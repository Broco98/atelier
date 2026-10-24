//! L1 — 대화 호스트 ↔ 가짜 로그인 셸: 「엔진 확인」이 로그인 셸의 PATH로 에이전트를 찾는다.
//!
//! Finder에서 띄운 앱도 내 터미널과 같은 PATH로 에이전트를 찾고, 못 찾으면 무엇을 깔아야 하는지 안다
//! (three-axes 티켓 02 · 스토리 101 · 103).

mod common;

use std::time::{Duration, Instant};

use atelier_acp::{Agent, EngineCheck, FoundProgram, LoginShellError, MissingProgram, ShellSource};
use common::{assert_all_gone, LoginShell, Sandbox};

/// 이 파일의 가짜 실행 파일은 찾기만 하는 `exit 0` 스크립트다. 그래서 로그인 확인에서 `claude auth status`는 JSON을 내지
/// 않아 「안 됨」이고, `codex login status`는 exit 0이라 「됨」이다 — 로그인의 모양은 `tests/login.rs`가 진짜 같은 가짜로 잰다.
#[test]
fn 보통_로그인_셸이면_두_엔진을_모두_찾고_path_앞쪽의_것을_고른다() {
    let sandbox = Sandbox::new();
    let front = sandbox.bin("front");
    let back = sandbox.bin("back");
    for program in ["claude", "codex-acp"] {
        sandbox.plant(&front, program);
    }
    for program in ["claude", "codex-acp", "codex", "node"] {
        sandbox.plant(&back, program);
    }
    let shell = sandbox.login_shell(LoginShell::Normal, &[&front, &back]);
    let host = sandbox.host(ShellSource::Path(shell));

    assert_eq!(
        host.check_engine(Agent::Claude, false).expect("엔진 확인"),
        EngineCheck::Found { programs: vec![FoundProgram { name: "claude", path: front.join("claude") }], logged_in: false },
    );
    assert_eq!(
        host.check_engine(Agent::Codex, false).expect("엔진 확인"),
        EngineCheck::Found {
            programs: vec![
                FoundProgram { name: "codex-acp", path: front.join("codex-acp") },
                FoundProgram { name: "codex", path: back.join("codex") },
                FoundProgram { name: "node", path: back.join("node") },
            ],
            logged_in: true,
        },
    );
}

#[test]
fn 실행_권한이_없는_claude만_있으면_못_찾음이고_설치_명령이_실린다() {
    let sandbox = Sandbox::new();
    let bin = sandbox.bin("bin");
    sandbox.plant_unexecutable(&bin, "claude");
    let shell = sandbox.login_shell(LoginShell::Normal, &[&bin]);
    let host = sandbox.host(ShellSource::Path(shell));

    assert_eq!(
        host.check_engine(Agent::Claude, false).expect("엔진 확인"),
        EngineCheck::Missing {
            missing: vec![MissingProgram {
                name: "claude",
                install: "curl -fsSL https://claude.ai/install.sh | bash",
            }],
        },
    );
}

#[test]
fn codex에서_codex_acp만_없으면_그것_하나만_빠진_것으로_실린다() {
    let sandbox = Sandbox::new();
    let bin = sandbox.bin("bin");
    for program in ["claude", "codex", "node"] {
        sandbox.plant(&bin, program);
    }
    let shell = sandbox.login_shell(LoginShell::Normal, &[&bin]);
    let host = sandbox.host(ShellSource::Path(shell));

    assert_eq!(
        host.check_engine(Agent::Codex, false).expect("엔진 확인"),
        EngineCheck::Missing {
            missing: vec![MissingProgram { name: "codex-acp", install: "npm i -g @agentclientprotocol/codex-acp" }],
        },
    );
}

#[test]
fn 배경_작업이_stdout을_쥐어도_end_표지에서_끝나고_남은_프로세스가_없다() {
    let sandbox = Sandbox::new();
    let bin = sandbox.bin("bin");
    sandbox.plant(&bin, "claude");
    let shell = sandbox.login_shell(LoginShell::BackgroundHoldsStdout, &[&bin]);
    // 배경 작업은 30초를 잔다. EOF를 기다리는 구현이면 이 한도에 걸려 시간 초과로 빨개진다.
    let host = sandbox.host_with_limit(ShellSource::Path(shell), Duration::from_secs(5));

    assert_eq!(
        host.check_engine(Agent::Claude, false).expect("END 표지에서 돌아와야 한다"),
        EngineCheck::Found { programs: vec![FoundProgram { name: "claude", path: bin.join("claude") }], logged_in: false },
    );
    let pids = sandbox.shell_pids();
    assert_eq!(pids.len(), 1, "가짜 셸이 배경 작업의 pid를 적었어야 한다");
    assert_all_gone(&pids);
}

#[test]
fn 표지_없이_끝난_셸은_까닭과_함께_실패한다() {
    let sandbox = Sandbox::new();
    let shell = sandbox.login_shell(LoginShell::NoMarker, &[]);
    let host = sandbox.host(ShellSource::Path(shell.clone()));

    let error = host.check_engine(Agent::Claude, false).expect_err("표지가 없다");
    assert_eq!(error, LoginShellError::NoMarker { shell });
}

