//! L1 — 대화 호스트 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude: 말을 보내면 claude의 stream-json 턴이 ACP로 옮겨져 기록에
//! 흐른다 — 답 · 생각 · 도구 · diff · 내장 명령 · 사용량(three-axes 티켓 14 · 스토리 35 · 37~42 · 47 · 48).
//!
//! 가짜 claude는 진짜 claude가 낸 원문(워크플로 실측 2.1.282 `twoturn-tools`, 판 02 실측 2.1.296 `slash-skill` ·
//! `edit-subagent`)을 user 줄마다 한 턴씩 되감는다. 시험은 호스트에 명령을 넣고, 나오는 `agents/` 기록과 가짜 claude의
//! 영수증(받은 stdin 줄 · 띄운 프로세스)만 본다.

mod common;

use atelier_acp::{Agent, ConversationHost};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 그 원문을 되감는 가짜 claude로 Claude 대화 하나를 연다.
fn open(sandbox: &Sandbox, fixture: &str) -> (ConversationHost, String) {
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", fixture)]));
    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");
    // 명령 목록은 `session/new`의 답 뒤에 따로 온다 — 그것까지 적힌 뒤에 말을 보내야 턴의 줄과 섞이지 않는다.
    sandbox.wait_record("cart", &conversation.id, |record| {
        record.iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "available_commands_update")
    });
    (host, conversation.id)
}

/// 말들을 차례로 보내고, 말마다 그 턴이 끝나기를 기다린다. 다 끝난 기록을 돌려준다.
fn converse(sandbox: &Sandbox, host: &ConversationHost, conversation: &str, texts: &[&str]) -> Vec<Value> {
    for (n, text) in texts.iter().enumerate() {
        host.send("cart", conversation, text).expect("보내기");
        sandbox.wait_kind("cart", conversation, "turn-end", n + 1);
    }
    sandbox.record("cart", conversation)
}

/// `n`번째(0부터) 턴의 update들 — 그 `sent` 뒤부터 그 턴의 `turn-end` 앞까지의 `session/update` 원문.
fn turn_updates(record: &[Value], n: usize) -> Vec<Value> {
    let sent = of_kind(record, "sent")[n]["seq"].as_u64().unwrap();
    let end = of_kind(record, "turn-end")[n]["seq"].as_u64().unwrap();
    record
        .iter()
        .filter(|line| line["kind"] == "update")
        .filter(|line| (sent..end).contains(&line["seq"].as_u64().unwrap()))
        .map(|line| line["payload"].clone())
        .collect()
}

/// update 원문에서 `update` 칸만.
fn bodies(updates: &[Value]) -> Vec<Value> {
    updates.iter().map(|payload| payload["update"].clone()).collect()
}

