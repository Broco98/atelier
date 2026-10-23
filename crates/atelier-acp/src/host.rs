//! 대화 호스트 — 대화창의 몸통. 앱은 이것 하나를 managed state로 쥐고 명령을 위임한다.
//!
//! 엔진 확인(three-axes 티켓 02) 위에 대화 목록 · 새 대화 · 대화 닫기 · 호스트 끄기(03), 보내기 · 기록 읽기(04),
//! 턴 앞뒤의 spec 비교(06), 멈추기 · 대기 줄 · 지금 보내기(07), 권한 답(08), 모델 · 모드 · 계획 바꾸기와 엔진 목록(09),
//! 앱을 다시 켠 뒤 · 에이전트가 죽은 뒤의 되살리기(10), 사라진 work의 대화 끄기(11), 로그인 확인 · 로그인 명령 · 로그인 필요
//! 대화의 다시 띄우기(12), Claude 대화 열기 · 에이전트 바꾸기(13), 에이전트가 스스로 이어 간 턴(16, S4)이 선다. 앱 잇기(05)가
//! 이 위에 선다.
//!
//! 대화 하나 = 에이전트 프로세스 하나 · 에이전트 쪽 세션 하나 · 기록 파일 하나다. 동시 개수 상한은 없다
//! (three-axes 결정 19).
//!
//! v1은 같은 호스트에 Thread를 자리로 더한다(v1 티켓 04, [`thread`]) — 열쇠가 (Thread, 참여자)인 Session들이 턴 차례 · 런타임 ·
//! 로그인 창구를 work 대화와 함께 쓴다. work 대화는 Work 안 대화창을 걷는 날(v1 티켓 08)까지 그대로 산다.

use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::chat_settings;
use crate::discovery::{self, Agent, EngineCheck, MissingProgram};
use crate::engines::{self, EngineLists};
use crate::login::{self, EngineState, LoginDesk, LoginProgress, Waiter, Waiting};
use crate::login_env::{self, AgentEnv, LoginShellError, ShellSource};
use crate::quote::Quote;
use crate::records::{self, CloseCause, ConversationRow, PermissionLine, RecordLine, Recorder, SessionState, TurnEndLine};
use crate::runtime::{self, AgentProcess, AnswerError, Launch, OpenError, OpenTerms, RuntimeEvent, SessionPlace, Sink, Turns};
use crate::spec_changes::{Snapshot, SpecPlace};

mod thread;
mod turn_order;

pub use thread::{ThreadLink, ThreadView};
use turn_order::{Draft, Seat, TurnHands, TurnOrder};

/// 판 02가 잰 codex-acp의 메이저 판(S6). 다르면 판 경고 줄을 남기고 계속한다.
const CODEX_ACP_MAJOR: u64 = 2;

/// Codex 세션 열기(띄우기 → initialize → `session/new`)의 기본 한도. ACP가 아닌 명령이 말없이 살아 있어도 새 대화가
/// 끝없이 막히지 않게 한다. 진짜 codex-acp는 1초 안팎에 연다(실측 A1).
const CODEX_OPEN_LIMIT: Duration = Duration::from_secs(30);

/// Claude 세션 열기의 기본 한도 — 관문 G5. 변환기는 `session/new`를 받아 claude를 띄우고 stdin `initialize`의 답으로
/// 세션을 여므로, 세션 열기가 그만큼 기다린다. 진짜 claude 2.1.296은 SessionStart 훅을 돈 뒤 0.9~3.5초에 답했다(판 02 실측
/// G5). 넘으면 열기 실패다.
const CLAUDE_OPEN_LIMIT: Duration = Duration::from_secs(10);

/// 모드 · 설정 바꾸기의 답을 기다리는 한도. 진짜 codex-acp는 1~3ms에 답한다(실측 A2) — 답 없이 버티는 에이전트에 화면이
/// 끝없이 막히지 않게만 둔다.
const SETTING_LIMIT: Duration = Duration::from_secs(10);

/// 호스트가 내보내는 것 — 기록 줄 · 대기 줄 바뀜(07) · 엔진 상태(12).
#[derive(Debug, Clone, PartialEq)]
pub enum HostEvent {
    /// 기록 줄 — 기록 파일에 적은 것과 같은 줄이다. 화면은 대화를 이것 하나로 그린다.
    Record { work: String, conversation: String, line: RecordLine },
    /// 대기 줄 바뀜 — 그 대화의 대기 줄 전체. 대기 줄은 기록에 없으므로(S13) 화면은 이것과 대화 목록으로 그린다.
    Queue { work: String, conversation: String, queue: Vec<QueuedMessage> },
    /// 엔진 상태 — 찾음 여부 · 로그인 여부 · 로그인 진행(링크 · 끝남). 엔진을 확인할 때, 에이전트가 로그인을 요구할 때,
    /// 로그인 명령이 돌고 끝날 때 나간다(three-axes 티켓 12). work 대화와 Thread가 함께 듣는다.
    Engine(EngineState),
    /// Thread의 기록 줄 — `events.jsonl`에 적은 것과 같은 줄이다(v1 티켓 04). 화면은 Thread를 이것 하나로 그린다.
    ThreadRecord { thread: String, line: RecordLine },
    /// Thread 참여자 하나의 Session의 대기 줄 바뀜 — 그 대기 줄 전체.
    ThreadQueue { thread: String, who: String, queue: Vec<QueuedMessage> },
    /// Thread 하나의 목록 요약이 바뀜 — 새 Thread · 참여자가 늘었다(S7: Thread 폴더는 감시하지 않으므로 엔진이 알린다).
    ThreadList(atelier_core::ThreadSummary),
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
    open_limit: Option<Duration>,
}

impl HostBuilder {
    /// 로그인 셸 읽기의 한도. 기본은 10초다(워크플로 §10) — 검사에서는 줄여도 된다.
    pub fn login_shell_limit(mut self, limit: Duration) -> Self {
        self.login_shell_limit = limit;
        self
    }

    /// 세션 열기의 한도. 기본은 Codex 30초 · Claude 10초(G5)다 — 검사에서는 줄여도 된다. 주면 두 엔진 모두 이 값이다.
    pub fn open_limit(mut self, limit: Duration) -> Self {
        self.open_limit = Some(limit);
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
            revivals: Mutex::new(HashMap::new()),
            agents_file: Mutex::new(()),
            engines_file: Mutex::new(()),
            threads: thread::Threads::default(),
        }
    }
}

pub struct ConversationHost {
    data_root: PathBuf,
    translator: TranslatorCommand,
    shell: ShellSource,
    emit: Arc<Emit>,
    login_shell_limit: Duration,
    open_limit: Option<Duration>,
    /// S7 — 로그인 env는 호스트가 도는 동안 한 번 읽어 메모리에 쥔다. 「다시 확인」만 다시 읽는다.
    /// 기록하지 않는다 — 비밀이 `agents/`에 남지 않게(워크플로 S37).
    ///
    /// 읽는 동안 잠금을 쥔다. 두 엔진 확인이 함께 와도 셸은 한 번만 뜨고, 뒤의 것이 앞의 결과를 쓴다.
    login_env: Mutex<Option<AgentEnv>>,
    /// 에이전트가 떠 있는 대화들 — 대화 id로 찾는다. 대화마다 이 표를 약하게 쥔다 — 사라진 work의 대화가 턴
    /// 끝에 스스로 표에서 빠져 꺼진다(S10).
    live: Arc<LiveTable>,
    /// 대화마다 띄우기(되살리기 · 에이전트 바꾸기 · 닫기)를 하나씩 세우는 잠금 — 함께 온 보내기 둘이 에이전트를 둘 띄우지 않고,
    /// 바꾸는 사이에 온 보내기가 엔진을 하나 더 띄우지 않고, 되살리는 사이에 닫힌 대화가 다시 떠 있는 표에 서지 않게(three-axes
    /// 티켓 10 · 13). 설정 바꾸기도 되살리기의 끝을 이것으로 기다린다. 잠금 차례의 맨 바깥이다 — 이 문 → 설정 → 떠 있는 표 →
    /// 대화(`state`) → 기록. 대화 id로 찾는다.
    revivals: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// `agents.json`을 읽고 고쳐 쓰는 사이를 잠근다 — 함께 연 두 대화가 서로의 줄을 지우지 않게.
    agents_file: Mutex<()>,
    /// 엔진 목록 파일을 읽고 고쳐 쓰는 사이를 잠근다 — 함께 열린 두 엔진이 서로의 목록을 지우지 않게(S16).
    engines_file: Mutex<()>,
    /// 로그인 창구 — 엔진 상태를 알리고, 로그인을 기다리는 대화와 도는 로그인 명령을 쥔다(three-axes 티켓 12).
    logins: Arc<LoginDesk>,
    /// Thread들 — 떠 있는 Session · 연 기록 · 색인(v1 티켓 04).
    threads: thread::Threads,
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
/// 잠금 순서는 늘 `state` → 기록이다. 턴 끝 줄은 `state`를 쥔 채 적고, 같은 잠금 안에서 대기 줄의 다음 말을 보낸다 — 그래야
/// 다음 말의 `sent` 줄이 턴 끝 줄보다 앞에 서지 않고, 그 사이에 온 보내기가 대기 줄을 앞지르지 못한다.
struct Conv {
    recorder: Recorder,
    /// 턴 앞뒤로 찍는 spec 폴더(three-axes 결정 22). Thread의 Session에는 없다 — 찍지 않고 `changes` 줄도 적지 않는다(v1 티켓 04).
    spec: Option<SpecPlace>,
    state: Mutex<ConvState>,
    /// 턴 끝에 work가 사라졌는지 본다(S10). 떠 있지 않은 대화(닫힘 줄만 적으려고 연 기록)에는 없다.
    vanish: Option<VanishWatch>,
    /// 턴 도중에 에이전트가 로그인을 요구하면 그 대화를 로그인 창구에 쥐게 한다(three-axes 티켓 12). 떠 있지 않은 대화에는
    /// 없다.
    login: Option<LoginWatch>,
    /// 모델 · 모드 · 계획 바꾸기를 하나씩 세운다 — 엔진에 넣은 차례와 `agents.json`에 남는 차례가 엇갈리지 않게(티켓 09).
    /// `state`와 따로 둔다: 바꾸기는 엔진의 답을 기다리는데, 그동안 `state`를 쥐면 턴 끝이 막혀 답이 오지 않는다.
    setting: Mutex<()>,
}

struct ConvState {
    /// 턴 차례 — 살아 있나 · 턴 단계 · 대기 줄(S13) · 고친 곳의 앞(three-axes 결정 22) · 머리말 붙임(S11). 대기 줄은 에이전트가
    /// 죽어도 그대로 두고, 되살린 대화가 이어 쥔다.
    order: TurnOrder<Snapshot>,
    /// 에이전트에 턴을 열고 멈추는 손잡이. 세션이 열린 뒤에 선다.
    turns: Option<Turns>,
    /// 떠 있는 표에서 꺼냈나 — 바꾸기 · 닫기 · 되살리기 · 사라진 work 끄기 · 호스트 끄기가 이 대화를 쥐었다. 명령은 표에서 대화를
    /// 찾은 뒤 표의 잠금을 놓고 이 잠금을 쥐는데(S2), 그 사이에 꺼내졌으면 표에 없는 대화로 본다([`Conv::lock_found`]). 꺼낸 쪽은
    /// 꺼낸 뒤로 명령이 이 대화에 닿지 않는 것에 기댄다 — 바꾸기가 첫 말을 확인한 뒤 옛 엔진을 끄는 사이에 말이 끼지 않고, 닫히는
    /// 대화에 말 · 권한 답이 끼지 않는다. 표에 되돌려 넣을 때 걷힌다.
    taken: bool,
}

/// 변환기가 표시한 턴 밖 턴의 시작 · 끝(S4) — `session_info_update`의 `_meta.atelier.outOfTurn`.
enum OutOfTurn {
    Started,
    /// 끝 — 몸은 `session/prompt`의 답과 같은 꼴(`stopReason` · `_meta`)이다.
    Ended(Value),
}

impl OutOfTurn {
    fn of(raw: &Value) -> Option<Self> {
        let update = &raw["update"];
        if update["sessionUpdate"] != "session_info_update" {
            return None;
        }
        let mark = &update["_meta"]["atelier"]["outOfTurn"];
        match mark["state"].as_str()? {
            "started" => Some(OutOfTurn::Started),
            "ended" => Some(OutOfTurn::Ended(mark["response"].clone())),
            _ => None,
        }
    }
}

impl ConvState {
    /// 에이전트 쪽 세션이 막 열린 대화 — 살아 있고, 턴이 쉬고, 첫 말에 머리말을 붙인다. 턴 손잡이는 세션이 열린 뒤에
    /// 서고, 대기 줄은 비어 있다.
    fn fresh() -> Self {
        Self { order: TurnOrder::new(), turns: None, taken: false }
    }

