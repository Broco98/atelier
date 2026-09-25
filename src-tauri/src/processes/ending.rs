//! 끝내기 — 판정이 고른 신원들을 끝낸다(프로세스 결정 3 · 프로세스 스펙 S4).
//!
//! 부작용 층이다. **누가 우리 것인지 다시 판단하지 않는다** — 판정이 고른 신원만 받는다. 여기서 보는 것은
//! 하나, 「그 pid가 아직 그 프로세스인가」(신원)뿐이다.
//!
//! 순서
//! 1. 대상마다 SIGTERM, 같은 순간 셸 그룹에 SIGHUP. 스스로 정리할 기회다.
//! 2. 50ms마다 생존을 본다. 모두 끝나면 바로 나온다. 최대 2초.
//! 3. 신원이 그대로인 생존자에 SIGKILL. 셸 그룹 전체의 SIGKILL은 셸의 신원이 그대로일 때만.
//!
//! **신호마다 보내기 직전에 신원을 다시 본다** — SIGTERM도 SIGKILL도. 스냅샷과 신호 사이, 유예 2초 사이에
//! pid가 재사용되면 남에게 신호가 간다.
//!
//! **두 단계(`start` · `finish`)로 가른 것은 부르는 쪽이 그 사이에 할 일이 있어서다.** 셸 닫기는 신호를 보낸
//! 뒤 pty를 떨군다(`pty.rs`). 유예를 뒤로 보낼 때(티켓 05) 「진행 중인 끝내기」가 쥐는 것도 이 값이다.
//!
//! 모듈 이름에 `terminate`를 쓰지 않는다 — `terminate.rs`는 ⌘Q · Dock 종료를 묻는 macOS 델리게이트다.

use std::time::{Duration, Instant};

use super::{snapshot, Identity};

/// SIGTERM 뒤 SIGKILL까지 기다리는 최대 시간(프로세스 결정 3의 2초).
pub const GRACE: Duration = Duration::from_secs(2);

/// 생존을 보는 간격. 다 끝나면 이 간격 안에 나온다.
const POLL: Duration = Duration::from_millis(50);

/// SIGKILL 뒤 끝났는지 보는 시간. 잡히지 않는 신호라 곧 끝난다 — 이 안에 안 끝나면 「못 끝냄」이다(권한,
/// 끝나지 않는 커널 대기).
const KILL_SETTLE: Duration = Duration::from_millis(200);
const KILL_POLL: Duration = Duration::from_millis(10);

/// 신원 하나가 어떻게 끝났나.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// 끝남(TERM) — 유예 안에 스스로 끝났다.
    Ended,
    /// 강제(KILL) — 유예가 지나도 살아 있어 SIGKILL로 끝냈다.
    Forced,
    /// 못 끝냄 — SIGKILL 뒤에도 살아 있다.
    Survived,
    /// 이미 없음 — SIGTERM을 보내려 할 때 이미 그 프로세스가 아니었다.
    Gone,
}

/// 셸의 프로세스 그룹. 셸은 대상 목록에 없다 — 그룹째 SIGHUP을 받고, 유예 뒤에는 그룹째 SIGKILL을 받는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Group {
    pub pgid: u32,
    /// 그룹 리더(셸)의 신원. 알면 신호마다 그 신원이 그대로인지 보고, 모르면(리눅스, 셸이 뜨자마자 끝나 못
    /// 읽음) 그룹이 아직 있는지만 본다 — 신원 확인이 들기 전의 방어선 그대로다.
    pub leader: Option<Identity>,
}

/// 신호를 보낸 끝내기 — 기다림과 SIGKILL이 남았다.
pub struct Ending<K: Kernel = Os> {
    kernel: K,
    deadline: Instant,
    /// 대상과, SIGTERM을 받았는가(보낼 때 이미 그 프로세스가 아니었으면 거짓).
    targets: Vec<(Identity, bool)>,
    groups: Vec<Group>,
}

/// 끝내기를 시작한다 — SIGTERM과 SIGHUP을 보내고 곧바로 돌아온다.
pub fn start(targets: &[Identity], groups: &[Group]) -> Ending {
    Ending::start_with(Os, targets, groups)
}

