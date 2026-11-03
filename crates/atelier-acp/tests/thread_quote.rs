//! L1 — 넓힌 카드의 문서에서 고른 글의 인용이 지금 Thread의 보낼 말에 붙는다(v1 티켓 35 · 구현 스펙 §15 S41). 인용 블록의 꼴은
//! three-axes 티켓 27의 것 그대로다 — 그 Work의 spec 폴더 안 실제 경로 + 줄 범위 한 줄, 빈 줄, 고른 글의 마크다운 인용.
//!
//! 새 채팅의 첫 말(채팅을 세우는 명령)도 인용을 받는다(restart 02a-11 — 작업공간의 새 채팅 탭).
//!
//! 시험은 호스트에 Thread 명령을 넣고, Thread 기록과 가짜 claude의 영수증(stdin의 user 줄)만 본다.

mod common;

use atelier_acp::{Quote, StartPicks, ThreadLink};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

fn two_turns(sandbox: &Sandbox) -> atelier_acp::ShellSource {
    sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")])
}

/// 그 Session의 claude가 받은 말(stdin의 user 줄)의 블록들.
fn heard(sandbox: &Sandbox, session: &str) -> Vec<Value> {
    sandbox
        .claude_stdin(session)
        .into_iter()
        .filter(|line| line["type"] == "user")
        .map(|line| line["message"]["content"].clone())
        .collect()
}

/// 넓힌 카드의 `design.md`에서 고른 두 줄.
fn picked() -> Quote {
    Quote {
        file: "design.md".into(),
        start: 3,
        end: 4,
        text: "차감은 결제사 응답 뒤 한 번만 한다.\n남은 금액은 refunded_amount로 계산한다.".into(),
    }
}

#[test]
fn 인용한_말은_spec_폴더의_실제_경로와_줄_범위의_인용_블록이_본문_바로_앞에_가고_sent_줄에_인용이_남는다() {
    let sandbox = Sandbox::new();
    sandbox.work("plan", &[]);
    let host = sandbox.host(two_turns(&sandbox));

    let thread = host.start_thread("설계를 같이 보자", ThreadLink::Work { slug: "plan".into() }).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread_quoting(&thread, "이 부분 다시 봐 줘", &[], Some(&picked())).expect("인용한 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);

    let doc = sandbox.work_dir("plan").join("spec").join("design.md");
    let session = sandbox.thread_session_id(&thread);
    assert_eq!(
        heard(&sandbox, &session)[1],
        json!([
            {
                "type": "text",
                "text": format!(
                    "{}:L3-4\n\n> 차감은 결제사 응답 뒤 한 번만 한다.\n> 남은 금액은 refunded_amount로 계산한다.\n\n",
                    doc.display()
                )
            },
            {"type": "text", "text": "이 부분 다시 봐 줘"}
        ]),
        "인용 블록은 본문 바로 앞이다 — claude가 본문과 이어 읽지 않게 빈 줄로 끝난다"
    );
    let sent = of_kind(&record, "sent");
    assert_eq!(
        sent[1]["payload"]["quote"],
        json!({"file": "design.md", "start": 3, "end": 4, "text": picked().text}),
        "sent 줄에 인용이 남는다 — 화면이 보낸 말 위에 세운다"
    );
    assert_eq!(sent[1]["payload"]["text"], "이 부분 다시 봐 줘", "본문은 사람이 쓴 글 그대로다");
    assert!(sent[0]["payload"].get("quote").is_none(), "인용 없는 말은 앞 장의 꼴 그대로다");

    host.shut_down();
}

#[test]
fn 인용이_spec_폴더_밖을_가리키거나_work_없는_thread면_보내기_전에_거절하고_아무것도_적지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("plan", &[]);
    let host = sandbox.host(two_turns(&sandbox));

    let linked = host.start_thread("설계를 같이 보자", ThreadLink::Work { slug: "plan".into() }).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&linked, "turn-end", 1);
    let before = sandbox.thread_record(&linked).len();
    let outside = Quote { file: "../work.json".into(), ..picked() };
    let refused = host.send_to_thread_quoting(&linked, "이것도", &[], Some(&outside)).unwrap_err();
    assert_eq!(refused.to_string(), "인용한 파일이 spec 폴더 안에 있지 않습니다");
    assert_eq!(sandbox.thread_record(&linked).len(), before, "기록에 아무것도 적지 않는다");

    let loose = host.start_thread("안녕", ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&loose, "turn-end", 1);
    let before = sandbox.thread_record(&loose).len();
    let refused = host.send_to_thread_quoting(&loose, "이것도", &[], Some(&picked())).unwrap_err();
    assert_eq!(refused.to_string(), "작업공간에 이어지지 않은 채팅에는 인용을 붙일 수 없습니다");
    assert_eq!(sandbox.thread_record(&loose).len(), before, "기록에 아무것도 적지 않는다");

    host.shut_down();
}

