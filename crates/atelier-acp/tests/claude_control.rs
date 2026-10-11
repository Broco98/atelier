//! L1 — 대화 호스트 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude: Claude 대화를 멈추고, 권한을 묻고, 모드 · 모델을 바꾸고,
//! 계획 승인을 받는다(three-axes 티켓 15 · 스토리 26 · 53 · 54 · 57 · 59 · 60 · 63 · 64 · 66 · 관문 G1).
//!
//! 호스트 쪽 길(멈추기 07 · 권한 08 · 바꾸기 09)은 Codex와 같다. 여기서는 변환기가 ACP 요청을 claude의 제어 요청으로,
//! claude의 요청을 ACP 모양으로 옮기는지를 본다 — 시험은 호스트에 명령을 넣고, `agents/` 기록과 가짜 claude의 영수증(받은
//! stdin 줄 · 받은 시그널 · 띄운 프로세스)만 본다.
//!
//! 가짜 claude는 진짜 claude가 낸 원문을 되감는다 — 워크플로 실측 2.1.282 `interrupt-sigint` · `permission-stdio`, 판 02 실측
//! 2.1.296 `set-model` · `set-permission-mode`, 판 02 관문 G1 `g1-plan-implement` · `g1-plan-revise`.

mod common;

use common::{of_kind, payloads_of, Sandbox};
use serde_json::{json, Value};

/// 기록의 update 줄들의 `update` 칸.
fn updates(record: &[Value]) -> Vec<Value> {
    of_kind(record, "update").iter().map(|line| line["payload"]["update"].clone()).collect()
}

/// 기록에 그 도구 이름의 `tool_call`이 섰나.
fn has_tool_call(record: &[Value], tool_name: &str) -> bool {
    updates(record)
        .iter()
        .any(|update| update["sessionUpdate"] == "tool_call" && update["_meta"]["claudeCode"]["toolName"] == tool_name)
}

/// 가짜 claude가 받은 stdin 줄마다 그 꼴 — user 줄은 `user`, 제어 요청은 그 subtype, 제어 답은 `answer`.
fn stdin_shape(stdin: &[Value]) -> Vec<String> {
    stdin
        .iter()
        .map(|line| match line["type"].as_str().unwrap() {
            "control_request" => line["request"]["subtype"].as_str().unwrap().to_owned(),
            "control_response" => "answer".to_owned(),
            other => other.to_owned(),
        })
        .collect()
}

#[test]
fn 멈추면_가짜_claude가_interrupt_제어_요청을_받고_sigint는_없고_턴이_cancelled로_끝나고_다음_말이_같은_프로세스_같은_세션으로_간다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/interrupt-sigint", &[]);
    host.send("cart", &conversation, "40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해").expect("보내기");
    // 원문은 그 명령이 도는 동안 interrupt를 보냈다 — 도구 줄이 선 뒤에 멈춘다.
    sandbox.wait_record("cart", &conversation, |record| has_tool_call(record, "Bash"));

    host.stop("cart", &conversation).expect("멈추기");

    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!(
        (end["stopReason"].clone(), end["cancelledByUs"].clone()),
        (json!("cancelled"), json!(true)),
        "우리가 interrupt를 보낸 턴의 error_during_execution은 cancelled다:\n{}",
        common::lines_text(&record)
    );
    let bash = updates(&record)
        .into_iter()
        .find(|update| update["sessionUpdate"] == "tool_call" && update["_meta"]["claudeCode"]["toolName"] == "Bash")
        .unwrap();
    let closed: Vec<Value> = updates(&record)
        .into_iter()
        .filter(|update| update["toolCallId"] == bash["toolCallId"] && update.get("status").is_some())
        .map(|update| update["status"].clone())
        .collect();
    assert_eq!(closed, [json!("in_progress"), json!("failed")], "멈춘 명령의 도구 줄은 실패로 닫힌다");

    let session_id = sandbox.agent_session_id("cart", &conversation);
    let stdin = sandbox.claude_stdin(&session_id);
    assert_eq!(stdin_shape(&stdin), ["initialize", "user", "interrupt"], "멈추기는 stdin의 interrupt 제어 요청 하나다");
    assert!(
        !sandbox.claude_events(&session_id).iter().any(|event| event == "signal SIGINT"),
        "SIGINT는 보내지 않는다 — claude가 끝난다(워크플로 함정 5)"
    );

    // 다음 말은 같은 프로세스 · 같은 세션으로 간다 — claude는 멈춘 턴의 맥락을 잇는다(원문 21줄).
    host.send("cart", &conversation, "방금 무엇을 돌리려 했고 끝났는지 한 문장으로").expect("다음 말");
    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 2);
    assert_eq!(of_kind(&record, "turn-end")[1]["payload"]["stopReason"], "end_turn");
    assert_eq!(sandbox.all_claude_receipts().len(), 1, "다시 띄우지 않았다");
    assert_eq!(stdin_shape(&sandbox.claude_stdin(&session_id)), ["initialize", "user", "interrupt", "user"]);
    let sessions: Vec<Value> = of_kind(&record, "update").iter().map(|line| line["payload"]["sessionId"].clone()).collect();
    assert!(sessions.iter().all(|id| *id == json!(session_id)), "모든 update가 처음 연 세션의 것이다");
    let answer = updates(&record)
        .into_iter()
        .filter(|update| update["sessionUpdate"] == "agent_message_chunk")
        .last()
        .unwrap();
    assert!(answer["content"]["text"].as_str().unwrap().contains("완료되지 않았습니다"), "{answer}");

    host.shut_down();
}

