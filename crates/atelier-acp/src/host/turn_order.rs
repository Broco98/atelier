//! 턴 차례 — 대화 하나의 턴 단계 · 대기 줄(S13) · 고친 곳의 앞(three-axes 결정 22) · 머리말 붙임(S11).
//!
//! 대화 호스트 안의 internal seam이다 — 호스트의 공개 interface(명령 · [`super::HostEvent`] · [`HostError`] ·
//! [`QueuedMessage`])는 이것을 드러내지 않는다. 잠금 · 스레드 · 파일 · tokio를 쥐지 않는다. 밖의 읽기(턴 손잡이 · 걸린
//! 권한 · 로그인 창구 · work가 남았나 · spec 폴더 찍기)와 할 일(기록 줄 · 대기 줄 바뀜 · 에이전트에 보냄 · 멈춤 · 권한 답 ·
//! 사라진 work 끄기)은 모두 [`TurnHands`]로 시킨다.
//!
//! 「턴이 돈다」([`TurnOrder::turning`])와 「대기 줄이 왜 가지 않나」([`Seat::hold`])는 여기 하나에서만 정한다.
//!
//! **불변식**
//! 1. 놓는 동사(`say` · `send_now` · `answer` · `resume` · `turn_ended` · `self_ended`)가 `Ok`로 돌아오면 대기 줄이 남았을
//!    때 늘 걸림이 있다. 예외는 둘이다 — 그 안에서 맨 앞을 보내지 못했을 때(`sent`를 못 적었거나 `prompt`가 실패)와,
//!    턴 끝에 사라진 work의 대화를 끄러 보냈을 때. 한 동사가 보내는 말은 많아야 하나다.
//! 2. 놓지 않는 동사(`opened` · `died` · `edit` · `delete` · `stop` · `self_started`)는 대기 줄을 보내지 않는다. 「다시 뜬
//!    뒤, 첫 놓는 동사 전」이 1이 깨져도 되는 하나뿐인 상태다 — 그래야 지금 보내기의 되살리기 길에서 옛 맨 앞이 먼저 가지
//!    않는다.
//! 3. 「지금 보내기」가 선 말은 많아야 하나이고, 있으면 맨 앞이다.
//! 4. 턴 끝에 견준 「지금」은 같은 동사 안에서만 다음 말의 턴 앞이 된다. 권한 답 · 다시 띄움 · 지금 보내기는 새로 찍는다.

use std::collections::VecDeque;
use std::time::Instant;

use serde_json::{json, Value};

use super::{HostError, QueuedMessage};
use crate::discovery::Agent;
use crate::login;
use crate::quote::{Attached, Quote};
use crate::records::{RecordError, TurnEndLine};
use crate::runtime::{AnswerError, TurnEnd};

/// 대화 하나의 턴 차례 — 살아 있나 · 도는 턴 · 대기 줄 · 다음 말에 머리말을 붙이나. `S`는 spec 폴더를 찍은 것이다(운영에서는
/// [`crate::spec_changes::Snapshot`]).
pub(super) struct TurnOrder<S> {
    phase: Phase<S>,
    /// 대기 줄(S13) — 턴이 도는 동안 받은 말. 메모리에만 둔다: 앱을 다시 켜면 비어 있다(재시작 뒤 저절로 보내는 놀람을
    /// 피한다). 에이전트가 죽어도 그대로 둔다 — 되살린 대화가 이어 쥔다.
    queue: VecDeque<Queued>,
    /// 다음 말에 머리말을 붙이나 — 에이전트 쪽 세션의 첫 말이다(S11).
    needs_preamble: bool,
}

/// 턴 단계.
enum Phase<S> {
    /// 에이전트가 죽었다. 다음 말이 되살리기(three-axes 티켓 10)로 다시 띄운다.
    Dead,
    /// 쉰다. `after_last`는 마지막 턴 끝에 견준 「지금」이다 — 그 뒤로 대기 줄의 말이 가지 않았으면 쥐어 두고, 에이전트가 스스로
    /// 이어 간 턴(S4)이 그것을 그 턴의 앞으로 삼는다.
    Idle { after_last: Option<S> },
    /// 우리가 보낸 턴이 돈다.
    Ours(OurTurn<S>),
    /// 에이전트가 스스로 이어 간 턴(S4)이 돈다 — 변환기가 턴 밖 시작을 알리면 서고 턴 밖 끝에서 걷힌다.
    Own(SelfTurn<S>),
    /// 둘이 겹쳤다 — 우리 턴이 도는 사이에 턴 밖 시작이 왔다(변환기가 그 말을 미뤄 두었다).
    Both(OurTurn<S>, SelfTurn<S>),
}

/// 우리가 보낸 턴 하나.
struct OurTurn<S> {
    started: Instant,
    /// 보내기 직전에 찍은 spec 폴더 — 턴 끝에 지금과 견준다(three-axes 결정 22).
    before: S,
}

/// 에이전트가 스스로 이어 간 턴 하나(S4).
struct SelfTurn<S> {
    started: Instant,
    /// 그 턴이 시작할 때의 spec 폴더 — 턴 밖 끝에서 견주어 고친 곳을 적는다. 우리 턴이 도는 사이에 시작했으면 없다 — 고친
    /// 곳은 우리 턴의 끝이 적는다.
    before: Option<S>,
    /// 우리가 멈췄나 — 턴 밖 끝 줄의 「우리가 멈췄나」다.
    stopped: bool,
}

/// 대기 줄에 든 말과, 보낼 때 그것이 에이전트 쪽 세션의 첫 말이면 앞에 붙일 머리말(S11), 그리고 붙었으면 인용과 그 인용
/// 블록(three-axes 티켓 27). 머리말과 인용 블록은 넣을 때 work를 읽어 지어 둔다 — 턴 끝(수신 루프 안)에서는 work를 읽지 않는다.
struct Queued {
    message: QueuedMessage,
    preamble: Value,
    quote: Option<Attached>,
}

/// 보낼 말 — 사람의 글, 에이전트 쪽 세션의 첫 말이면 앞에 붙일 머리말(S11), 붙었으면 인용(S12). 대기 줄에 들면 그대로 들고
/// 간다.
pub(super) struct Draft {
    pub(super) text: String,
    pub(super) preamble: Value,
    pub(super) quote: Option<Attached>,
}

/// 대기 줄이 왜 가지 않나 — 먼저 걸린 것 하나다. 이 차례로 보고, 앞에서 걸리면 뒤는 읽지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hold {
    /// 에이전트가 죽었다.
    Dead,
    /// 우리 턴이 돈다(턴 밖 턴과 겹쳤어도).
    OurTurn,
    /// 에이전트가 스스로 이어 간 턴이 돈다(S4).
    SelfTurn,
    /// 턴 손잡이가 없다 — 세션이 열리기 전이거나 끈 대화다.
    Unplugged,
    /// 답을 기다리는 권한 요청이 있다(three-axes 티켓 08).
    Permission,
    /// 그 대화가 로그인을 기다린다(three-axes 티켓 12).
    Login(Agent),
}

/// 턴 차례가 명령을 받지 않은 까닭. 호스트가 [`Refused::into_host`]로 화면의 오류로 옮긴다.
#[derive(Debug)]
pub(super) enum Refused {
    /// 대기 줄에 그 대기 id의 말이 없다.
    NotQueued(String),
    /// 로그인을 기다린다.
    Login(Agent),
    /// 에이전트가 떠 있지 않다.
    NotRunning,
    /// 걸려 있지 않은 권한 요청.
    PermissionClosed { request: String },
    /// 그 권한 요청이 준 선택지에 없는 optionId.
    PermissionOption { request: String, option: String },
    /// 에이전트에 보내지 못했다.
    Send(String),
    /// 기록을 적지 못했다.
    Record(RecordError),
}

impl Refused {
    /// 화면의 오류로 — 대화 id를 싣는 것은 싣는다.
    pub(super) fn into_host(self, conversation: &str) -> HostError {
        let conversation = conversation.to_owned();
        match self {
            Refused::NotQueued(queued) => HostError::QueuedNotFound(queued),
            Refused::Login(agent) => HostError::LoginRequired { agent, conversation },
            Refused::NotRunning => HostError::NotRunning(conversation),
            Refused::PermissionClosed { request } => HostError::PermissionClosed { conversation, request },
            Refused::PermissionOption { request, option } => HostError::PermissionOption { request, option },
            Refused::Send(reason) => HostError::Send(reason),
            Refused::Record(reason) => HostError::Record(reason),
        }
    }
}

impl<S> TurnOrder<S> {
    /// 에이전트 쪽 세션이 막 열린 대화 — 살아 있고, 턴이 쉬고, 대기 줄은 비었고, 첫 말에 머리말을 붙인다.
    pub(super) fn new() -> Self {
        Self { phase: Phase::Idle { after_last: None }, queue: VecDeque::new(), needs_preamble: true }
    }

    /// 세션이 열렸다(되살림 · 로그인 뒤 다시 띄움) — 어느 단계든 쉬는 것으로 돌리고, 다음 말에 머리말을 붙일지를 이 값으로 한다.
    /// 대기 줄은 그대로다 — 죽은 대화의 대기 줄은 되살린 대화가 이어 쥔다(S13). 대기 줄을 보내지 않는다: 무엇을 먼저 보낼지는
    /// 그 뒤의 보내기 · 지금 보내기 · 다시 띄움이 정한다.
    pub(super) fn opened(&mut self, needs_preamble: bool) {
        self.phase = Phase::Idle { after_last: None };
        self.needs_preamble = needs_preamble;
    }

    /// 에이전트가 죽었다 — 답 없이 사라진 턴에는 턴 끝이 없다(죽음 줄이 그 자리를 맡는다). 대기 줄 · 머리말은 그대로다. 대기
    /// 줄을 보내지 않는다.
    pub(super) fn died(&mut self) {
        self.phase = Phase::Dead;
    }

