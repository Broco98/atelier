//! 쓰기 자리 — Work 하나에서 지금 파일을 고칠 수 있는 Session 하나(v1 구현 스펙 §10 · S20, v1 티켓 18). plan 「Work 하나에 코드를
//! 쓰는 Agent는 동시에 하나」를 엔진이 지킨다.
//!
//! - **편집 도구가 허용되는 순간 그 Session이 쥔다.** 판정(v1 티켓 22, [`super::gate`])이 묻지 않고 편집을 허용하는 순간과, 사람이
//!   승인 카드에서 편집을 허락하는 순간이다. 편집 도구는 ACP 도구 종류(`toolCall.kind`)가 `edit` · `delete` · `move`인 것이다 —
//!   Runtime의 도구 이름으로 가르지 않는다(`policy::Act`).
//! - **턴이 끝나면 놓는다.** 그 Session의 턴 끝 · 스스로 이어 간 턴의 끝 · 죽음, 그리고 떠 있는 표에서 꺼낼 때다. 그 턴이 연 호출
//!   고리는 그 턴 안에서 끝난다 — 부른 쪽은 불린 턴이 끝날 때까지 결과를 기다린다(§8).
//! - **명령은 쥐지 않는다.** 테스트를 돌리는 리뷰어가 막히지 않게(S20). 명령 요청은 이 자리를 보지 않는다.
//! - **고리 안에서는 이어 쓴다.** 쥔 Session이 지금 턴의 호출 고리(같은 Thread에서 이 일을 맡긴 쪽들) 안이면 그 자리를 쓴다 — 부른
//!   쪽은 기다리는 중이라 겹치지 않는다. 주인은 그대로라 불린 턴이 끝나도 놓이지 않는다.
//! - **다른 Session의 편집 요청은 거절한다.** 판정의 셋째 칸이다(§9) — 사람에게 묻지 않고 「<주인>이 이 Work를 고치는 중이에요 — 끝난
//!   뒤 다시 하세요」를 그 Agent에게 돌려준다(`permission` 줄 `decided`). 물은 사이에 다른 Session이 쥐었으면, 사람이 허락해도 같은
//!   글로 거절한다.
//! - Work 없는 Thread에는 쓰기 자리가 없다 — 그 Thread 폴더는 그 Thread만 쓴다.
//!
//! three-axes 승인 길(`session/request_permission`)에서만 본다. 사용자의 Claude Code 설정이 허용한 편집은 엔진에 오지 않으므로 이
//! 자리를 쥐지도 거절되지도 않는다(S17).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use serde_json::Value;

use super::call::subject;
use super::gate::resolve;
use super::writing::{Changed, DocDesk, ToolStep};
use super::SessionKey;
use crate::host::{Conv, Emit, HostEvent, OutOfTurn};
use crate::policy::Card;
use crate::runtime::{Ruling, RuntimeEvent, Sink};

/// 쓰기 자리의 표 — Work slug → 쥔 Session. 호스트에 하나다. 잠금은 짧게만 쥐고, 쥔 채 대화의 잠금을 쥐지 않는다(대화 → 표의 차례).
#[derive(Default)]
pub(super) struct WriteSeats(Mutex<HashMap<String, SessionKey>>);

impl WriteSeats {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, SessionKey>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 그 Session이 그 Work를 고치는 것을 막는 주인 — 아무도 쥐지 않았거나 그 Session이 쓸 수 있는 자리면 없다.
    fn owner_against(&self, work: &str, key: &SessionKey, chain: &[String]) -> Option<SessionKey> {
        self.lock().get(work).filter(|owner| !shares(owner, key, chain)).cloned()
    }

    /// 쥔다 — 비었으면 그 Session이 쥐고(`Ok(true)`), 그 Session이 쓸 수 있는 자리면 주인을 그대로 둔다(`Ok(false)`). 막히면 주인이다.
    fn take(&self, work: &str, key: &SessionKey, chain: &[String]) -> Result<bool, SessionKey> {
        let mut seats = self.lock();
        match seats.get(work) {
            Some(owner) if shares(owner, key, chain) => Ok(false),
            Some(owner) => Err(owner.clone()),
            None => {
                seats.insert(work.to_owned(), key.clone());
                Ok(true)
            }
        }
    }

    /// 그 Session이 쥔 자리를 놓는다. 쥔 것이 없으면 아무 일도 하지 않는다.
    fn release(&self, key: &SessionKey) {
        self.lock().retain(|_, owner| owner != key);
    }
}

