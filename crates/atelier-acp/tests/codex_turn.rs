//! L1 — 대화 호스트 ↔ 가짜 ACP 에이전트: 말을 보내면 답이 원문 그대로 기록과 이벤트로 흐른다
//! (three-axes 티켓 04 · 스토리 37 · 107 · 108 · 114 · 115 · 123).
//!
//! 시험은 호스트에 명령을 넣고, 나오는 이벤트 · `agents/` 파일 · 가짜가 남긴 영수증만 본다.

mod common;

use atelier_acp::{Agent, HostError};
use common::{emitted, of_kind, payloads_of, Sandbox};
use serde_json::json;

#[test]
fn 첫_말은_머리말_블록과_사람의_블록이고_sent에_둘_다_남고_둘째_말에는_머리말이_없다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send("cart", &conversation.id, "첫 말이다").expect("첫 말");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    host.send("cart", &conversation.id, "둘째 말이다").expect("둘째 말");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 2);

    let preamble = common::preamble(&work, "cart");
    let first = json!({"type": "text", "text": "첫 말이다"});
    let second = json!({"type": "text", "text": "둘째 말이다"});

    let prompts = sandbox.acp_prompts(&sandbox.agent_session_id("cart", &conversation.id));
    let blocks: Vec<_> = prompts.iter().map(|prompt| prompt["prompt"].clone()).collect();
    assert_eq!(blocks, [json!([preamble, first]), json!([second])], "머리말은 에이전트 쪽 세션의 첫 말에만 붙는다(S11)");

    let sent: Vec<_> = payloads_of(&record, "sent");
    assert_eq!(
        sent,
        [
            json!({"text": "첫 말이다", "prompt": [preamble, first], "sendNow": false}),
            json!({"text": "둘째 말이다", "prompt": [second], "sendNow": false}),
        ],
        "화면에 보일 글과 실제로 보낸 내용 블록(머리말 포함)이 함께 남는다"
    );

    host.shut_down();
}

/// 가짜 `normal`의 한 턴이 보내는 `session/update` — 가짜가 쓴 그대로를 손으로 옮겼다.
fn codex_one_turn_updates(session_id: &str) -> Vec<serde_json::Value> {
    [
        json!({"sessionUpdate": "agent_thought_chunk", "messageId": "rs_fake_1",
               "content": {"type": "text", "text": "**Reading the request**"}}),
        json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_1",
               "content": {"type": "text", "text": "Plan: run `echo atelier`."}}),
        json!({"sessionUpdate": "tool_call", "toolCallId": "exec-fake-1", "kind": "execute",
               "title": "echo atelier", "status": "in_progress",
               "content": [{"type": "terminal", "terminalId": "exec-fake-1"}],
               "rawInput": {"command": ["/bin/zsh", "-lc", "echo atelier"]}}),
        json!({"sessionUpdate": "tool_call_update", "toolCallId": "exec-fake-1", "status": "completed",
               "_meta": {"terminal_output_delta": {"data": "atelier\n", "terminal_id": "exec-fake-1"},
                         "terminal_exit": {"exit_code": 0, "signal": null, "terminal_id": "exec-fake-1"}}}),
        json!({"sessionUpdate": "atelier_fake_unknown_kind", "note": "스키마에 없는 kind", "nested": {"kept": true}}),
        json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_2",
               "content": {"type": "text", "text": "Ran `echo atelier`; it printed `atelier`."}}),
        json!({"sessionUpdate": "usage_update", "used": 1200, "size": 258400}),
    ]
    .into_iter()
    .map(|update| json!({"sessionId": session_id, "update": update}))
    .collect()
}

