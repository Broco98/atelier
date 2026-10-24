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

/// 명령을 띄운다 — 못 뜨면 거기서 검사를 멈춘다(처리기 파일이 없거나 실행 권한이 없다). 「Text file busy」만 짧게 몇 번 다시
/// 띄운다(`spawn_past_busy_text`).
pub(crate) trait Launch {
    fn into_spawned(self) -> Child;
}

impl Launch for Command {
    fn into_spawned(mut self) -> Child {
        spawn_past_busy_text(|| self.spawn()).unwrap_or_else(|e| panic!("훅이 안 뜬다({e}): {self:?}"))
    }
}

/// 「Text file busy」에 다시 띄우기 전에 쉬는 틈(ms). 다 쉬면 한 번 더 띄우고, 그래도 바쁘면 그 오류를 돌려준다.
const BUSY_TEXT_WAITS_MS: [u64; 5] = [10, 20, 40, 80, 160];

/// 띄우기 `spawn`을 부르되 **ETXTBSY(os error 26)일 때만 짧게 몇 번 다시 부른다.** 다른 오류는 기다려도 안 풀리니 곧바로 돌려준다.
///
/// 처리기 파일은 앱 코드(`write_hook_scripts`)가 이 검사 프로세스 안에서 쓴다. 그 쓰기 fd가 열린 사이 다른 검사 스레드가 fork하면
/// 그 자식이 exec할 때까지 fd를 쥐어, 막 세운 처리기를 띄우면 리눅스가 「Text file busy」로 막는다(macOS는 안 막는다). 검사가 쓰는
/// 실행 파일은 자식 `sh`에 쓰기를 맡겨 피하지만(`atelier-acp` `tests/common`의 `write_script`) 앱 코드의 쓰기는 검사가 못 바꾼다.
/// 쥔 자식은 곧 exec해 fd를 놓으니 기다리면 풀린다.
///
/// 한 번 뜨면 그 뒤로는 안 막힌다 — 쓰기가 끝난 뒤의 fork는 fd를 물려받지 않는다. 셸이 처리기를 띄우는 꼴(`/bin/sh -c`)은 이
/// 길을 못 타므로(셸이 126으로 끝난다), 그런 검사는 그 앞에 처리기를 곧바로 한 번 띄운다(`ready_handler` 등).
fn spawn_past_busy_text<T>(mut spawn: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    for wait in BUSY_TEXT_WAITS_MS {
        match spawn() {
            Err(e) if e.raw_os_error() == Some(libc::ETXTBSY) => std::thread::sleep(std::time::Duration::from_millis(wait)),
            done => return done,
        }
    }
    spawn()
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

/// 띄우기를 흉내 낸다 — `answers`를 차례로 돌려주고 불린 수를 센다. 다 쓰면 마지막 답을 되풀이한다.
fn scripted(answers: Vec<Option<i32>>) -> (impl FnMut() -> std::io::Result<()>, std::rc::Rc<std::cell::Cell<usize>>) {
    let calls = std::rc::Rc::new(std::cell::Cell::new(0));
    let counted = calls.clone();
    let spawn = move || {
        let n = counted.get();
        counted.set(n + 1);
        match answers[n.min(answers.len() - 1)] {
            None => Ok(()),
            Some(code) => Err(std::io::Error::from_raw_os_error(code)),
        }
    };
    (spawn, calls)
}

/// **ETXTBSY면 다시 띄운다** — 리눅스에서 다른 검사 스레드의 fork가 처리기의 쓰기 fd를 exec 전까지 쥔 사이다. 그 자식이 exec하면
/// 풀리므로, 두 번 바빴다가 세 번째에 뜨면 뜬 것이다.
#[test]
fn a_busy_text_file_is_spawned_again() {
    let (spawn, calls) = scripted(vec![Some(libc::ETXTBSY), Some(libc::ETXTBSY), None]);
    assert!(spawn_past_busy_text(spawn).is_ok(), "바빴다가 풀린 처리기를 못 띄웠다");
    assert_eq!(calls.get(), 3);
}

/// **다른 오류는 곧바로 돌려준다** — 처리기가 없거나 실행 권한이 없는 것은 기다려도 안 풀린다. 다시 띄우면 진짜 고장을 늦게 본다.
#[test]
fn any_other_spawn_error_is_returned_at_once() {
    for code in [libc::ENOENT, libc::EACCES, libc::ENOEXEC] {
        let (spawn, calls) = scripted(vec![Some(code), None]);
        let failed = spawn_past_busy_text(spawn).expect_err("한 번에 실패해야 한다");
        assert_eq!((failed.raw_os_error(), calls.get()), (Some(code), 1), "os error {code}를 다시 띄웠다");
    }
}

/// **끝내 바쁘면 손을 떼고 그 오류를 돌려준다** — 쓰기 fd를 영영 쥔 것이 있으면 기다림이 검사를 붙잡지 않고 빨갛다.
#[test]
fn a_text_file_that_stays_busy_fails_after_a_few_tries() {
    let (spawn, calls) = scripted(vec![Some(libc::ETXTBSY)]);
    let started = std::time::Instant::now();
    let failed = spawn_past_busy_text(spawn).expect_err("끝내 바쁘면 실패한다");
    assert_eq!(failed.raw_os_error(), Some(libc::ETXTBSY));
    assert!((2..=10).contains(&calls.get()), "{}번 띄웠다 — 몇 번만 다시 띄운다", calls.get());
    assert!(started.elapsed() < std::time::Duration::from_secs(2), "{:?}를 기다렸다", started.elapsed());
}
