//! L1 — Work 하나에서 파일을 고치는 Session은 하나다(v1 티켓 18 · 구현 스펙 §10 · S20). 같은 Work에 이은 채팅 둘이 경쟁할 때, 편집을
//! 허락받은 Session이 쓰기 자리를 쥐고 그 턴이 끝나면 놓는다. 그동안 다른 채팅의 편집 요청은 사람에게 묻지 않고 「「<채팅 이름>」 Thread가
//! 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요」로 거절된다. 명령은 쥐지도 막히지도 않는다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 기록(`events.jsonl`) · 가짜 claude의 영수증(stdin 줄)만 본다. 쥔 Session이 턴을 이어 가게
//! 하려고, 편집을 허락받은 Session이 턴 끝머리에서 Work 밖 Project를 고치려 한다(`FAKE_CLAUDE_MCP_CALL`의 `"at": "result"`) — 카드에
//! 사람이 답할 때까지 그 턴은 돈다. 채팅마다 다른 녹음과 카드는 뜬 차례로 가른다(`FAKE_CLAUDE_LAUNCH_FIXTURES` · `"launch"`).

mod common;

use atelier_acp::{ConversationHost, ProjectChoice, ThreadLink};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\n---\n\n너는 시험 Thread의 Host다.\n";

/// 고치는 채팅의 첫 말 — 그 채팅의 이름이 된다.
const FIXING: &str = "장바구니 수량을 고쳐 줘";

/// 같은 Work의 다른 채팅의 첫 말.
const OTHER: &str = "장바구니 문서를 고쳐 줘";

/// 다른 채팅에서 거절된 Session이 받는 글 — 주인은 그 채팅의 이름으로 부른다.
const FIXING_HOLDS: &str = "「장바구니 수량을 고쳐 줘」 Thread가 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요";

/// 녹음 — 파일 쓰기(`Write`)를 묻는 턴 둘. 경로는 각자의 작업 폴더(Work `cart`의 worktree)로 옮긴다 — 원문의 경로는 Work 밖이라 판정이
/// 묻지 않고 거절한다(v1 티켓 22).
const WRITES: &str = "2.1.309/permission-stdio";

/// 녹음 — 명령(`Bash`)을 묻는 턴.
const RUNS: &str = "2.1.309/g4-background";

/// 시험의 자리 — Library의 `host.md`와, Project 하나에 worktree가 선 Work `cart`와, 그 Work 밖에 등록된 Project `api`.
fn sandbox() -> Sandbox {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.work("cart", &["fe"]);
    sandbox.register_project("api");
    sandbox
}

/// 그 차례로 뜬 채팅의 턴 끝머리 — Work 밖 Project를 고치려 해 카드의 답을 기다린다.
fn holds_turn(launch: usize) -> Value {
    json!({"launch": launch, "at": "result", "tool": "start_editing", "arguments": {"project": "api", "reason": "API도 고쳐야 해요"}})
}

/// 채팅마다 뜬 차례대로 되감을 녹음과, 턴 끝머리에서 카드를 세워 기다릴 채팅들의 차례.
fn shell(sandbox: &Sandbox, fixtures: [&str; 2], holding: &[usize]) -> atelier_acp::ShellSource {
    let fixtures = json!(fixtures).to_string();
    let holds = Value::from_iter(holding.iter().map(|launch| holds_turn(*launch))).to_string();
    sandbox.claude_login_shell(
        "normal",
        &[
            ("FAKE_CLAUDE_LAUNCH_FIXTURES", &fixtures),
            ("FAKE_CLAUDE_MCP_CALL", &holds),
            ("FAKE_CLAUDE_REBASE", common::RECORDED_PLACE),
        ],
    )
}

fn in_cart() -> ThreadLink {
    ThreadLink::Work { slug: "cart".into() }
}

/// 그 채팅의 `permission` 줄들.
fn permissions(record: &[Value]) -> Vec<&Value> {
    of_kind(record, "permission")
}

