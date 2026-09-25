//! 판정 — 스냅샷 값만 받아 「무엇이 어느 셸에서 나왔는가」를 가르는 순수 함수(프로세스 결정 2 · 3 ·
//! 프로세스 스펙 S6).
//!
//! **값만 받는 것이 요점이다.** 살아 있는 프로세스로는 「pid가 재사용된 셸」, 「앱을 띄운 사슬」 같은
//! 갈래를 재현할 수 없다. 스냅샷 행 몇 개와 기대 묶음을 한 줄에 두면 모든 갈래를 표로 잰다.
//!
//! **순서는 부르는 쪽이 지킨다: 스냅샷을 먼저 찍고, 셸 목록은 그 뒤에 읽는다**(프로세스 스펙 S52).
//! 그 사이에 뜬 셸은 목록에 이미 있어, 그 셸의 자손이 「셸이 없는 표식」으로 읽히는 창이 없다.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use super::{exceptions, Identity, Proc, Snapshot};

/// 셸 하나 — 셸 목록과 끝낼 셸이 같은 모양이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellEntry {
    /// 셸 키(`<세대>-<PTY 번호>`).
    pub key: String,
    /// 셸 프로세스의 신원. **띄우는 중인 셸은 아직 모른다** — 셸 목록은 인스턴스 기록의 목록이라 자식을
    /// 띄우기 전에 올린 키도 든다(프로세스 스펙 S52). 그 셸의 자손은 표식으로만 잡힌다.
    pub process: Option<Identity>,
    /// 사람이 처음 입력한 시각(에포크 µs). 이 시각 전에 태어난 이 셸의 자손이 셸 도우미다(프로세스 스펙 P1).
    /// `None`이면 입력이 아직 없어 자손이 모두 도우미다.
    pub first_input_us: Option<u64>,
}

/// 인스턴스 기록 — 지금 떠 있거나 떠 있던 아틀리에 실행 하나(프로세스 결정 6 · 프로세스 스펙 S8).
/// 판정이 읽는 칸만 둔다. 빌드 종류와 버전은 화면만 읽어 기록 파일 쪽에 산다(티켓 09).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceRecord {
    pub generation: String,
    /// 그 실행의 앱 프로세스. pid와 시작 시각이 함께 맞아야 살아 있다(프로세스 스펙 S9).
    pub app: Identity,
    pub shell_keys: Vec<String>,
    pub updated_us: u64,
}

/// 판정을 부르는 때. 스펙은 「모드」라 부르지만 이 저장소에서 모드는 세계(Atelier · Maison)라 이름을
/// 달리 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Occasion {
    Normal,
    /// 앱이 뜰 때 지난 실행이 남긴 것을 치운다. 이 실행의 세대를 보지 않는다(티켓 10).
    StartupCleanup,
}

/// 판정의 입력 — 스펙 「판 01 › 새 Rust 모듈 › 판정」의 입력 그대로다.
///
/// 지금 읽는 칸은 스냅샷 · 세대 · 셸 목록 · 끝낼 셸 · 예외 목록 · 앱 pid · 물려받은 셸 키다. 인스턴스 기록과
/// 모드(09 · 10)는 모양만 서 있고 판정이 아직 안 읽는다.
#[derive(Debug, Clone, Copy)]
pub struct Inputs<'a> {
    pub snapshot: &'a Snapshot,
    /// 이 실행의 세대(`pty::instance_prefix`).
    pub generation: &'a str,
    /// 이 실행의 셸 목록.
    pub shells: &'a [ShellEntry],
    /// 끝낼 셸 — 풀에서 이미 뺀 셸들. 목록에서 빠졌어도 그 자손은 이 셸의 것으로 가른다. 여럿인 것은
    /// 새로고침이 풀을 통째로 비우기 때문이다.
    pub ending: &'a [ShellEntry],
    pub instances: &'a [InstanceRecord],
    /// 예외 목록(프로세스 결정 5) — 설정의 `terminal.processExceptions`, `null`이면 기본 목록. 부르는 쪽이 끝낼
    /// 때마다 설정에서 읽어 준다(`settings::process_exceptions`).
    pub exceptions: &'a [String],
    /// 앱 자신의 pid.
    pub app_pid: u32,
    /// 앱이 물려받은 셸 키 — 앱 env의 표식. 앱을 아틀리에 셸에서 띄웠을 때만 있다. 뜬 뒤에 안 바뀌므로
    /// 부르는 쪽이 한 번 읽어 둔다.
    pub inherited_key: Option<&'a str>,
    pub occasion: Occasion,
}

