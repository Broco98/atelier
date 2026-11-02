//! L1 — 다시 잇기(restart 티켓 01b-6 · 스토리 55, 56). 말을 보내지 않고 재개 차례로 Session만 연다. 끊긴 턴은 다시 보내지 않는다.
//!
//! 시험은 호스트의 Thread 명령, Thread 기록, 가짜 claude의 영수증(뜬 인자 · 받은 stdin)만 본다. 끊김은 변환기와 claude의 프로세스 그룹을 바깥에서
//! 꺼 만든다 — 앱이 끈 것이 아니다.

mod common;

use std::os::unix::fs::PermissionsExt;

use atelier_acp::{Agent, ConversationHost, HostError, ThreadLink, TranslatorCommand};
use common::{of_kind, sent_texts, wait_until, write_script, Sandbox, NO_BROWSER};
use serde_json::{json, Value};

/// 멈추기 전에는 끝나지 않는 첫 턴의 말 — 원문은 40초 자는 명령을 돌리다 interrupt로 멈춘 턴이다.
const HELD_TURN: &str = "40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해";

fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
    args.windows(2).any(|pair| pair[0] == flag && pair[1] == value)
}

/// 첫 턴이 도는 Thread. 도구 줄이 선 뒤에 돌려준다. `extra`는 가짜 claude에게 주는 env다.
fn turning(sandbox: &Sandbox, extra: &[(&str, &str)]) -> (ConversationHost, String) {
    let mut env = vec![("FAKE_CLAUDE_FIXTURE", "2.1.309/interrupt-sigint")];
    env.extend_from_slice(extra);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &env));
    let thread = host.start_thread(HELD_TURN, ThreadLink::NoWork).expect("첫 말");
    wait_tool_line(sandbox, &thread);
    (host, thread)
}

fn wait_tool_line(sandbox: &Sandbox, thread: &str) {
    sandbox.wait_thread_record(thread, |record| {
        of_kind(record, "update").iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });
}

/// 도는 턴을 끊는다 — 변환기와 claude의 그룹을 바깥에서 끄고 죽음 줄을 기다린다.
fn cut(sandbox: &Sandbox, thread: &str) {
    let session = sandbox.thread_session_id(thread);
    let translator = sandbox.claude_receipt(&session)["ppid"].as_u64().unwrap() as i32;
    // SAFETY: 이 시험이 띄운 변환기의 프로세스 그룹에 신호를 보낼 뿐이다.
    unsafe { libc::killpg(translator, libc::SIGKILL) };
    sandbox.wait_thread_record(thread, |record| record.iter().any(|line| line["payload"]["state"] == "died"));
}

/// 그 Session의 claude가 받은 사람의 말 수.
fn heard(sandbox: &Sandbox, session: &str) -> usize {
    sandbox.claude_stdin(session).iter().filter(|line| line["type"] == "user").count()
}

/// Session을 띄운 수 — 띄우는 중 줄의 수.
fn spawns(record: &[Value]) -> usize {
    record.iter().filter(|line| line["payload"]["state"] == "spawning").count()
}

#[test]
fn 다시_잇기는_끊긴_턴을_보내지_않고_같은_session만_연다() {
    let sandbox = Sandbox::new();
    let (host, thread) = turning(&sandbox, &[]);
    let session = sandbox.thread_session_id(&thread);
    cut(&sandbox, &thread);
    assert!(!host.thread(&thread).unwrap().live);

    host.reconnect_thread(&thread).expect("다시 잇기");

    let launches = sandbox.claude_launch_args();
    assert_eq!(launches.len(), 2, "claude가 다시 떴다");
    assert!(has_pair(&launches[1], "--resume", &session), "{:?}", launches[1]);
    let record = sandbox.thread_record(&thread);
    assert_eq!(common::opened_hows(&record), ["new", "resumed"]);
    assert_eq!(sent_texts(&record), [HELD_TURN], "기록에 새 말이 서지 않는다");
    assert_eq!(heard(&sandbox, &session), 1, "끊긴 턴을 다시 보내지 않는다");
    assert!(host.thread(&thread).unwrap().live, "다시 이은 Session은 떠 있다");

    host.shut_down();
}

