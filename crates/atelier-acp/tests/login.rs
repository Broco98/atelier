//! L1 — 호스트 ↔ 가짜 `claude` · 가짜 `codex`: 로그인을 확인하고, 앱에서 로그인 명령을 띄우고, 끝나면 저절로 다시
//! 확인한다(three-axes 티켓 12 · 스토리 93 · 94 · 95 · 96 · 97 · 99 · 100). 로그인을 기다리던 Session이 「됨」으로 다시 뜨는
//! 것은 `thread_host.rs`가 잰다.
//!
//! 검사 중 진짜 브라우저는 열리지 않는다 — 로그인 env의 `BROWSER=/usr/bin/true`가 막고, PATH 앞의 `open`은 기록용
//! 가짜다(실측 함정 40). 시험은 호스트에 명령을 넣고, 나오는 이벤트 · 가짜의 영수증만 본다.

mod common;

use std::sync::Arc;

use atelier_acp::{Agent, EngineCheck, EngineState, FoundProgram, LoginProgress};
use common::{assert_all_gone, login_pids, Sandbox, NO_BROWSER};
use serde_json::json;

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
            EngineState { agent: Agent::Claude, found: true, logged_in: Some(false), login: None },
            EngineState { agent: Agent::Claude, found: true, logged_in: Some(true), login: None },
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
    assert_eq!(events.engine_states(), [EngineState { agent: Agent::Claude, found: false, logged_in: None, login: None }]);
}

const CODEX_URL: &str = "https://auth.openai.com/oauth/authorize?response_type=code&client_id=fake-client&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=fake-state";
const CLAUDE_URL: &str = "https://claude.com/cai/oauth/authorize?code=true&client_id=fake-client&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=fake-state";

fn running(agent: Agent, url: Option<&str>) -> EngineState {
    EngineState { agent, found: true, logged_in: None, login: Some(LoginProgress::Running { url: url.map(str::to_owned) }) }
}

fn ended(agent: Agent, logged_in: bool, cancelled: bool, exit_code: Option<i32>) -> EngineState {
    EngineState { agent, found: true, logged_in: Some(logged_in), login: Some(LoginProgress::Ended { cancelled, exit_code }) }
}

fn has_ended(states: &[EngineState]) -> bool {
    states.iter().any(|state| matches!(state.login, Some(LoginProgress::Ended { .. })))
}

fn has_link(states: &[EngineState]) -> bool {
    states.iter().any(|state| matches!(state.login, Some(LoginProgress::Running { url: Some(_) })))
}

#[test]
fn codex_로그인은_codex_login이고_처음_찍힌_https_링크를_내고_끝나면_저절로_다시_확인해_됨이다() {
    let sandbox = Sandbox::new();
    let shell = sandbox.login_shell_for_login("needs-auth", NO_BROWSER, &[]);
    let (host, events) = sandbox.host_with_events(shell);
    let host = Arc::new(host);

    Arc::clone(&host).start_login(Agent::Codex).expect("로그인 시작");
    events.wait_engine(has_link);
    let runs = sandbox.login_runs(Agent::Codex);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["args"], json!(["login"]), "Codex의 로그인 명령은 `codex login`이다");
    assert_eq!(runs[0]["sid"], runs[0]["pid"], "새 세션에 띄운다");
    assert_eq!(runs[0]["stdinTty"], json!(false), "TTY 없이 띄운다");
    assert!(sandbox.status_calls(Agent::Codex).is_empty(), "끝나기 전에는 다시 확인하지 않는다");

    sandbox.finish_login(Agent::Codex, true);
    let states = events.wait_engine(has_ended);
    assert_eq!(
        states,
        [running(Agent::Codex, None), running(Agent::Codex, Some(CODEX_URL)), ended(Agent::Codex, true, false, Some(0))],
        "링크는 stdout · stderr에 처음 찍힌 https:// URL이고(앞의 http://localhost는 아니다), 끝은 다시 돈 확인의 답을 싣는다"
    );
    assert_eq!(sandbox.status_calls(Agent::Codex), ["status"], "끝나면 확인을 저절로 다시 돈다");
    assert_all_gone(&login_pids(&runs[0]));
    assert_eq!(sandbox.opened(), Vec::<String>::new(), "검사 중 브라우저를 여는 쪽이 불리지 않았다");

    host.shut_down();
}

