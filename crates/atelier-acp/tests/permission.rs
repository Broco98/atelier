//! L1 — 대화 호스트 ↔ 가짜 ACP 에이전트: 권한 요청이 수신을 막지 않고, 답하면 턴이 이어지고, 멈추면 거둬진다(three-axes
//! 티켓 08 · 스토리 57 · 59 · 61 · 62 · 관문 G2).
//!
//! 시험은 호스트에 명령을 넣고, 나오는 이벤트 · `agents/` 기록 · 가짜가 남긴 영수증(받은 메시지 · 받은 답)만 본다.
//! 가짜의 권한 요청은 codex-acp 2.2.2 실측 G2(`workspace-write` 모드)의 모양이다 — 선택지 셋 · 요청 id 0.

mod common;

use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use atelier_acp::{Agent, HostError, HostEvent};
use common::{of_kind, payloads_of, sent_texts, Sandbox};
use serde_json::{json, Value};

/// 가짜가 묻는 명령(`fake-acp-agent`의 `PERMISSION_COMMAND`).
const COMMAND: &str = "printf 'g2' > /tmp/fake-outside/g2.txt";

/// 실측 G2의 선택지 셋 — 이름 · 종류 · 차례 그대로.
fn g2_options() -> Value {
    json!([
        {"optionId": "allow_once", "name": "Yes, proceed", "kind": "allow_once"},
        {"optionId": "accept_execpolicy_amendment",
         "name": format!("Yes, and don't ask again for commands that start with `{COMMAND}`"),
         "kind": "allow_always"},
        {"optionId": "cancel", "name": "No, and tell Codex what to do differently", "kind": "reject_once"}
    ])
}

/// `permission` 줄(물음) 뒤에 적힌 줄들의 kind.
fn kinds_after_asked(record: &[Value]) -> Vec<String> {
    record
        .iter()
        .skip_while(|line| line["kind"] != "permission")
        .skip(1)
        .map(|line| line["kind"].as_str().unwrap().to_owned())
        .collect()
}

/// 가짜가 요청 뒤에 보낸 update 둘(답을 기다리는 동안의 생각)까지 적혔다 — 수신 루프가 요청에 막히지 않았다.
fn asked_and_flowing(record: &[Value]) -> bool {
    kinds_after_asked(record).iter().filter(|kind| *kind == "update").count() >= 2
}

#[test]
fn asks_permission_요청이_걸린_동안에도_update가_적히고_선택지가_원문_그대로_permission_줄에_서고_답하면_턴이_이어진다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("asks-permission", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "워크트리 밖에 써 줘").expect("보내기");

    let record = sandbox.wait_record("cart", &conversation.id, asked_and_flowing);
    let asked = &payloads_of(&record, "permission")[0];
    assert_eq!(asked["state"], json!("asked"));
    assert_eq!(asked["requestId"], json!("0"), "codex-acp의 첫 권한 요청 id는 0이다 — 0을 없음으로 다루지 않는다");
    assert_eq!(
        asked["request"],
        json!({
            "sessionId": session_id,
            "toolCall": {"toolCallId": "exec-fake-perm", "title": "Run command",
                         "rawInput": {"command": format!("\"{COMMAND}\""), "cwd": "/tmp/fake-worktree"},
                         "kind": "execute", "status": "pending"},
            "options": g2_options(),
        }),
        "요청 원문 그대로다 — 선택지의 개수 · 이름 · 차례가 에이전트가 준 그대로"
    );
    assert!(of_kind(&record, "turn-end").is_empty(), "답하기 전에는 턴이 끝나지 않는다:\n{}", common::lines_text(&record));
    assert_eq!(common::emitted(&events, "cart", &conversation.id), record, "권한 줄도 같은 seq의 기록 줄 이벤트로 나간다");

    host.answer_permission("cart", &conversation.id, "0", "allow_once").expect("권한 답");

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    assert_eq!(
        payloads_of(&record, "permission"),
        [asked.clone(), json!({"requestId": "0", "state": "answered", "optionId": "allow_once"})],
        "고른 optionId가 그 요청의 답으로 적힌다"
    );
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("end_turn"), json!(false)));
    let after_answer: Vec<&str> = record
        .iter()
        .skip_while(|line| line["payload"]["state"] != "answered")
        .skip(1)
        .map(|line| line["payload"]["update"]["sessionUpdate"].as_str().unwrap_or(line["kind"].as_str().unwrap()))
        .collect();
    assert_eq!(after_answer, ["tool_call_update", "agent_message_chunk", "turn-end"], "답한 뒤에 도구가 끝나고 턴이 이어진다");
    assert_eq!(
        sandbox.acp_responses(&session_id),
        [json!({"jsonrpc": "2.0", "id": 0, "result": {"outcome": {"outcome": "selected", "optionId": "allow_once"}}})],
        "가짜가 받은 답 — 요청 id와 고른 optionId"
    );

    host.shut_down();
}

