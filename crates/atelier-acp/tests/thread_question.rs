//! L1 — Agent의 질문과 계획 넘어가기(v1 티켓 26 · 구현 스펙 §9 카드 · 스토리 81 · 88).
//!
//! - **질문** — claude가 사람에게 묻는 `AskUserQuestion`은 판정을 지나지 않고 질문 카드가 된다(`question` 줄). 답하면 claude가 물은
//!   입력에 답(물음 → 답)을 더한 allow가 가고, 「나중에」는 그 질문 하나만 닫는 deny다. 둘 다 답 줄로 남는다. 멈추면 거둬진다.
//! - **계획 넘어가기** — 「계획만」에서 「계획대로 구현」을 고르면 물어보는 정도가 「매번 묻기」로 나간다 — 구현의 첫 편집부터 그
//!   정도로 묻는다. 「계획 다시 쓰기」에 쓴 말은 고정 문구와 함께 claude에게 가고 정도는 그대로다.
//!
//! 사람에게 묻는 claude의 녹음이 없어, 가짜 claude가 되감는 `can_use_tool`을 `AskUserQuestion`으로 바꿔 낸다(`FAKE_CLAUDE_QUESTION`).
//! 시험은 호스트의 Thread 명령과 Thread 기록(`events.jsonl`) · `thread.json` · 가짜 claude의 stdin만 본다.

mod common;

use atelier_acp::{AskLevel, HostError, QuestionAnswer, QuestionReply, Reply, ThreadLink};
use common::{of_kind, wait_until, Sandbox};
use serde_json::{json, Value};

const HOST_MD: &str = "---\nname: Host\n---\n\n너는 시험 Thread의 Host다.\n";

const FEE: &str = "부분 환불 수수료는 어떻게 할까요?";
const SCREEN: &str = "어느 화면에 보일까요?";

/// claude 2.1.309 `AskUserQuestion`의 입력 꼴(도구 스키마) — 물음 둘, 둘째는 여럿 고르기.
fn refund_questions() -> Value {
    json!({"questions": [
        {"question": FEE, "header": "수수료", "multiSelect": false,
         "options": [{"label": "비율대로 돌려준다", "description": "환불한 금액만큼 나눠 돌려줘요"},
                     {"label": "돌려주지 않는다"}, {"label": "마지막 환불 때 한 번에 돌려준다"}]},
        {"question": SCREEN, "header": "화면", "multiSelect": true, "options": [{"label": "주문 상세"}, {"label": "환불 내역"}]},
    ]})
}

/// Host의 턴 둘이 각각 사람에게 묻는다(녹화 `permission-stdio`의 두 `can_use_tool`을 질문으로 바꾼 것).
fn asking_sandbox() -> (Sandbox, atelier_acp::ConversationHost) {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let question = refund_questions().to_string();
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"), ("FAKE_CLAUDE_QUESTION", &question)],
    ));
    (sandbox, host)
}

/// 그 kind · 그 상태인 `n`번째(1부터) 줄이 나올 때까지 기다린다.
fn wait_line(sandbox: &Sandbox, thread: &str, kind: &str, state: &str, n: usize) -> Value {
    let of_state = |record: &[Value]| -> Vec<Value> {
        of_kind(record, kind).into_iter().filter(|line| line["payload"]["state"] == state).cloned().collect()
    };
    let record = sandbox.wait_thread_record(thread, |record| of_state(record).len() >= n);
    of_state(&record)[n - 1].clone()
}

/// 그 Session의 claude가 받은 권한 답들 — `n`개가 닿을 때까지 기다린다. 답 줄은 답을 보내기 직전에 적히므로(`Turns::answer`) 답 줄을
/// 본 바로 뒤에는 claude가 아직 받지 못했을 수 있다.
fn decisions(sandbox: &Sandbox, session: &str, n: usize) -> Vec<Value> {
    wait_until("claude가 권한 답을 다 받지 않았다", || {
        let got: Vec<Value> = sandbox
            .claude_stdin(session)
            .into_iter()
            .filter(|line| line["type"] == "control_response")
            .map(|line| line["response"]["response"].clone())
            .collect();
        if got.len() >= n {
            Ok(got)
        } else {
            Err(format!("{got:?}"))
        }
    })
}

fn answer(question: &str, answer: &str) -> QuestionAnswer {
    QuestionAnswer { question: question.to_owned(), answer: answer.to_owned() }
}

