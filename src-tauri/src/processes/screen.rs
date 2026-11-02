//! 화면 스냅샷 — `Processes` 화면이 열려 있는 동안 2초마다 묻는 값(프로세스 결정 10 · 티켓 26).
//!
//! **판정 결과를 그대로 옮기고, 풀의 셸 목록을 곁들인다.** 판정은 스냅샷을 빌려 보는 값이라(`Verdict<'a>`) IPC로 못 나간다 —
//! 여기서 행을 제 것으로 떠 담는다. 묶음의 이름과 모양은 판정의 것 그대로다: 화면이 묶음을 다시 가르면 판정이 두 벌이 되고,
//! 셸을 닫을 때 끝나는 것과 화면이 그 셸 밑에 보인 것이 갈린다.
//!
//! 풀의 셸 목록은 판정에 없는 것이다. 판정의 셸 목록에는 이 실행의 기록에만 있는 키(띄우는 중인 셸, 끝내기가 도는 셸)도 들고,
//! 셸을 가리키는 pty id는 없다. 화면이 스냅샷의 셸을 스토어의 셸과 셸 키로 잇고(티켓 27), 스토어가 모르는 셸을 pty id로 닫는다(티켓 32).
//!
//! 셸마다 마지막 출력 시각을 싣는다(티켓 27 — 「조용함」의 경과).
//!
//! **행마다 지표(메모리 · CPU · 포트)를 싣는다**(티켓 28). 읽는 것은 판정이 묶음에 넣은 행과 풀의 셸 프로세스뿐이다
//! (`targets` — 프로세스 스펙 S38의 「우리 트리만」). 셸 프로세스 자신의 행은 판정에 없어 그 지표는 풀의 셸이 싣는다. 트리의 합
//! (셸 행 · work 행)은 화면이 짓는다 — work은 화면만 아는 층이다.
//!
//! **다른 인스턴스는 실행마다 빌드 종류와 버전을 싣는다**(티켓 31 · 프로세스 스펙 S54). 판정의 묶음은 셸 키마다라 실행을 모른다 —
//! 그 키를 낸 실행을 인스턴스 기록에서 찾아 묶고, 두 칸은 그 실행의 기록 파일에서 읽는다(`instances`).
//!
//! **머리 값도 같은 표본에서 싣는다**(restart 03-5 「한 표본」) — 잰 시각, 맥 전체(`machine::Machine`), 아틀리에 합계(`summary::Totals`
//! — 요약과 같은 함수). 화면을 보는 동안 머리와 줄과 메모리 카드가 이 한 장에서 선다. 그 밖(nav 메타)은 배경 10초 요약이다.
//!
//! **줄을 더하면 합계가 되게 싣는다**(restart 03-6) — 아틀리에 앱의 줄(앱 본체 · 웹뷰 — `BodyRows`), 다른 앱의 줄과 시스템 · 못 읽음 ·
//! 합계(`breakdown::Breakdown`). 아틀리에의 몫은 `atelier`다. 다른 앱은 같은 표본의 같은 미터로 쟀다(`service`).

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::apps::OtherApp;
use super::breakdown::Breakdown;
use super::instances::{Build, InstanceFile};
use super::machine::Machine;
use super::metrics::Measured;
use super::summary::{sum_read, Body, Totals};
use super::verdict::{InstanceRecord, Verdict};
use super::{shell_key, webkit, Identity, Proc};

