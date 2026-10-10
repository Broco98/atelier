//! 자식 프로세스의 띄우기 · 끄기 도우미. 이 크레이트가 띄우는 자식(로그인 셸 · 에이전트 · 로그인 명령)은
//! 모두 새 세션에 두고, 끌 때는 그룹째 끈다.

use std::os::unix::process::CommandExt;
use std::process::Command;

/// 자식을 새 세션에 둔다(워크플로 S40). 새 프로세스 그룹만으로는 앱이 제어 터미널을 가질 때
/// (`pnpm tauri dev`, 터미널에서 돈 `cargo test`) `zsh -i`가 SIGTTOU로 멈춘다. 새 세션은 새 그룹이기도
/// 해서 pgid = 자식 pid이고, 그룹째 끄기가 그대로 된다.
///
/// std의 `CommandExt::setsid`는 불안정 기능이라 `pre_exec`에서 `libc::setsid`를 부른다(워크플로 함정 28).
pub(crate) fn in_new_session(command: &mut Command) -> &mut Command {
    // SAFETY: fork 뒤 exec 전의 자식에서 async-signal-safe한 setsid 하나만 부른다.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        })
    }
}

/// 그룹 전체에 SIGKILL을 보낸다. 번호는 [`signallable`]이 거른다.
pub(crate) fn kill_group(pgid: u32) {
    if let Some(pgid) = signallable(pgid) {
        // SAFETY: killpg는 번호 하나와 신호 하나만 받는다. 없는 그룹이면 ESRCH로 끝난다.
        unsafe {
            libc::killpg(pgid, libc::SIGKILL);
        }
    }
}

/// **신호를 보내도 되는 번호인가** — 앱의 `processes/ending.rs`와 같은 가드다(그쪽은 `pub(crate)`라
/// 가져오지 못한다). `killpg(0)`은 자기 그룹을, `-1`로 접히는 i32 밖의 값은 모든 프로세스를, 1은 launchd를 쏜다.
fn signallable(pid: u32) -> Option<i32> {
    i32::try_from(pid).ok().filter(|pid| *pid > 1)
}
