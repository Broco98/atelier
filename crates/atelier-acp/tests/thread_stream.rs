//! L1 — Thread 엔진이 조각을 세션마다 쌓아 합친 글을 기록 줄 하나로 쓰고(restart 티켓 01b-2), 그동안 받은 글을 33ms로 묶어 기록하지 않는
//! 화면 조각으로 보낸다(01b-3 · 스펙 「01b — 스트리밍」).
//!
//! 시험은 호스트에 Thread 명령을 넣고 기록과 호스트가 낸 이벤트만 본다. 진짜 claude 2.1.316의 녹음은 변환기를 지나 재고, 녹음에 없는
//! 때(도중의 죽음 · 끄기 · 턴 끝 뒤의 조각 · 조각 사이의 틈)는 가짜 ACP 에이전트를 변환기 자리에 두어 잰다.

mod common;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use atelier_acp::{ConversationHost, FlowChunk, FlowKind, HostEvent, ThreadLink, TranslatorCommand};
use common::{of_kind, wait_until, Events, Sandbox};
use serde_json::Value;

/// 그 녹음을 되감는 가짜 claude로 새 Thread를 세운다 — 첫 말이 곧 첫 턴이다.
fn thread_on(sandbox: &Sandbox, fixture: &str) -> (ConversationHost, String) {
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", fixture)]));
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread)
}

/// 가짜 ACP 에이전트를 변환기 자리에 둔 호스트로 새 Thread를 세운다. 그 시나리오의 첫 턴이 돈다.
fn thread_on_agent(sandbox: &Sandbox, scenario: &str) -> (ConversationHost, String) {
    thread_on_agent_emitting(sandbox, scenario, |_| {})
}

/// [`thread_on_agent`]와 같고 호스트가 낸 이벤트를 모은다.
fn watched_on_agent(sandbox: &Sandbox, scenario: &str) -> (ConversationHost, String, Events) {
    let events = Events::default();
    let sink = events.clone();
    let (host, thread) = thread_on_agent_emitting(sandbox, scenario, move |event| sink.push(event));
    (host, thread, events)
}

fn thread_on_agent_emitting(
    sandbox: &Sandbox,
    scenario: &str,
    emit: impl Fn(HostEvent) + Send + Sync + 'static,
) -> (ConversationHost, String) {
    let receipts = sandbox.claude_receipts();
    let env = [
        ("FAKE_ACP_SCENARIO", scenario),
        ("FAKE_ACP_VERSION", env!("CARGO_PKG_VERSION")),
        ("FAKE_ACP_RECEIPTS", receipts.to_str().unwrap()),
    ];
    let agent = TranslatorCommand::new(env!("CARGO_BIN_EXE_fake-acp-agent"), Vec::<String>::new());
    let host = sandbox.host_builder_with_translator(sandbox.claude_login_shell("normal", &env), agent, emit).build();
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread)
}

/// 화면 조각들의 글을 잇는다.
fn joined(chunks: &[FlowChunk]) -> String {
    chunks.iter().map(|chunk| chunk.text.as_str()).collect()
}

/// 그 글이 다 나갈 때까지 기다린 화면 조각들.
fn wait_chunks(events: &Events, thread: &str, text: &str) -> Vec<FlowChunk> {
    wait_until("화면 조각이 그 글까지 나가지 않았다", || {
        let chunks = events.thread_chunks(thread);
        if joined(&chunks) == text {
            Ok(chunks)
        } else {
            Err(format!("{chunks:#?}"))
        }
    })
}

/// 그 Thread의 조각과 흐름 번호가 있는 기록 줄이 나간 차례 — `(흐름 번호, 무엇)`.
fn order_of(events: &Events, id: &str) -> Vec<(u64, &'static str)> {
    events
        .all()
        .into_iter()
        .filter_map(|event| match event {
            HostEvent::ThreadChunk { thread, chunk } if thread == id => Some((chunk.stream, "조각")),
            HostEvent::ThreadRecord { thread, line } if thread == id => {
                let line = serde_json::to_value(line).unwrap();
                line["payload"]["update"]["_meta"]["atelier"]["stream"].as_u64().map(|stream| (stream, "기록"))
            }
            _ => None,
        })
        .collect()
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
fn claude가_끊긴_메시지를_다시_받아도_기록에는_다시_받은_글만_남는다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_on(&sandbox, "2.1.316/stream-retry");

    let record = run_turns(&sandbox, &host, &thread, 3);

    // 녹음의 완성 줄이 다시 받은 메시지의 것뿐이다 — 끊긴 메시지의 글은 기록에 없다.
    assert_eq!(skeleton(&record), recorded("stream-retry"), "기록:\n{}", common::lines_text(&record));
    let marks: Vec<&Value> = record.iter().filter(|line| !line["payload"]["update"]["_meta"]["atelier"]["discardMessage"].is_null()).collect();
    assert!(marks.is_empty(), "버리라는 표지는 기록하지 않는다: {marks:?}");
    host.shut_down();
}

