//! 로그인 — 엔진의 로그인 확인과 로그인 명령(three-axes 결정 24 · 30, 티켓 12).
//!
//! - **확인.** Claude는 `claude auth status --json`의 `loggedIn`이다 — 안 됐으면 exit 1이지만 JSON은 그대로 낸다(실측 A8).
//!   Codex는 `codex login status`의 exit code다 — 결과 글을 stderr로 내기 때문이다(실측 함정 50).
//! - **로그인 명령.** `claude auth login` · `codex login`을 TTY 없이 새 세션에 띄운다. 둘 다 브라우저를 스스로 열고
//!   localhost 콜백을 기다린다(실측 A3 · A8). stdout · stderr에 처음 찍힌 `https://` URL이 「링크 복사」의 값이다.
//!   끝나면 호스트가 확인을 저절로 다시 돈다. 취소는 프로세스 그룹 SIGTERM이다(SIGINT가 아니다). 엔진마다 한 번에 하나다.
//! - **로그인 필요.** 에이전트가 `-32000 Authentication required`로 답한 대화(Codex `session/new`, 엔진을 가리지 않고 턴
//!   도중)를 쥐고 있다가, 로그인이 「됨」으로 바뀌면 호스트가 다시 띄운다. 기록은 그대로다.

use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::discovery::{Agent, EngineCheck, FoundProgram};
use crate::host::{Emit, HostEvent};
use crate::login_env::AgentEnv;
use crate::process::{self, Exit};

/// 로그인 확인 하나의 한도. 넘으면 그룹째 끄고 「안 됨」으로 친다.
const CHECK_LIMIT: Duration = Duration::from_secs(10);

/// 취소의 SIGTERM 뒤 스스로 끝나기를 기다리는 시간. 넘으면 그룹째 SIGKILL이다 — 남은 프로세스를 두지 않는다.
const CANCEL_GRACE: Duration = Duration::from_secs(1);

/// ACP의 「로그인 필요」 오류 코드(`Authentication required`) — 엔진을 가리지 않는 하나의 계약값이다. codex-acp가 `session/new`
/// · 턴에 내고(실측 A3), Claude 변환기가 같은 값으로 내고(S3), 런타임 · 호스트가 이것으로 받는다.
pub(crate) const AUTH_REQUIRED: i32 = -32000;

/// 엔진 상태 — 엔진 상태 이벤트가 싣는 것(three-axes 구현 스펙 「대화 호스트 › 나오는 것」). 화면의 안내 카드가 이것으로
/// 「로그인 안 됨 · 로그인 중(링크) · 끝남」을 그린다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    pub agent: Agent,
    /// 에이전트를 띄우는 데 드는 실행 파일을 다 찾았나. 빠진 것과 설치 명령은 엔진 확인의 답에 실린다.
    pub found: bool,
    /// 로그인돼 있나. 모르면 `None`이다 — 못 찾았거나, 로그인 명령이 도는 중이다.
    pub logged_in: Option<bool>,
    /// 로그인 명령의 진행. 도는 것도 막 끝난 것도 없으면 `None`이다.
    pub login: Option<LoginProgress>,
}

/// 로그인 명령의 진행.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum LoginProgress {
    /// 도는 중 — 명령이 URL을 찍었으면 그것(「링크 복사」의 값).
    Running { url: Option<String> },
    /// 끝남 — 사람이 취소했나, 명령의 exit code(시그널로 끝났으면 `None`). 이 상태와 함께 실린 `loggedIn`이 끝난 뒤
    /// 다시 돈 확인의 답이다.
    Ended { cancelled: bool, exit_code: Option<i32> },
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

/// 확인 · 로그인 명령을 도는 자리 — 로그인 env의 `HOME`(사용자의 집), 없으면 `fallback`(데이터 루트).
pub(crate) fn quiet_place(env: &AgentEnv, fallback: &Path) -> PathBuf {
    env.vars()
        .get(std::ffi::OsStr::new("HOME"))
        .map(PathBuf::from)
        .filter(|home| home.is_dir())
        .unwrap_or_else(|| fallback.to_path_buf())
}

