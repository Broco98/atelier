//! 실물 검사가 띄우는 자식 — 수집 · 끝내기 · 셸 닫기의 macOS 실물 검사가 함께 쓴다(프로세스 스펙 S46).
//!
//! **자식은 이 테스트 바이너리 자신이다.** 시스템 바이너리는 env가 0개로 읽혀 표식을 잴 수 없고, 검사가
//! 제 env에 표식을 심는 것도 안 된다 — `KERN_PROCARGS2`가 주는 것은 exec 때의 env다. 그래서 바이너리를
//! **테스트 이름 필터**(`--exact <자식 테스트>`)와 env(표식, 역할)로 다시 띄운다. libtest는 모르는 플래그를
//! 거절해서 역할을 인자로는 못 넘긴다.
//!
//! **이 기계의 진짜 프로세스를 건드리지 않는 것이 이 파일의 규칙이다.** 구현 세션도 사용자의 셸도 같은
//! 표에 있다. 표식 값은 실제 세대와 겹치지 않게 `test-<검사 pid>-<번호>`로 짓고(`key`), 신호는 검사가
//! 띄운 자식에게만 간다.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use super::{snapshot, Identity, SHELL_KEY_ENV};

/// 자식의 역할을 싣는 변수. 앱은 이 이름을 모른다.
pub(crate) const CHILD_ROLE: &str = "ATELIER_PROCESSES_TEST_CHILD";

/// 역할 `map`이 붙이는 파일의 크기(바이트).
pub(crate) const MAPPED: usize = 64 * 1024 * 1024;

/// 이 검사 실행에서만 쓰는 표식 값. 번호는 검사마다 다르게 준다 — 같은 바이너리 안에서 나란히 돈다.
pub(crate) fn key(n: u32) -> String {
    format!("test-{}-{n}", std::process::id())
}

/// 자식이 하는 일. 역할이 없으면(혼자 돌 때) 아무것도 안 하고 통과한다.
#[test]
fn a_child_the_real_tests_spawn() {
    let Some(role) = std::env::var_os(CHILD_ROLE) else {
        return;
    };
    match role.to_str() {
        // 별도 세션으로 떨어져 잠든다 — claude Bash 도구가 띄운 dev 서버의 모양이다. 부모가 죽어도
        // 영영 남지 않게 잠에 끝을 둔다.
        Some("sleep") => {
            unsafe { libc::setsid() };
            std::thread::sleep(Duration::from_secs(60));
        }
        // 위와 같되 SIGTERM을 못 들은 척한다 — 정리를 안 하는 상대. SIGKILL만 끝낸다.
        Some("ignore-term") => {
            unsafe {
                libc::signal(libc::SIGTERM, libc::SIG_IGN);
                libc::setsid();
            }
            std::thread::sleep(Duration::from_secs(60));
        }
        // 제 CPU 시계로 200ms를 바쁘게 돈 뒤 제 세션을 열고 잠든다 — 지표의 CPU 시간 단위를 재는 검사가 쓴다. 세션을 연 것이
        // 「다 돌았다」는 알림이다(`Kid::settle`이 그것을 기다린다). 재는 기준이 자식 자신의 시계라 부모가 읽은 값과 견줄 수 있다.
        Some("busy") => {
            let spent = || {
                let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
                unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut now) };
                Duration::new(now.tv_sec as u64, now.tv_nsec as u32)
            };
            while spent() < Duration::from_millis(200) {
                std::hint::spin_loop();
            }
            unsafe { libc::setsid() };
            std::thread::sleep(Duration::from_secs(60));
        }
        // 64MB짜리 빈 파일을 읽기 전용으로 붙여 모든 쪽을 한 번씩 읽은 뒤 제 세션을 열고 잠든다 — 지표의 메모리가 상주 크기가
        // 아니라 `phys_footprint`인지 재는 검사가 쓴다. 읽기만 한 파일 쪽은 상주 크기에는 들고 footprint에는 안 든다(되돌려
        // 쓸 수 있는 깨끗한 쪽이다). 파일은 붙인 뒤 곧바로 지운다 — 붙은 것은 남는다.
        Some("map") => {
            use std::os::fd::AsRawFd;
            let path = std::env::temp_dir().join(format!("atelier-metrics-map-{}", std::process::id()));
            let file = std::fs::File::options()
                .read(true)
                .write(true)
                .create_new(true)
                .open(&path)
                .expect("임시 파일을 만든다");
            file.set_len(MAPPED as u64).expect("파일 길이를 잡는다");
            let at = unsafe {
                libc::mmap(std::ptr::null_mut(), MAPPED, libc::PROT_READ, libc::MAP_PRIVATE, file.as_raw_fd(), 0)
            };
            let _ = std::fs::remove_file(&path);
            assert_ne!(at, libc::MAP_FAILED, "파일을 붙이지 못했다");
            let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as usize;
            for offset in (0..MAPPED).step_by(page) {
                unsafe { std::ptr::read_volatile(at.cast::<u8>().add(offset)) };
            }
            unsafe { libc::setsid() };
            std::thread::sleep(Duration::from_secs(60));
        }
        // 곧바로 끝난다. 부모가 거두기 전까지 좀비로 남는다.
        Some("exit") => {}
        other => panic!("모르는 역할이다: {other:?}"),
    }
}

