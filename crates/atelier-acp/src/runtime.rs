//! ACP 런타임 — 에이전트 프로세스 하나와 ACP로 말한다. 띄우기 · initialize · 세션 열기 · 끄기.
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

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fmt;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use agent_client_protocol::{Agent as AgentRole, Client, ConnectionTo, Lines, UntypedMessage};
use futures::channel::{mpsc as async_mpsc, oneshot};
use futures::SinkExt;
use serde_json::{json, Value};

use crate::process;

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

/// 열린 세션 — 에이전트가 준 원문 그대로다.
pub(crate) struct Opened {
    /// `initialize`의 답. 광고한 능력(`agentCapabilities.loadSession` · `sessionCapabilities.resume`)과
    /// `agentInfo`가 여기 있다 — 되살리기(10)가 이것을 본다.
    pub initialize: Value,
    /// `session/new`의 답 — 모드 · 모델 · configOptions.
    pub session: Value,
    pub session_id: String,
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
    exited: mpsc::Receiver<()>,
    /// 연결 클로저를 풀어 주는 신호.
    release: Option<oneshot::Sender<()>>,
    /// 열린 연결. 말 보내기(three-axes 티켓 04)가 이것으로 `session/prompt`를 보낸다.
    connection: Option<ConnectionTo<AgentRole>>,
}

/// 띄우고, initialize하고, 세션을 연다. 막히는 호출이다 — `limit` 안에 세션이 열리지 않으면 끄고 실패한다.
pub(crate) fn open(launch: Launch, place: SessionPlace, limit: Duration) -> Result<(AgentProcess, Opened), OpenError> {
    let program = launch.program.clone();
    let mut command = Command::new(&launch.program);
    command
        .args(&launch.args)
        .env_clear()
        .envs(&launch.env)
        .current_dir(&launch.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    process::in_new_session(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| OpenError::Spawn { program: program.clone(), reason: error.to_string() })?;
    let pid = child.id();
    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let stdout = child.stdout.take().expect("stdout을 파이프로 띄웠다");
    let exited = process::watch_exit(pid);

    let (outgoing, outgoing_lines) = async_mpsc::unbounded::<String>();
    write_lines(outgoing_lines, Arc::clone(&stdin));
    let (incoming_lines, incoming) = async_mpsc::unbounded::<std::io::Result<String>>();
    read_lines(stdout, incoming_lines);
    let transport = Lines::new(outgoing.sink_map_err(std::io::Error::other), incoming);

    let (outcome_tx, outcome_rx) = mpsc::channel::<Result<(Opened, ConnectionTo<AgentRole>), String>>();
    let (release, released) = oneshot::channel::<()>();
    std::thread::spawn(move || {
        let failure = outcome_tx.clone();
        let ran = futures::executor::block_on(Client.builder().name("atelier").connect_with(
            transport,
            async move |cx: ConnectionTo<AgentRole>| {
                let opened = open_session(&cx, &place).await;
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
            let _ = failure.send(Err(error.to_string()));
        }
    });

    let mut agent = AgentProcess { pid, child: Some(child), stdin, exited, release: Some(release), connection: None };
    let failed = |reason: String| OpenError::Protocol { program: program.clone(), reason };
    match outcome_rx.recv_timeout(limit) {
        Ok(Ok((opened, cx))) => {
            agent.connection = Some(cx);
            Ok((agent, opened))
        }
        Ok(Err(reason)) => {
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

/// initialize → `session/new`. 둘 다 날 JSON으로 보낸다 — 2.0 크레이트의 타입으로는 `clientCapabilities.plan`을
/// 실을 수 없고(기능 뒤에 숨어 있다), 답은 원문 그대로 넘긴다.
async fn open_session(cx: &ConnectionTo<AgentRole>, place: &SessionPlace) -> Result<Opened, String> {
    let initialize = request(cx, "initialize", initialize_params()).await?;

    // three-axes 결정 23 — MCP는 사용자 설정 그대로다. 앱이 세션에 따로 넣는 것은 없다.
    let mut params = serde_json::Map::new();
    params.insert("cwd".into(), json!(place.cwd));
    if !place.additional_directories.is_empty() {
        params.insert("additionalDirectories".into(), json!(place.additional_directories));
    }
    params.insert("mcpServers".into(), json!([]));
    let session = request(cx, "session/new", Value::Object(params)).await?;
    let session_id = session["sessionId"]
        .as_str()
        .ok_or_else(|| format!("session/new의 답에 sessionId가 없습니다: {session}"))?
        .to_owned();
    Ok(Opened { initialize, session, session_id })
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
    cx.send_request(message).block_task().await.map_err(|error| {
        if agent_client_protocol::is_incoming_transport_closed(&error) {
            // 에이전트가 끝났거나 ACP가 아닌 프로그램이다 — 크레이트의 진단 JSON보다 이 한 줄이 읽힌다.
            format!("{method}에 답하지 않고 끝났습니다")
        } else {
            format!("{method}: {error}")
        }
    })
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

/// stdout을 줄 단위로 읽어 넘기는 스레드. EOF면 통로를 닫는다 — 그것이 연결의 수신 EOF다.
fn read_lines(stdout: ChildStdout, lines: async_mpsc::UnboundedSender<std::io::Result<String>>) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => return,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buf).trim_end_matches(['\n', '\r']).to_owned();
                    if lines.unbounded_send(Ok(line)).is_err() {
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return,
            }
        }
    });
}

impl AgentProcess {
    /// 끄기의 앞 절반 — stdin을 닫고 연결을 놓는다. 기다리지 않는다.
    ///
    /// 여러 대화를 함께 끌 때(호스트 끄기) 모두의 앞 절반을 먼저 돌고 1초를 **한 번만** 기다린다.
    pub(crate) fn begin_shutdown(&mut self) {
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
        let exited = match self.exited.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(()) => true,
            Err(mpsc::RecvTimeoutError::Timeout) => false,
            // 끝을 지켜보지 못했다. 마감까지 기다린 셈 친다.
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                std::thread::sleep(deadline.saturating_duration_since(Instant::now()));
                false
            }
        };
        // 거두기 전에 끈다 — 끝난 리더도 거두기 전에는 그 번호를 쥐고 있어, 그룹 번호가 남에게 가지 않는다.
        process::kill_group(self.pid);
        if !exited && self.exited.recv_timeout(Duration::from_secs(5)).is_err() {
            // 그룹 신호가 리더에 닿지 않았다. 리더만이라도 직접 끄고 거둔다 — 거두기가 끝없이 막히지 않게.
            let _ = child.kill();
        }
        let _ = child.wait();
        self.connection = None;
    }

    /// stdin 닫기 → 1초 → 그룹째 SIGKILL.
    pub(crate) fn shut_down(&mut self) {
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        self.begin_shutdown();
        self.finish_shutdown(deadline);
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