/// 권한 줄 가운데 그 상태인 것이 나올 때까지 기다린다 — 그 줄.
fn wait_permission(sandbox: &Sandbox, thread: &str, state: &str) -> Value {
    let record = sandbox.wait_thread_record(thread, |record| {
        permissions(record).iter().any(|line| line["payload"]["state"] == state)
    });
    permissions(&record).into_iter().find(|line| line["payload"]["state"] == state).cloned().expect("기다린 줄")
}

/// 사람이 그 물음을 그 선택지로 답한다.
fn answer(host: &ConversationHost, thread: &str, asked: &Value, option: &str) {
    let request = asked["payload"]["requestId"].as_str().expect("요청 id");
    host.answer_thread_permission(thread, request, option).expect("사람의 답");
}

/// 그 Session의 claude가 받은 권한 답(`can_use_tool`의 답)들.
fn decisions(sandbox: &Sandbox, session: &str) -> Vec<Value> {
    sandbox
        .claude_stdin(session)
        .into_iter()
        .filter(|line| line["type"] == "control_response")
        .map(|line| line["response"]["response"].clone())
        .collect()
}

/// 그 채팅이 턴 끝머리의 카드를 세울 때까지 기다린다 — 그 물음의 요청 id.
fn wait_card(sandbox: &Sandbox, thread: &str) -> String {
    let asked = |line: &&Value| line["payload"]["state"] == "asked";
    let record = sandbox.wait_thread_record(thread, |record| of_kind(record, "question").iter().any(|line| asked(line)));
    let card = of_kind(&record, "question").into_iter().find(|line| asked(line)).cloned().expect("기다린 줄");
    card["payload"]["requestId"].as_str().expect("요청 id").to_owned()
}

/// 채팅을 열어 편집을 묻고, 사람이 허락해 쓰기 자리를 쥔다. 턴 끝머리의 카드가 설 때까지 기다린다 — 그 채팅과 카드의 요청 id.
fn writes(sandbox: &Sandbox, host: &ConversationHost, said: &str) -> (String, String) {
    let thread = host.start_thread(said, in_cart()).expect("Work에 이은 채팅의 첫 말");
    let asked = wait_permission(sandbox, &thread, "asked");
    assert_eq!(asked["payload"]["toolCall"]["kind"], "edit", "묻는 것은 편집이다");
    answer(host, &thread, &asked, "allow_once");
    let card = wait_card(sandbox, &thread);
    (thread, card)
}

#[test]
fn 편집을_허락받은_session이_쓰기_자리를_쥐면_같은_work의_다른_채팅의_편집은_묻지_않고_주인의_글로_거절되고_턴이_끝나면_놓인다() {
    let sandbox = sandbox();
    let host = sandbox.host(shell(&sandbox, [WRITES, WRITES], &[0]));
    let (writing, _) = writes(&sandbox, &host, FIXING);

    // 같은 Work에 이은 다른 채팅이 편집을 묻는다 — 사람에게 묻지 않고 거절된다.
    let other = host.start_thread(OTHER, in_cart()).expect("같은 Work의 다른 채팅");
    let record = sandbox.wait_thread_kind(&other, "turn-end", 1);
    let text = common::lines_text(&record);
    let asked = permissions(&record);
    assert_eq!(asked.len(), 1, "물음 줄 없이 판정 줄 하나다 — 승인 카드가 서지 않는다:\n{text}");
    let decided = &asked[0]["payload"];
    assert_eq!(
        (decided["state"].clone(), decided["optionId"].clone(), decided["reason"].clone()),
        (json!("decided"), json!("reject"), json!(FIXING_HOLDS)),
        "{text}"
    );
    assert_eq!(decided["toolCall"]["kind"], "edit", "받은 요청을 함께 남긴다: {decided}");
    assert!(decided["request"]["options"].is_array(), "요청 원문: {decided}");
    let session = sandbox.thread_session_id(&other);
    assert_eq!(
        decisions(&sandbox, &session),
        [json!({"behavior": "deny", "message": FIXING_HOLDS})],
        "그 글을 그 편집의 실패 결과로 받는다"
    );

    // 쥔 채팅의 턴이 끝나면(사람이 멈춤) 쓰기 자리가 놓인다 — 다른 채팅이 다시 물으면 이제 사람에게 묻는다.
    host.stop_thread(&writing).expect("사람이 고치는 채팅을 멈춘다");
    sandbox.wait_thread_kind(&writing, "turn-end", 1);
    host.send_to_thread(&other, "이제 다시 해 줘").expect("다시 맡긴다");
    let again = wait_permission(&sandbox, &other, "asked");
    assert_eq!(again["payload"]["toolCall"]["kind"], "edit");
    let record = sandbox.thread_record(&other);
    assert_eq!(
        permissions(&record).iter().filter(|line| line["payload"]["state"] == "decided").count(),
        1,
        "놓인 자리에서는 거절하지 않는다:\n{}",
        common::lines_text(&record)
    );

    host.shut_down();
}