/// 화면 스냅샷 한 장. 프런트의 `ProcessSnapshot`(`src/features/processes/types.ts`)과 **칸 이름으로만** 이어진다 — 어긋나면
/// 컴파일도 타입 검사도 통과하고 화면만 조용히 빈다. 그래서 와이어 모양을 아래 검사가 글자로 못박는다.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSnapshot {
    /// 판정 결과.
    pub verdict: Groups,
    /// 풀에 앉은 셸 — pty id 순.
    pub pool: Vec<PoolShell>,
    /// 다른 인스턴스 묶음(`verdict.otherInstances`)의 행을 낸 실행들 — 세대 순(티켓 31).
    pub instances: Vec<Instance>,
    /// `●`를 켜는 정리 기록 중 가장 새것의 번호(`cleanup_log::look_head` — 요약의 `record_head`와 같은 값). 화면이 보는 동안 이 번호와
    /// 출처 불명을 본 것으로 앉힌다(티켓 29 · 프로세스 스펙 S41) — 요약은 최대 20초 늦어, 그것으로만 앉히면 화면에서 본 기록이 떠난
    /// 뒤에 `●`를 켠다. 없으면 `None`.
    pub record_head: Option<u64>,
    /// 이 장을 잰 시각(에포크 ms) — 머리의 「…에 잰 값」(restart 03-5 · 스토리 129).
    pub measured_at: u64,
    /// 맥 전체 — 줄과 같은 순간에 읽었다(restart 03-5). macOS 밖이면 `None`이다 — 화면이 「측정 안 됨」으로 말한다.
    pub mac: Option<Machine>,
    /// 아틀리에 합계 — 줄과 같은 표본에서 지었다(restart 03-5). 요약의 그것과 같은 함수다(`Totals::of`).
    pub atelier: Totals,
    /// 아틀리에 앱의 줄 — 앱 본체와 웹뷰(restart 03-6). 판정의 행이 아니라 따로 싣는다 — 판정은 앱 자신을 안 가른다.
    pub body: BodyRows,
    /// 맥 전체의 나눔 — 다른 앱의 줄, 시스템 · 못 읽음, 합계(restart 03-6). 줄(아틀리에 · 다른 앱 · 시스템 · 못 읽음)을 더하면 합계다.
    pub breakdown: Breakdown,
}

/// **아틀리에 앱의 줄**(restart 03-6 · 시안 Processes 「아틀리에 앱」) — 앱 본체(Rust)와 웹뷰. 웹뷰 줄은 WebContent와 앱이 책임지는
/// WebKit 도우미(GPU · Networking — restart 03-8)의 합이다. 아틀리에 합계의 앱 본체가 이 둘이다(S39). 웹뷰를 못 물었거나 못 읽었고
/// 도우미도 없으면 그 줄의 숫자가 빈다(「—」 — 요약 카드의 「웹뷰 제외」와 같은 때다).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BodyRows {
    pub rust: Metrics,
    pub webview: Metrics,
    /// 웹뷰 줄에 함께 센 WebKit 도우미의 갈래(`webkit::Helper::kind` — `GPU` · `Networking`) — 이 표본에서 읽은 것만, 갈래 순, 겹침 없음.
    /// 책임 프로세스를 묻는 함수가 없거나 앱이 제 책임 프로세스가 아니면(셸에서 띄운 개발 빌드) 빈다 — 그 도우미는 「다른 앱」에 있다.
    pub webkit: Vec<String>,
}

impl BodyRows {
    /// 앱 본체의 신원과 이번 표본의 지표로 두 줄을 짓는다. 웹뷰 줄은 WebContent와 WebKit 도우미 중 읽은 것끼리 더한다(CPU는 잰 것끼리 —
    /// 아틀리에 합계와 같은 규칙).
    fn of(body: &Body, measured: &Measured) -> Self {
        let read: Vec<&webkit::Helper> = body.webkit.iter().filter(|helper| measured.readings.contains_key(&helper.id)).collect();
        let webview = body.web_content.into_iter().chain(read.iter().map(|helper| helper.id));
        let mut kinds: Vec<String> = read.iter().map(|helper| helper.kind.clone()).collect();
        kinds.sort();
        kinds.dedup();
        BodyRows { rust: metrics_of(measured, body.rust), webview: metrics_summed(measured, webview), webkit: kinds }
    }
}

