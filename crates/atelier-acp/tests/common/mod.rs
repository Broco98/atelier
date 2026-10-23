//! L1 호스트 시험의 공용 도우미 — 샌드박스와 가짜 로그인 셸.
//!
//! 호스트는 앱에서처럼 짓되, 셸 경로의 원천은 이 샌드박스가 쓴 가짜 로그인 셸이다. 시험은 호스트의
//! 답과 가짜가 남긴 영수증(받은 호출 · 띄운 pid)만 본다 — 호스트 안쪽을 부르지 않는다.
//!
//! `tests/common.rs`가 아니라 `tests/common/mod.rs`인 까닭: 앞의 것은 cargo가 시험 파일로도 짓는다.

#![allow(dead_code)] // 시험 파일마다 쓰는 도우미가 달라, 안 쓰는 파일에서 경고가 난다.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use atelier_acp::{Agent, ConversationHost, EngineState, HostEvent, QueuedMessage, ShellSource, TranslatorCommand};
use serde_json::Value;

/// 가짜 로그인 셸의 시나리오.
#[derive(Clone, Copy, Debug)]
pub enum LoginShell {
    /// 표지 앞뒤와 stderr에 rc 인사말을 찍고, 정해진 env로 호스트의 명령을 돈다.
    Normal,
    /// rc가 띄운 배경 작업이 stdout을 쥔 채 남는다 — 셸이 끝나도 EOF가 오지 않는다.
    BackgroundHoldsStdout,
    /// 호스트의 명령을 돌지 않고 exit 0 — rc가 다른 셸로 exec한 꼴.
    NoMarker,
    /// 호스트의 명령 전에 잠든다.
    Slow,
}

pub struct Sandbox {
    _dir: tempfile::TempDir,
    root: PathBuf,
}

