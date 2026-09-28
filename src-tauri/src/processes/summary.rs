//! 요약 — nav 메타가 10초마다 묻는 값, 그리고 `Processes` 요약 카드가 읽는 합계 · 추이 · CPU · 앱 본체(프로세스 결정 10 · 11 ·
//! 티켓 29 · 30).
//!
//! nav `Processes` 옆 메타는 두 세계의 모든 화면에 늘 선다. 평소에는 아틀리에의 메모리 합계이고, 손볼 것이 새로 생기면 그 앞에
//! `●`가 선다. 화면이 닫혀 있어도 그 값이 있어야 해서 **Rust가 10초마다 모은다**(배경 표본 —
//! `service::ProcessService::sample_in_background`). 화면 스냅샷(2초, `screen`)은 화면이 열려 있을 때만 온다.
//!
//! 모으는 것은 이렇다.
//! - **합계** = 앱 본체 + 이 실행의 모든 셸과 자손(셸 도우미 포함). 예외와 다른 인스턴스는 빼고, 고아도 안 든다(고아는 따로
//!   적는다 — 요약 카드가 확정 고아와 출처 불명을 화면 스냅샷에서 센다).
//! - **앱 본체** = Rust 본체 + 웹뷰(WebContent) 프로세스(프로세스 스펙 S39). WebContent는 부모가 launchd라 트리로 안 잡힌다 — 웹뷰에게
//!   pid를 묻는다(`WebContent`, 묻는 길은 `webview.rs`의 비공개 SPI). 못 물었거나 못 읽었으면 Rust 본체만 세고 「웹뷰 제외」를
//!   싣는다. **GPU와 Networking 프로세스는 세지 않는다** — 그래서 활성 상태 보기가 앱에 묶어 보이는 합과 차이가 난다(요약 카드의
//!   툴팁이 그렇게 말한다).
//! - **CPU** — 합계에 드는 것의 CPU%를 더한 것(한 코어 = 100). 배경 표본의 앞 표본과 견준다(`Background`의 미터 — 화면의 것과 따로).
//! - **출처 불명의 신원 목록**(pid, 시작 시각). 수가 아니라 신원이다(티켓 29 「스펙과 다른 점」) — `●`는 본 것의 집합과 견줘 새로
//!   생긴 것에만 서는데(S41), 수만으로는 하나가 사라지고 다른 하나가 생긴 것을 못 본다. 수는 목록의 길이다.
//! - **`●`를 켜는 기록의 머리 id**(`cleanup_log::look_head`) — 무엇이 켜는 기록인지는 그쪽이 가른다.
//!
//! 그리고 **합계의 1시간치**(360점)를 메모리 고리에 든다(프로세스 결정 10 · S37 — `Trend`). 앱을 다시 켜면 빈다. 추이 IPC가 이
//! 고리를 돌려준다.
//!
//! 합계의 메모리는 화면의 트리 합과 같은 규칙이다(`src/features/processes/metrics.ts`의 `sumMetrics`) — 읽은 것끼리 더하고, 아무것도
//! 못 읽었으면 없다. 그래야 nav와 화면이 같은 앱을 두고 다른 말을 하지 않는다.
//!
//! **이 파일은 값과 그 값을 쥐는 자리만 짓는다.** 스냅샷 · 판정 · 지표 읽기 · 기록 읽기를 잇는 자리는 프로세스 서비스의
//! `gather`다(`service` — 화면 스냅샷과 같은 순서). 웹뷰에게 묻는 FFI는 앱 층(`webview.rs`)이 setup에서 건다 — 이 층은 Tauri를
//! 모른다.

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::metrics::{CpuMeter, Measured};
use super::verdict::Verdict;
use super::Identity;

/// 배경 표본의 박자(프로세스 스펙 S37 — 배경 10초, 화면 2초). 프런트가 요약을 묻는 박자도 같다(`SUMMARY_EVERY_MS`).
pub const EVERY: Duration = Duration::from_secs(10);

/// 배경 표본이 첫 장을 미룰 때 쉬는 때(`holds_first`) — setup이 메인 스레드를 놓기를 기다린다. 박자(10초)보다 한참 짧다: 그동안
/// nav 메타의 첫 합계는 요약 IPC가 그 자리에서 모은 장이 메운다.
pub const FIRST_RETRY_AFTER: Duration = Duration::from_secs(1);

/// 배경 표본이 첫 장을 미루는 상한 — 넘으면 「웹뷰 제외」 장이라도 앉힌다(웹뷰가 끝내 답을 안 하는 기계에서 요약이 비지 않게). 표본
/// 스레드를 붙잡는 때는 많아야 상한 × (`FIRST_RETRY_AFTER` + 웹뷰를 기다리는 한계 0.5초)다.
pub const FIRST_RETRIES: u32 = 5;

