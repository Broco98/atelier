//! 판정 — 스냅샷 값만 받아 「무엇이 어느 셸에서 나왔는가」를 가르는 순수 함수(프로세스 결정 2 · 3 ·
//! 프로세스 스펙 S6).
//!
//! **값만 받는 것이 요점이다.** 살아 있는 프로세스로는 「pid가 재사용된 셸」, 「앱을 띄운 사슬」 같은
//! 갈래를 재현할 수 없다. 스냅샷 행 몇 개와 기대 묶음을 한 줄에 두면 모든 갈래를 표로 잰다.
//!
//! **순서는 부르는 쪽이 지킨다: 스냅샷을 먼저 찍고, 셸 목록과 인스턴스 기록은 그 뒤에 읽는다**(프로세스 스펙
//! S52). 셸 키는 자식을 띄우기 전에 기록에 오르므로, 스냅샷에 선 프로세스의 키는 그 뒤에 읽은 목록에 이미 있다 —
//! 막 뜬 셸의 자손이 「셸이 없는 표식」(확정 고아)으로 읽히는 창이 없다.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use super::{exceptions, shell_key, Identity, Proc, Snapshot, ThisRun};

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
/// 판정이 읽는 칸만 둔다. 빌드 종류와 버전은 화면만 읽어 디스크의 기록 쪽에 산다(`instances::InstanceFile`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceRecord {
    pub generation: String,
    /// 그 실행의 앱 프로세스. pid와 시작 시각이 함께 맞아야 살아 있다(프로세스 스펙 S9).
    pub app: Identity,
    /// 그 실행이 쥔 셸 키 — 띄우는 중인 셸과 끝내기가 아직 도는 셸도 든다.
    pub shell_keys: Vec<String>,
    /// 기록을 마지막으로 고친 시각(에포크 µs). 목록에 없는 키를 문 프로세스가 이보다 먼저 태어났으면 확정 고아다.
    pub updated_us: u64,
}

/// 판정을 부르는 때. 스펙은 「모드」라 부르지만 이 저장소에서 모드는 세계(Atelier · Maison)라 이름을
/// 달리 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Occasion {
    Normal,
    /// 앱이 뜰 때 지난 실행이 남긴 것을 치운다(프로세스 결정 6 · 티켓 10). **이 실행의 것은 보지 않는다**(프로세스 스펙
    /// S6) — 시작 정리가 뒤 스레드에서 도는 동안 웹뷰가 첫 셸을 띄우기 때문이다. 보통 판정이 이 실행에 주는 자리(이 실행의
    /// 셸 프로세스, 이 세대의 셸 키)를 만나는 행은 그 자리의 셸이 목록에 있든 없든 어느 묶음에도 넣지 않는다.
    StartupCleanup,
}

/// 판정의 입력 — 스펙 「판 01 › 새 Rust 모듈 › 판정」의 입력 그대로다.
#[derive(Debug, Clone, Copy)]
pub struct Inputs<'a> {
    pub snapshot: &'a Snapshot,
    /// 이 실행 — 세대 · 앱 자신의 pid · 앱이 물려받은 셸 키(`ThisRun`). 부르는 쪽은 `ThisRun::current()`를 준다. 앱이 물려받은
    /// 키는 앱을 아틀리에 셸에서 띄웠을 때만 있다.
    pub run: ThisRun<'a>,
    /// 이 실행의 셸 목록 — 풀에 앉은 셸들. 키만 올리고 아직 풀에 안 앉은 셸은 이 실행의 기록(`instances`)에서 온다.
    pub shells: &'a [ShellEntry],
    /// 끝낼 셸 — 풀에서 이미 뺀 셸들. 목록에서 빠졌어도 그 자손은 이 셸의 것으로 가른다. 여럿인 것은
    /// 새로고침이 풀을 통째로 비우기 때문이다.
    pub ending: &'a [ShellEntry],
    /// 인스턴스 기록들 — 이 실행의 것(세대가 `run.generation`인 것)과 다른 실행들의 것. 이 실행의 기록에 있는 키는
    /// 풀에 없어도 셸 목록에 든다: 띄우는 중인 셸, 풀에서 빠졌지만 끝내기가 아직 도는 셸이다. 이 실행의 기록이 없으면
    /// (앱 신원을 못 읽어 기록을 안 씀) 이 세대의 목록 밖 키는 어느 묶음에도 넣지 않는다 — 확정 고아를 가를 근거가 없다.
    pub instances: &'a [InstanceRecord],
    /// 예외 목록(프로세스 결정 5) — 설정의 `terminal.processExceptions`, `null`이면 기본 목록. 부르는 쪽이 끝낼
    /// 때마다 설정에서 읽어 준다(`settings::process_exceptions`).
    pub exceptions: &'a [String],
    pub occasion: Occasion,
}

/// 판정의 결과 — 셸별 자손, 고아(확정 고아 · 출처 불명), 다른 인스턴스, 예외. 셸별 자손 중 셸 도우미를 따로
/// 표시한다. 어느 묶음에도 없는 것(판정 밖)은 싣지 않는다. 묶음끼리 겹치지 않는다.
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
    /// 고아 — 셸 키를 물었는데 그 셸이 없는 것(프로세스 결정 6).
    pub orphans: Orphans<'a>,
    /// 다른 인스턴스 — 살아 있는 다른 실행의 셸 목록에 있는 키를 문 것과 그 트리. 그 실행의 기록이 갱신된 **뒤에**
    /// 태어난 것(확정 고아 (나)의 시각 조건에 안 걸린 것)도 여기 둔다. 셸 키마다, pid 순. 판정이 부작용을 모르므로
    /// 아무도 끝내지 않는다 — 그 실행이 제 셸을 닫을 때 끝낸다.
    pub other_instances: BTreeMap<&'a str, Vec<&'a Proc>>,
}

/// 고아 — 셸 키를 물었는데 그 셸이 없는 프로세스(프로세스 결정 6). 두 갈래다. 셸 키마다 그 키를 문 것과 그 트리(표식이
/// 안 읽히는 시스템 바이너리 자손)가 선다. pid 순.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Orphans<'a> {
    /// 확정 고아 — 그 셸이 없는 것이 **기록으로 확실한** 것. (가) 그 키를 낸 실행이 죽었다(기록의 앱 pid가 없거나 시작
    /// 시각이 다르다). (나) 실행은 살아 있는데 그 셸이 목록에 없고, 그 프로세스가 그 기록의 갱신 시각보다 먼저 태어났다.
    /// 이 실행의 세대도 보통 판정에서는 (나)로 가른다 — 풀에서 빠진 셸이 남긴 것이다. 셸 스스로 끝남도 그 키를 문 생존자를
    /// 곧바로 끝내고 끝내기 뒤에 키를 내리므로(티켓 13), 여기 남는 것은 그 끝내기가 못 끝낸 것과 판정 뒤에 막 뜬 것뿐이다.
    /// 앱이 뜰 때 치우는 것은 지난 실행이 남긴 것뿐이다(`at_startup` — 시작 정리 모드는 이 실행의 세대를 안 본다).
    pub confirmed: BTreeMap<&'a str, Vec<&'a Proc>>,
    /// 출처 불명 — 인스턴스 기록이 없는 세대의 키를 문 것. 이 기능 전의 판이 띄운 것, 데이터 루트가 다른 빌드
    /// (`ATELIER_HOME`)가 띄운 것, 기록이 깨진 실행의 것. 누구의 것인지 모르니 **자동으로는 절대 안 건드린다**.
    pub unknown: BTreeMap<&'a str, Vec<&'a Proc>>,
}