impl Sandbox {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("임시 폴더");
        let root = dir.path().to_path_buf();
        for sub in ["home", "receipts", "receipts/acp", "receipts/claude", "receipts/login"] {
            fs::create_dir_all(root.join(sub)).unwrap();
        }
        Self { _dir: dir, root }
    }

    /// 데이터 루트(`ATELIER_HOME` 자리).
    pub fn data_root(&self) -> PathBuf {
        self.root.join("home")
    }

    fn receipts(&self) -> PathBuf {
        self.root.join("receipts")
    }

    /// 로그인 PATH에 넣을 폴더 하나를 만든다.
    pub fn bin(&self, name: &str) -> PathBuf {
        let dir = self.root.join(name);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 실행 비트가 붙은 가짜 프로그램. 찾기만 하므로 내용은 상관없다.
    pub fn plant(&self, dir: &Path, program: &str) {
        self.plant_with_mode(dir, program, 0o755);
    }

    /// 실행 비트가 없는 같은 이름의 파일.
    pub fn plant_unexecutable(&self, dir: &Path, program: &str) {
        self.plant_with_mode(dir, program, 0o644);
    }

    fn plant_with_mode(&self, dir: &Path, program: &str, mode: u32) {
        let path = dir.join(program);
        fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
    }

    /// 가짜 로그인 셸을 쓰고 그 경로를 돌려준다. 호스트의 명령은 `path`만 PATH로 든 env에서 돈다 —
    /// 시험하는 기계의 진짜 `claude`로 새지 않는다.
    ///
    /// 영수증: 부를 때마다 `calls`에 받은 플래그 한 줄, 띄운 프로세스의 pid는 `pids`에 한 줄씩.
    pub fn login_shell(&self, scenario: LoginShell, path: &[&Path]) -> PathBuf {
        self.login_shell_with_env(scenario, path, &[])
    }

    /// [`Self::login_shell`]과 같되 로그인 env에 변수를 더 싣는다 — 가짜 ACP 에이전트의 시나리오처럼, 호스트가
    /// 띄우는 에이전트까지 닿아야 하는 값은 로그인 env로만 갈 수 있다(호스트가 자식 env를 통째로 바꾼다).
    ///
    /// 호스트의 명령을 도는 같은 셸이 그 앞에 자기 env를 `login-env`에 `env -0` 꼴로 떠 둔다 — 호스트가 읽은
    /// 로그인 env 그대로다. 검사는 그것으로 「자식 env가 준 env와 같다」를 잰다. 뒤가 아니라 앞인 것은, 호스트가
    /// END 표지를 읽자마자 셸의 그룹을 끄기 때문이다.
    pub fn login_shell_with_env(&self, scenario: LoginShell, path: &[&Path], env: &[(&str, &str)]) -> PathBuf {
        let path_var = path.iter().map(|dir| dir.display().to_string()).collect::<Vec<_>>().join(":");
        let extra = env.iter().map(|(name, value)| format!("{name}='{value}' ")).collect::<String>();
        let before_command = match scenario {
            LoginShell::Normal => "",
            LoginShell::BackgroundHoldsStdout => "sleep 30 &\necho $! >> \"$RECEIPTS/pids\"\n",
            LoginShell::NoMarker => "exit 0\n",
            LoginShell::Slow => "echo $$ >> \"$RECEIPTS/pids\"\nsleep 30 &\necho $! >> \"$RECEIPTS/pids\"\nwait\n",
        };
        // 표지 밖 인사말에 `PATH=`를 일부러 싣는다. 꼬리는 `env -0`과 같은 꼴(NUL로 갈린 `PATH=…`)이라,
        // END 표지 너머까지 env로 읽으면 진짜 PATH를 덮어 찾은 경로가 틀어진다.
        let script = format!(
            "#!/bin/sh\n\
             # 가짜 로그인 셸({scenario:?}) — 호스트가 `-l -i -c <명령>`으로 부른다.\n\
             RECEIPTS='{receipts}'\n\
             echo \"$1 $2 $3\" >> \"$RECEIPTS/calls\"\n\
             echo 'PATH=/rc-greeting'\n\
             echo 'PATH=/rc-stderr' >&2\n\
             {before_command}\
             /usr/bin/env -i PATH='{path_var}' HOME='{home}' {extra}/bin/sh -c '/usr/bin/env -0 > \"$0\"; '\"$4\" \"$RECEIPTS/login-env\"\n\
             printf '\\000PATH=/rc-tail\\000'\n",
            receipts = self.receipts().display(),
            home = self.data_root().display(),
        );
        let shell = self.root.join(format!("login-shell-{scenario:?}"));
        fs::write(&shell, script).unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();
        shell
    }

    /// 가짜 로그인 셸이 받은 호출들 — 줄마다 받은 플래그.
    pub fn shell_calls(&self) -> Vec<String> {
        text_lines(&self.receipts().join("calls"))
    }

    /// 가짜 로그인 셸이 적은 pid들(셸 자신 · 배경 작업).
    pub fn shell_pids(&self) -> Vec<u32> {
        pid_lines(&self.receipts().join("pids"))
    }

    /// 가짜 로그인 셸이 떠 둔 로그인 env.
    pub fn login_env(&self) -> BTreeMap<String, String> {
        let bytes = fs::read(self.receipts().join("login-env")).expect("가짜 로그인 셸이 env를 떠 뒀어야 한다");
        bytes
            .split(|byte| *byte == 0)
            .filter_map(|entry| {
                let entry = String::from_utf8_lossy(entry);
                let (name, value) = entry.split_once('=')?;
                (!name.is_empty()).then(|| (name.to_owned(), value.to_owned()))
            })
            .collect()
    }

    /// 앱처럼 지은 호스트. 셸 경로의 원천만 가짜 로그인 셸이다.
    pub fn host(&self, shell: ShellSource) -> ConversationHost {
        self.host_builder(shell, |_| {}).build()
    }

    pub fn host_with_limit(&self, shell: ShellSource, limit: Duration) -> ConversationHost {
        self.host_builder(shell, |_| {}).login_shell_limit(limit).build()
    }

    /// 호스트가 내보낸 이벤트를 모으는 호스트.
    pub fn host_with_events(&self, shell: ShellSource) -> (ConversationHost, Events) {
        let (builder, events) = self.host_builder_with_events(shell);
        (builder.build(), events)
    }

    pub fn host_builder_with_events(&self, shell: ShellSource) -> (atelier_acp::HostBuilder, Events) {
        let events = Events::default();
        let sink = events.clone();
        (self.host_builder(shell, move |event| sink.push(event)), events)
    }

    pub fn host_builder(
        &self,
        shell: ShellSource,
        emit: impl Fn(HostEvent) + Send + Sync + 'static,
    ) -> atelier_acp::HostBuilder {
        self.host_builder_with_translator(shell, translator(), emit)
    }

    /// 변환기 명령을 고른 호스트 — 판이 다른 변환기처럼 시험 bin이 아닌 것을 변환기로 줄 때. Thread 도구 중계 서버는 앱처럼 늘
    /// 싣는다(v1 티켓 15).
    pub fn host_builder_with_translator(
        &self,
        shell: ShellSource,
        translator: TranslatorCommand,
        emit: impl Fn(HostEvent) + Send + Sync + 'static,
    ) -> atelier_acp::HostBuilder {
        ConversationHost::builder(self.data_root(), translator, shell, emit).thread_tools(thread_tools())
    }

    // ── work ────────────────────────────────────────────────────────────────────

    /// 데이터 루트에 work 하나를 세운다 — `work.json`과 spec 폴더, 프로젝트마다 워크트리 자리. git은 없어도
    /// 된다(호스트는 `git status`를 부르지 않는다).
    pub fn work(&self, slug: &str, projects: &[&str]) -> PathBuf {
        let dir = self.work_dir(slug);
        fs::create_dir_all(dir.join("spec")).unwrap();
        for project in projects {
            fs::create_dir_all(dir.join("trees").join(project)).unwrap();
        }
        let work = serde_json::json!({
            "title": format!("{slug} 제목"),
            "status": "active",
            "createdAt": "2026-10-10",
            "projects": projects,
        });
        fs::write(dir.join("work.json"), work.to_string()).unwrap();
        dir
    }

    pub fn work_dir(&self, slug: &str) -> PathBuf {
        self.data_root().join("works").join(slug)
    }

    // ── Claude ──────────────────────────────────────────────────────────────────

    /// Claude를 띄우는 데 드는 `claude`를 둔 PATH 폴더 — 가짜 claude bin을 가리키는 링크다.
    pub fn claude_bin(&self) -> PathBuf {
        let bin = self.bin("claude-bin");
        let link = bin.join("claude");
        if fs::symlink_metadata(&link).is_err() {
            std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_fake-claude"), &link).unwrap();
        }
        bin
    }

    /// 가짜 claude의 시나리오를 로그인 env에 실은 로그인 셸. 변환기는 받은 env를 그대로 claude에게 주므로, 가짜 claude에게
    /// 닿아야 하는 값도 로그인 env로 간다.
    pub fn claude_login_shell(&self, scenario: &str, extra: &[(&str, &str)]) -> ShellSource {
        let bin = self.claude_bin();
        let receipts = self.claude_receipts();
        let receipts = receipts.to_str().unwrap();
        let mut env = vec![("FAKE_CLAUDE_SCENARIO", scenario), ("FAKE_CLAUDE_RECEIPTS", receipts)];
        env.extend_from_slice(extra);
        ShellSource::Path(self.login_shell_with_env(
            LoginShell::Normal,
            &[&bin, Path::new("/usr/bin"), Path::new("/bin")],
            &env,
        ))
    }

    /// 가짜 claude가 `-p`로 뜰 때마다 받은 인자 — 뜬 차례대로.
    pub fn claude_launch_args(&self) -> Vec<Vec<String>> {
        self.claude_launches().iter().map(receipt_args).collect()
    }

    /// 가짜 claude의 영수증 폴더.
    pub fn claude_receipts(&self) -> PathBuf {
        self.receipts().join("claude")
    }

    /// 가짜 claude가 그 세션 id(`--session-id`)로 떠서 남긴 영수증.
    pub fn claude_receipt(&self, session_id: &str) -> Value {
        receipt_at(&self.claude_receipts().join(format!("{session_id}.json")))
    }

    /// 가짜 claude가 남긴 영수증 전부 — 세션 id를 모를 때(열기가 실패한 Session).
    pub fn all_claude_receipts(&self) -> Vec<Value> {
        let mut receipts: Vec<Value> = fs::read_dir(self.claude_receipts())
            .unwrap()
            .filter_map(|entry| {
                let path = entry.ok()?.path();
                let name = path.file_name()?.to_str()?;
                (name.ends_with(".json") && !name.starts_with('.'))
                    .then(|| serde_json::from_str(&fs::read_to_string(&path).ok()?).ok())?
            })
            .collect();
        receipts.sort_by_key(|receipt| receipt["pid"].as_u64());
        receipts
    }

    /// 가짜 claude가 떠 있는 동안 겪은 일들(stdin EOF · 받은 시그널).
    pub fn claude_events(&self, session_id: &str) -> Vec<String> {
        text_lines(&self.claude_receipts().join(format!("{session_id}.events")))
    }

    /// 가짜 claude가 stdin으로 받은 줄들.
    pub fn claude_stdin(&self, session_id: &str) -> Vec<Value> {
        json_lines(&self.claude_receipts().join(format!("{session_id}.stdin")))
    }

    /// 가짜 claude가 `FAKE_CLAUDE_MCP_CALL`로 MCP 서버를 띄워 도구를 부를 때마다 남긴 줄 — `{server, tools, call}`(서버 이름 ·
    /// `tools/list`의 도구들 · `tools/call`의 답), 부른 차례대로(v1 티켓 15).
    pub fn claude_mcp(&self, session_id: &str) -> Vec<Value> {
        json_lines(&self.claude_receipts().join(format!("{session_id}.mcp")))
    }

    /// 가짜 claude가 `-p`로 뜰 때마다 남긴 줄 — `{pid, args}`, 뜬 차례대로. 되살리기가 실패해 곧바로 끝난 claude도 선다
    /// (three-axes 티켓 16).
    pub fn claude_launches(&self) -> Vec<Value> {
        json_lines(&self.claude_receipts().join("launches"))
    }

    /// `FAKE_CLAUDE_HOLD_BACKGROUND`로 붙잡힌 스스로 이어 간 턴을 놓는다 — 가짜가 기다리던 `<세션 id>.go`를 만든다.
    pub fn release_claude_background(&self, session_id: &str) {
        fs::write(self.claude_receipts().join(format!("{session_id}.go")), "").unwrap();
    }

    fn acp_receipts(&self) -> PathBuf {
        self.receipts().join("acp")
    }

    // ── Thread(v1 티켓 04) ──────────────────────────────────────────────────────

    /// Library에 Agent 정의 파일 하나를 둔다 — `library/agents/<handle>.md`. 있으면 덮는다(사람이 고친 꼴).
    pub fn library_agent(&self, handle: &str, text: &str) -> PathBuf {
        let dir = atelier_core::library_agents_in(&self.data_root());
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{handle}.md"));
        fs::write(&path, text).unwrap();
        path
    }

    /// Thread 폴더 `threads/<id>`.
    pub fn thread_dir(&self, thread: &str) -> PathBuf {
        self.data_root().join("threads").join(thread)
    }

    /// 그 Thread의 `thread.json`.
    pub fn thread_json(&self, thread: &str) -> Value {
        let path = self.thread_dir(thread).join("thread.json");
        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(|_| panic!("없다: {}", path.display()))).unwrap()
    }

    /// `thread.json`의 그 참여자.
    pub fn participant(&self, thread: &str, handle: &str) -> Value {
        self.thread_json(thread)["participants"]
            .as_array()
            .expect("participants 배열")
            .iter()
            .find(|participant| participant["handle"] == handle)
            .unwrap_or_else(|| panic!("thread.json에 @{handle} 참여자가 없다"))
            .clone()
    }

    /// 그 Thread 참여자의 Session id(`thread.json`).
    pub fn thread_session_id(&self, thread: &str, handle: &str) -> String {
        self.participant(thread, handle)["sessionId"].as_str().expect("Session id").to_owned()
    }

    /// 그 Thread의 기록 줄들(`events.jsonl`).
    pub fn thread_record(&self, thread: &str) -> Vec<Value> {
        record_at(&self.thread_record_path(thread))
    }

    pub fn thread_record_path(&self, thread: &str) -> PathBuf {
        self.thread_dir(thread).join("events.jsonl")
    }

    /// Thread의 기록이 `done`을 채울 때까지 기다린다.
    pub fn wait_thread_record(&self, thread: &str, done: impl Fn(&[Value]) -> bool) -> Vec<Value> {
        wait_record_at(&self.thread_record_path(thread), done)
    }

    /// Thread의 기록에 그 kind의 줄이 `n`개 적힐 때까지 기다린다.
    pub fn wait_thread_kind(&self, thread: &str, kind: &str, n: usize) -> Vec<Value> {
        self.wait_thread_record(thread, |record| record.iter().filter(|line| line["kind"] == kind).count() >= n)
    }
}