#[test]
fn claude가_끊긴_메시지를_다시_받으면_화면에_그_흐름을_지우는_조각이_다음_흐름보다_먼저_나간다() {
    let sandbox = Sandbox::new();
    let shell = sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.316/stream-retry")]);
    let (host, events) = sandbox.host_with_events(shell);
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("새 Thread의 첫 말");

    run_turns(&sandbox, &host, &thread, 3);

    // 흐름마다 처음 나간 차례와 끝 — 끊긴 메시지(1 · 3)는 지우는 조각으로 끝나고 기록 줄이 되지 않는다.
    let mut flows: Vec<(u64, &'static str)> = Vec::new();
    for event in events.all() {
        let (stream, what) = match event {
            HostEvent::ThreadChunk { thread: id, chunk } if id == thread => (chunk.stream, if chunk.discarded { "지움" } else { "조각" }),
            HostEvent::ThreadRecord { thread: id, line } if id == thread => {
                let line = serde_json::to_value(line).unwrap();
                let Some(stream) = line["payload"]["update"]["_meta"]["atelier"]["stream"].as_u64() else { continue };
                (stream, "기록")
            }
            _ => continue,
        };
        match flows.last_mut() {
            Some(last) if last.0 == stream => last.1 = what,
            _ => flows.push((stream, what)),
        }
    }
    assert_eq!(flows, [(1, "지움"), (2, "기록"), (3, "지움"), (4, "기록"), (5, "기록")]);
    let gone: Vec<FlowChunk> = events.thread_chunks(&thread).into_iter().filter(|chunk| chunk.discarded).collect();
    assert!(gone.iter().all(|chunk| chunk.text.is_empty() && chunk.offset == 0), "지우는 조각에는 글이 없다: {gone:?}");
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
    assert_eq!(host.thread(&thread).unwrap().flowing, None, "남은 글은 이제 기록에 있다");
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

#[test]
fn 받은_글이_기록하지_않는_화면_조각으로_흐르고_조각은_흐름_번호와_오프셋을_단다() {
    let sandbox = Sandbox::new();
    let (host, thread, events) = watched_on_agent(&sandbox, "streams-then-holds");
    wait_received(&sandbox, &thread);

    let chunks = wait_chunks(&events, &thread, "흐르던 답");

    assert_eq!((chunks[0].stream, chunks[0].kind, chunks[0].offset), (1, FlowKind::Message, 0));
    assert!(chunk_lines(&sandbox.thread_record(&thread)).is_empty(), "조각은 기록을 늘리지 않는다");
    host.shut_down();
}

#[test]
fn 조각은_33ms로_묶여_나가고_오프셋은_화면의_글자_단위로_이어진다() {
    let sandbox = Sandbox::new();
    let events = Events::default();
    let times = Arc::new(Mutex::new(Vec::new()));
    let (sink, stamps) = (events.clone(), Arc::clone(&times));
    let (host, thread) = thread_on_agent_emitting(&sandbox, "streams-steadily", move |event| {
        if matches!(event, HostEvent::ThreadChunk { .. }) {
            stamps.lock().unwrap().push(Instant::now());
        }
        sink.push(event);
    });
    wait_received(&sandbox, &thread);

    let chunks = wait_chunks(&events, &thread, &"가😀".repeat(12));

    assert!(chunks.len() < 12, "조각 12개가 묶이지 않았다: {chunks:#?}");
    let mut at = 0;
    for chunk in &chunks {
        assert_eq!(chunk.offset, at, "{chunks:#?}");
        at += chunk.text.encode_utf16().count();
    }
    assert_eq!(at, 36, "「가😀」는 UTF-16 세 단위다");
    let times = times.lock().unwrap();
    for pair in times.windows(2) {
        let gap = pair[1] - pair[0];
        assert!(gap >= Duration::from_millis(33), "33ms보다 잦게 나갔다: {gap:?}");
    }
    host.shut_down();
}

/// 부하를 흘리는 가짜 claude로 새 Thread를 세운다 — 첫 말이 곧 그 턴이다. 호스트가 낸 이벤트를 모은다.
fn thread_under_load(sandbox: &Sandbox, values: &[(&str, &str)]) -> (ConversationHost, String, Events) {
    let (builder, events) = sandbox.host_builder_with_events(sandbox.claude_login_shell("normal", values));
    let host = builder.build();
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread, events)
}

/// 가짜 claude가 부하를 다 흘리고 남긴 영수증 — 흘린 조각 수 · 메시지 수 · 걸린 밀리초.
fn load_receipt(sandbox: &Sandbox, thread: &str) -> Value {
    let path = sandbox.claude_receipts().join(format!("{}.stream", sandbox.thread_session_id(thread)));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    serde_json::from_str(text.trim()).expect("영수증은 JSON 한 줄이다")
}

#[test]
fn 조각_간격과_흘릴_시간을_주면_그동안_글이_조각으로_흐르고_완성_글이_기록_줄_하나로_남는다() {
    let sandbox = Sandbox::new();
    let started = Instant::now();
    let (host, thread, events) =
        thread_under_load(&sandbox, &[("FAKE_CLAUDE_STREAM_GAP_MS", "10"), ("FAKE_CLAUDE_STREAM_FOR_MS", "300")]);

    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);

    assert!(started.elapsed() >= Duration::from_millis(300), "흘릴 시간을 다 채우지 않았다: {:?}", started.elapsed());
    let lines = chunk_lines(&record);
    assert_eq!(lines.len(), 1, "{}", common::lines_text(&record));
    let text = lines[0]["payload"]["update"]["content"]["text"].as_str().expect("답 글");
    assert!(of_kind(&record, "stderr").is_empty(), "조각의 합과 완성 글이 같으면 경고가 없다: {}", common::lines_text(&record));
    // 마지막 묶음은 33ms가 차기 전에 기록 줄이 서면 조각으로 나가지 않는다.
    let chunks = events.thread_chunks(&thread);
    assert!(chunks.len() > 1, "한 번에 쏟지 않고 흘렸다: {chunks:#?}");
    assert!(text.starts_with(&joined(&chunks)), "흐른 글은 기록 글의 앞이다: {chunks:#?}");
    let receipt = load_receipt(&sandbox, &thread);
    assert_eq!(receipt["chunks"], 30, "{receipt}");
    assert_eq!(receipt["messages"], 1, "{receipt}");
    assert!(receipt["ms"].as_u64().unwrap() >= 290, "{receipt}");
    host.shut_down();
}

