//! L1 — Thread 엔진(대화 호스트의 Thread 열쇠) ↔ Claude 변환기(시험 bin) ↔ 가짜 claude(v1 티켓 04 · 구현 스펙 §5 S9 · S10 ·
//! S11 · §18).
//!
//! 시험은 호스트에 Thread 명령을 넣고, Thread 폴더(`thread.json` · `events.jsonl`), 호스트가 낸 이벤트, 가짜 claude의
//! 영수증(받은 인자 · cwd · stdin 줄)만 본다. 앱 재시작은 호스트를 끄고 같은 데이터 루트로 새 호스트를 짓는 것으로 흉내 낸다.

mod common;

use std::path::Path;

use atelier_acp::{StartPicks, ThreadLink};
use common::{has_pair, of_kind, Sandbox};
use serde_json::{json, Value};

/// spec 배치 글의 머리 줄 — `atelier_start_work`가 건네는 글과 같다.
const SPEC_LAYOUT_HEAD: &str = "Spec layout — how to arrange documents inside `specDir`.";

/// 두 턴(답만 하는 턴 · 도구를 쓰는 턴)을 되감는 가짜 claude의 로그인 셸.
fn two_turns(sandbox: &Sandbox) -> atelier_acp::ShellSource {
    sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")])
}

/// 두 경로가 같은 폴더인가 — macOS의 임시 폴더는 `/var`와 `/private/var` 두 이름이 있다.
fn same_dir(a: &Path, b: &Path) -> bool {
    a.canonicalize().unwrap() == b.canonicalize().unwrap()
}

#[test]
fn library_폴더가_없어도_새_thread가_열리고_답하며_앱이_그_폴더를_만들지_않는다() {
    let sandbox = Sandbox::new();
    assert!(!sandbox.data_root().join("library").exists(), "시작 절차가 옮긴 뒤의 자리다");
    let host = sandbox.host(two_turns(&sandbox));

    let thread = host.start_thread("세 낱말로 답해 줘: hello from turn", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert_eq!(of_kind(&record, "turn-end").len(), 1, "{}", common::lines_text(&record));
    assert!(!sandbox.data_root().join("library").exists(), "앱이 Library를 세우지 않는다");
}

/// 옛 판이 남긴 `library` 폴더 — 다른 설치본에서 온 자료다. 앱은 읽지도 지우지도 않는다.
#[test]
fn 옛_library의_정의는_읽지_않아_고르지_않으면_모델_생각_깊이_도구_금지를_넘기지_않고_깨져_있어도_채팅이_열린다() {
    let sandbox = Sandbox::new();
    let library = sandbox.data_root().join("library/agents");
    std::fs::create_dir_all(&library).unwrap();
    let definition = library.join("host.md");
    let narrow = "---\nmodel:\n  prefer: sonnet\n  effort: high\ntools:\n  builtin: [read]\n---\n";
    std::fs::write(&definition, narrow).unwrap();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

    let thread = host.start_thread("어제의 말", ThreadLink::NoWork).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);

    let file = sandbox.thread_json(&thread);
    assert_eq!((file["model"].clone(), file["effort"].clone()), (Value::Null, Value::Null), "고르지 않으면 채팅에 값이 없다: {file}");
    let args = common::receipt_args(&sandbox.claude_receipt(&sandbox.thread_session_id(&thread)));
    for name in ["--model", "--effort", "--tools", "--disallowedTools"] {
        assert!(!args.iter().any(|arg| arg == name), "고르지 않으면 {name}가 없다: {args:?}");
    }

    std::fs::write(&definition, "frontmatter 없는 글\n").unwrap();
    let broken = host.start_thread("오늘의 말", ThreadLink::NoWork).expect("깨진 옛 정의가 채팅을 막지 않는다");
    sandbox.wait_thread_kind(&broken, "turn-end", 1);
    host.shut_down();

    assert_eq!(std::fs::read_to_string(&definition).unwrap(), "frontmatter 없는 글\n", "옛 파일은 글자 그대로다");
}