    /// 에이전트가 떠 있고 살아 있나 — 세션이 열려 턴 손잡이가 섰다. 대화 목록의 `live`(three-axes 티켓 23)이고, 말을 곧바로
    /// 보낼 수 있는 대화다. 죽었거나 끈 대화는 아니다.
    fn is_up(&self) -> bool {
        self.order.alive() && self.turns.is_some()
    }
}

impl Conv {
    fn new(recorder: Recorder, spec: Option<SpecPlace>, vanish: Option<VanishWatch>, login: Option<LoginWatch>) -> Arc<Self> {
        Arc::new(Self { recorder, spec, state: Mutex::new(ConvState::fresh()), vanish, login, setting: Mutex::new(()) })
    }

    fn lock_state(&self) -> MutexGuard<'_, ConvState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 표에서 찾은 대화의 잠금 — 명령은 [`ConversationHost::find_live`]로 찾은 대화를 이것으로 쥔다. 찾은 뒤 이 잠금을 쥐기 전에
    /// 다른 명령이 표에서 꺼냈으면 `None`이다: 그 대화는 표에 없는 것과 같다(`ConvState::taken`). 턴 끝 · 죽음처럼 런타임이
    /// 넘긴 것은 명령이 아니라 이것을 거치지 않는다.
    fn lock_found(&self) -> Option<MutexGuard<'_, ConvState>> {
        let state = self.lock_state();
        (!state.taken).then_some(state)
    }

    /// 쥔 `state`의 턴 차례에 이 대화의 손을 붙인다 — 그 잠금 한 구간 동안만.
    fn seat<'a>(&'a self, state: &'a mut ConvState) -> Seat<'a, ConvHands<'a>> {
        let ConvState { order, turns, .. } = state;
        order.seat(ConvHands { conv: self, turns: turns.as_ref() })
    }

    /// 런타임이 넘긴 것을 기록에 적는 sink.
    fn sink(self: &Arc<Self>) -> Sink {
        let conv = Arc::clone(self);
        Arc::new(move |event| conv.receive(event))
    }

    fn receive(&self, event: RuntimeEvent) {
        let written = match event {
            RuntimeEvent::Update(raw) => match OutOfTurn::of(&raw) {
                Some(OutOfTurn::Started) => {
                    let written = self.recorder.update(raw);
                    let mut state = self.lock_state();
                    self.seat(&mut state).self_started();
                    written
                }
                Some(OutOfTurn::Ended(response)) => {
                    let mut state = self.lock_state();
                    self.seat(&mut state).self_ended(response)
                }
                None => self.recorder.update(raw),
            },
            RuntimeEvent::Stderr(line) => self.recorder.stderr(line),
            RuntimeEvent::AuthStatus(params) => self.recorder.session(SessionState::AuthStatus { params }),
            // 권한 줄은 대화의 잠금을 쥐지 않고 적는다 — 답 · 멈추기는 대화의 잠금을 쥔 채 런타임을 부르고, 런타임은 그 안에서
            // 이것을 넘긴다.
            RuntimeEvent::PermissionAsked(asked) => self.recorder.permission(PermissionLine::Asked {
                request_id: asked.request_id,
                request: asked.request,
                tool_call: asked.tool_call,
            }),
            RuntimeEvent::PermissionAnswered { request_id, option_id } => {
                self.recorder.permission(PermissionLine::Answered { request_id, option_id })
            }
            RuntimeEvent::PermissionWithdrawn { request_id, reason } => {
                self.recorder.permission(PermissionLine::Withdrawn { request_id, reason })
            }
            RuntimeEvent::Died(death) => {
                // 답 없이 사라진 턴에는 턴 끝이 없다 — 죽음 줄이 그 자리를 맡는다.
                let mut state = self.lock_state();
                state.order.died();
                self.recorder.session(SessionState::Died { reason: death.reason, stderr_tail: death.stderr_tail })
            }
            RuntimeEvent::TurnEnd(end) => {
                let mut state = self.lock_state();
                self.seat(&mut state).turn_ended(end)
            }
        };
        if let Err(error) = written {
            // 기록이 막혀도 대화는 이어 간다 — sink는 오류를 돌려줄 곳이 없다.
            eprintln!("{error}");
        }
    }
}

/// 턴 차례가 시키는 일을 이 대화의 기록 · 턴 손잡이 · 로그인 창구 · spec 폴더로 옮기는 것 — [`TurnHands`]의 운영 adapter.
/// 대화의 `state` 잠금 안에서만 산다. 손잡이는 그 잠금이 쥔 `ConvState::turns`다.
struct ConvHands<'a> {
    conv: &'a Conv,
    turns: Option<&'a Turns>,
}

impl ConvHands<'_> {
    /// 걸림 없이 부르는 자리라 손잡이는 늘 있다 — 없으면 떠 있지 않은 대화다.
    fn turns(&self) -> Result<&Turns, String> {
        self.turns.ok_or_else(|| format!("에이전트가 떠 있지 않은 대화입니다: {}", self.conv.recorder.name()))
    }
}

impl TurnHands for ConvHands<'_> {
    type Shot = Snapshot;

    fn plugged(&self) -> bool {
        self.turns.is_some()
    }

    fn permission_pending(&self) -> bool {
        self.turns.is_some_and(Turns::permission_pending)
    }

    fn login_waiting(&self) -> Option<Agent> {
        self.conv.login.as_ref().and_then(LoginWatch::waiting)
    }

    fn vanished(&self) -> bool {
        self.conv.spec.as_ref().is_some_and(|spec| work_vanished(&spec.works_root, &spec.work))
    }

    /// 찍을 spec 폴더가 없으면(Thread의 Session) 빈 것이다 — 견주어도 바뀐 것이 없다.
    fn shoot(&mut self) -> Snapshot {
        self.conv.spec.as_ref().map_or_else(Snapshot::empty, Snapshot::take)
    }

    /// 바뀐 것이 없으면 `changes` 줄이 없다 — 화면의 알약이 0개로 서지 않는다.
    fn changes(&mut self, before: &Snapshot, now: &Snapshot) -> Result<(), records::RecordError> {
        let files = before.compare(now);
        if files.is_empty() {
            return Ok(());
        }
        self.conv.recorder.changes(&files)
    }

    fn turn_end(&mut self, line: TurnEndLine) -> Result<(), records::RecordError> {
        self.conv.recorder.turn_end(line)
    }

    fn sent(
        &mut self,
        text: &str,
        quote: Option<&Quote>,
        prompt: &[Value],
        send_now: bool,
    ) -> Result<(), records::RecordError> {
        self.conv.recorder.sent(text, quote, prompt, send_now)
    }

    /// 엔진을 가리지 않는다 — 턴 도중의 `-32000`(풀린 Codex 로그인, Claude는 S3)도 `session/new`의 것과 같은 로그인 필요
    /// 줄이다(three-axes 티켓 12). 대화의 잠금을 쥔 채 적고 쥐어 둔다 — 그 사이에 보내기가 끼지 않고, 대기 줄도 로그인을
    /// 기다린다.
    fn login_lost(&mut self) -> Result<(), records::RecordError> {
        self.conv.recorder.session(SessionState::LoginRequired)?;
        if let Some(watch) = &self.conv.login {
            watch.required();
        }
        Ok(())
    }

    fn queue_changed(&mut self, queue: Vec<QueuedMessage>) {
        self.conv.recorder.queue_changed(queue);
    }

    fn prompt(&mut self, blocks: Vec<Value>) -> Result<(), String> {
        self.turns()?.prompt(blocks)
    }

    fn cancel(&mut self) -> Result<(), String> {
        self.turns()?.cancel()
    }

    fn answer(&mut self, request: &str, option: &str) -> Result<(), AnswerError> {
        self.turns.map_or(Err(AnswerError::Closed), |turns| turns.answer(request, option))
    }

    fn retire_if_vanished(&mut self) -> bool {
        self.conv.vanish.as_ref().is_some_and(VanishWatch::retire_if_vanished)
    }
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
    /// 대화의 에이전트 — 첫 말 전의 에이전트 바꾸기(three-axes 티켓 13)가 떠 있던 대화를 그대로 쓰며 바꾼다.
    agent: Mutex<Agent>,
    /// 다시 띄울 자리 — work 대화이거나 Thread 참여자의 Session이다.
    waiter: Waiter,
    desk: Arc<LoginDesk>,
}

impl LoginWatch {
    fn required(&self) {
        let agent = *self.agent.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.desk.login_required(agent, self.waiter.clone());
    }

    fn switch_to(&self, agent: Agent) {
        *self.agent.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = agent;
    }

    /// 그 대화가 로그인을 기다리면 그 에이전트 — 그동안은 대기 줄이 가지 않는다(S13의 걸림).
    fn waiting(&self) -> Option<Agent> {
        self.desk.waiting_for(&self.waiter)
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
    mark_taken(retiring.iter().map(|live| &*live.conv));
    shut_down_together(&mut retiring);
    for conversation in &retiring {
        let closed = SessionState::Closed { cause: Some(CloseCause::WorkVanished) };
        if let Err(error) = conversation.conv.recorder.session(closed) {
            eprintln!("{error}");
        }
    }
}

/// 떠 있는 표에서 꺼낸 대화들에 꺼냈다고 적는다(`ConvState::taken`) — 표의 잠금을 놓은 뒤에 부른다. 대화의 잠금이 턴 끝의 spec
/// 폴더 견주기에 쥐여 있어도 다른 대화의 명령이 표에서 막히지 않게(S2). 꺼낸 뒤에 표에서 찾는 명령은 대화를 못 찾고, 그 전에
/// 찾아 둔 명령은 이 표시를 보고 물러난다 — 이미 그 잠금을 쥔 명령이면 그것이 끝난 뒤에 적힌다.
fn mark_taken<'a>(taken: impl IntoIterator<Item = &'a Conv>) {
    for conv in taken {
        conv.lock_state().taken = true;
    }
}

/// 대화 여럿의 프로세스 그룹을 끈다 — [`end_together`].
fn shut_down_together(live: &mut [Live]) {
    end_together(live.iter_mut().map(|live| (&mut live.agent, &*live.conv)).collect());
}

