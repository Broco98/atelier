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
//! 뒤 pty를 떨구고, 유예와 SIGKILL(`finish`)은 뒤 스레드에 맡긴다.
//!
//! **뒤로 보낸 끝내기는 모두 「진행 중인 끝내기」(`InFlight`)에 오른다**(프로세스 스펙 S5). 뒤 스레드는 앱과
//! 함께 사라진다 — 유예 중에 앱이 닫히면 SIGKILL을 아무도 안 보낸다. 그래서 앱 종료가 이 목록을 동기로
//! 마감한다(`InFlight::close`).
//!
//! 모듈 이름에 `terminate`를 쓰지 않는다 — `terminate.rs`는 ⌘Q · Dock 종료를 묻는 macOS 델리게이트다.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::{snapshot, Identity};

/// SIGTERM 뒤 SIGKILL까지 기다리는 최대 시간(프로세스 결정 3의 2초).
pub const GRACE: Duration = Duration::from_secs(2);

/// 생존을 보는 간격. 다 끝나면 이 간격 안에 나온다.
const POLL: Duration = Duration::from_millis(50);

/// SIGKILL 뒤 끝났는지 보는 시간. 잡히지 않는 신호라 곧 끝난다 — 이 안에 안 끝나면 「못 끝냄」이다(권한,
/// 끝나지 않는 커널 대기).
const KILL_SETTLE: Duration = Duration::from_millis(200);
const KILL_POLL: Duration = Duration::from_millis(10);

/// 신원 하나가 어떻게 끝났나. 정리 기록(`cleanup_log`)에 그대로 적힌다 — 와이어는 `"ended"` · `"forced"` · `"survived"` ·
/// `"gone"`이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
///
/// **복사해 둘이 함께 마감해도 된다.** 진행 중인 끝내기 목록이 쥔 것이 복사본이다 — 뒤 스레드와 앱 종료가 같은
/// 끝내기를 나란히 마감할 수 있고, 신호마다 직전에 신원을 다시 보니 한쪽이 끝낸 것을 다른 쪽이 또 쏘지 않는다.
#[derive(Clone)]
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

/// 판정 중인 닫기를 앱 종료가 기다려 주는 최대 시간. 판정은 스냅샷 한 장과 순수 함수라 ms 단위다 — 이 값은
/// 목록에 끝내 안 오르는 몫(판정 중 패닉)이 종료를 붙잡지 않게 둔 상한이다.
const JUDGING_LIMIT: Duration = Duration::from_millis(500);

/// **진행 중인 끝내기** — 뒤 스레드로 보낸 끝내기의 목록(프로세스 스펙 S5).
///
/// 셸 닫기 · 새로고침은 신호를 보낸 뒤 유예와 SIGKILL을 뒤 스레드에 맡기고 곧바로 돌아온다. 그 스레드는 앱과
/// 함께 사라진다 — ×를 누르고 2초 안에 ⌘Q를 누르면 SIGTERM을 무시한 자손에 SIGKILL이 영영 안 간다. 그래서
/// 뒤로 보내는 끝내기는 모두 여기 오르고, 앱 종료가 목록을 동기로 마감한다(`close`).
///
/// 한 닫기는 두 걸음으로 오른다.
/// 1. `claim` — **풀에서 셸을 빼기 전에** 「판정 중」으로 센다. 판정이 끝나기 전에 종료가 오면 종료는 그것이
///    목록에 오르기를 기다린다. 뺀 셸이 풀에도 목록에도 없는 틈이 없다.
/// 2. `Claim::start` — 신호를 보내고 끝내기(신원들, 마감 시각, 셸 그룹)를 목록에 올린다. `Running::finish`가
///    마감하고 내린다.
pub struct InFlight<K: Kernel = Os> {
    kernel: K,
    state: Mutex<Listed<K>>,
    /// 판정 중이던 것이 목록에 오르거나 물러날 때 울린다 — 종료가 그것을 기다린다.
    changed: Condvar,
}

struct Listed<K: Kernel> {
    next: u64,
    /// `claim` 했는데 아직 `start` 하지 않은 닫기 수.
    judging: usize,
    /// 오른 차례대로.
    endings: BTreeMap<u64, Ending<K>>,
}

impl<K: Kernel> Listed<K> {
    /// 목록의 끝내기들이 이미 SIGTERM을 보낸 신원 — 보내려 할 때 이미 없던 신원은 안 든다.
    fn signalled(&self) -> HashSet<Identity> {
        self.endings
            .values()
            .flat_map(|ending| ending.targets.iter().filter(|(_, signalled)| *signalled).map(|(id, _)| *id))
            .collect()
    }

    /// **새 끝내기가 맡을 대상** — 목록의 끝내기가 이미 SIGTERM을 보낸 신원을 빼고, 겹친 신원은 한 번만 둔다. 두 번째 SIGTERM을
    /// 「그래도 끝내라」로 읽는 도구가 있다 — 정리하던 것이 정리를 버린다. 뺀 신원의 SIGKILL은 그것을 맡은 끝내기가 제 마감 시각에
    /// 보낸다. 뺀 신원은 새 끝내기의 결과에 없다 — 정리 기록에서 한 프로세스가 두 사건에 서지 않는다.
    ///
    /// **잠금을 쥔 채 부르고, 신호도 그 잠금 안에서 보낸다**(`Claim::start` · `InFlight::close`). 확인과 신호가 잠금 둘에 걸치면 동시에
    /// 온 두 끝내기가 모두 확인을 먼저 지나 둘 다 쏜다.
    fn unsignalled(&self, targets: &[Identity]) -> Vec<Identity> {
        let signalled = self.signalled();
        let mut seen = HashSet::new();
        targets.iter().copied().filter(|id| !signalled.contains(id) && seen.insert(*id)).collect()
    }
}

