//! L1 — 대화 호스트 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude(임시 PATH의 `claude`, 판 02 실측 2.1.296): `+`를 누르면
//! 변환기가 `claude -p` 하나를 쥐고 ACP 세션을 연다(three-axes 티켓 13 · 스토리 4 · 23 · 24 · 25 · 28 · 29 · 33 · 35 ·
//! 109 · 122).
//!
//! 시험은 호스트에 명령을 넣고, 나오는 `agents/` 파일과 가짜 claude가 남긴 영수증(받은 인자 · env · stdin 줄 · 시그널)만
//! 본다.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

use atelier_acp::{Agent, ConversationDefaults, HostError, TranslatorCommand};
use common::{assert_all_gone, has_pair, Sandbox};

#[test]
fn claude_새_대화는_늘_주는_플래그와_새_세션_id로_claude를_띄우고_주지_않는_플래그는_없다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    // 앱이 물려받은 env에 할 일 도구 옵트인이 있어도 claude에게 가지 않는다(three-axes 결정 29).
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("CLAUDE_CODE_ENABLE_TODO_TOOLS", "1")]));

    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");

    assert_eq!((conversation.agent, conversation.name.as_str()), (Agent::Claude, "Claude"));
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    assert!(uuid::Uuid::parse_str(&session_id).is_ok(), "새 대화의 세션 id는 변환기가 지은 UUID다: {session_id}");
    let receipt = sandbox.claude_receipt(&session_id);
    let args = common::receipt_args(&receipt);
    assert!(args.contains(&"-p".to_owned()) && args.contains(&"--verbose".to_owned()), "{args:?}");
    assert!(has_pair(&args, "--input-format", "stream-json"), "{args:?}");
    assert!(has_pair(&args, "--output-format", "stream-json"), "{args:?}");
    assert!(has_pair(&args, "--permission-prompt-tool", "stdio"), "{args:?}");
    assert!(has_pair(&args, "--session-id", &session_id), "{args:?}");
    for absent in ["--strict-mcp-config", "--mcp-config", "--allowedTools", "--settings"] {
        assert!(!args.iter().any(|arg| arg == absent), "{absent}를 주지 않는다 — 사용자 MCP와 커넥터는 claude가 스스로 붙인다: {args:?}");
    }
    assert_eq!(args.len(), 10, "늘 주는 것과 세션 id 말고는 없다(엔진 기본값 대화 · 함께 여는 폴더 없음): {args:?}");

    let cwd = std::path::PathBuf::from(receipt["cwd"].as_str().expect("cwd"));
    assert_eq!(cwd.canonicalize().unwrap(), work.join("spec").canonicalize().unwrap(), "프로젝트가 없으면 spec 폴더에서 일한다");
    assert!(receipt["env"].get("CLAUDE_CODE_ENABLE_TODO_TOOLS").is_none(), "할 일 도구를 켜지 않는다");

    host.shut_down();
}

#[test]
fn 모드와_모델이_있는_대화는_플래그로_주고_엔진_기본값_대화는_주지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

    let chosen = host
        .new_conversation_with(
            "cart",
            Agent::Claude,
            ConversationDefaults { model: Some("sonnet".into()), mode: Some("plan".into()) },
        )
        .expect("값이 있는 대화");
    let default = host.new_conversation("cart", Agent::Claude).expect("엔진 기본값 대화");

    let chosen_args = common::receipt_args(&sandbox.claude_receipt(&sandbox.agent_session_id("cart", &chosen.id)));
    assert!(has_pair(&chosen_args, "--permission-mode", "plan"), "{chosen_args:?}");
    assert!(has_pair(&chosen_args, "--model", "sonnet"), "{chosen_args:?}");
    let row = sandbox.agents_row("cart", &chosen.id);
    assert_eq!((row["model"].as_str(), row["mode"].as_str()), (Some("sonnet"), Some("plan")), "대화의 값은 그 대화에 남는다");
    assert_eq!((chosen.model.as_deref(), chosen.mode.as_deref()), (Some("sonnet"), Some("plan")));

    let default_args = common::receipt_args(&sandbox.claude_receipt(&sandbox.agent_session_id("cart", &default.id)));
    assert!(
        !default_args.iter().any(|arg| arg == "--permission-mode" || arg == "--model"),
        "엔진 기본값이면 사용자의 defaultMode · 모델을 물려받는다: {default_args:?}"
    );

    host.shut_down();
}

