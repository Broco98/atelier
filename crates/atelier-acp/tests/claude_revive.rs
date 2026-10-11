//! L1 — 대화 호스트 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude: 앱을 다시 켜도 Claude 대화가 맥락을 잇고, 로그인이 풀리면
//! Codex와 같은 길로 온다(three-axes 티켓 16 · 스토리 85 · 87 · 100).
//!
//! 앱 재시작은 호스트를 끄고 같은 데이터 루트로 새 호스트를 짓는 것으로 흉내 낸다. 시험은 호스트에 명령을 넣고, `agents/`
//! 기록 · 이벤트 · 가짜 claude의 영수증(받은 인자 · stdin 줄 · 뜬 차례)만 본다.
//!
//! 가짜 claude는 판 02 실측 2.1.296의 원문을 되감는다. `--resume <id>`는 그 세션을 연 적이 있으면(영수증이 있으면) 이어 뜨고,
//! 없으면 진짜 claude처럼(판 02 관문 G4 `g4-resume-missing`) initialize에 답하지 않고 끝난다.

mod common;

use atelier_acp::{Agent, ConversationDefaults, ConversationHost, EngineCheck, EngineState, HostError};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// `--flag 값` 짝이 있나.
fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
    args.windows(2).any(|pair| pair[0] == flag && pair[1] == value)
}

/// 가짜 claude가 뜰 때마다 받은 인자 — 뜬 차례대로.
fn launch_args(sandbox: &Sandbox) -> Vec<Vec<String>> {
    sandbox
        .claude_launches()
        .iter()
        .map(|launch| serde_json::from_value(launch["args"].clone()).expect("받은 인자"))
        .collect()
}

/// 기록의 열림 줄들이 말하는 길(`how`) — 온 차례대로.
fn opened_hows(record: &[Value]) -> Vec<String> {
    record
        .iter()
        .filter(|line| line["kind"] == "session" && line["payload"]["state"] == "opened")
        .map(|line| line["payload"]["how"].as_str().expect("how").to_owned())
        .collect()
}

/// 어제의 Claude 대화 — 모델 · 모드를 고른 대화에서 한 턴을 돌리고 호스트를 끈다.
fn yesterday(sandbox: &Sandbox, host: ConversationHost) -> String {
    let defaults = ConversationDefaults { model: Some("sonnet".into()), mode: Some("acceptEdits".into()) };
    let conversation = host.new_conversation_with("cart", Agent::Claude, defaults).expect("Claude 새 대화");
    host.send("cart", &conversation.id, "어제의 말").expect("보내기");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    host.shut_down();
    conversation.id
}

#[test]
fn 호스트를_다시_지은_뒤_claude_대화에_말을_보내면_가짜_claude가_resume과_기록의_모델_모드_플래그로_뜨고_맥락을_잇는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.claude_login_shell("normal", &[]);
    let id = yesterday(&sandbox, sandbox.host(shell.clone()));
    let session = sandbox.agent_session_id("cart", &id);

    // 앱을 다시 켠 꼴 — 띄우지 않은 동안 바꾼 값도 agents.json에만 남는다(티켓 09).
    let host = sandbox.host(shell);
    host.set_mode("cart", &id, "plan").expect("띄우지 않은 대화의 모드 바꾸기");
    assert_eq!(sandbox.claude_launches().len(), 1, "다시 지어도 띄우지 않는다(S8)");
    host.send("cart", &id, "오늘의 말").expect("말을 보내면 띄워 되살린다");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);

    let launches = launch_args(&sandbox);
    assert_eq!(launches.len(), 2, "보낼 때 하나가 뜬다");
    let revived = &launches[1];
    assert!(has_pair(revived, "--resume", &session), "기록의 세션 id로 되살린다: {revived:?}");
    assert!(!revived.iter().any(|arg| arg == "--session-id"), "되살리기는 --session-id 대신 --resume이다: {revived:?}");
    assert!(has_pair(revived, "--model", "sonnet"), "기록의 모델을 플래그로 준다(three-axes 결정 27): {revived:?}");
    assert!(has_pair(revived, "--permission-mode", "plan"), "기록의 모드(띄우지 않은 동안 바꾼 값)를 플래그로 준다: {revived:?}");
    assert_eq!(opened_hows(&record), ["new", "resumed"], "열림 줄이 맥락을 이었다고 말한다");
    assert_eq!(sandbox.agent_session_id("cart", &id), session, "같은 세션이다");

    let stdin = sandbox.claude_stdin(&session);
    let shapes: Vec<&str> = stdin
        .iter()
        .map(|line| line["request"]["subtype"].as_str().unwrap_or_else(|| line["type"].as_str().unwrap()))
        .collect();
    assert_eq!(
        shapes,
        ["initialize", "user", "initialize", "user"],
        "Codex처럼 set_*를 다시 넣지 않는다 — 띄울 때 플래그로 이미 들었다"
    );
    assert_eq!(
        stdin[3]["message"]["content"],
        json!([{"type": "text", "text": "오늘의 말"}]),
        "맥락을 이었으니 머리말을 다시 붙이지 않는다(S11)"
    );

    host.shut_down();
}

