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

use super::cleanup_log::{self, Event};
use super::instances::Record;
use super::metrics::{self, CpuMeter, Measured};
use super::screen::{self, PoolShell, ScreenSnapshot};
use super::snapshot::{self, EnvScope};
use super::summary::{self, Background, Body, Point, Summary, WebContentAnswer};
use super::verdict::{self, Inputs, Occasion, ShellEntry};
use super::{clock, Identity, ThisRun};

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
    /// `Processes` 화면 스냅샷의 앞 표본 — CPU%를 두 표본의 차이로 짓는다(프로세스 스펙 S37 · 티켓 28). 화면이 2초마다 부르는
    /// `screen`만 쓴다. 박자가 다른 읽기(배경 표본 — 요약 카드의 CPU, 티켓 30)는 제 것을 따로 쥔다(`Background`) — 한 앞 표본을 나눠
    /// 쓰면 두 박자가 섞인다.
    screen_cpu: Mutex<CpuMeter>,
    /// 배경 표본의 자리(티켓 29 · 30) — 마지막 요약(nav 메타가 10초마다 묻는다), 합계의 1시간 고리(추이), 배경의 CPU 미터, 웹뷰에게
    /// WebContent를 묻는 자리. 앱은 setup에서 묻는 함수와 표본 스레드를 건다. 안 걸면(검사의 서비스) 요약을 물을 때 그 자리에서 한
    /// 장을 모으고, 웹뷰는 모른다(「웹뷰 제외」).
    background: Background,
}

impl ProcessService {
    /// 풀 하나를 보는 서비스. 앞 표본 둘과 배경 자리는 빈 채로 선다.
    pub fn new(pool: Arc<impl ShellListing + 'static>) -> Self {
        ProcessService { pool, screen_cpu: Mutex::default(), background: Background::default() }
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
    /// **`●`를 켜는 기록의 머리도 싣는다**(티켓 29 · S41) — 요약(`summarize`)과 같은 자리(풀의 정리 기록)에서 고른다. 화면은 보는 동안
    /// 이 머리와 출처 불명을 본 것으로 앉힌다: 요약은 최대 20초 늦어 그것으로만 앉히면 화면에서 본 것이 떠난 뒤에 점을 켠다.
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
        let readings = metrics::read(screen::targets(&verdict, &listed));
        let cpu = self.screen_cpu().sample(Instant::now(), readings.cpu_ns());
        let measured = Measured { readings: readings.by_id, cpu };
        // 다른 인스턴스의 빌드 · 버전은 그 실행의 기록 파일에서 읽는다(티켓 31) — 판정이 받은 기록은 그 두 칸을 안 싣는다.
        let instances = screen::instances(&verdict, &records, |generation| self.pool.record().file(generation));
        // `●`를 켜는 기록의 머리 — 요약과 같은 자리에서 고른다(`summarize`). 화면이 보는 동안 본 것으로 앉힌다(티켓 29).
        let head = cleanup_log::look_head(&self.pool.record().cleanup_events());
        ScreenSnapshot::of(&verdict, listed, &measured, instances, head)
    }

    /// **요약 한 장을 모은다**(`gather`) — 요약 IPC가 마지막 장이 없을 때 그 자리에서 부른다(`summary`). 배경 표본은 그 장을 미룰지도
    /// 함께 받아야 해 `gather`를 곧바로 부른다(`sample_once`).
    pub fn summarize(&self) -> Summary {
        self.gather().0
    }