#[test]
fn twoturn_tools는_한_프로세스가_두_턴을_받고_답_생각_도구가_순서대로_acp_update로_적히고_첫_말은_init_전에_들어간다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = open(&sandbox, "2.1.282/twoturn-tools");

    let record = converse(&sandbox, &host, &conversation, &["세 낱말로 답해", "notes.txt를 쓰고 읽고 바이트를 세"]);

    // 한 프로세스가 두 턴을 받는다 — claude는 하나만 떴고, 그 stdin에 user 줄이 둘 들어갔다.
    let receipts = sandbox.all_claude_receipts();
    assert_eq!(receipts.len(), 1, "턴마다 새로 띄우지 않는다");
    let session_id = sandbox.agent_session_id("cart", &conversation);
    let stdin = sandbox.claude_stdin(&session_id);
    let kinds: Vec<&str> = stdin.iter().map(|line| line["type"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["control_request", "user", "user"], "{stdin:?}");
    assert_eq!(stdin[2]["message"]["content"], json!([{"type": "text", "text": "notes.txt를 쓰고 읽고 바이트를 세"}]));

    // 첫 말은 `system/init`을 기다리지 않고 들어간다(워크플로 함정 6) — claude는 첫 user 줄을 받은 뒤에야 init을 낸다.
    let first_sent = of_kind(&record, "sent")[0]["seq"].as_u64().unwrap();
    let init = record
        .iter()
        .find(|line| line["payload"]["update"]["sessionUpdate"] == "session_info_update")
        .expect("첫 init을 알리는 세션 정보");
    assert!(first_sent < init["seq"].as_u64().unwrap());

    let first = bodies(&turn_updates(&record, 0));
    assert_eq!(first[0]["sessionUpdate"], "session_info_update");
    assert_eq!(
        first[1..3],
        [
            json!({"sessionUpdate": "agent_thought_chunk", "messageId": "msg_011CfPd2ps1hQpw4v1Rs8tuk",
                   "content": {"type": "text", "text": ""}}),
            json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_011CfPd2ps1hQpw4v1Rs8tuk",
                   "content": {"type": "text", "text": "Hello from turn"}}),
        ]
    );

    let notes = "/tmp/gate/ws/g3/wt/notes.txt";
    let second = bodies(&turn_updates(&record, 1));
    let thought = |id: &str| json!({"sessionUpdate": "agent_thought_chunk", "messageId": id, "content": {"type": "text", "text": ""}});
    let output = |text: &str| json!([{"type": "content", "content": {"type": "text", "text": text}}]);
    assert_eq!(
        second[..second.len() - 1],
        [
            thought("msg_011CfPd34AiH7onGhJ4HX7My"),
            json!({"sessionUpdate": "tool_call", "toolCallId": "toolu_01M6s2XMKCLWJ7jLZEccS4N1",
                   "title": format!("Write {notes}"), "kind": "edit", "status": "in_progress",
                   "rawInput": {"file_path": notes, "content": "gate"},
                   "content": [{"type": "diff", "path": notes, "oldText": null, "newText": "gate"}],
                   "locations": [{"path": notes}],
                   "_meta": {"claudeCode": {"toolName": "Write"}}}),
            // 편집 도구의 성공은 diff를 덮지 않는다 — 도구 줄에 diff가 남는다.
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_01M6s2XMKCLWJ7jLZEccS4N1", "status": "completed"}),
            thought("msg_011CfPd3Z9ySN31ni8SVPHkT"),
            json!({"sessionUpdate": "tool_call", "toolCallId": "toolu_01VXai9x8h48DAUzNos1XrRq",
                   "title": format!("Read {notes}"), "kind": "read", "status": "in_progress",
                   "rawInput": {"file_path": notes}, "locations": [{"path": notes}],
                   "_meta": {"claudeCode": {"toolName": "Read"}}}),
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_01VXai9x8h48DAUzNos1XrRq", "status": "completed",
                   "content": output("1\tgate")}),
            thought("msg_011CfPd3hmtvDwNUFf4JfRJW"),
            json!({"sessionUpdate": "tool_call", "toolCallId": "toolu_01UUpYo9irycNHZBPMFkZNdz",
                   "title": format!("wc -c {notes}"), "kind": "execute", "status": "in_progress",
                   "rawInput": {"command": format!("wc -c {notes}"), "description": "Get byte count of notes.txt"},
                   "_meta": {"claudeCode": {"toolName": "Bash"}}}),
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_01UUpYo9irycNHZBPMFkZNdz", "status": "completed",
                   "content": output(&format!("       4 {notes}"))}),
            thought("msg_011CfPd3tBDJiEPbWXFpCuvQ"),
            json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_011CfPd3tBDJiEPbWXFpCuvQ",
                   "content": {"type": "text", "text": "4"}}),
        ]
    );

    // `result` 하나가 턴 끝 하나다.
    let ends: Vec<Value> = of_kind(&record, "turn-end").iter().map(|line| line["payload"]["stopReason"].clone()).collect();
    assert_eq!(ends, [json!("end_turn"), json!("end_turn")]);

    host.shut_down();
}

#[test]
fn 둘째_턴의_system_init은_새_세션을_열지_않고_같은_세션에서_턴이_이어진다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = open(&sandbox, "2.1.282/twoturn-tools");

    let record = converse(&sandbox, &host, &conversation, &["첫 말", "둘째 말"]);

    // claude는 턴마다 `system/init`을 다시 낸다(원문 12줄). 그것은 새 세션이 아니다.
    let session_id = sandbox.agent_session_id("cart", &conversation);
    let opened = record.iter().filter(|line| line["payload"]["state"] == "opened").count();
    let infos = record.iter().filter(|line| line["payload"]["update"]["sessionUpdate"] == "session_info_update").count();
    assert_eq!((opened, infos), (1, 1), "열림도 세션 정보도 한 번이다");
    let sessions: Vec<&Value> = of_kind(&record, "update").iter().map(|line| &line["payload"]["sessionId"]).collect();
    assert!(sessions.iter().all(|id| **id == json!(session_id)), "모든 update가 처음 연 세션의 것이다: {sessions:?}");
    assert!(!turn_updates(&record, 1).is_empty(), "둘째 턴의 줄도 같은 세션으로 흐른다");
    assert_eq!(of_kind(&record, "turn-end")[1]["payload"]["stopReason"], "end_turn");

    host.shut_down();
}

