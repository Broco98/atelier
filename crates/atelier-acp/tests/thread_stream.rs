//! L1 — Thread 엔진이 조각을 세션마다 쌓아 합친 글을 기록 줄 하나로 쓴다(restart 티켓 01b-2 · 스펙 「01b — 스트리밍」).
//!
//! 시험은 호스트에 Thread 명령을 넣고 기록만 본다. 진짜 claude 2.1.316의 녹음은 변환기를 지나 재고, 녹음에 없는 때(도중의 죽음 · 끄기 ·
//! 턴 끝 뒤의 조각)는 가짜 ACP 에이전트를 변환기 자리에 두어 잰다.

mod common;

use std::path::Path;

use atelier_acp::{ConversationHost, ThreadLink, TranslatorCommand};
use common::{of_kind, Sandbox};
use serde_json::Value;

/// 그 녹음을 되감는 가짜 claude로 새 Thread를 세운다 — 첫 말이 곧 첫 턴이다.
fn thread_on(sandbox: &Sandbox, fixture: &str) -> (ConversationHost, String) {
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", fixture)]));
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread)
}

/// 가짜 ACP 에이전트를 변환기 자리에 둔 호스트로 새 Thread를 세운다. 그 시나리오의 첫 턴이 돈다.
fn thread_on_agent(sandbox: &Sandbox, scenario: &str) -> (ConversationHost, String) {
    let receipts = sandbox.claude_receipts();
    let env = [
        ("FAKE_ACP_SCENARIO", scenario),
        ("FAKE_ACP_VERSION", env!("CARGO_PKG_VERSION")),
        ("FAKE_ACP_RECEIPTS", receipts.to_str().unwrap()),
    ];
    let agent = TranslatorCommand::new(env!("CARGO_BIN_EXE_fake-acp-agent"), Vec::<String>::new());
    let host = sandbox.host_builder_with_translator(sandbox.claude_login_shell("normal", &env), agent, |_| {}).build();
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread)
}

/// 호스트가 가짜의 조각을 다 받을 때까지 기다린다 — 가짜의 표지 줄이다(`stream_answer`).
fn wait_received(sandbox: &Sandbox, thread: &str) -> Vec<Value> {
    sandbox.wait_thread_record(thread, |record| record.iter().any(|line| line["payload"]["state"] == "auth-status"))
}

/// 턴을 다 돌린다 — 녹음의 턴 수만큼 말을 보낸다.
fn run_turns(sandbox: &Sandbox, host: &ConversationHost, thread: &str, turns: usize) -> Vec<Value> {
    let mut record = sandbox.wait_thread_kind(thread, "turn-end", 1);
    for turn in 2..=turns {
        host.send_to_thread(thread, "다음 말").expect("다음 말");
        record = sandbox.wait_thread_kind(thread, "turn-end", turn);
    }
    record
}

/// 기록을 뼈대로 — 조각은 `(종류, 글)`, 도구 줄은 `("tool_call", 도구)`, 턴 끝은 `("turn-end", "")`이다.
fn skeleton(record: &[Value]) -> Vec<(String, String)> {
    record
        .iter()
        .filter_map(|line| {
            if line["kind"] == "turn-end" {
                return Some(("turn-end".to_owned(), String::new()));
            }
            let update = &line["payload"]["update"];
            let kind = update["sessionUpdate"].as_str()?;
            match kind {
                "agent_message_chunk" | "agent_thought_chunk" => {
                    Some((kind.to_owned(), update["content"]["text"].as_str()?.to_owned()))
                }
                "tool_call" => Some((kind.to_owned(), update["_meta"]["claudeCode"]["toolName"].as_str()?.to_owned())),
                _ => None,
            }
        })
        .collect()
}

/// 녹음이 말하는 뼈대 — 메인 대화의 `assistant` 완성 줄과 `result`. 조각을 합친 글과 견줄, Host를 지나지 않은 답이다.
fn recorded(name: &str) -> Vec<(String, String)> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/claude-2.1.316").join(format!("{name}.jsonl"));
    let lines = common::record_at(&path);
    let mut skeleton = Vec::new();
    for line in &lines {
        if line["type"] == "result" {
            skeleton.push(("turn-end".to_owned(), String::new()));
        }
        if line["type"] != "assistant" || !line["parent_tool_use_id"].is_null() {
            continue;
        }
        for block in line["message"]["content"].as_array().expect("완성 줄의 블록들") {
            skeleton.push(match block["type"].as_str() {
                Some("text") => ("agent_message_chunk".to_owned(), block["text"].as_str().unwrap().to_owned()),
                Some("thinking") => ("agent_thought_chunk".to_owned(), block["thinking"].as_str().unwrap().to_owned()),
                Some("tool_use") => ("tool_call".to_owned(), block["name"].as_str().unwrap().to_owned()),
                other => panic!("모르는 블록: {other:?}"),
            });
        }
    }
    skeleton
}

/// 기록의 조각 줄들.
fn chunk_lines(record: &[Value]) -> Vec<&Value> {
    of_kind(record, "update")
        .into_iter()
        .filter(|line| matches!(line["payload"]["update"]["sessionUpdate"].as_str(), Some("agent_message_chunk" | "agent_thought_chunk")))
        .collect()
}