    /// **요약 한 장을 모은다** — nav 메타의 합계와 `●`의 재료, 요약 카드의 CPU와 앱 본체(프로세스 결정 10 · 11 · 티켓 29 · 30). 배경
    /// 표본이 10초마다 부른다(`sample_in_background`) — 화면이 닫혀 있어도 돈다.
    ///
    /// 순서는 화면 스냅샷(`screen`)과 같다: 스냅샷을 먼저 찍고, 판정에 넘길 셸 목록과 풀의 셸을 **한 잠금 안에서** 읽고(셸 프로세스의
    /// 신원은 풀의 셸에서 뽑는다), 인스턴스 기록은 그 **뒤에** 읽는다(S52). env는 전부 읽는다 — 출처 불명은 지금 풀의 어느 셸보다
    /// 먼저 태어났을 수 있다. 지표는 판정 뒤, 풀 잠금 밖에서 합계에 드는 것만 읽는다(`summary::targets` — 앱 본체 + 이 실행의 셸과
    /// 자손).
    ///
    /// **앱 본체는 Rust 본체와 웹뷰의 WebContent다**(S39 · 티켓 30). WebContent의 pid는 웹뷰에게 묻는다 — 메인 스레드로 가는
    /// 물음이라 풀 잠금 밖이다(`summary::WebContent`, 묻는 함수는 setup이 건다). **CPU%는 배경 표본의 앞 표본과 견준다**
    /// (`Background`의 미터) — 화면의 앞 표본(`screen_cpu`)을 나눠 쓰면 2초와 10초 박자가 섞인다.
    ///
    /// `●`를 켜는 기록의 머리는 정리 기록 파일에서 고른다(`cleanup_log::look_head`). 아무것도 안 끝낸다.
    ///
    /// 장과 함께 **이 장을 모은 WebContent 물음까지 웹뷰에게서 한 번도 제때 답을 못 들었나**(`WebContentAsked::unheard`)를 준다 — 배경
    /// 표본이 첫 장을 미룰지 이 값으로 가른다(`sample_once`).
    fn gather(&self) -> (Summary, bool) {
        let snapshot = snapshot::take(EnvScope::All);
        let (live, listed) = self.pool.listing();
        let shells: Vec<Identity> = listed.iter().filter_map(|shell| shell.process).collect();
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
        let body = Body { rust: snapshot::identity_of(std::process::id()), web_content: asked.id };
        let readings = metrics::read(summary::targets(&verdict, &shells, &body));
        let cpu = self.background.cpu(Instant::now(), readings.cpu_ns());
        let measured = Measured { readings: readings.by_id, cpu };
        let head = cleanup_log::look_head(&self.pool.record().cleanup_events());
        (Summary::of(&verdict, &shells, &body, &measured, head), asked.unheard)
    }

    /// 요약 IPC의 답(`processes_summary`) — **배경 표본의 마지막 한 장**이다(티켓 29). 아직 한 장도 없으면(앱이 막 떠 첫 표본이 도는
    /// 중 · 첫 장을 웹뷰의 답까지 미루는 중(`sample_once`), 표본 스레드를 안 건 검사의 서비스) 그 자리에서 모아 앉힌다 — 프런트는
    /// 뜨자마자 묻는다.
    pub fn summary(&self) -> Summary {
        self.background.latest().unwrap_or_else(|| {
            let fresh = self.summarize();
            self.background.keep(fresh.clone(), clock::now_ms());
            fresh
        })
    }