#[test]
fn 권한이_걸린_채_멈추면_가짜가_cancelled_답을_받고_거둬짐_턴이_끊김이_적히고_그_뒤의_답은_읽히는_오류다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("asks-permission", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "워크트리 밖에 써 줘").expect("보내기");
    sandbox.wait_record("cart", &conversation.id, asked_and_flowing);

    host.stop("cart", &conversation.id).expect("멈추기");

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    assert_eq!(
        payloads_of(&record, "permission")[1..],
        [json!({"requestId": "0", "state": "withdrawn", "reason": "stopped"})],
        "걸린 요청은 「거둬짐(턴이 끊김)」으로 닫힌다"
    );
    assert_eq!(
        &kinds_after_asked(&record)[2..],
        ["permission", "turn-end"],
        "거둬짐은 멈춘 턴의 끝보다 앞에 선다 — 진짜 codex-acp는 걸린 요청의 답을 기다리지 않고 곧바로 끝낸다(실측 G2):\n{}",
        common::lines_text(&record)
    );
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("cancelled"), json!(true)));
    sandbox.wait_acp_responses(&session_id, |responses| {
        responses == [json!({"jsonrpc": "2.0", "id": 0, "result": {"outcome": {"outcome": "cancelled"}}})]
    });
    assert_eq!(sandbox.acp_inbox(&session_id), ["session/prompt", "session/cancel"], "가짜가 받은 것 — 멈추기 하나");

    assert_eq!(
        host.answer_permission("cart", &conversation.id, "0", "allow_once"),
        Err(atelier_acp::HostError::PermissionClosed { conversation: conversation.id.clone(), request: "0".into() }),
        "거둬진 요청에 뒤늦게 준 답은 읽히는 오류다"
    );
    assert_eq!(payloads_of(&sandbox.record("cart", &conversation.id), "permission").len(), 2, "뒤늦은 답은 기록에 서지 않는다");
    assert_eq!(sandbox.acp_responses(&session_id).len(), 1, "뒤늦은 답은 에이전트에 가지 않는다");

    host.shut_down();
    // S26 — 대화창의 L3(티켓 20 · 21)가 카드의 멈추기 · 멈춘 줄의 「멈춤」을 이것으로 잰다.
    common::assert_record("permission-stopped", &common::fix_record(&record, &sandbox.data_root(), &session_id));
}