#[test]
fn 질문은_판정을_지나지_않고_질문_줄로_서고_답하면_claude가_답을_받고_나중에는_그_질문만_닫힌다() {
    let (sandbox, host) = asking_sandbox();
    let thread = host.start_thread("환불 수수료를 정해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");

    let asked = wait_line(&sandbox, &thread, "question", "asked", 1);
    assert_eq!(asked["who"], "host");
    let payload = &asked["payload"];
    assert_eq!((payload["card"].clone(), payload["requestId"].clone()), (json!("question"), json!("0")));
    assert_eq!(payload["questions"][0]["question"], FEE, "물음은 엔진이 읽는 꼴로 선다: {payload}");
    assert_eq!(payload["questions"][1]["multiSelect"], true);
    assert_eq!(payload["toolCall"]["_meta"]["claudeCode"]["toolName"], "AskUserQuestion", "도구 요지도 함께다 — 도구 줄을 잇는다");
    let record = sandbox.thread_record(&thread);
    assert!(of_kind(&record, "permission").is_empty(), "질문은 권한 줄이 아니다 — 판정도 묻지 않는다:\n{}", common::lines_text(&record));

    // 권한 답으로는 질문의 답을 줄 수 없고, 질문 답으로는 권한에 답할 수 없다 — 카드가 섞이지 않는다.
    let refused = host.reply_thread_permission(&thread, "host", "0", &Reply::pick("answer"));
    assert!(matches!(refused, Err(HostError::NotPermission { .. })), "{refused:?}");

    let answers = vec![answer(FEE, "비율대로 돌려준다"), answer(SCREEN, "주문 상세, 환불 내역")];
    host.answer_thread_question(&thread, "host", "0", &QuestionReply::Answer(answers)).expect("답한다");

    let answered = wait_line(&sandbox, &thread, "question", "answered", 1);
    assert_eq!(
        answered["payload"],
        json!({"state": "answered", "requestId": "0", "card": "question", "choice": "answer",
               "answers": [{"question": FEE, "answer": "비율대로 돌려준다"}, {"question": SCREEN, "answer": "주문 상세, 환불 내역"}]}),
        "답 줄 — 화면의 「답함: …」 줄이 이것을 읽는다"
    );
    let session = sandbox.thread_session_id(&thread, "host");
    let mut input = refund_questions();
    input["answers"] = json!({FEE: "비율대로 돌려준다", SCREEN: "주문 상세, 환불 내역"});
    assert_eq!(decisions(&sandbox, &session, 1), [json!({"behavior": "allow", "updatedInput": input})], "claude는 답을 실은 allow를 받는다");

    // 둘째 턴의 질문은 나중에 답한다 — 그 질문만 답 없이 닫히고 claude는 이어 간다.
    sandbox.wait_thread_record(&thread, |record| !of_kind(record, "turn-end").is_empty());
    host.send_to_thread(&thread, "다른 것도 물어봐").expect("둘째 말");
    let second = wait_line(&sandbox, &thread, "question", "asked", 2);
    assert_eq!(second["payload"]["requestId"], "1");
    let not_question = host.answer_thread_question(&thread, "host", "9", &QuestionReply::Later);
    assert!(matches!(not_question, Err(HostError::PermissionClosed { .. })), "걸려 있지 않은 질문: {not_question:?}");
    host.answer_thread_question(&thread, "host", "1", &QuestionReply::Later).expect("나중에");

    let later = wait_line(&sandbox, &thread, "question", "answered", 2);
    assert_eq!(later["payload"], json!({"state": "answered", "requestId": "1", "card": "question", "choice": "later"}));
    let denied = decisions(&sandbox, &session, 2);
    assert_eq!(denied.len(), 2);
    assert_eq!(denied[1]["behavior"], "deny");
    assert!(denied[1]["message"].as_str().is_some_and(|text| text.contains("later")), "나중에 답하겠다는 글: {}", denied[1]);
    sandbox.wait_thread_record(&thread, |record| of_kind(record, "turn-end").len() == 2);
}

