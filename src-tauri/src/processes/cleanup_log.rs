//! 정리 기록 — 앱이 무엇을 언제 왜 끝냈는가(프로세스 결정 6 · 프로세스 스펙 S12 · 티켓 11).
//!
//! 셸을 닫고, 앱을 끄고, 앱이 뜰 때 지난 실행이 남긴 것을 치우면 프로세스가 사라진다. 사람 손 없이 사라진 것은 나중에
//! 이유를 찾을 길이 없다(결정 6이 「조용히 자동」을 기각한 까닭). 그래서 끝낸 사건마다 한 줄을 `<데이터 루트>/cleanup-log.json`
//! 에 남긴다 — 새것부터 최근 100건이다. 읽는 화면은 판 04(`Processes`)가 세운다.
//!
//! **셸이나 셸 도우미만 끝난 사건은 적지 않는다**(프로세스 스펙 P1). p10k 셸은 닫을 때마다 `gitstatusd`가 함께 끝난다 —
//! 그것까지 적으면 × 한 번마다 한 줄이 차 100건이 금세 쓸모없는 줄로 찬다. 셸과 도우미는 셸의 몫이라 대상 목록에도 안 든다
//! (셸 자신이 목록에 없듯이). 사람이 띄운 것(도우미가 아닌 자손)이나 고아가 하나라도 끝났을 때만 적는다.
//!
//! 셸이 스스로 끝나며 끝낸 것을 토스트로 알릴 때의 수(`ended_count`, 티켓 13)도 같은 규칙으로 센다 — 도우미와 이미 없음은
//! 앱이 끝낸 것으로 안 친다.
//!
//! **명령줄은 앞 200자만 담는다.** 명령줄 전체에는 토큰 같은 비밀이 들 수 있다(`--token=…`, `curl -H 'Authorization: …'`).
//!
//! **쓰기는 인스턴스 기록과 같은 뮤텍스 안에서 「읽기 → 더하기 → 쓰기」다**(`instances::Record::log`). 이 파일을 쓰는 자리가
//! 여럿이다 — 셸 닫기 · 새로고침의 뒤 스레드, 앱 종료, 시작 정리. 잠금 밖에서 읽고 쓰면 먼저 읽은 쪽의 늦은 쓰기가 다른 쪽
//! 사건을 지운다. 파일은 코어의 원자 쓰기로 통째 바꿔 넣는다. **두 실행(dev와 설치본)이 같은 순간 쓰면 한쪽 사건을 잃을 수
//! 있다** — 실행끼리는 잠그지 않는다. 드물고 기록일 뿐이라 받아들인다.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::ending::Outcome;
use super::{Identity, Proc};

/// 담는 사건 수. 넘치면 가장 오래된 것부터 빠진다.
pub const KEEP: usize = 100;

/// 명령줄을 담는 길이(글자 수).
pub const COMMAND_CHARS: usize = 200;

/// 정리 기록의 자리. 루트는 부르는 쪽이 `atelier_core::data_root()`로 준다(`ATELIER_HOME`).
pub fn path(root: &Path) -> PathBuf {
    root.join("cleanup-log.json")
}

/// 앱이 무엇 때문에 끝냈나. 와이어는 camelCase다(`"shellClose"` …) — 화면(판 04)이 이 값을 사람 말로 옮긴다.
///
/// 까닭이 `●`를 켜는지는 이 값이 정한다(프로세스 스펙 S41, 티켓 29) — 시작 정리 · MCP 아카이브 · 셸 스스로 끝남과 「못 끝냄」이
/// 든 기록만 켠다. 그래서 까닭을 고르는 자리가 흩어지면 사람이 누른 닫기가 점을 켤 수 있다. 프런트가 고르는 셋은 닫기
/// IPC의 `CloseReason`이고, 나머지는 Rust가 그 길에서 안다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// 셸 닫기 — ×, ⌘W, 셸 메뉴, 안 쓴 자동 셸의 회수, xterm 열기 실패, spawn 왕복 중 닫힘.
    ShellClose,
    /// 셸 스스로 끝남 — `exit` · `^D`(티켓 13). 셸 키를 문 생존자를 앱이 끝냈다.
    ShellExit,
    /// 앱 종료.
    AppExit,
    /// 웹뷰 새로고침.
    Reload,
    /// UI 아카이브 · 삭제.
    Archive,
    /// MCP로 아카이브된 work의 조용한 셸(티켓 12가 남긴다).
    McpArchive,
    /// 앱이 뜰 때 지난 실행이 남긴 확정 고아를 치움(티켓 10).
    StartupCleanup,
    /// 손으로 — `Processes`의 [끝내기] · [정리](티켓 31이 남긴다).
    Manual,
}

