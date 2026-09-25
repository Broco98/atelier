//! 수집 — 이 맥의 프로세스 표 한 장(프로세스 스펙 S1 · S2 · S3).
//!
//! 부작용 층이다. `libproc`으로 pid 목록과 BSD 정보(ppid, pgid, uid, 시작 시각, 커널 이름)를 읽고,
//! 앱과 같은 uid인 것만 `KERN_PROCARGS2`로 부른 이름과 표식을 읽는다. 남의 uid는 어차피 못 읽고 못
//! 끝낸다. env를 읽는 버퍼는 한 장을 모든 프로세스가 돌려 쓴다 — 1MB를 프로세스마다 잡지 않는다.
//!
//! **개별 실패는 건너뛰고 센다.** 목록과 정보 읽기 사이에 끝나는 것은 늘 있고, 좀비와 권한 없는 것도
//! 있다. 하나 때문에 스냅샷 전체가 실패하면 셸 닫기가 통째로 멎는다.
//!
//! **macOS만 구현한다.** 다른 OS는 빈 스냅샷이고, 판정은 「아무것도 없다」가 된다 — 셸 닫기는 그때
//! 지금처럼 그룹 신호만 보낸다. 리눅스 `/proc`으로 같은 것을 읽는 길은 두지 않았다: 아무도 안 켜는
//! 코드는 조용히 썩고, 그것이 맞는지 보는 눈이 없다(`pty.rs`의 `process_name`과 같은 거래).

use super::Snapshot;

/// 어느 프로세스의 env(부른 이름과 표식)를 읽나. BSD 정보는 늘 전부 읽는다 — 트리가 끊기지 않게.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnvScope {
    /// 같은 uid 전부. 앱 종료 · 시작 정리처럼 어느 셸의 것을 찾는지 정해지지 않았을 때.
    All,
    /// 이 시각(µs) 이후에 태어난 같은 uid만. 셸 하나를 닫을 때 그 셸의 시작 시각을 준다(프로세스 스펙
    /// S3) — 그 셸의 표식을 문 프로세스는 셸보다 먼저 태어날 수 없다. × 한 번의 비용을 줄인다.
    BornSince(u64),
}

impl EnvScope {
    fn reads(self, started_us: u64) -> bool {
        match self {
            EnvScope::All => true,
            EnvScope::BornSince(since) => started_us >= since,
        }
    }
}

/// 프로세스 표를 한 장 찍는다.
#[cfg(target_os = "macos")]
pub fn take(scope: EnvScope) -> Snapshot {
    use super::procargs::{self, ProcArgs};
    use super::{Identity, Proc};

    let uid = unsafe { libc::geteuid() };
    let pids = mac::all_pids();
    // env를 읽는 버퍼는 이 한 장이다(프로세스 스펙 S2). 읽을 때마다 채운 길이까지만 본다.
    let mut buf = vec![0u8; procargs::buffer_len()];
    let mut procs = Vec::with_capacity(pids.len());
    let mut skipped = 0;
    for pid in pids {
        // 목록과 이 읽기 사이에 끝난 것, 정보를 못 읽은 것, 좀비. 좀비는 목록에는 서지만 BSD 정보가
        // 안 읽혀 여기서 걸린다(macOS 26.6 실측: `proc_pidinfo`가 0을 준다, errno EINVAL).
        let Some(info) = mac::bsd_info(pid) else {
            skipped += 1;
            continue;
        };
        // 좀비의 정보를 읽어 주는 커널이어도 행으로 세우지 않는다. 이미 끝났고 거두는 것은 그 부모의
        // 몫이다 — 행으로 서면 끝내기가 신호를 보내도 안 사라져 「못 끝냄」으로 적힌다. 이 맥에서는
        // 위에서 먼저 걸려 이 갈래가 돌지 않는다.
        if info.pbi_status == libc::SZOMB {
            skipped += 1;
            continue;
        }
        let id = Identity {
            pid: info.pbi_pid,
            started_us: info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec,
        };
        let (argv0, shell_key) = if info.pbi_uid == uid && scope.reads(id.started_us) {
            // 못 읽으면(그사이 끝남 등) 행은 그대로 세우고 env만 비운다. 행을 빼면 그 밑의 자손이
            // 트리에서 떨어진다.
            procargs::read(pid, &mut buf)
                .and_then(|len| ProcArgs::parse(&buf[..len]))
                .map_or((None, None), |args| {
                    let argv0 = args.argv().next().map(|a| String::from_utf8_lossy(a).into_owned());
                    (argv0, args.shell_key().map(str::to_string))
                })
        } else {
            (None, None)
        };
        procs.push(Proc {
            id,
            ppid: info.pbi_ppid,
            pgid: info.pbi_pgid,
            uid: info.pbi_uid,
            name: mac::kernel_name(&info),
            argv0,
            shell_key,
        });
    }
    Snapshot { uid, procs, skipped }
}

