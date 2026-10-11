//! 대화 호스트 — 대화창의 몸통. 앱은 이것 하나를 managed state로 쥐고 명령을 위임한다.
//!
//! 엔진 확인(three-axes 티켓 02) 위에 대화 목록 · 새 대화 · 대화 닫기 · 호스트 끄기(03), 보내기 · 기록 읽기(04),
//! 턴 앞뒤의 spec 비교(06), 멈추기 · 대기 줄 · 지금 보내기(07), 사라진 work의 대화 끄기(11), 로그인 확인 · 로그인
//! 명령 · 로그인 필요 대화의 다시 띄우기(12)가 선다. 앱 잇기(05)가 이 위에 선다.
//!
//! 대화 하나 = 에이전트 프로세스 하나 · 에이전트 쪽 세션 하나 · 기록 파일 하나다. 동시 개수 상한은 없다
//! (three-axes 결정 19).

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::discovery::{self, Agent, EngineCheck, MissingProgram};
use crate::login::{self, EngineState, LoginDesk, LoginProgress, Waiting};
use crate::login_env::{self, AgentEnv, LoginShellError, ShellSource};
use crate::quote::{Attached, Quote};
use crate::records::{self, CloseCause, ConversationRow, RecordLine, Recorder, SessionState, TurnEndLine};
use crate::runtime::{self, AgentProcess, Launch, OpenError, RuntimeEvent, SessionPlace, Sink, Turns};
use crate::spec_changes::{Snapshot, SpecPlace};

/// 판 02가 잰 codex-acp의 메이저 판(S6). 다르면 판 경고 줄을 남기고 계속한다.
const CODEX_ACP_MAJOR: u64 = 2;

/// 세션 열기(띄우기 → initialize → `session/new`)의 기본 한도. ACP가 아닌 명령이 말없이 살아 있어도 새 대화가
/// 끝없이 막히지 않게 한다. 진짜 codex-acp는 1초 안팎에 연다(실측 A1).
const DEFAULT_OPEN_LIMIT: Duration = Duration::from_secs(30);

/// 호스트가 내보내는 것 — 기록 줄 · 대기 줄 바뀜(07) · 엔진 상태(12).
#[derive(Debug, Clone, PartialEq)]
pub enum HostEvent {
    /// 기록 줄 — 기록 파일에 적은 것과 같은 줄이다. 화면은 대화를 이것 하나로 그린다.
    Record { work: String, conversation: String, line: RecordLine },
    /// 대기 줄 바뀜 — 그 대화의 대기 줄 전체. 대기 줄은 기록에 없으므로(S13) 화면은 이것과 대화 목록으로 그린다.
    Queue { work: String, conversation: String, queue: Vec<QueuedMessage> },
    /// 엔진 상태 — 찾음 여부 · 로그인 여부 · 로그인 진행(링크 · 끝남). 엔진을 확인할 때, 에이전트가 로그인을 요구할 때,
    /// 로그인 명령이 돌고 끝날 때 나간다(three-axes 티켓 12).
    Engine(EngineState),
}

/// 대기 줄의 말 하나(S13) — 턴이 도는 동안 받은 말이다. 화면이 입력창 위 「대기 중」에 그린다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessage {
    /// 대기 id — 고치기 · 지우기 · 지금 보내기가 이것으로 고른다.
    pub id: String,
    /// 화면에 보일 글 — 보내면 `sent` 줄의 글이 된다.
    pub text: String,
    /// 「지금 보내기」를 눌러 도는 턴의 멈춤(`cancelled`)을 기다리는 말인가. 그런 말은 늘 맨 앞에 하나뿐이다.
    pub send_now: bool,
}

/// 대기 줄에 든 말과, 보낼 때 그것이 에이전트 쪽 세션의 첫 말이면 앞에 붙일 머리말(S11), 그리고 붙었으면 인용과 그 인용
/// 블록(three-axes 티켓 27). 머리말과 인용 블록은 넣을 때 work를 읽어 지어 둔다 — 턴 끝(수신 루프 안)에서는 work를 읽지 않는다.
struct Queued {
    message: QueuedMessage,
    preamble: Value,
    quote: Option<Attached>,
}

/// 변환기 명령 — Claude 대화가 띄우는 ACP 에이전트. 앱에서는 `current_exe` + `acp-claude`, 검사에서는
/// 변환기 시험 bin이다. `current_exe`는 진입점에서만 읽어 넘긴다(워크플로 §1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslatorCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
}

impl TranslatorCommand {
    pub fn new(program: impl Into<PathBuf>, args: impl IntoIterator<Item = impl Into<OsString>>) -> Self {
        Self { program: program.into(), args: args.into_iter().map(Into::into).collect() }
    }
}

/// 이벤트를 내보내는 closure. 기록 줄은 기록의 잠금을 쥔 채 내보내므로 **이 안에서 호스트를 다시 부르지
/// 않는다** — 받은 값을 밖으로 넘기는 것까지가 이 자리의 일이다(앱에서는 화면으로 emit한다).
pub(crate) type Emit = dyn Fn(HostEvent) + Send + Sync;

/// 대화 호스트를 짓는다. 넷은 꼭 받고(데이터 루트 · 변환기 명령 · 셸 경로의 원천 · 이벤트를 내보내는
/// closure), 시간 한도는 검사가 줄일 수 있다.
pub struct HostBuilder {
    data_root: PathBuf,
    translator: TranslatorCommand,
    shell: ShellSource,
    emit: Arc<Emit>,
    login_shell_limit: Duration,
    open_limit: Duration,
}

impl HostBuilder {
    /// 로그인 셸 읽기의 한도. 기본은 10초다(워크플로 §10) — 검사에서는 줄여도 된다.
    pub fn login_shell_limit(mut self, limit: Duration) -> Self {
        self.login_shell_limit = limit;
        self
    }

    /// 세션 열기의 한도. 기본은 30초다 — 검사에서는 줄여도 된다.
    pub fn open_limit(mut self, limit: Duration) -> Self {
        self.open_limit = limit;
        self
    }

    pub fn build(self) -> ConversationHost {
        ConversationHost {
            logins: LoginDesk::new(Arc::clone(&self.emit)),
            data_root: self.data_root,
            translator: self.translator,
            shell: self.shell,
            emit: self.emit,
            login_shell_limit: self.login_shell_limit,
            open_limit: self.open_limit,
            login_env: Mutex::new(None),
            live: Arc::new(Mutex::new(HashMap::new())),
            agents_file: Mutex::new(()),
        }
    }
}

pub struct ConversationHost {
    data_root: PathBuf,
    #[expect(dead_code, reason = "Claude 대화를 13이 이것으로 띄운다")]
    translator: TranslatorCommand,
    shell: ShellSource,
    emit: Arc<Emit>,
    login_shell_limit: Duration,
    open_limit: Duration,
    /// S7 — 로그인 env는 호스트가 도는 동안 한 번 읽어 메모리에 쥔다. 「다시 확인」만 다시 읽는다.
    /// 기록하지 않는다 — 비밀이 `agents/`에 남지 않게(워크플로 S37).
    ///
    /// 읽는 동안 잠금을 쥔다. 두 엔진 확인이 함께 와도 셸은 한 번만 뜨고, 뒤의 것이 앞의 결과를 쓴다.
    login_env: Mutex<Option<AgentEnv>>,
    /// 에이전트가 떠 있는 대화들 — 대화 id로 찾는다. 대화마다 이 표를 약하게 쥔다 — 사라진 work의 대화가 턴
    /// 끝에 스스로 표에서 빠져 꺼진다(S10).
    live: Arc<LiveTable>,
    /// `agents.json`을 읽고 고쳐 쓰는 사이를 잠근다 — 함께 연 두 대화가 서로의 줄을 지우지 않게.
    agents_file: Mutex<()>,
    /// 로그인 창구 — 엔진 상태를 알리고, 로그인을 기다리는 대화와 도는 로그인 명령을 쥔다(three-axes 티켓 12).
    logins: Arc<LoginDesk>,
}

/// 에이전트가 떠 있는 대화들의 표.
type LiveTable = Mutex<HashMap<String, Live>>;

/// 에이전트가 떠 있는 대화 하나.
struct Live {
    work: String,
    agent: AgentProcess,
    conv: Arc<Conv>,
}