/// 주인이 쥔 자리를 이 Session이 쓰나 — 주인이거나, 같은 Thread에서 지금 턴의 호출 고리에 주인이 있다(고리 안에서는 이어 쓴다).
fn shares(owner: &SessionKey, key: &SessionKey, chain: &[String]) -> bool {
    owner == key || (owner.thread == key.thread && chain.contains(&owner.handle))
}

/// 사람의 권한 답이 쓰기 자리에 무엇을 했나.
pub(super) enum Grant {
    /// 편집을 허락하는 답이 아니거나, 이미 쓸 수 있는 자리다 — 그대로 답한다.
    Unchanged,
    /// 편집을 허락해 이 Session이 자리를 새로 쥐었다 — 답이 가지 못하면 놓는다.
    Took,
    /// 물은 사이에 다른 Session이 쥐었다 — 그 답 대신 이 엔진의 거부로 답한다.
    Refused(Ruling),
}

/// Session 하나의 쓰기 자리 손 — Session을 열 때마다 짓는다. 판정([`super::gate::Gate`]) · 턴 끝을 보는 sink([`Writer::watching`]) ·
/// 사람의 권한 답([`Writer::grant`] · [`Writer::remembered`])이 이것을 쓴다. 판정이 사람에게 물은 요청을 적어 두는 자리도 이것이다 —
/// 사람의 답이 그 요청의 선택지와 「다시 묻지 않기」로 줄 허락을 여기서 읽는다(v1 티켓 24).
pub(super) struct Writer {
    seats: Arc<WriteSeats>,
    data_root: PathBuf,
    key: SessionKey,
    /// 이 Session의 Thread가 이은 Work — 없으면 쓰기 자리가 없다. Work 없이 열린 Session의 Thread가 Work에 이어지면 곧바로 그 Work다
    /// ([`Writer::link`], v1 티켓 30) — 작업 폴더는 다음에 열 때부터 바뀌지만(S11) 판정 · 쓰기 자리는 그 턴부터 Work의 것이다.
    work: Mutex<Option<String>>,
    /// 이 Session의 대화 — 지금 턴의 호출 고리를 읽는다. 약하게 쥔다: 런타임이 판정을 쥐고, 대화가 런타임의 손잡이를 쥔다.
    conv: Weak<Conv>,
    /// 사람에게 물은 요청 — 요청 id → 적어 둔 것. 턴이 끝나면 비운다(그 턴의 요청은 거둬졌다).
    asked: Mutex<HashMap<String, Noted>>,
    /// 이 Session이 쓰는 문서를 적는 자리(v1 티켓 34) — 호스트에 하나다. 턴 끝을 보는 sink가 편집 도구의 갱신을 여기 적는다.
    docs: Docs,
}

/// 문서 쓰는 중을 적고 내는 손(v1 티켓 34) — 호스트의 [`DocDesk`] · 이벤트를 내보내는 closure와, 상대 경로를 풀 이 Session의 작업
/// 폴더 · 화면에 보일 이 Agent의 이름.
pub(super) struct Docs {
    pub(super) desk: Arc<DocDesk>,
    pub(super) emit: Arc<Emit>,
    pub(super) cwd: PathBuf,
    pub(super) name: String,
}

/// 사람에게 물은 요청 하나에 적어 둔 것.
struct Noted {
    /// 그 요청의 선택지(`optionId`, `kind`).
    options: Vec<(String, String)>,
    /// 세운 카드 — 질문의 답과 권한 답이 엇갈리지 않게, 계획 넘어가기의 허락이 「계획만」을 나가게(v1 티켓 26).
    card: Card,
    /// 편집인가 — 사람이 허락하면 쓰기 자리를 쥔다.
    edit: bool,
    /// 「다시 묻지 않기」로 줄 허락 — 판정이 물음과 함께 낸 규칙 이름들. 비었으면 줄 수 없다.
    grant: Vec<String>,
}

impl Writer {
    pub(super) fn new(
        seats: &Arc<WriteSeats>,
        data_root: PathBuf,
        key: SessionKey,
        work: Option<String>,
        conv: &Arc<Conv>,
        docs: Docs,
    ) -> Arc<Self> {
        Arc::new(Self {
            seats: Arc::clone(seats),
            data_root,
            key,
            work: Mutex::new(work),
            conv: Arc::downgrade(conv),
            asked: Mutex::new(HashMap::new()),
            docs,
        })
    }