/// 가짜 claude가 받은 제어 답들(`control_response`) — 권한 답이다.
fn answers(sandbox: &Sandbox, session_id: &str) -> Vec<Value> {
    sandbox.claude_stdin(session_id).into_iter().filter(|line| line["type"] == "control_response").collect()
}

/// 변환기가 짓는 Claude 권한 선택지 — 한 번 허락 · 이 대화에서 허락 · 거부.
fn claude_options(with_session: bool) -> Value {
    let mut options = vec![json!({"optionId": "allow_once", "name": "Yes", "kind": "allow_once"})];
    if with_session {
        options.push(json!({"optionId": "allow_session", "name": "Yes, and don't ask again this conversation",
                            "kind": "allow_always"}));
    }
    options.push(json!({"optionId": "reject", "name": "No, and tell Claude what to do differently", "kind": "reject_once"}));
    Value::Array(options)
}

/// 원문(워크플로 관문 G1)의 작업 자리 밖 파일 — 첫 턴은 허락한 것, 둘째 턴은 거부한 것.
const ALLOWED: &str = "/tmp/gate/ws/g1/outside/allowed.txt";
const DENIED: &str = "/tmp/gate/ws/g1/outside/denied.txt";

#[test]
fn permission_stdio_권한_요청이_permission_줄에_서고_세션_제안이_있으면_선택지가_셋이고_허락하면_턴이_이어진다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/permission-stdio", &[]);
    host.send("cart", &conversation, "outside/allowed.txt를 Write로 만들어").expect("보내기");

    let record = sandbox.wait_kind("cart", &conversation, "permission", 1);
    let asked = &payloads_of(&record, "permission")[0];
    let session_id = sandbox.agent_session_id("cart", &conversation);
    assert_eq!((asked["state"].clone(), asked["requestId"].clone()), (json!("asked"), json!("0")));
    assert_eq!(
        asked["request"]["toolCall"],
        json!({"toolCallId": "toolu_01N3UUSZaU6yvP6yapUN8U5P", "title": format!("Write {ALLOWED}"), "kind": "edit",
               "status": "pending", "rawInput": {"file_path": ALLOWED, "content": "x"},
               "_meta": {"claudeCode": {"toolName": "Write", "decisionReason": "Path is outside allowed working directories"}}}),
        "도구 요지 — 앞서 낸 tool_call과 같은 id · 제목 · 종류이고, 입력은 claude가 물은 그대로다. 까닭(decision_reason)은 승인 카드가 \
         읽는 자리(_meta.claudeCode.decisionReason)에 선다(티켓 21)"
    );
    assert_eq!(asked["request"]["sessionId"], json!(session_id));
    assert_eq!(asked["request"]["options"], claude_options(true), "원문의 제안 둘이 다 session이라 선택지는 셋이다");
    let original = &asked["request"]["_meta"]["claudeCode"]["request"];
    assert_eq!(
        (original["decision_reason"].as_str(), original["description"].as_str()),
        (Some("Path is outside allowed working directories"), Some(ALLOWED)),
        "claude가 물은 원문(까닭 · 설명 · 제안)이 _meta에 실린다 — 승인 카드의 재료다"
    );
    assert!(of_kind(&record, "turn-end").is_empty(), "답하기 전에는 턴이 끝나지 않는다");

    host.answer_permission("cart", &conversation, "0", "allow_once").expect("한 번 허락");

    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    assert_eq!(payloads_of(&record, "permission")[1], json!({"requestId": "0", "state": "answered", "optionId": "allow_once"}));
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("end_turn"), json!(false)));
    assert_eq!(
        answers(&sandbox, &session_id),
        [json!({"type": "control_response",
                "response": {"subtype": "success", "request_id": "93884787-809c-4c0a-82cd-a8ed96112508",
                             "response": {"behavior": "allow", "updatedInput": {"file_path": ALLOWED, "content": "x"}}}})],
        "한 번 허락은 allow와 claude가 물은 입력 그대로다 — 영구 규칙(updatedPermissions)이 없다"
    );
    let done = updates(&record)
        .into_iter()
        .find(|update| update["toolCallId"] == "toolu_01N3UUSZaU6yvP6yapUN8U5P" && update["sessionUpdate"] == "tool_call_update")
        .unwrap();
    assert_eq!(done["status"], "completed", "허락한 도구가 끝나고 턴이 이어진다");

    host.shut_down();
}