/// 에이전트 여럿(work 대화 · Thread의 Session)의 프로세스 그룹을 끈다 — 모두의 stdin을 **한꺼번에** 닫고 1초를 **한 번만**
/// 기다린 뒤 그룹들을 SIGKILL한다. 하나마다 1초씩 줄을 세우면 N초가 된다.
fn end_together(mut agents: Vec<(&mut AgentProcess, &Conv)>) {
    let deadline = Instant::now() + runtime::SHUTDOWN_GRACE;
    for (agent, _) in agents.iter_mut() {
        agent.begin_shutdown();
    }
    for (agent, conv) in agents {
        agent.finish_shutdown(deadline);
        // 끈 대화는 연결을 쥐지 않는다 — 대화가 든 턴 손잡이의 복제도 놓는다.
        conv.lock_state().turns = None;
    }
}

/// 새 대화가 처음 쥐는 모델 · 모드. 비우면 엔진 기본값이다(three-axes 결정 16) — Claude는 `--model` · `--permission-mode`를
/// 주지 않아 사용자 설정을 물려받는다. 설정 「대화」(티켓 25)가 채운다.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConversationDefaults {
    pub model: Option<String>,
    pub mode: Option<String>,
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
    /// 에이전트가 지금 이 앱에 떠 있고 살아 있나(three-axes 티켓 23). 앱을 다시 켠 뒤에는 말을 보내기 전까지 거짓이다 — 화면은
    /// 이것으로 기록 끝(`last_seq`)에 열린 채 남은 턴과 물음을 끝난 프로세스의 것으로 읽는다. 앱을 끄면 턴 끝도 죽음 줄도 없이
    /// 끝나므로 기록만으로는 「화면 새로고침(여전히 돈다)」과 「앱을 다시 켬(끝났다)」을 가를 수 없다.
    pub live: bool,
}

/// 앱 종료 확인 창이 세는 것(three-axes 티켓 23 · S13) — 앱 전체(지금 열지 않은 work 포함)에서, 끄면 잃는 것들.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuitCounts {
    /// 턴이 도는 대화 수.
    pub running: usize,
    /// 대기 중인 말 수 — 대기 줄은 메모리에만 있어 앱을 끄면 사라진다.
    pub queued: usize,
    /// 답하지 않은 권한 요청 수.
    pub approvals: usize,
}