/// 닫기 IPC(`pty_kill`)가 받는 까닭 — **프런트가 고르는 셋뿐이다.** 앱 종료 · 새로고침 · 시작 정리 · 셸 스스로 끝남은 Rust가
/// 그 길에서 알고, 프런트가 그것을 사칭할 길을 두지 않는다. 어느 닫기가 어느 까닭인지는 프런트의 표 한 자리가 고른다
/// (`shell-registry.ts`의 `CLOSE_REASONS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseReason {
    ShellClose,
    Archive,
    McpArchive,
}

impl From<CloseReason> for Reason {
    fn from(reason: CloseReason) -> Reason {
        match reason {
            CloseReason::ShellClose => Reason::ShellClose,
            CloseReason::Archive => Reason::Archive,
            CloseReason::McpArchive => Reason::McpArchive,
        }
    }
}

/// 사건 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// 끝내기가 끝난 시각(에포크 ms). 유예 2초 뒤 SIGKILL로 끝난 것도 있으니, 사람이 누른 순간이 아니라 끝난 순간이다.
    pub at: u64,
    pub reason: Reason,
    /// 그 사건의 셸 — 셸 하나를 닫은 사건에만 있다(셸 닫기 · 아카이브 · 새로고침은 셸마다 한 줄). 앱 종료와 시작 정리는 여러
    /// 셸의 것을 한 번에 끝내 비운다.
    pub shell_key: Option<String>,
    /// 그 셸의 주인(`atelier:<slug>` 꼴, 프런트의 `ShellOwner`). **닫기 IPC로 온 사건에만 있다** — Rust 풀은 셸의 주인을
    /// 모른다(티켓 11 「스펙과 다른 점」). 채우려면 셸을 띄울 때 넘겨야 하는데, 읽는 화면이 아직 없다.
    pub owner: Option<String>,
    /// 끝낸 것 — 셸과 셸 도우미는 빠진다.
    pub targets: Vec<Target>,
}

/// 끝낸 것 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub pid: u32,
    /// 커널 이름(`Proc::name`).
    pub name: String,
    /// 명령줄의 앞 200자. 수집이 argv를 못 읽은 행이면 없다.
    pub command: Option<String>,
    pub outcome: Outcome,
}

/// 끝내기에 넘긴 것 하나 — 판정의 행에서 적을 것만 떠 왔다. 뒤 스레드로 넘어가야 해서 스냅샷을 빌리지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aimed {
    pub id: Identity,
    pub name: String,
    pub command: Option<String>,
    /// 셸 도우미인가(`Verdict::helpers`) — 사건을 적을지 가르고, 대상 목록에서 빠진다.
    pub helper: bool,
}

impl Aimed {
    pub fn of(proc: &Proc, helper: bool) -> Aimed {
        Aimed { id: proc.id, name: proc.name.clone(), command: proc.command.clone(), helper }
    }
}

/// 끝내기의 결과로 사건 하나를 짓는다 — **적을 것이 없으면 `None`이다.**
///
/// 도우미가 아닌 대상이 하나라도 끝났을 때만 적는다: 끝남(TERM) · 강제(KILL) · 못 끝냄. 못 끝냄은 앱이 끝내려다 못 한
/// 것이라 반드시 남긴다(`●`를 켠다). 이미 없음은 앱이 끝낸 것이 아니다 — 그것뿐이면 적지 않고, 다른 것과 함께면 그 결과로
/// 목록에 든다. 결과를 못 찾은 대상(끝내기에 안 넘어간 것)은 빠진다.
pub fn event(
    at: u64,
    reason: Reason,
    shell_key: Option<&str>,
    owner: Option<&str>,
    aimed: &[Aimed],
    outcomes: &[(Identity, Outcome)],
) -> Option<Event> {
    let targets: Vec<Target> = aimed
        .iter()
        .filter(|one| !one.helper)
        .filter_map(|one| {
            let (_, outcome) = outcomes.iter().find(|(id, _)| *id == one.id)?;
            Some(Target { pid: one.id.pid, name: one.name.clone(), command: one.command.as_deref().map(cut), outcome: *outcome })
        })
        .collect();
    targets.iter().any(|target| target.outcome != Outcome::Gone).then(|| Event {
        at,
        reason,
        shell_key: shell_key.map(str::to_string),
        owner: owner.map(str::to_string),
        targets,
    })
}

