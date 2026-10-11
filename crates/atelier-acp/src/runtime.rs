//! ACP 런타임 — 에이전트 프로세스 하나와 ACP로 말한다. 띄우기 · initialize · 세션 열기 · 턴 · 끄기, 그리고 받은
//! 것(update · stderr · 계정 상태 · 프로세스 죽음)을 원문 그대로 호출자에게 넘기기.
//!
//! 8월 크레이트의 연결 뼈대를 2.0 크레이트에 맞춰 되살렸다. 연결의 수명은 `connect_with`에 준 **클로저의
//! 수명**이라, 연결마다 스레드 하나가 그 클로저 안에서 기다린다 — 내가 쏘는 끄기 신호와, **저쪽이 사라졌다는
//! 사실**(수신 EOF) 둘을. 수신 EOF는 클로저를 깨우지 않으므로 `incoming_closed`를 함께 기다려야 한다.
//!
//! 크레이트의 `AcpAgent`로 띄우지 않는다. 그것은 env를 덧붙이기만 하고 자식을 새 세션이 아니라 새 그룹에만
//! 둔다. 여기서는 env를 **통째로 바꿔** 새 세션에 띄우고(워크플로 함정 28), stdio를 스레드 둘로 `Lines`에 문다.
//!
//! 런타임은 파일을 쓰지 않는다 — 받은 것을 원문으로 호출자에게 넘길 뿐이다. 기록은 호스트가 쓴다
//! (구현 축의 엔진이 같은 런타임을 쓴다, three-axes 결정 12).

use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::fmt;
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use agent_client_protocol::{Agent as AgentRole, Client, ConnectionTo, JsonRpcRequest, Lines, Responder, UntypedMessage};
use futures::channel::{mpsc as async_mpsc, oneshot};
use futures::SinkExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::life::{Death, Life};
use crate::login::AUTH_REQUIRED;
use crate::process;
use crate::redact;

/// 끄기에서 stdin을 닫은 뒤 스스로 끝나기를 기다리는 시간(워크플로 §7). 넘으면 그룹째 SIGKILL이다.
pub(crate) const SHUTDOWN_GRACE: Duration = Duration::from_secs(1);

/// 띄울 것 — 명령 + 인자 + 통째로 줄 env + cwd.
pub(crate) struct Launch {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env: BTreeMap<OsString, OsString>,
    pub cwd: PathBuf,
}

/// 세션을 여는 자리 — `session/new`의 cwd와 함께 여는 폴더(three-axes 결정 17).
pub(crate) struct SessionPlace {
    pub cwd: PathBuf,
    pub additional_directories: Vec<PathBuf>,
}

/// 세션을 열 때의 조건 — 에이전트에게 더 싣는 것과, 받기 전에 확인하는 것.
#[derive(Debug, Clone, Default)]
pub(crate) struct OpenTerms {
    /// `session/new`에 실을 `_meta`. Claude 변환기는 여기서 claude의 자리와 모드 · 모델을 받는다(three-axes 티켓 13).
    pub meta: Option<Value>,
    /// 에이전트가 `initialize`의 `agentInfo.version`에 실어야 하는 판. 다르면 `session/new`를 보내지 않고 열기를 실패시킨다
    /// — 앱의 하위 모드로 도는 변환기가 앱과 다른 판이면(설치본을 갈아 끼우는 틈에 띄웠다) 쓰지 않는다(워크플로 S4).
    pub required_version: Option<String>,
    /// 되살릴 에이전트 쪽 세션 id(three-axes 티켓 10). 있으면 resume → load → 새 세션 순으로 열고, 없으면 곧바로 새 세션이다.
    pub revive: Option<String>,
}

/// 세션이 열린 길 — 열림 줄의 `how`다(three-axes 티켓 10).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum How {
    /// 되살릴 세션이 없어 새로 열었다 — 새 대화의 첫 열기.
    New,
    /// `session/resume`으로 이었다 — 맥락이 이어진다.
    Resumed,
    /// `session/load`로 이었다 — 맥락이 이어진다. 응답 전에 온 재생 update는 버렸다.
    Loaded,
    /// 되살리려 했지만 resume도 load도 못 해 새 세션으로 열었다 — 맥락을 잇지 못했다(스토리 86).
    Fresh,
}

impl How {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            How::New => "new",
            How::Resumed => "resumed",
            How::Loaded => "loaded",
            How::Fresh => "fresh",
        }
    }

    /// 에이전트 쪽 세션이 이 열기에서 새로 섰나 — 그러면 그 세션의 첫 말에 머리말을 붙인다(S11).
    pub(crate) fn starts_session(self) -> bool {
        matches!(self, How::New | How::Fresh)
    }
}

/// 런타임이 호출자에게 넘기는 것. 받은 것을 **원문 그대로, 온 순서대로** 넘긴다 — 스키마 타입으로 다시
/// 짓지 않으므로 모르는 kind도 산다(three-axes 결정 12, 스토리 123).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum RuntimeEvent {
    /// `session/update`의 params 원문. 턴 안이든 밖이든 온 대로 넘긴다.
    Update(Value),
    /// `session/prompt`의 답 — 턴 하나의 끝.
    TurnEnd(TurnEnd),
    /// 에이전트의 stderr 한 줄(끝 줄바꿈을 뗀 것).
    Stderr(String),
    /// Codex의 `_auth/status_update` params — 계정 칸을 가린 원문.
    AuthStatus(Value),
    /// 세션이 열린 뒤 에이전트가 사라졌다 — 수신 EOF와 자식의 끝 가운데 먼저 온 쪽. 한 번만 온다. 그 전에 받은
    /// stderr 줄은 다 넘긴 뒤다. 우리가 끈 것은 죽음이 아니다.
    Died(Death),
    /// 권한 요청이 왔다. 대기 요청 표에 넣은 뒤에 넘긴다 — 이것을 받은 쪽은 곧바로 답할 수 있다.
    PermissionAsked(PermissionAsked),
    /// 걸린 권한 요청에 고른 선택지로 답한다. 에이전트에 답을 보내기 **전에** 넘긴다 — 답을 받은 에이전트가 이어 보내는
    /// update보다 앞에 선다.
    PermissionAnswered { request_id: String, option_id: String },
    /// 걸린 권한 요청이 거둬졌다 — 우리가 턴을 끊었거나, 에이전트가 답을 기다리지 않고 턴을 끝냈거나, 에이전트가 죽었다. 그
    /// 턴의 끝(죽음이면 죽음)보다 앞에 넘긴다.
    PermissionWithdrawn { request_id: String, reason: Withdrawal },
}