/// 답 글자 `text`의 조각 줄이 기록의 몇 번째 줄인가.
fn at_chunk(record: &[Value], text: &str) -> usize {
    record
        .iter()
        .position(|line| line["payload"]["update"]["content"]["text"] == text)
        .unwrap_or_else(|| panic!("그 글의 조각 줄이 없다: {text}\n{}", common::lines_text(record)))
}

#[test]
fn 조각을_받아도_기록은_블록마다_한_줄이고_도구_줄과_턴_끝보다_앞서며_다시_읽으면_완성된_글이다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on(&sandbox, "2.1.316/stream-turns");

    let record = run_turns(&sandbox, &host, &thread, 4);

    assert_eq!(skeleton(&record), recorded("stream-turns"), "기록:\n{}", common::lines_text(&record));
    let read: Vec<Value> = host
        .read_thread_record(&thread, 0)
        .unwrap()
        .iter()
        .map(|line| serde_json::to_value(line).unwrap())
        .collect();
    assert_eq!(skeleton(&read), recorded("stream-turns"), "다시 연 채팅이 읽는 글이다");
    host.shut_down();
}

#[test]
fn 조각을_합친_줄마다_다른_흐름_번호가_선다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on(&sandbox, "2.1.316/stream-turns");

    let record = run_turns(&sandbox, &host, &thread, 2);

    let numbers: Vec<u64> =
        chunk_lines(&record).iter().map(|line| line["payload"]["update"]["_meta"]["atelier"]["stream"].as_u64().unwrap()).collect();
    assert_eq!(numbers, (1..=numbers.len() as u64).collect::<Vec<_>>());
    host.shut_down();
}

#[test]
fn 한_메시지의_생각과_글은_종류마다_한_줄이고_생각이_먼저다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on(&sandbox, "2.1.316/stream-thinking");

    let record = run_turns(&sandbox, &host, &thread, 1);

    let expected = recorded("stream-thinking");
    assert_eq!(expected.iter().map(|(kind, _)| kind.as_str()).collect::<Vec<_>>(), ["agent_thought_chunk", "agent_message_chunk", "turn-end"]);
    assert_eq!(skeleton(&record), expected);
    host.shut_down();
}

#[test]
fn 조각이_권한_줄보다_앞서_기록된다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on_agent(&sandbox, "streams-then-asks");

    let record = sandbox.wait_thread_kind(&thread, "permission", 1);

    let asked = record.iter().position(|line| line["kind"] == "permission").unwrap();
    assert!(at_chunk(&record, "흐르던 답") < asked, "{}", common::lines_text(&record));
    host.shut_down();
}

#[test]
fn 멈춘_턴의_글이_턴_끝보다_앞서_기록된다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on_agent(&sandbox, "streams-then-holds");
    wait_received(&sandbox, &thread);

    host.stop_thread(&thread).expect("멈추기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);

    let ended = record.iter().position(|line| line["kind"] == "turn-end").unwrap();
    assert!(at_chunk(&record, "흐르던 답") < ended, "{}", common::lines_text(&record));
    host.shut_down();
}

#[test]
fn session이_도중에_죽어도_받은_글이_죽음_줄보다_앞서_남는다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on_agent(&sandbox, "streams-then-dies");
    wait_received(&sandbox, &thread);

    sandbox.release_claude_background(&sandbox.thread_session_id(&thread));
    let record = sandbox.wait_thread_record(&thread, |record| record.iter().any(|line| line["payload"]["state"] == "died"));

    let died = record.iter().position(|line| line["payload"]["state"] == "died").unwrap();
    assert!(at_chunk(&record, "흐르던 답") < died, "{}", common::lines_text(&record));
    host.shut_down();
}

#[test]
fn 앱이_session을_끌_때_쌓인_글이_남는다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on_agent(&sandbox, "streams-then-holds");
    wait_received(&sandbox, &thread);

    host.shut_down();

    let record = sandbox.thread_record(&thread);
    assert_eq!(skeleton(&record), [("agent_message_chunk".to_owned(), "흐르던 답".to_owned())], "끈 Session에는 턴 끝도 죽음도 없다");
}

#[test]
fn 턴_끝_뒤에_온_조각은_곧바로_기록되고_다음_턴에_섞이지_않는다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on_agent(&sandbox, "chunk-after-turn-end");

    // 뒤에 아무 줄이 오지 않아도 선다 — 쌓지 않았다.
    let record = sandbox.wait_thread_record(&thread, |record| chunk_lines(record).len() == 2);
    let late = &record[at_chunk(&record, "턴 끝 뒤의 글")];
    assert!(late["payload"]["update"]["_meta"].is_null(), "흐름이 아니다 — 화면에 따로 흐르지 않는 줄이다: {late}");

    host.send_to_thread(&thread, "다음 말").expect("다음 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);

    let text = |words: &str| ("agent_message_chunk".to_owned(), words.to_owned());
    let end = ("turn-end".to_owned(), String::new());
    assert_eq!(skeleton(&record), [text("앞선 턴의 글"), end.clone(), text("턴 끝 뒤의 글"), text("다음 턴의 글"), end]);
    host.shut_down();
}
