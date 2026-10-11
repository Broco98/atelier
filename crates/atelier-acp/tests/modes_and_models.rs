//! L1 — 대화 호스트 ↔ 가짜 ACP 에이전트: 모드 · 모델 · 계획 · 명령 목록이 엔진에서 오고, 바꾼 값이 대화에 남는다
//! (three-axes 티켓 09 · 스토리 25 · 26 · 28 · 30 · 31 · 32 · 33 · 64 · 65 · 67).
//!
//! 시험은 호스트에 명령을 넣고, 나오는 이벤트 · `agents/` 파일 · 데이터 루트의 엔진 목록 파일 · 가짜가 남긴 영수증만 본다.
//! 가짜의 목록은 codex-acp 2.2.2 실측(`codex-acp-2.2.2-session-new-codex0.160.1.json`)을 줄인 것이다.

mod common;

use atelier_acp::Agent;
use common::{of_kind, payloads_of, Sandbox};
use serde_json::{json, Value};

/// 실측의 모드 넷(three-axes 결정 27) — 이름 · 설명 · 차례 그대로, 기본값은 `agent`.
fn codex_modes() -> Value {
    json!({
        "availableModes": [
            {"id": "read-only", "name": "Read-only", "description": "Requires approval to edit files and access the internet."},
            {"id": "workspace-write", "name": "Workspace access",
             "description": "Edit workspace files; ask before writing outside the workspace or accessing the network."},
            {"id": "agent", "name": "Auto review", "description": "Only ask for actions detected as potentially unsafe"},
            {"id": "agent-full-access", "name": "Full access",
             "description": "Unrestricted access to the internet and any file on your computer"}
        ],
        "currentModeId": "agent"
    })
}

/// 실측의 configOptions 다섯 — 모델 목록과 생각 깊이는 앞의 몇 개로 줄였다. 「계획」은 `collaboration_mode`다(three-axes 결정 29).
fn codex_config_options() -> Value {
    json!([
        {"id": "mode", "name": "Mode", "description": "Approval and sandboxing preset for the session", "category": "mode",
         "type": "select", "currentValue": "agent", "options": [
            {"value": "read-only", "name": "Read-only", "description": "Requires approval to edit files and access the internet."},
            {"value": "workspace-write", "name": "Workspace access",
             "description": "Edit workspace files; ask before writing outside the workspace or accessing the network."},
            {"value": "agent", "name": "Auto review", "description": "Only ask for actions detected as potentially unsafe"},
            {"value": "agent-full-access", "name": "Full access",
             "description": "Unrestricted access to the internet and any file on your computer"}]},
        {"id": "collaboration_mode", "name": "Collaboration mode", "description": "How Codex collaborates for subsequent turns",
         "category": "collaboration_mode", "type": "select", "currentValue": "default", "options": [
            {"value": "default", "name": "Default"},
            {"value": "plan", "name": "Plan", "description": "Plan before making changes"}]},
        {"id": "model", "name": "Model", "description": "Model Codex uses for the session", "category": "model",
         "type": "select", "currentValue": "gpt-6.1-sol", "options": [
            {"value": "gpt-6.1-sol", "name": "6.1 Sol", "description": "Latest workhorse model for coding and everyday work."},
            {"value": "gpt-6-astra", "name": "6 Astra", "description": "Frontier intelligence for the most demanding work."}]},
        {"id": "reasoning_effort", "name": "Reasoning effort", "description": "How much reasoning effort the model should use",
         "category": "thought_level", "type": "select", "currentValue": "low", "options": [
            {"value": "low", "name": "Low", "description": "Fast responses with lighter reasoning"},
            {"value": "medium", "name": "Medium", "description": "Balances speed and reasoning depth for everyday tasks"},
            {"value": "high", "name": "High", "description": "Greater reasoning depth for complex problems"}]},
        {"id": "fast-mode", "name": "Fast mode", "description": "1.5x speed, increased usage", "category": "model_config",
         "type": "select", "currentValue": "off", "options": [
            {"value": "off", "name": "Off", "description": "Default speed, normal usage"},
            {"value": "on", "name": "On", "description": "1.5x speed, increased usage"}]}
    ])
}

/// 기록의 `session` 열림 줄의 payload.
fn opened(record: &[Value]) -> Value {
    of_kind(record, "session")
        .into_iter()
        .find(|line| line["payload"]["state"] == "opened")
        .expect("열림 줄")["payload"]
        .clone()
}

