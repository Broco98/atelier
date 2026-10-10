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

use atelier_acp::{ConversationHost, HostEvent, ShellSource, TranslatorCommand};

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
        for sub in ["home", "receipts"] {
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
        let path_var = path.iter().map(|dir| dir.display().to_string()).collect::<Vec<_>>().join(":");
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
             /usr/bin/env -i PATH='{path_var}' HOME='{home}' /bin/sh -c \"$4\"\n\
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

    /// 앱처럼 지은 호스트. 셸 경로의 원천만 가짜 로그인 셸이다.
    pub fn host(&self, shell: ShellSource) -> ConversationHost {
        self.host_builder(shell).build()
    }

    pub fn host_with_limit(&self, shell: ShellSource, limit: Duration) -> ConversationHost {
        self.host_builder(shell).login_shell_limit(limit).build()
    }

    fn host_builder(&self, shell: ShellSource) -> atelier_acp::HostBuilder {
        // 변환기 시험 bin은 13이 세운다. 이 장의 명령(엔진 확인)은 변환기를 띄우지 않는다.
        let translator = TranslatorCommand::new("/usr/bin/false", ["acp-claude"]);
        ConversationHost::builder(self.data_root(), translator, shell, |event: HostEvent| match event {})
    }
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