#[test]
fn 세션_제안이_없는_권한_요청은_선택지가_한_번_허락과_거부_둘이다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/permission-stdio", &[("FAKE_CLAUDE_SUGGESTIONS", "[]")]);
    host.send("cart", &conversation, "outside/allowed.txt를 Write로 만들어").expect("보내기");

    let record = sandbox.wait_kind("cart", &conversation, "permission", 1);
    assert_eq!(payloads_of(&record, "permission")[0]["request"]["options"], claude_options(false));

    host.shut_down();
}

/// 세션 제안 둘(원문 그대로)과 설정 파일에 쓰는 제안 둘이 섞인 제안 — 워크플로 관문 G1에서 `Bash` 요청에 붙어 온
/// `addRules{destination:"localSettings"}`와, 사용자 설정을 고치는 `userSettings`의 꼴이다.
const MIXED_SUGGESTIONS: &str = r#"[
  {"type":"addRules","rules":[{"toolName":"Write","ruleContent":"/tmp/gate/ws/g1/outside/**"}],"behavior":"allow","destination":"localSettings"},
  {"type":"setMode","mode":"acceptEdits","destination":"session"},
  {"type":"addRules","rules":[{"toolName":"Write"}],"behavior":"allow","destination":"userSettings"},
  {"type":"addDirectories","directories":["/tmp/gate/ws/g1/outside"],"destination":"session"}
]"#;

#[test]
fn 이_대화에서_허락은_session_제안만_싣고_설정_파일에_쓰는_제안은_claude에_돌려주지_않는다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/permission-stdio", &[("FAKE_CLAUDE_SUGGESTIONS", MIXED_SUGGESTIONS)]);
    host.send("cart", &conversation, "outside/allowed.txt를 Write로 만들어").expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation, "permission", 1);
    assert_eq!(payloads_of(&record, "permission")[0]["request"]["options"], claude_options(true));

    host.answer_permission("cart", &conversation, "0", "allow_session").expect("이 대화에서 허락");

    sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    let session_id = sandbox.agent_session_id("cart", &conversation);
    let answer = &answers(&sandbox, &session_id)[0]["response"]["response"];
    assert_eq!(
        answer,
        &json!({"behavior": "allow", "updatedInput": {"file_path": ALLOWED, "content": "x"},
                "updatedPermissions": [
                    {"type": "setMode", "mode": "acceptEdits", "destination": "session"},
                    {"type": "addDirectories", "directories": ["/tmp/gate/ws/g1/outside"], "destination": "session"}
                ]}),
        "session 제안만 돌려준다 — localSettings는 워크트리에 .claude/settings.local.json을, userSettings는 사용자 설정을 쓴다(워크플로 함정 3)"
    );

    host.shut_down();
}