/// 다른 OS는 빈 스냅샷이다. 판정은 그대로 돌고 「아무것도 없다」가 된다.
#[cfg(not(target_os = "macos"))]
pub fn take(_scope: EnvScope) -> Snapshot {
    Snapshot { uid: unsafe { libc::geteuid() }, procs: Vec::new(), skipped: 0 }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::os::raw::c_int;

    /// 이 맥의 pid 전부. 먼저 수를 묻고 넉넉히 잡는다 — 묻고 읽는 사이에 새로 뜬 것이 있으면 모자란다.
    /// 꽉 찼으면 잘렸을 수 있어 늘려 다시 읽는다.
    ///
    /// 목록마저 못 읽으면 빈 목록이다. 스냅샷이 비면 판정은 아무것도 안 고르고, 셸 닫기는 그룹 신호만
    /// 보낸다 — 지금과 같다. 조용히 넘기지 않고 한 줄 남긴다.
    pub(super) fn all_pids() -> Vec<i32> {
        let mut room = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) }.max(0) as usize + 64;
        loop {
            let mut pids = vec![0 as c_int; room];
            let bytes = (room * std::mem::size_of::<c_int>()) as c_int;
            let count = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
            if count < 0 {
                eprintln!("atelier: proc_listallpids failed: {}", std::io::Error::last_os_error());
                return Vec::new();
            }
            let count = count as usize;
            if count < room {
                pids.truncate(count);
                return pids;
            }
            room *= 2;
        }
    }

    /// 한 pid의 BSD 정보. 못 읽으면 `None` — 그사이 끝났거나 권한이 없다.
    pub(super) fn bsd_info(pid: c_int) -> Option<libc::proc_bsdinfo> {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as c_int;
        let filled =
            unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&raw mut info).cast(), size) };
        // 구조체를 다 채웠을 때만 읽은 것이다. 0이면 못 읽었고, 모자라게 채운 값은 믿을 수 없다.
        (filled == size).then_some(info)
    }

    /// 커널 이름 — `proc_name`이 하는 그대로다: 긴 이름(`pbi_name`)이 있으면 그것, 없으면 16자로
    /// 잘린 `pbi_comm`.
    pub(super) fn kernel_name(info: &libc::proc_bsdinfo) -> String {
        let field = if info.pbi_name[0] != 0 { &info.pbi_name[..] } else { &info.pbi_comm[..] };
        let bytes: Vec<u8> = field.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use std::process::{Child, Command, Stdio};
    use std::time::Duration;

    use super::{take, EnvScope};
    use crate::processes::SHELL_KEY_ENV;

    /// 실물 검사가 띄우는 자식의 역할을 싣는 변수. 앱은 이 이름을 모른다.
    const CHILD_ROLE: &str = "ATELIER_PROCESSES_TEST_CHILD";

    /// **실물 검사의 자식은 이 테스트 바이너리 자신이다**(프로세스 스펙 S46).
    ///
    /// 시스템 바이너리는 env가 0개로 읽혀 표식을 잴 수 없고, 검사가 제 env에 표식을 심는 것도 안 된다 —
    /// `KERN_PROCARGS2`가 주는 것은 exec 때의 env다. 그래서 바이너리를 **테스트 이름 필터**
    /// (`--exact <이 함수>`)와 env(표식, 역할)로 다시 띄운다. libtest는 모르는 플래그를 거절해서 역할을
    /// 인자로는 못 넘긴다.
    ///
    /// 혼자 돌 때(역할이 없을 때)는 아무것도 안 하고 통과한다.
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
            // 곧바로 끝난다. 부모가 거두기 전까지 좀비로 남는다.
            Some("exit") => {}
            other => panic!("모르는 역할이다: {other:?}"),
        }
    }

    /// 위 자식의 libtest 이름 — 크레이트 이름을 뗀 모듈 경로. 모듈을 옮겨도 따라온다.
    fn child_test_name() -> String {
        let (_crate, path) = module_path!().split_once("::").expect("모듈 경로에 크레이트가 있다");
        format!("{path}::a_child_the_real_tests_spawn")
    }

    /// 검사가 띄운 자식. **떨어질 때 반드시 거둔다** — 단언이나 기다림이 패닉해도 풀리는 길에서 돈다.
    /// 신호는 이 핸들의 pid에만 간다. 거두기 전의 자식이라 그 pid는 아직 남에게 넘어갈 수 없다.
    struct Kid(Child);

    impl Kid {
        /// 표식 값은 이 기계의 실제 세대와 안 겹치게 짓는다 — `test-<검사 pid>-<번호>`.
        fn spawn(role: &str, key: &str) -> Kid {
            let exe = std::env::current_exe().expect("테스트 바이너리의 경로");
            let child = Command::new(exe)
                .args(["--exact", &child_test_name(), "--nocapture", "--test-threads", "1"])
                .env(CHILD_ROLE, role)
                .env(SHELL_KEY_ENV, key)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("테스트 바이너리를 자식으로 띄운다");
            Kid(child)
        }

        fn pid(&self) -> u32 {
            self.0.id()
        }
    }

    impl Drop for Kid {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// 조건이 설 때까지 10ms마다 본다. 5초면 포기한다.
    fn wait_until(mut ready: impl FnMut() -> bool) -> bool {
        for _ in 0..500 {
            if ready() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    /// **스냅샷이 표식을 읽는다.** 준 값 그대로여야 한다.
    ///
    /// 기다리는 조건은 「자식이 제 세션을 열었다」(pgid = pid)다. **「표식이 읽힐 때까지」로 기다리지
    /// 않는다** — 그러면 아래 단언이 스스로 통과한다. 게다가 exec 전의 자식은 부모의 exec 때 env를
    /// 들고 있어, 이 검사를 돌린 셸의 표식이 읽힐 수 있다.
    ///
    /// 셸 하나를 닫을 때의 가지치기(프로세스 스펙 S3)도 같은 자식으로 잰다: 자식보다 늦은 시각부터 읽으면
    /// 행은 서되 표식은 안 읽는다.
    #[test]
    fn the_snapshot_reads_the_marker_a_child_was_given() {
        let key = format!("test-{}-1", std::process::id());
        let kid = Kid::spawn("sleep", &key);
        let pid = kid.pid();

        let settled = wait_until(|| {
            take(EnvScope::All).procs.iter().any(|p| p.id.pid == pid && p.pgid == pid)
        });
        let whole = take(EnvScope::All).procs.into_iter().find(|p| p.id.pid == pid);
        let born = whole.as_ref().map_or(0, |p| p.id.started_us);
        let from_birth = take(EnvScope::BornSince(born)).procs.into_iter().find(|p| p.id.pid == pid);
        let after_birth =
            take(EnvScope::BornSince(born + 1)).procs.into_iter().find(|p| p.id.pid == pid);

        // **거두는 것이 단언보다 먼저다.**
        drop(kid);

        assert!(settled, "자식이 5초 안에 제 세션을 열지 못했다");
        let whole = whole.expect("스냅샷에 자식이 없다");
        assert_eq!(whole.shell_key.as_deref(), Some(key.as_str()), "준 표식을 못 읽었다");
        assert_eq!(whole.ppid, std::process::id(), "자식의 부모는 이 검사다");
        assert_eq!(
            from_birth.and_then(|p| p.shell_key).as_deref(),
            Some(key.as_str()),
            "자식이 태어난 그 시각부터 읽으면 자식의 표식을 읽는다"
        );
        let after_birth = after_birth.expect("가지치기는 env만 건너뛴다 — 행은 선다");
        assert_eq!(after_birth.shell_key, None, "자식보다 늦게 태어난 것만 읽으라 했는데 읽었다");
    }

    /// **좀비를 하나 둔 채로도 스냅샷이 성공한다.** 좀비는 행으로 서지 않고 건너뛴 수에 든다.
    ///
    /// 좀비는 `WNOWAIT`로 만든다 — 끝났는지는 보되 거두지는 않는다. 스냅샷을 찍은 뒤에 거둔다.
    #[test]
    fn the_snapshot_survives_a_zombie() {
        let key = format!("test-{}-2", std::process::id());
        let kid = Kid::spawn("exit", &key);
        let pid = kid.pid();

        let exited = wait_until(|| {
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            let flags = libc::WEXITED | libc::WNOWAIT | libc::WNOHANG;
            let ok = unsafe { libc::waitid(libc::P_PID, pid, &mut info, flags) };
            ok == 0 && info.si_pid == pid as libc::pid_t
        });
        let snapshot = take(EnvScope::All);

        // **거두는 것이 단언보다 먼저다.**
        drop(kid);

        assert!(exited, "자식이 5초 안에 끝나지 않았다");
        assert!(
            snapshot.procs.iter().any(|p| p.id.pid == std::process::id()),
            "스냅샷에 이 검사 자신이 없다 — 좀비 하나에 표 전체를 버렸다"
        );
        assert!(
            !snapshot.procs.iter().any(|p| p.id.pid == pid),
            "좀비가 행으로 섰다"
        );
        assert!(snapshot.skipped >= 1, "좀비를 건너뛰고도 세지 않았다");
    }
}