impl Default for InFlight {
    fn default() -> Self {
        InFlight::with_kernel(Os)
    }
}

impl<K: Kernel> InFlight<K> {
    fn with_kernel(kernel: K) -> Self {
        InFlight {
            kernel,
            state: Mutex::new(Listed { next: 0, judging: 0, endings: BTreeMap::new() }),
            changed: Condvar::new(),
        }
    }

    /// 잠금이 오염됐다는 것은 다른 스레드가 패닉했다는 뜻이다. 목록은 그래도 맞다 — 안을 꺼내 이어 간다.
    fn lock(&self) -> MutexGuard<'_, Listed<K>> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 닫기 하나를 「판정 중」으로 센다. **풀에서 셸을 빼기 전에** 부른다.
    pub fn claim(self: &Arc<Self>) -> Claim<K> {
        self.lock().judging += 1;
        Claim { list: Arc::clone(self), open: true }
    }

    /// 목록에 오른 끝내기의 대상 신원 전부 — 오른 차례대로. 앱은 목록을 `close`로만 읽는다.
    #[cfg(test)]
    fn listed(&self) -> Vec<Identity> {
        self.lock().endings.values().flat_map(|ending| ending.targets.iter().map(|(id, _)| *id)).collect()
    }

    /// **앱 종료** — 새로 고른 대상의 끝내기를 시작하고, 목록의 끝내기와 함께 마감할 차례로 돌려준다.
    ///
    /// - 판정 중인 닫기가 있으면 그것이 목록에 오르기를 기다린다(최대 `JUDGING_LIMIT`).
    /// - 목록의 끝내기는 **남은 유예만** 기다린다 — 마감 시각을 그대로 들고 온다. 이미 지났으면 곧바로
    ///   SIGKILL이다.
    /// - 목록이 이미 SIGTERM을 보낸 신원에는 다시 안 보낸다(`Listed::unsignalled` — 셸 닫기 · 손으로 끝내기와 같은 규칙).
    ///
    /// 목록에서 내리지 않는다. 뒤 스레드가 같은 끝내기를 나란히 마감하다 내린다 — 앱이 먼저 끝나면 함께
    /// 사라진다.
    pub fn close(&self, targets: &[Identity], groups: &[Group]) -> Closing<K> {
        let (listed, _) = self
            .changed
            .wait_timeout_while(self.lock(), JUDGING_LIMIT, |listed| listed.judging > 0)
            .unwrap_or_else(|e| e.into_inner());
        let mut endings: Vec<Ending<K>> = listed.endings.values().cloned().collect();
        let fresh = listed.unsignalled(targets);
        endings.push(Ending::start_with(self.kernel.clone(), &fresh, groups));
        drop(listed);
        // 오른 차례는 거의 신호를 보낸 차례지만, 두 스레드에서는 뒤바뀔 수 있다 — 이른 마감이 늦은 것 뒤에서
        // 기다리지 않게 마감 시각으로 줄 세운다.
        endings.sort_by_key(|ending| ending.deadline);
        Closing { endings, fresh }
    }
}

/// 풀에서 뺀 셸의 닫기 — 판정 중이다. `start` 하지 않고 떨어지면(뺄 셸이 없었다, 판정이 패닉했다) 셈에서
/// 물러나 종료가 기다리지 않는다.
pub struct Claim<K: Kernel = Os> {
    list: Arc<InFlight<K>>,
    open: bool,
}

impl<K: Kernel> Claim<K> {
    /// 끝내기를 시작하고(대상 SIGTERM, 셸 그룹 SIGHUP) 목록에 올린다. 곧바로 돌아온다. 셸 닫기 · 새로고침 · 셸 스스로 끝남 ·
    /// 시작 정리 · 손으로 끝내기가 모두 이것을 지난다.
    ///
    /// **진행 중인 끝내기가 이미 SIGTERM을 보낸 신원은 뺀다**(`Listed::unsignalled`) — [끝내기]의 유예 중에 그 행의 셸을 닫거나
    /// 새로고침하면 같은 신원이 두 끝내기에 든다. 빼기 · 신호 · 목록에 오르기가 **한 잠금 안**이다 — 동시에 온 두 끝내기도 한 신원에
    /// SIGTERM을 한 번만 보낸다. 신호는 ms 단위라(신원 읽기와 `kill`) 그동안 다른 끝내기가 잠금을 기다려도 짧다.
    pub fn start(mut self, targets: &[Identity], groups: &[Group]) -> Running<K> {
        let (id, ending) = {
            let mut listed = self.list.lock();
            let fresh = listed.unsignalled(targets);
            let ending = Ending::start_with(self.list.kernel.clone(), &fresh, groups);
            let id = listed.next;
            listed.next += 1;
            listed.endings.insert(id, ending.clone());
            listed.judging -= 1;
            (id, ending)
        };
        self.open = false;
        self.list.changed.notify_all();
        Running { list: Arc::clone(&self.list), id, ending }
    }

    /// **사람이 고른 신원 목록의 끝내기**(티켓 31 — `Processes`의 [끝내기] · [정리]). 판정 없이 받은 신원을 끝낸다. 셸 그룹은 없다 —
    /// 셸을 닫는 길이 아니다.
    ///
    /// 받는 것은 화면이 **보인 표본의 신원**이라 신호와 사이가 초 단위다(프로세스 스펙 판 04 › 동작). 그사이 그 pid를 남이 받았으면
    /// 신호 직전의 신원 확인이 거른다(`Ending::start_with` — S4) — 판정이 고른 것과 같은 길이다. 겹친 신원과 진행 중인 끝내기가 이미
    /// SIGTERM을 보낸 신원은 `start`가 뺀다 — 유예 중인 프로세스의 행은 다음 표본까지 화면에 남아 [끝내기]를 한 번 더 누를 수 있다.
    /// 뺀 신원은 결과에 없다.
    pub fn start_by_hand(self, targets: &[Identity]) -> Running<K> {
        self.start(targets, &[])
    }
}