/// 셸마다 그 셸이 띄운 자손을 가른다.
///
/// **예외를 가장 먼저 가른다**(프로세스 결정 5). 자기나 조상 중 하나가 예외 목록에 걸리면 예외이고, 다른 묶음에
/// 안 든다 — 표식을 물었어도, 다른 세대의 표식이어도. 판정을 부르는 모든 길(셸 닫기, 새로고침, 앱 종료)이 이
/// 함수를 지나므로 예외는 어느 길로도 안 끝난다.
///
/// 셸별 자손 = 그 셸의 PID 트리 ∪ 그 셸 키를 문 것 ∪ 그것들의 트리. 한 프로세스는 **가장 가까운
/// 자리**가 정한다: 자기 자신의 표식, 그다음 부모, 그 부모… 순으로 올라가다 처음 만나는 셸 프로세스나
/// 셸 키가 그 프로세스의 셸이다. 그래서 한 프로세스가 두 셸에 들지 않는다. 셸 목록은 풀의 셸 ∪ 끝낼 셸 ∪ 이 실행의
/// 기록에 있는 키다(프로세스 스펙 S52).
///
/// **셸별 자손이 아닌 표식 행은 고아나 다른 인스턴스로 간다**(프로세스 결정 6). 셸별 자손을 먼저 가르는 것이 요점이다 —
/// 우리 셸의 트리 안에 있으면 다른 세대의 표식을 물어도(셸에서 띄운 dev 앱의 셸) 우리 셸의 자손이고 고아가 아니다. 남은
/// 행은 자기부터 올라가다 **처음 만나는 표식**이 묶음을 정하고, 그 밑의 시스템 바이너리(표식이 안 읽힌다)는 그 표식을
/// 따라간다. 표식마다 가르는 규칙은 `Orphans`와 `Verdict::other_instances`에 있다. 이 실행의 세대인데 목록에 없고 기록
/// 갱신 뒤에 태어난 것은 어느 묶음에도 없다 — 다음 판정이 다시 본다.
///
/// **어느 묶음에도 넣지 않는 것**(프로세스 스펙 S6): pid ≤ 1, 앱 자신과 그 조상 사슬, 앱이 물려받은
/// 셸 키를 문 것, 앱과 uid가 다른 것. 앞의 둘(사슬과 물려받은 키)은 **길도 막는다** — 그 밑에 달린
/// 것은 위로 올라가다 거기서 멈춰 판정 밖이 된다. 앱을 셸에서 띄우면(설치본 셸에서 `pnpm tauri dev`)
/// 앱과 그 조상, 그리고 그 도구가 함께 띄운 형제 가지(vite와 그 밑)가 모두 그 셸의 키를 물기 때문이다.
/// uid가 다른 것은 길을 막지 않는다: `sudo`로 띄운 것 밑에 다시 사용자의 것이 달릴 수 있다.
///
/// **시작 정리 모드는 이 실행의 것을 어느 묶음에도 넣지 않는다**(`Occasion::StartupCleanup`). 이 실행의 것 = 셸별 자손을
/// 가르는 그 걷기(가장 가까운 자리)가 이 실행의 자리를 만나는 행이다. 이 모드에서는 이 세대의 셸 키가 모두 이 실행의
/// 자리다 — 목록에 없어도. 예외보다 먼저 거른다: 앱과 조상 사슬, 물려받은 키처럼 판정 밖이다.
pub fn judge<'a>(input: &Inputs<'a>) -> Verdict<'a> {
    let procs = &input.snapshot.procs;
    let table = Table::of(procs);
    let startup = input.occasion == Occasion::StartupCleanup;
    let shells: Vec<&'a ShellEntry> = input.shells.iter().chain(input.ending).collect();
    // 이 실행의 기록. 여기 있는 키는 풀에 없어도 셸이다 — 키를 올리고 아직 풀에 안 앉은 셸, 풀에서 빠졌지만 끝내기가
    // 아직 도는 셸. 셸 프로세스를 모르니 표식으로만 자손을 갖는다.
    let own = input.instances.iter().find(|record| record.generation == input.run.generation);
    let recorded: Vec<&'a str> = own.map_or_else(Vec::new, |record| record.shell_keys.iter().map(String::as_str).collect());

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
    let keys: HashSet<&'a str> =
        shells.iter().map(|shell| shell.key.as_str()).chain(recorded.iter().copied()).collect();
    // 이 실행의 셸 키인가. 시작 정리는 이 세대의 키를 모두 이 실행의 것으로 친다 — 목록에 없는 키(보통 판정이면 확정
    // 고아 (나)가 될 수 있다)도 이 실행이 가를 몫이지 시작 정리가 치울 몫이 아니다.
    let ours = |key: &'a str| keys.contains(key) || (startup && shell_key::of_generation(key, input.run.generation));
    // 셸마다 사람이 처음 입력한 시각. 같은 키가 두 번 서면(종료 판정이 풀에서 뺀 셸의 키를 한 번 더 더한다) 앞의
    // 것이 이긴다 — 셸 목록, 그다음 끝낼 셸 순이고 더한 키는 맨 뒤다.
    let mut first_input: HashMap<&'a str, Option<u64>> = HashMap::new();
    for shell in &shells {
        first_input.entry(shell.key.as_str()).or_insert(shell.first_input_us);
    }

    // 행이 없어도 앱 자신은 막는다.
    let mut blocked: HashSet<u32> = table.lineage(input.run.app_pid).collect();
    blocked.insert(input.run.app_pid);
    if let Some(inherited) = input.run.inherited_key {
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
    let excepted = |proc: &'a Proc| table.up_until(proc, &blocked).any(|node| exceptions::caught(input.exceptions, node));

    // 자기부터 부모를 따라 올라가다 처음 만나는 자리가 그 행의 셸이다. 막힌 행을 만나거나 끝까지
    // 올라가면 판정 밖이다.
    let owner_of = |proc: &'a Proc| -> Option<&'a str> {
        table.up_until(proc, &blocked).find_map(|node| {
            shell_at.get(&node.id.pid).copied().or_else(|| node.shell_key.as_deref().filter(|&key| ours(key)))
        })
    };

    // 셸별 자손이 아닌 표식 행이 어느 묶음에 드나 — 그 행부터 올라가다 **처음 만나는 표식**이 정한다. 그 표식이 어느 묶음에도
    // 안 들면(이 실행의 세대인데 기록 갱신 뒤에 태어났다) 더 올라가지 않는다. 막힌 행을 만나거나 끝까지 표식이 없으면 판정 밖이다.
    let stray_of = |proc: &'a Proc| -> Option<(Stray, &'a str)> {
        let carrier = table.up_until(proc, &blocked).find(|node| node.shell_key.is_some())?;
        let key = carrier.shell_key.as_deref()?;
        stray(key, carrier, own, input, &table).map(|bundle| (bundle, key))
    };

    let mut descendants: BTreeMap<&'a str, Vec<&'a Proc>> =
        keys.iter().map(|key| (*key, Vec::new())).collect();
    let mut excepted_rows = Vec::new();
    let mut helpers = BTreeSet::new();
    let mut orphans = Orphans::default();
    let mut other_instances: BTreeMap<&'a str, Vec<&'a Proc>> = BTreeMap::new();
    for proc in procs {
        let pid = proc.id.pid;
        if pid <= 1
            || proc.uid != input.snapshot.uid
            || blocked.contains(&pid)
            || shell_at.contains_key(&pid)
        {
            continue;
        }
        // 시작 정리는 이 실행의 것을 안 본다 — 셸별 자손도, 그 안의 예외도.
        if startup && owner_of(proc).is_some() {
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
        } else if let Some((bundle, key)) = stray_of(proc) {
            let bundle = match bundle {
                Stray::Confirmed => &mut orphans.confirmed,
                Stray::Unknown => &mut orphans.unknown,
                Stray::OtherInstance => &mut other_instances,
            };
            bundle.entry(key).or_default().push(proc);
        }
    }
    for members in descendants
        .values_mut()
        .chain(orphans.confirmed.values_mut())
        .chain(orphans.unknown.values_mut())
        .chain(other_instances.values_mut())
    {
        members.sort_by_key(|p| p.id.pid);
    }
    excepted_rows.sort_by_key(|p| p.id.pid);
    Verdict { descendants, exceptions: excepted_rows, helpers, orphans, other_instances }
}

