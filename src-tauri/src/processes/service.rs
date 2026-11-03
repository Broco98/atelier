//! 프로세스 서비스 — `Processes` 화면과 nav 메타가 **읽는** 값을 모으는 자리(프로세스 결정 10 · 11 · 티켓 26 · 29 · 30 · 32).
//!
//! 화면 스냅샷(화면이 열려 있는 동안 2초마다), 요약(배경 표본이 10초마다 — 화면이 닫혀 있어도), 추이, 정리 기록이 모두 여기서
//! 나온다. 모으는 순서는 판정을 부르는 다른 자리와 같다: 스냅샷을 먼저 찍고, 셸 목록을 한 잠금 안에서 읽고, 인스턴스 기록을 그
//! **뒤에** 읽는다(프로세스 스펙 S52). **아무것도 끝내지 않는다** — 끝내기의 길(셸 닫기 · 새로고침 · 셸 스스로 끝남 · 앱 종료 ·
//! 시작 정리 · 손으로 끝내기)은 셸을 쥔 `pty.rs`에 산다.
//!
//! **풀을 트레이트 뒤에서 본다**(`ShellListing`). 이 자리가 풀에게 묻는 것은 둘뿐이다 — 셸 목록(판정의 셸과 화면의 셸)과 인스턴스
//! 기록. 그래서 `processes`가 `pty`를 모르고, 검사는 셸 없는 가짜 풀로 이 자리를 돌린다. PTY 풀(`pty::PtyPool`)이 구현한다.
//!
//! **Tauri를 모른다.** 앱은 이 값을 풀과 따로 앱에 걸고(`lib.rs`의 `manage`), 읽는 명령(`commands.rs`의 `processes_snapshot` ·
//! `_summary` · `_trend` · `_cleanup_log`)이 그것을 `State`로 찾는다. 끝내는 `processes_end`는 풀을 찾는다 — 끝내기의 길은 풀에 산다.
//! 웹뷰에게 WebContent를 묻는 함수와 배경 표본의 스레드는 앱이 setup에서 건다(`ask_web_content_with` · `sample_in_background`).

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use super::apps;
use super::cleanup_log::Event;
use super::instances::Record;
use super::machine;
use super::metrics::{self, CpuMeter};
use super::screen::{self, PoolShell, ScreenSnapshot};
use super::snapshot::{self, EnvScope};
use super::summary::{self, Background, Body, Point, Summary, WebContentAnswer};
use super::verdict::{self, Inputs, Occasion, ShellEntry};
use super::{clock, webkit, Identity, ThisRun};

/// **서비스가 풀을 보는 창** — PTY 풀이 구현한다. 셸을 띄우고 닫는 일은 여기 없다: 읽기에 드는 둘만 연다.
pub trait ShellListing: Send + Sync {
    /// 풀의 셸 목록 둘 — 판정에 넘길 셸(`ShellEntry`)과 화면에 실을 풀의 셸(`PoolShell`, pty id 순 — `pool_shells`로 짓는다).
    /// **한 잠금 안에서** 읽는다: 다른 순간의 것이면 그 사이에 뜨거나 닫힌 셸이 한쪽에만 선다 — 화면이 판정의 셸을 풀에서 못 찾거나,
    /// 판정에 없는 셸을 풀 목록에서 본다(32의 화면 밖 셸이 그 차이를 셸로 센다).
    fn listing(&self) -> (Vec<ShellEntry>, Vec<PoolShell>);

    /// 이 실행의 인스턴스 기록 — 판정이 받는 셸 키 목록, 다른 실행의 기록 파일, 정리 기록이 모두 여기서 온다.
    fn record(&self) -> &Record;
}

/// **읽기의 자리.** 풀을 보고(`ShellListing`), 박자가 다른 두 읽기의 앞 표본을 따로 쥔다 — 화면 스냅샷의 CPU 미터와 배경 표본의
/// 자리(`Background`). 앱에 하나다.
pub struct ProcessService {
    pool: Arc<dyn ShellListing>,
    /// `Processes` 화면 스냅샷의 앞 표본 — 프로세스마다와 맥 전체의 CPU%를 두 표본의 차이로 짓는다(프로세스 스펙 S37 · 티켓 28 ·
    /// restart 03-5). 화면이 2초마다 부르는 `screen`만 쓴다. 박자가 다른 읽기(배경 표본 — 요약 · 추이, 티켓 30)는 제 것을 따로 쥔다
    /// (`Background`) — 한 앞 표본을 나눠 쓰면 두 박자가 섞인다.
    screen_cpu: Mutex<CpuMeter>,
    /// 배경 표본의 자리(티켓 29 · 30) — 마지막 요약(nav 메타가 10초마다 묻는다), CPU의 1시간 고리(추이 — 맥 전체 · 아틀리에), 배경의
    /// CPU 미터, 웹뷰에게 WebContent를 묻는 자리. 앱은 setup에서 묻는 함수와 표본 스레드를 건다. 안 걸면(검사의 서비스) 요약을 물을 때 그 자리에서 한
    /// 장을 모으고, 웹뷰는 모른다(「웹뷰 제외」).
    background: Background,
}

impl ProcessService {
    /// 풀 하나를 보는 서비스. 앞 표본 둘과 배경 자리는 빈 채로 선다. **코어 수를 여기서 한 번 읽는다**(`machine::cores` — 앱은 빌더
    /// 앞에서 이 서비스를 세운다, `lib.rs`) — 두 미터가 프로세스의 CPU%를 맥 전체 눈금으로 옮기는 분모다(restart 03-5).
    pub fn new(pool: Arc<impl ShellListing + 'static>) -> Self {
        let cores = machine::cores();
        ProcessService {
            pool,
            screen_cpu: Mutex::new(CpuMeter::new(metrics::STALE, cores)),
            background: Background::new(cores),
        }
    }

    /// 화면 스냅샷의 앞 표본. 잠금이 오염됐으면 안을 꺼내 이어 간다 — 잃어도 CPU 칸이 한 박자 「—」일 뿐이다.
    fn screen_cpu(&self) -> MutexGuard<'_, CpuMeter> {
        self.screen_cpu.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `Processes` 화면의 스냅샷(`processes_snapshot`, 프로세스 결정 10 · 티켓 26). 화면이 열려 있는 동안 프런트가 2초마다 묻는다 —
    /// 닫혀 있으면 아무도 안 부른다(스토리 95). 판정 결과에 풀의 셸 목록을 곁들인다(`processes::screen`).
    ///
    /// 순서는 닫기 전 물음(`pty::close_checks`)과 같다: 스냅샷을 먼저 찍고, 셸 목록과 인스턴스 기록은 그 **뒤에** 읽는다(S52). 다른
    /// 점은 둘이다.
    /// - env를 **전부** 읽는다. 셸 닫기는 그 셸이 뜬 뒤에 태어난 것만 읽지만(S3), 화면은 고아를 가려야 하고 고아는 지금 풀의
    ///   어느 셸보다 먼저 태어났을 수 있다.
    /// - 판정에 넘기는 셸 목록과 화면에 싣는 풀의 셸 목록을 **한 잠금 안에서** 읽는다(`ShellListing::listing`).
    ///
    /// **지표(메모리 · CPU · 포트)는 판정 뒤에 읽는다**(티켓 28). 무엇이 우리 트리인지는 판정이 정하므로(프로세스 스펙 S38 — 우리
    /// 트리만) 판정이 묶음에 넣은 행과 풀의 셸 프로세스만 읽는다(`screen::targets`). 풀 잠금 밖이다 — 프로세스마다 fd를 훑는 동안 셸
    /// 입력 · 닫기가 기다리지 않게. CPU%는 이 자리가 쥔 앞 표본과 견준다(`CpuMeter`).
    ///
    /// **머리 값도 이 표본에서 짓는다**(restart 03-5 「한 표본」) — 맥 전체(`machine::read`)를 프로세스의 지표 바로 뒤에 읽어 같은 미터에
    /// 넣고, 아틀리에 합계를 같은 지표로 짓는다. 그래서 앱 본체(Rust · WebContent)도 읽는다 — WebContent는 배경 표본처럼 웹뷰에게
    /// 묻는다(메인 스레드로 가는 물음이라 풀 잠금 밖이다).
    ///
    /// **다른 앱도 이 표본에서 읽는다**(restart 03-6 「합이 맞는다」) — 같은 표의 같은 uid 프로세스 중 우리 트리 밖의 것을 메모리 · CPU만
    /// 읽어(`metrics::read_usage` — fd는 안 훑는다) 같은 미터에 넣고, 앱 번들로 묶는다(`apps`). 맥 전체에서 아틀리에와 다른 앱을 뺀 것이
    /// 시스템 · 못 읽음이다(`breakdown`).
    ///
    /// 끝낼 셸은 없다 — 아무것도 안 끝낸다. 스냅샷과 판정은 기다리는 일이라 `commands.rs`가 blocking 풀에서 부른다.
    pub fn screen(&self) -> ScreenSnapshot {
        let snapshot = snapshot::take(EnvScope::All);
        let (live, listed) = self.pool.listing();
        let records = self.pool.record().records();
        let exceptions = crate::settings::process_exceptions_now();
        let verdict = verdict::judge(&Inputs {
            snapshot: &snapshot,
            run: ThisRun::current(),
            shells: &live,
            ending: &[],
            instances: &records,
            exceptions: &exceptions,
            occasion: Occasion::Normal,
        });
        let asked = self.background.web_content.identity(snapshot::identity_of);
        let shells: Vec<Identity> = listed.iter().filter_map(|shell| shell.process).collect();
        let body = Body::of(&snapshot, &verdict, &shells, snapshot::identity_of(std::process::id()), asked.id, webkit::responsible_for);
        // 우리 트리는 포트까지, 그 밖의 같은 uid 프로세스(다른 앱)는 메모리 · CPU만 읽어 한 표본에 합친다(restart 03-6).
        let ours = screen::targets(&verdict, &listed, &body);
        let theirs = apps::targets(&snapshot, &ours);
        let mut readings = metrics::read(ours.iter().copied());
        readings.absorb(metrics::read_usage(theirs.iter().map(|proc| proc.id)));
        let measured = self.screen_cpu().measure(Instant::now(), readings, machine::read());
        let apps = apps::of(&theirs, &measured);
        // 다른 인스턴스의 빌드 · 버전은 그 실행의 기록 파일에서 읽는다(티켓 31) — 판정이 받은 기록은 그 두 칸을 안 싣는다.
        let instances = screen::instances(&verdict, &records, |generation| self.pool.record().file(generation));
        ScreenSnapshot::of(&verdict, listed, &body, &measured, apps, instances)
    }