#[test]
fn 준_선택지에_없는_option_id는_읽히는_오류이고_요청은_남아_맞는_답을_다시_줄_수_있다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("asks-permission", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "워크트리 밖에 써 줘").expect("보내기");
    sandbox.wait_record("cart", &conversation.id, asked_and_flowing);

    assert_eq!(
        host.answer_permission("cart", &conversation.id, "0", "allow_always"),
        Err(atelier_acp::HostError::PermissionOption { request: "0".into(), option: "allow_always".into() }),
        "선택지의 종류 이름이 아니라 에이전트가 준 optionId로만 답한다"
    );
    assert_eq!(
        host.answer_permission("cart", &conversation.id, "1", "allow_once"),
        Err(atelier_acp::HostError::PermissionClosed { conversation: conversation.id.clone(), request: "1".into() }),
        "걸린 적 없는 요청 id"
    );
    let record = sandbox.record("cart", &conversation.id);
    assert_eq!(payloads_of(&record, "permission").len(), 1, "고르지 못한 답은 기록에 서지 않는다");
    assert!(sandbox.acp_responses(&session_id).is_empty(), "고르지 못한 답은 에이전트에 가지 않는다");

    host.answer_permission("cart", &conversation.id, "0", "cancel").expect("요청이 남아 있어 맞는 답이 간다");

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    assert_eq!(payloads_of(&record, "permission")[1], json!({"requestId": "0", "state": "answered", "optionId": "cancel"}));
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!(end["stopReason"], json!("end_turn"), "asks-permission의 거부는 그 도구만 실패시키고 턴이 이어진다");

    host.shut_down();
}

#[test]
fn 에이전트가_답을_기다리지_않고_턴을_끝내면_거둬짐_에이전트가_턴_끝_앞에_적히고_뒤늦은_답은_읽히는_오류다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("asks-permission", &[("FAKE_ACP_PERMISSION_WITHDRAWS", "1")]);
    let (host, _events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "워크트리 밖에 써 줘").expect("보내기");

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    assert_eq!(
        payloads_of(&record, "permission")[1..],
        [json!({"requestId": "0", "state": "withdrawn", "reason": "agent"})],
        "에이전트가 거둔 요청 — 우리가 멈춘 것과 까닭이 다르다"
    );
    assert_eq!(
        kinds_after_asked(&record),
        ["update", "update", "permission", "turn-end"],
        "거둬짐은 그 턴의 끝 바로 앞에 선다:\n{}",
        common::lines_text(&record)
    );
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("end_turn"), json!(false)));

    assert_eq!(
        host.answer_permission("cart", &conversation.id, "0", "allow_once"),
        Err(atelier_acp::HostError::PermissionClosed { conversation: conversation.id.clone(), request: "0".into() }),
        "에이전트가 거둔 요청에 뒤늦게 준 답은 읽히는 오류다"
    );
    sandbox.wait_acp_responses(&session_id, |responses| {
        responses == [json!({"jsonrpc": "2.0", "id": 0, "result": {"outcome": {"outcome": "cancelled"}}})]
    });

    host.shut_down();
    // S26 — 대화창의 L3(티켓 21)가 에이전트가 거둔 요청의 카드가 걷히는지를 이것으로 잰다.
    common::assert_record("permission-withdrawn", &common::fix_record(&record, &sandbox.data_root(), &session_id));
}

#[test]
fn deny_cancels_거부하면_turn_end가_cancelled이고_우리가_멈춤이_false다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("deny-cancels", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "워크트리 밖에 써 줘").expect("보내기");
    sandbox.wait_record("cart", &conversation.id, asked_and_flowing);

    host.answer_permission("cart", &conversation.id, "0", "cancel").expect("거부");

    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!(end["stopReason"], json!("cancelled"), "codex-acp는 거부 선택지에도 턴을 cancelled로 끝낸다(실측 G2)");
    assert_eq!(end["cancelledByUs"], json!(false), "우리가 cancel을 보내지 않았다 — 사람의 멈춤과 갈린다(워크플로 함정 14 · S24)");
    assert_eq!(sandbox.acp_inbox(&session_id), ["session/prompt"], "멈추기는 가지 않았다");
    let failed = &of_kind(&record, "update").last().unwrap()["payload"]["update"];
    assert_eq!(
        (failed["sessionUpdate"].clone(), failed["status"].clone()),
        (json!("tool_call_update"), json!("failed")),
        "거부한 도구가 실패로 닫힌 뒤에 턴이 끝난다"
    );

    host.shut_down();
}