#[test]
fn 새_thread의_첫_말에_runtime이_답하고_채팅의_값과_기록이_thread_폴더에_남는다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(two_turns(&sandbox));

    let picks = StartPicks { model: Some("sonnet".into()), effort: Some("high".into()), ..StartPicks::default() };
    let thread = host
        .start_thread_picking("세 낱말로 답해 줘: hello from turn", &[], ThreadLink::NoWork, picks)
        .expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let dir = sandbox.thread_dir(&thread);

    assert!(
        thread.len() == 15 && thread.as_bytes()[8] == b'-' && thread.bytes().filter(u8::is_ascii_digit).count() == 14,
        "Thread id는 처음 저장한 시각 YYYYMMDD-HHMMSS다(S5): {thread}"
    );
    let file = sandbox.thread_json(&thread);
    assert_eq!(file["title"], "세 낱말로 답해 줘: hello from turn", "이름은 첫 말에서 정한다");
    assert_eq!(file["work"], Value::Null, "Work 없음");
    assert!(file.get("participants").is_none(), "참여자 목록이 없다: {file}");
    assert_eq!(
        (file["runtime"].clone(), file["model"].clone(), file["effort"].clone()),
        (json!("claude-code"), json!("sonnet"), json!("high")),
        "Runtime · 모델 · 생각 깊이가 채팅의 값이다 — 모델 · 생각 깊이는 칩에서 고른 값이다"
    );
    // Codex는 작업 폴더 안을 묻지 않고 쓴다 — 작업 폴더를 Thread 폴더 안 `work/`로 옮겨 기록 파일과 뗀다(스펙 「01c — Codex」 작업 폴더).
    let work = dir.join("work");
    assert!(work.is_dir(), "Session을 열 때 `work/`가 선다");
    assert!(same_dir(Path::new(file["cwd"].as_str().expect("cwd")), &work), "Work 없는 Thread의 cwd는 Thread 폴더의 `work/`다");

    assert!(!dir.join("agents").exists(), "앱이 지시문 파일을 두지 않는다");

    let session = sandbox.thread_session_id(&thread);
    assert_eq!(file["sessionId"].as_str(), Some(session.as_str()));
    let receipt = sandbox.claude_receipt(&session);
    let args = common::receipt_args(&receipt);
    assert!(has_pair(&args, "--session-id", &session), "{args:?}");
    assert!(!args.iter().any(|arg| arg.contains("system-prompt")), "앱이 시스템 프롬프트를 덧붙이지 않는다: {args:?}");
    assert!(has_pair(&args, "--model", "sonnet") && has_pair(&args, "--effort", "high"), "영수증에 모델 · 생각 깊이: {args:?}");
    assert!(!args.iter().any(|arg| arg == "--add-dir"), "등록된 Project가 없으면 Work 없는 Thread는 함께 여는 폴더가 없다: {args:?}");
    assert!(same_dir(Path::new(receipt["cwd"].as_str().expect("cwd")), &work), "claude는 Thread 폴더의 `work/`에서 일한다");

    assert_eq!(
        (record[0]["seq"].clone(), record[0]["kind"].clone(), record[0]["payload"].clone()),
        (json!(1), json!("session"), json!({"state": "spawning"})),
        "첫 줄은 첫 Session의 띄우는 줄이다"
    );
    let spawning = record.iter().filter(|line| line["payload"]["state"] == "spawning").count();
    assert_eq!(spawning, 1, "첫 열기가 그 줄을 다시 쓰지 않는다:\n{}", common::lines_text(&record));
    assert!(
        record.iter().all(|line| line.get("who").is_none() && !["joined", "left"].contains(&line["kind"].as_str().unwrap())),
        "기록에 말한 이도 참여 줄도 없다:\n{}",
        common::lines_text(&record)
    );
    let sent = of_kind(&record, "sent");
    assert_eq!(sent.len(), 1);
    assert!(sent[0]["payload"].get("to").is_none(), "받는 이가 없다: {}", sent[0]);
    assert_eq!(
        sent[0]["payload"]["prompt"][1],
        json!({"type": "text", "text": "세 낱말로 답해 줘: hello from turn"}),
        "머리말 뒤에 본문이 간다(S10)"
    );
    let preamble = sent[0]["payload"]["prompt"][0]["text"].as_str().expect("머리말");
    assert!(preamble.contains(&thread), "머리말은 Thread id를 싣는다:\n{preamble}");
    let place = format!("\n- Work: 없음 — 이 Thread 폴더의 `work/`에서 일한다: `{}`\n", work.display());
    assert!(preamble.contains(&place), "머리말은 작업 폴더 `work/`를 말한다:\n{preamble}");
    assert!(!preamble.contains("handle") && !preamble.contains("참여자"), "머리말에 handle도 참여자도 없다:\n{preamble}");
    let stdin = sandbox.claude_stdin(&session);
    let user = stdin.iter().find(|line| line["type"] == "user").expect("claude가 받은 말");
    assert_eq!(user["message"]["content"], sent[0]["payload"]["prompt"], "claude가 받은 블록이 sent 줄에 남는다");

    assert_eq!(common::thread_emitted(&events, &thread), record, "기록 줄은 thread:record 이벤트로도 그대로 나간다");
    assert_eq!(events.thread_lists().first().map(|summary| summary.id.clone()), Some(thread.clone()), "새 채팅의 목록 요약이 나간다");
    let listed: Vec<String> = host.list_threads().expect("목록").into_iter().map(|summary| summary.id).collect();
    assert_eq!(listed, [thread.clone()]);

    host.shut_down();
}

/// 스펙 「옛 기록」 — 옛 판이 남긴 폴더(Runtime 값 없이 참여자만 있다)는 목록에 서지 않고, 말을 받지 않고, 글자 하나 바뀌지 않는다.
#[test]
fn runtime_값이_없는_옛_채팅_폴더는_목록에서_빠지고_지워지지_않는다() {
    let sandbox = Sandbox::new();
    let old = "20261001-090000";
    let dir = sandbox.thread_dir(old);
    std::fs::create_dir_all(dir.join("agents")).unwrap();
    let thread_json = r#"{"title": "옛 채팅", "participants": [{"handle": "host", "runtime": "claude-code", "sessionId": "옛-세션"}]}"#;
    let events_jsonl = r#"{"seq":1,"at":"2026-10-01T09:00:00.000+09:00","kind":"joined","who":"host","payload":{}}"#;
    std::fs::write(dir.join("thread.json"), thread_json).unwrap();
    std::fs::write(dir.join("events.jsonl"), format!("{events_jsonl}\n")).unwrap();
    std::fs::write(dir.join("agents/host.md"), "옛 스냅숏").unwrap();
    let host = sandbox.host(two_turns(&sandbox));

    assert_eq!(host.list_threads().expect("목록"), [], "목록에서 빠진다");
    let thread = host.start_thread("세 낱말로 답해 줘: hello from turn", ThreadLink::NoWork).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let listed: Vec<String> = host.list_threads().expect("목록").into_iter().map(|summary| summary.id).collect();
    assert_eq!(listed, [thread.clone()], "새 채팅만 선다");

    let gone = || atelier_acp::HostError::ThreadNotFound(old.to_owned());
    assert_eq!(host.thread(old).map(|_| ()), Err(gone()), "없는 Thread처럼 읽힌다");
    assert_eq!(host.send_to_thread(old, "살아났니"), Err(gone()), "말을 받지 않는다");
    assert_eq!(host.set_thread_model(old, "opus").map(|_| ()), Err(gone()), "채팅의 값도 바꾸지 않는다");
    assert_eq!(host.mark_thread_read(old, 1).map(|_| ()), Err(gone()));
    host.shut_down();

    assert_eq!(std::fs::read_to_string(dir.join("thread.json")).unwrap(), thread_json, "파일은 글자 그대로다");
    assert_eq!(std::fs::read_to_string(dir.join("events.jsonl")).unwrap(), format!("{events_jsonl}\n"), "기록도 글자 그대로다");
    assert_eq!(std::fs::read_to_string(dir.join("agents/host.md")).unwrap(), "옛 스냅숏");
    assert_eq!(sandbox.claude_launches().len(), 1, "옛 채팅을 띄우지 않았다");
}

