//! 화면 스냅샷 — `Processes` 화면이 열려 있는 동안 2초마다 묻는 값(프로세스 결정 10 · 티켓 26).
//!
//! **판정 결과를 그대로 옮기고, 풀의 셸 목록을 곁들인다.** 판정은 스냅샷을 빌려 보는 값이라(`Verdict<'a>`) IPC로 못 나간다 —
//! 여기서 행을 제 것으로 떠 담는다. 묶음의 이름과 모양은 판정의 것 그대로다: 화면이 묶음을 다시 가르면 판정이 두 벌이 되고,
//! 셸을 닫을 때 끝나는 것과 화면이 그 셸 밑에 보인 것이 갈린다.
//!
//! 풀의 셸 목록은 판정에 없는 것이다. 판정의 셸 목록에는 이 실행의 기록에만 있는 키(띄우는 중인 셸, 끝내기가 도는 셸)도 들고,
//! 셸을 가리키는 pty id는 없다. 화면이 스냅샷의 셸을 스토어의 셸과 셸 키로 잇고(27), 스토어가 모르는 셸을 pty id로 닫는다(32).
//!
//! 셸마다 마지막 출력 시각을 싣는다(티켓 27 — 「조용함」의 경과).
//!
//! **행마다 지표(메모리 · CPU · 포트)를 싣는다**(티켓 28). 읽는 것은 판정이 묶음에 넣은 행과 풀의 셸 프로세스뿐이다
//! (`targets` — 프로세스 스펙 S38의 「우리 트리만」). 셸 프로세스 자신의 행은 판정에 없어 그 지표는 풀의 셸이 싣는다. 트리의 합
//! (셸 행 · work 행)은 화면이 짓는다 — work은 화면만 아는 층이다.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;

use super::metrics::Reading;
use super::verdict::Verdict;
use super::{Identity, Proc};

/// 화면 스냅샷 한 장. 프런트의 `ProcessSnapshot`(`src/features/processes/types.ts`)과 **칸 이름으로만** 이어진다 — 어긋나면
/// 컴파일도 타입 검사도 통과하고 화면만 조용히 빈다. 그래서 와이어 모양을 아래 검사가 글자로 못박는다.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSnapshot {
    /// 판정 결과.
    pub verdict: Groups,
    /// 풀에 앉은 셸 — pty id 순.
    pub pool: Vec<PoolShell>,
}

/// 풀에 앉은 셸 하나. **pty id와 셸 키를 함께 싣는다** — 셸 키는 스냅샷의 셸을 스토어의 셸과 잇는 값이고(스토어의
/// `Shell.shellKey`, 티켓 23), pty id는 스토어가 모르는 셸을 닫는 값이다(`pty_kill`은 pty id로 풀에서 뺀다).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PoolShell {
    pub pty_id: u32,
    pub shell_key: String,
    /// 셸이 마지막으로 무언가를 찍은 때(에포크 ms). 셸 행의 「조용함」 경과가 이 값에서 잰다(티켓 27) — 사람이 친 글자의 메아리도
    /// 출력이라 이 값 뒤로 셸에 아무 일이 없었다. 아직 아무것도 안 찍었으면 띄운 때다.
    pub last_output_ms: u64,
    /// 셸 프로세스의 신원 — 그 지표를 찾는 열쇠다. 와이어에는 안 나간다(화면이 쓸 곳이 없다). 못 읽었으면(리눅스, 뜨자마자
    /// 끝남) `None`이고 지표가 빈다.
    #[serde(skip)]
    pub process: Option<Identity>,
    /// 셸 프로세스 **자신의** 지표(티켓 28). 판정은 셸 자신을 행으로 안 싣는다 — 셸 행의 트리 합은 화면이 이것과 자손을 더해 짓는다.
    pub metrics: Metrics,
}

/// 프로세스 하나의 지표(프로세스 결정 10 · 프로세스 스펙 S37 · S38). 못 읽은 것은 비었다 — 화면이 「—」로 세운다.
#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    /// `phys_footprint`(바이트) — 활성 상태 보기의 「메모리」 열과 같은 값이다. 못 읽었으면 `None`.
    pub memory: Option<u64>,
    /// CPU%(한 코어를 다 쓰면 100). 첫 표본이거나 못 읽었으면 `None`.
    pub cpu: Option<f64>,
    /// TCP LISTEN 로컬 포트 — 오름차순, 겹침 없음.
    pub ports: Vec<u16>,
}

