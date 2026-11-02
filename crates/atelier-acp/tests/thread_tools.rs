//! L1 — Thread 도구(v1 티켓 15 · 구현 스펙 §7 S12 · S13): 가짜 claude가 `--mcp-config`의 서버(중계 서버 시험 bin)를 실제로 띄워
//! 도구를 부르면, 중계 서버 → Session의 소켓 → 엔진을 지나 Thread가 바뀌고 그 결과가 claude에게 돌아온다.
//!
//! 시험은 호스트의 Thread 명령과, Thread 폴더(`thread.json` · `events.jsonl`) · 호스트가 낸 이벤트 · 가짜 claude의 영수증(받은
//! 인자 · MCP 서버와 주고받은 것)만 본다.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use atelier_acp::ThreadLink;
use common::{has_pair, of_kind, Sandbox};
use serde_json::{json, Value};

/// 가짜 claude가 첫 턴에 부를 Thread 도구 — `FAKE_CLAUDE_MCP_CALL`.
fn rename_call(title: &str) -> String {
    json!({"tool": "rename_thread", "arguments": {"title": title}}).to_string()
}

/// 답만 하는 턴을 되감되, 턴 앞머리에서 그 도구를 부르는 가짜 claude의 로그인 셸.
fn calling(sandbox: &Sandbox, call: &str) -> atelier_acp::ShellSource {
    sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools"), ("FAKE_CLAUDE_MCP_CALL", call)])
}

/// 진짜 claude가 Host로 Thread 이름을 바꾼 녹음(v1 티켓 20 끝 점검)을 되감는 가짜 claude의 로그인 셸 — `ToolSearch`로 들인
/// `rename_thread`를 녹음의 입력(「환불 API 버그」) 그대로 정말 부른다.
fn recorded_rename(sandbox: &Sandbox) -> atelier_acp::ShellSource {
    sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/thread-rename-host")])
}

/// claude가 받은 `--mcp-config`의 Thread 도구 서버 — `{type, command, args, env}`.
fn thread_server(args: &[String]) -> Value {
    let at = args.iter().position(|arg| arg == "--mcp-config").unwrap_or_else(|| panic!("--mcp-config가 없다: {args:?}"));
    let config: Value = serde_json::from_str(&args[at + 1]).expect("MCP 설정은 JSON 글이다");
    let servers = config["mcpServers"].as_object().expect("mcpServers");
    assert_eq!(servers.keys().collect::<Vec<_>>(), ["atelier-thread"], "엔진이 넣는 서버는 Thread 도구 하나다: {config}");
    servers["atelier-thread"].clone()
}

/// 그 서버가 엔진에 닿는 소켓 — 중계 서버 명령의 마지막 인자다.
fn socket_of(server: &Value) -> PathBuf {
    PathBuf::from(server["args"].as_array().and_then(|args| args.last()).and_then(Value::as_str).expect("소켓 경로"))
}