/// 기록 축복(S26 꼴) — 새 Thread의 두 턴(답만 하는 턴 · `Write` · `Read` · `Bash`의 턴)이 검사 자료로 선다. PR ①의 L3(v1 티켓 10)가
/// 이 파일을 `thread:record`로 흘려 Thread 화면을 그린다.
#[test]
fn 새_thread_두_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(two_turns(&sandbox));

    let picks = StartPicks { model: Some("sonnet".into()), effort: Some("high".into()), ..StartPicks::default() };
    let thread = host
        .start_thread_picking("세 낱말로 답해 줘: hello from turn", &[], ThreadLink::NoWork, picks)
        .expect("새 Thread의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread(&thread, "notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘").expect("이어 말하기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread);
    assert_eq!(
        of_kind(&record, "sent").iter().map(|line| line["payload"]["prompt"].as_array().unwrap().len()).collect::<Vec<_>>(),
        [2, 1],
        "머리말은 Session의 첫 말에만 붙는다(S10)"
    );
    let settled = common::commands_after_opened(&record);
    common::assert_record("thread-two-turns", &common::fix_thread_record(&settled, &sandbox.data_root(), &thread, &[&session]));
}

/// 어제의 Thread — 한 턴을 돌리고 호스트를 끈다(앱 종료).
fn yesterday(sandbox: &Sandbox) -> String {
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    let thread = host.start_thread("어제의 말", ThreadLink::NoWork).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    thread
}

#[test]
fn 참여자가_없는_채팅이_앱을_다시_켠_뒤_같은_session으로_이어_열리고_모델은_채팅의_값이다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    let picks = StartPicks { model: Some("sonnet".into()), effort: Some("high".into()), ..StartPicks::default() };
    let thread = host.start_thread_picking("어제의 말", &[], ThreadLink::NoWork, picks).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    let session = sandbox.thread_session_id(&thread);
    assert!(sandbox.thread_json(&thread).get("participants").is_none());

    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    assert_eq!(sandbox.claude_launches().len(), 1, "다시 지어도 띄우지 않는다");
    host.send_to_thread(&thread, "오늘의 말").expect("말을 보내면 띄워 되살린다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);

    let launches = sandbox.claude_launch_args();
    assert_eq!(launches.len(), 2, "보낼 때 하나가 뜬다");
    let revived = &launches[1];
    assert!(has_pair(revived, "--resume", &session), "thread.json의 Session id로 되살린다: {revived:?}");
    assert!(
        has_pair(revived, "--model", "sonnet") && has_pair(revived, "--effort", "high"),
        "되살릴 때도 모델 · 생각 깊이를 다시 싣는다 — `-p --resume`은 되살리지 않는다: {revived:?}"
    );
    assert!(!revived.iter().any(|arg| arg.contains("system-prompt")), "되살려도 시스템 프롬프트를 덧붙이지 않는다: {revived:?}");
    assert_eq!(common::opened_hows(&record), ["new", "resumed"], "열림 줄이 맥락을 이었다고 말한다");
    assert_eq!(sandbox.thread_session_id(&thread), session, "같은 Session이다");
    let stdin = sandbox.claude_stdin(&session);
    let users: Vec<&Value> = stdin.iter().filter(|line| line["type"] == "user").collect();
    assert_eq!(users.len(), 2);
    assert_eq!(
        users[1]["message"]["content"],
        json!([{"type": "text", "text": "오늘의 말"}]),
        "맥락을 이었으니 머리말을 다시 붙이지 않는다(S10)"
    );

    host.shut_down();
}

