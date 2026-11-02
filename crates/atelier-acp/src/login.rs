//! 로그인 — 엔진의 로그인 확인과, 터미널에서 칠 로그인 명령(three-axes 결정 24 · 30, 티켓 12 · restart 01c-10).
//!
//! - **확인.** Claude는 `claude auth status --json`의 `loggedIn`이다 — 안 됐으면 exit 1이지만 JSON은 그대로 낸다(실측 A8).
//!   Codex는 `codex login status`의 exit code다 — 결과 글을 stderr로 내기 때문이다(실측 함정 50).
//! - **로그인 명령.** `claude auth login` · `codex login`이다. 앱은 띄우지 않는다 — 화면이 Terminal에 새 셸을 열어 이 줄을 친다
//!   (restart 01c-10 — 앱 안 로그인을 터미널 로그인 하나로 바꿨다). 둘 다 브라우저를 스스로 연다(실측 A3 · A8).
//! - **로그인 필요.** Runtime이 `-32000 Authentication required`로 답한 Session(Codex `session/new`, 엔진을 가리지 않고 턴
//!   도중)을 쥐고 있다가, 「다시 확인」이 「됨」을 보면 호스트가 다시 띄운다. 기록은 그대로다.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::discovery::{Agent, EngineCheck, FoundProgram, MissingProgram};
use crate::host::{Emit, HostEvent};
use crate::login_env::AgentEnv;
use crate::process::{self, Exit};

/// 로그인 확인 하나의 한도. 넘으면 그룹째 끄고 「안 됨」으로 친다.
const CHECK_LIMIT: Duration = Duration::from_secs(10);

/// ACP의 「로그인 필요」 오류 코드(`Authentication required`) — 엔진을 가리지 않는 하나의 계약값이다. codex-acp가 `session/new`
/// · 턴에 내고(실측 A3), Claude 변환기가 같은 값으로 내고(S3), 런타임 · 호스트가 이것으로 받는다.
pub(crate) const AUTH_REQUIRED: i32 = -32000;

/// 엔진 상태 — 엔진 상태 이벤트가 싣는 것(three-axes 구현 스펙 「대화 호스트 › 나오는 것」). 화면의 안내 카드가 이것으로
/// 「못 찾음 · 로그인 안 됨」을 그린다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    pub agent: Agent,
    /// 에이전트를 띄우는 데 드는 실행 파일을 다 찾았나.
    pub found: bool,
    /// 로그인돼 있나. 못 찾았으면 모른다(`None`).
    pub logged_in: Option<bool>,
    /// 못 찾았으면 빠진 것마다 이름과 설치 명령 — 찾았으면 비었다. 세션을 열다 못 찾은 때도 화면의 안내 카드가 설치 명령을 보이게 싣는다
    /// (restart 01c-9 — 선 채팅은 세션을 열 때 확인한다).
    pub missing: Vec<MissingProgram>,
}

/// 그 에이전트에 로그인돼 있나 — 엔진에게 묻는다. 막히는 호출이다(한도 10초). 물을 수 없거나 답을 읽을 수 없으면
/// 「안 됨」이다.
pub(crate) fn logged_in(agent: Agent, programs: &[FoundProgram], env: &AgentEnv, cwd: &Path) -> bool {
    match agent {
        Agent::Claude => {
            let Some(claude) = program(programs, "claude") else { return false };
            let ran = run_to_end(claude, &["auth", "status", "--json"], env, cwd);
            serde_json::from_slice::<Value>(&ran.stdout).ok().and_then(|status| status["loggedIn"].as_bool()) == Some(true)
        }
        Agent::Codex => {
            let Some(codex) = program(programs, "codex") else { return false };
            run_to_end(codex, &["login", "status"], env, cwd).exit == Some(Exit::Code(0))
        }
    }
}

/// 에이전트의 답이 「로그인 필요」(`-32000`)인가 — `session/prompt`의 오류 원문(`{code, message, data?}`).
pub(crate) fn auth_required(error: &Value) -> bool {
    error["code"].as_i64() == Some(i64::from(AUTH_REQUIRED))
}

/// 확인을 도는 자리 — 로그인 env의 `HOME`(사용자의 집), 없으면 `fallback`(데이터 루트).
pub(crate) fn quiet_place(env: &AgentEnv, fallback: &Path) -> PathBuf {
    env.vars()
        .get(std::ffi::OsStr::new("HOME"))
        .map(PathBuf::from)
        .filter(|home| home.is_dir())
        .unwrap_or_else(|| fallback.to_path_buf())
}

/// 터미널에서 칠 그 엔진의 로그인 명령 한 줄 — 찾은 실행 파일의 경로와 로그인 인자다. 둘 다 브라우저를 여는 기본 명령이다
/// (three-axes 결정 30). device code 길은 쓰지 않는다. 경로는 셸이 한 낱말로 읽게 싼다.
pub(crate) fn login_command(agent: Agent, programs: &[FoundProgram]) -> Option<String> {
    let (program, args): (_, &[&str]) = match agent {
        Agent::Claude => (program(programs, "claude")?, &["auth", "login"]),
        Agent::Codex => (program(programs, "codex")?, &["login"]),
    };
    let mut line = shell_word(program.to_str()?);
    for arg in args {
        line.push(' ');
        line.push_str(arg);
    }
    Some(line)
}

