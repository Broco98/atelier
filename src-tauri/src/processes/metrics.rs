//! 지표 — 프로세스마다 메모리 · CPU 시간 · 포트(프로세스 결정 10 · 프로세스 스펙 S37 · S38 · 티켓 28).
//!
//! `Processes` 화면이 행마다 숫자를 세운다. 이 파일은 그 숫자를 커널에서 읽는 층(부작용)과, 두 표본으로 CPU%를 짓는 계산(순수)을
//! 함께 든다.
//!
//! - **메모리는 `phys_footprint`다.** 활성 상태 보기의 「메모리」 열이 보이는 값이 이것이다 — 상주 크기(RSS, `ri_resident_size`)는
//!   읽기만 한 파일 쪽이나 공유 라이브러리처럼 되돌려 쓸 수 있는 깨끗한 쪽까지 세고 압축된 메모리는 빼서, 그 열과 어긋난다.
//! - **CPU는 누적 CPU 시간(사용자 + 시스템)이다.** 커널은 mach 시각 단위(tick)로 준다 — 타임베이스로 ns로 바꾼다(`ticks_to_ns`).
//!   백분율은 두 표본의 차이를 벽시계 차이 × 코어 수로 나눈 것이라(**맥 전체 = 100** — restart 03-5) 한 표본으로는 못 짓는다
//!   (`CpuMeter`). 첫 표본은 없다(화면의 「—」). 맥 전체 CPU(`machine`)도 같은 미터가 같은 앞 표본과 견준다.
//! - **포트는 TCP LISTEN 소켓의 로컬 포트다.** 프로세스의 fd를 훑어 소켓만 커널에 묻는다. `lsof`를 띄우지 않는다 — 2초마다 바깥
//!   프로세스를 띄우는 것이 된다.
//!
//! **우리 트리의 프로세스만 읽는다**(S38). 무엇을 읽을지는 부르는 쪽(화면 스냅샷)이 판정 결과로 정해 신원 목록으로 넘긴다
//! (`screen::targets`) — 이 맥의 프로세스 전부의 fd를 2초마다 훑지 않는다.
//!
//! **개별 실패는 건너뛰고 센다**(판 01의 수집 규칙 — `snapshot.rs`). 판정과 이 읽기 사이에 끝난 것, 좀비, 남의 uid(`sudo` 밑)가
//! 그렇다. 그 프로세스의 지표만 빈다 — 하나 때문에 한 장 전체를 버리면 화면의 숫자가 통째로 사라진다. 좀비는 자원 사용이 읽히지만
//! (실측) 이미 끝난 것이라 신원 확인에서 빠진다(`read`).
//!
//! **macOS만 구현한다.** 다른 OS는 빈 값이다(`snapshot.rs`와 같은 거래) — 화면은 숫자 칸에 「—」를 세운다.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use super::machine::{self, CpuTicks, Machine};
use super::{clock, Identity};

/// 프로세스 하나를 한 번 읽은 것 — 커널이 준 그대로다(CPU는 누적 시간).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reading {
    /// `phys_footprint`(바이트).
    pub memory: u64,
    /// 누적 CPU 시간(사용자 + 시스템, ns).
    pub cpu_ns: u64,
    /// TCP LISTEN 소켓의 로컬 포트 — 오름차순, 겹침 없음(IPv4와 IPv6로 같은 포트를 열면 한 번).
    pub ports: Vec<u16>,
}

/// 한 번 읽은 것 전부.
#[derive(Debug, Default)]
pub struct Readings {
    pub by_id: HashMap<Identity, Reading>,
    /// 받은 신원 가운데 못 읽은 수 — 그사이 끝난 것, 좀비, 남의 uid, pid가 남에게 넘어간 것. macOS의 읽기만 센다(실물 검사가 읽는다)
    /// — 다른 OS는 아무것도 안 읽어 늘 0이다.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub skipped: u32,
}

impl Readings {
    /// 신원마다 누적 CPU 시간 — `CpuMeter`의 한 표본.
    pub fn cpu_ns(&self) -> HashMap<Identity, u64> {
        self.by_id.iter().map(|(id, reading)| (*id, reading.cpu_ns)).collect()
    }

    /// 다른 읽기를 이 표본에 합친다 — 화면 스냅샷이 우리 트리(`read`)와 다른 앱(`read_usage`)을 한 미터에 넣는다(restart 03-6). 못 읽은
    /// 수는 더한다.
    pub fn absorb(&mut self, other: Readings) {
        self.by_id.extend(other.by_id);
        self.skipped += other.skipped;
    }
}

/// 이번 표본의 지표 — 커널에서 읽은 것(`read`), 앞 표본으로 잰 CPU%(`CpuMeter`), 맥 전체(`machine`). 신원으로 찾는다. 화면 스냅샷과
/// 요약이 이 한 값을 받는다(`screen::ScreenSnapshot::of` · `summary::Summary::of`) — 칸들은 늘 한 표본의 것이라 따로 다니지 않는다
/// (restart 03-5 「한 표본」). 짓는 자리는 미터 하나다(`CpuMeter::measure`).
#[derive(Debug, Default)]
pub struct Measured {
    pub readings: HashMap<Identity, Reading>,
    /// 프로세스마다의 CPU% — **맥 전체 = 100**(S37 · restart 03-5).
    pub cpu: HashMap<Identity, f64>,
    /// 맥 전체 — 프로세스의 지표와 같은 순간에 읽었다. macOS 밖이면 없다(「측정 안 됨」).
    pub machine: Option<Machine>,
    /// 잰 시각(에포크 ms) — 화면 머리의 「…에 잰 값」(restart 03-5). 읽기를 마친 때다.
    pub measured_at: u64,
}