#[test]
fn 되살릴_session을_claude가_모르면_새_session으로_열리고_열림_줄이_fresh이고_머리말과_thread_처음부터의_지난_말이_붙는다() {
    let sandbox = Sandbox::new();
    let thread = yesterday(&sandbox);
    let first = sandbox.thread_session_id(&thread);

    // 다시 켠 앱의 claude는 그 Session을 모른다 — resume이 실패하고, load는 같은 `--resume`이라 변환기가 다시 띄우지 않고
    // 거절한다(three-axes 티켓 16). 그래서 새로 연다.
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FORGETS", "1")]));
    host.send_to_thread(&thread, "오늘의 말").expect("보내기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);

    let launches = sandbox.claude_launch_args();
    assert_eq!(launches.len(), 3, "어제의 하나 · 없다고 끝난 --resume 하나 · 새 Session 하나: {launches:?}");
    assert!(has_pair(&launches[1], "--resume", &first), "{:?}", launches[1]);
    let second = sandbox.thread_session_id(&thread);
    assert_ne!(second, first, "새 Session의 id가 thread.json에 적힌다");
    assert!(has_pair(&launches[2], "--session-id", &second), "{:?}", launches[2]);
    assert_eq!(common::opened_hows(&record), ["new", "fresh"], "맥락을 잇지 못했다고 열림 줄이 말한다");
    let spawning = record.iter().filter(|line| line["payload"]["state"] == "spawning").count();
    assert_eq!(spawning, 2, "새 Thread의 첫 줄 · 되살리기의 줄:\n{}", common::lines_text(&record));
    let user = sandbox.claude_stdin(&second).into_iter().find(|line| line["type"] == "user").expect("새 Session이 받은 말");
    let content = user["message"]["content"].as_array().expect("블록들").clone();
    assert_eq!(content.len(), 3, "새 Session의 첫 말에 머리말 · 지난 말이 다시 붙는다(S10): {content:?}");
    assert!(content[0]["text"].as_str().unwrap().starts_with("Atelier Thread 안에서 열린 Session이다."));
    let past = content[1]["text"].as_str().unwrap();
    assert!(
        past.starts_with("지난 말 — ") && past.ends_with("[사람]\n어제의 말\n\n[답]\nPROBE-SKILL-OK\n\n"),
        "새 Session은 앞 Session을 모르므로 Thread 처음부터 — 어제의 말과 제 답까지 받는다(v1 티켓 13):\n{past}"
    );
    assert_eq!(content[2]["text"], "오늘의 말");

    host.shut_down();
}

#[test]
fn 엔진이_넣는_mcp_서버는_thread_도구_하나이고_사용자_mcp는_그대로_붙는다() {
    let sandbox = Sandbox::new();
    let thread = yesterday(&sandbox);

    let args = common::receipt_args(&sandbox.claude_receipt(&sandbox.thread_session_id(&thread)));
    let config = args.iter().position(|arg| arg == "--mcp-config").and_then(|at| args.get(at + 1)).expect("--mcp-config");
    let servers: Vec<String> = serde_json::from_str::<Value>(config).unwrap()["mcpServers"]
        .as_object()
        .map(|servers| servers.keys().cloned().collect())
        .unwrap_or_default();
    assert_eq!(servers, ["atelier-thread"], "엔진이 넣는 MCP 서버는 Thread 도구 하나다(v1 티켓 15)");
    assert!(!args.iter().any(|arg| arg == "--strict-mcp-config"), "사용자 MCP는 그대로 붙는다: {args:?}");
}

#[test]
fn 이_work에_이은_thread는_thread_json에_work를_적고_worktree에서_spec_폴더를_함께_열고_머리말이_work를_싣는다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &["fe"]);
    let meta = work.join("work.json");
    let mut file: Value = serde_json::from_str(&std::fs::read_to_string(&meta).unwrap()).unwrap();
    file["branch"] = json!("feat/cart");
    std::fs::write(&meta, file.to_string()).unwrap();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

    let thread = host.start_thread("장바구니를 고치자", ThreadLink::Work { slug: "cart".into() }).expect("이 Work");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);

    assert_eq!(sandbox.thread_json(&thread)["work"], "cart", "연결은 thread.json의 work에만 적는다");
    let session = sandbox.thread_session_id(&thread);
    let receipt = sandbox.claude_receipt(&session);
    let args = common::receipt_args(&receipt);
    let spec = work.join("spec");
    assert!(has_pair(&args, "--add-dir", spec.to_str().unwrap()), "spec 폴더를 함께 연다: {args:?}");
    assert!(same_dir(Path::new(receipt["cwd"].as_str().unwrap()), &work.join("trees/fe")), "worktree 하나면 그 worktree에서 일한다(S11)");
    let me = sandbox.thread_json(&thread);
    assert!(same_dir(Path::new(me["cwd"].as_str().unwrap()), &work.join("trees/fe")), "thread.json에 지금 작업 폴더를 적는다");
    assert_eq!(me["additionalDirectories"], json!([spec]));
    let preamble = of_kind(&record, "sent")[0]["payload"]["prompt"][0]["text"].as_str().unwrap().to_owned();
    assert!(
        preamble.contains("- Work: `cart` — cart 제목")
            && preamble.contains(&format!("spec 폴더(specDir): `{}`", spec.display()))
            && preamble.contains(&format!("Project `fe`: worktree `{}`", work.join("trees/fe").display()))
            && preamble.contains("브랜치: `feat/cart`"),
        "머리말이 이어진 Work의 이름 · 브랜치 · worktree · spec 폴더를 싣는다(S10):\n{preamble}"
    );
    assert!(preamble.contains(SPEC_LAYOUT_HEAD) && preamble.contains("overview.md"), "머리말이 spec 배치를 싣는다:\n{preamble}");
    assert!(!preamble.contains("start_editing"), "worktree가 모두 섰으면 고치기 시작을 말할 까닭이 없다:\n{preamble}");

    host.shut_down();
}

#[test]
fn 아직_worktree가_없는_project가_있으면_머리말이_고치기_전에_start_editing을_부르라고_한다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &["fe", "be"]);
    std::fs::remove_dir(work.join("trees/be")).unwrap();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

    let thread = host.start_thread("장바구니를 고치자", ThreadLink::Work { slug: "cart".into() }).expect("이 Work");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let preamble = of_kind(&record, "sent")[0]["payload"]["prompt"][0]["text"].as_str().unwrap().to_owned();
    assert!(preamble.contains("Project `be`: 읽기만 — worktree가 아직 없다"), "{preamble}");
    assert!(preamble.contains("읽기만인 Project를 고치려면 먼저 `start_editing`을 부른다"), "{preamble}");
}

#[test]
fn worktree가_없는_work의_thread는_spec_폴더에서_일하고_새_work로_시작은_work_없이_선다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));

    let in_work = host.start_thread("문서부터", ThreadLink::Work { slug: "cart".into() }).expect("이 Work");
    let record = sandbox.wait_thread_kind(&in_work, "turn-end", 1);
    let receipt = sandbox.claude_receipt(&sandbox.thread_session_id(&in_work));
    assert!(same_dir(Path::new(receipt["cwd"].as_str().unwrap()), &work.join("spec")), "worktree 없는 Work는 spec 폴더다(S11)");
    assert!(!common::receipt_args(&receipt).iter().any(|arg| arg == "--add-dir"));
    let preamble = of_kind(&record, "sent")[0]["payload"]["prompt"][0]["text"].as_str().unwrap().to_owned();
    assert!(preamble.contains(SPEC_LAYOUT_HEAD), "기획만 하는 Work도 spec 배치를 받는다:\n{preamble}");
    assert!(!preamble.contains("브랜치:") && !preamble.contains("start_editing"), "브랜치도 고칠 Project도 없다:\n{preamble}");

    let new_work = host.start_thread("새로 시작하자", ThreadLink::NewWork).expect("새 Work로 시작");
    sandbox.wait_thread_kind(&new_work, "turn-end", 1);
    assert_eq!(sandbox.thread_json(&new_work)["work"], Value::Null, "아직 Work가 없다");
    let receipt = sandbox.claude_receipt(&sandbox.thread_session_id(&new_work));
    let place = sandbox.thread_dir(&new_work).join("work");
    assert!(same_dir(Path::new(receipt["cwd"].as_str().unwrap()), &place), "Work 없음처럼 Thread 폴더의 `work/`다");

    assert_eq!(
        host.start_thread("없는 곳", ThreadLink::Work { slug: "nope".into() }),
        Err(atelier_acp::HostError::WorkNotFound("nope".into())),
        "없는 Work에는 잇지 않는다"
    );
    let listed: Vec<String> = host.list_threads().unwrap().into_iter().map(|summary| summary.id).collect();
    assert_eq!(listed.len(), 2, "거절된 첫 말은 Thread를 세우지 않는다: {listed:?}");

    host.shut_down();
}