#[test]
fn 메시지_길이를_주면_흐르는_동안_기록_줄이_그만큼_선다() {
    let sandbox = Sandbox::new();
    let (host, thread, _events) = thread_under_load(
        &sandbox,
        &[
            ("FAKE_CLAUDE_STREAM_GAP_MS", "10"),
            ("FAKE_CLAUDE_STREAM_FOR_MS", "300"),
            ("FAKE_CLAUDE_STREAM_MESSAGE_MS", "100"),
        ],
    );

    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);

    let numbers: Vec<u64> =
        chunk_lines(&record).iter().map(|line| line["payload"]["update"]["_meta"]["atelier"]["stream"].as_u64().unwrap()).collect();
    assert_eq!(numbers.len(), 3, "{}", common::lines_text(&record));
    assert_eq!(numbers.iter().collect::<std::collections::BTreeSet<_>>().len(), 3, "메시지마다 다른 흐름이다");
    assert_eq!(load_receipt(&sandbox, &thread)["messages"], 3);
    host.shut_down();
}

#[test]
fn 글이_빈_생각도_흐름이_열렸다고_한_번_나간다() {
    let sandbox = Sandbox::new();
    let (host, thread, events) = watched_on_agent(&sandbox, "thinks-then-holds");
    wait_received(&sandbox, &thread);

    let chunks = wait_until("생각 조각이 나가지 않았다", || {
        let chunks = events.thread_chunks(&thread);
        if chunks.is_empty() {
            Err(String::new())
        } else {
            Ok(chunks)
        }
    });

    assert_eq!(chunks, [FlowChunk { stream: 1, kind: FlowKind::Thought, offset: 0, text: String::new(), discarded: false }]);
    assert_eq!(host.thread(&thread).unwrap().flowing, Some(chunks[0].clone()));
    host.shut_down();
}

#[test]
fn 조각은_그_흐름의_기록_줄보다_늘_먼저_나가고_기록_줄이_그_글을_잇는다() {
    let sandbox = Sandbox::new();
    let (host, thread, events) = watched_on_agent(&sandbox, "streams-steadily");
    wait_received(&sandbox, &thread);
    wait_chunks(&events, &thread, &"가😀".repeat(12));

    host.stop_thread(&thread).expect("멈추기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);

    let order = order_of(&events, &thread);
    let (last, chunks) = order.split_last().expect("조각과 기록 줄");
    assert_eq!(*last, (1, "기록"), "{order:?}");
    assert!(!chunks.is_empty() && chunks.iter().all(|one| *one == (1, "조각")), "{order:?}");
    assert_eq!(chunk_lines(&record)[0]["payload"]["update"]["content"]["text"], joined(&events.thread_chunks(&thread)));
    host.shut_down();
}

#[test]
fn 진행_중인_글은_오프셋_0의_조각으로_읽히고_기록_줄이_서면_없어진다() {
    let sandbox = Sandbox::new();
    let (host, thread, events) = watched_on_agent(&sandbox, "streams-then-holds");
    wait_received(&sandbox, &thread);

    // 화면에 나가기 전이든 뒤든 받은 글 전부다 — 새로 그린 화면은 이것에 다음 조각을 잇는다.
    let whole = Some(FlowChunk { stream: 1, kind: FlowKind::Message, offset: 0, text: "흐르던 답".to_owned(), discarded: false });
    assert_eq!(host.thread(&thread).unwrap().flowing, whole);
    wait_chunks(&events, &thread, "흐르던 답");
    assert_eq!(host.thread(&thread).unwrap().flowing, whole);

    host.stop_thread(&thread).expect("멈추기");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);

    assert_eq!(host.thread(&thread).unwrap().flowing, None);
    host.shut_down();
}
