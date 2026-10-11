//! 가짜들(가짜 ACP 에이전트 · 가짜 `claude` · 가짜 `codex`)이 함께 쓰는 영수증 배관 — 문 기다리기 · 한 줄 더하기 · 영수증 한 장
//! 쓰기 · 받은 시그널 적기. **크레이트의 모듈 나무에 들지 않는다** — 가짜 bin들이 `#[path]`로 가져다 쓴다(로그인 흉내
//! `login.rs`도 이것을 부른다).
//!
//! 영수증 폴더와 그 안의 이름은 가짜마다 다르다 — 그 약속은 각 가짜의 머리에 있다. 여기는 그 폴더에 쓰고 읽는 손만 둔다.

use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::os::fd::IntoRawFd;
use std::path::Path;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// 문(검사가 세우는 파일)이 끝내 안 설 때 가짜가 기다림을 그만두는 한도 — 검사가 놓지 않고 사라져도 가짜가 끝없이 남지 않게.
pub const GATE_LIMIT: Duration = Duration::from_secs(60);

/// 문을 보는 틈.
const GATE_POLL: Duration = Duration::from_millis(10);

/// `gate`가 설 때까지 기다린다. 섰으면 true, `limit`을 넘기면 false다.
pub fn wait_for(gate: &Path, limit: Duration) -> bool {
    wait_for_any(&[gate], limit).is_some()
}

/// `gates` 가운데 하나가 설 때까지 기다리고 선 문을 돌려준다. 함께 섰으면 앞의 것이다. `limit`을 넘기면 `None`이다.
pub fn wait_for_any<'a>(gates: &[&'a Path], limit: Duration) -> Option<&'a Path> {
    let deadline = Instant::now() + limit;
    loop {
        if let Some(gate) = gates.iter().find(|gate| gate.exists()) {
            return Some(gate);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(GATE_POLL);
    }
}

/// `path`에 한 줄을 더한다(없으면 만든다). 쓰지 못하면 아무것도 하지 않는다 — 영수증은 검사가 읽는 것이라 가짜를 멈추지 않는다.
pub fn append_line(path: &Path, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

/// 영수증 한 장을 `path`에 쓴다 — 반쯤 쓴 영수증을 검사가 읽지 않게 같은 폴더의 `.<이름>.tmp`에 쓰고 옮긴다.
pub fn write_atomically(path: &Path, receipt: &serde_json::Value) {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    let _ = std::fs::write(&tmp, receipt.to_string());
    let _ = std::fs::rename(&tmp, path);
}

/// 받은 env 전체 — 영수증에 싣는다(검사가 로그인 env가 그대로 왔는지 본다).
pub fn env_map() -> BTreeMap<String, String> {
    std::env::vars_os()
        .map(|(name, value)| (name.to_string_lossy().into_owned(), value.to_string_lossy().into_owned()))
        .collect()
}

/// 자기 Unix 세션 id — 새 세션에 떴는지(`setsid`) 잰다.
pub fn unix_session() -> i32 {
    // SAFETY: getsid(0)은 인자 없이 자기 세션 id를 돌려줄 뿐이다.
    unsafe { libc::getsid(0) }
}

/// 시그널 처리기가 쓸 영수증의 fd와, 시그널마다 적을 줄. 처리기를 걸기 전에 선다 — 처리기 안에서는 이미 선 값을 읽기만 하고
/// async-signal-safe한 `write`와 `_exit`만 부른다.
static SIGNALS_FD: AtomicI32 = AtomicI32::new(-1);
static SIGNAL_LINES: OnceLock<&'static [(libc::c_int, &'static [u8])]> = OnceLock::new();

/// `lines`의 시그널을 받으면 그 줄을 `path`에 적고 `128 + 시그널`로 끝나도록 처리기를 건다. `path`가 없거나 열지 못하면
/// 적지 않고 끝나기만 한다. SIGKILL은 받을 수 없으니 적히지 않는다.
pub fn record_signals(path: Option<&Path>, lines: &'static [(libc::c_int, &'static [u8])]) {
    if let Some(file) = path.and_then(|path| OpenOptions::new().create(true).append(true).open(path).ok()) {
        SIGNALS_FD.store(file.into_raw_fd(), Ordering::SeqCst);
    }
    let _ = SIGNAL_LINES.set(lines);
    for &(signal, _) in lines {
        // SAFETY: 처리기는 async-signal-safe한 일만 한다.
        unsafe {
            libc::signal(signal, on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t);
        }
    }
}

extern "C" fn on_signal(signal: libc::c_int) {
    let line = SIGNAL_LINES.get().and_then(|lines| lines.iter().find(|(caught, _)| *caught == signal)).map(|(_, line)| *line);
    let fd = SIGNALS_FD.load(Ordering::SeqCst);
    // SAFETY: write와 _exit는 async-signal-safe다. fd는 처리기를 걸기 전에 열어 두었고, 줄은 정적 바이트다.
    unsafe {
        if let (Some(line), true) = (line, fd >= 0) {
            libc::write(fd, line.as_ptr().cast(), line.len());
        }
        libc::_exit(128 + signal);
    }
}