#[test]
fn update가_보낸_순서대로_원문_그대로_적히고_모르는_kind_뒤로도_턴이_이어져_turn_end가_적힌다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send("cart", &conversation.id, "echo를 돌려 줘").expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);

    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    let after_sent: Vec<_> =
        record.iter().skip_while(|line| line["kind"] != "sent").skip(1).map(|line| line["kind"].clone()).collect();
    let mut expected_kinds = vec![json!("update"); 7];
    expected_kinds.push(json!("turn-end"));
    assert_eq!(after_sent, expected_kinds, "sent 뒤로 update 일곱, 그리고 턴 끝");
    let updates: Vec<_> = payloads_of(&record, "update");
    assert_eq!(updates, codex_one_turn_updates(&session_id), "스키마가 모르는 kind와 칸까지 원문 그대로다");

    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!(end["stopReason"], json!("end_turn"));
    assert_eq!(end["cancelledByUs"], json!(false), "우리가 멈추지 않은 턴이다");
    assert_eq!(end["outOfTurn"], json!(false));
    assert!(end["durationMs"].as_u64().is_some(), "걸린 시간: {end}");
    assert_eq!(
        end["response"],
        json!({"stopReason": "end_turn", "usage": {"totalTokens": 1400, "inputTokens": 1200, "outputTokens": 200}}),
        "답의 사용량은 보이지 않고 기록만 한다"
    );

    let seqs: Vec<u64> = record.iter().map(|line| line["seq"].as_u64().unwrap()).collect();
    assert_eq!(seqs, (1..=record.len() as u64).collect::<Vec<_>>(), "seq는 1부터 빈틈없이 는다");
    assert_eq!(emitted(&events, "cart", &conversation.id), record, "이벤트의 seq · 줄이 파일의 것과 같다");

    host.shut_down();
}

#[test]
fn 말을_받지_않는_에이전트의_오류는_turn_end에_읽히게_실리고_대화는_살아_다음_말을_받는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("refuses-prompt", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let (_, pids) = agent_pid(&sandbox, &conversation.id);

    host.send("cart", &conversation.id, "첫 말").expect("보내기는 된다 — 거절은 턴 끝으로 온다");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);

    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!(end["stopReason"], json!(null));
    assert_eq!(end["error"]["code"], json!(-32603));
    assert_eq!(end["error"]["message"], json!("Internal error: model unavailable"), "에이전트가 준 까닭이 읽힌다");
    assert_eq!(end.get("response"), None);
    let last = emitted(&events, "cart", &conversation.id).pop().unwrap();
    assert_eq!(last["kind"], json!("turn-end"), "화면도 이벤트로 그 오류를 받는다");

    host.send("cart", &conversation.id, "둘째 말").expect("대화는 산다");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 2);
    assert!(common::is_running(pids), "에이전트 프로세스가 그대로 살아 있다");
    assert_eq!(sandbox.acp_prompts(&sandbox.agent_session_id("cart", &conversation.id)).len(), 2);
    assert!(of_kind(&sandbox.record("cart", &conversation.id), "session").iter().all(|line| line["payload"]["state"] != "died"));

    host.shut_down();
}

#[test]
fn 에이전트의_stderr가_줄_단위로_stderr_줄로_적힌다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("normal", &[("FAKE_ACP_STDERR", "codex: warming up|경고: 느린 디스크")]);
    let (host, events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send("cart", &conversation.id, "말").expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "stderr", 2);

    let lines: Vec<_> = payloads_of(&record, "stderr");
    assert_eq!(lines, [json!({"line": "codex: warming up"}), json!({"line": "경고: 느린 디스크"})]);
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    let record = sandbox.record("cart", &conversation.id);
    assert_eq!(emitted(&events, "cart", &conversation.id), record, "stderr 줄도 같은 seq의 이벤트로 나간다");

    host.shut_down();
}

#[test]
fn 이메일이_든_auth_status_update는_기록에_email만_남는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("normal", &[("FAKE_ACP_ACCOUNT_EMAIL", "someone@example.com")]);
    let (host, events) = sandbox.host_with_events(shell);

    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let record = sandbox.record("cart", &conversation.id);
    let states: Vec<_> = record.iter().map(|line| line["payload"]["state"].clone()).collect();
    assert_eq!(states, [json!("spawning"), json!("auth-status"), json!("opened")], "세션을 여는 동안 온 대로 적힌다");
    assert_eq!(
        record[1]["payload"],
        json!({"state": "auth-status", "params": {"authStatus": {
            "kind": "account", "label": "ChatGPT Plus",
            "account": {"email": "<email>", "plan": "<email>"}
        }}}),
        "계정 이메일 · 플랜만 가리고 나머지는 원문 그대로다"
    );
    let text = std::fs::read_to_string(sandbox.record_path("cart", &conversation.id)).unwrap();
    assert!(!text.contains("someone@example.com") && !text.contains("\"plus\""), "{text}");
    let emitted = serde_json::to_string(&emitted(&events, "cart", &conversation.id)).unwrap();
    assert!(!emitted.contains("someone@example.com"), "이벤트에도 새지 않는다: {emitted}");

    host.shut_down();
}

