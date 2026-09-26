//! 요약 — nav 메타가 10초마다 묻는 값(프로세스 결정 10 · 11 · 티켓 29).
//!
//! nav `Processes` 옆 메타는 두 세계의 모든 화면에 늘 선다. 평소에는 아틀리에의 메모리 합계이고, 손볼 것이 새로 생기면 그 앞에
//! `●`가 선다. 화면이 닫혀 있어도 그 값이 있어야 해서 **Rust가 10초마다 모은다**(배경 표본 — `pty::sample_in_background`). 화면
//! 스냅샷(2초, `screen`)은 화면이 열려 있을 때만 온다.
//!
//! 모으는 것은 셋이다.
//! - **합계** = 앱 본체 + 이 실행의 모든 셸과 자손(셸 도우미 포함). 예외와 다른 인스턴스는 빼고, 고아도 안 든다(고아는 따로
//!   적는다 — 요약 카드의 몫, 30). 앱 본체는 **Rust 본체만** 센다: 웹뷰(WebContent)는 부모가 launchd라 트리로 안 잡히고, 그 pid를
//!   묻는 길은 30이 시험한다. 그래서 「웹뷰 제외」를 싣는다.
//! - **출처 불명의 신원 목록**(pid, 시작 시각). 수가 아니라 신원이다(티켓 29 「스펙과 다른 점」) — `●`는 본 것의 집합과 견줘 새로
//!   생긴 것에만 서는데(S41), 수만으로는 하나가 사라지고 다른 하나가 생긴 것을 못 본다. 수는 목록의 길이다.
//! - **`●`를 켜는 기록의 머리 id**(`cleanup_log::look_head`) — 무엇이 켜는 기록인지는 그쪽이 가른다.
//!
//! 합계의 메모리는 화면의 트리 합과 같은 규칙이다(`src/features/processes/metrics.ts`의 `sumMetrics`) — 읽은 것끼리 더하고, 아무것도
//! 못 읽었으면 없다. 그래야 nav와 화면이 같은 앱을 두고 다른 말을 하지 않는다.
//!
//! **이 파일은 값만 짓는다.** 스냅샷 · 판정 · 지표 읽기 · 기록 읽기를 잇는 자리는 풀을 쥔 `pty::summarize`다(화면 스냅샷과 같은 순서).

use std::collections::{BTreeSet, HashMap};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;

use super::metrics::Reading;
use super::verdict::Verdict;
use super::Identity;

/// 배경 표본의 박자(프로세스 스펙 S37 — 배경 10초, 화면 2초). 프런트가 요약을 묻는 박자도 같다(`SUMMARY_EVERY_MS`).
pub const EVERY: Duration = Duration::from_secs(10);

/// 요약 한 장. 프런트의 `ProcessSummary`(`src/features/processes/types.ts`)와 **칸 이름으로만** 이어진다 — 와이어 모양을 아래
/// 검사가 글자로 못박는다.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// 앱 전체 메모리 합계(`phys_footprint`, 바이트). 아무것도 못 읽었으면(macOS 밖) `None`이다 — nav 메타가 숫자를 안 세운다.
    pub total: Option<u64>,
    /// 앱 본체에 웹뷰(WebContent)를 안 셌다(프로세스 스펙 S39). 30의 귀속 시험 전까지 늘 참이다 — 요약 카드(30)가 이 표시를 보인다.
    pub webview_excluded: bool,
    /// 출처 불명의 신원 — pid 순, 겹침 없음.
    pub unknown: Vec<Identity>,
    /// `●`를 켜는 기록 중 가장 새것의 번호(`cleanup_log::look_head`). 없으면 `None`.
    pub record_head: Option<u64>,
}

/// **합계에 드는 신원** — 앱 본체(Rust)와 이 실행의 셸 프로세스, 판정이 셸마다 가른 자손(셸 도우미 포함). 이것만 지표를 읽는다
/// (프로세스 스펙 S38의 「우리 트리만」). 예외 · 다른 인스턴스 · 고아는 판정이 다른 묶음에 넣어 여기 안 든다 — 화면 스냅샷의
/// `screen::targets`와 다른 것이 그 셋이다.
pub fn targets(verdict: &Verdict, shells: &[Identity], app: Option<Identity>) -> BTreeSet<Identity> {
    verdict
        .descendants
        .values()
        .flatten()
        .map(|proc| proc.id)
        .chain(shells.iter().copied())
        .chain(app)
        .collect()
}

impl Summary {
    /// 판정 하나와 이 실행의 셸 프로세스, 앱 본체, 읽은 지표, 기록의 머리로 한 장을 짓는다.
    pub fn of(
        verdict: &Verdict,
        shells: &[Identity],
        app: Option<Identity>,
        readings: &HashMap<Identity, Reading>,
        record_head: Option<u64>,
    ) -> Summary {
        let read: Vec<u64> =
            targets(verdict, shells, app).iter().filter_map(|id| readings.get(id).map(|reading| reading.memory)).collect();
        let unknown: BTreeSet<Identity> = verdict.orphans.unknown.values().flatten().map(|proc| proc.id).collect();
        Summary {
            total: (!read.is_empty()).then(|| read.iter().sum()),
            webview_excluded: true,
            unknown: unknown.into_iter().collect(),
            record_head,
        }
    }
}