    fn lock_asked(&self) -> MutexGuard<'_, HashMap<String, Noted>> {
        self.asked.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 이 Session이 열릴 때 이은 Work — 물어보는 정도를 함께 쓰는 Session들을 찾고(v1 티켓 23), 「다시 묻지 않기」 허락을 둘 자리다
    /// (없으면 그 Thread 폴더, v1 티켓 24). 판정이 허락을 읽는 자리와 같다.
    pub(super) fn work(&self) -> Option<String> {
        self.work.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }

    /// 이 Session의 Thread가 Work에 이어졌다(v1 티켓 30 — Work 만들기 카드) — 다음 요청부터 판정이 그 Work의 자리 · 물어보는 정도를 읽고,
    /// 편집은 그 Work의 쓰기 자리를 쥔다.
    pub(super) fn link(&self, slug: &str) {
        *self.work.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(slug.to_owned());
    }

    /// 이 Session의 편집을 막는 주인의 글(§10) — 이 Work의 쓰기 자리를 다른 Session이 쥐었으면 그 거절 글, 아무도 쥐지 않았거나 이
    /// Session이 쓸 수 있는 자리면 없다. 판정의 입력(「쓰기 자리 주인」)이다.
    pub(super) fn blocker(&self) -> Option<String> {
        let work = self.work()?;
        let owner = self.seats.owner_against(&work, &self.key, &self.chain())?;
        Some(self.busy(&owner))
    }

    /// 판정이 편집을 묻지 않고 허용하는 순간 쓰기 자리를 쥔다. 그사이 다른 Session이 쥐었으면 그 주인의 거절 글이다. Work 없는 Thread는
    /// 쥘 자리가 없다.
    pub(super) fn take(&self) -> Result<(), String> {
        let Some(work) = self.work() else { return Ok(()) };
        self.seats.take(&work, &self.key, &self.chain()).map(drop).map_err(|owner| self.busy(&owner))
    }

    /// 사람에게 묻는 요청을 적어 둔다 — 편집을 허락하는 답이면 쥐고([`Writer::grant`]), 「다시 묻지 않기」면 그 허락을 읽는다
    /// ([`Writer::remembered`]).
    pub(super) fn note(&self, request_id: &str, options: Vec<(String, String)>, card: Card, edit: bool, grant: Vec<String>) {
        self.lock_asked().insert(request_id.to_owned(), Noted { options, card, edit, grant });
    }

    /// 물은 요청의 카드와 선택지 — 사람이 답하기 전에 그 요청이 아직 걸려 있는지 · 어느 카드인지 본다. 이미 닫혔으면 없다.
    pub(super) fn asked(&self, request: &str) -> Option<(Card, Vec<(String, String)>)> {
        self.lock_asked().get(request).map(|noted| (noted.card, noted.options.clone()))
    }

    /// 사람이 「다시 묻지 않기」로 그 선택지를 고르면 줄 허락 — 물은 요청이고, 허락하는 선택지이고, 판정이 허락을 냈을 때만 있다.
    pub(super) fn remembered(&self, request: &str, option: &str) -> Option<Vec<String>> {
        let asked = self.lock_asked();
        let noted = asked.get(request)?;
        let allows = noted.options.iter().any(|(id, kind)| id == option && kind.starts_with("allow"));
        (allows && !noted.grant.is_empty()).then(|| noted.grant.clone())
    }

    /// 사람의 권한 답 — 물은 편집을 허락하는 답이면 쓰기 자리를 쥔다. 물은 사이에 다른 Session이 쥐었으면 그 답 대신 주인의 글로 거부한다.
    pub(super) fn grant(&self, request: &str, option: &str) -> Grant {
        let Some(work) = self.work() else { return Grant::Unchanged };
        let Some(options) = self.lock_asked().get(request).filter(|noted| noted.edit).map(|noted| noted.options.clone()) else {
            return Grant::Unchanged;
        };
        if !options.iter().any(|(id, kind)| id == option && kind.starts_with("allow")) {
            return Grant::Unchanged;
        }
        match self.seats.take(&work, &self.key, &self.chain()) {
            Ok(true) => Grant::Took,
            Ok(false) => Grant::Unchanged,
            Err(owner) => match rejecting(&options) {
                Some(reject) => Grant::Refused(Ruling { option_id: reject, reason: self.busy(&owner) }),
                None => Grant::Unchanged,
            },
        }
    }

