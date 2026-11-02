//! 웹뷰 도우미 — 앱이 책임지는 WebKit 도우미(restart 03-8 · 스토리 128 · 시안 ProcessSheet 「웹뷰 도우미」).
//!
//! 웹뷰 하나에 WebKit은 XPC 서비스 셋을 띄운다 — WebContent · GPU · Networking. 부모가 launchd라 PID 트리로 안 잡히고, 앱이 물려준
//! env도 없다. WebContent는 웹뷰에게 pid를 묻지만(`summary::WebContent`) GPU와 Networking은 물을 길이 없다. 그래서 macOS가 프로세스마다
//! 두는 **책임 프로세스**를 본다 — XPC 서비스의 책임 프로세스는 그것을 쓰는 앱이다.
//!
//! - **묻는 함수**(`responsible_for`): `responsibility_get_pid_responsible_for_pid`. 공개 헤더에 없는 libsystem 함수라 `dlsym`으로 이름을
//!   찾아 한 번 묶는다. 없으면(앞으로의 macOS가 걷었다) 늘 모른다 — 도우미는 「다른 앱」에 남고 앱은 산다. 남의 uid와 끝난 pid에는 -1을
//!   준다(모른다).
//! - **고르기**(`helpers`): 이 uid의 행 가운데 실행 파일 이름이 WebKit XPC 서비스(`PREFIX`)이고 책임 프로세스가 앱인 것. **WebKit
//!   도우미만 든다**(시안) — 앱은 제가 띄운 셸과 그 자손(책임을 물려받는다), 오디오 · 테마 · Metal 컴파일러 같은 XPC 서비스도 책임진다.
//!   셸의 것은 판정이 가르고, 나머지는 웹뷰가 아니다. 이미 우리 트리에 든 것(웹뷰가 이름 댄 WebContent 포함)은 뺀다 — 한 프로세스가 두
//!   줄에 서면 줄의 합이 합계를 넘는다.
//!
//! **앱이 제 책임 프로세스일 때만 찾힌다.** LaunchServices로 띄운 앱 번들은 제가 제 책임 프로세스라 그 도우미의 책임 프로세스가 앱이다.
//! 셸에서 띄운 개발 빌드(`pnpm tauri dev`)는 책임을 그 셸에서 물려받아(셸을 띄운 터미널 앱) 도우미도 그 앱의 것으로 선다 — 그때는 못
//! 찾고 「다른 앱」에 남는다(restart 03-8 실측). 거꾸로 아틀리에 셸에서 띄운 다른 웹뷰 앱(개발 빌드)의 WebKit 도우미는 아틀리에가 책임
//! 프로세스라 이 앱의 웹뷰 줄에 든다 — 책임 프로세스만으로는 어느 웹뷰의 도우미인지 못 가른다.
//!
//! macOS 밖에는 그 함수가 없다 — 늘 모르고, 웹뷰 줄은 WebContent뿐이다.

use std::collections::BTreeSet;

use super::{Identity, Snapshot};

/// WebKit XPC 서비스의 실행 파일 이름 앞머리 — 그 뒤가 도우미의 갈래다(`Helper::kind`).
pub const PREFIX: &str = "com.apple.WebKit.";

/// **웹뷰 도우미 하나** — 앱이 책임지는 WebKit XPC 서비스 프로세스.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Helper {
    pub id: Identity,
    /// 실행 파일 이름에서 `PREFIX`를 뗀 것 — 웹뷰 줄의 글자가 쓴다.
    pub kind: String,
}