/// 판정의 결과. 지금 서는 묶음은 셸별 자손과 예외 둘이고, 셸별 자손 중 셸 도우미를 따로 표시한다(고아 · 다른
/// 인스턴스는 티켓 09). 어느 묶음에도 없는 것(판정 밖)은 싣지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict<'a> {
    /// 셸 키마다 그 셸의 자손 — 셸 목록과 끝낼 셸 모두 선다. 자손이 없으면 빈 목록이다. pid 순.
    ///
    /// **셸 자신은 안 든다.** 셸은 끝낼 셸로 따로 쥐고 그룹 신호로 끝낸다.
    pub descendants: BTreeMap<&'a str, Vec<&'a Proc>>,
    /// 예외 — 이름이 예외 목록에 걸린 것과 그 밑(프로세스 결정 5). 표식을 물었어도, 우리 셸의 트리 안이어도 여기
    /// 든다. 끝내기에 넘어가지 않는다. pid 순.
    pub exceptions: Vec<&'a Proc>,
    /// 셸 도우미 — 셸별 자손 중 그 셸에 사람이 처음 입력하기 **전에** 태어난 것(프로세스 스펙 P1). p10k의
    /// `gitstatusd`처럼 셸이 뜰 때 함께 뜨는 것이 여기 든다.
    ///
    /// **묶음이 아니라 표시다.** 도우미도 셸별 자손에 그대로 있어 셸을 닫으면 함께 끝난다. 빠지는 것은 사람에게
    /// 말하는 수다 — 닫기 확인 창의 수(`close_count`), 조용한 셸 판정(티켓 12), 정리 기록(티켓 11), 스스로 끝난
    /// 셸의 알림(티켓 13). 신원으로 쥐어 끝내기의 결과(신원마다 하나)와 곧바로 짝짓는다.
    ///
    /// 빈 곳(P1 그대로): 입력 뒤에 다시 뜬 도우미(`exec zsh`, 죽고 다시 뜬 `gitstatusd`)는 도우미가 아니다 —
    /// 태어난 때로만 가르고 이름으로는 가르지 않는다.
    pub helpers: BTreeSet<Identity>,
}

/// 셸마다 그 셸이 띄운 자손을 가른다.
///
/// **예외를 가장 먼저 가른다**(프로세스 결정 5). 자기나 조상 중 하나가 예외 목록에 걸리면 예외이고, 다른 묶음에
/// 안 든다 — 표식을 물었어도, 다른 세대의 표식이어도. 판정을 부르는 모든 길(셸 닫기, 새로고침, 앱 종료)이 이
/// 함수를 지나므로 예외는 어느 길로도 안 끝난다.
///
/// 셸별 자손 = 그 셸의 PID 트리 ∪ 그 셸 키를 문 것 ∪ 그것들의 트리. 한 프로세스는 **가장 가까운
/// 자리**가 정한다: 자기 자신의 표식, 그다음 부모, 그 부모… 순으로 올라가다 처음 만나는 셸 프로세스나
/// 셸 키가 그 프로세스의 셸이다. 그래서 한 프로세스가 두 셸에 들지 않는다.
///
/// **어느 묶음에도 넣지 않는 것**(프로세스 스펙 S6): pid ≤ 1, 앱 자신과 그 조상 사슬, 앱이 물려받은
/// 셸 키를 문 것, 앱과 uid가 다른 것. 앞의 둘(사슬과 물려받은 키)은 **길도 막는다** — 그 밑에 달린
/// 것은 위로 올라가다 거기서 멈춰 판정 밖이 된다. 앱을 셸에서 띄우면(설치본 셸에서 `pnpm tauri dev`)
/// 앱과 그 조상, 그리고 그 도구가 함께 띄운 형제 가지(vite와 그 밑)가 모두 그 셸의 키를 물기 때문이다.
/// uid가 다른 것은 길을 막지 않는다: `sudo`로 띄운 것 밑에 다시 사용자의 것이 달릴 수 있다.
pub fn judge<'a>(input: &Inputs<'a>) -> Verdict<'a> {
    let procs = &input.snapshot.procs;
    let table = Table { by_pid: procs.iter().map(|p| (p.id.pid, p)).collect(), rows: procs.len() };
    let shells: Vec<&'a ShellEntry> = input.shells.iter().chain(input.ending).collect();

    // 셸 프로세스는 **신원이 맞는 행만** 셸로 본다. 셸이 끝나고 그 pid를 남이 받았으면, 그 pid 밑은
    // 셸의 트리가 아니다(프로세스 결정 3).
    let shell_at: HashMap<u32, &'a str> = shells
        .iter()
        .filter_map(|shell| {
            let id = shell.process?;
            let row = table.by_pid.get(&id.pid)?;
            (row.id == id).then_some((id.pid, shell.key.as_str()))
        })
        .collect();
    let keys: HashSet<&'a str> = shells.iter().map(|shell| shell.key.as_str()).collect();
    // 셸마다 사람이 처음 입력한 시각. 같은 키가 두 번 서면(종료 판정이 풀에서 뺀 셸의 키를 한 번 더 더한다) 앞의
    // 것이 이긴다 — 셸 목록, 그다음 끝낼 셸 순이고 더한 키는 맨 뒤다.
    let mut first_input: HashMap<&'a str, Option<u64>> = HashMap::new();
    for shell in &shells {
        first_input.entry(shell.key.as_str()).or_insert(shell.first_input_us);
    }

    // 행이 없어도 앱 자신은 막는다.
    let mut blocked: HashSet<u32> = table.lineage(input.app_pid).collect();
    blocked.insert(input.app_pid);
    if let Some(inherited) = input.inherited_key {
        blocked.extend(
            procs.iter().filter(|p| p.shell_key.as_deref() == Some(inherited)).map(|p| p.id.pid),
        );
    }

    // **예외가 먼저다**(프로세스 결정 5). 자기부터 부모를 따라 올라가는 길 위 어디에든 예외 이름이 있으면 그 행은
    // 예외다 — 셸 자리를 만나기 전이든 뒤든. 가장 가까운 자리로만 가르면 tmux 서버 밑의 창 셸과 그 명령은 tmux를
    // 띄운 셸의 표식을 물고 있어(tmux가 그 env를 물려준다) 그 셸의 자손이 되고, 셸을 닫는 순간 끝난다.
    //
    // 이 길도 막힌 행에서 멈춘다. 그 위는 앱을 띄운 쪽이다 — tmux 안에서 띄운 dev 앱이면 앱이 띄운 셸의 자손이 모두
    // tmux 밑이라, 멈추지 않으면 셸을 닫아도 아무것도 안 끝난다.
    let excepted = |proc: &'a Proc| -> bool {
        for node in table.up_from(proc) {
            if blocked.contains(&node.id.pid) {
                return false;
            }
            if exceptions::caught(input.exceptions, node) {
                return true;
            }
        }
        false
    };

    // 자기부터 부모를 따라 올라가다 처음 만나는 자리가 그 행의 셸이다. 막힌 행을 만나거나 끝까지
    // 올라가면 판정 밖이다.
    let owner_of = |proc: &'a Proc| -> Option<&'a str> {
        for node in table.up_from(proc) {
            if blocked.contains(&node.id.pid) {
                return None;
            }
            if let Some(key) = shell_at.get(&node.id.pid) {
                return Some(*key);
            }
            if let Some(key) = node.shell_key.as_deref().and_then(|key| keys.get(key)) {
                return Some(*key);
            }
        }
        None
    };

    let mut descendants: BTreeMap<&'a str, Vec<&'a Proc>> =
        shells.iter().map(|shell| (shell.key.as_str(), Vec::new())).collect();
    let mut excepted_rows = Vec::new();
    let mut helpers = BTreeSet::new();
    for proc in procs {
        let pid = proc.id.pid;
        if pid <= 1
            || proc.uid != input.snapshot.uid
            || blocked.contains(&pid)
            || shell_at.contains_key(&pid)
        {
            continue;
        }
        if excepted(proc) {
            excepted_rows.push(proc);
        } else if let Some(key) = owner_of(proc) {
            // 입력이 아직 없으면 그 셸의 자손은 모두 도우미다. 입력과 같은 순간에 태어난 것은 도우미가 아니다 —
            // 입력 시각은 프런트가 사람 입력을 **본** 순간(ms를 µs로 옮겨 내림)이라, 사람이 띄운 것은 늘 그 뒤다.
            if first_input.get(key).copied().flatten().is_none_or(|input| proc.id.started_us < input) {
                helpers.insert(proc.id);
            }
            descendants.entry(key).or_default().push(proc);
        }
    }
    for members in descendants.values_mut() {
        members.sort_by_key(|p| p.id.pid);
    }
    excepted_rows.sort_by_key(|p| p.id.pid);
    Verdict { descendants, exceptions: excepted_rows, helpers }
}

