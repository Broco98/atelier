//! L1 — @멘션한 Agent가 Thread에 들어와 지난 말을 알고 답한다(v1 티켓 13 · 구현 스펙 §5 S9 · S10 · §6 범위 · S4).
//!
//! 시험은 호스트에 Thread 명령을 넣고, Thread 폴더(`thread.json` · `events.jsonl` · 스냅숏), 호스트가 낸 이벤트, 가짜 claude의
//! 영수증(받은 인자 · stdin 줄)만 본다. 참여자마다 claude 하나가 뜨므로 영수증은 Session id로 가른다.

mod common;

use std::path::{Path, PathBuf};

use atelier_acp::{HostError, ThreadLink};
use common::{has_pair, of_kind, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 시험의 Library `reviewer.md` — 읽기 · 찾기 · 명령만 쓰고 선호 모델을 적었다.
const REVIEWER_MD: &str =
    "---\nname: 리뷰어\nmodel:\n  prefer: haiku\ntools:\n  builtin: [read, search, shell]\n---\n\n너는 시험 Thread의 리뷰어다.\n";

/// 두 턴(답만 하는 턴 · 도구를 쓰는 턴)을 되감는 가짜 claude의 로그인 셸 — 참여자마다 제 claude가 같은 원문을 처음부터 되감는다.
fn two_turns(sandbox: &Sandbox) -> atelier_acp::ShellSource {
    sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.282/twoturn-tools")])
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

/// Host가 한 턴 답한 Thread — Library에 Host와 리뷰어가 있다.
fn answered_by_host(sandbox: &Sandbox) -> (atelier_acp::ConversationHost, String) {
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    let host = sandbox.host(two_turns(sandbox));
    let thread = host.start_thread("세 낱말로 답해 줘: hello from turn", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    (host, thread)
}

#[test]
fn 첫_멘션의_agent가_받고_처음_부르면_joined_줄과_스냅숏과_그_agent의_새_session이_선다() {
    let sandbox = Sandbox::new();
    let (host, thread) = answered_by_host(&sandbox);
    let host_session = sandbox.thread_session_id(&thread, "host");

    host.send_to_thread(&thread, "@reviewer 방금 답을 봐 줘. @host는 기다려").expect("멘션한 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);

    let joined = of_kind(&record, "joined");
    assert_eq!(joined.len(), 2, "리뷰어가 들어온다:\n{}", common::lines_text(&record));
    assert_eq!(
        (joined[1]["who"].clone(), joined[1]["payload"].clone()),
        (json!("reviewer"), json!({"handle": "reviewer", "name": "리뷰어", "from": "library"})),
        "참여 줄은 들어온 Agent의 것이다"
    );
    let sent = of_kind(&record, "sent");
    assert_eq!(sent[1]["payload"]["to"], "reviewer", "첫 멘션의 Agent가 받는다(S9) — 뒤의 멘션은 글자로만 남는다");
    assert_eq!(sent[1]["payload"]["text"], "@reviewer 방금 답을 봐 줘. @host는 기다려");
    let joined_at = joined[1]["seq"].as_u64().unwrap();
    assert!(
        record
            .iter()
            .filter(|line| line["seq"].as_u64().unwrap() > joined_at && line["kind"] != "sent")
            .all(|line| line["who"] == "reviewer"),
        "들어온 뒤의 Session 줄은 모두 리뷰어의 것이다:\n{}",
        common::lines_text(&record)
    );

    let reviewer = sandbox.participant(&thread, "reviewer");
    assert_eq!(
        (reviewer["from"].clone(), reviewer["runtime"].clone(), reviewer["model"].clone()),
        (json!("library"), json!("claude-code"), json!("haiku")),
        "참여자 줄은 리뷰어의 정의에서 선다"
    );
    let dir = sandbox.thread_dir(&thread);
    assert_eq!(std::fs::read_to_string(dir.join("agents/reviewer.md")).unwrap(), REVIEWER_MD, "정의를 스냅숏한다(S4)");

    let session = sandbox.thread_session_id(&thread, "reviewer");
    assert_ne!(session, host_session, "Agent마다 제 Session이다");
    let args = common::receipt_args(&sandbox.claude_receipt(&session));
    let instructions = dir.join("agents/reviewer.instructions.md");
    assert!(
        has_pair(&args, "--session-id", &session)
            && has_pair(&args, "--append-system-prompt-file", instructions.to_str().unwrap())
            && has_pair(&args, "--model", "haiku")
            && has_pair(&args, "--tools", "Read,Glob,Grep,LS,Bash,AskUserQuestion,ExitPlanMode,ToolSearch"),
        "리뷰어의 모델 · 도구로 새 Session이 열린다: {args:?}"
    );
    assert_eq!(std::fs::read_to_string(&instructions).unwrap(), "너는 시험 Thread의 리뷰어다.");
    assert_eq!(heard(&sandbox, &host_session).len(), 1, "Host는 그 말을 받지 않았다");

    host.shut_down();
}

#[test]
fn 다시_부르면_같은_session으로_이어_열리고_정의는_library_파일이_바뀌거나_지워져도_처음_스냅숏_그대로이고_다른_thread에서는_새_session이다() {
    let sandbox = Sandbox::new();
    let (host, thread) = answered_by_host(&sandbox);
    host.send_to_thread(&thread, "@reviewer 봐 줘").expect("리뷰어를 부른다");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    let first = sandbox.thread_session_id(&thread, "reviewer");
    host.shut_down();

    // 앱을 끈 사이 사람이 Library의 리뷰어를 고쳤다 — 모델도 지시문도 바뀌었다.
    let library = sandbox.library_agent("reviewer", &REVIEWER_MD.replace("haiku", "opus").replace("리뷰어다", "고친 리뷰어다"));
    let host = sandbox.host(two_turns(&sandbox));
    host.send_to_thread(&thread, "@reviewer 하나 더").expect("다시 부른다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 3);

    assert_eq!(of_kind(&record, "joined").len(), 2, "이미 참여한 Agent는 다시 들어오지 않는다");
    assert_eq!(sandbox.thread_session_id(&thread, "reviewer"), first, "같은 Session이다");
    let revived = sandbox.claude_launch_args().into_iter().last().expect("다시 띄움");
    assert!(
        has_pair(&revived, "--resume", &first) && has_pair(&revived, "--model", "haiku"),
        "thread.json의 Session id와 처음 들어온 정의의 모델로 이어 연다: {revived:?}"
    );
    let dir = sandbox.thread_dir(&thread);
    assert_eq!(std::fs::read_to_string(dir.join("agents/reviewer.md")).unwrap(), REVIEWER_MD, "스냅숏은 그대로다(S4)");
    assert_eq!(std::fs::read_to_string(dir.join("agents/reviewer.instructions.md")).unwrap(), "너는 시험 Thread의 리뷰어다.");

    // 다른 Thread에서 부르면 새 Session이고, 지금 Library의 정의로 들어온다(스토리 43).
    let other = host.start_thread("@reviewer 처음 보는 일", ThreadLink::NoWork).expect("새 Thread의 첫 말도 멘션한 Agent가 받는다");
    sandbox.wait_thread_kind(&other, "turn-end", 1);
    let participants = sandbox.thread_json(&other)["participants"].clone();
    assert_eq!(participants.as_array().map(Vec::len), Some(1), "Host는 들어오지 않았다: {participants}");
    assert_eq!(participants[0]["handle"], "reviewer");
    let fresh = sandbox.thread_session_id(&other, "reviewer");
    assert_ne!(fresh, first, "Thread끼리 맥락이 섞이지 않는다");
    assert!(has_pair(&common::receipt_args(&sandbox.claude_receipt(&fresh)), "--model", "opus"));

    // Library 파일이 지워져도 이미 들어온 리뷰어는 부른다 — 범위를 다시 보지 않는다(스토리 52).
    std::fs::remove_file(&library).unwrap();
    host.send_to_thread(&thread, "@reviewer 마지막으로").expect("지워진 정의의 참여자도 부른다");
    assert_eq!(common::sent_texts(&sandbox.thread_record(&thread)).last().map(String::as_str), Some("@reviewer 마지막으로"));

    host.shut_down();
}

/// Work의 Project 안(worktree의 `.atelier/agents/`)에 Agent 정의 파일 하나를 둔다.
fn project_agent(work: &Path, project: &str, handle: &str, text: &str) -> PathBuf {
    let dir = work.join("trees").join(project).join(".atelier/agents");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("{handle}.md"));
    std::fs::write(&path, text).unwrap();
    path
}

const HELPER_MD: &str = "---\nname: 도우미\n---\n\n너는 fe의 도우미다.\n";
const TESTER_MD: &str = "---\nname: 테스터\n---\n\n너는 테스터다.\n";
const BROKEN_MD: &str = "---\nname: 깨짐\ntools:\n  builtin: [teleport]\n---\n\n읽히지 않는다.\n";

#[test]
fn 범위_밖_이름_깨진_파일_project_여럿에_겹친_맨_이름은_보내기_전에_거절하고_아무것도_적지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let work = sandbox.work("cart", &["fe", "be"]);
    project_agent(&work, "fe", "helper", HELPER_MD);
    project_agent(&work, "fe", "tester", TESTER_MD);
    project_agent(&work, "be", "tester", TESTER_MD);
    project_agent(&work, "be", "broken", BROKEN_MD);
    let host = sandbox.host(two_turns(&sandbox));

    // Work 없는 Thread는 Library만 부른다(스토리 48).
    let alone = host.start_thread("시작하자", ThreadLink::NoWork).expect("Host가 받는다");
    sandbox.wait_thread_kind(&alone, "turn-end", 1);
    let before = sandbox.thread_record(&alone);
    assert_eq!(
        host.send_to_thread(&alone, "@helper 도와 줘"),
        Err(HostError::AgentNotFound { call: "helper".into(), work: None })
    );
    assert_eq!(sandbox.thread_record(&alone), before, "거절한 말은 기록에 아무것도 남기지 않는다");
    assert_eq!(
        host.start_thread("@helper 새로 시작", ThreadLink::NoWork),
        Err(HostError::AgentNotFound { call: "helper".into(), work: None }),
        "새 Thread의 첫 말도 같다"
    );
    assert_eq!(host.list_threads().unwrap().len(), 1, "거절한 첫 말은 Thread를 세우지 않는다");

    // Work의 Thread는 그 Work의 Project 안 Agent도 부른다(스토리 49).
    let in_work =
        host.start_thread("@helper 도와 줘", ThreadLink::Work { slug: "cart".into() }).expect("fe의 도우미가 받는다");
    let record = sandbox.wait_thread_kind(&in_work, "turn-end", 1);
    assert_eq!(record[0]["payload"], json!({"handle": "helper", "name": "도우미", "from": {"project": "fe"}}));
    assert_eq!(sandbox.participant(&in_work, "helper")["from"], json!({"project": "fe"}), "정의가 온 Project를 적는다");

    let before = sandbox.thread_record(&in_work);
    assert_eq!(
        host.send_to_thread(&in_work, "@tester 돌려 줘"),
        Err(HostError::AgentAmbiguous { call: "tester".into(), calls: vec!["be/tester".into(), "fe/tester".into()] }),
        "Project 둘에 있는 handle은 맨 이름으로 부르지 않는다(스토리 51)"
    );
    assert_eq!(
        host.send_to_thread(&in_work, "@broken 해 줘"),
        Err(HostError::AgentBroken { handle: "broken".into(), reason: "모르는 도구입니다: teleport".into() })
    );
    assert_eq!(
        host.send_to_thread(&in_work, "@nobody 해 줘"),
        Err(HostError::AgentNotFound { call: "nobody".into(), work: Some("cart".into()) })
    );
    assert_eq!(sandbox.thread_record(&in_work), before, "거절한 말은 기록에 아무것도 남기지 않는다");

    host.send_to_thread(&in_work, "@fe/tester 돌려 줘").expect("Project를 붙여 부른다");
    let tester = sandbox.participant(&in_work, "tester");
    assert_eq!(tester["from"], json!({"project": "fe"}));

    host.shut_down();
}

#[test]
fn work의_project에_library와_같은_handle이_있으면_project_정의가_들어온다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    let work = sandbox.work("cart", &["fe"]);
    let mine = "---\nname: fe 리뷰어\nmodel:\n  prefer: sonnet\n---\n\n너는 fe에 맞춘 리뷰어다.\n";
    project_agent(&work, "fe", "reviewer", mine);
    let host = sandbox.host(two_turns(&sandbox));

    let thread = host.start_thread("@reviewer가 봐 줘", ThreadLink::Work { slug: "cart".into() }).expect("멘션에 붙은 조사는 뗀다");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);

    assert_eq!(std::fs::read_to_string(sandbox.thread_dir(&thread).join("agents/reviewer.md")).unwrap(), mine);
    let reviewer = sandbox.participant(&thread, "reviewer");
    assert_eq!((reviewer["from"].clone(), reviewer["model"].clone()), (json!({"project": "fe"}), json!("sonnet")));

    host.shut_down();
}

#[test]
fn 참여자마다_대기_줄이_따로이고_thread의_지금은_handle별로_가른_대기_줄을_싣고_멈추기는_둘_다_멈춘다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    // 원문은 40초 자는 명령을 돌리다 interrupt로 멈춘 턴이다 — 참여자마다 제 claude가 같은 턴을 돈다.
    let shell = sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.282/interrupt-sigint")]);
    let (host, events) = sandbox.host_with_events(shell);
    let running = |who: &'static str| {
        move |record: &[Value]| {
            of_kind(record, "update")
                .iter()
                .any(|line| line["who"] == who && line["payload"]["update"]["sessionUpdate"] == "tool_call")
        }
    };
    let thread = host.start_thread("40초 자는 명령을 앞에서 돌려", ThreadLink::NoWork).expect("Host의 턴");
    sandbox.wait_thread_record(&thread, running("host"));
    host.send_to_thread(&thread, "@reviewer 너도 40초 자는 명령을 돌려").expect("리뷰어의 턴");
    sandbox.wait_thread_record(&thread, running("reviewer"));

    host.send_to_thread(&thread, "Host가 기다리는 말").expect("Host의 대기 줄");
    host.send_to_thread(&thread, "@reviewer 리뷰어가 기다리는 말").expect("리뷰어의 대기 줄");
    let queues = host.thread(&thread).expect("Thread의 지금").queues;
    let texts = |who: &str| queues[who].iter().map(|queued| queued.text.clone()).collect::<Vec<_>>();
    assert_eq!(queues.len(), 2, "{queues:?}");
    assert_eq!(texts("host"), ["Host가 기다리는 말"]);
    assert_eq!(texts("reviewer"), ["@reviewer 리뷰어가 기다리는 말"], "대기 줄은 받는 참여자의 것이다");
    assert_eq!(
        serde_json::to_value(host.thread(&thread).unwrap()).unwrap()["queues"]["reviewer"][0]["text"],
        "@reviewer 리뷰어가 기다리는 말",
        "화면에는 handle → 대기 줄로 간다 — `thread:queue` 이벤트의 `who`와 같은 열쇠다"
    );
    assert_eq!(events.thread_queues(&thread).last().map(|(who, _)| who.as_str()), Some("reviewer"));

    host.stop_thread(&thread).expect("멈추기는 Thread 전체에 건다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 4);
    let mut who: Vec<&str> = of_kind(&record, "turn-end")
        .into_iter()
        .filter(|end| end["payload"]["stopReason"] == "cancelled")
        .map(|end| end["who"].as_str().unwrap())
        .collect();
    who.sort();
    assert_eq!(who, ["host", "reviewer"], "두 참여자의 턴이 함께 멈춘다");
    assert_eq!(
        common::sent_texts(&record)[2..].iter().filter(|text| text.contains("기다리는 말")).count(),
        2,
        "멈춘 뒤 각자의 대기 줄의 말이 간다"
    );
    assert!(host.thread(&thread).unwrap().queues.is_empty(), "대기 줄이 빈 참여자는 칸이 없다");

    host.shut_down();
}