/// **앱이 책임지는 WebKit 도우미** — 스냅샷에서 이 uid의 행 가운데 실행 파일 이름이 `PREFIX`로 시작하고, 우리 트리(`ours`) 밖이고,
/// 책임 프로세스(`responsible`)가 앱(`app` — Rust 본체의 pid)인 것. 갈래 순이다(같은 갈래는 pid 순). 책임 프로세스를 모르면(함수가 없다 ·
/// 그사이 끝났다) 고르지 않는다 — 그것은 「다른 앱」에 남는다.
pub fn helpers(
    snapshot: &Snapshot,
    app: u32,
    ours: &BTreeSet<Identity>,
    responsible: impl Fn(u32) -> Option<u32>,
) -> Vec<Helper> {
    // 이름을 먼저 가른다 — 책임 프로세스는 프로세스마다 커널에 묻는 일이라, 이 uid의 행 전부(수백 개)에 묻지 않는다.
    let mut found: Vec<Helper> = snapshot
        .procs
        .iter()
        .filter(|proc| proc.uid == snapshot.uid && !ours.contains(&proc.id))
        .filter_map(|proc| {
            let kind = proc.name.strip_prefix(PREFIX).filter(|kind| !kind.is_empty())?;
            (responsible(proc.id.pid) == Some(app)).then(|| Helper { id: proc.id, kind: kind.to_string() })
        })
        .collect();
    found.sort_by(|a, b| (&a.kind, a.id).cmp(&(&b.kind, b.id)));
    found
}

/// 책임 프로세스를 묻는 함수의 이름 — libsystem이 낸다.
#[cfg(target_os = "macos")]
const SYMBOL: &std::ffi::CStr = c"responsibility_get_pid_responsible_for_pid";

/// `pid_t responsibility_get_pid_responsible_for_pid(pid_t)`.
#[cfg(target_os = "macos")]
type Responsible = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;

/// 이름으로 함수를 찾는다(`dlsym` — 앱이 띄울 때 실린 모든 라이브러리에서). 없으면 없다.
#[cfg(target_os = "macos")]
fn bind(name: &std::ffi::CStr) -> Option<Responsible> {
    // SAFETY: `RTLD_DEFAULT`로 이름 하나를 찾을 뿐이다. 이름은 널로 끝나는 C 문자열이다.
    let symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
    // SAFETY: 찾은 것은 libsystem의 `pid_t (pid_t)` 함수다 — 이 이름은 그 함수 하나뿐이다. 널은 위에서 걸렀다.
    (!symbol.is_null()).then(|| unsafe { std::mem::transmute::<*mut libc::c_void, Responsible>(symbol) })
}

/// 이 pid의 책임 프로세스. 함수가 없거나(이 macOS가 걷었다) 모르면(남의 uid · 끝났다 — 함수가 -1을 준다) 없다. 함수는 처음 물을 때
/// 한 번 찾아 쥔다.
#[cfg(target_os = "macos")]
pub fn responsible_for(pid: u32) -> Option<u32> {
    static FUNCTION: std::sync::OnceLock<Option<Responsible>> = std::sync::OnceLock::new();
    let function = (*FUNCTION.get_or_init(|| bind(SYMBOL)))?;
    let pid = libc::pid_t::try_from(pid).ok()?;
    // SAFETY: pid 하나를 받아 pid 하나를 돌려주는 읽기다 — 남의 것이거나 없는 pid면 -1을 준다.
    let answer = unsafe { function(pid) };
    u32::try_from(answer).ok().filter(|pid| *pid > 0)
}