/// 변환기 시험 bin — 앱 진입점의 `acp-claude` 갈래와 같은 진입 함수를 부른다.
pub fn translator() -> TranslatorCommand {
    TranslatorCommand::new(env!("CARGO_BIN_EXE_claude-translator"), Vec::<String>::new())
}

/// Thread 도구 중계 서버 시험 bin — 앱 진입점의 `thread-tools` 갈래와 같은 진입 함수를 부른다(v1 티켓 15).
pub fn thread_tools() -> TranslatorCommand {
    TranslatorCommand::new(env!("CARGO_BIN_EXE_thread-tools"), Vec::<String>::new())
}

// ── 변환기를 ACP로 직접 몰기 ─────────────────────────────────────────────────────

/// 변환기 시험 bin을 ACP로 직접 모는 시험의 선 — 변환기의 stdin에 쓰고, stdout 줄을 차례로 받는다. 놓으면(`drop`) 변환기의
/// stdin이 닫힌다.
pub struct Wire {
    stdin: std::process::ChildStdin,
    lines: std::sync::mpsc::Receiver<Value>,
    /// 지금까지 받은 줄들 — 받은 차례대로.
    pub seen: Vec<Value>,
}

impl Wire {
    pub fn send(&mut self, message: Value) {
        use std::io::Write;
        writeln!(self.stdin, "{message}").unwrap();
    }