/// 권한 요청 하나(`session/request_permission`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PermissionAsked {
    /// JSON-RPC 요청 id를 글로 — 답할 때 이것으로 고른다. Codex는 0부터 센다.
    pub request_id: String,
    /// 요청의 params 원문. 선택지(`options`)는 에이전트가 준 그대로다.
    pub request: Value,
    /// 도구 요지 — 요청의 `toolCall`에서 빈 칸(제목 · 종류 · 입력)을 같은 id의 앞선 `tool_call`로 채운 것. Codex의 MCP
    /// 승인은 id · 종류 · 상태만 싣는다(워크플로 S21). 이을 것이 없으면 받은 그대로다.
    pub tool_call: Value,
}

/// 권한 요청이 거둬진 까닭.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Withdrawal {
    /// 우리가 턴을 끊었다 — 그 요청에 `cancelled`로 답했다.
    Stopped,
    /// 에이전트가 답을 기다리지 않고 턴을 끝냈다.
    Agent,
    /// 에이전트 프로세스가 죽었다 — 답할 곳이 없다(three-axes 티켓 10).
    Died,
}

/// 권한 답이 가지 못한 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AnswerError {
    /// 걸려 있지 않은 요청 — 이미 답했거나 거둬졌거나, 그런 요청이 없었다.
    Closed,
    /// 그 요청이 준 선택지에 없는 optionId. 요청은 그대로 걸려 있다.
    UnknownOption,
    /// 에이전트에 답을 보내지 못했다(연결이 끊겼다).
    Send(String),
}

/// 턴 하나의 끝.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TurnEnd {
    /// `session/prompt`의 답 원문(`stopReason` · `usage` …), 또는 에이전트가 말을 받지 않은 오류
    /// (`{code, message, data?}`).
    pub result: Result<Value, Value>,
    /// 그 턴에 우리가 `session/cancel`을 보냈나. Codex는 거부 선택지도 `cancelled`로 끝내므로 이 표지로 가른다
    /// (워크플로 함정 14).
    pub cancelled_by_us: bool,
}

/// 런타임의 일을 받는 곳. 수신 루프 · stderr 스레드 · 죽음을 지켜보는 스레드에서 불리므로 **이 안에서 런타임이나 호스트를 다시 부르지
/// 않는다** — 받은 것을 적고 넘기는 데까지가 이 자리의 일이다.
pub(crate) type Sink = Arc<dyn Fn(RuntimeEvent) + Send + Sync>;

/// 턴을 열고 멈추는 손잡이 — 열린 연결과 에이전트 쪽 세션 id. 복제해 쥔다: 호스트는 명령 스레드에서도, 턴 끝을 받은
/// 수신 루프 안에서도(대기 줄의 다음 말) 이것으로 보낸다. 둘 다 기다리지 않는 부름이라 수신 루프를 막지 않는다.
#[derive(Clone)]
pub(crate) struct Turns {
    connection: ConnectionTo<AgentRole>,
    session_id: String,
    /// 턴 끝을 넘길 곳. **약하게 쥔다** — 호스트의 대화가 이 손잡이를 쥐고 sink가 그 대화를 쥐므로, 강하게 쥐면 순환이
    /// 생긴다. 강한 쪽은 에이전트 프로세스(`AgentProcess`)와 그 스레드들이 산 동안 쥔다.
    sink: Weak<dyn Fn(RuntimeEvent) + Send + Sync>,
    /// 지금 턴의 「우리가 cancel을 보냈나」. 턴마다 새 표지를 세우고, 그 턴의 답이 자기 표지를 읽는다 — 앞 턴의 멈추기가
    /// 다음 턴에 묻어 가지 않는다.
    cancel_sent: Arc<Mutex<Arc<AtomicBool>>>,
    /// 대기 요청 표 — 수신 루프의 권한 요청 처리기와 함께 쥔다.
    permissions: Arc<Permissions>,
}

/// 대기 요청 표 — 답을 기다리는 권한 요청들과, 빈 `toolCall`을 채울 앞선 도구 요지들.
///
/// 권한 요청을 받은 자리(수신 루프)에서 사람을 기다릴 수는 없다 — 붙잡으면 답하는 동안 에이전트의 다른 메시지가 하나도
/// 들어오지 못한다. 그래서 **답할 자리만 여기 챙겨 두고 루프를 놓는다**(8월 크레이트 `Pending` 그대로).
///
/// 표의 잠금은 넘기는 일까지 감싼다 — 답 · 거두기 · 턴 끝의 거두기가 서로 엇갈려도 한 요청은 한 번만 닫히고, 닫힌 줄이
/// 턴 끝보다 앞에 선다. 잠금 안에서 부르는 sink는 기록만 하고 대화의 잠금을 쥐지 않는다.
#[derive(Default)]
struct Permissions {
    pending: Mutex<Vec<Pending>>,
    /// 에이전트가 죽어 표를 닫았다 — 그 뒤에 늦게 넘어온 요청도 곧바로 거둔다. `pending`의 잠금 안에서만 읽고 쓴다.
    closed: AtomicBool,
    /// 앞선 `tool_call`의 요지(제목 · 종류 · 입력) — 도구 id로 찾는다. 세션이 사는 동안 쥔다.
    tool_calls: Mutex<HashMap<String, serde_json::Map<String, Value>>>,
}

/// 답을 기다리는 권한 요청 하나 — 답할 자리와 에이전트가 준 선택지들.
struct Pending {
    request_id: String,
    option_ids: Vec<String>,
    responder: Responder<Value>,
}