#[test]
fn 턴_밖에서_걸린_권한도_대기_줄을_붙잡고_답하는_자리에서_대기_줄이_간다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 턴을 먼저 끝내고 권한을 묻는다 — 턴 밖에서 걸린 권한이다(에이전트가 스스로 이어 가는 일, 구현 스펙 S4).
    let shell = sandbox.codex_login_shell("asks-permission", &[("FAKE_ACP_PERMISSION_OUT_OF_TURN", "1")]);
    let (host, events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    host.send("cart", &conversation.id, "첫 말").expect("첫 말");
    let record = sandbox.wait_record("cart", &conversation.id, asked_and_flowing);
    let kinds: Vec<&str> = record.iter().map(|line| line["kind"].as_str().unwrap()).collect();
    let ended = kinds.iter().position(|kind| *kind == "turn-end");
    let asked = kinds.iter().position(|kind| *kind == "permission");
    assert!(
        matches!((ended, asked), (Some(ended), Some(asked)) if ended < asked),
        "턴이 끝난 뒤에 물었다:\n{}",
        common::lines_text(&record)
    );

    host.send("cart", &conversation.id, "둘째 말").expect("걸린 권한이 있으면 턴이 쉬어도 대기 줄에 든다");

    assert_eq!(events.queue_texts("cart", &conversation.id), [vec!["둘째 말"]]);
    assert_eq!(sandbox.acp_prompts(&session_id).len(), 1, "걸린 동안에는 에이전트에 가지 않는다");

    host.answer_permission("cart", &conversation.id, "0", "allow_once").expect("권한 답");

    // 둘째 말의 일도 권한을 묻는다 — 그 물음까지 적히면 가짜가 둘째 말을 받은 것이다.
    let record = sandbox.wait_kind("cart", &conversation.id, "permission", 3);
    assert_eq!(sent_texts(&record), ["첫 말", "둘째 말"], "걸림이 풀린 자리에서 대기 말이 간다");
    assert_eq!(sandbox.acp_prompts(&session_id).len(), 2);
    assert_eq!(events.queue_texts("cart", &conversation.id).last(), Some(&Vec::<String>::new()));

    host.shut_down();
}

