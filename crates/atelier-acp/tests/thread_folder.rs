//! L1 — Thread의 기록 폴더가 사라지면 그 Thread의 Session을 끈다(구현 스펙 §5 「끄는 때」, 코드 리뷰 1차 B9). 쉬던 Session은 Thread
//! 폴더가 사라진 소식(`check_vanished_threads`, 앱에서는 `threads/` 감시)에 곧바로, 도는 턴은 그 턴이 끝나는 대로 끈다 — 보관된
//! Work의 Thread와 같은 차례다(`thread_archive.rs`).
//!
//! 시험은 호스트의 Thread 명령과 가짜 claude의 영수증(프로세스 · stdin)만 본다.

mod common;

use atelier_acp::{ConversationHost, ThreadLink};
use common::{of_kind, Sandbox};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ndescription: 시험의 Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 그 Session의 claude와 변환기 프로세스.
fn session_pids(sandbox: &Sandbox, thread: &str) -> [u32; 2] {
    let receipt = sandbox.claude_receipt(&sandbox.thread_session_id(thread, "host"));
    [receipt["pid"].as_u64().unwrap() as u32, receipt["ppid"].as_u64().unwrap() as u32]
}

/// Work 없는 Thread 하나 — 첫 턴이 끝날 때까지 기다린다.
fn settled(sandbox: &Sandbox, host: &ConversationHost, text: &str) -> String {
    let thread = host.start_thread(text, ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    thread
}

#[test]
fn thread_폴더가_사라지면_그_thread의_쉬던_session만_꺼진다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    let gone = settled(&sandbox, &host, "메모를 정리하자");
    let kept = settled(&sandbox, &host, "다른 메모도 보자");
    let (gone_pids, kept_pids) = (session_pids(&sandbox, &gone), session_pids(&sandbox, &kept));

    std::fs::remove_dir_all(sandbox.thread_dir(&gone)).unwrap();
    host.check_vanished_threads();

    common::assert_all_gone(&gone_pids);
    assert!(kept_pids.iter().all(|pid| common::is_running(*pid)), "다른 Thread의 Session은 그대로다");

    host.shut_down();
}

#[test]
fn 턴이_도는_동안_thread_폴더가_사라지면_그_턴은_이어_돌고_끝난_뒤에_session이_꺼진다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    // 원문은 40초 자는 명령을 돌리다 interrupt로 멈춘 턴이다 — 멈추기 전에는 끝나지 않는다.
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/interrupt-sigint")]));
    let thread = host.start_thread("40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해", ThreadLink::NoWork).expect("첫 말");
    sandbox.wait_thread_record(&thread, |record| {
        of_kind(record, "update").iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });
    let pids = session_pids(&sandbox, &thread);

    std::fs::remove_dir_all(sandbox.thread_dir(&thread)).unwrap();
    host.check_vanished_threads();
    assert!(pids.iter().all(|pid| common::is_running(*pid)), "도는 턴은 끊지 않는다");

    // 사람이 그 턴을 멈춘다 — 턴이 끝나면 엔진이 Session을 끈다.
    host.stop_thread(&thread).expect("멈추기");
    common::assert_all_gone(&pids);

    host.shut_down();
}