#[test]
fn 함께_여는_폴더가_있는_work에서는_add_dir로_spec_폴더를_주고_워크트리에서_일한다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &["atelier"]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");

    let receipt = sandbox.claude_receipt(&sandbox.agent_session_id("cart", &conversation.id));
    let args = common::receipt_args(&receipt);
    let spec = work.join("spec");
    assert!(has_pair(&args, "--add-dir", spec.to_str().unwrap()), "{args:?}");
    let cwd = std::path::PathBuf::from(receipt["cwd"].as_str().expect("cwd"));
    assert_eq!(cwd.canonicalize().unwrap(), work.join("trees/atelier").canonicalize().unwrap(), "프로젝트가 하나면 그 워크트리에서 일한다");

    host.shut_down();
}

/// 판 02 실측 2.1.296의 `initialize` 응답 원문 — 가짜 claude가 되감는 것과 같은 파일이다.
fn recorded_initialize() -> serde_json::Value {
    let text = include_str!("fixtures/claude-2.1.296/initialize.json");
    serde_json::from_str::<serde_json::Value>(text).expect("initialize 원문")["response"]["response"].clone()
}

#[test]
fn 열림_줄에_claude의_모델_목록이_configoptions_model로_서고_모드는_다섯이고_명령_목록에_설명이_실린다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");

    let record = sandbox.wait_record("cart", &conversation.id, |record| {
        record.iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "available_commands_update")
    });
    let opened = record
        .iter()
        .find(|line| line["kind"] == "session" && line["payload"]["state"] == "opened")
        .expect("열림 줄");
    let payload = &opened["payload"];
    assert_eq!(payload["agentVersion"], serde_json::json!(env!("CARGO_PKG_VERSION")), "변환기의 판은 앱의 판이다");

    // 모델 — codex-acp와 같은 모양(S1): configOptions의 id `model`, 값은 2.1.296의 `models[].value` 13개 그대로.
    let model = payload["configOptions"]
        .as_array()
        .expect("configOptions")
        .iter()
        .find(|option| option["id"] == "model")
        .expect("configOptions.model");
    assert_eq!((model["type"].as_str(), model["currentValue"].as_str()), (Some("select"), Some("default")));
    let values: Vec<&str> = model["options"].as_array().unwrap().iter().map(|o| o["value"].as_str().unwrap()).collect();
    assert_eq!(
        values,
        [
            "default", "opus", "fable", "sonnet", "haiku", "claude-haiku-4-5-20251001", "claude-sonnet-5",
            "claude-opus-5", "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
        ]
    );
    let opus = model["options"].as_array().unwrap().iter().find(|o| o["value"] == "opus").unwrap();
    assert_eq!(opus["name"], "Opus 5.5", "이름은 claude의 displayName이다");

    // 모드 — claude의 이름 그대로 다섯. bypassPermissions는 띄울 때 허락하지 않았으면 고를 수 없어 없다.
    let modes: Vec<&str> =
        payload["modes"]["availableModes"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(modes, ["default", "acceptEdits", "auto", "dontAsk", "plan"]);
    assert_eq!(payload["modes"]["currentModeId"], "auto", "지금 모드는 claude의 current_permission_mode다");

    // 명령 — 이름 · 설명 · 인자 힌트. 별칭은 찾기 말로 `_meta`에 실린다.
    let commands = record
        .iter()
        .find(|line| line["payload"]["update"]["sessionUpdate"] == "available_commands_update")
        .unwrap()["payload"]["update"]["availableCommands"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(commands.len(), recorded_initialize()["commands"].as_array().unwrap().len(), "claude의 명령이 다 온다");
    let handoff = commands.iter().find(|c| c["name"] == "claude-handoff").expect("사용자 스킬");
    assert_eq!(
        handoff["description"],
        "Hand the current conversation off to a fresh background agent that picks up the work immediately. (user)"
    );
    assert_eq!(handoff["input"]["hint"], "What will the next session be used for?");
    let ask = commands.iter().find(|c| c["name"] == "ask-matt").unwrap();
    assert!(ask["input"].is_null(), "인자 힌트가 없으면 input은 null이다(codex-acp와 같은 모양)");
    let creator = commands.iter().find(|c| c["name"] == "skill-creator:skill-creator").unwrap();
    assert_eq!(creator["_meta"]["aliases"], serde_json::json!(["skill-creator"]));

    // 순서 — 열림이 명령 목록보다 앞에 선다(화면은 열림 줄로 칩을 짓고, 그 뒤 메뉴를 채운다).
    let seq_of = |pick: &dyn Fn(&serde_json::Value) -> bool| record.iter().find(|l| pick(l)).unwrap()["seq"].as_u64();
    assert!(
        seq_of(&|l| l["payload"]["state"] == "opened")
            < seq_of(&|l| l["payload"]["update"]["sessionUpdate"] == "available_commands_update")
    );

    host.shut_down();
}

#[test]
fn 판이_다른_변환기면_세션을_열지_않고_실패하고_남은_프로세스가_없다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 판이 다른 변환기 — 가짜 ACP 에이전트가 `initialize`에 다른 판을 싣는다. 띄운 pid는 감싼 스크립트가 적는다.
    let pids = sandbox.claude_receipts().join("translator-pids");
    let wrapper = sandbox.bin("old-translator").join("acp-claude");
    std::fs::write(
        &wrapper,
        format!("#!/bin/sh\necho $$ >> '{}'\nexec '{}'\n", pids.display(), env!("CARGO_BIN_EXE_fake-acp-agent")),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let shell = sandbox.claude_login_shell("normal", &[("FAKE_ACP_VERSION", "0.17.9")]);
    let host = sandbox
        .host_builder_with_translator(shell, TranslatorCommand::new(&wrapper, Vec::<String>::new()), |_| {})
        .build();

    let failed = host.new_conversation("cart", Agent::Claude).expect_err("판이 다르면 열지 않는다");

    let HostError::Open { conversation, reason } = &failed else { panic!("열기 실패여야 한다: {failed:?}") };
    assert!(reason.contains("판 어긋남") && reason.contains("0.17.9"), "{reason}");
    let translator: Vec<u32> =
        std::fs::read_to_string(&pids).unwrap().lines().map(|line| line.trim().parse().unwrap()).collect();
    assert_eq!(translator.len(), 1);
    assert_all_gone(&translator);
    assert!(sandbox.all_claude_receipts().is_empty(), "판을 본 뒤에는 session/new를 보내지 않는다 — claude가 뜨지 않는다");
    let record = sandbox.record("cart", conversation);
    assert!(
        record.iter().any(|line| line["payload"]["state"] == "died" && line["payload"]["reason"] == serde_json::json!(reason)),
        "기록에 까닭이 남는다: {record:?}"
    );

    host.shut_down();
}

#[test]
fn claude가_initialize에_답하지_않으면_한도_뒤_열기_실패이고_남은_프로세스가_없다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (builder, _events) = sandbox.host_builder_with_events(sandbox.claude_login_shell("silent-initialize", &[]));
    let host = builder.open_limit(Duration::from_millis(800)).build();

    let started = Instant::now();
    let failed = host.new_conversation("cart", Agent::Claude).expect_err("답하지 않으면 열지 않는다");

    assert!(started.elapsed() < Duration::from_secs(5), "한도에서 끊는다: {:?}", started.elapsed());
    assert!(matches!(&failed, HostError::Open { reason, .. } if reason.contains("안에 세션을 열지 않았습니다")), "{failed:?}");
    let receipts = sandbox.all_claude_receipts();
    assert_eq!(receipts.len(), 1, "claude는 떴다");
    let claude = receipts[0]["pid"].as_u64().unwrap() as u32;
    let translator = receipts[0]["ppid"].as_u64().unwrap() as u32;
    assert_all_gone(&[translator, claude]);
    let session_id = receipts[0]["args"]
        .as_array()
        .unwrap()
        .windows(2)
        .find(|pair| pair[0] == "--session-id")
        .map(|pair| pair[1].as_str().unwrap().to_owned())
        .unwrap();
    let stdin = sandbox.claude_stdin(&session_id);
    assert_eq!(stdin.len(), 1, "띄운 직후 받은 것은 initialize 하나다: {stdin:?}");
    assert_eq!(stdin[0]["type"], "control_request");
    assert_eq!(stdin[0]["request"], serde_json::json!({"subtype": "initialize"}));

    host.shut_down();
}