    /// `done`을 채우는 줄이 올 때까지 받는다. 마감(`PATIENCE`) 안에 오지 않거나 변환기가 끝나면 터진다.
    pub fn until(&mut self, done: impl Fn(&Value) -> bool) -> Value {
        loop {
            let line = self.lines.recv_timeout(PATIENCE).expect("변환기가 기다린 줄을 내지 않았다");
            self.seen.push(line.clone());
            if done(&line) {
                return line;
            }
        }
    }

    /// `initialize`(요청 id 1)와 `session/new`(요청 id 2 — 샌드박스의 자리 `cwd`와 가짜 claude의 자리)를 보낸다. `initialize`의
    /// 답과 연 세션 id를 돌려준다.
    pub fn open_session(&mut self, sandbox: &Sandbox) -> (Value, String) {
        let answer_to = |id: u64| move |line: &Value| line["id"] == id && line.get("method").is_none();
        self.send(serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": 1}}));
        let initialized = self.until(answer_to(1));
        let (cwd, claude) = (sandbox.bin("cwd"), sandbox.claude_bin().join("claude"));
        self.send(serde_json::json!({"jsonrpc": "2.0", "id": 2, "method": "session/new",
                                     "params": {"cwd": cwd, "mcpServers": [], "_meta": {"atelier": {"claudePath": claude}}}}));
        let session = self.until(answer_to(2))["result"]["sessionId"].as_str().expect("세션 id").to_owned();
        (initialized, session)
    }
}

/// 변환기 시험 bin을 띄운다 — 호스트 없이. env는 PATH(`/usr/bin:/bin`)와 가짜 claude의 영수증 자리에 `env`를 더한 것뿐이다.
/// 시험이 실패해도 남은 것을 그룹째 거둘 수 있게 새 세션에 띄운다.
pub fn spawn_translator(sandbox: &Sandbox, env: &[(&str, &str)]) -> (std::process::Child, Wire) {
    use std::io::BufRead;
    use std::os::unix::process::CommandExt;

    let mut command = Command::new(env!("CARGO_BIN_EXE_claude-translator"));
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("FAKE_CLAUDE_RECEIPTS", sandbox.claude_receipts())
        .envs(env.iter().copied())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    // SAFETY: fork 뒤 exec 전의 자식에서 async-signal-safe한 setsid 하나만 부른다.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    let mut translator = command.spawn().expect("변환기 시험 bin");
    let stdout = std::io::BufReader::new(translator.stdout.take().unwrap());
    let (tx, lines) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in stdout.lines().map_while(Result::ok) {
            if tx.send(serde_json::from_str::<Value>(&line).unwrap()).is_err() {
                break;
            }
        }
    });
    let wire = Wire { stdin: translator.stdin.take().unwrap(), lines, seen: Vec::new() };
    (translator, wire)
}