#[test]
fn host가_thread_도구로_이름을_바꾸면_thread_json과_title_줄과_목록이_바뀌고_도구의_답이_claude에게_돌아간다() {
    let sandbox = Sandbox::new();
    // 다른 Thread 하나 — 도구는 Thread id를 받지 않는다. 부른 Session의 Thread만 바뀐다.
    let quiet = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    let other = quiet.start_thread("다른 일", ThreadLink::NoWork).expect("다른 Thread");
    sandbox.wait_thread_kind(&other, "turn-end", 1);
    quiet.shut_down();

    let (host, events) = sandbox.host_with_events(calling(&sandbox, &rename_call("환불 API 버그")));
    let thread = host.start_thread("환불이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);

    assert_eq!(sandbox.thread_json(&thread)["title"], "환불 API 버그", "thread.json의 이름이 바뀐다");
    assert_eq!(sandbox.thread_json(&other)["title"], "다른 일", "다른 Thread는 그대로다 — 소켓이 부른 Thread를 안다");
    let titles = of_kind(&record, "title");
    assert_eq!(titles.len(), 1, "{}", common::lines_text(&record));
    assert_eq!(titles[0]["payload"], json!({"title": "환불 API 버그", "before": "환불이 두 번 빠져요"}));
    let at = |line: &Value| record.iter().position(|seen| seen == line).unwrap();
    let ended = record.iter().position(|line| line["kind"] == "turn-end").unwrap();
    assert!(at(titles[0]) < ended, "이름 바꾸기는 그 턴 안에서 일어난다:\n{}", common::lines_text(&record));
    let tool = record
        .iter()
        .find(|line| line["payload"]["update"]["_meta"]["claudeCode"]["toolName"] == "mcp__atelier-thread__rename_thread")
        .expect("도구 줄");
    assert_eq!(tool["payload"]["update"]["sessionUpdate"], "tool_call");
    let lists = events.thread_lists();
    let renamed = lists.iter().rev().find(|summary| summary.id == thread).expect("목록 요약이 나간다");
    assert_eq!(renamed.title, "환불 API 버그", "사이드바가 이름을 바꾼다(thread:list)");

    let session = sandbox.thread_session_id(&thread);
    let args = common::receipt_args(&sandbox.claude_receipt(&session));
    let server = thread_server(&args);
    assert_eq!(server["type"], "stdio");
    assert!(!args.iter().any(|arg| arg == "--strict-mcp-config"), "사용자 MCP는 그대로 붙는다: {args:?}");
    assert!(has_pair(&args, "--allowedTools", "mcp__atelier-thread"), "Thread 도구는 claude가 묻지 않는다: {args:?}");
    let socket = socket_of(&server);
    let place = socket.parent().expect("소켓 폴더");
    let mode = std::fs::metadata(place).expect("Session이 떠 있는 동안 소켓 폴더가 있다").permissions().mode();
    assert_eq!(mode & 0o777, 0o700, "소켓은 사용자만 여는 폴더에 있다(S12)");

    let mcp = sandbox.claude_mcp(&session);
    assert_eq!(mcp.len(), 1, "{mcp:?}");
    assert_eq!(mcp[0]["server"], "atelier-thread");
    let listed: Vec<&str> = mcp[0]["tools"].as_array().unwrap().iter().filter_map(|tool| tool["name"].as_str()).collect();
    assert!(listed.contains(&"rename_thread"), "도구 목록에 이름 바꾸기가 있다: {listed:?}");
    assert!(listed.contains(&"list_services") && listed.contains(&"set_service"), "도구 목록에 Service 목록 · 붙이기가 있다(03 §11): {listed:?}");
    for setting in ["add_project", "edit_project", "create_service", "edit_service"] {
        assert!(listed.contains(&setting), "도구 목록에 대화로 하는 설정 넷이 있다(03 §12): {listed:?}");
    }
    assert!(!listed.iter().any(|name| name.starts_with("remove_") || name.starts_with("delete_")), "지우는 도구는 없다(03 §17): {listed:?}");
    let answer = &mcp[0]["call"];
    assert_ne!(answer["isError"], true, "{answer}");
    assert_eq!(answer["content"][0]["text"], "Thread 이름을 바꿨다 — 환불 API 버그", "도구의 답이 claude에게 돌아간다");

    host.shut_down();
    assert!(!place.exists(), "Session이 끝나면 소켓을 치운다: {}", place.display());
}

/// 시스템 프롬프트가 없으니 앱 기능 도구는 일반 MCP 도구다 — 첫 말은 자리만 말하고, 언제 무엇을 부르는지는 Runtime이 `tools/list`로
/// 받는 설명이 말한다.
#[test]
fn 머리말은_자리만_말하고_앱_기능_도구의_쓰임은_도구_설명이_말한다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(calling(&sandbox, &rename_call("환불 API 버그")));

    let thread = host.start_thread("환불이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let preamble = of_kind(&record, "sent")[0]["payload"]["prompt"][0]["text"].as_str().expect("머리말").to_owned();
    assert!(preamble.contains("\n- Work: 없음 — 이 Thread 폴더에서 일한다: `"), "Work 줄의 꼴은 그대로다(L3 `workTitleOf`):\n{preamble}");
    assert!(preamble.lines().any(|line| line.starts_with("- Service:")), "{preamble}");
    assert!(!preamble.contains("Spec layout"), "Work 없는 채팅에는 spec 배치가 없다:\n{preamble}");
    for name in [
        "atelier-thread",
        "rename_thread",
        "list_projects",
        "get_work",
        "propose_work",
        "start_editing",
        "list_services",
        "set_service",
        "add_project",
        "edit_project",
        "create_service",
        "edit_service",
    ] {
        assert!(!preamble.contains(name), "머리말이 도구 쓰는 법을 나열하지 않는다 — {name}:\n{preamble}");
    }

    let session = sandbox.thread_session_id(&thread);
    for (name, says) in [
        ("rename_thread", "이름을 바꾼다"),
        ("list_projects", "Work 만들기를 제안하기 전에 부른다"),
        ("get_work", "이 Thread가 이어진 Work"),
        ("propose_work", "일이 커지면 부른다"),
        ("propose_work", "atelier_start_work가 아니라 이 도구로 만든다"),
        ("start_editing", "처음 고치기 전에 부른다"),
        ("list_services", "set_service 전에 부른다"),
        ("add_project", "Project로 등록한다"),
        ("edit_project", "기준 브랜치는 그 저장소에 이미 있는 브랜치만 받는다"),
    ] {
        let guide = sandbox.claude_tool_guide(&session, name);
        assert!(guide.contains(says), "{name}의 설명이 쓰임을 말한다 — {says}:\n{guide}");
    }
}

#[test]
fn 빈_이름으로_부르면_도구가_거절_까닭을_돌려주고_아무것도_바꾸지_않는다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(calling(&sandbox, &rename_call("  \n ")));

    let thread = host.start_thread("환불이 두 번 빠져요", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let answer = &sandbox.claude_mcp(&sandbox.thread_session_id(&thread))[0]["call"];
    assert_eq!(answer["isError"], true, "{answer}");
    assert_eq!(answer["content"][0]["text"], "채팅 이름이 비었어요", "거절 까닭을 글로 돌려준다");
    assert_eq!(sandbox.thread_json(&thread)["title"], "환불이 두 번 빠져요");
    assert!(of_kind(&record, "title").is_empty(), "{}", common::lines_text(&record));
}

#[test]
fn 다시_켠_뒤_이어_연_session에도_새_소켓의_thread_도구가_실린다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    let thread = host.start_thread("어제의 말", ThreadLink::NoWork).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    let yesterday = socket_of(&thread_server(&sandbox.claude_launch_args()[0]));
    assert!(!yesterday.exists(), "앱을 끄면 소켓을 치운다");

    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    host.send_to_thread(&thread, "오늘의 말").expect("되살려 보낸다");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    let revived = &sandbox.claude_launch_args()[1];
    assert!(has_pair(revived, "--resume", &sandbox.thread_session_id(&thread)), "{revived:?}");
    let today = socket_of(&thread_server(revived));
    assert_ne!(today, yesterday, "이어 열 때도 Session의 소켓을 새로 연다");
    assert!(today.exists(), "떠 있는 Session의 소켓이 있다");

    host.shut_down();
    assert!(!today.exists());
}