/// 기록에서 그 도구 이름의 `tool_call`과, 그 호출의 `tool_call_update`들.
fn tool_lines(record: &[Value], tool_name: &str) -> (Value, Vec<Value>) {
    let updates = bodies(&of_kind(record, "update").into_iter().map(|line| line["payload"].clone()).collect::<Vec<_>>());
    let call = updates
        .iter()
        .find(|update| update["sessionUpdate"] == "tool_call" && update["_meta"]["claudeCode"]["toolName"] == tool_name)
        .unwrap_or_else(|| panic!("{tool_name} 도구 줄이 없다"))
        .clone();
    let after = updates
        .iter()
        .filter(|update| update["sessionUpdate"] == "tool_call_update" && update["toolCallId"] == call["toolCallId"])
        .cloned()
        .collect();
    (call, after)
}

#[test]
fn edit_입력은_옛_조각과_새_조각의_diff_내용으로_tool_call에_실리고_변환기는_그_파일을_읽지_않는다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = open(&sandbox, "2.1.296/edit-subagent");

    let record = converse(&sandbox, &host, &conversation, &["note.md의 status를 done으로 고쳐"]);

    // 원문(진짜 claude 2.1.296이 고친 파일)의 경로는 이 기계에 없다 — 변환기가 diff를 지으려 그 파일을 읽었다면 지을 수 없었다.
    let note = "/tmp/gate/ws/proj/note.md";
    assert!(!std::path::Path::new(note).exists(), "시험의 전제: 원문의 파일이 없다");
    let (edit, after) = tool_lines(&record, "Edit");
    assert_eq!(
        edit,
        json!({"sessionUpdate": "tool_call", "toolCallId": "toolu_016oQDPXytJaFxiNBTyz9gsb",
               "title": format!("Edit {note}"), "kind": "edit", "status": "in_progress",
               "rawInput": {"replace_all": false, "file_path": note, "old_string": "status: draft", "new_string": "status: done"},
               "content": [{"type": "diff", "path": note, "oldText": "status: draft", "newText": "status: done"}],
               "locations": [{"path": note}],
               "_meta": {"claudeCode": {"toolName": "Edit"}}}),
        "diff는 입력의 조각 그대로다 — 파일 전체가 아니다(S2)"
    );
    assert_eq!(
        after,
        [json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_016oQDPXytJaFxiNBTyz9gsb", "status": "completed"})],
        "성공한 편집은 결과 글로 diff를 덮지 않는다"
    );
    // 고치기 전에 읽은 `Read`는 보통 도구 줄이다.
    let (read, _) = tool_lines(&record, "Read");
    assert_eq!((read["kind"].as_str(), read.get("content")), (Some("read"), None));

    host.shut_down();
}

/// 기록 파일 글 전체.
fn record_text(sandbox: &Sandbox, conversation: &str) -> String {
    std::fs::read_to_string(sandbox.record_path("cart", conversation)).unwrap()
}

#[test]
fn 모델이_skill을_부를_때_생기는_issynthetic_글은_기록에_없고_스킬_도구_줄과_답만_흐른다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = open(&sandbox, "2.1.296/slash-skill-noreplay");

    let record = converse(&sandbox, &host, &conversation, &["/probe-skill", "probe-skill 스킬을 Skill 도구로 불러서 답하라"]);

    // 원문 17줄 — `{"type":"user","isSynthetic":true, …"Skill /probe-skill is already loaded above; …"}`. 사람의 말이 아니다(실측 함정 34).
    assert!(!record_text(&sandbox, &conversation).contains("is already loaded above"), "합성 글이 기록에 실렸다");
    let kinds: Vec<Value> = bodies(&turn_updates(&record, 1)).iter().map(|update| update["sessionUpdate"].clone()).collect();
    assert_eq!(
        kinds,
        [json!("agent_thought_chunk"), json!("tool_call"), json!("tool_call_update"), json!("agent_message_chunk"), json!("usage_update")]
    );
    let (skill, after) = tool_lines(&record, "Skill");
    assert_eq!((skill["title"].as_str(), skill["kind"].as_str()), (Some("Skill probe-skill"), Some("other")));
    assert_eq!(after[0]["content"], json!([{"type": "content", "content": {"type": "text", "text": "Launching skill: probe-skill"}}]));
    let answer = &bodies(&turn_updates(&record, 1))[3];
    assert_eq!(answer["content"]["text"], "PROBE-SKILL-OK");

    host.shut_down();
}