/// 변환기가 스스로 끝나기를 기다리고 그 끝을 돌려준다 — stdin EOF 뒤에는 claude를 거두고 끝나야 한다. 마감(`PATIENCE`)을
/// 넘기면 그룹째 SIGKILL하고 터진다.
pub fn assert_translator_exits(translator: &mut std::process::Child) -> std::process::ExitStatus {
    let deadline = Instant::now() + PATIENCE;
    loop {
        if let Some(status) = translator.try_wait().unwrap() {
            return status;
        }
        if Instant::now() > deadline {
            // SAFETY: 시험이 새 세션에 띄운 그룹이다(`spawn_translator`).
            unsafe { libc::killpg(translator.id() as i32, libc::SIGKILL) };
            panic!("변환기가 stdin EOF 뒤에 끝나지 않았다");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

// ── 로그인(three-axes 티켓 12) ──────────────────────────────────────────────────

/// 가짜가 영수증 이름에 쓰는 엔진 이름.
fn engine_name(agent: Agent) -> &'static str {
    match agent {
        Agent::Claude => "claude",
        Agent::Codex => "codex",
    }
}

impl Sandbox {
    /// 로그인 검사의 PATH 폴더. `claude` · `codex` · `codex-acp`는 가짜 claude · 가짜 codex · 가짜 ACP 에이전트 bin을
    /// 가리키는 링크이고, `node`는 찾기만 하는 가짜, `open`은 받은 인자를 영수증에 적는 기록용 가짜다(실측 함정 40).
    pub fn login_bin(&self) -> PathBuf {
        let bin = self.bin("login-bin");
        if !bin.join("claude").exists() {
            std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_fake-claude"), bin.join("claude")).unwrap();
            std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_fake-codex"), bin.join("codex")).unwrap();
            std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_fake-acp-agent"), bin.join("codex-acp")).unwrap();
            self.plant(&bin, "node");
            let open = bin.join("open");
            fs::write(&open, format!("#!/bin/sh\necho \"$*\" >> '{}'\n", self.login_receipts().join("open").display()))
                .unwrap();
            fs::set_permissions(&open, fs::Permissions::from_mode(0o755)).unwrap();
        }
        bin
    }

    /// 로그인 흉내의 영수증 폴더(`FAKE_LOGIN_RECEIPTS`).
    pub fn login_receipts(&self) -> PathBuf {
        self.receipts().join("login")
    }

    /// 로그인 검사의 로그인 셸. 가짜 ACP 에이전트의 시나리오와 로그인 흉내의 자리(영수증 · 엔진마다의 로그인 파일)를
    /// 로그인 env에 싣는다 — 호스트가 띄우는 로그인 명령 · 에이전트까지 닿는 길은 로그인 env뿐이다.
    ///
    /// `browser`는 `BROWSER`의 값이다. 검사는 `/usr/bin/true`로 진짜 브라우저를 막는다(실측 함정 40). `None`이면
    /// `BROWSER`를 싣지 않는다 — 그러면 엔진은 PATH의 `open`을 부르고, 그것은 이 샌드박스의 기록용 가짜다.
    pub fn login_shell_for_login(&self, scenario: &str, browser: Option<&str>, extra: &[(&str, &str)]) -> ShellSource {
        let bin = self.login_bin();
        let acp = self.acp_receipts().display().to_string();
        let login = self.login_receipts().display().to_string();
        let claude_auth = self.auth_file(Agent::Claude).display().to_string();
        let codex_auth = self.auth_file(Agent::Codex).display().to_string();
        let mut env = vec![
            ("FAKE_ACP_SCENARIO", scenario),
            ("FAKE_ACP_RECEIPTS", acp.as_str()),
            ("FAKE_LOGIN_RECEIPTS", login.as_str()),
            ("FAKE_CLAUDE_AUTH", claude_auth.as_str()),
            ("FAKE_CODEX_AUTH", codex_auth.as_str()),
        ];
        if let Some(browser) = browser {
            env.push(("BROWSER", browser));
        }
        env.extend_from_slice(extra);
        ShellSource::Path(self.login_shell_with_env(
            LoginShell::Normal,
            &[&bin, Path::new("/usr/bin"), Path::new("/bin")],
            &env,
        ))
    }

    /// 그 엔진의 로그인 파일 — 있으면 로그인됨이다(진짜는 Claude 키체인 · `~/.codex/auth.json`).
    pub fn auth_file(&self, agent: Agent) -> PathBuf {
        self.login_receipts().join(format!("{}.auth", engine_name(agent)))
    }

    /// 터미널에서 로그인한 것처럼 로그인 파일을 둔다.
    pub fn log_in(&self, agent: Agent) {
        fs::write(self.auth_file(agent), "{}").unwrap();
    }

    /// 로그인이 풀린 것처럼 로그인 파일을 지운다.
    pub fn log_out(&self, agent: Agent) {
        let _ = fs::remove_file(self.auth_file(agent));
    }

    /// 그 엔진의 로그인 파일이 있나.
    pub fn logged_in_file(&self, agent: Agent) -> bool {
        self.auth_file(agent).exists()
    }

    /// 기다리는 로그인 명령을 끝낸다 — `ok`면 로그인 파일을 쓰고 exit 0, 아니면 쓰지 않고 exit 1.
    pub fn finish_login(&self, agent: Agent, ok: bool) {
        let gate = format!("{}-login.{}", engine_name(agent), if ok { "go" } else { "fail" });
        fs::write(self.login_receipts().join(gate), "").unwrap();
    }

    /// 로그인 명령이 띄워질 때마다 남긴 영수증(pid · Unix 세션 · stdin이 TTY인가 · 인자 · 손주 pid).
    pub fn login_runs(&self, agent: Agent) -> Vec<Value> {
        json_lines(&self.login_receipts().join(format!("{}-login.runs", engine_name(agent))))
    }

    /// 로그인 명령이 받은 시그널들(`TERM` · `INT`).
    pub fn login_signals(&self, agent: Agent) -> Vec<String> {
        self.login_lines(&format!("{}-login.signals", engine_name(agent)))
    }

    /// 로그인 확인이 불린 인자들 — 부를 때마다 한 줄.
    pub fn status_calls(&self, agent: Agent) -> Vec<String> {
        self.login_lines(&format!("{}-status.calls", engine_name(agent)))
    }

    /// 기록용 가짜 `open`이 받은 것들 — 엔진이 브라우저를 열려고 넘긴 URL.
    pub fn opened(&self) -> Vec<String> {
        self.login_lines("open")
    }

    fn login_lines(&self, name: &str) -> Vec<String> {
        text_lines(&self.login_receipts().join(name))
    }
}

/// 로그인 명령의 프로세스들 — 가짜 자신과 그 손주.
pub fn login_pids(run: &Value) -> Vec<u32> {
    let mut pids = vec![run["pid"].as_u64().expect("pid") as u32];
    pids.extend(run["grandchild"].as_u64().map(|pid| pid as u32));
    pids
}

// ── S26 — L1이 남긴 기록을 L3 자료로 ─────────────────────────────────────────────

/// 검사 자료 폴더. 만드는 쪽(L1)이 갖고, 화면의 L2 · L3가 그대로 읽는다.
pub fn records_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/records")
}

/// 다시 지은 기록을 고정값으로 바꾼다 — 매번 달라지는 것은 시각 · 걸린 시간 · 임시 데이터 루트 · Runtime 쪽 세션 id다.
/// 시각은 `기준 + seq초`로 다시 찍는다. 그래서 화면에서 「N초 동안 작업함」이 0이 아닌 값으로 선다. 세션 id는 첫째를
/// `fake-session`, 그 뒤는 `fake-session-2` …로 바꾼다. 가짜의 세션 id는 `fake-<pid>`라 한 id가 다른 id의 앞부분일 수 있어,
/// 긴 것부터 바꾼다.
pub fn fix_record_sessions(record: &[Value], data_root: &Path, session_ids: &[&str]) -> Vec<Value> {
    fn at(seq: u64) -> String {
        format!("2026-10-10T10:{:02}:{:02}.000+09:00", seq / 60, seq % 60)
    }
    let root = data_root.display().to_string();
    let mut last_sent = 0;
    record
        .iter()
        .map(|line| {
            let mut line = line.clone();
            let seq = line["seq"].as_u64().expect("seq");
            line["at"] = Value::from(at(seq));
            match line["kind"].as_str() {
                Some("sent") => last_sent = seq,
                Some("turn-end") => line["payload"]["durationMs"] = Value::from((seq - last_sent) * 1000),
                _ => {}
            }
            replace(&mut line, &root, "~/.atelier");
            let mut sessions: Vec<(usize, &str)> = session_ids.iter().copied().enumerate().collect();
            sessions.sort_by_key(|(_, id)| std::cmp::Reverse(id.len()));
            for (at, id) in sessions {
                let fixed = if at == 0 { "fake-session".to_owned() } else { format!("fake-session-{}", at + 1) };
                replace(&mut line, id, &fixed);
            }
            line
        })
        .collect()
}

/// Thread의 기록을 고정값으로 바꾼다 — [`fix_record_sessions`]에 더해 Thread id(지금 시각)를 `20261010-100000`으로 바꾼다. id는
/// 줄의 경로(Thread 폴더)와 머리말에 실린다.
pub fn fix_thread_record(record: &[Value], data_root: &Path, thread: &str, session_ids: &[&str]) -> Vec<Value> {
    let mut fixed = fix_record_sessions(record, data_root, session_ids);
    fixed.iter_mut().for_each(|line| replace(line, thread, "20261010-100000"));
    fixed
}

/// 명령 목록 줄(`available_commands_update`)마다 그 참여자의 열림 줄 바로 뒤로 옮기고 seq를 다시 센다. 명령 목록은 Session을 연
/// 답 뒤에 따로 오는데 새 Thread는 열자마자 첫 말을 보내므로, 그 줄과 `sent`의 차례가 매번 다르다. 축복 자료는 하나의 차례로 둔다.
pub fn commands_after_opened(record: &[Value]) -> Vec<Value> {
    let is_commands = |line: &Value| line["payload"]["update"]["sessionUpdate"] == "available_commands_update";
    let commands: Vec<Value> = record.iter().filter(|line| is_commands(line)).cloned().collect();
    let mut lines: Vec<Value> = record.iter().filter(|line| !is_commands(line)).cloned().collect();
    for command in commands {
        let opened = lines
            .iter()
            .position(|line| line["payload"]["state"] == "opened" && line["who"] == command["who"])
            .expect("그 참여자의 열림 줄");
        lines.insert(opened + 1, command);
    }
    for (n, line) in lines.iter_mut().enumerate() {
        line["seq"] = serde_json::json!(n + 1);
    }
    lines
}

/// JSON 안의 글마다 `from`을 `to`로 바꾼다.
fn replace(value: &mut Value, from: &str, to: &str) {
    match value {
        Value::String(text) => *text = text.replace(from, to),
        Value::Array(items) => items.iter_mut().for_each(|item| replace(item, from, to)),
        Value::Object(fields) => fields.values_mut().for_each(|field| replace(field, from, to)),
        _ => {}
    }
}

/// 다시 지은 기록이 검사 자료 `tests/records/<name>.jsonl`과 같은지 잰다. 줄마다 JSON으로 견준다 — 키 순서에
/// 기대지 않는다. `ATELIER_BLESS_RECORDS=1`이면 견주지 않고 자료를 다시 쓴다(가짜의 턴 모양을 바꾼 날).
///
/// 어긋나면 실제 기록을 증거 폴더(`test-results/l1-records/`)에 떠 두고 첫 어긋난 줄을 싣고 터진다.
pub fn assert_record(name: &str, actual: &[Value]) {
    let path = records_dir().join(format!("{name}.jsonl"));
    let text: String = actual.iter().map(|line| format!("{line}\n")).collect();
    if std::env::var_os("ATELIER_BLESS_RECORDS").is_some() {
        fs::create_dir_all(records_dir()).unwrap();
        fs::write(&path, &text).unwrap();
        return;
    }
    let expected: Vec<Value> = fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("검사 자료가 없다: {} — ATELIER_BLESS_RECORDS=1로 지어 둔다", path.display()))
        .lines()
        .map(|line| serde_json::from_str(line).expect("검사 자료 줄은 JSON"))
        .collect();
    if expected == actual {
        return;
    }
    let evidence: Value =
        serde_json::from_str(include_str!("../../../../scripts/evidence-dir.json")).expect("증거 폴더 설정");
    let dumped = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(evidence["evidenceDir"].as_str().expect("evidenceDir"))
        .join("l1-records")
        .join(format!("{name}.jsonl"));
    let _ = fs::create_dir_all(dumped.parent().unwrap());
    let _ = fs::write(&dumped, &text);
    let at = (0..expected.len().max(actual.len()))
        .find(|i| expected.get(*i) != actual.get(*i))
        .expect("어긋난 줄이 있다");
    panic!(
        "다시 지은 기록이 검사 자료 {}와 다르다 — {}번째 줄\n  자료: {}\n  실제: {}\n실제 기록: {}\n가짜의 턴 모양을 일부러 바꿨으면 ATELIER_BLESS_RECORDS=1로 다시 짓는다",
        path.display(),
        at + 1,
        expected.get(at).map_or("(없음)".to_owned(), Value::to_string),
        actual.get(at).map_or("(없음)".to_owned(), Value::to_string),
        dumped.display(),
    );
}