#[test]
fn 거부하면_그_도구_호출만_실패하고_턴이_이어져_end_turn으로_끝나고_claude는_거부의_글을_도구_결과로_받는다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/permission-stdio", &[]);
    host.send("cart", &conversation, "outside/allowed.txt를 Write로 만들어").expect("첫 말");
    sandbox.wait_kind("cart", &conversation, "permission", 1);
    host.answer_permission("cart", &conversation, "0", "allow_once").expect("한 번 허락");
    sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    host.send("cart", &conversation, "outside/denied.txt를 Write로 만들어").expect("둘째 말");
    let record = sandbox.wait_kind("cart", &conversation, "permission", 3);
    assert_eq!(payloads_of(&record, "permission")[2]["requestId"], "1", "변환기의 요청 id는 세션 동안 이어 센다");
    assert_eq!(payloads_of(&record, "permission")[2]["request"]["toolCall"]["rawInput"]["file_path"], DENIED);

    host.answer_permission("cart", &conversation, "1", "reject").expect("거부");

    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 2);
    let session_id = sandbox.agent_session_id("cart", &conversation);
    let denial = &answers(&sandbox, &session_id)[1]["response"];
    assert_eq!(denial["request_id"], "55ac2cb2-29bc-47b0-ad5d-d840238550ad");
    assert_eq!(denial["response"]["behavior"], "deny", "거부는 deny다");
    let message = denial["response"]["message"].clone();
    assert!(message.as_str().is_some_and(|text| !text.is_empty()), "deny에는 claude에게 줄 글이 실린다");

    // 거부한 뒤의 줄 — 그 도구가 실패로 닫히고(claude가 거부의 글을 결과로 받았다), 모델이 이어 답하고, 턴이 보통으로 끝난다.
    let after: Vec<Value> = record
        .iter()
        .skip_while(|line| line["payload"]["state"] != "answered" || line["payload"]["requestId"] != "1")
        .skip(1)
        .map(|line| match line["kind"].as_str().unwrap() {
            "update" => line["payload"]["update"].clone(),
            kind => json!(kind),
        })
        .collect();
    assert_eq!(
        after[0],
        json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_01242xqAGeUr9Sx7LfbCib3t", "status": "failed",
               "content": [{"type": "content", "content": {"type": "text", "text": message}}]}),
        "그 도구 호출 하나만 실패한다"
    );
    let kinds: Vec<&str> = after[1..]
        .iter()
        .map(|item| item["sessionUpdate"].as_str().unwrap_or_else(|| item.as_str().unwrap()))
        .collect();
    assert_eq!(kinds, ["agent_thought_chunk", "agent_message_chunk", "usage_update", "turn-end"], "턴이 이어진다");
    let end = &of_kind(&record, "turn-end")[1]["payload"];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("end_turn"), json!(false)));

    host.shut_down();
}