#[test]
fn agent_저장과_agent_부르기_도구는_도구_목록에도_머리말에도_서지_않는다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(calling(&sandbox, &rename_call("리뷰어 만들기")));

    let thread = host.start_thread("보안 위주로 보는 리뷰어 만들어줘", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let mcp = sandbox.claude_mcp(&sandbox.thread_session_id(&thread));
    let listed: Vec<&str> = mcp[0]["tools"].as_array().unwrap().iter().filter_map(|tool| tool["name"].as_str()).collect();
    assert!(listed.contains(&"rename_thread"), "앱 기능 도구 목록: {listed:?}");
    let preamble = of_kind(&record, "sent")[0]["payload"]["prompt"][0]["text"].as_str().expect("머리말").to_owned();
    for gone in ["save_agent", "call_agent"] {
        assert!(!listed.contains(&gone), "앱 기능 도구 목록: {listed:?}");
        assert!(!preamble.contains(gone), "머리말:\n{preamble}");
    }
}

/// 기록 축복(S26 꼴) — Host가 첫 턴에서 Thread 도구로 이름을 바꾼 기록이 검사 자료로 선다. PR ②의 L3(v1 티켓 21)가 이 파일을
/// `thread:record`로 흘려 MCP 도구 줄과 시스템 줄 「Thread 이름을 … 로 바꿈」을 그린다. 턴은 진짜 claude의 녹음이다(v1 티켓 20) —
/// 작업 로그에는 Thread 도구를 들이는 `ToolSearch` 줄이 먼저 선다.
#[test]
fn thread_도구로_이름을_바꾼_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(recorded_rename(&sandbox));

    let thread = host
        .start_thread("이 Thread 이름을 「환불 API 버그」로 바꿔 줘. 이름만 바꾸고 한 줄로 답해.", ThreadLink::NoWork)
        .expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread);
    common::assert_record("thread-rename", &common::fix_thread_record(&settled(&record), &sandbox.data_root(), &thread, &[&session]));
}

