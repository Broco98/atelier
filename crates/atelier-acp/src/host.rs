//! 대화 호스트 — Thread 엔진의 몸통. 앱은 이것 하나를 managed state로 쥐고 명령을 위임한다.
//!
//! three-axes가 지은 몸(엔진 확인 · 로그인 · 턴 차례 · 멈추기 · 대기 줄 · 권한 답 · 되살리기 · 끄기) 위에 v1이 Thread를 자리로
//! 세웠다(v1 티켓 04, [`thread`]) — 열쇠가 (Thread, 참여자)인 Session들이 턴 차례 · 런타임 · 로그인 창구를 쓴다. three-axes의 work
//! 대화(열쇠가 (work, 대화)이고 기록이 `works/<slug>/agents/`에 서던 자리)는 Work 안 대화창과 함께 걷었다(v1 티켓 08).
//!
//! Session 하나 = Runtime 프로세스 하나 · Runtime 쪽 세션 하나다. 동시 개수 상한은 없다(three-axes 결정 19).

use std::collections::HashMap;
use std::ffi::OsString;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::discovery::{self, Agent, EngineCheck, MissingProgram};
use crate::login::{self, EngineState, LoginDesk, LoginProgress, Waiter, Waiting};
use crate::login_env::{self, AgentEnv, LoginShellError, ShellSource};
use crate::quote::Quote;
use crate::records::{self, PermissionLine, RecordLine, Recorder, SessionState, TurnEndLine};
use crate::runtime::{self, AgentProcess, AnswerError, Launch, OpenTerms, Ruling, RuntimeEvent, SessionPlace, Sink, Turns};

mod thread;
mod turn_order;

pub use thread::{ThreadLink, ThreadView};
use turn_order::{Draft, Seat, TurnHands, TurnOrder};

/// Claude 세션 열기의 기본 한도 — 관문 G5. 변환기는 `session/new`를 받아 claude를 띄우고 stdin `initialize`의 답으로
/// 세션을 여므로, 세션 열기가 그만큼 기다린다. 진짜 claude 2.1.296은 SessionStart 훅을 돈 뒤 0.9~3.5초에 답했다(판 02 실측
/// G5). 넘으면 열기 실패다.
const CLAUDE_OPEN_LIMIT: Duration = Duration::from_secs(10);

/// 설정 바꾸기의 답을 기다리는 한도. Runtime은 몇 ms에 답한다(실측 A2) — 답 없이 버티는 Runtime에 화면이 끝없이 막히지 않게만
/// 둔다.
const SETTING_LIMIT: Duration = Duration::from_secs(10);

/// 호스트가 내보내는 것 — 엔진 상태와 Thread의 기록 줄 · 대기 줄 · 목록 요약.
#[derive(Debug, Clone, PartialEq)]
pub enum HostEvent {
    /// 엔진 상태 — 찾음 여부 · 로그인 여부 · 로그인 진행(링크 · 끝남). 엔진을 확인할 때, Runtime이 로그인을 요구할 때,
    /// 로그인 명령이 돌고 끝날 때 나간다(three-axes 티켓 12).
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

/// 변환기 명령 — Session이 띄우는 ACP 에이전트. 앱에서는 `current_exe` + `acp-claude`, 검사에서는 변환기 시험 bin이다.
/// `current_exe`는 진입점에서만 읽어 넘긴다(워크플로 §1).
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
/// closure), 시간 한도는 검사가 줄일 수 있다. Thread 도구 중계 서버 명령은 주면 Thread의 Session에 Thread 도구가 실린다.
pub struct HostBuilder {
    data_root: PathBuf,
    translator: TranslatorCommand,
    shell: ShellSource,
    emit: Arc<Emit>,
    login_shell_limit: Duration,
    open_limit: Option<Duration>,
    thread_tools: Option<TranslatorCommand>,
}

impl HostBuilder {
    /// Thread 도구 중계 서버 명령(v1 티켓 15 · S12) — 앱에서는 `current_exe` + `thread-tools`, 검사에서는 중계 서버 시험 bin이다.
    /// 엔진은 Thread의 Session마다 소켓을 열고, 이 명령에 그 소켓을 마지막 인자로 붙여 ACP `mcpServers`로 넘긴다. 주지 않으면
    /// Session에 Thread 도구가 없다.
    pub fn thread_tools(mut self, relay: TranslatorCommand) -> Self {
        self.thread_tools = Some(relay);
        self
    }

    /// 로그인 셸 읽기의 한도. 기본은 10초다(워크플로 §10) — 검사에서는 줄여도 된다.
    pub fn login_shell_limit(mut self, limit: Duration) -> Self {
        self.login_shell_limit = limit;
        self
    }

