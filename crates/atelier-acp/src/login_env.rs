//! 로그인 셸의 환경 읽기(워크플로 §10 · 티켓 05). Finder에서 띄운 앱의 환경은 launchd의 빈약한 것이라,
//! 내 터미널과 같은 PATH를 얻으려면 로그인 셸에게 환경을 찍게 해 읽는다.

use std::collections::BTreeMap;
use std::ffi::{CStr, OsStr, OsString};
use std::fmt;
use std::io::Read;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use crate::process;

/// 로그인 셸 읽기의 기본 한도.
pub(crate) const DEFAULT_LIMIT: Duration = Duration::from_secs(10);

/// 셸 경로의 원천 — 대화 호스트가 받는 넷 가운데 하나.
///
/// 검사는 셸을 프로세스 env(`$SHELL`)가 아니라 이 인자로 준다. 다른 검사가 `$SHELL`을 바꾸므로
/// (`src-tauri/src/pty.rs`) env로 주면 나란히 도는 검사끼리 서로를 밟는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellSource {
    /// 사용자의 로그인 셸 — `$SHELL`, 비었으면 passwd의 셸, 그것도 없으면 `/bin/sh`.
    /// 앱 PTY가 셸을 고르는 규칙(`$SHELL` → passwd)과 같다.
    User,
    /// 정한 셸.
    Path(PathBuf),
}

impl ShellSource {
    fn resolve(&self) -> PathBuf {
        match self {
            ShellSource::Path(path) => path.clone(),
            ShellSource::User => std::env::var_os("SHELL")
                .filter(|shell| !shell.is_empty())
                .map(PathBuf::from)
                .or_else(passwd_shell)
                .unwrap_or_else(|| PathBuf::from("/bin/sh")),
        }
    }
}

/// passwd에 적힌 이 사용자의 셸. `getpwuid`는 정적 버퍼를 돌려줘 스레드에 안전하지 않으므로 `_r`을 쓴다.
fn passwd_shell() -> Option<PathBuf> {
    let mut buf = vec![0 as libc::c_char; 4096];
    // SAFETY: passwd는 포인터와 수로만 된 C 구조체라 0으로 채운 값이 유효하다.
    let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
    let mut found: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: 버퍼와 길이를 짝으로 넘긴다. 성공하면 entry의 포인터들은 buf 안을 가리킨다.
    let rc = unsafe { libc::getpwuid_r(libc::getuid(), &mut entry, buf.as_mut_ptr(), buf.len(), &mut found) };
    if rc != 0 || found.is_null() || entry.pw_shell.is_null() {
        return None;
    }
    // SAFETY: 위에서 null이 아님을 봤고, buf가 살아 있는 동안 읽어 곧바로 복사한다.
    let shell = unsafe { CStr::from_ptr(entry.pw_shell) }.to_bytes();
    (!shell.is_empty()).then(|| PathBuf::from(OsStr::from_bytes(shell)))
}

/// 로그인 셸 읽기가 실패한 까닭 — 셋뿐이다(워크플로 §10).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginShellError {
    /// 셸을 실행할 수 없음 — 없는 경로 · 실행 권한이 없는 파일.
    CannotRun { shell: PathBuf, reason: String },
    /// 표지 없이 끝남 — rc가 다른 셸로 exec했을 수 있다.
    NoMarker { shell: PathBuf },
    /// 한도를 넘김.
    TimedOut { shell: PathBuf, limit: Duration },
}

impl fmt::Display for LoginShellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoginShellError::CannotRun { shell, reason } => {
                write!(f, "로그인 셸을 실행할 수 없습니다: {} — {reason}", shell.display())
            }
            LoginShellError::NoMarker { shell } => write!(
                f,
                "로그인 셸이 환경을 찍지 않고 끝났습니다: {} — rc가 다른 셸로 exec했을 수 있습니다",
                shell.display()
            ),
            LoginShellError::TimedOut { shell, limit } => write!(
                f,
                "로그인 셸이 {} 안에 환경을 찍지 않았습니다: {}",
                spoken(*limit),
                shell.display()
            ),
        }
    }
}