#[test]
fn 먼저_쥔_채팅이_놓으면_다른_채팅이_쥐고_먼저_쥐었던_채팅의_다음_편집이_그_채팅의_글로_거절된다() {
    let sandbox = sandbox();
    let host = sandbox.host(shell(&sandbox, [WRITES, WRITES], &[0, 1]));
    let (first, card) = writes(&sandbox, &host, FIXING);

    // 사람이 카드에 답해 첫 채팅의 턴이 끝난다 — 자리가 빈다.
    host.answer_project(&first, &card, ProjectChoice::Decline).expect("사람이 카드에 답한다");
    sandbox.wait_thread_kind(&first, "turn-end", 1);

    // 다른 채팅이 빈 자리를 쥐고 턴을 이어 간다.
    let (second, _) = writes(&sandbox, &host, OTHER);
    assert_eq!(sandbox.thread_record(&second).iter().filter(|line| line["kind"] == "turn-end").count(), 0, "둘째 채팅의 턴은 돈다");

    // 먼저 쥐었던 채팅이 다시 고치려 한다 — 이제 주인은 둘째 채팅이라 사람에게 묻지 않고 그 이름으로 거절된다.
    host.send_to_thread(&first, "하나 더 고쳐 줘").expect("둘째 말");
    let refused = wait_permission(&sandbox, &first, "decided");
    assert_eq!(
        (refused["payload"]["optionId"].clone(), refused["payload"]["reason"].clone()),
        (json!("reject"), json!("「장바구니 문서를 고쳐 줘」 Thread가 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요"))
    );
    let session = sandbox.thread_session_id(&first);
    assert_eq!(decisions(&sandbox, &session).last().expect("둘째 편집의 답")["behavior"], "deny");

    host.shut_down();
}

#[test]
fn 명령을_허락받은_session은_쓰기_자리를_쥐지_않아_그_턴이_도는_동안에도_다른_채팅의_편집은_사람에게_묻는다() {
    let sandbox = sandbox();
    // 첫 채팅은 명령(`Bash`)을 묻는 턴을 되감고, 그 턴 끝머리에서 카드의 답을 기다린다.
    let host = sandbox.host(shell(&sandbox, [RUNS, WRITES], &[0]));
    let running = host.start_thread(FIXING, in_cart()).expect("Work에 이은 채팅의 첫 말");
    let asked = wait_permission(&sandbox, &running, "asked");
    assert_eq!(asked["payload"]["toolCall"]["kind"], "execute", "묻는 것은 명령이다");
    answer(&host, &running, &asked, "allow_once");
    wait_card(&sandbox, &running);

    // 첫 채팅의 턴은 카드의 답을 기다리며 돈다 — 그래도 명령은 쓰기 자리를 쥐지 않았다(S20).
    let other = host.start_thread(OTHER, in_cart()).expect("같은 Work의 다른 채팅");
    let edit = wait_permission(&sandbox, &other, "asked");
    assert_eq!(edit["payload"]["toolCall"]["kind"], "edit");
    answer(&host, &other, &edit, "allow_once");
    let record = sandbox.wait_thread_kind(&other, "turn-end", 1);
    let states: Vec<&Value> = permissions(&record).iter().map(|line| &line["payload"]["state"]).collect();
    assert_eq!(states, [&json!("asked"), &json!("answered")], "{}", common::lines_text(&record));

    host.shut_down();
}