#[test]
fn 권한이_걸린_채_멈추면_claude가_control_cancel_request로_요청을_거두고_거둬짐이_적히고_턴이_cancelled로_끝나고_다음_말이_이어진다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/permission-stdio", &[]);
    host.send("cart", &conversation, "outside/allowed.txt를 Write로 만들어").expect("보내기");
    sandbox.wait_kind("cart", &conversation, "permission", 1);

    host.stop("cart", &conversation).expect("멈추기");

    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    assert_eq!(
        payloads_of(&record, "permission")[1..],
        [json!({"requestId": "0", "state": "withdrawn", "reason": "stopped"})],
        "걸린 요청은 「거둬짐(턴이 끊김)」으로 닫힌다:\n{}",
        common::lines_text(&record)
    );
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("cancelled"), json!(true)));
    let failed = updates(&record)
        .into_iter()
        .find(|update| update["toolCallId"] == "toolu_01N3UUSZaU6yvP6yapUN8U5P" && update["sessionUpdate"] == "tool_call_update")
        .unwrap();
    assert_eq!(failed["status"], "failed", "묻던 도구는 돌지 않고 실패로 닫힌다");
    let session_id = sandbox.agent_session_id("cart", &conversation);
    assert_eq!(
        stdin_shape(&sandbox.claude_stdin(&session_id)),
        ["initialize", "user", "interrupt"],
        "claude는 interrupt에 그 요청을 스스로 거둔다 — 변환기는 거둔 요청에 답하지 않는다"
    );
    assert_eq!(
        host.answer_permission("cart", &conversation, "0", "allow_once"),
        Err(atelier_acp::HostError::PermissionClosed { conversation: conversation.clone(), request: "0".into() }),
        "거둬진 요청에 뒤늦게 준 답은 읽히는 오류다"
    );

    // 같은 claude가 다음 말을 받는다 — 둘째 턴도 권한을 묻는다.
    host.send("cart", &conversation, "outside/denied.txt를 Write로 만들어").expect("다음 말");
    let record = sandbox.wait_kind("cart", &conversation, "permission", 3);
    assert_eq!(payloads_of(&record, "permission")[2]["request"]["toolCall"]["rawInput"]["file_path"], DENIED);
    assert_eq!(sandbox.all_claude_receipts().len(), 1);

    host.shut_down();
}

/// 가짜 claude가 받은 제어 요청들의 `request` 칸 — 받은 차례대로. `initialize`는 뺀다.
fn controls(sandbox: &Sandbox, session_id: &str) -> Vec<Value> {
    sandbox
        .claude_stdin(session_id)
        .into_iter()
        .filter(|line| line["type"] == "control_request" && line["request"]["subtype"] != "initialize")
        .map(|line| line["request"].clone())
        .collect()
}

#[test]
fn 모델과_모드를_바꾸면_가짜_claude가_stdin_set_model과_set_permission_mode를_받고_agents_json과_config_줄에_남는다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/twoturn-tools", &[]);
    let session_id = sandbox.agent_session_id("cart", &conversation);

    let changed = host.set_model("cart", &conversation, "sonnet").expect("모델 바꾸기");
    assert_eq!(changed.model.as_deref(), Some("sonnet"), "답은 바뀐 대화다");
    let changed = host.set_mode("cart", &conversation, "acceptEdits").expect("모드 바꾸기");
    assert_eq!((changed.model.as_deref(), changed.mode.as_deref()), (Some("sonnet"), Some("acceptEdits")));

    assert_eq!(
        controls(&sandbox, &session_id),
        [json!({"subtype": "set_model", "model": "sonnet"}), json!({"subtype": "set_permission_mode", "mode": "acceptEdits"})],
        "모델 → stdin set_model, 모드 → stdin set_permission_mode(three-axes 결정 16 · 27)"
    );
    let row = sandbox.agents_row("cart", &conversation);
    assert_eq!((row["model"].clone(), row["mode"].clone()), (json!("sonnet"), json!("acceptEdits")));

    // 다음 말보다 먼저 claude에 닿았다 — 같은 프로세스가 다음 턴을 받는다.
    host.send("cart", &conversation, "다음 말").expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    assert_eq!(stdin_shape(&sandbox.claude_stdin(&session_id)), ["initialize", "set_model", "set_permission_mode", "user"]);
    assert_eq!(payloads_of(&record, "config"), [json!({"model": "sonnet"}), json!({"mode": "acceptEdits"})], "바꾼 값이 config 줄로 남는다");
    assert!(
        !updates(&record).iter().any(|update| update["sessionUpdate"] == "current_mode_update"),
        "사람이 바꾼 모드에 claude가 되돌려 주는 system/status는 config 줄과 겹치므로 옮기지 않는다:\n{}",
        common::lines_text(&record)
    );

    host.shut_down();
}