impl<K: Kernel> Ending<K> {
    fn start_with(kernel: K, targets: &[Identity], groups: &[Group]) -> Self {
        let targets = targets
            .iter()
            .map(|id| {
                let same = kernel.identity_of(id.pid) == Some(*id);
                if same {
                    kernel.kill(id.pid, libc::SIGTERM);
                }
                (*id, same)
            })
            .collect();
        let ending = Ending { deadline: kernel.now() + GRACE, kernel, targets, groups: groups.to_vec() };
        for group in &ending.groups {
            if ending.still_there(group) {
                ending.kernel.killpg(group.pgid, libc::SIGHUP);
            }
        }
        ending
    }

    /// 유예를 기다리고 남은 것을 SIGKILL로 끝낸다. 대상마다 결과를 받은 순서대로 돌려준다.
    pub fn finish(self) -> Vec<(Identity, Outcome)> {
        // 셸도 기다린다. 대상이 없어도 SIGHUP을 무시하는 셸(`trap '' HUP TERM`)에게 바로 SIGKILL이 가지 않게
        // — 셸 역시 정리할 기회를 받는다.
        self.wait_while(self.deadline, POLL, |ending| {
            ending.targets.iter().any(|(id, signalled)| *signalled && ending.same(id))
                || ending.groups.iter().any(|group| ending.still_there(group))
        });

        let mut outcomes: Vec<(Identity, Outcome)> = self
            .targets
            .iter()
            .map(|(id, signalled)| {
                let outcome = if !signalled {
                    Outcome::Gone
                } else if self.same(id) {
                    self.kernel.kill(id.pid, libc::SIGKILL);
                    Outcome::Forced
                } else {
                    Outcome::Ended
                };
                (*id, outcome)
            })
            .collect();
        // 그룹째 SIGKILL은 지금 방어선이다 — `trap '' HUP TERM`을 건 셸은 SIGHUP도 master를 떨구는 것도
        // 다 통과하고 SIGKILL만이 끝냈다(실측). 셸의 신원이 그대로일 때만 보낸다.
        let forced: Vec<Group> =
            self.groups.iter().copied().filter(|group| self.still_there(group)).collect();
        for group in &forced {
            self.kernel.killpg(group.pgid, libc::SIGKILL);
        }

        if forced.is_empty() && !outcomes.iter().any(|(_, outcome)| *outcome == Outcome::Forced) {
            return outcomes;
        }
        let until = self.kernel.now() + KILL_SETTLE;
        self.wait_while(until, KILL_POLL, |ending| {
            outcomes.iter().any(|(id, outcome)| *outcome == Outcome::Forced && ending.same(id))
                || forced.iter().any(|group| ending.still_there(group))
        });
        // SIGKILL은 잡히지 않으므로 여기까지 살아 있으면 우리가 못 건드리는 것이다. 조용히 넘기면 남긴 채
        // 「끝냈다」고 믿게 된다.
        for (id, outcome) in &mut outcomes {
            if *outcome == Outcome::Forced && self.same(id) {
                *outcome = Outcome::Survived;
                eprintln!("atelier: pid {} survived SIGKILL", id.pid);
            }
        }
        for group in forced.iter().filter(|group| self.still_there(group)) {
            eprintln!("atelier: process group {} survived SIGKILL", group.pgid);
        }
        outcomes
    }

    /// 그 pid가 아직 그 프로세스인가.
    fn same(&self, id: &Identity) -> bool {
        self.kernel.identity_of(id.pid) == Some(*id)
    }

    /// 그룹이 아직 신호를 받을 자리인가. 리더의 신원을 알면 리더가 그대로인가를, 모르면 그룹이 있는가를 본다.
    ///
    /// **리더가 끝났으면 그룹에는 더 보내지 않는다.** 그 pid를 남이 받아 제 그룹을 열었을 수 있다. 그룹에
    /// 남은 우리 것은 대상 목록에 신원째 있어 따로 끝난다.
    fn still_there(&self, group: &Group) -> bool {
        match group.leader {
            Some(leader) => self.same(&leader),
            None => self.kernel.group_alive(group.pgid),
        }
    }

    /// 조건이 서 있는 동안 `every`마다 보며 `until`까지 기다린다.
    fn wait_while(&self, until: Instant, every: Duration, busy: impl Fn(&Self) -> bool) {
        while busy(self) {
            let now = self.kernel.now();
            if now >= until {
                return;
            }
            self.kernel.sleep(every.min(until - now));
        }
    }
}

