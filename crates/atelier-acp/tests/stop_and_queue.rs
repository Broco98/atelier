//! L1 — 대화 호스트 ↔ 가짜 ACP 에이전트: 턴을 멈추고, 도는 동안의 말은 대기 줄에 쌓이고, 「지금 보내기」가 멈추고
//! 보낸다(three-axes 티켓 07 · 스토리 49~55 · 결정 20 · 28).
//!
//! 시험은 호스트에 명령을 넣고, 나오는 이벤트 · `agents/` 파일 · 가짜가 남긴 영수증(받은 메시지의 차례)만 본다.

mod common;

use atelier_acp::{Agent, HostError, HostEvent, QueuedMessage};
use common::{of_kind, Sandbox};
use serde_json::json;

#[test]
fn long_turn_도중_멈추면_가짜가_cancel을_받고_turn_end가_cancelled이고_우리가_멈춤이고_다음_말이_같은_세션에서_돈다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("long-turn", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "오래 걸리는 일").expect("첫 말");
    sandbox.wait_kind("cart", &conversation.id, "update", 1);

    host.stop("cart", &conversation.id).expect("멈추기");

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!(end["stopReason"], json!("cancelled"));
    assert_eq!(end["cancelledByUs"], json!(true), "우리가 cancel을 보낸 턴이다 — 거부의 cancelled와 가른다(S24)");
    assert_eq!(sandbox.acp_inbox(&session_id), ["session/prompt", "session/cancel"], "가짜가 받은 것");

    host.stop("cart", &conversation.id).expect("쉬는 대화의 멈추기는 아무 일도 하지 않는다");
    host.send("cart", &conversation.id, "다음 말").expect("멈춘 뒤의 말");
    sandbox.wait_kind("cart", &conversation.id, "update", 2);
    assert_eq!(
        sandbox.acp_inbox(&session_id),
        ["session/prompt", "session/cancel", "session/prompt"],
        "쉬는 동안의 멈추기는 가지 않고, 다음 말은 같은 프로세스의 같은 세션이 받는다"
    );
    let prompts = sandbox.acp_prompts(&session_id);
    assert_eq!(prompts[1]["sessionId"], json!(session_id));
    assert_eq!(prompts[1]["prompt"], json!([{"type": "text", "text": "다음 말"}]), "머리말은 다시 붙지 않는다 — 같은 세션이다");

    host.shut_down();
}

/// `late-update-after-cancel`이 cancel 뒤에 늦게 보내는 도구 update — 가짜가 쓴 그대로를 손으로 옮겼다(실측
/// `codex-acp-2.2.2-cancel-late-updates.jsonl` 37 · 38줄의 모양).
fn late_updates(session_id: &str) -> Vec<serde_json::Value> {
    [
        json!({"sessionUpdate": "tool_call_update", "toolCallId": "exec-fake-late",
               "_meta": {"terminal_output_delta": {"data": "slept-fake\n", "terminal_id": "exec-fake-late"}}}),
        json!({"sessionUpdate": "tool_call_update", "toolCallId": "exec-fake-late", "name": "exec_command",
               "status": "completed",
               "_meta": {"terminal_exit": {"exit_code": 0, "signal": null, "terminal_id": "exec-fake-late"}}}),
    ]
    .into_iter()
    .map(|update| json!({"sessionId": session_id, "update": update}))
    .collect()
}

#[test]
fn 멈춘_뒤에_늦게_온_도구_update가_턴_끝_뒤에_턴_밖_update_줄로_원문_그대로_적힌다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("late-update-after-cancel", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "20초 걸리는 명령을 돌려 줘").expect("보내기");
    // 답 조각과 명령 도구 줄(진행)이 선 뒤에 멈춘다.
    sandbox.wait_kind("cart", &conversation.id, "update", 2);

    host.stop("cart", &conversation.id).expect("멈추기");

    let record = sandbox.wait_kind("cart", &conversation.id, "update", 4);
    let after_sent: Vec<_> =
        record.iter().skip_while(|line| line["kind"] != "sent").skip(1).map(|line| line["kind"].clone()).collect();
    assert_eq!(
        after_sent,
        [json!("update"), json!("update"), json!("turn-end"), json!("update"), json!("update")],
        "늦은 update는 cancelled 턴 끝 뒤에 선다:\n{}",
        common::lines_text(&record)
    );
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("cancelled"), json!(true)));
    let late: Vec<_> = record.iter().rev().take(2).rev().map(|line| line["payload"].clone()).collect();
    assert_eq!(late, late_updates(&session_id), "런타임이 원문 그대로 넘기고 호스트가 그대로 적는다");
    let opened_tool = &of_kind(&record, "update")[1]["payload"]["update"];
    assert_eq!(
        (opened_tool["sessionUpdate"].clone(), opened_tool["toolCallId"].clone()),
        (json!("tool_call"), json!("exec-fake-late")),
        "늦은 update는 cancel 때 열려 있던 그 도구 줄의 것이다 — 화면이 그 줄에 붙인다(결정 28)"
    );
    assert_eq!(common::emitted(&events, "cart", &conversation.id), record, "턴 밖 update도 같은 seq의 기록 줄 이벤트로 나간다");

    host.shut_down();
}