/// **닫기와 엇갈린 권한 답은 닫기 앞에 서거나 물러난다 — 닫기 전에 그 대화를 찾아 두었어도.** 닫기는 떠 있는 표에서 대화를
/// 꺼낸 뒤 에이전트를 끄는데(1초 한도), 꺼낸 뒤로는 명령이 그 대화에 닿지 않는 것에 기댄다 — 닫히는 대화에 권한 답 · 보낸 말이
/// 끼지 않게. 바꾸기(첫 말이 없음을 확인한 뒤 옛 엔진을 끈다)도 같은 것에 기댄다. 그래서 답은 둘 가운데 하나다: 닫기보다 먼저
/// 대화를 쥐어 에이전트가 그 답을 받거나, 닫힌 요청으로 거절되고 기록에 아무것도 남기지 않는다. 끄기 시작한 에이전트에 보내다
/// 끊기는 일(기록에는 답했다고 적히고 에이전트는 못 받는다)은 없다.
///
/// 틈을 붙잡아 잰다: 대기 말 고치기가 대화의 잠금을 쥔 채 대기 줄 바뀜을 내는 자리에서 이벤트를 붙들어 두면, 그 뒤에 온 권한 답은
/// 대화를 찾은 채 그 잠금을 기다린다. 그 사이 닫기가 대화를 꺼낸 뒤 이벤트를 놓는다. 가짜는 stdin이 닫혀도 남아 끄기가 1초 한도를
/// 다 쓴다 — 닫기가 대화를 쥐기 전에 끄기부터 시작하면 권한 답은 끄는 사이에 닿는다.
#[test]
fn 닫기와_엇갈린_권한_답은_찾아_둔_대화라도_닫기_앞에_서거나_물러나고_끄는_에이전트에_닿다_끊기지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell(
        "asks-permission",
        &[("FAKE_ACP_PERMISSION_OUT_OF_TURN", "1"), ("FAKE_ACP_LINGERS", "1")],
    );
    let events = common::Events::default();
    let (held, holding) = mpsc::channel::<()>();
    let (release, released) = mpsc::channel::<()>();
    let released = Mutex::new(released);
    let sink = events.clone();
    let host = Arc::new(
        sandbox
            .host_builder(shell, move |event| {
                let edited = matches!(&event, HostEvent::Queue { queue, .. }
                    if queue.iter().map(|queued| queued.text.as_str()).eq(["둘째 말 고침"]));
                sink.push(event);
                if edited {
                    held.send(()).unwrap();
                    released.lock().unwrap().recv_timeout(common::PATIENCE).expect("붙든 이벤트를 놓지 않았다");
                }
            })
            .build(),
    );
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let id = conversation.id.clone();
    let session_id = sandbox.agent_session_id("cart", &id);
    host.send("cart", &id, "첫 말").expect("첫 말");
    sandbox.wait_record("cart", &id, asked_and_flowing);
    host.send("cart", &id, "둘째 말").expect("걸린 권한이 있으면 대기 줄에 든다");
    let queued = events.queues("cart", &id).last().expect("대기 줄 바뀜")[0].id.clone();

    // 대기 말 고치기가 대화의 잠금을 쥔 채 붙들린다.
    let editing = std::thread::spawn({
        let (host, id) = (Arc::clone(&host), id.clone());
        move || host.edit_queued("cart", &id, &queued, "둘째 말 고침")
    });
    holding.recv_timeout(common::PATIENCE).expect("대기 말 고치기가 대기 줄 바뀜을 내지 않았다");
    // 권한 답이 대화를 찾고 그 잠금을 기다린다.
    let answering = std::thread::spawn({
        let (host, id) = (Arc::clone(&host), id.clone());
        move || host.answer_permission("cart", &id, "0", "allow_once")
    });
    std::thread::sleep(Duration::from_millis(300));
    // 닫기가 대화를 꺼낸다.
    let closing = std::thread::spawn({
        let (host, id) = (Arc::clone(&host), id.clone());
        move || host.close_conversation("cart", &id)
    });
    std::thread::sleep(Duration::from_millis(300));
    release.send(()).unwrap();

    editing.join().unwrap().expect("대기 말 고치기");
    let answered = answering.join().unwrap();
    closing.join().unwrap().expect("닫기");
    let record = sandbox.record("cart", &id);
    match &answered {
        // 닫기 앞에 섰다 — 에이전트가 그 답을 받았다.
        Ok(()) => assert_eq!(
            sandbox.acp_responses(&session_id),
            [json!({"jsonrpc": "2.0", "id": 0, "result": {"outcome": {"outcome": "selected", "optionId": "allow_once"}}})],
            "답했다고 했는데 에이전트가 못 받았다:\n{}",
            common::lines_text(&record)
        ),
        // 물러났다 — 닫히는 대화에 답 줄도 대기 말도 끼지 않았다.
        Err(HostError::PermissionClosed { .. }) => {
            assert!(
                !payloads_of(&record, "permission").iter().any(|payload| payload["state"] == "answered"),
                "닫히는 대화에 권한 답 줄이 끼었다:\n{}",
                common::lines_text(&record)
            );
            assert_eq!(sent_texts(&record), ["첫 말"], "닫히는 대화에 대기 말이 보내졌다:\n{}", common::lines_text(&record));
        }
        Err(error) => panic!("끄기 시작한 에이전트에 권한 답이 닿았다 — {error}:\n{}", common::lines_text(&record)),
    }
    assert_eq!(record.last().unwrap()["kind"], "session", "닫힘 줄이 끝이다:\n{}", common::lines_text(&record));

    host.shut_down();
}

