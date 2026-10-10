//! L1 대화 호스트 시험의 공용 도우미 — 샌드박스와 가짜 로그인 셸.
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

use atelier_acp::{ConversationHost, HostEvent, ShellSource, TranslatorCommand};
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
        for sub in ["home", "receipts", "receipts/acp"] {
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
        fs::read_to_string(self.receipts().join("calls"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// 가짜 로그인 셸이 적은 pid들(셸 자신 · 배경 작업).
    pub fn shell_pids(&self) -> Vec<u32> {
        fs::read_to_string(self.receipts().join("pids"))
            .unwrap_or_default()
            .lines()
            .map(|line| line.trim().parse().expect("pid 줄"))
            .collect()
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
        (self.host_builder(shell, move |event| sink.0.lock().unwrap().push(event)), events)
    }

    fn host_builder(
        &self,
        shell: ShellSource,
        emit: impl Fn(HostEvent) + Send + Sync + 'static,
    ) -> atelier_acp::HostBuilder {
        // 변환기 시험 bin은 13이 세운다. 이 장의 명령은 Claude 대화를 띄우지 않는다.
        let translator = TranslatorCommand::new("/usr/bin/false", ["acp-claude"]);
        ConversationHost::builder(self.data_root(), translator, shell, emit)
    }

    // ── work와 Codex 대화 ──────────────────────────────────────────────────────

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

    /// Codex를 띄우는 데 드는 셋을 둔 PATH 폴더. `codex-acp`는 가짜 ACP 에이전트 bin을 가리키는 링크이고,
    /// `codex` · `node`는 찾기만 하는 가짜다.
    pub fn codex_bin(&self) -> PathBuf {
        let bin = self.bin("codex-bin");
        std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_fake-acp-agent"), bin.join("codex-acp")).unwrap();
        self.plant(&bin, "codex");
        self.plant(&bin, "node");
        bin
    }

    /// 가짜 ACP 에이전트의 시나리오를 로그인 env에 실은 로그인 셸.
    pub fn codex_login_shell(&self, scenario: &str, extra: &[(&str, &str)]) -> ShellSource {
        let bin = self.codex_bin();
        self.codex_login_shell_in(&bin, scenario, extra)
    }

    /// `codex-acp` 자리에 가짜 ACP 에이전트 대신 이 내용의 실행 파일을 둔 로그인 셸 — ACP가 아닌 명령,
    /// 실행할 수 없는 파일.
    pub fn codex_login_shell_with_program(&self, contents: &[u8]) -> ShellSource {
        let bin = self.bin("codex-bin");
        let program = bin.join("codex-acp");
        fs::write(&program, contents).unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
        self.plant(&bin, "codex");
        self.plant(&bin, "node");
        self.codex_login_shell_in(&bin, "normal", &[])
    }

    fn codex_login_shell_in(&self, bin: &Path, scenario: &str, extra: &[(&str, &str)]) -> ShellSource {
        let receipts = self.acp_receipts();
        let receipts = receipts.to_str().unwrap();
        let mut env = vec![("FAKE_ACP_SCENARIO", scenario), ("FAKE_ACP_RECEIPTS", receipts)];
        env.extend_from_slice(extra);
        ShellSource::Path(self.login_shell_with_env(LoginShell::Normal, &[bin, Path::new("/usr/bin"), Path::new("/bin")], &env))
    }

    /// 영수증 폴더의 `name` 파일에 한 줄씩 적힌 pid들 — 가짜 `codex-acp` 스크립트가 적는다.
    pub fn receipt_pids(&self, name: &str) -> Vec<u32> {
        fs::read_to_string(self.acp_receipts().join(name))
            .unwrap_or_default()
            .lines()
            .map(|line| line.trim().parse().expect("pid 줄"))
            .collect()
    }

    fn acp_receipts(&self) -> PathBuf {
        self.receipts().join("acp")
    }

    /// 가짜 ACP 에이전트가 그 세션을 열 때 남긴 영수증.
    pub fn acp_receipt(&self, session_id: &str) -> Value {
        let path = self.acp_receipts().join(format!("{session_id}.json"));
        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(|_| panic!("영수증이 없다: {}", path.display())))
            .unwrap()
    }

    /// 가짜 ACP 에이전트가 세션을 연 뒤 겪은 일들(줄마다 하나).
    pub fn acp_events(&self, session_id: &str) -> Vec<String> {
        fs::read_to_string(self.acp_receipts().join(format!("{session_id}.events")))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// 그 work의 `agents.json`.
    pub fn agents_json(&self, slug: &str) -> Value {
        let path = self.work_dir(slug).join("agents/agents.json");
        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(|_| panic!("없다: {}", path.display()))).unwrap()
    }

    /// `agents.json`의 그 대화 줄.
    pub fn agents_row(&self, slug: &str, conversation: &str) -> Value {
        self.agents_json(slug)["conversations"]
            .as_array()
            .expect("conversations 배열")
            .iter()
            .find(|row| row["id"] == conversation)
            .unwrap_or_else(|| panic!("agents.json에 {conversation} 줄이 없다"))
            .clone()
    }

    /// 그 대화의 기록 파일 줄들.
    pub fn record(&self, slug: &str, conversation: &str) -> Vec<Value> {
        let path = self.work_dir(slug).join("agents").join(format!("{conversation}.jsonl"));
        fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("없다: {}", path.display()))
            .lines()
            .map(|line| serde_json::from_str(line).expect("기록 줄은 JSON"))
            .collect()
    }
}

/// 호스트가 내보낸 이벤트들.
#[derive(Clone, Default)]
pub struct Events(Arc<Mutex<Vec<HostEvent>>>);

impl Events {
    pub fn all(&self) -> Vec<HostEvent> {
        self.0.lock().unwrap().clone()
    }
}

/// 테스트 프로세스 자신의 Unix 세션 id.
pub fn own_sid() -> i32 {
    // SAFETY: getsid(0)은 인자 없이 자기 세션 id를 돌려줄 뿐이다.
    unsafe { libc::getsid(0) }
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
