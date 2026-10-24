//! L1 — 문서 쓰는 중(v1 티켓 34 · 구현 스펙 §12 「문서」 · §18 `work:writing`). Work에 이은 Thread의 Agent가 그 Work의 spec 폴더 안
//! 파일에 편집 도구를 세우면 엔진이 그 Work의 「누가 어느 문서를 쓰는 중」 목록을 내고, 도구가 끝나거나 턴이 끝나면 걷는다. Work 카드의
//! 문서 줄이 이것으로 파란 점과 「Host가 쓰는 중」을 세운다(스토리 108).
//!
//! Project 없는 Work라 Session의 작업 폴더가 spec 폴더다(S11 표) — 녹음의 `Write` 경로를 그 자리로 옮기면 spec 폴더 안 편집이 된다.
//! 시험은 호스트가 내보낸 이벤트와 Thread 기록만 본다.

mod common;

use atelier_acp::{DocWriting, HostEvent, ThreadLink};
use common::{of_kind, wait_until, Sandbox};
use serde_json::Value;

const HOST_MD: &str = "---\nname: 진행자\n---\n\n너는 시험 Thread의 Host다.\n";

/// 그 Work에 대해 낸 `work:writing` 목록들 — 낸 차례대로.
fn writings(events: &common::Events, work: &str) -> Vec<Vec<DocWriting>> {
    events
        .all()
        .into_iter()
        .filter_map(|event| match event {
            HostEvent::WorkWriting { work: of, writing } if of == work => Some(writing),
            _ => None,
        })
        .collect()
}

fn wait_permission(sandbox: &Sandbox, thread: &str, state: &str) -> Value {
    let found = |record: &[Value]| {
        of_kind(record, "permission").into_iter().find(|line| line["payload"]["state"] == state).cloned()
    };
    let record = sandbox.wait_thread_record(thread, |record| found(record).is_some());
    found(&record).expect("기다린 줄")
}

#[test]
fn spec_폴더의_문서에_편집_도구가_서면_그_work의_쓰는_중_목록에_들고_턴이_끝나면_빠진다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.work("plan", &[]);
    let shell = sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"), ("FAKE_CLAUDE_REBASE", common::RECORDED_PLACE)],
    );
    let (host, events) = sandbox.host_with_events(shell);

    let thread = host.start_thread("설계 문서를 써 줘", ThreadLink::Work { slug: "plan".into() }).expect("Work에 이은 Thread");
    // Host가 spec 폴더의 `allowed.txt`를 쓰려고 묻는 동안 — 곧 쓸 문서라 쓰는 중이다. 이름은 「Host」다(정의 이름과 상관없이).
    let asked = wait_permission(&sandbox, &thread, "asked");
    assert_eq!(asked["payload"]["toolCall"]["kind"], "edit");
    let first = DocWriting { path: "allowed.txt".into(), who: "host".into(), name: "Host".into(), thread: thread.clone() };
    assert_eq!(writings(&events, "plan"), vec![vec![first.clone()]], "쓰기 시작 하나만 낸다");
    assert!(
        events.all().iter().all(|event| !matches!(event, HostEvent::WorkWriting { work, .. } if work != "plan")),
        "다른 Work의 목록은 내지 않는다"
    );

    // 허락하면 그 도구가 끝나 빠진다 — 빈 목록을 한 번 내고, 턴 끝은 걷을 것이 없어 다시 내지 않는다.
    let request = asked["payload"]["requestId"].as_str().expect("요청 id").to_owned();
    host.answer_thread_permission(&thread, "host", &request, "allow_once").expect("사람의 답");
    let seen = wait_until("쓰는 중 목록이 비지 않았다", || {
        let seen = writings(&events, "plan");
        if seen.last().is_some_and(Vec::is_empty) {
            Ok(seen)
        } else {
            Err(format!("{seen:#?}"))
        }
    });
    assert_eq!(seen, vec![vec![first], Vec::new()], "도구가 끝나면 빈 목록을 낸다");

    host.shut_down();
}