/// 판 02 실측 2.1.296 `slash-skill-replay`에서 내장 명령 `command`의 `<synthetic>` 답 줄.
fn builtin_answer(command: &str) -> Value {
    include_str!("fixtures/claude-2.1.296/slash-skill-replay.jsonl")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|line| line["local_command_run"]["command"] == command)
        .expect("내장 명령의 답 줄")
}

#[test]
fn 내장_명령_context의_synthetic_답은_agent_message_chunk로_적히고_사람의_말_메아리는_옮기지_않는다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = open(&sandbox, "2.1.296/slash-skill-replay");

    let record = converse(&sandbox, &host, &conversation, &["/probe-skill", "/probe-cmd", "/context"]);

    // 모델을 부르지 않은 턴 — `assistant{message.model:"<synthetic>", local_command_source}` + `result{local_command}`(실측 A4).
    let answer = builtin_answer("context");
    assert_eq!(answer["message"]["model"], "<synthetic>");
    assert_eq!(
        bodies(&turn_updates(&record, 2)),
        [json!({"sessionUpdate": "agent_message_chunk", "messageId": answer["message"]["id"],
                "content": {"type": "text", "text": answer["message"]["content"][0]["text"]}})],
        "내장 명령의 답은 보통 답이다. 모델을 부르지 않아 사용량도 없다"
    );
    assert_eq!(of_kind(&record, "turn-end")[2]["payload"]["stopReason"], "end_turn");

    // `--replay-user-messages`로 잰 원문이라 사람의 말이 `isReplay`로 되돌아온다 — 호스트가 이미 `sent`로 적은 말이다.
    assert!(!record_text(&sandbox, &conversation).contains("<command-message>"), "사람의 말 메아리가 기록에 실렸다");

    host.shut_down();
}

#[test]
fn 사용량은_result_usage_iterations의_마지막_원소에서_세고_크기는_답한_모델의_컨텍스트_창이다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = open(&sandbox, "2.1.282/twoturn-tools");

    let record = converse(&sandbox, &host, &conversation, &["첫 말", "도구를 쓰는 둘째 말"]);

    let usage = |n: usize| bodies(&turn_updates(&record, n)).last().cloned().unwrap();
    // 원문 11줄: iterations[-1] = 입력 10 + 출력 228 + 캐시 읽기 13856 + 캐시 쓰기 6368. contextWindow 200000.
    assert_eq!(usage(0), json!({"sessionUpdate": "usage_update", "used": 20462, "size": 200000}));
    // 원문 30줄: 도구를 넷 부른 턴이라 `usage`(합) = 34 + 1096 + 94730 + 5329 = 101189로 부푼다. 지금 컨텍스트는 마지막
    // 호출 하나 — 8 + 113 + 25237 + 316.
    assert_eq!(usage(1), json!({"sessionUpdate": "usage_update", "used": 25674, "size": 200000}));

    // 사용량은 턴 끝 답의 원문에도 남는다 — 화면은 그리지 않고 기록만 한다.
    let response = &of_kind(&record, "turn-end")[1]["payload"]["response"];
    assert_eq!(response["stopReason"], "end_turn");
    assert_eq!(response["_meta"]["claudeCode"]["result"]["usage"]["output_tokens"], 1096, "result 원문이 실린다");

    host.shut_down();
}