impl std::error::Error for LoginShellError {}

fn spoken(limit: Duration) -> String {
    if limit.subsec_millis() == 0 {
        format!("{}초", limit.as_secs())
    } else {
        format!("{}ms", limit.as_millis())
    }
}

/// 로그인 셸의 환경 전체를 읽는다. 막히는 호출이다.
///
/// - `$SHELL -l -i -c`로 띄운다. **`-i`를 꼭 준다** — `-l`만으로는 zsh가 `.zshrc`를 안 읽어, 거기서 세운
///   PATH(`~/.local/bin`의 `claude`)를 놓친다.
/// - 표지는 읽을 때마다 새 난수로 짓고, 표지와 환경은 절대 경로로 찍는다(`/usr/bin/printf` ·
///   `/usr/bin/env -0`) — rc의 alias · 함수를 피하고, 줄바꿈이 든 값도 온전히 받는다. 표지 밖 출력(rc의
///   인사말)과 stderr는 결과로 쓰지 않는다.
/// - stdin은 `/dev/null`, 새 세션에 띄운다(워크플로 S40).
/// - **END 표지에서 읽기를 멈추고 곧바로 그룹을 끈다.** EOF를 기다리지 않는다 — rc가 띄운 배경 작업이
///   stdout을 쥐고 살아 EOF가 오지 않는다. 표지 없이 끝났어도, 한도를 넘겨도 그룹을 끈다.
pub(crate) fn read(shell: &ShellSource, limit: Duration) -> Result<Vec<(OsString, OsString)>, LoginShellError> {
    let shell = shell.resolve();
    let marker = Marker::new();

    let mut command = Command::new(&shell);
    command
        .args(["-l", "-i", "-c"])
        .arg(marker.script())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    process::in_new_session(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| LoginShellError::CannotRun { shell: shell.clone(), reason: error.to_string() })?;
    let pgid = child.id();

    let stdout = child.stdout.take().expect("stdout을 파이프로 띄웠다");
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        // 한도를 넘겨 받는 쪽이 떠났으면 보내기가 실패한다. 그대로 버린다.
        let _ = tx.send(marker.read_between(stdout));
    });
    let outcome = rx.recv_timeout(limit);

    // 거두기 전에 끈다 — 셸이 이미 끝났어도 거두지 않은 동안은 그 번호가 다른 프로세스에게 가지 않는다.
    process::kill_group(pgid);
    let _ = child.wait();

    match outcome {
        Ok(Some(body)) => Ok(parse_env(&body)),
        Ok(None) | Err(mpsc::RecvTimeoutError::Disconnected) => Err(LoginShellError::NoMarker { shell }),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(LoginShellError::TimedOut { shell, limit }),
    }
}

/// 한 번의 읽기에 쓰는 표지 한 쌍.
struct Marker {
    begin: Vec<u8>,
    end: Vec<u8>,
    token: String,
}

const MARKER_PREFIX: &str = "ATELIER-LOGIN-ENV-";

impl Marker {
    fn new() -> Self {
        let token = random_token();
        Self {
            begin: format!("{MARKER_PREFIX}{token}-BEGIN").into_bytes(),
            end: format!("{MARKER_PREFIX}{token}-END").into_bytes(),
            token,
        }
    }

    /// 셸에 넘길 명령. 표지를 두 조각으로 나눠 찍는다 — rc가 받은 명령 줄을 stdout에 되울려도 그 글에는
    /// 표지가 이어 붙은 꼴로 나타나지 않는다. zsh · bash · fish 모두 읽는 문법만 쓴다.
    fn script(&self) -> String {
        let token = &self.token;
        format!(
            "/usr/bin/printf '%s%s' '{MARKER_PREFIX}' '{token}-BEGIN'; \
             /usr/bin/env -0; \
             /usr/bin/printf '%s%s' '{MARKER_PREFIX}' '{token}-END'"
        )
    }

