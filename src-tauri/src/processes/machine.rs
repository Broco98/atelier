//! 맥 전체 — 이 맥 한 대의 CPU와 메모리(restart 03-5 · 프로세스 스펙 S37).
//!
//! `Processes`는 「지금 무엇이 내 컴퓨터를 먹나」에 답한다. 그 답의 분모가 맥 전체다 — **맥 전체를 100으로 잡는다**. 프로세스마다의
//! CPU%도 같은 눈금으로 옮긴다(`metrics::percent`가 코어 수로 나눈다) — 줄을 더한 것과 머리 숫자가 한 눈금이어야 견줄 수 있다.
//!
//! - **CPU**는 `host_statistics`의 `HOST_CPU_LOAD_INFO` — 상태마다의 누적 tick이다. 백분율은 두 표본의 차이라 한 표본으로는 못 짓는다
//!   (`cpu_percent`, 앞 표본은 프로세스의 CPU 시간과 같은 미터가 쥔다 — `metrics::CpuMeter`).
//! - **메모리**는 `host_statistics64`의 `HOST_VM_INFO64`에서 active · wired · compressed 쪽의 합이다(`memory_used`).
//! - **코어 수**는 `sysctl hw.logicalcpu`를 앱 시작 때 한 번 읽는다(`cores`).
//!
//! 읽기(부작용)는 macOS에만 있다. 다른 OS는 없음이고 화면은 「측정 안 됨」으로 말한다(스펙 「Out of Scope」). 계산은 순수라 모든 OS에서
//! 검사가 돈다.

use serde::Serialize;

/// **맥 전체 한 표본** — 화면 스냅샷과 요약이 와이어로 싣는다(`mac`). 프런트의 `MacMeasure`(`src/features/processes/types.ts`)와 칸
/// 이름으로 이어진다. macOS 밖에서는 이 값 자체가 없다(`null` — 「측정 안 됨」). CPU가 `f64`라 `Eq`가 없다.
#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    /// 맥 전체 CPU% — 맥 전체가 100이다. 첫 표본이거나 tick을 못 읽었으면 `None`(화면의 「—」).
    pub cpu: Option<f64>,
    /// 맥 전체 메모리(바이트) — active + wired + compressed. 못 읽었으면 `None`.
    pub memory: Option<u64>,
    /// 이 맥의 코어 수 — 맥 전체 눈금의 CPU%에 곱하면 활성 상태 보기 눈금(한 코어 = 100)이다.
    pub cores: u32,
}

/// `HOST_CPU_LOAD_INFO`의 누적 tick — 상태 넷(`CPU_STATE_USER` · `SYSTEM` · `IDLE` · `NICE`). 짓는 읽기는 macOS에만 있다(다른 OS의 앱
/// 빌드에서는 지어지지 않는다 — `processes`의 머리말).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct CpuTicks {
    pub user: u32,
    pub system: u32,
    pub idle: u32,
    pub nice: u32,
}

/// 두 표본 사이 맥 전체 CPU% — 흐른 tick 중 쉬지 않은(사용자 · 시스템 · nice) 몫. **맥 전체가 100이다.** 누적 tick은 32비트라 한 바퀴
/// 돌 수 있어 차이를 감아 잰다. tick이 안 흘렀으면 없다.
///
/// **커널은 tick을 몰아서 더한다**(macOS 27 · Apple Silicon 실측 — 40ms마다 읽으면 0.5초 넘게 같은 값을 주다가 한꺼번에 오른다). 화면의
/// 박자(2초)는 대개 그 사이를 넘지만, 넘지 못한 박자는 「—」다. 몰아 더한 만큼 프로세스의 CPU 시간과 재는 구간이 조금 어긋난다 — 읽은
/// 합이 맥 전체를 넘는 표본(스펙 「합이 맞는다」)의 한 까닭이다.
pub fn cpu_percent(before: CpuTicks, now: CpuTicks) -> Option<f64> {
    let delta = |then: u32, now: u32| u64::from(now.wrapping_sub(then));
    let busy = delta(before.user, now.user) + delta(before.system, now.system) + delta(before.nice, now.nice);
    let total = busy + delta(before.idle, now.idle);
    (total > 0).then(|| busy as f64 / total as f64 * 100.0)
}

