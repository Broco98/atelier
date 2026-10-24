//! L1 — 설정 「대화」의 기본값으로 새 대화를 연다(three-axes 티켓 25 · 결정 16 · 스토리 111 · 112 · 113).
//!
//! 시험은 데이터 루트의 `settings.json`을 손으로 쓰고 호스트에 새 대화를 넣은 뒤, 가짜가 남긴 영수증(Codex가 받은 바꾸기 ·
//! claude가 받은 인자)과 `agents/` 파일만 본다. 호스트는 설정 파일을 읽기만 한다.

mod common;

use atelier_acp::Agent;
use common::{has_pair, Sandbox};
use serde_json::json;

/// 데이터 루트의 설정 파일에 이 글을 쓴다 — 사람이 손으로 쓴 것과 같다.
fn write_settings(sandbox: &Sandbox, text: &str) {
    std::fs::write(sandbox.data_root().join("settings.json"), text).unwrap();
}

#[test]
fn 설정에_codex_기본_모델과_모드가_있으면_새_대화가_그_값으로_열리고_가짜가_set_config_option과_set_mode를_받는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let settings = r#"{"terminal": {}, "chat": {"defaultAgent": "codex", "codex": {"model": "gpt-6-astra", "mode": "workspace-write"}, "자리": 1}}"#;
    write_settings(&sandbox, settings);
    let host = sandbox.host(sandbox.codex_login_shell("modes-and-models", &[]));

    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    assert_eq!(
        sandbox.acp_config(&session_id),
        [
            json!({"method": "session/set_config_option",
                   "params": {"sessionId": session_id, "configId": "model", "value": "gpt-6-astra"}}),
            json!({"method": "session/set_mode", "params": {"sessionId": session_id, "modeId": "workspace-write"}}),
        ],
        "Codex는 session/new에 모델 · 모드를 싣지 못해, 열린 뒤 첫 말 전에 set_*로 넣는다"
    );
    assert_eq!(
        (conversation.model.as_deref(), conversation.mode.as_deref()),
        (Some("gpt-6-astra"), Some("workspace-write")),
        "답은 그 값으로 선 대화다 — 칩이 곧바로 그 값으로 선다"
    );
    let row = sandbox.agents_row("cart", &conversation.id);
    assert_eq!((row["model"].clone(), row["mode"].clone()), (json!("gpt-6-astra"), json!("workspace-write")));
    assert_eq!(
        std::fs::read_to_string(sandbox.data_root().join("settings.json")).unwrap(),
        settings,
        "호스트는 설정 파일을 읽기만 한다 — 모르는 키까지 그대로다"
    );

    host.shut_down();
}

#[test]
fn 설정에_claude_기본_모델과_모드가_있으면_새_대화가_그_값으로_열리고_claude가_플래그를_받는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    write_settings(&sandbox, r#"{"chat": {"claude": {"model": "sonnet", "mode": "acceptEdits"}}}"#);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");

    let args = sandbox.claude_args("cart", &conversation.id);
    assert!(has_pair(&args, "--model", "sonnet"), "{args:?}");
    assert!(has_pair(&args, "--permission-mode", "acceptEdits"), "{args:?}");
    assert_eq!((conversation.model.as_deref(), conversation.mode.as_deref()), (Some("sonnet"), Some("acceptEdits")));
    let row = sandbox.agents_row("cart", &conversation.id);
    assert_eq!((row["model"].clone(), row["mode"].clone()), (json!("sonnet"), json!("acceptEdits")));

    host.shut_down();
}

/// 엔진 기본값 — 키가 없는 칸 · 다른 엔진의 칸만 있는 구획 · 글자가 아닌 값 · 빈 글자 · 깨진 파일이 모두 같은 뜻이다.
const ENGINE_DEFAULTS: [&str; 5] = [
    r#"{"terminal": {"fontSize": 13}}"#,
    r#"{"chat": {"defaultAgent": "codex"}}"#,
    r#"{"chat": {"claude": {"model": "sonnet"}}}"#,
    r#"{"chat": {"codex": {"model": 7, "mode": ""}}}"#,
    r#"{"chat": {"codex": {"model": "gpt-6-astra""#,
];