/// 도구 요지로 채우는 칸 — 제목 · 종류 · 입력(워크플로 S21).
const TOOL_SUMMARY: [&str; 3] = ["title", "kind", "rawInput"];

impl Permissions {
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Pending>> {
        self.pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// `session/update` 하나를 본다 — `tool_call`이면 요지를 적고, `tool_call_update`면 온 칸을 덧쓴다.
    fn note_update(&self, params: &Value) {
        let update = &params["update"];
        let (Some(kind), Some(id)) = (update["sessionUpdate"].as_str(), update["toolCallId"].as_str()) else { return };
        if kind != "tool_call" && kind != "tool_call_update" {
            return;
        }
        let mut calls = self.tool_calls.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let summary = calls.entry(id.to_owned()).or_default();
        for key in TOOL_SUMMARY {
            if let Some(value) = update.get(key).filter(|value| !value.is_null()) {
                summary.insert(key.to_owned(), value.clone());
            }
        }
    }

    /// 요청의 `toolCall`에서 비었거나 없는 요지 칸을 같은 id의 앞선 도구 요지로 채운다. 온 칸은 그대로 둔다.
    fn fill(&self, tool_call: &Value) -> Value {
        let mut filled = tool_call.clone();
        let Some(id) = tool_call["toolCallId"].as_str() else { return filled };
        let calls = self.tool_calls.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let (Some(summary), Some(fields)) = (calls.get(id), filled.as_object_mut()) else { return filled };
        for (key, value) in summary {
            if fields.get(key).is_none_or(Value::is_null) {
                fields.insert(key.clone(), value.clone());
            }
        }
        filled
    }

    /// 에이전트가 죽었다 — 걸린 요청을 모두 「거둬짐(죽음)」으로 거두고 표를 닫는다. 닫힌 뒤에 넘어온 요청(죽음과 엇갈려 늦게
    /// 읽힌 줄)도 받는 자리에서 곧바로 거둔다 — 죽은 대화에 승인 카드가 남지 않는다.
    fn close(&self, sink: &Sink) {
        let mut pending = self.lock();
        self.closed.store(true, Ordering::SeqCst);
        Self::withdraw_all(&mut pending, Withdrawal::Died, sink);
    }

    /// 걸린 요청을 모두 거둔다 — 까닭을 넘기고 `cancelled`로 답한다. 표의 잠금을 쥔 채 부른다.
    fn withdraw_all(pending: &mut Vec<Pending>, reason: Withdrawal, sink: &Sink) {
        for asked in pending.drain(..) {
            sink(RuntimeEvent::PermissionWithdrawn { request_id: asked.request_id, reason });
            // 답을 기다리지 않는 에이전트에게도 답은 간다 — JSON-RPC의 요청은 모두 답을 받는다. 연결이 끊겼으면 갈 곳이 없다.
            let _ = asked.responder.respond(json!({"outcome": {"outcome": "cancelled"}}));
        }
    }
}

/// `session/request_permission` 요청을 **원문 그대로** 받는다 — 카드에 무엇을 그릴지는 화면이 정하고, 기록은 에이전트가
/// 보낸 것을 그대로 안는다(8월 크레이트 그대로). 답도 날 JSON이다.
#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "session/request_permission", response = serde_json::Value)]
#[serde(transparent)]
struct RawPermissionRequest(Value);

/// 열린 세션 — 에이전트가 준 원문 그대로다.
pub(crate) struct Opened {
    /// `initialize`의 답. 광고한 능력(`agentCapabilities.loadSession` · `sessionCapabilities.resume`)과
    /// `agentInfo`가 여기 있다 — 되살리기(10)가 이것을 본다.
    pub initialize: Value,
    /// 세션을 연 답(`session/new` · `session/resume` · `session/load`) — 모드 · 모델 · configOptions.
    pub session: Value,
    /// 에이전트 쪽 세션 id — 새 세션이면 답의 것, 되살렸으면 되살린 그 id다(resume · load의 답에는 id가 없다).
    pub session_id: String,
    /// 어느 길로 열렸나.
    pub how: How,
}

/// 열지 못한 까닭. 어느 경우든 띄운 프로세스는 그룹째 끈 뒤에 돌아온다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OpenError {
    /// 실행할 수 없음 — 없는 파일 · 실행 형식이 아님 · cwd가 없음.
    Spawn { program: PathBuf, reason: String },
    /// 떴지만 ACP로 세션을 열지 못함 — 오류 답, 답 없이 끝남, ACP가 아닌 말.
    Protocol { program: PathBuf, reason: String },
    /// 한도 안에 세션을 열지 않음.
    TimedOut { program: PathBuf, limit: Duration },
    /// 에이전트가 세션 열기를 「로그인 필요」(`-32000 Authentication required`)로 거절했다 — Codex의 미로그인이다
    /// (실측 A3). initialize는 됐다. 프로세스는 끈 뒤다(three-axes 티켓 12).
    AuthRequired { program: PathBuf },
}

impl fmt::Display for OpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OpenError::Spawn { program, reason } => {
                write!(f, "에이전트를 실행할 수 없습니다: {} — {reason}", program.display())
            }
            OpenError::Protocol { program, reason } => {
                write!(f, "에이전트가 ACP 세션을 열지 못했습니다: {} — {reason}", program.display())
            }
            OpenError::TimedOut { program, limit } => {
                write!(f, "에이전트가 {}초 안에 세션을 열지 않았습니다: {}", limit.as_secs_f32(), program.display())
            }
            OpenError::AuthRequired { program } => {
                write!(f, "에이전트가 로그인을 요구합니다: {}", program.display())
            }
        }
    }
}

/// 살아 있는 에이전트 프로세스 하나와 그 ACP 연결.
pub(crate) struct AgentProcess {
    pid: u32,
    /// 거두지 않은 자식. 끈 뒤에 `None`이다.
    child: Option<Child>,
    /// 쓰는 스레드와 함께 쥔다. 끄기가 꺼내 떨어뜨리면 에이전트가 stdin EOF를 받는다.
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    life: Arc<Life>,
    /// 연결 클로저를 풀어 주는 신호.
    release: Option<oneshot::Sender<()>>,
    /// 열린 세션의 턴 손잡이. 열기 전과 끈 뒤에는 `None`이다.
    turns: Option<Turns>,
    /// [`Turns`]가 약하게 쥐는 sink를 이 프로세스가 사는 동안 붙든다.
    sink: Sink,
}