/// 그 엔진의 로그인 명령 — 둘 다 브라우저를 여는 기본 명령이다(three-axes 결정 30). device code 길은 쓰지 않는다.
fn login_command(agent: Agent, programs: &[FoundProgram]) -> Option<(&Path, &'static [&'static str])> {
    match agent {
        Agent::Claude => Some((program(programs, "claude")?, &["auth", "login"])),
        Agent::Codex => Some((program(programs, "codex")?, &["login"])),
    }
}

/// 줄에 든 첫 `https://` URL — 공백까지다.
fn first_https(line: &str) -> Option<String> {
    let at = line.find("https://")?;
    line[at..].split_whitespace().next().map(str::to_owned)
}

fn program<'a>(programs: &'a [FoundProgram], name: &str) -> Option<&'a Path> {
    programs.iter().find(|program| program.name == name).map(|program| program.path.as_path())
}

/// 확인 명령 하나가 남긴 것.
struct Ran {
    exit: Option<Exit>,
    stdout: Vec<u8>,
}

/// 확인 명령을 끝까지 돈다 — 에이전트와 같은 env를 통째로 주고, 새 세션에, stdin 없이 띄운다. 끝나면(한도를 넘겨도)
/// 그룹째 끄고 거둔다.
fn run_to_end(program: &Path, args: &[&str], env: &AgentEnv, cwd: &Path) -> Ran {
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

/// 로그인을 기다리는 대화 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Waiting {
    pub agent: Agent,
    pub work: String,
    pub conversation: String,
}

/// 도는 로그인 명령 하나.
struct Run {
    /// 프로세스 그룹 — 새 세션이라 리더의 pid와 같다. 끝을 지켜보는 쪽이 거두기 전에 표에서 빼므로, 표에 있는 동안은
    /// 이 번호가 남의 것이 되지 않는다.
    pgid: u32,
    /// 명령이 처음 찍은 `https://` URL.
    url: Option<String>,
    /// 사람이 취소했나.
    cancelled: bool,
    /// 열어 둔 stdin. 쓰지 않고 쥐기만 한다 — `claude auth login`은 「Paste code here」를 찍고 stdin을 읽는데, 실측은
    /// 열린 파이프로 쟀다(실측 A8). 닫힌 stdin(EOF)이면 기다리지 않고 끝날 수 있다.
    _stdin: Option<ChildStdin>,
}

/// 로그인 창구 — 엔진 상태를 알리고, 로그인을 기다리는 대화들과 도는 로그인 명령을 쥔다. 호스트와 대화들(턴 도중의
/// `-32000`)이 함께 쥔다.
///
/// 잠금은 이 창구 안에서 끝난다 — 이벤트를 내보내는 closure 말고는 아무것도 부르지 않는다. 그래서 대화의 잠금을 쥔 채
/// 불러도 된다. 잠금 순서는 `waiting` → `runs`다.
pub(crate) struct LoginDesk {
    emit: Arc<Emit>,
    waiting: Mutex<Vec<Waiting>>,
    /// 엔진마다 도는 로그인 명령 — 한 번에 하나다.
    runs: Mutex<HashMap<Agent, Run>>,
    /// 로그인 명령이 표에서 빠질 때 깨운다(취소가 기다린다).
    run_ended: Condvar,
    /// 호스트를 끄는 중 — 끝난 로그인 명령 뒤에 확인을 다시 돌지 않는다.
    closing: AtomicBool,
}

impl LoginDesk {
    pub(crate) fn new(emit: Arc<Emit>) -> Arc<Self> {
        Arc::new(Self {
            emit,
            waiting: Mutex::new(Vec::new()),
            runs: Mutex::new(HashMap::new()),
            run_ended: Condvar::new(),
            closing: AtomicBool::new(false),
        })
    }

    /// 지금 도는 로그인 명령의 진행.
    fn progress(&self, agent: Agent) -> Option<LoginProgress> {
        self.lock_runs().get(&agent).map(|run| LoginProgress::Running { url: run.url.clone() })
    }