#[test]
fn 엔진_기본값으로_되돌린_모델은_값_없는_set_model이다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/twoturn-tools", &[]);
    let session_id = sandbox.agent_session_id("cart", &conversation);

    host.set_model("cart", &conversation, "default").expect("기본 모델로");

    // 실측 2.1.296 — 값 없는 set_model이 사용자의 기본 모델로 돌린다(`Set model to claude-opus-5-5`).
    assert_eq!(controls(&sandbox, &session_id), [json!({"subtype": "set_model"})]);

    host.shut_down();
}

#[test]
fn claude가_거절한_바꾸기와_claude에_없는_설정은_읽히는_오류이고_아무것도_남지_않는다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/twoturn-tools", &[]);
    let record_before = sandbox.record("cart", &conversation);

    // 실측 2.1.296 — 띄울 때 허락하지 않은 bypassPermissions는 `bypass_not_launched`(실측 함정 38).
    let refused = host.set_mode("cart", &conversation, "bypassPermissions").expect_err("claude가 거절한다");
    assert!(matches!(refused, atelier_acp::HostError::Setting(_)), "{refused:?}");
    assert!(refused.to_string().contains("--dangerously-skip-permissions"), "claude가 준 까닭이 실린다: {refused}");
    let refused = host.set_model("cart", &conversation, "no-such-model").expect_err("claude가 거절한다");
    assert!(refused.to_string().contains("not found"), "{refused}");
    // Claude의 계획은 모드 칩의 plan이다 — Codex의 「계획」 설정(collaboration_mode)은 없다(three-axes 결정 29).
    let refused = host.set_plan("cart", &conversation, true).expect_err("Claude에는 계획 설정이 없다");
    assert!(matches!(refused, atelier_acp::HostError::Setting(_)), "{refused:?}");

    let row = sandbox.agents_row("cart", &conversation);
    assert_eq!((row["model"].clone(), row["mode"].clone(), row["plan"].clone()), (Value::Null, Value::Null, Value::Null));
    assert_eq!(sandbox.record("cart", &conversation), record_before, "config 줄도 없다");

    host.shut_down();
}

/// 판 02 관문 G1 원문(`g1-plan-revise`)에서 claude가 물은 `ExitPlanMode`들의 `can_use_tool` 요청 — 물은 차례대로.
fn recorded_plan_requests() -> Vec<Value> {
    include_str!("fixtures/claude-2.1.296/g1-plan-revise.jsonl")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|line| line["type"] == "control_request" && line["request"]["tool_name"] == "ExitPlanMode")
        .collect()
}

/// G1에서 진짜 claude 2.1.296이 계획 모드에 남아 다음 말을 기다리게 한 「다시 짜기」의 글 — 잰 쪽이 넣은 deny의 `message`.
fn measured_revise_message() -> Value {
    include_str!("fixtures/claude-2.1.296/g1-plan-revise.stdin.jsonl")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|line| line["response"]["response"]["behavior"] == "deny")
        .expect("G1 원문에 다시 짜기의 deny가 있다")["response"]["response"]["message"]
        .clone()
}