/// 세션이 열린 순간 부르는 것. 수신 루프의 순서 장벽 안에서 돈다 — `session/new`의 답 뒤에 온 메시지는 이것이
/// 끝난 뒤에야 `sink`로 간다. 그래서 「열림」을 적으면 기록의 순서가 받은 순서와 같다.
pub(crate) type OnOpened = Box<dyn FnOnce(&Opened) + Send>;

/// 띄우고, initialize하고, 세션을 연다. 막히는 호출이다 — `limit` 안에 세션이 열리지 않으면 끄고 실패한다.
///
/// 띄운 순간부터 받은 것은 `sink`로 넘기고, 세션이 열리면 그 자리에서 `on_opened`를 부른다.
pub(crate) fn open(
    launch: Launch,
    place: SessionPlace,
    terms: OpenTerms,
    limit: Duration,
    sink: Sink,
    on_opened: OnOpened,
) -> Result<(AgentProcess, Opened), OpenError> {
    let program = launch.program.clone();
    let mut command = Command::new(&launch.program);
    command
        .args(&launch.args)
        .env_clear()
        .envs(&launch.env)
        .current_dir(&launch.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    process::in_new_session(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| OpenError::Spawn { program: program.clone(), reason: error.to_string() })?;
    let pid = child.id();
    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let stdout = child.stdout.take().expect("stdout을 파이프로 띄웠다");
    let stderr = child.stderr.take().expect("stderr를 파이프로 띄웠다");
    let life = Life::new();
    let exits = Arc::clone(&life);
    process::watch_exit(pid, move |exit| exits.exited(exit));
    read_stderr(stderr, Arc::clone(&life), Arc::clone(&sink));
    let permissions = Arc::new(Permissions::default());
    let deaths = Arc::clone(&sink);
    let orphaned = Arc::clone(&permissions);
    life.watch_death(pid, move |death| {
        // 걸린 권한 요청은 답할 곳이 없다 — 「거둬짐(죽음)」을 죽음 줄 앞에 넘긴다(three-axes 티켓 10).
        orphaned.close(&deaths);
        deaths(RuntimeEvent::Died(death));
    });

    let (outgoing, outgoing_lines) = async_mpsc::unbounded::<String>();
    write_lines(outgoing_lines, Arc::clone(&stdin));
    let (incoming_lines, incoming) = async_mpsc::unbounded::<std::io::Result<String>>();
    read_lines(stdout, incoming_lines, Arc::clone(&life));
    let transport = Lines::new(outgoing.sink_map_err(std::io::Error::other), incoming);

    let (outcome_tx, outcome_rx) = mpsc::channel::<Result<(Opened, ConnectionTo<AgentRole>), Refusal>>();
    let (release, released) = oneshot::channel::<()>();
    let notified = Arc::clone(&sink);
    let asked = Arc::clone(&sink);
    let noted = Arc::clone(&permissions);
    let tabled = Arc::clone(&permissions);
    // `session/load`의 답이 오기 전에 온 update(재생)를 버리는 동안 선다. load를 보내기 직전에 켜고, load 답의 순서 장벽 안에서
    // 끈다 — 그래서 답 앞의 update는 버려지고 답 뒤의 것은 산다.
    let replaying = Arc::new(AtomicBool::new(false));
    let skipped = Arc::clone(&replaying);
    std::thread::spawn(move || {
        let failure = outcome_tx.clone();
        let builder = Client
            .builder()
            .name("atelier")
            .on_receive_notification(
                // 수신 루프 안에서 돈다 — 콜백 하나가 끝나야 다음 메시지를 보므로 **도착 순서가 곧 넘기는 순서**다.
                async move |message: UntypedMessage, _cx: ConnectionTo<AgentRole>| {
                    match message.method.as_str() {
                        // 화면은 앱의 기록으로 그린다 — load가 되감는 과거는 기록에 두 번 쌓이지 않게 버린다(티켓 10).
                        "session/update" if skipped.load(Ordering::SeqCst) => {}
                        "session/update" => {
                            noted.note_update(&message.params);
                            notified(RuntimeEvent::Update(message.params));
                        }
                        "_auth/status_update" => notified(RuntimeEvent::AuthStatus(mask_account(message.params))),
                        // 그 밖의 알림은 이 판이 쓰지 않는다.
                        _ => {}
                    }
                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .on_receive_request(
                // 권한 요청. **여기서 사람을 기다리지 않는다** — 이 콜백도 수신 루프 안에서 돌아, 붙잡으면 답하는 동안 다른
                // 메시지가 멎는다. 답할 자리를 표에 넣고 곧바로 놓는다. 표에 먼저 넣고 넘긴다 — 넘긴 것을 본 사람이 곧바로
                // 눌러도 답할 자리가 있다.
                async move |request: RawPermissionRequest, responder: Responder<Value>, _cx: ConnectionTo<AgentRole>| {
                    let request = request.0;
                    let request_id = responder.id().to_string();
                    let option_ids = request["options"]
                        .as_array()
                        .map(|options| options.iter().filter_map(|option| option["optionId"].as_str()).map(str::to_owned).collect())
                        .unwrap_or_default();
                    let tool_call = tabled.fill(&request["toolCall"]);
                    let mut pending = tabled.lock();
                    let orphan = tabled.closed.load(Ordering::SeqCst);
                    pending.push(Pending { request_id: request_id.clone(), option_ids, responder });
                    asked(RuntimeEvent::PermissionAsked(PermissionAsked { request_id, request, tool_call }));
                    if orphan {
                        // 죽은 에이전트의 늦은 줄이다 — 넘긴 자리에서 곧바로 거둔다.
                        Permissions::withdraw_all(&mut pending, Withdrawal::Died, &asked);
                    }
                    Ok(())
                },
                agent_client_protocol::on_receive_request!(),
            );
        let ran = futures::executor::block_on(builder.connect_with(
            transport,
            async move |cx: ConnectionTo<AgentRole>| {
                let opened = open_session(&cx, &place, &terms, &replaying, on_opened).await;
                let opened_ok = opened.is_ok();
                let _ = outcome_tx.send(opened.map(|opened| (opened, cx.clone())));
                if opened_ok {
                    // 끄기 신호가 올 때까지, **또는 저쪽이 사라질 때까지** 연결을 쥔다.
                    let gone = std::pin::pin!(cx.incoming_closed());
                    let _ = futures::future::select(released, gone).await;
                }
                Ok(())
            },
        ));
        // 클로저가 돌지 못하고 연결이 끝났으면 이 통로로만 소식이 나간다.
        if let Err(error) = ran {
            let _ = failure.send(Err(Refusal::Other(error.to_string())));
        }
    });

    let mut agent = AgentProcess {
        pid,
        child: Some(child),
        stdin,
        life,
        release: Some(release),
        turns: None,
        sink,
    };
    let failed = |reason: String| OpenError::Protocol { program: program.clone(), reason };
    match outcome_rx.recv_timeout(limit) {
        Ok(Ok((opened, cx))) => {
            agent.turns = Some(Turns {
                connection: cx,
                session_id: opened.session_id.clone(),
                sink: Arc::downgrade(&agent.sink),
                cancel_sent: Arc::new(Mutex::new(Arc::new(AtomicBool::new(false)))),
                permissions,
            });
            // 이제부터의 끝은 죽음이다. 그 전의 끝은 열기 실패로 알렸다.
            agent.life.arm();
            Ok((agent, opened))
        }
        Ok(Err(Refusal::AuthRequired)) => {
            agent.shut_down();
            Err(OpenError::AuthRequired { program })
        }
        Ok(Err(Refusal::Other(reason))) => {
            agent.shut_down();
            Err(failed(reason))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            agent.shut_down();
            Err(failed("답 없이 연결이 끝났습니다".to_string()))
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            agent.shut_down();
            Err(OpenError::TimedOut { program, limit })
        }
    }
}

/// 세션을 열지 못한 까닭 — 에이전트가 로그인을 요구했나, 그 밖의 것인가.
enum Refusal {
    AuthRequired,
    Other(String),
}

impl From<String> for Refusal {
    fn from(reason: String) -> Self {
        Refusal::Other(reason)
    }
}

/// initialize → 세션 열기. 모두 날 JSON으로 보낸다 — 2.0 크레이트의 타입으로는 `clientCapabilities.plan`을 실을 수
/// 없고(기능 뒤에 숨어 있다), 답은 원문 그대로 넘긴다.
///
/// 되살릴 세션 id(`terms.revive`)가 있으면 resume → load → 새 세션 순이다(three-axes 티켓 10 · 워크플로 §7). 앞 단계의 오류는
/// 다음 단계로 넘어간다. 에이전트가 광고하지 않은 단계(`sessionCapabilities.resume` · `agentCapabilities.loadSession`)는
/// 건너뛴다. 그 id가 없으면 곧바로 새 세션이다.
///
/// 세션을 연 답은 순서 장벽(`on_receiving_result`)으로 받는다 — 진짜 codex-acp는 `session/new` · `session/resume`의 답 바로
/// 뒤에 명령 목록을 보내는데(실측 turns 5 · 6줄 · session-resume), 다른 자리에서 답을 기다리면 그 update가 「열림」보다 앞에
/// 적힌다. `session/load`는 답 **전에** 과거를 되감는다(실측 session-load-replay) — 그 동안의 update는 `replaying`이 버린다.
///
/// 새 세션이 `-32000`이면 로그인 필요다(실측 A3) — 다른 거절과 갈라 넘긴다.
async fn open_session(
    cx: &ConnectionTo<AgentRole>,
    place: &SessionPlace,
    terms: &OpenTerms,
    replaying: &Arc<AtomicBool>,
    on_opened: OnOpened,
) -> Result<Opened, Refusal> {
    let initialize = request(cx, "initialize", initialize_params()).await?;
    if let Some(required) = &terms.required_version {
        let version = initialize["agentInfo"]["version"].as_str();
        if version != Some(required.as_str()) {
            return Err(Refusal::Other(format!(
                "판 어긋남 — 에이전트 {} · 앱 {required}. 앱을 다시 켜면 맞는 판이 뜹니다",
                version.unwrap_or("(판 없음)")
            )));
        }
    }

    // three-axes 결정 23 — MCP는 사용자 설정 그대로다. 앱이 세션에 따로 넣는 것은 없다.
    let mut params = serde_json::Map::new();
    params.insert("cwd".into(), json!(place.cwd));
    if !place.additional_directories.is_empty() {
        params.insert("additionalDirectories".into(), json!(place.additional_directories));
    }
    params.insert("mcpServers".into(), json!([]));
    if let Some(meta) = &terms.meta {
        params.insert("_meta".into(), meta.clone());
    }

    let on_opened = Arc::new(Mutex::new(Some(on_opened)));
    if let Some(session_id) = &terms.revive {
        let mut revive = params.clone();
        revive.insert("sessionId".into(), json!(session_id));
        let steps = [
            ("session/resume", How::Resumed, !initialize["agentCapabilities"]["sessionCapabilities"]["resume"].is_null()),
            ("session/load", How::Loaded, initialize["agentCapabilities"]["loadSession"] == true),
        ];
        for (method, how, advertised) in steps {
            if !advertised {
                continue;
            }
            let replay = (how == How::Loaded).then(|| Arc::clone(replaying));
            let step = Step { method, how, initialize: &initialize, session_id: Some(session_id), replay };
            // 오류는 다음 단계로 넘어간다 — 까닭은 남기지 않는다. 열림 줄의 길이 결과를 말한다.
            if let Ok(opened) = step.send(cx, &revive, &on_opened).await {
                return Ok(opened);
            }
        }
    }
    let how = if terms.revive.is_some() { How::Fresh } else { How::New };
    Step { method: "session/new", how, initialize: &initialize, session_id: None, replay: None }
        .send(cx, &params, &on_opened)
        .await
}

/// 세션을 여는 요청 하나 — `session/new` · `session/resume` · `session/load`.
struct Step<'a> {
    method: &'static str,
    how: How,
    initialize: &'a Value,
    /// 되살리는 세션 id. 새 세션이면 `None`이고 id는 답에서 읽는다.
    session_id: Option<&'a String>,
    /// load면 답이 올 때까지 update를 버리는 표지.
    replay: Option<Arc<AtomicBool>>,
}

impl Step<'_> {
    /// 보내고 답을 순서 장벽으로 받는다. 열리면 그 자리에서 `on_opened`를 한 번 부른다.
    async fn send(
        self,
        cx: &ConnectionTo<AgentRole>,
        params: &serde_json::Map<String, Value>,
        on_opened: &Arc<Mutex<Option<OnOpened>>>,
    ) -> Result<Opened, Refusal> {
        let Step { method, how, initialize, session_id, replay } = self;
        let message = UntypedMessage::new(method, Value::Object(params.clone())).map_err(|error| error.to_string())?;
        let (opened_tx, opened_rx) = oneshot::channel::<Result<Opened, Refusal>>();
        let initialize = initialize.clone();
        let asked_id = session_id.cloned();
        let on_opened = Arc::clone(on_opened);
        let replay_flag = replay.clone();
        if let Some(replay) = &replay {
            replay.store(true, Ordering::SeqCst);
        }
        let sent = cx
            .send_request(message)
            .on_receiving_result(async move |result| {
                // 답이 왔다 — 이 뒤의 update는 재생이 아니다.
                if let Some(replay) = &replay {
                    replay.store(false, Ordering::SeqCst);
                }
                let outcome = match result {
                    Ok(session) => match asked_id.or_else(|| session["sessionId"].as_str().map(str::to_owned)) {
                        Some(session_id) => {
                            let opened = Opened { initialize, session, session_id, how };
                            if let Some(on_opened) = on_opened.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
                                on_opened(&opened);
                            }
                            Ok(opened)
                        }
                        None => Err(Refusal::Other(format!("{method}의 답에 sessionId가 없습니다: {session}"))),
                    },
                    Err(error) if i32::from(error.code) == AUTH_REQUIRED => Err(Refusal::AuthRequired),
                    Err(error) => Err(Refusal::Other(describe(method, &error))),
                };
                let _ = opened_tx.send(outcome);
                Ok(())
            })
            .map_err(|error| error.to_string());
        if let Err(error) = sent {
            if let Some(replay) = replay_flag {
                replay.store(false, Ordering::SeqCst);
            }
            return Err(Refusal::Other(error));
        }
        opened_rx.await.map_err(|_| Refusal::Other(format!("{method}에 답하지 않고 끝났습니다")))?
    }
}