/// 대화 하나의 기록과 턴의 상태. 런타임의 sink가 함께 쥔다 — 받은 것은 sink가 곧바로 적는다.
///
/// 잠금 순서는 늘 `state` → 기록이다. 턴 끝 줄은 `state`를 쥔 채 적고 나서 턴을 비운다 — 그래야 다음 말의
/// `sent` 줄이 턴 끝 줄보다 앞에 서지 않는다.
struct Conv {
    recorder: Recorder,
    /// 턴 앞뒤로 찍는 spec 폴더(three-axes 결정 22).
    spec: SpecPlace,
    state: Mutex<ConvState>,
    /// 턴 끝에 work가 사라졌는지 본다(S10). 떠 있지 않은 대화(닫힘 줄만 적으려고 연 기록)에는 없다.
    vanish: Option<VanishWatch>,
    /// 턴 도중에 에이전트가 로그인을 요구하면 그 대화를 로그인 창구에 쥐게 한다(three-axes 티켓 12). 떠 있지 않은 대화에는
    /// 없다.
    login: Option<LoginWatch>,
}

struct ConvState {
    /// 에이전트가 살아 있나. 죽으면 다시 띄우기(티켓 10) 전까지 말을 받지 않는다.
    alive: bool,
    /// 도는 턴이 시작한 때. 쉬면 `None`이다.
    turn: Option<Instant>,
    /// 다음 말에 머리말을 붙이나 — 에이전트 쪽 세션의 첫 말이다(S11).
    needs_preamble: bool,
    /// 에이전트에 턴을 열고 멈추는 손잡이. 세션이 열린 뒤에 선다.
    turns: Option<Turns>,
    /// 대기 줄(S13) — 턴이 도는 동안 받은 말. 메모리에만 둔다: 앱을 다시 켜면 비어 있다(재시작 뒤 저절로 보내는
    /// 놀람을 피한다). 에이전트가 죽어도 그대로 둔다.
    queue: VecDeque<Queued>,
    /// 도는 턴 앞(보내기 직전)에 찍은 spec 폴더. 턴 끝에 지금과 견준다.
    before: Option<Snapshot>,
}

impl Conv {
    fn new(recorder: Recorder, spec: SpecPlace, vanish: Option<VanishWatch>, login: Option<LoginWatch>) -> Arc<Self> {
        Arc::new(Self {
            recorder,
            spec,
            state: Mutex::new(ConvState {
                alive: true,
                turn: None,
                needs_preamble: true,
                turns: None,
                queue: VecDeque::new(),
                before: None,
            }),
            vanish,
            login,
        })
    }

    fn lock_state(&self) -> MutexGuard<'_, ConvState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 런타임이 넘긴 것을 기록에 적는 sink.
    fn sink(self: &Arc<Self>) -> Sink {
        let conv = Arc::clone(self);
        Arc::new(move |event| conv.receive(event))
    }

    fn receive(&self, event: RuntimeEvent) {
        let written = match event {
            RuntimeEvent::Update(raw) => self.recorder.update(raw),
            RuntimeEvent::Stderr(line) => self.recorder.stderr(line),
            RuntimeEvent::AuthStatus(params) => self.recorder.session(SessionState::AuthStatus { params }),
            RuntimeEvent::Died(death) => {
                // 답 없이 사라진 턴에는 턴 끝이 없다 — 죽음 줄이 그 자리를 맡고, 턴은 쉬는 것으로 돌린다.
                let mut state = self.lock_state();
                state.alive = false;
                state.turn = None;
                state.before = None;
                self.recorder.session(SessionState::Died { reason: death.reason, stderr_tail: death.stderr_tail })
            }
            RuntimeEvent::TurnEnd(end) => {
                let lost_login = matches!(&end.result, Err(error) if login::auth_required(error));
                let mut state = self.lock_state();
                let started = state.turn.take();
                let (response, error) = match end.result {
                    Ok(response) => (Some(response), None),
                    Err(error) => (None, Some(error)),
                };
                let ended = self
                    .end_turn(
                        &mut state,
                        TurnEndLine {
                            stop_reason: response.as_ref().and_then(|r| r["stopReason"].as_str()).map(str::to_owned),
                            duration_ms: elapsed_ms(started),
                            cancelled_by_us: end.cancelled_by_us,
                            out_of_turn: false,
                            response,
                            error,
                        },
                    )
                    .and_then(|now| {
                        // 엔진을 가리지 않는다 — 턴 도중의 `-32000`(풀린 Codex 로그인, Claude는 S3)도 `session/new`의 것과
                        // 같은 로그인 필요 줄이다(three-axes 티켓 12). 대화의 잠금을 쥔 채 적고 쥐어 둔다 — 그 사이에
                        // 보내기가 끼지 않고, 아래의 대기 줄도 로그인을 기다린다.
                        if lost_login {
                            self.recorder.session(SessionState::LoginRequired)?;
                            if let Some(watch) = &self.login {
                                watch.required();
                            }
                        }
                        Ok(now)
                    });
                let (written, now) = match ended {
                    Ok(now) => (Ok(()), now),
                    Err(error) => (Err(error), None),
                };
                // S10 — 아카이브를 시킨 에이전트가 바로 이 턴 안에 있을 수 있다(MCP `atelier_archive_work`를 부른
                // 그 턴). 그래서 턴 도중에는 끄지 않고, 턴 끝 줄을 적은 뒤에 work가 남아 있는지 본다. 꺼질 대화의
                // 대기 줄은 보내지 않는다.
                let retiring = self.vanish.as_ref().is_some_and(VanishWatch::retire_if_vanished);
                if !retiring {
                    // S13 — 턴이 끝났으니 대기 줄의 맨 앞을 보낸다. 턴 끝 줄과 같은 잠금 안이라, 그 사이에 온 보내기가
                    // 대기 줄을 앞지르지 못한다. 멈춰서 끝난 턴(`cancelled`)도 같다 — 지금 보내기가 이것을 쓴다.
                    // 방금 견준 「지금」이 그 말의 턴 앞이다.
                    self.send_queued(&mut state, now);
                }
                written
            }
        };
        if let Err(error) = written {
            // 기록이 막혀도 대화는 이어 간다 — sink는 오류를 돌려줄 곳이 없다.
            eprintln!("{error}");
        }
    }

    /// 턴 끝 — 턴 앞에 찍은 spec 폴더를 지금과 견주어 바뀐 것이 있으면 `changes` 줄을 적고, 이어 턴 끝 줄을 적는다
    /// (three-axes 결정 22). 그래서 화면이 턴 끝 줄을 받을 때 그 턴의 고친 곳은 이미 와 있다. `state`를 쥔 채 부른다.
    ///
    /// - 바뀐 것이 없으면 `changes` 줄이 없다 — 화면의 알약이 0개로 서지 않는다.
    /// - work 폴더가 그 사이 사라졌으면(아카이브 · 삭제) 견주지 않는다. 옛 자리에는 아무것도 없어 모든 파일이
    ///   「지움」으로 적히기 때문이다. 그 대화는 턴 끝 줄 뒤에 꺼진다(S10).
    ///
    /// 견준 「지금」을 돌려준다 — 대기 줄의 다음 말이 곧바로 가면 그 턴의 앞이 된다(폴더를 두 번 걷지 않는다).
    fn end_turn(&self, state: &mut ConvState, end: TurnEndLine) -> Result<Option<Snapshot>, records::RecordError> {
        let mut now = None;
        if let Some(before) = state.before.take() {
            if !work_vanished(&self.spec.works_root, &self.spec.work) {
                let taken = Snapshot::take(&self.spec);
                let files = before.compare(&taken);
                if !files.is_empty() {
                    self.recorder.changes(&files)?;
                }
                now = Some(taken);
            }
        }
        self.recorder.turn_end(end)?;
        Ok(now)
    }

    /// 지금 말을 보낼 수 있나 — 에이전트가 살아 있고 턴이 쉬고, 로그인을 기다리지 않는다(티켓 12 — 턴 도중에 로그인이
    /// 풀렸다). 걸린 권한(08) · 스스로 이어 간 턴(16)이 이 자리에 조건을 더한다 — 그동안 받은 말은 대기 줄에서 기다린다.
    fn can_send(&self, state: &ConvState) -> bool {
        state.alive
            && state.turn.is_none()
            && state.turns.is_some()
            && !self.login.as_ref().is_some_and(LoginWatch::waiting)
    }