/// 호스트 명령이 실패한 까닭 — 화면에 그대로 보일 글이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostError {
    /// `work.json`이 있는 work 폴더가 없다.
    WorkNotFound(String),
    LoginShell(LoginShellError),
    /// 에이전트를 띄우는 데 드는 실행 파일을 로그인 셸의 PATH에서 찾지 못했다.
    EngineMissing { agent: Agent, missing: Vec<MissingProgram> },
    /// 대화는 섰지만 에이전트가 세션을 열지 못했다. 까닭은 그 대화의 기록에도 `session` 죽음 줄로 남는다.
    Open { conversation: String, reason: String },
    ConversationNotFound(String),
    /// 첫 말 뒤의 에이전트 바꾸기 — Claude와 Codex는 서로의 대화를 읽지 못해 맥락이 끊긴다(three-axes 결정 15).
    AgentLocked(String),
    /// 에이전트가 떠 있지 않은 대화 — 보내기가 되살린 뒤에도 에이전트가 곧바로 죽었다(three-axes 티켓 10).
    NotRunning(String),
    /// 그 대화의 대기 줄에 그 대기 id의 말이 없다 — 이미 갔거나 지웠다. 대기 줄은 메모리에만 있어 다시 켠 뒤에는 늘
    /// 비어 있다.
    QueuedNotFound(String),
    /// 걸려 있지 않은 권한 요청 — 이미 답했거나 거둬졌다(멈춤 · 에이전트가 턴을 끝냄 · 에이전트가 떠 있지 않음).
    PermissionClosed { conversation: String, request: String },
    /// 그 권한 요청이 준 선택지에 없는 optionId. 요청은 그대로 걸려 있다.
    PermissionOption { request: String, option: String },
    /// 로그인을 기다리는 대화 — 에이전트가 `-32000`으로 답했다. 로그인이 「됨」으로 바뀌면 호스트가 다시 띄운다
    /// (three-axes 티켓 12).
    LoginRequired { agent: Agent, conversation: String },
    /// 에이전트에 말을 보내지 못했다(연결이 끊겼다).
    Send(String),
    /// 떠 있는 에이전트가 모드 · 설정 바꾸기를 받지 않았다(모르는 값 · 답 없음 · 연결이 끊김). 아무것도 남지 않았다(티켓 09).
    Setting(String),
    /// 보낸 말의 인용이 올바르지 않다 — spec 폴더 밖을 가리키거나 줄 범위가 뒤집혔거나 글이 비었다(three-axes 티켓 27).
    BadQuote(String),
    /// `agents/`를 읽거나 쓰지 못했다.
    Record(String),
    /// 로그인 명령을 띄우지 못했다.
    Login(String),
    /// 그 id의 Thread가 없다(v1 티켓 04) — 폴더가 없거나 id의 꼴이 아니다.
    ThreadNotFound(String),
    /// 그 Agent의 정의 파일이 깨졌다(v1 구현 스펙 §6 「깨진 파일」) — 부를 수 없다. 까닭은 사람이 읽을 글이다.
    AgentBroken { handle: String, reason: String },
    /// 그 Thread에 그 handle의 참여자가 없다.
    ParticipantNotFound { thread: String, handle: String },
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
            HostError::Open { reason, .. } => write!(f, "{reason}"),
            HostError::ConversationNotFound(conversation) => write!(f, "대화를 찾을 수 없습니다: {conversation}"),
            HostError::AgentLocked(_) => write!(f, "첫 말 뒤에는 에이전트를 바꿀 수 없어요. 다른 에이전트는 +로 열어요"),
            HostError::NotRunning(conversation) => write!(f, "에이전트가 떠 있지 않은 대화입니다: {conversation}"),
            HostError::QueuedNotFound(_) => write!(f, "대기 중인 말을 찾을 수 없습니다. 이미 보냈거나 지운 말입니다"),
            HostError::PermissionClosed { .. } => {
                write!(f, "이미 닫힌 권한 요청입니다. 답했거나 거둬진 요청에는 답할 수 없습니다")
            }
            HostError::PermissionOption { option, .. } => write!(f, "그 권한 요청에 없는 선택지입니다: {option}"),
            HostError::LoginRequired { agent, .. } => {
                write!(f, "{} 로그인이 필요합니다. 로그인한 뒤에 보내세요", agent.display_name())
            }
            HostError::Send(reason) => write!(f, "{reason}"),
            HostError::Setting(reason) => write!(f, "에이전트가 바꾸기를 받지 않았습니다: {reason}"),
            HostError::BadQuote(reason) => write!(f, "{reason}"),
            HostError::Record(reason) => write!(f, "{reason}"),
            HostError::Login(reason) => write!(f, "{reason}"),
            HostError::ThreadNotFound(thread) => write!(f, "Thread를 찾을 수 없습니다: {thread}"),
            HostError::AgentBroken { handle, reason } => write!(f, "@{handle}의 정의 파일을 읽지 못했습니다: {reason}"),
            HostError::ParticipantNotFound { thread, handle } => write!(f, "Thread {thread}에 @{handle}이 없습니다"),
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
            open_limit: None,
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
        let programs = find_programs(agent, &env)?;
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

    /// 로그인을 기다리던 대화 하나를 다시 띄운다 — 같은 기록 파일에 이어 적고, 되살리기(티켓 10)의 길(resume → load → 새
    /// 세션)로 연다. 새 세션으로 끝나면 그 첫 말에 머리말이 다시 붙는다(S11).
    ///
    /// - 에이전트가 떠 있으면(턴 도중의 `-32000`) 끄고 새로 띄운다 — 떠 있는 에이전트가 새 로그인을 읽는다는 보장이 없다.
    /// - work가 사라졌거나 대화가 닫혔으면 아무것도 하지 않는다.
    /// - 대기 줄은 다시 뜬 대화가 그대로 이어 쥐고, 로그인이라는 걸림이 풀린 이 자리에서 맨 앞부터 간다(S13, 티켓 07).
    fn relaunch(&self, waiting: &Waiting) -> Result<(), HostError> {
        let (work, conversation) = match &waiting.waiter {
            Waiter::Conversation { work, conversation } => (work, conversation),
            Waiter::Thread { thread, handle } => return self.relaunch_session(thread, handle),
        };
        // 호스트가 쥐었던 대화라 id를 다시 검사하지 않는다.
        let key = ConversationKey { work, id: conversation };
        let Ok(work_at) = self.open_work(key.work) else { return Ok(()) };
        match work_at.open_row(key.id) {
            Ok(_) => {}
            Err(HostError::ConversationNotFound(_)) => return Ok(()),
            Err(error) => return Err(error),
        }
        self.revive(key, Revive::EvenIfRunning)?;
        // 표의 잠금은 놓고 보낸다 — 맨 앞의 턴 앞을 찍느라 spec 폴더를 걷는 동안 다른 대화의 명령을 막지 않게(S2).
        if let Some(conv) = self.find_live(key) {
            if let Some(mut state) = conv.lock_found() {
                conv.seat(&mut state).resume();
            }
        }
        Ok(())
    }

    /// 떠 있지 않거나 죽은 대화를 띄워 되살린다(three-axes 티켓 10) — 다시 켠 뒤의 대화와 죽은 대화는 말을 보낼 때 띄운다(S8 ·
    /// three-axes 결정 19). 로그인이 「됨」으로 바뀐 뒤의 다시 띄우기(12)도 이 길이다(`Revive::EvenIfRunning`).
    ///
    /// - 대화를 만들 때 정한 자리(`agents.json`의 cwd · 함께 여는 폴더)에서 연다(three-axes 결정 17) — work에 프로젝트가 나중에 붙어도
    ///   있던 대화는 그 자리에서 이어진다(스토리 110).
    /// - `agents.json`의 에이전트 쪽 세션 id로 resume → load → 새 세션 순이다. 열림 줄이 그 길(resumed · loaded · fresh)을
    ///   말하고, 새 세션으로 끝나면 다음 첫 말에 머리말이 다시 붙는다(S11).
    /// - Codex에는 `agents.json`의 모델 · 모드 · 계획을 `set_*`로 다시 넣는다(three-axes 결정 27, [`Self::open_agent`]).
    /// - 떠 있던(죽은) 대화는 기록기와 대기 줄을 그대로 이어 쓴다 — 기록의 seq가 한 셈이고, 대기 줄은 죽어도 그대로다(S13).
    ///   다시 뜨지 못하면(로그인이 또 필요하거나 못 열었으면) 대기 줄은 사라진다 — 떠 있는 대화의 메모리에만 있으므로. 화면이
    ///   옛 줄을 붙들지 않게 빈 대기 줄을 알린다.
    ///
    /// 막히는 호출이다 — 세션이 열릴 때까지 기다린다. 대화마다 하나씩 돈다 — 앞선 것이 되살렸으면 아무것도 하지 않는다.
    fn revive(&self, key: ConversationKey, when: Revive) -> Result<(), HostError> {
        let gate = self.revival_gate(key.id);
        let _one_at_a_time = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if when == Revive::IfNotRunning && self.is_running(key) {
            return Ok(());
        }
        let work_at = self.open_work(key.work)?;
        let mut row = work_at.open_row(key.id)?;
        let env = self.login_env(false)?;
        let programs = find_programs(row.agent, &env)?;
        let conv = match self.take_live(key) {
            Some(mut live) => {
                shut_down_together(std::slice::from_mut(&mut live));
                live.conv
            }
            None => self.live_conv(&work_at, key, row.agent)?,
        };
        let queued = conv.lock_state().order.queued() > 0;
        let opened = self.open_agent(key.work, &work_at.places, &mut row, conv, &env, &programs);
        if queued && self.find_live(key).is_none() {
            (self.emit)(HostEvent::Queue { work: key.work.to_owned(), conversation: key.id.to_owned(), queue: Vec::new() });
        }
        opened.map(|_| ())
    }

    /// 그 대화의 띄우기 잠금.
    fn revival_gate(&self, conversation: &str) -> Arc<Mutex<()>> {
        let mut gates = self.revivals.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        Arc::clone(gates.entry(conversation.to_owned()).or_default())
    }

    /// 그 대화의 에이전트가 떠 있고 살아 있나 — 아니면 보내기가 먼저 되살린다.
    fn is_running(&self, key: ConversationKey) -> bool {
        self.find_live(key).is_some_and(|conv| conv.lock_found().is_some_and(|state| state.is_up()))
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
        let work_at = self.open_work(work)?;
        let rows: Vec<ConversationRow> = work_at.rows()?.into_iter().filter(|row| row.closed_at.is_none()).collect();
        // 표의 잠금 안에서는 떠 있는 대화를 모으기만 한다 — 쉬는 대화의 기록 파일을 읽고 떠 있는 대화의 잠금을 기다리는 것은
        // 놓은 뒤다. 턴 끝이 spec 폴더를 걷느라 한 대화의 잠금을 쥐고 있어도 다른 대화의 명령이 표에서 막히지 않게(S2).
        let found: Vec<Option<Arc<Conv>>> = {
            let live = self.lock_live();
            rows.iter().map(|row| live.get(&row.id).filter(|live| live.work == work).map(|live| Arc::clone(&live.conv))).collect()
        };
        Ok(rows.iter().zip(found).map(|(row, conv)| summarize(conv.as_deref(), &work_at.places.agents, row)).collect())
    }

    /// 기록 읽기 — 그 대화의 기록에서 `after` 다음 seq의 줄들을 준다. 화면은 이것으로 그리고, 그 뒤는 기록 줄
    /// 이벤트로 잇는다(앱을 다시 켠 뒤 · 다른 work에서 돌아온 뒤). 끝에 줄바꿈이 없는 꼬리(반쪽 줄)는 버린다.
    ///
    /// 읽기만 한다 — 에이전트를 띄우지 않고, 아무것도 만들지 않는다.
    pub fn read_record(&self, work: &str, conversation: &str, after: u64) -> Result<Vec<RecordLine>, HostError> {
        let work_at = self.open_work(work)?;
        let key = ConversationKey::new(work, conversation)?;
        let path = records::record_path(&work_at.places.agents, key.id);
        records::read_lines(&path, after).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => HostError::ConversationNotFound(conversation.to_owned()),
            _ => HostError::Record(format!("기록을 읽지 못했습니다: {} — {error}", path.display())),
        })
    }

    /// 새 대화 — 설정 「대화」의 그 엔진 기본값(모델 · 모드)으로 만들고 곧바로 띄워 세션을 연다(S8 · three-axes 결정 16 · 티켓
    /// 25). [`Self::new_conversation_with`]에 데이터 루트의 `settings.json`에서 읽은 기본값을 준 것이다.
    ///
    /// - 설정은 부를 때마다 다시 읽는다 — 바꾼 설정은 다음 새 대화부터 들고, 이미 열린 대화는 그대로다(스토리 113).
    /// - 비어 있는 칸은 엔진 기본값이다. 설정 파일이 없거나 깨졌어도 엔진 기본값으로 연다. 호스트는 설정 파일을 쓰지 않는다.
    pub fn new_conversation(&self, work: &str, agent: Agent) -> Result<Conversation, HostError> {
        self.new_conversation_with(work, agent, chat_settings::conversation_defaults(&self.data_root, agent))
    }

    /// 새 대화 — `defaults`의 모델 · 모드로 만들고 곧바로 띄워 세션을 연다(S8). 그래서 칩 · 메뉴 · 로그인 실패가 첫 말
    /// 전에 선다. 이름은 에이전트 이름으로 저절로 붙는다(Codex · Codex 2).
    ///
    /// 막히는 호출이다 — 세션이 열릴 때까지(한도 Codex 30초 · Claude 10초) 기다린다.
    ///
    /// - work 폴더에 `work.json`이 없으면 아무것도 만들지 않고 실패한다(`agents/`도 만들지 않는다).
    /// - 에이전트를 못 찾으면 대화를 만들지 않고 실패한다 — 안내 카드가 빠진 것과 설치 명령을 보인다.
    /// - 대화를 만든 뒤 세션을 열지 못하면, 프로세스를 남김없이 끄고 기록에 까닭(`session` 죽음 줄)을 적고
    ///   실패한다. 대화는 목록에 남는다 — 다음 말에서 다시 띄운다(10).
    pub fn new_conversation_with(
        &self,
        work: &str,
        agent: Agent,
        defaults: ConversationDefaults,
    ) -> Result<Conversation, HostError> {
        let work_at = self.open_work(work)?;
        let env = self.login_env(false)?;
        let programs = find_programs(agent, &env)?;
        let place = workplace(&work_at.places, work_at.meta.projects.len());

        records::ensure_agents_dir(&work_at.places.agents).map_err(HostError::Record)?;
        let row = {
            let _file = self.lock_agents_file();
            let rows = work_at.rows()?;
            let row = ConversationRow {
                id: uuid::Uuid::new_v4().to_string(),
                agent,
                name: next_name(agent, &rows),
                cwd: place.cwd.clone(),
                additional_directories: place.additional_directories.clone(),
                agent_session_id: None,
                model: defaults.model,
                mode: defaults.mode,
                plan: None,
                created_at: records::now(),
                closed_at: None,
                extra: Default::default(),
            };
            records::write_row(&work_at.places.agents, &row).map_err(HostError::Record)?;
            row
        };
        self.start_agent(work, &work_at, row, &programs, &env)
    }

    /// 새 대화의 에이전트를 띄워 세션을 연다. 에이전트는 대화를 만들 때 정한 자리(`agents.json`의 cwd · 함께 여는 폴더)에서
    /// 일한다(three-axes 결정 17). 다시 띄우기(다시 켠 뒤 · 죽은 뒤 · 로그인 뒤)는 [`Self::revive`]다.
    ///
    /// - 열리면 에이전트 쪽 세션 id를 `agents.json`에 적고 떠 있는 표에 넣는다.
    /// - 에이전트가 로그인을 요구하면(`-32000`, 실측 A3) 기록에 로그인 필요 줄을 적고, 로그인 창구가 그 대화를 쥐고 엔진
    ///   상태(찾음 · 안 됨)를 알린다. 실패가 아니다 — 대화는 서고, 화면은 그 자리에 안내 카드를 세운다. 로그인이 「됨」으로
    ///   바뀌면 다시 띄운다.
    /// - 그 밖의 까닭으로 못 열면 프로세스를 남김없이 끈 뒤 기록에 까닭(`session` 죽음 줄)을 적고 실패한다.
    fn start_agent(
        &self,
        work: &str,
        work_at: &WorkAt,
        mut row: ConversationRow,
        programs: &[discovery::FoundProgram],
        env: &AgentEnv,
    ) -> Result<Conversation, HostError> {
        // 호스트가 방금 지은 id라 다시 검사하지 않는다.
        let conv = self.live_conv(work_at, ConversationKey { work, id: &row.id }, row.agent)?;
        self.open_agent(work, &work_at.places, &mut row, conv, env, programs)
    }

    /// 에이전트 바꾸기 — 첫 말 전에만 된다(three-axes 결정 15 · 스토리 23 · 24). 지금 프로세스를 남김없이 끄고(stdin 닫기 →
    /// 1초 → 그룹째 SIGKILL) 같은 대화를 새 엔진으로 띄워 세션을 연다. 막히는 호출이다 — 끄기와 세션 열기를 기다린다.
    ///
    /// - 첫 말 뒤에는 거절한다 — Claude와 Codex는 서로의 대화를 읽지 못해 맥락이 끊긴다. 다른 에이전트는 `+`로 연다.
    ///   거절은 돌던 에이전트를 건드리지 않는다.
    /// - 이름은 새 에이전트 이름으로 다시 붙고(Codex → Claude), 모델 · 모드 · 계획은 비운다 — 엔진마다 목록이 다르다.
    /// - 기록에 사람이 바꾼 에이전트(`config` 줄)를 적고, 이어 새 엔진의 띄우는 중 · 열림이 선다.
    /// - 새 엔진을 못 찾으면 아무것도 바꾸지 않고 실패한다. 새 엔진이 세션을 열지 못하면 대화는 새 엔진으로 남는다 —
    ///   다음 말에서 다시 띄운다(10).
    pub fn switch_agent(&self, work: &str, conversation: &str, agent: Agent) -> Result<Conversation, HostError> {
        let key = ConversationKey::new(work, conversation)?;
        // 그 대화의 띄우기를 쥐고 바꾼다 — 바꾸는 동안 대화는 떠 있는 표에 없어, 그사이 온 보내기는 되살리기로 간다. 이 문을
        // 쥐지 않으면 되살리기가 아직 옛 엔진인 `agents.json` 줄로 엔진을 하나 더 띄운다. 쥐면 그 보내기는 바꾸기가 끝난 뒤 새
        // 엔진이 떠 있음을 보고 그 엔진에 보낸다. 되살리는 중이면 그 끝을 기다린다. 잠금 차례의 맨 바깥이다(되살리기 · 설정 바꾸기 ·
        // 닫기와 같다).
        let gate = self.revival_gate(conversation);
        let _one_at_a_time = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let work_at = self.open_work(work)?;
        let mut row = work_at.open_row(conversation)?;

        // 떠 있는 표에서 먼저 꺼낸다 — 꺼낸 뒤로는 보내기가 이 대화에 닿지 않아(먼저 찾아 둔 보내기도 대화의 잠금에서 물러난다),
        // 첫 말을 확인하는 사이에 말이 끼지 못한다. 바꾸지 않고 돌아갈 때는 그대로 되돌려 둔다.
        let live = self.take_live(key);
        let put_back = |live: Option<Live>| {
            if let Some(live) = live {
                self.put_live(conversation.to_owned(), live);
            }
        };
        let record = records::facts(&work_at.places.agents, conversation);
        if record.sent() {
            put_back(live);
            return Err(HostError::AgentLocked(conversation.to_owned()));
        }
        if row.agent == agent {
            let (last_seq, queue, up) = match &live {
                Some(live) => {
                    let state = live.conv.lock_state();
                    (live.conv.recorder.last_seq(), state.order.queue(), state.is_up())
                }
                None => (record.last_seq(), Vec::new(), false),
            };
            put_back(live);
            return Ok(summary(&row, last_seq, queue, up));
        }
        let found = self.login_env(false).map_err(HostError::from).and_then(|env| Ok((find_programs(agent, &env)?, env)));
        let (programs, env) = match found {
            Ok(found) => found,
            Err(error) => {
                put_back(live);
                return Err(error);
            }
        };
        // 옛 엔진의 로그인을 기다리던 대화였어도(12) 더는 그 엔진을 쓰지 않는다 — 그 로그인이 「됨」이 돼도 다시 띄우지 않고,
        // 보내기가 옛 엔진의 로그인 필요로 거절되지 않는다. 새 엔진이 로그인을 요구하면 열기가 새 엔진으로 다시 쥔다.
        self.logins.forget(&key.waiter());
        let conv = match live {
            Some(mut live) => {
                shut_down_together(std::slice::from_mut(&mut live));
                live.conv
            }
            None => self.live_conv(&work_at, key, agent)?,
        };
        // 떠 있던 대화는 기록기를 그대로 쓴다 — 옛 런타임이 끈 뒤에 늦게 넘기는 줄(stderr 꼬리)이 같은 seq 셈에 선다. 턴
        // 도중의 로그인 필요(12)는 새 엔진의 것으로 쥐게 한다.
        if let Some(watch) = &conv.login {
            watch.switch_to(agent);
        }
        conv.recorder.config(json!({"agent": agent})).map_err(HostError::Record)?;
        {
            let _file = self.lock_agents_file();
            let others: Vec<ConversationRow> =
                work_at.rows()?.into_iter().filter(|other| other.id != conversation).collect();
            row.agent = agent;
            row.name = next_name(agent, &others);
            row.model = None;
            row.mode = None;
            row.plan = None;
            row.agent_session_id = None;
            records::write_row(&work_at.places.agents, &row).map_err(HostError::Record)?;
        }
        // 새 엔진의 새 세션이다 — 옛 프로세스가 죽어 있었어도 다시 산 것으로 보고, 첫 말에 머리말을 붙인다(S11). 대기 줄은
        // 비어 있다 — 말은 턴이 도는 동안에만 대기 줄에 들고, 턴은 첫 말이 연다(첫 말 뒤에는 위에서 거절했다).
        // 표에 다시 들 때까지는 꺼낸 대화다 — 옛 엔진에 쥐여 기다리던 명령이 새 엔진에 닿지 않게.
        {
            let mut state = conv.lock_state();
            *state = ConvState { taken: state.taken, ..ConvState::fresh() };
        }
        self.open_agent(work, &work_at.places, &mut row, conv, &env, &programs)
    }

    /// 대화의 에이전트를 띄워 세션을 열고, 떠 있는 표에 넣는다. 열리면 에이전트 쪽 세션 id를 `agents.json`에 적는다.
    /// 열지 못하면 기록에 죽음 줄을 적고 실패한다 — 대화는 목록에 남는다.
    fn open_agent(
        &self,
        work: &str,
        places: &atelier_core::WorkPlaces,
        row: &mut ConversationRow,
        conv: Arc<Conv>,
        env: &AgentEnv,
        programs: &[discovery::FoundProgram],
    ) -> Result<Conversation, HostError> {
        let recorder = &conv.recorder;
        recorder.session(SessionState::Spawning).map_err(HostError::Record)?;
        let place = SessionPlace { cwd: row.cwd.clone(), additional_directories: row.additional_directories.clone() };
        let (launch, mut terms) = match row.agent {
            Agent::Codex => (codex_launch(programs, env, &place), OpenTerms::default()),
            Agent::Claude => claude_launch(&self.translator, programs, env, &place, &ClaudeChoice::of_row(row)),
        };
        // 에이전트 쪽 세션 id가 있으면 되살린다 — 다시 켠 뒤 · 죽은 뒤 · 로그인 뒤(티켓 10). 새 대화와 에이전트 바꾸기는 id가
        // 비어 곧바로 새 세션이다.
        terms.revive = row.agent_session_id.clone();
        let limit = self.open_limit.unwrap_or(match row.agent {
            Agent::Codex => CODEX_OPEN_LIMIT,
            Agent::Claude => CLAUDE_OPEN_LIMIT,
        });
        let opened = runtime::open(launch, place, terms, limit, conv.sink(), record_opened(&conv, row.agent));
        let (agent_process, opened) = match opened {
            Ok(opened) => opened,
            Err(OpenError::AuthRequired { .. }) => {
                recorder.session(SessionState::LoginRequired).map_err(HostError::Record)?;
                self.logins.login_required(row.agent, Waiter::Conversation { work: work.to_owned(), conversation: row.id.clone() });
                return Ok(summary(row, recorder.last_seq(), Vec::new(), false));
            }
            Err(error) => {
                let reason = error.to_string();
                recorder
                    .session(SessionState::Died { reason: reason.clone(), stderr_tail: Vec::new() })
                    .map_err(HostError::Record)?;
                return Err(HostError::Open { conversation: row.id.clone(), reason });
            }
        };

        let turns = agent_process.turns();
        if row.agent == Agent::Codex {
            if let Some(turns) = &turns {
                reapply_settings(turns, row);
            }
        }
        // 에이전트 쪽 세션의 첫 말이면 머리말을 붙인다(S11) — 새로 선 세션이거나, 되살린 세션이 아직 말을 받은 적이 없다.
        let needs_preamble =
            opened.how.starts_session() || !records::facts(&places.agents, &row.id).sent_since_session_start();
        {
            // 대기 줄은 그대로 둔다 — 죽은 대화의 대기 줄은 되살린 대화가 이어 쥔다(S13).
            let mut state = conv.lock_state();
            state.order.opened(needs_preamble);
            state.turns = turns;
        }
        // S16 — 세션이 열릴 때마다 그 엔진의 목록을 덮어 쓴다. 못 써도 대화는 연다: 설정 쪽의 목록이 낡을 뿐이다.
        {
            let _file = self.lock_engines_file();
            if let Err(error) = engines::write(&self.data_root, row.agent, &EngineLists::of_session(&opened.session)) {
                eprintln!("{error}");
            }
        }
        row.agent_session_id = Some(opened.session_id.clone());
        {
            let _file = self.lock_agents_file();
            records::write_row(&places.agents, row).map_err(HostError::Record)?;
        }

        let conversation = summary(row, recorder.last_seq(), Vec::new(), true);
        self.put_live(row.id.clone(), Live { work: work.to_owned(), agent: agent_process, conv });
        Ok(conversation)
    }

    fn vanish_watch(&self, works: &Path, work: &str, conversation: &str) -> VanishWatch {
        VanishWatch {
            works: works.to_path_buf(),
            work: work.to_owned(),
            conversation: conversation.to_owned(),
            live: Arc::downgrade(&self.live),
        }
    }

    fn login_watch(&self, agent: Agent, waiter: Waiter) -> LoginWatch {
        LoginWatch { agent: Mutex::new(agent), waiter, desk: Arc::clone(&self.logins) }
    }

    /// 보내기 — 턴이 쉬면 말을 보낸다. 기다리지 않는다: 답은 기록 줄 이벤트로 흐르고, 턴 끝도 `turn-end` 줄로
    /// 온다. 에이전트가 말을 받지 않으면(오류로 답하면) 그 까닭이 `turn-end` 줄에 실리고 대화는 산다.
    ///
    /// - 에이전트 쪽 세션의 첫 말이면 머리말(work slug · 제목 · specDir)을 따로 된 텍스트 블록으로 앞에 붙인다
    ///   (S11, three-axes 결정 23). 화면에는 `sent`의 글만 보이고, 기록에는 보낸 블록이 다 남는다.
    /// - 보내기 직전에 spec 폴더를 찍는다. 턴이 끝나면 지금과 견주어 고친 곳(`changes` 줄)을 적는다(three-axes
    ///   결정 22).
    /// - 턴이 도는 동안의 말은 대기 줄 끝에 넣고 대기 줄 바뀜을 낸다(S13). 턴이 끝나면 맨 앞부터 차례로 간다.
    /// - 에이전트가 떠 있지 않은 대화(다시 켠 뒤 · 죽은 뒤)는 먼저 띄워 되살린다(three-axes 티켓 10, [`Self::revive`]) — 그래서
    ///   막히는 호출일 수 있다(세션이 열릴 때까지). 죽은 대화에 남은 대기 줄은 이 말보다 먼저 간다.
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
        let key = ConversationKey::new(work, conversation)?;
        let work_at = self.open_work(work)?;
        // 인용 블록은 지금 짓는다 — 대기 줄에 들어 턴 끝에 가는 말도 그 블록을 들고 간다(턴 끝에서는 work를 읽지 않는다).
        let quote = match quote {
            Some(quote) => Some(quote.attach(&work_at.places.spec).map_err(|bad| HostError::BadQuote(bad.to_string()))?),
            None => None,
        };
        // 떠 있는 표의 잠금도 이 대화의 잠금도 쥐기 전에 찍는다 — 폴더를 걷는 동안 다른 대화의 명령도, 이 대화의 턴 끝도
        // 막지 않게. 그 틈에 다른 대화가 고친 것은 이 턴의 비교에 든다(함께 돈 대화의 고침은 원래 든다).
        let before = Snapshot::take(&work_at.spec_place());

        // 떠 있지 않거나 죽은 대화는 먼저 띄워 되살린다(티켓 10). 로그인을 기다리는 대화는 띄우지 않는다 — 로그인이 「됨」이
        // 되면 호스트가 다시 띄운다(12).
        if !self.is_running(key) && self.logins.waiting_for(&key.waiter()).is_none() {
            self.revive(key, Revive::IfNotRunning)?;
        }

        // 찾은 뒤 대화의 잠금을 쥐기 전에 다른 명령(바꾸기 · 닫기)이 꺼냈으면 떠 있지 않은 것과 같다 — 바꾸기는 첫 말이 없음을
        // 확인한 뒤 옛 엔진을 끄는데, 그 사이에 이 말이 옛 엔진에 가면 첫 말 전에만 바꾼다(three-axes 결정 15)가 깨진다.
        let found = self.find_live(key);
        let Some((conv, mut state)) = found.as_ref().and_then(|conv| conv.lock_found().map(|state| (conv, state))) else {
            return Err(match self.logins.waiting_for(&key.waiter()) {
                Some(agent) => HostError::LoginRequired { agent, conversation: conversation.to_owned() },
                None => HostError::NotRunning(conversation.to_owned()),
            });
        };
        // 턴 도중에 로그인이 풀렸으면 거절한다 — 대화의 잠금 안에서 본다(턴 끝이 같은 잠금 안에서 쥐게 한다). S13 — 턴이 도는
        // 동안의 말은 대기 줄 끝에 들고, 턴이 끝나면 맨 앞부터 차례로 간다.
        let draft = Draft { text: text.to_owned(), preamble: work_at.preamble(), quote };
        conv.seat(&mut state).say(draft, before).map_err(|refused| refused.into_host(conversation))
    }

    /// 멈추기 — 도는 턴에 `session/cancel`을 보낸다. 기다리지 않는다: 턴 끝(`cancelled`)은 `turn-end` 줄로 오고, 그
    /// 줄에 「우리가 멈췄나」(`cancelledByUs`)가 true로 실린다. 같은 세션이 다음 말을 받는다(스토리 53 · 54).
    ///
    /// - 에이전트가 스스로 이어 간 턴(S4)도 멈춘다 — 그 턴 밖 끝 줄에 「우리가 멈췄나」가 실린다.
    /// - 도는 턴이 없으면(쉬는 대화 · 죽은 대화 · 떠 있지 않은 대화) 아무 일도 하지 않는다 — 멈추기 단추와 턴 끝이
    ///   엇갈려도 읽히는 오류가 나지 않는다.
    /// - 대기 줄은 거두지 않는다 — 멈춘 턴이 끝나면 다른 턴 끝처럼 맨 앞이 간다(S13). 보내지 않을 말은 먼저 지운다.
    pub fn stop(&self, work: &str, conversation: &str) -> Result<(), HostError> {
        let key = ConversationKey::new(work, conversation)?;
        let Some(conv) = self.find_live(key) else { return Ok(()) };
        let Some(mut state) = conv.lock_found() else { return Ok(()) };
        conv.seat(&mut state).stop().map_err(|refused| refused.into_host(conversation))
    }

    /// 권한 답 — 걸린 권한 요청(`request` — 요청 id)에 고른 선택지(`option` — optionId)로 답한다. 기다리지 않는다: 고른
    /// optionId는 그 요청의 답으로 `permission` 줄에 적히고, 답을 받은 에이전트가 이어 가는 턴은 기록 줄로 온다(스토리 57 · 59).
    ///
    /// - 준 선택지에 없는 optionId는 읽히는 오류이고, 요청은 그대로 걸려 있다 — 맞는 답을 다시 줄 수 있다.
    /// - 이미 닫힌 요청(답했다 · 멈춰서 거둬졌다 · 에이전트가 턴을 끝내 거둬졌다 · 에이전트가 떠 있지 않다)도 읽히는 오류다.
    /// - 걸림이 풀리는 자리다 — 턴이 쉬는데 대기 줄이 남아 있으면 맨 앞을 보낸다(S13). 턴 도중의 답이면 턴 끝이 보낸다.
    pub fn answer_permission(&self, work: &str, conversation: &str, request: &str, option: &str) -> Result<(), HostError> {
        let key = ConversationKey::new(work, conversation)?;
        let closed = || HostError::PermissionClosed { conversation: conversation.to_owned(), request: request.to_owned() };
        // 표의 잠금은 놓고 답한다 — 걸림이 풀려 대기 줄의 맨 앞을 보내면 그 턴 앞을 찍느라 spec 폴더를 걷는데, 그동안 다른
        // 대화의 명령을 막지 않게(S2).
        let conv = self.find_live(key).ok_or_else(closed)?;
        let mut state = conv.lock_found().ok_or_else(closed)?;
        conv.seat(&mut state).answer(request, option).map_err(|refused| refused.into_host(conversation))
    }

    /// 대기 고치기 — 대기 줄에서 그 대기 id의 말의 글을 바꾸고 대기 줄 바뀜을 낸다. 대기 id와 차례는 그대로다
    /// (스토리 50). 이미 갔거나 지운 말이면 읽히는 오류다.
    pub fn edit_queued(&self, work: &str, conversation: &str, queued: &str, text: &str) -> Result<(), HostError> {
        let key = ConversationKey::new(work, conversation)?;
        let not_found = || HostError::QueuedNotFound(queued.to_owned());
        let conv = self.find_live(key).ok_or_else(not_found)?;
        let mut state = conv.lock_found().ok_or_else(not_found)?;
        conv.seat(&mut state).edit(queued, text).map_err(|refused| refused.into_host(conversation))
    }

    /// 대기 지우기 — 대기 줄에서 그 대기 id의 말을 빼고 대기 줄 바뀜을 낸다(스토리 50). 이미 갔거나 지운 말이면
    /// 읽히는 오류다.
    pub fn delete_queued(&self, work: &str, conversation: &str, queued: &str) -> Result<(), HostError> {
        let key = ConversationKey::new(work, conversation)?;
        let not_found = || HostError::QueuedNotFound(queued.to_owned());
        let conv = self.find_live(key).ok_or_else(not_found)?;
        let mut state = conv.lock_found().ok_or_else(not_found)?;
        conv.seat(&mut state).delete(queued).map_err(|refused| refused.into_host(conversation))
    }

    /// 지금 보내기 — 대기 줄의 그 말을 맨 앞으로 옮겨 「지금 보내기」로 세우고(대기 줄 바뀜), 도는 턴을 멈춘다
    /// (`session/cancel`). 턴이 `cancelled`로 끝나면 턴 끝이 맨 앞의 그 말을 보낸다 — `sent` 줄의 「지금 보내기였는지」
    /// (`sendNow`)가 true다. 나머지 대기 줄은 그 뒤 차례로 간다(스토리 52, three-axes 결정 20).
    ///
    /// 기다리지 않는다 — 멈춤도 그 말도 기록 줄로 온다. 에이전트가 cancel을 받고도 턴을 끝내지 않으면 그 말은 맨 앞에서
    /// 턴 끝을 기다린다.
    ///
    /// - 「지금 보내기」를 기다리는 말은 하나뿐이다. 다른 말을 고르면 앞서 고른 말은 보통 대기 말로 돌아간다.
    /// - 이미 갔거나 지운 말이면 읽히는 오류이고 멈추지 않는다. 로그인을 기다리는 대화(12)도 읽히는 오류다.
    /// - 에이전트가 죽은 대화면 보내기처럼 먼저 띄워 되살린 뒤 그 말을 곧바로 보낸다(티켓 10) — 막히는 호출일 수 있다.
    pub fn send_now(&self, work: &str, conversation: &str, queued: &str) -> Result<(), HostError> {
        let key = ConversationKey::new(work, conversation)?;
        let dead_with_it = self.find_live(key).is_some_and(|conv| {
            conv.lock_found().is_some_and(|state| !state.is_up() && state.order.contains(queued))
        });
        if dead_with_it && self.logins.waiting_for(&key.waiter()).is_none() {
            self.revive(key, Revive::IfNotRunning)?;
        }
        // 대화의 잠금을 쥔 채 고른다 — 턴 끝이 맨 앞을 꺼내 보내는 것과 엇갈리지 않는다. 표의 잠금은 쥐지 않는다 — 맨 앞을 곧바로
        // 보내며 spec 폴더를 걷는 동안 다른 대화의 명령을 막지 않게(S2). 떠 있지 않은 대화의 대기 줄은 늘 비어 있다.
        let not_found = || HostError::QueuedNotFound(queued.to_owned());
        let conv = self.find_live(key).ok_or_else(not_found)?;
        let mut state = conv.lock_found().ok_or_else(not_found)?;
        conv.seat(&mut state).send_now(queued).map_err(|refused| refused.into_host(conversation))
    }

    /// 모델 바꾸기 — 그 대화의 모델을 바꾼다(`session/set_config_option{configId: "model"}`). 값은 그 대화의 것이고 설정의
    /// 기본값은 그대로다(스토리 31 · 32). 규칙은 [`ConversationHost::set_mode`]와 같다.
    pub fn set_model(&self, work: &str, conversation: &str, model: &str) -> Result<Conversation, HostError> {
        self.change_setting(work, conversation, Setting::Model(model.to_owned()))
    }

    /// 모드 바꾸기 — 그 대화의 모드를 엔진이 낸 목록의 id로 바꾼다(`session/set_mode`, three-axes 결정 16 · 27).
    ///
    /// - `agents.json`의 그 대화 줄에 남는다. 설정 파일의 기본값은 건드리지 않는다.
    /// - 에이전트가 떠 있으면 곧바로 엔진에 넣고 답을 기다린다 — 다음 턴부터 든다. 알림이 없으므로 값은 호스트가 쥔다.
    ///   넣은 바꾸기는 기록에 `config` 줄로 적힌다. 엔진이 거절하면 아무것도 남기지 않고 그 까닭을 돌려준다.
    /// - 띄우지 않은 대화(다시 켠 뒤 · 죽은 뒤 · 세션을 열다 로그인을 요구받은 대화)는 `agents.json`에만 남기고 띄우지 않는다. 띄울 때
    ///   넣는다(티켓 10). 되살리는 중인 대화는 그 끝을 기다렸다가 떠 있는 엔진에 넣는다.
    /// - 닫은 대화는 바꾸지 않는다.
    ///
    /// 막히는 호출이다 — 엔진의 답을 기다린다(한도 10초, 보통 몇 ms). 되살리는 중이면 세션이 열릴 때까지도 기다린다.
    pub fn set_mode(&self, work: &str, conversation: &str, mode: &str) -> Result<Conversation, HostError> {
        self.change_setting(work, conversation, Setting::Mode(mode.to_owned()))
    }

    /// 계획 켜고 끄기 — Codex의 「계획」 토글이다(`session/set_config_option{configId: "collaboration_mode"}`의 `plan` ·
    /// `default`, three-axes 결정 29). 모드와 따로 있는 설정이다. 규칙은 [`ConversationHost::set_mode`]와 같다.
    pub fn set_plan(&self, work: &str, conversation: &str, plan: bool) -> Result<Conversation, HostError> {
        self.change_setting(work, conversation, Setting::Plan(plan))
    }

    fn change_setting(&self, work: &str, conversation: &str, setting: Setting) -> Result<Conversation, HostError> {
        let key = ConversationKey::new(work, conversation)?;
        // 되살리는 중이면 그 끝을 기다린다 — 되살리기는 시작할 때 읽은 줄로 엔진에 설정을 다시 넣고 `agents.json`을 다시 쓰므로, 그
        // 사이에 `agents.json`에만 쓴 바꾸기는 지워지고 엔진에도 들지 않는다(티켓 09 · 10). 되살린 뒤면 떠 있는 엔진에 곧바로 넣는다.
        let gate = self.revival_gate(conversation);
        let _not_while_reviving = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let work_at = self.open_work(work)?;
        work_at.open_row(conversation)?;

        // 에이전트가 떠 있으면 엔진에 먼저 넣는다 — 대화들의 잠금은 놓고 기다린다(턴 끝이 그 잠금을 쥔다).
        let running: Option<(Arc<Conv>, runtime::Turns)> = self.find_live(key).and_then(|conv| {
            let turns = {
                let state = conv.lock_found()?;
                state.turns.clone().filter(|_| state.order.alive())
            }?;
            Some((conv, turns))
        });
        let _one_at_a_time = running.as_ref().map(|(conv, _)| conv.setting.lock().unwrap_or_else(|p| p.into_inner()));
        if let Some((_, turns)) = &running {
            let (method, fields) = setting.request();
            turns.change(method, fields, SETTING_LIMIT).map_err(HostError::Setting)?;
        }
        let row = {
            let _file = self.lock_agents_file();
            let mut row = work_at.open_row(conversation)?;
            setting.apply(&mut row);
            records::write_row(&work_at.places.agents, &row).map_err(HostError::Record)?;
            row
        };
        if let Some((conv, _)) = &running {
            conv.recorder.config(setting.changed()).map_err(HostError::Record)?;
        }
        Ok(summarize(self.find_live(key).as_deref(), &work_at.places.agents, &row))
    }

    /// 엔진 목록 — 그 엔진의 세션이 마지막으로 열릴 때 본 모델 · 모드 목록(S16). 설정 「대화」 쪽이 새 대화의 기본값 목록으로
    /// 쓴다. 세션을 한 번도 연 적 없는 엔진은 빈 목록이다. 읽기만 한다 — 에이전트를 띄우지 않는다.
    pub fn engine_lists(&self, agent: Agent) -> EngineLists {
        engines::read(&self.data_root, agent)
    }

    /// 대화 닫기 — 그 에이전트의 프로세스를 남김없이 끄고(stdin 닫기 → 1초 → 그룹째 SIGKILL), 기록에 `session`
    /// 닫힘 줄을, `agents.json`에 닫은 때를 적는다. 줄은 남기고(S14) 기록 파일도 남긴다 — 평가의 재료다.
    ///
    /// 막히는 호출이다 — 끄기가 최대 1초 남짓 걸린다. 이미 닫은 대화를 다시 닫으면 아무 일도 하지 않는다.
    pub fn close_conversation(&self, work: &str, conversation: &str) -> Result<(), HostError> {
        let key = ConversationKey::new(work, conversation)?;
        // 되살리는 중이면 그 끝을 기다린다 — 닫은 대화가 되살아나 떠 있는 표에 서지 않게(티켓 10).
        let gate = self.revival_gate(conversation);
        let _one_at_a_time = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut live = self.take_live(key);
        if let Some(live) = live.as_mut() {
            shut_down_together(std::slice::from_mut(live));
        }
        // 닫은 대화는 로그인이 「됨」이 돼도 다시 띄우지 않는다.
        self.logins.forget(&key.waiter());

        let Ok(work_at) = self.open_work(work) else {
            // work 폴더가 사라졌다(아카이브 · 삭제). 끈 것으로 끝낸다 — 열어 둔 기록 파일은 옮겨진 자리를 따라가지만,
            // 사라진 자리의 `agents.json`은 다시 만들지 않는다(S10).
            return match live {
                Some(live) => live.conv.recorder.session(SessionState::Closed { cause: None }).map_err(HostError::Record),
                None => Err(HostError::WorkNotFound(work.to_owned())),
            };
        };
        let _file = self.lock_agents_file();
        let Some(mut row) = work_at.rows()?.into_iter().find(|row| row.id == conversation) else {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        };
        if row.closed_at.is_some() && live.is_none() {
            return Ok(());
        }
        let conv = match live {
            Some(live) => live.conv,
            // 닫힘 줄만 적으려고 연다 — 턴이 돌지 않으므로 지켜볼 것이 없다.
            None => Conv::new(
                Recorder::open(&work_at.places.agents, work, conversation, Arc::clone(&self.emit))
                    .map_err(HostError::Record)?,
                Some(work_at.spec_place()),
                None,
                None,
            ),
        };
        conv.recorder.session(SessionState::Closed { cause: None }).map_err(HostError::Record)?;
        row.closed_at = Some(records::now());
        records::write_row(&work_at.places.agents, &row).map_err(HostError::Record)
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
        retire_vanished(&self.live, |_, live| vanished.contains(&live.work) && !live.conv.lock_state().order.turning());
    }

    /// 앱 종료 확인 창의 셈(three-axes 티켓 23 · S13) — 떠 있는 대화 모두에서 턴이 도는 대화 · 대기 중인 말 · 답하지 않은
    /// 권한 요청을 센다. 셈의 원천이 화면이 아니라 여기인 것은, 대기 줄이 이 메모리에만 있고 지금 화면이 열지 않은 work의
    /// 대화도 함께 꺼지기 때문이다. 떠 있지 않은 대화(다시 켠 뒤 · 닫은 대화)는 셀 것이 없다. 기다리지 않는다.
    ///
    /// 에이전트가 스스로 이어 간 턴(three-axes 티켓 16 · S4)도 「턴이 도는 대화」다 — 끄면 그 턴도 잃는다.
    ///
    /// Thread의 Session도 센다(v1 구현 스펙 S40) — 앱을 끄면 함께 꺼진다.
    pub fn quit_counts(&self) -> QuitCounts {
        let mut counts = QuitCounts::default();
        let mut count = |conv: &Conv| {
            let state = conv.lock_state();
            counts.running += usize::from(state.order.turning());
            counts.queued += state.order.queued();
            counts.approvals += state.turns.as_ref().map_or(0, Turns::pending_permissions);
        };
        for conversation in self.lock_live().values() {
            count(&conversation.conv);
        }
        for conv in self.threads.live_convs() {
            count(&conv);
        }
        counts
    }

    /// 호스트 끄기 — 모든 대화의 프로세스 그룹을 끈다(앱 종료). 대화를 닫지는 않는다: `agents.json`과 기록은
    /// 그대로이고, 앱을 다시 켜면 말을 보낼 때 되살린다(three-axes 결정 19).
    ///
    /// 모든 대화의 stdin을 **한꺼번에** 닫고 1초를 **한 번만** 기다린 뒤 그룹들을 SIGKILL한다 — 대화마다 1초씩
    /// 줄을 세우면 N초가 된다.
    ///
    /// Thread의 Session도 같은 1초 안에 함께 끈다(v1 티켓 04).
    pub fn shut_down(&self) {
        // 로그인 명령도 끈다 — SIGTERM을 먼저 보내 두고, 대화들을 끄는 1초 뒤에 남은 것을 SIGKILL한다.
        self.logins.begin_close();
        let mut live: Vec<Live> = self.lock_live().drain().map(|(_, live)| live).collect();
        let mut sessions = self.threads.drain_sessions();
        mark_taken(live.iter().map(|live| &*live.conv).chain(sessions.iter().map(|session| &*session.conv)));
        end_together(
            live.iter_mut()
                .map(|live| (&mut live.agent, &*live.conv))
                .chain(sessions.iter_mut().map(|session| (&mut session.agent, &*session.conv)))
                .collect(),
        );
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

    /// 그 work의 자리들(S5) — `works/`에서 `work.json`을 읽고 폴더 자리를 셈한다. `work.json`이 없거나 읽지 못하면 그 work는
    /// 없다.
    fn open_work(&self, work: &str) -> Result<WorkAt, HostError> {
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        let places = atelier_core::work_places(&works, &meta);
        Ok(WorkAt { works, meta, places })
    }

    /// 떠 있을 대화 — 기록을 이어 열고, 턴 끝에 work가 사라졌는지 보고(S10), 턴 도중의 로그인 요구를 창구에 쥐게 한다
    /// (three-axes 티켓 12).
    fn live_conv(&self, work_at: &WorkAt, key: ConversationKey, agent: Agent) -> Result<Arc<Conv>, HostError> {
        Ok(Conv::new(
            Recorder::open(&work_at.places.agents, key.work, key.id, Arc::clone(&self.emit)).map_err(HostError::Record)?,
            Some(work_at.spec_place()),
            Some(self.vanish_watch(&work_at.works, key.work, key.id)),
            Some(self.login_watch(agent, key.waiter())),
        ))
    }

    /// 그 대화가 떠 있으면 그 대화 — 표의 잠금은 곧바로 놓는다(S2). 부른 쪽은 그 대화의 잠금만 쥐고 일하므로, 한 대화가 spec
    /// 폴더를 찍는 동안에도 다른 대화의 명령이 표에서 막히지 않는다. 그 잠금은 [`Conv::lock_found`]로 쥔다 — 찾은 뒤 다른 명령이
    /// 꺼냈으면 거기서 물러난다.
    fn find_live(&self, key: ConversationKey) -> Option<Arc<Conv>> {
        self.lock_live().get(key.id).filter(|live| live.work == key.work).map(|live| Arc::clone(&live.conv))
    }

    /// 그 대화가 떠 있으면 표에서 꺼낸다 — 꺼낸 대화라고 적고 돌려준다([`mark_taken`]). 꺼낸 뒤로는 어느 명령도 이 대화에 닿지
    /// 않는다: 표에서 못 찾고, 먼저 찾아 둔 명령도 대화의 잠금에서 물러난다. 되돌려 넣는 것은 [`Self::put_live`]다.
    fn take_live(&self, key: ConversationKey) -> Option<Live> {
        let taken = {
            let mut live = self.lock_live();
            match live.get(key.id) {
                Some(found) if found.work == key.work => live.remove(key.id),
                _ => None,
            }
        };
        mark_taken(taken.iter().map(|live| &*live.conv));
        taken
    }

    /// 대화를 떠 있는 표에 넣는다 — 새로 띄웠거나, 꺼냈다가 되돌린다. 꺼냄 표시를 걷은 뒤에 넣는다.
    fn put_live(&self, id: String, live: Live) {
        live.conv.lock_state().taken = false;
        self.lock_live().insert(id, live);
    }

    fn lock_live(&self) -> MutexGuard<'_, HashMap<String, Live>> {
        self.live.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_agents_file(&self) -> MutexGuard<'_, ()> {
        self.agents_file.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_engines_file(&self) -> MutexGuard<'_, ()> {
        self.engines_file.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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

/// 그 work의 자리들(S5) — 명령마다 `works/`에서 읽은 `work.json`과 그것으로 셈한 폴더 자리. [`ConversationHost::open_work`]가
/// 짓는다.
struct WorkAt {
    works: PathBuf,
    meta: atelier_core::Work,
    places: atelier_core::WorkPlaces,
}

impl WorkAt {
    /// 턴 앞뒤로 찍는 spec 폴더 — 프로젝트가 있어도 워크트리는 찍지 않는다(three-axes 결정 22).
    fn spec_place(&self) -> SpecPlace {
        SpecPlace {
            works_root: self.works.clone(),
            work: self.meta.slug.clone(),
            work_dir: self.places.dir.clone(),
            spec_dir: self.places.spec.clone(),
        }
    }

    /// 머리말(S11) — 에이전트가 첫 말에서 어느 work인지 안다(스토리 107). 따로 된 텍스트 블록이라 화면은 이것을
    /// 그리지 않고 `sent`의 글만 그린다(스토리 108). 봉투처럼 한국어 마크다운 한 장이다(워크플로 S18).
    fn preamble(&self) -> Value {
        let text = format!(
            "Atelier work 안에서 열린 대화다.\n\n- work slug: `{}`\n- 제목: {}\n- spec 폴더(specDir): `{}`\n",
            self.meta.slug,
            self.meta.title,
            self.places.spec.display()
        );
        json!({"type": "text", "text": text})
    }

    /// `agents.json`의 대화 줄들. 없으면 비어 있다.
    fn rows(&self) -> Result<Vec<ConversationRow>, HostError> {
        records::read_rows(&self.places.agents).map_err(HostError::Record)
    }

    /// 그 대화의 열린 줄 — 줄이 없거나 닫은 대화면 그 대화는 없다.
    fn open_row(&self, conversation: &str) -> Result<ConversationRow, HostError> {
        self.rows()?
            .into_iter()
            .find(|row| row.id == conversation && row.closed_at.is_none())
            .ok_or_else(|| HostError::ConversationNotFound(conversation.to_owned()))
    }
}

/// 대화의 정체 — work slug와 대화 id의 쌍(S8). 떠 있는 표는 대화 id로 키를 잡지만, 다른 work의 같은 id는 그 대화가 아니다.
/// 화면이 넘긴 id는 [`ConversationKey::new`]가 명령의 문턱에서 한 번 검사한다.
#[derive(Debug, Clone, Copy)]
struct ConversationKey<'a> {
    work: &'a str,
    id: &'a str,
}