/// `HOST_VM_INFO64`에서 쓰는 칸 — 쪽(page) 수. 읽기는 macOS에만 있다(다른 OS의 앱 빌드에서는 안 쓰인다 — `processes`의 머리말).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct VmPages {
    pub active: u64,
    pub wired: u64,
    pub compressed: u64,
}

/// 맥 전체를 한 번 읽은 것 — 커널이 준 그대로다(CPU는 누적 tick). 칸마다 못 읽을 수 있다. 짓는 읽기는 macOS에만 있다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct Reading {
    pub ticks: Option<CpuTicks>,
    /// 맥 전체 메모리(바이트, `memory_used`).
    pub memory: Option<u64>,
}

/// 맥 전체를 한 번 읽는다. **macOS 밖은 없다** — 화면이 「측정 안 됨」으로 말한다(스펙 「Out of Scope」 — Windows · Linux의 맥 전체
/// 수집은 짓지 않는다).
#[cfg(target_os = "macos")]
pub fn read() -> Option<Reading> {
    Some(Reading { ticks: mac::cpu_ticks(), memory: mac::vm_pages().map(|pages| memory_used(pages, mac::page_size())) })
}

/// 다른 OS는 맥 전체를 모른다.
#[cfg(not(target_os = "macos"))]
pub fn read() -> Option<Reading> {
    None
}

/// 이 맥의 논리 코어 수(`sysctl hw.logicalcpu`). **앱 시작 때 한 번 읽는다** — 프로세스 서비스가 앱을 세울 때 부르고(`ProcessService::new`),
/// 그 뒤로는 쥔 값이다. 프로세스마다의 CPU%를 맥 전체 눈금으로 옮기는 분모이고(`metrics::percent`), 화면의 「활성 상태 보기 눈금」이 이것을
/// 곱한다. 못 읽으면 표준 라이브러리가 아는 수, 그것도 없으면 1이다 — 0으로 나누지 않는다.
pub fn cores() -> u32 {
    static CORES: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
    *CORES.get_or_init(|| {
        logical_cpus()
            .or_else(|| std::thread::available_parallelism().ok().and_then(|n| u32::try_from(n.get()).ok()))
            .filter(|cores| *cores > 0)
            .unwrap_or(1)
    })
}

#[cfg(target_os = "macos")]
fn logical_cpus() -> Option<u32> {
    mac::logical_cpus()
}

#[cfg(not(target_os = "macos"))]
fn logical_cpus() -> Option<u32> {
    None
}

/// 맥 전체 메모리(바이트) — active · wired · compressed 쪽의 합에 쪽 크기를 곱한다. 넘치면 끝에 눕힌다. 순수 계산이라 검사는 모든
/// OS에서 돌고, 부르는 읽기는 macOS에만 있다.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn memory_used(pages: VmPages, page_size: u64) -> u64 {
    pages.active.saturating_add(pages.wired).saturating_add(pages.compressed).saturating_mul(page_size)
}

#[cfg(target_os = "macos")]
mod mac {
    use std::os::raw::c_int;
    use std::sync::OnceLock;

    use super::{CpuTicks, VmPages};

    /// 이 맥의 host 포트. `mach_host_self`는 부를 때마다 포트 권리를 하나씩 더 얹어 한 번 받아 쥔다.
    // libc는 이 함수를 `mach2` 크레이트로 옮기라며 낡았다고 적었다 — 포트 하나를 위해 새 의존을 들이지 않는다(`metrics.rs`의 타임베이스와 같다).
    #[allow(deprecated)]
    fn host() -> libc::mach_port_t {
        static HOST: OnceLock<libc::mach_port_t> = OnceLock::new();
        *HOST.get_or_init(|| unsafe { libc::mach_host_self() })
    }

