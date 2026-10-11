//! L1 — 대화 호스트 ↔ 가짜 `claude` · 가짜 `codex` · 가짜 ACP 에이전트: 로그인을 확인하고, 앱에서 로그인 명령을 띄우고,
//! 로그인이 필요하면 기록에 남기고, 「됨」으로 바뀌면 그 대화를 다시 띄운다(three-axes 티켓 12 · 스토리 93 · 94 · 95 · 96 ·
//! 97 · 99 · 100).
//!
//! 검사 중 진짜 브라우저는 열리지 않는다 — 로그인 env의 `BROWSER=/usr/bin/true`가 막고, PATH 앞의 `open`은 기록용
//! 가짜다(실측 함정 40). 시험은 호스트에 명령을 넣고, 나오는 이벤트 · `agents/` 파일 · 가짜의 영수증만 본다.

mod common;

use std::sync::Arc;

use atelier_acp::{Agent, EngineCheck, EngineState, FoundProgram, HostError, LoginProgress};
use common::{assert_all_gone, login_pids, Sandbox, NO_BROWSER};
use serde_json::{json, Value};

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

#[test]
fn needs_auth면_대화는_서고_로그인_필요_줄과_엔진_상태가_오고_말은_로그인_필요로_거절된다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("needs-auth", NO_BROWSER, &[]));

    let conversation = host.new_conversation("cart", Agent::Codex).expect("로그인이 필요해도 대화는 선다");

    let record = sandbox.record("cart", &conversation.id);
    let sessions: Vec<Value> = record.iter().filter(|line| line["kind"] == "session").map(|line| line["payload"].clone()).collect();
    assert_eq!(
        sessions,
        [
            json!({"state": "spawning"}),
            json!({"state": "auth-status", "params": {"authStatus": {"kind": "none", "label": "Not logged in"}}}),
            json!({"state": "login-required"}),
        ],
        "initialize는 되고 session/new가 -32000이다(실측 A3) — 죽음이 아니라 로그인 필요다"
    );
    assert_eq!(conversation.last_seq, record.last().unwrap()["seq"].as_u64().unwrap());
    assert!(sandbox.agents_row("cart", &conversation.id)["agentSessionId"].is_null(), "에이전트 쪽 세션은 아직 없다");
    assert_eq!(
        events.engine_states(),
        [EngineState { agent: Agent::Codex, found: true, logged_in: Some(false), login: None }],
    );
    assert_eq!(
        host.send("cart", &conversation.id, "안녕"),
        Err(HostError::LoginRequired { agent: Agent::Codex, conversation: conversation.id.clone() }),
    );
    assert_eq!(sandbox.opened(), Vec::<String>::new(), "로그인 필요만으로 브라우저를 열지 않는다");

    host.shut_down();
    // S26 — 대화창의 L3(티켓 22)가 이 기록으로 「로그인 안 됨」 안내 카드를 잰다. 에이전트 쪽 세션은 없다.
    common::assert_record("login-required", &common::fix_record_sessions(&record, &sandbox.data_root(), &[]));
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
fn 로그인을_시작하면_링크가_오고_끝나면_저절로_다시_확인해_됨이면_로그인_필요였던_대화가_다시_뜬다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.login_shell_for_login("needs-auth", NO_BROWSER, &[("FAKE_ACP_ACCOUNT_EMAIL", "someone@example.com")]);
    let (host, events) = sandbox.host_with_events(shell);
    let host = Arc::new(host);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("로그인이 필요해도 대화는 선다");

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
        [
            EngineState { agent: Agent::Codex, found: true, logged_in: Some(false), login: None },
            running(Agent::Codex, None),
            running(Agent::Codex, Some(CODEX_URL)),
            ended(Agent::Codex, true, false, Some(0)),
        ],
        "링크는 stdout · stderr에 처음 찍힌 https:// URL이고(앞의 http://localhost는 아니다), 끝은 다시 돈 확인의 답을 싣는다"
    );
    assert_eq!(sandbox.status_calls(Agent::Codex), ["status"], "끝나면 확인을 저절로 다시 돈다");

    let record =
        sandbox.wait_record("cart", &conversation.id, |record| record.iter().any(|line| line["payload"]["state"] == "opened"));
    let sessions: Vec<&str> = record
        .iter()
        .filter(|line| line["kind"] == "session")
        .map(|line| line["payload"]["state"].as_str().unwrap())
        .collect();
    assert_eq!(
        sessions,
        ["spawning", "auth-status", "login-required", "spawning", "auth-status", "opened"],
        "같은 기록에 이어 다시 띄운다 — 기록은 그대로다"
    );
    let text = std::fs::read_to_string(sandbox.record_path("cart", &conversation.id)).unwrap();
    assert!(!text.contains("someone@example.com"), "기록의 이메일은 가려진다");
    assert!(text.contains("<email>"));
    assert!(!sandbox.agents_row("cart", &conversation.id)["agentSessionId"].is_null(), "다시 띄운 세션의 id가 적힌다");

    host.send("cart", &conversation.id, "안녕").expect("다시 뜬 대화에는 말이 간다");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
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