#[test]
fn 되살릴_세션을_claude가_모르면_load로_다시_띄우지_않고_새_세션으로_열리고_열림_줄이_fresh이고_머리말이_다시_붙는다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let id = yesterday(&sandbox, sandbox.host(sandbox.claude_login_shell("normal", &[])));
    let first_session = sandbox.agent_session_id("cart", &id);

    // 다시 켠 앱의 claude는 그 세션을 모른다 — 세션 저장소가 비었다.
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FORGETS", "1")]));
    host.send("cart", &id, "오늘의 말").expect("보내기");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);

    let launches = launch_args(&sandbox);
    assert_eq!(
        launches.len(),
        3,
        "어제의 하나 · 없다고 끝난 --resume 하나 · 새 세션 하나 — load는 같은 --resume이라 다시 띄우지 않는다: {launches:?}"
    );
    assert!(has_pair(&launches[1], "--resume", &first_session), "{:?}", launches[1]);
    let second_session = sandbox.agent_session_id("cart", &id);
    assert_ne!(second_session, first_session, "새 세션의 id가 agents.json에 적힌다");
    assert!(has_pair(&launches[2], "--session-id", &second_session), "{:?}", launches[2]);
    assert!(has_pair(&launches[2], "--model", "sonnet"), "새 세션으로 끝나도 기록의 모델을 준다: {:?}", launches[2]);
    assert_eq!(opened_hows(&record), ["new", "fresh"], "맥락을 잇지 못했다고 열림 줄이 말한다(스토리 86)");
    assert!(
        of_kind(&record, "stderr")
            .iter()
            .any(|line| line["payload"]["line"].as_str().is_some_and(|text| text.contains("No conversation found"))),
        "claude가 남긴 까닭은 stderr 줄로 남는다:\n{}",
        common::lines_text(&record)
    );
    let stdin = sandbox.claude_stdin(&second_session);
    let user = stdin.iter().find(|line| line["type"] == "user").expect("새 세션이 받은 말");
    assert_eq!(
        user["message"]["content"][0]["text"],
        json!(format!(
            "Atelier work 안에서 열린 대화다.\n\n- work slug: `cart`\n- 제목: cart 제목\n- spec 폴더(specDir): `{}`\n",
            work.join("spec").display()
        )),
        "새 세션의 첫 말에 머리말이 다시 붙는다(S11)"
    );
    assert_eq!(user["message"]["content"][1]["text"], "오늘의 말");

    host.shut_down();
}

/// 검사에서 진짜 브라우저를 막는 `BROWSER`(실측 함정 40).
const NO_BROWSER: Option<&str> = Some("/usr/bin/true");

#[test]
fn noauth_첫_턴의_authentication_failed는_codex와_같은_로그인_필요_줄과_엔진_상태로_오고_오류_글은_답으로_서지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    sandbox.log_in(Agent::Claude);
    let receipts = sandbox.claude_receipts();
    let extra = [("FAKE_CLAUDE_FIXTURE", "2.1.296/noauth"), ("FAKE_CLAUDE_RECEIPTS", receipts.to_str().unwrap())];
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("normal", NO_BROWSER, &extra));
    // 진짜 claude 2.1.296은 로그인이 안 돼도 세션 열기(initialize)는 된다 — 첫 턴에서야 드러난다(실측 A8).
    let conversation = host.new_conversation("cart", Agent::Claude).expect("세션은 열린다");
    let session = sandbox.agent_session_id("cart", &conversation.id);

    host.send("cart", &conversation.id, "ok 라고만 답해.").expect("보내기");
    let record = sandbox.wait_record("cart", &conversation.id, |record| {
        record.iter().any(|line| line["payload"]["state"] == "login-required")
    });

    let tail: Vec<(Value, Value)> =
        record.iter().rev().take(2).rev().map(|line| (line["kind"].clone(), line["payload"].clone())).collect();
    assert_eq!(tail[0].0, json!("turn-end"));
    assert_eq!(
        (tail[0].1["error"]["code"].clone(), tail[0].1["error"]["message"].clone()),
        (json!(-32000), json!("Authentication required")),
        "변환기가 session/prompt에 codex-acp와 같은 -32000으로 답하고, 턴 끝 줄에 그대로 실린다(S3)"
    );
    assert_eq!(tail[1], (json!("session"), json!({"state": "login-required"})), "턴 끝 바로 뒤에 로그인 필요 줄이 선다");
    assert_eq!(
        events.engine_states().last(),
        Some(&EngineState { agent: Agent::Claude, found: true, logged_in: Some(false), login: None }),
        "엔진을 가리지 않고 같은 엔진 상태가 나간다(티켓 12)"
    );
    let answers: Vec<&Value> = of_kind(&record, "update")
        .into_iter()
        .filter(|line| line["payload"]["update"]["sessionUpdate"] == "agent_message_chunk")
        .collect();
    assert!(answers.is_empty(), "미로그인 오류의 <synthetic> 글은 답으로 옮기지 않는다(실측 함정 33): {answers:?}");
    assert_eq!(
        host.send("cart", &conversation.id, "한 번 더."),
        Err(HostError::LoginRequired { agent: Agent::Claude, conversation: conversation.id.clone() }),
        "로그인을 기다리는 동안의 말은 로그인 필요로 거절된다"
    );

    // 터미널에서 로그인하고 「다시 확인」을 눌렀다 — 같은 세션을 --resume으로 다시 띄운다(티켓 10의 길).
    assert!(matches!(host.check_engine(Agent::Claude, true), Ok(EngineCheck::Found { logged_in: true, .. })));
    let launches = launch_args(&sandbox);
    assert_eq!(launches.len(), 2, "떠 있던 claude를 끄고 새로 띄웠다 — 새 로그인을 읽는다는 보장이 없다");
    assert!(has_pair(&launches[1], "--resume", &session), "{:?}", launches[1]);
    assert_eq!(opened_hows(&sandbox.record("cart", &conversation.id)), ["new", "resumed"]);

    host.shut_down();
}