impl<'a> ConversationKey<'a> {
    /// 화면이 넘긴 (work, 대화 id). id가 이 호스트가 지은 꼴이 아니면 그 대화는 없다 — 기록 파일 이름이 되므로 경로 요소를
    /// 들이지 않는다.
    fn new(work: &'a str, id: &'a str) -> Result<Self, HostError> {
        if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') {
            return Err(HostError::ConversationNotFound(id.to_owned()));
        }
        Ok(Self { work, id })
    }

    /// 로그인 창구에서 이 대화의 자리.
    fn waiter(self) -> Waiter {
        Waiter::Conversation { work: self.work.to_owned(), conversation: self.id.to_owned() }
    }
}

/// 세션이 열린 순간 적는 줄 — 판 경고(S6)와 열림. 런타임의 순서 장벽 안에서 돌아, 답 뒤에 온 update보다 앞에 선다.
///
/// 판 경고는 Codex만이다 — Claude 변환기는 앱과 같은 판이어야 열리고(다르면 열기 실패), 열림의 판이 곧 앱의 판이다.
fn record_opened(conv: &Arc<Conv>, agent: Agent) -> runtime::OnOpened {
    let conv = Arc::clone(conv);
    Box::new(move |opened| {
        let agent_version = opened.initialize["agentInfo"]["version"].as_str().map(str::to_owned);
        let written = (|| {
            if agent == Agent::Codex && major(agent_version.as_deref()) != Some(CODEX_ACP_MAJOR) {
                conv.recorder.session(SessionState::VersionWarning {
                    agent_version: agent_version.clone(),
                    supported_major: CODEX_ACP_MAJOR,
                })?;
            }
            conv.recorder.session(SessionState::Opened {
                how: opened.how,
                agent_version: agent_version.clone(),
                modes: opened.session.get("modes").cloned().unwrap_or(Value::Null),
                models: opened.session.get("models").cloned().unwrap_or(Value::Null),
                config_options: opened.session.get("configOptions").cloned().unwrap_or(Value::Null),
                meta: opened.session.get("_meta").cloned().unwrap_or(Value::Null),
            })
        })();
        if let Err(error) = written {
            eprintln!("{error}");
        }
    })
}

