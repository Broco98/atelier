//! L1 — Codex 채팅(restart 티켓 01c-3 · 스펙 「01c — Codex」). 새 채팅에서 Codex를 고르면 Host가 `codex-acp`를 `CODEX_PATH`와 함께 띄우고, 화면과
//! 기록은 ACP 하나만 읽는다 — Claude 채팅과 같은 기록 줄이 선다.
//!
//! `codex-acp`는 가짜 ACP 에이전트다. 진짜 codex-acp 2.2.2의 녹음(`tests/fixtures/codex-acp-2.2.2/`)을 재생한다(01c-1). 시험은 호스트에 Thread
//! 명령을 넣고 Thread 폴더와 가짜의 영수증(받은 env · `session/new` · 되살리기)만 본다. 앱 재시작은 호스트를 끄고 같은 데이터 루트로 새 호스트를
//! 짓는 것으로 흉내 낸다.

mod common;

use std::path::Path;

use atelier_acp::{Agent, EngineCheck, EngineState, HostError, Runtime, StartPicks, ThreadLink};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// Codex를 고른 첫 말의 칩.
fn codex() -> StartPicks {
    StartPicks { runtime: Runtime::Codex, ..StartPicks::default() }
}

/// 두 경로가 같은 폴더인가 — macOS의 임시 폴더는 `/var`와 `/private/var` 두 이름이 있다.
fn same_dir(a: &Path, b: &Path) -> bool {
    a.canonicalize().unwrap() == b.canonicalize().unwrap()
}

#[test]
fn 새_채팅에서_codex를_고르면_codex_acp가_codex_path와_함께_뜨고_채팅의_runtime_칸이_codex다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[]));

    let thread = host
        .start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex())
        .expect("Codex 채팅의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let file = sandbox.thread_json(&thread);
    assert_eq!(file["runtime"], "codex", "{file}");
    let session = sandbox.thread_session_id(&thread);
    let receipt = sandbox.acp_receipt(&session);
    let codex_path = sandbox.login_bin().join("codex");
    assert_eq!(receipt["env"]["CODEX_PATH"], json!(codex_path.display().to_string()), "codex-acp는 사용자의 codex를 CODEX_PATH로 받는다");
    let opened = &receipt["sessionNew"];
    assert!(same_dir(Path::new(opened["cwd"].as_str().expect("cwd")), &sandbox.thread_dir(&thread).join("work")), "{opened}");
    let servers: Vec<&str> = opened["mcpServers"].as_array().expect("mcpServers").iter().filter_map(|server| server["name"].as_str()).collect();
    assert_eq!(servers, ["atelier-thread"], "앱 기능 도구 서버를 넘긴다");
    assert!(opened.get("_meta").is_none(), "Claude 변환기에게 주는 값을 싣지 않는다: {opened}");
    assert!(sandbox.claude_launches().is_empty(), "claude는 뜨지 않는다");

    let ended = of_kind(&record, "turn-end");
    assert_eq!(ended[0]["payload"]["stopReason"], "end_turn", "{}", common::lines_text(&record));
    let answer: String = record
        .iter()
        .filter(|line| line["payload"]["update"]["sessionUpdate"] == "agent_message_chunk")
        .filter_map(|line| line["payload"]["update"]["content"]["text"].as_str())
        .collect();
    assert_eq!(answer, "ok", "녹음의 답이 기록에 선다");
    let prompts = sandbox.acp_prompts(&session);
    assert_eq!(prompts.len(), 1);
    let blocks = prompts[0]["prompt"].as_array().expect("블록들");
    assert!(
        blocks[0]["text"].as_str().is_some_and(|text| text.starts_with("Atelier Thread 안에서 열린 Session이다.")),
        "Codex에도 같은 머리말이 간다: {blocks:?}"
    );
    assert_eq!(blocks[1], json!({"type": "text", "text": "Reply with exactly one word: ok"}));
}