    /// 손을 붙인다 — 그 대화의 `state` 잠금 한 구간 동안만.
    pub(super) fn seat<H: TurnHands<Shot = S>>(&mut self, hands: H) -> Seat<'_, H> {
        Seat { order: self, hands }
    }

    /// 턴이 도나 — 우리 턴이든 에이전트가 스스로 이어 간 턴이든(S4). 「턴이 돈다」는 여기 하나에서만 정한다 — 멈추기 · 종료
    /// 확인의 셈(three-axes 티켓 23) · 사라진 work 끄기(S10)가 이것을 본다.
    pub(super) fn turning(&self) -> bool {
        matches!(self.phase, Phase::Ours(_) | Phase::Own(_) | Phase::Both(..))
    }

    /// 에이전트가 살아 있나.
    pub(super) fn alive(&self) -> bool {
        !matches!(self.phase, Phase::Dead)
    }

    /// 화면에 보일 대기 줄.
    pub(super) fn queue(&self) -> Vec<QueuedMessage> {
        self.queue.iter().map(|queued| queued.message.clone()).collect()
    }

    /// 대기 중인 말 수.
    pub(super) fn queued(&self) -> usize {
        self.queue.len()
    }

    /// 대기 줄에 그 대기 id의 말이 있나.
    pub(super) fn contains(&self, id: &str) -> bool {
        self.at(id).is_some()
    }

    fn at(&self, id: &str) -> Option<usize> {
        self.queue.iter().position(|queued| queued.message.id == id)
    }

    /// 단계를 꺼낸다 — 그 자리에는 쉬는 단계가 잠시 선다. 꺼낸 쪽이 곧 다음 단계를 넣는다.
    fn take_phase(&mut self) -> Phase<S> {
        std::mem::replace(&mut self.phase, Phase::Idle { after_last: None })
    }
}

/// 손을 붙인 턴 차례. 그 대화의 `state` 잠금 한 구간 동안만 빌린다. 동사는 `self`를 먹는다 — 한 잠금에 동사 하나다.
///
/// 놓는 동사(`say` · `send_now` · `answer` · `resume` · `turn_ended` · `self_ended`)는 걸림이 없으면 대기 줄의 맨 앞을
/// 보낸다. 놓지 않는 동사(`edit` · `delete` · `stop` · `self_started`)는 보내지 않는다.
pub(super) struct Seat<'a, H: TurnHands> {
    order: &'a mut TurnOrder<H::Shot>,
    hands: H,
}