/// **배경 표본이 이 장을 앉히지 않고 곧 다시 모으나**(티켓 30 · S39). 웹뷰에게 물을 길은 걸렸는데 이 장을 모은 물음까지 **아직 한
/// 번도 제때 답을 못 받았고**(`WebContentAsked::unheard`), 미룬 수(`held`)가 상한 아래일 때다.
///
/// 앱에서 첫 표본은 setup이 메인 스레드를 쥔 동안 돈다 — WebContent 물음이 늦어(「늦음」) 아직 아는 신원이 없고, 그 장은 「웹뷰 제외」다.
/// 앉히면 요약 IPC가 그 장을 다음 박자까지 돌려주고 추이의 첫 점이 웹뷰만큼 낮다. 묻는 함수가 없거나(검사) 한 번이라도 답했으면(macOS
/// 밖은 늘 「없음」으로 답한다) 미룰 까닭이 없다.
pub fn holds_first(unheard: bool, held: u32) -> bool {
    unheard && held < FIRST_RETRIES
}

/// 추이 고리가 쥐는 점 수 — 10초마다 한 점, 1시간치(프로세스 결정 10 「화면이 닫혀 있어도 10초마다 합계만 모아 메모리에 1시간치를
/// 든다」).
pub const TREND_POINTS: usize = 360;

/// 배경 표본의 CPU 미터가 앞 표본을 버리는 나이 — 박자의 세 배. 표본 사이는 10초 잠 + 모으는 시간이라 늘 `EVERY`를 조금 넘는다
/// (화면의 `metrics::STALE`로 버리면 요약의 CPU가 영영 없다). 이보다 벌어졌으면 맥이 잠들었거나 스레드가 밀린 것이라 그 사이의
/// 평균을 지금 값처럼 세우지 않는다.
pub const CPU_STALE: Duration = Duration::from_secs(30);

/// 요약 한 장. 프런트의 `ProcessSummary`(`src/features/processes/types.ts`)와 **칸 이름으로만** 이어진다 — 와이어 모양을 아래
/// 검사가 글자로 못박는다. CPU가 `f64`라 `Eq`가 없다.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// 앱 전체 메모리 합계(`phys_footprint`, 바이트) — 앱 본체 + 이 실행의 셸과 자손. 아무것도 못 읽었으면(macOS 밖) `None`이다 —
    /// nav 메타가 숫자를 안 세운다.
    pub total: Option<u64>,
    /// 합계에 드는 것의 CPU%를 더한 것(한 코어 = 100). 배경 표본의 첫 장이거나 아무것도 못 쟀으면 `None`(카드의 「—」).
    pub cpu: Option<f64>,
    /// 앱 본체의 메모리 — Rust 본체 + WebContent 중 읽은 것(S39). 아무것도 못 읽었으면 `None`.
    pub app: Option<u64>,
    /// 앱 본체에 웹뷰(WebContent)를 안 셌다(프로세스 스펙 S39) — pid를 못 물었거나 그 프로세스를 못 읽었다. 요약 카드가 「웹뷰 제외」로
    /// 보인다.
    pub webview_excluded: bool,
    /// 출처 불명의 신원 — pid 순, 겹침 없음.
    pub unknown: Vec<Identity>,
    /// `●`를 켜는 기록 중 가장 새것의 번호(`cleanup_log::look_head`). 없으면 `None`.
    pub record_head: Option<u64>,
}

/// **앱 본체의 신원** — Rust 본체와 웹뷰의 WebContent 프로세스(S39). 둘 다 못 알 수 있다(macOS 밖 · 웹뷰가 아직 안 떴다).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Body {
    pub rust: Option<Identity>,
    pub web_content: Option<Identity>,
}

impl Body {
    fn ids(&self) -> impl Iterator<Item = Identity> {
        self.rust.into_iter().chain(self.web_content)
    }
}

/// **합계에 드는 신원** — 앱 본체(Rust · WebContent)와 이 실행의 셸 프로세스, 판정이 셸마다 가른 자손(셸 도우미 포함). 이것만 지표를
/// 읽는다(프로세스 스펙 S38의 「우리 트리만」). 예외 · 다른 인스턴스 · 고아는 판정이 다른 묶음에 넣어 여기 안 든다 — 화면 스냅샷의
/// `screen::targets`와 다른 것이 그 셋이다.
pub fn targets(verdict: &Verdict, shells: &[Identity], body: &Body) -> BTreeSet<Identity> {
    verdict
        .descendants
        .values()
        .flatten()
        .map(|proc| proc.id)
        .chain(shells.iter().copied())
        .chain(body.ids())
        .collect()
}

/// 읽은 것끼리의 합. 하나도 못 읽었으면 없다 — 모르는 것을 0이라 하지 않는다(화면의 `sumMetrics`와 같은 규칙).
fn sum_read<T: std::iter::Sum<T>>(values: impl Iterator<Item = Option<T>>) -> Option<T> {
    let read: Vec<T> = values.flatten().collect();
    (!read.is_empty()).then(|| read.into_iter().sum())
}

impl Summary {
    /// 판정 하나와 이 실행의 셸 프로세스, 앱 본체, 이번 표본의 지표(CPU%는 배경 미터가 지은 것), 기록의 머리로 한 장을 짓는다.
    pub fn of(verdict: &Verdict, shells: &[Identity], body: &Body, measured: &Measured, record_head: Option<u64>) -> Summary {
        let counted = targets(verdict, shells, body);
        let memory = |id: &Identity| measured.readings.get(id).map(|reading| reading.memory);
        let unknown: BTreeSet<Identity> = verdict.orphans.unknown.values().flatten().map(|proc| proc.id).collect();
        Summary {
            total: sum_read(counted.iter().map(memory)),
            cpu: sum_read(counted.iter().map(|id| measured.cpu.get(id).copied())),
            app: sum_read(body.ids().map(|id| memory(&id))),
            webview_excluded: body.web_content.is_none_or(|id| !measured.readings.contains_key(&id)),
            unknown: unknown.into_iter().collect(),
            record_head,
        }
    }
}