#[test]
fn claude는_변환기의_프로세스_그룹_안에_있고_대화를_닫으면_후손이_0개다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.claude_login_shell("mcp-child", &[]));
    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    let receipt = sandbox.claude_receipt(&session_id);
    let (claude, translator) = (receipt["pid"].as_u64().unwrap() as u32, receipt["ppid"].as_u64().unwrap() as u32);
    let mcp_child = receipt["descendants"][0].as_u64().unwrap() as u32;
    assert_eq!(receipt["pgid"].as_u64(), Some(translator as u64), "claude는 변환기의 프로세스 그룹 안에 있다");
    assert_eq!(receipt["sid"].as_u64(), Some(translator as u64), "변환기는 새 세션의 리더이고 claude도 그 세션에 있다");
    assert!(common::is_running(mcp_child));

    host.close_conversation("cart", &conversation.id).expect("대화 닫기");

    assert_all_gone(&[translator, claude, mcp_child]);
    let events = sandbox.claude_events(&session_id);
    assert!(events.contains(&"stdin-eof".to_owned()), "변환기가 claude의 stdin을 닫았다: {events:?}");
    assert!(!events.iter().any(|event| event.starts_with("signal")), "SIGINT · SIGTERM으로 끄지 않는다: {events:?}");

    // 앱 종료(호스트 끄기)도 같다.
    let again = host.new_conversation("cart", Agent::Claude).expect("둘째 대화");
    let receipt = sandbox.claude_receipt(&sandbox.agent_session_id("cart", &again.id));
    let pids = [
        receipt["pid"].as_u64().unwrap() as u32,
        receipt["ppid"].as_u64().unwrap() as u32,
        receipt["descendants"][0].as_u64().unwrap() as u32,
    ];
    host.shut_down();
    assert_all_gone(&pids);
}