/// 첫 턴이 멈출 때까지 도는 Thread — 원문은 40초 자는 명령을 돌리다 interrupt로 멈춘 턴이다. 도구 줄이 선 뒤에 돌려준다.
fn running_thread(sandbox: &Sandbox) -> (atelier_acp::ConversationHost, common::Events, String) {
    let shell = sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/interrupt-sigint")]);
    let (host, events) = sandbox.host_with_events(shell);
    let thread = host.start_thread("40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해", ThreadLink::NoWork).expect("첫 말");
    sandbox.wait_thread_record(&thread, |record| {
        of_kind(record, "update").iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });
    (host, events, thread)
}

#[test]
fn 도는_동안의_말은_대기_줄에_들고_고치고_지울_수_있고_멈추면_턴이_cancelled로_끝난_뒤_대기_줄의_말이_같은_session으로_간다() {
    let sandbox = Sandbox::new();
    let (host, events, thread) = running_thread(&sandbox);

    host.send_to_thread(&thread, "지울 말").expect("도는 동안의 말");
    host.send_to_thread(&thread, "고칠 말").expect("도는 동안의 말");
    let queued = host.thread(&thread).expect("Thread의 지금").queue.clone();
    assert_eq!(queued.iter().map(|message| message.text.as_str()).collect::<Vec<_>>(), ["지울 말", "고칠 말"], "대기 줄에 든다");
    host.delete_thread_queued(&thread, &queued[0].id).expect("대기 지우기");
    host.edit_thread_queued(&thread, &queued[1].id, "방금 무엇을 돌리려 했고 끝났는지 한 문장으로").expect("대기 고치기");
    let last = events.thread_queues(&thread).last().cloned().expect("대기 줄 바뀜 이벤트");
    assert_eq!(last.iter().map(|message| message.text.as_str()).collect::<Vec<_>>(), ["방금 무엇을 돌리려 했고 끝났는지 한 문장으로"]);
    assert!(host.thread(&thread).unwrap().live, "턴이 도는 Thread는 떠 있다");

    host.stop_thread(&thread).expect("멈추기는 Thread 전체에 건다");

    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    let ends = of_kind(&record, "turn-end");
    assert_eq!(
        (ends[0]["payload"]["stopReason"].clone(), ends[0]["payload"]["cancelledByUs"].clone()),
        (json!("cancelled"), json!(true)),
        "우리가 멈춘 턴이다:\n{}",
        common::lines_text(&record)
    );
    assert_eq!(common::sent_texts(&record), ["40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해", "방금 무엇을 돌리려 했고 끝났는지 한 문장으로"]);
    assert_eq!(ends[1]["payload"]["stopReason"], "end_turn");
    assert_eq!(sandbox.all_claude_receipts().len(), 1, "같은 프로세스가 다음 말을 받는다");
    let session = sandbox.thread_session_id(&thread);
    let shapes: Vec<String> = sandbox
        .claude_stdin(&session)
        .iter()
        .map(|line| line["request"]["subtype"].as_str().unwrap_or_else(|| line["type"].as_str().unwrap()).to_owned())
        .collect();
    assert_eq!(shapes, ["initialize", "user", "interrupt", "user"], "멈추기는 stdin의 interrupt 하나다");
    assert!(host.thread(&thread).unwrap().queue.is_empty());

    host.shut_down();
}

#[test]
fn 지금_전하기는_도는_턴을_멈추고_그_말을_먼저_보낸다() {
    let sandbox = Sandbox::new();
    let (host, _events, thread) = running_thread(&sandbox);

    host.send_to_thread(&thread, "방금 무엇을 돌리려 했고 끝났는지 한 문장으로").expect("도는 동안의 말");
    let queued = host.thread(&thread).unwrap().queue.clone();
    host.send_thread_now(&thread, &queued[0].id).expect("지금 전하기");

    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    let sent = of_kind(&record, "sent");
    assert_eq!(sent[1]["payload"]["sendNow"], json!(true), "지금 전한 말이다");
    assert_eq!(of_kind(&record, "turn-end")[0]["payload"]["stopReason"], "cancelled");
    assert_eq!(
        host.send_thread_now(&thread, &queued[0].id),
        Err(atelier_acp::HostError::QueuedNotFound(queued[0].id.clone())),
        "이미 간 말이다"
    );

    host.shut_down();
}