/// 그 대화의 대기 줄 바뀜 이벤트들 — 이벤트마다 대기 줄의 글들.
fn queue_texts(events: &common::Events, slug: &str, id: &str) -> Vec<Vec<String>> {
    queue_events(events, slug, id)
        .into_iter()
        .map(|queue| queue.into_iter().map(|queued| queued.text).collect())
        .collect()
}

fn queue_events(events: &common::Events, slug: &str, id: &str) -> Vec<Vec<QueuedMessage>> {
    events
        .all()
        .into_iter()
        .filter_map(|event| match event {
            HostEvent::Queue { work, conversation, queue } if work == slug && conversation == id => Some(queue),
            _ => None,
        })
        .collect()
}

/// 대화 목록에 실린 그 대화의 대기 줄.
fn listed_queue(host: &atelier_acp::ConversationHost, slug: &str, id: &str) -> Vec<QueuedMessage> {
    host.list_conversations(slug)
        .expect("대화 목록")
        .into_iter()
        .find(|conversation| conversation.id == id)
        .expect("목록에 그 대화가 있다")
        .queue
}

/// 기록의 `sent` 줄들이 화면에 보일 글.
fn sent_texts(record: &[serde_json::Value]) -> Vec<String> {
    of_kind(record, "sent").iter().map(|line| line["payload"]["text"].as_str().unwrap().to_owned()).collect()
}

#[test]
fn 턴이_도는_동안_보낸_말_둘이_대기_줄에_들어_이벤트와_목록에_서고_턴이_끝나면_차례로_간다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 첫 턴을 검사가 놓을 때까지 붙잡는다. 놓은 뒤의 턴은 곧바로 끝난다.
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("pauses-mid-turn", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "첫 말").expect("첫 말");
    sandbox.wait_kind("cart", &conversation.id, "update", 1);

    host.send("cart", &conversation.id, "둘째 말").expect("도는 동안의 말은 대기 줄에 든다");
    host.send("cart", &conversation.id, "셋째 말").expect("도는 동안의 말은 대기 줄에 든다");

    assert_eq!(queue_texts(&events, "cart", &conversation.id), [vec!["둘째 말"], vec!["둘째 말", "셋째 말"]]);
    let queue = listed_queue(&host, "cart", &conversation.id);
    assert_eq!(queue, queue_events(&events, "cart", &conversation.id)[1], "목록의 대기 줄이 마지막 이벤트와 같다");
    assert!(queue.iter().all(|queued| !queued.send_now) && queue[0].id != queue[1].id, "{queue:?}");
    assert_eq!(sent_texts(&sandbox.record("cart", &conversation.id)), ["첫 말"], "대기 줄은 기록에 없다(메모리에만 둔다)");
    assert_eq!(sandbox.acp_prompts(&session_id).len(), 1, "도는 동안에는 에이전트에 가지 않는다");

    sandbox.release_turn(&session_id);

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 3);
    let kinds: Vec<&str> = record.iter().map(|line| line["kind"].as_str().unwrap()).skip_while(|kind| *kind != "sent").collect();
    let one_turn = ["sent", "update", "update", "turn-end"];
    assert_eq!(kinds, one_turn.repeat(3), "앞 턴이 끝난 뒤에 다음 말이 간다:\n{}", common::lines_text(&record));
    assert_eq!(sent_texts(&record), ["첫 말", "둘째 말", "셋째 말"]);
    assert!(of_kind(&record, "sent").iter().all(|line| line["payload"]["sendNow"] == json!(false)));
    let prompts: Vec<_> = sandbox.acp_prompts(&session_id).into_iter().map(|prompt| prompt["prompt"].clone()).collect();
    assert_eq!(
        prompts[1..],
        [json!([{"type": "text", "text": "둘째 말"}]), json!([{"type": "text", "text": "셋째 말"}])],
        "대기 줄의 말도 같은 세션의 다음 말이라 머리말이 없다"
    );
    assert_eq!(
        queue_texts(&events, "cart", &conversation.id)[2..],
        [vec!["셋째 말"], vec![]],
        "하나씩 갈 때마다 대기 줄 바뀜이 난다"
    );
    assert_eq!(listed_queue(&host, "cart", &conversation.id), []);

    host.shut_down();
}