/// 그 자리의 기록 파일 줄들 — work 폴더가 옮겨진 뒤처럼 `works/<slug>` 밖의 기록을 읽는다.
pub fn record_at(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap_or_else(|_| panic!("없다: {}", path.display()))
        .lines()
        .map(|line| serde_json::from_str(line).expect("기록 줄은 JSON"))
        .collect()
}

/// 그 자리의 기록이 `done`을 채울 때까지 기다린다. 마감을 넘기면 그때까지의 기록을 싣고 터진다.
pub fn wait_record_at(path: &Path, done: impl Fn(&[Value]) -> bool) -> Vec<Value> {
    wait_until(&format!("기록이 기다린 꼴이 되지 않았다({})", path.display()), || {
        let record = record_at(path);
        if done(&record) {
            Ok(record)
        } else {
            Err(lines_text(&record))
        }
    })
}

/// 턴 · 죽음 같은 비동기 일을 기다리는 마감.
pub const PATIENCE: Duration = Duration::from_secs(10);

/// `poll`이 값을 낼 때까지 20ms마다 다시 본다 — 턴 · 죽음 · 영수증은 다른 프로세스와 스레드에서 적힌다. 마감(`PATIENCE`)을
/// 넘기면 `what`과, `poll`이 마지막에 `Err`로 준 그때의 꼴을 싣고 터진다.
pub fn wait_until<T>(what: &str, mut poll: impl FnMut() -> Result<T, String>) -> T {
    let deadline = Instant::now() + PATIENCE;
    loop {
        match poll() {
            Ok(value) => return value,
            Err(seen) if Instant::now() > deadline => {
                if seen.is_empty() {
                    panic!("{what}");
                }
                panic!("{what}:\n{seen}");
            }
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

/// `ready`가 참이 될 때까지 기다린다. 마감(`PATIENCE`)을 넘기면 `what`을 싣고 터진다.
pub fn wait_for(what: &str, mut ready: impl FnMut() -> bool) {
    wait_until(what, || if ready() { Ok(()) } else { Err(String::new()) })
}

/// JSON 줄 파일의 줄들 — 영수증 · 기록. 없으면 비어 있다.
fn json_lines(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|_| panic!("JSON 줄이 아니다({}): {line}", path.display())))
        .collect()
}

/// 글 줄 파일의 줄들. 없으면 비어 있다.
fn text_lines(path: &Path) -> Vec<String> {
    fs::read_to_string(path).unwrap_or_default().lines().map(str::to_owned).collect()
}

/// pid가 한 줄씩 적힌 파일의 pid들. 없으면 비어 있다.
fn pid_lines(path: &Path) -> Vec<u32> {
    text_lines(path).iter().map(|line| line.trim().parse().expect("pid 줄")).collect()
}

/// 영수증 한 장(JSON 파일). 없으면 터진다.
fn receipt_at(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap_or_else(|_| panic!("영수증이 없다: {}", path.display())))
        .unwrap()
}

