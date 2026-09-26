//! 화면 스냅샷 — `Processes` 화면이 열려 있는 동안 2초마다 묻는 값(프로세스 결정 10 · 티켓 26).
//!
//! **판정 결과를 그대로 옮기고, 풀의 셸 목록을 곁들인다.** 판정은 스냅샷을 빌려 보는 값이라(`Verdict<'a>`) IPC로 못 나간다 —
//! 여기서 행을 제 것으로 떠 담는다. 묶음의 이름과 모양은 판정의 것 그대로다: 화면이 묶음을 다시 가르면 판정이 두 벌이 되고,
//! 셸을 닫을 때 끝나는 것과 화면이 그 셸 밑에 보인 것이 갈린다.
//!
//! 풀의 셸 목록은 판정에 없는 것이다. 판정의 셸 목록에는 이 실행의 기록에만 있는 키(띄우는 중인 셸, 끝내기가 도는 셸)도 들고,
//! 셸을 가리키는 pty id는 없다. 화면이 스냅샷의 셸을 스토어의 셸과 셸 키로 잇고(27), 스토어가 모르는 셸을 pty id로 닫는다(32).
//!
//! 지표(메모리 · CPU · 포트)는 아직 없다 — 28이 더한다.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::verdict::Verdict;
use super::{Identity, Proc};

/// 화면 스냅샷 한 장. 프런트의 `ProcessSnapshot`(`src/features/processes/types.ts`)과 **칸 이름으로만** 이어진다 — 어긋나면
/// 컴파일도 타입 검사도 통과하고 화면만 조용히 빈다. 그래서 와이어 모양을 아래 검사가 글자로 못박는다.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSnapshot {
    /// 판정 결과.
    pub verdict: Groups,
    /// 풀에 앉은 셸 — pty id 순.
    pub pool: Vec<PoolShell>,
}

/// 풀에 앉은 셸 하나. **pty id와 셸 키를 함께 싣는다** — 셸 키는 스냅샷의 셸을 스토어의 셸과 잇는 값이고(스토어의
/// `Shell.shellKey`, 티켓 23), pty id는 스토어가 모르는 셸을 닫는 값이다(`pty_kill`은 pty id로 풀에서 뺀다).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PoolShell {
    pub pty_id: u32,
    pub shell_key: String,
}

/// 판정의 묶음 — `verdict::Verdict`의 칸 그대로다. 각 칸의 뜻은 그쪽 머리말이 든다.
#[derive(Serialize, Debug, Clone, Default, PartialEq, Eq)]
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
#[derive(Serialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrphanGroups {
    pub confirmed: BTreeMap<String, Vec<Row>>,
    pub unknown: BTreeMap<String, Vec<Row>>,
}

/// 프로세스 한 행 — 화면이 쓸 칸만 뜬다. 신원은 [끝내기]가 끝내기 IPC에 되돌려 줄 값이다(「화면에 보인 표본의 신원」,
/// 프로세스 스펙 판 04 › 동작). 부모 pid는 자손 트리의 들여쓰기가, 이름 둘과 명령줄은 행의 글자와 툴팁이 쓴다.
///
/// 빼는 칸 — uid(판정이 이미 이 uid의 것만 가른다), 프로세스 그룹과 표식(묶음이 이미 그 뜻을 들었다).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
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
}

impl ScreenSnapshot {
    /// 판정 하나와 풀의 셸 목록으로 한 장을 짓는다.
    pub fn of(verdict: &Verdict, pool: Vec<PoolShell>) -> Self {
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
            pool,
        }
    }
}

fn rows(procs: &[&Proc]) -> Vec<Row> {
    procs.iter().map(|proc| Row::from(*proc)).collect()
}

fn by_key(groups: &BTreeMap<&str, Vec<&Proc>>) -> BTreeMap<String, Vec<Row>> {
    groups.iter().map(|(key, procs)| (key.to_string(), rows(procs))).collect()
}

impl From<&Proc> for Row {
    fn from(proc: &Proc) -> Self {
        Row {
            id: proc.id,
            ppid: proc.ppid,
            name: proc.name.clone(),
            argv0: proc.argv0.clone(),
            command: proc.command.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;
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

    /// **화면 스냅샷이 싣는 모양**(티켓 26). 프런트가 칸 이름으로 읽는다 — 글자로 못박는다.
    ///
    /// 판정의 묶음 다섯이 모두 서게 한 장을 짓는다: 셸 G-1의 자손(부른 이름 · 명령줄이 읽힌 vite와 그 밑의 esbuild, 셸 도우미
    /// gitstatusd), 예외(tmux), 확정 고아와 출처 불명, 다른 인스턴스. 셸 자신의 pid나 uid · 그룹 · 표식 같은 판정 안쪽 칸은
    /// 안 나간다. 풀의 셸 목록은 pty id와 셸 키다.
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
            PoolShell { pty_id: 1, shell_key: "G-1".into() },
            PoolShell { pty_id: 2, shell_key: "G-2".into() },
        ];

        let plain = |pid: u32, ppid: u32, name: &str| {
            serde_json::json!({
                "id": { "pid": pid, "startedUs": 1_000 + u64::from(pid) },
                "ppid": ppid,
                "name": name,
                "argv0": null,
                "command": null,
            })
        };
        assert_eq!(
            serde_json::to_value(ScreenSnapshot::of(&verdict, pool)).unwrap(),
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
                            },
                            plain(210, 200, "esbuild"),
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
                    { "ptyId": 1, "shellKey": "G-1" },
                    { "ptyId": 2, "shellKey": "G-2" },
                ],
            })
        );
    }
}
