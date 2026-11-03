//! 다른 앱 — 이 맥의 같은 uid 프로세스 중 우리 트리 밖의 것(restart 03-6 · 시안 ProcessSheet 「값이 오는 곳」).
//!
//! `Processes`는 「지금 무엇이 내 컴퓨터를 먹나」에 답한다. 아틀리에만 보이면 나머지가 어디 갔는지 모른다 — 그래서 같은 uid의 프로세스는
//! **앱 번들로 묶어** CPU와 메모리를 읽는다. 남의 uid는 못 읽는다 — 그 몫은 「시스템 · 못 읽음」이다(`breakdown`).
//!
//! - **무엇을 읽나**(`targets`): 스냅샷에서 이 uid인 행 가운데 우리 트리(`summary::targets` — 아틀리에 합계에 드는 것) 밖의 것. 포트는
//!   읽지 않는다 — fd 훑기는 지금처럼 우리 트리만 한다(`metrics::read_usage`).
//! - **어디에 묶나**(`bundle_name`): 실행 파일 경로의 **가장 바깥** `.app` 번들이다. 브라우저의 렌더러는 그 앱 번들 안의
//!   `… Helper (Renderer).app`에서 뜨지만 그 브라우저에 든다. 번들 밖의 것(데몬 · XPC 서비스 · 명령줄 도구)은 한 줄에 모은다.
//! - **줄**(`OtherApp`): 이름이 같은 번들은 한 줄이다 — 같은 앱이 두 자리(설치본 · 크립텍스)에서 뜨면 두 줄로 갈리지 않게. 읽은
//!   프로세스만 센다. 못 읽은 것의 몫도 「시스템 · 못 읽음」이다.
//!
//! 보기만 한다 — 끝내기가 없다(시안 「다른 앱」). 이 파일은 순수 함수다 — 커널은 수집(`snapshot` — 경로)과 지표(`metrics`)가 읽는다.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::metrics::Measured;
use super::{Identity, Proc, Snapshot};

/// **다른 앱 한 줄** — 앱 번들 하나, 또는 번들 밖의 프로세스를 모은 줄. 화면 스냅샷이 `breakdown.apps`로 싣는다. 프런트의 `OtherApp`과 칸
/// 이름으로 이어진다. CPU가 `f64`라 `Eq`가 없다.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OtherApp {
    /// 앱 번들 이름(`.app`을 뗀 것). 번들 밖의 프로세스를 모은 줄은 `None`이다 — 화면의 「그 밖의 프로세스」.
    pub name: Option<String>,
    /// 이 줄에 든 프로세스 수 — 읽은 것만이다.
    pub processes: u32,
    /// 읽은 것의 메모리(`phys_footprint`) 합(바이트).
    pub memory: u64,
    /// 읽은 것의 CPU% 합(맥 전체 = 100). 하나도 못 쟀으면(첫 표본) `None`.
    pub cpu: Option<f64>,
}

/// 실행 파일 경로의 **가장 바깥** 앱 번들 이름(`.app`을 뗀 것). 번들 밖이면 없다.
pub fn bundle_name(path: &str) -> Option<&str> {
    path.split('/').find_map(|part| part.strip_suffix(".app").filter(|name| !name.is_empty()))
}

/// **다른 앱으로 읽을 행** — 스냅샷에서 이 uid인 행 가운데 우리 트리(`ours`) 밖의 것. 남의 uid는 못 읽는다.
pub fn targets<'a>(snapshot: &'a Snapshot, ours: &BTreeSet<Identity>) -> Vec<&'a Proc> {
    snapshot.procs.iter().filter(|proc| proc.uid == snapshot.uid && !ours.contains(&proc.id)).collect()
}