impl<H: TurnHands> Seat<'_, H> {
    /// 대기 줄이 왜 가지 않나 — 걸림이 없으면 `None`이다. 죽음 → 우리 턴 → 스스로 이어 간 턴 → 손잡이 없음 → 걸린 권한 →
    /// 로그인 기다림 차례로 보고, 앞에서 걸리면 뒤는 읽지 않는다.
    fn hold(&self) -> Option<Hold> {
        match self.order.phase {
            Phase::Dead => return Some(Hold::Dead),
            Phase::Ours(_) | Phase::Both(..) => return Some(Hold::OurTurn),
            Phase::Own(_) => return Some(Hold::SelfTurn),
            Phase::Idle { .. } => {}
        }
        if !self.hands.plugged() {
            return Some(Hold::Unplugged);
        }
        if self.hands.permission_pending() {
            return Some(Hold::Permission);
        }
        self.hands.login_waiting().map(Hold::Login)
    }

    /// 보내기 — 걸림이 없고 대기 줄이 비었으면 곧바로 턴을 연다(대기 줄 바뀜 없음). 아니면 대기 줄 끝에 넣는다(S13): 걸림이
    /// 없으면(쉬는데 대기 줄이 남았다) 맨 앞부터 보내고 — 새 말이 앞지르지 않는다 — 걸렸으면 대기 줄 바뀜을 낸다.
    ///
    /// `before`는 부른 쪽이 잠금을 쥐기 전에 찍은 spec 폴더다(S2). 곧바로 가는 말이나 대기 줄의 맨 앞이 그것을 턴 앞으로 든다.
    ///
    /// 거절: 로그인을 기다리면(three-axes 티켓 12) [`Refused::Login`], 에이전트가 죽었거나 손잡이가 없으면 [`Refused::NotRunning`].
    /// 곧바로 연 턴의 실패(기록 · 보내기)는 돌려준다.
    pub(super) fn say(mut self, draft: Draft, before: H::Shot) -> Result<(), Refused> {
        if let Some(agent) = self.hands.login_waiting() {
            return Err(Refused::Login(agent));
        }
        if !self.order.alive() || !self.hands.plugged() {
            return Err(Refused::NotRunning);
        }
        let Draft { text, preamble, quote } = draft;
        if self.hold().is_none() && self.order.queue.is_empty() {
            return self.open(&text, quote.as_ref(), preamble, false, before);
        }
        let message = QueuedMessage { id: uuid::Uuid::new_v4().to_string(), text, send_now: false };
        self.order.queue.push_back(Queued { message, preamble, quote });
        if self.hold().is_none() {
            self.release(Some(before));
        } else {
            self.announce();
        }
        Ok(())
    }

    /// 지금 보내기 — 그 말을 맨 앞으로 옮겨 「지금 보내기」로 세운다(앞서 고른 말은 보통 대기 말로 돌아간다). 걸림이 없으면
    /// 멈출 턴이 없으니 곧바로 보낸다 — 턴 앞은 새로 찍고, 보내다 난 실패는 명령의 오류가 아니다. 걸렸으면 대기 줄 바뀜을 내고
    /// 도는 턴을 멈춘다(three-axes 결정 20) — 그 턴이 끝나면 맨 앞의 그 말이 간다. 손잡이가 없으면 알리기만 한다.
    ///
    /// 거절: 대기 줄에 없으면 [`Refused::NotQueued`], 로그인을 기다리면 [`Refused::Login`] — 대기 줄은 그대로 두고 멈추지도
    /// 않는다 — 에이전트가 죽었으면 [`Refused::NotRunning`].
    pub(super) fn send_now(mut self, id: &str) -> Result<(), Refused> {
        let at = self.order.at(id).ok_or_else(|| Refused::NotQueued(id.to_owned()))?;
        if let Some(agent) = self.hands.login_waiting() {
            return Err(Refused::Login(agent));
        }
        if !self.order.alive() {
            return Err(Refused::NotRunning);
        }
        let mut picked = self.order.queue.remove(at).expect("찾은 자리다");
        for other in &mut self.order.queue {
            other.message.send_now = false;
        }
        picked.message.send_now = true;
        self.order.queue.push_front(picked);
        if self.hold().is_none() {
            self.release(None);
            return Ok(());
        }
        self.announce();
        self.stop()
    }

    /// 권한 답 — 걸린 요청에 고른 선택지로 답한다. 답이 가면 걸림이 풀린 자리라 맨 앞을 보낸다(S13) — 턴 앞은 새로 찍는다.
    /// 턴 도중의 답이면 우리 턴이 걸림이라 턴 끝이 보낸다.
    ///
    /// 거절: 걸려 있지 않은 요청(손잡이가 없음 포함) [`Refused::PermissionClosed`], 준 선택지에 없는 optionId
    /// [`Refused::PermissionOption`], 보내지 못함 [`Refused::Send`]. 거절이면 대기 줄을 보내지 않는다.
    pub(super) fn answer(mut self, request: &str, option: &str) -> Result<(), Refused> {
        self.hands.answer(request, option).map_err(|error| match error {
            AnswerError::Closed => Refused::PermissionClosed { request: request.to_owned() },
            AnswerError::UnknownOption => Refused::PermissionOption { request: request.to_owned(), option: option.to_owned() },
            AnswerError::Send(reason) => Refused::Send(reason),
        })?;
        self.release(None);
        Ok(())
    }

    /// 로그인 걸림이 풀렸다 — 다시 띄운 대화가 맨 앞부터 보낸다(S13, three-axes 티켓 12). 턴 앞은 새로 찍는다.
    pub(super) fn resume(mut self) {
        self.release(None);
    }

    /// 대기 고치기 — 그 말의 글을 바꾸고 대기 줄 바뀜을 낸다. 대기 id와 차례는 그대로다.
    pub(super) fn edit(mut self, id: &str, text: &str) -> Result<(), Refused> {
        let at = self.order.at(id).ok_or_else(|| Refused::NotQueued(id.to_owned()))?;
        self.order.queue[at].message.text = text.to_owned();
        self.announce();
        Ok(())
    }

    /// 대기 지우기 — 그 말을 빼고 대기 줄 바뀜을 낸다.
    pub(super) fn delete(mut self, id: &str) -> Result<(), Refused> {
        let at = self.order.at(id).ok_or_else(|| Refused::NotQueued(id.to_owned()))?;
        self.order.queue.remove(at);
        self.announce();
        Ok(())
    }

    /// 멈추기 — 도는 턴(우리 턴이든 스스로 이어 간 턴이든)에 멈춤 하나를 보낸다. 기다리지 않는다. 도는 턴이 없거나 손잡이가
    /// 없으면 아무 일도 하지 않는다. 스스로 이어 간 턴이 돌면 그 턴 밖 끝 줄에 「우리가 멈췄나」가 실린다 — 멈춤을 보내지
    /// 못했으면 싣지 않는다. 대기 줄은 거두지 않는다.
    pub(super) fn stop(mut self) -> Result<(), Refused> {
        if !self.order.turning() || !self.hands.plugged() {
            return Ok(());
        }
        self.hands.cancel().map_err(Refused::Send)?;
        if let Phase::Own(own) | Phase::Both(_, own) = &mut self.order.phase {
            own.stopped = true;
        }
        Ok(())
    }

    /// 우리 턴의 끝 — 고친 곳을 견주어 `changes` 줄을 적고 턴 끝 줄을 적는다(three-axes 결정 22). 턴 도중에 로그인이 풀렸으면
    /// (`-32000`, 엔진을 가리지 않는다) 로그인 필요 줄을 적고 그 대화를 로그인 창구에 쥐게 한다(three-axes 티켓 12). 그 뒤
    /// work가 사라졌으면 끄러 보내고 끝난다(S10) — 꺼질 대화의 대기 줄은 보내지 않는다. 아니면 걸림이 없을 때 대기 줄의 맨 앞을
    /// 보낸다(S13) — 방금 견준 「지금」이 그 말의 턴 앞이다. 멈춰서 끝난 턴(`cancelled`)도 같다 — 지금 보내기가 이것을 쓴다.
    ///
    /// 턴 끝 줄과 다음 `sent`는 한 잠금 안에서 적는다 — 그 사이에 온 보내기가 대기 줄을 앞지르지 못한다. 기록을 적지 못하면
    /// 남은 줄을 건너뛰고 「지금」을 버리되(다음 말은 새로 찍는다) 끄기와 대기 줄은 이어 가고, 첫 오류를 돌려준다.
    ///
    /// 턴 밖 턴과 겹쳐 있었으면 그 턴이 남아 돈다. 우리 턴이 없는데 온 끝(늦은 끝)도 턴 끝 줄은 선다(걸린 시간 0).
    pub(super) fn turn_ended(mut self, end: TurnEnd) -> Result<(), RecordError> {
        let lost_login = matches!(&end.result, Err(error) if login::auth_required(error));
        let ours = match self.order.take_phase() {
            Phase::Ours(turn) => Some(turn),
            Phase::Both(turn, own) => {
                self.order.phase = Phase::Own(own);
                Some(turn)
            }
            other => {
                self.order.phase = other;
                None
            }
        };
        let (started, before) = ours.map_or((None, None), |turn| (Some(turn.started), Some(turn.before)));
        let (response, error) = match end.result {
            Ok(response) => (Some(response), None),
            Err(error) => (None, Some(error)),
        };
        let line = finish(started, response, error, end.cancelled_by_us, false);
        let closed = self.close(before, line).and_then(|now| {
            if lost_login {
                self.hands.login_lost()?;
            }
            Ok(now)
        });
        self.after_turn(closed)
    }

    /// 턴 밖 시작(S4) — 에이전트가 스스로 이어 간 턴이 선다. 그 끝까지 대기 줄은 가지 않는다. 고친 곳을 견줄 앞은 마지막 턴
    /// 끝에 견준 「지금」이고, 없으면 지금 찍는다. work가 사라졌으면 견주지 않는다. 우리 턴이 돌면 앞이 없다 — 우리 턴의 끝이
    /// 고친 곳을 맡는다. 죽었거나 이미 서 있으면 아무 일도 하지 않는다.
    pub(super) fn self_started(mut self) {
        self.order.phase = match self.order.take_phase() {
            Phase::Idle { after_last } => {
                let before = if self.hands.vanished() {
                    None
                } else {
                    Some(after_last.unwrap_or_else(|| self.hands.shoot()))
                };
                Phase::Own(SelfTurn { started: Instant::now(), before, stopped: false })
            }
            Phase::Ours(turn) => Phase::Both(turn, SelfTurn { started: Instant::now(), before: None, stopped: false }),
            other => other,
        };
    }

    /// 턴 밖 끝(S4) — 우리 턴의 끝과 같은 길이다(three-axes 티켓 06 · 07 · 11): 고친 곳을 견주어 `changes` 줄을 적고, 턴 밖 턴
    /// 표지를 단 턴 끝 줄을 적고, work가 사라졌으면 끄고, 아니면 걸림이 없을 때 대기 줄의 맨 앞을 보낸다. 시작을 못 보고 끝만
    /// 와도 턴 끝 줄은 선다(걸린 시간 0). 우리 턴이 도는 사이에 온 끝은 우리 턴을 건드리지 않는다 — 끄기도 대기 줄도 우리 턴의
    /// 끝이 맡는다.
    pub(super) fn self_ended(mut self, response: Value) -> Result<(), RecordError> {
        let own = match self.order.take_phase() {
            Phase::Own(own) => Some(own),
            Phase::Both(turn, own) => {
                self.order.phase = Phase::Ours(turn);
                Some(own)
            }
            other => {
                self.order.phase = other;
                None
            }
        };
        let (started, before, stopped) =
            own.map_or((None, None, false), |own| (Some(own.started), own.before, own.stopped));
        let line = finish(started, Some(response), None, stopped, true);
        let closed = self.close(before, line);
        if matches!(self.order.phase, Phase::Ours(_) | Phase::Both(..)) {
            return closed.map(|_| ());
        }
        self.after_turn(closed)
    }

    /// 턴 하나를 닫는다 — 앞이 있으면 지금을 찍어 견주고 바뀐 것이 있으면 `changes` 줄을 적은 뒤 턴 끝 줄을 적는다(three-axes
    /// 결정 22). 그래서 화면이 턴 끝 줄을 받을 때 그 턴의 고친 곳은 이미 와 있다. work 폴더가 그 사이 사라졌으면(아카이브 ·
    /// 삭제) 견주지 않는다 — 옛 자리에는 아무것도 없어 모든 파일이 「지움」으로 적히기 때문이다.
    ///
    /// 견준 「지금」을 돌려준다 — 대기 줄의 다음 말이 곧바로 가면 그 턴의 앞이 된다(폴더를 두 번 걷지 않는다).
    fn close(&mut self, before: Option<H::Shot>, line: TurnEndLine) -> Result<Option<H::Shot>, RecordError> {
        let mut now = None;
        if let Some(before) = before {
            if !self.hands.vanished() {
                let shot = self.hands.shoot();
                self.hands.changes(&before, &shot)?;
                now = Some(shot);
            }
        }
        self.hands.turn_end(line)?;
        Ok(now)
    }

    /// 턴 끝(우리 턴 · 스스로 이어 간 턴) 뒤 — work가 사라졌으면 끄러 보내고 끝난다(S10). 아니면 걸림이 없고 대기 줄이
    /// 남았을 때 맨 앞을 보내고(방금 견준 「지금」이 그 말의 턴 앞이다), 아니면 쉴 때만 그 「지금」을 쥐어 둔다(스스로 이어 간
    /// 턴의 앞). 닫다 난 기록 오류를 돌려준다 — 그때 「지금」은 없다.
    fn after_turn(mut self, closed: Result<Option<H::Shot>, RecordError>) -> Result<(), RecordError> {
        let (written, now) = match closed {
            Ok(now) => (Ok(()), now),
            Err(error) => (Err(error), None),
        };
        if self.hands.retire_if_vanished() {
            return written;
        }
        if self.hold().is_none() && !self.order.queue.is_empty() {
            self.release(now);
        } else if let Phase::Idle { after_last } = &mut self.order.phase {
            *after_last = now;
        }
        written
    }

    /// 대기 줄의 맨 앞을 보낸다(S13) — 걸림이 없을 때만, 하나만. `before`는 이미 찍어 둔 턴 앞이다(턴 끝에 견준 「지금」) —
    /// 없으면 여기서 찍는다. 보내고 나면 성공이든 실패든 대기 줄 바뀜을 낸다. 실패는 턴 끝 줄(오류)이 기록에 섰거나 그 말을
    /// 잃은 것이라 돌려줄 곳이 없다.
    fn release(&mut self, before: Option<H::Shot>) {
        if self.hold().is_some() {
            return;
        }
        let Some(Queued { message, preamble, quote }) = self.order.queue.pop_front() else { return };
        let before = before.unwrap_or_else(|| self.hands.shoot());
        let sent = self.open(&message.text, quote.as_ref(), preamble, message.send_now, before);
        self.announce();
        if let Err(Refused::Record(reason) | Refused::Send(reason)) = sent {
            eprintln!("{reason}");
        }
    }

    /// 턴을 연다 — `sent`를 먼저 적고(보낸 뒤에 적으면 첫 update가 그보다 앞에 설 수 있다), 턴을 열고, 에이전트에 보낸다.
    /// 에이전트 쪽 세션의 첫 말이면 머리말을 앞에 붙이고(S11), 그 뒤에 지난 말(Thread의 Session, v1 구현 스펙 S10)을, 인용이
    /// 붙은 말이면 사람의 글 바로 앞에 인용 블록을 둔다(S12). 걸림이 없을 때만 부른다.
    ///
    /// `sent`를 적지 못하면 아무것도 바꾸지 않는다(대기 줄에서 꺼낸 말이면 그 말을 잃는다). 보내지 못하면 턴을 연 채로 두지
    /// 않는다 — 화면이 「일하는 중」에 갇히지 않게 턴 끝 줄(오류)까지 적는다. 머리말은 붙인 것으로 남고, 그 끝은 대기 줄을 보내지
    /// 않는다: 연결이 끊긴 것이라 다음 말도 가지 못한다.
    fn open(
        &mut self,
        text: &str,
        quote: Option<&Attached>,
        preamble: Value,
        send_now: bool,
        before: H::Shot,
    ) -> Result<(), Refused> {
        let mut prompt = Vec::new();
        if self.order.needs_preamble {
            prompt.push(preamble);
        }
        prompt.extend(self.hands.past());
        if let Some(attached) = quote {
            prompt.push(attached.block.clone());
        }
        prompt.push(json!({"type": "text", "text": text}));
        self.hands.sent(text, quote.map(|attached| &attached.quote), &prompt, send_now).map_err(Refused::Record)?;
        let started = Instant::now();
        self.order.needs_preamble = false;
        if let Err(reason) = self.hands.prompt(prompt) {
            self.order.phase = Phase::Idle { after_last: None };
            let line = finish(Some(started), None, Some(json!({"message": reason})), false, false);
            self.close(Some(before), line).map_err(Refused::Record)?;
            return Err(Refused::Send(reason));
        }
        self.order.phase = Phase::Ours(OurTurn { started, before });
        Ok(())
    }

    /// 대기 줄 바뀜을 낸다 — 바뀔 때마다 대기 줄 전체를 싣는다. 알리는 차례가 바뀐 차례다.
    fn announce(&mut self) {
        let queue = self.order.queue();
        self.hands.queue_changed(queue);
    }
}

