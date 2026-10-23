//! L1 — 여럿이 물을 때(v1 티켓 25 · 구현 스펙 §9 카드 · 스토리 80 · 83). 한 Thread의 두 Agent가 함께 물으면 물음 줄이 온 차례로
//! 서고, 화면은 그 차례로 하나씩 카드를 세운다. 카드에서 고르기 전에 쓴 말은 그 요청을 거부하며 **그 Agent에게만** 간다 — 뒤에 선
//! 다른 Agent의 물음은 그대로 걸려 있다가 제 차례에 답해진다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 기록(`events.jsonl`) · 가짜 claude의 stdin만 본다.

mod common;

use atelier_acp::{ConversationHost, Reply, ThreadLink};
use common::{of_kind, wait_until, Sandbox, RECORDED_PLACE};
use serde_json::{json, Value};

const HOST_MD: &str = "---\nname: Host\n---\n\n너는 시험 Thread의 Host다.\n";
const TESTER_MD: &str = "---\nname: 테스터\n---\n\n너는 시험 Thread의 테스터다.\n";

/// Host는 Thread 폴더 안 파일 쓰기(`Write`)를, 테스터는 명령(`python3 -c …`)을 묻는다 — Work 없는 Thread라 둘 다 「매번 묻기」가 묻는다.
fn sandbox_and_host() -> (Sandbox, ConversationHost) {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("tester", TESTER_MD);
    let fixtures = json!({"tester": "2.1.309/g4-background"}).to_string();
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[
            ("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"),
            ("FAKE_CLAUDE_AGENT_FIXTURES", &fixtures),
            ("FAKE_CLAUDE_REBASE", RECORDED_PLACE),
        ],
    ));
    (sandbox, host)
}

fn permissions<'a>(record: &'a [Value], who: &str) -> Vec<&'a Value> {
    of_kind(record, "permission").into_iter().filter(|line| line["who"] == who).collect()
}

/// 그 참여자의 권한 줄 가운데 그 상태인 첫 줄이 나올 때까지 기다린다.
fn wait_permission(sandbox: &Sandbox, thread: &str, who: &str, state: &str) -> Value {
    let first = |record: &[Value]| permissions(record, who).into_iter().find(|line| line["payload"]["state"] == state).cloned();
    first(&sandbox.wait_thread_record(thread, |record| first(record).is_some())).expect("기다린 줄")
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
    let who = asked["who"].as_str().expect("물은 참여자");
    let request = asked["payload"]["requestId"].as_str().expect("요청 id");
    host.reply_thread_permission(thread, who, request, reply).expect("걸린 물음에 답한다");
}