/// Codex를 띄우는 것 — 찾은 `codex-acp`를 `npx` 없이 바로 띄운다(three-axes 결정 26). env는 로그인 env에
/// `CODEX_PATH=<찾은 codex>`를 더한 것이다. `INITIAL_AGENT_MODE`는 넣지 않는다 — 대화의 시작 모드 · 모델은 세션이 열린 뒤
/// `set_*`로 넣고(`reapply_settings`, three-axes 티켓 25), 비어 있으면 엔진 기본값이다.
/// 사용자의 `CODEX_HOME`은 로그인 env에 있으면 그대로 간다(로그인 · config의 MCP · 모델이 이어진다).
fn codex_launch(programs: &[discovery::FoundProgram], env: &AgentEnv, place: &SessionPlace) -> Launch {
    let found = |name: &str| -> PathBuf {
        programs.iter().find(|program| program.name == name).expect("찾은 것에 Codex의 셋이 다 있다").path.clone()
    };
    let mut vars: BTreeMap<OsString, OsString> = env.vars().clone();
    vars.insert("CODEX_PATH".into(), found("codex").into_os_string());
    Launch { program: found("codex-acp"), args: Vec::new(), env: vars, cwd: place.cwd.clone() }
}

/// Claude에 넘길 고른 값 — 모드 · 모델 · 생각 깊이 · 지시문 파일 · 내장 도구 · 금지. 빈 칸은 엔진 기본값이다(three-axes 결정 16).
#[derive(Debug, Clone, Default)]
struct ClaudeChoice {
    mode: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    /// 지시문 파일 — Thread 참여자의 정의 스냅숏 본문(v1 구현 스펙 S4). work 대화에는 없다.
    instructions: Option<PathBuf>,
    /// 정의 스냅숏의 `tools.builtin` — 추상 이름 그대로다. `None`이면 기본 도구 전부다(§3). work 대화에는 없다.
    tools: Option<Vec<atelier_core::BuiltinTool>>,
    /// 정의 스냅숏의 `policy.forbid` — 추상 이름 · 명령 패턴 그대로다(S19). work 대화에는 없다.
    forbid: Vec<String>,
}