/// 받은 신원의 지표를 읽는다. 실패하지 않는다 — 못 읽은 것은 건너뛰고 센다.
///
/// **읽은 뒤에 신원을 다시 본다.** 판정과 이 읽기 사이에 그 pid가 끝나 남에게 넘어갔으면 읽은 것은 남의 숫자다 — 시작 시각까지
/// 같아야 그 프로세스다(프로세스 결정 3). 읽기 전에 보면 보고 읽는 사이의 재사용을 못 거른다. 좀비도 여기서 빠진다
/// (`identity_of`가 좀비를 안 준다).
#[cfg(target_os = "macos")]
pub fn read(ids: impl IntoIterator<Item = Identity>) -> Readings {
    read_with(ids, true)
}

/// **다른 앱**(restart 03-6)의 지표를 읽는다 — 메모리 · CPU만이다. 포트는 프로세스마다 fd를 훑는 일이라 우리 트리만 한다(S38 · 시안
/// ProcessSheet 「값이 오는 곳」) — 이 맥의 같은 uid 프로세스 전부를 2초마다 훑지 않는다. 실패하지 않는 것과 신원을 다시 보는 것은
/// `read`와 같다.
#[cfg(target_os = "macos")]
pub fn read_usage(ids: impl IntoIterator<Item = Identity>) -> Readings {
    read_with(ids, false)
}

/// `read` · `read_usage`의 몸통 — 포트를 읽을지만 다르다.
#[cfg(target_os = "macos")]
fn read_with(ids: impl IntoIterator<Item = Identity>, ports: bool) -> Readings {
    let (numer, denom) = mac::timebase();
    let mut readings = Readings::default();
    for id in ids {
        let reading = std::os::raw::c_int::try_from(id.pid).ok().and_then(|pid| {
            let usage = mac::usage(pid)?;
            // 포트는 메모리 · CPU를 읽은 것만 훑는다 — 없는 프로세스의 fd를 묻지 않는다.
            Some(Reading {
                memory: usage.ri_phys_footprint,
                cpu_ns: ticks_to_ns(usage.ri_user_time.saturating_add(usage.ri_system_time), numer, denom),
                ports: if ports { mac::listening_ports(pid) } else { Vec::new() },
            })
        });
        match reading {
            Some(reading) if super::snapshot::identity_of(id.pid) == Some(id) => {
                readings.by_id.insert(id, reading);
            }
            _ => readings.skipped += 1,
        }
    }
    readings
}

/// 다른 OS는 아무것도 안 읽는다. 화면은 숫자 칸에 「—」를 세운다.
#[cfg(not(target_os = "macos"))]
pub fn read(_ids: impl IntoIterator<Item = Identity>) -> Readings {
    Readings::default()
}

/// 다른 OS는 다른 앱도 안 읽는다.
#[cfg(not(target_os = "macos"))]
pub fn read_usage(_ids: impl IntoIterator<Item = Identity>) -> Readings {
    Readings::default()
}

/// mach 시각 단위(tick)를 ns로 — `mach_timebase_info`가 준 비율(`numer / denom`)을 곱한다. Apple Silicon은 125/3(1 tick ≈
/// 41.7ns), Intel은 1/1이다. 곱(tick × 125)이 u64를 넘을 수 있어 넓혀서 하고, 넘치면 끝에 눕힌다. 비율을 못 읽었으면(분모 0) 안
/// 바꾼다 — 0으로 나누지 않는다. 순수 계산이라 검사는 모든 OS에서 돌고, 부르는 읽기는 macOS에만 있다.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn ticks_to_ns(ticks: u64, numer: u32, denom: u32) -> u64 {
    if denom == 0 {
        return ticks;
    }
    let ns = u128::from(ticks) * u128::from(numer) / u128::from(denom);
    u64::try_from(ns).unwrap_or(u64::MAX)
}

/// CPU% 한 칸 — 두 누적 CPU 시간(ns)의 차이를 벽시계 차이 × 코어 수로 나눈다. **맥 전체가 100이다**(S37 · restart 03-5) — 코어 열 개인
/// 맥에서 한 코어를 다 쓰면 10이다. 줄을 더한 것이 맥 전체 CPU(`machine::cpu_percent`)와 같은 눈금이어야 해서다. 활성 상태 보기의
/// 「% CPU」(한 코어 = 100)는 이 값 × 코어 수다. 벽시계가 안 흘렀거나 CPU 시간이 줄었으면(같은 프로세스가 아니다) 없다.
pub fn percent(before_ns: u64, now_ns: u64, wall: Duration, cores: u32) -> Option<f64> {
    let span = wall.as_nanos() * u128::from(cores.max(1));
    if span == 0 || now_ns < before_ns {
        return None;
    }
    Some((now_ns - before_ns) as f64 / span as f64 * 100.0)
}

/// 앞 표본을 버리는 나이 — 화면 박자(2초)의 다섯 배. 이보다 오래된 앞 표본은 창이 가려져 박자가 쉬었거나 화면을 떠났다 돌아온
/// 것이라, 그 사이의 평균을 지금 값처럼 세우지 않는다(`CpuMeter`).
pub const STALE: Duration = Duration::from_secs(10);

/// 두 표본 사이의 CPU%(S37) — 프로세스마다와 **맥 전체를 같은 앞 표본과** 견준다(restart 03-5 「한 표본」). 부르는 쪽이 이것을 쥐고
/// 부를 때마다 새 표본을 넣는다 — 화면 스냅샷은 프로세스 서비스에 하나를 쥔다(`service::ProcessService::screen`).
/// 박자가 다른 읽기(배경 표본 — 요약 · 추이)는 제 것을 따로 쥔다(`summary::Background`): 한 앞 표본을 나눠 쓰면 두 박자가 섞여 차이의
/// 벽시계가 뒤엉킨다. 그래서 버리는 나이를 박자마다 정해 세운다(`new`).
///
/// 앞 표본이 없는 신원은 CPU%가 없다(화면의 「—」) — 첫 표본, 그사이 새로 뜬 프로세스, pid가 재사용된 남. 맥 전체도 같다 — 첫 표본,
/// tick을 못 읽은 표본과 그 다음 표본. 앞 표본이 버리는 나이보다 오래됐으면 모두 없다. **쥐는 것은 바로 앞 표본 하나다** — 끝난
/// 프로세스의 누적 시간이 쌓이지 않는다.
#[derive(Debug)]
pub struct CpuMeter {
    last: Option<Sample>,
    /// 앞 표본을 버리는 나이. 화면의 미터는 `STALE`이다.
    stale: Duration,
    /// 이 맥의 코어 수 — 프로세스의 CPU%를 맥 전체 눈금으로 옮기는 분모(`machine::cores`, 앱 시작 때 한 번 읽는다).
    cores: u32,
}