/// 추이의 한 점 — 배경 표본이 합계를 읽은 때(에포크 ms)와 그 합계(바이트). 프런트의 `TrendPoint`와 칸 이름으로 이어진다.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub at: u64,
    pub total: u64,
}

/// **합계의 1시간 고리**(프로세스 결정 10 · S37). 넘치면 가장 오래된 점부터 버린다 — 늘 마지막 `TREND_POINTS`개다. 메모리에만 산다:
/// 앱을 다시 켜면 빈다.
///
/// **한 기준의 합계만 잇는다**(`add`) — 웹뷰(WebContent)를 센 합계와 못 센 합계는 웹뷰만큼(약 1.6GB) 다른 값이라 한 선에 이으면
/// 없던 오르내림이 선다.
#[derive(Debug, Default)]
pub struct Trend {
    points: VecDeque<Point>,
    /// 고리의 점이 웹뷰를 센 합계다 — 그런 점이 한 번 오면 참이 되고 다시 안 내려간다.
    counts_webview: bool,
}

impl Trend {
    /// 고리 끝에 한 점을 더한다(넘치면 가장 오래된 것부터 버린다). 기준은 가르지 않는다 — 가르는 것은 `add`다.
    pub fn push(&mut self, point: Point) {
        if self.points.len() == TREND_POINTS {
            self.points.pop_front();
        }
        self.points.push_back(point);
    }

    /// **표본의 합계를 한 점으로 더한다 — 한 기준의 점만**(티켓 30 · S39). `counted_webview`는 그 합계가 웹뷰를 셌는가다.
    /// - 웹뷰를 센 점이 **처음** 오면 그 앞의 제외 점을 비우고 거기서 선을 시작한다 — 앱이 막 떠 웹뷰를 못 센 점과 이으면 켠 뒤 한
    ///   시간 동안 없던 상승이 선다.
    /// - 그 뒤의 제외 표본(그사이 WebContent를 못 읽었다)은 점을 안 넣는다 — 넣으면 없던 하락이 선다. 선이 그만큼 빈다.
    /// - **한 번도 못 셌으면** 제외 점끼리 잇는다 — macOS 밖이나 웹뷰가 끝내 답을 안 하는 기계에서 추이가 비지 않게.
    pub fn add(&mut self, point: Point, counted_webview: bool) {
        match (self.counts_webview, counted_webview) {
            (false, true) => {
                self.points.clear();
                self.counts_webview = true;
                self.push(point);
            }
            (true, false) => {}
            _ => self.push(point),
        }
    }

    /// 오래된 것부터.
    pub fn points(&self) -> Vec<Point> {
        self.points.iter().copied().collect()
    }
}

/// 웹뷰에게 WebContent의 pid를 물은 답(S39 — 묻는 길은 앱 층의 `webview::content_pid`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebContentAnswer {
    /// 웹뷰가 답했다 — pid, 또는 없음(아직 아무것도 안 띄웠다 · 이 OS의 WebKit에 그 SPI가 없다 · 창이 없다).
    Answered(Option<u32>),
    /// 제때 답이 안 왔다 — 메인 스레드가 바빴다. 웹뷰에게 묻는 앱 층(`webview::content_pid`)은 macOS에만 있다.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Late,
}

/// **WebContent를 묻는 자리.** 앱은 setup에서 묻는 함수를 건다(`ask_with`). 기본값은 빈 자리라, 검사가 세우는 풀은 웹뷰를 모른다 —
/// 요약은 「웹뷰 제외」다.
///
/// **마지막으로 안 신원을 쥔다.** 답이 늦으면(메인 스레드가 바빴다) 그 신원을 다시 쓴다 — 늦을 때마다 앱 본체에서 웹뷰가 빠지면 합계와
/// 추이가 그 크기만큼 들쭉날쭉한다. pid가 아니라 신원(pid + 시작 시각)을 쥐므로, 그사이 WebContent가 끝나 pid가 남에게 넘어갔으면
/// 지표를 읽는 쪽이 신원 재확인에서 거른다(`metrics::read`) — 남의 숫자가 앱 본체에 안 든다.
///
/// **한 번도 제때 답을 못 받은 것도 가른다**(`WebContentAsked::unheard`) — 배경 표본이 첫 장을 미루는 재료다(`holds_first`).
#[derive(Default)]
pub struct WebContent {
    ask: OnceLock<Box<dyn Fn() -> WebContentAnswer + Send + Sync>>,
    last: Mutex<Heard>,
}

/// 웹뷰에게서 들은 마지막 답.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum Heard {
    /// 아직 한 번도 제때 답을 못 받았다(묻지 않았거나 늘 늦었다).
    #[default]
    Nothing,
    /// 마지막으로 제때 온 답 — 신원, 또는 없음(웹뷰가 없다고 답했다 · 신원으로 못 바꿨다).
    Answer(Option<Identity>),
}