/// **닫기 확인 창이 말할 「이 셸에서 띄운 프로세스」 수**(프로세스 결정 3 · 프로세스 스펙 S55).
///
/// 그 셸의 자손 중 **셋을 뺀다.** 빼는 자리는 이 함수 하나다 — 셸 하나의 닫기 전 물음과 여러 셸의 배치 물음(종료 ·
/// 아카이브 확인 창)이 모두 이것을 지나, 두 길이 규칙을 따로 들지 않는다(`pty::close_checks`).
/// - **셸 도우미**(`Verdict::helpers`): 닫으면 함께 끝나지만 사람이 띄운 것이 아니다. 세면 p10k 셸은 빈 프롬프트를
///   닫을 때마다 묻는다 — ux-papercuts 결정 92가 피한 바로 그것이다.
/// - **예외**: 끝나지 않으므로 「함께 끝나요」에 들 수 없다. 판정이 이미 셸별 자손에서 뺐다.
/// - **명령이 도는 foreground 그룹**(`command_group`): 명령 자신과 그 그룹(claude와 그 MCP 서버)이다 — 확인 창이
///   이미 명령으로 말한다. claude가 Bash 도구로 띄운 dev 서버는 제 세션이라 여기 안 걸리고 세어진다.
///
/// `command_group`은 **명령이 돌 때만** 준다. 프롬프트에 서 있으면 터미널을 쥔 그룹이 셸 자신이라, 그 그룹을 빼면
/// 명령이 없는데 무언가를 「명령으로」 말한 셈이 된다 — 잡 제어가 꺼진 셸의 백그라운드 잡이 그 그룹에 산다.
pub fn close_count(verdict: &Verdict, key: &str, command_group: Option<u32>) -> usize {
    verdict.descendants.get(key).map_or(0, |members| {
        members
            .iter()
            .filter(|proc| !verdict.helpers.contains(&proc.id) && Some(proc.pgid) != command_group)
            .count()
    })
}

/// **앱 종료의 판정** — 끝낼 신원(프로세스 결정 3 · 프로세스 스펙 S5).
///
/// 끝낼 것 = 풀에서 뺀 셸들(`ending`)의 자손 ∪ **이 세대의 표식을 문 전부**(와 그 트리). 뒤의 것은 셸이 이미
/// 풀에 없는 키다 — 스스로 끝난 셸이 남긴 것, 닫는 중인 셸의 것, 풀에 오르기 전에 종료가 온 셸의 것. 앱이
/// 끝나면 그 셸을 이어 쓸 길이 없으니 모두 끝낸다. 빼는 것(예외와 그 밑, 앱과 조상 사슬, 물려받은 키, pid ≤ 1,
/// 다른 uid)은 `judge` 그대로다 — 예외는 셸별 자손에 안 들어 여기로 오지 않는다.
///
/// 진행 중인 끝내기의 신원도 여기 들 수 있다 — 그 셸의 표식을 물고 있어서다. 이미 SIGTERM을 받은 그것을 다시
/// 쏘지 않는 것은 끝내기 층이 가른다(`ending::InFlight::close`).
pub fn at_exit(input: &Inputs) -> Vec<Identity> {
    // 셸 프로세스를 모르는 끝낼 셸로 더한다 — 판정은 그 키를 문 행과 그 밑을 그 셸의 자손으로 고른다. 풀에서
    // 뺀 셸의 키가 한 번 더 서도 판정은 키를 집합으로 읽어 같은 답이다.
    let marked: BTreeSet<&str> = input
        .snapshot
        .procs
        .iter()
        .filter_map(|proc| proc.shell_key.as_deref())
        .filter(|key| of_generation(key, input.generation))
        .collect();
    let mut ending = input.ending.to_vec();
    ending.extend(marked.into_iter().map(|key| ShellEntry {
        key: key.to_string(),
        process: None,
        first_input_us: None,
    }));
    let verdict = judge(&Inputs { ending: &ending, ..*input });
    verdict.descendants.into_values().flatten().map(|proc| proc.id).collect()
}

