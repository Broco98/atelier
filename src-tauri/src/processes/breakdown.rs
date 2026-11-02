//! 나눔 — 맥 전체를 아틀리에 · 다른 앱 · 시스템 · 못 읽음으로 나눈다(restart 03-6 · 스펙 「합이 맞는다」 · 스토리 123 · 124).
//!
//! **줄을 더하면 합계가 된다.** 시스템 · 못 읽음은 맥 전체 측정값에서 읽은 합(아틀리에 + 다른 앱)을 뺀 몫이다 — 남의 uid, 못 읽은
//! 프로세스, 두 표본 사이에 끝난 것이 여기 든다. 그래서 줄(아틀리에 · 다른 앱 · 시스템 · 못 읽음)의 합이 합계이고, 합계는 맥 전체
//! 측정값이다.
//!
//! **읽은 합이 측정값을 넘는 표본이 있다.** 커널은 CPU tick을 몰아서 더하고(`machine`), 프로세스의 footprint는 압축된 쪽을 압축 전 크기로
//! 센다 — 맥 전체 메모리(active + wired + compressed)는 압축된 크기다. 그 표본에서는 시스템 · 못 읽음을 0으로 두고 **읽은 합을 합계로**
//! 쓴다(`over`). 그래도 줄의 합이 합계다. 화면은 그때 합계 칸에 「이 표본은 읽은 값의 합이에요」라고 말한다.
//!
//! CPU와 메모리를 따로 가른다 — 한쪽만 넘을 수 있다. 맥 전체를 못 잰 칸(macOS 밖 · 첫 표본 · tick이 안 흐른 박자)은 시스템과 합계가
//! 없다(「—」). 순수 함수다.

use serde::Serialize;

use super::apps::OtherApp;
use super::machine::Machine;
use super::summary::Totals;

/// 한 줄의 몫 — CPU%(맥 전체 = 100)와 메모리(바이트). 못 잰 칸은 `None`이다.
#[derive(Serialize, Debug, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Share {
    pub cpu: Option<f64>,
    pub memory: Option<u64>,
}

/// 읽은 합이 맥 전체 측정값을 넘은 칸 — 그 칸의 합계는 읽은 합이고 시스템 · 못 읽음은 0이다.
#[derive(Serialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Over {
    pub cpu: bool,
    pub memory: bool,
}

/// **한 표본의 나눔** — 다른 앱의 줄, 시스템 · 못 읽음, 합계. 아틀리에의 몫은 스냅샷의 `atelier`(`Totals`)다. 화면 스냅샷이 `breakdown`으로
/// 싣는다. 프런트의 `Breakdown`과 칸 이름으로 이어진다.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    /// 다른 앱 — 받은 차례 그대로다.
    pub apps: Vec<OtherApp>,
    /// 시스템 · 못 읽음 — 맥 전체 측정값 − 읽은 합. 0 아래로 내려가지 않는다.
    pub system: Share,
    /// 합계 — 줄(아틀리에 · 다른 앱 · 시스템 · 못 읽음)의 합. 읽은 합이 넘지 않은 칸은 맥 전체 측정값이다.
    pub total: Share,
    pub over: Over,
}