/// 여러 프로세스의 지표를 한 줄로 더한다 — 읽은 것끼리(아무것도 못 읽었으면 없다), 포트는 모아 오름차순 · 겹침 없이.
fn metrics_summed(measured: &Measured, ids: impl Iterator<Item = Identity>) -> Metrics {
    let rows: Vec<Metrics> = ids.map(|id| metrics_of(measured, Some(id))).collect();
    let mut ports: Vec<u16> = rows.iter().flat_map(|row| row.ports.iter().copied()).collect();
    ports.sort_unstable();
    ports.dedup();
    Metrics {
        memory: sum_read(rows.iter().map(|row| row.memory)),
        cpu: sum_read(rows.iter().map(|row| row.cpu)),
        ports,
    }
}

/// **다른 인스턴스 하나** — 지금 떠 있는 다른 아틀리에 실행(프로세스 스펙 S54 · 티켓 31). 화면이 이 실행마다 빌드 종류와 버전을
/// 머리로 세우고 그 밑에 그 실행의 셸 키가 낸 행을 보인다. 보기만 한다 — 그 실행이 제 셸을 닫을 때 끝낸다.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub generation: String,
    /// 빌드 종류. 그 실행의 기록 파일을 못 읽었으면(판정 뒤에 닫혀 지웠다) `None`이다.
    pub build: Option<Build>,
    /// 앱 버전. `build`와 같이 빈다.
    pub version: Option<String>,
    /// 이 실행의 셸 키 중 다른 인스턴스 묶음에 행이 선 것 — 판정의 순서(키 순) 그대로다.
    pub shell_keys: Vec<String>,
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
    /// CPU% — 맥 전체가 100이다(S37 · restart 03-5 — 코어 열 개인 맥에서 한 코어를 다 쓰면 10). 첫 표본이거나 못 읽었으면 `None`.
    pub cpu: Option<f64>,
    /// TCP LISTEN 로컬 포트 — 오름차순, 겹침 없음.
    pub ports: Vec<u16>,
}

/// 이번 표본에서 한 프로세스의 지표를 와이어 모양으로 뜬다. 신원을 모르면(셸 프로세스를 못 읽었다) 비었다.
fn metrics_of(measured: &Measured, id: Option<Identity>) -> Metrics {
    let Some(id) = id else {
        return Metrics::default();
    };
    let reading = measured.readings.get(&id);
    Metrics {
        memory: reading.map(|reading| reading.memory),
        cpu: measured.cpu.get(&id).copied(),
        ports: reading.map(|reading| reading.ports.clone()).unwrap_or_default(),
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
    /// 지표(티켓 28). 고아 · 다른 인스턴스 · 예외 묶음의 행도 싣는다 — 그 묶음의 숫자 칸도 이 값에서 선다(티켓 31).
    pub metrics: Metrics,
}

impl ScreenSnapshot {
    /// 판정 하나와 풀의 셸 목록, 앱 본체, 이번 표본의 지표, 다른 앱의 줄(`apps`), 다른 인스턴스의 실행들(`instances`), 정리 기록의
    /// 머리로 한 장을 짓는다. 아틀리에 합계는 풀의 셸 프로세스를 이 실행의 셸로 센다(요약의 `gather`와 같다). 나눔은 그 합계와 다른 앱의
    /// 줄을 같은 표본의 맥 전체에서 가른다.
    pub fn of(
        verdict: &Verdict,
        pool: Vec<PoolShell>,
        body: &Body,
        measured: &Measured,
        apps: Vec<OtherApp>,
        instances: Vec<Instance>,
        record_head: Option<u64>,
    ) -> Self {
        let shells: Vec<Identity> = pool.iter().filter_map(|shell| shell.process).collect();
        let rows = |procs: &[&Proc]| -> Vec<Row> { procs.iter().map(|proc| Row::of(proc, measured)).collect() };
        let by_key = |groups: &BTreeMap<&str, Vec<&Proc>>| -> BTreeMap<String, Vec<Row>> {
            groups.iter().map(|(key, procs)| (key.to_string(), rows(procs))).collect()
        };
        let atelier = Totals::of(verdict, &shells, body, measured);
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
            pool: pool.into_iter().map(|shell| PoolShell { metrics: metrics_of(measured, shell.process), ..shell }).collect(),
            instances,
            record_head,
            measured_at: measured.measured_at,
            mac: measured.machine,
            body: BodyRows::of(body, measured),
            breakdown: Breakdown::of(&atelier, apps, measured.machine),
            atelier,
        }
    }
}