#[test]
fn 로그인이_풀린_claude는_thread에_로그인_필요_줄을_남기고_로그인하면_같은_session으로_다시_뜬다() {
    let sandbox = Sandbox::new();
    sandbox.log_in(atelier_acp::Agent::Claude);
    let receipts = sandbox.claude_receipts();
    let extra = [("FAKE_CLAUDE_FIXTURE", "2.1.309/noauth"), ("FAKE_CLAUDE_RECEIPTS", receipts.to_str().unwrap())];
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("normal", common::NO_BROWSER, &extra));

    // 진짜 claude 2.1.296은 로그인이 안 돼도 세션 열기는 된다 — 첫 턴에서야 드러난다(three-axes 실측 A8).
    let thread = host.start_thread("ok 라고만 답해.", ThreadLink::NoWork).expect("Session은 열린다");
    let record =
        sandbox.wait_thread_record(&thread, |record| record.iter().any(|line| line["payload"]["state"] == "login-required"));
    let session = sandbox.thread_session_id(&thread);

    let tail: Vec<Value> = record.iter().rev().take(2).rev().map(|line| line["kind"].clone()).collect();
    assert_eq!(tail, [json!("turn-end"), json!("session")], "턴 끝 바로 뒤에 로그인 필요 줄");
    assert_eq!(record.last().unwrap()["payload"], json!({"state": "login-required"}));
    assert_eq!(
        events.engine_states().last(),
        Some(&atelier_acp::EngineState { agent: atelier_acp::Agent::Claude, found: true, logged_in: Some(false), missing: vec![] }),
        "설정 화면이 읽는 엔진 상태가 나간다"
    );
    assert_eq!(
        host.send_to_thread(&thread, "한 번 더."),
        Err(atelier_acp::HostError::LoginRequired { agent: atelier_acp::Agent::Claude, thread: thread.clone() }),
        "로그인을 기다리는 동안의 말은 로그인 필요로 거절된다"
    );

    // 터미널에서 로그인하고 「다시 확인」을 눌렀다 — 같은 Session을 --resume으로 다시 띄운다.
    assert!(matches!(host.check_engine(atelier_acp::Agent::Claude, true), Ok(atelier_acp::EngineCheck::Found { logged_in: true, .. })));
    let launches = sandbox.claude_launch_args();
    assert_eq!(launches.len(), 2, "떠 있던 claude를 끄고 새로 띄웠다");
    assert!(has_pair(&launches[1], "--resume", &session), "{:?}", launches[1]);
    assert_eq!(common::opened_hows(&sandbox.thread_record(&thread)), ["new", "resumed"]);
    assert!(host.thread(&thread).unwrap().live, "다시 뜬 Session은 떠 있다");

    host.shut_down();
}

#[test]
fn 에이전트_프로세스가_죽으면_host의_죽음_줄이_서고_다음_말에서_같은_session으로_되살린다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let session = sandbox.thread_session_id(&thread);
    let translator = sandbox.claude_receipt(&session)["ppid"].as_u64().unwrap() as i32;

    // 변환기와 claude의 그룹을 바깥에서 끈다 — 앱이 끈 것이 아니다.
    // SAFETY: 이 시험이 띄운 변환기의 프로세스 그룹에 신호를 보낼 뿐이다.
    unsafe { libc::killpg(translator, libc::SIGKILL) };
    sandbox.wait_thread_record(&thread, |record| record.iter().any(|line| line["payload"]["state"] == "died"));
    assert!(!host.thread(&thread).unwrap().live, "죽은 Session은 떠 있지 않다");

    host.send_to_thread(&thread, "다시 말").expect("다음 말이 되살린다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    let launches = sandbox.claude_launch_args();
    assert_eq!(launches.len(), 2);
    assert!(has_pair(&launches[1], "--resume", &session), "{:?}", launches[1]);
    assert_eq!(common::opened_hows(&record), ["new", "resumed"]);

    host.shut_down();
}

#[test]
fn 끌_때_셈에_thread의_도는_턴과_대기_줄이_들고_호스트를_끄면_남는_프로세스가_없다() {
    let sandbox = Sandbox::new();
    let (host, _events, thread) = running_thread(&sandbox);
    host.send_to_thread(&thread, "기다리는 말").expect("도는 동안의 말");

    assert_eq!(
        host.quit_counts(),
        atelier_acp::QuitCounts { running: 1, queued: 1, approvals: 0 },
        "Thread의 Session도 센다(S40)"
    );
    let receipt = sandbox.claude_receipt(&sandbox.thread_session_id(&thread));
    let pids = [receipt["pid"].as_u64().unwrap() as u32, receipt["ppid"].as_u64().unwrap() as u32];

    host.shut_down();

    common::assert_all_gone(&pids);
    assert_eq!(host.quit_counts(), atelier_acp::QuitCounts::default(), "끈 뒤에는 셀 것이 없다");
}

#[test]
fn 모델을_바꾸면_떠_있는_claude가_set_model을_받고_채팅의_값과_config_줄에_남고_떠_있지_않으면_다음에_띄울_때_든다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")]));
    let thread = host.start_thread("세 낱말로 답해 줘: hello from turn", ThreadLink::NoWork).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let session = sandbox.thread_session_id(&thread);

    let changed = host.set_thread_model(&thread, "opus").expect("모델 바꾸기");
    assert_eq!(changed.model.as_deref(), Some("opus"), "답은 바뀐 채팅의 값이다");
    let controls: Vec<Value> = sandbox
        .claude_stdin(&session)
        .into_iter()
        .filter(|line| line["type"] == "control_request" && line["request"]["subtype"] != "initialize")
        .map(|line| line["request"].clone())
        .collect();
    assert_eq!(controls, [json!({"subtype": "set_model", "model": "opus"})], "떠 있는 claude에 곧바로 넣는다");
    assert_eq!(sandbox.thread_json(&thread)["model"], "opus");
    let record = sandbox.wait_thread_kind(&thread, "config", 1);
    let config = of_kind(&record, "config")[0];
    assert_eq!(config["payload"], json!({"model": "opus"}));

    // 앱을 다시 켠 뒤 — 떠 있지 않은 Session의 바꾸기는 thread.json에만 남고 띄울 때 플래그로 준다.
    host.shut_down();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")]));
    host.set_thread_model(&thread, "haiku").expect("떠 있지 않은 Session의 모델 바꾸기");
    assert_eq!(sandbox.claude_launches().len(), 1, "바꾸기는 띄우지 않는다");
    host.send_to_thread(&thread, "notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘").expect("보내기");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    assert!(has_pair(&sandbox.claude_launch_args()[1], "--model", "haiku"), "{:?}", sandbox.claude_launch_args()[1]);

    host.shut_down();
}