#[test]
fn 설정이_엔진_기본값이면_codex는_set을_받지_않는다() {
    for settings in ENGINE_DEFAULTS {
        let sandbox = Sandbox::new();
        sandbox.work("cart", &[]);
        write_settings(&sandbox, settings);
        let host = sandbox.host(sandbox.codex_login_shell("modes-and-models", &[]));

        let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

        let session_id = sandbox.agent_session_id("cart", &conversation.id);
        assert!(sandbox.acp_config(&session_id).is_empty(), "set_*를 부르지 않는다: {settings}");
        assert_eq!((conversation.model.as_deref(), conversation.mode.as_deref()), (None, None), "{settings}");
        let row = sandbox.agents_row("cart", &conversation.id);
        assert_eq!((row["model"].clone(), row["mode"].clone()), (json!(null), json!(null)), "{settings}");
        host.shut_down();
    }
}

#[test]
fn 설정이_엔진_기본값이면_claude는_모델_모드_플래그를_받지_않는다() {
    let settings = [r#"{"chat": {"codex": {"model": "gpt-6-astra", "mode": "read-only"}}}"#, r#"{"chat": {"claude": {"mode": null}}}"#, "{"];
    for settings in settings {
        let sandbox = Sandbox::new();
        sandbox.work("cart", &[]);
        write_settings(&sandbox, settings);
        let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

        let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");

        let args = sandbox.claude_args("cart", &conversation.id);
        assert!(
            !args.iter().any(|arg| arg == "--model" || arg == "--permission-mode"),
            "사용자의 모델 · defaultMode를 물려받는다({settings}): {args:?}"
        );
        host.shut_down();
    }
}

#[test]
fn 설정을_바꿔도_이미_열린_대화의_agents_json과_엔진은_그대로이고_다음_새_대화부터_든다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    write_settings(&sandbox, r#"{"chat": {"codex": {"model": "gpt-6.1-sol", "mode": "read-only"}}}"#);
    let host = sandbox.host(sandbox.codex_login_shell("modes-and-models", &[]));
    let open = host.new_conversation("cart", Agent::Codex).expect("먼저 연 대화");
    let open_session = sandbox.agent_session_id("cart", &open.id);
    let open_row = sandbox.agents_row("cart", &open.id);
    let open_config = sandbox.acp_config(&open_session);

    // 설정 화면에서 바꿔 저장한 것 — 모델은 다른 값으로, 모드는 엔진 기본값으로.
    write_settings(&sandbox, r#"{"chat": {"codex": {"model": "gpt-6-astra"}}}"#);
    let next = host.new_conversation("cart", Agent::Codex).expect("다음 새 대화");

    assert_eq!(sandbox.agents_row("cart", &open.id), open_row, "열린 대화의 agents.json 줄은 그대로다");
    assert_eq!((open_row["model"].clone(), open_row["mode"].clone()), (json!("gpt-6.1-sol"), json!("read-only")));
    assert_eq!(sandbox.acp_config(&open_session), open_config, "열린 대화의 엔진에는 아무것도 더 가지 않는다");
    let listed = host.list_conversations("cart").expect("대화 목록");
    let first = listed.iter().find(|one| one.id == open.id).expect("먼저 연 대화");
    assert_eq!((first.model.as_deref(), first.mode.as_deref()), (Some("gpt-6.1-sol"), Some("read-only")));

    let next_session = sandbox.agent_session_id("cart", &next.id);
    assert_eq!(
        sandbox.acp_config(&next_session),
        [json!({"method": "session/set_config_option",
                "params": {"sessionId": next_session, "configId": "model", "value": "gpt-6-astra"}})],
        "다음 새 대화는 바꾼 값으로 연다 — 엔진 기본값인 모드는 넣지 않는다"
    );
    assert_eq!((next.model.as_deref(), next.mode.as_deref()), (Some("gpt-6-astra"), None));

    host.shut_down();
}
