//! 훅 처리기 검사 도구 — 처리기를 **에이전트가 부르는 모양으로** 띄우고, 페이로드를 주고, 남긴 상태 파일을 읽는다. 셸 신호의
//! 검사(`shells`)와 설치한 줄을 실제로 돌려 보는 검사(`hooks`의 `the_installed_lines_run_the_handler`)가 함께 쓴다.
//!
//! **검사가 띄우는 처리기는 진짜 셸 · 진짜 데이터 루트를 안 건드린다.** 검사 프로세스는 이 앱의 셸에서 떠 진짜 셸 키
//! (`ATELIER_SHELL`)를 물려받았다 — 그래서 셸 키는 늘 명시하고(없으면 지운다), 데이터 루트(`ATELIER_HOME`)는 늘 임시 루트다.

use std::path::Path;
use std::process::{Child, Command, Output, Stdio};

use super::state_path;

/// 에이전트가 훅을 부르는 모양으로 명령을 꾸민다 — 데이터 루트는 `root`, 셸 키는 `shell`(없으면 물려받은 것을 지운다),
/// stdin · stdout · stderr는 파이프다. 부르는 쪽이 띄우고 `feed`로 페이로드를 준다.
fn as_an_agent_calls(mut command: Command, root: &Path, shell: Option<&str>) -> Command {
    command
        .env("ATELIER_HOME", root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match shell {
        Some(id) => command.env("ATELIER_SHELL", id),
        None => command.env_remove("ATELIER_SHELL"),
    };
    command
}

/// 훅 한 장(`program`)을 argv `args`로 띄울 명령 — 옛 python 처리기의 검사가 쓴다. `HOME`은 안 옮긴다: macOS의 python은
/// `HOME/Library`에 캐시를 적어 「상태 폴더 밖에 안 쓴다」 검사가 그것을 제 자국으로 본다.
pub(crate) fn hook_command(program: &Path, root: &Path, shell: Option<&str>, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    as_an_agent_calls(command, root, shell)
}

/// 새 처리기를 부르는 명령 `command`를 에이전트가 부르는 모양으로 꾸민다 — `hook_command`에 **`HOME`까지 임시 루트로 옮긴다.**
/// 새 처리기는 `ATELIER_HOME`이 없으면 `HOME` 아래로 간다 — 검사가 그 갈래를 밟을 때 진짜 홈에 쓰면 안 된다.
///
/// 명령은 부르는 쪽이 짓는다: claude의 `args` 꼴(처리기를 곧바로), codex의 셸 꼴(`/bin/sh -c <명령줄>`) 모두 이것을 지난다.
pub(crate) fn handler_call(command: Command, root: &Path, shell: Option<&str>) -> Command {
    let mut command = as_an_agent_calls(command, root, shell);
    command.env("HOME", root);
    command
}

/// 새 처리기(`program`)를 argv `args`로 곧바로 띄울 명령 — claude가 `args` 꼴 훅을 띄우는 모양이다(`handler_call`).
pub(crate) fn handler_command(program: &Path, root: &Path, shell: Option<&str>, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    handler_call(command, root, shell)
}

/// 명령을 띄운다 — 못 뜨면 거기서 검사를 멈춘다(처리기 파일이 없거나 실행 권한이 없다).
pub(crate) trait Launch {
    fn into_spawned(self) -> Child;
}

impl Launch for Command {
    fn into_spawned(mut self) -> Child {
        self.spawn().unwrap_or_else(|e| panic!("훅이 안 뜬다({e}): {self:?}"))
    }
}

/// 뜬 훅에 페이로드를 다 쓰고 파이프를 닫은 뒤 끝을 기다린다.
///
/// **쓰기의 실패를 삼키지 않고 돌려준다.** 훅이 stdin을 안 읽고 나가면 그 실패는 훅이 아니라 **쓰는 쪽**(에이전트)에서
/// `EPIPE`로 나므로, 여기서 `unwrap`으로 삼키면 그 자리를 잴 검사가 어디에도 안 남는다.
pub(crate) fn feed(mut child: Child, stdin: &str) -> (std::io::Result<()>, Output) {
    use std::io::Write;

    let mut pipe = child.stdin.take().expect("stdin이 열려 있다");
    let wrote = pipe.write_all(stdin.as_bytes()).and_then(|()| pipe.flush());
    // 파이프를 닫아야 스크립트의 `read()`가 EOF를 본다 — 안 닫으면 둘이 서로를 기다린다.
    drop(pipe);
    (wrote, child.wait_with_output().expect("끝난다"))
}

/// **조용한 성공** — 처리기가 0으로 끝나고 아무 말도 없다. 에이전트는 0이 아닌 코드를 훅 실패로 읽어 사람에게 오류를 보이고,
/// claude는 `UserPromptSubmit`의 stdout을 대화에 싣는다. `what`은 어느 부름인지 단언 글에 붙는다.
pub(crate) fn assert_quiet_success(out: &Output, what: &str) {
    assert!(out.status.success(), "{what}: 0이 아닌 코드로 끝났다: {out:?}");
    assert!(out.stdout.is_empty() && out.stderr.is_empty(), "{what}: 처리기가 말을 했다: {out:?}");
}

/// 그 셸의 상태 파일 — 처리기가 남긴 것. 없거나 JSON이 아니면 거기서 검사를 멈춘다.
pub(crate) fn state_in(root: &Path, shell: &str) -> serde_json::Value {
    let written = std::fs::read_to_string(state_path(root, shell)).expect("그 셸의 상태 파일이 있다");
    serde_json::from_str(&written).unwrap_or_else(|e| panic!("상태 파일이 JSON이 아니다({e}): {written}"))
}