/// 원문의 **유일한 예외** — 계정 이메일 · 플랜을 `<email>`로 가린다(워크플로 S34). 기록이 fixture나 이슈로
/// 옮겨져도 계정이 새지 않게 한다(스토리 115). Codex는 `_auth/status_update`의 `authStatus.account`에 싣는다.
/// 그 칸 아래의 글자 값은 다 가리고, 나머지 칸(`kind` · `label`)은 그대로 둔다.
///
/// Claude 쪽 자리(`initialize`의 `account` · `init.plugins[].path`)는 claude의 원문을 처음 읽는 변환기가 가린다(티켓 13).
fn mask_account(mut params: Value) -> Value {
    if let Some(account) = params.pointer_mut("/authStatus/account") {
        redact::mask_strings(account);
    }
    params
}

/// 클라이언트가 광고하는 것.
/// - `fs` · `terminal`을 끈다 — 에이전트가 자기 도구로 파일과 셸을 다룬다.
/// - `plan:{}`를 광고한다 — Codex가 계획을 `plan_update`(마크다운)로 보낸다(three-axes 결정 29).
/// - `elicitation`은 광고하지 않는다 — device code 로그인 길을 쓰지 않는다(three-axes 결정 30).
fn initialize_params() -> Value {
    json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": {"readTextFile": false, "writeTextFile": false},
            "terminal": false,
            "plan": {}
        },
        "clientInfo": {"name": "atelier", "title": "Atelier", "version": env!("CARGO_PKG_VERSION")}
    })
}