impl ClaudeChoice {
    /// work 대화의 것 — `agents.json`의 모드 · 모델.
    fn of_row(row: &ConversationRow) -> Self {
        Self { mode: row.mode.clone(), model: row.model.clone(), ..Self::default() }
    }
}

/// Claude를 띄우는 것 — 변환기(앱에서는 이 실행 파일의 하위 모드 `acp-claude`)를 로그인 env 그대로 띄운다. 변환기가
/// `session/new`를 받아 `claude -p`를 띄우므로, claude가 받을 것(찾은 claude의 자리 · 모드 · 모델 · 생각 깊이 · 지시문 파일 ·
/// 내장 도구 · 금지)은 `session/new`의 `_meta.atelier`에 싣는다. 「엔진 기본값」인 칸은 싣지 않는다 — 변환기가 플래그를 주지
/// 않는다(three-axes 결정 16). 되살릴 때(`session/resume` · `load`)도 같이 싣는다 — `-p --resume`은 이것들을 되살리지 않는다
/// (v1 티켓 03 · 12). 도구 · 금지는 추상 이름 그대로 싣고, Claude Code의 이름으로 옮기는 일은 변환기가 한다(v1 티켓 12).
///
/// 변환기는 앱과 같은 판이어야 연다 — 다르면 「판 어긋남」으로 열기 실패다(워크플로 S4).
fn claude_launch(
    translator: &TranslatorCommand,
    programs: &[discovery::FoundProgram],
    env: &AgentEnv,
    place: &SessionPlace,
    choice: &ClaudeChoice,
) -> (Launch, OpenTerms) {
    let claude = programs.iter().find(|program| program.name == "claude").expect("찾은 것에 claude가 있다");
    let mut atelier = serde_json::Map::new();
    atelier.insert("claudePath".into(), json!(claude.path));
    if let Some(mode) = &choice.mode {
        atelier.insert("permissionMode".into(), json!(mode));
    }
    if let Some(model) = &choice.model {
        atelier.insert("model".into(), json!(model));
    }
    if let Some(effort) = &choice.effort {
        atelier.insert("effort".into(), json!(effort));
    }
    if let Some(instructions) = &choice.instructions {
        atelier.insert("instructionsFile".into(), json!(instructions));
    }
    if let Some(tools) = &choice.tools {
        atelier.insert("builtinTools".into(), json!(tools));
    }
    if !choice.forbid.is_empty() {
        atelier.insert("forbid".into(), json!(choice.forbid));
    }
    let launch = Launch {
        program: translator.program.clone(),
        args: translator.args.clone(),
        env: env.vars().clone(),
        cwd: place.cwd.clone(),
    };
    let terms = OpenTerms {
        meta: Some(json!({"atelier": atelier})),
        required_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
        revive: None,
    };
    (launch, terms)
}