    /// 세션 열기의 한도. 기본은 Claude 10초(G5)다 — 검사에서는 줄여도 된다.
    pub fn open_limit(mut self, limit: Duration) -> Self {
        self.open_limit = Some(limit);
        self
    }

    pub fn build(self) -> ConversationHost {
        ConversationHost(Arc::new(HostCore {
            logins: LoginDesk::new(Arc::clone(&self.emit)),
            data_root: self.data_root,
            translator: self.translator,
            shell: self.shell,
            emit: self.emit,
            login_shell_limit: self.login_shell_limit,
            open_limit: self.open_limit,
            login_env: Mutex::new(None),
            revivals: Mutex::new(HashMap::new()),
            threads: thread::Threads::default(),
            thread_tools: self.thread_tools,
        }))
    }
}

/// 대화 호스트 — 앱이 managed state로 쥐는 손잡이. 몸([`HostCore`])을 `Arc`로 쥔다: Thread 도구의 소켓(v1 티켓 15)은 연결마다 다른
/// 스레드에서 호스트를 불러야 하는데, 호스트를 쥐면 Session → 소켓 → 호스트의 고리가 생겨 끄지 못한다. 그래서 소켓은 몸을 **약하게**
/// 쥐고 부를 때만 손잡이를 다시 세운다([`ConversationHost::upgrade`]). 메서드는 그대로 손잡이에 있고, 칸은 `Deref`로 몸의 것을
/// 읽는다.
pub struct ConversationHost(Arc<HostCore>);

impl std::ops::Deref for ConversationHost {
    type Target = HostCore;

    fn deref(&self) -> &HostCore {
        &self.0
    }
}

impl ConversationHost {
    /// 몸을 약하게 쥔 것 — 호스트가 꺼지면(손잡이가 다 놓이면) 되살지 않는다.
    fn weak(&self) -> Weak<HostCore> {
        Arc::downgrade(&self.0)
    }

    /// 약하게 쥔 몸에서 손잡이를 다시 세운다 — 아직 살아 있으면.
    fn upgrade(core: &Weak<HostCore>) -> Option<ConversationHost> {
        core.upgrade().map(ConversationHost)
    }
}

/// 대화 호스트의 몸 — 칸들. 크레이트 밖에서는 이름을 부를 수 없다.
pub struct HostCore {
    data_root: PathBuf,
    translator: TranslatorCommand,
    shell: ShellSource,
    emit: Arc<Emit>,
    login_shell_limit: Duration,
    open_limit: Option<Duration>,
    /// S7 — 로그인 env는 호스트가 도는 동안 한 번 읽어 메모리에 쥔다. 「다시 확인」만 다시 읽는다.
    /// 기록하지 않는다 — 비밀이 기록에 남지 않게(워크플로 S37).
    ///
    /// 읽는 동안 잠금을 쥔다. 두 엔진 확인이 함께 와도 셸은 한 번만 뜨고, 뒤의 것이 앞의 결과를 쓴다.
    login_env: Mutex<Option<AgentEnv>>,
    /// Session마다 띄우기(되살리기 · 다시 띄우기 · 참여)를 하나씩 세우는 잠금 — 함께 온 보내기 둘이 Runtime을 둘 띄우지 않고,
    /// 같은 Agent를 멘션한 말 둘이 엇갈려도 한 번만 들어오게(three-axes 티켓 10 · v1 티켓 13). 설정 바꾸기도 되살리기의 끝을 이것으로
    /// 기다린다. 잠금 차례의 맨 바깥이다 — 이 문 → 설정 → Session 표 → Session의 대화(`state`) → 기록. 문의 이름으로 찾는다.
    revivals: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// 로그인 창구 — 엔진 상태를 알리고, 로그인을 기다리는 Session과 도는 로그인 명령을 쥔다(three-axes 티켓 12).
    logins: Arc<LoginDesk>,
    /// Thread들 — 떠 있는 Session · 연 기록 · 색인(v1 티켓 04).
    threads: thread::Threads,
    /// Thread 도구 중계 서버 명령(v1 티켓 15) — 없으면 Thread의 Session에 Thread 도구를 싣지 않는다.
    thread_tools: Option<TranslatorCommand>,
}

/// Session 하나의 기록과 턴의 상태. 런타임의 sink가 함께 쥔다 — 받은 것은 sink가 곧바로 적는다.
///
/// 잠금 순서는 늘 `state` → 기록이다. 턴 끝 줄은 `state`를 쥔 채 적고, 같은 잠금 안에서 대기 줄의 다음 말을 보낸다 — 그래야
/// 다음 말의 `sent` 줄이 턴 끝 줄보다 앞에 서지 않고, 그 사이에 온 보내기가 대기 줄을 앞지르지 못한다.
struct Conv {
    recorder: Recorder,
    state: Mutex<ConvState>,
    /// 턴 도중에 Runtime이 로그인을 요구하면 그 Session을 로그인 창구에 쥐게 한다(three-axes 티켓 12).
    login: LoginWatch,
    /// 설정 바꾸기를 하나씩 세운다 — 엔진에 넣은 차례와 `thread.json`에 남는 차례가 엇갈리지 않게(three-axes 티켓 09). `state`와
    /// 따로 둔다: 바꾸기는 엔진의 답을 기다리는데, 그동안 `state`를 쥐면 턴 끝이 막혀 답이 오지 않는다.
    setting: Mutex<()>,
}

struct ConvState {
    /// 턴 차례 — 살아 있나 · 턴 단계 · 대기 줄(S13) · 머리말 붙임(S10). 대기 줄은 Runtime이 죽어도 그대로 두고, 되살린 Session이
    /// 이어 쥔다. Thread의 Session은 spec 폴더를 찍지 않으므로 턴 앞뒤의 찍기는 빈 것(`()`)이다(v1 티켓 04).
    order: TurnOrder<()>,
    /// Runtime에 턴을 열고 멈추는 손잡이. 세션이 열린 뒤에 선다.
    turns: Option<Turns>,
    /// 떠 있는 표에서 꺼냈나 — 되살리기 · 다시 띄우기 · 호스트 끄기가 이 Session을 쥐었다. 명령은 표에서 Session을 찾은 뒤 표의
    /// 잠금을 놓고 이 잠금을 쥐는데(S2), 그 사이에 꺼내졌으면 표에 없는 Session으로 본다([`Conv::lock_found`]). 꺼낸 쪽은 꺼낸
    /// 뒤로 명령이 이 Session에 닿지 않는 것에 기댄다 — 끄는 Session에 말 · 권한 답이 끼지 않는다. 표에 되돌려 넣을 때 걷힌다.
    taken: bool,
}

/// 변환기가 표시한 턴 밖 턴의 시작 · 끝(three-axes S4) — `session_info_update`의 `_meta.atelier.outOfTurn`.
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
    /// Runtime 쪽 세션이 막 열린 Session — 살아 있고, 턴이 쉬고, 첫 말에 머리말을 붙인다. 턴 손잡이는 세션이 열린 뒤에
    /// 서고, 대기 줄은 비어 있다.
    fn fresh() -> Self {
        Self { order: TurnOrder::new(), turns: None, taken: false }
    }