    /// **요약 한 장을 모은다**(`gather`) — 요약 IPC가 마지막 장이 없을 때 그 자리에서 부른다(`summary`). 배경 표본은 그 장을 미룰지도
    /// 함께 받아야 해 `gather`를 곧바로 부른다(`sample_once`).
    pub fn summarize(&self) -> Summary {
        self.gather().0
    }

    /// **요약 한 장을 모은다** — nav 메타의 합계, 요약 카드의 CPU와 앱 본체(프로세스 결정 10 · 티켓 29 · 30). 배경
    /// 표본이 10초마다 부른다(`sample_in_background`) — 화면이 닫혀 있어도 돈다.
    ///
    /// 순서는 화면 스냅샷(`screen`)과 같다: 스냅샷을 먼저 찍고, 판정에 넘길 셸 목록과 풀의 셸을 **한 잠금 안에서** 읽고(셸 프로세스의
    /// 신원은 풀의 셸에서 뽑는다), 인스턴스 기록은 그 **뒤에** 읽는다(S52). env는 전부 읽는다 — 출처 불명은 지금 풀의 어느 셸보다
    /// 먼저 태어났을 수 있다. 지표는 판정 뒤, 풀 잠금 밖에서 합계에 드는 것만 읽는다(`summary::targets` — 앱 본체 + 이 실행의 셸과
    /// 자손).
    ///
    /// **앱 본체는 Rust 본체와 웹뷰의 WebContent다**(S39 · 티켓 30). WebContent의 pid는 웹뷰에게 묻는다 — 메인 스레드로 가는
    /// 물음이라 풀 잠금 밖이다(`summary::WebContent`, 묻는 함수는 setup이 건다). 묻기는 셸 목록 뒤 · 인스턴스 기록 앞이다 — 기록은
    /// 셸 목록 뒤면 언제 읽어도 되고(S52), 물은 뒤 기록을 읽는 자리가 두 스레드의 차례를 고정하는 검사의 이음매다(`Meanwhile`).
    /// **CPU%는 배경 표본의 앞 표본과 견준다**
    /// (`Background`의 미터) — 화면의 앞 표본(`screen_cpu`)을 나눠 쓰면 2초와 10초 박자가 섞인다. 맥 전체(`machine::read`)도 지표 바로
    /// 뒤에 읽어 같은 미터에 넣는다 — 추이의 맥 전체 CPU다(restart 03-5).
    ///
    /// 아무것도 안 끝낸다. 한때 `●`를 켜는 정리 기록의 머리도 여기서 골랐다(restart 03-15d가 `●`와 함께 걷었다).
    ///
    /// 장과 함께 **이 장을 모은 WebContent 물음까지 웹뷰에게서 한 번도 제때 답을 못 들었나**(`WebContentAsked::unheard`)를 준다 — 배경
    /// 표본이 첫 장을 미룰지 이 값으로 가른다(`sample_once`).
    fn gather(&self) -> (Summary, bool) {
        let snapshot = snapshot::take(EnvScope::All);
        let (live, listed) = self.pool.listing();
        let shells: Vec<Identity> = listed.iter().filter_map(|shell| shell.process).collect();
        let asked = self.background.web_content.identity(snapshot::identity_of);
        let records = self.pool.record().records();
        let exceptions = crate::settings::process_exceptions_now();
        let verdict = verdict::judge(&Inputs {
            snapshot: &snapshot,
            run: ThisRun::current(),
            shells: &live,
            ending: &[],
            instances: &records,
            exceptions: &exceptions,
            occasion: Occasion::Normal,
        });
        let body = Body::of(&snapshot, &verdict, &shells, snapshot::identity_of(std::process::id()), asked.id, webkit::responsible_for);
        let readings = metrics::read(summary::targets(&verdict, &shells, &body));
        let measured = self.background.measure(Instant::now(), readings, machine::read());
        (Summary::of(&verdict, &shells, &body, &measured), asked.unheard)
    }

    /// 요약 IPC의 답(`processes_summary`) — **배경 표본의 마지막 한 장**이다(티켓 29). 아직 한 장도 없으면(앱이 막 떠 첫 표본이 도는
    /// 중 · 첫 장을 웹뷰의 답까지 미루는 중(`sample_once`), 표본 스레드를 안 건 검사의 서비스) 그 자리에서 모아 앉힌다 — 프런트는
    /// 뜨자마자 묻는다.
    ///
    /// **모으는 사이 표본이 웹뷰를 센 장을 앉혔으면 그 장을 돌려준다**(`Background::fill_in`). 이 물음이 늦어 「웹뷰 제외」로 모은 장이
    /// 그것을 덮으면 nav와 요약 카드가 다음 박자(10초)까지 웹뷰만큼 낮은 합계를 보인다 — 표본의 제외 장이 이 장을 덮는 거울 쪽은
    /// `sample_once`가 막는다.
    pub fn summary(&self) -> Summary {
        self.background.latest().unwrap_or_else(|| self.background.fill_in(self.summarize(), clock::now_ms()))
    }

    /// 추이 IPC의 답(`processes_trend`) — 배경 표본이 든 맥 전체 CPU와 아틀리에 CPU의 1시간치, 오래된 것부터(프로세스 결정 10 · 티켓 30 ·
    /// restart 03-5). 표를 찍지 않는다 — 고리를 복사할 뿐이다.
    pub fn trend(&self) -> Vec<Point> {
        self.background.trend()
    }

    /// 정리 기록 IPC의 답(`processes_cleanup_log`) — **풀의 인스턴스 기록이 연** 정리 기록을 새것부터(프로세스 스펙 S12 · 티켓 32).
    /// 파일이 최근 100건만 담으므로(`cleanup_log::KEEP`) 그것이 곧 화면의 「최근 100건」이다. 데이터 루트를 다시 계산하지 않는다 —
    /// 검사의 풀이 진짜 기록을 읽는다. 연 적 없는 기록이면 빈 기록이다. 표를 찍지 않는다. 이름이 기록의 읽기
    /// (`instances::Record::cleanup_events`)와 같다 — 이것은 서비스의 IPC 답이고 그것은 기록 한 장의 읽기다.
    pub fn cleanup_events(&self) -> Vec<Event> {
        self.pool.record().cleanup_events()
    }