/// 그 에이전트를 띄우는 데 드는 실행 파일들 — 로그인 셸의 PATH에서 찾는다. 못 찾으면 빠진 것과 설치 명령을 싣고 실패한다.
fn find_programs(agent: Agent, env: &AgentEnv) -> Result<Vec<discovery::FoundProgram>, HostError> {
    discovery::look_up(agent, env.path()).map_err(|missing| HostError::EngineMissing { agent, missing })
}

/// 열린 대화 가운데 쓰지 않은 가장 작은 이름 — `Codex`, `Codex 2`, `Codex 3` …
fn next_name(agent: Agent, rows: &[ConversationRow]) -> String {
    let taken: Vec<&str> = rows.iter().filter(|row| row.closed_at.is_none()).map(|row| row.name.as_str()).collect();
    (1..)
        .map(|n| if n == 1 { agent.display_name().to_owned() } else { format!("{} {n}", agent.display_name()) })
        .find(|name| !taken.contains(&name.as_str()))
        .expect("이름은 언젠가 빈다")
}

/// 판 글의 메이저 — `2.2.2` → 2. 읽을 수 없으면 `None`이다.
fn major(version: Option<&str>) -> Option<u64> {
    version?.split('.').next()?.trim().parse().ok()
}

/// 대화 목록의 한 줄 — 표에서 찾은 대화(`found`)면 기록의 마지막 seq와 대기 줄을 메모리에서, 아니면 기록 파일에서 읽는다.
///
/// 표의 잠금 밖에서 부른다 — 찾은 대화의 잠금을 기다리고 기록 파일을 읽는다(S2). 찾은 뒤 다른 명령이 꺼낸 대화는 표에 없는
/// 대화로 본다([`Conv::lock_found`]).
fn summarize(found: Option<&Conv>, agents_dir: &Path, row: &ConversationRow) -> Conversation {
    match found.and_then(|conv| Some((conv, conv.lock_found()?))) {
        Some((conv, state)) => summary(row, conv.recorder.last_seq(), state.order.queue(), state.is_up()),
        None => summary(row, records::facts(agents_dir, &row.id).last_seq(), Vec::new(), false),
    }
}

/// 되살리기를 언제 하나(three-axes 티켓 10).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Revive {
    /// 떠 있지 않거나 죽었을 때만 — 보내기.
    IfNotRunning,
    /// 떠 있어도 끄고 다시 — 로그인이 「됨」으로 바뀐 뒤(티켓 12).
    EvenIfRunning,
}

/// 사람이 바꾸는 대화의 설정 하나(three-axes 티켓 09) — 엔진에 넣는 요청과 `agents.json`의 칸과 `config` 줄이 짝을 이룬다.
enum Setting {
    Model(String),
    Mode(String),
    /// Codex의 「계획」 — `collaboration_mode`가 `plan`인가(three-axes 결정 29).
    Plan(bool),
}

/// 띄운 Codex에 그 대화의 모델 · 모드 · 계획을 넣는다 — Codex는 `session/new`에 이것을 싣지 못해 새 세션을 config 기본값으로
/// 열고, resume · load도 config 기본값으로 되돌린다(three-axes 결정 27). 그래서 설정 「대화」의 기본값으로 만든 새 대화(티켓 25),
/// 띄우지 않은 동안 바꾼 값(티켓 09), 되살린 대화(티켓 10)가 모두 이 길로 그 값을 받는다. 사람이 바꾼 것이 아니므로 `config` 줄은
/// 적지 않는다. 비어 있는 칸(엔진 기본값)은 넣지 않는다 — Codex는 `set_*`를 받지 않는다(three-axes 결정 16).
///
/// 엔진이 거절해도(사라진 모델 · 답 없음) 대화는 연다 — 그 값은 `agents.json`에 남고 엔진은 기본값으로 돈다. 까닭은 앱의
/// stderr에만 남는다. 수신 루프 밖에서, 대화의 잠금 없이 부른다 — 답을 기다린다. 떠 있는 표에 넣기 전이라 첫 말보다 먼저 닿는다.
fn reapply_settings(turns: &Turns, row: &ConversationRow) {
    for setting in Setting::of_row(row) {
        let (method, fields) = setting.request();
        if let Err(error) = turns.change(method, fields, SETTING_LIMIT) {
            eprintln!("띄운 대화에 설정을 넣지 못했습니다: {} — {error}", row.id);
        }
    }
}

impl Setting {
    /// 그 대화 줄에 든 설정들 — 모델 · 모드 · 계획 차례. 비어 있는 칸(엔진 기본값)은 넣지 않는다.
    fn of_row(row: &ConversationRow) -> Vec<Setting> {
        let mut settings = Vec::new();
        if let Some(model) = &row.model {
            settings.push(Setting::Model(model.clone()));
        }
        if let Some(mode) = &row.mode {
            settings.push(Setting::Mode(mode.clone()));
        }
        if let Some(plan) = row.plan {
            settings.push(Setting::Plan(plan));
        }
        settings
    }

    /// 엔진에 넣는 요청 — 메서드와 `sessionId` 밖의 인자(실측 A2 · plan-mode의 꼴).
    fn request(&self) -> (&'static str, Value) {
        match self {
            Setting::Model(model) => ("session/set_config_option", json!({"configId": "model", "value": model})),
            Setting::Mode(mode) => ("session/set_mode", json!({"modeId": mode})),
            Setting::Plan(plan) => (
                "session/set_config_option",
                json!({"configId": "collaboration_mode", "value": if *plan { "plan" } else { "default" }}),
            ),
        }
    }

    fn apply(&self, row: &mut ConversationRow) {
        match self {
            Setting::Model(model) => row.model = Some(model.clone()),
            Setting::Mode(mode) => row.mode = Some(mode.clone()),
            Setting::Plan(plan) => row.plan = Some(*plan),
        }
    }

    /// `config` 줄의 payload — 바꾼 칸과 새 값.
    fn changed(&self) -> Value {
        match self {
            Setting::Model(model) => json!({"model": model}),
            Setting::Mode(mode) => json!({"mode": mode}),
            Setting::Plan(plan) => json!({"plan": plan}),
        }
    }
}

fn summary(row: &ConversationRow, last_seq: u64, queue: Vec<QueuedMessage>, live: bool) -> Conversation {
    Conversation {
        id: row.id.clone(),
        agent: row.agent,
        name: row.name.clone(),
        model: row.model.clone(),
        mode: row.mode.clone(),
        plan: row.plan,
        last_seq,
        queue,
        live,
    }
}