    /// Runtime이 떠 있고 살아 있나 — 세션이 열려 턴 손잡이가 섰다. Thread의 `live`(three-axes 티켓 23)이고, 말을 곧바로 보낼 수
    /// 있는 Session이다. 죽었거나 끈 Session은 아니다.
    fn is_up(&self) -> bool {
        self.order.alive() && self.turns.is_some()
    }
}

impl Conv {
    fn new(recorder: Recorder, login: LoginWatch) -> Arc<Self> {
        Arc::new(Self { recorder, state: Mutex::new(ConvState::fresh()), login, setting: Mutex::new(()) })
    }

    fn lock_state(&self) -> MutexGuard<'_, ConvState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 표에서 찾은 Session의 잠금 — 명령은 표에서 찾은 Session을 이것으로 쥔다. 찾은 뒤 이 잠금을 쥐기 전에 다른 명령이 표에서
    /// 꺼냈으면 `None`이다: 그 Session은 표에 없는 것과 같다(`ConvState::taken`). 턴 끝 · 죽음처럼 런타임이 넘긴 것은 명령이
    /// 아니라 이것을 거치지 않는다.
    fn lock_found(&self) -> Option<MutexGuard<'_, ConvState>> {
        let state = self.lock_state();
        (!state.taken).then_some(state)
    }

    /// 쥔 `state`의 턴 차례에 이 Session의 손을 붙인다 — 그 잠금 한 구간 동안만.
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
            // 권한 줄은 Session의 잠금을 쥐지 않고 적는다 — 답 · 멈추기는 Session의 잠금을 쥔 채 런타임을 부르고, 런타임은 그
            // 안에서 이것을 넘긴다.
            RuntimeEvent::PermissionAsked(asked) => {
                let (card, policy) = asked.asking.map(|asking| (asking.card, asking.policy)).unzip();
                self.recorder.permission(PermissionLine::Asked {
                    request_id: asked.request_id,
                    request: asked.request,
                    tool_call: asked.tool_call,
                    card,
                    policy,
                })
            }
            RuntimeEvent::PermissionAnswered { request_id, option_id } => {
                self.recorder.permission(PermissionLine::Answered { request_id, option_id })
            }
            RuntimeEvent::PermissionWithdrawn { request_id, reason } => {
                self.recorder.permission(PermissionLine::Withdrawn { request_id, reason })
            }
            RuntimeEvent::PermissionDecided { request_id, ruling, asked } => {
                let (request, tool_call) = asked.map(|asked| (asked.request, asked.tool_call)).unzip();
                let line =
                    PermissionLine::Decided { request_id, option_id: ruling.option_id, reason: ruling.reason, request, tool_call };
                self.recorder.permission(line)
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
            // 기록이 막혀도 Session은 이어 간다 — sink는 오류를 돌려줄 곳이 없다.
            eprintln!("{error}");
        }
    }
}