    /// 턴을 연다 — `sent`를 먼저 적고(보낸 뒤에 적으면 첫 update가 그보다 앞에 설 수 있다), 턴을 열고, 에이전트에
    /// 보낸다. 에이전트 쪽 세션의 첫 말이면 머리말을 앞에 붙이고(S11), 인용이 붙은 말이면 사람의 글 바로 앞에 인용
    /// 블록을 둔다(S12). `state`를 쥔 채 부른다.
    ///
    /// `before`는 턴 앞에 찍은 spec 폴더다 — 턴이 끝나면 지금과 견주어 고친 곳을 적는다(three-axes 결정 22).
    ///
    /// 보내지 못하면 턴을 연 채로 두지 않는다 — 화면이 「일하는 중」에 갇히지 않게 턴 끝 줄(오류)까지 적는다. 그 끝은
    /// 대기 줄을 보내지 않는다: 연결이 끊긴 것이라 다음 말도 가지 못한다.
    fn begin_turn(
        &self,
        state: &mut ConvState,
        text: &str,
        quote: Option<&Attached>,
        preamble: Value,
        send_now: bool,
        before: Snapshot,
    ) -> Result<(), HostError> {
        let Some(turns) = state.turns.clone() else {
            return Err(HostError::NotRunning(self.recorder.conversation().to_owned()));
        };
        let mut prompt = Vec::new();
        if state.needs_preamble {
            prompt.push(preamble);
        }
        if let Some(attached) = quote {
            prompt.push(attached.block.clone());
        }
        prompt.push(json!({"type": "text", "text": text}));
        let quoted = quote.map(|attached| &attached.quote);
        self.recorder.sent(text, quoted, &prompt, send_now).map_err(HostError::Record)?;
        state.turn = Some(Instant::now());
        state.before = Some(before);
        state.needs_preamble = false;
        if let Err(reason) = turns.prompt(prompt) {
            let started = state.turn.take();
            self.end_turn(
                state,
                TurnEndLine {
                    stop_reason: None,
                    duration_ms: elapsed_ms(started),
                    cancelled_by_us: false,
                    out_of_turn: false,
                    response: None,
                    error: Some(json!({"message": reason})),
                },
            )
            .map_err(HostError::Record)?;
            return Err(HostError::Send(reason));
        }
        Ok(())
    }

    /// 대기 줄의 맨 앞을 보낸다(S13) — 보낼 수 있을 때만. 턴 끝(수신 루프 안)이 부른다. 보낸 뒤 대기 줄 바뀜을 낸다.
    /// `before`는 이미 찍어 둔 spec 폴더다(턴 끝에 견준 「지금」) — 없으면 여기서 찍는다.
    fn send_queued(&self, state: &mut ConvState, before: Option<Snapshot>) {
        if !self.can_send(state) {
            return;
        }
        let Some(queued) = state.queue.pop_front() else { return };
        let before = before.unwrap_or_else(|| Snapshot::take(&self.spec));
        let Queued { message, preamble, quote } = queued;
        let sent = self.begin_turn(state, &message.text, quote.as_ref(), preamble, message.send_now, before);
        self.announce_queue(state);
        if let Err(error) = sent {
            // 턴 끝 줄(오류)이 기록에 섰다. 돌려줄 곳이 없다.
            eprintln!("{error}");
        }
    }

    /// 대기 줄 바뀜을 낸다 — 바뀔 때마다 대기 줄 전체를 싣는다. `state`를 쥔 채 부른다: 알리는 차례가 바뀐 차례다.
    fn announce_queue(&self, state: &ConvState) {
        self.recorder.announce(HostEvent::Queue {
            work: self.recorder.work().to_owned(),
            conversation: self.recorder.conversation().to_owned(),
            queue: queue_of(state),
        });
    }
}

/// 화면에 보일 대기 줄.
fn queue_of(state: &ConvState) -> Vec<QueuedMessage> {
    state.queue.iter().map(|queued| queued.message.clone()).collect()
}

/// 턴 끝에 그 대화의 work가 사라졌는지 보는 것(S10). 턴 끝은 런타임의 sink 안이라 호스트를 부를 수 없으므로, 떠
/// 있는 대화의 표를 약하게 쥐고 끄기는 따로 띄운 스레드가 한다.
struct VanishWatch {
    works: PathBuf,
    work: String,
    conversation: String,
    live: Weak<LiveTable>,
}

impl VanishWatch {
    /// work가 사라졌으면 그 대화를 끄러 보내고 true를 돌려준다.
    fn retire_if_vanished(&self) -> bool {
        if !work_vanished(&self.works, &self.work) {
            return false;
        }
        let live = self.live.clone();
        let conversation = self.conversation.clone();
        // 이 자리에서 끄지 않는다 — 끄기는 연결을 놓고 1초를 기다리는데, 이 자리가 바로 그 연결의 수신 루프다.
        std::thread::spawn(move || {
            if let Some(live) = live.upgrade() {
                retire_vanished(&live, |id, _| id == conversation);
            }
        });
        true
    }
}

/// 턴 도중에 에이전트가 로그인을 요구하면 그 대화를 로그인 창구에 쥐게 하는 것(three-axes 티켓 12). 턴 끝은 런타임의
/// sink 안이라 호스트를 부를 수 없으므로 창구를 함께 쥔다 — 창구는 대화의 잠금을 쥔 채 불러도 된다.
struct LoginWatch {
    agent: Agent,
    work: String,
    conversation: String,
    desk: Arc<LoginDesk>,
}

impl LoginWatch {
    fn required(&self) {
        self.desk.login_required(self.agent, &self.work, &self.conversation);
    }

    /// 그 대화가 로그인을 기다리나 — 그동안은 대기 줄이 가지 않는다(S13의 걸림).
    fn waiting(&self) -> bool {
        self.desk.waiting_for(&self.conversation).is_some()
    }
}

/// work가 사라졌나 — `work.json`이 없다(아카이브 · 삭제). 깨진 `work.json`은 사라진 것이 아니다 — 사람이 손보는
/// 중일 수 있는데, 그때 대화를 끄면 하던 일을 잃는다.
fn work_vanished(works: &Path, work: &str) -> bool {
    matches!(atelier_core::read_work(works, work), Err(atelier_core::Error::WorkNotFound(_)))
}

/// 사라진 work의 대화들을 끈다(S10) — 떠 있는 표에서 `pick`이 고른 것을 꺼내 남김없이 끄고(stdin 닫기 → 1초 →
/// 그룹째 SIGKILL), 기록에 닫힘 줄을 적는다.
///
/// - 열어 둔 기록 파일은 work 폴더의 rename을 따라가므로, 닫힘 줄도 work와 함께 아카이브로 간다.
/// - `agents.json`은 쓰지 않는다 — 옛 자리에 쓰면 `work.json` 없는 유령 work 폴더가 선다. 그래서 닫은 때도 적지
///   않는다(대화를 닫은 것은 사람이 아니다).
/// - 고른 것이 표에 없으면 아무 일도 하지 않는다 — 턴 끝과 감시 소식이 같은 대화를 함께 골랐으면 먼저 꺼낸 쪽이 끈다.
fn retire_vanished(live: &LiveTable, pick: impl Fn(&str, &Live) -> bool) {
    let mut retiring: Vec<Live> = {
        let mut table = live.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let ids: Vec<String> =
            table.iter().filter(|(id, conversation)| pick(id, conversation)).map(|(id, _)| id.clone()).collect();
        ids.iter().filter_map(|id| table.remove(id)).collect()
    };
    shut_down_together(&mut retiring);
    for conversation in &retiring {
        let closed = SessionState::Closed { cause: Some(CloseCause::WorkVanished) };
        if let Err(error) = conversation.conv.recorder.session(closed) {
            eprintln!("{error}");
        }
    }
}

/// 대화 여럿의 프로세스 그룹을 끈다 — 모두의 stdin을 **한꺼번에** 닫고 1초를 **한 번만** 기다린 뒤 그룹들을
/// SIGKILL한다. 대화마다 1초씩 줄을 세우면 N초가 된다.
fn shut_down_together(live: &mut [Live]) {
    let deadline = Instant::now() + runtime::SHUTDOWN_GRACE;
    for conversation in live.iter_mut() {
        conversation.agent.begin_shutdown();
    }
    for conversation in live.iter_mut() {
        conversation.agent.finish_shutdown(deadline);
        // 끈 대화는 연결을 쥐지 않는다 — 대화가 든 턴 손잡이의 복제도 놓는다.
        conversation.conv.lock_state().turns = None;
    }
}

fn elapsed_ms(started: Option<Instant>) -> u64 {
    started.map_or(0, |at| u64::try_from(at.elapsed().as_millis()).unwrap_or(u64::MAX))
}

/// 대화 목록의 한 줄 — 화면이 대화 탭을 짓는 것.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub agent: Agent,
    pub name: String,
    pub model: Option<String>,
    pub mode: Option<String>,
    pub plan: Option<bool>,
    /// 기록에 마지막으로 적힌 줄의 seq. 화면은 이 다음부터 기록 줄 이벤트로 잇는다.
    pub last_seq: u64,
    /// 대기 줄(S13) — 메모리에만 있으므로 앱을 다시 켠 뒤와 에이전트가 떠 있지 않은 대화에서는 비어 있다.
    pub queue: Vec<QueuedMessage>,
}

