//! L1 — 승인 카드의 답(v1 티켓 24 · 구현 스펙 §9 · S18). 카드의 세 선택지가 엔진에 닿는 길을 본다.
//!
//! - 「예, 이 Work에서는 다시 묻지 않기」 — 허락하는 선택지로 답하고, 판정이 물음과 함께 낸 허락을 Work 폴더(Work 없으면 Thread 폴더)의
//!   점 파일에 적는다. 같은 종류의 다음 요청은 판정의 5번 칸에서 묻지 않고 넘어간다.
//! - 「아니요, 다르게 해 주세요」 — 거부하는 선택지로 답하며 사람이 쓴 말을 Agent에게 준다(claude는 deny의 글로 받는다).
//! - `ask_before`가 물은 요청에는 「다시 묻지 않기」가 없다 — 허락이 `ask_before`를 넘기지 못한다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 기록(`events.jsonl`) · 점 파일 · 가짜 claude의 stdin만 본다.

mod common;

use atelier_acp::{ConversationHost, HostError, Reply, ThreadLink};
use common::{of_kind, wait_until, Sandbox, RECORDED_PLACE};
use serde_json::{json, Value};

fn host_md(policy: &str) -> String {
    format!("---\nname: Host\ntools:\n  agents: any\n{policy}---\n\n너는 시험 Thread의 Host다.\n")
}

fn agent_md(name: &str) -> String {
    format!("---\nname: {name}\n---\n\n너는 시험 Thread의 {name}다.\n")
}

fn in_cart() -> ThreadLink {
    ThreadLink::Work { slug: "cart".into() }
}

fn permissions<'a>(record: &'a [Value], who: &str) -> Vec<&'a Value> {
    of_kind(record, "permission").into_iter().filter(|line| line["who"] == who).collect()
}

/// 그 참여자의 권한 줄 가운데 그 상태인 `n`번째(1부터)가 나올 때까지 기다린다 — 그 줄.
fn wait_permission(sandbox: &Sandbox, thread: &str, who: &str, state: &str, n: usize) -> Value {
    let of_state = |record: &[Value]| -> Vec<Value> {
        permissions(record, who).into_iter().filter(|line| line["payload"]["state"] == state).cloned().collect()
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

/// 사람이 카드에서 고른 것으로 답한다.
fn reply(host: &ConversationHost, thread: &str, asked: &Value, reply: &Reply) -> Result<(), HostError> {
    let who = asked["who"].as_str().expect("물은 참여자");
    let request = asked["payload"]["requestId"].as_str().expect("요청 id");
    host.reply_thread_permission(thread, who, request, reply)
}

fn remember(option: &str) -> Reply {
    Reply { remember: true, ..Reply::pick(option) }
}

fn policy_file(dir: &std::path::Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.join(".policy.json")).expect("점 파일")).expect("JSON")
}

#[test]
fn work_없는_thread에서_다시_묻지_않기를_고르면_thread_폴더에_허락이_서고_다음_편집은_묻지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    // Host의 턴 둘이 각각 편집(`Write`)을 묻는다 — 경로는 작업 폴더(Thread 폴더)로 옮긴다.
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"), ("FAKE_CLAUDE_REBASE", RECORDED_PLACE)],
    ));
    let thread = host.start_thread("메모를 써 줘", ThreadLink::NoWork).expect("Work 없는 Thread");

    let asked = wait_permission(&sandbox, &thread, "host", "asked", 1);
    assert_eq!(asked["payload"]["grant"], json!(["edit"]), "물어보는 정도가 물은 편집은 편집 허락을 내민다: {asked}");
    reply(&host, &thread, &asked, &remember("allow_once")).expect("다시 묻지 않기");

    let answered = wait_permission(&sandbox, &thread, "host", "answered", 1);
    assert_eq!(answered["payload"]["optionId"], "allow_once", "Runtime에는 이번만 허락으로 답한다 — 기억은 Atelier가 한다");
    assert_eq!(answered["payload"]["granted"], json!({"rules": ["edit"], "work": null}));
    assert_eq!(policy_file(&sandbox.thread_dir(&thread))["grants"], json!(["edit"]), "Work가 없으면 Thread 폴더의 점 파일이다");
    let session = sandbox.thread_session_id(&thread, "host");
    assert_eq!(decisions(&sandbox, &session, 1)[0]["behavior"], "allow");

    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread(&thread, "하나 더 써 줘").expect("두 번째 말");
    let decided = wait_permission(&sandbox, &thread, "host", "decided", 1);
    assert_eq!(
        (decided["payload"]["optionId"].clone(), decided["payload"]["reason"].clone()),
        (json!("allow_once"), json!("이 Thread에서는 다시 묻지 않기")),
        "같은 종류의 다음 요청은 묻지 않는다"
    );
    let asks = permissions(&sandbox.thread_record(&thread), "host")
        .iter()
        .filter(|line| line["payload"]["state"] == "asked")
        .count();
    assert_eq!(asks, 1, "카드는 처음 한 번만 섰다");

    host.shut_down();
}