    /// 맥 전체의 누적 CPU tick(`host_statistics` · `HOST_CPU_LOAD_INFO`). 못 읽으면 `None`.
    pub(super) fn cpu_ticks() -> Option<CpuTicks> {
        let mut info: libc::host_cpu_load_info = unsafe { std::mem::zeroed() };
        let mut count = libc::HOST_CPU_LOAD_INFO_COUNT;
        let status = unsafe { libc::host_statistics(host(), libc::HOST_CPU_LOAD_INFO, (&raw mut info).cast(), &mut count) };
        let tick = |state: c_int| info.cpu_ticks[state as usize];
        (status == libc::KERN_SUCCESS).then(|| CpuTicks {
            user: tick(libc::CPU_STATE_USER),
            system: tick(libc::CPU_STATE_SYSTEM),
            idle: tick(libc::CPU_STATE_IDLE),
            nice: tick(libc::CPU_STATE_NICE),
        })
    }

    /// 맥 전체 메모리의 쪽 수(`host_statistics64` · `HOST_VM_INFO64`). 못 읽으면 `None`.
    pub(super) fn vm_pages() -> Option<VmPages> {
        let mut info: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
        let mut count = libc::HOST_VM_INFO64_COUNT;
        let status = unsafe { libc::host_statistics64(host(), libc::HOST_VM_INFO64, (&raw mut info).cast(), &mut count) };
        (status == libc::KERN_SUCCESS).then(|| VmPages {
            active: u64::from(info.active_count),
            wired: u64::from(info.wire_count),
            compressed: u64::from(info.compressor_page_count),
        })
    }

    /// 쪽 크기(바이트) — Apple Silicon의 앱은 16KB다.
    pub(super) fn page_size() -> u64 {
        unsafe { libc::vm_page_size as u64 }
    }