/// 셸이 한 낱말로 읽는 꼴 — 그대로 둬도 되는 글자뿐이면 그대로, 아니면 작은따옴표로 싼다(안의 `'`는 `'\''`).
fn shell_word(text: &str) -> String {
    let plain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | '+');
    if !text.is_empty() && text.chars().all(plain) {
        return text.to_owned();
    }
    format!("'{}'", text.replace('\'', r"'\''"))
}

fn program<'a>(programs: &'a [FoundProgram], name: &str) -> Option<&'a Path> {
    programs.iter().find(|program| program.name == name).map(|program| program.path.as_path())
}

/// 확인 명령 하나가 남긴 것.
pub(crate) struct Ran {
    pub exit: Option<Exit>,
    pub stdout: Vec<u8>,
}

/// 확인 명령을 끝까지 돈다 — 에이전트와 같은 env를 통째로 주고, 새 세션에, stdin 없이 띄운다. 끝나면(한도를 넘겨도)
/// 그룹째 끄고 거둔다. 판 확인(`codex --version`, `tested.rs`)도 이것으로 돈다.
pub(crate) fn run_to_end(program: &Path, args: &[&str], env: &AgentEnv, cwd: &Path) -> Ran {
    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .envs(env.vars())
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    process::in_new_session(&mut command);
    let Ok(mut child) = command.spawn() else { return Ran { exit: None, stdout: Vec::new() } };
    let pid = child.id();
    let mut stdout = child.stdout.take().expect("stdout을 파이프로 띄웠다");
    let (out_tx, out_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = out_tx.send(buf);
    });
    let (exit_tx, exit_rx) = mpsc::channel();
    process::watch_exit(pid, move |exit| {
        let _ = exit_tx.send(exit);
    });
    let exit = exit_rx.recv_timeout(CHECK_LIMIT).ok();
    // 거두기 전에 끈다 — 한도를 넘긴 확인과 남은 후손이다. 끝난 리더도 거두기 전에는 그 번호를 쥔다.
    process::kill_group(pid);
    let _ = child.wait();
    let stdout = out_rx.recv_timeout(Duration::from_secs(1)).unwrap_or_default();
    Ran { exit, stdout }
}

/// 로그인을 기다리는 것 하나 — 그 엔진과 다시 띄울 Session의 Thread(v1 티켓 04). three-axes의 work 대화 자리는 v1 티켓 08이 걷었다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Waiting {
    pub agent: Agent,
    pub thread: String,
}

/// 로그인 창구 — 엔진 상태를 알리고, 로그인을 기다리는 Session들을 쥔다. 호스트와 Session들(턴 도중의 `-32000`)이 함께 쥔다.
///
/// 잠금은 이 창구 안에서 끝난다 — 이벤트를 내보내는 closure 말고는 아무것도 부르지 않는다. 그래서 Session의 잠금을 쥔 채
/// 불러도 된다.
pub(crate) struct LoginDesk {
    emit: Arc<Emit>,
    waiting: Mutex<Vec<Waiting>>,
}

impl LoginDesk {
    pub(crate) fn new(emit: Arc<Emit>) -> Arc<Self> {
        Arc::new(Self { emit, waiting: Mutex::new(Vec::new()) })
    }

    pub(crate) fn announce(&self, state: EngineState) {
        (self.emit)(HostEvent::Engine(state));
    }

    /// 엔진 확인의 답을 엔진 상태로 알린다.
    pub(crate) fn announce_check(&self, agent: Agent, check: &EngineCheck) {
        let (found, logged_in, missing) = match check {
            EngineCheck::Found { logged_in, .. } => (true, Some(*logged_in), Vec::new()),
            EngineCheck::Missing { missing } => (false, None, missing.clone()),
        };
        self.announce(EngineState { agent, found, logged_in, missing });
    }

    /// 그 자리가 로그인을 기다린다 — 에이전트가 `-32000`으로 답했다. 쥐고, 엔진 상태(찾음 · 안 됨)를 알린다.
    pub(crate) fn login_required(&self, agent: Agent, thread: String) {
        {
            let mut waiting = self.lock_waiting();
            if !waiting.iter().any(|held| held.thread == thread) {
                waiting.push(Waiting { agent, thread });
            }
        }
        self.announce(EngineState { agent, found: true, logged_in: Some(false), missing: Vec::new() });
    }

    /// 그 자리가 로그인을 기다리면 그 엔진.
    pub(crate) fn waiting_for(&self, thread: &str) -> Option<Agent> {
        self.lock_waiting().iter().find(|held| held.thread == thread).map(|held| held.agent)
    }

    /// 그 엔진의 로그인을 기다리던 Session들을 꺼낸다 — 다시 띄울 차례다. 꺼낸 것은 다시 쥐지 않는다(두 길이 함께
    /// 「됨」을 봐도 한 번만 띄운다).
    pub(crate) fn take_waiting(&self, agent: Agent) -> Vec<Waiting> {
        let mut waiting = self.lock_waiting();
        let (taken, kept): (Vec<Waiting>, Vec<Waiting>) = waiting.drain(..).partition(|held| held.agent == agent);
        *waiting = kept;
        taken
    }

    fn lock_waiting(&self) -> MutexGuard<'_, Vec<Waiting>> {
        self.waiting.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