#[test]
fn work에서_다시_묻지_않기를_고르면_work_점_파일에_명령의_머리가_서고_같은_work의_다른_thread도_묻지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    sandbox.library_agent("runner", &agent_md("러너"));
    sandbox.work("cart", &["fe"]);
    // 둘 다 첫 턴에 명령(`python3 -c …`)을 묻는다.
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/g4-background")]));

    let first = host.start_thread("배경 작업을 돌려 줘", in_cart()).expect("Host의 Thread");
    let asked = wait_permission(&sandbox, &first, "host", "asked", 1);
    assert_eq!(asked["payload"]["grant"], json!(["Bash(python3 *)"]), "{asked}");
    reply(&host, &first, &asked, &remember("allow_once")).expect("다시 묻지 않기");
    let answered = wait_permission(&sandbox, &first, "host", "answered", 1);
    assert_eq!(answered["payload"]["granted"], json!({"rules": ["Bash(python3 *)"], "work": "cart"}));
    assert_eq!(policy_file(&sandbox.work_dir("cart"))["grants"], json!(["Bash(python3 *)"]));
    assert!(!sandbox.thread_dir(&first).join(".policy.json").exists(), "Work에 이은 Thread는 Work의 것이다");

    let second = host.start_thread("@runner 배경 작업을 돌려 줘", in_cart()).expect("같은 Work의 다른 Thread");
    let decided = wait_permission(&sandbox, &second, "runner", "decided", 1);
    assert_eq!(
        (decided["payload"]["optionId"].clone(), decided["payload"]["reason"].clone()),
        (json!("allow_once"), json!("이 Work에서는 다시 묻지 않기"))
    );

    host.shut_down();
}

#[test]
fn 아니요를_고르며_쓴_말은_거절과_함께_agent에게_가고_답_줄에_남는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"), ("FAKE_CLAUDE_REBASE", RECORDED_PLACE)],
    ));
    let thread = host.start_thread("메모를 써 줘", ThreadLink::NoWork).expect("Work 없는 Thread");

    let asked = wait_permission(&sandbox, &thread, "host", "asked", 1);
    let words = "파일 말고 이 Thread에 바로 적어 줘";
    reply(&host, &thread, &asked, &Reply { words: Some(words.to_owned()), ..Reply::pick("reject") }).expect("거절과 말");

    let answered = wait_permission(&sandbox, &thread, "host", "answered", 1);
    assert_eq!((answered["payload"]["optionId"].clone(), answered["payload"]["words"].clone()), (json!("reject"), json!(words)));
    assert!(answered["payload"].get("granted").is_none(), "{answered}");
    let session = sandbox.thread_session_id(&thread, "host");
    let told = format!("사람이 이 요청을 거절하고 이렇게 말했어요 — 그대로 다시 하지 말고 이 말을 따르세요:\n{words}");
    assert_eq!(decisions(&sandbox, &session, 1), [json!({"behavior": "deny", "message": told})]);

    host.shut_down();
}

#[test]
fn ask_before가_물은_요청에는_다시_묻지_않기를_줄_수_없고_요청은_그대로_걸려_있다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md("policy:\n  ask_before: [\"Bash(python3 *)\"]\n"));
    sandbox.work("cart", &["fe"]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/g4-background")]));
    let thread = host.start_thread("배경 작업을 돌려 줘", in_cart()).expect("Host의 Thread");

    let asked = wait_permission(&sandbox, &thread, "host", "asked", 1);
    assert_eq!(asked["payload"]["policy"], "「python3」 실행 전에 묻기");
    assert!(asked["payload"].get("grant").is_none(), "허락은 ask_before를 넘기지 못한다 — 내밀지 않는다: {asked}");
    let refused = reply(&host, &thread, &asked, &remember("allow_once")).expect_err("줄 허락이 없다");
    assert!(matches!(refused, HostError::PermissionNoGrant { .. }), "{refused:?}");
    assert!(!sandbox.work_dir("cart").join(".policy.json").exists(), "아무것도 적지 않았다");

    reply(&host, &thread, &asked, &Reply::pick("allow_once")).expect("요청은 그대로 걸려 있어 이번만 허락할 수 있다");
    let answered = wait_permission(&sandbox, &thread, "host", "answered", 1);
    assert_eq!(answered["payload"]["optionId"], "allow_once");

    host.shut_down();
}