#[test]
fn claude_로그인은_auth_login이고_stdout의_링크를_내고_실패로_끝나면_안_됨이다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("normal", NO_BROWSER, &[]));
    let host = Arc::new(host);

    Arc::clone(&host).start_login(Agent::Claude).expect("로그인 시작");
    events.wait_engine(has_link);
    sandbox.finish_login(Agent::Claude, false);
    let states = events.wait_engine(has_ended);

    assert_eq!(
        states,
        [running(Agent::Claude, None), running(Agent::Claude, Some(CLAUDE_URL)), ended(Agent::Claude, false, false, Some(1))],
    );
    let runs = sandbox.login_runs(Agent::Claude);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["args"], json!(["auth", "login"]));
    assert_eq!(sandbox.status_calls(Agent::Claude), ["status --json"]);
    assert_all_gone(&login_pids(&runs[0]));

    host.shut_down();
}

#[test]
fn 로그인_중_취소하면_그룹이_sigterm을_받고_sigint는_0회이고_남은_프로세스가_없다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("normal", NO_BROWSER, &[]));
    let host = Arc::new(host);
    Arc::clone(&host).start_login(Agent::Codex).expect("로그인 시작");
    events.wait_engine(has_link);
    let runs = sandbox.login_runs(Agent::Codex);
    let pids = login_pids(&runs[0]);
    assert_eq!(pids.len(), 2, "로그인 명령과 그 손주");

    host.cancel_login(Agent::Codex);

    assert_all_gone(&pids);
    assert_eq!(sandbox.login_signals(Agent::Codex), ["TERM"], "취소는 그룹 SIGTERM이다 — SIGINT가 아니다");
    let states = events.wait_engine(has_ended);
    assert_eq!(
        states.last(),
        Some(&ended(Agent::Codex, false, true, Some(143))),
        "끝남(취소)과, 다시 돈 확인의 답이 실린다"
    );
    assert!(!sandbox.logged_in_file(Agent::Codex), "로그인 파일은 쓰이지 않았다");

    host.cancel_login(Agent::Codex);
    assert_eq!(sandbox.login_signals(Agent::Codex), ["TERM"], "도는 것이 없으면 취소는 아무 일도 하지 않는다");
    host.shut_down();
}

#[test]
fn 같은_엔진의_두_번째_로그인_시작은_새_프로세스를_띄우지_않고_지금의_진행을_다시_알린다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("normal", NO_BROWSER, &[]));
    let host = Arc::new(host);
    Arc::clone(&host).start_login(Agent::Claude).expect("로그인 시작");
    events.wait_engine(has_link);

    Arc::clone(&host).start_login(Agent::Claude).expect("두 번째 로그인 시작");

    assert_eq!(sandbox.login_runs(Agent::Claude).len(), 1, "엔진마다 로그인 명령은 한 번에 하나다");
    assert_eq!(events.engine_states().last(), Some(&running(Agent::Claude, Some(CLAUDE_URL))));

    // 다른 엔진은 따로 돈다.
    Arc::clone(&host).start_login(Agent::Codex).expect("다른 엔진의 로그인 시작");
    events.wait_engine(|states| states.iter().any(|state| state.agent == Agent::Codex && has_link(std::slice::from_ref(state))));
    assert_eq!(sandbox.login_runs(Agent::Codex).len(), 1);

    let pids: Vec<u32> = [Agent::Claude, Agent::Codex].iter().flat_map(|agent| login_pids(&sandbox.login_runs(*agent)[0])).collect();
    host.shut_down();
    assert_all_gone(&pids);
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert!(!has_ended(&events.engine_states()), "호스트를 끄며 거둔 로그인 명령 뒤에는 다시 확인하지 않는다");
}

#[test]
fn browser가_없어도_엔진이_부르는_open은_기록용_가짜이고_진짜_브라우저가_열리지_않는다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("normal", None, &[]));
    let host = Arc::new(host);

    Arc::clone(&host).start_login(Agent::Claude).expect("로그인 시작");
    events.wait_engine(has_link);
    sandbox.finish_login(Agent::Claude, true);
    let states = events.wait_engine(has_ended);

    assert_eq!(states.last(), Some(&ended(Agent::Claude, true, false, Some(0))));
    assert_eq!(
        sandbox.opened(),
        ["https://claude.com/cai/oauth/authorize?code=true&client_id=fake-client&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A61655%2Fcallback&state=fake-state"],
        "BROWSER가 없으면 엔진은 PATH의 open을 부른다(실측 함정 40) — 그것은 PATH 앞의 기록용 가짜다"
    );
    host.shut_down();
}