    /// 로그인 명령을 띄운다. 그 엔진의 것이 이미 돌면 새로 띄우지 않고 지금의 진행을 다시 알린다.
    ///
    /// - TTY 없이(stdin은 쓰지 않는 파이프), 새 세션에, 에이전트와 같은 env를 통째로 주고 `cwd`에서 띄운다.
    /// - stdout · stderr에 처음 찍힌 `https://` URL을 엔진 상태의 링크로 알린다.
    /// - 끝나면 그룹째 끄고(남은 후손) 거둔 뒤 `on_end`를 부른다 — 호스트가 확인을 다시 돌고 「끝남」을 알린다.
    ///   호스트를 끄는 중이면 부르지 않는다. `on_end`는 끝을 지켜보는 스레드에서 돈다.
    pub(crate) fn start(
        self: &Arc<Self>,
        agent: Agent,
        programs: &[FoundProgram],
        env: &AgentEnv,
        cwd: &Path,
        on_end: impl FnOnce(LoginProgress) + Send + 'static,
    ) -> Result<(), String> {
        let (program, args) = login_command(agent, programs).ok_or_else(|| {
            format!("{}의 로그인 명령을 찾지 못했습니다", agent.display_name())
        })?;
        let mut runs = self.lock_runs();
        if let Some(run) = runs.get(&agent) {
            // 엔진마다 한 번에 하나 — 두 번째 「로그인」은 도는 것의 진행을 다시 알릴 뿐이다.
            self.announce(EngineState { agent, found: true, logged_in: None, login: Some(LoginProgress::Running { url: run.url.clone() }) });
            return Ok(());
        }
        let mut command = Command::new(program);
        command
            .args(args)
            .env_clear()
            .envs(env.vars())
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        process::in_new_session(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| format!("로그인 명령을 띄우지 못했습니다: {} — {error}", program.display()))?;
        let pgid = child.id();
        let stdout = child.stdout.take().expect("stdout을 파이프로 띄웠다");
        let stderr = child.stderr.take().expect("stderr를 파이프로 띄웠다");
        runs.insert(agent, Run { pgid, url: None, cancelled: false, _stdin: child.stdin.take() });
        // 잠금 안에서 알린다 — 링크 · 끝의 알림이 이보다 앞서지 않는다.
        self.announce(EngineState { agent, found: true, logged_in: None, login: Some(LoginProgress::Running { url: None }) });
        drop(runs);

        for stream in [Box::new(stdout) as Box<dyn Read + Send>, Box::new(stderr)] {
            let desk = Arc::clone(self);
            std::thread::spawn(move || {
                process::for_each_line(BufReader::new(stream), |line| {
                    desk.saw_line(agent, pgid, &String::from_utf8_lossy(line));
                });
            });
        }

        let desk = Arc::clone(self);
        process::watch_exit(pgid, move |exit| {
            let cancelled = desk.finish(agent, pgid);
            let _ = child.wait();
            if desk.closing.load(Ordering::SeqCst) {
                return;
            }
            let exit_code = match exit {
                Exit::Code(code) => Some(code),
                Exit::Signal(_) | Exit::Unknown => None,
            };
            on_end(LoginProgress::Ended { cancelled, exit_code });
        });
        Ok(())
    }

    /// 로그인 명령이 찍은 줄 하나. 처음 본 `https://` URL을 링크로 알린다 — 그 명령이 아직 표에 있을 때만, 잠금 안에서
    /// 알린다. 그래서 「끝남」 뒤에 링크가 오지 않는다.
    fn saw_line(&self, agent: Agent, pgid: u32, line: &str) {
        let Some(url) = first_https(line) else { return };
        let mut runs = self.lock_runs();
        let Some(run) = runs.get_mut(&agent).filter(|run| run.pgid == pgid && run.url.is_none()) else { return };
        run.url = Some(url.clone());
        self.announce(EngineState { agent, found: true, logged_in: None, login: Some(LoginProgress::Running { url: Some(url) }) });
    }

    /// 로그인 명령의 리더가 끝났다 — 거두기 전에 그룹째 끄고(남은 후손) 표에서 뺀다. 취소였나를 돌려준다.
    fn finish(&self, agent: Agent, pgid: u32) -> bool {
        let mut runs = self.lock_runs();
        process::kill_group(pgid);
        let cancelled = match runs.get(&agent) {
            Some(run) if run.pgid == pgid => runs.remove(&agent).is_some_and(|run| run.cancelled),
            _ => false,
        };
        self.run_ended.notify_all();
        cancelled
    }