/// 호스트 명령이 실패한 까닭 — 화면에 그대로 보일 글이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostError {
    /// `work.json`이 있는 work 폴더가 없다.
    WorkNotFound(String),
    LoginShell(LoginShellError),
    /// 에이전트를 띄우는 데 드는 실행 파일을 로그인 셸의 PATH에서 찾지 못했다.
    EngineMissing { agent: Agent, missing: Vec<MissingProgram> },
    /// 이 판에서 아직 열 수 없는 에이전트(Claude — 변환기가 서면 연다).
    AgentNotReady(Agent),
    /// 대화는 섰지만 에이전트가 세션을 열지 못했다. 까닭은 그 대화의 기록에도 `session` 죽음 줄로 남는다.
    Open { conversation: String, reason: String },
    ConversationNotFound(String),
    /// 에이전트가 떠 있지 않은 대화 — 다시 켠 뒤이거나 에이전트가 죽었다. 다시 띄우기는 티켓 10이다.
    NotRunning(String),
    /// 그 대화의 대기 줄에 그 대기 id의 말이 없다 — 이미 갔거나 지웠다. 대기 줄은 메모리에만 있어 다시 켠 뒤에는 늘
    /// 비어 있다.
    QueuedNotFound(String),
    /// 로그인을 기다리는 대화 — 에이전트가 `-32000`으로 답했다. 로그인이 「됨」으로 바뀌면 호스트가 다시 띄운다
    /// (three-axes 티켓 12).
    LoginRequired { agent: Agent, conversation: String },
    /// 에이전트에 말을 보내지 못했다(연결이 끊겼다).
    Send(String),
    /// 보낸 말의 인용이 올바르지 않다 — spec 폴더 밖을 가리키거나 줄 범위가 뒤집혔거나 글이 비었다(three-axes 티켓 27).
    BadQuote(String),
    /// `agents/`를 읽거나 쓰지 못했다.
    Record(String),
    /// 로그인 명령을 띄우지 못했다.
    Login(String),
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HostError::WorkNotFound(work) => write!(f, "work를 찾을 수 없습니다: {work}"),
            HostError::LoginShell(error) => write!(f, "{error}"),
            HostError::EngineMissing { agent, missing } => {
                let names: Vec<&str> = missing.iter().map(|program| program.name).collect();
                write!(f, "{}를 띄우는 데 드는 것을 찾지 못했습니다: {}", agent.display_name(), names.join(", "))
            }
            HostError::AgentNotReady(agent) => write!(f, "{} 대화는 아직 열 수 없습니다", agent.display_name()),
            HostError::Open { reason, .. } => write!(f, "{reason}"),
            HostError::ConversationNotFound(conversation) => write!(f, "대화를 찾을 수 없습니다: {conversation}"),
            HostError::NotRunning(conversation) => write!(f, "에이전트가 떠 있지 않은 대화입니다: {conversation}"),
            HostError::QueuedNotFound(_) => write!(f, "대기 중인 말을 찾을 수 없습니다. 이미 보냈거나 지운 말입니다"),
            HostError::LoginRequired { agent, .. } => {
                write!(f, "{} 로그인이 필요합니다. 로그인한 뒤에 보내세요", agent.display_name())
            }
            HostError::Send(reason) => write!(f, "{reason}"),
            HostError::BadQuote(reason) => write!(f, "{reason}"),
            HostError::Record(reason) => write!(f, "{reason}"),
            HostError::Login(reason) => write!(f, "{reason}"),
        }
    }
}

impl std::error::Error for HostError {}

impl From<LoginShellError> for HostError {
    fn from(error: LoginShellError) -> Self {
        HostError::LoginShell(error)
    }
}

impl ConversationHost {
    pub fn builder(
        data_root: PathBuf,
        translator: TranslatorCommand,
        shell: ShellSource,
        emit: impl Fn(HostEvent) + Send + Sync + 'static,
    ) -> HostBuilder {
        HostBuilder {
            data_root,
            translator,
            shell,
            emit: Arc::new(emit),
            login_shell_limit: login_env::DEFAULT_LIMIT,
            open_limit: DEFAULT_OPEN_LIMIT,
        }
    }

    /// 엔진 확인 — 그 에이전트를 띄우는 데 드는 실행 파일을 로그인 셸의 PATH에서 찾고, 찾았으면 로그인돼 있는지
    /// 엔진에게 묻는다(three-axes 티켓 12). `reread`는 안내 카드의 「다시 확인」이다. 설치한 뒤 앱을 다시 켜지 않고 이어
    /// 가도록 로그인 env를 새로 읽는다.
    ///
    /// - 답은 엔진 상태 이벤트로도 나간다 — 같은 엔진의 다른 대화 · 카드도 따라 바뀐다.
    /// - 로그인돼 있으면 그 엔진의 로그인을 기다리던 대화를 다시 띄운다 — 터미널에서 로그인하고 「다시 확인」을 누른 때다.
    ///
    /// 막히는 호출이다 — 로그인 env를 아직 쥐지 않았으면 셸을 띄워 기다리고(한도 10초), 로그인을 묻는다(한도 10초).
    pub fn check_engine(&self, agent: Agent, reread: bool) -> Result<EngineCheck, LoginShellError> {
        let env = self.login_env(reread)?;
        let check = self.engine_check(agent, &env);
        self.logins.announce_check(agent, &check);
        if matches!(check, EngineCheck::Found { logged_in: true, .. }) {
            self.relaunch_waiting(agent);
        }
        Ok(check)
    }

    /// 로그인 시작 — 그 엔진의 로그인 명령(`claude auth login` · `codex login`)을 TTY 없이 새 세션에 띄운다(three-axes
    /// 결정 30). 명령이 브라우저를 스스로 연다. 기다리지 않는다 — 진행은 엔진 상태 이벤트로 온다:
    ///
    /// 1. 도는 중(링크 없음) → 명령이 `https://` URL을 찍으면 도는 중(링크) — 「링크 복사」의 값이다.
    /// 2. 명령이 끝나면 확인을 저절로 다시 돌고 「끝남」과 그 답(됨 · 안 됨)을 알린다.
    /// 3. 됨이면 그 엔진의 로그인을 기다리던 대화를 다시 띄운다. 기록은 그대로다.
    ///
    /// 엔진마다 한 번에 하나다 — 이미 돌면 새로 띄우지 않고 지금의 진행을 다시 알린다. 로그인 명령의 끝을 지켜보는 스레드가
    /// 호스트를 약하게 쥐므로 `Arc`로 부른다.
    ///
    /// 막히는 호출이다 — 로그인 env를 아직 쥐지 않았으면 셸을 띄워 기다린다(한도 10초).
    pub fn start_login(self: Arc<Self>, agent: Agent) -> Result<(), HostError> {
        let env = self.login_env(false)?;
        let programs = discovery::look_up(agent, env.path()).map_err(|missing| HostError::EngineMissing { agent, missing })?;
        let host = Arc::downgrade(&self);
        self.logins
            .start(agent, &programs, &env, &login::quiet_place(&env, &self.data_root), move |ended| {
                if let Some(host) = host.upgrade() {
                    host.login_ended(agent, ended);
                }
            })
            .map_err(HostError::Login)
    }

    /// 로그인 취소 — 도는 로그인 명령의 프로세스 그룹에 SIGTERM을 보낸다(SIGINT가 아니다). 1초 안에 끝나지 않으면 그룹째
    /// SIGKILL이다. 「끝남(취소)」은 엔진 상태 이벤트로 온다. 도는 것이 없으면 아무 일도 하지 않는다.
    ///
    /// 막히는 호출이다 — 최대 1초 남짓.
    pub fn cancel_login(&self, agent: Agent) {
        self.logins.cancel(agent);
    }

    /// 로그인 명령이 끝났다 — 확인을 다시 돌고 「끝남」을 알리고, 됨이면 기다리던 대화를 다시 띄운다. 끝을 지켜보는
    /// 스레드에서 돈다.
    fn login_ended(&self, agent: Agent, ended: LoginProgress) {
        let (found, logged_in) = match self.login_env(false) {
            Ok(env) => match self.engine_check(agent, &env) {
                EngineCheck::Found { logged_in, .. } => (true, Some(logged_in)),
                EngineCheck::Missing { .. } => (false, None),
            },
            Err(_) => (false, None),
        };
        self.logins.announce(EngineState { agent, found, logged_in, login: Some(ended) });
        if logged_in == Some(true) {
            self.relaunch_waiting(agent);
        }
    }