#[test]
fn 기록_읽기는_준_seq_다음부터_주고_끝의_반쪽_줄은_버린다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    host.send("cart", &conversation.id, "말").expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    host.shut_down();
    // 줄을 쓰다 만 꼴 — 끝에 줄바꿈이 없다.
    let path = sandbox.record_path("cart", &conversation.id);
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str(r#"{"seq":99,"at":"2026-10-10T00:00:00.000+09:00","kind":"upd"#);
    std::fs::write(&path, text).unwrap();
    let as_json = |lines: Vec<atelier_acp::RecordLine>| -> Vec<serde_json::Value> {
        lines.into_iter().map(|line| serde_json::to_value(line).unwrap()).collect()
    };

    let all = host.read_record("cart", &conversation.id, 0).expect("기록 읽기");
    assert_eq!(as_json(all), record, "적힌 줄 그대로이고, 반쪽 줄은 없다");

    let after = host.read_record("cart", &conversation.id, 3).expect("seq 3 다음부터");
    assert_eq!(as_json(after), record[3..].to_vec());
    assert_eq!(host.read_record("cart", &conversation.id, record.len() as u64).expect("끝 다음"), []);

    // 앱을 다시 켠 꼴 — 에이전트를 찾을 PATH도 없다.
    let reopened = sandbox.host(atelier_acp::ShellSource::Path(sandbox.login_shell(common::LoginShell::Normal, &[])));
    assert_eq!(
        as_json(reopened.read_record("cart", &conversation.id, 0).expect("다시 지은 호스트도 읽는다")),
        record,
        "에이전트를 띄우지 않고 파일에서 읽는다"
    );
    assert_eq!(
        host.read_record("cart", "no-such-conversation", 0),
        Err(HostError::ConversationNotFound("no-such-conversation".into()))
    );
    assert_eq!(host.read_record("cart", "../agents", 0), Err(HostError::ConversationNotFound("../agents".into())));
    assert_eq!(host.read_record("nowhere", &conversation.id, 0), Err(HostError::WorkNotFound("nowhere".into())));
}

#[test]
fn 세션을_연_답_바로_뒤에_온_update는_열림_줄_뒤에_적힌다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 진짜 codex-acp는 `session/new`의 답 바로 뒤에 명령 목록을 보낸다(실측 turns 5 · 6줄). 여럿을 몰아 보내
    // 호스트가 열림 줄을 적는 틈에 끼어들 기회를 준다.
    let shell = sandbox.codex_login_shell("normal", &[("FAKE_ACP_UPDATES_AFTER_OPEN", "20")]);
    let (host, _events) = sandbox.host_with_events(shell);

    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let record = sandbox.wait_kind("cart", &conversation.id, "update", 20);
    let kinds: Vec<_> =
        record.iter().map(|line| format!("{}:{}", line["kind"].as_str().unwrap(), line["payload"]["state"].as_str().unwrap_or("")))
            .collect();
    let mut expected = vec!["session:spawning".to_owned(), "session:opened".to_owned()];
    expected.extend(std::iter::repeat_n("update:".to_owned(), 20));
    assert_eq!(kinds, expected, "기록의 순서가 받은 순서다 — 열림은 답이 온 때다");

    host.shut_down();
}