/// **다른 앱의 줄** — 읽은 행을 앱 번들 이름으로 묶는다. 이름 순이고(`BTreeMap`의 `Some` 차례), 번들 밖의 줄이 맨 끝이다. 못 읽은 행은 안
/// 센다.
pub fn of(theirs: &[&Proc], measured: &Measured) -> Vec<OtherApp> {
    let mut lines: BTreeMap<(bool, Option<&str>), OtherApp> = BTreeMap::new();
    for proc in theirs {
        let Some(reading) = measured.readings.get(&proc.id) else {
            continue;
        };
        let name = proc.path.as_deref().and_then(bundle_name);
        // 번들 밖의 줄을 맨 끝에 두려고 열쇠 앞에 「번들 밖인가」를 단다 — `None`은 `Some`보다 앞이라 그대로 두면 맨 앞에 선다.
        let line = lines.entry((name.is_none(), name)).or_insert_with(|| OtherApp {
            name: name.map(String::from),
            processes: 0,
            memory: 0,
            cpu: None,
        });
        line.processes += 1;
        line.memory = line.memory.saturating_add(reading.memory);
        if let Some(cpu) = measured.cpu.get(&proc.id) {
            line.cpu = Some(line.cpu.unwrap_or(0.0) + cpu);
        }
    }
    lines.into_values().collect()
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashMap};

    use super::*;
    use crate::processes::metrics::Reading;

    const MB: u64 = 1024 * 1024;

    /// **가장 바깥 `.app`이 그 프로세스의 앱이다.** 앱 안의 도우미 앱(`… Helper (Render).app`)은 바깥 앱에 든다. 경로가 번들 자신에서
    /// 끝나도 된다. 번들 밖(데몬 · 명령줄 도구 · 프레임워크 안의 XPC 서비스)은 없다. 이름이 `.app` 하나뿐인 조각은 번들이 아니다.
    #[test]
    fn a_process_belongs_to_its_outermost_app_bundle() {
        let helper = "/Applications/Sketchpad.app/Contents/Frameworks/Sketchpad Engine.framework/Helpers/Sketchpad Helper (Render).app/Contents/MacOS/Sketchpad Helper (Render)";
        assert_eq!(bundle_name(helper), Some("Sketchpad"), "도우미 앱이 바깥 앱에 안 들었다");
        assert_eq!(bundle_name("/System/Library/CoreServices/Shelf.app/Contents/MacOS/Shelf"), Some("Shelf"));
        assert_eq!(bundle_name("/Users/fixture/Applications/Notebook.app"), Some("Notebook"), "번들 자신에서 끝나는 경로");
        assert_eq!(bundle_name("/usr/libexec/fixtured"), None, "번들 밖의 데몬");
        assert_eq!(
            bundle_name("/System/Library/PrivateFrameworks/Fixture.framework/XPCServices/com.example.fixture.xpc/Contents/MacOS/fixture"),
            None,
            "프레임워크 안의 XPC 서비스는 앱이 아니다"
        );
        assert_eq!(bundle_name("/opt/.app/bin/tool"), None, "이름 없는 `.app` 조각");
        assert_eq!(bundle_name("/opt/tools/apple"), None, "`.app`으로 끝나지 않는 이름");
    }

    fn proc(pid: u32, uid: u32, path: Option<&str>) -> Proc {
        Proc {
            id: Identity { pid, started_us: 1_000 + u64::from(pid) },
            ppid: 1,
            pgid: pid,
            uid,
            name: format!("p{pid}"),
            argv0: None,
            command: None,
            path: path.map(String::from),
            shell_key: None,
            runtime_key: None,
        }
    }

    /// **다른 앱은 이 uid의 프로세스 중 우리 트리 밖의 것이다.** 우리 트리(아틀리에 합계에 드는 것)는 아틀리에의 몫이라 여기 안 들고,
    /// 남의 uid는 못 읽어 「시스템 · 못 읽음」에 든다. 스냅샷의 차례 그대로다.
    #[test]
    fn other_apps_are_this_uids_processes_outside_our_tree() {
        let (ours, theirs, root, later) = (proc(10, 501, None), proc(20, 501, None), proc(30, 0, None), proc(40, 501, None));
        let snapshot = Snapshot { uid: 501, procs: vec![ours.clone(), theirs.clone(), root, later.clone()], skipped: 0 };
        let picked: Vec<Identity> = targets(&snapshot, &BTreeSet::from([ours.id])).iter().map(|proc| proc.id).collect();
        assert_eq!(picked, vec![theirs.id, later.id]);
    }

    /// **읽은 행을 앱 번들 이름으로 묶는다.** 같은 앱의 도우미는 한 줄에 들고(프로세스 수 · 메모리 · CPU를 더한다), 같은 이름의 번들이 두
    /// 자리에서 떠도 한 줄이다. 번들 밖의 행은 한 줄(이름 없음)에 모여 맨 끝에 선다. 못 읽은 행(그사이 끝났다)은 안 센다 — 그 몫은
    /// 「시스템 · 못 읽음」이다. 아무것도 CPU를 못 잰 줄(첫 표본)은 CPU가 없다.
    #[test]
    fn the_read_processes_are_grouped_by_their_app() {
        let main = proc(10, 501, Some("/Applications/Sketchpad.app/Contents/MacOS/Sketchpad"));
        let helper = proc(11, 501, Some("/Applications/Sketchpad.app/Contents/Frameworks/Sketchpad Helper.app/Contents/MacOS/Sketchpad Helper"));
        let gone = proc(12, 501, Some("/Applications/Sketchpad.app/Contents/MacOS/Sketchpad"));
        let elsewhere = proc(13, 501, Some("/Volumes/Fixture/Sketchpad.app/Contents/MacOS/Sketchpad"));
        let shelf = proc(20, 501, Some("/System/Library/CoreServices/Shelf.app/Contents/MacOS/Shelf"));
        let daemon = proc(30, 501, Some("/usr/libexec/fixtured"));
        let unnamed = proc(31, 501, None);

        let reading = |memory: u64| Reading { memory, cpu_ns: 0, ports: vec![] };
        let measured = Measured {
            readings: HashMap::from([
                (main.id, reading(300 * MB)),
                (helper.id, reading(200 * MB)),
                (elsewhere.id, reading(50 * MB)),
                (shelf.id, reading(40 * MB)),
                (daemon.id, reading(8 * MB)),
                (unnamed.id, reading(2 * MB)),
            ]),
            cpu: HashMap::from([(main.id, 4.0), (helper.id, 1.5), (daemon.id, 0.25), (unnamed.id, 0.5)]),
            ..Measured::default()
        };
        let theirs = [&shelf, &main, &helper, &gone, &elsewhere, &daemon, &unnamed];

        let line = |name: Option<&str>, processes: u32, memory: u64, cpu: Option<f64>| OtherApp {
            name: name.map(String::from),
            processes,
            memory,
            cpu,
        };
        assert_eq!(
            of(&theirs, &measured),
            vec![
                line(Some("Shelf"), 1, 40 * MB, None),
                line(Some("Sketchpad"), 3, 550 * MB, Some(5.5)),
                line(None, 2, 10 * MB, Some(0.75)),
            ]
        );
    }
}