/// 턴 끝 줄 하나 — 끝 까닭은 답의 `stopReason`이고, 걸린 시간은 시작을 못 봤으면 0이다.
fn finish(
    started: Option<Instant>,
    response: Option<Value>,
    error: Option<Value>,
    cancelled_by_us: bool,
    out_of_turn: bool,
) -> TurnEndLine {
    TurnEndLine {
        stop_reason: response.as_ref().and_then(|response| response["stopReason"].as_str()).map(str::to_owned),
        duration_ms: started.map_or(0, |at| u64::try_from(at.elapsed().as_millis()).unwrap_or(u64::MAX)),
        cancelled_by_us,
        out_of_turn,
        response,
        error,
    }
}

/// 턴 차례가 밖에 시키는 일(seam). adapter는 둘이다 — 호스트의 대화(운영, 찍은 것은 spec 폴더)와 시험의 가짜 손.
///
/// 모두 대화의 `state` 잠금 안에서 불린다. 이 안에서 대화의 수신(`Conv::receive`)이나 호스트를 다시 부르거나 `state`를 쥐지
/// 않는다 — 대기 요청 표 · 로그인 창구 · 기록 파일만 잠근다.
pub(super) trait TurnHands {
    /// spec 폴더를 한 번 찍은 것.
    type Shot;

    /// 턴 손잡이가 섰나. 부를 때마다 정본의 지금 값을 읽는다 — 아래 읽기 넷도 같다. 사본을 두지 않는다.
    fn plugged(&self) -> bool;
    /// 답을 기다리는 권한 요청이 있나. 손잡이가 없으면 false다.
    fn permission_pending(&self) -> bool;
    /// 그 대화가 로그인을 기다리면 그 에이전트.
    fn login_waiting(&self) -> Option<Agent>;
    /// work가 사라졌나(S10).
    fn vanished(&self) -> bool;
    /// spec 폴더를 찍는다 — 폴더를 걷는다(느리다).
    fn shoot(&mut self) -> Self::Shot;
    /// 보낼 말에 붙일 지난 말 블록(v1 구현 스펙 S10) — 보내는 그때 기록에서 짓는다(기록을 읽는다). 넘길 말이 없으면 없다.
    fn past(&mut self) -> Option<Value>;

    /// 고친 곳 — 견주어 바뀐 것이 있을 때만 줄을 적는다. 기록은 부르는 차례가 곧 seq 차례다 — 아래 넷도 같다.
    fn changes(&mut self, before: &Self::Shot, now: &Self::Shot) -> Result<(), RecordError>;
    /// 턴 끝 줄.
    fn turn_end(&mut self, line: TurnEndLine) -> Result<(), RecordError>;
    /// 보낸 말 — `prompt`는 에이전트에게 실제로 갈 블록 그대로다.
    fn sent(&mut self, text: &str, quote: Option<&Quote>, prompt: &[Value], send_now: bool) -> Result<(), RecordError>;
    /// 로그인 필요 줄을 적고, 적었을 때만 로그인 창구에 그 대화를 쥐게 한다(three-axes 티켓 12).
    fn login_lost(&mut self) -> Result<(), RecordError>;
    /// 대기 줄 바뀜 — 대기 줄 전체를 싣는다.
    fn queue_changed(&mut self, queue: Vec<QueuedMessage>);

    /// 에이전트에 턴을 연다. 기다리지 않는다.
    fn prompt(&mut self, blocks: Vec<Value>) -> Result<(), String>;
    /// 도는 턴을 멈춘다. 기다리지 않는다.
    fn cancel(&mut self) -> Result<(), String>;
    /// 걸린 권한 요청에 답한다. 손잡이가 없으면 닫힌 요청이다.
    fn answer(&mut self, request: &str, option: &str) -> Result<(), AnswerError>;
    /// work가 사라졌으면 그 대화를 끄러 보내고 true(S10). 지켜볼 것이 없으면 false다.
    fn retire_if_vanished(&mut self) -> bool;
}

impl<H: TurnHands + ?Sized> TurnHands for &mut H {
    type Shot = H::Shot;

    fn plugged(&self) -> bool {
        (**self).plugged()
    }
    fn permission_pending(&self) -> bool {
        (**self).permission_pending()
    }
    fn login_waiting(&self) -> Option<Agent> {
        (**self).login_waiting()
    }
    fn vanished(&self) -> bool {
        (**self).vanished()
    }
    fn shoot(&mut self) -> Self::Shot {
        (**self).shoot()
    }
    fn past(&mut self) -> Option<Value> {
        (**self).past()
    }
    fn changes(&mut self, before: &Self::Shot, now: &Self::Shot) -> Result<(), RecordError> {
        (**self).changes(before, now)
    }
    fn turn_end(&mut self, line: TurnEndLine) -> Result<(), RecordError> {
        (**self).turn_end(line)
    }
    fn sent(&mut self, text: &str, quote: Option<&Quote>, prompt: &[Value], send_now: bool) -> Result<(), RecordError> {
        (**self).sent(text, quote, prompt, send_now)
    }
    fn login_lost(&mut self) -> Result<(), RecordError> {
        (**self).login_lost()
    }
    fn queue_changed(&mut self, queue: Vec<QueuedMessage>) {
        (**self).queue_changed(queue)
    }
    fn prompt(&mut self, blocks: Vec<Value>) -> Result<(), String> {
        (**self).prompt(blocks)
    }
    fn cancel(&mut self) -> Result<(), String> {
        (**self).cancel()
    }
    fn answer(&mut self, request: &str, option: &str) -> Result<(), AnswerError> {
        (**self).answer(request, option)
    }
    fn retire_if_vanished(&mut self) -> bool {
        (**self).retire_if_vanished()
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    /// 가짜 손이 한 일 — 기록에 선 줄 · 에이전트에 간 것 · 대기 줄 바뀜. 적지 못한 줄은 남지 않는다.
    #[derive(Debug, Clone, PartialEq)]
    enum Did {
        /// 견준 앞과 지금.
        Changes(u32, u32),
        /// `zero`는 걸린 시간이 0인가다.
        TurnEnd { out_of_turn: bool, by_us: bool, error: bool, zero: bool },
        /// `preamble` · `quote`는 그 블록이 실렸나다.
        Sent { text: String, send_now: bool, preamble: bool, quote: bool },
        Prompt,
        Cancel,
        Answer,
        /// 대기 줄 바뀜 — 그 글들.
        Queue(Vec<String>),
        LoginLost,
    }

    /// 적지 못하게 할 기록 줄.
    #[derive(Debug, Clone, Copy, PartialEq)]
    enum Line {
        Changes,
        TurnEnd,
        Sent,
        LoginLost,
    }

    const PREAMBLE: &str = "머리말";
    const QUOTE_BLOCK: &str = "인용 블록";

    /// 시험의 adapter — 찍은 것은 찍은 차례의 수다(1부터). 스위치로 밖의 상태와 실패를 정하고, 한 일을 `log`에 남긴다.
    struct FakeHands {
        plugged: bool,
        permission: bool,
        login: Option<Agent>,
        vanished: bool,
        retire: bool,
        prompt_fails: bool,
        cancel_fails: bool,
        answer: Result<(), AnswerError>,
        fails: Option<Line>,
        shots: u32,
        /// 보낼 때 짓는 지난 말 블록의 글.
        past: Option<&'static str>,
        prompts: Vec<Vec<Value>>,
        log: Vec<Did>,
    }

    impl Default for FakeHands {
        fn default() -> Self {
            Self {
                plugged: true,
                permission: false,
                login: None,
                vanished: false,
                retire: false,
                prompt_fails: false,
                cancel_fails: false,
                answer: Ok(()),
                fails: None,
                shots: 0,
                past: None,
                prompts: Vec::new(),
                log: Vec::new(),
            }
        }
    }

    impl FakeHands {
        fn write(&mut self, line: Line, did: Did) -> Result<(), RecordError> {
            if self.fails == Some(line) {
                return Err(format!("{line:?}을 적지 못했다"));
            }
            self.log.push(did);
            Ok(())
        }
    }

    impl TurnHands for FakeHands {
        type Shot = u32;

        fn plugged(&self) -> bool {
            self.plugged
        }
        fn permission_pending(&self) -> bool {
            self.plugged && self.permission
        }
        fn login_waiting(&self) -> Option<Agent> {
            self.login
        }
        fn vanished(&self) -> bool {
            self.vanished
        }
        fn shoot(&mut self) -> u32 {
            self.shots += 1;
            self.shots
        }
        fn past(&mut self) -> Option<Value> {
            self.past.map(|text| json!({"type": "text", "text": text}))
        }
        fn changes(&mut self, before: &u32, now: &u32) -> Result<(), RecordError> {
            self.write(Line::Changes, Did::Changes(*before, *now))
        }
        fn turn_end(&mut self, line: TurnEndLine) -> Result<(), RecordError> {
            let did = Did::TurnEnd {
                out_of_turn: line.out_of_turn,
                by_us: line.cancelled_by_us,
                error: line.error.is_some(),
                zero: line.duration_ms == 0,
            };
            self.write(Line::TurnEnd, did)
        }
        fn sent(&mut self, text: &str, quote: Option<&Quote>, prompt: &[Value], send_now: bool) -> Result<(), RecordError> {
            let carries = |block: &str| prompt.iter().any(|sent| sent["text"] == block);
            let did = Did::Sent {
                text: text.to_owned(),
                send_now,
                preamble: carries(PREAMBLE),
                quote: quote.is_some() && carries(QUOTE_BLOCK),
            };
            self.write(Line::Sent, did)
        }
        fn login_lost(&mut self) -> Result<(), RecordError> {
            self.write(Line::LoginLost, Did::LoginLost)?;
            self.login = Some(Agent::Codex);
            Ok(())
        }
        fn queue_changed(&mut self, queue: Vec<QueuedMessage>) {
            self.log.push(Did::Queue(queue.into_iter().map(|queued| queued.text).collect()));
        }
        fn prompt(&mut self, blocks: Vec<Value>) -> Result<(), String> {
            self.log.push(Did::Prompt);
            self.prompts.push(blocks);
            if self.prompt_fails {
                return Err("연결이 끊겼다".into());
            }
            Ok(())
        }
        fn cancel(&mut self) -> Result<(), String> {
            if self.cancel_fails {
                return Err("멈추기를 보내지 못했다".into());
            }
            self.log.push(Did::Cancel);
            Ok(())
        }
        fn answer(&mut self, _request: &str, _option: &str) -> Result<(), AnswerError> {
            if !self.plugged {
                return Err(AnswerError::Closed);
            }
            self.answer.clone()?;
            self.log.push(Did::Answer);
            self.permission = false;
            Ok(())
        }
        fn retire_if_vanished(&mut self) -> bool {
            self.retire
        }
    }

    /// 턴 차례와 가짜 손 한 벌. 보내기의 턴 앞(부른 쪽이 잠금 밖에서 찍은 것)은 900부터 오른다 — 손이 찍은 것과 가른다.
    struct Rig {
        order: TurnOrder<u32>,
        hands: FakeHands,
        said: u32,
    }

    fn draft(text: &str) -> Draft {
        Draft { text: text.to_owned(), preamble: json!({"type": "text", "text": PREAMBLE}), quote: None }
    }

    fn ended(stop_reason: &str) -> TurnEnd {
        TurnEnd { result: Ok(json!({"stopReason": stop_reason})), cancelled_by_us: false }
    }

    fn cancelled() -> TurnEnd {
        TurnEnd { result: Ok(json!({"stopReason": "cancelled"})), cancelled_by_us: true }
    }

    fn login_lost() -> TurnEnd {
        TurnEnd { result: Err(json!({"code": -32000, "message": "Authentication required"})), cancelled_by_us: false }
    }

    impl Rig {
        fn new() -> Self {
            Self { order: TurnOrder::new(), hands: FakeHands::default(), said: 900 }
        }

        fn seat(&mut self) -> Seat<'_, &mut FakeHands> {
            self.order.seat(&mut self.hands)
        }

        fn hold(&mut self) -> Option<Hold> {
            self.seat().hold()
        }

        fn say(&mut self, text: &str) -> Result<(), Refused> {
            self.said += 1;
            let before = self.said;
            self.seat().say(draft(text), before)
        }

        /// 대기 줄의 그 글을 지금 보낸다.
        fn send_now(&mut self, text: &str) -> Result<(), Refused> {
            let id = self.id(text);
            self.seat().send_now(&id)
        }

        fn id(&self, text: &str) -> String {
            self.order.queue().into_iter().find(|queued| queued.text == text).expect("대기 줄에 그 말이 있다").id
        }

        fn texts(&self) -> Vec<String> {
            self.order.queue().into_iter().map(|queued| queued.text).collect()
        }

        /// 지금까지 한 일의 수 — [`Rig::since`]의 기준.
        fn mark(&self) -> usize {
            self.hands.log.len()
        }

        fn since(&self, mark: usize) -> &[Did] {
            &self.hands.log[mark..]
        }

        fn sent_since(&self, mark: usize) -> Vec<String> {
            self.since(mark)
                .iter()
                .filter_map(|did| match did {
                    Did::Sent { text, .. } => Some(text.clone()),
                    _ => None,
                })
                .collect()
        }
    }