/// 미터가 쥔 앞 표본 — 읽은 때, 신원마다 누적 CPU 시간(ns), 맥 전체 누적 tick.
#[derive(Debug)]
struct Sample {
    at: Instant,
    procs: HashMap<Identity, u64>,
    machine: Option<CpuTicks>,
}

/// 미터가 한 표본에서 지은 CPU% — 프로세스마다와 맥 전체. 둘 다 맥 전체 = 100이다.
#[derive(Debug, Default, PartialEq)]
pub struct Cpu {
    pub procs: HashMap<Identity, f64>,
    pub machine: Option<f64>,
}

impl CpuMeter {
    /// 앞 표본을 `stale`까지 쥐고, 프로세스의 CPU%를 `cores`로 나누는 미터. 박자가 화면(2초)과 다른 읽기가 제 박자에 맞춰 세운다.
    pub fn new(stale: Duration, cores: u32) -> Self {
        CpuMeter { last: None, stale, cores }
    }

    /// 새 표본(신원 → 누적 CPU 시간 ns, 맥 전체 tick, 읽은 때)을 받아 CPU%를 돌려주고, 그 표본을 다음 번의 앞 표본으로 쥔다.
    pub fn sample(&mut self, at: Instant, procs: HashMap<Identity, u64>, machine: Option<CpuTicks>) -> Cpu {
        let cpu = match &self.last {
            Some(before) if at.saturating_duration_since(before.at) <= self.stale => {
                let wall = at.saturating_duration_since(before.at);
                Cpu {
                    procs: procs
                        .iter()
                        .filter_map(|(id, now)| Some((*id, percent(*before.procs.get(id)?, *now, wall, self.cores)?)))
                        .collect(),
                    machine: before.machine.zip(machine).and_then(|(then, now)| machine::cpu_percent(then, now)),
                }
            }
            _ => Cpu::default(),
        };
        self.last = Some(Sample { at, procs, machine });
        cpu
    }