    /// 웹뷰에게 WebContent의 pid를 묻는 함수를 한 번 건다(S39 · 티켓 30). 앱은 setup에서 `webview::content_pid`를 건다 — 이 층은
    /// Tauri를 모른다. 안 걸면(검사의 서비스) 요약은 「웹뷰 제외」다.
    pub fn ask_web_content_with(&self, ask: impl Fn() -> WebContentAnswer + Send + Sync + 'static) {
        self.background.web_content.ask_with(ask);
    }

    /// **배경 표본을 건다** — setup에서 한 번, 인스턴스 기록을 연 **뒤에**(티켓 29 · 프로세스 스펙 「수집 › 배경 표본」). 곧바로 한
    /// 장을 모으고 10초마다 다시 모은다(`sample_once` — 첫 장은 웹뷰의 첫 답을 잠깐 기다린다). 화면이 닫혀 있어도, 창이 가려져 있어도 돈다 — nav 메타는 늘 서 있고, 1시간 추이(티켓 30)는
    /// 그 사이를 비우면 안 된다. 앉힐 때 합계를 읽은 때(에포크 ms)를 함께 넘겨 추이의 점이 된다. 스레드가 이 서비스를 쥐어 풀도 함께
    /// 쥔다 — 앱이 사는 동안 돈다.
    ///
    /// 기록을 열기 전에 모으면 판정이 이 실행 밖의 모든 세대를 기록 없는 세대로 본다 — 함께 뜬 다른 빌드의 셸 자손이 모두 출처
    /// 불명으로 서서 그 몫이 합계에 든다. 그래서 setup의 자리가 `pty::open_record` 뒤다(`lib.rs`의 핀).
    pub fn sample_in_background(self: Arc<Self>) {
        let spawned = std::thread::Builder::new().name("atelier-summary".into()).spawn(move || {
            let mut held = 0;
            loop {
                let wait = self.sample_once(&mut held);
                std::thread::sleep(wait);
            }
        });
        // 스레드를 못 띄우면 요약은 첫 물음이 그 자리에서 모은 한 장에서 멎는다(`summary`) — nav 메타의 합계가 안 바뀐다. 조용히
        // 넘기지 않고 한 줄 남긴다.
        if let Err(e) = spawned {
            eprintln!("atelier: could not start the summary sampler: {e}");
        }
    }

    /// **배경 표본 한 번** — 한 장을 모아 앉히고 다음 박자(`summary::EVERY`)를 돌려준다. 잠은 부르는 쪽(`sample_in_background`)이 잔다.
    ///
    /// **첫 장은 웹뷰의 첫 답을 기다린다**(티켓 30 · S39 — `summary::holds_first`). 앱에서 첫 표본은 setup이 메인 스레드를 쥔 동안
    /// 돌아 WebContent 물음이 늦고, 아직 아는 신원이 없어 「웹뷰 제외」 장이 선다 — 요약 IPC가 그 장을 다음 박자까지 돌려준다. 그래서
    /// 묻는 함수는 걸렸는데 한 번도 제때 답을 못 받았으면 그 장을 앉히지 않고, 미룬 수(`held`)를 올려 짧게(`FIRST_RETRY_AFTER`) 쉬게
    /// 한다. 상한 뒤에는 그대로 앉힌다. 미루는 동안 요약 IPC는 마지막 장이 없어 그 자리에서 모은다(`summary`) — 그때는 setup이 끝나
    /// 메인 스레드가 답한다.
    ///
    /// **미룰지는 이 장을 모은 물음이 가른다**(`gather`가 함께 주는 값). 다 모은 뒤에 물음의 자리를 다시 보면, 이 장의 물음이 늦은 사이
    /// 요약 IPC의 물음이 답을 받아 제 장을 앉혔을 때 이 장을 「들었다」로 읽어 앉힌다 — 「웹뷰 제외」 장이 IPC의 장을 덮는다.
    fn sample_once(&self, held: &mut u32) -> Duration {
        let (fresh, unheard) = self.gather();
        if summary::holds_first(unheard, *held) {
            *held += 1;
            return summary::FIRST_RETRY_AFTER;
        }
        self.background.keep(fresh, clock::now_ms());
        summary::EVERY
    }
}