/// 셸별 자손이 아닌 표식 행의 묶음.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stray {
    Confirmed,
    Unknown,
    OtherInstance,
}

/// 셸 키 하나와 그 키를 문 행(`carrier`)으로 묶음을 가른다 — 셸 목록에 없는 키다(`judge`가 먼저 걸렀다).
///
/// - 이 실행의 세대: 이 실행은 살아 있다. 그 행이 이 실행의 기록 갱신 전에 태어났으면 확정 고아 (나), 아니면 어느 묶음에도
///   없다(그 사이 뜬 셸일 수 있다 — 다음 판정이 다시 본다). 이 실행의 기록이 없으면 가를 근거가 없어 어느 묶음에도 없다.
/// - 다른 세대: 기록이 없으면 출처 불명. 그 실행이 죽었으면(앱 신원이 스냅샷에 없다) 확정 고아 (가). 살아 있고 그 셸이
///   목록에 있으면 다른 인스턴스. 목록에 없으면 기록 갱신 전 태생은 확정 고아 (나), 뒤 태생은 다른 인스턴스.
fn stray(
    key: &str,
    carrier: &Proc,
    own: Option<&InstanceRecord>,
    input: &Inputs,
    table: &Table,
) -> Option<Stray> {
    let before = |record: &InstanceRecord| carrier.id.started_us < record.updated_us;
    if shell_key::of_generation(key, input.run.generation) {
        return own.filter(|record| before(record)).map(|_| Stray::Confirmed);
    }
    let Some(record) = input.instances.iter().find(|record| shell_key::of_generation(key, &record.generation)) else {
        return Some(Stray::Unknown);
    };
    Some(if !table.alive(record) || (!record.shell_keys.iter().any(|listed| listed == key) && before(record)) {
        Stray::Confirmed
    } else {
        Stray::OtherInstance
    })
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
///
/// 셸 도우미도 함께 준다 — 끝내기에는 그대로 넘기고, 정리 기록이 「셸과 도우미만 끝난 종료」를 안 적는 데 쓴다(티켓 11).
/// 풀 셸의 도우미는 그 셸의 입력 시각으로 가른다. **셸이 풀에 없는 키의 자손은 도우미로 안 친다** — 그 셸의 입력 시각을
/// 모른다. 입력이 없다고 읽으면(보통 판정의 `None`) 스스로 끝난 셸이 남긴 사람의 것까지 도우미가 되어 기록에서 사라진다.
pub fn at_exit(input: &Inputs) -> Exit {
    // 셸 프로세스를 모르는 끝낼 셸로 더한다 — 판정은 그 키를 문 행과 그 밑을 그 셸의 자손으로 고른다. 풀에서
    // 뺀 셸의 키가 한 번 더 서도 판정은 키를 집합으로 읽어 같은 답이다(입력 시각도 앞에 선 풀의 셸 것이 이긴다).
    let marked: BTreeSet<&str> = input
        .snapshot
        .procs
        .iter()
        .filter_map(|proc| proc.shell_key.as_deref())
        .filter(|key| shell_key::of_generation(key, input.run.generation))
        .collect();
    let mut ending = input.ending.to_vec();
    ending.extend(marked.into_iter().map(|key| ShellEntry {
        key: key.to_string(),
        process: None,
        first_input_us: Some(0),
    }));
    let verdict = judge(&Inputs { ending: &ending, ..*input });
    Exit {
        targets: verdict.descendants.into_values().flatten().map(|proc| proc.id).collect(),
        helpers: verdict.helpers,
    }
}

/// 앱 종료가 끝낼 것(`at_exit`) — 신원과, 그중 셸 도우미.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exit {
    pub targets: Vec<Identity>,
    pub helpers: BTreeSet<Identity>,
}

/// **시작 정리의 판정** — 끝낼 것(프로세스 결정 6 · 티켓 10). 지난 실행이 남긴 **확정 고아와 그 트리뿐**이다.
///
/// 출처 불명(누구의 것인지 모른다), 다른 인스턴스(살아 있는 실행이 제 셸을 닫을 때 끝낸다), 예외(늘 예외다 — 죽은 세대의
/// 키를 물었어도)는 안 든다. 이 실행의 것도 안 든다 — 부르는 쪽이 모드를 무엇으로 주든 시작 정리 모드로 판정한다
/// (`Occasion::StartupCleanup`). 이 세대의 확정 고아는 이 실행이 제 판정(스스로 끝난 셸 · 종료)으로 가른다.
///
/// 행을 돌려주는 것은 끝낸 뒤 알릴 이름(시작 보고)까지 들고 가기 위해서다. pid 순.
pub fn at_startup<'a>(input: &Inputs<'a>) -> Vec<&'a Proc> {
    let verdict = judge(&Inputs { occasion: Occasion::StartupCleanup, ..*input });
    let mut targets: Vec<&'a Proc> = verdict.orphans.confirmed.into_values().flatten().collect();
    targets.sort_by_key(|proc| proc.id.pid);
    targets
}

