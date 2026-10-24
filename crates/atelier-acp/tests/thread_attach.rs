//! L1 — 첨부한 파일 · 폴더의 절대 경로가 Agent가 받은 말의 본문 앞에 들어가고, `sent` 줄에 남는다(v1 티켓 06 · 구현 스펙 §14
//! S30 · §4 `sent`).
//!
//! 시험은 호스트에 Thread 명령을 넣고, Thread 기록과 가짜 claude의 영수증(stdin의 user 줄)만 본다. 내용은 넘기지 않는다 —
//! 경로만 간다.

mod common;

use std::path::{Path, PathBuf};

use atelier_acp::ThreadLink;
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 시험의 Library `reviewer.md`.
const REVIEWER_MD: &str = "---\nname: 리뷰어\ntools:\n  builtin: [read, search]\n---\n\n너는 시험 Thread의 리뷰어다.\n";

/// 첨부 블록의 머리 — 엔진의 글과 따로 적는다(시험의 기댓값).
const ATTACHED_HEAD: &str = "첨부 — 사람이 이 말에 붙인 파일 · 폴더의 절대 경로다. 내용은 싣지 않았다. 필요하면 그 경로를 읽어라.";

/// 지난 말 블록의 머리(`past.rs`).
const PAST_HEAD: &str =
    "지난 말 — 이 Thread에서 네가 아직 보지 못한 말이다. 사람의 말, Agent끼리 맡긴 일, 다른 Agent의 마지막 메시지만 누가 했는지와 \
     함께 담았다.";

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

/// 사람이 끌어다 놓을 것 — 12KB 로그 하나와 그림이 든 폴더 하나.
fn dropped(sandbox: &Sandbox) -> (PathBuf, PathBuf) {
    let desk = sandbox.bin("desk");
    let log = desk.join("error.log");
    std::fs::write(&log, vec![b'x'; 12_288]).unwrap();
    let shots = desk.join("재현 화면");
    std::fs::create_dir_all(&shots).unwrap();
    std::fs::write(shots.join("refund.png"), b"\x89PNG").unwrap();
    (log, shots)
}

fn text(path: &Path) -> String {
    path.to_str().unwrap().to_owned()
}

#[test]
fn 첨부한_말은_절대_경로_목록이_본문_바로_앞에_가고_sent_줄에_첨부가_남는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let (log, shots) = dropped(&sandbox);
    let host = sandbox.host(two_turns(&sandbox));

    let thread = host
        .start_thread_with("이 로그 봐 줘", &[text(&log)], ThreadLink::NoWork)
        .expect("첨부한 첫 말로 새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread_with(&thread, "이 폴더도", &[text(&log), text(&shots)]).expect("첨부한 둘째 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);

    let session = sandbox.thread_session_id(&thread, "host");
    let got = heard(&sandbox, &session);
    let first = got[0].as_array().expect("블록 배열");
    assert_eq!(first.len(), 3, "머리말 + 첨부 + 본문: {first:#?}");
    assert_eq!(
        &first[1..],
        [
            json!({"type": "text", "text": format!("{ATTACHED_HEAD}\n- {}\n\n", log.display())}),
            json!({"type": "text", "text": "이 로그 봐 줘"}),
        ],
        "첨부는 본문 바로 앞에 경로 목록으로 간다 — 내용은 싣지 않는다(S30). claude가 본문과 이어 읽지 않게 빈 줄로 끝난다(v1 티켓 09)"
    );
    assert_eq!(
        got[1],
        json!([
            {"type": "text", "text": format!("{ATTACHED_HEAD}\n- {}\n- {}/\n\n", log.display(), shots.display())},
            {"type": "text", "text": "이 폴더도"}
        ]),
        "폴더는 끝에 `/`를 붙여 가른다"
    );

    let sent = of_kind(&record, "sent");
    assert_eq!(
        sent[0]["payload"]["attachments"],
        json!([{"path": text(&log), "size": 12_288, "folder": false}]),
        "sent 줄에 첨부가 남는다 — 화면이 말풍선 위 칩으로 그린다"
    );
    assert_eq!(
        sent[1]["payload"]["attachments"],
        json!([
            {"path": text(&log), "size": 12_288, "folder": false},
            {"path": text(&shots), "size": null, "folder": true}
        ])
    );
    assert_eq!(sent[1]["payload"]["text"], "이 폴더도", "본문은 사람이 쓴 글 그대로다");
    assert_eq!(sent[1]["payload"]["prompt"], got[1], "넘긴 그대로 sent 줄에 남는다");

    host.send_to_thread(&thread, "고마워").expect("첨부 없는 말");
    let record = sandbox.wait_thread_kind(&thread, "sent", 3);
    assert!(of_kind(&record, "sent")[2]["payload"].get("attachments").is_none(), "첨부 없는 말은 앞 장의 꼴 그대로다");

    host.shut_down();
}