/// 기록 줄들을 한 줄씩 — 실패 메시지용.
pub fn lines_text(record: &[Value]) -> String {
    record.iter().map(|line| line.to_string()).collect::<Vec<_>>().join("\n")
}

/// 기록에서 그 kind의 줄들.
pub fn of_kind<'a>(record: &'a [Value], kind: &str) -> Vec<&'a Value> {
    record.iter().filter(|line| line["kind"] == kind).collect()
}

/// 기록에서 그 kind의 줄들의 payload.
pub fn payloads_of(record: &[Value], kind: &str) -> Vec<Value> {
    of_kind(record, kind).into_iter().map(|line| line["payload"].clone()).collect()
}

/// 기록의 `sent` 줄들이 화면에 보일 글.
pub fn sent_texts(record: &[Value]) -> Vec<String> {
    of_kind(record, "sent").iter().map(|line| line["payload"]["text"].as_str().unwrap().to_owned()).collect()
}

/// 기록의 열림 줄들이 말하는 길(`how`) — 온 차례대로.
pub fn opened_hows(record: &[Value]) -> Vec<String> {
    record
        .iter()
        .filter(|line| line["kind"] == "session" && line["payload"]["state"] == "opened")
        .map(|line| line["payload"]["how"].as_str().expect("how").to_owned())
        .collect()
}