#[test]
fn 서브에이전트_도구_호출은_meta에_서브에이전트를_싣고_그_안의_일은_대화가_아니라_그_줄의_meta로_간다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = open(&sandbox, "2.1.296/edit-subagent");

    let record = converse(&sandbox, &host, &conversation, &["note.md를 고쳐", "서브에이전트로 셋째 줄을 읽어 와"]);

    let subagent = json!({"subagentType": "general-purpose", "description": "Read third line of note.md"});
    let (agent, after) = tool_lines(&record, "Agent");
    assert_eq!(agent["toolCallId"], "toolu_01BEzxBrdDFdcVJX23ZT5jDN");
    assert_eq!((agent["title"].as_str(), agent["kind"].as_str()), (Some("Read third line of note.md"), Some("think")));
    assert_eq!(agent["_meta"], json!({"claudeCode": {"toolName": "Agent", "subagent": subagent}}), "서브에이전트 자료는 _meta에 실린다");

    // 서브에이전트 안의 줄(`parent_tool_use_id`가 붙은 것)과 `task_*` 이벤트는 그 도구 줄의 update `_meta`로 — 원문 21~27줄.
    let relayed: Vec<&Value> = after.iter().filter(|update| update["_meta"]["claudeCode"].get("event").is_some()).collect();
    let events: Vec<String> = relayed
        .iter()
        .map(|update| {
            let event = &update["_meta"]["claudeCode"]["event"];
            format!("{}/{}", event["type"].as_str().unwrap(), event["subtype"].as_str().unwrap_or(""))
        })
        .collect();
    assert_eq!(
        events,
        ["system/task_started", "user/", "system/task_progress", "assistant/", "user/", "system/task_notification"]
    );
    for update in &relayed {
        assert_eq!(update["_meta"]["claudeCode"]["subagent"], subagent, "덮어 합쳐도 서브에이전트 자료가 남는다");
        assert!(update.get("status").is_none() && update.get("content").is_none(), "도구 줄의 상태 · 내용은 건드리지 않는다");
    }
    let inner = &relayed[3]["_meta"]["claudeCode"]["event"];
    assert_eq!(inner["message"]["content"][0]["name"], "Read", "서브에이전트가 부른 도구가 그 자료에 든다");

    // 서브에이전트의 도구는 대화의 도구 줄이 아니다 — 둘째 턴의 도구 줄은 `Agent` 하나다.
    let calls: Vec<Value> = bodies(&turn_updates(&record, 1))
        .into_iter()
        .filter(|update| update["sessionUpdate"] == "tool_call")
        .map(|update| update["_meta"]["claudeCode"]["toolName"].clone())
        .collect();
    assert_eq!(calls, [json!("Agent")]);
    let done = after.last().unwrap();
    assert_eq!(done["status"], "completed");
    assert!(done["content"][0]["content"]["text"].as_str().unwrap().starts_with("[Subagent hand-back]"), "{done}");
    let answer = bodies(&turn_updates(&record, 1))
        .into_iter()
        .filter(|update| update["sessionUpdate"] == "agent_message_chunk")
        .map(|update| update["content"]["text"].clone())
        .collect::<Vec<_>>();
    assert_eq!(answer, [json!("status: done")], "대화의 답은 claude 자신의 것뿐이다");

    host.shut_down();
}

/// S26 — 「Claude 두 턴」(답만 하는 턴 · `Write` · `Read` · `Bash`의 턴)의 결과 기록이 검사 자료로 서고, 매번 다시 지은
/// 기록이 그것과 같다. 대화창의 L3 목업 백엔드가 이 파일을 그대로 쏜다 — 도구 줄(티켓 18)과 열림 줄 · 명령 목록(티켓 19).
#[test]
fn claude_두_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 진짜 claude처럼 로그인된 계정을 싣는다 — 자료에도 가린 꼴로 선다.
    let shell = sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.282/twoturn-tools"), ("FAKE_CLAUDE_ACCOUNT_EMAIL", "someone@example.com")],
    );
    let host = sandbox.host(shell);
    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화").id;
    sandbox.wait_record("cart", &conversation, |record| {
        record.iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "available_commands_update")
    });

    let record = converse(
        &sandbox,
        &host,
        &conversation,
        &["세 낱말로 답해 줘: hello from turn", "notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘"],
    );
    host.shut_down();

    let session_id = sandbox.agent_session_id("cart", &conversation);
    common::assert_record("claude-two-turns", &common::fix_record(&record, &sandbox.data_root(), &session_id));
}