/// 끝내기가 딛는 커널 — 신원 읽기, 신호, 시계. 검사는 가짜 커널로 모든 갈래를 잰다.
pub trait Kernel {
    /// 그 pid의 지금 신원. 없거나 이미 끝났으면(좀비 포함) `None`.
    fn identity_of(&self, pid: u32) -> Option<Identity>;
    fn kill(&self, pid: u32, sig: i32);
    fn killpg(&self, pgid: u32, sig: i32);
    /// 신원을 모르는 그룹이 아직 있는가.
    fn group_alive(&self, pgid: u32) -> bool;
    fn now(&self) -> Instant;
    fn sleep(&self, duration: Duration);
}

/// 이 기계의 커널.
pub struct Os;

impl Kernel for Os {
    fn identity_of(&self, pid: u32) -> Option<Identity> {
        snapshot::identity_of(pid)
    }

    fn kill(&self, pid: u32, sig: i32) {
        // `kill(0)`은 **앱 자신의 그룹**을, `kill(-1)`은 보낼 수 있는 모든 프로세스를 쏜다. i32를 넘는 값도
        // 음수로 접혀 그룹 신호가 된다.
        let Some(pid) = i32::try_from(pid).ok().filter(|pid| *pid > 1) else {
            return;
        };
        unsafe {
            libc::kill(pid, sig);
        }
    }

    fn killpg(&self, pgid: u32, sig: i32) {
        signal_group(pgid, sig);
    }

    fn group_alive(&self, pgid: u32) -> bool {
        group_alive(pgid)
    }