/// S26 — 「Codex 한 턴」(답 · 생각 · 도구 update)의 결과 기록이 검사 자료로 서고, 매번 다시 지은 기록이 그것과
/// 같다. 대화창의 L3 목업 백엔드(티켓 17)가 이 파일을 그대로 쏜다.
#[test]
fn codex_한_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 진짜 codex-acp처럼 로그인된 계정을 알린다 — 자료에도 가린 꼴로 선다.
    let shell = sandbox.codex_login_shell("normal", &[("FAKE_ACP_ACCOUNT_EMAIL", "someone@example.com")]);
    let (host, _events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send("cart", &conversation.id, "echo atelier를 돌려 줘").expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    host.shut_down();

    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    common::assert_record("codex-one-turn", &common::fix_record(&record, &sandbox.data_root(), &session_id));
}

/// `dies-mid-turn`이 죽기 전에 stderr에 쓰는 줄들.
const LAST_WORDS: [&str; 2] = ["thread 'main' panicked at codex-rs/core/src/turn.rs:42", "note: run with RUST_BACKTRACE=1"];

/// 턴 도중에 에이전트가 죽으면 죽음 줄이 한 번 적히고, 남은 프로세스가 없고, 다음 말에서 다시 뜬다(three-axes 티켓 10).
fn dies_mid_turn(order: &str, reason: &str) {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("dies-mid-turn", &[("FAKE_ACP_DIES", order)]);
    let (host, events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let (session_id, pid) = agent_pid(&sandbox, &conversation.id);

    host.send("cart", &conversation.id, "말").expect("보내기");
    let record = sandbox.wait_record("cart", &conversation.id, |record| {
        record.iter().any(|line| line["kind"] == "session" && line["payload"]["state"] == "died")
    });

    let died: Vec<_> = record.iter().filter(|line| line["payload"]["state"] == "died").collect();
    assert_eq!(
        died[0]["payload"],
        json!({"state": "died", "reason": reason, "stderrTail": LAST_WORDS}),
        "까닭과 stderr 꼬리가 실린다"
    );
    assert_eq!(of_kind(&record, "turn-end").len(), 0, "답 없이 사라진 턴에는 턴 끝이 없다 — 죽음 줄이 그 자리를 맡는다");
    let mut pids = vec![pid];
    pids.extend(sandbox.receipt_pids(&format!("{session_id}.pids")));
    common::assert_all_gone(&pids);

    std::thread::sleep(std::time::Duration::from_millis(300));
    let record = sandbox.record("cart", &conversation.id);
    assert_eq!(record.iter().filter(|line| line["payload"]["state"] == "died").count(), 1, "죽음은 한 번만 적힌다");
    assert_eq!(emitted(&events, "cart", &conversation.id), record, "죽음 줄도 같은 seq의 이벤트로 나간다");
    // 다음 말은 다시 띄워 되살린다(three-axes 티켓 10) — 가짜는 한 번만 죽는다.
    host.send("cart", &conversation.id, "다음 말").expect("다음 말에서 다시 뜬다");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    assert_eq!(of_kind(&record, "sent").len(), 2, "같은 기록에 이어 적힌다");

    host.close_conversation("cart", &conversation.id).expect("다시 뜬 대화도 닫힌다");
    let record = sandbox.record("cart", &conversation.id);
    assert_eq!(record.last().unwrap()["payload"], json!({"state": "closed"}));
}

#[test]
fn 턴_도중에_에이전트가_끝나고_후손이_출력을_쥐어_수신_eof가_오지_않아도_죽음_줄이_적힌다() {
    dies_mid_turn("exit-first", "에이전트 프로세스가 끝났습니다 (종료 코드 3)");
}

#[test]
fn 턴_도중에_에이전트가_출력을_닫고_살아_있어도_수신_eof로_죽음_줄이_적히고_그룹째_꺼진다() {
    dies_mid_turn("eof-first", "에이전트가 출력을 닫았습니다");
}

/// 그 대화의 에이전트 쪽 세션 id와 에이전트 pid.
fn agent_pid(sandbox: &Sandbox, conversation: &str) -> (String, u32) {
    let session_id = sandbox.agent_session_id("cart", conversation);
    let pid = sandbox.acp_receipt(&session_id)["pid"].as_u64().unwrap() as u32;
    (session_id, pid)
}