#[test]
fn modes_and_models_열림_줄에_모드_넷과_config_options가_원문대로_있다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.codex_login_shell("modes-and-models", &[]));

    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let opened = opened(&sandbox.record("cart", &conversation.id));
    assert_eq!(opened["modes"], codex_modes(), "모드 넷이 이름 · 설명 · 차례 그대로다");
    assert_eq!(opened["configOptions"], codex_config_options(), "configOptions가 원문 그대로다 — 모델 · 계획 칩의 원천");
    assert_eq!(opened["models"]["currentModelId"], json!("gpt-6.1-sol[low]"));

    host.shut_down();
}

/// 사람이 손으로 쓴 설정 파일 — 대화 쪽 기본값이 든 꼴. 호스트는 이것을 쓰지 않는다(스토리 31 · 32). 기본값은 Claude 몫만
/// 든다 — Codex 몫이 있으면 새 대화가 그 값으로 열려(티켓 25) 아래 바꾸기 영수증 앞에 그 `set_*`가 선다.
const SETTINGS: &str = "{\n  \"terminal\": {\"fontSize\": 13},\n  \"chat\": {\"defaultAgent\": \"codex\", \"claude\": {\"model\": \"sonnet\", \"mode\": \"plan\"}}\n}\n";

#[test]
fn 모델_모드_계획을_바꾸면_가짜가_set_config_option과_set_mode를_받고_agents_json과_config_줄에_남고_설정_파일은_그대로다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let settings = sandbox.data_root().join("settings.json");
    std::fs::write(&settings, SETTINGS).unwrap();
    let host = sandbox.host(sandbox.codex_login_shell("modes-and-models", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);

    let changed = host.set_model("cart", &conversation.id, "gpt-6-astra").expect("모델 바꾸기");
    assert_eq!(changed.model.as_deref(), Some("gpt-6-astra"), "답은 바뀐 대화다 — 칩이 곧바로 그 값으로 선다");
    host.set_mode("cart", &conversation.id, "read-only").expect("모드 바꾸기");
    let changed = host.set_plan("cart", &conversation.id, true).expect("계획 켜기");
    assert_eq!(
        (changed.model.as_deref(), changed.mode.as_deref(), changed.plan),
        (Some("gpt-6-astra"), Some("read-only"), Some(true))
    );

    assert_eq!(
        sandbox.acp_config(&session_id),
        [
            json!({"method": "session/set_config_option",
                   "params": {"sessionId": session_id, "configId": "model", "value": "gpt-6-astra"}}),
            json!({"method": "session/set_mode", "params": {"sessionId": session_id, "modeId": "read-only"}}),
            json!({"method": "session/set_config_option",
                   "params": {"sessionId": session_id, "configId": "collaboration_mode", "value": "plan"}}),
        ],
        "모델 → set_config_option{{model}}, 모드 → set_mode, 계획 → set_config_option{{collaboration_mode}}(three-axes 결정 29)"
    );
    let row = sandbox.agents_row("cart", &conversation.id);
    assert_eq!((row["model"].clone(), row["mode"].clone(), row["plan"].clone()), (json!("gpt-6-astra"), json!("read-only"), json!(true)));
    let record = sandbox.record("cart", &conversation.id);
    let configs = payloads_of(&record, "config");
    assert_eq!(
        configs,
        [json!({"model": "gpt-6-astra"}), json!({"mode": "read-only"}), json!({"plan": true})],
        "사람이 바꾼 것은 바꾼 칸과 새 값으로 config 줄에 적힌다"
    );
    let listed = host.list_conversations("cart").expect("대화 목록");
    assert_eq!((listed[0].model.as_deref(), listed[0].mode.as_deref(), listed[0].plan), (Some("gpt-6-astra"), Some("read-only"), Some(true)));
    assert_eq!(std::fs::read_to_string(&settings).unwrap(), SETTINGS, "설정 파일의 기본값은 그대로다 — 값은 그 대화의 것이다");

    // 다음 턴부터 든다 — 바꾸기는 다음 말보다 먼저 엔진에 닿았다.
    host.send("cart", &conversation.id, "다음 말").expect("보내기");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    assert_eq!(
        sandbox.acp_inbox(&session_id),
        ["session/set_config_option", "session/set_mode", "session/set_config_option", "session/prompt"]
    );

    host.shut_down();
}

/// 가짜 ACP 에이전트가 세션을 열 때마다 남긴 영수증의 수 — 띄운 프로세스의 수다.
fn sessions_opened(sandbox: &Sandbox) -> usize {
    sandbox.acp_receipt_names().iter().filter(|name| name.ends_with(".json")).count()
}