    /// 그 엔진의 로그인을 기다리던 대화들을 다시 띄운다. 막히는 호출이다 — 대화마다 세션이 열릴 때까지 기다린다.
    fn relaunch_waiting(&self, agent: Agent) {
        for waiting in self.logins.take_waiting(agent) {
            if let Err(error) = self.relaunch(&waiting) {
                eprintln!("{error}");
            }
        }
    }

    /// 로그인을 기다리던 대화 하나를 다시 띄운다 — 같은 기록 파일에 이어 적고, 새 에이전트 쪽 세션을 연다. 그 세션의 첫
    /// 말에는 머리말이 다시 붙는다(S11).
    ///
    /// - 에이전트가 떠 있으면(턴 도중의 `-32000`) 끄고 새로 띄운다 — 떠 있는 에이전트가 새 로그인을 읽는다는 보장이 없다.
    /// - work가 사라졌거나 대화가 닫혔으면 아무것도 하지 않는다.
    /// - 대기 줄은 다시 뜬 대화로 옮겨 맨 앞부터 간다(티켓 07).
    fn relaunch(&self, waiting: &Waiting) -> Result<(), HostError> {
        let works = atelier_core::works_in(&self.data_root);
        let Ok(meta) = atelier_core::read_work(&works, &waiting.work) else { return Ok(()) };
        let places = atelier_core::work_places(&works, &meta);
        let Some(row) = records::read_rows(&places.agents)
            .map_err(HostError::Record)?
            .into_iter()
            .find(|row| row.id == waiting.conversation && row.closed_at.is_none())
        else {
            return Ok(());
        };
        // 대기 줄은 다시 뜬 대화로 옮긴다 — 에이전트가 죽어도 대기 줄을 그대로 두듯이(S13, 티켓 07).
        let mut queue = VecDeque::new();
        if let Some(mut live) = self.take_live(&waiting.work, &waiting.conversation) {
            shut_down_together(std::slice::from_mut(&mut live));
            queue = std::mem::take(&mut live.conv.lock_state().queue);
        }
        let started = (|| {
            let env = self.login_env(false)?;
            let programs = discovery::look_up(row.agent, env.path())
                .map_err(|missing| HostError::EngineMissing { agent: row.agent, missing })?;
            self.start_agent(&waiting.work, &works, &meta, &places, row, &programs, &env)
        })();
        self.hand_over_queue(&waiting.work, &waiting.conversation, queue);
        started.map(|_| ())
    }

    /// 다시 뜬 대화에 옛 대기 줄을 넘긴다. 로그인이라는 걸림이 풀린 자리라 보낼 수 있으면 맨 앞부터 간다(S13 — 걸림이
    /// 풀리는 자리에서 대기 줄을 보낸다). 다시 뜨지 못했으면(로그인이 또 필요하거나 못 열었으면) 넘길 대화가 없다 — 대기
    /// 줄은 떠 있는 대화의 메모리에만 있으므로 사라지고, 화면이 옛 줄을 붙들지 않게 빈 대기 줄을 알린다.
    fn hand_over_queue(&self, work: &str, conversation: &str, queue: VecDeque<Queued>) {
        if queue.is_empty() {
            return;
        }
        let live = self.lock_live();
        let Some(found) = live.get(conversation).filter(|live| live.work == work) else {
            (self.emit)(HostEvent::Queue { work: work.to_owned(), conversation: conversation.to_owned(), queue: Vec::new() });
            return;
        };
        let mut state = found.conv.lock_state();
        // 다시 뜬 사이에 받은 말이 있으면 그 앞에 선다 — 먼저 든 말이 먼저 간다.
        for queued in queue.into_iter().rev() {
            state.queue.push_front(queued);
        }
        if found.conv.can_send(&state) {
            found.conv.send_queued(&mut state, None);
        } else {
            found.conv.announce_queue(&state);
        }
    }

    /// 찾고, 찾았으면 로그인을 묻는다.
    fn engine_check(&self, agent: Agent, env: &AgentEnv) -> EngineCheck {
        match discovery::look_up(agent, env.path()) {
            Ok(programs) => {
                let logged_in = login::logged_in(agent, &programs, env, &login::quiet_place(env, &self.data_root));
                EngineCheck::Found { programs, logged_in }
            }
            Err(missing) => EngineCheck::Missing { missing },
        }
    }

    /// 대화 목록 — 그 work의 열린 대화들을 만든 순서로 준다. 닫은 대화는 `agents.json`에 줄이 남아도 빠진다
    /// (S14). 읽기만 한다 — `agents/`가 없으면 빈 목록이고, 아무것도 만들지 않는다.
    pub fn list_conversations(&self, work: &str) -> Result<Vec<Conversation>, HostError> {
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        let places = atelier_core::work_places(&works, &meta);
        let rows = records::read_rows(&places.agents).map_err(HostError::Record)?;
        let live = self.lock_live();
        Ok(rows
            .iter()
            .filter(|row| row.closed_at.is_none())
            .map(|row| {
                let (last_seq, queue) = match live.get(&row.id) {
                    Some(conversation) => {
                        (conversation.conv.recorder.last_seq(), queue_of(&conversation.conv.lock_state()))
                    }
                    None => (records::last_seq(&records::record_path(&places.agents, &row.id)), Vec::new()),
                };
                summary(row, last_seq, queue)
            })
            .collect())
    }