    fn sent(text: &str) -> Did {
        Did::Sent { text: text.to_owned(), send_now: false, preamble: false, quote: false }
    }

    fn queue(texts: &[&str]) -> Did {
        Did::Queue(texts.iter().map(|text| (*text).to_owned()).collect())
    }

    fn turn_end() -> Did {
        Did::TurnEnd { out_of_turn: false, by_us: false, error: false, zero: false }
    }

    // ── 1. 걸림 표 ─────────────────────────────────────────────────────────────────────────────────────────────

    /// 걸림 표의 줄 — 대기 줄에 「대기」 하나가 든 채 대기 줄이 가지 않는 까닭.
    #[derive(Debug, Clone, Copy, PartialEq)]
    enum Cond {
        Dead,
        Ours,
        Own,
        Both,
        Unplugged,
        Permission,
        Login,
    }

    const CONDS: [Cond; 7] = [Cond::Dead, Cond::Ours, Cond::Own, Cond::Both, Cond::Unplugged, Cond::Permission, Cond::Login];

    /// 걸림 표의 칸 — 넣는 사건.
    #[derive(Debug, Clone, Copy, PartialEq)]
    enum Event {
        Say,
        SendNow,
        Answer,
        Resume,
        TurnEnded,
        TurnCancelled,
        TurnLostLogin,
        SelfEnded,
    }

    const EVENTS: [Event; 8] = [
        Event::Say,
        Event::SendNow,
        Event::Answer,
        Event::Resume,
        Event::TurnEnded,
        Event::TurnCancelled,
        Event::TurnLostLogin,
        Event::SelfEnded,
    ];

    /// 걸림 표의 답.
    #[derive(Debug, Clone, Copy, PartialEq)]
    enum Then {
        /// 대기 줄의 맨 앞(「대기」)이 간다.
        Goes,
        /// 받았고 대기 줄은 남는다.
        Stays,
        /// 거절하고 아무것도 바꾸지 않는다.
        Refused(&'static str),
    }

    /// 대기 줄에 「대기」 하나가 든 채 `cond`로 걸린 턴 차례.
    fn held(cond: Cond) -> Rig {
        let mut rig = Rig::new();
        match cond {
            Cond::Own => {
                rig.seat().self_started();
                rig.say("대기").unwrap();
            }
            Cond::Both => {
                rig.say("첫 말").unwrap();
                rig.seat().self_started();
                rig.say("대기").unwrap();
            }
            _ => {
                rig.say("첫 말").unwrap();
                rig.say("대기").unwrap();
            }
        }
        match cond {
            Cond::Dead => rig.order.died(),
            Cond::Unplugged => rig.hands.plugged = false,
            Cond::Permission => rig.hands.permission = true,
            Cond::Login => rig.hands.login = Some(Agent::Codex),
            _ => {}
        }
        if matches!(cond, Cond::Unplugged | Cond::Permission | Cond::Login) {
            rig.seat().turn_ended(ended("end_turn")).unwrap();
        }
        assert_eq!(rig.texts(), ["대기"], "{cond:?}");
        rig
    }

    fn refused_name(refused: &Refused) -> &'static str {
        match refused {
            Refused::NotQueued(_) => "NotQueued",
            Refused::Login(_) => "Login",
            Refused::NotRunning => "NotRunning",
            Refused::PermissionClosed { .. } => "PermissionClosed",
            Refused::PermissionOption { .. } => "PermissionOption",
            Refused::Send(_) => "Send",
            Refused::Record(_) => "Record",
        }
    }

