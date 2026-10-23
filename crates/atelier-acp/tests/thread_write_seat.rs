//! L1 — Work 하나에서 파일을 고치는 Session은 하나다(v1 티켓 18 · 구현 스펙 §10 · S20). 같은 Work에 이은 Thread 둘에서 두 Agent가
//! 함께 일할 때, 편집을 허락받은 Session이 쓰기 자리를 쥐고 그 턴(과 그 턴이 연 호출 고리)이 끝나면 놓는다. 그동안 다른 Session의
//! 편집 요청은 사람에게 묻지 않고 「<주인>이 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요」로 거절된다. 명령은 쥐지도 막히지도
//! 않고, 고리 안에서 불린 Agent는 부른 Agent의 자리를 이어 쓴다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 기록(`events.jsonl`) · 가짜 claude의 영수증(stdin 줄)만 본다. 쥔 Session이 턴을 이어 가게
//! 하려고, 편집을 허락받은 Host가 턴 끝머리에서 다른 Agent를 부른다(`FAKE_CLAUDE_MCP_CALL`의 `"at": "result"`) — 부른 동안 Host의
//! 턴은 결과를 기다리며 돈다.

mod common;

use atelier_acp::{ConversationHost, ThreadLink};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md` — 범위 안 아무 Agent나 부른다(S15).
const HOST_MD: &str = "---\nname: Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// Host가 고치는 Thread의 첫 말 — 그 Thread의 이름이 된다.
const FIXING: &str = "장바구니 수량을 고쳐 줘";

/// 다른 Thread에서 거절된 Agent가 받는 글 — 주인은 「Thread 이름」 Thread의 @handle이다.
const HOST_IS_WRITING: &str = "「장바구니 수량을 고쳐 줘」 Thread의 @host가 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요";

fn agent_md(name: &str) -> String {
    format!("---\nname: {name}\n---\n\n너는 시험 Thread의 {name}다.\n")
}

/// 시험의 자리 — Library의 Agent 넷과 Project 하나에 worktree가 선 Work `cart`.
fn sandbox() -> Sandbox {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", &agent_md("리뷰어"));
    sandbox.library_agent("tester", &agent_md("테스터"));
    sandbox.library_agent("runner", &agent_md("러너"));
    sandbox.work("cart", &["fe"]);
    sandbox
}

/// Host는 `host` 원문을 되감고 그 턴 끝머리에서 리뷰어를 부른다. 리뷰어 · 러너는 제 원문을, 나머지(테스터)는 `Write`를 묻는 턴
/// 둘(`2.1.282/permission-stdio`)을 되감는다. 그 `Write`의 경로는 각자의 작업 폴더(Work `cart`의 worktree)로 옮긴다 — 원문의 경로는
/// Work 밖이라 판정이 묻지 않고 거절한다(v1 티켓 22).
fn shell(sandbox: &Sandbox, host: &str, reviewer: &str) -> atelier_acp::ShellSource {
    let fixtures = json!({"host": host, "reviewer": reviewer, "runner": "2.1.296/g4-background"}).to_string();
    let call = json!([{"by": "host", "at": "result", "tool": "call_agent",
                       "arguments": {"handle": "reviewer", "task": "고친 것을 확인해 줘"}}])
    .to_string();
    sandbox.claude_login_shell(
        "normal",
        &[
            ("FAKE_CLAUDE_FIXTURE", "2.1.282/permission-stdio"),
            ("FAKE_CLAUDE_AGENT_FIXTURES", &fixtures),
            ("FAKE_CLAUDE_MCP_CALL", &call),
            ("FAKE_CLAUDE_REBASE", common::RECORDED_PLACE),
        ],
    )
}

fn in_cart() -> ThreadLink {
    ThreadLink::Work { slug: "cart".into() }
}

/// 그 참여자의 `permission` 줄들.
fn permissions<'a>(record: &'a [Value], who: &str) -> Vec<&'a Value> {
    of_kind(record, "permission").into_iter().filter(|line| line["who"] == who).collect()
}

/// 그 참여자의 권한 줄 가운데 그 상태인 것이 나올 때까지 기다린다 — 그 줄.
fn wait_permission(sandbox: &Sandbox, thread: &str, who: &str, state: &str) -> Value {
    let record = sandbox.wait_thread_record(thread, |record| {
        permissions(record, who).iter().any(|line| line["payload"]["state"] == state)
    });
    permissions(&record, who).into_iter().find(|line| line["payload"]["state"] == state).cloned().expect("기다린 줄")
}

/// 그 참여자의 턴 끝이 `n`개 적힐 때까지 기다린다.
fn wait_turns_of(sandbox: &Sandbox, thread: &str, who: &str, n: usize) -> Vec<Value> {
    sandbox.wait_thread_record(thread, |record| {
        record.iter().filter(|line| line["kind"] == "turn-end" && line["who"] == who).count() >= n
    })
}

/// 사람이 그 물음을 그 선택지로 답한다.
fn answer(host: &ConversationHost, thread: &str, asked: &Value, option: &str) {
    let who = asked["who"].as_str().expect("물은 참여자");
    let request = asked["payload"]["requestId"].as_str().expect("요청 id");
    host.answer_thread_permission(thread, who, request, option).expect("사람의 답");
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

/// Host가 Thread를 열어 편집을 묻고, 사람이 허락해 Host가 쓰기 자리를 쥔다. Host는 턴 끝머리에서 리뷰어를 불러 그 결과를 기다린다
/// — 리뷰어의 첫 도구 줄이 설 때까지 기다린다.
fn host_writes(sandbox: &Sandbox, host: &ConversationHost) -> String {
    let thread = host.start_thread(FIXING, in_cart()).expect("Work에 이은 Thread의 첫 말");
    let asked = wait_permission(sandbox, &thread, "host", "asked");
    assert_eq!(asked["payload"]["toolCall"]["kind"], "edit", "Host가 묻는 것은 편집이다");
    answer(host, &thread, &asked, "allow_once");
    sandbox.wait_thread_record(&thread, |record| {
        record.iter().any(|line| line["who"] == "reviewer" && line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });
    thread
}

#[test]
fn 편집을_허락받은_session이_쓰기_자리를_쥐면_같은_work의_다른_thread의_편집은_묻지_않고_주인의_글로_거절되고_턴이_끝나면_놓인다() {
    let sandbox = sandbox();
    let host = sandbox.host(shell(&sandbox, "2.1.282/permission-stdio", "2.1.282/interrupt-sigint"));
    let writing = host_writes(&sandbox, &host);

    // 같은 Work에 이은 다른 Thread에서 테스터가 편집을 묻는다 — 사람에게 묻지 않고 거절된다.
    let other = host.start_thread("@tester 장바구니 문서를 고쳐 줘", in_cart()).expect("같은 Work의 다른 Thread");
    let record = wait_turns_of(&sandbox, &other, "tester", 1);
    let text = common::lines_text(&record);
    let asked = permissions(&record, "tester");
    assert_eq!(asked.len(), 1, "물음 줄 없이 판정 줄 하나다 — 승인 카드가 서지 않는다:\n{text}");
    let decided = &asked[0]["payload"];
    assert_eq!(
        (decided["state"].clone(), decided["optionId"].clone(), decided["reason"].clone()),
        (json!("decided"), json!("reject"), json!(HOST_IS_WRITING)),
        "{text}"
    );
    assert_eq!(decided["toolCall"]["kind"], "edit", "받은 요청을 함께 남긴다: {decided}");
    assert!(decided["request"]["options"].is_array(), "요청 원문: {decided}");
    let tester = sandbox.thread_session_id(&other, "tester");
    assert_eq!(
        decisions(&sandbox, &tester),
        [json!({"behavior": "deny", "message": HOST_IS_WRITING})],
        "테스터는 그 글을 그 편집의 실패 결과로 받는다"
    );

    // Host의 턴이 끝나면(사람이 멈춤) 쓰기 자리가 놓인다 — 테스터가 다시 물으면 이제 사람에게 묻는다.
    host.stop_thread(&writing).expect("사람이 Host의 Thread를 멈춘다");
    wait_turns_of(&sandbox, &writing, "host", 1);
    host.send_to_thread(&other, "@tester 이제 다시 해 줘").expect("다시 맡긴다");
    let again = wait_permission(&sandbox, &other, "tester", "asked");
    assert_eq!(again["payload"]["toolCall"]["kind"], "edit");
    let record = sandbox.thread_record(&other);
    assert_eq!(
        permissions(&record, "tester").iter().filter(|line| line["payload"]["state"] == "decided").count(),
        1,
        "놓인 자리에서는 거절하지 않는다:\n{}",
        common::lines_text(&record)
    );

    host.shut_down();
}

#[test]
fn 쓰기_자리를_쥔_agent가_부른_agent는_그_자리를_이어_써서_사람에게_묻고_그동안에도_다른_thread의_편집은_거절된다() {
    let sandbox = sandbox();
    // 리뷰어도 편집을 묻는다 — 작업 자리 안으로 옮긴 `Write`.
    let host = sandbox.host(shell(&sandbox, "2.1.282/permission-stdio", "2.1.282/permission-stdio"));
    let writing = host_writes(&sandbox, &host);

    // Host가 쥔 채 부른 리뷰어의 편집 — 고리 안이라 거절하지 않고 사람에게 묻는다(§10 「이어 쓴다」).
    let asked = wait_permission(&sandbox, &writing, "reviewer", "asked");
    assert_eq!(asked["payload"]["toolCall"]["kind"], "edit");

    // 리뷰어가 이어 쓰는 동안에도 자리의 주인은 Host다 — 다른 Thread의 편집은 Host의 이름으로 거절된다.
    let other = host.start_thread("@tester 장바구니 문서를 고쳐 줘", in_cart()).expect("같은 Work의 다른 Thread");
    let decided = wait_permission(&sandbox, &other, "tester", "decided");
    assert_eq!(decided["payload"]["reason"], HOST_IS_WRITING);

    // 사람이 리뷰어의 편집을 허락한다 — 고리 안이라 그대로 간다. 리뷰어의 결과가 Host에게 돌아가고 Host의 턴이 끝난다.
    answer(&host, &writing, &asked, "allow_once");
    let record = wait_turns_of(&sandbox, &writing, "host", 1);
    let text = common::lines_text(&record);
    let reviewer = permissions(&record, "reviewer");
    let states: Vec<&Value> = reviewer.iter().map(|line| &line["payload"]["state"]).collect();
    assert_eq!(states, [&json!("asked"), &json!("answered")], "리뷰어의 편집은 거절되지 않는다:\n{text}");
    assert_eq!(reviewer[1]["payload"]["optionId"], "allow_once");
    let reviewer_session = sandbox.thread_session_id(&writing, "reviewer");
    assert_eq!(decisions(&sandbox, &reviewer_session)[0]["behavior"], "allow", "리뷰어의 claude는 허락을 받는다");
    let ended = &of_kind(&record, "call")[1]["payload"];
    assert_eq!((ended["outcome"].clone(), ended["answer"].clone()), (json!("answered"), json!("완료되었습니다.")), "{text}");

    host.shut_down();
}

#[test]
fn 명령을_허락받은_session은_쓰기_자리를_쥐지_않아_그_턴이_도는_동안에도_다른_thread의_편집은_사람에게_묻는다() {
    let sandbox = sandbox();
    // Host는 명령(`Bash`)을 묻는 턴을 되감고, 그 턴 끝머리에서 부른 리뷰어는 오래 도는 명령에서 멈춤을 기다린다.
    let host = sandbox.host(shell(&sandbox, "2.1.296/g4-background", "2.1.282/interrupt-sigint"));
    let running = host.start_thread(FIXING, in_cart()).expect("Work에 이은 Thread의 첫 말");
    let asked = wait_permission(&sandbox, &running, "host", "asked");
    assert_eq!(asked["payload"]["toolCall"]["kind"], "execute", "Host가 묻는 것은 명령이다");
    answer(&host, &running, &asked, "allow_once");
    sandbox.wait_thread_record(&running, |record| {
        record.iter().any(|line| line["who"] == "reviewer" && line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });

    // Host의 턴은 리뷰어의 결과를 기다리며 돈다 — 그래도 명령은 쓰기 자리를 쥐지 않았다(S20).
    let other = host.start_thread("@tester 장바구니 문서를 고쳐 줘", in_cart()).expect("같은 Work의 다른 Thread");
    let edit = wait_permission(&sandbox, &other, "tester", "asked");
    assert_eq!(edit["payload"]["toolCall"]["kind"], "edit");
    answer(&host, &other, &edit, "allow_once");
    let record = wait_turns_of(&sandbox, &other, "tester", 1);
    let states: Vec<&Value> = permissions(&record, "tester").iter().map(|line| &line["payload"]["state"]).collect();
    assert_eq!(states, [&json!("asked"), &json!("answered")], "{}", common::lines_text(&record));

    host.shut_down();
}

#[test]
fn 쓰기_자리를_쥔_session이_있어도_같은_work의_다른_session의_명령은_막지_않는다() {
    let sandbox = sandbox();
    let host = sandbox.host(shell(&sandbox, "2.1.282/permission-stdio", "2.1.282/interrupt-sigint"));
    let writing = host_writes(&sandbox, &host);

    // 러너는 명령(`Bash`)을 묻는다 — Host가 쓰기 자리를 쥐었어도 사람에게 묻는다. 테스트를 돌리는 리뷰어가 막히지 않는다(S20).
    let other = host.start_thread("@runner 테스트를 돌려 줘", in_cart()).expect("같은 Work의 다른 Thread");
    let command = wait_permission(&sandbox, &other, "runner", "asked");
    assert_eq!(command["payload"]["toolCall"]["kind"], "execute");
    answer(&host, &other, &command, "allow_once");
    let record = wait_turns_of(&sandbox, &other, "runner", 1);
    let text = common::lines_text(&record);
    assert!(
        permissions(&record, "runner").iter().all(|line| line["payload"]["state"] != "decided"),
        "명령은 거절하지 않는다:\n{text}"
    );
    let runner = sandbox.thread_session_id(&other, "runner");
    assert_eq!(decisions(&sandbox, &runner)[0]["behavior"], "allow", "러너의 claude는 허락을 받는다");
    assert!(sandbox.thread_record(&writing).iter().all(|line| line["kind"] != "turn-end"), "그동안 Host의 턴은 돈다");

    host.shut_down();
}

#[test]
fn 물은_사이에_다른_session이_쓰기_자리를_쥐었으면_사람이_허락해도_그_편집은_주인의_글로_거절된다() {
    let sandbox = sandbox();
    let host = sandbox.host(shell(&sandbox, "2.1.282/permission-stdio", "2.1.282/interrupt-sigint"));
    // 두 Thread가 함께 편집을 묻는다 — 아직 아무도 쥐지 않아 둘 다 승인 카드다.
    let writing = host.start_thread(FIXING, in_cart()).expect("Work에 이은 Thread의 첫 말");
    let first = wait_permission(&sandbox, &writing, "host", "asked");
    let other = host.start_thread("@tester 장바구니 문서를 고쳐 줘", in_cart()).expect("같은 Work의 다른 Thread");
    let second = wait_permission(&sandbox, &other, "tester", "asked");

    // 사람이 Host의 편집을 먼저 허락한다 — Host가 쥔다. 그 뒤 테스터의 편집을 허락하면 엔진이 주인의 글로 거부한다.
    answer(&host, &writing, &first, "allow_once");
    answer(&host, &other, &second, "allow_once");
    let record = wait_turns_of(&sandbox, &other, "tester", 1);
    let text = common::lines_text(&record);
    let tester = permissions(&record, "tester");
    assert_eq!(tester.len(), 2, "물음과 판정:\n{text}");
    assert_eq!(
        tester[1]["payload"],
        json!({"state": "decided", "requestId": second["payload"]["requestId"], "optionId": "reject", "reason": HOST_IS_WRITING}),
        "물음 줄이 이미 요청을 담았다 — 판정 줄은 답과 까닭만 싣는다"
    );
    let session = sandbox.thread_session_id(&other, "tester");
    assert_eq!(decisions(&sandbox, &session), [json!({"behavior": "deny", "message": HOST_IS_WRITING})]);

    host.shut_down();
}