#[test]
fn 대기_줄의_말을_대기_id로_고치고_지우면_대기_줄과_이벤트에_서고_턴이_끝나면_고친_글이_간다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("pauses-mid-turn", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "첫 말").expect("첫 말");
    sandbox.wait_kind("cart", &conversation.id, "update", 1);
    for text in ["가", "나", "다"] {
        host.send("cart", &conversation.id, text).expect("대기 줄에 든다");
    }
    let queue = listed_queue(&host, "cart", &conversation.id);

    host.edit_queued("cart", &conversation.id, &queue[1].id, "나를 고쳤다").expect("고치기");
    host.delete_queued("cart", &conversation.id, &queue[0].id).expect("지우기");

    assert_eq!(
        queue_texts(&events, "cart", &conversation.id)[3..],
        [vec!["가", "나를 고쳤다", "다"], vec!["나를 고쳤다", "다"]],
        "고치기 · 지우기마다 대기 줄 바뀜이 난다"
    );
    let after = listed_queue(&host, "cart", &conversation.id);
    assert_eq!(
        after,
        [
            QueuedMessage { id: queue[1].id.clone(), text: "나를 고쳤다".into(), send_now: false },
            queue[2].clone(),
        ],
        "고쳐도 대기 id와 차례는 그대로다"
    );
    assert_eq!(
        host.delete_queued("cart", &conversation.id, &queue[0].id),
        Err(HostError::QueuedNotFound(queue[0].id.clone())),
        "지운 말은 다시 고르지 못한다"
    );
    assert_eq!(
        host.edit_queued("cart", &conversation.id, "no-such-queued", "글"),
        Err(HostError::QueuedNotFound("no-such-queued".into()))
    );
    assert_eq!(queue_events(&events, "cart", &conversation.id).len(), 5, "고르지 못한 고치기 · 지우기는 대기 줄을 바꾸지 않는다");

    sandbox.release_turn(&session_id);

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 3);
    assert_eq!(sent_texts(&record), ["첫 말", "나를 고쳤다", "다"]);
    let prompts = sandbox.acp_prompts(&session_id);
    assert_eq!(prompts[1]["prompt"], json!([{"type": "text", "text": "나를 고쳤다"}]), "에이전트에도 고친 글이 간다");

    host.shut_down();
}