#[test]
fn 변환기의_stdin을_닫으면_claude까지_끝난다() {
    // 앱이 비정상으로 끝난 꼴 — 그룹째 끄는 호스트가 없고, 변환기의 stdin만 닫힌다. 변환기를 ACP로 직접 몬다.
    let sandbox = Sandbox::new();
    let (mut translator, mut wire) = common::spawn_translator(&sandbox, &[("FAKE_CLAUDE_SCENARIO", "mcp-child")]);
    let (_, session_id) = wire.open_session(&sandbox);
    let receipt = sandbox.claude_receipt(&session_id);
    let pids = [receipt["pid"].as_u64().unwrap() as u32, receipt["descendants"][0].as_u64().unwrap() as u32];

    drop(wire);

    let status = common::assert_translator_exits(&mut translator);
    assert!(status.success(), "변환기는 stdin EOF에 스스로 끝난다: {status}");
    assert_all_gone(&pids);
    assert!(sandbox.claude_events(&session_id).contains(&"stdin-eof".to_owned()), "claude가 stdin EOF를 받았다");
}

#[test]
fn 기록에서_claude의_계정_이메일_플랜과_플러그인_경로가_가려진다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_ACCOUNT_EMAIL", "dana@example.com")]));
    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");

    // 첫 말을 보내면 claude가 `system/init`을 낸다 — 그 원문(플러그인 경로가 든다)이 세션 정보로 기록에 실린다.
    host.send("cart", &conversation.id, "안녕").expect("보내기");
    let record = sandbox.wait_record("cart", &conversation.id, |record| {
        record.iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "session_info_update")
    });

    // `initialize`의 계정 칸(이메일 · 조직 · 플랜)은 `<email>`이다(워크플로 함정 19). 나머지는 원문 그대로다.
    let opened = record.iter().find(|line| line["payload"]["state"] == "opened").expect("열림 줄");
    let initialize = &opened["payload"]["meta"]["claudeCode"]["initialize"];
    assert_eq!(initialize["claude_code_version"], "2.1.296", "claude의 initialize 답이 열림 줄에 실린다");
    let account = initialize["account"].as_object().expect("계정 칸");
    assert!(!account.is_empty() && account.values().all(|value| value == "<email>"), "{account:?}");

    // `system/init`의 `plugins[].path`에는 조직 · 계정 id가 실린다(실측 함정 39).
    let info = record
        .iter()
        .find(|line| line["payload"]["update"]["sessionUpdate"] == "session_info_update")
        .unwrap();
    let init = &info["payload"]["update"]["_meta"]["claudeCode"]["init"];
    assert_eq!((init["type"].as_str(), init["subtype"].as_str()), (Some("system"), Some("init")));
    let plugins = init["plugins"].as_array().expect("plugins");
    assert!(!plugins.is_empty() && plugins.iter().all(|plugin| plugin["path"] == "<path>"), "{plugins:?}");
    assert!(plugins.iter().any(|plugin| plugin["name"] == "hookify"), "경로 말고는 원문 그대로다");

    let text = std::fs::read_to_string(sandbox.record_path("cart", &conversation.id)).unwrap();
    for secret in ["dana@example.com", "Claude Max", "/.claude/plugins/", "plugins/synced/"] {
        assert!(!text.contains(secret), "기록에 `{secret}`가 남았다");
    }

    host.shut_down();
}