/// 이 테스트 바이너리의 경로.
pub(crate) fn exe() -> PathBuf {
    std::env::current_exe().expect("테스트 바이너리의 경로")
}

/// 위 자식을 부르는 libtest 인자. 셸에 한 줄로 쳐 넣는 검사(셸 닫기의 풀 배선)도 이것을 쓴다.
pub(crate) fn child_args() -> [String; 5] {
    [
        "--exact".to_string(),
        child_test_name(),
        "--nocapture".to_string(),
        "--test-threads".to_string(),
        "1".to_string(),
    ]
}

/// 위 자식의 libtest 이름 — 크레이트 이름을 뗀 모듈 경로. 모듈을 옮겨도 따라온다.
fn child_test_name() -> String {
    let (_crate, path) = module_path!().split_once("::").expect("모듈 경로에 크레이트가 있다");
    format!("{path}::a_child_the_real_tests_spawn")
}

/// 검사가 띄운 자식. **떨어질 때 반드시 거둔다** — 단언이나 기다림이 패닉해도 풀리는 길에서 돈다.
/// 신호는 이 핸들의 pid에만 간다. 거두기 전의 자식이라 그 pid는 아직 남에게 넘어갈 수 없다.
pub(crate) struct Kid(Child);

impl Kid {
    pub(crate) fn spawn(role: &str, key: &str) -> Kid {
        let child = Command::new(exe())
            .args(child_args())
            .env(CHILD_ROLE, role)
            .env(SHELL_KEY_ENV, key)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("테스트 바이너리를 자식으로 띄운다");
        Kid(child)
    }

    pub(crate) fn pid(&self) -> u32 {
        self.0.id()
    }

    /// 자식이 자리를 잡을 때까지(제 세션을 열었다 — pgid = pid) 기다려 신원을 읽는다. 5초 안에 못 잡으면
    /// `None`이다.
    ///
    /// **「표식이 읽힐 때까지」로 기다리지 않는다** — 표식을 재는 검사가 스스로 통과한다. 게다가 exec
    /// 전의 자식은 부모의 exec 때 env를 들고 있어, 이 검사를 돌린 셸의 표식이 읽힐 수 있다.
    pub(crate) fn settle(&self) -> Option<Identity> {
        let pid = self.pid();
        let mut found = None;
        wait_until(|| {
            // env는 안 읽는다 — 행만 서면 된다.
            found = snapshot::take(snapshot::EnvScope::BornSince(u64::MAX))
                .procs
                .into_iter()
                .find(|p| p.id.pid == pid && p.pgid == pid)
                .map(|p| p.id);
            found.is_some()
        });
        found
    }
}

impl Drop for Kid {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// 조건이 설 때까지 10ms마다 본다. 5초면 포기한다.
pub(crate) fn wait_until(mut ready: impl FnMut() -> bool) -> bool {
    for _ in 0..500 {
        if ready() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

/// 조건이 `limit` 내내 서 있는가. 10ms마다 보고, 한 번이라도 무너지면 곧바로 `false`다.
///
/// **「안 일어났다」를 재는 자리가 쓴다.** 신호는 보낸 뒤 조금 늦게 닿는다 — 보낸 직후에 한 번만 보면 신호가
/// 갔어도 아직 살아 있어 검사가 스스로 통과한다.
pub(crate) fn holds_for(limit: Duration, mut ok: impl FnMut() -> bool) -> bool {
    let until = Instant::now() + limit;
    while Instant::now() < until {
        if !ok() {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    ok()
}