impl<K: Kernel> Drop for Claim<K> {
    fn drop(&mut self) {
        if self.open {
            self.list.lock().judging -= 1;
            self.list.changed.notify_all();
        }
    }
}

/// 목록에 오른 끝내기 — 뒤 스레드가 쥐고 마감한다.
pub struct Running<K: Kernel = Os> {
    list: Arc<InFlight<K>>,
    id: u64,
    ending: Ending<K>,
}

impl<K: Kernel> Running<K> {
    /// 유예를 기다리고 남은 것을 SIGKILL로 끝낸 뒤 목록에서 내린다.
    ///
    /// 마감하지 않고 떨어지면 목록에 남는다 — 앱 종료가 대신 마감한다.
    pub fn finish(self) -> Vec<(Identity, Outcome)> {
        let Running { list, id, ending } = self;
        let outcomes = ending.finish();
        list.lock().endings.remove(&id);
        outcomes
    }
}

/// 앱 종료가 마감할 끝내기들 — 마감 시각이 이른 것부터.
pub struct Closing<K: Kernel = Os> {
    endings: Vec<Ending<K>>,
    /// 종료가 **새로** 맡은 대상 — 목록의 끝내기가 이미 SIGTERM을 보낸 신원은 빠졌다.
    fresh: Vec<Identity>,
}

impl<K: Kernel> Closing<K> {
    /// 종료가 새로 맡은 대상(티켓 11). 목록의 끝내기는 그것을 시작한 길(셸 닫기 · 새로고침 · 셸 스스로 끝남 · 시작 정리 · 손으로
    /// 끝내기)의 사건으로 정리 기록에 적힌다 — 종료의 사건이 이것만 적어야 같은 프로세스가 두 사건에 서지 않는다.
    pub fn fresh(&self) -> &[Identity] {
        &self.fresh
    }

    /// 마감 시각이 이른 것부터 차례로 마감한다. **모두 끝나야 돌아온다** — 그 사이 다른 끝내기의 유예도 함께
    /// 흐르므로, 걸리는 시간은 가장 늦은 마감 시각까지다(최악 2초). 다 끝나면 바로 나온다.
    ///
    /// 결과는 목록의 것부터 마감한 차례대로, 대상마다 받은 순서 그대로다.
    pub fn finish(self) -> Vec<(Identity, Outcome)> {
        self.endings.into_iter().flat_map(Ending::finish).collect()
    }
}

/// 끝내기가 딛는 커널 — 신원 읽기, 신호, 시계. 검사는 가짜 커널로 모든 갈래를 잰다.
///
/// `Clone`인 것은 진행 중인 끝내기 목록이 끝내기를 복사해 쥐기 때문이다.
pub trait Kernel: Clone {
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
#[derive(Debug, Clone, Copy)]
pub struct Os;

impl Kernel for Os {
    fn identity_of(&self, pid: u32) -> Option<Identity> {
        snapshot::identity_of(pid)
    }