/// 턴 차례가 시키는 일을 이 Session의 기록 · 턴 손잡이 · 로그인 창구로 옮기는 것 — [`TurnHands`]의 운영 adapter. Session의 `state`
/// 잠금 안에서만 산다. 손잡이는 그 잠금이 쥔 `ConvState::turns`다.
struct ConvHands<'a> {
    conv: &'a Conv,
    turns: Option<&'a Turns>,
}

impl ConvHands<'_> {
    /// 걸림 없이 부르는 자리라 손잡이는 늘 있다 — 없으면 떠 있지 않은 Session이다.
    fn turns(&self) -> Result<&Turns, String> {
        self.turns.ok_or_else(|| format!("Runtime이 떠 있지 않은 Session입니다: {}", self.conv.recorder.name()))
    }
}

impl TurnHands for ConvHands<'_> {
    /// Thread의 Session은 턴 앞뒤로 spec 폴더를 찍지 않는다 — Thread의 「바뀐 것」은 Work 카드가 git으로 본다(v1 티켓 04 · 33).
    type Shot = ();

    fn plugged(&self) -> bool {
        self.turns.is_some()
    }

    fn permission_pending(&self) -> bool {
        self.turns.is_some_and(Turns::permission_pending)
    }

    fn login_waiting(&self) -> Option<Agent> {
        self.conv.login.waiting()
    }

    /// 사라진 Work를 지켜보지 않는다 — 보관된 Work의 Thread를 읽기만으로 두는 일은 v1 티켓 38이 이 자리에 건다(구현 스펙 §5).
    fn vanished(&self) -> bool {
        false
    }

    fn shoot(&mut self) {}

    fn past(&mut self) -> Option<Value> {
        self.conv.recorder.past()
    }

    fn changes(&mut self, _before: &(), _now: &()) -> Result<(), records::RecordError> {
        Ok(())
    }

    fn turn_end(&mut self, line: TurnEndLine) -> Result<(), records::RecordError> {
        self.conv.recorder.turn_end(line)
    }

    fn sent(
        &mut self,
        text: &str,
        quote: Option<&Quote>,
        attachments: &[atelier_core::Attachment],
        prompt: &[Value],
        send_now: bool,
    ) -> Result<(), records::RecordError> {
        self.conv.recorder.sent(text, quote, attachments, prompt, send_now)
    }

    fn called(&mut self, call: &thread::Assignment, text: &str, prompt: &[Value]) -> Result<(), records::RecordError> {
        self.conv.recorder.call(call.from(), call.started(text, prompt))
    }

    /// 엔진을 가리지 않는다 — 턴 도중의 `-32000`도 `session/new`의 것과 같은 로그인 필요 줄이다(three-axes 티켓 12). Session의
    /// 잠금을 쥔 채 적고 쥐어 둔다 — 그 사이에 보내기가 끼지 않고, 대기 줄도 로그인을 기다린다.
    fn login_lost(&mut self) -> Result<(), records::RecordError> {
        self.conv.recorder.session(SessionState::LoginRequired)?;
        self.conv.login.required();
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

    fn rule(&mut self, request: &str, ruling: Ruling) -> Result<(), AnswerError> {
        self.turns.map_or(Err(AnswerError::Closed), |turns| turns.rule(request, ruling))
    }

    fn retire_if_vanished(&mut self) -> bool {
        false
    }
}

/// 턴 도중에 Runtime이 로그인을 요구하면 그 Session을 로그인 창구에 쥐게 하는 것(three-axes 티켓 12). 턴 끝은 런타임의
/// sink 안이라 호스트를 부를 수 없으므로 창구를 함께 쥔다 — 창구는 Session의 잠금을 쥔 채 불러도 된다.
struct LoginWatch {
    agent: Agent,
    /// 다시 띄울 자리 — Thread 참여자의 Session이다.
    waiter: Waiter,
    desk: Arc<LoginDesk>,
}

impl LoginWatch {
    fn required(&self) {
        self.desk.login_required(self.agent, self.waiter.clone());
    }

    /// 그 Session이 로그인을 기다리면 그 엔진 — 그동안은 대기 줄이 가지 않는다(S13의 걸림).
    fn waiting(&self) -> Option<Agent> {
        self.desk.waiting_for(&self.waiter)
    }
}