    /// 기록 읽기 — 그 대화의 기록에서 `after` 다음 seq의 줄들을 준다. 화면은 이것으로 그리고, 그 뒤는 기록 줄
    /// 이벤트로 잇는다(앱을 다시 켠 뒤 · 다른 work에서 돌아온 뒤). 끝에 줄바꿈이 없는 꼬리(반쪽 줄)는 버린다.
    ///
    /// 읽기만 한다 — 에이전트를 띄우지 않고, 아무것도 만들지 않는다.
    pub fn read_record(&self, work: &str, conversation: &str, after: u64) -> Result<Vec<RecordLine>, HostError> {
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        if !is_conversation_id(conversation) {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        }
        let places = atelier_core::work_places(&works, &meta);
        let path = records::record_path(&places.agents, conversation);
        records::read_lines(&path, after).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => HostError::ConversationNotFound(conversation.to_owned()),
            _ => HostError::Record(format!("기록을 읽지 못했습니다: {} — {error}", path.display())),
        })
    }

    /// 새 대화 — 엔진 기본값으로 만들고 곧바로 띄워 세션을 연다(S8). 그래서 칩 · 메뉴 · 로그인 실패가 첫 말
    /// 전에 선다. 이름은 에이전트 이름으로 저절로 붙는다(Codex · Codex 2).
    ///
    /// 막히는 호출이다 — 세션이 열릴 때까지(한도 30초) 기다린다.
    ///
    /// - work 폴더에 `work.json`이 없으면 아무것도 만들지 않고 실패한다(`agents/`도 만들지 않는다).
    /// - 에이전트를 못 찾으면 대화를 만들지 않고 실패한다 — 안내 카드가 빠진 것과 설치 명령을 보인다.
    /// - 대화를 만든 뒤 세션을 열지 못하면, 프로세스를 남김없이 끄고 기록에 까닭(`session` 죽음 줄)을 적고
    ///   실패한다. 대화는 목록에 남는다 — 다음 말에서 다시 띄운다(10).
    pub fn new_conversation(&self, work: &str, agent: Agent) -> Result<Conversation, HostError> {
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        let places = atelier_core::work_places(&works, &meta);
        if agent == Agent::Claude {
            // three-axes 결정 12 — Codex를 먼저 잇는다. Claude는 변환기(티켓 13)가 서면 연다.
            return Err(HostError::AgentNotReady(agent));
        }
        let env = self.login_env(false)?;
        let programs = discovery::look_up(agent, env.path()).map_err(|missing| HostError::EngineMissing { agent, missing })?;
        let place = workplace(&places, meta.projects.len());

        records::ensure_agents_dir(&places.agents).map_err(HostError::Record)?;
        let row = {
            let _file = self.lock_agents_file();
            let rows = records::read_rows(&places.agents).map_err(HostError::Record)?;
            let row = ConversationRow {
                id: uuid::Uuid::new_v4().to_string(),
                agent,
                name: next_name(agent, &rows),
                cwd: place.cwd.clone(),
                additional_directories: place.additional_directories.clone(),
                agent_session_id: None,
                model: None,
                mode: None,
                plan: None,
                created_at: records::now(),
                closed_at: None,
                extra: Default::default(),
            };
            records::write_row(&places.agents, &row).map_err(HostError::Record)?;
            row
        };
        self.start_agent(work, &works, &meta, &places, row, &programs, &env)
    }

    /// 대화의 에이전트를 띄워 세션을 연다 — 새 대화와, 로그인이 「됨」으로 바뀐 뒤의 다시 띄우기(three-axes 티켓 12)가 함께
    /// 쓴다. 에이전트는 대화를 만들 때 정한 자리(`agents.json`의 cwd · 함께 여는 폴더)에서 일한다(three-axes 결정 17).
    ///
    /// - 열리면 에이전트 쪽 세션 id를 `agents.json`에 적고 떠 있는 표에 넣는다.
    /// - 에이전트가 로그인을 요구하면(`-32000`, 실측 A3) 기록에 로그인 필요 줄을 적고, 로그인 창구가 그 대화를 쥐고 엔진
    ///   상태(찾음 · 안 됨)를 알린다. 실패가 아니다 — 대화는 서고, 화면은 그 자리에 안내 카드를 세운다. 로그인이 「됨」으로
    ///   바뀌면 다시 띄운다.
    /// - 그 밖의 까닭으로 못 열면 프로세스를 남김없이 끈 뒤 기록에 까닭(`session` 죽음 줄)을 적고 실패한다.
    #[allow(clippy::too_many_arguments)]
    fn start_agent(
        &self,
        work: &str,
        works: &Path,
        meta: &atelier_core::Work,
        places: &atelier_core::WorkPlaces,
        mut row: ConversationRow,
        programs: &[discovery::FoundProgram],
        env: &AgentEnv,
    ) -> Result<Conversation, HostError> {
        let conv = Conv::new(
            Recorder::open(&places.agents, work, &row.id, Arc::clone(&self.emit)).map_err(HostError::Record)?,
            spec_place(works, meta, places),
            Some(VanishWatch {
                works: works.to_path_buf(),
                work: work.to_owned(),
                conversation: row.id.clone(),
                live: Arc::downgrade(&self.live),
            }),
            Some(LoginWatch {
                agent: row.agent,
                work: work.to_owned(),
                conversation: row.id.clone(),
                desk: Arc::clone(&self.logins),
            }),
        );
        let recorder = &conv.recorder;
        recorder.session(SessionState::Spawning).map_err(HostError::Record)?;

        let place = SessionPlace { cwd: row.cwd.clone(), additional_directories: row.additional_directories.clone() };
        let launch = codex_launch(programs, env, &place);
        let (agent_process, opened) =
            match runtime::open(launch, place, self.open_limit, conv.sink(), record_opened(&conv)) {
                Ok(opened) => opened,
                Err(OpenError::AuthRequired { .. }) => {
                    recorder.session(SessionState::LoginRequired).map_err(HostError::Record)?;
                    self.logins.login_required(row.agent, work, &row.id);
                    return Ok(summary(&row, recorder.last_seq(), Vec::new()));
                }
                Err(error) => {
                    let reason = error.to_string();
                    recorder
                        .session(SessionState::Died { reason: reason.clone(), stderr_tail: Vec::new() })
                        .map_err(HostError::Record)?;
                    return Err(HostError::Open { conversation: row.id, reason });
                }
            };

        conv.lock_state().turns = agent_process.turns();
        row.agent_session_id = Some(opened.session_id.clone());
        {
            let _file = self.lock_agents_file();
            records::write_row(&places.agents, &row).map_err(HostError::Record)?;
        }

        let conversation = summary(&row, recorder.last_seq(), Vec::new());
        self.lock_live().insert(row.id, Live { work: work.to_owned(), agent: agent_process, conv });
        Ok(conversation)
    }

    /// 보내기 — 턴이 쉬면 말을 보낸다. 기다리지 않는다: 답은 기록 줄 이벤트로 흐르고, 턴 끝도 `turn-end` 줄로
    /// 온다. 에이전트가 말을 받지 않으면(오류로 답하면) 그 까닭이 `turn-end` 줄에 실리고 대화는 산다.
    ///
    /// - 에이전트 쪽 세션의 첫 말이면 머리말(work slug · 제목 · specDir)을 따로 된 텍스트 블록으로 앞에 붙인다
    ///   (S11, three-axes 결정 23). 화면에는 `sent`의 글만 보이고, 기록에는 보낸 블록이 다 남는다.
    /// - 보내기 직전에 spec 폴더를 찍는다. 턴이 끝나면 지금과 견주어 고친 곳(`changes` 줄)을 적는다(three-axes
    ///   결정 22).
    /// - 턴이 도는 동안의 말은 대기 줄 끝에 넣고 대기 줄 바뀜을 낸다(S13). 턴이 끝나면 맨 앞부터 차례로 간다.
    /// - 에이전트가 떠 있지 않은 대화(다시 켠 뒤 · 죽은 뒤)는 아직 보낼 수 없다 — 다시 띄우기는 티켓 10이다.
    ///
    /// 인용 없는 보내기다 — 인용을 붙이는 길은 [`ConversationHost::send_message`].
    pub fn send(&self, work: &str, conversation: &str, text: &str) -> Result<(), HostError> {
        self.send_message(work, conversation, text, None)
    }

    /// 보내기 — [`ConversationHost::send`]와 같고, 문서에서 고른 자리(인용)를 붙일 수 있다(three-axes 티켓 27 · S12).
    /// 인용이 있으면 사람의 글 바로 앞에 인용 블록(실제 경로 + 줄 범위 참조와 마크다운 인용 글)을 따로 된 텍스트 블록으로
    /// 둔다. `sent` 줄에는 인용과 실제로 보낸 블록이 함께 남는다. 올바르지 않은 인용은 아무것도 보내거나 적지 않고
    /// 거절한다.
    pub fn send_message(
        &self,
        work: &str,
        conversation: &str,
        text: &str,
        quote: Option<&Quote>,
    ) -> Result<(), HostError> {
        if !is_conversation_id(conversation) {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        }
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        let places = atelier_core::work_places(&works, &meta);
        // 인용 블록은 지금 짓는다 — 대기 줄에 들어 턴 끝에 가는 말도 그 블록을 들고 간다(턴 끝에서는 work를 읽지 않는다).
        let quote = match quote {
            Some(quote) => Some(quote.attach(&places.spec).map_err(|bad| HostError::BadQuote(bad.to_string()))?),
            None => None,
        };
        // 대화들의 잠금을 쥐기 전에 찍는다 — 폴더를 걷는 동안 다른 대화의 명령을 막지 않게. 그 틈에 다른 대화가
        // 고친 것은 이 턴의 비교에 든다(함께 돈 대화의 고침은 원래 든다).
        let before = Snapshot::take(&spec_place(&works, &meta, &places));

        let live = self.lock_live();
        let Some(found) = live.get(conversation).filter(|live| live.work == work) else {
            return Err(match self.logins.waiting_for(conversation) {
                Some(agent) => HostError::LoginRequired { agent, conversation: conversation.to_owned() },
                None => HostError::NotRunning(conversation.to_owned()),
            });
        };
        let mut state = found.conv.lock_state();
        if let Some(agent) = self.logins.waiting_for(conversation) {
            // 턴 도중에 로그인이 풀렸다. 대화의 잠금 안에서 본다 — 턴 끝이 같은 잠금 안에서 쥐게 한다.
            return Err(HostError::LoginRequired { agent, conversation: conversation.to_owned() });
        }
        if !state.alive || state.turns.is_none() {
            return Err(HostError::NotRunning(conversation.to_owned()));
        }
        let preamble = preamble(&meta, &places);
        if found.conv.can_send(&state) && state.queue.is_empty() {
            return found.conv.begin_turn(&mut state, text, quote.as_ref(), preamble, false, before);
        }
        // S13 — 턴이 도는 동안의 말은 대기 줄 끝에 든다. 턴이 끝나면 맨 앞부터 차례로 간다.
        let message = QueuedMessage { id: uuid::Uuid::new_v4().to_string(), text: text.to_owned(), send_now: false };
        state.queue.push_back(Queued { message, preamble, quote });
        if found.conv.can_send(&state) {
            // 쉬는데 대기 줄이 남아 있다 — 맨 앞부터 보낸다. 새 말이 앞지르지 않는다.
            found.conv.send_queued(&mut state, Some(before));
        } else {
            found.conv.announce_queue(&state);
        }
        Ok(())
    }

    /// 멈추기 — 도는 턴에 `session/cancel`을 보낸다. 기다리지 않는다: 턴 끝(`cancelled`)은 `turn-end` 줄로 오고, 그
    /// 줄에 「우리가 멈췄나」(`cancelledByUs`)가 true로 실린다. 같은 세션이 다음 말을 받는다(스토리 53 · 54).
    ///
    /// - 도는 턴이 없으면(쉬는 대화 · 죽은 대화 · 떠 있지 않은 대화) 아무 일도 하지 않는다 — 멈추기 단추와 턴 끝이
    ///   엇갈려도 읽히는 오류가 나지 않는다.
    /// - 대기 줄은 거두지 않는다 — 멈춘 턴이 끝나면 다른 턴 끝처럼 맨 앞이 간다(S13). 보내지 않을 말은 먼저 지운다.
    pub fn stop(&self, work: &str, conversation: &str) -> Result<(), HostError> {
        if !is_conversation_id(conversation) {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        }
        let live = self.lock_live();
        let Some(found) = live.get(conversation).filter(|live| live.work == work) else { return Ok(()) };
        let state = found.conv.lock_state();
        match (&state.turns, state.alive && state.turn.is_some()) {
            (Some(turns), true) => turns.cancel().map_err(HostError::Send),
            _ => Ok(()),
        }
    }

    /// 대기 고치기 — 대기 줄에서 그 대기 id의 말의 글을 바꾸고 대기 줄 바뀜을 낸다. 대기 id와 차례는 그대로다
    /// (스토리 50). 이미 갔거나 지운 말이면 읽히는 오류다.
    pub fn edit_queued(&self, work: &str, conversation: &str, queued: &str, text: &str) -> Result<(), HostError> {
        self.change_queued(work, conversation, queued, |conv, state, at| {
            state.queue[at].message.text = text.to_owned();
            conv.announce_queue(state);
            Ok(())
        })
    }

    /// 대기 지우기 — 대기 줄에서 그 대기 id의 말을 빼고 대기 줄 바뀜을 낸다(스토리 50). 이미 갔거나 지운 말이면
    /// 읽히는 오류다.
    pub fn delete_queued(&self, work: &str, conversation: &str, queued: &str) -> Result<(), HostError> {
        self.change_queued(work, conversation, queued, |conv, state, at| {
            state.queue.remove(at);
            conv.announce_queue(state);
            Ok(())
        })
    }

    /// 지금 보내기 — 대기 줄의 그 말을 맨 앞으로 옮겨 「지금 보내기」로 세우고(대기 줄 바뀜), 도는 턴을 멈춘다
    /// (`session/cancel`). 턴이 `cancelled`로 끝나면 턴 끝이 맨 앞의 그 말을 보낸다 — `sent` 줄의 「지금 보내기였는지」
    /// (`sendNow`)가 true다. 나머지 대기 줄은 그 뒤 차례로 간다(스토리 52, three-axes 결정 20).
    ///
    /// 기다리지 않는다 — 멈춤도 그 말도 기록 줄로 온다. 에이전트가 cancel을 받고도 턴을 끝내지 않으면 그 말은 맨 앞에서
    /// 턴 끝을 기다린다.
    ///
    /// - 「지금 보내기」를 기다리는 말은 하나뿐이다. 다른 말을 고르면 앞서 고른 말은 보통 대기 말로 돌아간다.
    /// - 이미 갔거나 지운 말이면 읽히는 오류이고 멈추지 않는다. 에이전트가 죽은 대화(다시 띄우기는 10)와 로그인을
    ///   기다리는 대화(12)도 읽히는 오류다.
    pub fn send_now(&self, work: &str, conversation: &str, queued: &str) -> Result<(), HostError> {
        self.change_queued(work, conversation, queued, |conv, state, at| {
            if let Some(agent) = self.logins.waiting_for(conversation) {
                // 보내기처럼 로그인을 기다린다(티켓 12) — 대기 줄은 그대로 두고 멈추지도 않는다.
                return Err(HostError::LoginRequired { agent, conversation: conversation.to_owned() });
            }
            if !state.alive {
                return Err(HostError::NotRunning(conversation.to_owned()));
            }
            let mut picked = state.queue.remove(at).expect("찾은 자리다");
            for other in state.queue.iter_mut() {
                other.message.send_now = false;
            }
            picked.message.send_now = true;
            state.queue.push_front(picked);
            if conv.can_send(state) {
                // 쉬고 있다 — 멈출 턴이 없으니 곧바로 보낸다.
                conv.send_queued(state, None);
                return Ok(());
            }
            conv.announce_queue(state);
            match (&state.turns, state.turn.is_some()) {
                (Some(turns), true) => turns.cancel().map_err(HostError::Send),
                _ => Ok(()),
            }
        })
    }

    /// 그 대화의 대기 줄에서 그 대기 id의 말을 찾아 `change`에 자리와 함께 넘긴다. 대화의 잠금을 쥔 채 부른다 — 턴 끝이
    /// 맨 앞을 꺼내 보내는 것과 엇갈리지 않는다. 떠 있지 않은 대화의 대기 줄은 늘 비어 있다.
    fn change_queued(
        &self,
        work: &str,
        conversation: &str,
        queued: &str,
        change: impl FnOnce(&Conv, &mut ConvState, usize) -> Result<(), HostError>,
    ) -> Result<(), HostError> {
        if !is_conversation_id(conversation) {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        }
        let not_found = || HostError::QueuedNotFound(queued.to_owned());
        let live = self.lock_live();
        let found = live.get(conversation).filter(|live| live.work == work).ok_or_else(not_found)?;
        let mut state = found.conv.lock_state();
        let at = state.queue.iter().position(|item| item.message.id == queued).ok_or_else(not_found)?;
        change(&found.conv, &mut state, at)
    }

    /// 대화 닫기 — 그 에이전트의 프로세스를 남김없이 끄고(stdin 닫기 → 1초 → 그룹째 SIGKILL), 기록에 `session`
    /// 닫힘 줄을, `agents.json`에 닫은 때를 적는다. 줄은 남기고(S14) 기록 파일도 남긴다 — 평가의 재료다.
    ///
    /// 막히는 호출이다 — 끄기가 최대 1초 남짓 걸린다. 이미 닫은 대화를 다시 닫으면 아무 일도 하지 않는다.
    pub fn close_conversation(&self, work: &str, conversation: &str) -> Result<(), HostError> {
        if !is_conversation_id(conversation) {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        }
        let mut live = self.take_live(work, conversation);
        if let Some(live) = live.as_mut() {
            shut_down_together(std::slice::from_mut(live));
        }
        // 닫은 대화는 로그인이 「됨」이 돼도 다시 띄우지 않는다.
        self.logins.forget(conversation);

        let works = atelier_core::works_in(&self.data_root);
        let Ok(meta) = atelier_core::read_work(&works, work) else {
            // work 폴더가 사라졌다(아카이브 · 삭제). 끈 것으로 끝낸다 — 열어 둔 기록 파일은 옮겨진 자리를 따라가지만,
            // 사라진 자리의 `agents.json`은 다시 만들지 않는다(S10).
            return match live {
                Some(live) => live.conv.recorder.session(SessionState::Closed { cause: None }).map_err(HostError::Record),
                None => Err(HostError::WorkNotFound(work.to_owned())),
            };
        };
        let places = atelier_core::work_places(&works, &meta);
        let _file = self.lock_agents_file();
        let Some(mut row) =
            records::read_rows(&places.agents).map_err(HostError::Record)?.into_iter().find(|row| row.id == conversation)
        else {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        };
        if row.closed_at.is_some() && live.is_none() {
            return Ok(());
        }
        let conv = match live {
            Some(live) => live.conv,
            None => Conv::new(
                Recorder::open(&places.agents, work, conversation, Arc::clone(&self.emit)).map_err(HostError::Record)?,
                spec_place(&works, &meta, &places),
                None,
                None,
            ),
        };
        conv.recorder.session(SessionState::Closed { cause: None }).map_err(HostError::Record)?;
        row.closed_at = Some(records::now());
        records::write_row(&places.agents, &row).map_err(HostError::Record)
    }

    /// 사라진 work의 대화를 끈다(S10) — 앱은 work 목록이 바뀌었다는 감시 소식(`works:changed`)마다 부른다. work가
    /// 사라지는 길은 아카이브든 삭제든, 앱에서든 앱 밖의 MCP 프로세스에서든 같다 — 감시는 `works/`를 보므로 다 안다.
    ///
    /// - 쉬는 대화는 지금 끈다.
    /// - 턴이 도는 대화는 두고 그 턴이 끝나는 대로 끈다 — 아카이브를 시킨 에이전트가 바로 그 턴 안에 있을 수 있다.
    ///   턴 끝에는 대화가 스스로 `work.json`을 보므로, 이 소식이 턴 도중에 와도 턴 끝에 꺼진다.
    /// - 기록은 열어 둔 파일에 닫힘 줄을 적고 끝낸다. `agents.json`은 쓰지 않는다 — 옛 자리를 다시 만들지 않는다.
    ///
    /// 막히는 호출이다 — 끌 대화가 있으면 끄기가 최대 1초 남짓 걸린다.
    pub fn check_vanished_works(&self) {
        let works = atelier_core::works_in(&self.data_root);
        // 떠 있는 대화의 work마다 한 번씩, 표를 잠그지 않은 채 본다 — 감시 소식은 spec을 고칠 때마다 온다.
        let mut held: Vec<String> = self.lock_live().values().map(|live| live.work.clone()).collect();
        held.sort();
        held.dedup();
        let vanished: Vec<String> = held.into_iter().filter(|work| work_vanished(&works, work)).collect();
        if vanished.is_empty() {
            return;
        }
        retire_vanished(&self.live, |_, live| {
            vanished.contains(&live.work) && live.conv.lock_state().turn.is_none()
        });
    }

    /// 호스트 끄기 — 모든 대화의 프로세스 그룹을 끈다(앱 종료). 대화를 닫지는 않는다: `agents.json`과 기록은
    /// 그대로이고, 앱을 다시 켜면 말을 보낼 때 되살린다(three-axes 결정 19).
    ///
    /// 모든 대화의 stdin을 **한꺼번에** 닫고 1초를 **한 번만** 기다린 뒤 그룹들을 SIGKILL한다 — 대화마다 1초씩
    /// 줄을 세우면 N초가 된다.
    pub fn shut_down(&self) {
        // 로그인 명령도 끈다 — SIGTERM을 먼저 보내 두고, 대화들을 끄는 1초 뒤에 남은 것을 SIGKILL한다.
        self.logins.begin_close();
        let mut live: Vec<Live> = self.lock_live().drain().map(|(_, live)| live).collect();
        shut_down_together(&mut live);
        self.logins.finish_close();
    }

    /// 쥔 로그인 env. 없거나 다시 읽으라면 셸을 띄워 읽는다. 다시 읽기가 실패하면 쥔 것도 버린다 —
    /// 사람이 방금 본 실패와 다음 확인의 답이 어긋나지 않게.
    fn login_env(&self, reread: bool) -> Result<AgentEnv, LoginShellError> {
        let mut held = self.login_env.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if reread {
            *held = None;
        }
        if let Some(env) = held.as_ref() {
            return Ok(env.clone());
        }
        let env = AgentEnv::from_login(login_env::read(&self.shell, self.login_shell_limit)?);
        *held = Some(env.clone());
        Ok(env)
    }

    /// 그 work의 그 대화가 떠 있으면 꺼낸다.
    fn take_live(&self, work: &str, conversation: &str) -> Option<Live> {
        let mut live = self.lock_live();
        match live.get(conversation) {
            Some(found) if found.work == work => live.remove(conversation),
            _ => None,
        }
    }

    fn lock_live(&self) -> MutexGuard<'_, HashMap<String, Live>> {
        self.live.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_agents_file(&self) -> MutexGuard<'_, ()> {
        self.agents_file.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// 에이전트가 일하는 자리(three-axes 결정 17).