    /// **한 표본의 지표를 짓는다** — 프로세스마다 읽은 것(`read`)과 맥 전체를 읽은 것(`machine::read`)을 같은 때(`at`)의 표본으로 넣어
    /// CPU%를 짓고, 메모리와 함께 한 값으로 묶는다. 화면 스냅샷과 배경 표본이 이 자리 하나로 지표를 짓는다.
    pub fn measure(&mut self, at: Instant, readings: Readings, machine: Option<machine::Reading>) -> Measured {
        let cpu = self.sample(at, readings.cpu_ns(), machine.and_then(|machine| machine.ticks));
        Measured {
            readings: readings.by_id,
            cpu: cpu.procs,
            machine: machine.map(|read| Machine { cpu: cpu.machine, memory: read.memory, cores: self.cores }),
            measured_at: clock::now_ms(),
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::os::raw::c_int;
    use std::sync::OnceLock;

    /// `mach_timebase_info`의 비율(`numer`, `denom`). 부팅 동안 안 바뀌어 한 번 묻는다. 못 읽으면 1/1이다 — Intel의 값이고, 틀려도
    /// CPU%가 틀릴 뿐 화면은 선다.
    // libc는 이 구조체와 함수를 `mach2` 크레이트로 옮기라며 낡았다고 적었다 — 비율 하나를 위해 새 의존을 들이지 않는다.
    #[allow(deprecated)]
    pub(super) fn timebase() -> (u32, u32) {
        static RATIO: OnceLock<(u32, u32)> = OnceLock::new();
        *RATIO.get_or_init(|| {
            let mut info = libc::mach_timebase_info { numer: 0, denom: 0 };
            let status = unsafe { libc::mach_timebase_info(&mut info) };
            if status == 0 && info.denom != 0 {
                (info.numer, info.denom)
            } else {
                (1, 1)
            }
        })
    }

    /// 한 pid의 자원 사용(`proc_pid_rusage`, 판 0). 못 읽으면 `None` — 그사이 끝났거나 남의 uid다. **좀비는 읽힌다**(0이 온다 —
    /// `a_zombie_leaves_only_its_own_metrics_empty`의 실측). 좀비의 칸을 비우는 것은 읽은 뒤 신원을 다시 보는 `read`다.
    ///
    /// 판 0을 고른 것은 쓰는 칸(`ri_phys_footprint` · `ri_user_time` · `ri_system_time`)이 모두 거기 있고 가장 작아서다. 뒤 판은 같은
    /// 칸 뒤에 다른 것을 더할 뿐이다.
    pub(super) fn usage(pid: c_int) -> Option<libc::rusage_info_v0> {
        let mut info: libc::rusage_info_v0 = unsafe { std::mem::zeroed() };
        let status = unsafe { libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V0, (&raw mut info).cast()) };
        (status == 0).then_some(info)
    }

    /// 소켓 fd 정보를 묻는 판(`<sys/proc_info.h>`의 `PROC_PIDFDSOCKETINFO`). libc에 없다.
    pub(super) const PROC_PIDFDSOCKETINFO: c_int = 3;
    /// `soi_kind`의 TCP(`SOCKINFO_TCP`). 그 소켓의 `soi_proto`가 `tcp_sockinfo`로 읽힌다.
    const SOCKINFO_TCP: c_int = 2;
    /// `tcpsi_state`의 LISTEN(`TSI_S_LISTEN`).
    const TSI_S_LISTEN: c_int = 1;

    /// `struct socket_fdinfo`(`<sys/proc_info.h>`) — **쓰는 칸 셋만 손으로 선언한다**(프로세스 스펙 S38).
    ///
    /// **이것은 「커널 구조체를 손으로 베끼지 않는다」(`pty.rs`의 `process_name` 주석)의 예외다.** libc 0.2.186에는 소켓 fd 정보
    /// 구조체가 없고(`socket_fdinfo` · `PROC_PIDFDSOCKETINFO`), 그것을 가진 `libproc` 크레이트를 들이는 것보다 칸 셋을 적는 것이
    /// 작다. 그 방침이 두려워한 「조용히 틀림」은 검사 둘이 막는다: 크기가 커널이 채우는 크기와 같은지(실물), 칸 셋의 자리가 SDK
    /// 헤더의 `offsetof`와 같은지(`the_socket_struct_is_the_size_the_kernel_fills`). 크기가 어긋나면 커널이 채우기를 거절해 포트가
    /// 조용히 사라지고, 자리가 어긋나면 엉뚱한 바이트를 포트로 읽는다. 이 결정을 뒤집으면 크레이트를 들이거나 포트를 뺀다.
    ///
    /// 자리(바이트)는 macOS 26.6 SDK 헤더를 `offsetof`로 잰 값이다: 전체 792(정렬 8), `psi.soi_kind` 256,
    /// `psi.soi_proto.pri_tcp.tcpsi_ini.insi_lport` 268, `psi.soi_proto.pri_tcp.tcpsi_state` 344. 그 사이는 안 읽는 바이트다.
    #[repr(C, align(8))]
    pub(super) struct SocketFdInfo {
        /// `pfi`(`proc_fileinfo`) 전체와 `psi`(`socket_info`)의 `soi_kind` 앞까지.
        _head: [u8; 256],
        /// `psi.soi_kind` — 소켓의 종류.
        pub(super) kind: c_int,
        /// `psi.rfu_1`.
        _reserved: u32,
        /// `psi.soi_proto.pri_tcp.tcpsi_ini.insi_fport` — 상대 포트.
        _fport: c_int,
        /// `…tcpsi_ini.insi_lport` — 로컬 포트. **네트워크 바이트 순서**의 16비트가 `int`에 담겨 온다.
        pub(super) lport: c_int,
        /// `insi_gencnt`부터 `tcpsi_state` 앞까지.
        _between: [u8; 344 - 272],
        /// `psi.soi_proto.pri_tcp.tcpsi_state` — TCP 상태.
        pub(super) state: c_int,
        /// `tcpsi_timer`부터 끝까지(`soi_proto` 공용체의 가장 큰 칸이 정한 길이).
        _tail: [u8; 792 - 348],
    }

    impl SocketFdInfo {
        /// LISTEN 중인 TCP 소켓이면 그 로컬 포트.
        fn listening_port(&self) -> Option<u16> {
            (self.kind == SOCKINFO_TCP && self.state == TSI_S_LISTEN).then(|| u16::from_be(self.lport as u16))
        }
    }

    /// 한 pid가 LISTEN 중인 TCP 포트 — 오름차순, 겹침 없음. 못 읽으면 빈다(포트가 없는 것과 같게 보인다 — 메모리 · CPU를 읽은
    /// 프로세스라 대개 그사이 끝난 것이다).
    ///
    /// fd 목록을 받고 소켓인 것만 커널에 한 번씩 묻는다. 목록은 먼저 크기를 물어 넉넉히 잡는다 — 묻고 읽는 사이에 fd가 늘 수 있다.
    pub(super) fn listening_ports(pid: c_int) -> Vec<u16> {
        let entry = std::mem::size_of::<libc::proc_fdinfo>();
        let needed = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0) };
        if needed <= 0 {
            return Vec::new();
        }
        let room = needed as usize / entry + 16;
        let mut fds = vec![libc::proc_fdinfo { proc_fd: 0, proc_fdtype: 0 }; room];
        let filled = unsafe {
            libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, fds.as_mut_ptr().cast(), (room * entry) as c_int)
        };
        if filled <= 0 {
            return Vec::new();
        }
        fds.truncate(filled as usize / entry);

        let size = std::mem::size_of::<SocketFdInfo>();
        let mut ports: Vec<u16> = fds
            .iter()
            .filter(|fd| fd.proc_fdtype == libc::PROX_FDTYPE_SOCKET as u32)
            .filter_map(|fd| {
                let mut info: SocketFdInfo = unsafe { std::mem::zeroed() };
                let got = unsafe {
                    libc::proc_pidfdinfo(pid, fd.proc_fd, PROC_PIDFDSOCKETINFO, (&raw mut info).cast(), size as c_int)
                };
                // 다 채웠을 때만 읽은 것이다 — 그사이 닫힌 fd는 0이다.
                (got as usize == size).then(|| info.listening_port()).flatten()
            })
            .collect();
        ports.sort_unstable();
        ports.dedup();
        ports
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    use super::{percent, ticks_to_ns, CpuMeter, STALE};
    use crate::processes::machine::CpuTicks;
    use crate::processes::Identity;

    const SEC: u64 = 1_000_000_000;

    fn id(pid: u32, started_us: u64) -> Identity {
        Identity { pid, started_us }
    }

    /// **CPU 시간을 타임베이스로 ns로 바꾼다**(프로세스 스펙 S37). Apple Silicon은 1 tick이 125/3 ns다 — 안 바꾸면 CPU%가 약 42배
    /// 작게 선다. Intel은 1/1이라 그대로다. 곱은 u64를 넘을 수 있어(tick × 125) 넓혀서 한다.
    #[test]
    fn ticks_become_nanoseconds_by_the_timebase() {
        assert_eq!(ticks_to_ns(24_000_000, 125, 3), SEC, "Apple Silicon의 1초치 tick이 1초가 아니다");
        assert_eq!(ticks_to_ns(SEC, 1, 1), SEC, "Intel의 비율(1/1)에서 값이 바뀌었다");
        let big = u64::MAX / 100;
        assert_eq!(
            ticks_to_ns(big, 125, 3),
            (u128::from(big) * 125 / 3) as u64,
            "곱이 u64를 넘자 값이 틀어졌다"
        );
        // 타임베이스를 못 읽었으면(분모 0) 바꾸지 않는다 — 0으로 나누지 않는다.
        assert_eq!(ticks_to_ns(SEC, 0, 0), SEC);
    }

    /// **CPU%는 두 누적 CPU 시간의 차이를 벽시계 차이 × 코어 수로 나눈 것이다**(S37 · restart 03-5). **맥 전체가 100이다** — 코어 열
    /// 개인 맥에서 한 코어를 다 쓰면 10, 열을 다 쓰면 100이다. 그래야 줄을 더한 것이 맥 전체 CPU와 같은 눈금이다. 활성 상태 보기의
    /// 「% CPU」(한 코어 = 100)는 이 값에 코어 수를 곱한 것이다. 벽시계가 안 흘렀거나 CPU 시간이 거꾸로 갔으면(같은 프로세스가
    /// 아니다) 없다.
    #[test]
    fn cpu_percent_is_the_cpu_time_over_the_wall_time_of_the_whole_mac() {
        let two = Duration::from_secs(2);
        assert_eq!(percent(0, SEC, two, 1), Some(50.0), "코어 하나인 맥의 절반이 50이 아니다");
        assert_eq!(percent(0, 2 * SEC, two, 10), Some(10.0), "코어 열 개 중 하나를 다 쓰면 10이다");
        assert_eq!(percent(0, 20 * SEC, two, 10), Some(100.0), "코어 열 개를 다 쓰면 100이다");
        assert_eq!(percent(SEC, SEC, two, 10), Some(0.0), "안 쓴 프로세스는 0이다 — 없음이 아니다");
        assert_eq!(percent(0, SEC, Duration::ZERO, 10), None, "벽시계가 안 흘렀는데 값을 지었다");
        assert_eq!(percent(2 * SEC, SEC, two, 10), None, "CPU 시간이 줄었는데 값을 지었다");
    }

    /// **두 읽기를 한 표본으로 합친다**(restart 03-6 — 우리 트리의 읽기와 다른 앱의 읽기). 읽은 것은 모두 남고 못 읽은 수는 더한다.
    #[test]
    fn two_reads_join_into_one_sample() {
        use super::{Reading, Readings};

        let reading = |memory: u64| Reading { memory, cpu_ns: memory, ports: vec![] };
        let mut ours = Readings { by_id: HashMap::from([(id(10, 1), reading(1))]), skipped: 2 };
        ours.absorb(Readings { by_id: HashMap::from([(id(20, 2), reading(5))]), skipped: 3 });
        assert_eq!(ours.by_id, HashMap::from([(id(10, 1), reading(1)), (id(20, 2), reading(5))]));
        assert_eq!(ours.skipped, 5);
    }

    /// 화면 박자의 미터 — 코어 하나인 맥이라 프로세스의 CPU%가 「한 코어 = 100」과 같은 숫자다(눈금은 위 검사가 잰다).
    fn one_core() -> CpuMeter {
        CpuMeter::new(STALE, 1)
    }

    /// 프로세스마다의 CPU 시간만 넣은 표본 — 맥 전체 tick은 못 읽었다.
    fn procs(meter: &mut CpuMeter, at: Instant, cpu_ns: &[(Identity, u64)]) -> HashMap<Identity, f64> {
        meter.sample(at, cpu_ns.iter().copied().collect(), None).procs
    }

    /// **첫 표본에는 CPU%가 없다**(S37 — 화면의 「—」). 두 번째 표본부터 앞 표본과의 차이로 선다. 그사이 새로 뜬 프로세스는 그
    /// 프로세스에게 첫 표본이라 없다.
    #[test]
    fn the_first_sample_has_no_cpu() {
        let (a, b) = (id(10, 1), id(11, 2));
        let t0 = Instant::now();
        let mut meter = one_core();

        assert_eq!(procs(&mut meter, t0, &[(a, SEC)]), HashMap::new(), "첫 표본에 CPU%가 섰다");
        let second = procs(&mut meter, t0 + Duration::from_secs(2), &[(a, 2 * SEC), (b, SEC)]);
        assert_eq!(second, HashMap::from([(a, 50.0)]), "둘째 표본이 앞 표본과의 차이가 아니다 — 새로 뜬 b도 없어야 한다");
        let third = procs(&mut meter, t0 + Duration::from_secs(4), &[(a, 2 * SEC), (b, 3 * SEC)]);
        assert_eq!(third, HashMap::from([(a, 0.0), (b, 100.0)]), "앞 표본이 바로 앞의 것으로 바뀌지 않았다");
    }

    /// **프로세스의 CPU%는 맥 전체 눈금이다**(restart 03-5) — 미터가 받은 코어 수로 나눈다. 코어 열 개인 맥에서 2초 동안 한 코어를
    /// 다 쓴 프로세스는 10이다.
    #[test]
    fn the_meter_puts_each_process_on_the_whole_mac() {
        let a = id(10, 1);
        let t0 = Instant::now();
        let mut meter = CpuMeter::new(STALE, 10);
        procs(&mut meter, t0, &[(a, 0)]);
        assert_eq!(procs(&mut meter, t0 + Duration::from_secs(2), &[(a, 2 * SEC)]), HashMap::from([(a, 10.0)]));
    }

    /// **맥 전체 CPU도 같은 미터가 같은 앞 표본과 견준다**(restart 03-5 「한 표본」). 프로세스의 CPU%와 맥 전체 CPU%가 같은 두 순간
    /// 사이의 값이라 줄을 더한 것과 맥 전체를 견줄 수 있다. 첫 표본 · tick을 못 읽은 표본 · 앞 표본이 오래된 표본은 없다(「—」).
    #[test]
    fn the_mac_cpu_is_measured_between_the_same_two_samples() {
        let a = id(10, 1);
        let t0 = Instant::now();
        let ticks = |busy: u32, idle: u32| Some(CpuTicks { user: busy, system: 0, idle, nice: 0 });
        let mut meter = CpuMeter::new(STALE, 10);

        let first = meter.sample(t0, HashMap::from([(a, 0)]), ticks(100, 900));
        assert_eq!(first.machine, None, "첫 표본에 맥 전체 CPU가 섰다");
        let second = meter.sample(t0 + Duration::from_secs(2), HashMap::from([(a, 2 * SEC)]), ticks(400, 1_600));
        assert_eq!((second.machine, second.procs.get(&a).copied()), (Some(30.0), Some(10.0)), "두 값이 같은 두 표본 사이의 것이 아니다");
        let unread = meter.sample(t0 + Duration::from_secs(4), HashMap::from([(a, 2 * SEC)]), None);
        assert_eq!(unread.machine, None, "tick을 못 읽었는데 맥 전체 CPU가 섰다");
        let after_unread = meter.sample(t0 + Duration::from_secs(6), HashMap::from([(a, 2 * SEC)]), ticks(500, 1_700));
        assert_eq!(after_unread.machine, None, "못 읽은 표본을 건너 그 앞 표본과 이었다 — 4초 평균을 2초 값처럼 세운다");

        let late = t0 + Duration::from_secs(6) + STALE + Duration::from_millis(1);
        assert_eq!(meter.sample(late, HashMap::new(), ticks(900, 1_800)).machine, None, "오래된 앞 표본과 이었다");
    }

    /// **pid가 재사용되면 새 프로세스다** — 신원이 시작 시각까지 본다(프로세스 결정 3). 옛 프로세스의 누적 시간과 빼면 남의
    /// 숫자가 선다. 앵커는 같은 표본에서 이어지는 다른 프로세스다 — 아무것도 안 잇는 구현은 여기서 빨갛다.
    #[test]
    fn a_reused_pid_starts_over() {
        let steady = id(20, 1);
        let t0 = Instant::now();
        let mut meter = one_core();
        procs(&mut meter, t0, &[(id(10, 1), 5 * SEC), (steady, 0)]);
        let after = procs(&mut meter, t0 + Duration::from_secs(2), &[(id(10, 9), 6 * SEC), (steady, SEC)]);
        assert_eq!(after, HashMap::from([(steady, 50.0)]), "같은 pid의 다른 프로세스를 앞 표본과 이었다");
    }

    /// **앞 표본이 오래됐으면 첫 표본으로 친다.** 화면을 떠났다가 한참 뒤에 돌아오거나 창이 가려져 박자가 쉬면 앞 표본이 몇 분
    /// 전 것이다 — 그 사이의 평균을 지금 값처럼 세우지 않는다. 다음 박자부터 다시 선다.
    #[test]
    fn a_stale_sample_starts_over() {
        let a = id(10, 1);
        let t0 = Instant::now();
        let mut meter = one_core();
        procs(&mut meter, t0, &[(a, 0)]);

        let late = t0 + STALE + Duration::from_millis(1);
        assert_eq!(procs(&mut meter, late, &[(a, SEC)]), HashMap::new(), "오래된 앞 표본과 이었다");
        let next = procs(&mut meter, late + Duration::from_secs(2), &[(a, 2 * SEC)]);
        assert_eq!(next, HashMap::from([(a, 50.0)]), "오래된 표본을 버린 뒤 다음 박자에 다시 서지 않았다");

        // 경계 — 딱 그 나이까지는 앞 표본이다.
        let edge = late + Duration::from_secs(2) + STALE;
        assert_eq!(procs(&mut meter, edge, &[(a, 2 * SEC)]), HashMap::from([(a, 0.0)]));
    }

    /// **박자가 느린 읽기는 버리는 나이를 제 것으로 정한다**(티켓 30). 배경 표본은 10초 잠 + 모으는 시간마다 부르므로 표본 사이가
    /// 늘 화면의 `STALE`(10초)을 조금 넘는다 — 그 나이로 버리면 요약의 CPU가 영영 없다. 나이를 받은 미터는 그 나이까지 앞 표본과
    /// 잇고, 넘으면 버린다. 앵커는 같은 간격을 화면의 미터에 넣은 것이다(버린다).
    #[test]
    fn a_meter_for_a_slower_beat_keeps_its_sample_as_long_as_it_says() {
        let a = id(10, 1);
        let t0 = Instant::now();
        let beat = Duration::from_millis(10_050);

        let mut screen = one_core();
        procs(&mut screen, t0, &[(a, 0)]);
        assert_eq!(procs(&mut screen, t0 + beat, &[(a, SEC)]), HashMap::new(), "화면의 미터가 10초 넘은 앞 표본과 이었다");

        let mut background = CpuMeter::new(Duration::from_secs(30), 1);
        procs(&mut background, t0, &[(a, 0)]);
        let next = procs(&mut background, t0 + beat, &[(a, SEC)]);
        let percent = next.get(&a).copied().expect("배경의 미터가 10초 조금 넘은 앞 표본을 버렸다 — 요약의 CPU가 늘 없다");
        assert!((percent - 100.0 / 10.05).abs() < 1e-9, "배경의 CPU%가 차이 / 벽시계가 아니다 — {percent}");

        let late = t0 + beat + Duration::from_secs(30) + Duration::from_millis(1);
        assert_eq!(procs(&mut background, late, &[(a, 2 * SEC)]), HashMap::new(), "제 나이를 넘은 앞 표본과 이었다");
    }
}