/// 떠 있는 표에서 꺼낸 Session들에 꺼냈다고 적는다(`ConvState::taken`) — 표의 잠금을 놓은 뒤에 부른다. Session의 잠금이 쥐여 있어도
/// 다른 Session의 명령이 표에서 막히지 않게(S2). 꺼낸 뒤에 표에서 찾는 명령은 Session을 못 찾고, 그 전에 찾아 둔 명령은 이 표시를
/// 보고 물러난다 — 이미 그 잠금을 쥔 명령이면 그것이 끝난 뒤에 적힌다.
fn mark_taken<'a>(taken: impl IntoIterator<Item = &'a Conv>) {
    for conv in taken {
        conv.lock_state().taken = true;
    }
}

/// Runtime 여럿의 프로세스 그룹을 끈다 — 모두의 stdin을 **한꺼번에** 닫고 1초를 **한 번만** 기다린 뒤 그룹들을 SIGKILL한다.
/// 하나마다 1초씩 줄을 세우면 N초가 된다.
fn end_together(mut agents: Vec<(&mut AgentProcess, &Conv)>) {
    let deadline = Instant::now() + runtime::SHUTDOWN_GRACE;
    for (agent, _) in agents.iter_mut() {
        agent.begin_shutdown();
    }
    for (agent, conv) in agents {
        agent.finish_shutdown(deadline);
        // 끈 Session은 연결을 쥐지 않는다 — Session이 든 턴 손잡이의 복제도 놓는다.
        conv.lock_state().turns = None;
    }
}

/// 앱 종료 확인 창이 세는 것(three-axes 티켓 23 · S13 · v1 구현 스펙 S40) — 앱 전체(지금 열지 않은 Thread 포함)에서, 끄면 잃는
/// 것들.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuitCounts {
    /// 턴이 도는 Session 수.
    pub running: usize,
    /// 대기 중인 말 수 — 대기 줄은 메모리에만 있어 앱을 끄면 사라진다.
    pub queued: usize,
    /// 답하지 않은 권한 요청 수.
    pub approvals: usize,
}