#[test]
fn 첨부가_절대_경로가_아니거나_없으면_보내기_전에_거절하고_아무것도_적지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let (log, _) = dropped(&sandbox);
    let gone = text(&log.with_file_name("지운.log"));
    let host = sandbox.host(two_turns(&sandbox));

    let refused = host.start_thread_with("봐 줘", &[gone.clone()], ThreadLink::NoWork).unwrap_err();
    assert_eq!(refused.to_string(), format!("첨부한 파일을 찾지 못했어요: {gone}"));
    assert_eq!(host.list_threads().expect("목록").len(), 0, "Thread를 세우지 않는다");

    let thread = host.start_thread("안녕", ThreadLink::NoWork).expect("첨부 없는 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let before = sandbox.thread_record(&thread).len();
    let refused = host.send_to_thread_with(&thread, "이것도", &["error.log".to_owned()]).unwrap_err();
    assert_eq!(refused.to_string(), "첨부는 절대 경로여야 해요: error.log");
    assert_eq!(sandbox.thread_record(&thread).len(), before, "기록에 아무것도 적지 않는다");

    host.shut_down();
}

#[test]
fn 나중에_들어온_agent의_지난_말에도_사람이_첨부한_경로가_든다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    let (log, _) = dropped(&sandbox);
    let host = sandbox.host(two_turns(&sandbox));
    let thread =
        host.start_thread_with("이 로그 봐 줘", &[text(&log)], ThreadLink::NoWork).expect("첨부한 첫 말로 새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);

    host.send_to_thread(&thread, "@reviewer 확인해 줘").expect("리뷰어를 부른다");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);

    let reviewer = sandbox.thread_session_id(&thread, "reviewer");
    let first = &heard(&sandbox, &reviewer)[0];
    assert_eq!(
        first[1]["text"],
        format!(
            "{PAST_HEAD}\n\n[사람 → @host]\n{ATTACHED_HEAD}\n- {}\n이 로그 봐 줘\n\n[@host]\nhello from turn\n\n",
            log.display()
        ),
        "사람의 말에 붙은 경로도 지난 말에 함께 간다 — 리뷰어도 그 파일을 읽을 수 있다"
    );

    host.shut_down();
}

/// 축복 자료에서 사람의 책상 자리 — 끌어다 놓은 것이 있던 시험의 임시 폴더는 매번 다르다.
const DESK: &str = "/Users/tester/Desktop";

/// 기록 축복(S26 꼴) — 파일 하나 · 폴더 하나를 붙인 새 Thread의 첫 말과 Host의 답이 검사 자료로 선다. PR ①의 L3(v1 티켓 10)가 이 파일을
/// `thread:record`로 흘려 말풍선 위 첨부 칩을 그리고, `sent` 줄의 첨부를 경로 재기(`describe_attachments`)의 답으로 쓴다.
#[test]
fn 첨부한_첫_말의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let (log, shots) = dropped(&sandbox);
    let host = sandbox.host(two_turns(&sandbox));

    let thread = host
        .start_thread_with("이 로그 봐 줘", &[text(&log), text(&shots)], ThreadLink::NoWork)
        .expect("첨부한 첫 말로 새 Thread");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread, "host");
    let fixed = common::fix_thread_record(&common::commands_after_opened(&record), &sandbox.data_root(), &thread, &[&session]);
    let desk = text(log.parent().expect("책상 폴더"));
    let fixed: Vec<Value> = fixed
        .iter()
        .map(|line| serde_json::from_str(&line.to_string().replace(&desk, DESK)).expect("고친 줄은 JSON"))
        .collect();
    common::assert_record("thread-attach", &fixed);
}