/// 배경 표본의 자리 — 마지막 요약 한 장(티켓 29). 요약 IPC가 이것을 돌려준다. 1시간 고리(360개)는 30이 여기에 더한다.
#[derive(Default)]
pub struct Background {
    latest: Mutex<Option<Summary>>,
}

impl Background {
    /// 잠금이 오염됐으면 안을 꺼내 이어 간다 — 잃어도 요약 한 장이다.
    fn lock(&self) -> MutexGuard<'_, Option<Summary>> {
        self.latest.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 새 표본을 앉힌다.
    pub fn keep(&self, summary: Summary) {
        *self.lock() = Some(summary);
    }

    /// 마지막 표본. 아직 한 장도 없으면 `None`이다.
    pub fn latest(&self) -> Option<Summary> {
        self.lock().clone()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet, HashMap};

    use super::*;
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

    /// **요약이 싣는 모양**(티켓 29). 프런트가 칸 이름으로 읽는다 — 글자로 못박는다. 출처 불명은 신원(pid · 시작 시각)의 목록이고,
    /// 합계는 바이트, 머리 id는 기록 번호다. 웹뷰는 아직 안 센다.
    #[test]
    fn the_summary_crosses_the_wire_in_the_shape_the_nav_reads() {
        let lost = row(500, 1, "sleep");
        let verdict = Verdict {
            orphans: Orphans { unknown: BTreeMap::from([("OLD-1", vec![&lost])]), ..Orphans::default() },
            ..empty()
        };
        let app = Identity { pid: 42, started_us: 4_200 };
        let summary = Summary::of(&verdict, &[], Some(app), &HashMap::from([(app, reading(610 * MB))]), Some(7));
        assert_eq!(
            serde_json::to_value(summary).unwrap(),
            serde_json::json!({
                "total": 610 * MB,
                "webviewExcluded": true,
                "unknown": [{ "pid": 500, "startedUs": 1_500 }],
                "recordHead": 7,
            })
        );
        let blank = Summary::of(&empty(), &[], None, &HashMap::new(), None);
        assert_eq!(
            serde_json::to_value(blank).unwrap(),
            serde_json::json!({ "total": null, "webviewExcluded": true, "unknown": [], "recordHead": null })
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
        let summary = Summary::of(&verdict, &[], None, &HashMap::new(), None);
        assert_eq!(summary.unknown, [older.id, lost.id, below.id], "출처 불명의 신원이 판정의 것과 다르다");
    }

    /// **합계 = 앱 본체 + 이 실행의 셸과 자손**(프로세스 스펙 「수집 › 합계」). 셸 도우미도 셸의 몫이라 든다. 예외 · 다른 인스턴스는
    /// 빼고, 고아(확정 · 출처 불명)도 안 든다. 못 읽은 것은 건너뛰고 읽은 것끼리 더한다(화면의 트리 합과 같은 규칙) — 아무것도 못
    /// 읽었으면 합계가 없다(0이 아니다).
    #[test]
    fn the_total_is_the_app_and_this_runs_shells_and_their_descendants() {
        let (gitstatusd, vite, esbuild) = (row(150, 100, "gitstatusd"), row(200, 100, "node"), row(210, 200, "esbuild"));
        let (tmux, stale, lost, other) = (row(300, 1, "tmux"), row(400, 1, "node"), row(500, 1, "sleep"), row(600, 1, "zsh"));
        let (zsh, bash) = (Identity { pid: 100, started_us: 1_100 }, Identity { pid: 110, started_us: 1_110 });
        let app = Identity { pid: 42, started_us: 4_200 };
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
            (app, reading(600 * MB)),
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

        assert_eq!(
            targets(&verdict, &[zsh, bash], Some(app)),
            BTreeSet::from([app, zsh, bash, gitstatusd.id, vite.id, esbuild.id]),
            "합계에 드는 신원이 앱 본체 + 이 실행의 셸과 자손이 아니다"
        );
        assert_eq!(
            Summary::of(&verdict, &[zsh, bash], Some(app), &readings, None).total,
            Some((600 + 4 + 3 + 2 + 300) * MB),
            "합계가 어긋났다 — 예외 · 다른 인스턴스 · 고아가 섞였거나, 셸 · 도우미 · 앱 본체가 빠졌다"
        );
        assert_eq!(
            Summary::of(&verdict, &[zsh, bash], Some(app), &HashMap::new(), None).total,
            None,
            "아무것도 못 읽었는데 합계가 섰다 — 모르는 것을 0이라 한다"
        );
    }

    /// 배경 표본의 자리는 마지막 한 장을 쥔다 — 아직 없으면 없다.
    #[test]
    fn the_background_keeps_the_last_summary() {
        let background = Background::default();
        assert_eq!(background.latest(), None);
        let first = Summary::of(&empty(), &[], None, &HashMap::new(), Some(1));
        let second = Summary::of(&empty(), &[], None, &HashMap::new(), Some(2));
        background.keep(first);
        background.keep(second.clone());
        assert_eq!(background.latest(), Some(second));
    }
}