#[test]
fn 띄우지_않은_대화에서_바꾸면_agents_json에만_남고_프로세스가_뜨지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("modes-and-models", &[]);
    let first = sandbox.host(shell.clone());
    let conversation = first.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    first.shut_down();
    let record_before = sandbox.record("cart", &conversation.id);

    // 앱을 다시 켠 것 — 대화는 목록에 서지만 에이전트는 떠 있지 않다(three-axes 결정 19).
    let host = sandbox.host(shell);
    host.set_model("cart", &conversation.id, "gpt-6-astra").expect("모델 바꾸기");
    host.set_mode("cart", &conversation.id, "workspace-write").expect("모드 바꾸기");
    let changed = host.set_plan("cart", &conversation.id, false).expect("계획 끄기");

    assert_eq!(
        (changed.model.as_deref(), changed.mode.as_deref(), changed.plan),
        (Some("gpt-6-astra"), Some("workspace-write"), Some(false))
    );
    let row = sandbox.agents_row("cart", &conversation.id);
    assert_eq!(
        (row["model"].clone(), row["mode"].clone(), row["plan"].clone()),
        (json!("gpt-6-astra"), json!("workspace-write"), json!(false)),
        "agents.json에 남는다 — 띄울 때 넣는다(10)"
    );
    assert_eq!(sandbox.record("cart", &conversation.id), record_before, "기록에는 아무것도 더해지지 않는다 — 엔진에 넣은 것이 없다");
    assert_eq!(sessions_opened(&sandbox), 1, "프로세스가 뜨지 않는다 — 세션은 처음 하나뿐이다");
    assert!(sandbox.acp_config(&session_id).is_empty(), "꺼진 옛 에이전트에도 간 것이 없다");

    host.shut_down();
}

#[test]
fn 엔진이_거절한_바꾸기는_읽히는_오류이고_아무것도_남지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // `normal`은 모드 · 설정 바꾸기를 모르는 메서드로 거절한다.
    let host = sandbox.host(sandbox.codex_login_shell("normal", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let record_before = sandbox.record("cart", &conversation.id);

    let refused = host.set_mode("cart", &conversation.id, "read-only").expect_err("거절된다");

    assert!(matches!(refused, atelier_acp::HostError::Setting(_)), "{refused:?}");
    assert!(refused.to_string().contains("session/set_mode"), "까닭에 무엇이 거절됐는지가 실린다: {refused}");
    assert_eq!(sandbox.agents_row("cart", &conversation.id)["mode"], Value::Null, "엔진에 들지 않은 값은 남기지 않는다 — 칩이 거짓말하지 않는다");
    assert_eq!(sandbox.record("cart", &conversation.id), record_before, "config 줄도 없다");

    host.shut_down();
}

#[test]
fn 닫은_대화나_없는_대화는_바꾸지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.codex_login_shell("modes-and-models", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    host.close_conversation("cart", &conversation.id).expect("닫기");

    assert_eq!(
        host.set_model("cart", &conversation.id, "gpt-6-astra"),
        Err(atelier_acp::HostError::ConversationNotFound(conversation.id.clone()))
    );
    assert_eq!(sandbox.agents_row("cart", &conversation.id)["model"], Value::Null);
    assert_eq!(
        host.set_plan("cart", "no-such-conversation", true),
        Err(atelier_acp::HostError::ConversationNotFound("no-such-conversation".into()))
    );
    assert_eq!(host.set_mode("gone", &conversation.id, "agent"), Err(atelier_acp::HostError::WorkNotFound("gone".into())));

    host.shut_down();
}

/// 기록의 `update` 줄 가운데 그 kind(`sessionUpdate`)의 것들의 update 원문.
fn updates_of<'a>(record: &'a [Value], kind: &str) -> Vec<&'a Value> {
    of_kind(record, "update")
        .into_iter()
        .map(|line| &line["payload"]["update"])
        .filter(|update| update["sessionUpdate"] == kind)
        .collect()
}

/// 기록의 줄마다 kind — update면 그 `sessionUpdate`, session이면 그 `state`로 적는다.
fn shape(record: &[Value]) -> Vec<String> {
    record
        .iter()
        .map(|line| match line["kind"].as_str().unwrap() {
            "update" => line["payload"]["update"]["sessionUpdate"].as_str().unwrap().to_owned(),
            "session" => format!("session:{}", line["payload"]["state"].as_str().unwrap()),
            "permission" => format!("permission:{}", line["payload"]["state"].as_str().unwrap()),
            kind => kind.to_owned(),
        })
        .collect()
}