#[test]
fn 한도를_넘긴_셸은_까닭과_함께_실패하고_남은_프로세스가_없다() {
    let sandbox = Sandbox::new();
    let shell = sandbox.login_shell(LoginShell::Slow, &[]);
    let limit = Duration::from_secs(1);
    let host = sandbox.host_with_limit(ShellSource::Path(shell.clone()), limit);

    let started = Instant::now();
    let error = host.check_engine(Agent::Codex, false).expect_err("셸이 잠들어 있다");
    assert_eq!(error, LoginShellError::TimedOut { shell, limit });
    assert!(started.elapsed() < limit + Duration::from_secs(2), "한도에서 곧바로 돌아와야 한다: {:?}", started.elapsed());
    let pids = sandbox.shell_pids();
    assert_eq!(pids.len(), 2, "가짜 셸이 자기와 잠든 자식의 pid를 적었어야 한다");
    assert_all_gone(&pids);
}

#[test]
fn 실행할_수_없는_셸은_까닭과_함께_실패한다() {
    let sandbox = Sandbox::new();
    let bin = sandbox.bin("bin");
    sandbox.plant_unexecutable(&bin, "zsh");
    let host = sandbox.host(ShellSource::Path(bin.join("zsh")));

    let error = host.check_engine(Agent::Claude, false).expect_err("실행 권한이 없다");
    assert!(matches!(error, LoginShellError::CannotRun { ref shell, .. } if *shell == bin.join("zsh")), "{error:?}");
}

#[test]
fn 로그인_env는_한_번_읽어_쥐고_다시_확인만_셸을_다시_띄운다() {
    let sandbox = Sandbox::new();
    let bin = sandbox.bin("bin");
    for program in ["claude", "codex-acp", "codex", "node"] {
        sandbox.plant(&bin, program);
    }
    let shell = sandbox.login_shell(LoginShell::Normal, &[&bin]);
    let host = sandbox.host(ShellSource::Path(shell));

    host.check_engine(Agent::Claude, false).expect("첫 엔진 확인");
    host.check_engine(Agent::Codex, false).expect("두 번째 엔진 확인");
    host.check_engine(Agent::Claude, false).expect("세 번째 엔진 확인");
    assert_eq!(sandbox.shell_calls(), ["-l -i -c"], "쥔 로그인 env를 써야 한다");

    host.check_engine(Agent::Codex, true).expect("다시 확인");
    assert_eq!(sandbox.shell_calls(), ["-l -i -c", "-l -i -c"], "다시 확인은 셸을 다시 띄운다");
}

#[test]
fn 설치기가_rc에_더한_path는_다시_확인에서만_보인다() {
    let sandbox = Sandbox::new();
    let bin = sandbox.bin("bin");
    let shell = sandbox.login_shell(LoginShell::Normal, &[&bin]);
    let host = sandbox.host(ShellSource::Path(shell));
    assert!(matches!(host.check_engine(Agent::Claude, false), Ok(EngineCheck::Missing { .. })));

    // 설치기가 새 폴더에 claude를 깔고, 그 폴더를 rc의 PATH 앞에 더했다.
    let installed = sandbox.bin("installed");
    sandbox.plant(&installed, "claude");
    sandbox.login_shell(LoginShell::Normal, &[&installed, &bin]);

    assert!(
        matches!(host.check_engine(Agent::Claude, false), Ok(EngineCheck::Missing { .. })),
        "다시 확인이 아니면 쥔 로그인 env의 PATH로 찾는다"
    );
    assert_eq!(
        host.check_engine(Agent::Claude, true).expect("다시 확인"),
        EngineCheck::Found {
            programs: vec![FoundProgram { name: "claude", path: installed.join("claude") }],
            logged_in: false,
        },
    );
}

/// 엔진 확인의 답은 앱 명령을 건너 화면으로 간다(three-axes 티켓 05). 화면은 `state`로 찾음 · 못 찾음을 가르고,
/// 안내 카드는 빠진 것마다 이름과 설치 명령을, 찾았는데 로그인이 안 됐으면 로그인을 보인다(티켓 12) — 이 꼴이 프런트의
/// `EngineCheck` 타입과 같은 말이다.
#[test]
fn 엔진_확인의_답은_화면이_읽는_꼴로_나간다() {
    let found = EngineCheck::Found {
        programs: vec![FoundProgram { name: "claude", path: "/Users/me/.local/bin/claude".into() }],
        logged_in: false,
    };
    assert_eq!(
        serde_json::to_value(&found).unwrap(),
        serde_json::json!({
            "state": "found",
            "programs": [{"name": "claude", "path": "/Users/me/.local/bin/claude"}],
            "loggedIn": false,
        }),
    );
    let missing = EngineCheck::Missing {
        missing: vec![MissingProgram { name: "codex-acp", install: "npm i -g @agentclientprotocol/codex-acp" }],
    };
    assert_eq!(
        serde_json::to_value(&missing).unwrap(),
        serde_json::json!({
            "state": "missing",
            "missing": [{"name": "codex-acp", "install": "npm i -g @agentclientprotocol/codex-acp"}],
        }),
    );
}