///
/// | 프로젝트 | cwd | 함께 여는 폴더 |
/// |---|---|---|
/// | 없음 | spec 폴더 | — |
/// | 하나 | 그 워크트리 | spec 폴더 |
/// | 여럿 | `trees/` | spec 폴더 |
fn workplace(places: &atelier_core::WorkPlaces, projects: usize) -> SessionPlace {
    let cwd = match (projects, places.worktrees.first()) {
        (0, _) | (_, None) => return SessionPlace { cwd: places.spec.clone(), additional_directories: Vec::new() },
        (1, Some(tree)) => tree.clone(),
        _ => places.trees.clone(),
    };
    SessionPlace { cwd, additional_directories: vec![places.spec.clone()] }
}

/// 턴 앞뒤로 찍는 spec 폴더 — 프로젝트가 있어도 워크트리는 찍지 않는다(three-axes 결정 22).
fn spec_place(works: &Path, meta: &atelier_core::Work, places: &atelier_core::WorkPlaces) -> SpecPlace {
    SpecPlace {
        works_root: works.to_path_buf(),
        work: meta.slug.clone(),
        work_dir: places.dir.clone(),
        spec_dir: places.spec.clone(),
    }
}

/// 세션이 열린 순간 적는 줄 — 판 경고(S6)와 열림. 런타임의 순서 장벽 안에서 돌아, 답 뒤에 온 update보다 앞에 선다.
fn record_opened(conv: &Arc<Conv>) -> runtime::OnOpened {
    let conv = Arc::clone(conv);
    Box::new(move |opened| {
        let agent_version = opened.initialize["agentInfo"]["version"].as_str().map(str::to_owned);
        let written = (|| {
            if major(agent_version.as_deref()) != Some(CODEX_ACP_MAJOR) {
                conv.recorder.session(SessionState::VersionWarning {
                    agent_version: agent_version.clone(),
                    supported_major: CODEX_ACP_MAJOR,
                })?;
            }
            conv.recorder.session(SessionState::Opened {
                how: "new",
                agent_version: agent_version.clone(),
                modes: opened.session.get("modes").cloned().unwrap_or(Value::Null),
                models: opened.session.get("models").cloned().unwrap_or(Value::Null),
                config_options: opened.session.get("configOptions").cloned().unwrap_or(Value::Null),
            })
        })();
        if let Err(error) = written {
            eprintln!("{error}");
        }
    })
}

