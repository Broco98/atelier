//! 시작 보고 — 앱이 뜰 때 한 일을 **붙잡아 두고**, 프런트가 부팅 때 한 번 묻는다(프로세스 결정 6 ·
//! 프로세스 스펙 S11).
//!
//! **이벤트로 쏘지 않는다.** 앱이 뜨는 순간의 일은 웹뷰가 `listen`을 걸기 전에 끝날 수 있고, 그때 쏜
//! 이벤트는 아무도 못 듣고 지나간다. 붙잡아 둔 값은 늦게 물어도 그대로 있다. 묻는 자리는 프런트의
//! `main.tsx` 한 곳이다(`src/components/shell/startup-report.ts`).
//!
//! 싣는 것은 둘이다: 지난 실행이 남긴 확정 고아를 치운 결과(시작 정리 `clean_up`, 티켓 10)와, 이미 깔린 에이전트 훅을 새
//! 목록으로 맞춘 결과(훅 맞춤 `sync_hooks`, 티켓 21).
//!
//! **준비됨은 시작 때 할 일이 모두 끝났을 때다.** 할 일마다 몫(`Chore`)을 하나씩 세고, 몫이 모두 끝나야 답한다 — 물었을 때
//! 정리가 아직 돌고 있으면 끝날 때까지 기다렸다 답한다. 기다리는 것은 부르는 스레드라, 명령은 blocking 풀에서 묻는다
//! (`commands::startup_report` — tokio 워커를 막지 않는다).

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use serde::Serialize;

use crate::processes::ending::Outcome;
use crate::pty::{self, Cleared, PtyPool};
use crate::{hooks, shells};

/// 앱이 뜰 때 한 일. 프런트의 `StartupReport`(`src/components/shell/startup-report.ts`)와 **필드 이름으로만**
/// 이어진다 — 어긋나면 컴파일도 타입 검사도 통과하고 토스트만 조용히 안 선다. 그래서 와이어 모양을
/// 아래 검사가 글자로 못박는다.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupReport {
    /// 시작 정리가 **실제로 끝낸** 것 — 결과가 「끝남」이거나 「강제」인 것만 싣는다. 「이미 없음」은
    /// 끝낸 것이 아니라서 안 싣는다: 전부 이미 없었으면 알릴 것도 없다. 수는 이 목록의 길이다.
    pub cleaned: Vec<Cleaned>,
    /// 훅을 새 목록으로 맞춘 에이전트(`claude` · `codex`). 비어 있으면 맞출 것이 없었다.
    pub hooks_updated: Vec<String>,
}

/// 시작 정리가 끝낸 프로세스 하나.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Cleaned {
    pub pid: u32,
    /// 커널이 아는 이름.
    pub name: String,
}

/// 보고를 붙잡아 두는 자리. 앱이 하나 들고(`lib.rs`의 `manage`) 명령이 읽는다.
///
/// **읽어도 비우지 않는다.** 웹뷰가 새로고침되면 부팅이 다시 돌아 또 묻고, 같은 답이 가서 같은 토스트가
/// 한 번 더 선다. 한 번만 주려면 「이미 받아 갔다」를 여기서 들어야 하는데, 받아 간 웹뷰가 그것을 그리기
/// 전에 새로고침됐는지는 Rust가 모른다 — 비우면 그때 알림이 통째로 사라진다.
#[derive(Debug, Default)]
pub struct ReportHolder {
    board: Mutex<Board>,
    /// 몫 하나가 끝날 때마다 울린다 — 묻는 쪽이 이것을 기다린다.
    settled: Condvar,
}

#[derive(Debug, Default)]
struct Board {
    report: StartupReport,
    /// 세었는데 아직 안 끝난 몫의 수.
    pending: usize,
}

impl ReportHolder {
    /// 잠금이 독에 걸려도 이어 간다 — 보고는 알림일 뿐이라 앞 스레드의 패닉이 부팅을 멈출 까닭이 없다.
    fn lock(&self) -> MutexGuard<'_, Board> {
        self.board.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 시작 때 할 일 하나를 몫으로 센다 — **웹뷰가 서기 전에**(`lib.rs`의 `run`, 빌더보다 앞). 웹뷰는 셋업의 앱 몫보다 먼저
    /// 서고 프런트는 뜨자마자 묻는다 — 몫을 셋업 안에서 세면 그 사이에 온 물음이 빈 보고를 받을 자리가 생긴다. 센 몫이
    /// 끝나기 전에는 `answer`가 기다린다.
    pub fn expect(self: &Arc<Self>) -> Chore {
        self.lock().pending += 1;
        Chore { holder: Arc::clone(self), open: true }
    }