/// 기록 축복(S26 꼴) — Host가 답한 Thread에 @멘션으로 리뷰어가 들어와 지난 말을 받고 답한 기록이 검사 자료로 선다. PR ②의
/// L3(v1 티켓 21)가 이 파일을 `thread:record`로 흘려 여럿이 한 Thread를 그린다.
#[test]
fn 멘션으로_리뷰어가_들어와_답한_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    let (host, thread) = answered_by_host(&sandbox);
    host.send_to_thread(&thread, "@reviewer 방금 답을 봐 줘").expect("리뷰어를 부른다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    let sessions = [sandbox.thread_session_id(&thread, "host"), sandbox.thread_session_id(&thread, "reviewer")];
    let settled = commands_after_opened(&record);
    common::assert_record(
        "thread-mention",
        &common::fix_thread_record(&settled, &sandbox.data_root(), &thread, &[&sessions[0], &sessions[1]]),
    );
}

/// 명령 목록 줄(`available_commands_update`)마다 그 참여자의 열림 줄 바로 뒤로 옮기고 seq를 다시 센다. 명령 목록은 Session을 연
/// 답 뒤에 따로 오므로 `sent`와의 차례가 매번 다르다(`thread_host.rs`의 같은 손질). 축복 자료는 하나의 차례로 둔다.
fn commands_after_opened(record: &[Value]) -> Vec<Value> {
    let is_commands = |line: &Value| line["payload"]["update"]["sessionUpdate"] == "available_commands_update";
    let commands: Vec<Value> = record.iter().filter(|line| is_commands(line)).cloned().collect();
    let mut lines: Vec<Value> = record.iter().filter(|line| !is_commands(line)).cloned().collect();
    for command in commands {
        let opened = lines
            .iter()
            .position(|line| line["payload"]["state"] == "opened" && line["who"] == command["who"])
            .expect("그 참여자의 열림 줄");
        lines.insert(opened + 1, command);
    }
    for (n, line) in lines.iter_mut().enumerate() {
        line["seq"] = json!(n + 1);
    }
    lines
}