/// 코드 리뷰 1차 A3 — CI(Linux)에서 Host claude의 stdout 줄(변환기 → 엔진)이 Thread 도구 부르기(중계 서버 → 소켓)보다 늦게 닿아, 그
/// 결과의 줄이 도구 줄 앞에 섰다. 가짜 claude가 stdout만 늦게 쓰면 그 엇갈림이 늘 난다 — 엔진은 그 도구 줄이 적힌 뒤에 부르기를
/// 받으므로 기록은 같다.
#[test]
fn host의_stdout이_thread_도구_부르기보다_늦게_닿아도_기록의_차례가_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/thread-rename-host"), ("FAKE_CLAUDE_STDOUT_LAG", "500")],
    ));

    let thread = host
        .start_thread("이 Thread 이름을 「환불 API 버그」로 바꿔 줘. 이름만 바꾸고 한 줄로 답해.", ThreadLink::NoWork)
        .expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread);
    common::assert_record("thread-rename", &common::fix_thread_record(&settled(&record), &sandbox.data_root(), &thread, &[&session]));
}

/// 축복 자료의 차례를 하나로 둔다 — 매번 갈리는 차례를 앞 줄 뒤로 옮기고 seq를 다시 센다.
/// - 명령 목록 줄(`available_commands_update`)은 Session을 연 답 뒤에 따로 와 첫 말의 `sent`와 엇갈린다 → 열림 줄 바로 뒤.
///
/// `title` 줄은 도구 호출(중계 서버 → 소켓)이 적고 도구 줄은 claude의 stdout(변환기 → ACP)이 적지만 옮기지 않는다 — 엔진이 그 도구
/// 줄이 적힌 뒤에 부르기를 받는다(코드 리뷰 1차 A3).
fn settled(record: &[Value]) -> Vec<Value> {
    let mut lines = record.to_vec();
    let mut after = |moved: &dyn Fn(&Value) -> bool, anchor: &dyn Fn(&Value) -> bool| {
        let at = lines.iter().position(|line| moved(line)).expect("옮길 줄");
        let line = lines.remove(at);
        let anchor = lines.iter().position(|line| anchor(line)).expect("앞 줄");
        lines.insert(anchor + 1, line);
    };
    after(&|line| line["payload"]["update"]["sessionUpdate"] == "available_commands_update", &|line| {
        line["payload"]["state"] == "opened"
    });
    for (n, line) in lines.iter_mut().enumerate() {
        line["seq"] = json!(n + 1);
    }
    lines
}