#[test]
fn 지금_보내기는_cancel_cancelled_그_말의_prompt_순이고_sent에_지금_보내기로_남고_나머지_대기_줄은_그_뒤에_간다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 첫 턴만 cancel이 올 때까지 돈다. 그 뒤의 턴은 곧바로 끝난다.
    let shell = sandbox.codex_login_shell("long-turn", &[("FAKE_ACP_LONG_TURNS", "1")]);
    let (host, events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "첫 말").expect("첫 말");
    sandbox.wait_kind("cart", &conversation.id, "update", 1);
    for text in ["가", "나", "다"] {
        host.send("cart", &conversation.id, text).expect("대기 줄에 든다");
    }
    let queue = listed_queue(&host, "cart", &conversation.id);
    assert_eq!(
        host.send_now("cart", &conversation.id, "no-such-queued"),
        Err(HostError::QueuedNotFound("no-such-queued".into()))
    );
    assert_eq!(sandbox.acp_inbox(&session_id), ["session/prompt"], "고르지 못한 지금 보내기는 멈추지 않는다");

    host.send_now("cart", &conversation.id, &queue[2].id).expect("지금 보내기");

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 4);
    assert_eq!(
        sandbox.acp_inbox(&session_id),
        ["session/prompt", "session/cancel", "session/prompt", "session/prompt", "session/prompt"],
        "멈추기가 먼저 가고, 말은 그 뒤에 간다"
    );
    let ends = of_kind(&record, "turn-end");
    assert_eq!(
        (ends[0]["payload"]["stopReason"].clone(), ends[0]["payload"]["cancelledByUs"].clone()),
        (json!("cancelled"), json!(true))
    );
    let seq_of = |line: &serde_json::Value| line["seq"].as_u64().unwrap();
    let sent = of_kind(&record, "sent");
    assert!(seq_of(ends[0]) < seq_of(sent[1]), "그 말은 cancelled 턴 끝을 받은 뒤에 간다:\n{}", common::lines_text(&record));
    assert_eq!(sent_texts(&record), ["첫 말", "다", "가", "나"], "지금 보낸 말이 먼저, 나머지 대기 줄은 그 뒤 차례로");
    let send_now: Vec<_> = sent.iter().map(|line| line["payload"]["sendNow"].clone()).collect();
    assert_eq!(send_now, [json!(false), json!(true), json!(false), json!(false)], "sent의 「지금 보내기였는지」");
    assert_eq!(sandbox.acp_prompts(&session_id)[1]["prompt"], json!([{"type": "text", "text": "다"}]));
    assert_eq!(
        queue_events(&events, "cart", &conversation.id)[3],
        [QueuedMessage { send_now: true, ..queue[2].clone() }, queue[0].clone(), queue[1].clone()],
        "지금 보낸 말은 멈춤을 기다리는 동안 맨 앞에 「지금 보내기」로 선다"
    );
    assert_eq!(queue_texts(&events, "cart", &conversation.id)[4..], [vec!["가", "나"], vec!["나"], vec![]]);

    host.shut_down();
}

#[test]
fn 호스트를_다시_지으면_대기_줄은_비어_있고_대기_말은_기록에_남지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("long-turn", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    host.send("cart", &conversation.id, "첫 말").expect("첫 말");
    sandbox.wait_kind("cart", &conversation.id, "update", 1);
    host.send("cart", &conversation.id, "대기 말 하나").expect("대기 줄에 든다");
    host.send("cart", &conversation.id, "대기 말 둘").expect("대기 줄에 든다");
    let queue = listed_queue(&host, "cart", &conversation.id);
    assert_eq!(queue.len(), 2);

    // 앱을 끄고 다시 켠 꼴 — 에이전트를 찾을 PATH도 없다.
    host.shut_down();
    let reopened = sandbox.host(atelier_acp::ShellSource::Path(sandbox.login_shell(common::LoginShell::Normal, &[])));

    assert_eq!(listed_queue(&reopened, "cart", &conversation.id), [], "대기 줄은 메모리에만 있다(S13)");
    assert_eq!(
        reopened.delete_queued("cart", &conversation.id, &queue[0].id),
        Err(HostError::QueuedNotFound(queue[0].id.clone()))
    );
    let text = std::fs::read_to_string(sandbox.record_path("cart", &conversation.id)).unwrap();
    assert!(!text.contains("대기 말"), "보내지 못한 대기 말은 기록에 없다:\n{text}");
}

/// S26 — 「멈춘 뒤 늦은 줄」(Codex의 돌던 명령이 cancel 뒤에 출력과 끝을 늦게 보낸다)의 결과 기록이 검사 자료로 서고,
/// 매번 다시 지은 기록이 그것과 같다. 대화창의 L3 목업 백엔드(티켓 20)가 이 파일을 그대로 쏜다 — 열려 있던 도구 줄이
/// 「멈춘 뒤에도 도는 중」으로 남고 늦은 출력이 그 줄에 붙는지.
#[test]
fn 멈춘_뒤_늦은_줄의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 진짜 codex-acp처럼 로그인된 계정을 알린다 — 자료에도 가린 꼴로 선다.
    let shell =
        sandbox.codex_login_shell("late-update-after-cancel", &[("FAKE_ACP_ACCOUNT_EMAIL", "someone@example.com")]);
    let (host, _events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    host.send("cart", &conversation.id, "20초 걸리는 명령을 돌려 줘").expect("보내기");
    sandbox.wait_kind("cart", &conversation.id, "update", 2);
    host.stop("cart", &conversation.id).expect("멈추기");
    let record = sandbox.wait_kind("cart", &conversation.id, "update", 4);
    host.shut_down();

    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    common::assert_record("late-after-cancel", &common::fix_record(&record, &sandbox.data_root(), &session_id));
}