/// Codex를 띄우는 것 — 찾은 `codex-acp`를 `npx` 없이 바로 띄운다(three-axes 결정 26). env는 로그인 env에
/// `CODEX_PATH=<찾은 codex>`를 더한 것이다. `INITIAL_AGENT_MODE`는 넣지 않는다 — 시작 모드는 엔진 기본값이다.
/// 사용자의 `CODEX_HOME`은 로그인 env에 있으면 그대로 간다(로그인 · config의 MCP · 모델이 이어진다).
fn codex_launch(programs: &[discovery::FoundProgram], env: &AgentEnv, place: &SessionPlace) -> Launch {
    let found = |name: &str| -> PathBuf {
        programs.iter().find(|program| program.name == name).expect("찾은 것에 Codex의 셋이 다 있다").path.clone()
    };
    let mut vars: BTreeMap<OsString, OsString> = env.vars().clone();
    vars.insert("CODEX_PATH".into(), found("codex").into_os_string());
    Launch { program: found("codex-acp"), args: Vec::new(), env: vars, cwd: place.cwd.clone() }
}

/// 머리말(S11) — 에이전트가 첫 말에서 어느 work인지 안다(스토리 107). 따로 된 텍스트 블록이라 화면은 이것을
/// 그리지 않고 `sent`의 글만 그린다(스토리 108). 봉투처럼 한국어 마크다운 한 장이다(워크플로 S18).
fn preamble(meta: &atelier_core::Work, places: &atelier_core::WorkPlaces) -> Value {
    let text = format!(
        "Atelier work 안에서 열린 대화다.\n\n- work slug: `{}`\n- 제목: {}\n- spec 폴더(specDir): `{}`\n",
        meta.slug,
        meta.title,
        places.spec.display()
    );
    json!({"type": "text", "text": text})
}

/// 열린 대화 가운데 쓰지 않은 가장 작은 이름 — `Codex`, `Codex 2`, `Codex 3` …
fn next_name(agent: Agent, rows: &[ConversationRow]) -> String {
    let taken: Vec<&str> = rows.iter().filter(|row| row.closed_at.is_none()).map(|row| row.name.as_str()).collect();
    (1..)
        .map(|n| if n == 1 { agent.display_name().to_owned() } else { format!("{} {n}", agent.display_name()) })
        .find(|name| !taken.contains(&name.as_str()))
        .expect("이름은 언젠가 빈다")
}

/// 화면이 넘긴 대화 id가 이 호스트가 지은 꼴인가 — 기록 파일 이름이 되므로 경로 요소를 들이지 않는다.
fn is_conversation_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// 판 글의 메이저 — `2.2.2` → 2. 읽을 수 없으면 `None`이다.
fn major(version: Option<&str>) -> Option<u64> {
    version?.split('.').next()?.trim().parse().ok()
}

fn summary(row: &ConversationRow, last_seq: u64, queue: Vec<QueuedMessage>) -> Conversation {
    Conversation {
        id: row.id.clone(),
        agent: row.agent,
        name: row.name.clone(),
        model: row.model.clone(),
        mode: row.mode.clone(),
        plan: row.plan,
        last_seq,
        queue,
    }
}