    fn put(rig: &mut Rig, event: Event) -> Result<(), &'static str> {
        let id = rig.id("대기");
        let seat = rig.order.seat(&mut rig.hands);
        let refused = |result: Result<(), Refused>| result.map_err(|refused| refused_name(&refused));
        match event {
            Event::Say => {
                rig.said += 1;
                refused(seat.say(draft("새 말"), rig.said))
            }
            Event::SendNow => refused(seat.send_now(&id)),
            Event::Answer => refused(seat.answer("0", "allow_once")),
            Event::Resume => {
                seat.resume();
                Ok(())
            }
            Event::TurnEnded => seat.turn_ended(ended("end_turn")).map_err(|_| "기록"),
            Event::TurnCancelled => seat.turn_ended(cancelled()).map_err(|_| "기록"),
            Event::TurnLostLogin => seat.turn_ended(login_lost()).map_err(|_| "기록"),
            Event::SelfEnded => seat.self_ended(json!({"stopReason": "end_turn"})).map_err(|_| "기록"),
        }
    }

    fn expected(cond: Cond, event: Event) -> Then {
        use Then::{Goes, Refused, Stays};
        match (cond, event) {
            (Cond::Dead, Event::Say | Event::SendNow) => Refused("NotRunning"),
            (Cond::Unplugged, Event::Say) => Refused("NotRunning"),
            (Cond::Unplugged, Event::Answer) => Refused("PermissionClosed"),
            (Cond::Login, Event::Say | Event::SendNow) => Refused("Login"),
            (Cond::Ours, Event::TurnEnded | Event::TurnCancelled) => Goes,
            (Cond::Own, Event::SelfEnded) => Goes,
            (Cond::Permission, Event::Answer) => Goes,
            _ => Stays,
        }
    }

    #[test]
    fn 걸림마다_무엇이_대기_줄을_보내고_무엇이_거절되는지가_표대로다() {
        let hold_of = |cond: Cond| match cond {
            Cond::Dead => Hold::Dead,
            Cond::Ours | Cond::Both => Hold::OurTurn,
            Cond::Own => Hold::SelfTurn,
            Cond::Unplugged => Hold::Unplugged,
            Cond::Permission => Hold::Permission,
            Cond::Login => Hold::Login(Agent::Codex),
        };
        for cond in CONDS {
            for event in EVENTS {
                let mut rig = held(cond);
                assert_eq!(rig.hold(), Some(hold_of(cond)), "{cond:?}");
                let before = rig.texts();
                let mark = rig.mark();

                let result = put(&mut rig, event);

                let cell = format!("{cond:?} × {event:?}: {:?}", rig.since(mark));
                let went = rig.sent_since(mark);
                match expected(cond, event) {
                    Then::Goes => {
                        assert_eq!(result, Ok(()), "{cell}");
                        assert_eq!(went, ["대기"], "{cell}");
                        assert_eq!(rig.texts(), Vec::<String>::new(), "{cell}");
                    }
                    Then::Stays => {
                        assert_eq!(result, Ok(()), "{cell}");
                        assert_eq!(went, Vec::<String>::new(), "{cell}");
                        assert!(rig.texts().contains(&"대기".to_owned()), "{cell}");
                    }
                    Then::Refused(name) => {
                        assert_eq!(result, Err(name), "{cell}");
                        assert_eq!(rig.since(mark), [], "거절은 아무것도 하지 않는다 — {cell}");
                        assert_eq!(rig.texts(), before, "{cell}");
                    }
                }
                let cancelled = rig.since(mark).contains(&Did::Cancel);
                let turning = matches!(cond, Cond::Ours | Cond::Own | Cond::Both);
                assert_eq!(cancelled, event == Event::SendNow && turning, "지금 보내기는 도는 턴만 멈춘다 — {cell}");
            }
        }
    }

    /// 걸린 시간을 지운 꼴 — 시작한 턴의 걸린 시간은 시계에 따라 0일 수도 있어, 차례를 재는 시험은 이것으로 견준다.
    fn plain(log: &[Did]) -> Vec<Did> {
        log.iter()
            .map(|did| match did {
                Did::TurnEnd { out_of_turn, by_us, error, .. } => {
                    Did::TurnEnd { out_of_turn: *out_of_turn, by_us: *by_us, error: *error, zero: false }
                }
                other => other.clone(),
            })
            .collect()
    }

    fn self_end() -> Did {
        Did::TurnEnd { out_of_turn: true, by_us: false, error: false, zero: false }
    }

    fn failed_end() -> Did {
        Did::TurnEnd { out_of_turn: false, by_us: false, error: true, zero: false }
    }

    fn self_response() -> Value {
        json!({"stopReason": "end_turn"})
    }

    // ── 2. 기록 차례(S26) ──────────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn 턴_끝은_고친_곳_턴_끝_다음_말_보냄_대기_줄_바뀜_차례다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        let mark = rig.mark();

        rig.seat().turn_ended(ended("end_turn")).unwrap();

        assert_eq!(plain(rig.since(mark)), [Did::Changes(901, 1), turn_end(), sent("대기"), Did::Prompt, queue(&[])]);
    }

    #[test]
    fn 턴_도중에_로그인이_풀리면_턴_끝_뒤에_로그인_필요가_서고_대기_줄은_로그인을_기다린다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        let mark = rig.mark();

        rig.seat().turn_ended(login_lost()).unwrap();

        assert_eq!(plain(rig.since(mark)), [Did::Changes(901, 1), failed_end(), Did::LoginLost]);
        assert_eq!(rig.hold(), Some(Hold::Login(Agent::Codex)));
        assert_eq!(rig.texts(), ["대기"]);
    }

    #[test]
    fn 턴_끝에_work가_사라졌으면_끄러_보내고_대기_줄을_보내지_않는다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        rig.hands.retire = true;
        let mark = rig.mark();

        rig.seat().turn_ended(ended("end_turn")).unwrap();

        assert_eq!(plain(rig.since(mark)), [Did::Changes(901, 1), turn_end()]);
        assert_eq!(rig.texts(), ["대기"], "꺼질 대화의 대기 줄은 가지 않는다(S10)");
    }

    #[test]
    fn 대기_줄의_맨_앞을_보내다_못_보내면_보냄_고친_곳_오류_턴_끝_대기_줄_바뀜_차례고_대기_줄은_멈춘다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("가").unwrap();
        rig.say("나").unwrap();
        rig.hands.prompt_fails = true;
        let mark = rig.mark();

        rig.seat().turn_ended(ended("end_turn")).unwrap();

        assert_eq!(
            plain(rig.since(mark)),
            [Did::Changes(901, 1), turn_end(), sent("가"), Did::Prompt, Did::Changes(1, 2), failed_end(), queue(&["나"])]
        );
        assert!(!rig.order.turning(), "턴을 연 채로 두지 않는다");
        assert_eq!(rig.texts(), ["나"], "연결이 끊긴 것이라 다음 말도 보내지 않는다");
    }

    #[test]
    fn 쉬는데_대기_줄이_비었으면_보내기는_대기_줄_바뀜_없이_곧바로_보낸다() {
        let mut rig = Rig::new();

        rig.say("첫 말").unwrap();

        assert_eq!(
            rig.since(0),
            [Did::Sent { text: "첫 말".into(), send_now: false, preamble: true, quote: false }, Did::Prompt],
            "에이전트 쪽 세션의 첫 말이라 머리말이 붙는다(S11)"
        );
        assert!(rig.order.turning());
        assert_eq!(rig.hands.shots, 0, "턴 앞은 부른 쪽이 잠금 밖에서 찍었다");
    }

    #[test]
    fn 다시_뜬_뒤의_지금_보내기는_새로_찍어_보내고_대기_줄_바뀜을_낸다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("가").unwrap();
        rig.say("나").unwrap();
        rig.order.died();
        rig.order.opened(false);
        assert_eq!(rig.hold(), None, "다시 뜬 뒤 첫 놓는 동사 전에는 걸림 없이 대기 줄이 남는다");
        let mark = rig.mark();

        rig.send_now("나").unwrap();

        assert_eq!(
            rig.since(mark),
            [Did::Sent { text: "나".into(), send_now: true, preamble: false, quote: false }, Did::Prompt, queue(&["가"])],
            "옛 맨 앞(가)이 먼저 가지 않는다"
        );
        assert_eq!(rig.hands.shots, 1);
    }

    #[test]
    fn 턴이_돌_때의_지금_보내기는_대기_줄_바뀜_뒤에_멈춤을_보낸다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("가").unwrap();
        rig.say("나").unwrap();
        let mark = rig.mark();

        rig.send_now("나").unwrap();

        assert_eq!(rig.since(mark), [queue(&["나", "가"]), Did::Cancel]);
        let front = &rig.order.queue()[0];
        assert!(front.send_now && rig.order.queue()[1..].iter().all(|queued| !queued.send_now));

        let mark = rig.mark();
        rig.seat().turn_ended(cancelled()).unwrap();
        assert_eq!(
            plain(rig.since(mark)),
            [
                Did::Changes(901, 1),
                Did::TurnEnd { out_of_turn: false, by_us: true, error: false, zero: false },
                Did::Sent { text: "나".into(), send_now: true, preamble: false, quote: false },
                Did::Prompt,
                queue(&["가"]),
            ],
            "멈춰서 끝난 턴 뒤에 그 말이 간다"
        );
    }

    #[test]
    fn 보낸_블록은_머리말_인용_글_차례고_대기_줄의_말은_넣을_때의_머리말과_인용을_들고_간다() {
        let attached = Attached {
            quote: Quote { file: "drafts/idea.md".into(), start: 3, end: 4, text: "고른 글".into() },
            block: json!({"type": "text", "text": QUOTE_BLOCK}),
        };
        let quoted = |text: &str| Draft { quote: Some(attached.clone()), ..draft(text) };
        let mut rig = Rig::new();

        rig.seat().say(quoted("첫 말"), 901).unwrap();
        rig.seat().say(quoted("대기"), 902).unwrap();
        rig.order.died();
        rig.order.opened(true);
        rig.seat().resume();

        let preamble = json!({"type": "text", "text": PREAMBLE});
        let quote_block = json!({"type": "text", "text": QUOTE_BLOCK});
        assert_eq!(
            rig.hands.prompts,
            [
                vec![preamble.clone(), quote_block.clone(), json!({"type": "text", "text": "첫 말"})],
                vec![preamble, quote_block, json!({"type": "text", "text": "대기"})],
            ],
            "다시 열린 세션이 새 세션이면 대기 줄의 말에도 머리말이 다시 붙는다(S11)"
        );
        assert!(rig.since(0).contains(&Did::Sent { text: "대기".into(), send_now: false, preamble: true, quote: true }));
    }

    #[test]
    fn 지난_말은_머리말_뒤에_서고_대기_줄의_말은_넣을_때가_아니라_보내는_그때의_지난_말을_든다() {
        let mut rig = Rig::new();
        rig.hands.past = Some("지난 말 하나");
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        // 대기 줄에 든 사이 다른 참여자가 말했다(v1 구현 스펙 S10).
        rig.hands.past = Some("지난 말 둘");
        rig.seat().turn_ended(ended("end_turn")).unwrap();

        let text = |text: &str| json!({"type": "text", "text": text});
        assert_eq!(
            rig.hands.prompts,
            [vec![text(PREAMBLE), text("지난 말 하나"), text("첫 말")], vec![text("지난 말 둘"), text("대기")]]
        );
    }

    #[test]
    fn 시작을_못_본_끝은_걸린_시간이_0이고_시작한_턴은_그때부터_잰다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        rig.seat().self_ended(self_response()).unwrap();

        let zeros: Vec<bool> = rig
            .since(0)
            .iter()
            .filter_map(|did| if let Did::TurnEnd { zero, .. } = did { Some(*zero) } else { None })
            .collect();
        assert_eq!(zeros, [false, true, true]);
    }

    // ── 3. 고친 곳의 앞 넘기기(three-axes 결정 22) ──────────────────────────────────────────────────────────────────

    #[test]
    fn 대기_줄이_이어_가는_턴_끝은_폴더를_한_번만_찍고_그것이_다음_턴의_앞이_된다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();

        rig.seat().turn_ended(ended("end_turn")).unwrap();
        assert_eq!(rig.hands.shots, 1);

        let mark = rig.mark();
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        assert_eq!(plain(rig.since(mark)), [Did::Changes(1, 2), turn_end()], "앞 턴이 고친 것은 앞 턴에만 선다");
    }

    #[test]
    fn 풀림이_미뤄진_턴_끝의_지금은_스스로_이어_간_턴의_앞이_되고_다시_찍지_않는다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        rig.hands.permission = true;
        rig.seat().turn_ended(ended("end_turn")).unwrap();

        rig.seat().self_started();
        assert_eq!(rig.hands.shots, 1, "마지막 턴 끝에 견준 「지금」을 그 턴의 앞으로 삼는다");

        let mark = rig.mark();
        rig.seat().self_ended(self_response()).unwrap();
        assert_eq!(plain(rig.since(mark)), [Did::Changes(1, 2), self_end()]);
    }

    #[test]
    fn 쉬다가_시작한_턴_밖_턴은_마지막_지금이_없으면_시작할_때_찍는다() {
        let mut rig = Rig::new();
        rig.seat().self_started();
        assert_eq!(rig.hands.shots, 1);
        rig.seat().self_ended(self_response()).unwrap();
        assert_eq!(plain(rig.since(0)), [Did::Changes(1, 2), self_end()]);
    }

    #[test]
    fn 우리_턴_사이에_시작한_턴_밖_턴은_고친_곳을_적지_않고_우리_턴의_끝이_적는다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.seat().self_started();
        assert_eq!(rig.hands.shots, 0);

        let mark = rig.mark();
        rig.seat().self_ended(self_response()).unwrap();
        assert_eq!(plain(rig.since(mark)), [self_end()]);
        assert!(rig.order.turning(), "우리 턴은 그대로 돈다");

        let mark = rig.mark();
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        assert_eq!(plain(rig.since(mark)), [Did::Changes(901, 1), turn_end()]);
    }

    #[test]
    fn work가_사라졌으면_견주지도_찍지도_보내지도_않는다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        rig.hands.vanished = true;
        rig.hands.retire = true;
        let mark = rig.mark();

        rig.seat().turn_ended(ended("end_turn")).unwrap();
        rig.seat().self_started();
        rig.seat().self_ended(self_response()).unwrap();

        assert_eq!(plain(rig.since(mark)), [turn_end(), self_end()]);
        assert_eq!(rig.hands.shots, 0);
    }

    // ── 4. 겹침 ──────────────────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn 턴_밖_턴_끝에_권한이_걸려_있으면_대기_줄은_답하는_자리에서_새로_찍어_간다() {
        let mut rig = Rig::new();
        rig.seat().self_started();
        rig.say("대기").unwrap();
        rig.hands.permission = true;

        let mark = rig.mark();
        rig.seat().self_ended(self_response()).unwrap();
        assert_eq!(plain(rig.since(mark)), [Did::Changes(1, 2), self_end()]);
        assert_eq!(rig.hold(), Some(Hold::Permission));

        let mark = rig.mark();
        rig.seat().answer("0", "allow_once").unwrap();
        assert_eq!(
            rig.since(mark),
            [
                Did::Answer,
                Did::Sent { text: "대기".into(), send_now: false, preamble: true, quote: false },
                Did::Prompt,
                queue(&[]),
            ],
            "에이전트 쪽 세션의 첫 말이다(S11)"
        );
        assert_eq!(rig.hands.shots, 3, "답하는 자리는 턴 끝의 「지금」을 쓰지 않고 새로 찍는다");

        let mark = rig.mark();
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        assert_eq!(plain(rig.since(mark))[0], Did::Changes(3, 4));
    }

    #[test]
    fn 로그인을_기다리는_동안의_지금_보내기는_거절되고_멈추지도_대기_줄을_바꾸지도_않는다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        rig.hands.login = Some(Agent::Codex);
        let mark = rig.mark();

        let refused = rig.send_now("대기");

        assert!(matches!(refused, Err(Refused::Login(Agent::Codex))), "{refused:?}");
        assert_eq!(rig.since(mark), []);
        assert!(!rig.order.queue()[0].send_now);
    }

    #[test]
    fn 턴_없이_권한이_걸린_동안의_지금_보내기는_멈추지_않고_세워_두었다가_답하면_간다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("가").unwrap();
        rig.say("나").unwrap();
        rig.hands.permission = true;
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        let mark = rig.mark();

        rig.send_now("나").unwrap();
        assert_eq!(rig.since(mark), [queue(&["나", "가"])], "멈출 턴이 없다");

        let mark = rig.mark();
        rig.seat().answer("0", "allow_once").unwrap();
        assert_eq!(
            rig.since(mark),
            [
                Did::Answer,
                Did::Sent { text: "나".into(), send_now: true, preamble: false, quote: false },
                Did::Prompt,
                queue(&["가"]),
            ]
        );
    }

    #[test]
    fn 턴_도중에_걸린_권한에_답해도_대기_줄은_그_턴의_끝을_기다렸다가_간다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.hands.permission = true;
        rig.say("둘째 말").unwrap();
        assert_eq!(rig.since(2), [queue(&["둘째 말"])], "걸린 동안의 말은 대기 줄에 든다");

        let mark = rig.mark();
        rig.seat().answer("0", "allow_once").unwrap();
        assert_eq!(rig.since(mark), [Did::Answer], "답해도 우리 턴이 돈다");

        let mark = rig.mark();
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        assert_eq!(plain(rig.since(mark)), [Did::Changes(901, 1), turn_end(), sent("둘째 말"), Did::Prompt, queue(&[])]);
    }

    #[test]
    fn 겹친_턴은_우리_턴이_끝나도_턴_밖_턴이_대기_줄을_붙잡고_그_끝이_새로_찍어_보낸다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.seat().self_started();
        rig.say("대기").unwrap();

        let mark = rig.mark();
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        assert_eq!(plain(rig.since(mark)), [Did::Changes(901, 1), turn_end()]);
        assert_eq!(rig.hold(), Some(Hold::SelfTurn));

        let mark = rig.mark();
        rig.seat().self_ended(self_response()).unwrap();
        assert_eq!(plain(rig.since(mark)), [self_end(), sent("대기"), Did::Prompt, queue(&[])]);
        assert_eq!(rig.hands.shots, 2, "턴 밖 턴은 앞이 없어 견주지 않았다 — 맨 앞의 턴 앞은 새로 찍는다");

        let mark = rig.mark();
        rig.seat().turn_ended(ended("end_turn")).unwrap();
        assert_eq!(plain(rig.since(mark))[0], Did::Changes(2, 3));
    }

    // ── 5. 실패 갈래 ─────────────────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn 대기_줄의_맨_앞을_보냄으로_적지_못하면_그_말을_잃고_대기_줄_바뀜이_난다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("가").unwrap();
        rig.say("나").unwrap();
        rig.hands.fails = Some(Line::Sent);
        let mark = rig.mark();

        rig.seat().turn_ended(ended("end_turn")).unwrap();

        assert_eq!(plain(rig.since(mark)), [Did::Changes(901, 1), turn_end(), queue(&["나"])]);
        assert_eq!(rig.texts(), ["나"]);
        assert!(!rig.order.turning());
    }

    #[test]
    fn 보내지_못한_첫_말도_머리말을_붙인_것으로_남아_다음_말에는_머리말이_없다() {
        let mut rig = Rig::new();
        rig.hands.prompt_fails = true;

        let refused = rig.say("첫 말");

        assert!(matches!(&refused, Err(Refused::Send(reason)) if reason == "연결이 끊겼다"), "{refused:?}");
        assert_eq!(
            plain(rig.since(0)),
            [
                Did::Sent { text: "첫 말".into(), send_now: false, preamble: true, quote: false },
                Did::Prompt,
                Did::Changes(901, 1),
                failed_end(),
            ]
        );
        assert!(!rig.order.turning());

        rig.hands.prompt_fails = false;
        let mark = rig.mark();
        rig.say("둘째 말").unwrap();
        assert_eq!(rig.since(mark)[0], Did::Sent { text: "둘째 말".into(), send_now: false, preamble: false, quote: false });
    }

    #[test]
    fn 보내지_못한_턴의_끝_줄도_적지_못하면_기록_오류로_돌려준다() {
        let mut rig = Rig::new();
        rig.hands.prompt_fails = true;
        rig.hands.fails = Some(Line::TurnEnd);

        let refused = rig.say("첫 말");

        assert!(matches!(refused, Err(Refused::Record(_))), "{refused:?}");
    }

    #[test]
    fn 고친_곳을_적지_못하면_턴_끝도_로그인_필요도_없고_다음_말은_새로_찍어_간다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        rig.hands.fails = Some(Line::Changes);
        let mark = rig.mark();

        let written = rig.seat().turn_ended(login_lost());

        assert!(written.is_err());
        assert_eq!(rig.since(mark), [sent("대기"), Did::Prompt, queue(&[])]);
        assert_eq!(rig.hands.shots, 2, "실패한 비교의 「지금」은 버린다");
        assert_eq!(rig.hands.login, None);
    }

    #[test]
    fn 턴_끝_줄을_적지_못하면_로그인_필요도_쥐기도_없다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        rig.hands.fails = Some(Line::TurnEnd);
        let mark = rig.mark();

        let written = rig.seat().turn_ended(login_lost());

        assert!(written.is_err());
        assert_eq!(rig.since(mark), [Did::Changes(901, 1), sent("대기"), Did::Prompt, queue(&[])]);
        assert_eq!((rig.hands.shots, rig.hands.login), (2, None));
    }

    #[test]
    fn 로그인_필요_줄을_적지_못하면_창구에_쥐이지_않고_대기_줄은_새로_찍어_간다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.say("대기").unwrap();
        rig.hands.fails = Some(Line::LoginLost);
        let mark = rig.mark();

        let written = rig.seat().turn_ended(login_lost());

        assert!(written.is_err());
        assert_eq!(plain(rig.since(mark)), [Did::Changes(901, 1), failed_end(), sent("대기"), Did::Prompt, queue(&[])]);
        assert_eq!((rig.hands.shots, rig.hands.login), (2, None));
    }

    // ── 6. 거절 차례 ─────────────────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn 보내기는_로그인_기다림을_먼저_보고_그다음_죽음과_손잡이_없음을_본다() {
        let mut rig = held(Cond::Dead);
        rig.hands.login = Some(Agent::Claude);
        assert!(matches!(rig.say("말"), Err(Refused::Login(Agent::Claude))));
        rig.hands.login = None;
        assert!(matches!(rig.say("말"), Err(Refused::NotRunning)));

        let mut rig = Rig::new();
        rig.hands.plugged = false;
        assert!(matches!(rig.say("말"), Err(Refused::NotRunning)), "손잡이가 없으면 떠 있지 않은 대화다");
        assert_eq!(rig.since(0), []);
    }

    #[test]
    fn 지금_보내기는_대기_줄에_있나를_먼저_보고_그다음_로그인_그다음_죽음을_본다() {
        let mut rig = held(Cond::Dead);
        let id = rig.id("대기");
        rig.hands.login = Some(Agent::Codex);
        assert!(matches!(rig.seat().send_now("no-such-queued"), Err(Refused::NotQueued(id)) if id == "no-such-queued"));
        assert!(matches!(rig.seat().send_now(&id), Err(Refused::Login(Agent::Codex))));
        rig.hands.login = None;
        assert!(matches!(rig.seat().send_now(&id), Err(Refused::NotRunning)));
        assert!(!rig.order.queue()[0].send_now, "거절은 「지금 보내기」를 세우지 않는다");
    }

    #[test]
    fn 대기_고치기와_지우기는_대기_id로_고르고_대기_id와_차례를_지키며_못_고르면_거절한다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        for text in ["가", "나", "다"] {
            rig.say(text).unwrap();
        }
        let before = rig.order.queue();
        let mark = rig.mark();

        rig.seat().edit(&before[1].id, "나를 고쳤다").unwrap();
        rig.seat().delete(&before[0].id).unwrap();

        assert_eq!(rig.since(mark), [queue(&["가", "나를 고쳤다", "다"]), queue(&["나를 고쳤다", "다"])]);
        assert_eq!(
            rig.order.queue(),
            [QueuedMessage { text: "나를 고쳤다".into(), ..before[1].clone() }, before[2].clone()],
            "고쳐도 대기 id와 차례는 그대로다"
        );
        let mark = rig.mark();
        assert!(matches!(rig.seat().delete(&before[0].id), Err(Refused::NotQueued(id)) if id == before[0].id));
        assert!(matches!(rig.seat().edit("no-such-queued", "글"), Err(Refused::NotQueued(_))));
        assert_eq!(rig.since(mark), [], "고르지 못한 고치기 · 지우기는 대기 줄을 바꾸지 않는다");
    }

    #[test]
    fn 권한_답이_가지_않으면_까닭대로_거절하고_대기_줄을_보내지_않는다() {
        let cases = [
            (AnswerError::Closed, "PermissionClosed"),
            (AnswerError::UnknownOption, "PermissionOption"),
            (AnswerError::Send("끊겼다".into()), "Send"),
        ];
        for (error, name) in cases {
            let mut rig = held(Cond::Permission);
            rig.hands.answer = Err(error);
            let mark = rig.mark();

            let refused = rig.seat().answer("0", "allow_once").unwrap_err();

            assert_eq!(refused_name(&refused), name);
            assert_eq!(rig.since(mark), []);
            assert_eq!(rig.texts(), ["대기"]);
        }
    }

    #[test]
    fn 거절은_대화_id를_실어_화면의_오류로_옮겨진다() {
        let conversation = "c1".to_owned();
        let request = "0".to_owned();
        let cases = [
            (Refused::NotQueued("q1".into()), HostError::QueuedNotFound("q1".into())),
            (
                Refused::Login(Agent::Claude),
                HostError::LoginRequired { agent: Agent::Claude, conversation: conversation.clone() },
            ),
            (Refused::NotRunning, HostError::NotRunning(conversation.clone())),
            (
                Refused::PermissionClosed { request: request.clone() },
                HostError::PermissionClosed { conversation: conversation.clone(), request: request.clone() },
            ),
            (
                Refused::PermissionOption { request: request.clone(), option: "nope".into() },
                HostError::PermissionOption { request, option: "nope".into() },
            ),
            (Refused::Send("끊겼다".into()), HostError::Send("끊겼다".into())),
            (Refused::Record("막혔다".into()), HostError::Record("막혔다".into())),
        ];
        for (refused, host) in cases {
            assert_eq!(refused.into_host(&conversation), host);
        }
    }

    // ── 7. 멈추기와 「우리가 멈췄나」 ─────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn 스스로_이어_간_턴을_멈추면_그_턴_밖_끝에_우리가_멈춤이_실린다() {
        let mut rig = Rig::new();
        rig.seat().self_started();

        rig.seat().stop().unwrap();
        rig.seat().self_ended(json!({"stopReason": "cancelled"})).unwrap();

        assert_eq!(
            plain(rig.since(0)),
            [Did::Cancel, Did::Changes(1, 2), Did::TurnEnd { out_of_turn: true, by_us: true, error: false, zero: false }]
        );
    }

    #[test]
    fn 겹친_턴을_멈추면_멈춤은_하나이고_턴_밖_끝은_우리가_멈춤을_싣고_우리_턴의_끝은_런타임의_표지를_싣는다() {
        let mut rig = Rig::new();
        rig.say("첫 말").unwrap();
        rig.seat().self_started();
        let mark = rig.mark();

        rig.seat().stop().unwrap();
        rig.seat().self_ended(json!({"stopReason": "cancelled"})).unwrap();
        rig.seat().turn_ended(ended("cancelled")).unwrap();

        assert_eq!(
            plain(rig.since(mark)),
            [
                Did::Cancel,
                Did::TurnEnd { out_of_turn: true, by_us: true, error: false, zero: false },
                Did::Changes(901, 1),
                turn_end(),
            ]
        );
    }

    #[test]
    fn 도는_턴이_없거나_손잡이가_없으면_멈추기는_아무_일도_하지_않는다() {
        for mut rig in [Rig::new(), held(Cond::Dead), held(Cond::Permission)] {
            let mark = rig.mark();
            rig.seat().stop().unwrap();
            assert_eq!(rig.since(mark), []);
        }
        let mut rig = held(Cond::Ours);
        rig.hands.plugged = false;
        let mark = rig.mark();
        rig.seat().stop().unwrap();
        assert_eq!(rig.since(mark), [], "끈 대화의 턴에는 멈춤을 보낼 곳이 없다");
    }

    #[test]
    fn 멈춤을_보내지_못하면_보내기_오류이고_우리가_멈춤을_싣지_않는다() {
        let mut rig = Rig::new();
        rig.seat().self_started();
        rig.hands.cancel_fails = true;

        let refused = rig.seat().stop();
        rig.seat().self_ended(self_response()).unwrap();

        assert!(matches!(&refused, Err(Refused::Send(reason)) if reason == "멈추기를 보내지 못했다"), "{refused:?}");
        assert_eq!(plain(rig.since(0)), [Did::Changes(1, 2), self_end()]);
    }

    // ── 8. 무작위 동사열의 불변식 ───────────────────────────────────────────────────────────────────────────────────

    /// 시험 안의 작은 의사 난수(xorshift64) — 새 의존 없이, 같은 씨앗이면 같은 동사열이다.
    struct Dice(u64);

    impl Dice {
        fn roll(&mut self, sides: usize) -> usize {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            usize::try_from(self.0 % u64::try_from(sides).unwrap()).unwrap()
        }
    }

    #[test]
    fn 어떤_동사열에서도_놓는_동사_뒤에_대기_줄이_남으면_걸림이_있고_지금_보내기는_맨_앞_하나뿐이다() {
        for seed in 1..=300u64 {
            let mut dice = Dice(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
            let mut rig = Rig::new();
            let mut said = 0;
            for step in 0..200 {
                let mark = rig.mark();
                let pick = dice.roll(19);
                let releasing = pick <= 7;
                let result: Result<(), String> = match pick {
                    0 | 1 => {
                        said += 1;
                        rig.say(&format!("말 {said}")).map_err(|refused| format!("{refused:?}"))
                    }
                    2 => {
                        let queue = rig.order.queue();
                        let id = if queue.is_empty() { "없는 말".to_owned() } else { queue[dice.roll(queue.len())].id.clone() };
                        rig.seat().send_now(&id).map_err(|refused| format!("{refused:?}"))
                    }
                    3 => rig.seat().answer("0", "allow_once").map_err(|refused| format!("{refused:?}")),
                    4 => {
                        rig.seat().resume();
                        Ok(())
                    }
                    5 => rig.seat().turn_ended([ended("end_turn"), cancelled(), login_lost()][dice.roll(3)].clone()),
                    6 | 7 => rig.seat().self_ended(self_response()),
                    8 => {
                        let queue = rig.order.queue();
                        let id = if queue.is_empty() { "없는 말".to_owned() } else { queue[dice.roll(queue.len())].id.clone() };
                        rig.seat().edit(&id, "고친 말").map_err(|refused| format!("{refused:?}"))
                    }
                    9 => {
                        let queue = rig.order.queue();
                        let id = if queue.is_empty() { "없는 말".to_owned() } else { queue[dice.roll(queue.len())].id.clone() };
                        rig.seat().delete(&id).map_err(|refused| format!("{refused:?}"))
                    }
                    10 => rig.seat().stop().map_err(|refused| format!("{refused:?}")),
                    11 | 12 => {
                        rig.seat().self_started();
                        Ok(())
                    }
                    13 => {
                        rig.order.opened(dice.roll(2) == 0);
                        Ok(())
                    }
                    14 => {
                        rig.order.died();
                        Ok(())
                    }
                    15 => {
                        rig.hands.permission = !rig.hands.permission;
                        Ok(())
                    }
                    16 => {
                        rig.hands.login = if rig.hands.login.is_some() { None } else { Some(Agent::Codex) };
                        Ok(())
                    }
                    17 => {
                        rig.hands.plugged = !rig.hands.plugged;
                        Ok(())
                    }
                    _ => {
                        rig.hands.prompt_fails = !rig.hands.prompt_fails;
                        Ok(())
                    }
                };
                let at = format!("씨앗 {seed} · {step}번째(동사 {pick}): {:?}", rig.since(mark));
                let went = rig.sent_since(mark).len();
                assert!(went <= 1, "한 동사가 보내는 말은 많아야 하나다 — {at}");
                if !releasing {
                    assert_eq!(went, 0, "놓지 않는 동사는 대기 줄을 보내지 않는다 — {at}");
                }
                let failed_to_send = rig.hands.prompt_fails && rig.since(mark).contains(&Did::Prompt);
                if releasing && result.is_ok() && !failed_to_send && rig.order.queued() > 0 {
                    assert!(rig.hold().is_some(), "놓는 동사 뒤에 대기 줄이 남으면 걸림이 있다 — {at}");
                }
                let flags: Vec<usize> =
                    rig.order.queue().iter().enumerate().filter(|(_, queued)| queued.send_now).map(|(at, _)| at).collect();
                assert!(flags.is_empty() || flags == [0], "「지금 보내기」는 맨 앞 하나뿐이다 — {at}");
            }
        }
    }
}