    /// 묻는 쪽에 줄 답 — **센 몫이 모두 끝난 뒤의** 보고. 도는 일이 있으면 끝날 때까지 기다린다. 부르는 스레드를
    /// 막으므로 명령은 blocking 풀에서 부른다.
    pub fn answer(&self) -> StartupReport {
        let board = self.settled.wait_while(self.lock(), |board| board.pending > 0);
        board.unwrap_or_else(|poisoned| poisoned.into_inner()).report.clone()
    }
}

/// 시작 때 할 일 하나의 몫. `deliver`로 결과를 싣고 끝낸다.
///
/// **싣지 않고 떨어져도 끝난 것으로 친다** — 일을 돌릴 스레드를 못 띄웠거나 일이 패닉했을 때다. 그 몫이 영영 안 끝나면
/// 묻는 쪽이 영영 기다리고, 그동안 다른 몫의 알림(정리 · 훅 맞춤)까지 못 간다. 빈손이면 알릴 것이 없을 뿐이다.
pub struct Chore {
    holder: Arc<ReportHolder>,
    open: bool,
}

impl Chore {
    /// 결과를 보고에 싣고 몫을 끝낸다.
    pub fn deliver(mut self, fill: impl FnOnce(&mut StartupReport)) {
        {
            let mut board = self.holder.lock();
            fill(&mut board.report);
            board.pending -= 1;
        }
        self.open = false;
        self.holder.settled.notify_all();
    }
}

impl Drop for Chore {
    fn drop(&mut self) {
        if self.open {
            self.holder.lock().pending -= 1;
            self.holder.settled.notify_all();
        }
    }
}

/// 시작 때 할 일 하나를 **뒤 스레드에서** 돌리고 그 결과를 그 몫으로 보고에 싣는다. 몫은 부르는 쪽이 미리 센 것이다
/// (`ReportHolder::expect`). 스레드를 못 띄우면 몫은 빈손으로 끝난다(`Chore`).
pub fn in_background<T>(
    chore: Chore,
    name: &str,
    work: impl FnOnce() -> T + Send + 'static,
    fill: impl FnOnce(&mut StartupReport, T) + Send + 'static,
) {
    let spawned = std::thread::Builder::new().name(name.to_string()).spawn(move || {
        let done = work();
        chore.deliver(|report| fill(report, done));
    });
    if let Err(e) = spawned {
        eprintln!("atelier: could not start {name}: {e}");
    }
}

/// **시작 정리**(프로세스 결정 6 · 티켓 10) — 지난 실행이 남긴 확정 고아를 뒤 스레드에서 끝내고, 끝낸 것을 시작 보고에
/// 그 몫(`chore`)으로 싣는다. 인스턴스 기록을 연 **뒤에** 부른다(`pty::open_record`) — 기록을 안 열면 남의 기록도 안 읽혀
/// 끝낼 것이 없다. 판정 · 끝내기 · 죽은 실행의 기록 지우기는 풀을 쥔 `pty::clean_up_at_startup`이 한다.
pub fn clean_up(chore: Chore, pool: Arc<PtyPool>) {
    in_background(chore, "atelier-startup-cleanup", move || pty::clean_up_at_startup(&pool), |report, cleared| {
        report.cleaned = cleaned(&cleared)
    });
}