/// 실물 검사 — 이 테스트 프로세스와 검사가 띄운 자식만 읽는다.
#[cfg(all(test, target_os = "macos"))]
mod real {
    use std::net::{TcpListener, TcpStream, UdpSocket};
    use std::os::fd::AsRawFd;

    use super::read;
    use crate::processes::snapshot::identity_of;
    use crate::processes::testkit::{key, Kid};
    use crate::processes::Identity;

    fn me() -> Identity {
        identity_of(std::process::id()).expect("이 검사 자신의 신원")
    }

    /// **손으로 선언한 소켓 fd 정보가 커널이 채우는 크기와 같다**(프로세스 스펙 S38). 커널은 받은 버퍼가 제 구조체보다 작으면
    /// 채우기를 거절하고, 크면 제 크기만큼만 채워 그 크기를 돌려준다 — 넉넉한 버퍼로 물어 돌아온 크기가 곧 커널의 크기다. 어긋나면
    /// 포트가 조용히 사라지거나(작을 때) 엉뚱한 바이트를 칸으로 읽는다.
    ///
    /// 칸 셋의 자리는 SDK 헤더의 `offsetof`로 잰 값과 견준다(`SocketFdInfo`의 주석). 그 칸들이 제 뜻대로 읽히는지는 아래 포트
    /// 검사가 진짜 소켓으로 잰다.
    #[test]
    fn the_socket_struct_is_the_size_the_kernel_fills() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("LISTEN 소켓을 연다");
        let mut room = [0u64; 256];
        let filled = unsafe {
            libc::proc_pidfdinfo(
                std::process::id() as i32,
                listener.as_raw_fd(),
                super::mac::PROC_PIDFDSOCKETINFO,
                room.as_mut_ptr().cast(),
                std::mem::size_of_val(&room) as i32,
            )
        };
        drop(listener);