/// 그 기록에서 줄 종류마다 payload의 칸 이름들 — 갈래가 있는 세션 줄은 `state`로 가른다.
fn shapes(record: &[Value]) -> Vec<(String, Vec<String>)> {
    let mut shapes: Vec<(String, Vec<String>)> = Vec::new();
    for line in record {
        let kind = match (line["kind"].as_str().unwrap(), line["payload"]["state"].as_str()) {
            ("session", Some(state)) => format!("session {state}"),
            (kind, _) => kind.to_owned(),
        };
        let mut keys: Vec<String> = line["payload"].as_object().expect("payload").keys().cloned().collect();
        keys.sort();
        if !shapes.contains(&(kind.clone(), keys.clone())) {
            shapes.push((kind, keys));
        }
    }
    shapes
}

/// 기록 축복(S26 꼴) — Codex 채팅의 두 턴(답만 하는 턴 · `echo atelier` 명령의 턴)이 검사 자료로 선다. 화면의 L2가 이 파일을 접어 Claude
/// 기록과 같은 모양인지 본다(스토리 41).
#[test]
fn codex_턴은_claude_턴과_같은_기록_줄을_만들고_그_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[]));

    let thread = host
        .start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex())
        .expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread(&thread, "Run the shell command `echo atelier` and tell me what it printed. Do nothing else.").expect("이어 말하기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    // Atelier 전용 이벤트 형식을 만들지 않는다 — 줄의 종류와 칸이 Claude 채팅의 것 안에 들고, Runtime이 보낸 update는 원문 그대로 선다. 계정
    // 줄(`auth-status`)은 codex-acp만 보내는 ACP 알림을 Host가 이미 적던 세션 줄이다.
    let claude = shapes(&common::record_at(&common::records_dir().join("thread-two-turns.jsonl")));
    for (kind, keys) in shapes(&record).into_iter().filter(|(kind, _)| kind != "session auth-status") {
        let known = claude.iter().find(|(seen, _)| *seen == kind).map(|(_, keys)| keys);
        assert!(
            known.is_some_and(|known| keys.iter().all(|key| known.contains(key))),
            "Claude 채팅에 없는 꼴의 줄: {kind} {keys:?}\n{}",
            common::lines_text(&record)
        );
    }
    let tool = of_kind(&record, "update")
        .into_iter()
        .find(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call")
        .unwrap_or_else(|| panic!("도구 줄이 없다:\n{}", common::lines_text(&record)));
    assert_eq!(tool["payload"]["update"]["title"], "echo atelier", "codex-acp가 보낸 줄 그대로다");
    assert_eq!(of_kind(&record, "turn-end").iter().map(|line| line["payload"]["stopReason"].clone()).collect::<Vec<_>>(), ["end_turn", "end_turn"]);

    let session = sandbox.thread_session_id(&thread);
    let settled = common::commands_after_each_opened(&record);
    common::assert_record("thread-codex", &common::fix_thread_record(&settled, &sandbox.data_root(), &thread, &[&session]));
}

/// 기록 축복 — 작업공간에 이은 Codex 채팅이 작업 폴더(worktree가 아직 없어 spec 폴더) 안에 파일을 묻지 않고 쓴 턴(녹음 `edit`의 첫 턴). 화면의
/// L2가 이 기록으로 문서 카드와 바뀐 파일 표시를 본다(스토리 41).
#[test]
fn 작업공간에_이은_codex_채팅의_편집_턴_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/edit", &[]));

    let first = "Use apply_patch to create a file named hello.txt in the current folder containing exactly `hi`. Do nothing else.";
    let thread =
        host.start_thread_picking(first, &[], ThreadLink::Work { slug: "cart".into() }, codex()).expect("Codex 채팅의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let spec = sandbox.work_dir("cart").join("spec");
    let edit = record
        .iter()
        .find(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call")
        .unwrap_or_else(|| panic!("편집 줄이 없다:\n{}", common::lines_text(&record)));
    let path = edit["payload"]["update"]["content"][0]["path"].as_str().expect("diff의 경로");
    assert!(same_dir(Path::new(path).parent().unwrap(), &spec), "녹음의 작업 폴더가 이 채팅의 작업 폴더(spec 폴더)로 바뀐다: {path}");
    assert!(of_kind(&record, "permission").is_empty(), "작업 폴더 안의 편집은 묻지 않는다:\n{}", common::lines_text(&record));

    let session = sandbox.thread_session_id(&thread);
    let settled = common::commands_after_each_opened(&record);
    common::assert_record("thread-codex-edit", &common::fix_thread_record(&settled, &sandbox.data_root(), &thread, &[&session]));
}

// ── 재개 차례 ───────────────────────────────────────────────────────────────────────
//
// 녹음 `resume`은 세 번 띄웠다 — 연 세션의 한 턴, `session/resume`(재생 없음) 뒤의 한 턴, `session/load`(답 전에 과거를 되감는다) 뒤의 한 턴.

/// 어제의 Codex 채팅 — 녹음 `resume`의 첫 턴을 돌리고 호스트를 끈다(앱 종료). 그때 넘긴 앱 기능 도구 서버를 함께 돌려준다.
fn yesterday(sandbox: &Sandbox) -> (String, Value) {
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/resume", &[]));
    let thread = host
        .start_thread_picking("Remember the word lantern. Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex())
        .expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    let session = sandbox.thread_session_id(&thread);
    let server = sandbox.acp_receipt(&session)["sessionNew"]["mcpServers"][0].clone();
    (thread, server)
}

/// 그 턴(1부터)의 답 글 — 조각을 이어 붙인다.
fn answer_of(record: &[Value], turn: usize) -> String {
    let starts: Vec<usize> = record.iter().enumerate().filter(|(_, line)| line["kind"] == "sent").map(|(at, _)| at).collect();
    let end = starts.get(turn).copied().unwrap_or(record.len());
    record[starts[turn - 1]..end]
        .iter()
        .filter(|line| line["payload"]["update"]["sessionUpdate"] == "agent_message_chunk")
        .filter_map(|line| line["payload"]["update"]["content"]["text"].as_str())
        .collect()
}

#[test]
fn 다시_켠_앱의_codex_채팅은_재생이_없는_session_resume으로_같은_세션을_잇고_앱_기능_도구의_새_소켓을_넘긴다() {
    let sandbox = Sandbox::new();
    let (thread, yesterday_server) = yesterday(&sandbox);
    let session = sandbox.thread_session_id(&thread);

    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/resume", &[]));
    host.send_to_thread(&thread, "What word did I ask you to remember? Reply with that one word.").expect("말을 보내면 띄워 되살린다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    let revivals = sandbox.acp_revivals();
    assert_eq!(revivals.len(), 1, "{revivals:?}");
    assert_eq!((&revivals[0]["method"], &revivals[0]["ok"]), (&json!("session/resume"), &json!(true)));
    assert_eq!(revivals[0]["params"]["sessionId"], json!(session), "thread.json의 세션 id로 잇는다");
    let servers = revivals[0]["params"]["mcpServers"].as_array().expect("mcpServers");
    assert_eq!(servers.len(), 1, "{servers:?}");
    assert_eq!(servers[0]["name"], "atelier-thread");
    assert_ne!(servers[0], yesterday_server, "열 때마다 새 소켓이다 — 앞 프로세스의 소켓은 이미 치웠다");
    assert_eq!(common::opened_hows(&record), ["new", "resumed"]);
    assert_eq!(sandbox.thread_session_id(&thread), session, "같은 세션이다");
    assert_eq!(answer_of(&record, 2), "lantern", "맥락이 이어진 녹음의 답이다");
    let prompts = sandbox.acp_prompts(&session);
    assert_eq!(
        prompts.last().map(|prompt| prompt["prompt"].clone()),
        Some(json!([{"type": "text", "text": "What word did I ask you to remember? Reply with that one word."}])),
        "맥락을 이었으니 머리말을 다시 붙이지 않는다"
    );
}

#[test]
fn session_resume이_안_되면_session_load로_잇고_되감은_과거는_기록에_다시_쌓이지_않는다() {
    let sandbox = Sandbox::new();
    let (thread, _) = yesterday(&sandbox);
    let session = sandbox.thread_session_id(&thread);
    let before = sandbox.thread_record(&thread).len();

    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/resume", &[("FAKE_ACP_REFUSES_RESUME", "1")]));
    host.send_to_thread(&thread, "Reply with exactly one word: done").expect("보내기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    let revivals: Vec<(Value, Value)> =
        sandbox.acp_revivals().iter().map(|revival| (revival["method"].clone(), revival["ok"].clone())).collect();
    assert_eq!(revivals, [(json!("session/resume"), json!(false)), (json!("session/load"), json!(true))], "resume 다음이 load다");
    assert_eq!(common::opened_hows(&record), ["new", "loaded"]);
    assert_eq!(sandbox.thread_session_id(&thread), session);
    let replayed: Vec<&Value> =
        record[before..].iter().filter(|line| line["payload"]["update"]["sessionUpdate"] == "user_message_chunk").collect();
    assert!(replayed.is_empty(), "load가 답 전에 되감은 과거는 버린다:\n{}", common::lines_text(&record));
    assert_eq!(answer_of(&record, 1), "ok", "어제의 답은 한 번만 선다");
    assert_eq!(answer_of(&record, 2), "done");
}

#[test]
fn 되살릴_세션을_codex가_모르면_새_세션으로_열고_머리말과_지난_말을_붙인다() {
    let sandbox = Sandbox::new();
    let (thread, _) = yesterday(&sandbox);
    let first = sandbox.thread_session_id(&thread);

    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/resume", &[("FAKE_ACP_FORGETS", "1")]));
    host.send_to_thread(&thread, "오늘의 말").expect("보내기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    let revivals: Vec<(Value, Value)> =
        sandbox.acp_revivals().iter().map(|revival| (revival["method"].clone(), revival["ok"].clone())).collect();
    assert_eq!(revivals, [(json!("session/resume"), json!(false)), (json!("session/load"), json!(false))]);
    assert_eq!(common::opened_hows(&record), ["new", "fresh"]);
    let second = sandbox.thread_session_id(&thread);
    assert_ne!(second, first, "새 세션의 id가 thread.json에 적힌다");
    let blocks = sandbox.acp_prompts(&second)[0]["prompt"].as_array().expect("블록들").clone();
    assert_eq!(blocks.len(), 3, "새 세션의 첫 말에 머리말 · 지난 말이 붙는다: {blocks:?}");
    assert!(blocks[0]["text"].as_str().unwrap().starts_with("Atelier Thread 안에서 열린 Session이다."));
    assert!(blocks[1]["text"].as_str().unwrap().starts_with("지난 말 — "), "{blocks:?}");
    assert_eq!(blocks[2]["text"], "오늘의 말");
}

// ── 판정 ───────────────────────────────────────────────────────────────────────────

/// 그 Thread의 권한 줄 가운데 첫 판정(물음 · 판정)이 적힐 때까지 기다린다.
fn first_permission(sandbox: &Sandbox, thread: &str) -> Value {
    let judged = |line: &&Value| line["kind"] == "permission" && matches!(line["payload"]["state"].as_str(), Some("asked" | "decided"));
    let record = sandbox.wait_thread_record(thread, |record| record.iter().any(|line| judged(&line)));
    record.iter().find(judged).cloned().expect("기다린 줄")
}

/// 작업공간의 정도가 `level`인 작업공간 `cart`에 이은 새 채팅이 권한 요청 하나를 받는다 — 요청은 `asks-permission` 가짜의 명령, `edit`이면 작업 폴더
/// 안 파일의 편집이다. 작업공간의 정도는 그 작업공간의 Claude 채팅이 칩으로 고른 값과 같은 자리(점 파일)다.
fn asked_in_work(runtime: Runtime, level: &str, edit: bool) -> Value {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    atelier_core::update_policy(&sandbox.data_root(), atelier_core::PolicyPlace::Work("cart"), |policy| policy.mode = Some(level.into()))
        .expect("작업공간의 정도");
    let version = env!("CARGO_PKG_VERSION");
    let mut extra = vec![("FAKE_ACP_VERSION", version)];
    if edit {
        extra.push(("FAKE_ACP_PERMISSION_TOOL_CALL", "edit"));
    }
    let shell = sandbox.login_shell_for_login("asks-permission", common::NO_BROWSER, &extra);
    // Claude 채팅의 변환기 자리에도 같은 가짜를 둔다 — 같은 요청이 Runtime의 판정 갈래만 달리 지난다.
    let agent = atelier_acp::TranslatorCommand::new(env!("CARGO_BIN_EXE_fake-acp-agent"), Vec::<String>::new());
    let host = sandbox.host_builder_with_translator(shell, agent, |_| {}).build();
    let picks = StartPicks { runtime, ..StartPicks::default() };
    let thread = host.start_thread_picking("고쳐 줘", &[], ThreadLink::Work { slug: "cart".into() }, picks).expect("새 채팅");
    let judged = first_permission(&sandbox, &thread);
    host.shut_down();
    judged
}

#[test]
fn 작업공간의_정도가_편집_자동이나_묻지_않음이어도_codex의_요청은_자동으로_허용되지_않고_카드로_묻는다() {
    for (level, edit, card) in [("edits", true, "edit"), ("auto", true, "edit"), ("auto", false, "command")] {
        let claude = asked_in_work(Runtime::ClaudeCode, level, edit);
        assert_eq!(claude["payload"]["state"], "decided", "Claude 채팅은 {level}의 표대로 허용한다: {claude}");

        let codex = asked_in_work(Runtime::Codex, level, edit);
        assert_eq!(
            (codex["payload"]["state"].clone(), codex["payload"]["card"].clone()),
            (json!("asked"), json!(card)),
            "Codex 채팅은 {level}에서도 묻는다: {codex}"
        );
        assert_eq!(codex["payload"]["policy"], "", "Claude의 정도를 까닭으로 달지 않는다(질문 카드처럼 빈 까닭): {codex}");
        assert!(codex["payload"].get("grant").is_none(), "「다시 묻지 않기」로 줄 허락이 없다: {codex}");
    }
}

// ── 로그인 ─────────────────────────────────────────────────────────────────────────

#[test]
fn 로그인이_풀린_codex_채팅의_로그인_필요는_codex의_것으로_서고_codex를_다시_확인하면_그_채팅이_뜬다() {
    let sandbox = Sandbox::new();
    sandbox.log_in(Agent::Claude);
    let (host, events) = sandbox.host_with_events(sandbox.login_shell_for_login("needs-auth", common::NO_BROWSER, &[]));

    let started = host.start_thread_picking("첫 말", &[], ThreadLink::NoWork, codex());
    let Err(HostError::LoginRequired { agent, thread }) = started else { panic!("로그인 필요로 거절된다: {started:?}") };
    assert_eq!(agent, Agent::Codex, "Codex의 로그인이 풀린 것이다");
    let record = sandbox.thread_record(&thread);
    assert_eq!(record.last().unwrap()["payload"], json!({"state": "login-required"}), "{}", common::lines_text(&record));
    assert_eq!(
        events.engine_states(),
        [EngineState { agent: Agent::Codex, found: true, logged_in: Some(false), login: None }],
        "Claude의 엔진 상태는 건드리지 않는다 — Claude 채팅에 로그인 카드가 서지 않는다"
    );

    sandbox.log_in(Agent::Codex);
    assert!(matches!(host.check_engine(Agent::Codex, true), Ok(EngineCheck::Found { logged_in: true, .. })));
    assert_eq!(common::opened_hows(&sandbox.thread_record(&thread)), ["new"], "Codex를 다시 확인하면 기다리던 채팅이 뜬다");
    assert!(host.thread(&thread).unwrap().live);
    host.shut_down();
}