/// 호스트 명령이 실패한 까닭 — 화면에 그대로 보일 글이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostError {
    /// `work.json`이 있는 work 폴더가 없다 — Thread가 이은 Work가 사라졌다.
    WorkNotFound(String),
    LoginShell(LoginShellError),
    /// Runtime을 띄우는 데 드는 실행 파일을 로그인 셸의 PATH에서 찾지 못했다.
    EngineMissing { agent: Agent, missing: Vec<MissingProgram> },
    /// Thread는 섰지만 Runtime이 세션을 열지 못했다. 까닭은 그 Thread의 기록에도 `session` 죽음 줄로 남는다.
    Open { thread: String, reason: String },
    /// Runtime이 떠 있지 않은 Session — 보내기가 되살린 뒤에도 Runtime이 곧바로 죽었다(three-axes 티켓 10).
    NotRunning(String),
    /// 그 Session의 대기 줄에 그 대기 id의 말이 없다 — 이미 갔거나 지웠다. 대기 줄은 메모리에만 있어 다시 켠 뒤에는 늘
    /// 비어 있다.
    QueuedNotFound(String),
    /// 걸려 있지 않은 권한 요청 — 이미 답했거나 거둬졌다(멈춤 · Runtime이 턴을 끝냄 · Runtime이 떠 있지 않음).
    PermissionClosed { thread: String, request: String },
    /// 그 권한 요청이 준 선택지에 없는 optionId. 요청은 그대로 걸려 있다.
    PermissionOption { request: String, option: String },
    /// 로그인을 기다리는 Session — Runtime이 `-32000`으로 답했다. 로그인이 「됨」으로 바뀌면 호스트가 다시 띄운다
    /// (three-axes 티켓 12).
    LoginRequired { agent: Agent, thread: String },
    /// Runtime에 말을 보내지 못했다(연결이 끊겼다).
    Send(String),
    /// 떠 있는 Runtime이 설정 바꾸기를 받지 않았다(모르는 값 · 답 없음 · 연결이 끊김). 아무것도 남지 않았다(three-axes 티켓 09).
    Setting(String),
    /// 보낸 말의 인용이 올바르지 않다 — spec 폴더 밖을 가리키거나 줄 범위가 뒤집혔거나 글이 비었다(three-axes 티켓 27). 인용을
    /// Thread 입력창에 잇는 일은 v1 티켓 35다(S41).
    BadQuote(String),
    /// 보낸 말의 첨부가 올바르지 않다 — 절대 경로가 아니거나 없는 파일이다(v1 티켓 06). 아무것도 적지 않았다.
    BadAttachment(String),
    /// Thread 폴더를 읽거나 쓰지 못했다.
    Record(String),
    /// 로그인 명령을 띄우지 못했다.
    Login(String),
    /// 그 id의 Thread가 없다(v1 티켓 04) — 폴더가 없거나 id의 꼴이 아니다.
    ThreadNotFound(String),
    /// 그 Agent의 정의 파일이 깨졌다(v1 구현 스펙 §6 「깨진 파일」) — 부를 수 없다. 까닭은 사람이 읽을 글이다.
    AgentBroken { handle: String, reason: String },
    /// 그 Thread에 그 handle의 참여자가 없다.
    ParticipantNotFound { thread: String, handle: String },
    /// 멘션한 이름(`call` — @ 뒤)이 이 Thread의 범위에 없다(v1 구현 스펙 §6 범위) — Work 없는 Thread는 Library만, Work에 이은
    /// Thread는 Library와 그 Work의 Project들이다. 보내기 전에 거절한다(v1 티켓 13).
    AgentNotFound { call: String, work: Option<String> },
    /// 멘션한 맨 이름이 Project 여럿에 있다 — 붙인 이름(`calls`) 가운데 하나로 불러야 한다(v1 티켓 11).
    AgentAmbiguous { call: String, calls: Vec<String> },
    /// 멘션한 Agent와 같은 handle의 다른 Agent가 이미 이 Thread에 있다 — Session은 (Thread, handle)마다 하나다.
    HandleTaken { call: String, handle: String },
    /// 바꾸려는 Thread 이름이 비었다(v1 티켓 05).
    BadTitle,
    /// 「다시 맡기기」로 부를 수 없다(v1 티켓 17) — `tools.agents`에 없음 · 범위 밖 · 호출 고리 안(§8 「부를 수 있나」). 까닭은
    /// Agent 부르기 도구가 돌려주는 글 그대로다.
    CallRefused(String),
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
            HostError::NotRunning(thread) => write!(f, "Runtime이 떠 있지 않은 Session입니다: {thread}"),
            HostError::QueuedNotFound(_) => write!(f, "대기 중인 말을 찾을 수 없습니다. 이미 보냈거나 지운 말입니다"),
            HostError::PermissionClosed { .. } => {
                write!(f, "이미 닫힌 권한 요청입니다. 답했거나 거둬진 요청에는 답할 수 없습니다")
            }
            HostError::PermissionOption { option, .. } => write!(f, "그 권한 요청에 없는 선택지입니다: {option}"),
            HostError::LoginRequired { agent, .. } => {
                write!(f, "{} 로그인이 필요합니다. 로그인한 뒤에 보내세요", agent.display_name())
            }
            HostError::Send(reason) => write!(f, "{reason}"),
            HostError::Setting(reason) => write!(f, "Runtime이 바꾸기를 받지 않았습니다: {reason}"),
            HostError::BadQuote(reason) | HostError::BadAttachment(reason) => write!(f, "{reason}"),
            HostError::Record(reason) => write!(f, "{reason}"),
            HostError::Login(reason) => write!(f, "{reason}"),
            HostError::ThreadNotFound(thread) => write!(f, "Thread를 찾을 수 없습니다: {thread}"),
            HostError::AgentBroken { handle, reason } => write!(f, "@{handle}의 정의 파일을 읽지 못했습니다: {reason}"),
            HostError::ParticipantNotFound { thread, handle } => write!(f, "Thread {thread}에 @{handle}이 없습니다"),
            HostError::AgentNotFound { call, work: None } => {
                write!(f, "@{call} — 이 Thread에서 부를 수 없는 Agent예요. Work 없는 Thread에서는 Library의 Agent만 불러요")
            }
            HostError::AgentNotFound { call, work: Some(work) } => write!(
                f,
                "@{call} — 이 Thread에서 부를 수 없는 Agent예요. Library와 Work `{work}`의 Project에 있는 Agent만 불러요"
            ),
            HostError::AgentAmbiguous { call, calls } => {
                let calls: Vec<String> = calls.iter().map(|call| format!("@{call}")).collect();
                write!(f, "@{call} — 같은 handle이 Project 여럿에 있어요. {} 가운데 하나로 불러 주세요", calls.join(" · "))
            }
            HostError::HandleTaken { call, handle } => {
                write!(f, "@{call} — 이 Thread에는 이미 다른 @{handle} Agent가 들어와 있어요")
            }
            HostError::BadTitle => write!(f, "Thread 이름이 비었어요"),
            HostError::CallRefused(reason) => write!(f, "{reason}"),
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
            thread_tools: None,
        }
    }

    /// 엔진 확인 — 그 엔진을 띄우는 데 드는 실행 파일을 로그인 셸의 PATH에서 찾고, 찾았으면 로그인돼 있는지 엔진에게 묻는다
    /// (three-axes 티켓 12). `reread`는 안내 카드의 「다시 확인」이다. 설치한 뒤 앱을 다시 켜지 않고 이어 가도록 로그인 env를 새로
    /// 읽는다. v1의 화면은 Claude만 묻는다(S3) — Codex를 찾는 길은 크레이트에 남는다.
    ///
    /// - 답은 엔진 상태 이벤트로도 나간다 — 같은 엔진을 쓰는 다른 Thread의 카드도 따라 바뀐다.
    /// - 로그인돼 있으면 그 엔진의 로그인을 기다리던 Session을 다시 띄운다 — 터미널에서 로그인하고 「다시 확인」을 누른 때다.
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

    /// 로그인 셸의 PATH — Runtime 밖의 도구(Work의 PR을 읽는 `gh`, v1 티켓 33)도 Runtime처럼 내 터미널과 같은 자리에서
    /// 찾게 한다. Finder에서 띄운 앱의 PATH로는 Homebrew의 `gh`가 안 보인다. 쥔 로그인 env를 쓰고, 셸을 다시 띄우지 않는다.
    /// 읽지 못하면 없다 — 부르는 쪽이 앱의 PATH로 물러선다.
    ///
    /// 막히는 호출이다 — 로그인 env를 아직 쥐지 않았으면 셸을 띄워 기다린다(한도 10초).
    pub fn login_path(&self) -> Option<OsString> {
        self.login_env(false).ok()?.path().map(OsString::from)
    }

    /// 로그인 시작 — 그 엔진의 로그인 명령(`claude auth login` · `codex login`)을 TTY 없이 새 세션에 띄운다(three-axes
    /// 결정 30). 명령이 브라우저를 스스로 연다. 기다리지 않는다 — 진행은 엔진 상태 이벤트로 온다:
    ///
    /// 1. 도는 중(링크 없음) → 명령이 `https://` URL을 찍으면 도는 중(링크) — 「링크 복사」의 값이다.
    /// 2. 명령이 끝나면 확인을 저절로 다시 돌고 「끝남」과 그 답(됨 · 안 됨)을 알린다.
    /// 3. 됨이면 그 엔진의 로그인을 기다리던 Session을 다시 띄운다. 기록은 그대로다.
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

    /// 로그인 명령이 끝났다 — 확인을 다시 돌고 「끝남」을 알리고, 됨이면 기다리던 Session을 다시 띄운다. 끝을 지켜보는
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

    /// 그 엔진의 로그인을 기다리던 Session들을 다시 띄운다 — 같은 기록에 이어 적고, 되살리기의 길(resume → load → 새로)로 연다.
    /// 막히는 호출이다 — Session마다 세션이 열릴 때까지 기다린다.
    fn relaunch_waiting(&self, agent: Agent) {
        for Waiting { waiter, .. } in self.logins.take_waiting(agent) {
            if let Err(error) = self.relaunch_session(&waiter.thread, &waiter.handle) {
                eprintln!("{error}");
            }
        }
    }

    /// 그 문의 띄우기 잠금.
    fn revival_gate(&self, gate: &str) -> Arc<Mutex<()>> {
        let mut gates = self.revivals.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        Arc::clone(gates.entry(gate.to_owned()).or_default())
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

    /// 앱 종료 확인 창의 셈(three-axes 티켓 23 · S13 · v1 구현 스펙 S40) — 떠 있는 Session 모두에서 턴이 도는 Session · 대기 중인
    /// 말 · 답하지 않은 권한 요청을 센다. 셈의 원천이 화면이 아니라 여기인 것은, 대기 줄이 이 메모리에만 있고 지금 화면이 열지 않은
    /// Thread의 Session도 함께 꺼지기 때문이다. 떠 있지 않은 Session(다시 켠 뒤)은 셀 것이 없다. 기다리지 않는다.
    ///
    /// Runtime이 스스로 이어 간 턴(three-axes 티켓 16 · S4)도 「턴이 도는 Session」이다 — 끄면 그 턴도 잃는다.
    pub fn quit_counts(&self) -> QuitCounts {
        let mut counts = QuitCounts::default();
        for conv in self.threads.live_convs() {
            let state = conv.lock_state();
            counts.running += usize::from(state.order.turning());
            counts.queued += state.order.queued();
            counts.approvals += state.turns.as_ref().map_or(0, Turns::pending_permissions);
        }
        counts
    }

    /// 호스트 끄기 — 모든 Session의 프로세스 그룹을 끈다(앱 종료). Thread는 그대로이고, 앱을 다시 켜면 말을 보낼 때 되살린다
    /// (three-axes 결정 19).
    ///
    /// 모든 Session의 stdin을 **한꺼번에** 닫고 1초를 **한 번만** 기다린 뒤 그룹들을 SIGKILL한다 — Session마다 1초씩 줄을 세우면
    /// N초가 된다.
    pub fn shut_down(&self) {
        // 로그인 명령도 끈다 — SIGTERM을 먼저 보내 두고, Session들을 끄는 1초 뒤에 남은 것을 SIGKILL한다.
        self.logins.begin_close();
        let mut sessions = self.threads.drain_sessions();
        mark_taken(sessions.iter().map(|session| &*session.conv));
        end_together(sessions.iter_mut().map(|session| (&mut session.agent, &*session.conv)).collect());
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
        Ok(WorkAt { meta, places })
    }

    fn login_watch(&self, agent: Agent, waiter: Waiter) -> LoginWatch {
        LoginWatch { agent, waiter, desk: Arc::clone(&self.logins) }
    }
}