/// **다른 인스턴스 묶음의 셸 키를 그 키를 낸 실행으로 묶는다**(티켓 31). 실행은 판정이 받은 인스턴스 기록(`records`)에서 판정과
/// 같은 규칙(`shell_key::of_generation` — 「세대-숫자」)으로 찾는다: 판정이 다른 인스턴스로 가른 키는 살아 있는 실행의 기록이 있는 키다.
/// 기록에 없는 키는 판정이 다른 인스턴스로 가르지 않으므로 여기 안 선다 — 화면은 실행에 안 묶인 키를 따로 세운다.
///
/// 빌드 종류와 버전은 그 실행의 기록 파일에서 읽는다(`file` — 판정의 기록이 안 싣는 칸이다). 행이 선 실행의 파일만 읽는다.
pub fn instances(
    verdict: &Verdict,
    records: &[InstanceRecord],
    file: impl Fn(&str) -> Option<InstanceFile>,
) -> Vec<Instance> {
    let mut keys_by_run: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    for key in verdict.other_instances.keys() {
        if let Some(record) = records.iter().find(|record| shell_key::of_generation(key, &record.generation)) {
            keys_by_run.entry(record.generation.as_str()).or_default().push(key.to_string());
        }
    }
    keys_by_run
        .into_iter()
        .map(|(generation, shell_keys)| {
            let file = file(generation);
            Instance {
                generation: generation.to_string(),
                build: file.as_ref().map(|file| file.build),
                version: file.map(|file| file.version),
                shell_keys,
            }
        })
        .collect()
}

/// **포트까지 읽을 신원 — 우리 트리의 프로세스만**(프로세스 스펙 S38). 판정이 묶음에 넣은 행 전부와 풀의 셸 프로세스, 앱 본체다 — 아틀리에
/// 합계에 드는 것과 같다(`summary::targets` — restart 03-6). 이 맥의 다른 프로세스는 포트를 읽지 않는다: 포트는 프로세스마다 fd를 훑는
/// 일이라, 표 전체를 2초마다 훑으면 화면 하나가 이 맥의 모든 소켓을 뒤진다(같은 uid의 그것들은 메모리 · CPU만 읽는다 — `apps`). 예외
/// 묶음도 우리 트리 안의 것이다 — 판정이 셸별 자손이나 표식 묶음에 들 행에서만 예외를 가른다(launchd의 `ssh-agent`, 앱 밖 tmux는 판정
/// 밖이라 여기 안 온다). 셸 도우미는 셸의 자손 묶음에 이미 들었다.
pub fn targets(verdict: &Verdict, pool: &[PoolShell], body: &Body) -> BTreeSet<Identity> {
    let shells: Vec<Identity> = pool.iter().filter_map(|shell| shell.process).collect();
    super::summary::targets(verdict, &shells, body)
}

impl Row {
    fn of(proc: &Proc, measured: &Measured) -> Self {
        Row {
            id: proc.id,
            ppid: proc.ppid,
            name: proc.name.clone(),
            argv0: proc.argv0.clone(),
            command: proc.command.clone(),
            metrics: metrics_of(measured, Some(proc.id)),
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
            path: None,
            shell_key: None,
        }
    }

    fn pool_shell(pty_id: u32, key: &str, last_output_ms: u64, process: Option<Identity>) -> PoolShell {
        PoolShell { pty_id, shell_key: key.into(), last_output_ms, process, metrics: Metrics::default() }
    }