async fn request(cx: &ConnectionTo<AgentRole>, method: &str, params: Value) -> Result<Value, String> {
    let message = UntypedMessage::new(method, params).map_err(|error| error.to_string())?;
    cx.send_request(message).block_task().await.map_err(|error| describe(method, &error))
}

/// 요청이 실패한 까닭 한 줄.
fn describe(method: &str, error: &agent_client_protocol::Error) -> String {
    if agent_client_protocol::is_incoming_transport_closed(error) {
        // 에이전트가 끝났거나 ACP가 아닌 프로그램이다 — 크레이트의 진단 JSON보다 이 한 줄이 읽힌다.
        format!("{method}에 답하지 않고 끝났습니다")
    } else {
        format!("{method}: {error}")
    }
}

/// 나가는 줄을 stdin에 쓰는 스레드. stdin이 이미 닫혔으면 줄을 버린다.
fn write_lines(lines: async_mpsc::UnboundedReceiver<String>, stdin: Arc<Mutex<Option<ChildStdin>>>) {
    std::thread::spawn(move || {
        for line in futures::executor::block_on_stream(lines) {
            let mut held = stdin.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(pipe) = held.as_mut() else { continue };
            if pipe.write_all(line.as_bytes()).and_then(|()| pipe.write_all(b"\n")).and_then(|()| pipe.flush()).is_err() {
                // 저쪽이 떠났다. 닫아 두면 뒤의 줄은 버려진다.
                *held = None;
            }
        }
    });
}