#[test]
fn 계획_승인은_계획_본문이_든_switch_mode_권한_줄이고_다시_짜기는_deny와_고정_문구_구현은_allow로_가고_승인_뒤_claude가_바꾼_모드는_current_mode_update로_적힌다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.296/g1-plan-revise", &[]);
    let session_id = sandbox.agent_session_id("cart", &conversation);
    host.set_mode("cart", &conversation, "plan").expect("모드 칩의 plan");
    host.send("cart", &conversation, "hello.txt에 hi를 담는 계획을 두 단계로 짜고 ExitPlanMode로 물어").expect("보내기");

    // claude가 계획을 다 짜면 ExitPlanMode를 can_use_tool로 묻는다(G1) — codex-acp의 계획 승인과 같은 모양이다.
    let record = sandbox.wait_kind("cart", &conversation, "permission", 1);
    let plans = recorded_plan_requests();
    let asked = &payloads_of(&record, "permission")[0];
    assert_eq!(
        asked["request"]["toolCall"],
        json!({"toolCallId": plans[0]["request"]["tool_use_id"], "kind": "switch_mode", "status": "pending",
               "title": "Implement this plan?", "rawInput": {"plan": plans[0]["request"]["input"]["plan"]},
               "_meta": {"claudeCode": {"toolName": "ExitPlanMode"}}}),
        "계획 본문(input.plan)이 rawInput.plan에 실린다 — 계획 카드의 재료다(S5)"
    );
    assert_eq!(
        asked["request"]["options"],
        json!([
            {"optionId": "implement_plan", "name": "Yes, implement this plan", "kind": "allow_once"},
            {"optionId": "revise_plan", "name": "No, and tell Claude what to do differently", "kind": "reject_once"}
        ]),
        "선택지는 구현 · 다시 짜기 둘이다"
    );

    host.answer_permission("cart", &conversation, "0", "revise_plan").expect("다시 짜기");

    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    assert_eq!(
        answers(&sandbox, &session_id)[0]["response"],
        json!({"subtype": "success", "request_id": plans[0]["request_id"],
               "response": {"behavior": "deny", "message": measured_revise_message()}}),
        "다시 짜기는 deny와 고정 문구다 — G1에서 claude가 이 글을 받고 파일을 고치지 않은 채 계획 모드에 남았다"
    );
    assert_eq!(of_kind(&record, "turn-end")[0]["payload"]["stopReason"], "end_turn");
    assert!(!updates(&record).iter().any(|update| update["sessionUpdate"] == "current_mode_update"), "계획 모드에 남는다");

    host.send("cart", &conversation, "파일 이름을 greeting.txt로 바꿔서 다시 물어").expect("고칠 점");
    sandbox.wait_kind("cart", &conversation, "permission", 3);
    host.answer_permission("cart", &conversation, "1", "implement_plan").expect("구현");
    // 승인하면 claude가 default 모드로 가서 구현하고, 그 Write가 다시 묻는다(G1).
    let record = sandbox.wait_kind("cart", &conversation, "permission", 5);
    assert_eq!(payloads_of(&record, "permission")[4]["request"]["toolCall"]["kind"], "edit");
    host.answer_permission("cart", &conversation, "2", "allow_once").expect("Write 허락");

    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 2);
    assert_eq!(
        answers(&sandbox, &session_id)[1]["response"],
        json!({"subtype": "success", "request_id": plans[1]["request_id"],
               "response": {"behavior": "allow", "updatedInput": plans[1]["request"]["input"]}}),
        "구현은 allow와 claude가 물은 입력 그대로다"
    );
    let modes: Vec<Value> = updates(&record)
        .into_iter()
        .filter(|update| update["sessionUpdate"] == "current_mode_update")
        .collect();
    assert_eq!(
        modes,
        [json!({"sessionUpdate": "current_mode_update", "currentModeId": "default"})],
        "claude가 스스로 바꾼 모드(system/status)는 current_mode_update다 — 우리가 넣은 plan의 메아리는 옮기지 않았다"
    );
    let shape: Vec<String> = record
        .iter()
        .skip_while(|line| line["payload"]["requestId"] != "1")
        .map(|line| match line["kind"].as_str().unwrap() {
            "update" => line["payload"]["update"]["sessionUpdate"].as_str().unwrap().to_owned(),
            "permission" => format!("permission:{}", line["payload"]["state"].as_str().unwrap()),
            kind => kind.to_owned(),
        })
        .take(4)
        .collect();
    assert_eq!(
        shape,
        ["permission:asked", "permission:answered", "current_mode_update", "tool_call_update"],
        "모드가 바뀐 것은 승인 바로 뒤, 승인된 ExitPlanMode가 끝나기 전에 선다"
    );
    assert_eq!(of_kind(&record, "turn-end")[1]["payload"]["stopReason"], "end_turn");

    host.shut_down();
}