/// **죽은 실행의 기록** — 이 실행 말고, 앱이 스냅샷에 없는 기록들(프로세스 스펙 S9). 확정 고아 (가)를 가르는 규칙과 한 자리다
/// (`Table::alive`). 시작 정리가 그 고아를 끝낸 뒤 이 기록들을 지운다(프로세스 스펙 「인스턴스 기록 › 지우는 때」).
pub fn dead_instances<'a>(input: &Inputs<'a>) -> Vec<&'a InstanceRecord> {
    let table = Table::of(&input.snapshot.procs);
    input
        .instances
        .iter()
        .filter(|record| record.generation != input.run.generation && !table.alive(record))
        .collect()
}

/// 스냅샷을 pid로 찾는 표 — 부모를 따라 올라가는 데 쓴다.
struct Table<'a> {
    by_pid: HashMap<u32, &'a Proc>,
    rows: usize,
}

impl<'a> Table<'a> {
    fn of(procs: &'a [Proc]) -> Self {
        Table { by_pid: procs.iter().map(|p| (p.id.pid, p)).collect(), rows: procs.len() }
    }

    /// 그 기록의 실행이 살아 있나 — 앱 pid의 행이 있고 시작 시각도 같다(프로세스 스펙 S9). pid만 보면 그 pid를 받은 남을
    /// 그 실행으로 본다.
    fn alive(&self, record: &InstanceRecord) -> bool {
        self.by_pid.get(&record.app.pid).is_some_and(|row| row.id == record.app)
    }

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