/// 이번 표본의 지표 — 커널에서 읽은 것과 앞 표본으로 잰 CPU%. 신원으로 찾는다.
#[derive(Debug, Default)]
pub struct Measured {
    pub readings: HashMap<Identity, Reading>,
    pub cpu: HashMap<Identity, f64>,
}

impl Measured {
    fn metrics(&self, id: Option<Identity>) -> Metrics {
        let Some(id) = id else {
            return Metrics::default();
        };
        let reading = self.readings.get(&id);
        Metrics {
            memory: reading.map(|reading| reading.memory),
            cpu: self.cpu.get(&id).copied(),
            ports: reading.map(|reading| reading.ports.clone()).unwrap_or_default(),
        }
    }
}

/// 판정의 묶음 — `verdict::Verdict`의 칸 그대로다. 각 칸의 뜻은 그쪽 머리말이 든다.
#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Groups {
    /// 셸 키마다 그 셸의 자손. 셸 자신은 안 든다.
    pub descendants: BTreeMap<String, Vec<Row>>,
    pub exceptions: Vec<Row>,
    /// 셸 도우미 — 묶음이 아니라 표시라 신원만 싣는다. 자손 행과 신원으로 짝짓는다.
    pub helpers: BTreeSet<Identity>,
    pub orphans: OrphanGroups,
    pub other_instances: BTreeMap<String, Vec<Row>>,
}

/// 고아의 두 갈래 — `verdict::Orphans` 그대로다.
#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrphanGroups {
    pub confirmed: BTreeMap<String, Vec<Row>>,
    pub unknown: BTreeMap<String, Vec<Row>>,
}

/// 프로세스 한 행 — 화면이 쓸 칸만 뜬다. 신원은 [끝내기]가 끝내기 IPC에 되돌려 줄 값이다(「화면에 보인 표본의 신원」,
/// 프로세스 스펙 판 04 › 동작). 부모 pid는 자손 트리의 들여쓰기가, 이름 둘과 명령줄은 행의 글자와 툴팁이 쓴다.
///
/// 빼는 칸 — uid(판정이 이미 이 uid의 것만 가른다), 프로세스 그룹과 표식(묶음이 이미 그 뜻을 들었다).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: Identity,
    pub ppid: u32,
    /// 커널 이름.
    pub name: String,
    /// 부른 이름(argv[0], 경로째). env를 못 읽은 행은 `None`.
    pub argv0: Option<String>,
    /// 명령줄 전체. env를 못 읽은 행은 `None`.
    pub command: Option<String>,
    /// 지표(티켓 28). 고아 · 다른 인스턴스 · 예외 묶음의 행도 싣는다 — 그 묶음의 숫자 칸은 31이 이 값으로 채운다.
    pub metrics: Metrics,
}

impl ScreenSnapshot {
    /// 판정 하나와 풀의 셸 목록, 그리고 이번 표본의 지표로 한 장을 짓는다.
    pub fn of(verdict: &Verdict, pool: Vec<PoolShell>, measured: &Measured) -> Self {
        let rows = |procs: &[&Proc]| -> Vec<Row> { procs.iter().map(|proc| Row::of(proc, measured)).collect() };
        let by_key = |groups: &BTreeMap<&str, Vec<&Proc>>| -> BTreeMap<String, Vec<Row>> {
            groups.iter().map(|(key, procs)| (key.to_string(), rows(procs))).collect()
        };
        ScreenSnapshot {
            verdict: Groups {
                descendants: by_key(&verdict.descendants),
                exceptions: rows(&verdict.exceptions),
                helpers: verdict.helpers.clone(),
                orphans: OrphanGroups {
                    confirmed: by_key(&verdict.orphans.confirmed),
                    unknown: by_key(&verdict.orphans.unknown),
                },
                other_instances: by_key(&verdict.other_instances),
            },
            pool: pool.into_iter().map(|shell| PoolShell { metrics: measured.metrics(shell.process), ..shell }).collect(),
        }
    }
}