/// 풀의 셸 목록 — pty id · 셸 키 · 마지막 출력 시각 · 셸 프로세스의 신원을 **pty id 순**으로. 풀이 해시 맵이라 그대로 두면 부를
/// 때마다 순서가 흔들린다. 지표는 비워 둔다 — 판정 뒤에 읽어 `ScreenSnapshot::of`가 채운다. 풀이 `ShellListing::listing`에서 잠금
/// 안에 부른다.
pub fn pool_shells<'a>(shells: impl Iterator<Item = (u32, &'a str, u64, Option<Identity>)>) -> Vec<PoolShell> {
    let mut listed: Vec<PoolShell> = shells
        .map(|(pty_id, key, last_output_ms, process)| PoolShell {
            pty_id,
            shell_key: key.to_string(),
            last_output_ms,
            process,
            metrics: Default::default(),
        })
        .collect();
    listed.sort_by_key(|shell| shell.pty_id);
    listed
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use super::*;
    use crate::processes::machine::Machine;
    use crate::processes::summary::Totals;

    /// 셸 없는 풀 — 판정의 셸도 화면의 셸도 없고, 기록만 쥔다. 연 적 없는 기록은 아무 파일도 안 쓴다.
    #[derive(Default)]
    struct NoShells {
        record: Record,
    }

    impl ShellListing for NoShells {
        fn listing(&self) -> (Vec<ShellEntry>, Vec<PoolShell>) {
            (Vec::new(), Vec::new())
        }

        fn record(&self) -> &Record {
            &self.record
        }
    }

    fn service() -> ProcessService {
        ProcessService::new(Arc::new(NoShells::default()))
    }

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atelier-service-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// 이 파일에서 서비스 메서드 하나의 본문 — 닫는 표식은 `impl` 안 메서드의 들여쓰기(`\n    }\n`)다. 가드는 한 자리에 산다
    /// (`crate::tests::body_of`). 판정을 부르는 여섯 자리의 표는 `pty.rs`의 `verdict_sites`가 이 파일의 둘까지 함께 든다.
    fn method_body(start: &str) -> &'static str {
        crate::tests::body_of(include_str!("service.rs"), start, "\n    }\n")
    }

    /// `Processes` 화면의 스냅샷은 **풀의 셸 목록을 판정에 넘긴 셸 목록과 한 번에** 받는다(티켓 26) — 풀이 두 목록을 한 잠금 안에서
    /// 읽고(`pty.rs`의 `the_pool_lists_its_shells_for_the_verdict_and_the_screen_under_one_lock`), 여기서는 그것을 한 번만 부른다. 두 번
    /// 부르면 두 목록이 다른 순간의 것이 된다 — 그 사이에 뜨거나 닫힌 셸이 한쪽에만 선다. env는 **전부** 읽는다: 고아는 지금 풀의
    /// 어느 셸보다 먼저 태어났을 수 있어 셸 닫기의 가지치기(`env_scope`, S3)를 쓰면 표식이 안 읽혀 묶음에서 빠진다.
    ///
    /// 실행으로는 못 잰다 — 진짜 스냅샷은 이 맥의 표 전체라 기대값을 못 세운다. 자리로 잰다. 판정 결과가 와이어에 실리는 모양은
    /// `processes::screen`의 검사가 잰다.
    #[test]
    fn the_screen_reads_the_pool_with_the_shells_it_judges() {
        let body = method_body("pub fn screen(");
        assert_eq!(body.matches("snapshot::take(").count(), 1, "화면 스냅샷이 표를 한 장이 아니게 찍는다");
        assert!(body.contains("snapshot::take(EnvScope::All)"), "화면 스냅샷이 env를 가지치기한다 — 오래된 고아의 표식이 안 읽힌다");
        let taken = body.find("snapshot::take(").expect("스냅샷을 찍는다");
        assert_eq!(body.matches(".listing()").count(), 1, "풀의 셸 목록을 두 번 읽는다 — 두 목록이 다른 순간의 것이 된다");
        let listed = body.find("let (live, listed) = self.pool.listing();").expect("판정의 셸과 풀의 셸을 한 번에 받는다");
        let records = body.find("self.pool.record().records()").expect("기록을 읽는다");
        assert!(taken < listed, "풀({listed})을 스냅샷({taken})보다 먼저 읽는다");
        assert!(listed < records, "기록({records})을 셸 목록({listed})보다 먼저 읽는다");
        assert!(body.contains("shells: &live,"), "판정에 풀이 준 셸 목록을 안 넘긴다");
        assert!(
            body.contains("ScreenSnapshot::of(&verdict, listed, &body, &measured, apps, instances)"),
            "판정 결과와 풀의 셸 목록과 앱 본체와 지표와 다른 앱과 다른 인스턴스의 실행들을 그대로 싣지 않는다"
        );
        assert!(
            body.contains("screen::instances(&verdict, &records,"),
            "다른 인스턴스를 판정이 받은 그 기록으로 실행마다 안 묶는다 — 판정과 화면이 다른 순간의 기록을 본다"
        );
    }

    /// **지표는 판정 뒤에, 판정이 고른 것만, 풀 잠금 밖에서 읽는다**(티켓 28 · 프로세스 스펙 S38). 무엇이 우리 트리인지는 판정이
    /// 정하므로 판정보다 앞설 수 없고, 읽을 신원은 판정의 결과와 풀의 셸에서만 고른다(`screen::targets` — 이 맥의 다른 프로세스의 fd를
    /// 훑지 않는다). 프로세스마다 fd를 훑는 일이라 풀을 쥔 채 하면 그동안 셸 입력 · 크기 바꾸기 · 닫기가 기다린다 — 풀 잠금은 목록을
    /// 받으며 풀렸다(`listing`).
    ///
    /// CPU%는 이 자리가 쥔 앞 표본과 견준다(`CpuMeter`) — 부를 때마다 새로 세우면 늘 첫 표본이라 CPU 칸이 영영 「—」다. 실행으로는
    /// 장면 `Ask`가 잰다(macOS — 한 서비스로 두 번 찍으면 둘째에 셸의 CPU%가 선다).
    ///
    /// **머리 값도 같은 표본이다**(restart 03-5) — 맥 전체를 지표와 같은 미터 물음 하나에 넣고(`measure(…, machine::read())`), 앱 본체는
    /// 지표를 읽기 전에 서야 아틀리에 합계에 든다. 웹뷰에게 WebContent를 묻는 것은 풀 잠금 밖이다(메인 스레드로 가는 물음).
    ///
    /// **다른 앱도 같은 표본이다**(restart 03-6) — 우리 트리 밖의 같은 uid 프로세스(`apps::targets`)를 메모리 · CPU만 읽어(`read_usage` —
    /// 포트 없음) 우리 트리의 읽기에 합치고, 같은 미터 물음에 넣는다. 그래야 줄을 더한 것과 맥 전체가 같은 두 순간 사이의 값이다. 다른 앱의
    /// 줄은 그 표본에서 묶는다.
    #[test]
    fn the_screen_measures_what_the_verdict_picked_outside_the_pool_lock() {
        let body = method_body("pub fn screen(");
        let judged = body.find("verdict::judge(").expect("판정한다");
        let ours = body.find("let ours = screen::targets(&verdict, &listed, &body);").expect("판정이 고른 것과 앱 본체가 우리 트리다");
        let read = body.find("metrics::read(ours.iter().copied())").expect("우리 트리만 포트까지 읽는다");
        let listed = body.find("self.pool.listing()").expect("풀의 셸 목록을 받는다");
        assert!(listed < ours && judged < ours, "우리 트리를 판정({judged})이나 풀의 셸 목록({listed}) 전에 가른다 — {ours}");
        assert_eq!(body.matches("metrics::read(").count(), 1, "지표를 두 번 읽는다");
        let asked = body.find("self.background.web_content.identity(").expect("앱 본체에 WebContent를 묻는다");
        assert!(listed < asked && asked < ours, "WebContent를 셸 목록({listed}) 앞이나 우리 트리를 가른 뒤({ours})에 묻는다 — {asked}");
        let helpers = body.find("asked.id, webkit::responsible_for);").expect("앱 본체에 앱이 책임지는 WebKit 도우미를 찾아 더한다");
        assert!(asked < helpers && helpers < ours, "WebKit 도우미를 WebContent 앞({asked})이나 우리 트리를 가른 뒤({ours})에 찾는다 — {helpers}");
        let theirs = body.find("apps::targets(&snapshot, &ours)").expect("다른 앱은 같은 표의 우리 트리 밖이다");
        let usage = body
            .find("readings.absorb(metrics::read_usage(theirs.iter().map(|proc| proc.id)));")
            .expect("다른 앱은 메모리 · CPU만 읽어 같은 표본에 합친다");
        assert_eq!(body.matches("metrics::read_usage(").count(), 1, "다른 앱을 두 번 읽는다");
        let sampled = body.find("self.screen_cpu().measure(Instant::now(), readings, machine::read())").expect(
            "이 자리가 쥔 앞 표본과 견주고, 맥 전체를 같은 표본으로 넣는다",
        );
        assert!(read < sampled && theirs < usage && usage < sampled, "읽기({read} · {usage}) 전에 CPU% 표본을 넣는다({sampled})");
        let grouped = body.find("let apps = apps::of(&theirs, &measured);").expect("다른 앱의 줄을 같은 표본에서 묶는다");
        assert!(sampled < grouped, "표본({sampled}) 전에 다른 앱을 묶는다({grouped})");
        assert_eq!(body.matches("machine::read(").count(), 1, "맥 전체를 두 번 읽는다 — 머리와 줄이 다른 표본이 된다");
        assert!(!body.contains("CpuMeter::"), "부를 때마다 앞 표본을 새로 세운다 — CPU%가 늘 첫 표본이다");
    }

    /// **배경 표본은 화면 스냅샷과 같은 순서로 모은다**(티켓 29 · 프로세스 스펙 S52 · S38). 표를 한 장 찍고(env 전부 — 출처 불명은
    /// 지금 풀의 어느 셸보다 먼저 태어났을 수 있다), 판정의 셸 목록과 풀의 셸(셸 프로세스의 신원)을 한 번에 받는다. 지표는 판정 뒤,
    /// 잠금 밖에서 **합계에 드는 것만** 읽는다(`summary::targets` — 앱 본체와 이 실행의 셸 · 자손).
    ///
    /// **웹뷰에게 WebContent를 묻는 것도 잠금 밖이다**(티켓 30) — 메인 스레드로 가는 물음이라 답을 기다리는 동안 풀을 쥐면 셸 입력 ·
    /// 닫기가 함께 기다린다. 앱 본체의 신원은 지표를 읽기 전에 서야 합계에 든다. **CPU%는 배경의 미터와 견준다** — 읽은 뒤에, 화면의
    /// 앞 표본이 아니라.
    ///
    /// 실행으로는 못 잰다 — 진짜 스냅샷은 이 맥의 표 전체라 기대값을 못 세운다. 값의 모양은 `processes::summary`의 검사가 잰다.
    #[test]
    fn the_background_sample_reads_like_the_screen_and_measures_only_the_total() {
        let body = method_body("fn gather(");
        assert!(body.contains("snapshot::take(EnvScope::All)"), "배경 표본이 env를 가지치기한다 — 오래된 출처 불명의 표식이 안 읽힌다");
        assert_eq!(body.matches(".listing()").count(), 1, "풀의 셸 목록을 두 번 읽는다 — 판정의 셸과 셸 프로세스가 다른 순간의 것이 된다");
        let listed = body.find("let (live, listed) = self.pool.listing();").expect("판정의 셸과 풀의 셸을 한 번에 받는다");
        assert!(
            body.contains("listed.iter().filter_map(|shell| shell.process)"),
            "합계에 드는 셸 프로세스를 판정의 셸과 같은 목록에서 안 뽑는다"
        );
        let judged = body.find("verdict::judge(").expect("판정한다");
        let read = body.find("metrics::read(summary::targets(&verdict, &shells, &body))").expect("합계에 드는 것만 지표를 읽는다");
        let records = body.find("self.pool.record().records()").expect("기록을 읽는다");
        assert!(listed < records, "기록({records})을 셸 목록({listed})보다 먼저 읽는다");
        assert!(records < read && judged < read, "지표를 판정({judged})이나 기록({records}) 전에 읽는다 — {read}");
        assert_eq!(body.matches("metrics::read(").count(), 1, "지표를 두 번 읽는다");
        let asked = body.find("self.background.web_content.identity(").expect("앱 본체에 WebContent를 묻는다");
        assert!(listed < asked && asked < read, "WebContent를 셸 목록({listed}) 앞이나 지표를 읽은 뒤({read})에 묻는다 — {asked}");
        // 물은 뒤에 기록을 읽는다 — 늦은 물음의 두 검사(`Meanwhile`)가 이 자리에서 다른 스레드의 차례를 끼운다. 순서가 바뀌면 그 둘이
        // 「이 검사가 재는 차례가 없다」로 빨개진다.
        assert!(asked < records, "WebContent를 기록({records})을 읽은 뒤에 묻는다 — {asked}");
        let helpers = body.find("asked.id, webkit::responsible_for);").expect("앱 본체에 앱이 책임지는 WebKit 도우미를 찾아 더한다");
        assert!(asked < helpers && helpers < read, "WebKit 도우미를 WebContent 앞({asked})이나 지표를 읽은 뒤({read})에 찾는다 — {helpers}");
        let sampled = body.find("self.background.measure(Instant::now(), readings, machine::read())").expect(
            "배경의 미터로 CPU%를 짓고, 맥 전체를 같은 표본으로 넣는다",
        );
        assert!(read < sampled, "읽기({read}) 전에 CPU% 표본을 넣는다({sampled})");
        assert!(!body.contains("screen_cpu"), "배경 표본이 화면의 앞 표본을 나눠 쓴다 — 두 박자가 섞인다");
        assert!(!body.contains("CpuMeter::"), "부를 때마다 앞 표본을 새로 세운다 — 요약의 CPU가 늘 첫 표본이다");
    }

    /// **요약 IPC는 배경 표본의 마지막 장을 돌려준다**(티켓 29) — 부를 때마다 표를 찍지 않는다. 아직 한 장도 없으면 그 자리에서
    /// 모아 앉힌다(앱이 막 떠 첫 표본이 도는 중에 프런트가 묻는다).
    ///
    /// 둘째 갈래는 이 맥의 표를 한 장 찍는다(읽기만 한다 — 아무것도 안 끝낸다).
    #[test]
    fn the_summary_answers_the_last_background_sample() {
        let kept_service = service();
        let kept = Summary {
            atelier: Totals { total: Some(1), cpu: None, app: Some(1), webview_excluded: true },
            mac: None,
        };
        kept_service.background.keep(kept.clone(), 5_000);
        assert_eq!(kept_service.summary(), kept, "배경 표본이 앉힌 장을 안 돌려준다");

        let fresh = service();
        let first = fresh.summary();
        assert_eq!(fresh.background.latest(), Some(first), "그 자리에서 모은 장을 안 앉혔다");
    }

    /// **화면 스냅샷 한 장이 머리 값을 제 표본에서 싣는다**(restart 03-5 「한 표본」 · 스토리 122 · 129). 잰 시각은 찍은 그 순간이다.
    /// macOS에서는 맥 전체가 서고 — 첫 장은 CPU가 없고(두 번 재야 안다) 그 뒤 장에서 0~100이다. 메모리와 코어 수는 첫 장부터 선다.
    /// 아틀리에 합계도 같은 장의 지표로 선다: 셸 없는 풀이라 합계가 곧 앱 본체(이 검사 프로세스)다. macOS 밖은 맥 전체가 없다(「측정
    /// 안 됨」) — 화면 스냅샷은 그래도 선다.
    ///
    /// 커널은 CPU tick을 몰아서 더해(`machine`의 실물 검사) 짧게 잇달아 찍으면 tick이 안 흘러 맥 전체 CPU가 없을 수 있다 — CPU가 설
    /// 때까지 0.2초마다 다시 찍는다(3초).
    ///
    /// 이 맥의 표를 여러 번 찍고 판정한다(읽기만 한다 — 아무것도 안 끝낸다).
    #[test]
    fn the_screen_carries_the_mac_and_the_atelier_from_its_own_sample() {
        let service = service();
        let before = clock::now_ms();
        let first = service.screen();
        let mut second = service.screen();
        for _ in 0..15 {
            if second.mac.is_none_or(|mac| mac.cpu.is_some()) {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
            second = service.screen();
        }
        let after = clock::now_ms();

        assert!(
            before <= first.measured_at && first.measured_at <= second.measured_at && second.measured_at <= after,
            "잰 시각이 찍은 순간이 아니다 — {before} ≤ {} ≤ {} ≤ {after}",
            first.measured_at,
            second.measured_at
        );
        if cfg!(target_os = "macos") {
            let opened = first.mac.expect("맥 전체를 못 읽었다");
            assert_eq!(opened.cpu, None, "첫 장에 맥 전체 CPU가 섰다 — 두 번 재야 안다");
            assert!(opened.memory.is_some_and(|memory| memory > 0), "첫 장에 맥 전체 메모리가 없다");
            let mac = second.mac.expect("맥 전체를 못 읽었다");
            assert!(mac.cpu.is_some_and(|cpu| (0.0..=100.0).contains(&cpu)), "둘째 장의 맥 전체 CPU가 0~100이 아니다 — {:?}", mac.cpu);
            assert_eq!(mac.cores, machine::cores(), "코어 수가 앱이 읽은 수가 아니다");
            assert!(second.atelier.total.is_some(), "아틀리에 합계를 같은 장에서 못 지었다 — 앱 본체를 안 읽었다");
            // 셸 없는 풀이라 합계는 앱 본체 + 판정이 묶음에 넣은 행이다(restart 03-6 — 이 맥에 떠 있는 다른 아틀리에의 셸 자손은 이 검사의
            // 빈 기록에게 출처 불명으로 선다). 같은 장의 줄에서 더한 것과 같다.
            let v = &second.verdict;
            let rows = v
                .descendants
                .values()
                .chain(v.orphans.confirmed.values())
                .chain(v.orphans.unknown.values())
                .chain(v.other_instances.values())
                .flatten()
                .chain(v.exceptions.iter());
            let shown = second.atelier.app.unwrap_or(0) + rows.filter_map(|row| row.metrics.memory).sum::<u64>();
            assert_eq!(second.atelier.total, Some(shown), "셸 없는 풀의 아틀리에 합계가 앱 본체 + 판정의 줄이 아니다");
        } else {
            assert_eq!(second.mac, None, "macOS 밖에서 맥 전체가 섰다");
        }
    }

    /// **화면 스냅샷의 줄을 더하면 합계다**(restart 03-6 · 스펙 「합이 맞는다」 · 티켓 AC). 이 맥에서 찍은 장의 아틀리에 · 다른 앱 · 시스템
    /// · 못 읽음을 반올림 전 값으로 더하면 합계다. 읽은 합이 안 넘은 칸의 합계는 맥 전체 측정값이고, 넘은 칸은 시스템 · 못 읽음이 0이고 합계가
    /// 측정값보다 크다. 다른 앱은 이 맥의 같은 uid 프로세스라 줄이 선다(이 검사를 띄운 것들). macOS 밖은 맥 전체를 몰라 시스템 · 못 읽음과
    /// 합계가 없다.
    ///
    /// 맥 전체 CPU가 설 때까지 0.2초마다 다시 찍는다(3초 — 커널이 tick을 몰아서 더한다). 이 맥의 표를 찍고 읽기만 한다.
    #[test]
    fn the_screen_rows_add_up_to_its_total() {
        let service = service();
        let mut sheet = service.screen();
        for _ in 0..15 {
            if sheet.mac.is_none_or(|mac| mac.cpu.is_some()) {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
            sheet = service.screen();
        }
        let split = &sheet.breakdown;
        let Some(mac) = sheet.mac else {
            assert_eq!((split.system, split.total), Default::default(), "macOS 밖에서 시스템 · 못 읽음이나 합계가 섰다");
            return;
        };
        assert!(!split.apps.is_empty(), "다른 앱이 하나도 안 섰다 — 이 맥의 같은 uid 프로세스를 안 읽었다");

        let measured_cpu = mac.cpu.expect("3초 동안 맥 전체 CPU가 안 섰다");
        let total_cpu = split.total.cpu.expect("합계 CPU가 없다");
        let rows_cpu = sheet.atelier.cpu.unwrap_or(0.0)
            + split.apps.iter().filter_map(|app| app.cpu).sum::<f64>()
            + split.system.cpu.expect("시스템 · 못 읽음 CPU가 없다");
        assert!((rows_cpu - total_cpu).abs() < 1e-9, "줄의 CPU({rows_cpu})를 더한 것이 합계({total_cpu})가 아니다");
        if split.over.cpu {
            assert_eq!(split.system.cpu, Some(0.0), "넘은 표본의 시스템 · 못 읽음이 0이 아니다");
            assert!(total_cpu > measured_cpu, "넘었다는데 합계({total_cpu})가 측정값({measured_cpu})보다 크지 않다");
        } else {
            assert!((total_cpu - measured_cpu).abs() < 1e-9, "합계({total_cpu})가 맥 전체({measured_cpu})가 아니다");
        }

        let measured_memory = mac.memory.expect("맥 전체 메모리가 없다");
        let total_memory = split.total.memory.expect("합계 메모리가 없다");
        let rows_memory = sheet.atelier.total.unwrap_or(0)
            + split.apps.iter().map(|app| app.memory).sum::<u64>()
            + split.system.memory.expect("시스템 · 못 읽음 메모리가 없다");
        assert_eq!(rows_memory, total_memory, "줄의 메모리를 더한 것이 합계가 아니다");
        if split.over.memory {
            assert_eq!(split.system.memory, Some(0));
            assert!(total_memory > measured_memory);
        } else {
            assert_eq!(total_memory, measured_memory, "합계 메모리가 맥 전체가 아니다");
        }
    }

    /// **채팅의 Runtime이 화면의 「채팅」에 선다**(restart 03-7 · 스토리 126). 엔진이 띄운 Runtime처럼 이 검사(앱)의 자식 하나를 이 실행의
    /// Runtime 키를 물려 띄운다 — 제 세션을 연다(엔진의 `in_new_session`과 같다). 화면 스냅샷이 그 채팅 id 밑에 그 행을 세우고, Runtime 몫에
    /// 넣고, 우리 트리로 읽어(메모리) 아틀리에 합계에 넣는다. 그 자식이 「다른 앱」이면 이 셋이 모두 빈다.
    ///
    /// 자손 따라가기(부모가 먼저 죽은 것 · Codex의 트리)는 판정 표가 잰다(`verdict`의 `each_chat_gets_its_runtime_and_what_it_spawned`) —
    /// 여기는 수집 → 판정 → 와이어를 실물로 잇는 자리다. 신호는 이 검사가 띄운 자식에게만 간다(`Kid`의 거두기).
    #[cfg(target_os = "macos")]
    #[test]
    fn a_chats_runtime_stands_in_the_screens_chats() {
        use crate::processes::runtime_key;
        use crate::processes::testkit::Kid;

        let runtime = Kid::in_chat("sleep", &runtime_key::mint("20261010-100000"));
        let id = runtime.settle().expect("Runtime 자리의 자식이 자리를 잡는다");
        let sheet = service().screen();
        drop(runtime);

        let chat = sheet.verdict.chats.get("20261010-100000").expect("화면의 「채팅」에 그 채팅이 없다");
        let row = chat.iter().find(|row| row.id == id).expect("그 채팅에 Runtime이 없다");
        assert!(sheet.verdict.runtimes.contains(&id), "앱이 띄운 Runtime이 Runtime 몫이 아니다");
        assert!(row.metrics.memory.is_some(), "Runtime을 우리 트리로 안 읽었다 — 「다른 앱」으로 갔다");
        assert!(
            sheet.atelier.total.zip(row.metrics.memory).is_some_and(|(total, memory)| total >= memory),
            "Runtime이 아틀리에 합계에 안 들었다"
        );
    }

    /// 웹뷰의 답을 차례로 주는 가짜 물음 — 차례가 다 떨어지면 「늦음」이다(메인 스레드가 끝내 안 답한다).
    fn scripted(answers: &[WebContentAnswer]) -> impl Fn() -> WebContentAnswer + Send + Sync + 'static {
        let queue = Mutex::new(answers.iter().copied().collect::<std::collections::VecDeque<_>>());
        move || queue.lock().unwrap().pop_front().unwrap_or(WebContentAnswer::Late)
    }

    /// **배경 표본의 첫 장은 웹뷰의 첫 답을 기다린다**(티켓 30 · 프로세스 스펙 S39). 앱에서 첫 표본은 setup이 메인 스레드를 쥔 동안
    /// 돌아 WebContent 물음이 늦고(「늦음」), 아직 아는 신원이 없어 「웹뷰 제외」 장이 선다 — 요약 IPC가 그 장을 다음 박자(10초)까지
    /// 돌려주고, 추이의 첫 점이 웹뷰만큼 낮다. 그래서 **묻는 함수는 걸렸는데 한 번도 제때 답을 못 받았으면** 그 장을 앉히지 않고 짧게
    /// 쉬어 다시 모은다. 상한(`FIRST_RETRIES`) 뒤에는 그대로 앉힌다 — 웹뷰가 끝내 답을 안 하는 기계에서 요약이 비지 않게. 묻는 함수가
    /// 없거나(검사의 서비스) 한 번이라도 답했으면(macOS 밖은 늘 「없음」으로 답한다) 곧바로 앉힌다.
    ///
    /// 미루는 동안 요약 IPC는 마지막 장이 없어 그 자리에서 모은다(`summary`) — 그때는 setup이 끝나 메인 스레드가 답한다.
    ///
    /// 표본마다 이 맥의 표를 한 장 찍는다(읽기만 한다 — 아무것도 안 끝낸다). 잠은 없다 — 쉴 때는 돌려받기만 한다.
    #[test]
    fn the_first_background_sample_waits_for_the_webviews_first_answer() {
        let unasked = service();
        assert_eq!(unasked.sample_once(&mut 0), summary::EVERY, "묻는 함수가 없는데 첫 장을 미뤘다");
        assert!(unasked.background.latest().is_some(), "묻는 함수가 없는데 첫 장을 안 앉혔다");

        let late_then_answered = service();
        late_then_answered.ask_web_content_with(scripted(&[
            WebContentAnswer::Late,
            WebContentAnswer::Late,
            WebContentAnswer::Answered(None),
        ]));
        let mut held = 0;
        for n in 1..=2 {
            assert_eq!(late_then_answered.sample_once(&mut held), summary::FIRST_RETRY_AFTER, "{n}째 늦은 답에 곧 다시 모으지 않는다");
            assert_eq!(late_then_answered.background.latest(), None, "{n}째 늦은 답의 장을 앉혔다 — 「웹뷰 제외」가 먼저 선다");
        }
        assert_eq!(late_then_answered.sample_once(&mut held), summary::EVERY, "웹뷰가 답했는데 또 미뤘다");
        assert!(late_then_answered.background.latest().is_some(), "웹뷰가 답한 장을 안 앉혔다");
        assert_eq!(held, 2);

        let never = service();
        never.ask_web_content_with(scripted(&[]));
        let mut held = 0;
        for _ in 0..summary::FIRST_RETRIES {
            assert_eq!(never.sample_once(&mut held), summary::FIRST_RETRY_AFTER);
        }
        assert_eq!(never.background.latest(), None, "상한 전에 앉혔다");
        assert_eq!(never.sample_once(&mut held), summary::EVERY, "상한 뒤에도 미룬다 — 웹뷰가 끝내 답을 안 하면 요약이 빈다");
        assert!(never.background.latest().is_some_and(|kept| kept.atelier.webview_excluded), "상한 뒤에 「웹뷰 제외」 장을 안 앉혔다");
        assert_eq!(never.sample_once(&mut held), summary::EVERY, "한 번 앉힌 뒤에 다시 미뤘다");

        // 미루는 동안의 요약 IPC — 그 자리에서 모은 장을 돌려주고 앉힌다. 그 장이 웹뷰의 첫 답을 받았으니 다음 표본은 곧바로 앉는다.
        let asked_meanwhile = service();
        asked_meanwhile.ask_web_content_with(scripted(&[WebContentAnswer::Late, WebContentAnswer::Answered(None)]));
        let mut held = 0;
        assert_eq!(asked_meanwhile.sample_once(&mut held), summary::FIRST_RETRY_AFTER);
        let answered = asked_meanwhile.summary();
        assert_eq!(asked_meanwhile.background.latest(), Some(answered), "미루는 동안 요약 IPC가 그 자리에서 모은 장을 안 앉혔다");
        assert_eq!(asked_meanwhile.sample_once(&mut held), summary::EVERY, "요약 IPC가 웹뷰의 답을 받았는데 또 미뤘다");
    }

    /// 서비스가 WebContent를 물은 **뒤**, 그 모으기가 풀을 다시 볼 때(인스턴스 기록 — `gather`) 다른 스레드의 일 하나(`then`)를 그 자리에서 돌리는 풀 — 두
    /// 스레드의 차례(먼저 모으기 시작한 쪽의 물음이 끝난 뒤, 그쪽이 장을 가르거나 앉히기 전에 다른 쪽이 돈다)를 한 스레드에서 고정한다.
    /// 그 일도 다시 이 풀을 보지만 한 번만 돈다.
    struct Meanwhile {
        record: Record,
        service: std::sync::OnceLock<std::sync::Weak<ProcessService>>,
        /// 웹뷰에게 한 번이라도 물었나 — 묻는 함수가 세운다.
        asked: Arc<std::sync::atomic::AtomicBool>,
        ran: std::sync::atomic::AtomicBool,
        then: Box<dyn Fn(&ProcessService) + Send + Sync>,
    }

    impl ShellListing for Meanwhile {
        fn listing(&self) -> (Vec<ShellEntry>, Vec<PoolShell>) {
            (Vec::new(), Vec::new())
        }

        fn record(&self) -> &Record {
            use std::sync::atomic::Ordering;
            if self.asked.load(Ordering::SeqCst) && !self.ran.swap(true, Ordering::SeqCst) {
                let service = self.service.get().and_then(std::sync::Weak::upgrade).expect("서비스가 아직 산다");
                (self.then)(&service);
            }
            &self.record
        }
    }

    /// `Meanwhile` 풀을 보는 서비스 — 웹뷰는 `answers`를 차례로 답한다(`scripted`).
    fn meanwhile(answers: &[WebContentAnswer], then: impl Fn(&ProcessService) + Send + Sync + 'static) -> Arc<ProcessService> {
        use std::sync::atomic::{AtomicBool, Ordering};

        let asked = Arc::new(AtomicBool::new(false));
        let pool = Arc::new(Meanwhile {
            record: Record::default(),
            service: std::sync::OnceLock::new(),
            asked: Arc::clone(&asked),
            ran: AtomicBool::new(false),
            then: Box::new(then),
        });
        let service = Arc::new(ProcessService::new(Arc::clone(&pool)));
        assert!(pool.service.set(Arc::downgrade(&service)).is_ok(), "한 번만 건다");
        let answers = scripted(answers);
        service.ask_web_content_with(move || {
            asked.store(true, Ordering::SeqCst);
            answers()
        });
        service
    }

    /// **첫 장을 미룰지는 그 장을 모은 물음이 가른다**(티켓 30 · S39). 표본의 물음이 늦어 그 장이 「웹뷰 제외」인데, 표본이 가르기 전에
    /// 요약 IPC(다른 스레드)의 물음이 답을 받아 제 장을 앉혔다 — 그 뒤에 자리의 지금 값(「들었다」)으로 가르면 표본이 제 제외 장을
    /// 앉혀 IPC의 장을 덮는다. nav와 요약 카드가 다음 박자(10초)까지 그 장을 보인다. 이 장은 이 장의 물음으로 가른다: 미루고, IPC의
    /// 장이 남는다. 다음 표본은 들은 답이 있어 곧바로 앉는다(앵커). 거울 쪽(IPC의 제외 장이 표본의 장을 덮는 것)은
    /// `a_summary_asked_too_late_does_not_cover_the_sample_that_counted_the_webview`가 잰다.
    ///
    /// 표본마다 이 맥의 표를 한 장 찍는다(읽기만 한다 — 아무것도 안 끝낸다).
    #[test]
    fn a_sample_asked_too_late_is_held_even_if_the_summary_ipc_heard_meanwhile() {
        let answered = Arc::new(Mutex::new(None));
        let seen = Arc::clone(&answered);
        let service = meanwhile(&[WebContentAnswer::Late, WebContentAnswer::Answered(None)], move |service| {
            *seen.lock().unwrap() = Some(service.summary());
        });

        let mut held = 0;
        let wait = service.sample_once(&mut held);
        let answered = answered.lock().unwrap().clone();
        assert!(answered.is_some(), "표본이 모으는 사이 요약 IPC가 안 돌았다 — 이 검사가 재는 차례가 없다");
        assert_eq!(
            wait,
            summary::FIRST_RETRY_AFTER,
            "표본의 물음은 늦었는데 그사이 IPC가 들은 답을 이 장의 것으로 읽고 「웹뷰 제외」 장을 앉혔다"
        );
        assert_eq!(service.background.latest(), answered, "표본이 IPC가 앉힌 장을 덮었다");
        assert_eq!(service.sample_once(&mut held), summary::EVERY, "들은 답이 있는데 다음 표본도 미뤘다");
    }

    /// **요약 IPC가 제 물음이 늦어 모은 「웹뷰 제외」 장은, 그사이 배경 표본이 앉힌 웹뷰를 센 장을 덮지 않는다**(티켓 30 · S39) — 위
    /// `a_sample_asked_too_late_is_held_even_if_the_summary_ipc_heard_meanwhile`의 거울이다. 앱이 막 떠 마지막 장이 없을 때 요약 IPC가
    /// 그 자리에서 모으는데, 그 물음이 늦어(아직 들은 답이 없다) 그 장은 「웹뷰 제외」다. 그사이 표본의 물음이 답을 받아 웹뷰를 센 장을
    /// 앉혔다 — IPC가 제 장을 그대로 앉히면 nav와 요약 카드가 다음 박자(10초)까지 웹뷰만큼 낮은 합계를 보인다. IPC는 표본의 장을
    /// 돌려주고 그 장이 남는다(`Background::fill_in`). 추이는 이 차례에서도 안 흔들린다 — 웹뷰를 센 점 뒤의 제외 점은 원래 안 든다
    /// (`Trend::add`).
    ///
    /// 검사가 띄운 자식 하나를 WebContent 자리에 세운다(`the_app_body_counts_the_web_content_the_webview_names`와 같다). 신호는 이
    /// 검사가 띄운 자식에게만 간다(`Kid`의 거두기).
    #[cfg(target_os = "macos")]
    #[test]
    fn a_summary_asked_too_late_does_not_cover_the_sample_that_counted_the_webview() {
        use crate::processes::testkit::{key, Kid};

        let stand_in = Kid::spawn("sleep", &key(52));
        let pid = stand_in.settle().expect("WebContent 자리의 자식이 자리를 잡는다").pid;
        let sampled = Arc::new(Mutex::new(None));
        let seen = Arc::clone(&sampled);
        let service = meanwhile(&[WebContentAnswer::Late, WebContentAnswer::Answered(Some(pid))], move |service| {
            *seen.lock().unwrap() = Some(service.sample_once(&mut 0));
        });

        let answered = service.summary();
        assert_eq!(
            *sampled.lock().unwrap(),
            Some(summary::EVERY),
            "요약 IPC가 모으는 사이 표본이 웹뷰의 답을 받아 제 장을 앉히지 않았다 — 이 검사가 재는 차례가 없다"
        );
        let kept = service.background.latest().expect("장이 앉았다");
        assert!(!kept.atelier.webview_excluded, "요약 IPC의 「웹뷰 제외」 장이 그사이 표본이 앉힌 웹뷰를 센 장을 덮었다");
        assert_eq!(answered, kept, "요약 IPC가 앉은 장과 다른 장을 돌려줬다");
        drop(stand_in);
    }

    /// **추이 IPC는 배경 자리의 고리를 돌려준다**(티켓 30) — 표본이 앉힐 때 합계와 그 때를 한 점으로 더한 것이다. 부를 때마다 표를
    /// 찍지 않는다(찍으면 화면이 열려 있는 동안 요약 박자마다 표 한 장이 는다). 아직 한 점도 없으면 빈 목록이다.
    #[test]
    fn the_trend_answers_the_background_ring() {
        let service = service();
        assert_eq!(service.trend(), vec![], "빈 서비스의 추이가 빈 목록이 아니다");
        let kept = |atelier: f64, mac: f64| Summary {
            atelier: Totals { total: Some(1), cpu: Some(atelier), app: None, webview_excluded: true },
            mac: Some(Machine { cpu: Some(mac), memory: None, cores: 10 }),
        };
        service.background.keep(kept(3.0, 30.0), 7_000);
        service.background.keep(kept(5.0, 50.0), 17_000);
        assert_eq!(
            service.trend(),
            vec![Point { at: 7_000, mac: 30.0, atelier: 3.0 }, Point { at: 17_000, mac: 50.0, atelier: 5.0 }]
        );
        let body = method_body("pub fn trend(");
        assert!(
            !body.contains("summarize(") && !body.contains("gather(") && !body.contains("snapshot::take("),
            "추이 IPC가 표를 찍는다"
        );
    }

    /// **정리 기록 IPC는 풀의 인스턴스 기록이 연 정리 기록을 새것부터 돌려준다**(티켓 32 · 프로세스 스펙 S12). 데이터 루트를 다시
    /// 계산하지 않는다 — 그러면 검사의 풀이 진짜 기록을 읽는다. 연 적 없는 기록의 풀은 빈 기록이다(앵커 — 늘 빈 목록을 주게 무너지면
    /// 둘째 단언이 빨개진다). 파일에 100건을 넘게 담지 않으므로(`cleanup_log::KEEP`) 최근 100건이 곧 전부다.
    ///
    /// 자리는 검사가 손으로 세운다(`Place`) — 앱의 신원을 읽는 `pty::open_record`는 macOS에서만 서서, 그 길로 열면 이 검사가 리눅스에서
    /// 늘 빈 기록을 본다. 신호는 없다 — 기록 파일을 쓰고 읽을 뿐이다.
    #[test]
    fn the_cleanup_log_answers_this_pools_log_newest_first() {
        use crate::processes::cleanup_log::{Reason, Target};
        use crate::processes::ending::Outcome;
        use crate::processes::instances::{Build, Place};

        assert_eq!(service().cleanup_events(), vec![], "연 적 없는 기록의 풀이 기록을 읽었다 — 검사의 풀이 진짜 정리 기록을 읽는다");

        let root = temp_home("cleanup-log");
        let pool = Arc::new(NoShells::default());
        pool.record.open(Place {
            dir: root.join("instances"),
            generation: format!("test-{}-1", std::process::id()),
            app: Identity { pid: std::process::id(), started_us: 1 },
            build: Build::Dev,
            version: "test".into(),
            log: crate::processes::cleanup_log::path(&root),
        });
        let event = |at: u64, reason: Reason| Event {
            id: 0,
            at,
            reason,
            shell_key: None,
            owner: None,
            targets: vec![Target { pid: 7, name: "node".into(), command: None, outcome: Outcome::Ended }],
        };
        pool.record.log_cleanup(event(1_000, Reason::ShellClose));
        pool.record.log_cleanup(event(2_000, Reason::StartupCleanup));
        pool.record.log_cleanup(event(3_000, Reason::Manual));
        let answered = ProcessService::new(pool).cleanup_events();
        let _ = std::fs::remove_dir_all(&root);

        let seen: Vec<(u64, u64, Reason)> = answered.iter().map(|one| (one.id, one.at, one.reason)).collect();
        assert_eq!(
            seen,
            vec![(3_000, 3_000, Reason::Manual), (2_000, 2_000, Reason::StartupCleanup), (1_000, 1_000, Reason::ShellClose)],
            "정리 기록이 새것부터 오지 않는다"
        );
    }

    /// **앱 본체에 웹뷰가 이름 댄 WebContent가 든다**(S39 · 티켓 30). 앱에서는 setup이 웹뷰에게 묻는 함수를 건다(`webview.rs`) — 여기서는
    /// 검사가 띄운 자식 하나를 WebContent 자리에 세운다. 살아 있으면 셌다(「웹뷰 제외」가 아니다). 답이 늦으면 마지막으로 안 신원을
    /// 다시 쓴다. 그 자식이 끝났으면(신원으로 못 바꾼다) 「웹뷰 제외」다. 묻는 함수가 없는 서비스(앵커)는 늘 「웹뷰 제외」다.
    ///
    /// 표를 찍고 판정하지만 읽기만 한다 — 신호는 이 검사가 띄운 자식에게만 간다(`Kid`의 거두기).
    #[cfg(target_os = "macos")]
    #[test]
    fn the_app_body_counts_the_web_content_the_webview_names() {
        use std::sync::atomic::{AtomicU32, Ordering};

        use crate::processes::testkit::{key, Kid};

        assert!(service().summarize().atelier.webview_excluded, "묻는 함수가 없는데 웹뷰를 셌다");

        let stand_in = Kid::spawn("sleep", &key(50));
        let pid = stand_in.settle().expect("WebContent 자리의 자식이 자리를 잡는다").pid;
        let answer = Arc::new(AtomicU32::new(pid));
        let asked = Arc::clone(&answer);
        let service = service();
        service.ask_web_content_with(move || match asked.load(Ordering::Relaxed) {
            0 => WebContentAnswer::Late,
            pid => WebContentAnswer::Answered(Some(pid)),
        });
        let counted = service.summarize();
        assert!(!counted.atelier.webview_excluded, "웹뷰가 이름 댄 WebContent를 앱 본체에 안 셌다");
        assert!(counted.atelier.app.is_some_and(|app| counted.atelier.total.is_some_and(|total| total >= app)), "앱 본체가 합계에 안 들었다");

        answer.store(0, Ordering::Relaxed);
        assert!(!service.summarize().atelier.webview_excluded, "답이 늦자 마지막으로 안 WebContent를 버렸다");

        drop(stand_in);
        answer.store(pid, Ordering::Relaxed);
        assert!(service.summarize().atelier.webview_excluded, "끝난 WebContent를 셌다");
    }

    /// **늦은 첫 답 뒤에 처음 앉힌 장은 웹뷰를 셌다**(티켓 30 · S39) — 앱이 막 떴을 때 nav와 요약 카드가 「웹뷰 제외」 장을 다음
    /// 박자까지 보이지 않는다. 검사가 띄운 자식 하나를 WebContent 자리에 세운다(`the_app_body_counts_the_web_content_the_webview_names`와
    /// 같다). 신호는 이 검사가 띄운 자식에게만 간다(`Kid`의 거두기).
    #[cfg(target_os = "macos")]
    #[test]
    fn the_first_kept_sample_counts_the_web_content_that_answered_late() {
        use crate::processes::testkit::{key, Kid};

        let stand_in = Kid::spawn("sleep", &key(51));
        let pid = stand_in.settle().expect("WebContent 자리의 자식이 자리를 잡는다").pid;
        let service = service();
        service.ask_web_content_with(scripted(&[WebContentAnswer::Late, WebContentAnswer::Answered(Some(pid))]));
        let mut held = 0;
        while service.background.latest().is_none() && held < summary::FIRST_RETRIES {
            service.sample_once(&mut held);
        }
        let kept = service.background.latest().expect("첫 장을 앉혔다");
        assert!(!kept.atelier.webview_excluded, "처음 앉힌 장이 「웹뷰 제외」다 — 늦은 첫 답의 장을 앉혔다");
        drop(stand_in);
    }

    /// 풀의 셸 목록은 **pty id 순**이다 — 풀이 해시 맵이라 그대로 두면 부를 때마다 순서가 흔들린다. 셸마다 pty id와 셸 키가 짝으로
    /// 서고(티켓 26), 그 셸이 마지막으로 무언가를 찍은 때(티켓 27 — 「조용함」의 경과)와 셸 프로세스의 신원(티켓 28 — 셸 자신의 지표를
    /// 찾는 열쇠)이 함께 간다. 넷이 한 셸의 것으로 붙어 다닌다. 지표는 아직 비었다 — 판정 뒤에 읽어 채운다.
    #[test]
    fn the_pool_list_is_in_pty_order_with_each_shells_key() {
        let zsh = |pid: u32| Some(Identity { pid, started_us: u64::from(pid) * 10 });
        let shell = |pty_id: u32, key: &str, last_output_ms: u64, process: Option<Identity>| PoolShell {
            pty_id,
            shell_key: key.into(),
            last_output_ms,
            process,
            metrics: Default::default(),
        };
        assert_eq!(
            pool_shells([(3, "G-3", 30, zsh(33)), (1, "G-1", 10, zsh(11)), (2, "G-2", 20, None)].into_iter()),
            vec![shell(1, "G-1", 10, zsh(11)), shell(2, "G-2", 20, None), shell(3, "G-3", 30, zsh(33))]
        );
    }
}