#[test]
fn 턴_도중의_32000도_로그인_필요_줄이고_다시_확인이_됨이면_에이전트를_새로_띄워_말이_간다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    sandbox.log_in(Agent::Codex);
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("needs-auth", NO_BROWSER, &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("로그인돼 있으면 세션이 열린다");
    let (first_session, first_pid) = {
        let session = sandbox.agent_session_id("cart", &conversation.id);
        let pid = sandbox.acp_receipt(&session)["pid"].as_u64().unwrap() as u32;
        (session, pid)
    };

    // 대화 도중에 로그인이 풀렸다.
    sandbox.log_out(Agent::Codex);
    host.send("cart", &conversation.id, "첫 말").expect("보내기");
    let record = sandbox.wait_record("cart", &conversation.id, |record| {
        record.iter().any(|line| line["payload"]["state"] == "login-required")
    });
    let tail: Vec<(Value, Value)> =
        record.iter().rev().take(2).rev().map(|line| (line["kind"].clone(), line["payload"].clone())).collect();
    assert_eq!(tail[0].0, json!("turn-end"));
    assert_eq!(tail[0].1["error"]["code"], json!(-32000), "턴 끝 줄에 에이전트의 오류가 그대로 실린다");
    assert_eq!(tail[1], (json!("session"), json!({"state": "login-required"})), "턴 끝 바로 뒤에 로그인 필요 줄이 선다");
    assert_eq!(
        events.engine_states().last(),
        Some(&EngineState { agent: Agent::Codex, found: true, logged_in: Some(false), login: None }),
        "엔진을 가리지 않고 같은 엔진 상태가 나간다"
    );
    assert_eq!(
        host.send("cart", &conversation.id, "둘째 말"),
        Err(HostError::LoginRequired { agent: Agent::Codex, conversation: conversation.id.clone() }),
    );

    // 터미널에서 로그인하고 안내 카드의 「다시 확인」을 눌렀다.
    sandbox.log_in(Agent::Codex);
    assert!(matches!(host.check_engine(Agent::Codex, true), Ok(EngineCheck::Found { logged_in: true, .. })));

    let second_session = sandbox.agent_session_id("cart", &conversation.id);
    assert_ne!(second_session, first_session, "떠 있던 에이전트를 끄고 새로 띄웠다 — 새 로그인을 읽는다는 보장이 없다");
    assert_all_gone(&[first_pid]);
    assert_eq!(sandbox.acp_events(&first_session), ["stdin-eof"], "끌 때는 먼저 stdin을 닫는다");
    host.send("cart", &conversation.id, "셋째 말").expect("다시 뜬 대화에는 말이 간다");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 2);
    assert_eq!(record.last().unwrap()["payload"]["stopReason"], json!("end_turn"));
    let prompts = sandbox.acp_prompts(&second_session);
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0]["prompt"].as_array().unwrap().len(), 2, "새 세션의 첫 말에는 머리말이 다시 붙는다(S11)");

    host.shut_down();
}

#[test]
fn 로그인을_기다리던_대화를_닫으면_됨이_돼도_다시_띄우지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.login_shell_for_login("needs-auth", NO_BROWSER, &[]));
    let closed = host.new_conversation("cart", Agent::Codex).expect("닫을 대화");
    let kept = host.new_conversation("cart", Agent::Codex).expect("남길 대화");
    host.close_conversation("cart", &closed.id).expect("닫기");

    sandbox.log_in(Agent::Codex);
    host.check_engine(Agent::Codex, true).expect("다시 확인");

    let spawned = |id: &str| {
        sandbox.record("cart", id).iter().filter(|line| line["payload"]["state"] == "spawning").count()
    };
    assert_eq!(spawned(&closed.id), 1, "닫은 대화는 다시 띄우지 않는다");
    assert_eq!(spawned(&kept.id), 2, "남은 대화는 다시 띄운다");
    assert!(sandbox.agents_row("cart", &closed.id)["agentSessionId"].is_null());
    host.shut_down();
}