#[test]
fn 빈_tool_call의_권한_요청은_앞선_tool_call의_제목_종류_입력으로_채운_도구_요지가_서고_원문은_그대로다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // codex의 MCP 승인 모양 — 요청의 toolCall에 id · 종류 · 상태만 온다(워크플로 G12 · S21).
    let shell = sandbox.codex_login_shell("asks-permission", &[("FAKE_ACP_PERMISSION_TOOL_CALL", "bare")]);
    let (host, _events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    host.send("cart", &conversation.id, "워크트리 밖에 써 줘").expect("보내기");

    let record = sandbox.wait_record("cart", &conversation.id, asked_and_flowing);
    let asked = &payloads_of(&record, "permission")[0];
    assert_eq!(
        asked["request"]["toolCall"],
        json!({"toolCallId": "exec-fake-perm", "kind": "execute", "status": "pending"}),
        "요청 원문은 받은 그대로다"
    );
    assert_eq!(
        asked["toolCall"],
        json!({"toolCallId": "exec-fake-perm", "kind": "execute", "status": "pending",
               "title": COMMAND, "rawInput": {"command": COMMAND, "cwd": "/tmp/fake-worktree"}}),
        "도구 요지는 같은 id의 앞선 tool_call에서 제목 · 입력을 채운다 — 온 칸(종류 · 상태)은 그대로"
    );
    assert_eq!(asked["request"]["options"], g2_options(), "선택지는 받은 그대로다(개수 · 이름 · 차례)");

    host.shut_down();
}

/// 권한 시나리오 하나를 끝까지 몰고 고정값으로 바꾼 기록을 돌려준다 — 걸린 동안의 update 둘이 적힌 것을 본 뒤 답한다
/// (줄 순서를 고정한다).
fn permission_record(scenario: &str, option: &str) -> Vec<Value> {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 진짜 codex-acp처럼 로그인된 계정을 알린다 — 자료에도 가린 꼴로 선다.
    let shell = sandbox.codex_login_shell(scenario, &[("FAKE_ACP_ACCOUNT_EMAIL", "someone@example.com")]);
    let (host, _events) = sandbox.host_with_events(shell);
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    host.send("cart", &conversation.id, "워크트리 밖에 g2.txt를 써 줘").expect("보내기");
    sandbox.wait_record("cart", &conversation.id, asked_and_flowing);
    host.answer_permission("cart", &conversation.id, "0", option).expect("권한 답");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    host.shut_down();
    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    common::fix_record(&record, &sandbox.data_root(), &session_id)
}

/// S26 — 「권한」(묻고 · 걸린 동안에도 흐르고 · 허락하면 이어 가는 턴)의 결과 기록이 검사 자료로 서고, 매번 다시 지은 기록이
/// 그것과 같다. 대화창의 L3 목업 백엔드(티켓 21)가 이 파일을 그대로 쏜다 — 답하지 않은 물음이 입력창 자리에 승인 카드로
/// 서고, 선택지가 기록의 것 그대로 보이고, 답 줄이 오면 걷히는지.
#[test]
fn 권한의_기록이_검사_자료와_같다() {
    common::assert_record("permission", &permission_record("asks-permission", "allow_once"));
}

/// S26 — 「Codex 거부」(거부 선택지가 턴을 `cancelled`로 끝내고 우리가 멈추지 않았다)의 결과 기록. 21의 L3가 거부 머리줄
/// (S24 「거부해서 멈췄어요」)을 이것으로 잰다.
#[test]
fn codex_거부의_기록이_검사_자료와_같다() {
    common::assert_record("permission-deny", &permission_record("deny-cancels", "cancel"));
}
