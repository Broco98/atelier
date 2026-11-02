//! L1 — 호스트 ↔ 가짜 `claude` · 가짜 `codex`: 로그인을 확인하고, 터미널에서 칠 로그인 명령을 짓는다(three-axes 티켓 12 · 스토리
//! 93 · 94 · restart 01c-10). 앱은 로그인 명령을 띄우지 않는다 — 화면이 Terminal에 새 셸을 열어 친다. 로그인을 기다리던 Session이
//! 「다시 확인」으로 다시 뜨는 것은 `thread_host.rs` · `thread_codex.rs`가 잰다.

mod common;

use atelier_acp::{Agent, EngineCheck, EngineState, FoundProgram, MissingProgram};
use common::{Sandbox, NO_BROWSER};

#[test]
fn claude_auth_status가_loggedin_false로_exit_1이면_엔진_확인이_로그인_안_됨이고_로그인_파일이_서면_됨이다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("normal", NO_BROWSER, &[]));
    let claude = FoundProgram { name: "claude", path: sandbox.login_bin().join("claude") };

    assert_eq!(
        host.check_engine(Agent::Claude, false).expect("엔진 확인"),
        EngineCheck::Found { programs: vec![claude.clone()], logged_in: false },
    );
    sandbox.log_in(Agent::Claude);
    assert_eq!(
        host.check_engine(Agent::Claude, false).expect("엔진 확인"),
        EngineCheck::Found { programs: vec![claude], logged_in: true },
        "확인은 매번 엔진에 묻는다 — 쥔 것은 로그인 env뿐이다"
    );
    assert_eq!(sandbox.status_calls(Agent::Claude), ["status --json", "status --json"]);
    assert_eq!(
        events.engine_states(),
        [
            EngineState { agent: Agent::Claude, found: true, logged_in: Some(false), missing: vec![] },
            EngineState { agent: Agent::Claude, found: true, logged_in: Some(true), missing: vec![] },
        ],
        "확인한 엔진 상태가 엔진 상태 이벤트로도 나간다"
    );
}

#[test]
fn codex_login_status의_exit가_0이_아니면_로그인_안_됨이고_0이면_됨이다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.login_shell_for_login("normal", NO_BROWSER, &[]));

    let logged_in = |check: EngineCheck| match check {
        EngineCheck::Found { logged_in, .. } => logged_in,
        missing => panic!("찾았어야 한다: {missing:?}"),
    };
    assert!(!logged_in(host.check_engine(Agent::Codex, false).expect("엔진 확인")));
    sandbox.log_in(Agent::Codex);
    assert!(logged_in(host.check_engine(Agent::Codex, false).expect("엔진 확인")));
    assert_eq!(sandbox.status_calls(Agent::Codex), ["status", "status"]);
}

#[test]
fn 못_찾은_엔진은_로그인을_묻지_않고_엔진_상태가_못_찾음이다() {
    let sandbox = Sandbox::new();
    let bin = sandbox.bin("empty");
    let (host, events) = sandbox.host_with_events(atelier_acp::ShellSource::Path(
        sandbox.login_shell(common::LoginShell::Normal, &[&bin]),
    ));

    assert!(matches!(host.check_engine(Agent::Claude, false), Ok(EngineCheck::Missing { .. })));
    let claude = MissingProgram { name: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" };
    assert_eq!(
        events.engine_states(),
        [EngineState { agent: Agent::Claude, found: false, logged_in: None, missing: vec![claude] }],
        "빠진 것과 설치 명령도 싣는다 — 세션을 열다 못 찾은 때와 같은 꼴이다(restart 01c-9)"
    );
}

#[test]
fn 터미널에서_칠_로그인_명령은_로그인_셸의_path에서_찾은_실행_파일과_그_엔진의_로그인_인자다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.login_shell_for_login("normal", NO_BROWSER, &[]));
    let bin = sandbox.login_bin();

    assert_eq!(host.login_command(Agent::Codex).expect("Codex의 로그인 명령"), format!("{} login", bin.join("codex").display()));
    assert_eq!(
        host.login_command(Agent::Claude).expect("Claude의 로그인 명령"),
        format!("{} auth login", bin.join("claude").display())
    );
    assert!(sandbox.status_calls(Agent::Codex).is_empty(), "명령을 짓기만 한다 — 로그인을 묻지 않는다");
}

#[test]
fn 실행_파일의_경로에_빈칸이_있으면_셸이_한_낱말로_읽게_따옴표로_싼다() {
    let sandbox = Sandbox::new();
    let spaced = sandbox.bin("my tools");
    std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_fake-claude"), spaced.join("claude")).unwrap();
    let host = sandbox.host(atelier_acp::ShellSource::Path(sandbox.login_shell(common::LoginShell::Normal, &[&spaced])));

    assert_eq!(host.login_command(Agent::Claude).expect("로그인 명령"), format!("'{}' auth login", spaced.join("claude").display()));
}

#[test]
fn 엔진을_못_찾으면_로그인_명령은_못_찾음이고_그_엔진의_못_찾음이_알려진다() {
    let sandbox = Sandbox::new();
    let empty = sandbox.bin("empty");
    let (host, events) =
        sandbox.host_with_events(atelier_acp::ShellSource::Path(sandbox.login_shell(common::LoginShell::Normal, &[&empty])));

    let claude = MissingProgram { name: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" };
    assert_eq!(
        host.login_command(Agent::Claude),
        Err(atelier_acp::HostError::EngineMissing { agent: Agent::Claude, missing: vec![claude.clone()] })
    );
    assert_eq!(
        events.engine_states(),
        [EngineState { agent: Agent::Claude, found: false, logged_in: None, missing: vec![claude] }],
        "카드가 「설치 안내」로 바뀐다"
    );
}