    /// 표지 사이의 바이트. END 표지를 보면 곧바로 돌아온다. 그 전에 EOF면 `None`.
    fn read_between(&self, mut out: impl Read) -> Option<Vec<u8>> {
        let mut seen = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match out.read(&mut chunk) {
                Ok(0) => return None,
                Ok(n) => seen.extend_from_slice(&chunk[..n]),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return None,
            }
            if let Some(start) = find(&seen, &self.begin) {
                let body = start + self.begin.len();
                if let Some(len) = find(&seen[body..], &self.end) {
                    return Some(seen[body..body + len].to_vec());
                }
            }
        }
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

/// 읽을 때마다 새 표지. 보안 값이 아니라 rc 출력과 겹치지 않기만 하면 되므로, 프로세스마다 무작위로
/// 씨앗을 받는 std의 `RandomState`에 pid · 시각 · 횟수를 섞는다 — 난수 크레이트를 들이지 않는다.
fn random_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNT: AtomicU64 = AtomicU64::new(0);
    let count = COUNT.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or_default();
    let half = |salt: u64| {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(salt);
        hasher.write_u64(count);
        hasher.write_u32(std::process::id());
        hasher.write_u128(nanos);
        hasher.finish()
    };
    format!("{:016x}{:016x}", half(0), half(1))
}

/// `env -0`의 출력 — `이름=값\0`이 이어진다. 값에 줄바꿈이 들어도 온전하다.
fn parse_env(body: &[u8]) -> Vec<(OsString, OsString)> {
    body.split(|byte| *byte == 0)
        .filter_map(|entry| {
            let eq = entry.iter().position(|byte| *byte == b'=')?;
            let (name, value) = (&entry[..eq], &entry[eq + 1..]);
            (!name.is_empty()).then(|| (OsString::from_vec(name.to_vec()), OsString::from_vec(value.to_vec())))
        })
        .collect()
}

/// 에이전트에게 주는 env — 로그인 env에서 지울 것을 지우고 `GIT_OPTIONAL_LOCKS=0`을 더한 것(워크플로 S20).
/// 자식에게는 덧붙이지 않고 이것으로 **통째로 바꿔** 준다(03이 띄운다).
///
/// - `ATELIER_SHELL` — 사용자 훅이 개발자 셸에 신호를 쏘지 않게.
/// - `ATELIER_MODE` — 사용자 `atelier` MCP가 기본 루트를 읽게.
/// - `CLAUDECODE` · `CLAUDE_CODE_*` · `CLAUDE_PID` · `CODEX_COMPANION_*` — Claude가 몬 셸에서 앱을 띄웠을 때
///   그 세션 변수가 새지 않게.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AgentEnv {
    vars: BTreeMap<OsString, OsString>,
}

impl AgentEnv {
    pub(crate) fn from_login(login: Vec<(OsString, OsString)>) -> Self {
        let mut vars: BTreeMap<OsString, OsString> =
            login.into_iter().filter(|(name, _)| !leaks_into_agent(name)).collect();
        vars.insert("GIT_OPTIONAL_LOCKS".into(), "0".into());
        Self { vars }
    }

    /// 이 env의 PATH — 에이전트를 찾는 자리다.
    pub(crate) fn path(&self) -> Option<&OsStr> {
        self.vars.get(OsStr::new("PATH")).map(OsString::as_os_str)
    }
}

fn leaks_into_agent(name: &OsStr) -> bool {
    let name = name.as_bytes();
    matches!(name, b"ATELIER_SHELL" | b"ATELIER_MODE" | b"CLAUDECODE" | b"CLAUDE_PID")
        || name.starts_with(b"CLAUDE_CODE_")
        || name.starts_with(b"CODEX_COMPANION_")
}