    /// **화면 스냅샷이 싣는 모양**(티켓 26 · 27 · 28). 프런트가 칸 이름으로 읽는다 — 글자로 못박는다.
    ///
    /// 다른 인스턴스는 실행마다 빌드 종류 · 버전과 그 실행의 셸 키가 선다(티켓 31) — 기록을 못 읽은 실행은 두 칸이 빈다. `●`를 켜는
    /// 정리 기록의 머리 번호도 싣는다(티켓 29 — 화면이 보는 동안 본 것으로 앉힌다).
    ///
    /// 판정의 묶음 다섯이 모두 서게 한 장을 짓는다: 셸 G-1의 자손(부른 이름 · 명령줄이 읽힌 vite와 그 밑의 esbuild, 셸 도우미
    /// gitstatusd), 예외(tmux), 확정 고아와 출처 불명, 다른 인스턴스. 셸 자신의 pid나 uid · 그룹 · 표식 같은 판정 안쪽 칸은
    /// 안 나간다. 풀의 셸 목록은 pty id와 셸 키, 그리고 셸이 마지막으로 무언가를 찍은 때(에포크 ms — 티켓 27의 「조용함」 경과)다.
    ///
    /// 행마다 지표가 선다(티켓 28): vite는 메모리 · CPU% · LISTEN 포트를, esbuild는 첫 표본이라 CPU%가 없고, 못 읽은 행은 모두 빈다.
    /// 풀의 셸은 셸 프로세스 자신의 지표를 싣고, 그 신원은 안 나간다.
    ///
    /// **한 표본의 머리 값도 싣는다**(restart 03-5) — 잰 시각(에포크 ms), 맥 전체(CPU% · 메모리 · 코어 수), 아틀리에 합계(메모리 · CPU ·
    /// 앱 본체 · 「웹뷰 제외」). 화면을 보는 동안 머리와 줄과 메모리 카드가 이 한 장에서 선다. 맥 전체를 안 쟀으면(macOS 밖) `mac`이
    /// `null`이다 — 「측정 안 됨」.
    ///
    /// **아틀리에 앱의 줄과 나눔도 싣는다**(restart 03-6) — 앱 본체(Rust)와 웹뷰(WebContent)의 지표(`body`), 다른 앱의 줄 · 시스템 ·
    /// 못 읽음 · 합계(`breakdown`). 아틀리에 합계에는 예외 · 고아 · 다른 인스턴스도 든다.
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
        // 앱 본체는 Rust 본체만 읽었다 — 웹뷰를 못 물었다(「웹뷰 제외」).
        let app = Identity { pid: 42, started_us: 4_200 };
        let body = Body { rust: Some(app), web_content: None, ..Body::default() };
        let measured = Measured {
            readings: HashMap::from([
                (vite.id, reading(335_544_320, vec![5173, 24678])),
                (esbuild.id, reading(20_971_520, vec![])),
                (zsh, reading(4_194_304, vec![])),
                (app, reading(419_430_400, vec![])),
                (tmux.id, reading(10_485_760, vec![])),
            ]),
            cpu: HashMap::from([(vite.id, 12.5), (zsh, 0.25), (app, 1.25), (tmux.id, 0.5)]),
            machine: Some(Machine { cpu: Some(37.5), memory: Some(12_884_901_888), cores: 10 }),
            measured_at: 1_758_000_100_000,
        };

        let instances = vec![
            Instance { generation: "H".into(), build: Some(Build::Release), version: Some("0.15.0".into()), shell_keys: vec!["H-2".into()] },
            Instance { generation: "D".into(), build: None, version: None, shell_keys: vec!["D-7".into()] },
        ];

