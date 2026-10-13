//! 자식 프로세스의 띄우기 · 끄기 도우미. 이 크레이트가 띄우는 자식(로그인 셸 · 에이전트 · 로그인 명령)은
//! 모두 새 세션에 두고, 끌 때는 그룹째 끈다.

use std::io::BufRead;
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

/// 줄 단위로 끝까지 읽어 줄마다 `on_line`에 넘긴다 — 줄바꿈까지 든 바이트 그대로다. EOF나 읽기 오류에서 멈추고, 시그널에
/// 끊긴 읽기(EINTR)는 다시 읽는다. 받는 쪽이 할 일이 없어도 끝까지 읽는다 — 자식의 파이프가 차면 그 자식이 막힌다.
pub(crate) fn for_each_line(mut reader: impl BufRead, mut on_line: impl FnMut(&[u8])) {
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) => return,
            Ok(_) => on_line(&buf),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
}

/// 줄바꿈까지 든 한 줄의 글 — 끝의 줄바꿈(`\n` · `\r`)을 뗀다. UTF-8이 아닌 바이트는 바꿔 읽는다.
pub(crate) fn line_text(line: &[u8]) -> String {
    String::from_utf8_lossy(line).trim_end_matches(['\n', '\r']).to_owned()
}

/// 그룹 전체에 SIGKILL을 보낸다. 번호는 [`signallable`]이 거른다.
pub(crate) fn kill_group(pgid: u32) {
    signal_group(pgid, libc::SIGKILL);
}

/// 그룹 전체에 SIGTERM을 보낸다 — 로그인 명령의 취소다(three-axes 결정 30). SIGINT가 아니다.
pub(crate) fn terminate_group(pgid: u32) {
    signal_group(pgid, libc::SIGTERM);
}

fn signal_group(pgid: u32, signal: libc::c_int) {
    if let Some(pgid) = signallable(pgid) {
        // SAFETY: killpg는 번호 하나와 신호 하나만 받는다. 없는 그룹이면 ESRCH로 끝난다.
        unsafe {
            libc::killpg(pgid, signal);
        }
    }
}

/// 자식이 끝난 모양.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Exit {
    Code(i32),
    Signal(i32),
    /// 끝났지만 모양을 읽지 못했다.
    Unknown,
}

/// 자식이 끝나면 `on_exit`를 한 번 부르는 스레드를 띄운다. **끝난 자식을 거두지 않는다**(`WNOWAIT`) — 거두는 것은
/// 그룹째 끈 뒤의 `Child::wait`다. 거두기 전에는 그 번호가 다른 프로세스에게 가지 않으므로, 끝을 본 뒤에 보내는
/// `killpg`도 남의 그룹을 쏘지 않는다.
///
/// 기다리기가 실패하면 부르지 않는다 — 끝났는지 모른다는 뜻이다.
pub(crate) fn watch_exit(pid: u32, on_exit: impl FnOnce(Exit) + Send + 'static) {
    std::thread::spawn(move || loop {
        // SAFETY: siginfo_t는 수와 포인터로만 된 C 구조체라 0으로 채운 값이 유효하다.
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        // SAFETY: 자기 자식 하나를 기다리고 info에만 쓴다. WNOWAIT라 거두지 않는다.
        let rc = unsafe { libc::waitid(libc::P_PID, pid as libc::id_t, &mut info, libc::WEXITED | libc::WNOWAIT) };
        if rc == 0 {
            // SAFETY: waitid가 채운 SIGCHLD 정보다 — si_status는 그 갈래의 칸이다.
            let status = unsafe { info.si_status() };
            on_exit(match info.si_code {
                libc::CLD_EXITED => Exit::Code(status),
                libc::CLD_KILLED | libc::CLD_DUMPED => Exit::Signal(status),
                _ => Exit::Unknown,
            });
            return;
        }
        if std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return;
        }
    });
}

/// **신호를 보내도 되는 번호인가** — 앱의 `processes/ending.rs`와 같은 가드다(그쪽은 `pub(crate)`라
/// 가져오지 못한다). `killpg(0)`은 자기 그룹을, `-1`로 접히는 i32 밖의 값은 모든 프로세스를, 1은 launchd를 쏜다.
fn signallable(pid: u32) -> Option<i32> {
    i32::try_from(pid).ok().filter(|pid| *pid > 1)
}