    fn kill(&self, pid: u32, sig: i32) {
        let Some(pid) = signallable(pid) else {
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

/// **신호를 보내도 되는 번호인가** — 되면 libc가 받는 꼴(`i32`)로 준다. 커널에 번호를 넘기는 세 자리(`Os::kill` ·
/// `signal_group` · `group_alive`)가 모두 이것을 지난다. 번호를 그대로 믿고 넘기면 위험하다(모두 실측):
/// - `kill(0)` · `killpg(0)`은 **앱 자신의 프로세스 그룹**을 쏜다.
/// - `kill(-1)`은 보낼 수 있는 모든 프로세스를 쏜다. i32를 넘는 u32는 음수로 접혀 그런 번호가 된다.
/// - 음수 pgid는 macOS에서 `kill(-N)`이 되어 그룹이 아니라 pid `N` 하나를 죽이면서 반환값은 0을 준다.
/// - 1은 launchd다.
fn signallable(pid: u32) -> Option<i32> {
    i32::try_from(pid).ok().filter(|pid| *pid > 1)
}

/// 그룹에 신호를 보낸다. 번호는 `signallable`이 거른다.
pub(crate) fn signal_group(pgid: u32, sig: i32) {
    let Some(pgid) = signallable(pgid) else {
        return;
    };
    unsafe {
        libc::killpg(pgid, sig);
    }
}

/// 그룹이 아직 있는가. 신호를 보낼 수 없는 번호는 없는 그룹이다(`signallable`).
pub(crate) fn group_alive(pgid: u32) -> bool {
    let Some(pgid) = signallable(pgid) else {
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
    ///
    /// 표는 입구 둘이 함께 쓴다 — 판정이 고른 것의 끝내기(`Ending::start_with`)와 사람이 고른 것의 끝내기(`Claim::start_by_hand`,
    /// 티켓 31). 뒤의 것은 셸 그룹이 없어 그룹 없는 줄만 탄다.
    #[test]
    fn only_the_identity_that_was_judged_is_signalled() {
        let mut wrong = Vec::new();
        for case in survivor_cases() {
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

    /// **사람이 고른 신원 목록의 끝내기도 같은 표를 지난다**(티켓 31 — `Processes`의 [끝내기] · [정리]). 받는 신원은 화면에 보인
    /// 표본의 것이라 신호와 사이가 초 단위다(프로세스 스펙 판 04 › 동작) — 그사이 그 pid를 남이 받았으면 SIGTERM도 SIGKILL도 그
    /// 남에게 안 간다(S4). 셸 그룹을 받지 않는 입구라 그룹 없는 줄만 탄다. 앵커: 그룹 없는 줄이 하나라도 있다.
    #[test]
    fn a_hand_picked_ending_leaves_a_reused_pid_alone_like_any_other() {
        let cases: Vec<Case> = survivor_cases().into_iter().filter(|case| case.groups.is_empty()).collect();
        assert!(cases.len() >= 4, "그룹 없는 줄이 모자란다 — 이 입구가 재는 것이 없다");
        let mut wrong = Vec::new();
        for case in cases {
            let fake = Fake::new(case.world, case.arrivals);
            let list = Arc::new(InFlight::with_kernel(&fake));
            let outcomes: Vec<Outcome> = list
                .claim()
                .start_by_hand(&case.targets)
                .finish()
                .into_iter()
                .map(|(_, outcome)| outcome)
                .collect();
            let got = (fake.sent.borrow().clone(), outcomes, fake.ms());
            let want = (case.sent, case.outcomes, case.done_at);
            if got != want {
                wrong.push(format!("{}\n    기대 {want:?}\n    받음 {got:?}", case.what));
            }
            assert_eq!(list.listed(), vec![], "{} — 마감했는데 목록에 남았다", case.what);
        }
        assert!(wrong.is_empty(), "손으로 끝내기가 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// **사람이 고른 신원에는 SIGTERM이 한 번만 간다**(티켓 31). 같은 신원이 두 번 오면 한 번만 보낸다. 유예 중인 끝내기(앞서 누른
    /// [끝내기])가 이미 SIGTERM을 보낸 신원도 다시 안 보낸다 — 그 행은 다음 표본까지 화면에 남아 한 번 더 누를 수 있고, 두 번째
    /// SIGTERM을 「그래도 끝내라」로 읽는 도구가 있다(`InFlight::close`와 같은 까닭). 그 신원의 SIGKILL은 앞 끝내기가 제 마감에
    /// 보낸다. 앵커: 겹치지 않은 신원(20)은 SIGTERM을 받는다.
    #[test]
    fn a_hand_picked_ending_signals_each_identity_once() {
        let fake = Fake::new(vec![proc(10).on_term(Fate::Ignores), proc(20)], vec![]);
        let list = Arc::new(InFlight::with_kernel(&fake));
        let first = list.claim().start_by_hand(&[id(10)]);
        let second = list.claim().start_by_hand(&[id(10), id(20), id(20)]);
        let second = second.finish();
        let first = first.finish();

        assert_eq!(
            fake.sent.borrow().clone(),
            vec![(0, P(10), SIGTERM), (0, P(20), SIGTERM), (2000, P(10), SIGKILL)],
            "겹친 신원이나 유예 중인 신원에 SIGTERM이 또 갔다"
        );
        assert_eq!(second, vec![(id(20), Outcome::Ended)], "둘째 끝내기가 맡은 것이 어긋났다");
        assert_eq!(first, vec![(id(10), Outcome::Forced)], "앞 끝내기가 제 마감에 SIGKILL을 안 보냈다");
    }

    /// **진행 중인 끝내기가 이미 SIGTERM을 보낸 신원은 뒤의 어느 끝내기도 다시 안 쏜다**(티켓 31 · 프로세스 스펙 S5). [끝내기]의 유예
    /// 중에 그 행의 셸을 닫거나 새로고침하면(셸 닫기 · 새로고침은 `start`), 또는 시작 정리가 같은 신원을 고르면 두 번째 SIGTERM이 간다
    /// — 그것을 「그래도 끝내라」로 읽는 도구가 있다(`InFlight::close`와 같은 까닭). 뺀 신원은 뒤 끝내기의 결과에 없어 정리 기록의 두
    /// 번째 사건에 안 선다. 그 신원의 SIGKILL은 앞 끝내기가 제 마감에 보낸다.
    ///
    /// 앵커: 겹치지 않은 신원(20)은 SIGTERM을 받고, 뒤 끝내기의 셸 그룹(100)은 SIGHUP을 받는다.
    #[test]
    fn what_an_ending_in_flight_signalled_is_not_signalled_again() {
        let fake = Fake::new(vec![proc(10).on_term(Fate::Ignores), proc(20), proc(100)], vec![]);
        let list = Arc::new(InFlight::with_kernel(&fake));
        let by_hand = list.claim().start_by_hand(&[id(10)]);
        let closing = list.claim().start(&[id(10), id(20)], &[shell(100)]);
        let closed = closing.finish();
        let ended = by_hand.finish();

        assert_eq!(
            fake.sent.borrow().clone(),
            vec![(0, P(10), SIGTERM), (0, P(20), SIGTERM), (0, G(100), SIGHUP), (2000, P(10), SIGKILL)],
            "유예 중인 신원에 뒤의 끝내기가 SIGTERM을 또 보냈다"
        );
        assert_eq!(closed, vec![(id(20), Outcome::Ended)], "뒤 끝내기의 결과에 앞 끝내기가 맡은 신원이 섰다 — 정리 기록 두 사건에 선다");
        assert_eq!(ended, vec![(id(10), Outcome::Forced)], "앞 끝내기가 제 마감에 SIGKILL을 안 보냈다");
    }

    /// 스레드를 넘나드는 커널 — 모두 살아 있고 SIGTERM을 못 들은 척한다. **신원을 읽을 때마다 잠깐 잔다**: 「이미 보냈나」 확인과
    /// 신호 사이를 벌려, 확인을 잠금 밖에서 하면 동시에 온 두 호출이 모두 SIGTERM을 보내게 한다.
    #[derive(Clone, Default)]
    struct Slow {
        sent: Arc<Mutex<Vec<(u32, i32)>>>,
    }

    impl Kernel for Slow {
        fn identity_of(&self, pid: u32) -> Option<Identity> {
            std::thread::sleep(Duration::from_millis(20));
            Some(id(pid))
        }
        fn kill(&self, pid: u32, sig: i32) {
            self.sent.lock().unwrap_or_else(|e| e.into_inner()).push((pid, sig));
        }
        fn killpg(&self, pgid: u32, sig: i32) {
            panic!("그룹 없는 끝내기에서 그룹 {pgid}에 신호 {sig}가 갔다");
        }
        fn group_alive(&self, _pgid: u32) -> bool {
            false
        }
        fn now(&self) -> Instant {
            Instant::now()
        }
        fn sleep(&self, duration: Duration) {
            std::thread::sleep(duration);
        }
    }

    /// **동시에 온 두 [끝내기]도 한 신원에 SIGTERM을 한 번만 보낸다**(티켓 31). 「이미 보냈나」 확인과 신호와 목록에 오르기가 한 잠금
    /// 안이다 — 잠금 둘에 걸치면 둘 다 확인을 먼저 지나 둘 다 쏜다. 앵커: 한 번은 간다.
    #[test]
    fn two_endings_at_once_signal_an_identity_once() {
        let kernel = Slow::default();
        let list = Arc::new(InFlight::with_kernel(kernel.clone()));
        let ready = Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = (0..2)
            .map(|_| {
                let (list, ready) = (Arc::clone(&list), Arc::clone(&ready));
                std::thread::spawn(move || {
                    let claim = list.claim();
                    ready.wait();
                    drop(claim.start_by_hand(&[id(10)]));
                })
            })
            .collect();
        for thread in threads {
            thread.join().expect("끝내기 스레드가 패닉했다");
        }

        let terms = kernel.sent.lock().unwrap_or_else(|e| e.into_inner()).iter().filter(|sent| **sent == (10, SIGTERM)).count();
        assert_eq!(terms, 1, "동시에 온 두 끝내기가 한 신원에 SIGTERM을 {terms}번 보냈다");
    }

    /// 위 표 — 신원 확인 · 유예 · SIGKILL · 셸 그룹의 줄들.
    fn survivor_cases() -> Vec<Case> {
        vec![
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
        ]
    }

    /// **앱 자신의 그룹 · launchd · 모두에게는 신호가 갈 길이 없다.** 0은 앱 자신의 그룹, 1은 launchd, i32를 넘는 값은 음수로 접혀
    /// 「모두」나 남의 pid가 된다. 보이는 것은 그룹의 생존 물음뿐이라(`group_alive` — 신호 0이라 아무것도 안 보낸다) 그것으로 잰다:
    /// 가드가 없으면 0은 앱 자신의 그룹이라 살았고, 1은 launchd의 그룹이라 EPERM으로 살았다고 답한다. 앵커: 이 검사 자신의 그룹은
    /// 번호로 물으면 살아 있다.
    #[test]
    fn no_signal_finds_its_way_to_our_own_group_launchd_or_everyone() {
        for pgid in [0, 1, u32::MAX, i32::MAX as u32 + 1] {
            assert!(!group_alive(pgid), "그룹 {pgid}를 살아 있다고 봤다 — 가드 없이 커널에 물었다");
        }
        let ours = unsafe { libc::getpgrp() } as u32;
        assert!(ours > 1 && group_alive(ours), "이 검사의 그룹 {ours}를 못 봤다 — 위 단언이 아무것도 못 잰다");
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

    /// 가짜 시계를 이 시각(ms)까지 보낸다.
    fn until(fake: &Fake, ms: u64) {
        let now = fake.clock.get();
        let at = Duration::from_millis(ms);
        assert!(at >= now, "시계를 되돌릴 수 없다 — {now:?}에서 {at:?}로");
        fake.sleep(at - now);
    }

    /// **진행 중인 끝내기 목록은 시작할 때 오르고 끝나면 내린다.** 겹쳐 돈 둘이 서로의 항목을 잃지 않는다 —
    /// 나중에 시작한 것이 먼저 끝나도.
    #[test]
    fn an_ending_is_listed_from_start_to_finish() {
        let fake = Fake::new(vec![proc(10), proc(20), proc(30)], vec![]);
        let list = Arc::new(InFlight::with_kernel(&fake));
        let before = list.listed();
        let first = list.claim().start(&[id(10)], &[]);
        let second = list.claim().start(&[id(20), id(30)], &[]);
        let both = list.listed();
        let _ = second.finish();
        let after_second = list.listed();
        let _ = first.finish();
        let after_first = list.listed();

        assert_eq!(
            (before, both, after_second, after_first),
            (vec![], vec![id(10), id(20), id(30)], vec![id(10)], vec![]),
            "(처음, 둘 다 오른 뒤, 나중 것이 끝난 뒤, 둘 다 끝난 뒤)"
        );
    }

    /// 아무도 없는 세상 — 어떤 신원도 맞지 않아 신호가 안 간다. **스레드를 넘나드는 검사가 쓴다**(가짜 커널은
    /// 한 스레드용이다).
    #[derive(Clone, Copy)]
    struct Void;

    impl Kernel for Void {
        fn identity_of(&self, _pid: u32) -> Option<Identity> {
            None
        }
        fn kill(&self, pid: u32, sig: i32) {
            panic!("아무도 없는 세상에서 pid {pid}에 신호 {sig}가 갔다");
        }
        fn killpg(&self, pgid: u32, sig: i32) {
            panic!("아무도 없는 세상에서 그룹 {pgid}에 신호 {sig}가 갔다");
        }
        fn group_alive(&self, _pgid: u32) -> bool {
            false
        }
        fn now(&self) -> Instant {
            Instant::now()
        }
        fn sleep(&self, duration: Duration) {
            std::thread::sleep(duration);
        }
    }

    /// 여덟이 **다른 스레드에서** 겹쳐 돌아도 서로의 항목을 잃지 않는다 — 셸 닫기는 blocking 풀에서, 새로고침은
    /// 메인 스레드에서, 마감은 뒤 스레드에서 목록을 고친다.
    #[test]
    fn endings_on_many_threads_keep_each_others_entries() {
        const N: u32 = 8;
        let list = Arc::new(InFlight::with_kernel(Void));
        let started = Arc::new(std::sync::Barrier::new(N as usize + 1));
        let release = Arc::new(std::sync::Barrier::new(N as usize + 1));
        let threads: Vec<_> = (0..N)
            .map(|n| {
                let (list, started, release) =
                    (Arc::clone(&list), Arc::clone(&started), Arc::clone(&release));
                std::thread::spawn(move || {
                    let running = list.claim().start(&[id(100 + n)], &[]);
                    started.wait();
                    release.wait();
                    running.finish()
                })
            })
            .collect();
        started.wait();
        let mut all = list.listed();
        all.sort_by_key(|id| id.pid);
        release.wait();
        for thread in threads {
            thread.join().expect("끝내기 스레드가 패닉했다");
        }

        assert_eq!(all, (0..N).map(|n| id(100 + n)).collect::<Vec<_>>(), "모두 오른 순간의 목록");
        assert_eq!(list.listed(), vec![], "모두 끝난 뒤의 목록");
    }

    /// 앱 종료 한 줄 — 뒤로 보낸 끝내기들이 선 세상에서 종료 길을 부른다.
    struct Exit {
        what: &'static str,
        world: Vec<FakeProc>,
        /// 뒤로 보낸 끝내기: (시작 ms, 대상, 셸 그룹, 뒤 스레드가 종료 전에 마감했나).
        in_flight: Vec<(u64, Vec<Identity>, Vec<Group>, bool)>,
        /// 종료 길을 부르는 시각(ms).
        at: u64,
        /// 종료의 판정이 고른 것 — 이 세대의 표식을 문 전부와 풀의 PID 트리.
        targets: Vec<Identity>,
        groups: Vec<Group>,
        sent: Vec<(u128, To, i32)>,
        outcomes: Vec<(u32, Outcome)>,
        done_at: u128,
    }

    /// **앱 종료 표**(프로세스 스펙 S5). 종료는 진행 중인 끝내기를 **남은 유예만** 기다려 마감하고, 스스로 고른
    /// 것은 제 2초를 기다린다. 뒤 스레드는 돌리지 않는다 — 앱이 끝나면 함께 사라지는 그것을, 종료 혼자
    /// 마감해야 한다.
    #[test]
    fn the_exit_closes_what_is_in_flight_within_the_grace_left() {
        let cases = [
            Exit {
                what: "유예 중인 끝내기의 신원도 종료가 끝낸다 — 남은 유예만 기다리고, SIGTERM을 다시 안 보낸다",
                world: vec![proc(10).on_term(Fate::Ignores), proc(20).on_term(Fate::Ignores)],
                in_flight: vec![(0, vec![id(10)], vec![], false)],
                at: 500,
                targets: vec![id(10), id(20)],
                groups: vec![],
                sent: vec![
                    (0, P(10), SIGTERM),
                    (500, P(20), SIGTERM),
                    (2000, P(10), SIGKILL),
                    (2500, P(20), SIGKILL),
                ],
                outcomes: vec![(10, Outcome::Forced), (20, Outcome::Forced)],
                done_at: 2500,
            },
            Exit {
                what: "마감 시각이 지났는데 뒤 스레드가 아직 못 보낸 SIGKILL은 종료가 곧바로 보낸다",
                world: vec![proc(10).on_term(Fate::Ignores)],
                in_flight: vec![(0, vec![id(10)], vec![], false)],
                at: 2300,
                targets: vec![],
                groups: vec![],
                sent: vec![(0, P(10), SIGTERM), (2300, P(10), SIGKILL)],
                outcomes: vec![(10, Outcome::Forced)],
                done_at: 2300,
            },
            Exit {
                what: "모두 SIGTERM에 곧 끝나면 2초를 채우지 않는다",
                world: vec![
                    proc(10).on_term(Fate::DiesAfter(Duration::from_millis(100))),
                    proc(20).on_term(Fate::DiesAfter(Duration::from_millis(100))),
                ],
                in_flight: vec![(0, vec![id(10)], vec![], false)],
                at: 50,
                targets: vec![id(20)],
                groups: vec![],
                sent: vec![(0, P(10), SIGTERM), (50, P(20), SIGTERM)],
                outcomes: vec![(10, Outcome::Ended), (20, Outcome::Ended)],
                done_at: 150,
            },
            Exit {
                what: "겹쳐 돈 둘을 모두 마감한다 — 각자의 마감 시각에",
                world: vec![proc(10).on_term(Fate::Ignores), proc(20).on_term(Fate::Ignores)],
                in_flight: vec![(0, vec![id(10)], vec![], false), (1000, vec![id(20)], vec![], false)],
                at: 1500,
                targets: vec![],
                groups: vec![],
                sent: vec![
                    (0, P(10), SIGTERM),
                    (1000, P(20), SIGTERM),
                    (2000, P(10), SIGKILL),
                    (3000, P(20), SIGKILL),
                ],
                outcomes: vec![(10, Outcome::Forced), (20, Outcome::Forced)],
                done_at: 3000,
            },
            Exit {
                what: "뒤 스레드가 마감한 끝내기는 목록에서 내려 종료가 다시 안 본다",
                world: vec![proc(10).on_term(Fate::DiesAfter(Duration::from_millis(100)))],
                in_flight: vec![(0, vec![id(10)], vec![], true)],
                at: 500,
                targets: vec![],
                groups: vec![],
                sent: vec![(0, P(10), SIGTERM)],
                outcomes: vec![],
                done_at: 500,
            },
            Exit {
                what: "뒤로 보낸 셸 그룹도 남은 유예만 — SIGHUP을 무시하는 셸은 그 마감 시각에 그룹째 SIGKILL",
                world: vec![proc(100).on_hup(Fate::Ignores)],
                in_flight: vec![(0, vec![], vec![shell(100)], false)],
                at: 500,
                targets: vec![],
                groups: vec![],
                sent: vec![(0, G(100), SIGHUP), (2000, G(100), SIGKILL)],
                outcomes: vec![],
                done_at: 2000,
            },
            Exit {
                what: "종료가 고른 셸 그룹은 종료 때 SIGHUP을 받는다",
                world: vec![proc(100).on_hup(Fate::DiesAfter(Duration::from_millis(60)))],
                in_flight: vec![],
                at: 0,
                targets: vec![],
                groups: vec![shell(100)],
                sent: vec![(0, G(100), SIGHUP)],
                outcomes: vec![],
                done_at: 100,
            },
        ];

        let mut wrong = Vec::new();
        for case in cases {
            let fake = Fake::new(case.world, vec![]);
            let list = Arc::new(InFlight::with_kernel(&fake));
            // 마감하지 않은 것은 쥐고만 있다 — 뒤 스레드가 아직 자는 중이다.
            let mut sleeping = Vec::new();
            for (at, targets, groups, finished) in &case.in_flight {
                until(&fake, *at);
                let running = list.claim().start(targets, groups);
                if *finished {
                    let _ = running.finish();
                } else {
                    sleeping.push(running);
                }
            }
            until(&fake, case.at);
            let outcomes: Vec<(u32, Outcome)> = list
                .close(&case.targets, &case.groups)
                .finish()
                .into_iter()
                .map(|(id, outcome)| (id.pid, outcome))
                .collect();
            let got = (fake.sent.borrow().clone(), outcomes, fake.ms());
            let want = (case.sent, case.outcomes, case.done_at);
            if got != want {
                wrong.push(format!("{}\n    기대 {want:?}\n    받음 {got:?}", case.what));
            }
            drop(sleeping);
        }
        assert!(wrong.is_empty(), "종료가 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// **판정 중인 닫기를 종료가 기다린다.** 셸을 풀에서 뺀 뒤 목록에 오르기 전에 종료가 오면, 그 셸은 풀에도
    /// 목록에도 없다 — 종료가 그것을 모른 채 끝나면 그 셸의 자손에 SIGKILL이 안 간다. 판정 없이 떨어진 셈은
    /// 종료를 붙잡지 않는다.
    #[test]
    fn the_exit_waits_for_a_close_still_being_judged() {
        let list = Arc::new(InFlight::with_kernel(Void));
        drop(list.claim());
        let claim = list.claim();
        let judging = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            claim.start(&[id(77)], &[])
        });

        let began = Instant::now();
        let outcomes = list.close(&[], &[]).finish();
        let took = began.elapsed();
        drop(judging.join().expect("판정 스레드가 패닉했다"));

        assert_eq!(outcomes, vec![(id(77), Outcome::Gone)], "판정 중이던 닫기를 종료가 안 기다렸다");
        assert!(took < JUDGING_LIMIT, "판정 없이 떨어진 셈을 종료가 끝까지 기다렸다 ({took:?})");
    }

    /// **종료가 새로 맡은 대상**(티켓 11) — 목록의 끝내기가 이미 SIGTERM을 보낸 신원은 빠진다. 정리 기록에서 종료의 사건은
    /// 이것만 적는다: 목록의 것은 그 끝내기를 시작한 셸 닫기의 사건으로 적힌다. 보내려 할 때 이미 없던 신원(SIGTERM을 안
    /// 받았다)은 종료가 다시 맡는다 — 종료의 끝내기가 그것을 「이미 없음」으로 준다.
    #[test]
    fn the_exit_takes_on_only_what_no_listed_ending_has_signalled() {
        let fake = Fake::new(vec![proc(10).on_term(Fate::Ignores), proc(20)], vec![]);
        let list = Arc::new(InFlight::with_kernel(&fake));
        let running = list.claim().start(&[id(10), id(30)], &[]);
        let closing = list.close(&[id(10), id(20), id(30)], &[]);
        assert_eq!(closing.fresh(), [id(20), id(30)], "종료가 새로 맡은 대상이 어긋났다");
        drop(running);
    }
}

/// **실물 검사(macOS).** 자식은 이 테스트 바이너리 자신이고(`testkit`), 신호는 검사가 띄운 자식에게만 간다 —
/// 판정이 고른 것을 그 자식의 pid로 한 번 더 거른 뒤에 끝내기에 넘긴다. 이 기계의 표에는 구현 세션과
/// 사용자의 셸이 함께 있다.
///
/// 판정의 입력은 모두 적어 준다(앱 pid, 물려받은 키 없음, 셸 목록 없음). 검사 프로세스도 설치본 셸의
/// 표식을 물려받았지만 그 사실에 흔들리지 않게. **앱 pid는 이 검사를 띄운 쪽(부모)이다** — 자식은 이 검사가 곧바로 띄우는데,
/// 셸 목록의 키를 문 앱의 자식은 판정이 셸 자신으로 본다(`verdict::judge` — 셸은 앱이 곧바로 띄운다). 이 검사 프로세스는 셸을
/// 띄우는 쪽이 아니라 셸 밑에서 자식을 띄운 쪽의 자리다. 부모와 그 조상 사슬은 그대로 막힌다.
#[cfg(all(test, target_os = "macos"))]
mod real {
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use super::{start, InFlight, Outcome, GRACE};
    use crate::processes::snapshot::{identity_of, take, EnvScope};
    use crate::processes::testkit::{holds_for, key, Kid};
    use crate::processes::verdict::{judge, Inputs, Occasion, ShellEntry};
    use crate::processes::{Identity, ThisRun};

    /// 끝낼 셸 하나(`key`)의 자손을 판정으로 고르고, 그중 이 자식만 남긴다.
    fn judged(key: &str, kid: &Kid) -> Vec<Identity> {
        let snapshot = take(EnvScope::All);
        let ending = [ShellEntry { key: key.to_string(), process: None, first_input_us: None }];
        let verdict = judge(&Inputs {
            snapshot: &snapshot,
            run: ThisRun { generation: "test", app_pid: std::os::unix::process::parent_id(), inherited_key: None },
            shells: &[],
            ending: &ending,
            instances: &[],
            exceptions: &[],
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

    /// **유예 중인 뒤 끝내기를 종료 길이 SIGKILL까지 보내고 나서 돌아온다**(프로세스 스펙 S5). ×를 누르고 2초
    /// 안에 ⌘Q를 누른 모양이다 — SIGTERM을 무시하는 자식의 끝내기를 뒤로 보내고, 유예 중에 종료 길을 부른다.
    ///
    /// **뒤 스레드는 띄우지 않는다.** 앱이 끝나면 그 스레드는 함께 사라진다 — 종료 혼자서 SIGKILL을 보내야 한다.
    /// 띄우면 그 스레드가 같은 순간 SIGKILL을 보내 종료가 한 일을 못 가른다.
    #[test]
    fn the_exit_ends_a_background_ending_in_grace_before_it_returns() {
        let key = key(6);
        let kid = Kid::spawn("ignore-term", &key);
        let settled = kid.settle();
        let targets = judged(&key, &kid);
        let list = Arc::new(InFlight::default());
        let behind = list.claim().start(&targets, &[]);
        std::thread::sleep(Duration::from_millis(300));

        let began = Instant::now();
        let outcomes = list.close(&[], &[]).finish();
        let took = began.elapsed();
        let alive = settled.is_some_and(|id| identity_of(id.pid) == Some(id));

        // **거두는 것이 단언보다 먼저다.**
        drop(behind);
        drop(kid);

        let id = settled.expect("자식이 5초 안에 제 세션을 열지 못했다");
        assert_eq!(targets, vec![id], "판정이 표식 자식을 끝낼 셸의 자손으로 안 골랐다");
        assert_eq!(outcomes, vec![(id, Outcome::Forced)], "종료가 유예 중인 끝내기를 SIGKILL로 마감하지 않았다");
        assert!(!alive, "종료 길이 돌아왔는데 자식이 살아 있다");
        assert!(took < GRACE, "남은 유예가 아니라 2초를 새로 기다렸다 ({took:?})");
        assert!(took > Duration::from_secs(1), "유예가 남았는데 SIGKILL을 서둘렀다 ({took:?})");
    }

    /// **모두 SIGTERM에 곧 끝나면 종료 길이 2초를 채워 기다리지 않는다** — 뒤로 보낸 끝내기의 자식도, 종료가
    /// 새로 고른 자식도.
    #[test]
    fn the_exit_does_not_wait_out_the_grace_when_everything_ends_on_sigterm() {
        let (key_behind, key_fresh) = (key(7), key(8));
        let (kid_behind, kid_fresh) = (Kid::spawn("sleep", &key_behind), Kid::spawn("sleep", &key_fresh));
        let (settled_behind, settled_fresh) = (kid_behind.settle(), kid_fresh.settle());
        let behind_targets = judged(&key_behind, &kid_behind);
        let fresh_targets = judged(&key_fresh, &kid_fresh);
        let list = Arc::new(InFlight::default());
        let behind = list.claim().start(&behind_targets, &[]);

        let began = Instant::now();
        let outcomes = list.close(&fresh_targets, &[]).finish();
        let took = began.elapsed();
        let alive =
            [settled_behind, settled_fresh].into_iter().flatten().any(|id| identity_of(id.pid) == Some(id));

        // **거두는 것이 단언보다 먼저다.**
        drop(behind);
        drop(kid_behind);
        drop(kid_fresh);

        let behind_id = settled_behind.expect("뒤로 보낸 자식이 5초 안에 제 세션을 열지 못했다");
        let fresh_id = settled_fresh.expect("종료가 고를 자식이 5초 안에 제 세션을 열지 못했다");
        assert_eq!(
            outcomes,
            vec![(behind_id, Outcome::Ended), (fresh_id, Outcome::Ended)],
            "둘 다 SIGTERM으로 끝나야 한다"
        );
        assert!(!alive, "종료 길이 돌아왔는데 자식이 살아 있다");
        assert!(took < GRACE / 2, "다 끝났는데 유예를 채워 기다렸다 ({took:?})");
    }
}