    /// `sysctl hw.logicalcpu`. 못 읽으면 `None`.
    pub(super) fn logical_cpus() -> Option<u32> {
        let mut value: c_int = 0;
        let mut size = std::mem::size_of::<c_int>();
        let status = unsafe {
            libc::sysctlbyname(c"hw.logicalcpu".as_ptr(), (&raw mut value).cast(), &mut size, std::ptr::null_mut(), 0)
        };
        (status == 0).then_some(value).and_then(|cores| u32::try_from(cores).ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **맥 전체 메모리는 active · wired · compressed 쪽의 합이다**(restart 03-5). 쪽 크기를 곱해 바이트로 준다 — Apple Silicon의 쪽은
    /// 16KB다. inactive · free · speculative는 안 든다(되찾아 쓸 수 있는 쪽이다).
    #[test]
    fn the_mac_memory_is_the_active_wired_and_compressed_pages() {
        let pages = VmPages { active: 100, wired: 20, compressed: 3 };
        assert_eq!(memory_used(pages, 16_384), 123 * 16_384);
        assert_eq!(memory_used(VmPages::default(), 16_384), 0);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn other_systems_measure_nothing() {
        assert_eq!(read(), None, "macOS 밖에서 맥 전체를 읽었다 — 화면이 「측정 안 됨」을 못 말한다");
        assert!(cores() >= 1);
    }

    fn ticks(user: u32, system: u32, idle: u32, nice: u32) -> CpuTicks {
        CpuTicks { user, system, idle, nice }
    }

    /// **맥 전체 CPU%는 두 표본 사이에 흐른 tick 중 쉬지 않은 몫이다**(restart 03-5). 맥 전체를 100으로 잡는다 — 코어가 몇이든 다 쓰면
    /// 100이다. 사용자 · 시스템 · nice가 쓴 몫이고 idle만 쉰 몫이다.
    #[test]
    fn the_mac_cpu_is_the_busy_share_of_the_ticks_between_two_samples() {
        let before = ticks(1_000, 500, 8_000, 0);
        assert_eq!(cpu_percent(before, ticks(1_300, 600, 8_600, 0)), Some(40.0), "쓴 tick 400 / 흐른 tick 1000이 40%가 아니다");
        assert_eq!(cpu_percent(before, ticks(1_000, 500, 9_000, 0)), Some(0.0), "다 쉬었는데 0이 아니다 — 없음도 아니다");
        assert_eq!(cpu_percent(before, ticks(1_500, 900, 8_000, 100)), Some(100.0), "nice까지 다 썼는데 100이 아니다");
    }

    /// **tick이 안 흘렀으면 없다** — 같은 표본을 두 번 받았다. 0으로 나누지 않는다.
    #[test]
    fn no_ticks_between_samples_is_no_reading() {
        let same = ticks(1_000, 500, 8_000, 3);
        assert_eq!(cpu_percent(same, same), None);
    }

    /// **누적 tick은 32비트라 한 바퀴 돈다**(`natural_t`). 코어 열 개면 50일쯤에 넘친다 — 넘친 자리에서 차이가 음수로 뒤집히면
    /// 그 박자의 CPU가 틀리거나 사라진다. 차이는 한 바퀴를 감아 잰다.
    #[test]
    fn the_ticks_wrap_around() {
        let before = ticks(u32::MAX - 99, 0, u32::MAX - 99, 0);
        let after = ticks(100, 0, 100, 0);
        assert_eq!(cpu_percent(before, after), Some(50.0), "넘친 tick의 차이를 감아 재지 않았다");
    }
}

/// 실물 검사 — 이 맥을 읽기만 한다.
#[cfg(all(test, target_os = "macos"))]
mod real {
    use super::{cores, cpu_percent, read};

    /// sysctl 값 하나(정수).
    fn sysctl_u64(name: &str) -> u64 {
        let name = std::ffi::CString::new(name).unwrap();
        let mut value: u64 = 0;
        let mut size = std::mem::size_of::<u64>();
        let status =
            unsafe { libc::sysctlbyname(name.as_ptr(), (&raw mut value).cast(), &mut size, std::ptr::null_mut(), 0) };
        assert_eq!(status, 0, "{name:?}를 못 읽었다");
        value
    }

    /// **맥 전체 메모리를 읽는다** — 0보다 크고 이 맥의 물리 메모리(`hw.memsize`)를 넘지 않는다. 쪽 크기를 잘못 곱하면(4KB와 16KB)
    /// 네 배로 어긋나 둘 중 하나가 깨진다.
    #[test]
    fn the_mac_memory_is_read_within_the_physical_memory() {
        let memory = read().and_then(|reading| reading.memory).expect("맥 전체 메모리를 못 읽었다");
        let physical = sysctl_u64("hw.memsize");
        assert!(memory > 0, "맥 전체 메모리가 0이다");
        assert!(memory <= physical, "맥 전체 메모리({memory})가 물리 메모리({physical})를 넘는다 — 쪽 크기가 틀렸다");
    }

    /// **맥 전체 CPU tick이 흐른다** — 두 번 읽은 사이에 tick이 흐르면 0~100의 값이 선다.
    ///
    /// **커널은 tick을 몰아서 더한다**(macOS 27 · Apple Silicon 실측) — 40ms마다 읽으면 몇 번은 흐르고, 그 뒤 0.5초 넘게 같은 값을 주다가
    /// 한꺼번에 오른다. 그래서 흐를 때까지 기다린다(5초). 화면의 박자(2초)는 대개 그 사이를 넘는다 — 넘지 못한 박자는 맥 전체 CPU가
    /// 「—」다(`cpu_percent`가 tick이 안 흘렀으면 없다).
    #[test]
    fn the_mac_cpu_ticks_advance_between_two_reads() {
        let before = read().and_then(|reading| reading.ticks).expect("CPU tick을 못 읽었다");
        let mut percent = None;
        let advanced = crate::processes::testkit::wait_until(|| {
            percent = read().and_then(|reading| reading.ticks).and_then(|after| cpu_percent(before, after));
            percent.is_some()
        });
        assert!(advanced, "5초 동안 tick이 안 흘렀다");
        let percent = percent.expect("위에서 섰다");
        assert!((0.0..=100.0).contains(&percent), "맥 전체 CPU가 0~100 밖이다 — {percent}");
    }

    /// **코어 수는 이 맥의 논리 코어 수다**(`hw.logicalcpu`). 견주는 값은 표준 라이브러리가 따로 읽은 것이다.
    #[test]
    fn the_cores_are_the_logical_cpus_of_this_mac() {
        let parallelism = std::thread::available_parallelism().map(|n| n.get() as u32).expect("코어 수");
        assert_eq!(cores(), parallelism);
    }
}