/// stderr를 줄 단위로 읽어 넘기는 스레드. 받는 쪽이 없어도 끝까지 읽는다 — 파이프가 차면 에이전트가 막힌다.
/// 줄마다 죽음 줄에 실을 꼬리에도 더한다.
fn read_stderr(stderr: ChildStderr, life: Arc<Life>, sink: Sink) {
    std::thread::spawn(move || {
        process::for_each_line(BufReader::new(stderr), |line| {
            let line = process::line_text(line);
            life.stderr_line(&line);
            sink(RuntimeEvent::Stderr(line));
        });
        life.stderr_closed();
    });
}

/// stdout을 줄 단위로 읽어 넘기는 스레드. EOF면 통로를 닫는다 — 그것이 연결의 수신 EOF이고, 생애에도 알린다.
fn read_lines(stdout: ChildStdout, lines: async_mpsc::UnboundedSender<std::io::Result<String>>, life: Arc<Life>) {
    std::thread::spawn(move || {
        process::for_each_line(BufReader::new(stdout), |line| {
            // 받는 쪽(연결)이 먼저 끝났어도 끝까지 읽는다 — EOF를 생애에 알려야 한다.
            let _ = lines.unbounded_send(Ok(process::line_text(line)));
        });
        drop(lines);
        life.closed_output();
    });
}

impl AgentProcess {
    /// 열린 세션의 턴 손잡이. 끈 뒤에는 `None`이다.
    pub(crate) fn turns(&self) -> Option<Turns> {
        self.turns.clone()
    }

    /// 끄기의 앞 절반 — stdin을 닫고 연결을 놓는다. 기다리지 않는다. 이 뒤의 끝은 죽음으로 알리지 않는다.
    ///
    /// 여러 대화를 함께 끌 때(호스트 끄기) 모두의 앞 절반을 먼저 돌고 1초를 **한 번만** 기다린다.
    pub(crate) fn begin_shutdown(&mut self) {
        self.life.stop();
        // 쓰는 스레드가 막힌 채 쥐고 있으면(에이전트가 stdin을 읽지 않는다) 닫지 못한다. 그때는 SIGKILL이 끝낸다.
        if let Ok(mut stdin) = self.stdin.try_lock() {
            stdin.take();
        }
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
    }

    /// 끄기의 뒤 절반 — `deadline`까지 스스로 끝나기를 기다리고, 프로세스 그룹째 SIGKILL하고, 거둔다.
    ///
    /// 스스로 끝났어도 그룹을 끈다 — 에이전트가 낳은 후손(Codex의 app-server · 셸 도구)이 그룹에 남는다.
    pub(crate) fn finish_shutdown(&mut self, deadline: Instant) {
        let Some(mut child) = self.child.take() else { return };
        let exited = self.life.wait_exit(deadline);
        // 거두기 전에 끈다 — 끝난 리더도 거두기 전에는 그 번호를 쥐고 있어, 그룹 번호가 남에게 가지 않는다.
        self.life.kill_before_reaping(self.pid);
        if !exited && !self.life.wait_exit(Instant::now() + Duration::from_secs(5)) {
            // 그룹 신호가 리더에 닿지 않았다. 리더만이라도 직접 끄고 거둔다 — 거두기가 끝없이 막히지 않게.
            let _ = child.kill();
        }
        let _ = child.wait();
        self.turns = None;
    }

    /// stdin 닫기 → 1초 → 그룹째 SIGKILL.
    pub(crate) fn shut_down(&mut self) {
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        self.begin_shutdown();
        self.finish_shutdown(deadline);
    }
}

impl Turns {
    /// 턴 하나를 연다 — `session/prompt` 하나가 턴 하나다. 기다리지 않는다: 턴의 update와 끝은 sink로 온다.
    ///
    /// 답은 **수신 루프 안의 순서 장벽**으로 받는다(`on_receiving_result`). 다른 스레드에서 답을 기다리면 그
    /// 스레드가 깨는 사이 루프가 다음 메시지를 먼저 넘겨, 턴 뒤에 온 update가 턴 끝보다 앞에 선다. 등록은 곧바로
    /// 돌아오므로 수신 루프 안(앞 턴의 끝)에서 불러도 된다.
    ///
    /// 에이전트가 답 없이 사라지면 턴 끝은 오지 않는다 — 프로세스 죽음이 그 자리를 맡는다.
    pub(crate) fn prompt(&self, blocks: Vec<Value>) -> Result<(), String> {
        let message = UntypedMessage::new("session/prompt", json!({"sessionId": self.session_id, "prompt": blocks}))
            .map_err(|error| error.to_string())?;
        let cancel_sent = Arc::new(AtomicBool::new(false));
        *self.cancel_sent.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Arc::clone(&cancel_sent);
        let sink = self.sink.clone();
        let permissions = Arc::clone(&self.permissions);
        self.connection
            .send_request(message)
            .on_receiving_result(async move |result| {
                if let Err(error) = &result {
                    if agent_client_protocol::is_incoming_transport_closed(error) {
                        // 크레이트가 수신 EOF에 걸린 요청을 이 오류로 닫는다. 에이전트가 답 없이 사라진 것이라 턴
                        // 끝이 아니다 — 프로세스 죽음이 그 자리를 맡는다.
                        return Ok(());
                    }
                }
                // 끈 뒤에 온 답이다 — 받을 쪽이 없다.
                let Some(sink) = sink.upgrade() else { return Ok(()) };
                // 답을 받기 전에 에이전트가 턴을 끝냈다 — 걸린 권한 요청은 거둬진 것이다. 턴 끝보다 앞에 넘긴다. 표의 잠금을
                // 턴 끝을 넘기기 전에 놓는다 — 턴 끝을 받는 쪽은 대화의 잠금을 쥔다.
                Permissions::withdraw_all(&mut permissions.lock(), Withdrawal::Agent, &sink);
                let result = result.map_err(|error| {
                    serde_json::to_value(&error).unwrap_or_else(|_| json!({"message": error.to_string()}))
                });
                sink(RuntimeEvent::TurnEnd(TurnEnd { result, cancelled_by_us: cancel_sent.load(Ordering::SeqCst) }));
                Ok(())
            })
            .map_err(|error| format!("에이전트에 말을 보내지 못했습니다: {error}"))
    }