/// **이미 깐 에이전트 훅을 지금 목록으로 맞춘다**(프로세스 결정 15 · 티켓 21) — 뒤 스레드에서 `hooks::sync`를 돌리고, 실제로 쓴
/// 에이전트를 시작 보고의 훅 칸에 그 몫(`chore`)으로 싣는다. 프런트는 그 칸이 비지 않았으면 토스트를 한 번 띄운다(S36).
///
/// `home`은 고칠 설정이 사는 사용자의 홈(`hooks::agent_home`)이고 `root`는 처리기가 사는 데이터 루트다 — 설정이 가리키게 될
/// 처리기는 `<root>/hooks/atelier-hook.zsh`다. **처리기를 디스크에 세운 뒤에 부른다**(`lib.rs`의 셋업) — 설정만 새 경로를 가리키면
/// 에이전트가 매 턴 없는 파일을 부른다.
///
/// 파일을 넷까지 읽고 쓰는 기다리는 일이라 뒤 스레드로 보낸다 — 셋업이 그동안 서지 않고, 묻는 쪽(`commands::startup_report`)은
/// blocking 풀에서 몫을 기다린다. 스레드를 못 띄우면 몫은 빈손으로 끝나고 맞춤은 다음 실행으로 미뤄진다.
pub fn sync_hooks(chore: Chore, home: PathBuf, root: PathBuf) {
    in_background(
        chore,
        "atelier-hook-sync",
        move || hooks::sync(&home, &shells::handler_path(&root)),
        |report, agents| report.hooks_updated = agents,
    );
}