    /// 이 행부터 올라가다 **막힌 행(`stop`) 앞에서 끊는** 사슬(프로세스 스펙 S6). 판정의 걷기 셋(예외 · 셸 자리 · 표식)이 모두
    /// 이 사슬을 걷는다 — 막힌 행(앱과 조상 사슬, 물려받은 키를 문 것)의 위는 앱을 띄운 쪽이라 어느 걷기도 거기를 넘지 않는다.
    fn up_until<'s>(&'s self, start: &'a Proc, stop: &'s HashSet<u32>) -> impl Iterator<Item = &'a Proc> + 's {
        self.up_from(start).take_while(move |node| !stop.contains(&node.id.pid))
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

    /// 이 실행 — 세대 `generation`, 앱 `APP`, 물려받은 키 없음. 물려받은 키를 재는 줄은 그 칸만 바꿔 짓는다
    /// (`ThisRun { inherited_key: …, ..run("G") }`).
    fn run(generation: &str) -> ThisRun<'_> {
        ThisRun { generation, app_pid: APP, inherited_key: None }
    }

    /// 스냅샷 한 행. 시작 시각은 따로 안 주면 pid를 따른다 — 부모가 자식보다 먼저 태어나게.
    fn row(pid: u32, ppid: u32) -> Proc {
        Proc {
            id: Identity { pid, started_us: 1_000 + u64::from(pid) },
            ppid,
            pgid: pid,
            uid: UID,
            name: format!("p{pid}"),
            argv0: None,
            command: None,
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
        /// 기대 확정 고아 · 출처 불명 · 다른 인스턴스 — 셸 키마다 pid. 적지 않으면 비어 있다.
        confirmed: Vec<(&'static str, Vec<u32>)>,
        unknown: Vec<(&'static str, Vec<u32>)>,
        others: Vec<(&'static str, Vec<u32>)>,
        /// 판정을 부르는 때. 따로 안 주면 보통이다.
        occasion: Occasion,
    }

    fn case(what: &'static str, rows: Vec<Proc>, expect: &[(&'static str, &[u32])]) -> Case {
        Case {
            what,
            rows,
            inherited: Some("I-3"),
            expect: listed(expect),
            excepted: Vec::new(),
            confirmed: Vec::new(),
            unknown: Vec::new(),
            others: Vec::new(),
            occasion: Occasion::Normal,
        }
    }

    fn listed(bundle: &[(&'static str, &[u32])]) -> Vec<(&'static str, Vec<u32>)> {
        bundle.iter().map(|(key, pids)| (*key, pids.to_vec())).collect()
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
        /// 확정 고아.
        fn orphaned(mut self, bundle: &[(&'static str, &[u32])]) -> Case {
            self.confirmed = listed(bundle);
            self
        }
        /// 출처 불명.
        fn of_unknown_origin(mut self, bundle: &[(&'static str, &[u32])]) -> Case {
            self.unknown = listed(bundle);
            self
        }
        /// 다른 인스턴스.
        fn of_other_instance(mut self, bundle: &[(&'static str, &[u32])]) -> Case {
            self.others = listed(bundle);
            self
        }
        /// 시작 정리 모드로 판정한다(티켓 10).
        fn at_startup(mut self) -> Case {
            self.occasion = Occasion::StartupCleanup;
            self
        }
    }

    /// 판정이 낸 묶음 전부를 pid로 — 표의 한 줄과 견주는 모양이다. **모든 줄이 모든 묶음을 잰다**: 「셸의 자손이 아니다」를
    /// 재는 줄이 그 행이 어디로 갔는지(고아 · 다른 인스턴스 · 판정 밖)까지 함께 못박는다.
    #[derive(Debug, PartialEq)]
    struct Bundles {
        descendants: BTreeMap<String, Vec<u32>>,
        excepted: Vec<u32>,
        confirmed: BTreeMap<String, Vec<u32>>,
        unknown: BTreeMap<String, Vec<u32>>,
        others: BTreeMap<String, Vec<u32>>,
    }

    fn pids_of(bundle: &BTreeMap<&str, Vec<&Proc>>) -> BTreeMap<String, Vec<u32>> {
        bundle.iter().map(|(key, procs)| (key.to_string(), procs.iter().map(|p| p.id.pid).collect())).collect()
    }

    fn wanted(bundle: &[(&'static str, Vec<u32>)]) -> BTreeMap<String, Vec<u32>> {
        bundle.iter().map(|(key, pids)| (key.to_string(), pids.clone())).collect()
    }

    /// 표의 한 줄을 판정해 어긋났으면 그 까닭을 준다. `shell_keys`는 셸별 자손에 서야 할 키 전부다(자손이 없으면 빈 목록).
    fn misjudged(
        case: &Case,
        world: Vec<Proc>,
        shells: &[ShellEntry],
        ending: &[ShellEntry],
        instances: &[InstanceRecord],
        shell_keys: &[&str],
    ) -> Option<String> {
        let mut procs = world;
        for added in &case.rows {
            procs.retain(|p| p.id.pid != added.id.pid);
            procs.push(added.clone());
        }
        let snapshot = Snapshot { uid: UID, procs, skipped: 0 };
        let exceptions = exceptions();
        let verdict = judge(&Inputs {
            snapshot: &snapshot,
            run: ThisRun { inherited_key: case.inherited, ..run("G") },
            shells,
            ending,
            instances,
            exceptions: &exceptions,
            occasion: case.occasion,
        });
        let got = Bundles {
            descendants: pids_of(&verdict.descendants),
            excepted: verdict.exceptions.iter().map(|p| p.id.pid).collect(),
            confirmed: pids_of(&verdict.orphans.confirmed),
            unknown: pids_of(&verdict.orphans.unknown),
            others: pids_of(&verdict.other_instances),
        };
        let mut descendants: BTreeMap<String, Vec<u32>> =
            shell_keys.iter().map(|key| (key.to_string(), Vec::new())).collect();
        descendants.extend(wanted(&case.expect));
        let want = Bundles {
            descendants,
            excepted: case.excepted.clone(),
            confirmed: wanted(&case.confirmed),
            unknown: wanted(&case.unknown),
            others: wanted(&case.others),
        };
        (got != want).then(|| format!("{}\n    기대 {want:?}\n    받음 {got:?}", case.what))
    }

    /// **판정 표.** 한 줄에 스냅샷 행과 기대 묶음을 둔다.
    ///
    /// 「어느 묶음에도 없다」를 재는 줄은 **빠지는 행이 살아 있는 셸의 표식을 물게** 두고, 같은 줄에 그
    /// 셸의 자손 하나를 앵커로 세운다. 표식이 없는 행은 규칙이 없어도 어차피 어디에도 안 든다 — 그러면 그 줄은
    /// 아무것도 재지 않는다.
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
            // 이 표에는 인스턴스 기록이 없다 — 이 실행의 기록을 못 쓴 채(신원을 못 읽음) 판정하는 셈이다. 그러면 이 세대의
            // 목록 밖 키는 확정 고아가 될 근거(기록의 갱신 시각)가 없어 어느 묶음에도 안 든다. 자동으로 끝내는 것이 없는
            // 쪽이다. 기록이 있을 때의 갈래는 `strays_split_into_orphans_and_other_instances`가 잰다.
            case(
                "셸 목록에 없는 키는 셸의 자손이 아니다 — 기록이 없으면 이 세대의 키는 어느 묶음에도 없고, 남의 키는 출처 불명",
                vec![row(220, 1).key("G-7"), row(221, 1).key("OLD-1"), row(222, 1).key("G-1")],
                &[("G-1", &[222])],
            )
            .of_unknown_origin(&[("OLD-1", &[221])]),
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
        let wrong: Vec<String> = cases
            .iter()
            .filter_map(|case| misjudged(case, world(), &shells, &ending, &[], &["G-1", "G-2", "G-3"]))
            .collect();
        assert!(wrong.is_empty(), "판정이 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// 인스턴스 기록 표가 쓰는 기록들(프로세스 결정 6 · 프로세스 스펙 S8 · S9). 모두 갱신 시각이 5_000이다.
    ///
    /// - G — **이 실행**(앱 50). 풀의 셸 G-1(100), 끝내는 중인 G-2(110), 키만 올리고 아직 풀에 안 앉은 G-4.
    /// - D — 살아 있는 다른 실행(앱 70). 셸 D-1.
    /// - R — 앱 pid 80이 살아 있지만 시작 시각이 다르다 — 그 pid를 남이 받았다. 죽은 실행이다.
    /// - X — 앱 pid 90이 없다. 죽은 실행이다.
    /// - I — 이 앱을 띄운 설치본(앱 10). 셸 I-3이 이 앱의 조상 사슬이다.
    /// - 기록이 없는 세대 OLD — 이 기능 전의 판이 띄운 것.
    fn records() -> Vec<InstanceRecord> {
        let record = |generation: &str, pid: u32, started_us: u64, keys: &[&str]| InstanceRecord {
            generation: generation.to_string(),
            app: Identity { pid, started_us },
            shell_keys: keys.iter().map(|key| key.to_string()).collect(),
            updated_us: 5_000,
        };
        vec![
            record("G", APP, 1_050, &["G-1", "G-2", "G-4"]),
            record("D", 70, 1_070, &["D-1"]),
            record("R", 80, 900, &["R-1"]),
            record("X", 90, 1_090, &["X-1"]),
            record("I", 10, 1_010, &["I-3"]),
        ]
    }

    /// **셸별 자손이 아닌 표식 행을 가른다**(프로세스 결정 6 · 프로세스 스펙 S52 · 티켓 09) — 확정 고아, 출처 불명, 다른 인스턴스.
    ///
    /// 예외가 가장 먼저이고, 그다음 셸별 자손이다. 남은 행은 자기부터 부모를 따라 올라가다 **처음 만나는 표식**이 묶음을
    /// 정한다 — 표식이 안 읽히는 시스템 바이너리는 그 위의 표식을 따라간다. 판정 밖(앱과 조상 사슬, 물려받은 키)을 만나면
    /// 거기서 멈춘다.
    ///
    /// 「어느 묶음에도 없다」를 재는 줄은 같은 줄에 묶음에 드는 행 하나를 앵커로 세운다.
    #[test]
    fn strays_split_into_orphans_and_other_instances() {
        let cases = [
            // ── 이 실행의 세대(G, 기록 갱신 5_000)
            case(
                "이 실행의 세대 · 기록에 있고 풀에는 아직 없는 키(띄우는 중인 셸) → 셸별 자손이다. 확정 고아가 아니다",
                vec![row(301, 1).key("G-4").born(3_000), row(302, 301).born(3_100)],
                &[("G-4", &[301, 302])],
            ),
            case(
                "이 실행의 세대 · 목록에 없는 키 · 기록 갱신 전에 태어남 → 확정 고아 — 스스로 끝난 셸이 남긴 것",
                vec![row(303, 1).key("G-7").born(3_000)],
                &[],
            )
            .orphaned(&[("G-7", &[303])]),
            case(
                "이 실행의 세대 · 목록에 없는 키 · 기록 갱신 뒤에 태어남 → 어느 묶음에도 없다(다음 판정이 다시 본다)",
                vec![row(304, 1).key("G-8").born(6_000), row(303, 1).key("G-7").born(3_000)],
                &[],
            )
            .orphaned(&[("G-7", &[303])]),
            // ── 다른 세대
            case("다른 세대 · 기록 없음 → 출처 불명", vec![row(310, 1).key("OLD-1")], &[])
                .of_unknown_origin(&[("OLD-1", &[310])]),
            case("다른 세대 · 인스턴스 죽음(앱 pid가 없다) → 확정 고아", vec![row(311, 1).key("X-1")], &[])
                .orphaned(&[("X-1", &[311])]),
            case(
                "다른 세대 · 앱 pid는 살았는데 시작 시각이 다름(재사용) → 확정 고아",
                vec![row(312, 1).key("R-1")],
                &[],
            )
            .orphaned(&[("R-1", &[312])]),
            case(
                "다른 세대 · 살아 있고 그 셸이 목록에 있음 → 다른 인스턴스 — 기록 갱신 전에 태어났어도",
                vec![row(313, 1).key("D-1").born(3_000)],
                &[],
            )
            .of_other_instance(&[("D-1", &[313])]),
            case(
                "다른 세대 · 살아 있는데 그 셸이 목록에 없음 · 기록 갱신 전에 태어남 → 확정 고아",
                vec![row(314, 1).key("D-2").born(3_000)],
                &[],
            )
            .orphaned(&[("D-2", &[314])]),
            case(
                "다른 세대 · 살아 있는데 그 셸이 목록에 없음 · 기록 갱신 뒤에 태어남 → 다른 인스턴스",
                vec![row(315, 1).key("D-3").born(6_000)],
                &[],
            )
            .of_other_instance(&[("D-3", &[315])]),
            // ── 예외가 가장 먼저다(프로세스 결정 5)
            case(
                "죽은 세대의 키를 문 예외 이름 프로세스와 그 밑의 표식 프로세스 → 예외. 확정 고아가 아니다",
                vec![
                    row(320, 1).named("tmux").key("X-1"),
                    row(321, 320).key("X-1"),
                    row(322, 321),
                    row(311, 1).key("X-1"),
                ],
                &[],
            )
            .excepting(&[320, 321, 322])
            .orphaned(&[("X-1", &[311])]),
            // ── 트리
            case(
                "확정 고아의 트리 안 시스템 바이너리 자손은 그 고아 묶음에 든다",
                vec![row(311, 1).key("X-1"), row(323, 311), row(324, 323)],
                &[],
            )
            .orphaned(&[("X-1", &[311, 323, 324])]),
            case(
                "출처 불명 · 다른 인스턴스의 트리 안 시스템 바이너리도 그 묶음에 든다",
                vec![row(310, 1).key("OLD-1"), row(325, 310), row(313, 1).key("D-1"), row(326, 313)],
                &[],
            )
            .of_unknown_origin(&[("OLD-1", &[310, 325])])
            .of_other_instance(&[("D-1", &[313, 326])]),
            case(
                "가장 가까운 표식이 정한다 — 확정 고아 밑에서 떠도 살아 있는 실행의 셸 키를 문 것과 그 밑은 다른 인스턴스",
                vec![row(311, 1).key("X-1"), row(327, 311).key("D-1"), row(328, 327)],
                &[],
            )
            .orphaned(&[("X-1", &[311])])
            .of_other_instance(&[("D-1", &[327, 328])]),
            case(
                "가장 가까운 표식이 정한다 — 그 표식이 어느 묶음에도 안 들면(이 실행의 세대 · 기록 갱신 뒤 태생) 위의 표식을 따르지 \
                 않는다",
                vec![row(311, 1).key("X-1"), row(308, 311).key("G-8").born(6_000), row(309, 308).born(6_100)],
                &[],
            )
            .orphaned(&[("X-1", &[311])]),
            case(
                "셸의 트리 안에서는 죽은 세대의 표식을 물어도 그 셸의 자손이다 — 고아가 아니다",
                vec![row(115, 100).key("X-1"), row(116, 115)],
                &[("G-1", &[115, 116])],
            ),
            // ── 판정 밖(프로세스 스펙 S6). 03은 물려받은 키를 이 실행의 셸 키로 두고 쟀다 — 여기서는 다른 세대로 다시 잰다.
            case(
                "앱이 물려받은 키를 문 형제 가지(vite와 그 밑) — 그 키를 낸 설치본이 죽어도 확정 고아가 아니다",
                vec![
                    row(10, 1).born(9_000),
                    row(60, 30).key("I-3"),
                    row(61, 60),
                    row(62, 60).key("I-3"),
                    row(317, 1).key("I-5"),
                ],
                &[],
            )
            .orphaned(&[("I-5", &[317])]),
            // 물려받은 키(I-3)와 다른, 죽은 세대의 키를 사슬이 문다 — 사슬이라서 빠지는지만 잰다.
            case(
                "앱과 조상 사슬은 죽은 세대의 키를 물어도 확정 고아가 아니다. 그 밑에서 앱이 띄운 셸 아닌 자식(표식 없음)도",
                vec![
                    row(30, 20).key("X-1"),
                    row(40, 30).key("X-1"),
                    row(APP, 40).key("X-1"),
                    row(52, APP),
                    row(311, 1).key("X-1"),
                ],
                &[],
            )
            .orphaned(&[("X-1", &[311])]),
            case(
                "pid ≤ 1과 다른 uid — 죽은 세대의 키를 물어도",
                vec![row(1, 0).key("X-1"), row(318, 1).uid(0).key("X-1"), row(311, 1).key("X-1")],
                &[],
            )
            .orphaned(&[("X-1", &[311])]),
        ];

        let wrong = misjudged_on_the_records(&cases);
        assert!(wrong.is_empty(), "판정이 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// 인스턴스 기록 표(`records`)의 줄들을 판정해 어긋난 줄마다 그 까닭을 준다.
    ///
    /// 이 실행: 풀의 셸 G-1과 끝내는 중인 G-2. G-4는 기록에만 있다 — 판정이 기록에서 읽어 셸 목록에 더한다. 세상에는
    /// 살아 있는 다른 실행의 앱(70)과, 죽은 실행 R의 앱 pid를 받은 남(80)이 더 있다.
    fn misjudged_on_the_records(cases: &[Case]) -> Vec<String> {
        let shells = [shell("G-1", Some(Identity { pid: 100, started_us: 1_100 }))];
        let ending = [shell("G-2", Some(Identity { pid: 110, started_us: 1_110 }))];
        let mut world = world();
        world.extend([row(70, 1), row(80, 1)]);
        let records = records();
        cases
            .iter()
            .filter_map(|case| misjudged(case, world.clone(), &shells, &ending, &records, &["G-1", "G-2", "G-4"]))
            .collect()
    }

    /// **시작 정리 모드는 이 실행의 것을 보지 않는다**(프로세스 스펙 S6 · 티켓 10). 시작 정리가 뒤 스레드에서 도는 동안 웹뷰가
    /// 첫 셸을 띄운다 — 그 셸의 자손이 막 뜬 순간을 어떻게 읽든, 시작 정리가 손댈 것은 지난 실행이 남긴 것뿐이다.
    ///
    /// 「이 실행의 것」은 보통 판정이 이 실행에 주는 자리 그대로다 — 자기부터 올라가다 처음 만나는 자리(이 실행의 셸 프로세스나
    /// 이 세대의 셸 키)가 이 실행의 것이면 어느 묶음에도 없다. 그래서 이 실행의 셸 트리 안에 있는 죽은 세대의 표식도 빠진다
    /// (보통 판정이면 그 셸의 자손이다). 목록에 없는 이 세대의 키는 보통 판정이면 확정 고아 (나)가 될 수 있지만(위 표) 여기서는
    /// 아니다.
    ///
    /// 「없다」를 재는 줄마다 죽은 세대의 확정 고아(311)나 다른 세대의 예외를 앵커로 세운다 — 시작 정리 모드가 아무것도 안
    /// 가르게 무너지면 앵커가 빠진다.
    #[test]
    fn the_startup_cleanup_sees_nothing_of_this_run() {
        let cases = [
            case(
                "이 실행의 세대 · 목록에 없는 키 · 기록 갱신 전에 태어남(보통이면 확정 고아)과 그 밑의 시스템 바이너리 → 어느 묶음에도 \
                 없다",
                vec![row(303, 1).key("G-7").born(3_000), row(305, 303).born(3_100), row(311, 1).key("X-1")],
                &[],
            )
            .orphaned(&[("X-1", &[311])])
            .at_startup(),
            case(
                "이 실행의 셸 — 풀의 셸 트리, 끝내는 중인 셸의 표식, 기록에만 있는 키(띄우는 중) → 셸별 자손에도 없다",
                vec![
                    row(101, 100).key("G-1"),
                    row(102, 101),
                    row(103, 100),
                    row(111, 110).key("G-2"),
                    row(301, 1).key("G-4").born(3_000),
                    row(311, 1).key("X-1"),
                ],
                &[],
            )
            .orphaned(&[("X-1", &[311])])
            .at_startup(),
            case(
                "이 실행의 셸 트리 안이면 죽은 세대의 표식을 물어도 없다 — 셸 프로세스 밑이든, 이 세대의 표식을 문 것 밑이든",
                vec![
                    row(115, 100).key("X-1"),
                    row(116, 115),
                    row(306, 1).key("G-7").born(3_000),
                    row(307, 306).key("X-1").born(3_100),
                    row(311, 1).key("X-1"),
                ],
                &[],
            )
            .orphaned(&[("X-1", &[311])])
            .at_startup(),
            case(
                "이 세대의 표식을 문 예외 이름과 그 밑도 없다 — 다른 세대의 예외는 그대로 예외",
                vec![
                    row(330, 1).named("tmux").key("G-5"),
                    row(331, 330),
                    row(320, 1).named("tmux").key("X-1"),
                    row(321, 320),
                ],
                &[],
            )
            .excepting(&[320, 321])
            .at_startup(),
            case(
                "다른 세대는 보통과 같다 — 확정 고아 (가) · (나), 출처 불명, 다른 인스턴스",
                vec![
                    row(311, 1).key("X-1"),
                    row(312, 1).key("R-1"),
                    row(314, 1).key("D-2").born(3_000),
                    row(310, 1).key("OLD-1"),
                    row(313, 1).key("D-1"),
                    row(315, 1).key("D-3").born(6_000),
                ],
                &[],
            )
            .orphaned(&[("X-1", &[311]), ("R-1", &[312]), ("D-2", &[314])])
            .of_unknown_origin(&[("OLD-1", &[310])])
            .of_other_instance(&[("D-1", &[313]), ("D-3", &[315])])
            .at_startup(),
        ];
        let wrong = misjudged_on_the_records(&cases);
        assert!(wrong.is_empty(), "시작 정리의 판정이 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// **시작 정리가 끝내기에 넘기는 것은 확정 고아뿐이다**(프로세스 결정 6 · 티켓 10). 출처 불명은 누구의 것인지 몰라서, 다른
    /// 인스턴스는 살아 있는 실행이 제 셸을 닫을 때 끝내서, 예외는 늘 예외라서 안 넘긴다 — 죽은 세대의 키를 물었어도.
    ///
    /// 세상과 기록은 위 표와 같다. 줄마다 넘기지 말아야 할 것 곁에 죽은 실행 X의 확정 고아(311)를 앵커로 세운다 — 아무것도 안
    /// 넘기게 무너지면 앵커가 빠진다.
    #[test]
    fn the_startup_cleanup_hands_only_confirmed_orphans_to_the_ending() {
        let cases: [(&str, Vec<Proc>, &[u32]); 9] = [
            (
                "확정 고아 (가) 죽은 실행 — 그 트리의 시스템 바이너리까지",
                vec![row(311, 1).key("X-1"), row(323, 311), row(324, 323)],
                &[311, 323, 324],
            ),
            ("확정 고아 (가) 앱 pid를 남이 받은 실행", vec![row(312, 1).key("R-1")], &[312]),
            (
                "확정 고아 (나) 살아 있는 실행 · 목록에 없는 키 · 기록 갱신 전에 태어남",
                vec![row(314, 1).key("D-2").born(3_000)],
                &[314],
            ),
            ("출처 불명은 안 넘긴다", vec![row(310, 1).key("OLD-1"), row(325, 310), row(311, 1).key("X-1")], &[311]),
            (
                "다른 인스턴스는 안 넘긴다 — 목록에 있는 키, 목록에 없어도 기록 갱신 뒤에 태어난 것",
                vec![row(313, 1).key("D-1"), row(315, 1).key("D-3").born(6_000), row(311, 1).key("X-1")],
                &[311],
            ),
            (
                "예외는 안 넘긴다 — 죽은 세대의 키를 문 예외 이름과 그 밑의 표식 프로세스도",
                vec![
                    row(320, 1).named("tmux").key("X-1"),
                    row(321, 320).key("X-1"),
                    row(322, 321),
                    row(311, 1).key("X-1"),
                ],
                &[311],
            ),
            (
                "이 실행의 세대는 안 넘긴다 — 보통 판정이면 확정 고아인 목록 밖 키도, 풀의 셸 트리도",
                vec![row(303, 1).key("G-7").born(3_000), row(101, 100).key("G-1"), row(311, 1).key("X-1")],
                &[311],
            ),
            (
                "앱이 물려받은 키를 문 형제 가지(vite)와 앱 사슬은 안 넘긴다 — 그 키를 낸 설치본이 죽었어도",
                vec![row(10, 1).born(9_000), row(60, 30).key("I-3"), row(61, 60), row(311, 1).key("X-1")],
                &[311],
            ),
            (
                "pid ≤ 1과 다른 uid는 안 넘긴다 — 죽은 세대의 키를 물어도",
                vec![row(1, 0).key("X-1"), row(318, 1).uid(0).key("X-1"), row(311, 1).key("X-1")],
                &[311],
            ),
        ];

        let shells = [shell("G-1", Some(Identity { pid: 100, started_us: 1_100 }))];
        let records = records();
        let exceptions = exceptions();
        let mut wrong = Vec::new();
        for (what, rows, want) in &cases {
            let mut procs = world();
            procs.extend([row(70, 1), row(80, 1)]);
            for added in rows {
                procs.retain(|p| p.id.pid != added.id.pid);
                procs.push(added.clone());
            }
            let snapshot = Snapshot { uid: UID, procs, skipped: 0 };
            // 부르는 쪽이 모드를 무엇으로 주든 시작 정리로 판정한다 — 이 표는 보통으로 준다.
            let mut got: Vec<u32> = at_startup(&Inputs {
                snapshot: &snapshot,
                run: ThisRun { inherited_key: Some("I-3"), ..run("G") },
                shells: &shells,
                ending: &[],
                instances: &records,
                exceptions: &exceptions,
                occasion: Occasion::Normal,
            })
            .into_iter()
            .map(|proc| proc.id.pid)
            .collect();
            got.sort_unstable();
            if got != *want {
                wrong.push(format!("{what}\n    기대 {want:?}\n    받음 {got:?}"));
            }
        }
        assert!(wrong.is_empty(), "시작 정리가 끝내기에 넘기는 것이 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// **시작 정리가 지울 죽은 실행의 기록**(프로세스 스펙 「인스턴스 기록 › 지우는 때」). 살아 있다 = 앱 pid의 행이 있고
    /// 시작 시각도 같다(S9) — 확정 고아 (가)를 가르는 규칙과 한 자리다. 이 실행의 기록은 죽은 것으로 안 친다.
    #[test]
    fn dead_instances_are_the_records_whose_app_is_gone() {
        let dead = |rows: Vec<Proc>| -> Vec<String> {
            let mut procs = world();
            procs.extend([row(70, 1), row(80, 1)]);
            for added in rows {
                procs.retain(|p| p.id.pid != added.id.pid);
                procs.push(added);
            }
            let snapshot = Snapshot { uid: UID, procs, skipped: 0 };
            let records = records();
            let mut got: Vec<String> = dead_instances(&Inputs {
                snapshot: &snapshot,
                run: ThisRun { inherited_key: Some("I-3"), ..run("G") },
                shells: &[],
                ending: &[],
                instances: &records,
                exceptions: &[],
                occasion: Occasion::StartupCleanup,
            })
            .into_iter()
            .map(|record| record.generation.clone())
            .collect();
            got.sort();
            got
        };
        assert_eq!(dead(vec![]), ["R", "X"], "앱 pid가 없는 실행(X)과 그 pid를 남이 받은 실행(R)만 죽었다");
        assert_eq!(
            dead(vec![row(10, 1).born(9_000), row(APP, 40).born(9_000)]),
            ["I", "R", "X"],
            "설치본(I)의 pid를 남이 받았으면 죽었다 — 이 실행(G)의 행이 달라도 이 실행은 죽은 것으로 안 친다"
        );
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
                 프롬프트에서 그룹을 안 주는 것은 `pty::answer_for`의 몫이라 pty의 배치 표가 잰다",
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
            // 셸이 `exit`로 스스로 끝났다(프로세스 스펙 S49 · 티켓 13). 리더 스레드가 셸을 거둔 뒤라 셸의 행이 없고, 그 pid는 남이
            // 받았다(110, 9_000에 태어남) — 셸의 PID 트리가 끊겼다. 남은 길은 그 셸 키를 문 생존자와 그 트리뿐이다: dev 서버(211)와
            // 그 일꾼(212), 입력 전에 뜬 도우미(213). 끊긴 시스템 바이너리(214)는 못 찾고(표식이 안 읽힌다 — 스펙 Further Notes
            // 「표식이 안 읽히는 고아」), pid를 받은 남과 그 자식(110 · 217)은 셸의 것이 아니며, 예외 이름(215)과 그 밑(216)은
            // 표식을 물어도 산다. 앵커: 끝낼 것(211 · 212 · 213)과 도우미(213)가 선다.
            told(
                "스스로 끝난 셸은 행이 없다 — 그 키를 문 생존자와 그 트리만 끝내고, 예외는 남기고, 도우미는 표시한다",
                "G-2",
                vec![
                    row(110, 1).born(9_000),
                    row(217, 110).born(9_100),
                    row(211, 1).key("G-2").born(6_000),
                    row(212, 211).born(6_100),
                    row(213, 1).key("G-2").born(2_000).named("gitstatusd"),
                    row(214, 1).born(6_000),
                    row(215, 1).key("G-2").born(6_000).named("tmux"),
                    row(216, 215).key("G-2").born(6_100),
                ],
                Some(5_000),
                None,
                &[211, 212, 213],
                &[213],
                2,
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
                run: run("G"),
                shells: &shells,
                ending: &ending,
                instances: &[],
                exceptions: &exceptions,
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
                run: ThisRun { inherited_key: case.inherited, ..run("G") },
                shells: &[],
                ending: &ending,
                instances: &[],
                exceptions: &exceptions,
                occasion: Occasion::Normal,
            })
            .targets
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

    /// **종료의 셸 도우미**(티켓 11 · 프로세스 스펙 P1). 정리 기록은 셸과 도우미만 끝난 종료를 안 적는다 — p10k 셸을 띄워 둔 채
    /// 끌 때마다 한 줄이 차지 않게. 풀 셸(G-1, 입력 5_000)의 자손은 그 입력 시각으로 가른다. 셸이 풀에 없는 키(G-5 — 스스로
    /// 끝난 셸이 남긴 것)의 자손은 입력 시각을 몰라 도우미로 안 친다 — 사람이 띄운 것이 기록에서 사라지지 않게.
    ///
    /// 앵커: 끝낼 것에는 도우미까지 모두 든다 — 도우미는 표시이지 묶음이 아니다.
    #[test]
    fn the_exit_tells_the_helpers_it_ends_by_the_pool_shells_input() {
        let procs = vec![
            row(100, 50).born(1_100),
            row(101, 100).born(2_000),
            row(102, 100).born(6_000),
            row(201, 1).key("G-5").born(1_500),
            row(202, 201).born(1_600),
        ];
        let snapshot = Snapshot { uid: UID, procs, skipped: 0 };
        let ending = [ShellEntry {
            key: "G-1".into(),
            process: Some(Identity { pid: 100, started_us: 1_100 }),
            first_input_us: Some(5_000),
        }];
        let exit = at_exit(&Inputs {
            snapshot: &snapshot,
            run: run("G"),
            shells: &[],
            ending: &ending,
            instances: &[],
            exceptions: &[],
            occasion: Occasion::Normal,
        });
        let mut targets: Vec<u32> = exit.targets.iter().map(|id| id.pid).collect();
        targets.sort_unstable();
        assert_eq!(targets, [101, 102, 201, 202], "종료가 끝낼 것이 어긋났다 — 도우미도 끝낸다");
        let helpers: Vec<u32> = exit.helpers.iter().map(|id| id.pid).collect();
        assert_eq!(helpers, [101], "종료의 도우미가 어긋났다 — 풀 셸의 입력 전 태생만 도우미다");
    }
}