impl WebContent {
    /// 묻는 함수를 한 번 건다. 두 번째는 버린다 — 앱에서는 setup 한 자리만 부른다.
    pub fn ask_with(&self, ask: impl Fn() -> WebContentAnswer + Send + Sync + 'static) {
        if self.ask.set(Box::new(ask)).is_err() {
            eprintln!("atelier: the web content asker was already set");
        }
    }

    /// 웹뷰에게 한 번 묻고, 지금의 WebContent 신원과 **이 물음까지 한 번도 제때 답을 못 들었나**를 준다(`WebContentAsked`). 묻는
    /// 함수가 없으면 신원도 없고 기다릴 답도 없다. pid를 신원으로 바꾸는 것은 부르는 쪽이 건넨다(`snapshot::identity_of`) — 이 자리는
    /// 커널을 안 읽는다.
    pub fn identity(&self, identify: impl Fn(u32) -> Option<Identity>) -> WebContentAsked {
        let Some(ask) = self.ask.get() else {
            return WebContentAsked { id: None, unheard: false };
        };
        let answer = ask();
        let mut last = lock(&self.last);
        if let WebContentAnswer::Answered(pid) = answer {
            *last = Heard::Answer(pid.and_then(identify));
        }
        match *last {
            Heard::Answer(id) => WebContentAsked { id, unheard: false },
            Heard::Nothing => WebContentAsked { id: None, unheard: true },
        }
    }
}

/// 웹뷰에게 한 번 물은 결과(`WebContent::identity`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WebContentAsked {
    /// 지금의 WebContent 신원 — 이번 답, 늦었으면 마지막으로 안 것.
    pub id: Option<Identity>,
    /// **묻는 함수는 걸렸는데 이 물음까지 한 번도 제때 답을 못 받았다** — 물은 것이 모두 「늦음」이었다(앱이 막 떠 setup이 메인
    /// 스레드를 쥐고 있었다). 묻는 함수가 없으면(검사의 풀) 기다릴 답도 없어 거짓이다. 한 번이라도 답했으면(「없음」이라도) 거짓이다.
    ///
    /// **이 물음과 한 잠금 안에서 가른다.** 물은 뒤에 자리를 다시 보면 그사이 다른 스레드(요약 IPC)의 물음이 들은 답이 섞인다 —
    /// 이 물음은 늦어 「웹뷰 제외」로 모은 장을 「들었다」로 읽어 앉힌다(`ProcessService::sample_once`).
    pub unheard: bool,
}

/// 배경 표본의 자리 — 마지막 요약 한 장(티켓 29), 합계의 1시간 고리와 CPU 미터(티켓 30), WebContent를 묻는 자리. 요약 IPC가 마지막
/// 장을, 추이 IPC가 고리를 돌려준다.
pub struct Background {
    latest: Mutex<Option<Summary>>,
    trend: Mutex<Trend>,
    /// 배경 표본의 앞 표본 — 화면의 것(`ProcessService`의 `screen_cpu`)과 따로다. 나눠 쓰면 2초와 10초 박자가 섞인다.
    cpu: Mutex<CpuMeter>,
    pub web_content: WebContent,
}

impl Default for Background {
    fn default() -> Self {
        Background {
            latest: Mutex::default(),
            trend: Mutex::default(),
            cpu: Mutex::new(CpuMeter::aged(CPU_STALE)),
            web_content: WebContent::default(),
        }
    }
}