    /// 이 Session이 쥔 쓰기 자리를 놓는다 — 쥐지 않았으면 아무 일도 하지 않는다. 물은 요청도 잊는다(그 턴의 요청은 거둬졌다).
    pub(super) fn release(&self) {
        self.seats.release(&self.key);
        self.lock_asked().clear();
    }

    /// 턴이 끝나면 쓰기 자리를 놓는 sink — 받은 것을 `sink`에 넘기기 **전에** 놓는다. 그래서 턴 끝 줄이 기록에 설 때는 이미 놓였다.
    /// 편집 도구의 갱신은 「문서 쓰는 중」으로 적고, 턴이 끝나면 그 Session의 것을 걷는다(v1 티켓 34).
    pub(super) fn watching(self: &Arc<Self>, sink: Sink) -> Sink {
        let writer = Arc::clone(self);
        Arc::new(move |event| {
            if ends_turn(&event) {
                writer.release();
                writer.put_pens_down();
            } else if let RuntimeEvent::Update(raw) = &event {
                writer.see_tool(raw);
            }
            sink(event);
        })
    }

    /// 편집 도구의 갱신 하나 — 이은 Work의 spec 폴더 안 문서를 쓰기 시작했으면 적고, 그 도구가 끝났으면 걷는다. 바뀐 Work의 목록을
    /// 낸다(`work:writing`).
    fn see_tool(&self, raw: &Value) {
        match ToolStep::of(raw) {
            ToolStep::Began { tool, paths } => {
                let Some(work) = self.work() else { return };
                let Some(path) = self.spec_doc(&work, &paths) else { return };
                if let Some(writing) = self.docs.desk.began(&work, &self.key, &self.docs.name, &tool, &path) {
                    (self.docs.emit)(HostEvent::WorkWriting { work, writing });
                }
            }
            ToolStep::Ended { tool } => self.announce(self.docs.desk.ended(&self.key, &tool)),
            ToolStep::Other => {}
        }
    }

    /// 이 Session이 쓰던 문서를 모두 걷는다 — 턴이 끝났거나 Session이 표에서 꺼졌다.
    pub(super) fn put_pens_down(&self) {
        self.announce(self.docs.desk.cleared(&self.key));
    }

    fn announce(&self, changed: Changed) {
        for (work, writing) in changed {
            (self.docs.emit)(HostEvent::WorkWriting { work, writing });
        }
    }

    /// 고칠 경로들 가운데 그 Work의 spec 폴더 안 첫 파일 — spec 기준 경로(`/`로 잇는다). 경로는 판정과 같은 꼴로 풀어 견준다
    /// (상대 경로는 이 Session의 작업 폴더에서, 링크는 푼다). Work를 읽지 못하면 없다.
    fn spec_doc(&self, work: &str, paths: &[PathBuf]) -> Option<String> {
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).ok()?;
        let spec = resolve(&atelier_core::work_places(&works, &meta).spec, &self.docs.cwd);
        paths.iter().find_map(|path| {
            let inside = resolve(path, &self.docs.cwd).strip_prefix(&spec).ok()?.to_path_buf();
            let parts: Vec<String> = inside.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
            (!parts.is_empty()).then(|| parts.join("/"))
        })
    }

    /// 지금 턴의 호출 고리 — 맡은 일을 받은 턴이면 그 고리, 아니면 이 Agent 하나다(v1 티켓 16).
    fn chain(&self) -> Vec<String> {
        self.conv
            .upgrade()
            .and_then(|conv| conv.lock_state().order.serving().map(|call| call.chain().to_vec()))
            .unwrap_or_else(|| vec![self.key.handle.clone()])
    }

    /// 거절의 글(§10) — 같은 Thread의 주인이면 handle만, 다른 Thread면 그 Thread의 이름을 앞에 단다.
    fn busy(&self, owner: &SessionKey) -> String {
        let who = subject(&owner.handle);
        if owner.thread == self.key.thread {
            return format!("{who} 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요");
        }
        let title = atelier_core::read_thread(&self.data_root, &owner.thread)
            .map(|file| file.title)
            .ok()
            .filter(|title| !title.is_empty())
            .unwrap_or_else(|| owner.thread.clone());
        format!("「{title}」 Thread의 {who} 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요")
    }
}