#[test]
fn 두_agent가_함께_물으면_물음_줄이_온_차례로_서고_요청_id는_session마다_따로_센다() {
    let (sandbox, host) = sandbox_and_host();
    let thread = host.start_thread("메모를 써 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    let first = wait_permission(&sandbox, &thread, "host", "asked");
    // Host가 승인을 기다리는 동안 테스터를 부른다 — 테스터는 제 Session에서 따로 돌다 묻는다.
    host.send_to_thread(&thread, "@tester 배경 작업을 돌려 줘").expect("테스터를 부른다");
    let second = wait_permission(&sandbox, &thread, "tester", "asked");

    assert!(first["seq"].as_u64() < second["seq"].as_u64(), "먼저 물은 Host의 줄이 앞이다: {first} / {second}");
    assert_eq!(
        (first["payload"]["card"].clone(), second["payload"]["card"].clone()),
        (json!("edit"), json!("command")),
        "카드 종류는 각자의 것이다"
    );
    // 화면은 물음을 (물은 참여자, 요청 id)로 건다 — id만으로는 둘이 겹친다.
    assert_eq!(first["payload"]["requestId"], second["payload"]["requestId"], "Session마다 0부터 센다");
    let record = sandbox.thread_record(&thread);
    assert!(
        of_kind(&record, "permission").iter().all(|line| line["payload"]["state"] == "asked"),
        "둘 다 사람의 답을 기다린다 — 한쪽의 물음이 다른 쪽을 닫지 않는다:\n{}",
        common::lines_text(&record)
    );

    host.shut_down();
}

#[test]
fn 카드에서_고르기_전에_쓴_말은_그_요청을_거부하며_그_agent에게만_가고_다음_차례의_물음은_그대로_걸려_있다() {
    let (sandbox, host) = sandbox_and_host();
    let thread = host.start_thread("메모를 써 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    let first = wait_permission(&sandbox, &thread, "host", "asked");
    host.send_to_thread(&thread, "@tester 배경 작업을 돌려 줘").expect("테스터를 부른다");
    let second = wait_permission(&sandbox, &thread, "tester", "asked");

    // 맨 앞(Host)의 카드에 말을 쓰고 보낸다 — 「보내면 이 편집은 건너뛰고 Host에게 말을 전해요」.
    let words = "파일 말고 이 Thread에 바로 적어 줘";
    reply(&host, &thread, &first, &Reply { words: Some(words.to_owned()), ..Reply::pick("reject") });
    let answered = wait_permission(&sandbox, &thread, "host", "answered");
    assert_eq!((answered["payload"]["optionId"].clone(), answered["payload"]["words"].clone()), (json!("reject"), json!(words)));
    let told = format!("사람이 이 요청을 거절하고 이렇게 말했어요 — 그대로 다시 하지 말고 이 말을 따르세요:\n{words}");
    let host_session = sandbox.thread_session_id(&thread, "host");
    assert_eq!(decisions(&sandbox, &host_session, 1), [json!({"behavior": "deny", "message": told})], "말은 Host가 받는다");
    let tester_session = sandbox.thread_session_id(&thread, "tester");
    assert_eq!(decisions(&sandbox, &tester_session, 0), Vec::<Value>::new(), "테스터는 아직 아무 답도 받지 않았다");
    assert!(
        !permissions(&sandbox.thread_record(&thread), "tester").iter().any(|line| line["payload"]["state"] != "asked"),
        "테스터의 물음은 그대로 걸려 있다"
    );

    // 다음 차례 — 테스터의 카드에 답한다.
    reply(&host, &thread, &second, &Reply::pick("allow_once"));
    let answered = wait_permission(&sandbox, &thread, "tester", "answered");
    assert_eq!(answered["payload"]["optionId"], "allow_once");
    assert_eq!(decisions(&sandbox, &tester_session, 1)[0]["behavior"], "allow");
    assert_eq!(decisions(&sandbox, &host_session, 1).len(), 1, "Host는 제 답 하나만 받았다");

    host.shut_down();
}

/// 그 참여자의 `n`째(1부터) 물음 줄이 설 때까지 기다린다.
fn nth_asked(sandbox: &Sandbox, thread: &str, who: &str, n: usize) -> Value {
    let nth = |record: &[Value]| {
        permissions(record, who).into_iter().filter(|line| line["payload"]["state"] == "asked").nth(n - 1).cloned()
    };
    nth(&sandbox.wait_thread_record(thread, |record| nth(record).is_some())).expect("기다린 줄")
}

/// 그 참여자의 턴 끝이 `n`개 적힐 때까지 기다린다 — 그때의 기록.
fn turns_ended(sandbox: &Sandbox, thread: &str, who: &str, n: usize) -> Vec<Value> {
    sandbox.wait_thread_record(thread, |record| {
        of_kind(record, "turn-end").iter().filter(|line| line["who"] == who).count() >= n
    })
}

#[test]
fn 두_agent의_물음에_차례로_답한_thread의_기록이_검사_자료와_같다() {
    let (sandbox, host) = sandbox_and_host();
    // Host의 첫 턴은 편집을 묻고 허락받는다. 녹음의 둘째 턴이 거절을 받는 꼴이라(거절의 글이 도구 결과로 간다) 차례는 둘째 턴에서 잰다.
    let thread = host.start_thread("outside/allowed.txt를 Write로 만들어", ThreadLink::NoWork).expect("Work 없는 Thread");
    reply(&host, &thread, &nth_asked(&sandbox, &thread, "host", 1), &Reply::pick("allow_once"));
    turns_ended(&sandbox, &thread, "host", 1);
    host.send_to_thread(&thread, "outside/denied.txt를 Write로 만들어").expect("둘째 말");
    let edit = nth_asked(&sandbox, &thread, "host", 2);
    host.send_to_thread(&thread, "@tester 배경 작업을 돌려 줘").expect("테스터를 부른다");
    let command = nth_asked(&sandbox, &thread, "tester", 1);

    // 맨 앞(Host)의 카드에 말을 남겨 거부한다. 줄의 차례가 늘 같게 Host의 턴이 끝난 뒤에 테스터에게 답하고, 배경 작업이 끝나 테스터가
    // 스스로 이어 간 턴까지 기다린다 — 그 뒤로 기록이 늘지 않는다.
    let words = Reply { words: Some("파일 말고 이 Thread에 바로 적어 줘".to_owned()), ..Reply::pick("reject") };
    reply(&host, &thread, &edit, &words);
    turns_ended(&sandbox, &thread, "host", 2);
    reply(&host, &thread, &command, &Reply::pick("allow_once"));
    let record = turns_ended(&sandbox, &thread, "tester", 2);
    let sessions = [sandbox.thread_session_id(&thread, "host"), sandbox.thread_session_id(&thread, "tester")];

    host.shut_down();
    // Thread 화면의 L3(v1 티켓 28)가 두 물음의 차례 · 카드 안에 남긴 말 · 결정 줄을 이것으로 잰다.
    let settled = common::fix_thread_record(
        &common::commands_after_opened(&record),
        &sandbox.data_root(),
        &thread,
        &[&sessions[0], &sessions[1]],
    );
    common::assert_record("thread-ask-turns", &settled);
}