#[test]
fn 질문에_답한_thread의_기록이_검사_자료와_같다() {
    let (sandbox, host) = asking_sandbox();
    let thread = host.start_thread("환불 수수료를 정해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    wait_line(&sandbox, &thread, "question", "asked", 1);
    let answers = vec![answer(FEE, "비율대로 돌려준다"), answer(SCREEN, "주문 상세, 환불 내역")];
    host.answer_thread_question(&thread, "host", "0", &QuestionReply::Answer(answers)).expect("답한다");
    let record = sandbox.wait_thread_record(&thread, |record| !of_kind(record, "turn-end").is_empty());
    let session = sandbox.thread_session_id(&thread, "host");

    host.shut_down();
    // Thread 화면의 접기(L2)와 L3(v1 티켓 28)가 질문 카드 · 「답함: …」 줄을 이것으로 잰다.
    let settled = common::fix_thread_record(&common::commands_after_opened(&record), &sandbox.data_root(), &thread, &[&session]);
    common::assert_record("thread-question", &settled);
}

#[test]
fn 질문이_걸린_채_멈추면_질문이_거둬지고_승인_답으로는_닫지_못한다() {
    let (sandbox, host) = asking_sandbox();
    let thread = host.start_thread("환불 수수료를 정해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    wait_line(&sandbox, &thread, "question", "asked", 1);

    host.stop_thread(&thread).expect("멈춘다");

    let withdrawn = wait_line(&sandbox, &thread, "question", "withdrawn", 1);
    assert_eq!(withdrawn["payload"], json!({"state": "withdrawn", "requestId": "0", "card": "question", "reason": "stopped"}));
    let late = host.answer_thread_question(&thread, "host", "0", &QuestionReply::Later);
    assert!(matches!(late, Err(HostError::PermissionClosed { .. })), "거둬진 질문에는 답할 수 없다: {late:?}");
}

#[test]
fn 계획만에서_계획대로_구현을_고르면_정도가_매번_묻기로_나가고_다시_쓰기에_쓴_말은_claude에게_간다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    // 녹화의 작업 폴더를 claude의 자리(Thread 폴더)로 옮긴다 — 구현의 편집이 Thread 폴더 안이라 정도대로 묻는다.
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/g1-plan-revise"), ("FAKE_CLAUDE_REBASE", "/tmp/gate/ws/revise")],
    ));
    let thread = host
        .start_thread_asking("hello.txt에 hi를 담는 계획을 짜 줘", &[], ThreadLink::NoWork, Some(AskLevel::Plan))
        .expect("계획만 Thread");

    // 다시 쓰기 — 쓴 말이 고정 문구 뒤에 붙어 간다. 정도는 그대로 계획만이다.
    let first = wait_line(&sandbox, &thread, "permission", "asked", 1);
    assert_eq!(first["payload"]["card"], "plan");
    let revise = Reply { words: Some("파일 이름을 greeting.txt로".into()), ..Reply::pick("revise_plan") };
    host.reply_thread_permission(&thread, "host", "0", &revise).expect("다시 쓰기");
    let session = sandbox.thread_session_id(&thread, "host");
    let told = sandbox.wait_thread_record(&thread, |record| !of_kind(record, "turn-end").is_empty());
    let denial = decisions(&sandbox, &session, 1)[0].clone();
    assert_eq!(denial["behavior"], "deny");
    let message = denial["message"].as_str().unwrap_or_default();
    assert!(message.contains("Stay in plan mode") && message.ends_with("파일 이름을 greeting.txt로"), "{message}");
    assert!(of_kind(&told, "mode").is_empty(), "다시 쓰기는 정도를 바꾸지 않는다");
    assert_eq!(host.thread(&thread).expect("Thread").ask_level, AskLevel::Plan);

    // 계획대로 구현 — 정도가 매번 묻기로 나가고, 구현의 첫 편집이 그 정도로 묻는다.
    host.send_to_thread(&thread, "파일 이름을 greeting.txt로 바꿔서 다시 물어").expect("둘째 말");
    let second = wait_line(&sandbox, &thread, "permission", "asked", 2);
    assert_eq!(second["payload"]["card"], "plan");
    host.reply_thread_permission(&thread, "host", "1", &Reply::pick("implement_plan")).expect("계획대로 구현");

    let edit = wait_line(&sandbox, &thread, "permission", "asked", 3);
    assert_eq!(
        (edit["payload"]["card"].clone(), edit["payload"]["policy"].clone()),
        (json!("edit"), json!("매번 묻기")),
        "구현의 첫 편집은 바뀐 정도로 묻는다: {edit}"
    );
    let record = sandbox.thread_record(&thread);
    let modes = of_kind(&record, "mode");
    assert_eq!(modes.len(), 1, "{}", common::lines_text(&record));
    assert_eq!(modes[0]["payload"], json!({"mode": "always", "work": null}), "시스템 줄 「Policy를 매번 묻기로 바꿈」");
    assert_eq!(sandbox.thread_json(&thread)["mode"], "always");
    assert_eq!(host.thread(&thread).expect("Thread").ask_level, AskLevel::Always);
}