/// 지난 말 블록의 머리 — 이 Session이 아직 보지 못한 말이라는 것과 무엇을 담았는지.
const PAST_HEAD: &str =
    "지난 말 — 이 Thread에서 네가 아직 보지 못한 말이다. 사람의 말과 다른 Agent의 마지막 메시지만, 누가 했는지와 함께 담았다.";

#[test]
fn 새로_들어온_agent는_머리말_뒤에_지난_말을_받고_그_뒤로는_못_본_말만_받는다() {
    let sandbox = Sandbox::new();
    let (host, thread) = answered_by_host(&sandbox);
    host.send_to_thread(&thread, "notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘").expect("Host에게 이어 말하기");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);

    host.send_to_thread(&thread, "@reviewer 지금까지 한 일을 봐 줘").expect("리뷰어를 부른다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 3);
    let reviewer = sandbox.thread_session_id(&thread, "reviewer");
    let first = &heard(&sandbox, &reviewer)[0];
    assert_eq!(first.as_array().map(Vec::len), Some(3), "머리말 + 지난 말 + 본문(S10): {first:#}");
    assert!(first[0]["text"].as_str().unwrap().contains("너의 handle: `@reviewer`"), "머리말은 리뷰어의 것이다");
    assert_eq!(
        first[1]["text"],
        format!(
            "{PAST_HEAD}\n\n[사람 → @host]\n세 낱말로 답해 줘: hello from turn\n\n[@host]\nHello from turn\n\n\
             [사람 → @host]\nnotes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘\n\n[@host]\n4"
        ),
        "사람의 말과 Host의 턴마다 마지막 메시지를 차례로 — 도구 기록 · 생각은 넘기지 않는다"
    );
    assert_eq!(first[2], json!({"type": "text", "text": "@reviewer 지금까지 한 일을 봐 줘"}));
    assert_eq!(&of_kind(&record, "sent")[2]["payload"]["prompt"], first, "넘긴 그대로 sent 줄에 남는다");

    // 리뷰어는 이제 자기 턴까지 다 봤다 — 다시 부르면 그 뒤에 아무 말도 없으니 본문만 간다.
    host.send_to_thread(&thread, "@reviewer 하나만 더").expect("리뷰어를 다시 부른다");
    sandbox.wait_thread_kind(&thread, "turn-end", 4);
    assert_eq!(heard(&sandbox, &reviewer)[1], json!([{"type": "text", "text": "@reviewer 하나만 더"}]));

    // Host는 마지막으로 받은 말 뒤의 것을 받는다 — 리뷰어에게 간 사람의 말과 리뷰어의 마지막 메시지. 원문에 Host의 셋째 턴은
    // 없으므로 claude가 받은 말만 본다.
    host.send_to_thread(&thread, "리뷰를 반영해 줘").expect("Host에게");
    let host_session = sandbox.thread_session_id(&thread, "host");
    let host_heard = common::wait_until("Host의 claude가 셋째 말을 받는다", || {
        let got = heard(&sandbox, &host_session);
        if got.len() >= 3 { Ok(got) } else { Err(format!("{got:#?}")) }
    });
    assert_eq!(
        host_heard[2],
        json!([
            {"type": "text", "text": format!(
                "{PAST_HEAD}\n\n[사람 → @reviewer]\n@reviewer 지금까지 한 일을 봐 줘\n\n[@reviewer]\nHello from turn\n\n\
                 [사람 → @reviewer]\n@reviewer 하나만 더\n\n[@reviewer]\n4"
            )},
            {"type": "text", "text": "리뷰를 반영해 줘"}
        ]),
        "이어 쓰는 Session에는 머리말 없이 지난 말 + 본문이다"
    );

    host.shut_down();
}