    /// 도는 턴을 멈춘다 — `session/cancel`을 보낸다. 기다리지 않는다: 턴의 끝(`cancelled`)은 sink로 오고, 그 턴 끝에
    /// 「우리가 멈췄나」가 실린다. 에이전트는 cancel 뒤에도 update를 보낼 수 있다(Codex의 돌던 명령, three-axes 결정 28)
    /// — 턴 끝 뒤에 온 것도 원문 그대로 sink로 간다.
    ///
    /// 걸린 권한 요청은 `cancelled`로 답하고 「거둬짐(턴이 끊김)」을 넘긴다(ACP 규칙). 진짜 codex-acp는 걸린 요청의 답을
    /// 기다리지 않고 cancel 뒤 곧바로 턴을 끝내므로(실측 G2), cancel을 보내고 요청을 거두는 동안 대기 요청 표를 쥔다 — 턴 끝이
    /// 먼저 와도 그 끝은 표가 빈 뒤에 넘어가, 「거둬짐(에이전트)」로 잘못 적히지 않고 거둬진 줄이 턴 끝보다 앞에 선다.
    pub(crate) fn cancel(&self) -> Result<(), String> {
        let mut pending = self.permissions.lock();
        // 보내기 전에 세운다 — 답이 먼저 와도 표지를 읽는다.
        self.cancel_sent.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).store(true, Ordering::SeqCst);
        let message = UntypedMessage::new("session/cancel", json!({"sessionId": self.session_id}))
            .map_err(|error| error.to_string())?;
        self.connection
            .send_notification(message)
            .map_err(|error| format!("에이전트에 멈추기를 보내지 못했습니다: {error}"))?;
        if let Some(sink) = self.sink.upgrade() {
            Permissions::withdraw_all(&mut pending, Withdrawal::Stopped, &sink);
        }
        Ok(())
    }

    /// 걸린 권한 요청에 고른 선택지로 답한다. 기다리지 않는다 — 답을 받은 에이전트가 이어 가는 턴은 sink로 온다.
    ///
    /// 걸려 있지 않은 요청(이미 답했거나 거둬졌다)이나 준 선택지에 없는 optionId는 읽히는 오류이고, 요청은 그대로 걸려
    /// 있다 — 맞는 답을 다시 줄 수 있다. 답은 넘긴 뒤에 보낸다 — 기록에서 답이 그 뒤의 update보다 앞에 선다.
    pub(crate) fn answer(&self, request_id: &str, option_id: &str) -> Result<(), AnswerError> {
        let mut pending = self.permissions.lock();
        let at = pending.iter().position(|asked| asked.request_id == request_id).ok_or(AnswerError::Closed)?;
        if !pending[at].option_ids.iter().any(|option| option == option_id) {
            return Err(AnswerError::UnknownOption);
        }
        let asked = pending.remove(at);
        if let Some(sink) = self.sink.upgrade() {
            sink(RuntimeEvent::PermissionAnswered { request_id: asked.request_id, option_id: option_id.to_owned() });
        }
        asked
            .responder
            .respond(json!({"outcome": {"outcome": "selected", "optionId": option_id}}))
            .map_err(|error| AnswerError::Send(format!("에이전트에 권한 답을 보내지 못했습니다: {error}")))
    }

    /// 답을 기다리는 권한 요청이 있나 — 그동안은 대기 줄이 가지 않는다(S13).
    pub(crate) fn permission_pending(&self) -> bool {
        !self.permissions.lock().is_empty()
    }

    /// 답을 기다리는 권한 요청 수 — 앱 종료 확인 창이 센다(three-axes 티켓 23).
    pub(crate) fn pending_permissions(&self) -> usize {
        self.permissions.lock().len()
    }

    /// 세션의 모드 · 설정을 바꾼다 — `session/set_mode` · `session/set_config_option`(three-axes 결정 16 · 27). `fields`는
    /// `sessionId` 밖의 인자(`{modeId}` · `{configId, value}`)다. 바뀐 값은 다음 턴부터 든다.
    ///
    /// 답을 `limit`까지 기다린다 — 에이전트가 거절하면(모르는 값) 그 까닭을 돌려준다. 답의 내용은 쓰지 않는다: 둘 다 알림이
    /// 없고 Codex는 `{}`나 `{configOptions}`로 답할 뿐이라, 값은 부른 쪽이 쥔다. **수신 루프 안에서 부르지 않는다** — 답을
    /// 받는 것이 그 루프다. 대화의 잠금을 쥔 채 부르지도 않는다: 루프가 턴 끝을 넘기며 그 잠금을 기다리면 답이 오지 않는다.
    pub(crate) fn change(&self, method: &'static str, fields: Value, limit: Duration) -> Result<(), String> {
        let mut params = serde_json::Map::new();
        params.insert("sessionId".into(), json!(self.session_id));
        if let Value::Object(fields) = fields {
            params.extend(fields);
        }
        let message = UntypedMessage::new(method, Value::Object(params)).map_err(|error| error.to_string())?;
        let (answered, answer) = mpsc::channel::<Result<(), String>>();
        self.connection
            .send_request(message)
            .on_receiving_result(async move |result| {
                let _ = answered.send(result.map(|_| ()).map_err(|error| describe(method, &error)));
                Ok(())
            })
            .map_err(|error| format!("에이전트에 {method}를 보내지 못했습니다: {error}"))?;
        match answer.recv_timeout(limit) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                Err(format!("에이전트가 {}초 안에 {method}에 답하지 않았습니다", limit.as_secs_f32()))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(format!("{method}에 답하지 않고 끝났습니다")),
        }
    }
}

impl Drop for AgentProcess {
    /// 끄지 않고 떨어뜨렸으면(호스트가 패닉으로 풀렸다) 기다리지 않고 그룹째 끈다. 고아를 남기지 않는다.
    fn drop(&mut self) {
        if self.child.is_some() {
            self.begin_shutdown();
            self.finish_shutdown(Instant::now());
        }
    }
}