    /// 추이 IPC의 답(`processes_trend`) — 배경 표본이 든 합계의 1시간치, 오래된 것부터(프로세스 결정 10 · 티켓 30). 표를 찍지 않는다 —
    /// 고리를 복사할 뿐이다.
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
    /// 불명으로 서서 뜨자마자 `●`가 선다. 그래서 setup의 자리가 `pty::open_record` 뒤다(`lib.rs`의 핀).
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
            body.contains("ScreenSnapshot::of(&verdict, listed, &measured, instances, head)"),
            "판정 결과와 풀의 셸 목록과 지표와 다른 인스턴스의 실행들과 기록의 머리를 그대로 싣지 않는다"
        );
        assert!(
            body.contains("let head = cleanup_log::look_head(&self.pool.record().cleanup_events());"),
            "`●`의 머리를 요약과 같은 자리(풀의 정리 기록)에서 안 고른다 — 검사의 풀이 진짜 기록을 읽거나 화면과 nav가 다른 머리를 본다"
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
    #[test]
    fn the_screen_measures_what_the_verdict_picked_outside_the_pool_lock() {
        let body = method_body("pub fn screen(");
        let judged = body.find("verdict::judge(").expect("판정한다");
        let read = body.find("metrics::read(screen::targets(&verdict, &listed))").expect("판정이 고른 것만 지표를 읽는다");
        let listed = body.find("self.pool.listing()").expect("풀의 셸 목록을 받는다");
        assert!(listed < read && judged < read, "지표를 판정({judged})이나 풀의 셸 목록({listed}) 전에 읽는다 — {read}");
        assert_eq!(body.matches("metrics::read(").count(), 1, "지표를 두 번 읽는다");
        let sampled = body.find("self.screen_cpu()").expect("이 자리가 쥔 앞 표본과 견준다");
        assert!(read < sampled, "읽기({read}) 전에 CPU% 표본을 넣는다({sampled})");
        assert!(!body.contains("CpuMeter::default()"), "부를 때마다 앞 표본을 새로 세운다 — CPU%가 늘 첫 표본이다");
    }

    /// **배경 표본은 화면 스냅샷과 같은 순서로 모은다**(티켓 29 · 프로세스 스펙 S52 · S38). 표를 한 장 찍고(env 전부 — 출처 불명은
    /// 지금 풀의 어느 셸보다 먼저 태어났을 수 있다), 판정의 셸 목록과 풀의 셸(셸 프로세스의 신원)을 한 번에 받는다. 지표는 판정 뒤,
    /// 잠금 밖에서 **합계에 드는 것만** 읽는다(`summary::targets` — 앱 본체와 이 실행의 셸 · 자손). `●`의 머리는 풀의 인스턴스 기록이
    /// 연 정리 기록에서 고른다 — 데이터 루트를 다시 계산하면 검사의 풀이 진짜 기록을 읽는다.
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
        let sampled = body.find("self.background.cpu(").expect("배경의 미터로 CPU%를 짓는다");
        assert!(read < sampled, "읽기({read}) 전에 CPU% 표본을 넣는다({sampled})");
        assert!(
            body.contains("cleanup_log::look_head(&self.pool.record().cleanup_events())"),
            "`●`의 머리를 풀의 정리 기록에서 안 고른다"
        );
        assert!(!body.contains("screen_cpu"), "배경 표본이 화면의 앞 표본을 나눠 쓴다 — 두 박자가 섞인다");
        assert!(!body.contains("CpuMeter::"), "부를 때마다 앞 표본을 새로 세운다 — 요약의 CPU가 늘 첫 표본이다");
    }

    /// **요약 IPC는 배경 표본의 마지막 장을 돌려준다**(티켓 29) — 부를 때마다 표를 찍지 않는다. 아직 한 장도 없으면 그 자리에서
    /// 모아 앉힌다(앱이 막 떠 첫 표본이 도는 중에 프런트가 묻는다). 연 적 없는 기록의 풀은 정리 기록을 안 읽는다 — 머리가 없다.
    ///
    /// 둘째 갈래는 이 맥의 표를 한 장 찍는다(읽기만 한다 — 아무것도 안 끝낸다).
    #[test]
    fn the_summary_answers_the_last_background_sample() {
        let kept_service = service();
        let kept = Summary {
            total: Some(1),
            cpu: None,
            app: Some(1),
            webview_excluded: true,
            unknown: vec![],
            record_head: Some(9),
        };
        kept_service.background.keep(kept.clone(), 5_000);
        assert_eq!(kept_service.summary(), kept, "배경 표본이 앉힌 장을 안 돌려준다");

        let fresh = service();
        let first = fresh.summary();
        assert_eq!(fresh.background.latest(), Some(first.clone()), "그 자리에서 모은 장을 안 앉혔다");
        assert_eq!(first.record_head, None, "연 적 없는 기록에서 머리를 골랐다 — 검사의 풀이 진짜 정리 기록을 읽는다");
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
        assert!(never.background.latest().is_some_and(|kept| kept.webview_excluded), "상한 뒤에 「웹뷰 제외」 장을 안 앉혔다");
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

    /// 표본이 WebContent를 물은 **뒤**, 그 표본이 풀을 다시 볼 때 요약 IPC 하나를 그 자리에서 돌리는 풀 — 두 스레드의 차례(표본의
    /// 물음이 늦음으로 끝난 뒤, 표본이 미룰지 가르기 전에 IPC의 물음이 답을 받는다)를 한 스레드에서 고정한다. IPC의 요약은 다시
    /// 이 풀을 보지만 한 번만 돈다.
    #[derive(Default)]
    struct IpcMeanwhile {
        record: Record,
        service: std::sync::OnceLock<std::sync::Weak<ProcessService>>,
        /// 웹뷰에게 한 번이라도 물었나 — 묻는 함수가 세운다.
        asked: Arc<std::sync::atomic::AtomicBool>,
        ran: std::sync::atomic::AtomicBool,
        /// IPC가 돌려준 장.
        answered: Mutex<Option<Summary>>,
    }

    impl ShellListing for IpcMeanwhile {
        fn listing(&self) -> (Vec<ShellEntry>, Vec<PoolShell>) {
            (Vec::new(), Vec::new())
        }

        fn record(&self) -> &Record {
            use std::sync::atomic::Ordering;
            if self.asked.load(Ordering::SeqCst) && !self.ran.swap(true, Ordering::SeqCst) {
                let service = self.service.get().and_then(std::sync::Weak::upgrade).expect("서비스가 아직 산다");
                *self.answered.lock().unwrap() = Some(service.summary());
            }
            &self.record
        }
    }

    /// **첫 장을 미룰지는 그 장을 모은 물음이 가른다**(티켓 30 · S39). 표본의 물음이 늦어 그 장이 「웹뷰 제외」인데, 표본이 가르기 전에
    /// 요약 IPC(다른 스레드)의 물음이 답을 받아 제 장을 앉혔다 — 그 뒤에 자리의 지금 값(「들었다」)으로 가르면 표본이 제 제외 장을
    /// 앉혀 IPC의 장을 덮는다. nav와 요약 카드가 다음 박자(10초)까지 그 장을 보인다. 이 장은 이 장의 물음으로 가른다: 미루고, IPC의
    /// 장이 남는다. 다음 표본은 들은 답이 있어 곧바로 앉는다(앵커).
    ///
    /// 표본마다 이 맥의 표를 한 장 찍는다(읽기만 한다 — 아무것도 안 끝낸다).
    #[test]
    fn a_sample_asked_too_late_is_held_even_if_the_summary_ipc_heard_meanwhile() {
        use std::sync::atomic::Ordering;

        let pool = Arc::new(IpcMeanwhile::default());
        let service = Arc::new(ProcessService::new(Arc::clone(&pool)));
        pool.service.set(Arc::downgrade(&service)).expect("한 번만 건다");
        let answers = scripted(&[WebContentAnswer::Late, WebContentAnswer::Answered(None)]);
        let asked = Arc::clone(&pool.asked);
        service.ask_web_content_with(move || {
            asked.store(true, Ordering::SeqCst);
            answers()
        });

        let mut held = 0;
        let wait = service.sample_once(&mut held);
        let answered = pool.answered.lock().unwrap().clone();
        assert!(answered.is_some(), "표본이 모으는 사이 요약 IPC가 안 돌았다 — 이 검사가 재는 차례가 없다");
        assert_eq!(
            wait,
            summary::FIRST_RETRY_AFTER,
            "표본의 물음은 늦었는데 그사이 IPC가 들은 답을 이 장의 것으로 읽고 「웹뷰 제외」 장을 앉혔다"
        );
        assert_eq!(service.background.latest(), answered, "표본이 IPC가 앉힌 장을 덮었다");
        assert_eq!(service.sample_once(&mut held), summary::EVERY, "들은 답이 있는데 다음 표본도 미뤘다");
    }

    /// **추이 IPC는 배경 자리의 고리를 돌려준다**(티켓 30) — 표본이 앉힐 때 합계와 그 때를 한 점으로 더한 것이다. 부를 때마다 표를
    /// 찍지 않는다(찍으면 화면이 열려 있는 동안 요약 박자마다 표 한 장이 는다). 아직 한 점도 없으면 빈 목록이다.
    #[test]
    fn the_trend_answers_the_background_ring() {
        let service = service();
        assert_eq!(service.trend(), vec![], "빈 서비스의 추이가 빈 목록이 아니다");
        let kept = |total: u64| Summary {
            total: Some(total),
            cpu: None,
            app: None,
            webview_excluded: true,
            unknown: vec![],
            record_head: None,
        };
        service.background.keep(kept(3), 7_000);
        service.background.keep(kept(5), 17_000);
        assert_eq!(service.trend(), vec![Point { at: 7_000, total: 3 }, Point { at: 17_000, total: 5 }]);
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

        assert!(service().summarize().webview_excluded, "묻는 함수가 없는데 웹뷰를 셌다");

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
        assert!(!counted.webview_excluded, "웹뷰가 이름 댄 WebContent를 앱 본체에 안 셌다");
        assert!(counted.app.is_some_and(|app| counted.total.is_some_and(|total| total >= app)), "앱 본체가 합계에 안 들었다");

        answer.store(0, Ordering::Relaxed);
        assert!(!service.summarize().webview_excluded, "답이 늦자 마지막으로 안 WebContent를 버렸다");

        drop(stand_in);
        answer.store(pid, Ordering::Relaxed);
        assert!(service.summarize().webview_excluded, "끝난 WebContent를 셌다");
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
        assert!(!kept.webview_excluded, "처음 앉힌 장이 「웹뷰 제외」다 — 늦은 첫 답의 장을 앉혔다");
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
