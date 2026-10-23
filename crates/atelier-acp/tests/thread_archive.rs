//! L1 — 보관된 Work의 Thread는 읽기만 된다(v1 티켓 38 · 구현 스펙 §4 · §5 · §11 「보관」).
//!
//! - Work가 보관되거나 지워지면 엔진이 그 Work에 이은 Thread의 Session을 **지금 턴 뒤에** 끈다 — 쉬던 Session은 Work 목록이 바뀐 소식
//!   (`check_vanished_works`, 앱에서는 `works:changed`)에 곧바로, 도는 턴은 그 턴이 끝나는 대로.
//! - 그 Thread에는 말을 보내지 못한다 — 사람의 말 · 지금 전하기 · 다시 맡기기 · 이름 바꾸기를 거절하고 아무것도 적지 않는다.
//! - 그 Thread의 지금(`thread`)과 목록 요약이 읽기만인 까닭(보관됨 · 지워짐)을 싣는다 — 바뀐 요약은 이벤트로 나간다.
//!
//! 시험은 호스트의 Thread 명령 · 이벤트, Thread 기록, 가짜 claude의 영수증(프로세스 · stdin)만 본다. 보관은 core의 보관(`archive_work`)
//! 그대로다.

mod common;

use atelier_acp::{ConversationHost, HostError, ThreadLink};
use atelier_core::WorkGone;
use common::{of_kind, Sandbox};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ndescription: 시험의 Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

fn in_cart() -> ThreadLink {
    ThreadLink::Work { slug: "cart".into() }
}

/// core의 보관 그대로 — 검증 → 기록 → 폴더째 `archive/<slug>`로 옮긴다.
fn archive(sandbox: &Sandbox, slug: &str) {
    let root = sandbox.data_root();
    atelier_core::archive_work(
        &atelier_core::works_in(&root),
        &atelier_core::archive_in(&root),
        &atelier_core::projects_in(&root),
        slug,
    )
    .expect("보관");
}

/// 그 Session의 claude와 변환기 프로세스.
fn session_pids(sandbox: &Sandbox, thread: &str) -> [u32; 2] {
    let receipt = sandbox.claude_receipt(&sandbox.thread_session_id(thread, "host"));
    [receipt["pid"].as_u64().unwrap() as u32, receipt["ppid"].as_u64().unwrap() as u32]
}

fn read_only(thread: &str, gone: WorkGone) -> Result<(), HostError> {
    Err(HostError::ReadOnly { thread: thread.to_owned(), gone })
}

/// Work에 이은 Thread — 첫 턴이 끝날 때까지 기다린다.
fn settled(sandbox: &Sandbox) -> (ConversationHost, common::Events, String) {
    sandbox.library_agent("host", HOST_MD);
    sandbox.work("cart", &[]);
    let (host, events) = sandbox.host_with_events(sandbox.claude_login_shell("normal", &[]));
    let thread = host.start_thread("장바구니 문서를 정리하자", in_cart()).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    (host, events, thread)
}