/// 인자 목록에 `--flag 값` 짝이 있나.
pub fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
    args.windows(2).any(|pair| pair[0] == flag && pair[1] == value)
}

/// 가짜 claude의 영수증(띄운 때 한 장 · `launches` 한 줄)에 적힌 받은 인자.
pub fn receipt_args(receipt: &Value) -> Vec<String> {
    serde_json::from_value(receipt["args"].clone()).expect("받은 인자")
}

/// 검사에서 진짜 브라우저를 막는 `BROWSER`(실측 함정 40).
pub const NO_BROWSER: Option<&str> = Some("/usr/bin/true");

/// 호스트가 내보낸 이벤트들.
#[derive(Clone, Default)]
pub struct Events(Arc<Mutex<Vec<HostEvent>>>);

impl Events {
    /// 호스트가 낸 이벤트 하나를 모은다 — 제 emit을 짓는 시험(이벤트를 붙드는 시험)이 부른다.
    pub fn push(&self, event: HostEvent) {
        self.0.lock().unwrap().push(event);
    }

    pub fn all(&self) -> Vec<HostEvent> {
        self.0.lock().unwrap().clone()
    }

    /// 엔진 상태 이벤트들 — 온 차례대로.
    pub fn engine_states(&self) -> Vec<EngineState> {
        self.all()
            .into_iter()
            .filter_map(|event| match event {
                HostEvent::Engine(state) => Some(state),
                _ => None,
            })
            .collect()
    }

    /// 엔진 상태 이벤트가 `done`을 채울 때까지 기다린다. 로그인 명령의 끝은 그것을 지켜보는 스레드가 알린다.
    pub fn wait_engine(&self, done: impl Fn(&[EngineState]) -> bool) -> Vec<EngineState> {
        wait_until("엔진 상태가 기다린 꼴이 되지 않았다", || {
            let states = self.engine_states();
            if done(&states) {
                Ok(states)
            } else {
                Err(format!("{states:#?}"))
            }
        })
    }

    /// 그 Thread의 대기 줄 바뀜 이벤트들 — 이벤트마다 그 참여자와 그때의 대기 줄 전체.
    pub fn thread_queues(&self, id: &str) -> Vec<(String, Vec<QueuedMessage>)> {
        self.all()
            .into_iter()
            .filter_map(|event| match event {
                HostEvent::ThreadQueue { thread, who, queue } if thread == id => Some((who, queue)),
                _ => None,
            })
            .collect()
    }

    /// Thread 목록 요약이 바뀐 이벤트들 — 온 차례대로.
    pub fn thread_lists(&self) -> Vec<atelier_core::ThreadSummary> {
        self.all()
            .into_iter()
            .filter_map(|event| match event {
                HostEvent::ThreadList(summary) => Some(summary),
                _ => None,
            })
            .collect()
    }
}

/// 그 Thread의 기록 줄 이벤트들을 파일 줄과 같은 꼴(JSON)로.
pub fn thread_emitted(events: &Events, id: &str) -> Vec<Value> {
    events
        .all()
        .into_iter()
        .filter_map(|event| match event {
            HostEvent::ThreadRecord { thread, line } if thread == id => Some(serde_json::to_value(line).unwrap()),
            _ => None,
        })
        .collect()
}

/// 프로세스가 살아 있나 — `ps`에 없거나 좀비(`Z`)면 끝난 것이다. macOS와 ubuntu에서 같게 돈다.
pub fn is_running(pid: u32) -> bool {
    let out = Command::new("ps").args(["-p", &pid.to_string(), "-o", "state="]).output().expect("ps");
    let state = String::from_utf8_lossy(&out.stdout);
    let state = state.trim();
    !state.is_empty() && !state.starts_with('Z')
}

/// SIGKILL은 곧바로 닿지만 `ps`에서 사라지는 데는 틈이 있다. 그 틈만 기다리고, 넘으면 남은 것을 싣고 터진다.
pub fn assert_all_gone(pids: &[u32]) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let alive: Vec<u32> = pids.iter().copied().filter(|pid| is_running(*pid)).collect();
        if alive.is_empty() {
            return;
        }
        if Instant::now() > deadline {
            panic!("남은 프로세스가 있다: {alive:?} (전부 {pids:?})");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
