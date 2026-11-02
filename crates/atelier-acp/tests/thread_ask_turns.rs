//! L1 — 한 세션의 잇단 물음(v1 티켓 25 · 구현 스펙 §9 카드 · 스토리 80 · 83). 세션이 잇달아 물으면 물음 줄이 온 차례로 서고, 앞의 것에
//! 답해야 턴이 이어져 다음 물음이 선다. 카드에서 고르기 전에 쓴 말은 그 요청을 거부하며 세션에게 간다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 기록(`events.jsonl`) · 가짜 claude의 stdin만 본다.

mod common;

use atelier_acp::{ConversationHost, Reply, ThreadLink};
use common::{of_kind, wait_until, Sandbox, RECORDED_PLACE};
use serde_json::{json, Value};

/// 녹음의 두 턴이 각각 Thread 폴더 안 파일 쓰기(`Write`)를 묻는다 — Work 없는 Thread라 「매번 묻기」가 묻는다.
fn sandbox_and_host() -> (Sandbox, ConversationHost) {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"), ("FAKE_CLAUDE_REBASE", RECORDED_PLACE)],
    ));
    (sandbox, host)
}

/// `n`째(1부터) 물음 줄이 설 때까지 기다린다.
fn nth_asked(sandbox: &Sandbox, thread: &str, n: usize) -> Value {
    let nth = |record: &[Value]| {
        of_kind(record, "permission").into_iter().filter(|line| line["payload"]["state"] == "asked").nth(n - 1).cloned()
    };
    nth(&sandbox.wait_thread_record(thread, |record| nth(record).is_some())).expect("기다린 줄")
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

fn reply(host: &ConversationHost, thread: &str, asked: &Value, reply: &Reply) {
    let request = asked["payload"]["requestId"].as_str().expect("요청 id");
    host.reply_thread_permission(thread, request, reply).expect("걸린 물음에 답한다");
}

/// 첫 물음을 허락해 첫 턴을 마치고 둘째 턴의 물음이 선 Thread — 그 Thread와 두 물음.
fn second_ask_standing(sandbox: &Sandbox, host: &ConversationHost) -> (String, Value, Value) {
    let thread = host.start_thread("outside/allowed.txt를 Write로 만들어", ThreadLink::NoWork).expect("Work 없는 Thread");
    let first = nth_asked(sandbox, &thread, 1);
    reply(host, &thread, &first, &Reply::pick("allow_once"));
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread(&thread, "outside/denied.txt를 Write로 만들어").expect("둘째 말");
    let second = nth_asked(sandbox, &thread, 2);
    (thread, first, second)
}

#[test]
fn 한_세션이_잇달아_물으면_물음_줄이_온_차례로_서고_요청_id가_겹치지_않는다() {
    let (sandbox, host) = sandbox_and_host();
    let (thread, first, second) = second_ask_standing(&sandbox, &host);

    assert!(first["seq"].as_u64() < second["seq"].as_u64(), "먼저 물은 줄이 앞이다: {first} / {second}");
    assert_ne!(first["payload"]["requestId"], second["payload"]["requestId"], "화면은 물음을 요청 id로 건다");
    let record = sandbox.thread_record(&thread);
    let states: Vec<&Value> = of_kind(&record, "permission").iter().map(|line| &line["payload"]["state"]).collect();
    assert_eq!(states, [&json!("asked"), &json!("answered"), &json!("asked")], "{}", common::lines_text(&record));

    host.shut_down();
}

#[test]
fn 카드에서_고르기_전에_쓴_말은_그_요청을_거부하며_세션에게_가고_잇단_물음의_기록이_검사_자료와_같다() {
    let (sandbox, host) = sandbox_and_host();
    let (thread, _, second) = second_ask_standing(&sandbox, &host);

    let words = "파일 말고 이 Thread에 바로 적어 줘";
    reply(&host, &thread, &second, &Reply { words: Some(words.to_owned()), ..Reply::pick("reject") });
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    let session = sandbox.thread_session_id(&thread);
    let told = format!("사람이 이 요청을 거절하고 이렇게 말했어요 — 그대로 다시 하지 말고 이 말을 따르세요:\n{words}");
    assert_eq!(decisions(&sandbox, &session, 2)[1], json!({"behavior": "deny", "message": told}), "말은 세션이 받는다");

    host.shut_down();
    // Thread 화면의 L3(v1 티켓 28)가 잇단 물음의 카드 · 카드 안에 남긴 말 · 결정 줄을 이것으로 잰다.
    let settled = common::fix_thread_record(&common::commands_after_opened(&record), &sandbox.data_root(), &thread, &[&session]);
    common::assert_record("thread-ask-turns", &settled);
}