// restart 02a-11 — 작업공간의 새 채팅 탭은 첫 말 전에 넓힌 카드에서 문서를 읽고 인용을 붙인다. 첫 말은 채팅을 세우는 명령으로 가므로 그
// 명령도 인용을 받는다 — 인용 블록이 첫 말 본문 바로 앞(머리말 뒤)에 가고, `sent` 줄에 남는다.
#[test]
fn 새_채팅의_첫_말에_붙은_인용은_머리말_뒤_본문_바로_앞에_가고_sent_줄에_남는다() {
    let sandbox = Sandbox::new();
    sandbox.work("plan", &[]);
    let host = sandbox.host(two_turns(&sandbox));

    let thread = host
        .start_thread_quoting("이 부분부터 보자", &[], ThreadLink::Work { slug: "plan".into() }, StartPicks::default(), Some(&picked()))
        .expect("인용한 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);

    let doc = sandbox.work_dir("plan").join("spec").join("design.md");
    let session = sandbox.thread_session_id(&thread);
    let first = heard(&sandbox, &session)[0].as_array().expect("첫 말의 블록들").clone();
    assert!(first.len() >= 3, "머리말 · 인용 · 본문이 간다 — {first:?}");
    assert_eq!(
        first[first.len() - 2..],
        [
            json!({
                "type": "text",
                "text": format!(
                    "{}:L3-4\n\n> 차감은 결제사 응답 뒤 한 번만 한다.\n> 남은 금액은 refunded_amount로 계산한다.\n\n",
                    doc.display()
                )
            }),
            json!({"type": "text", "text": "이 부분부터 보자"}),
        ],
        "인용 블록은 첫 말 본문 바로 앞이다"
    );
    let sent = of_kind(&record, "sent");
    assert_eq!(sent[0]["payload"]["quote"], json!({"file": "design.md", "start": 3, "end": 4, "text": picked().text}));
    assert_eq!(sent[0]["payload"]["text"], "이 부분부터 보자", "본문은 사람이 쓴 글 그대로다");

    host.shut_down();
}

// 인용이 틀리면 채팅을 세우기 전에 거절한다 — 채팅 파일도 Session도 서지 않는다. 화면은 거절을 받아 쓰던 글과 인용 칩을 되돌린다.
#[test]
fn 새_채팅의_첫_말에_붙은_인용이_틀리면_채팅을_세우지_않고_거절한다() {
    let sandbox = Sandbox::new();
    sandbox.work("plan", &[]);
    let host = sandbox.host(two_turns(&sandbox));

    let outside = Quote { file: "../work.json".into(), ..picked() };
    let refused = host
        .start_thread_quoting("이것도", &[], ThreadLink::Work { slug: "plan".into() }, StartPicks::default(), Some(&outside))
        .unwrap_err();
    assert_eq!(refused.to_string(), "인용한 파일이 spec 폴더 안에 있지 않습니다");

    let refused = host
        .start_thread_quoting("이것도", &[], ThreadLink::NoWork, StartPicks::default(), Some(&picked()))
        .unwrap_err();
    assert_eq!(refused.to_string(), "작업공간에 이어지지 않은 채팅에는 인용을 붙일 수 없습니다");

    assert_eq!(host.list_threads().expect("채팅 목록").len(), 0, "채팅을 세우지 않는다");
    assert!(sandbox.claude_launches().is_empty(), "Session을 띄우지 않는다");

    host.shut_down();
}