#[test]
fn 첫_말_전에는_codex를_claude로_바꿔_옛_프로세스를_끄고_새_엔진으로_열고_첫_말_뒤에는_거절한다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.both_login_shell("spawns-a-child", "normal"));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("Codex 새 대화");
    let codex = sandbox.acp_receipt(&sandbox.agent_session_id("cart", &conversation.id));
    let mut old: Vec<u32> = vec![codex["pid"].as_u64().unwrap() as u32];
    old.extend(codex["descendants"].as_array().unwrap().iter().map(|pid| pid.as_u64().unwrap() as u32));

    let switched = host.switch_agent("cart", &conversation.id, Agent::Claude).expect("첫 말 전에는 바꾼다");

    assert_all_gone(&old);
    assert_eq!(switched.id, conversation.id, "새 대화가 아니라 같은 대화다");
    assert_eq!((switched.agent, switched.name.as_str()), (Agent::Claude, "Claude"), "이름도 에이전트를 따라간다");
    let row = sandbox.agents_row("cart", &conversation.id);
    assert_eq!((row["agent"].as_str(), row["name"].as_str()), (Some("claude"), Some("Claude")));
    let session_id = row["agentSessionId"].as_str().expect("새 엔진의 세션 id").to_owned();
    let claude = sandbox.claude_receipt(&session_id);
    assert!(has_pair(&common::receipt_args(&claude), "--session-id", &session_id), "새 엔진으로 열렸다");
    let listed = host.list_conversations("cart").expect("대화 목록");
    assert_eq!(listed.iter().map(|c| (c.id.as_str(), c.agent)).collect::<Vec<_>>(), [(conversation.id.as_str(), Agent::Claude)]);

    let record = sandbox.wait_record("cart", &conversation.id, |record| {
        record.iter().filter(|line| line["payload"]["state"] == "opened").count() == 2
    });
    let config = record.iter().find(|line| line["kind"] == "config").expect("사람이 바꾼 에이전트가 기록에 남는다");
    assert_eq!(config["payload"], serde_json::json!({"agent": "claude"}));
    let reopened = record.iter().filter(|line| line["payload"]["state"] == "opened").last().unwrap();
    assert!(config["seq"].as_u64() < reopened["seq"].as_u64());
    assert_eq!(reopened["payload"]["agentVersion"], serde_json::json!(env!("CARGO_PKG_VERSION")), "Claude 변환기로 열렸다");

    // 첫 말 뒤에는 거절하고, 돌던 에이전트는 그대로 둔다.
    host.send("cart", &conversation.id, "안녕").expect("첫 말");
    let refused = host.switch_agent("cart", &conversation.id, Agent::Codex).expect_err("첫 말 뒤에는 바꾸지 않는다");
    assert!(matches!(refused, HostError::AgentLocked(_)), "{refused:?}");
    assert_eq!(refused.to_string(), "첫 말 뒤에는 에이전트를 바꿀 수 없어요. 다른 에이전트는 +로 열어요");
    assert!(common::is_running(claude["pid"].as_u64().unwrap() as u32), "거절은 프로세스를 건드리지 않는다");
    assert_eq!(sandbox.agents_row("cart", &conversation.id)["agent"], "claude");

    host.shut_down();
}

#[test]
fn 로그인이_필요한_codex_대화를_첫_말_전에_claude로_바꾸면_로그인을_기다리지_않고_말이_간다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.both_login_shell("needs-auth", "normal"));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("로그인이 필요해도 대화는 선다");
    assert!(matches!(host.send("cart", &conversation.id, "안녕"), Err(HostError::LoginRequired { agent: Agent::Codex, .. })));

    host.switch_agent("cart", &conversation.id, Agent::Claude).expect("첫 말 전에는 바꾼다");

    host.send("cart", &conversation.id, "안녕").expect("Claude로 바꾼 대화는 Codex 로그인을 기다리지 않는다");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    common::wait_for("말이 claude의 stdin에 닿는다", || {
        sandbox.claude_stdin(&session_id).iter().any(|line| line["type"] == "user")
    });
    host.shut_down();
}