/// 권한 요청의 선택지들 — (`optionId`, `kind`).
pub(super) fn options_of(request: &Value) -> Vec<(String, String)> {
    request["options"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|option| Some((option["optionId"].as_str()?.to_owned(), option["kind"].as_str()?.to_owned())))
        .collect()
}

/// 거부하는 선택지 — 이번만 거부를 먼저 고른다. 선택지는 `kind`로 고른다(`optionId`는 Runtime마다 다르다).
pub(super) fn rejecting(options: &[(String, String)]) -> Option<String> {
    of_kind(options, "reject_once").or_else(|| of_kind(options, "reject_always"))
}

/// 허락하는 선택지 — 이번만 허락을 먼저 고른다. 판정이 묻지 않고 허용할 때 고른다 — 「이 대화에서 허락」은 Runtime이 그 허락을
/// 기억해 다음 요청이 판정에 오지 않게 하므로 고르지 않는다(없을 때만 고른다).
pub(super) fn allowing(options: &[(String, String)]) -> Option<String> {
    of_kind(options, "allow_once").or_else(|| of_kind(options, "allow_always"))
}

fn of_kind(options: &[(String, String)], wanted: &str) -> Option<String> {
    options.iter().find(|(_, kind)| kind == wanted).map(|(id, _)| id.clone())
}

/// 그 Session의 턴이 끝났나 — 우리 턴의 끝 · 스스로 이어 간 턴의 끝 · 죽음.
fn ends_turn(event: &RuntimeEvent) -> bool {
    match event {
        RuntimeEvent::TurnEnd(_) | RuntimeEvent::Died(_) => true,
        RuntimeEvent::Update(raw) => matches!(OutOfTurn::of(raw), Some(OutOfTurn::Ended(_))),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(thread: &str, handle: &str) -> SessionKey {
        SessionKey::new(thread, handle)
    }

    fn chain(handles: &[&str]) -> Vec<String> {
        handles.iter().map(|handle| (*handle).to_owned()).collect()
    }

    #[test]
    fn 쓰기_자리는_work마다_하나이고_주인과_같은_thread의_고리_안만_이어_쓰며_주인이_놓으면_빈다() {
        let seats = WriteSeats::default();
        let host = key("a", "host");
        assert_eq!(seats.take("cart", &host, &chain(&["host"])), Ok(true), "빈 자리는 쥔다");
        assert_eq!(seats.take("cart", &host, &chain(&["host"])), Ok(false), "주인은 그대로 쓴다");
        assert_eq!(seats.take("billing", &key("b", "tester"), &chain(&["tester"])), Ok(true), "Work마다 따로다");

        let reviewer = key("a", "reviewer");
        assert_eq!(seats.owner_against("cart", &reviewer, &chain(&["host", "reviewer"])), None, "고리 안에서는 이어 쓴다");
        assert_eq!(seats.take("cart", &reviewer, &chain(&["host", "reviewer"])), Ok(false), "주인은 바뀌지 않는다");
        seats.release(&reviewer);
        assert_eq!(seats.owner_against("cart", &key("b", "tester"), &chain(&["tester"])), Some(host.clone()), "불린 쪽이 놓아도 그대로다");
        assert_eq!(seats.owner_against("cart", &reviewer, &chain(&["reviewer"])), Some(host.clone()), "고리 밖이면 같은 Thread여도 막힌다");
        assert_eq!(
            seats.owner_against("cart", &key("b", "reviewer"), &chain(&["host", "reviewer"])),
            Some(host.clone()),
            "다른 Thread의 같은 handle은 고리가 아니다"
        );

        seats.release(&host);
        assert_eq!(seats.take("cart", &key("b", "tester"), &chain(&["tester"])), Ok(true), "주인이 놓으면 빈다");
    }

    #[test]
    fn 선택지는_kind로_고르고_거부도_허락도_이번만을_먼저_고른다() {
        let options = vec![
            ("always".to_owned(), "reject_always".to_owned()),
            ("once".to_owned(), "reject_once".to_owned()),
            ("session".to_owned(), "allow_always".to_owned()),
            ("yes".to_owned(), "allow_once".to_owned()),
        ];
        assert_eq!(rejecting(&options).as_deref(), Some("once"));
        assert_eq!(rejecting(&options[2..]), None);
        assert_eq!(allowing(&options).as_deref(), Some("yes"));
        assert_eq!(allowing(&options[..3]).as_deref(), Some("session"), "이번만이 없을 때만 「이 대화에서」를 고른다");
        assert_eq!(allowing(&options[..2]), None);
    }
}