#[test]
fn commands_명령_목록이_열림_줄_뒤와_턴_뒤에_update_줄로_원문_그대로_적힌다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.codex_login_shell("commands", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);

    let record = sandbox.wait_record("cart", &conversation.id, |record| !updates_of(record, "available_commands_update").is_empty());
    assert_eq!(shape(&record), ["session:spawning", "session:opened", "available_commands_update"], "명령 목록은 열림 줄 뒤에 선다");
    let line = &of_kind(&record, "update")[0]["payload"];
    assert_eq!(line["sessionId"], json!(session_id), "update 줄은 session/update params 원문이다");
    let commands = &line["update"]["availableCommands"];
    assert_eq!(commands[0], json!({"name": "plan", "description": "Turn plan mode on.", "input": null}));
    assert_eq!(
        commands[1],
        json!({"name": "mcp", "description": "Show the status of the MCP servers, or reconnect them.", "input": {"hint": "[reconnect]"}}),
        "이름 · 설명 · 인자 힌트가 원문 그대로다 — 「/」 메뉴의 원천"
    );

    host.send("cart", &conversation.id, "말").expect("보내기");
    let record = sandbox.wait_record("cart", &conversation.id, |record| updates_of(record, "available_commands_update").len() == 2);
    assert_eq!(shape(&record).last().map(String::as_str), Some("available_commands_update"), "턴 끝 뒤에 다시 온 목록도 적힌다");

    host.shut_down();
}

#[test]
fn plan_mode_plan_update_넷은_update_줄로_switch_mode_요청은_permission_줄로_적힌다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.codex_login_shell("plan-mode", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.set_plan("cart", &conversation.id, true).expect("계획 켜기");
    host.send("cart", &conversation.id, "계획만 짜 줘").expect("보내기");

    let record = sandbox.wait_kind("cart", &conversation.id, "permission", 1);
    let plans: Vec<Value> = updates_of(&record, "plan_update").into_iter().map(|update| update["plan"].clone()).collect();
    assert_eq!(plans.len(), 4, "plan_update 넷이 다 update 줄이다:\n{}", common::lines_text(&record));
    assert_eq!(
        plans[3],
        json!({"type": "markdown", "planId": "fake-plan-1-plan",
               "content": "## Add `hello.txt`\n\n1. Create a repo-root file named `hello.txt` containing `hi`.\n2. Verify the file contains exactly `hi`.\n"}),
        "계획은 마크다운 전문이 원문 그대로 온다(three-axes 결정 29)"
    );
    let asked = &of_kind(&record, "permission")[0]["payload"];
    assert_eq!(asked["state"], json!("asked"));
    assert_eq!(asked["request"]["toolCall"]["kind"], json!("switch_mode"), "「이 계획대로 할까요?」는 권한 요청의 길(08)로 선다");
    assert_eq!(asked["request"]["toolCall"]["rawInput"]["plan"], plans[3]["content"]);
    assert_eq!(
        asked["request"]["options"],
        json!([
            {"optionId": "implement_plan", "name": "Yes, implement this plan", "kind": "allow_once"},
            {"optionId": "revise_plan", "name": "No, and tell Codex what to do differently", "kind": "reject_once"}
        ])
    );

    host.answer_permission("cart", &conversation.id, "0", "revise_plan").expect("다시 짜기");
    // 턴 끝 뒤에 명령 목록이 다시 온다(실측 plan-mode 46줄) — 그것까지 기다린다.
    let record = sandbox.wait_record("cart", &conversation.id, |record| updates_of(record, "available_commands_update").len() == 2);
    let after_asked: Vec<String> = shape(&record).into_iter().skip_while(|kind| kind != "permission:asked").collect();
    assert_eq!(after_asked, ["permission:asked", "permission:answered", "tool_call_update", "turn-end", "available_commands_update"]);
    assert_eq!(
        sandbox.acp_responses(&session_id),
        [json!({"jsonrpc": "2.0", "id": 0, "result": {"outcome": {"outcome": "selected", "optionId": "revise_plan"}}})]
    );

    host.shut_down();
}