#[test]
fn 쓰기_자리를_쥔_session이_있어도_같은_work의_다른_session의_명령은_막지_않는다() {
    let sandbox = sandbox();
    let host = sandbox.host(shell(&sandbox, [WRITES, RUNS], &[0]));
    let (writing, _) = writes(&sandbox, &host, FIXING);

    // 다른 채팅은 명령(`Bash`)을 묻는다 — 첫 채팅이 쓰기 자리를 쥐었어도 사람에게 묻는다. 테스트를 돌리는 Session이 막히지 않는다(S20).
    let other = host.start_thread("테스트를 돌려 줘", in_cart()).expect("같은 Work의 다른 채팅");
    let command = wait_permission(&sandbox, &other, "asked");
    assert_eq!(command["payload"]["toolCall"]["kind"], "execute");
    answer(&host, &other, &command, "allow_once");
    let record = sandbox.wait_thread_kind(&other, "turn-end", 1);
    let text = common::lines_text(&record);
    assert!(
        permissions(&record).iter().all(|line| line["payload"]["state"] != "decided"),
        "명령은 거절하지 않는다:\n{text}"
    );
    let session = sandbox.thread_session_id(&other);
    assert_eq!(decisions(&sandbox, &session)[0]["behavior"], "allow", "그 채팅의 claude는 허락을 받는다");
    assert!(sandbox.thread_record(&writing).iter().all(|line| line["kind"] != "turn-end"), "그동안 첫 채팅의 턴은 돈다");

    host.shut_down();
}

#[test]
fn 물은_사이에_다른_session이_쓰기_자리를_쥐었으면_사람이_허락해도_그_편집은_주인의_글로_거절된다() {
    let sandbox = sandbox();
    let host = sandbox.host(shell(&sandbox, [WRITES, WRITES], &[0]));
    // 두 채팅이 함께 편집을 묻는다 — 아직 아무도 쥐지 않아 둘 다 승인 카드다.
    let writing = host.start_thread(FIXING, in_cart()).expect("Work에 이은 채팅의 첫 말");
    let first = wait_permission(&sandbox, &writing, "asked");
    let other = host.start_thread(OTHER, in_cart()).expect("같은 Work의 다른 채팅");
    let second = wait_permission(&sandbox, &other, "asked");

    // 사람이 첫 채팅의 편집을 먼저 허락한다 — 첫 채팅이 쥔다. 그 뒤 다른 채팅의 편집을 허락하면 엔진이 주인의 글로 거부한다.
    answer(&host, &writing, &first, "allow_once");
    answer(&host, &other, &second, "allow_once");
    let record = sandbox.wait_thread_kind(&other, "turn-end", 1);
    let text = common::lines_text(&record);
    let lines = permissions(&record);
    assert_eq!(lines.len(), 2, "물음과 판정:\n{text}");
    assert_eq!(
        lines[1]["payload"],
        json!({"state": "decided", "requestId": second["payload"]["requestId"], "optionId": "reject", "reason": FIXING_HOLDS}),
        "물음 줄이 이미 요청을 담았다 — 판정 줄은 답과 까닭만 싣는다"
    );
    let session = sandbox.thread_session_id(&other);
    assert_eq!(decisions(&sandbox, &session), [json!({"behavior": "deny", "message": FIXING_HOLDS})]);

    host.shut_down();
}