#[test]
fn 보관된_work의_thread는_쉬던_session이_꺼지고_말을_거절하며_지금과_요약이_보관됨을_싣는다() {
    let sandbox = Sandbox::new();
    let (host, events, thread) = settled(&sandbox);
    let pids = session_pids(&sandbox, &thread);
    assert_eq!(host.thread(&thread).unwrap().read_only, None, "진행 중인 Work의 Thread는 말할 수 있다");
    let before = sandbox.thread_record(&thread).len();

    archive(&sandbox, "cart");
    host.check_vanished_works();

    common::assert_all_gone(&pids);
    let view = host.thread(&thread).expect("Thread의 지금");
    assert_eq!(view.read_only, Some(WorkGone::Archived));
    assert!(!view.live, "떠 있는 Session이 없다");
    let summary = host.list_threads().unwrap().into_iter().find(|summary| summary.id == thread).unwrap();
    assert_eq!(summary.read_only, Some(WorkGone::Archived), "목록 요약도 읽기만이다");
    let announced = events.thread_lists().into_iter().filter(|summary| summary.id == thread).last().expect("요약 이벤트");
    assert_eq!(announced.read_only, Some(WorkGone::Archived), "바뀐 요약을 알린다 — 열린 화면 · 사이드바가 따라온다(S7)");

    assert_eq!(host.send_to_thread(&thread, "하나 더 정리해 줘"), read_only(&thread, WorkGone::Archived));
    assert_eq!(host.send_to_thread(&thread, "@reviewer 봐 줘"), read_only(&thread, WorkGone::Archived), "새 Agent도 들이지 않는다");
    assert_eq!(host.call_again(&thread, "host", "reviewer", "봐 줘"), read_only(&thread, WorkGone::Archived));
    assert_eq!(host.rename_thread(&thread, "새 이름").map(drop), read_only(&thread, WorkGone::Archived));
    assert_eq!(
        sandbox.thread_record(&thread).len(),
        before,
        "읽기만 된 Thread의 기록은 바뀌지 않는다:\n{}",
        common::lines_text(&sandbox.thread_record(&thread))
    );
    assert_eq!(sandbox.all_claude_receipts().len(), 1, "Session을 다시 띄우지 않았다");

    host.shut_down();
}

#[test]
fn 지워진_work의_thread도_읽기만이고_쉬던_session이_꺼진다() {
    let sandbox = Sandbox::new();
    let (host, _events, thread) = settled(&sandbox);
    let pids = session_pids(&sandbox, &thread);

    std::fs::remove_dir_all(sandbox.work_dir("cart")).unwrap();
    host.check_vanished_works();

    common::assert_all_gone(&pids);
    assert_eq!(host.thread(&thread).unwrap().read_only, Some(WorkGone::Removed));
    assert_eq!(host.send_to_thread(&thread, "하나 더"), read_only(&thread, WorkGone::Removed));

    host.shut_down();
}

#[test]
fn 턴이_도는_동안_보관되면_그_턴은_이어_돌고_끝난_뒤에_session이_꺼지며_대기_줄의_말은_가지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.work("cart", &[]);
    // 원문은 40초 자는 명령을 돌리다 interrupt로 멈춘 턴이다 — 멈추기 전에는 끝나지 않는다.
    let shell = sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/interrupt-sigint")]);
    let (host, events) = sandbox.host_with_events(shell);
    let thread = host.start_thread("40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해", in_cart()).expect("첫 말");
    sandbox.wait_thread_record(&thread, |record| {
        of_kind(record, "update").iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });
    host.send_to_thread(&thread, "끝나면 한 줄로 알려 줘").expect("보관 전에 온 말은 대기 줄에 든다");
    let pids = session_pids(&sandbox, &thread);

    archive(&sandbox, "cart");
    host.check_vanished_works();

    assert!(pids.iter().all(|pid| common::is_running(*pid)), "도는 턴은 끊지 않는다 — 보관을 시킨 Agent가 그 턴 안에 있을 수 있다");
    let session = sandbox.thread_session_id(&thread, "host");
    assert!(
        !sandbox.claude_stdin(&session).iter().any(|line| line["request"]["subtype"] == "interrupt"),
        "멈추지도 않는다"
    );
    assert_eq!(host.thread(&thread).unwrap().read_only, Some(WorkGone::Archived), "말은 이미 받지 않는다");
    assert_eq!(host.send_to_thread(&thread, "하나 더"), read_only(&thread, WorkGone::Archived));

    // 사람이 그 턴을 멈춘다 — 멈추기는 말이 아니라 읽기만 된 Thread에도 건다. 턴이 끝나면 엔진이 Session을 끈다.
    host.stop_thread(&thread).expect("멈추기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    common::assert_all_gone(&pids);
    assert_eq!(
        common::sent_texts(&record),
        ["40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해"],
        "대기 줄의 말은 가지 않는다"
    );
    let (who, queue) = events.thread_queues(&thread).last().cloned().expect("대기 줄 바뀜");
    assert_eq!((who.as_str(), queue.len()), ("host", 0), "꺼진 Session의 대기 줄은 비었다고 알린다");
    assert!(host.thread(&thread).unwrap().queues.is_empty());

    host.shut_down();
}