/// 생각 깊이 바꾸기(v1 티켓 05 · 스토리 33) — claude는 떠 있는 Session의 생각 깊이를 바꾸는 요청이 없어 `--effort`로만 받는다. 쉬는
/// Session은 같은 Session으로 다시 띄워 다음 턴부터 들고, 떠 있지 않으면 thread.json에만 남아 띄울 때 든다. 도는 턴은 끊지 않는다.
#[test]
fn 생각_깊이를_바꾸면_쉬는_session은_같은_session으로_다시_뜨고_떠_있지_않으면_다음에_띄울_때_들고_도는_턴에는_거절한다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(two_turns(&sandbox));
    let thread = host.start_thread("세 낱말로 답해 줘: hello from turn", ThreadLink::NoWork).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let session = sandbox.thread_session_id(&thread);

    let changed = host.set_thread_effort(&thread, "low").expect("생각 깊이 바꾸기");
    assert_eq!(changed.effort.as_deref(), Some("low"), "답은 바뀐 채팅의 값이다");
    assert_eq!(sandbox.thread_json(&thread)["effort"], "low");
    let launches = sandbox.claude_launch_args();
    assert_eq!(launches.len(), 2, "쉬는 Session은 다시 띄운다");
    assert!(
        has_pair(&launches[1], "--resume", &session) && has_pair(&launches[1], "--effort", "low"),
        "같은 Session을 새 생각 깊이로 잇는다: {:?}",
        launches[1]
    );
    let record = sandbox.wait_thread_kind(&thread, "config", 1);
    let config = of_kind(&record, "config")[0];
    assert_eq!(config["payload"], json!({"effort": "low"}));
    assert_eq!(sandbox.thread_session_id(&thread), session, "Session id는 그대로다");
    assert_eq!(
        host.set_thread_effort(&thread, "extreme").map(|_| ()),
        Err(atelier_acp::HostError::Setting("모르는 생각 깊이예요: extreme".into())),
        "claude가 받지 않는 값은 거절한다"
    );
    assert_eq!(sandbox.thread_json(&thread)["effort"], "low", "거절하면 아무것도 바뀌지 않는다");

    // 앱을 다시 켠 뒤 — 떠 있지 않은 Session은 띄우지 않고, 다음에 띄울 때 플래그로 준다.
    host.shut_down();
    let host = sandbox.host(two_turns(&sandbox));
    host.set_thread_effort(&thread, "max").expect("떠 있지 않은 Session의 생각 깊이 바꾸기");
    assert_eq!(sandbox.claude_launches().len(), 2, "떠 있지 않은 Session은 띄우지 않는다");
    host.send_to_thread(&thread, "notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘").expect("보내기");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    assert!(has_pair(&sandbox.claude_launch_args()[2], "--effort", "max"), "{:?}", sandbox.claude_launch_args()[2]);
    host.shut_down();

    // 도는 턴 — 다시 띄우면 그 턴이 끊기므로 거절한다.
    let sandbox = Sandbox::new();
    let (host, _events, thread) = running_thread(&sandbox);
    assert_eq!(
        host.set_thread_effort(&thread, "low").map(|_| ()),
        Err(atelier_acp::HostError::Setting("턴이 도는 동안에는 생각 깊이를 바꿀 수 없습니다".into()))
    );
    assert_eq!(sandbox.thread_json(&thread)["effort"], Value::Null, "거절하면 채팅의 값도 그대로다");
    host.shut_down();
}

/// 첫 말 전의 모델 · 생각 깊이(v1 티켓 31 · 스토리 33) — 새 Thread의 입력창 칩에서 고른 값이 첫 Session의 `--model` · `--effort`가
/// 되고 채팅의 값으로 남는다. 고르지 않은 칸은 플래그가 없다. claude가 받지 않는 생각 깊이는 아무것도 세우지 않고 거절한다.
#[test]
fn 첫_말_전에_고른_모델과_생각_깊이로_첫_session이_서고_고르지_않은_칸은_넘기지_않는다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    let args_of = |thread: &str| {
        sandbox.wait_thread_kind(thread, "turn-end", 1);
        common::receipt_args(&sandbox.claude_receipt(&sandbox.thread_session_id(thread)))
    };

    let picks = StartPicks { model: Some("haiku".into()), effort: Some("low".into()), ..StartPicks::default() };
    let thread = host.start_thread_picking("안녕", &[], ThreadLink::NoWork, picks).expect("고른 모델로 새 Thread");
    let args = args_of(&thread);
    assert!(has_pair(&args, "--model", "haiku") && has_pair(&args, "--effort", "low"), "고른 값으로 첫 Session이 선다: {args:?}");
    let me = sandbox.thread_json(&thread);
    assert_eq!((me["model"].clone(), me["effort"].clone()), (json!("haiku"), json!("low")), "채팅의 값으로 남는다");

    let model_only = StartPicks { model: Some("opus".into()), ..StartPicks::default() };
    let other = host.start_thread_picking("안녕", &[], ThreadLink::NoWork, model_only).expect("모델만 고른 새 Thread");
    let args = args_of(&other);
    assert!(has_pair(&args, "--model", "opus"), "고른 모델은 간다: {args:?}");
    assert!(!args.iter().any(|arg| arg == "--effort"), "고르지 않은 생각 깊이는 넘기지 않는다: {args:?}");
    assert_eq!(sandbox.thread_json(&other)["effort"], Value::Null, "고르지 않은 칸은 채팅에 값이 없다");

    let before = host.list_threads().unwrap().len();
    let unknown = StartPicks { effort: Some("extreme".into()), ..StartPicks::default() };
    assert_eq!(
        host.start_thread_picking("안녕", &[], ThreadLink::NoWork, unknown).map(|_| ()),
        Err(atelier_acp::HostError::Setting("모르는 생각 깊이예요: extreme".into()))
    );
    assert_eq!(host.list_threads().unwrap().len(), before, "거절된 첫 말은 Thread를 세우지 않는다");
    host.shut_down();
}