impl Breakdown {
    /// 아틀리에 합계와 다른 앱의 줄, 같은 표본의 맥 전체로 나눔을 짓는다.
    pub fn of(atelier: &Totals, apps: Vec<OtherApp>, mac: Option<Machine>) -> Breakdown {
        // 읽은 합 — 아틀리에부터 다른 앱을 차례로 더한다. 화면이 줄을 위에서부터 더하는 차례와 같다.
        let read_cpu: f64 = atelier.cpu.into_iter().chain(apps.iter().filter_map(|app| app.cpu)).sum();
        let read_memory: u64 = atelier.total.into_iter().chain(apps.iter().map(|app| app.memory)).sum();
        let (system_cpu, total_cpu, over_cpu) = match mac.and_then(|mac| mac.cpu) {
            None => (None, None, false),
            Some(measured) if read_cpu > measured => (Some(0.0), Some(read_cpu), true),
            Some(measured) => {
                let system = measured - read_cpu;
                // 합계는 줄의 합이다 — 측정값을 다시 쓰지 않는다(빼고 더한 부동소수의 끝자리가 줄의 합과 갈리지 않게).
                (Some(system), Some(read_cpu + system), false)
            }
        };
        let (system_memory, total_memory, over_memory) = match mac.and_then(|mac| mac.memory) {
            None => (None, None, false),
            Some(measured) if read_memory > measured => (Some(0), Some(read_memory), true),
            Some(measured) => (Some(measured - read_memory), Some(measured), false),
        };
        Breakdown {
            apps,
            system: Share { cpu: system_cpu, memory: system_memory },
            total: Share { cpu: total_cpu, memory: total_memory },
            over: Over { cpu: over_cpu, memory: over_memory },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1024 * 1024 * 1024;

    fn atelier(cpu: Option<f64>, memory: Option<u64>) -> Totals {
        Totals { total: memory, cpu, app: None, webview_excluded: false }
    }

    fn app(name: Option<&str>, cpu: Option<f64>, memory: u64) -> OtherApp {
        OtherApp { name: name.map(String::from), processes: 1, memory, cpu }
    }

    fn mac(cpu: Option<f64>, memory: Option<u64>) -> Option<Machine> {
        Some(Machine { cpu, memory, cores: 10 })
    }

    /// 줄 — 아틀리에, 다른 앱, 시스템 · 못 읽음 — 을 반올림 전 값으로 더한다. 화면이 보이는 줄이 이것들이다.
    fn rows_cpu(atelier: &Totals, split: &Breakdown) -> f64 {
        atelier.cpu.unwrap_or(0.0) + split.apps.iter().filter_map(|app| app.cpu).sum::<f64>() + split.system.cpu.unwrap_or(0.0)
    }

    fn rows_memory(atelier: &Totals, split: &Breakdown) -> u64 {
        atelier.total.unwrap_or(0) + split.apps.iter().map(|app| app.memory).sum::<u64>() + split.system.memory.unwrap_or(0)
    }

    /// **시스템 · 못 읽음은 맥 전체 측정값에서 읽은 합을 뺀 몫이고, 줄을 더하면 합계다**(스펙 「합이 맞는다」 · 스토리 124). 합계는 맥 전체
    /// 측정값이다. 예: 맥 전체 20%에 아틀리에 3.5 · Sketchpad 9.25 · 번들 밖 1.25 → 시스템 · 못 읽음 6.0. 메모리도 같다 — 8GB에 2 + 2 + 1 →
    /// 3GB.
    #[test]
    fn the_rows_add_up_to_the_mac() {
        let ours = atelier(Some(3.5), Some(2 * GB));
        let split = Breakdown::of(
            &ours,
            vec![app(Some("Sketchpad"), Some(9.25), 2 * GB), app(None, Some(1.25), GB)],
            mac(Some(20.0), Some(8 * GB)),
        );
        assert_eq!(split.system, Share { cpu: Some(6.0), memory: Some(3 * GB) }, "시스템 · 못 읽음이 측정값 − 읽은 합이 아니다");
        assert_eq!(split.total, Share { cpu: Some(20.0), memory: Some(8 * GB) }, "합계가 맥 전체 측정값이 아니다");
        assert_eq!(split.over, Over::default(), "읽은 합이 안 넘었는데 넘었다고 한다");
        assert!((rows_cpu(&ours, &split) - 20.0).abs() < 1e-9, "줄의 CPU를 더한 것이 합계가 아니다");
        assert_eq!(rows_memory(&ours, &split), 8 * GB, "줄의 메모리를 더한 것이 합계가 아니다");
    }

    /// **읽은 합이 측정값을 넘는 표본에서는 시스템 · 못 읽음이 0이고 읽은 합이 합계다**(스펙 「합이 맞는다」). 그래도 줄을 더하면 합계다 —
    /// 0 아래의 줄이 없다. 넘은 칸만 「넘음」이다: CPU가 넘은 표본(아틀리에 12 + 다른 앱 10 > 맥 전체 20)과 메모리가 넘은 표본(footprint
    /// 합 9GB > 8GB)을 따로 잰다.
    #[test]
    fn a_sample_whose_reads_exceed_the_mac_totals_the_reads() {
        let busy = atelier(Some(12.0), Some(GB));
        let cpu_over = Breakdown::of(&busy, vec![app(Some("Notebook"), Some(10.0), GB)], mac(Some(20.0), Some(8 * GB)));
        assert_eq!(cpu_over.system, Share { cpu: Some(0.0), memory: Some(6 * GB) }, "넘은 칸의 시스템 · 못 읽음이 0이 아니다");
        assert_eq!(cpu_over.total, Share { cpu: Some(22.0), memory: Some(8 * GB) }, "넘은 칸의 합계가 읽은 합이 아니다");
        assert_eq!(cpu_over.over, Over { cpu: true, memory: false });
        assert!((rows_cpu(&busy, &cpu_over) - 22.0).abs() < 1e-9, "넘은 표본에서 줄의 CPU를 더한 것이 합계가 아니다");

        let heavy = atelier(Some(1.0), Some(5 * GB));
        let memory_over = Breakdown::of(&heavy, vec![app(None, Some(2.0), 4 * GB)], mac(Some(20.0), Some(8 * GB)));
        assert_eq!(memory_over.system, Share { cpu: Some(17.0), memory: Some(0) });
        assert_eq!(memory_over.total, Share { cpu: Some(20.0), memory: Some(9 * GB) });
        assert_eq!(memory_over.over, Over { cpu: false, memory: true });
        assert_eq!(rows_memory(&heavy, &memory_over), 9 * GB, "넘은 표본에서 줄의 메모리를 더한 것이 합계가 아니다");
    }

    /// **맥 전체를 못 잰 칸은 시스템 · 못 읽음도 합계도 없다**(「—」 — 모르는 것을 0이라 하지 않는다). macOS 밖은 둘 다 없고, 첫 표본(tick이 안
    /// 흘렀다)은 CPU만 없다 — 메모리는 첫 장부터 선다. 다른 앱의 줄은 그대로 실린다.
    #[test]
    fn an_unmeasured_mac_leaves_the_system_and_the_total_unknown() {
        let ours = atelier(None, Some(2 * GB));
        let elsewhere = Breakdown::of(&ours, vec![], None);
        assert_eq!((elsewhere.system, elsewhere.total, elsewhere.over), (Share::default(), Share::default(), Over::default()));

        let first = Breakdown::of(&ours, vec![app(Some("Chatter"), None, GB)], mac(None, Some(8 * GB)));
        assert_eq!(first.system, Share { cpu: None, memory: Some(5 * GB) });
        assert_eq!(first.total, Share { cpu: None, memory: Some(8 * GB) });
        assert_eq!(first.apps, vec![app(Some("Chatter"), None, GB)], "다른 앱의 줄이 받은 그대로가 아니다");
    }
}