/// 사람에게 알릴 「앱이 끝낸 수」 — **알릴 것이 없으면 `None`이다**(티켓 13 · 프로세스 스펙 P4). 셸이 스스로 끝나며 그 셸에서
/// 띄운 것을 끝냈을 때, 토스트 「셸이 끝나면서 그 셸에서 띄운 프로세스 N개를 끝냈어요」의 N이다.
///
/// 세는 것은 도우미가 아닌 대상 중 **끝남 · 강제**뿐이다. 도우미는 셸의 몫이라 뺀다(P1) — 안 빼면 p10k 셸에서 `exit`를 칠
/// 때마다 `gitstatusd` 하나로 토스트가 선다. 이미 없음은 앱이 끝낸 것이 아니다. 못 끝냄도 세지 않는다 — 문구가 「끝냈어요」다.
/// 못 끝냄은 정리 기록에 남아(`event`) 판 04의 `●`가 알린다. 그래서 이 수가 0이어도 사건은 적힐 수 있다(못 끝냄뿐일 때).
pub fn ended_count(aimed: &[Aimed], outcomes: &[(Identity, Outcome)]) -> Option<usize> {
    let count = aimed
        .iter()
        .filter(|one| !one.helper)
        .filter_map(|one| outcomes.iter().find(|(id, _)| *id == one.id))
        .filter(|(_, outcome)| matches!(outcome, Outcome::Ended | Outcome::Forced))
        .count();
    (count > 0).then_some(count)
}

/// 명령줄의 앞 200자. 바이트가 아니라 글자로 자른다 — 한글 인자 한가운데서 끊으면 UTF-8이 깨진다.
fn cut(command: &str) -> String {
    command.chars().take(COMMAND_CHARS).collect()
}

/// 기록 전부 — 새것부터. **깨졌거나 없으면 빈 기록이다.** 다음 쓰기가 새로 쓴다: 한 장이 깨졌다고 기록을 멈추면 그 뒤로
/// 앱이 끝낸 것이 모두 사라진다.
pub fn read(path: &Path) -> Vec<Event> {
    std::fs::read_to_string(path).ok().and_then(|content| serde_json::from_str(&content).ok()).unwrap_or_default()
}

/// 사건 하나를 맨 앞에 더하고 100건으로 자른다. **부르는 쪽이 잠금을 쥐고 부른다**(`instances::Record::log`).
///
/// 쓰기가 실패해도 부른 길(셸 닫기 · 종료)을 막지 않는다 — 기록 한 줄을 잃을 뿐이다.
pub(super) fn add(path: &Path, event: Event) {
    let mut events = read(path);
    events.insert(0, event);
    events.truncate(KEEP);
    let (Some(dir), Some(name)) = (path.parent(), path.file_name().and_then(|name| name.to_str())) else {
        return;
    };
    if let Err(e) = atelier_core::write_json_atomically(dir, name, &events, "정리 기록을") {
        eprintln!("atelier: cleanup log write failed ({}): {e}", path.display());
    }
}