        assert_eq!(filled as usize, std::mem::size_of::<super::mac::SocketFdInfo>(), "커널의 소켓 fd 정보와 크기가 다르다");
        assert_eq!(std::mem::align_of::<super::mac::SocketFdInfo>(), 8, "커널 구조체의 정렬(8)과 다르다");
        assert_eq!(std::mem::offset_of!(super::mac::SocketFdInfo, kind), 256, "psi.soi_kind의 자리");
        assert_eq!(std::mem::offset_of!(super::mac::SocketFdInfo, lport), 268, "tcpsi_ini.insi_lport의 자리");
        assert_eq!(std::mem::offset_of!(super::mac::SocketFdInfo, state), 344, "tcpsi_state의 자리");
    }

    /// **LISTEN 소켓의 포트를 읽는다**(S38). 검사가 `127.0.0.1:0`에 LISTEN을 열고 자기 지표에서 그 포트를 찾는다. 같은 검사가 연
    /// 다른 소켓 둘은 안 선다 — 그 LISTEN에 붙은 TCP 연결의 제 쪽 포트(연결됨)와 UDP 포트. 둘이 앵커다: 소켓이면 다 세는 구현도
    /// LISTEN 포트는 찾는다.
    #[test]
    fn the_ports_a_process_listens_on_are_read() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("LISTEN 소켓을 연다");
        let port = listener.local_addr().expect("LISTEN 주소").port();
        let client = TcpStream::connect(("127.0.0.1", port)).expect("LISTEN에 붙는다");
        let connected = client.local_addr().expect("연결의 제 쪽 주소").port();
        let udp = UdpSocket::bind("127.0.0.1:0").expect("UDP 소켓을 연다");
        let datagram = udp.local_addr().expect("UDP 주소").port();

        let me = me();
        let readings = read([me]);

        // **거두는 것이 단언보다 먼저다.**
        drop((client, udp, listener));

        let ports = readings.by_id.get(&me).map(|reading| reading.ports.clone()).expect("이 검사 자신을 못 읽었다");
        assert!(ports.contains(&port), "LISTEN 포트 {port}를 못 찾았다: {ports:?}");
        assert!(!ports.contains(&connected), "연결된 소켓의 포트 {connected}를 LISTEN으로 셌다: {ports:?}");
        assert!(!ports.contains(&datagram), "UDP 포트 {datagram}를 셌다: {ports:?}");
        assert!(ports.windows(2).all(|pair| pair[0] < pair[1]), "포트가 오름차순 · 겹침 없음이 아니다: {ports:?}");
    }

    /// **다른 앱은 메모리 · CPU만 읽는다**(restart 03-6 · 시안 ProcessSheet 「포트를 찾는 fd 훑기는 지금처럼 우리 트리만 한다」). LISTEN을
    /// 연 이 검사 자신을 그 읽기로 읽으면 메모리는 서고 포트는 없다. 앵커는 같은 소켓을 우리 트리의 읽기(`read`)로 본 것이다 — 포트가 선다.
    #[test]
    fn other_apps_are_read_without_their_ports() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("LISTEN 소켓을 연다");
        let port = listener.local_addr().expect("LISTEN 주소").port();
        let me = me();
        let usage = super::read_usage([me]);
        let ours = read([me]);

        // **거두는 것이 단언보다 먼저다.**
        drop(listener);

        let usage = usage.by_id.get(&me).expect("이 검사 자신을 못 읽었다");
        assert!(usage.memory > 0, "다른 앱의 읽기가 메모리를 안 읽었다");
        assert_eq!(usage.ports, Vec::<u16>::new(), "다른 앱의 읽기가 fd를 훑어 포트를 읽었다");
        assert!(ours.by_id.get(&me).is_some_and(|reading| reading.ports.contains(&port)), "앵커 — 우리 트리의 읽기는 그 포트를 본다");
    }

    /// **메모리(`phys_footprint`)를 읽는다.** 이 검사 자신의 값이 0보다 크다.
    #[test]
    fn the_footprint_of_this_process_is_read() {
        let me = me();
        let readings = read([me]);
        let memory = readings.by_id.get(&me).map(|reading| reading.memory).expect("이 검사 자신을 못 읽었다");
        assert!(memory > 0, "footprint가 0이다");
    }

    /// **메모리는 상주 크기가 아니라 `phys_footprint`다** — 활성 상태 보기의 「메모리」 열이 그 값이다. 자식이 64MB 파일을 읽기
    /// 전용으로 붙여 다 읽은 뒤 잠든다: 그 쪽은 상주 크기에는 들고 footprint에는 안 든다. 자식의 상주 크기가 64MB를 넘는 것이
    /// 앵커다(파일을 정말 읽었다).
    #[test]
    fn the_memory_is_the_footprint_not_the_resident_size() {
        use crate::processes::testkit::MAPPED;

        let kid = Kid::spawn("map", &key(42));
        let settled = kid.settle();
        let memory = settled.and_then(|id| read([id]).by_id.get(&id).map(|reading| reading.memory));
        let resident = settled.and_then(|id| super::mac::usage(id.pid as i32)).map(|usage| usage.ri_resident_size);

        // **거두는 것이 단언보다 먼저다.**
        drop(kid);

        assert!(settled.is_some(), "자식이 5초 안에 파일을 다 읽고 제 세션을 열지 못했다");
        let (memory, resident) = (memory.expect("자식을 못 읽었다"), resident.expect("자식의 상주 크기를 못 읽었다"));
        assert!(resident > MAPPED as u64, "자식의 상주 크기({resident})가 붙인 파일보다 작다 — 파일을 안 읽었다");
        assert!(memory < MAPPED as u64 / 2, "메모리({memory})가 읽기만 한 파일 쪽까지 셌다 — 상주 크기(RSS)다");
    }

    /// **CPU 시간이 ns다**(S37 — 단위는 실물로 잰다). 자식이 제 CPU 시계(`CLOCK_PROCESS_CPUTIME_ID`)로 200ms를 바쁘게 돈 뒤 제
    /// 세션을 연다. 그 뒤 읽은 CPU 시간이 약 200ms다 — tick을 안 바꾸면 Apple Silicon에서 약 5ms로 선다.
    ///
    /// **이 검사 자신이 아니라 자식을 잰다.** 프로세스의 CPU 시간은 모든 스레드의 합인데, 이 테스트 바이너리는 다른 검사를 나란히
    /// 돌린다 — 제 시간을 재면 남의 검사가 쓴 시간이 섞인다.
    #[test]
    fn cpu_time_is_in_nanoseconds() {
        let kid = Kid::spawn("busy", &key(40));
        let settled = kid.settle();
        let readings = settled.map(|id| read([id]));

        // **거두는 것이 단언보다 먼저다.**
        drop(kid);

        let id = settled.expect("자식이 5초 안에 바쁜 돌기를 마치고 제 세션을 열지 못했다");
        let cpu_ns = readings.and_then(|readings| readings.by_id.get(&id).map(|reading| reading.cpu_ns)).expect("자식을 못 읽었다");
        let cpu_ms = cpu_ns / 1_000_000;
        assert!((190..=400).contains(&cpu_ms), "바쁜 돌기 200ms 뒤의 CPU 시간이 {cpu_ms}ms다 — 단위가 ns가 아니다");
    }

    /// **좀비를 하나 둔 채로도 지표를 읽는다** — 그 프로세스의 지표만 빈다(판 01의 수집 규칙). 좀비는 검사가 띄운 자식을 끝내고
    /// 거두지 않아 만든다(`WNOWAIT`). 신원은 끝내기 전에 읽어 둔 진짜 것이다.
    ///
    /// **좀비의 자원 사용은 읽힌다**(macOS 26.6 실측 — `proc_pid_rusage`가 0을 돌려준다). 그래서 좀비를 비우는 것은 읽은 뒤 신원을
    /// 다시 보는 자리다(`read`) — 그 자리를 빼면 끝난 프로세스의 숫자가 행에 선다.
    #[test]
    fn a_zombie_leaves_only_its_own_metrics_empty() {
        let kid = Kid::spawn("sleep", &key(41));
        let zombie = kid.settle();
        let pid = kid.pid();
        // 이 검사가 방금 띄운 자식에게만 보낸다 — 아직 거두지 않아 그 pid는 남에게 넘어갈 수 없다.
        unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        let exited = crate::processes::testkit::wait_until(|| {
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            let flags = libc::WEXITED | libc::WNOWAIT | libc::WNOHANG;
            let ok = unsafe { libc::waitid(libc::P_PID, pid, &mut info, flags) };
            ok == 0 && info.si_pid == pid as libc::pid_t
        });
        let me = me();
        let readings = zombie.map(|zombie| read([zombie, me]));

        // **거두는 것이 단언보다 먼저다.**
        drop(kid);

        let zombie = zombie.expect("자식이 5초 안에 제 세션을 열지 못했다");
        assert!(exited, "자식이 5초 안에 끝나지 않았다");
        let readings = readings.expect("위에서 읽었다");
        assert!(readings.by_id.get(&me).is_some_and(|reading| reading.memory > 0), "좀비 하나에 이 검사 자신의 지표까지 잃었다");
        assert!(!readings.by_id.contains_key(&zombie), "좀비의 지표가 섰다");
        assert!(readings.skipped >= 1, "좀비를 건너뛰고도 세지 않았다");
    }
}

/// 다른 OS — 지표 수집이 컴파일되고 빈 값을 돌려준다(PR 게이트의 우분투가 잰다).
#[cfg(all(test, not(target_os = "macos")))]
mod elsewhere {
    use super::read;
    use crate::processes::Identity;

    #[test]
    fn other_systems_read_nothing() {
        let readings = read([Identity { pid: std::process::id(), started_us: 0 }]);
        assert!(readings.by_id.is_empty(), "macOS 밖에서 지표를 읽었다");
    }
}