    fn now(&self) -> Instant {
        Instant::now()
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

/// 그룹에 신호를 보낸다.
///
/// `killpg`에 pgid를 그대로 믿고 넘기면 두 가지로 위험하다(둘 다 실측): `0`은 **앱 자신의 프로세스
/// 그룹**을 쏘고, 음수는 macOS에서 `kill(-N)`이 되어 그룹이 아니라 pid `N` 하나를 죽이면서 반환값은 0을
/// 준다.
pub(crate) fn signal_group(pgid: u32, sig: i32) {
    let Some(pgid) = i32::try_from(pgid).ok().filter(|pgid| *pgid > 1) else {
        return;
    };
    unsafe {
        libc::killpg(pgid, sig);
    }
}

/// 그룹이 아직 있는가.
pub(crate) fn group_alive(pgid: u32) -> bool {
    let Some(pgid) = i32::try_from(pgid).ok().filter(|pgid| *pgid > 1) else {
        return false;
    };
    if unsafe { libc::killpg(pgid, 0) } == 0 {
        return true;
    }
    // 좀비만 남은 그룹은 ESRCH가 아니라 EPERM을 낸다(실측). 살아있음으로 세는 것이 맞고, 끝내기는 유예
    // 끝에서 멈추므로 영원히 기다리는 일로는 이어지지 않는다 — 셸 좀비는 리더 스레드의 `child.wait()`가
    // 거둔다.
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;

    /// 가짜 프로세스 하나가 신호를 받으면 어떻게 되나.
    #[derive(Debug, Clone, Copy)]
    enum Fate {
        /// 곧바로 끝난다.
        Dies,
        /// 정리하느라 이만큼 걸려 끝난다.
        DiesAfter(Duration),
        /// 못 들은 척한다(`trap '' HUP TERM`, SIG_IGN). SIGKILL에 이것을 주면 끝나지 않는 커널 대기다.
        Ignores,
    }

    #[derive(Debug, Clone)]
    struct FakeProc {
        id: Identity,
        pgid: u32,
        alive: bool,
        term: Fate,
        hup: Fate,
        kill: Fate,
    }

    fn proc(pid: u32) -> FakeProc {
        FakeProc {
            id: Identity { pid, started_us: u64::from(pid) },
            pgid: pid,
            alive: true,
            term: Fate::Dies,
            hup: Fate::Dies,
            kill: Fate::Dies,
        }
    }

    impl FakeProc {
        fn born(mut self, started_us: u64) -> Self {
            self.id.started_us = started_us;
            self
        }
        fn in_group(mut self, pgid: u32) -> Self {
            self.pgid = pgid;
            self
        }
        fn on_term(mut self, fate: Fate) -> Self {
            self.term = fate;
            self
        }
        fn on_hup(mut self, fate: Fate) -> Self {
            self.hup = fate;
            self
        }
        fn on_kill(mut self, fate: Fate) -> Self {
            self.kill = fate;
            self
        }
    }

    /// 보낸 신호 하나 — 언제(ms), 누구에게, 무엇을.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum To {
        Pid(u32),
        Group(u32),
    }

    /// 가짜 커널. 시계는 `sleep`으로만 간다 — 2초 유예를 기다리지 않고 잰다.
    struct Fake {
        base: Instant,
        clock: Cell<Duration>,
        procs: RefCell<Vec<FakeProc>>,
        /// 이 시각에 이 프로세스가 표에 선다 — 끝난 것의 pid를 남이 새로 받는 자리.
        arrivals: RefCell<Vec<(Duration, FakeProc)>>,
        /// 이 시각에 이 신원이 끝난다(`DiesAfter`).
        deaths: RefCell<Vec<(Duration, Identity)>>,
        sent: RefCell<Vec<(u128, To, i32)>>,
    }

    impl Fake {
        fn new(procs: Vec<FakeProc>, arrivals: Vec<(u64, FakeProc)>) -> Self {
            Fake {
                base: Instant::now(),
                clock: Cell::new(Duration::ZERO),
                procs: RefCell::new(procs),
                arrivals: RefCell::new(
                    arrivals.into_iter().map(|(ms, p)| (Duration::from_millis(ms), p)).collect(),
                ),
                deaths: RefCell::new(Vec::new()),
                sent: RefCell::new(Vec::new()),
            }
        }

        fn ms(&self) -> u128 {
            self.clock.get().as_millis()
        }

        fn deliver(&self, sig: i32, hit: impl Fn(&FakeProc) -> bool) {
            let now = self.clock.get();
            let mut procs = self.procs.borrow_mut();
            for p in procs.iter_mut().filter(|p| p.alive && hit(p)) {
                let fate = match sig {
                    libc::SIGTERM => p.term,
                    libc::SIGHUP => p.hup,
                    libc::SIGKILL => p.kill,
                    _ => Fate::Ignores,
                };
                match fate {
                    Fate::Dies => p.alive = false,
                    Fate::DiesAfter(d) => self.deaths.borrow_mut().push((now + d, p.id)),
                    Fate::Ignores => {}
                }
            }
        }
    }

    impl Kernel for &Fake {
        fn identity_of(&self, pid: u32) -> Option<Identity> {
            self.procs.borrow().iter().find(|p| p.alive && p.id.pid == pid).map(|p| p.id)
        }
        fn kill(&self, pid: u32, sig: i32) {
            self.sent.borrow_mut().push((self.ms(), To::Pid(pid), sig));
            self.deliver(sig, |p| p.id.pid == pid);
        }
        fn killpg(&self, pgid: u32, sig: i32) {
            self.sent.borrow_mut().push((self.ms(), To::Group(pgid), sig));
            self.deliver(sig, |p| p.pgid == pgid);
        }
        fn group_alive(&self, pgid: u32) -> bool {
            self.procs.borrow().iter().any(|p| p.alive && p.pgid == pgid)
        }
        fn now(&self) -> Instant {
            self.base + self.clock.get()
        }
        fn sleep(&self, duration: Duration) {
            let now = self.clock.get() + duration;
            self.clock.set(now);
            let mut procs = self.procs.borrow_mut();
            for (_, id) in self.deaths.borrow().iter().filter(|(at, _)| *at <= now) {
                procs.iter_mut().filter(|p| p.id == *id).for_each(|p| p.alive = false);
            }
            let arrived: Vec<FakeProc> = self
                .arrivals
                .borrow()
                .iter()
                .filter(|(at, _)| *at <= now)
                .map(|(_, p)| p.clone())
                .collect();
            self.arrivals.borrow_mut().retain(|(at, _)| *at > now);
            procs.extend(arrived);
        }
    }

    fn id(pid: u32) -> Identity {
        Identity { pid, started_us: u64::from(pid) }
    }

    fn shell(pid: u32) -> Group {
        Group { pgid: pid, leader: Some(id(pid)) }
    }

    struct Case {
        what: &'static str,
        world: Vec<FakeProc>,
        /// (ms, 새로 선 프로세스) — 그 시각에 표에 선다.
        arrivals: Vec<(u64, FakeProc)>,
        targets: Vec<Identity>,
        groups: Vec<Group>,
        /// 보낸 신호 전부(ms, 누구, 신호). 여기 없는 신호는 안 갔다.
        sent: Vec<(u128, To, i32)>,
        outcomes: Vec<Outcome>,
        /// `finish`가 돌아온 시각(ms).
        done_at: u128,
    }

    use libc::{SIGHUP, SIGKILL, SIGTERM};
    use To::{Group as G, Pid as P};

    /// **끝내기 표.** 한 줄에 프로세스 표 · 대상 · 셸 그룹과, 보낸 신호 전부 · 결과 · 끝난 시각을 둔다.
    ///
    /// 「신호가 안 갔다」를 재는 줄은 그 pid를 **살아 있는 남**이 쥐게 두고, 받은 신호 목록을 통째로 견준다
    /// — 남이 없으면 신호가 가도 아무 일이 없어 그 줄은 아무것도 재지 않는다.
    #[test]
    fn only_the_identity_that_was_judged_is_signalled() {
        let cases = [
            Case {
                what: "신원이 같은 것만 SIGTERM을 받는다 — pid가 같아도 시작 시각이 다르면 빠진다",
                world: vec![proc(10), proc(11).born(999).on_term(Fate::Ignores), proc(13)],
                arrivals: vec![],
                targets: vec![id(10), id(11), id(12)],
                groups: vec![],
                sent: vec![(0, P(10), SIGTERM)],
                outcomes: vec![Outcome::Ended, Outcome::Gone, Outcome::Gone],
                done_at: 0,
            },
            Case {
                what: "모두 끝나면 2초를 다 기다리지 않고 나온다",
                world: vec![proc(10).on_term(Fate::DiesAfter(Duration::from_millis(120)))],
                arrivals: vec![],
                targets: vec![id(10)],
                groups: vec![],
                sent: vec![(0, P(10), SIGTERM)],
                outcomes: vec![Outcome::Ended],
                done_at: 150,
            },
            Case {
                what: "SIGTERM을 무시하면 2초 뒤 SIGKILL로 끝난다",
                world: vec![proc(10).on_term(Fate::Ignores)],
                arrivals: vec![],
                targets: vec![id(10)],
                groups: vec![],
                sent: vec![(0, P(10), SIGTERM), (2000, P(10), SIGKILL)],
                outcomes: vec![Outcome::Forced],
                done_at: 2000,
            },
            Case {
                what: "유예 사이에 끝난 pid를 남이 받으면 그 남에게 SIGKILL이 안 간다",
                world: vec![
                    proc(10).on_term(Fate::DiesAfter(Duration::from_millis(100))),
                    proc(20).on_term(Fate::Ignores),
                ],
                arrivals: vec![(500, proc(10).born(500).on_term(Fate::Ignores))],
                targets: vec![id(10), id(20)],
                groups: vec![],
                sent: vec![(0, P(10), SIGTERM), (0, P(20), SIGTERM), (2000, P(20), SIGKILL)],
                outcomes: vec![Outcome::Ended, Outcome::Forced],
                done_at: 2000,
            },
            Case {
                what: "SIGKILL 뒤에도 살아 있으면 못 끝냄이다",
                world: vec![proc(10).on_term(Fate::Ignores).on_kill(Fate::Ignores)],
                arrivals: vec![],
                targets: vec![id(10)],
                groups: vec![],
                sent: vec![(0, P(10), SIGTERM), (2000, P(10), SIGKILL)],
                outcomes: vec![Outcome::Survived],
                done_at: 2200,
            },
            Case {
                what: "셸 그룹은 같은 순간 SIGHUP을 받고, 셸이 끝나기를 함께 기다린다",
                world: vec![
                    proc(100).on_hup(Fate::DiesAfter(Duration::from_millis(60))),
                    proc(101).in_group(100),
                ],
                arrivals: vec![],
                targets: vec![id(101)],
                groups: vec![shell(100)],
                sent: vec![(0, P(101), SIGTERM), (0, G(100), SIGHUP)],
                outcomes: vec![Outcome::Ended],
                done_at: 100,
            },
            Case {
                what: "SIGHUP을 무시하는 셸은 셸 신원이 그대로라 그룹째 SIGKILL을 받는다",
                world: vec![proc(100).on_hup(Fate::Ignores)],
                arrivals: vec![],
                targets: vec![],
                groups: vec![shell(100)],
                sent: vec![(0, G(100), SIGHUP), (2000, G(100), SIGKILL)],
                outcomes: vec![],
                done_at: 2000,
            },
            Case {
                what: "셸 pid를 남이 받으면 그룹 SIGKILL이 안 간다",
                world: vec![
                    proc(100).on_hup(Fate::DiesAfter(Duration::from_millis(100))),
                    proc(20).on_term(Fate::Ignores),
                ],
                arrivals: vec![(300, proc(100).born(300).on_hup(Fate::Ignores))],
                targets: vec![id(20)],
                groups: vec![shell(100)],
                sent: vec![(0, P(20), SIGTERM), (0, G(100), SIGHUP), (2000, P(20), SIGKILL)],
                outcomes: vec![Outcome::Forced],
                done_at: 2000,
            },
            Case {
                what: "셸이 이미 끝났으면 그 pid를 쥔 남의 그룹에 SIGHUP도 안 간다",
                world: vec![proc(100).born(300), proc(20)],
                arrivals: vec![],
                targets: vec![id(20)],
                groups: vec![shell(100)],
                sent: vec![(0, P(20), SIGTERM)],
                outcomes: vec![Outcome::Ended],
                done_at: 0,
            },
            Case {
                what: "신원을 모르는 그룹(리눅스)은 그룹이 있는 동안 기다리고 남으면 SIGKILL — 옛 방어선",
                world: vec![proc(100).on_hup(Fate::Ignores), proc(101).in_group(100).on_hup(Fate::Ignores)],
                arrivals: vec![],
                targets: vec![],
                groups: vec![Group { pgid: 100, leader: None }],
                sent: vec![(0, G(100), SIGHUP), (2000, G(100), SIGKILL)],
                outcomes: vec![],
                done_at: 2000,
            },
        ];

        let mut wrong = Vec::new();
        for case in cases {
            let fake = Fake::new(case.world, case.arrivals);
            let outcomes: Vec<Outcome> = Ending::start_with(&fake, &case.targets, &case.groups)
                .finish()
                .into_iter()
                .map(|(_, outcome)| outcome)
                .collect();
            let got = (fake.sent.borrow().clone(), outcomes, fake.ms());
            let want = (case.sent, case.outcomes, case.done_at);
            if got != want {
                wrong.push(format!("{}\n    기대 {want:?}\n    받음 {got:?}", case.what));
            }
        }
        assert!(wrong.is_empty(), "끝내기가 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// 결과는 받은 대상의 순서 그대로, 신원째 돌아온다 — 부르는 쪽(정리 기록)이 그것으로 행을 찾는다.
    #[test]
    fn outcomes_come_back_in_the_order_the_targets_went_in() {
        let fake = Fake::new(vec![proc(30), proc(10)], vec![]);
        let got = Ending::start_with(&fake, &[id(30), id(20), id(10)], &[]).finish();
        assert_eq!(
            got,
            vec![(id(30), Outcome::Ended), (id(20), Outcome::Gone), (id(10), Outcome::Ended)]
        );
    }
}

/// **실물 검사(macOS).** 자식은 이 테스트 바이너리 자신이고(`testkit`), 신호는 검사가 띄운 자식에게만 간다 —
/// 판정이 고른 것을 그 자식의 pid로 한 번 더 거른 뒤에 끝내기에 넘긴다. 이 기계의 표에는 구현 세션과
/// 사용자의 셸이 함께 있다.
///
/// 판정의 입력은 모두 적어 준다(앱 pid, 물려받은 키 없음, 셸 목록 없음). 검사 프로세스도 설치본 셸의
/// 표식을 물려받았지만 그 사실에 흔들리지 않게.
#[cfg(all(test, target_os = "macos"))]
mod real {
    use std::time::{Duration, Instant};

    use super::{start, Outcome, GRACE};
    use crate::processes::snapshot::{identity_of, take, EnvScope};
    use crate::processes::testkit::{holds_for, key, Kid};
    use crate::processes::verdict::{judge, Inputs, Occasion, ShellEntry};
    use crate::processes::Identity;

    /// 끝낼 셸 하나(`key`)의 자손을 판정으로 고르고, 그중 이 자식만 남긴다.
    fn judged(key: &str, kid: &Kid) -> Vec<Identity> {
        let snapshot = take(EnvScope::All);
        let ending = [ShellEntry { key: key.to_string(), process: None, first_input_us: None }];
        let verdict = judge(&Inputs {
            snapshot: &snapshot,
            generation: "test",
            shells: &[],
            ending: &ending,
            instances: &[],
            exceptions: &[],
            app_pid: std::process::id(),
            inherited_key: None,
            occasion: Occasion::Normal,
        });
        verdict.descendants[key]
            .iter()
            .map(|p| p.id)
            .filter(|id| id.pid == kid.pid())
            .collect()
    }

    /// **셸을 닫으면 `setsid`로 떨어진 표식 자식이 2초 안에 끝난다.** claude Bash 도구가 띄운 dev 서버의
    /// 모양이다 — 별도 세션이라 셸 그룹 신호는 안 닿고, 표식으로 찾아 SIGTERM으로 끝낸다.
    #[test]
    fn a_marked_child_in_its_own_session_ends_within_two_seconds() {
        let key = key(3);
        let kid = Kid::spawn("sleep", &key);
        let settled = kid.settle();
        let targets = judged(&key, &kid);

        let began = Instant::now();
        let outcomes = start(&targets, &[]).finish();
        let took = began.elapsed();
        let alive = settled.is_some_and(|id| identity_of(id.pid) == Some(id));

        // **거두는 것이 단언보다 먼저다.**
        drop(kid);

        let id = settled.expect("자식이 5초 안에 제 세션을 열지 못했다");
        assert_eq!(targets, vec![id], "판정이 표식 자식을 끝낼 셸의 자손으로 안 골랐다");
        assert_eq!(outcomes, vec![(id, Outcome::Ended)], "SIGTERM으로 끝나야 한다");
        assert!(!alive, "끝내기가 돌아왔는데 자식이 살아 있다");
        assert!(took < GRACE, "끝났는데 유예를 다 기다렸다 ({took:?})");
    }

    /// **SIGTERM을 무시하는 자식은 2초 뒤 SIGKILL로 끝난다.**
    #[test]
    fn a_child_that_ignores_sigterm_is_ended_by_sigkill() {
        let key = key(4);
        let kid = Kid::spawn("ignore-term", &key);
        let settled = kid.settle();
        let targets = judged(&key, &kid);

        let began = Instant::now();
        let outcomes = start(&targets, &[]).finish();
        let took = began.elapsed();
        let alive = settled.is_some_and(|id| identity_of(id.pid) == Some(id));

        // **거두는 것이 단언보다 먼저다.**
        drop(kid);

        let id = settled.expect("자식이 5초 안에 제 세션을 열지 못했다");
        assert_eq!(targets, vec![id], "판정이 표식 자식을 끝낼 셸의 자손으로 안 골랐다");
        assert_eq!(outcomes, vec![(id, Outcome::Forced)], "SIGKILL로 끝나야 한다");
        assert!(!alive, "SIGKILL 뒤에도 자식이 살아 있다");
        assert!(took >= GRACE, "SIGTERM을 무시하는 상대를 유예 전에 끝냈다 ({took:?})");
    }

    /// **pid가 같아도 시작 시각이 다르면 신호가 안 간다** — 순수 표의 같은 줄을 진짜 커널로 잰다. 그사이 그
    /// pid를 새로 받은 남의 모양이다. 앵커: 신호가 갔다면 이 자식은 SIGTERM에 끝난다(위 첫 검사).
    ///
    /// 살아 있는지는 돌아온 직후 한 번이 아니라 0.3초 내내 본다 — 신호는 조금 늦게 닿아, 한 번만 보면 신호가
    /// 가도 초록이다(신원 확인을 뺀 변형이 그렇게 지나갔다).
    #[test]
    fn a_pid_whose_start_time_differs_is_left_alone() {
        let key = key(5);
        let kid = Kid::spawn("sleep", &key);
        let settled = kid.settle();
        let forged = settled.map(|id| Identity { pid: id.pid, started_us: id.started_us + 1 });

        let outcomes = forged.map(|forged| start(&[forged], &[]).finish());
        let alive = settled.is_some_and(|id| {
            holds_for(Duration::from_millis(300), || identity_of(id.pid) == Some(id))
        });

        // **거두는 것이 단언보다 먼저다.**
        drop(kid);

        let forged = forged.expect("자식이 5초 안에 제 세션을 열지 못했다");
        assert_eq!(outcomes, Some(vec![(forged, Outcome::Gone)]), "다른 신원을 「이미 없음」으로 안 봤다");
        assert!(alive, "시작 시각이 다른 신원인데 그 pid의 프로세스에 신호가 갔다");
    }
}