        // 다른 앱 — 번들 하나와 번들 밖의 줄(`apps::of`가 짓는다).
        let apps = vec![
            OtherApp { name: Some("Sketchpad".into()), processes: 2, memory: 1_073_741_824, cpu: Some(9.5) },
            OtherApp { name: None, processes: 3, memory: 67_108_864, cpu: Some(0.5) },
        ];

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
            serde_json::to_value(ScreenSnapshot::of(&verdict, pool, &body, &measured, apps, instances, Some(7))).unwrap(),
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
                    "exceptions": [{
                        "id": { "pid": 300, "startedUs": 1_300 },
                        "ppid": 1,
                        "name": "tmux",
                        "argv0": null,
                        "command": null,
                        "metrics": { "memory": 10_485_760u64, "cpu": 0.5, "ports": [] },
                    }],
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
                "instances": [
                    { "generation": "H", "build": "release", "version": "0.15.0", "shellKeys": ["H-2"] },
                    { "generation": "D", "build": null, "version": null, "shellKeys": ["D-7"] },
                ],
                "recordHead": 7,
                "measuredAt": 1_758_000_100_000u64,
                "mac": { "cpu": 37.5, "memory": 12_884_901_888u64, "cores": 10 },
                // 아틀리에 합계 — 앱 본체 + 이 실행의 셸(G-1의 zsh) + 셸의 자손(vite · esbuild · gitstatusd) + 예외(tmux)다. 고아 · 다른
                // 인스턴스도 들지만 이 장에서는 못 읽었다. 줄과 같은 표본의 값이다.
                "atelier": {
                    "total": 790_626_304u64,
                    "cpu": 14.5,
                    "app": 419_430_400u64,
                    "webviewExcluded": true,
                },
                // 아틀리에 앱의 줄 — 앱 본체(Rust)는 읽었고, 웹뷰(WebContent)는 못 물어 비었다. 앱이 책임지는 WebKit 도우미도 없다(restart 03-8).
                "body": {
                    "rust": { "memory": 419_430_400u64, "cpu": 1.25, "ports": [] },
                    "webview": unmeasured,
                    "webkit": [],
                },
                // 나눔 — 읽은 합(아틀리에 14.5 + 다른 앱 9.5 + 0.5 = 24.5%, 1,931,476,992B)을 맥 전체(37.5%, 12GB)에서 뺀 것이 시스템 ·
                // 못 읽음이고, 합계는 맥 전체다.
                "breakdown": {
                    "apps": [
                        { "name": "Sketchpad", "processes": 2, "memory": 1_073_741_824u64, "cpu": 9.5 },
                        { "name": null, "processes": 3, "memory": 67_108_864u64, "cpu": 0.5 },
                    ],
                    "system": { "cpu": 13.0, "memory": 10_953_424_896u64 },
                    "total": { "cpu": 37.5, "memory": 12_884_901_888u64 },
                    "over": { "cpu": false, "memory": false },
                },
            })
        );
        let blank =
            serde_json::to_value(ScreenSnapshot::of(&verdict, vec![], &Body::default(), &Measured::default(), vec![], vec![], None)).unwrap();
        assert_eq!(blank["recordHead"], serde_json::Value::Null, "머리가 없는데 번호가 섰다");
        assert_eq!(blank["mac"], serde_json::Value::Null, "맥 전체를 안 쟀는데(macOS 밖) 값이 섰다 — 화면이 「측정 안 됨」을 못 말한다");
        assert_eq!(
            blank["atelier"],
            serde_json::json!({ "total": null, "cpu": null, "app": null, "webviewExcluded": true }),
            "아무것도 못 읽었는데 아틀리에 합계에 숫자가 섰다"
        );
        assert_eq!(
            blank["breakdown"],
            serde_json::json!({
                "apps": [],
                "system": { "cpu": null, "memory": null },
                "total": { "cpu": null, "memory": null },
                "over": { "cpu": false, "memory": false },
            }),
            "맥 전체를 안 쟀는데 시스템 · 못 읽음이나 합계가 섰다"
        );
        assert_eq!(
            blank["body"],
            serde_json::json!({ "rust": unmeasured, "webview": unmeasured, "webkit": [] }),
            "앱 본체를 모르는데 숫자가 섰다"
        );
    }

    /// **웹뷰 줄은 WebContent와 앱이 책임지는 WebKit 도우미의 합이다**(restart 03-8 · 시안 Processes 「웹뷰 — WebContent · GPU · Networking」).
    /// 읽은 것끼리 더하고(CPU는 잰 것끼리), 이 표본에서 읽은 도우미의 갈래를 갈래 순으로 싣는다 — 화면이 줄의 글자로 쓴다. 그사이 끝나 못
    /// 읽은 도우미는 숫자에도 갈래에도 없다. WebContent를 못 물었어도 읽은 도우미는 줄에 선다 — 아틀리에 합계가 그것을 세므로 줄을 더하면
    /// 합계가 돼야 한다. 앱 본체(`atelier.app`)도 같은 것을 센다.
    #[test]
    fn the_webview_row_adds_the_webkit_helpers_to_the_web_content() {
        use crate::processes::webkit::Helper;

        let (app, page) = (Identity { pid: 42, started_us: 4_200 }, Identity { pid: 77, started_us: 7_700 });
        let helper = |pid: u32, kind: &str| Helper { id: Identity { pid, started_us: u64::from(pid) * 100 }, kind: kind.into() };
        let (render, relay, gone) = (helper(78, "Render"), helper(79, "Relay"), helper(80, "Paint"));
        let webkit = vec![relay.clone(), render.clone(), gone];
        let reading = |memory: u64| Reading { memory, cpu_ns: 0, ports: vec![] };
        let measured = Measured {
            readings: HashMap::from([
                (app, reading(400)),
                (page, reading(200)),
                (render.id, reading(60)),
                (relay.id, Reading { memory: 30, cpu_ns: 0, ports: vec![8080] }),
            ]),
            cpu: HashMap::from([(app, 1.0), (page, 1.0), (render.id, 0.5)]),
            ..Measured::default()
        };
        let empty = Verdict {
            descendants: BTreeMap::new(),
            exceptions: vec![],
            helpers: BTreeSet::new(),
            orphans: Orphans::default(),
            other_instances: BTreeMap::new(),
        };

        let body = Body { rust: Some(app), web_content: Some(page), webkit: webkit.clone() };
        let sheet = serde_json::to_value(ScreenSnapshot::of(&empty, vec![], &body, &measured, vec![], vec![], None)).unwrap();
        assert_eq!(
            sheet["body"],
            serde_json::json!({
                "rust": { "memory": 400, "cpu": 1.0, "ports": [] },
                "webview": { "memory": 290, "cpu": 1.5, "ports": [8080] },
                "webkit": ["Relay", "Render"],
            }),
            "웹뷰 줄이 WebContent와 읽은 WebKit 도우미의 합이 아니다"
        );
        assert_eq!(sheet["atelier"]["app"], 690, "앱 본체가 웹뷰 줄과 같은 것을 안 셌다");

        let unasked = Body { rust: Some(app), web_content: None, webkit };
        let sheet = serde_json::to_value(ScreenSnapshot::of(&empty, vec![], &unasked, &measured, vec![], vec![], None)).unwrap();
        assert_eq!(
            sheet["body"]["webview"],
            serde_json::json!({ "memory": 90, "cpu": 0.5, "ports": [8080] }),
            "WebContent를 못 물었을 때 웹뷰 줄이 합계가 센 도우미를 빠뜨렸다"
        );
        assert_eq!(sheet["atelier"]["webviewExcluded"], true, "WebContent를 못 셌는데 웹뷰를 셌다고 한다");
    }

    /// **지표는 우리 트리의 프로세스만 읽는다**(프로세스 스펙 S38). 판정이 묶음에 넣은 행 전부(자손 · 예외 · 고아 두 갈래 · 다른
    /// 인스턴스)와 풀의 셸 프로세스, 그리고 앱 본체(Rust · WebContent — restart 03-5: 아틀리에 합계를 같은 표본에서 짓는다)다 — 판정의
    /// 결과에서만 고르므로 어느 묶음에도 안 든 이 맥의 다른 프로세스는 이를 길이 없다. 신원을 모르는 셸(리눅스, 뜨자마자 끝남)은 읽을
    /// 것이 없다. 묶음 하나를 빠뜨리면 그 묶음의 숫자 칸(티켓 31)이 빈다.
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

        let (rust, web) = (Identity { pid: 42, started_us: 4_200 }, Identity { pid: 77, started_us: 7_700 });
        let body = Body { rust: Some(rust), web_content: Some(web), ..Body::default() };

        assert_eq!(
            targets(&verdict, &pool, &body),
            BTreeSet::from([zsh, vite.id, tmux.id, stale.id, unknown.id, other.id, rust, web])
        );
    }

    fn record(generation: &str) -> InstanceRecord {
        InstanceRecord {
            generation: generation.into(),
            app: Identity { pid: 9_000, started_us: 1 },
            shell_keys: vec![],
            updated_us: 0,
        }
    }

    /// **다른 인스턴스를 실행마다 묶는다**(티켓 31 · 프로세스 스펙 S54). 판정의 다른 인스턴스 묶음은 셸 키마다라, 그 키를 낸 실행(세대)을
    /// 기록에서 찾아 실행 하나에 그 실행의 키를 모은다 — 실행 순은 세대 순, 키는 판정의 순서 그대로다. 빌드 종류와 버전은 그 실행의 기록
    /// 파일에서 읽는다(판정의 기록은 두 칸을 안 싣는다). **세대는 접두가 아니라 「세대-숫자」로 가른다** — 세대 `H`의 키 `H-1`과 세대
    /// `HX`의 키 `HX-1`은 다른 실행이다(앵커). 파일을 못 읽은 실행(그새 닫혀 지웠다)은 빌드 · 버전이 비고 키는 그대로 선다. 다른
    /// 인스턴스 행이 없는 실행(셸만 있고 띄운 것이 없다)은 안 선다 — 이 묶음은 행을 보이는 자리다.
    #[test]
    fn other_instances_are_grouped_by_the_run_that_issued_their_keys() {
        let (a, b, c, d) = (row(600, 1, "zsh"), row(610, 1, "node"), row(620, 1, "zsh"), row(630, 1, "sleep"));
        let verdict = Verdict {
            other_instances: BTreeMap::from([
                ("H-1", vec![&a]),
                ("H-2", vec![&b]),
                ("HX-1", vec![&c]),
                ("D-4", vec![&d]),
            ]),
            descendants: BTreeMap::new(),
            exceptions: vec![],
            helpers: BTreeSet::new(),
            orphans: Orphans::default(),
        };
        let records = [record("G"), record("H"), record("HX"), record("D"), record("Q")];
        let file = |generation: &str| -> Option<InstanceFile> {
            let (build, version) = match generation {
                "H" => (Build::Release, "0.15.0"),
                "HX" => (Build::Dev, "0.16.0-dev"),
                _ => return None,
            };
            Some(InstanceFile {
                app: Identity { pid: 9_000, started_us: 1 },
                build,
                version: version.into(),
                shell_keys: vec![],
                updated_us: 0,
            })
        };

        let instance = |generation: &str, build: Option<Build>, version: Option<&str>, keys: &[&str]| Instance {
            generation: generation.into(),
            build,
            version: version.map(String::from),
            shell_keys: keys.iter().map(|key| key.to_string()).collect(),
        };
        assert_eq!(
            instances(&verdict, &records, file),
            vec![
                instance("D", None, None, &["D-4"]),
                instance("H", Some(Build::Release), Some("0.15.0"), &["H-1", "H-2"]),
                instance("HX", Some(Build::Dev), Some("0.16.0-dev"), &["HX-1"]),
            ]
        );
    }
}