/// 잠금이 오염됐으면 안을 꺼내 이어 간다 — 잃어도 요약 한 장 · 추이 한 점 · CPU 한 박자 · 마지막으로 안 WebContent다.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl Background {
    /// 새 표본을 앉힌다. 합계가 있으면 그 때(`at`, 에포크 ms)와 함께 추이 고리에 한 점을 더한다 — **고리가 든 기준의 합계일 때만**
    /// (`Trend::add` — 웹뷰를 센 합계와 못 센 합계를 한 선에 안 잇는다). 합계를 못 읽은 표본(macOS 밖)은 점이 없다. 점을 안 넣는 장도
    /// 마지막 장으로는 앉는다.
    pub fn keep(&self, summary: Summary, at: u64) {
        if let Some(total) = summary.total {
            lock(&self.trend).add(Point { at, total }, !summary.webview_excluded);
        }
        *lock(&self.latest) = Some(summary);
    }

    /// 마지막 표본. 아직 한 장도 없으면 `None`이다.
    pub fn latest(&self) -> Option<Summary> {
        lock(&self.latest).clone()
    }

    /// 합계의 1시간치 — 오래된 것부터. 아직 없으면 빈 목록이다.
    pub fn trend(&self) -> Vec<Point> {
        lock(&self.trend).points()
    }

    /// 배경 미터에 새 표본을 넣고 신원마다 CPU%를 받는다.
    pub fn cpu(&self, at: Instant, cpu_ns: HashMap<Identity, u64>) -> HashMap<Identity, f64> {
        lock(&self.cpu).sample(at, cpu_ns)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet, HashMap};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    use super::*;
    use crate::processes::metrics::Reading;
    use crate::processes::verdict::Orphans;
    use crate::processes::Proc;

    fn row(pid: u32, ppid: u32, name: &str) -> Proc {
        Proc {
            id: Identity { pid, started_us: 1_000 + u64::from(pid) },
            ppid,
            pgid: pid,
            uid: 501,
            name: name.to_string(),
            argv0: None,
            command: None,
            shell_key: None,
        }
    }

    fn reading(memory: u64) -> Reading {
        Reading { memory, cpu_ns: 0, ports: vec![] }
    }

    const MB: u64 = 1024 * 1024;
    /// 메모리만 읽은 표본 — 배경 표본의 첫 장이라 앞 표본이 없어 CPU를 못 쟀다.
    fn memory_only(readings: HashMap<Identity, Reading>) -> Measured {
        Measured { readings, cpu: HashMap::new() }
    }

    fn rust_only(app: Identity) -> Body {
        Body { rust: Some(app), web_content: None }
    }

    /// 아무 묶음도 없는 판정.
    fn empty<'a>() -> Verdict<'a> {
        Verdict {
            descendants: BTreeMap::new(),
            exceptions: vec![],
            helpers: BTreeSet::new(),
            orphans: Orphans::default(),
            other_instances: BTreeMap::new(),
        }
    }

    /// **요약이 싣는 모양**(티켓 29 · 30). 프런트가 칸 이름으로 읽는다 — 글자로 못박는다. 출처 불명은 신원(pid · 시작 시각)의 목록이고,
    /// 합계 · 앱 본체는 바이트, CPU는 %, 머리 id는 기록 번호다. 웹뷰를 읽었으면 「웹뷰 제외」가 거짓이다. 아무것도 못 읽은 장은 숫자가
    /// 모두 비고 웹뷰는 제외다.
    #[test]
    fn the_summary_crosses_the_wire_in_the_shape_the_nav_reads() {
        let lost = row(500, 1, "sleep");
        let verdict = Verdict {
            orphans: Orphans { unknown: BTreeMap::from([("OLD-1", vec![&lost])]), ..Orphans::default() },
            ..empty()
        };
        let body = Body {
            rust: Some(Identity { pid: 42, started_us: 4_200 }),
            web_content: Some(Identity { pid: 77, started_us: 7_700 }),
        };
        let readings = HashMap::from([(body.rust.unwrap(), reading(410 * MB)), (body.web_content.unwrap(), reading(200 * MB))]);
        let cpu = HashMap::from([(body.rust.unwrap(), 2.5), (body.web_content.unwrap(), 1.5)]);
        let summary = Summary::of(&verdict, &[], &body, &Measured { readings, cpu }, Some(7));
        assert_eq!(
            serde_json::to_value(summary).unwrap(),
            serde_json::json!({
                "total": 610 * MB,
                "cpu": 4.0,
                "app": 610 * MB,
                "webviewExcluded": false,
                "unknown": [{ "pid": 500, "startedUs": 1_500 }],
                "recordHead": 7,
            })
        );
        let blank = Summary::of(&empty(), &[], &Body::default(), &Measured::default(), None);
        assert_eq!(
            serde_json::to_value(blank).unwrap(),
            serde_json::json!({
                "total": null,
                "cpu": null,
                "app": null,
                "webviewExcluded": true,
                "unknown": [],
                "recordHead": null,
            })
        );
    }

    /// **요약의 출처 불명 목록은 판정의 출처 불명 신원 그대로다**(티켓 29). 키가 여럿이어도, 키 밑의 트리(표식이 안 읽히는 시스템
    /// 바이너리 자손)도 모두 든다 — 판정이 그 묶음에 넣은 것 전부다. pid 순이다. 확정 고아 · 다른 인스턴스 · 예외 · 셸의 자손은
    /// 출처 불명이 아니다(앵커: 그 묶음들에도 행이 있다 — 비어서 안 든 것이 아니다).
    #[test]
    fn the_unknown_list_is_the_unknown_identities_of_the_verdict() {
        let (vite, tmux, stale, other) = (row(200, 100, "node"), row(300, 1, "tmux"), row(400, 1, "node"), row(600, 1, "zsh"));
        let (lost, below, older) = (row(520, 1, "python3"), row(521, 520, "sleep"), row(510, 1, "node"));
        let verdict = Verdict {
            descendants: BTreeMap::from([("G-1", vec![&vite])]),
            exceptions: vec![&tmux],
            helpers: BTreeSet::new(),
            orphans: Orphans {
                confirmed: BTreeMap::from([("F-4", vec![&stale])]),
                unknown: BTreeMap::from([("OLD-1", vec![&lost, &below]), ("OLD-9", vec![&older])]),
            },
            other_instances: BTreeMap::from([("H-2", vec![&other])]),
        };
        let summary = Summary::of(&verdict, &[], &Body::default(), &Measured::default(), None);
        assert_eq!(summary.unknown, [older.id, lost.id, below.id], "출처 불명의 신원이 판정의 것과 다르다");
    }

    /// **합계 = 앱 본체 + 이 실행의 셸과 자손**(프로세스 스펙 「수집 › 합계」). 셸 도우미도 셸의 몫이라 든다. 앱 본체는 Rust 본체와
    /// WebContent다(S39). 예외 · 다른 인스턴스는 빼고, 고아(확정 · 출처 불명)도 안 든다. 못 읽은 것은 건너뛰고 읽은 것끼리 더한다(화면의
    /// 트리 합과 같은 규칙) — 아무것도 못 읽었으면 합계가 없다(0이 아니다). **CPU도 같은 것끼리 더한다**(티켓 30) — 합계에 안 드는
    /// 것의 CPU는 안 들고, 앞 표본이 없어 못 잰 것은 건너뛴다.
    #[test]
    fn the_total_is_the_app_and_this_runs_shells_and_their_descendants() {
        let (gitstatusd, vite, esbuild) = (row(150, 100, "gitstatusd"), row(200, 100, "node"), row(210, 200, "esbuild"));
        let (tmux, stale, lost, other) = (row(300, 1, "tmux"), row(400, 1, "node"), row(500, 1, "sleep"), row(600, 1, "zsh"));
        let (zsh, bash) = (Identity { pid: 100, started_us: 1_100 }, Identity { pid: 110, started_us: 1_110 });
        let body = Body {
            rust: Some(Identity { pid: 42, started_us: 4_200 }),
            web_content: Some(Identity { pid: 77, started_us: 7_700 }),
        };
        let verdict = Verdict {
            descendants: BTreeMap::from([("G-1", vec![&gitstatusd, &vite, &esbuild]), ("G-2", vec![])]),
            exceptions: vec![&tmux],
            helpers: BTreeSet::from([gitstatusd.id]),
            orphans: Orphans {
                confirmed: BTreeMap::from([("F-4", vec![&stale])]),
                unknown: BTreeMap::from([("OLD-1", vec![&lost])]),
            },
            other_instances: BTreeMap::from([("H-2", vec![&other])]),
        };
        let readings = HashMap::from([
            (body.rust.unwrap(), reading(400 * MB)),
            (body.web_content.unwrap(), reading(200 * MB)),
            (zsh, reading(4 * MB)),
            (bash, reading(3 * MB)),
            (gitstatusd.id, reading(2 * MB)),
            (vite.id, reading(300 * MB)),
            // esbuild는 못 읽었다 — 그사이 끝났다.
            (tmux.id, reading(1_000 * MB)),
            (stale.id, reading(1_000 * MB)),
            (lost.id, reading(1_000 * MB)),
            (other.id, reading(1_000 * MB)),
        ]);
        let cpu = HashMap::from([
            (body.rust.unwrap(), 3.0),
            (body.web_content.unwrap(), 2.0),
            (vite.id, 10.0),
            // 셸은 앞 표본이 없다 — 막 떴다.
            (tmux.id, 90.0),
            (stale.id, 90.0),
            (lost.id, 90.0),
            (other.id, 90.0),
        ]);

        assert_eq!(
            targets(&verdict, &[zsh, bash], &body),
            BTreeSet::from([body.rust.unwrap(), body.web_content.unwrap(), zsh, bash, gitstatusd.id, vite.id, esbuild.id]),
            "합계에 드는 신원이 앱 본체 + 이 실행의 셸과 자손이 아니다"
        );
        let summary = Summary::of(&verdict, &[zsh, bash], &body, &Measured { readings, cpu }, None);
        assert_eq!(
            summary.total,
            Some((400 + 200 + 4 + 3 + 2 + 300) * MB),
            "합계가 어긋났다 — 예외 · 다른 인스턴스 · 고아가 섞였거나, 셸 · 도우미 · 앱 본체(WebContent 포함)가 빠졌다"
        );
        assert_eq!(summary.cpu, Some(15.0), "CPU가 합계에 드는 것의 잰 값끼리의 합이 아니다");
        let unread = Summary::of(&verdict, &[zsh, bash], &body, &Measured::default(), None);
        assert_eq!((unread.total, unread.cpu), (None, None), "아무것도 못 읽었는데 숫자가 섰다 — 모르는 것을 0이라 한다");
    }

    /// **앱 본체 = Rust 본체 + WebContent**(S39 · 티켓 30). WebContent의 신원을 모르거나(못 물었다) 그 프로세스를 못 읽었으면(그사이
    /// 끝났다) Rust 본체만 세고 「웹뷰 제외」다. 아무것도 못 읽었으면 앱 본체가 없다.
    #[test]
    fn the_app_body_is_the_rust_body_and_the_web_content() {
        let rust = Identity { pid: 42, started_us: 4_200 };
        let web = Identity { pid: 77, started_us: 7_700 };
        let both = Body { rust: Some(rust), web_content: Some(web) };
        let read_both = memory_only(HashMap::from([(rust, reading(410 * MB)), (web, reading(200 * MB))]));

        let counted = Summary::of(&empty(), &[], &both, &read_both, None);
        assert_eq!((counted.app, counted.webview_excluded), (Some(610 * MB), false), "WebContent를 앱 본체에 안 셌다");

        let unasked = Summary::of(&empty(), &[], &rust_only(rust), &read_both, None);
        assert_eq!(
            (unasked.app, unasked.total, unasked.webview_excluded),
            (Some(410 * MB), Some(410 * MB), true),
            "WebContent를 모르는데 「웹뷰 제외」가 안 섰다"
        );

        let gone = Summary::of(&empty(), &[], &both, &memory_only(HashMap::from([(rust, reading(410 * MB))])), None);
        assert_eq!((gone.app, gone.webview_excluded), (Some(410 * MB), true), "WebContent를 못 읽었는데 셌다고 한다");

        let nothing = Summary::of(&empty(), &[], &both, &Measured::default(), None);
        assert_eq!((nothing.app, nothing.webview_excluded), (None, true));
    }

    /// **추이 고리는 1시간치다**(프로세스 결정 10 · 티켓 30 AC). 360개를 넘으면 가장 오래된 것부터 버린다 — 늘 마지막 360개가 오래된
    /// 것부터 선다. 비어 있으면 빈 목록이다. 점은 때(에포크 ms)와 합계(바이트)로 와이어를 건넌다.
    #[test]
    fn the_trend_keeps_the_last_hour() {
        let point = |n: u64| Point { at: 1_000 * n, total: n * MB };
        let mut trend = Trend::default();
        assert_eq!(trend.points(), vec![], "빈 고리가 빈 목록이 아니다");

        for n in 1..=TREND_POINTS as u64 {
            trend.push(point(n));
        }
        assert_eq!(trend.points().len(), 360);
        assert_eq!(trend.points().first(), Some(&point(1)), "넘치기 전에 앞을 버렸다");
        trend.push(point(361));
        trend.push(point(362));
        let points = trend.points();
        assert_eq!(points.len(), 360, "넘쳤는데 앞을 안 버렸다");
        assert_eq!((points[0], points[359]), (point(3), point(362)), "버린 것이 가장 오래된 둘이 아니다");

        assert_eq!(serde_json::to_value(point(2)).unwrap(), serde_json::json!({ "at": 2_000, "total": 2 * MB }));
    }

    /// 배경 표본의 자리는 마지막 한 장을 쥐고, **합계가 있는 장마다** 추이에 한 점을 더한다(그 때와 함께). 합계를 못 읽은 장(macOS 밖)은
    /// 점이 없다 — 「0」을 그리면 모르는 것을 없다고 한다. 아직 없으면 둘 다 없다.
    #[test]
    fn the_background_keeps_the_last_summary_and_the_trend() {
        let background = Background::default();
        assert_eq!(background.latest(), None);
        assert_eq!(background.trend(), vec![]);
        let app = Identity { pid: 42, started_us: 4_200 };
        let first = Summary::of(&empty(), &[], &rust_only(app), &memory_only(HashMap::from([(app, reading(600 * MB))])), Some(1));
        let blank = Summary::of(&empty(), &[], &Body::default(), &Measured::default(), Some(2));
        background.keep(first, 10_000);
        background.keep(blank.clone(), 20_000);
        assert_eq!(background.latest(), Some(blank));
        assert_eq!(background.trend(), vec![Point { at: 10_000, total: 600 * MB }], "합계 없는 장이 점을 남겼거나 점이 빠졌다");
    }

    /// **추이 고리는 한 기준의 합계만 잇는다**(티켓 30 · S39). 웹뷰(WebContent)를 못 센 합계와 센 합계를 한 선에 이으면 웹뷰가 처음
    /// 셀 때 없던 상승(약 1.6GB)이 서고, 그 점이 한 시간 동안 스파크라인에 남는다. 그래서 웹뷰를 센 점이 처음 오면 그 앞의 제외 점을
    /// 비우고, 그 뒤 제외 표본(WebContent를 그사이 못 읽었다)은 점을 안 넣는다. **한 번도 못 셌으면** 제외 점끼리 잇는다(macOS 밖 ·
    /// 웹뷰가 끝내 답을 안 하는 기계 — 추이가 비지 않게). 합계 없는 장은 어느 쪽이든 점이 없다.
    #[test]
    fn the_trend_joins_totals_of_one_basis_only() {
        let sheet = |total: Option<u64>, webview_excluded: bool| Summary {
            total,
            cpu: None,
            app: None,
            webview_excluded,
            unknown: vec![],
            record_head: None,
        };
        let point = |at: u64, total: u64| Point { at, total };

        let never = Background::default();
        never.keep(sheet(Some(400 * MB), true), 10_000);
        never.keep(sheet(Some(410 * MB), true), 20_000);
        assert_eq!(never.trend(), vec![point(10_000, 400 * MB), point(20_000, 410 * MB)], "한 번도 못 셌는데 제외 점끼리 안 이었다");

        let counted = Background::default();
        counted.keep(sheet(Some(400 * MB), true), 10_000);
        counted.keep(sheet(Some(2_000 * MB), false), 20_000);
        assert_eq!(counted.trend(), vec![point(20_000, 2_000 * MB)], "웹뷰를 센 첫 점 앞의 제외 점이 남았다 — 없던 상승이 선다");
        counted.keep(sheet(Some(400 * MB), true), 30_000);
        counted.keep(sheet(None, false), 40_000);
        counted.keep(sheet(Some(2_010 * MB), false), 50_000);
        assert_eq!(
            counted.trend(),
            vec![point(20_000, 2_000 * MB), point(50_000, 2_010 * MB)],
            "웹뷰를 센 뒤의 제외 표본이 점을 넣었다 — 없던 하락이 선다"
        );
        assert_eq!(counted.latest(), Some(sheet(Some(2_010 * MB), false)), "점을 안 넣는 장도 마지막 장으로는 앉는다");
    }

    /// **배경 미터는 제 박자로 버린다**(티켓 30). 표본 사이가 10초를 조금 넘어도 CPU가 선다 — 화면의 나이(10초)로 버리면 요약의 CPU가
    /// 영영 없다. `CPU_STALE`을 넘으면 첫 표본으로 친다.
    #[test]
    fn the_background_meter_spans_its_own_beat() {
        let background = Background::default();
        let app = Identity { pid: 42, started_us: 4_200 };
        let t0 = Instant::now();
        assert_eq!(background.cpu(t0, HashMap::from([(app, 0)])), HashMap::new(), "첫 표본에 CPU가 섰다");
        let beat = t0 + EVERY + Duration::from_millis(40);
        assert!(background.cpu(beat, HashMap::from([(app, 1_000_000_000)])).contains_key(&app), "10초 조금 넘은 앞 표본을 버렸다");
        let late = beat + CPU_STALE + Duration::from_millis(1);
        assert_eq!(background.cpu(late, HashMap::from([(app, 2_000_000_000)])), HashMap::new(), "제 나이를 넘은 앞 표본과 이었다");
    }

    /// **WebContent를 묻는 자리**(티켓 30). 묻는 함수가 없으면(검사의 풀 · setup 전) 모르고 기다릴 답도 없다. 답한 pid는 신원으로 바꿔
    /// 쥐고, 답이 늦으면 마지막으로 안 신원을 쓴다(늦을 때마다 앱 본체가 웹뷰만큼 들쭉날쭉하지 않게). 「없다」고 답하면 쥔 것도 잊는다
    /// — 웹뷰가 없는데 옛 신원을 붙들지 않는다. 신원으로 못 바꾼 pid(그사이 끝났다)는 없다. 물음마다 그 물음까지 한 번도 제때 답을 못
    /// 들었는지도 준다 — 늦은 답만 받은 동안만 참이다.
    #[test]
    fn the_web_content_is_what_the_webview_answered_last() {
        let web = Identity { pid: 77, started_us: 7_700 };
        let identify = |pid: u32| (pid == 77).then_some(web);
        let asked = |id: Option<Identity>, unheard: bool| WebContentAsked { id, unheard };

        let seat = WebContent::default();
        assert_eq!(
            seat.identity(|_| panic!("묻는 함수가 없는데 커널을 읽었다")),
            asked(None, false),
            "묻는 함수가 없는데 신원이 섰거나 답을 기다린다고 한다 — 검사의 풀이 첫 장을 미룬다"
        );

        let answer = Arc::new(AtomicU32::new(u32::MAX));
        let answering = Arc::clone(&answer);
        seat.ask_with(move || match answering.load(Ordering::Relaxed) {
            0 => WebContentAnswer::Answered(None),
            u32::MAX => WebContentAnswer::Late,
            pid => WebContentAnswer::Answered(Some(pid)),
        });
        assert_eq!(seat.identity(identify), asked(None, true), "한 번도 답을 못 받았는데 신원이 섰거나, 늦은 답을 들은 답으로 쳤다");
        answer.store(77, Ordering::Relaxed);
        assert_eq!(seat.identity(identify), asked(Some(web), false), "답한 pid를 신원으로 안 바꿨거나, 답을 들었는데 못 들었다고 한다");
        answer.store(u32::MAX, Ordering::Relaxed);
        assert_eq!(
            seat.identity(identify),
            asked(Some(web), false),
            "답이 늦었는데 마지막으로 안 신원을 버렸거나, 한 번 들은 뒤의 늦은 답에 다시 못 들었다고 한다"
        );
        answer.store(0, Ordering::Relaxed);
        assert_eq!(seat.identity(identify), asked(None, false), "웹뷰가 없다고 답했는데 옛 신원을 붙들었다");
        answer.store(u32::MAX, Ordering::Relaxed);
        assert_eq!(seat.identity(identify), asked(None, false), "잊은 신원이 늦은 답에서 되살아났다");
        answer.store(88, Ordering::Relaxed);
        assert_eq!(seat.identity(identify), asked(None, false), "신원으로 못 바꾼 pid를 셌다");
    }

    /// **첫 장을 미루는 판단**(티켓 30). 웹뷰에게 물을 길은 걸렸는데 한 번도 제때 답을 못 받았고 상한 아래일 때만 미룬다. 앵커: 미루는
    /// 줄과 안 미루는 줄이 둘 다 있다.
    #[test]
    fn the_first_sample_is_held_only_while_the_webview_was_never_heard() {
        let cases = [
            ("한 번도 못 들었고 처음이다", true, 0, true),
            ("한 번도 못 들었고 상한 바로 아래다", true, FIRST_RETRIES - 1, true),
            ("한 번도 못 들었지만 상한에 닿았다", true, FIRST_RETRIES, false),
            ("들었다(또는 묻는 함수가 없다)", false, 0, false),
        ];
        for (what, unheard, held, want) in cases {
            assert_eq!(holds_first(unheard, held), want, "{what}");
        }
    }
}