/// Thread가 이은 Work의 자리들(S5) — 명령마다 `works/`에서 읽은 `work.json`과 그것으로 셈한 폴더 자리. [`ConversationHost::open_work`]가
/// 짓는다.
struct WorkAt {
    meta: atelier_core::Work,
    places: atelier_core::WorkPlaces,
}

/// 세션이 열린 순간 적는 줄 — 열림. 런타임의 순서 장벽 안에서 돌아, 답 뒤에 온 update보다 앞에 선다. Claude 변환기는 앱과 같은
/// 판이어야 열리고(다르면 열기 실패), 열림의 판이 곧 앱의 판이다.
fn record_opened(conv: &Arc<Conv>) -> runtime::OnOpened {
    let conv = Arc::clone(conv);
    Box::new(move |opened| {
        let written = conv.recorder.session(SessionState::Opened {
            how: opened.how,
            agent_version: opened.initialize["agentInfo"]["version"].as_str().map(str::to_owned),
            modes: opened.session.get("modes").cloned().unwrap_or(Value::Null),
            models: opened.session.get("models").cloned().unwrap_or(Value::Null),
            config_options: opened.session.get("configOptions").cloned().unwrap_or(Value::Null),
            meta: opened.session.get("_meta").cloned().unwrap_or(Value::Null),
        });
        if let Err(error) = written {
            eprintln!("{error}");
        }
    })
}