#[test]
fn 다시_잇기는_산_턴을_끊지_않는다() {
    let sandbox = Sandbox::new();
    let (host, thread) = turning(&sandbox, &[]);
    let session = sandbox.thread_session_id(&thread);

    host.reconnect_thread(&thread).expect("떠 있으면 할 일이 없다");

    assert_eq!(sandbox.claude_launch_args().len(), 1, "다시 띄우지 않는다");
    assert_eq!(spawns(&sandbox.thread_record(&thread)), 1);
    assert!(
        !sandbox.claude_stdin(&session).iter().any(|line| line["request"]["subtype"] == "interrupt"),
        "멈추지도 않는다"
    );
    host.stop_thread(&thread).expect("멈추기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    assert_eq!(of_kind(&record, "turn-end")[0]["payload"]["stopReason"], "cancelled", "그 턴은 그때까지 돌았다");

    host.shut_down();
}

#[test]
fn 세션이_열리면_대기_줄이_맨_앞부터_간다() {
    let sandbox = Sandbox::new();
    let (host, thread) = turning(&sandbox, &[("FAKE_CLAUDE_LAUNCH_FIXTURES", r#"[null, "2.1.309/twoturn-tools"]"#)]);
    let session = sandbox.thread_session_id(&thread);
    host.send_to_thread(&thread, "앞의 말").expect("도는 동안의 말");
    host.send_to_thread(&thread, "뒤의 말").expect("도는 동안의 말");
    cut(&sandbox, &thread);
    assert_eq!(host.thread(&thread).unwrap().queue.len(), 2, "죽어도 대기 줄은 남는다");

    host.reconnect_thread(&thread).expect("다시 잇기");

    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    assert_eq!(sent_texts(&record), [HELD_TURN, "앞의 말", "뒤의 말"]);
    assert_eq!(heard(&sandbox, &session), 3, "끊긴 턴 하나와 대기 줄의 둘이다 — 끊긴 턴은 다시 가지 않는다");
    assert!(host.thread(&thread).unwrap().queue.is_empty());

    host.shut_down();
}

#[test]
fn 새_세션으로_떨어져도_끊긴_턴을_보내지_않고_다음_말에_지난_말이_붙는다() {
    let sandbox = Sandbox::new();
    let (host, thread) = turning(&sandbox, &[("FAKE_CLAUDE_FORGETS", "1")]);
    let first = sandbox.thread_session_id(&thread);
    cut(&sandbox, &thread);

    host.reconnect_thread(&thread).expect("새 세션으로라도 열린다");

    let record = sandbox.thread_record(&thread);
    assert_eq!(common::opened_hows(&record), ["new", "fresh"]);
    assert_eq!(sent_texts(&record), [HELD_TURN]);
    let second = sandbox.thread_session_id(&thread);
    assert_ne!(second, first);
    assert_eq!(heard(&sandbox, &second), 0, "새 세션에도 보내지 않는다");

    host.send_to_thread(&thread, "이어서 해 줘").expect("다음 말");
    let user = wait_until("새 세션이 말을 받지 않았다", || {
        let lines = sandbox.claude_stdin(&second);
        lines.into_iter().find(|line| line["type"] == "user").ok_or_else(String::new)
    });
    let content = user["message"]["content"].as_array().expect("블록들").clone();
    assert_eq!(content.len(), 3, "머리말 · 지난 말 · 사람의 말: {content:?}");
    let past = content[1]["text"].as_str().unwrap();
    assert!(past.starts_with("지난 말 — ") && past.contains(&format!("[사람]\n{HELD_TURN}")), "{past}");
    assert_eq!(content[2]["text"], "이어서 해 줘");

    host.shut_down();
}

#[test]
fn 읽기만_된_thread는_다시_잇지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    let thread = host.start_thread("장바구니 문서를 정리하자", ThreadLink::Work { slug: "cart".into() }).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let root = sandbox.data_root();
    atelier_core::archive_work(
        &atelier_core::works_in(&root),
        &atelier_core::archive_in(&root),
        &atelier_core::projects_in(&root),
        "cart",
    )
    .expect("보관");
    host.check_vanished_works();
    let launches = sandbox.claude_launch_args().len();

    assert_eq!(
        host.reconnect_thread(&thread),
        Err(HostError::ReadOnly { thread: thread.clone(), gone: atelier_core::WorkGone::Archived })
    );

    assert_eq!(sandbox.claude_launch_args().len(), launches, "띄우지 않는다");
    host.shut_down();
}

#[test]
fn 다시_잇지_못하면_까닭을_돌려주고_기록에_남기며_다시_부르면_열린다() {
    let sandbox = Sandbox::new();
    let gate = sandbox.bin("gated-translator");
    let blocked = gate.join("blocked");
    let wrapper = gate.join("acp-claude");
    write_script(
        &wrapper,
        &format!("#!/bin/sh\n[ -e '{}' ] && exit 7\nexec '{}'\n", blocked.display(), env!("CARGO_BIN_EXE_claude-translator")),
    );
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let shell = sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/interrupt-sigint")]);
    let translator = TranslatorCommand::new(&wrapper, Vec::<String>::new());
    let host = sandbox.host_builder_with_translator(shell, translator, |_| {}).build();
    let thread = host.start_thread(HELD_TURN, ThreadLink::NoWork).expect("첫 말");
    wait_tool_line(&sandbox, &thread);
    let session = sandbox.thread_session_id(&thread);
    cut(&sandbox, &thread);
    std::fs::write(&blocked, "").unwrap();

    let failed = host.reconnect_thread(&thread).expect_err("변환기가 뜨지 못한다");

    let HostError::Open { reason, .. } = &failed else { panic!("열기 실패여야 한다: {failed:?}") };
    let record = sandbox.thread_record(&thread);
    assert_eq!(record.last().unwrap()["payload"]["state"], "died", "{}", common::lines_text(&record));
    assert_eq!(record.last().unwrap()["payload"]["reason"], json!(reason), "화면이 기록에서도 까닭을 읽는다");
    assert!(!host.thread(&thread).unwrap().live);

    std::fs::remove_file(&blocked).unwrap();
    host.reconnect_thread(&thread).expect("다시 부르면 열린다");

    assert_eq!(common::opened_hows(&sandbox.thread_record(&thread)), ["new", "resumed"]);
    assert_eq!(heard(&sandbox, &session), 1, "끊긴 턴은 그때도 가지 않는다");
    host.shut_down();
}

#[test]
fn 로그인이_필요하면_실패가_아니라_로그인_필요_줄이_서고_다시_불러도_띄우지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.log_in(Agent::Codex);
    let version = env!("CARGO_PKG_VERSION");
    let shell = || sandbox.login_shell_for_login("needs-auth", NO_BROWSER, &[("FAKE_ACP_VERSION", version)]);
    let agent = || TranslatorCommand::new(env!("CARGO_BIN_EXE_fake-acp-agent"), Vec::<String>::new());
    let host = sandbox.host_builder_with_translator(shell(), agent(), |_| {}).build();
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    sandbox.log_out(Agent::Codex);

    let host = sandbox.host_builder_with_translator(shell(), agent(), |_| {}).build();
    host.reconnect_thread(&thread).expect("로그인 필요는 실패가 아니다");

    let record = sandbox.thread_record(&thread);
    assert_eq!(record.last().unwrap()["payload"], json!({"state": "login-required"}), "{}", common::lines_text(&record));
    let spawned = spawns(&record);
    host.reconnect_thread(&thread).expect("로그인 창구가 이미 쥐었다");
    assert_eq!(spawns(&sandbox.thread_record(&thread)), spawned, "로그인을 기다리는 동안은 띄우지 않는다");

    host.shut_down();
}