/// 위 막대의 이름 고치기(v1 티켓 05 · 구현 스펙 §14 · §18) — 사람이 바꾼 이름은 `thread.json` · `title` 줄 · 목록 요약에 함께 선다.
/// 줄에는 `who`가 없다(사람의 줄, S8). Session을 띄우지 않고, 다시 켠 뒤(기록을 쥐지 않은 엔진)에도 된다.
#[test]
fn 이름을_바꾸면_thread_json과_title_줄과_목록_요약이_바뀌고_같거나_빈_이름은_줄을_더하지_않는다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(two_turns(&sandbox));
    let thread = host.start_thread("세 낱말로 답해 줘: hello from turn", ThreadLink::NoWork).expect("새 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);

    let summary = host.rename_thread(&thread, "  환불 API 버그\n").expect("이름 바꾸기");
    assert_eq!(summary.title, "환불 API 버그", "앞뒤 빈칸과 줄바꿈은 걷는다");
    assert_eq!(sandbox.thread_json(&thread)["title"], "환불 API 버그");
    let record = sandbox.wait_thread_kind(&thread, "title", 1);
    let line = of_kind(&record, "title")[0];
    assert_eq!(line["payload"], json!({"title": "환불 API 버그", "before": "세 낱말로 답해 줘: hello from turn"}));
    assert_eq!(events.thread_lists().last().map(|summary| summary.title.clone()).as_deref(), Some("환불 API 버그"));
    assert_eq!(host.list_threads().expect("목록")[0].title, "환불 API 버그");

    host.rename_thread(&thread, "환불 API 버그").expect("같은 이름");
    assert_eq!(
        host.rename_thread(&thread, "  \n "),
        Err(atelier_acp::HostError::BadTitle),
        "빈 이름은 거절하고 아무것도 바꾸지 않는다"
    );
    assert_eq!(of_kind(&sandbox.thread_record(&thread), "title").len(), 1, "같은 이름 · 빈 이름은 줄을 더하지 않는다");

    // 다시 켠 뒤 — 엔진이 기록을 쥐지 않았어도 이어 적는다. Session은 띄우지 않는다.
    host.shut_down();
    let host = sandbox.host(two_turns(&sandbox));
    host.rename_thread(&thread, "환불 버그").expect("다시 켠 뒤의 이름 바꾸기");
    assert_eq!(sandbox.claude_launches().len(), 1, "이름 바꾸기는 Session을 띄우지 않는다");
    let titles: Vec<Value> =
        of_kind(&sandbox.thread_record(&thread), "title").into_iter().map(|line| line["payload"].clone()).collect();
    assert_eq!(titles.last(), Some(&json!({"title": "환불 버그", "before": "환불 API 버그"})));
    assert_eq!(
        host.rename_thread("20261010-100000", "이름").map(|_| ()),
        Err(atelier_acp::HostError::ThreadNotFound("20261010-100000".into()))
    );
    host.shut_down();
}

/// 읽은 자리(v1 티켓 41 · 구현 스펙 §17 · S38) — 화면은 Thread를 열고 맨 아래가 보일 때 끝 줄의 seq를 적는다. `thread.json`의 `lastRead`와
/// 목록 요약이 함께 바뀌어 사이드바의 「새 결과」(굵은 제목)가 걷힌다. 읽은 자리는 뒤로 가지 않는다 — 늦게 온 옛 seq가 읽은 결과를 다시
/// 새 결과로 만들지 않게.
#[test]
fn 읽은_자리를_적으면_thread_json과_목록_요약이_바뀌고_뒤로_가지_않는다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(two_turns(&sandbox));
    let thread = host.start_thread("세 낱말로 답해 줘: hello from turn", ThreadLink::NoWork).expect("새 Thread");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let end = record.last().expect("기록")["seq"].as_u64().expect("seq");
    assert_eq!(host.list_threads().expect("목록")[0].last_read, 0, "열어 보기 전에는 0이다");
    let written = sandbox.thread_record(&thread).len();

    let summary = host.mark_thread_read(&thread, end).expect("읽은 자리");
    assert_eq!(summary.last_read, end);
    assert_eq!(sandbox.thread_json(&thread)["lastRead"], end);
    assert_eq!(events.thread_lists().last().map(|summary| summary.last_read), Some(end), "사이드바는 요약 이벤트로 안다");

    let told = events.thread_lists().len();
    assert_eq!(host.mark_thread_read(&thread, end - 1).expect("옛 자리").last_read, end, "뒤로 가지 않는다");
    host.mark_thread_read(&thread, end).expect("같은 자리");
    assert_eq!(sandbox.thread_json(&thread)["lastRead"], end);
    assert_eq!(events.thread_lists().len(), told, "바뀐 것이 없으면 알리지 않는다");
    assert_eq!(sandbox.thread_record(&thread).len(), written, "읽은 자리는 기록에 줄을 남기지 않는다");

    // 다시 켠 뒤 — 색인을 처음 읽는 엔진도 읽은 자리를 안다. Session은 띄우지 않는다.
    host.shut_down();
    let host = sandbox.host(two_turns(&sandbox));
    assert_eq!(host.list_threads().expect("목록")[0].last_read, end);
    assert_eq!(sandbox.claude_launches().len(), 1, "읽은 자리 적기는 Session을 띄우지 않는다");
    assert_eq!(
        host.mark_thread_read("20261010-100000", 1).map(|_| ()),
        Err(atelier_acp::HostError::ThreadNotFound("20261010-100000".into()))
    );
    host.shut_down();
}

#[test]
fn thread_id의_꼴이_아니거나_없는_thread는_찾을_수_없다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[]));
    for id in ["../works", "20261010-100000"] {
        assert_eq!(host.read_thread_record(id, 0), Err(atelier_acp::HostError::ThreadNotFound(id.into())), "{id}");
        assert_eq!(host.send_to_thread(id, "말"), Err(atelier_acp::HostError::ThreadNotFound(id.into())), "{id}");
        assert_eq!(host.thread(id).map(|_| ()), Err(atelier_acp::HostError::ThreadNotFound(id.into())), "{id}");
    }
    assert!(!sandbox.data_root().join("threads").exists(), "찾기는 아무것도 만들지 않는다");
    assert_eq!(host.list_threads(), Ok(Vec::new()));
}