    /// 로그인 명령을 거둔다 — 그룹에 SIGTERM을 보내고(SIGINT가 아니다, three-axes 결정 30) 끝나기를 잠깐 기다린다. 넘으면
    /// 그룹째 SIGKILL이다. 도는 것이 없으면 아무 일도 하지 않는다. 「끝남(취소)」은 끝을 지켜보는 쪽이 알린다.
    ///
    /// 막히는 호출이다 — 최대 1초 남짓.
    pub(crate) fn cancel(&self, agent: Agent) {
        let mut runs = self.lock_runs();
        let Some(run) = runs.get_mut(&agent) else { return };
        run.cancelled = true;
        let pgid = run.pgid;
        process::terminate_group(pgid);
        let still = |runs: &HashMap<Agent, Run>| runs.get(&agent).is_some_and(|run| run.pgid == pgid);
        runs = self.wait_ended(runs, Instant::now() + CANCEL_GRACE, still);
        if still(&runs) {
            // 표에 있으면 아직 거두지 않았다 — 그룹 번호는 아직 그것의 것이다.
            process::kill_group(pgid);
            drop(self.wait_ended(runs, Instant::now() + Duration::from_secs(5), still));
        }
    }

    /// 호스트를 끄기 시작한다 — 모든 로그인 명령의 그룹에 SIGTERM을 보내고, 끝난 뒤에 확인을 다시 돌지 않게 한다.
    pub(crate) fn begin_close(&self) {
        self.closing.store(true, Ordering::SeqCst);
        for run in self.lock_runs().values() {
            process::terminate_group(run.pgid);
        }
    }

    /// 호스트 끄기의 끝 — 아직 끝나지 않은 로그인 명령은 그룹째 SIGKILL이다.
    pub(crate) fn finish_close(&self) {
        for run in self.lock_runs().values() {
            process::kill_group(run.pgid);
        }
    }

    /// `still`이 거짓이 되거나 마감이 될 때까지 기다린다.
    fn wait_ended<'a>(
        &self,
        mut runs: MutexGuard<'a, HashMap<Agent, Run>>,
        deadline: Instant,
        still: impl Fn(&HashMap<Agent, Run>) -> bool,
    ) -> MutexGuard<'a, HashMap<Agent, Run>> {
        while still(&runs) {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            runs = self.run_ended.wait_timeout(runs, deadline - now).unwrap_or_else(|poisoned| poisoned.into_inner()).0;
        }
        runs
    }

    fn lock_runs(&self) -> MutexGuard<'_, HashMap<Agent, Run>> {
        self.runs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn announce(&self, state: EngineState) {
        (self.emit)(HostEvent::Engine(state));
    }

    /// 엔진 확인의 답을 엔진 상태로 알린다 — 도는 로그인 명령이 있으면 그 진행도 싣는다.
    pub(crate) fn announce_check(&self, agent: Agent, check: &EngineCheck) {
        let (found, logged_in) = match check {
            EngineCheck::Found { logged_in, .. } => (true, Some(*logged_in)),
            EngineCheck::Missing { .. } => (false, None),
        };
        self.announce(EngineState { agent, found, logged_in, login: self.progress(agent) });
    }

    /// 그 대화가 로그인을 기다린다 — 에이전트가 `-32000`으로 답했다. 쥐고, 엔진 상태(찾음 · 안 됨)를 알린다.
    pub(crate) fn login_required(&self, agent: Agent, work: &str, conversation: &str) {
        let login = self.progress(agent);
        {
            let mut waiting = self.lock_waiting();
            if !waiting.iter().any(|held| held.conversation == conversation) {
                waiting.push(Waiting { agent, work: work.to_owned(), conversation: conversation.to_owned() });
            }
        }
        self.announce(EngineState { agent, found: true, logged_in: Some(false), login });
    }

    /// 그 대화가 로그인을 기다리면 그 엔진.
    pub(crate) fn waiting_for(&self, conversation: &str) -> Option<Agent> {
        self.lock_waiting().iter().find(|held| held.conversation == conversation).map(|held| held.agent)
    }

    /// 그 대화를 더는 쥐지 않는다 — 닫혔거나, 첫 말 전에 에이전트를 바꿨다(three-axes 티켓 13).
    pub(crate) fn forget(&self, conversation: &str) {
        self.lock_waiting().retain(|held| held.conversation != conversation);
    }

    /// 그 엔진의 로그인을 기다리던 대화들을 꺼낸다 — 다시 띄울 차례다. 꺼낸 것은 다시 쥐지 않는다(두 길이 함께
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