#[test]
fn 세션이_열리면_엔진_목록_파일이_덮어_쓰이고_엔진_목록이_그것을_주고_연_적_없는_엔진은_빈_목록이다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.codex_login_shell("modes-and-models", &[]));
    let empty = atelier_acp::EngineLists::default();
    assert_eq!(host.engine_lists(Agent::Codex), empty, "세션을 연 적 없는 엔진은 빈 목록이다 — 설정은 「엔진 기본값」만 보인다");
    assert_eq!(serde_json::to_value(&empty).unwrap(), json!({"models": [], "modes": []}), "화면이 읽는 꼴");

    // 지난번에 본 목록(낡은 Codex 몫)과 다른 엔진의 몫이 이미 있다.
    let file = sandbox.data_root().join("engines.json");
    let claude = json!({"models": [{"value": "sonnet", "name": "Sonnet"}], "modes": [{"id": "plan", "name": "Plan"}]});
    std::fs::write(&file, json!({"codex": {"models": [{"value": "old", "name": "Old"}], "modes": []}, "claude": claude}).to_string())
        .unwrap();

    host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let codex = host.engine_lists(Agent::Codex);
    assert_eq!(
        serde_json::to_value(&codex).unwrap(),
        json!({
            "models": codex_config_options()[2]["options"],
            "modes": codex_modes()["availableModes"],
        }),
        "그 엔진의 몫이 이번 세션의 목록으로 덮어 쓰인다 — 모델은 configOptions의 model 선택지, 모드는 modes 그대로"
    );
    assert_eq!(serde_json::to_value(host.engine_lists(Agent::Claude)).unwrap(), claude, "다른 엔진의 몫은 그대로다");
    let written: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(written["codex"], serde_json::to_value(&codex).unwrap(), "목록은 데이터 루트의 엔진 목록 파일에 산다");

    // 앱을 다시 켜도(에이전트를 띄우지 않고) 목록이 선다.
    host.shut_down();
    assert_eq!(sandbox.host(sandbox_shell_unused()).engine_lists(Agent::Codex), codex);
}

/// 엔진 목록만 읽는 호스트의 셸 — 띄우지 않으므로 아무 셸이어도 된다.
fn sandbox_shell_unused() -> atelier_acp::ShellSource {
    atelier_acp::ShellSource::Path("/usr/bin/false".into())
}

/// S26 — 「Codex 계획」(codex-acp 2.2.2 모양의 열림 줄 · 명령 목록 · 「계획」을 켠 config 줄 · 계획 넷 · 「이 계획대로 할까요?」 ·
/// 다시 짜기)의 결과 기록이 검사 자료로 서고, 매번 다시 지은 기록이 그것과 같다. 대화창의 L3 목업 백엔드가 이 파일을 그대로
/// 쏜다 — 19는 열림 줄과 명령 목록으로 칩 · 「/」 메뉴를, 21은 계획 카드와 승인 카드를 잰다.
///
/// 줄 순서를 고정하려고 단계마다 앞 줄이 적힌 것을 본 뒤 다음 명령을 넣는다 — 열림 뒤의 명령 목록을 본 뒤 계획을 켜고,
/// 물음을 본 뒤 답하고, 턴 끝 뒤에 다시 온 명령 목록까지 기다린다.
#[test]
fn codex_계획의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 진짜 codex-acp처럼 로그인된 계정을 알린다(실측 plan-mode 3줄) — 자료에도 가린 꼴로 선다.
    let shell = sandbox.codex_login_shell("plan-mode", &[("FAKE_ACP_ACCOUNT_EMAIL", "someone@example.com")]);
    let host = sandbox.host(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    sandbox.wait_record("cart", &conversation.id, |record| !updates_of(record, "available_commands_update").is_empty());
    host.set_plan("cart", &conversation.id, true).expect("계획 켜기");
    host.send("cart", &conversation.id, "계획만 세워 줘 — hello.txt에 hi를 담아 저장소에 더하려면? 두 단계로 짧게.").expect("보내기");
    sandbox.wait_kind("cart", &conversation.id, "permission", 1);
    host.answer_permission("cart", &conversation.id, "0", "revise_plan").expect("다시 짜기");
    let record = sandbox.wait_record("cart", &conversation.id, |record| updates_of(record, "available_commands_update").len() == 2);
    host.shut_down();
    let session_id = sandbox.agent_session_id("cart", &conversation.id);

    let fixed = common::fix_record(&record, &sandbox.data_root(), &session_id);
    assert_eq!(
        shape(&fixed),
        [
            "session:spawning", "session:auth-status", "session:opened", "available_commands_update", "config", "sent",
            "agent_message_chunk", "plan_update", "plan_update", "plan_update", "plan_update", "permission:asked",
            "permission:answered", "tool_call_update", "turn-end", "available_commands_update",
        ],
        "자료의 줄 차례"
    );
    common::assert_record("codex-plan", &fixed);
}