/// 지금(에포크 ms). 사건의 시각이다.
pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(pid: u32) -> Identity {
        Identity { pid, started_us: u64::from(pid) * 10 }
    }

    fn aimed(pid: u32, name: &str, helper: bool) -> Aimed {
        Aimed { id: id(pid), name: name.to_string(), command: Some(format!("{name} --serve")), helper }
    }

    /// **셸이나 셸 도우미만 끝난 사건은 적지 않는다**(프로세스 스펙 P1). 도우미가 아닌 것이 하나라도 끝나면 적고, 그때
    /// 목록에는 도우미가 빠진다. 셸 자신은 끝내기의 대상이 아니라(그룹 신호) 여기 오지 않는다 — 대상이 없는 사건이 셸만 끝난
    /// 사건이다.
    ///
    /// 앵커: 적히는 줄이 있다 — 늘 `None`을 주게 무너지면 「안 적힌다」들이 저절로 참이 된다.
    #[test]
    fn only_a_shell_and_its_helpers_ending_is_not_worth_a_line() {
        let helper = aimed(11, "gitstatusd", true);
        let server = aimed(12, "node", false);
        let other = aimed(13, "esbuild", false);
        let at = 1_790_000_000_000;
        let case = |what: &str, aimed: &[Aimed], outcomes: &[(Identity, Outcome)]| {
            (what.to_string(), event(at, Reason::ShellClose, Some("G-1"), Some("atelier:x"), aimed, outcomes))
        };
        let got = [
            case("셸만 끝났다 — 대상이 없다", &[], &[]),
            case("셸과 도우미만 끝났다", &[helper.clone()], &[(id(11), Outcome::Ended)]),
            case("도우미는 강제로 끝났다", &[helper.clone()], &[(id(11), Outcome::Forced)]),
            case(
                "도우미가 아닌 것은 이미 없었다 — 앱이 끝낸 것이 아니다",
                &[helper.clone(), server.clone()],
                &[(id(11), Outcome::Ended), (id(12), Outcome::Gone)],
            ),
        ];
        for (what, written) in &got {
            assert_eq!(written, &None, "{what}: 적을 것이 없는데 적었다");
        }

        let written = event(
            at,
            Reason::ShellClose,
            Some("G-1"),
            Some("atelier:x"),
            &[helper.clone(), server.clone(), other.clone()],
            &[(id(11), Outcome::Ended), (id(12), Outcome::Forced), (id(13), Outcome::Gone)],
        )
        .expect("도우미가 아닌 것이 끝났는데 안 적었다");
        assert_eq!(
            written.targets,
            vec![
                Target { pid: 12, name: "node".into(), command: Some("node --serve".into()), outcome: Outcome::Forced },
                Target { pid: 13, name: "esbuild".into(), command: Some("esbuild --serve".into()), outcome: Outcome::Gone },
            ],
            "대상 목록이 어긋났다 — 도우미가 섞였거나, 함께 넘어간 이미 없음이 빠졌다"
        );
        assert_eq!((written.at, written.reason), (at, Reason::ShellClose));
        assert_eq!((written.shell_key.as_deref(), written.owner.as_deref()), (Some("G-1"), Some("atelier:x")));

        let survived = event(at, Reason::AppExit, None, None, &[server], &[(id(12), Outcome::Survived)]);
        assert!(
            survived.is_some_and(|event| event.targets[0].outcome == Outcome::Survived),
            "못 끝낸 것을 안 적었다 — 앱이 끝내려다 못 한 것이 기록에서 사라진다"
        );
    }

    /// **셸이 스스로 끝나며 끝낸 것을 알릴지**(티켓 13 · 프로세스 스펙 P4 · P1). 알릴 수는 도우미가 아닌 대상 중 끝남 · 강제다.
    /// 셸 도우미만, 또는 이미 없음만 끝났으면 알리지 않는다 — p10k 셸에서 `exit`를 칠 때마다 토스트가 서면 안 된다.
    ///
    /// 앵커: 알리는 줄이 있다 — 늘 `None`을 주게 무너지면 「알리지 않는다」들이 저절로 참이 된다.
    #[test]
    fn a_shell_exit_announces_only_what_the_app_ended_beyond_the_helpers() {
        let helper = aimed(11, "gitstatusd", true);
        let server = aimed(12, "node", false);
        let bundler = aimed(13, "esbuild", false);
        let stale = aimed(14, "python3", false);
        let cases: [(&str, Vec<Aimed>, Vec<(Identity, Outcome)>, Option<usize>); 9] = [
            ("끝낼 것이 없었다 — 셸만 끝났다", vec![], vec![], None),
            ("셸 도우미만 끝났다", vec![helper.clone()], vec![(id(11), Outcome::Ended)], None),
            ("셸 도우미만, 강제로 끝났다", vec![helper.clone()], vec![(id(11), Outcome::Forced)], None),
            ("이미 없음뿐이다 — 앱이 끝낸 것이 아니다", vec![server.clone()], vec![(id(12), Outcome::Gone)], None),
            (
                "셸 도우미와 이미 없음뿐이다",
                vec![helper.clone(), server.clone()],
                vec![(id(11), Outcome::Ended), (id(12), Outcome::Gone)],
                None,
            ),
            ("결과를 못 찾은 대상은 끝낸 것이 아니다", vec![server.clone()], vec![], None),
            (
                "도우미가 아닌 것이 끝나면 그 수 — 끝남과 강제를 세고 도우미 · 이미 없음은 뺀다",
                vec![helper.clone(), server.clone(), bundler.clone(), stale.clone()],
                vec![(id(11), Outcome::Ended), (id(12), Outcome::Ended), (id(13), Outcome::Forced), (id(14), Outcome::Gone)],
                Some(2),
            ),
            (
                "못 끝냄은 세지 않는다 — 문구가 「끝냈어요」다(정리 기록에는 남는다)",
                vec![server.clone(), bundler.clone()],
                vec![(id(12), Outcome::Survived), (id(13), Outcome::Ended)],
                Some(1),
            ),
            ("못 끝냄뿐이면 알리지 않는다", vec![server.clone()], vec![(id(12), Outcome::Survived)], None),
        ];
        let wrong: Vec<String> = cases
            .iter()
            .filter_map(|(what, aimed, outcomes, want)| {
                let got = ended_count(aimed, outcomes);
                (got != *want).then(|| format!("{what}: 기대 {want:?}, 받음 {got:?}"))
            })
            .collect();
        assert!(wrong.is_empty(), "알릴 수가 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// **명령줄은 앞 200자만 담는다** — 전체에는 토큰 같은 비밀이 들 수 있다. 글자로 자른다: 한글 인자 한가운데를 바이트로
    /// 자르면 UTF-8이 깨진다. 200자 이하면 그대로다.
    #[test]
    fn a_command_line_is_cut_at_two_hundred_characters() {
        let long = format!("node server.js --token={}", "비".repeat(300));
        let one = Aimed { command: Some(long.clone()), ..aimed(12, "node", false) };
        let written = event(1, Reason::ShellClose, None, None, &[one], &[(id(12), Outcome::Ended)]).expect("적는다");
        let command = written.targets[0].command.clone().expect("명령줄이 있다");
        assert_eq!(command.chars().count(), COMMAND_CHARS, "명령줄이 200자가 아니다");
        assert_eq!(command, long.chars().take(200).collect::<String>(), "앞 200자가 아니다");

        let short = aimed(13, "vite", false);
        let written = event(1, Reason::ShellClose, None, None, &[short], &[(id(13), Outcome::Ended)]).expect("적는다");
        assert_eq!(written.targets[0].command.as_deref(), Some("vite --serve"), "짧은 명령줄을 건드렸다");
    }

    /// **와이어 모양.** 판 04의 화면(TS)이 이 파일을 그대로 읽는다 — 칸 이름과 값의 글자를 못박는다.
    #[test]
    fn an_event_crosses_the_wire_in_the_shape_the_screen_will_read() {
        let event = Event {
            at: 1_790_000_000_123,
            reason: Reason::StartupCleanup,
            shell_key: None,
            owner: None,
            targets: vec![Target { pid: 7, name: "node".into(), command: None, outcome: Outcome::Survived }],
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "at": 1_790_000_000_123_u64,
                "reason": "startupCleanup",
                "shellKey": null,
                "owner": null,
                "targets": [{ "pid": 7, "name": "node", "command": null, "outcome": "survived" }],
            })
        );
        let reasons = [
            (Reason::ShellClose, "shellClose"),
            (Reason::ShellExit, "shellExit"),
            (Reason::AppExit, "appExit"),
            (Reason::Reload, "reload"),
            (Reason::Archive, "archive"),
            (Reason::McpArchive, "mcpArchive"),
            (Reason::StartupCleanup, "startupCleanup"),
            (Reason::Manual, "manual"),
        ];
        for (reason, wire) in reasons {
            assert_eq!(serde_json::to_value(reason).unwrap(), wire, "까닭 {reason:?}의 글자가 다르다");
        }
        let outcomes =
            [(Outcome::Ended, "ended"), (Outcome::Forced, "forced"), (Outcome::Survived, "survived"), (Outcome::Gone, "gone")];
        for (outcome, wire) in outcomes {
            assert_eq!(serde_json::to_value(outcome).unwrap(), wire, "결과 {outcome:?}의 글자가 다르다");
        }
    }

    /// 닫기 IPC가 받는 까닭은 프런트가 고르는 셋뿐이다 — Rust가 아는 까닭(앱 종료 · 시작 정리 …)을 프런트가 실어 보내면 거절한다.
    #[test]
    fn the_close_ipc_takes_only_the_reasons_the_frontend_picks() {
        let taken: Vec<Reason> = ["shellClose", "archive", "mcpArchive"]
            .into_iter()
            .map(|wire| serde_json::from_value::<CloseReason>(serde_json::json!(wire)).expect("받는다").into())
            .collect();
        assert_eq!(taken, [Reason::ShellClose, Reason::Archive, Reason::McpArchive]);
        for wire in ["appExit", "reload", "startupCleanup", "shellExit", "manual", "셸 닫기"] {
            assert!(
                serde_json::from_value::<CloseReason>(serde_json::json!(wire)).is_err(),
                "닫기 IPC가 프런트가 고를 수 없는 까닭 {wire}를 받았다"
            );
        }
    }
}