/// **지표를 읽을 신원 — 우리 트리의 프로세스만**(프로세스 스펙 S38). 판정이 묶음에 넣은 행 전부와 풀의 셸 프로세스다. 이 맥의
/// 다른 프로세스는 읽지 않는다: 포트는 프로세스마다 fd를 훑는 일이라, 표 전체를 2초마다 훑으면 화면 하나가 이 맥의 모든 소켓을
/// 뒤진다. 셸 도우미는 셸의 자손 묶음에 이미 들었다.
pub fn targets(verdict: &Verdict, pool: &[PoolShell]) -> BTreeSet<Identity> {
    let grouped = verdict
        .descendants
        .values()
        .chain(verdict.orphans.confirmed.values())
        .chain(verdict.orphans.unknown.values())
        .chain(verdict.other_instances.values())
        .flatten()
        .chain(verdict.exceptions.iter());
    grouped.map(|proc| proc.id).chain(pool.iter().filter_map(|shell| shell.process)).collect()
}

impl Row {
    fn of(proc: &Proc, measured: &Measured) -> Self {
        Row {
            id: proc.id,
            ppid: proc.ppid,
            name: proc.name.clone(),
            argv0: proc.argv0.clone(),
            command: proc.command.clone(),
            metrics: measured.metrics(Some(proc.id)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet, HashMap};

    use super::*;
    use crate::processes::metrics::Reading;
    use crate::processes::verdict::Orphans;

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

    fn pool_shell(pty_id: u32, key: &str, last_output_ms: u64, process: Option<Identity>) -> PoolShell {
        PoolShell { pty_id, shell_key: key.into(), last_output_ms, process, metrics: Metrics::default() }
    }

    /// **화면 스냅샷이 싣는 모양**(티켓 26 · 27 · 28). 프런트가 칸 이름으로 읽는다 — 글자로 못박는다.
    ///
    /// 판정의 묶음 다섯이 모두 서게 한 장을 짓는다: 셸 G-1의 자손(부른 이름 · 명령줄이 읽힌 vite와 그 밑의 esbuild, 셸 도우미
    /// gitstatusd), 예외(tmux), 확정 고아와 출처 불명, 다른 인스턴스. 셸 자신의 pid나 uid · 그룹 · 표식 같은 판정 안쪽 칸은
    /// 안 나간다. 풀의 셸 목록은 pty id와 셸 키, 그리고 셸이 마지막으로 무언가를 찍은 때(에포크 ms — 티켓 27의 「조용함」 경과)다.
    ///
    /// 행마다 지표가 선다(티켓 28): vite는 메모리 · CPU% · LISTEN 포트를, esbuild는 첫 표본이라 CPU%가 없고, 못 읽은 행은 모두 빈다.
    /// 풀의 셸은 셸 프로세스 자신의 지표를 싣고, 그 신원은 안 나간다.
    #[test]
    fn the_snapshot_crosses_the_wire_in_the_shape_the_frontend_reads() {
        let mut vite = row(200, 100, "node");
        vite.argv0 = Some("/opt/homebrew/bin/node".into());
        vite.command = Some("node vite --port 5173".into());
        vite.shell_key = Some("G-1".into());
        let esbuild = row(210, 200, "esbuild");
        let gitstatusd = row(150, 100, "gitstatusd");
        let tmux = row(300, 1, "tmux");
        let stale = row(400, 1, "node");
        let unknown = row(500, 1, "sleep");
        let other = row(600, 1, "zsh");
        let zsh = Identity { pid: 100, started_us: 1_100 };

        let verdict = Verdict {
            descendants: BTreeMap::from([("G-1", vec![&gitstatusd, &vite, &esbuild]), ("G-2", vec![])]),
            exceptions: vec![&tmux],
            helpers: BTreeSet::from([gitstatusd.id]),
            orphans: Orphans {
                confirmed: BTreeMap::from([("F-4", vec![&stale])]),
                unknown: BTreeMap::from([("OLD-1", vec![&unknown])]),
            },
            other_instances: BTreeMap::from([("H-2", vec![&other])]),
        };
        let pool = vec![
            pool_shell(1, "G-1", 1_758_000_000_000, Some(zsh)),
            pool_shell(2, "G-2", 1_758_000_060_000, None),
        ];
        let reading = |memory: u64, ports: Vec<u16>| Reading { memory, cpu_ns: 0, ports };
        let measured = Measured {
            readings: HashMap::from([
                (vite.id, reading(335_544_320, vec![5173, 24678])),
                (esbuild.id, reading(20_971_520, vec![])),
                (zsh, reading(4_194_304, vec![])),
            ]),
            cpu: HashMap::from([(vite.id, 12.5), (zsh, 0.25)]),
        };

        let unmeasured = serde_json::json!({ "memory": null, "cpu": null, "ports": [] });
        let plain = |pid: u32, ppid: u32, name: &str| {
            serde_json::json!({
                "id": { "pid": pid, "startedUs": 1_000 + u64::from(pid) },
                "ppid": ppid,
                "name": name,
                "argv0": null,
                "command": null,
                "metrics": unmeasured,
            })
        };
        assert_eq!(
            serde_json::to_value(ScreenSnapshot::of(&verdict, pool, &measured)).unwrap(),
            serde_json::json!({
                "verdict": {
                    "descendants": {
                        "G-1": [
                            plain(150, 100, "gitstatusd"),
                            {
                                "id": { "pid": 200, "startedUs": 1_200 },
                                "ppid": 100,
                                "name": "node",
                                "argv0": "/opt/homebrew/bin/node",
                                "command": "node vite --port 5173",
                                "metrics": { "memory": 335_544_320u64, "cpu": 12.5, "ports": [5173, 24678] },
                            },
                            {
                                "id": { "pid": 210, "startedUs": 1_210 },
                                "ppid": 200,
                                "name": "esbuild",
                                "argv0": null,
                                "command": null,
                                "metrics": { "memory": 20_971_520u64, "cpu": null, "ports": [] },
                            },
                        ],
                        "G-2": [],
                    },
                    "exceptions": [plain(300, 1, "tmux")],
                    "helpers": [{ "pid": 150, "startedUs": 1_150 }],
                    "orphans": {
                        "confirmed": { "F-4": [plain(400, 1, "node")] },
                        "unknown": { "OLD-1": [plain(500, 1, "sleep")] },
                    },
                    "otherInstances": { "H-2": [plain(600, 1, "zsh")] },
                },
                "pool": [
                    {
                        "ptyId": 1,
                        "shellKey": "G-1",
                        "lastOutputMs": 1_758_000_000_000u64,
                        "metrics": { "memory": 4_194_304u64, "cpu": 0.25, "ports": [] },
                    },
                    { "ptyId": 2, "shellKey": "G-2", "lastOutputMs": 1_758_000_060_000u64, "metrics": unmeasured },
                ],
            })
        );
    }

    /// **지표는 우리 트리의 프로세스만 읽는다**(프로세스 스펙 S38). 판정이 묶음에 넣은 행 전부(자손 · 예외 · 고아 두 갈래 · 다른
    /// 인스턴스)와 풀의 셸 프로세스다 — 판정의 결과에서만 고르므로 어느 묶음에도 안 든 이 맥의 다른 프로세스는 이를 길이 없다. 신원을
    /// 모르는 셸(리눅스, 뜨자마자 끝남)은 읽을 것이 없다. 묶음 하나를 빠뜨리면 그 묶음의 숫자 칸(31)이 빈다.
    #[test]
    fn only_our_tree_is_measured() {
        let (vite, tmux, stale, unknown, other) =
            (row(200, 100, "node"), row(300, 1, "tmux"), row(400, 1, "node"), row(500, 1, "sleep"), row(600, 1, "zsh"));
        let zsh = Identity { pid: 100, started_us: 1_100 };
        let verdict = Verdict {
            descendants: BTreeMap::from([("G-1", vec![&vite])]),
            exceptions: vec![&tmux],
            helpers: BTreeSet::new(),
            orphans: Orphans {
                confirmed: BTreeMap::from([("F-4", vec![&stale])]),
                unknown: BTreeMap::from([("OLD-1", vec![&unknown])]),
            },
            other_instances: BTreeMap::from([("H-2", vec![&other])]),
        };
        let pool = [pool_shell(1, "G-1", 0, Some(zsh)), pool_shell(2, "G-2", 0, None)];

        assert_eq!(targets(&verdict, &pool), BTreeSet::from([zsh, vite.id, tmux.id, stale.id, unknown.id, other.id]));
    }
}
