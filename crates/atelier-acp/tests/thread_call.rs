//! L1 — Agent가 다른 Agent를 불러 글로 주고받는다(v1 티켓 16 · 구현 스펙 §8 · S15 · S16). 가짜 claude가 Thread 도구
//! 「Agent 부르기」(`call_agent`)를 정말 부르면, 중계 서버 → Session의 소켓 → 엔진을 지나 불린 Agent가 Thread에 들어와 맡긴 일을
//! 받고, 그 턴의 마지막 메시지가 부른 Agent에게 도구의 결과로 돌아간다.
//!
//! 시험은 호스트의 Thread 명령과, Thread 폴더(`thread.json` · `events.jsonl`) · 가짜 claude의 영수증(받은 인자 · stdin 줄 · MCP
//! 서버와 주고받은 것)만 본다. 참여자마다 claude가 따로 뜨므로 영수증은 Session id로 가른다.

mod common;

use atelier_acp::ThreadLink;
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md` — 범위 안 아무 Agent나 부른다(S15).
const HOST_MD: &str = "---\nname: Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 시험의 Library `reviewer.md` — `tools.agents`를 적지 않았다: 아무도 부르지 않는다.
const REVIEWER_MD: &str = "---\nname: 리뷰어\ntools:\n  builtin: [read, search, shell]\n---\n\n너는 시험 Thread의 리뷰어다.\n";

/// 그 Agent의 claude가 턴 앞머리에서 부를 「Agent 부르기」 하나.
fn call_by(by: &str, handle: &str, task: &str) -> Value {
    json!({"by": by, "tool": "call_agent", "arguments": {"handle": handle, "task": task}})
}

/// Host는 답만 하는 턴을, 리뷰어는 `Read` · `Edit` 뒤 「edited」로 끝나는 턴을 되감는 가짜 claude의 로그인 셸 — `calls`가 턴
/// 앞머리의 부르기들이다.
fn calling(sandbox: &Sandbox, calls: &[Value], reviewer_fixture: &str) -> atelier_acp::ShellSource {
    let calls = Value::Array(calls.to_vec()).to_string();
    let fixtures = json!({"reviewer": reviewer_fixture}).to_string();
    sandbox.claude_login_shell(
        "normal",
        &[
            ("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools"),
            ("FAKE_CLAUDE_AGENT_FIXTURES", &fixtures),
            ("FAKE_CLAUDE_MCP_CALL", &calls),
            ("FAKE_CLAUDE_REBASE", common::RECORDED_PLACE),
        ],
    )
}

/// 진짜 claude가 Host로 리뷰어를 부른 녹음 한 쌍을 되감는 가짜 claude의 로그인 셸(v1 티켓 20 끝 점검) — Host는 `ToolSearch`로 들인
/// `call_agent`를 녹음의 입력 그대로 정말 부르고, 리뷰어는 `thread.json`을 읽고 답한다. 녹음의 Thread 폴더는 각자의 작업 폴더로 옮긴다.
fn recorded_call(sandbox: &Sandbox) -> atelier_acp::ShellSource {
    let fixtures = json!({"host": "2.1.309/thread-call-host", "reviewer": "2.1.309/thread-call-reviewer"}).to_string();
    sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_AGENT_FIXTURES", &fixtures), ("FAKE_CLAUDE_REBASE", RECORDED_THREAD)],
    )
}

/// 녹음 `thread-call-host`의 Thread 폴더와 첫 말.
const RECORDED_THREAD: &str = "/tmp/gate/home/threads/20261023-234318";
const RECORDED_ASK: &str = "리뷰어에게 이 Thread 폴더의 thread.json을 읽고 제목이 무엇인지 한 줄로 답해 달라고 맡겨 줘. 받은 답을 그대로 전해.";

/// 그 참여자의 턴 끝이 `n`개 적힐 때까지 기다린다.
fn wait_turns_of(sandbox: &Sandbox, thread: &str, who: &str, n: usize) -> Vec<Value> {
    sandbox.wait_thread_record(thread, |record| {
        record.iter().filter(|line| line["kind"] == "turn-end" && line["who"] == who).count() >= n
    })
}

/// 그 줄의 기록 안 자리.
fn seq(line: &Value) -> u64 {
    line["seq"].as_u64().expect("seq")
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

#[test]
fn host가_부른_agent가_들어와_맡긴_일을_받고_그_턴의_마지막_메시지가_도구의_결과로_돌아가며_call_줄_둘이_선다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    let host = sandbox.host(calling(&sandbox, &[call_by("host", "reviewer", "방금 고친 장바구니를 봐 줘")], "2.1.309/edit-subagent"));

    let thread = host.start_thread("장바구니 수량이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = wait_turns_of(&sandbox, &thread, "host", 1);
    let text = common::lines_text(&record);

    let joined = of_kind(&record, "joined");
    assert_eq!(joined.len(), 2, "불린 리뷰어가 들어온다:\n{text}");
    assert_eq!(joined[1]["payload"], json!({"handle": "reviewer", "name": "리뷰어", "from": "library"}));
    assert_eq!(of_kind(&record, "sent").len(), 1, "맡긴 일은 사람의 말(`sent`)이 아니다:\n{text}");

    let calls = of_kind(&record, "call");
    assert_eq!(calls.len(), 2, "call 줄 둘(시작 · 끝):\n{text}");
    let (started, ended) = (calls[0], calls[1]);
    assert_eq!(started["who"], "host", "부른 Agent의 줄이다(S8)");
    assert_eq!(
        (started["payload"]["state"].clone(), started["payload"]["from"].clone(), started["payload"]["to"].clone()),
        (json!("started"), json!("host"), json!("reviewer"))
    );
    assert_eq!(started["payload"]["text"], "방금 고친 장바구니를 봐 줘", "맡긴 말");
    let id = started["payload"]["id"].clone();
    assert!(id.is_string(), "시작과 끝을 잇는 id: {started}");
    assert_eq!(ended["who"], "host");
    let end = &ended["payload"];
    assert_eq!(
        (end["state"].clone(), end["id"].clone(), end["from"].clone(), end["to"].clone(), end["text"].clone()),
        (json!("ended"), id, json!("host"), json!("reviewer"), json!("방금 고친 장바구니를 봐 줘"))
    );
    assert_eq!((end["outcome"].clone(), end["answer"].clone()), (json!("answered"), json!("edited")), "받은 말: {end}");
    assert!(end["durationMs"].is_u64(), "걸린 시간: {end}");

    let reviewer_end = record.iter().find(|line| line["kind"] == "turn-end" && line["who"] == "reviewer").expect("리뷰어의 턴 끝");
    let host_end = record.iter().find(|line| line["kind"] == "turn-end" && line["who"] == "host").expect("Host의 턴 끝");
    assert!(
        seq(started) < seq(reviewer_end) && seq(reviewer_end) < seq(ended) && seq(ended) < seq(host_end),
        "맡기고 → 불린 턴이 끝나고 → 결과가 돌아간 뒤 → 부른 턴이 끝난다:\n{text}"
    );
    assert!(
        record
            .iter()
            .filter(|line| seq(line) > seq(started) && seq(line) < seq(reviewer_end) && line["kind"] == "update")
            .all(|line| line["who"] == "reviewer"),
        "그사이의 update는 불린 Agent의 줄이다 — Host는 결과를 기다린다:\n{text}"
    );

    // 불린 Agent는 제 Session에서 머리말 + 지난 말 + 「Host가 맡긴 일」을 받는다(§8 · S10).
    let reviewer = sandbox.thread_session_id(&thread, "reviewer");
    assert_ne!(reviewer, sandbox.thread_session_id(&thread, "host"), "Agent마다 제 Session이다");
    let blocks = heard(&sandbox, &reviewer);
    assert_eq!(blocks.len(), 1, "{blocks:?}");
    let texts: Vec<&str> = blocks[0].as_array().unwrap().iter().filter_map(|block| block["text"].as_str()).collect();
    assert_eq!(texts.len(), 3, "머리말 · 지난 말 · 본문: {texts:?}");
    assert!(texts[0].contains("`@reviewer`"), "머리말: {}", texts[0]);
    assert!(texts[1].contains("[사람 → @host]\n장바구니 수량이 두 번 빠져요"), "지난 말: {}", texts[1]);
    assert!(texts[2].starts_with("@host가 맡긴 일"), "본문은 부른 쪽이 맡긴 일이다: {}", texts[2]);
    assert!(texts[2].ends_with("방금 고친 장바구니를 봐 줘"), "{}", texts[2]);
    assert_eq!(started["payload"]["prompt"], blocks[0], "시작 줄은 불린 Agent에게 실제로 간 것을 담는다");

    // 부른 Agent는 도구의 결과로 불린 Agent의 마지막 메시지를 받는다.
    let mcp = sandbox.claude_mcp(&sandbox.thread_session_id(&thread, "host"));
    assert_eq!(mcp.len(), 1, "{mcp:?}");
    assert_eq!(mcp[0]["tool"], "call_agent");
    assert_ne!(mcp[0]["call"]["isError"], true, "{}", mcp[0]["call"]);
    assert_eq!(mcp[0]["call"]["content"][0]["text"], "edited");

    host.shut_down();
}

/// 받은 말 블록들의 글.
fn texts_of(blocks: &Value) -> Vec<String> {
    blocks.as_array().into_iter().flatten().filter_map(|block| block["text"].as_str()).map(str::to_owned).collect()
}

#[test]
fn 같은_thread에서_다시_부르면_불린_agent의_session이_이어지고_앱을_다시_켠_뒤에는_그_session으로_이어_연다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    // Host의 claude는 사람의 말마다 턴 앞머리에서 리뷰어를 부른다.
    let shell = || calling(&sandbox, &[call_by("host", "reviewer", "다시 봐 줘")], "2.1.309/edit-subagent");
    let host = sandbox.host(shell());
    let thread = host.start_thread("장바구니 수량이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    wait_turns_of(&sandbox, &thread, "host", 1);
    let reviewer = sandbox.thread_session_id(&thread, "reviewer");

    host.send_to_thread(&thread, "하나 더 고쳤어요").expect("둘째 말");
    let record = wait_turns_of(&sandbox, &thread, "host", 2);
    let text = common::lines_text(&record);
    assert_eq!(of_kind(&record, "joined").len(), 2, "이미 참여한 리뷰어는 다시 들어오지 않는다:\n{text}");
    assert_eq!(sandbox.thread_session_id(&thread, "reviewer"), reviewer, "같은 Session이다");
    let reviewer_launches =
        |sandbox: &Sandbox| sandbox.claude_launch_args().into_iter().filter(|args| args.iter().any(|arg| arg.ends_with("reviewer.instructions.md"))).collect::<Vec<_>>();
    assert_eq!(reviewer_launches(&sandbox).len(), 1, "떠 있는 Session에 이어 보낸다 — 새로 띄우지 않는다");
    let blocks = heard(&sandbox, &reviewer);
    assert_eq!(blocks.len(), 2, "{blocks:?}");
    let second = texts_of(&blocks[1]);
    assert_eq!(second.len(), 2, "이어 받는 말에는 머리말이 없다 — 지난 말 + 본문: {second:?}");
    assert!(second[0].contains("[사람 → @host]\n하나 더 고쳤어요"), "그사이의 말을 받는다: {}", second[0]);
    assert!(!second[0].contains("장바구니 수량이 두 번 빠져요"), "이미 본 말은 다시 받지 않는다: {}", second[0]);
    host.shut_down();

    // 앱을 다시 켠 뒤 — Host가 다시 부르면 리뷰어는 thread.json의 Session id로 이어 열린다.
    let host = sandbox.host(shell());
    host.send_to_thread(&thread, "마지막으로").expect("셋째 말");
    let record = wait_turns_of(&sandbox, &thread, "host", 3);
    let launches = reviewer_launches(&sandbox);
    assert_eq!(launches.len(), 2, "{launches:?}");
    assert!(common::has_pair(&launches[1], "--resume", &reviewer), "같은 Session으로 이어 연다: {:?}", launches[1]);
    assert_eq!(sandbox.thread_session_id(&thread, "reviewer"), reviewer);
    let third = texts_of(heard(&sandbox, &reviewer).last().expect("셋째 맡긴 일"));
    assert_eq!(third.len(), 2, "이어 연 Session은 이미 맡긴 일을 받았던 Session이다 — 머리말이 다시 붙지 않는다: {third:?}");

    let answers = answers(&sandbox, &sandbox.thread_session_id(&thread, "host"));
    let texts: Vec<&str> = answers.iter().map(|(_, _, text)| text.as_str()).collect();
    assert_eq!(texts, ["edited", "status: done", "edited"], "부를 때마다 그 턴의 마지막 메시지가 돌아온다");
    assert_eq!(of_kind(&record, "call").len(), 6, "부르기마다 시작 · 끝:\n{}", common::lines_text(&record));

    host.shut_down();
}

#[test]
fn 불린_agent가_사람에게_물으면_카드는_불린_agent의_것이고_부른_agent는_그_답까지_결과를_기다린다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    // 리뷰어의 턴은 `Write`를 묻는다(can_use_tool) — 경로는 Thread 폴더로 옮겼다(Work 밖이면 판정이 거절한다). 허락하면
    // 「done」으로 끝난다.
    let host = sandbox.host(calling(&sandbox, &[call_by("host", "reviewer", "파일 하나 써 줘")], "2.1.309/permission-stdio"));
    let thread = host.start_thread("장바구니 수량이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");

    let asked = |record: &[Value]| {
        record.iter().find(|line| line["kind"] == "permission" && line["payload"]["state"] == "asked").cloned()
    };
    let record = sandbox.wait_thread_record(&thread, |record| asked(record).is_some());
    let question = asked(&record).expect("물음");
    assert_eq!(question["who"], "reviewer", "카드는 불린 Agent의 것이다(§8 「기다림」)");
    // 사람이 답하기 전에는 부르기가 끝나지 않는다 — 잠시 두어도 그대로다.
    std::thread::sleep(std::time::Duration::from_millis(300));
    let record = sandbox.thread_record(&thread);
    let text = common::lines_text(&record);
    assert_eq!(of_kind(&record, "call").len(), 1, "맡긴 일은 시작만 섰다:\n{text}");
    assert!(!record.iter().any(|line| line["kind"] == "turn-end"), "부른 턴도 불린 턴도 끝나지 않았다:\n{text}");
    let host_session = sandbox.thread_session_id(&thread, "host");
    assert!(sandbox.claude_mcp(&host_session).is_empty(), "Host는 아직 도구의 결과를 받지 않았다");

    let request = question["payload"]["requestId"].as_str().expect("요청 id").to_owned();
    host.answer_thread_permission(&thread, "reviewer", &request, "allow_once").expect("사람이 허락한다");
    let record = wait_turns_of(&sandbox, &thread, "host", 1);
    let text = common::lines_text(&record);
    let answered = record
        .iter()
        .find(|line| line["kind"] == "permission" && line["payload"]["state"] == "answered")
        .expect("답 줄");
    let ended = of_kind(&record, "call")[1];
    let host_end = record.iter().find(|line| line["kind"] == "turn-end" && line["who"] == "host").expect("Host의 턴 끝");
    assert!(seq(answered) < seq(ended) && seq(ended) < seq(host_end), "답 → 결과 → 부른 턴의 끝:\n{text}");
    assert_eq!(ended["payload"]["answer"], "done", "{text}");
    assert_eq!(answers(&sandbox, &host_session), [("reviewer".to_owned(), false, "done".to_owned())]);

    host.shut_down();
}

/// 기록 축복(S26 꼴) — Host가 리뷰어를 불러 결과를 받은 기록이 검사 자료로 선다. PR ②의 호출 줄 화면(v1 티켓 17)과 L3(v1 티켓
/// 21)가 이 파일을 `thread:record`로 흘려 호출 줄(진행 · 끝)과 불린 Agent의 작업 로그를 그린다. 두 턴 모두 진짜 claude의 녹음이다
/// (v1 티켓 20) — Host의 작업 로그에는 Thread 도구를 들이는 `ToolSearch` 줄이 먼저 선다.
#[test]
fn host가_리뷰어를_불러_결과를_받은_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    let host = sandbox.host(recorded_call(&sandbox));

    let thread = host.start_thread(RECORDED_ASK, ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = wait_turns_of(&sandbox, &thread, "host", 1);
    host.shut_down();

    let sessions = [sandbox.thread_session_id(&thread, "host"), sandbox.thread_session_id(&thread, "reviewer")];
    let sessions: Vec<&str> = sessions.iter().map(String::as_str).collect();
    common::assert_record("thread-call", &common::fix_thread_record(&settled(&record), &sandbox.data_root(), &thread, &sessions));
}

/// 축복 자료의 차례와 값을 하나로 둔다 — 매번 갈리는 것을 앞 줄 뒤로 옮기고 seq를 다시 센 뒤, 부르기의 id를 `fake-call`로, 걸린
/// 시간을 seq로 고친다.
/// - 명령 목록 줄(`available_commands_update`)은 Session을 연 답 뒤에 따로 와 다음 줄과 엇갈린다 → 그 참여자의 열림 줄 바로 뒤.
/// - 부른 쪽의 「Agent 부르기」 도구 줄은 claude의 stdout(변환기 → ACP)이 적고, 불린 Agent의 참여는 도구 호출(중계 서버 → 소켓)이
///   적어 둘이 엇갈린다 → 그 도구 줄을 불린 Agent의 `joined` 바로 앞으로.
fn settled(record: &[Value]) -> Vec<Value> {
    let mut lines = record.to_vec();
    for who in ["host", "reviewer"] {
        let commands = |line: &Value| line["who"] == who && line["payload"]["update"]["sessionUpdate"] == "available_commands_update";
        let Some(at) = lines.iter().position(commands) else { continue };
        let line = lines.remove(at);
        let opened = lines.iter().position(|line| line["who"] == who && line["payload"]["state"] == "opened").expect("열림 줄");
        lines.insert(opened + 1, line);
    }
    let tool = |line: &Value| {
        line["who"] == "host"
            && line["payload"]["update"]["sessionUpdate"] == "tool_call"
            && line["payload"]["update"]["_meta"]["claudeCode"]["toolName"] == "mcp__atelier-thread__call_agent"
    };
    let at = lines.iter().position(tool).expect("Host의 「Agent 부르기」 도구 줄");
    let line = lines.remove(at);
    let joined = lines.iter().position(|line| line["kind"] == "joined" && line["who"] == "reviewer").expect("리뷰어의 참여 줄");
    lines.insert(joined, line);
    for (n, line) in lines.iter_mut().enumerate() {
        line["seq"] = json!(n + 1);
    }
    let started = lines.iter().position(|line| line["kind"] == "call").expect("call 시작 줄");
    let ended = lines.iter().rposition(|line| line["kind"] == "call").expect("call 끝 줄");
    lines[ended]["payload"]["durationMs"] = json!((ended - started) * 1000);
    for at in [started, ended] {
        lines[at]["payload"]["id"] = json!("fake-call");
    }
    lines
}

/// 그 Session의 claude가 stdin으로 멈춤(`interrupt`)을 받았나.
fn interrupted(sandbox: &Sandbox, session: &str) -> bool {
    sandbox
        .claude_stdin(session)
        .iter()
        .any(|line| line["type"] == "control_request" && line["request"]["subtype"] == "interrupt")
}

#[test]
fn 사람이_thread를_멈추면_부른_턴과_불린_턴이_함께_멈추고_부르기의_결과는_사람이_멈춤이다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    // 리뷰어의 턴은 오래 도는 `Bash`에서 멈춤을 기다린다.
    let host = sandbox.host(calling(&sandbox, &[call_by("host", "reviewer", "테스트를 돌려 줘")], "2.1.309/interrupt-sigint"));
    let thread = host.start_thread("장바구니 수량이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    sandbox.wait_thread_record(&thread, |record| {
        record.iter().any(|line| line["who"] == "reviewer" && line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });

    host.stop_thread(&thread).expect("사람이 멈춘다");
    let record = wait_turns_of(&sandbox, &thread, "host", 1);
    let text = common::lines_text(&record);

    let reviewer_end = record.iter().find(|line| line["kind"] == "turn-end" && line["who"] == "reviewer").expect("불린 턴의 끝");
    assert_eq!(reviewer_end["payload"]["cancelledByUs"], true, "불린 턴이 멈춘다:\n{text}");
    let (host_session, reviewer) = (sandbox.thread_session_id(&thread, "host"), sandbox.thread_session_id(&thread, "reviewer"));
    assert!(interrupted(&sandbox, &reviewer) && interrupted(&sandbox, &host_session), "고리의 모든 턴에 멈춤이 간다");
    let ended = &of_kind(&record, "call")[1]["payload"];
    assert_eq!((ended["outcome"].clone(), ended["reason"].clone()), (json!("stopped"), json!("사람이 멈춤")), "{text}");
    let by_host = answers(&sandbox, &host_session);
    assert_eq!(by_host.len(), 1, "{by_host:?}");
    assert!(by_host[0].1 && by_host[0].2.starts_with("사람이 멈춤"), "부른 Agent가 받는 결과: {by_host:?}");

    host.shut_down();
}

#[test]
fn 불린_agent가_다른_일을_하는_동안_맡긴_일은_그_대기_줄에서_기다리고_사람이_멈추면_거둬져_전해지지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    let host = sandbox.host(calling(&sandbox, &[call_by("host", "reviewer", "이것도 봐 줘")], "2.1.309/interrupt-sigint"));
    // 사람이 먼저 리뷰어에게 오래 도는 일을 맡겼다.
    let thread = host.start_thread("@reviewer 테스트를 돌려 줘", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    sandbox.wait_thread_record(&thread, |record| {
        record.iter().any(|line| line["who"] == "reviewer" && line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });

    host.send_to_thread(&thread, "리뷰어에게 하나 더 맡겨 줘").expect("Host에게");
    common::wait_until("맡긴 일이 리뷰어의 대기 줄에 든다", || {
        let queues = host.thread(&thread).expect("Thread").queues;
        match queues.get("reviewer") {
            Some(queue) if queue.len() == 1 => Ok(queue[0].text.clone()),
            _ => Err(format!("{queues:?}")),
        }
    });
    assert_eq!(host.thread(&thread).unwrap().queues["reviewer"][0].text, "이것도 봐 줘", "대기 줄에 맡긴 말이 보인다");

    host.stop_thread(&thread).expect("사람이 멈춘다");
    let record = wait_turns_of(&sandbox, &thread, "host", 1);
    let text = common::lines_text(&record);
    let calls = of_kind(&record, "call");
    assert_eq!(calls.len(), 1, "전해지지 않은 일에는 시작 줄이 없고 끝 줄 하나다:\n{text}");
    assert_eq!(
        (calls[0]["payload"]["outcome"].clone(), calls[0]["payload"]["text"].clone()),
        (json!("stopped"), json!("이것도 봐 줘"))
    );
    assert!(host.thread(&thread).unwrap().queues.is_empty(), "맡긴 일을 거뒀다");
    assert_eq!(heard(&sandbox, &sandbox.thread_session_id(&thread, "reviewer")).len(), 1, "리뷰어는 맡긴 일을 받지 않았다");

    host.shut_down();
}

/// 그 Session의 claude가 부른 도구마다 (부른 이름, 도구의 실패인가, 결과 글).
fn answers(sandbox: &Sandbox, session: &str) -> Vec<(String, bool, String)> {
    sandbox
        .claude_mcp(session)
        .iter()
        .map(|made| {
            let handle = made["arguments"]["handle"].as_str().unwrap_or_default().to_owned();
            let text = made["call"]["content"][0]["text"].as_str().unwrap_or_default().to_owned();
            (handle, made["call"]["isError"] == true, text)
        })
        .collect()
}

#[test]
fn 목록에_없는_agent_범위_밖의_agent_호출_고리_안의_agent는_부르지_못하고_거절_까닭만_돌아가며_기록에는_아무것도_서지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    // 리뷰어는 Host만 부를 수 있다 — 테스터는 범위 안이지만 리뷰어의 목록에 없다.
    sandbox.library_agent("reviewer", &REVIEWER_MD.replace("  builtin:", "  agents: [host]\n  builtin:"));
    sandbox.library_agent("tester", "---\nname: 테스터\n---\n\n너는 시험 Thread의 테스터다.\n");
    let calls = [
        call_by("host", "ghost", "없는 Agent에게 맡긴다"),
        call_by("host", "reviewer", "봐 줘"),
        call_by("reviewer", "host", "되돌아 묻는다"),
        call_by("reviewer", "tester", "돌려 줘"),
    ];
    let host = sandbox.host(calling(&sandbox, &calls, "2.1.309/edit-subagent"));

    let thread = host.start_thread("장바구니 수량이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = wait_turns_of(&sandbox, &thread, "host", 1);
    let text = common::lines_text(&record);

    let by_host = answers(&sandbox, &sandbox.thread_session_id(&thread, "host"));
    assert_eq!(by_host.len(), 2, "{by_host:?}");
    assert_eq!(
        by_host[0],
        (
            "ghost".to_owned(),
            true,
            "@ghost — 이 Thread에서 부를 수 없는 Agent예요. Work 없는 Thread에서는 Library의 Agent만 불러요".to_owned()
        ),
        "범위 밖 — Host는 아무나 부르지만 이 Thread의 범위 안에서다(S15)"
    );
    assert_eq!(by_host[1], ("reviewer".to_owned(), false, "edited".to_owned()), "거절 뒤의 부르기는 그대로 된다");

    let by_reviewer = answers(&sandbox, &sandbox.thread_session_id(&thread, "reviewer"));
    assert_eq!(by_reviewer.len(), 2, "{by_reviewer:?}");
    assert_eq!(
        by_reviewer[0],
        ("host".to_owned(), true, "@host — 지금 호출 고리 안에 있어 다시 부를 수 없어요: @host → @reviewer".to_owned()),
        "되돌아 부르기 — 리뷰어의 목록에 Host가 있어도 고리 안이다(S16)"
    );
    assert_eq!(
        by_reviewer[1],
        (
            "tester".to_owned(),
            true,
            "@tester — 네 정의의 tools.agents에 없는 Agent라 부를 수 없어요. 부를 수 있는 Agent: @host".to_owned()
        ),
        "목록에 없음 — 범위 안이어도 tools.agents에 적힌 Agent만 부른다(스토리 59)"
    );

    let joined: Vec<&Value> = of_kind(&record, "joined").into_iter().map(|line| &line["who"]).collect();
    assert_eq!(joined, [&json!("host"), &json!("reviewer")], "거절된 Agent는 들어오지 않는다:\n{text}");
    let calls = of_kind(&record, "call");
    assert_eq!(calls.len(), 2, "call 줄은 맡긴 부르기 하나의 시작 · 끝뿐이다:\n{text}");
    assert!(calls.iter().all(|line| line["payload"]["to"] == "reviewer"), "{text}");

    host.shut_down();
}

#[test]
fn 사람이_다시_맡기면_같은_글로_부르기가_다시_돌고_그_결과가_부른_agent의_다음_말로_간다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    // Host의 claude는 스스로 부르지 않는다 — 사람이 호출 줄의 「다시 맡기기」로 부른다(§8).
    let host = sandbox.host(calling(&sandbox, &[], "2.1.309/edit-subagent"));
    let thread = host.start_thread("장바구니 수량이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    wait_turns_of(&sandbox, &thread, "host", 1);

    host.call_again(&thread, "host", "reviewer", "방금 고친 장바구니를 봐 줘").expect("다시 맡긴다");
    let record = wait_turns_of(&sandbox, &thread, "host", 2);
    let text = common::lines_text(&record);

    let calls = of_kind(&record, "call");
    assert_eq!(calls.len(), 2, "부르기 하나의 시작 · 끝:\n{text}");
    let (started, ended) = (calls[0], calls[1]);
    assert_eq!(started["who"], "host", "받는 쪽은 부른 Agent다 — 부른 Agent의 줄이다");
    assert_eq!(
        (started["payload"]["from"].clone(), started["payload"]["to"].clone(), started["payload"]["text"].clone()),
        (json!("host"), json!("reviewer"), json!("방금 고친 장바구니를 봐 줘")),
        "같은 맡긴 글로 부른다"
    );
    assert_eq!((ended["payload"]["outcome"].clone(), ended["payload"]["answer"].clone()), (json!("answered"), json!("edited")));

    // 결과는 부른 Agent의 다음 말이다 — 사람이 다시 맡겼으니 사람의 말(`sent`)로 선다.
    let sent = of_kind(&record, "sent");
    assert_eq!(sent.len(), 2, "{text}");
    let relay = sent[1];
    assert_eq!(relay["payload"]["to"], "host");
    assert_eq!(relay["payload"]["text"], "같은 일을 @reviewer에게 다시 맡겼어요. 받은 답으로 이어 가 주세요.");
    assert!(seq(ended) < seq(relay), "부르기가 끝난 뒤에 간다:\n{text}");
    // 받은 답은 Host가 아직 보지 못한 리뷰어의 마지막 메시지로 지난 말에 든다.
    let host_session = sandbox.thread_session_id(&thread, "host");
    let second = texts_of(heard(&sandbox, &host_session).last().expect("Host가 받은 둘째 말"));
    assert_eq!(second.len(), 2, "지난 말 + 본문: {second:?}");
    assert!(second[0].contains("[@reviewer]\nedited"), "받은 답: {}", second[0]);
    assert_eq!(second[1], "같은 일을 @reviewer에게 다시 맡겼어요. 받은 답으로 이어 가 주세요.");

    host.shut_down();
}

#[test]
fn 다시_맡기기가_부를_수_없으면_까닭으로_거절되고_기록에는_아무것도_서지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    sandbox.library_agent("reviewer", REVIEWER_MD);
    let host = sandbox.host(calling(&sandbox, &[], "2.1.309/edit-subagent"));
    let thread = host.start_thread("장바구니 수량이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let before = wait_turns_of(&sandbox, &thread, "host", 1).len();

    let refused = host.call_again(&thread, "host", "ghost", "봐 줘").expect_err("범위 밖");
    assert_eq!(refused.to_string(), "@ghost — 이 Thread에서 부를 수 없는 Agent예요. Work 없는 Thread에서는 Library의 Agent만 불러요");
    let stranger = host.call_again(&thread, "reviewer", "host", "봐 줘").expect_err("참여자가 아닌 부른 쪽");
    assert_eq!(stranger.to_string(), format!("Thread {thread}에 @reviewer이 없습니다"));

    std::thread::sleep(std::time::Duration::from_millis(300));
    let record = sandbox.thread_record(&thread);
    assert_eq!(record.len(), before, "{}", common::lines_text(&record));
    host.shut_down();
}