/// 이 세대가 지은 셸 키인가 — `<세대>-<PTY 번호>`(`pty::shell_id`). 앞글자로만 겹치는 다른 세대(`G` 대
/// `GX`)를 가르려고 구분자와 번호까지 본다.
fn of_generation(key: &str, generation: &str) -> bool {
    key.strip_prefix(generation)
        .and_then(|rest| rest.strip_prefix('-'))
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

/// 스냅샷을 pid로 찾는 표 — 부모를 따라 올라가는 데 쓴다.
struct Table<'a> {
    by_pid: HashMap<u32, &'a Proc>,
    rows: usize,
}

impl<'a> Table<'a> {
    /// 이 행의 부모 행. **부모는 자식보다 먼저 태어난다** — 그렇지 않은 부모 행은 그 pid를 나중에 받은
    /// 남이다(스냅샷을 찍는 사이 진짜 부모가 끝나고 pid가 재사용됐다). launchd(1) 밑은 트리가 끊긴
    /// 것이다.
    fn parent(&self, child: &Proc) -> Option<&'a Proc> {
        if child.ppid <= 1 {
            return None;
        }
        let parent = *self.by_pid.get(&child.ppid)?;
        (parent.id.started_us <= child.id.started_us).then_some(parent)
    }

    /// 이 행부터 부모를 따라 올라가는 사슬(자기 포함). 스냅샷이 흔들려 고리가 생겨도 행 수에서 멈춘다.
    fn up_from(&self, start: &'a Proc) -> impl Iterator<Item = &'a Proc> + '_ {
        std::iter::successors(Some(start), |node| self.parent(node)).take(self.rows + 1)
    }

    /// 그 pid와 그 조상들의 pid. 행이 없으면 비어 있다.
    fn lineage(&self, pid: u32) -> impl Iterator<Item = u32> + '_ {
        let start = self.by_pid.get(&pid).copied();
        start.into_iter().flat_map(|row| self.up_from(row)).map(|node| node.id.pid)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    const UID: u32 = 501;
    const APP: u32 = 50;

    /// 스냅샷 한 행. 시작 시각은 따로 안 주면 pid를 따른다 — 부모가 자식보다 먼저 태어나게.
    fn row(pid: u32, ppid: u32) -> Proc {
        Proc {
            id: Identity { pid, started_us: 1_000 + u64::from(pid) },
            ppid,
            pgid: pid,
            uid: UID,
            name: format!("p{pid}"),
            argv0: None,
            shell_key: None,
        }
    }

    trait Row {
        fn key(self, key: &str) -> Proc;
        fn uid(self, uid: u32) -> Proc;
        fn born(self, started_us: u64) -> Proc;
        /// 커널 이름.
        fn named(self, name: &str) -> Proc;
        /// 부른 이름(argv[0]). 커널 이름은 그대로 둔다.
        fn invoked(self, argv0: &str) -> Proc;
        /// 프로세스 그룹. 따로 안 주면 제 pid다(제 그룹의 리더).
        fn group(self, pgid: u32) -> Proc;
    }

    impl Row for Proc {
        fn key(mut self, key: &str) -> Proc {
            self.shell_key = Some(key.to_string());
            self
        }
        fn uid(mut self, uid: u32) -> Proc {
            self.uid = uid;
            self
        }
        fn born(mut self, started_us: u64) -> Proc {
            self.id.started_us = started_us;
            self
        }
        fn named(mut self, name: &str) -> Proc {
            self.name = name.to_string();
            self
        }
        fn invoked(mut self, argv0: &str) -> Proc {
            self.argv0 = Some(argv0.to_string());
            self
        }
        fn group(mut self, pgid: u32) -> Proc {
            self.pgid = pgid;
            self
        }
    }

    /// 판정 표가 쓰는 예외 목록. 세상의 행 이름(`p<pid>`)은 아무것도 안 걸린다 — 걸리는 것은 줄이 이름을 준
    /// 행뿐이다.
    fn exceptions() -> Vec<String> {
        ["tmux", "ssh-agent", "colima", "docker*"].into_iter().map(String::from).collect()
    }

    /// 모든 줄이 함께 쓰는 세상. 이 앱(50)은 설치본 셸에서 띄운 dev 빌드다.
    ///
    /// 설치본(10)의 셸 I-3(zsh 20) → pnpm(30) → cargo(40) → 앱(50). 사슬은 표식 I-3을 문다 — zsh는
    /// 시스템 바이너리라 표식이 안 읽힌다. 이 실행의 셸은 G-1(100)과 띄우는 중인 G-3(pid 모름)이고,
    /// 끝낼 셸은 G-2(110)다.
    fn world() -> Vec<Proc> {
        vec![
            row(0, 0).uid(0),
            row(1, 0).uid(0),
            row(10, 1),
            row(20, 10),
            row(30, 20).key("I-3"),
            row(40, 30).key("I-3"),
            row(APP, 40).key("I-3"),
            row(100, APP),
            row(110, APP),
        ]
    }

    fn shell(key: &str, process: Option<Identity>) -> ShellEntry {
        ShellEntry { key: key.to_string(), process, first_input_us: None }
    }

    struct Case {
        what: &'static str,
        /// 세상에 더하는 행. 같은 pid가 세상에 있으면 이 행이 그것을 갈아 끼운다.
        rows: Vec<Proc>,
        inherited: Option<&'static str>,
        /// 셸 키마다 기대 자손(pid). 적지 않은 셸은 빈 목록이다.
        expect: Vec<(&'static str, Vec<u32>)>,
        /// 기대 예외 묶음(pid). 적지 않으면 비어 있다.
        excepted: Vec<u32>,
    }

    fn case(what: &'static str, rows: Vec<Proc>, expect: &[(&'static str, &[u32])]) -> Case {
        Case {
            what,
            rows,
            inherited: Some("I-3"),
            expect: expect.iter().map(|(key, pids)| (*key, pids.to_vec())).collect(),
            excepted: Vec::new(),
        }
    }

    impl Case {
        fn inheriting(mut self, key: &'static str) -> Case {
            self.inherited = Some(key);
            self
        }
        fn excepting(mut self, pids: &[u32]) -> Case {
            self.excepted = pids.to_vec();
            self
        }
    }

    /// **판정 표.** 한 줄에 스냅샷 행과 기대 묶음을 둔다.
    ///
    /// 「어느 묶음에도 없다」를 재는 줄은 **빠지는 행이 살아 있는 셸의 표식을 물게** 두고, 같은 줄에 그
    /// 셸의 자손 하나를 앵커로 세운다. 이 판의 묶음은 셸별 자손뿐이라, 표식이 없는 행은 규칙이 없어도
    /// 어차피 어디에도 안 든다 — 그러면 그 줄은 아무것도 재지 않는다.
    #[test]
    fn each_shell_gets_what_it_spawned() {
        let cases = [
            case(
                "트리 자손 — 셸 밑의 자식과 손자",
                vec![row(101, 100).key("G-1"), row(102, 101).key("G-1")],
                &[("G-1", &[101, 102])],
            ),
            case(
                "트리 자손 — 표식이 안 읽히는 시스템 바이너리",
                vec![row(103, 100)],
                &[("G-1", &[103])],
            ),
            case(
                "트리가 끊긴 표식 자손(ppid 1)",
                vec![row(201, 1).key("G-1")],
                &[("G-1", &[201])],
            ),
            case(
                "트리가 끊긴 표식 자손 밑의 시스템 바이너리",
                vec![row(202, 1).key("G-1"), row(203, 202)],
                &[("G-1", &[202, 203])],
            ),
            case(
                "띄우는 중인 셸(pid 모름)도 표식으로 자손을 갖는다",
                vec![row(204, 1).key("G-3")],
                &[("G-3", &[204])],
            ),
            case(
                "끝낼 셸의 자손 → 셸별 자손(끝낼 셸)",
                vec![
                    row(111, 110).key("G-2"),
                    row(112, 111),
                    row(211, 1).key("G-2"),
                    row(212, 211),
                ],
                &[("G-2", &[111, 112, 211, 212])],
            ),
            case(
                "트리 안에서는 다른 세대의 표식을 물어도 그 셸의 자손 — 셸에서 띄운 dev 앱의 셸",
                vec![row(115, 100).key("D-1"), row(116, 115).key("D-1")],
                &[("G-1", &[115, 116])],
            ),
            case(
                "셸 자신은 제 자손이 아니다 — 표식이 읽히는 셸이어도",
                vec![row(100, APP).key("G-1"), row(101, 100)],
                &[("G-1", &[101])],
            ),
            case(
                "앱 자신과 조상 사슬, 앱이 띄운 셸 아닌 자식 — 살아 있는 셸의 표식을 물어도",
                vec![
                    row(30, 20).key("G-1"),
                    row(40, 30).key("G-1"),
                    row(APP, 40).key("G-1"),
                    row(51, APP),
                    row(205, 1).key("G-1"),
                ],
                &[("G-1", &[205])],
            ),
            // 물려받은 키는 다른 실행의 것이라 이 판의 묶음(셸별 자손)에서는 보통 안 보인다. 여기서는 그
            // 키가 살아 있는 셸의 것이라고 두고도 빠지는지 잰다 — 다른 세대로는 09 · 10의 고아 묶음이
            // 다시 잰다.
            case(
                "앱이 물려받은 셸 키를 문 형제 가지 — vite와 그 밑",
                vec![row(60, 30).key("G-1"), row(61, 60).key("G-1"), row(62, 60), row(104, 100)],
                &[("G-1", &[104])],
            )
            .inheriting("G-1"),
            case(
                "pid ≤ 1 — 표식을 물어도",
                vec![row(0, 0).key("G-1"), row(1, 0).key("G-1"), row(207, 1).key("G-1")],
                &[("G-1", &[207])],
            ),
            case(
                "다른 uid — 트리 안이어도, 표식을 물어도. 그 밑의 같은 uid는 트리를 잇는다",
                vec![
                    row(106, 100).uid(0),
                    row(107, 106).uid(0),
                    row(108, 106),
                    row(208, 1).uid(0).key("G-1"),
                ],
                &[("G-1", &[108])],
            ),
            case(
                "셸 pid가 재사용됐으면 그 pid 밑은 셸의 것이 아니다",
                vec![row(100, 1).born(5_000), row(109, 100).born(5_100), row(209, 1).key("G-1")],
                &[("G-1", &[209])],
            ),
            case(
                "부모보다 먼저 태어난 행은 그 부모 밑이 아니다 — 그사이 부모 pid가 재사용됐다",
                vec![row(113, 100).born(1_050), row(114, 100)],
                &[("G-1", &[114])],
            ),
            case(
                "셸 목록에 없는 키는 판정 밖",
                vec![row(220, 1).key("G-7"), row(221, 1).key("OLD-1"), row(222, 1).key("G-1")],
                &[("G-1", &[222])],
            ),
            // ── 예외(프로세스 결정 5). 예외는 **다른 묶음보다 먼저** 가른다 — 자기나 조상 중 하나가 예외
            // 이름이면 표식을 물었어도 셸의 자손이 아니다. 줄마다 그 셸의 자손 하나를 앵커로 세운다.
            case(
                "예외 이름의 프로세스와 그 트리는 셸의 자손이 아니다 — 셸 밑의 tmux 클라이언트와 그 밑",
                vec![row(120, 100).named("tmux"), row(121, 120), row(101, 100).key("G-1")],
                &[("G-1", &[101])],
            )
            .excepting(&[120, 121]),
            case(
                "예외 밑의 표식 프로세스도 예외 — 트리가 끊긴 tmux 서버와 그 창의 셸, 그 셸의 명령",
                vec![
                    row(230, 1).named("tmux").key("G-1"),
                    row(231, 230).key("G-1"),
                    row(232, 231).key("G-1"),
                    row(205, 1).key("G-1"),
                ],
                &[("G-1", &[205])],
            )
            .excepting(&[230, 231, 232]),
            case(
                "다른 세대의 표식을 물어도 예외 이름이면 예외 — 셸의 트리 안이든, 트리 밖이든",
                vec![
                    row(122, 100).named("ssh-agent").key("D-1"),
                    row(233, 1).named("ssh-agent").key("OLD-1"),
                    row(234, 1).named("colima").key("G-1"),
                    row(101, 100).key("G-1"),
                ],
                &[("G-1", &[101])],
            )
            .excepting(&[122, 233, 234]),
            case(
                "끝낼 셸의 예외와 그 밑은 끝낼 셸의 자손이 아니다 — 셸을 닫아도 산다",
                vec![row(118, 110).named("docker").key("G-2"), row(119, 118), row(111, 110).key("G-2")],
                &[("G-2", &[111])],
            )
            .excepting(&[118, 119]),
            case(
                "부른 이름(argv[0])으로도 걸린다 — 커널 이름이 달라도",
                vec![row(235, 1).invoked("/opt/homebrew/bin/tmux").key("G-1"), row(206, 1).key("G-1")],
                &[("G-1", &[206])],
            )
            .excepting(&[235]),
            case(
                "이름의 일부만 같으면 예외가 아니다",
                vec![row(123, 100).named("tmuxx"), row(236, 1).named("tmux").key("G-1")],
                &[("G-1", &[123])],
            )
            .excepting(&[236]),
            // 앱을 tmux 안에서 띄운 dev 빌드. 예외를 찾으며 올라가는 길도 앱과 조상 사슬에서 멈춘다 — 안 멈추면
            // 앱이 띄운 셸의 자손이 모두 tmux 밑이라 예외가 되어, 셸을 닫아도 아무것도 안 끝난다.
            case(
                "앱을 띄운 사슬에 예외 이름이 있어도 앱의 셸 자손은 예외가 아니다",
                vec![row(20, 10).named("tmux"), row(101, 100).key("G-1"), row(102, 101)],
                &[("G-1", &[101, 102])],
            ),
        ];

        let shells = [
            shell("G-1", Some(Identity { pid: 100, started_us: 1_100 })),
            shell("G-3", None),
        ];
        let ending = [shell("G-2", Some(Identity { pid: 110, started_us: 1_110 }))];
        let exceptions = exceptions();

        let mut wrong = Vec::new();
        for case in &cases {
            let mut procs = world();
            for added in &case.rows {
                procs.retain(|p| p.id.pid != added.id.pid);
                procs.push(added.clone());
            }
            let snapshot = Snapshot { uid: UID, procs, skipped: 0 };
            let verdict = judge(&Inputs {
                snapshot: &snapshot,
                generation: "G",
                shells: &shells,
                ending: &ending,
                instances: &[],
                exceptions: &exceptions,
                app_pid: APP,
                inherited_key: case.inherited,
                occasion: Occasion::Normal,
            });

            let got: BTreeMap<&str, Vec<u32>> = verdict
                .descendants
                .iter()
                .map(|(key, procs)| (*key, procs.iter().map(|p| p.id.pid).collect()))
                .collect();
            let mut want: BTreeMap<&str, Vec<u32>> =
                ["G-1", "G-2", "G-3"].into_iter().map(|key| (key, Vec::new())).collect();
            for (key, pids) in &case.expect {
                want.insert(key, pids.clone());
            }
            let got_excepted: Vec<u32> = verdict.exceptions.iter().map(|p| p.id.pid).collect();
            if got != want || got_excepted != case.excepted {
                wrong.push(format!(
                    "{}\n    기대 {want:?} · 예외 {:?}\n    받음 {got:?} · 예외 {got_excepted:?}",
                    case.what, case.excepted
                ));
            }
        }
        assert!(wrong.is_empty(), "판정이 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// 셸 도우미 · 확인 창의 수 표의 한 줄.
    struct Told {
        what: &'static str,
        /// 셸 G-1(셸 목록)이나 G-2(끝낼 셸).
        key: &'static str,
        rows: Vec<Proc>,
        /// 그 셸에 사람이 처음 입력한 시각(µs). `None`이면 입력이 아직 없다.
        first_input: Option<u64>,
        /// 명령이 돌 때 터미널을 쥔 그룹. 프롬프트면 `None`이다.
        command_group: Option<u32>,
        /// 끝낼 대상 — 그 셸의 자손 전부(pid).
        ended: &'static [u32],
        /// 그중 셸 도우미(pid).
        helpers: &'static [u32],
        /// 확인 창이 말할 수.
        told: usize,
    }

    /// **셸 도우미와 확인 창의 수**(프로세스 스펙 P1 · S55 · 티켓 08).
    ///
    /// 셸 도우미는 그 셸에 사람이 처음 입력하기 **전에** 태어난 자손이다(p10k의 `gitstatusd`). 닫을 때 함께 끝나므로
    /// 끝낼 대상(셸별 자손)에는 들고, 확인 창의 수에서는 빠진다 — 빈 프롬프트를 닫을 때마다 창이 뜨지 않게. 수에서
    /// 빼는 것은 셋이다: 셸 도우미, 예외(끝나지 않는다), 명령이 도는 foreground 그룹(확인 창이 이미 명령으로 말한다).
    ///
    /// 셸 G-1(100)은 1_100에, 끝낼 셸 G-2(110)는 1_110에 떴다. 줄마다 입력 시각과 행의 태생을 준다. 수에서 「빠진다」를
    /// 재는 줄은 같은 줄에 세어지는 자손 하나를 앵커로 세운다 — 규칙이 없어도 0이 되는 줄은 아무것도 안 잰다.
    #[test]
    fn helpers_end_with_the_shell_but_the_confirm_does_not_count_them() {
        let told = |what, key, rows, first_input, command_group, ended, helpers, told| Told {
            what,
            key,
            rows,
            first_input,
            command_group,
            ended,
            helpers,
            told,
        };
        let cases = [
            told(
                "입력 전에 태어난 자손은 셸 도우미다 — 끝낼 대상에는 들고 수에서는 빠진다",
                "G-1",
                vec![row(101, 100).born(2_000).named("gitstatusd"), row(102, 100).born(6_000)],
                Some(5_000),
                None,
                &[101, 102],
                &[101],
                1,
            ),
            told(
                "트리가 끊긴 표식 자손도 태어난 때로 가른다",
                "G-1",
                vec![row(201, 1).key("G-1").born(3_000), row(202, 1).key("G-1").born(7_000)],
                Some(5_000),
                None,
                &[201, 202],
                &[201],
                1,
            ),
            told(
                "입력 뒤에 다시 뜬 도우미는 자손으로 센다 — 이름으로 가르지 않는다(P1의 빈 곳)",
                "G-1",
                vec![row(101, 100).born(2_000).named("gitstatusd"), row(103, 100).born(8_000).named("gitstatusd")],
                Some(5_000),
                None,
                &[101, 103],
                &[101],
                1,
            ),
            told(
                "입력과 같은 순간에 태어난 것은 도우미가 아니다 — 입력보다 먼저여야 한다",
                "G-1",
                vec![row(101, 100).born(4_999), row(104, 100).born(5_000)],
                Some(5_000),
                None,
                &[101, 104],
                &[101],
                1,
            ),
            told(
                "입력이 아직 없으면 자손이 모두 도우미다 — 끝낼 대상에는 모두 든다",
                "G-1",
                vec![
                    row(101, 100).born(2_000),
                    row(102, 100).born(6_000),
                    row(201, 1).key("G-1").born(7_000),
                ],
                None,
                None,
                &[101, 102, 201],
                &[101, 102, 201],
                0,
            ),
            told(
                "명령이 돌면 그 foreground 그룹은 수에서 빠진다 — claude와 그 MCP 서버. Bash 도구가 띄운 dev 서버는 \
                 제 세션이라 센다",
                "G-1",
                vec![
                    row(300, 100).born(6_000).named("claude"),
                    row(301, 300).born(6_100).named("node").group(300),
                    row(310, 1).key("G-1").born(6_200).named("node"),
                ],
                Some(5_000),
                Some(300),
                &[300, 301, 310],
                &[],
                1,
            ),
            told(
                "빼는 그룹을 안 주면 어느 그룹도 빠지지 않는다 — 셸 자신의 그룹(100)에 사는 백그라운드 잡도 센다. \
                 프롬프트에서 그룹을 안 주는 것은 `pty::close_check`의 몫이라 pty의 배치 표가 잰다",
                "G-1",
                vec![row(300, 100).born(6_000).group(100), row(310, 1).key("G-1").born(6_200)],
                Some(5_000),
                None,
                &[300, 310],
                &[],
                2,
            ),
            told(
                "예외는 끝내지도 세지도 않는다",
                "G-1",
                vec![row(120, 100).born(6_000).named("tmux"), row(121, 120).born(6_100), row(102, 100).born(6_000)],
                Some(5_000),
                None,
                &[102],
                &[],
                1,
            ),
            told(
                "끝낼 셸의 도우미도 그 셸의 첫 입력으로 가른다",
                "G-2",
                vec![row(111, 110).born(2_000), row(112, 110).born(6_000)],
                Some(5_000),
                None,
                &[111, 112],
                &[111],
                1,
            ),
        ];

        let exceptions = exceptions();
        let mut wrong = Vec::new();
        for case in &cases {
            let with_input = |key: &str, pid: u32| ShellEntry {
                key: key.to_string(),
                process: Some(Identity { pid, started_us: 1_000 + u64::from(pid) }),
                first_input_us: case.first_input,
            };
            let shells = [with_input("G-1", 100), shell("G-3", None)];
            let ending = [with_input("G-2", 110)];
            let mut procs = world();
            for added in &case.rows {
                procs.retain(|p| p.id.pid != added.id.pid);
                procs.push(added.clone());
            }
            let snapshot = Snapshot { uid: UID, procs, skipped: 0 };
            let verdict = judge(&Inputs {
                snapshot: &snapshot,
                generation: "G",
                shells: &shells,
                ending: &ending,
                instances: &[],
                exceptions: &exceptions,
                app_pid: APP,
                inherited_key: None,
                occasion: Occasion::Normal,
            });

            let ended: Vec<u32> =
                verdict.descendants.get(case.key).into_iter().flatten().map(|p| p.id.pid).collect();
            let helpers: Vec<u32> = verdict.helpers.iter().map(|id| id.pid).collect();
            let got = close_count(&verdict, case.key, case.command_group);
            if ended != case.ended || helpers != case.helpers || got != case.told {
                wrong.push(format!(
                    "{}\n    기대 끝냄 {:?} · 도우미 {:?} · 수 {}\n    받음 끝냄 {ended:?} · 도우미 {helpers:?} · 수 {got}",
                    case.what, case.ended, case.helpers, case.told
                ));
            }
        }
        assert!(wrong.is_empty(), "셸 도우미 · 확인 창의 수가 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// **종료 판정 표**(프로세스 스펙 S5). 종료 때 풀은 비었다 — 뺀 셸 G-1(100)과 G-2(110)이 끝낼 셸이고, 셸
    /// 목록은 없다. 이 세대(G)의 다른 키는 셸이 이미 풀에 없다.
    ///
    /// 「안 든다」를 재는 줄은 같은 줄에 이 세대의 표식을 문 행 하나를 앵커로 세운다.
    #[test]
    fn the_exit_takes_this_generations_marks_and_the_pool_trees() {
        let cases = [
            case(
                "풀 셸의 PID 트리 — 표식이 안 읽히는 시스템 바이너리까지. 셸 자신은 안 든다",
                vec![row(101, 100), row(102, 101), row(111, 110).key("G-2")],
                &[("", &[101, 102, 111])],
            ),
            case(
                "이 세대의 표식을 문 것 — 셸이 풀에 없는 키(스스로 끝남, 닫는 중)와 그 밑",
                vec![row(201, 1).key("G-5"), row(202, 201), row(203, 1).key("G-9")],
                &[("", &[201, 202, 203])],
            ),
            case(
                "다른 세대의 표식은 안 든다",
                vec![row(221, 1).key("OLD-1"), row(222, 1).key("G-5")],
                &[("", &[222])],
            ),
            case(
                "세대가 앞글자로만 겹치는 키, 번호가 아닌 꼬리는 안 든다",
                vec![
                    row(223, 1).key("GX-1"),
                    row(224, 1).key("G-"),
                    row(225, 1).key("G-1x"),
                    row(226, 1).key("G-6"),
                ],
                &[("", &[226])],
            ),
            case(
                "앱과 조상 사슬, 앱이 물려받은 키, 앱이 띄운 셸 아닌 자식",
                vec![row(60, 30).key("I-3"), row(61, 60), row(51, APP), row(227, 1).key("G-7")],
                &[("", &[227])],
            ),
            case(
                "pid ≤ 1과 다른 uid — 이 세대의 표식을 물어도",
                vec![row(1, 0).key("G-5"), row(228, 1).uid(0).key("G-5"), row(229, 1).key("G-5")],
                &[("", &[229])],
            ),
            case(
                "예외와 그 밑은 앱이 닫혀도 산다 — 이 세대의 표식을 물어도, 풀 셸의 트리 안이어도",
                vec![
                    row(240, 1).named("tmux").key("G-5"),
                    row(241, 240).key("G-5"),
                    row(124, 100).named("colima"),
                    row(242, 1).key("G-5"),
                ],
                &[("", &[242])],
            ),
        ];

        let ending = [
            shell("G-1", Some(Identity { pid: 100, started_us: 1_100 })),
            shell("G-2", Some(Identity { pid: 110, started_us: 1_110 })),
        ];
        let exceptions = exceptions();
        let mut wrong = Vec::new();
        for case in &cases {
            let mut procs = world();
            for added in &case.rows {
                procs.retain(|p| p.id.pid != added.id.pid);
                procs.push(added.clone());
            }
            let snapshot = Snapshot { uid: UID, procs, skipped: 0 };
            let mut got: Vec<u32> = at_exit(&Inputs {
                snapshot: &snapshot,
                generation: "G",
                shells: &[],
                ending: &ending,
                instances: &[],
                exceptions: &exceptions,
                app_pid: APP,
                inherited_key: case.inherited,
                occasion: Occasion::Normal,
            })
            .into_iter()
            .map(|id| id.pid)
            .collect();
            got.sort_unstable();
            let want: Vec<u32> = case.expect.iter().flat_map(|(_, pids)| pids.clone()).collect();
            if got != want {
                wrong.push(format!("{}\n    기대 {want:?}\n    받음 {got:?}", case.what));
            }
        }
        assert!(wrong.is_empty(), "종료 판정이 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }
}