/// Claude에 넘길 고른 값 — 모드 · 모델 · 생각 깊이 · 지시문 파일 · 내장 도구 · 금지. 빈 칸은 엔진 기본값이다(three-axes 결정 16).
#[derive(Debug, Clone, Default)]
struct ClaudeChoice {
    /// 권한 모드 — Thread의 Session은 늘 싣는다: `default`, 「계획만」이면 `plan`(v1 구현 스펙 S17 · v1 티켓 22).
    mode: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    /// 지시문 파일 — Thread 참여자의 정의 스냅숏 본문(v1 구현 스펙 S4).
    instructions: Option<PathBuf>,
    /// 정의 스냅숏의 `tools.builtin` — 추상 이름 그대로다. `None`이면 기본 도구 전부다(§3).
    tools: Option<Vec<atelier_core::BuiltinTool>>,
    /// 정의 스냅숏의 `policy.forbid` — 추상 이름 · 명령 패턴 그대로다(S19).
    forbid: Vec<String>,
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
        mcp_servers: Vec::new(),
        judge: None,
    };
    (launch, terms)
}

/// 그 엔진을 띄우는 데 드는 실행 파일들 — 로그인 셸의 PATH에서 찾는다. 못 찾으면 빠진 것과 설치 명령을 싣고 실패한다.
fn find_programs(agent: Agent, env: &AgentEnv) -> Result<Vec<discovery::FoundProgram>, HostError> {
    discovery::look_up(agent, env.path()).map_err(|missing| HostError::EngineMissing { agent, missing })
}

/// 되살리기를 언제 하나(three-axes 티켓 10).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Revive {
    /// 떠 있지 않거나 죽었을 때만 — 보내기.
    IfNotRunning,
    /// 떠 있어도 끄고 다시 — 로그인이 「됨」으로 바뀐 뒤(three-axes 티켓 12) · 생각 깊이를 바꾼 뒤(v1 티켓 05).
    EvenIfRunning,
}

/// 사람이 바꾸는 Session의 설정 하나 — Runtime에 넣는 요청과 `config` 줄이 짝을 이룬다. Runtime이 떠 있는 Session에 곧바로 넣는
/// 것은 모델 하나다(three-axes 티켓 09 · 스토리 33). 생각 깊이는 띄울 때의 플래그로만 받는다(v1 티켓 05).
enum Setting {
    Model(String),
}

impl Setting {
    /// Runtime에 넣는 요청 — 메서드와 `sessionId` 밖의 인자(실측 A2의 꼴).
    fn request(&self) -> (&'static str, Value) {
        match self {
            Setting::Model(model) => ("session/set_config_option", json!({"configId": "model", "value": model})),
        }
    }

    /// `config` 줄의 payload — 바꾼 칸과 새 값.
    fn changed(&self) -> Value {
        match self {
            Setting::Model(model) => json!({"model": model}),
        }
    }
}