/// 시작 정리가 끝내려 한 것 중 **실제로 끝낸 것** — 끝남(TERM) · 강제(KILL). 「이미 없음」은 끝낸 것이 아니고, 「못 끝냄」은
/// 아직 산다. 끝낸 차례 그대로다.
pub fn cleaned(cleared: &[Cleared]) -> Vec<Cleaned> {
    cleared
        .iter()
        .filter(|one| matches!(one.outcome, Outcome::Ended | Outcome::Forced))
        .map(|one| Cleaned { pid: one.id.pid, name: one.name.clone() })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use super::*;
    use crate::processes::Identity;

    /// 묻는 쪽이 아직 기다리는지 볼 때 주는 틈. 이 틈 안에 답이 오면 기다리지 않은 것이다.
    const STILL: Duration = Duration::from_millis(200);

    /// 다른 스레드에서 묻는다 — `answer`가 기다리는 동안 이 스레드가 몫을 끝낼 수 있게.
    fn ask(holder: &Arc<ReportHolder>) -> mpsc::Receiver<StartupReport> {
        let (tx, rx) = mpsc::channel();
        let holder = Arc::clone(holder);
        std::thread::spawn(move || {
            let _ = tx.send(holder.answer());
        });
        rx
    }

    fn cleared(pid: u32, name: &str, outcome: Outcome) -> Cleared {
        Cleared { id: Identity { pid, started_us: 1_000 + u64::from(pid) }, name: name.to_string(), outcome }
    }

    /// 시작 때 할 일이 없으면 곧바로 빈 보고다 — 프런트는 알릴 것 없이 지나간다.
    #[test]
    fn a_fresh_holder_answers_an_empty_report() {
        assert_eq!(ReportHolder::default().answer(), StartupReport::default());
        assert!(ReportHolder::default().answer().cleaned.is_empty());
        assert!(ReportHolder::default().answer().hooks_updated.is_empty());
    }

    /// **준비됨은 몫 모두를 기다린다**(티켓 10). 몫 둘 중 하나만 끝나면 아직 답하지 않고, 둘 다 끝나야 답한다 — 둘의
    /// 결과가 한 보고에 함께 실린다. 시작 정리와 훅 맞춤(티켓 21)이 이 모양으로 선다.
    #[test]
    fn ready_waits_for_every_chore() {
        let holder = Arc::new(ReportHolder::default());
        let cleanup = holder.expect();
        let hooks = holder.expect();
        let answered = ask(&holder);

        assert!(answered.recv_timeout(STILL).is_err(), "아무 몫도 안 끝났는데 답했다");
        cleanup.deliver(|report| report.cleaned.push(Cleaned { pid: 4242, name: "node".into() }));
        assert!(answered.recv_timeout(STILL).is_err(), "몫 둘 중 하나만 끝났는데 답했다 — 훅 맞춤의 결과를 못 싣는다");
        hooks.deliver(|report| report.hooks_updated.push("claude".into()));

        let report = answered.recv_timeout(Duration::from_secs(5)).expect("몫이 모두 끝났는데 5초가 지나도 답이 없다");
        assert_eq!(
            report,
            StartupReport {
                cleaned: vec![Cleaned { pid: 4242, name: "node".into() }],
                hooks_updated: vec!["claude".into()],
            },
            "두 몫의 결과가 한 보고에 안 실렸다"
        );
    }

    /// **싣지 않고 떨어진 몫도 끝난 것이다** — 일을 돌릴 스레드를 못 띄웠거나 일이 패닉했을 때. 안 그러면 묻는 쪽이 영영
    /// 기다린다. 앵커: 떨어뜨리기 전에는 기다린다.
    #[test]
    fn a_chore_dropped_without_a_result_does_not_hold_the_answer() {
        let holder = Arc::new(ReportHolder::default());
        let chore = holder.expect();
        let answered = ask(&holder);
        assert!(answered.recv_timeout(STILL).is_err(), "몫이 남았는데 답했다");
        drop(chore);
        assert_eq!(
            answered.recv_timeout(Duration::from_secs(5)).ok(),
            Some(StartupReport::default()),
            "빈손으로 떨어진 몫을 끝나지 않은 것으로 쳐 영영 기다린다"
        );
    }

    /// **시작 보고가 시작 정리의 실제 결과를 싣는다. 정리가 아직 돌고 있을 때 물으면 끝난 뒤에 답한다**(프로세스 스펙 S11 ·
    /// 티켓 10). 정리는 뒤 스레드에서 돌고(`in_background`), 그 결과 중 끝낸 것(끝남 · 강제)만 싣는다 — 「이미 없음」과
    /// 「못 끝냄」은 끝낸 것이 아니다. 앱의 정리(`clean_up`)는 같은 길에 풀의 정리와 이 싣기를 건넨다.
    #[test]
    fn the_report_carries_what_the_cleanup_ended_once_it_is_done() {
        let holder = Arc::new(ReportHolder::default());
        let (release, gate) = mpsc::channel::<()>();
        in_background(
            holder.expect(),
            "atelier-test-startup-chore",
            move || {
                let _ = gate.recv();
                vec![
                    cleared(311, "node", Outcome::Ended),
                    cleared(312, "gone", Outcome::Gone),
                    cleared(313, "vite", Outcome::Forced),
                    cleared(314, "stuck", Outcome::Survived),
                ]
            },
            |report, cleared| report.cleaned = super::cleaned(&cleared),
        );
        let answered = ask(&holder);

        assert!(answered.recv_timeout(STILL).is_err(), "정리가 아직 도는데 답했다 — 토스트가 영영 안 선다");
        release.send(()).expect("정리를 풀어 준다");
        let report = answered.recv_timeout(Duration::from_secs(5)).expect("정리가 끝났는데 5초가 지나도 답이 없다");
        assert_eq!(
            report.cleaned,
            vec![Cleaned { pid: 311, name: "node".into() }, Cleaned { pid: 313, name: "vite".into() }],
            "끝낸 것(끝남 · 강제)만 끝낸 차례대로 실려야 한다"
        );
    }

    /// 앱의 시작 정리는 위 길(`in_background`)에 **받은 몫과 풀의 정리와 그 싣기**를 건넨다. 풀의 정리는 이 기계의 표 전체를 판정해
    /// 끝내므로 여기서 실행으로 부르지 않는다 — 부르는 모양을 자리로 본다. 풀의 정리 자체는 `pty.rs`의 실물 장면
    /// `Startup`이 잰다.
    #[test]
    fn the_app_cleanup_hands_the_pools_cleanup_to_the_background() {
        let src = include_str!("startup.rs");
        let body = src
            .split_once("pub fn clean_up(")
            .expect("여는 표식이 있다")
            .1
            .split_once("\n}\n")
            .expect("닫는 표식이 있다")
            .0;
        assert!(!body.contains("mod tests"), "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다");
        assert!(body.contains("in_background(chore,"), "시작 정리가 받은 몫으로 뒤 스레드에 가는 길을 안 탄다");
        assert!(body.contains("pty::clean_up_at_startup(&pool)"), "시작 정리가 풀의 정리를 안 부른다");
        assert!(body.contains("report.cleaned = cleaned(&cleared)"), "정리의 결과를 보고에 안 싣는다");
    }

    /// 임시 폴더 하나 — 이 검사만의 이름이다. 진짜 홈(`~/.claude` · `~/.codex`)과 진짜 데이터 루트는 건드리지 않는다.
    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("atelier-startup-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 옛 빌드가 훅을 깐 홈 — claude 설정에 옛 python 처리기의 `Stop` 한 줄, codex 설정에 옛 울타리 구획(`Stop` 한 줄).
    /// 훅 설치기의 검사가 모양을 넓게 재고(`hooks.rs`), 여기서는 앱이 뜰 때의 길이 그것을 부르는지만 본다.
    fn old_install(home: &std::path::Path) {
        let old = "/Users/someone/.atelier/hooks/atelier-hook.py";
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        let claude = serde_json::json!({ "model": "opus", "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": format!("'{old}' claude Stop") }] }] } });
        std::fs::write(home.join(".claude/settings.json"), serde_json::to_string_pretty(&claude).unwrap()).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(
            home.join(".codex/config.toml"),
            format!(
                "model = \"gpt-5\"\n\n# >>> atelier 셸 신호 훅 — 아틀리에 설정 화면이 넣었습니다 >>>\n\n[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = \"command\"\ncommand = \"'{old}' codex Stop\"\n# <<< atelier 셸 신호 훅 <<<\n"
            ),
        )
        .unwrap();
    }

    /// **앱이 뜰 때의 훅 맞춤이 인자로 받은 홈과 데이터 루트에서 돌고, 맞춘 에이전트를 시작 보고에 싣는다**(프로세스 결정 15 ·
    /// 티켓 21). 옛 설치는 지금 목록으로 맞춰지고 `.bak`이 서며, 설정의 처리기 경로는 받은 데이터 루트의 새 처리기다. 한 번도 깐
    /// 적이 없는 홈은 글자 그대로이고 보고의 훅 칸이 빈다.
    #[test]
    fn the_hook_sync_runs_on_the_homes_it_is_given_and_reports_what_it_wrote() {
        let (home, root) = (temp_dir("sync-home"), temp_dir("sync-root"));
        old_install(&home);
        let holder = Arc::new(ReportHolder::default());
        sync_hooks(holder.expect(), home.clone(), root.clone());

        let report = ask(&holder).recv_timeout(Duration::from_secs(5)).expect("맞춤이 끝났는데 5초가 지나도 답이 없다");
        assert_eq!(report.hooks_updated, ["claude", "codex"], "맞춘 에이전트가 보고에 안 실렸다");
        let handler = crate::shells::handler_path(&root);
        for file in [".claude/settings.json", ".codex/config.toml"] {
            let now = std::fs::read_to_string(home.join(file)).unwrap();
            assert!(now.contains(&*handler.to_string_lossy()), "{file}이 받은 데이터 루트의 처리기를 안 가리킨다:\n{now}");
            assert!(!now.contains("atelier-hook.py"), "{file}에 옛 줄이 남았다:\n{now}");
            assert!(home.join(format!("{file}.bak")).exists(), "{file}의 .bak이 안 섰다");
        }
        let _ = std::fs::remove_dir_all(&home);

        // 한 번도 깐 적이 없는 홈 — 남의 설정만 있다.
        let fresh = temp_dir("sync-fresh");
        std::fs::create_dir_all(fresh.join(".claude")).unwrap();
        let foreign = "{\n    \"model\": \"opus\"\n}";
        std::fs::write(fresh.join(".claude/settings.json"), foreign).unwrap();
        let holder = Arc::new(ReportHolder::default());
        sync_hooks(holder.expect(), fresh.clone(), root.clone());
        let report = ask(&holder).recv_timeout(Duration::from_secs(5)).expect("5초가 지나도 답이 없다");
        assert!(report.hooks_updated.is_empty(), "깐 적이 없는데 맞췄다고 한다: {:?}", report.hooks_updated);
        assert_eq!(std::fs::read_to_string(fresh.join(".claude/settings.json")).unwrap(), foreign, "남의 설정을 다시 썼다");
        assert!(!fresh.join(".claude/settings.json.bak").exists(), "쓴 것이 없는데 벌을 떴다");
        assert!(!fresh.join(".codex").exists(), "없던 codex 설정을 만들었다");
        let _ = std::fs::remove_dir_all(&fresh);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **시작 보고는 훅 맞춤이 끝난 뒤 답한다**(티켓 21 — 티켓 10이 세운 「기여자 여럿」에 훅 맞춤을 하나 더한다). 시작 정리의 몫이
    /// 끝나도 맞춤이 도는 동안은 답하지 않는다. 맞춤은 부르는 스레드를 막지 않는다 — 앱의 셋업이 그동안 서면 창이 늦게 뜬다.
    ///
    /// **문은 codex 설정 자리의 이름 붙은 파이프(FIFO)다.** 맞춤이 그 파일을 읽으려 열면 누가 쓰기로 열 때까지 막힌다 — 진짜 맞춤을
    /// 그 자리에 붙잡아 둘 수 있다. 문을 열면 우리 것 없는 설정을 흘려보내므로 codex는 안 쓰이고(파이프가 그대로 남는다) claude만
    /// 맞춘다.
    #[cfg(unix)]
    #[test]
    fn the_report_waits_for_the_hook_sync() {
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::FileTypeExt;

        let (home, root) = (temp_dir("wait-home"), temp_dir("wait-root"));
        old_install(&home);
        let fifo = home.join(".codex/config.toml");
        std::fs::remove_file(&fifo).unwrap();
        let name = std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
        // SAFETY: 널로 끝나는 경로 하나를 넘길 뿐이다.
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0, "파이프를 못 만들었다");

        let holder = Arc::new(ReportHolder::default());
        let cleanup = holder.expect();
        let (returned, came_back) = mpsc::channel();
        {
            let (chore, home, root) = (holder.expect(), home.clone(), root.clone());
            std::thread::spawn(move || {
                sync_hooks(chore, home, root);
                let _ = returned.send(());
            });
        }
        assert!(
            came_back.recv_timeout(Duration::from_secs(5)).is_ok(),
            "훅 맞춤이 부르는 스레드를 막는다 — 앱의 셋업이 파일을 다 읽고 쓸 때까지 선다"
        );
        let answered = ask(&holder);
        cleanup.deliver(|report| report.cleaned.push(Cleaned { pid: 4242, name: "node".into() }));
        assert!(answered.recv_timeout(STILL).is_err(), "훅 맞춤이 도는데 답했다 — 맞춘 사실이 보고에 안 실린다");

        // 문을 연다 — 파이프를 쓰기로 열면 막혀 있던 읽기가 이어진다. 맞춤이 그 파일을 영영 안 읽으면 여기서 5초 뒤 빨갛다.
        let (opened, open) = mpsc::channel();
        {
            let fifo = fifo.clone();
            std::thread::spawn(move || {
                use std::io::Write;
                if let Ok(mut pipe) = std::fs::OpenOptions::new().write(true).open(&fifo) {
                    let _ = pipe.write_all(b"model = \"gpt-5\"\n");
                    let _ = opened.send(());
                }
            });
        }
        open.recv_timeout(Duration::from_secs(5)).expect("맞춤이 codex 설정을 안 읽는다");

        let report = answered.recv_timeout(Duration::from_secs(5)).expect("맞춤이 끝났는데 5초가 지나도 답이 없다");
        assert_eq!(report.cleaned, vec![Cleaned { pid: 4242, name: "node".into() }], "시작 정리의 몫이 빠졌다");
        assert_eq!(report.hooks_updated, ["claude"], "훅 맞춤의 몫이 빠졌거나 codex를 썼다");
        assert!(std::fs::symlink_metadata(&fifo).unwrap().file_type().is_fifo(), "우리 것이 없는 codex 설정을 다시 썼다");
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 와이어 모양. 프런트는 `cleaned` · `hooksUpdated`를 읽는다 — `rename_all`이 빠지면 훅 칸이
    /// `hooks_updated`로 나가 프런트가 `undefined`를 읽는다.
    #[test]
    fn the_report_crosses_the_wire_in_the_shape_the_frontend_reads() {
        let report = StartupReport {
            cleaned: vec![Cleaned { pid: 4242, name: "node".into() }],
            hooks_updated: vec!["claude".into()],
        };
        assert_eq!(
            serde_json::to_value(&report).unwrap(),
            serde_json::json!({
                "cleaned": [{ "pid": 4242, "name": "node" }],
                "hooksUpdated": ["claude"],
            })
        );
    }
}
