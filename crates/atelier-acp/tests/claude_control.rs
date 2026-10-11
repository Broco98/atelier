//! L1 — 대화 호스트 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude: 멈추기 · 권한 · 바꾸기가 호스트에서 claude까지 닿고 돌아온다
//! (three-axes 티켓 15 · 스토리 26 · 53 · 54 · 57 · 59 · 64). 호스트와 변환기가 잇는 끝맺음이다 — 시험은 호스트에 명령을 넣고,
//! `agents/` 기록과 가짜 claude의 영수증(받은 stdin 줄 · 받은 시그널 · 띄운 프로세스)만 본다.
//!
//! 호스트 쪽 길(멈추기 07 · 권한 08 · 바꾸기 09)은 Codex와 같아 그쪽 시험이 잰다. 변환기가 옮기는 갈래(interrupt의 끝 · 선택지 ·
//! 이 대화에서 허락 · 거부 · 거둔 요청 · 계획 승인 · 기본 모델 · 거절된 바꾸기 · 모드의 메아리)는 변환기 상태 기계의 시험
//! (`src/translator/machine/tests.rs`)이 같은 녹화를 프로세스 없이 먹여 잰다.

mod common;

use common::{of_kind, payloads_of, Sandbox};
use serde_json::{json, Value};

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
fn 멈추면_가짜_claude가_interrupt_제어_요청을_받고_sigint는_없고_턴이_cancelled로_끝나고_다음_말이_같은_프로세스로_간다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/interrupt-sigint", &[]);
    host.send("cart", &conversation, "40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해").expect("보내기");
    // 원문은 그 명령이 도는 동안 interrupt를 보냈다 — 도구 줄이 선 뒤에 멈춘다.
    sandbox.wait_record("cart", &conversation, |record| {
        of_kind(record, "update").iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });

    host.stop("cart", &conversation).expect("멈추기");

    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!(
        (end["stopReason"].clone(), end["cancelledByUs"].clone()),
        (json!("cancelled"), json!(true)),
        "우리가 interrupt를 보낸 턴은 cancelled이고 「우리가 멈춤」이다:\n{}",
        common::lines_text(&record)
    );
    let session_id = sandbox.agent_session_id("cart", &conversation);
    assert_eq!(stdin_shape(&sandbox.claude_stdin(&session_id)), ["initialize", "user", "interrupt"], "멈추기는 stdin의 interrupt 제어 요청 하나다");
    assert!(
        !sandbox.claude_events(&session_id).iter().any(|event| event == "signal SIGINT"),
        "SIGINT는 보내지 않는다 — claude가 끝난다(워크플로 함정 5)"
    );

    // 다음 말은 같은 프로세스로 간다 — claude는 멈춘 턴의 맥락을 잇는다(원문 21줄).
    host.send("cart", &conversation, "방금 무엇을 돌리려 했고 끝났는지 한 문장으로").expect("다음 말");
    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 2);
    assert_eq!(of_kind(&record, "turn-end")[1]["payload"]["stopReason"], "end_turn");
    assert_eq!(sandbox.all_claude_receipts().len(), 1, "다시 띄우지 않았다");
    assert_eq!(stdin_shape(&sandbox.claude_stdin(&session_id)), ["initialize", "user", "interrupt", "user"]);

    host.shut_down();
    // S26 — 대화창의 L3(티켓 20)가 Claude 꼴의 멈춘 턴(돌던 도구가 `failed`로 닫힌 뒤 `cancelled`)을 이것으로 잰다.
    common::assert_record("claude-stopped", &common::fix_record(&record, &sandbox.data_root(), &session_id));
}

#[test]
fn permission_stdio_권한_요청이_permission_줄에_서고_답하면_claude가_그_답을_받고_턴이_이어진다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = sandbox.open_claude("2.1.282/permission-stdio", &[]);
    host.send("cart", &conversation, "outside/allowed.txt를 Write로 만들어").expect("보내기");

    let record = sandbox.wait_kind("cart", &conversation, "permission", 1);
    let asked = &payloads_of(&record, "permission")[0];
    let session_id = sandbox.agent_session_id("cart", &conversation);
    assert_eq!((asked["state"].clone(), asked["requestId"].clone()), (json!("asked"), json!("0")));
    assert_eq!(asked["request"]["sessionId"], json!(session_id));
    let options: Vec<&str> =
        asked["request"]["options"].as_array().unwrap().iter().map(|option| option["optionId"].as_str().unwrap()).collect();
    assert_eq!(options, ["allow_once", "allow_session", "reject"], "변환기가 지은 선택지가 그대로 permission 줄에 선다");
    assert!(of_kind(&record, "turn-end").is_empty(), "답하기 전에는 턴이 끝나지 않는다");

    host.answer_permission("cart", &conversation, "0", "allow_once").expect("한 번 허락");

    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    assert_eq!(payloads_of(&record, "permission")[1], json!({"requestId": "0", "state": "answered", "optionId": "allow_once"}));
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("end_turn"), json!(false)));
    let answers: Vec<Value> =
        sandbox.claude_stdin(&session_id).into_iter().filter(|line| line["type"] == "control_response").collect();
    assert_eq!(answers.len(), 1, "호스트의 답이 claude의 stdin에 닿았다: {answers:?}");
    assert_eq!(answers[0]["response"]["request_id"], "93884787-809c-4c0a-82cd-a8ed96112508", "claude가 물은 그 요청의 답이다");
    assert_eq!(answers[0]["response"]["response"]["behavior"], "allow");

    host.shut_down();
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

    let controls: Vec<Value> = sandbox
        .claude_stdin(&session_id)
        .into_iter()
        .filter(|line| line["type"] == "control_request" && line["request"]["subtype"] != "initialize")
        .map(|line| line["request"].clone())
        .collect();
    assert_eq!(
        controls,
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

    host.shut_down();
}