/// macOS 밖에는 그 함수가 없다 — 늘 모른다.
#[cfg(not(target_os = "macos"))]
pub fn responsible_for(_pid: u32) -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::processes::Proc;

    const APP: u32 = 42;

    fn proc(pid: u32, uid: u32, name: &str) -> Proc {
        Proc {
            id: Identity { pid, started_us: 1_000 + u64::from(pid) },
            ppid: 1,
            pgid: pid,
            uid,
            name: name.to_string(),
            argv0: None,
            command: None,
            path: None,
            shell_key: None,
        }
    }

    fn webkit(pid: u32, kind: &str) -> Proc {
        proc(pid, 501, &format!("{PREFIX}{kind}"))
    }

    /// **웹뷰 도우미는 앱이 책임지는 WebKit XPC 서비스다**(restart 03-8 · 시안 「WebKit 도우미만 웹뷰 줄에 넣는다」). 이 uid의 WebKit 이름
    /// 가운데 책임 프로세스가 앱인 것만 갈래 순으로 선다. 빼는 것 — 다른 앱이 책임지는 WebKit(그 앱의 웹뷰), 앱이 책임지지만 WebKit이
    /// 아닌 XPC 서비스, 이미 우리 트리에 든 것(웹뷰가 이름 댄 WebContent), 남의 uid, 책임 프로세스를 모르는 것(그사이 끝났다).
    #[test]
    fn the_webkit_helpers_are_the_ones_the_app_is_responsible_for() {
        let render = webkit(20, "Render");
        let relay = webkit(21, "Relay");
        let page = webkit(22, "Page");
        let theirs = webkit(30, "Render");
        let sandbox = proc(31, 501, "com.example.fixture.SandboxHelper");
        let root = proc(32, 0, &format!("{PREFIX}Render"));
        let gone = webkit(33, "Relay");
        let snapshot = Snapshot {
            uid: 501,
            procs: vec![render.clone(), theirs.clone(), page.clone(), sandbox.clone(), relay.clone(), root.clone(), gone.clone()],
            skipped: 0,
        };
        let responsible = |pid: u32| match pid {
            20 | 21 | 22 | 31 | 32 => Some(APP),
            30 => Some(900),
            _ => None,
        };

        let found = helpers(&snapshot, APP, &BTreeSet::from([page.id]), responsible);
        assert_eq!(
            found,
            vec![Helper { id: relay.id, kind: "Relay".into() }, Helper { id: render.id, kind: "Render".into() }],
            "앱이 책임지는 WebKit 도우미만 갈래 순으로 서야 한다"
        );
    }

    /// **책임 프로세스를 묻는 함수가 없으면 아무것도 안 고른다**(restart 03-8 「심볼이 없어도 깨지지 않는다」). 그 도우미들은 우리 트리 밖에
    /// 남아 「다른 앱」에 든다 — 웹뷰 줄은 WebContent뿐이다.
    #[test]
    fn without_the_responsibility_function_nothing_is_picked() {
        let snapshot = Snapshot { uid: 501, procs: vec![webkit(20, "Render"), webkit(21, "Relay")], skipped: 0 };
        assert_eq!(helpers(&snapshot, APP, &BTreeSet::new(), |_| None), vec![]);
    }

    /// **함수는 이름으로 찾고, 없으면 없다**(restart 03-8 「심볼이 없어도 깨지지 않는다」). 이 맥의 libsystem에는 그 함수가 있다(앵커 —
    /// 찾는 길이 늘 없음으로 무너진 것이 아니다). 없는 이름은 널이 아니라 없음이다 — 앱은 그때 아무 도우미도 못 찾고 산다.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_responsibility_function_is_bound_by_name_or_not_at_all() {
        assert!(bind(SYMBOL).is_some(), "이 맥의 libsystem에서 `{SYMBOL:?}`를 못 찾았다");
        assert!(bind(c"atelier_no_such_responsibility_function").is_none(), "없는 함수를 찾았다고 한다");
    }

    /// **책임 프로세스는 자식에게 물려진다**(restart 03-8). 이 검사가 띄운 자식의 책임 프로세스는 이 검사의 것과 같다 — 셸에서 띄운 개발
    /// 빌드가 제 도우미를 못 찾는 까닭이 이것이다(모듈 머리말). 모르는 것(없는 pid 0 · 남의 uid인 launchd)은 없음이다 — -1을 pid로 읽지
    /// 않는다.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_child_answers_to_the_same_responsible_process_as_its_parent() {
        use crate::processes::testkit::{key, Kid};

        let mine = responsible_for(std::process::id()).expect("이 검사의 책임 프로세스를 모른다");
        let kid = Kid::spawn("sleep", &key(80));
        kid.settle().expect("자식이 자리를 잡는다");
        assert_eq!(responsible_for(kid.pid()), Some(mine), "자식의 책임 프로세스가 부모의 것이 아니다");
        assert_eq!(responsible_for(0), None, "없는 pid의 책임 프로세스가 섰다");
        assert_eq!(responsible_for(1), None, "남의 uid(launchd)의 책임 프로세스가 섰다");
    }
}
