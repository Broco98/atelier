//! L1 — Codex 채팅(restart 티켓 01c-3 · 스펙 「01c — Codex」). 새 채팅에서 Codex를 고르면 Host가 `codex-acp`를 `CODEX_PATH`와 함께 띄우고, 화면과
//! 기록은 ACP 하나만 읽는다 — Claude 채팅과 같은 기록 줄이 선다. Codex의 요청은 Claude의 정도를 읽지 않고 앱 경계를 본 뒤 묻는다 — 앱 서버의
//! 도구만 허용하고, 앱이 거절해 멈춘 턴은 까닭을 단다(01c-7).
//!
//! `codex-acp`는 가짜 ACP 에이전트다. 진짜 codex-acp 2.2.2의 녹음(`tests/fixtures/codex-acp-2.2.2/`)을 재생한다(01c-1). 시험은 호스트에 Thread
//! 명령을 넣고 Thread 폴더와 가짜의 영수증(받은 env · `session/new` · 되살리기)만 본다. 앱 재시작은 호스트를 끄고 같은 데이터 루트로 새 호스트를
//! 짓는 것으로 흉내 낸다.

mod common;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use atelier_acp::{
    Agent, AskLevel, ConversationHost, EngineCheck, EngineState, HostError, ProjectChoice, Runtime, ServiceChoice, StartPicks,
    ThreadLink,
};
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

// ── 모드(restart 01c-5) ─────────────────────────────────────────────────────────────
//
// 스펙 「01c — Codex」 모드 — 채팅 파일에 Codex 모드를 두고 새로 열 때나 재개할 때 언제나 `session/set_mode`를 보낸다. 재개하면 모드가 풀리고,
// 모드가 풀린 채 턴이 돌면 경계가 사라진다. 기본은 `workspace-write`다.

/// 그 기록에서 처음으로 그 종류인 줄의 자리.
fn first_at(record: &[Value], kind: &str) -> usize {
    record.iter().position(|line| line["kind"] == kind).unwrap_or_else(|| panic!("{kind} 줄이 없다:\n{}", common::lines_text(record)))
}

#[test]
fn 새_codex_채팅은_workspace_access로_시작하고_첫_말보다_먼저_그_모드를_codex에_넣는다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[]));

    let thread = host
        .start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex())
        .expect("Codex 채팅의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert_eq!(sandbox.thread_json(&thread)["codexMode"], "workspace-write", "채팅 파일에 Codex 모드가 선다");
    let session = sandbox.thread_session_id(&thread);
    assert_eq!(sandbox.acp_modes(&session), ["workspace-write"], "codex-acp의 기본 `agent`를 쓰지 않는다");
    let set = first_at(&record, "config");
    assert_eq!(record[set]["payload"], json!({"mode": "workspace-write"}), "넣은 모드가 기록에 남는다");
    assert!(first_at(&record, "session") < set && set < first_at(&record, "sent"), "모드를 맞춘 뒤에 첫 말이 간다:\n{}", common::lines_text(&record));
}

#[test]
fn 떠_있는_codex_채팅에서_모드를_바꾸면_다시_띄우지_않고_그_세션에_넣고_채팅_파일에_남긴다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[]));
    let thread = host
        .start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex())
        .expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);

    let changed = host.set_thread_codex_mode(&thread, "read-only").expect("Codex 모드 바꾸기");
    assert_eq!(changed.codex_mode.as_deref(), Some("read-only"), "답은 바뀐 채팅의 값이다");
    host.send_to_thread(&thread, "Run the shell command `echo atelier` and tell me what it printed. Do nothing else.").expect("이어 말하기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread);
    assert_eq!(sandbox.acp_modes(&session), ["workspace-write", "read-only"], "떠 있는 세션에 곧바로 넣는다");
    assert_eq!(sandbox.acp_launches().len(), 1, "다시 띄우지 않는다");
    assert_eq!(sandbox.thread_json(&thread)["codexMode"], "read-only");
    assert_eq!(common::payloads_of(&record, "config"), [json!({"mode": "workspace-write"}), json!({"mode": "read-only"})]);
}

#[test]
fn 고른_codex_모드는_다시_켠_앱이_재개한_세션에_넣고_칩이_읽는_채팅의_값으로_남는다() {
    let sandbox = Sandbox::new();
    let (thread, _) = yesterday(&sandbox);
    let session = sandbox.thread_session_id(&thread);

    // 다시 켠 앱 — Session이 떠 있지 않을 때 고른 모드는 채팅 파일에만 서고, 다음에 열 때 든다.
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/resume", &[]));
    host.set_thread_codex_mode(&thread, "read-only").expect("떠 있지 않은 채팅의 Codex 모드 바꾸기");
    assert_eq!(sandbox.acp_modes(&session), ["workspace-write"], "떠 있지 않은 세션에는 넣을 곳이 없다");
    host.send_to_thread(&thread, "What word did I ask you to remember? Reply with that one word.").expect("말을 보내면 띄워 되살린다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    let view = host.thread(&thread).expect("채팅의 지금");
    host.shut_down();

    assert_eq!(common::opened_hows(&record), ["new", "resumed"]);
    assert_eq!(sandbox.acp_modes(&session), ["workspace-write", "read-only"], "재개하면 모드가 풀리므로 고른 모드를 다시 넣는다");
    let reopened = record.iter().rposition(|line| line["payload"]["state"] == "opened").expect("재개의 열림 줄");
    let set = reopened + record[reopened..].iter().position(|line| line["kind"] == "config").expect("재개 뒤의 config 줄");
    assert_eq!(record[set]["payload"], json!({"mode": "read-only"}));
    assert!(set < record.iter().rposition(|line| line["kind"] == "sent").unwrap(), "모드를 맞춘 뒤에 말이 간다");
    assert_eq!(answer_of(&record, 2), "lantern");
    assert_eq!(view.file.codex_mode.as_deref(), Some("read-only"), "칩은 Codex의 `currentModeId`가 아니라 이 값을 그린다");
}

#[test]
fn 재개_뒤_codex가_모드를_받지_않으면_턴을_시작하지_않고_말을_보내지_않은_채_까닭을_돌려준다() {
    let sandbox = Sandbox::new();
    let (thread, _) = yesterday(&sandbox);
    let session = sandbox.thread_session_id(&thread);
    let before = sandbox.thread_record(&thread).len();

    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/resume", &[("FAKE_ACP_REFUSES_MODE", "1")]));
    let sent = host.send_to_thread(&thread, "What word did I ask you to remember? Reply with that one word.");
    let live = host.thread(&thread).expect("채팅의 지금").live;
    host.shut_down();

    // 화면은 거절된 말을 입력창에 돌려놓고 이 글을 보인다(`ThreadComposer`의 `onSend` 거절).
    let Err(HostError::Open { reason, .. }) = sent else { panic!("모드를 맞추지 못하면 보내기가 거절된다: {sent:?}") };
    assert!(reason.contains("모드 바꾸기(workspace-write)") && reason.contains("턴을 시작하지 않았어요"), "{reason}");
    assert_eq!(sandbox.acp_modes(&session), ["workspace-write", "workspace-write"], "재개한 세션에 모드를 넣으려 했다");
    assert_eq!(sandbox.acp_prompts(&session).len(), 1, "Codex는 어제의 말 하나만 받았다 — 모드가 풀린 채 턴이 돌지 않는다");
    let record = sandbox.thread_record(&thread);
    let today = &record[before..];
    assert!(of_kind(today, "sent").is_empty(), "말이 기록에 서지 않는다:\n{}", common::lines_text(today));
    assert_eq!(today.last().unwrap()["payload"], json!({"state": "died", "reason": reason}), "까닭이 흐름에 남는다");
    assert!(!live, "모드가 풀린 Session은 띄워 두지 않는다 — 다음 말이 다시 띄운다");
}

#[test]
fn 새_codex_채팅의_첫_말도_모드를_맞추지_못하면_codex에_가지_않는다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[("FAKE_ACP_REFUSES_MODE", "1")]));

    let started = host.start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex());
    host.shut_down();

    assert!(matches!(started, Err(HostError::Open { .. })), "{started:?}");
    let launched = sandbox.acp_launches();
    assert_eq!(launched.len(), 1);
    // 모드를 받지 않은 세션은 채팅의 세션으로 적지 않는다 — 다음 말은 새 세션을 연다. 가짜의 세션 id는 `fake-<pid>`다.
    let session = format!("fake-{}", launched[0]["pid"]);
    let thread = host.list_threads().expect("목록")[0].id.clone();
    assert!(sandbox.thread_json(&thread).get("sessionId").is_none_or(Value::is_null), "{}", sandbox.thread_json(&thread));
    assert_eq!(sandbox.acp_modes(&session), ["workspace-write"]);
    assert!(sandbox.acp_prompts(&session).is_empty(), "첫 말이 Codex에 가지 않는다");
    assert!(of_kind(&sandbox.thread_record(&thread), "sent").is_empty());
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
    // 줄(`auth-status`)은 codex-acp만 보내는 ACP 알림을 Host가 이미 적던 세션 줄이다. 열 때 넣은 Codex 모드의 `config` 줄(01c-5)은 Claude 채팅이
    // 「계획」을 들고 날 때 떠 있는 Session에 넣은 모드를 적던 줄과 같은 꼴이다 — 이 축복 자료에는 그 바꾸기가 없어 따로 든다.
    let mut claude = shapes(&common::record_at(&common::records_dir().join("thread-two-turns.jsonl")));
    claude.push(("config".to_owned(), vec!["mode".to_owned()]));
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

// ── 추가 폴더(restart 01c-6) ─────────────────────────────────────────────────────────
//
// Codex는 `additionalDirectories`를 쓸 수 있는 자리로 받는다(실측 「worktree와 git」). 그래서 고칠 수 있는 자리만 넘긴다 — spec 폴더와
// worktree마다의 git 자리 넷. 읽는 범위는 넘기지 않는다(읽기에는 필요 없다).

#[test]
fn 작업공간_없는_codex_채팅은_읽는_범위의_project도_채팅_폴더도_추가_폴더로_넘기지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.register_project("api");
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[]));

    let thread = host
        .start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex())
        .expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let opened = &sandbox.acp_receipt(&sandbox.thread_session_id(&thread))["sessionNew"];
    assert!(opened.get("additionalDirectories").is_none(), "읽는 범위는 쓸 수 있는 자리가 되므로 넘기지 않는다: {opened}");
    assert_eq!(sandbox.thread_json(&thread)["additionalDirectories"], json!([]), "thread.json도 넘긴 값을 적는다");
}

/// 등록한 Project들로 작업공간을 세운다 — `start_work`가 진짜 git worktree를 `trees/<project>`에 만든다. 브랜치는 slug다.
fn work_with_trees(sandbox: &Sandbox, slug: &str, projects: &[&str]) {
    let root = sandbox.data_root();
    let projects: Vec<String> = projects.iter().map(|one| (*one).to_owned()).collect();
    let report = atelier_core::start_work(
        &atelier_core::works_in(&root),
        &atelier_core::archive_in(&root),
        &atelier_core::projects_in(&root),
        &format!("{slug} 제목"),
        Some(slug),
        &projects,
        None,
    )
    .expect("작업공간");
    assert!(report.errors.is_empty(), "{:?}", report.errors);
}

/// 그 Project 저장소에서 worktree 이름이 `name`인 git 자리 넷 — 실측 「worktree와 git」의 넷이다.
fn git_places(repo: &Path, name: &str) -> Vec<PathBuf> {
    let git = repo.join(".git");
    vec![git.join("worktrees").join(name), git.join("objects"), git.join("refs"), git.join("logs")]
}

/// 경로 목록을 실제 자리로 — macOS의 임시 폴더는 `/var`와 `/private/var` 두 이름이 있다.
fn real_dirs(value: &Value) -> Vec<PathBuf> {
    value.as_array().unwrap_or_else(|| panic!("경로 목록이 아니다: {value}")).iter().map(|dir| real(dir.as_str().expect("경로"))).collect()
}

fn real(path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    path.canonicalize().unwrap_or_else(|_| panic!("없다: {}", path.display()))
}

#[test]
fn 작업공간에_이은_codex_채팅의_추가_폴더는_spec_폴더와_worktree의_git_자리_넷이고_읽는_범위는_들지_않으며_말마다_다시_열지_않는다() {
    let sandbox = Sandbox::new();
    let api = sandbox.register_project("api");
    sandbox.register_project("web");
    work_with_trees(&sandbox, "cart", &["api"]);
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[]));

    let link = ThreadLink::Work { slug: "cart".into() };
    let thread = host.start_thread_picking("Reply with exactly one word: ok", &[], link, codex()).expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread(&thread, "Run the shell command `echo atelier` and tell me what it printed. Do nothing else.").expect("이어 말하기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    let opened = &sandbox.acp_receipt(&sandbox.thread_session_id(&thread))["sessionNew"];
    let tree = sandbox.work_dir("cart").join("trees/api");
    assert_eq!(real(opened["cwd"].as_str().expect("cwd")), real(&tree), "worktree 하나면 그 worktree에서 일한다");
    let mut expected = vec![real(sandbox.work_dir("cart").join("spec"))];
    expected.extend(git_places(&api, "api").iter().map(real));
    assert_eq!(real_dirs(&opened["additionalDirectories"]), expected, "읽는 범위의 web은 들지 않는다: {opened}");
    assert_eq!(real_dirs(&sandbox.thread_json(&thread)["additionalDirectories"]), expected, "thread.json도 넘긴 값을 적는다");

    assert!(sandbox.acp_revivals().is_empty(), "자리가 그대로이니 다음 말에 다시 열지 않는다: {:?}", sandbox.acp_revivals());
    assert_eq!(common::opened_hows(&record), ["new"]);
}

#[test]
fn 같은_project를_쓰는_둘째_작업공간의_git_자리는_폴더_이름이_아니라_포인터_파일에서_읽는다() {
    let sandbox = Sandbox::new();
    let api = sandbox.register_project("api");
    work_with_trees(&sandbox, "cart", &["api"]);
    work_with_trees(&sandbox, "shop", &["api"]);
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[]));

    let link = ThreadLink::Work { slug: "shop".into() };
    let thread = host.start_thread_picking("Reply with exactly one word: ok", &[], link, codex()).expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let opened = &sandbox.acp_receipt(&sandbox.thread_session_id(&thread))["sessionNew"];
    assert_eq!(real(opened["cwd"].as_str().expect("cwd")), real(sandbox.work_dir("shop").join("trees/api")), "둘째도 폴더 이름은 api다");
    let mut expected = vec![real(sandbox.work_dir("shop").join("spec"))];
    expected.extend(git_places(&api, "api1").iter().map(real));
    assert_eq!(real_dirs(&opened["additionalDirectories"]), expected, "git은 둘째 worktree의 자리를 api1로 지었다: {opened}");
}

#[test]
fn spec_폴더에서_연_codex_채팅은_worktree가_서면_다음_말에_worktree를_cwd로_spec과_git_자리를_추가_폴더로_재개한다() {
    let sandbox = Sandbox::new();
    let api = sandbox.register_project("api");
    let root = sandbox.data_root();
    let (works, projects) = (atelier_core::works_in(&root), atelier_core::projects_in(&root));
    let api_slug = vec!["api".to_owned()];
    atelier_core::start_work_deferred(&works, &atelier_core::archive_in(&root), &projects, "cart 제목", Some("cart"), &api_slug, None)
        .expect("worktree 없는 작업공간");
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/resume", &[]));

    let link = ThreadLink::Work { slug: "cart".into() };
    let first = "Remember the word lantern. Reply with exactly one word: ok";
    let thread = host.start_thread_picking(first, &[], link, codex()).expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let spec = sandbox.work_dir("cart").join("spec");
    let opened = &sandbox.acp_receipt(&sandbox.thread_session_id(&thread))["sessionNew"];
    assert_eq!(real(opened["cwd"].as_str().expect("cwd")), real(&spec), "worktree가 없으면 spec 폴더에서 연다");
    assert!(opened.get("additionalDirectories").is_none(), "읽기만인 api는 넘기지 않는다: {opened}");

    let report = atelier_core::attach_project(&works, &projects, "cart", "api", None).expect("api를 고치기 시작");
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    host.send_to_thread(&thread, "What word did I ask you to remember? Reply with that one word.").expect("이어 말하기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();

    let revivals = sandbox.acp_revivals();
    assert_eq!(revivals.len(), 1, "{revivals:?}");
    assert_eq!((&revivals[0]["method"], &revivals[0]["ok"]), (&json!("session/resume"), &json!(true)));
    let params = &revivals[0]["params"];
    let tree = sandbox.work_dir("cart").join("trees/api");
    assert_eq!(real(params["cwd"].as_str().expect("cwd")), real(&tree), "바뀐 작업 폴더로 재개한다: {params}");
    let mut expected = vec![real(&spec)];
    expected.extend(git_places(&api, "api").iter().map(real));
    assert_eq!(real_dirs(&params["additionalDirectories"]), expected, "재개에도 spec 폴더와 git 자리를 준다: {params}");
    assert_eq!(common::opened_hows(&record), ["new", "resumed"]);
    assert_eq!(real(sandbox.thread_json(&thread)["cwd"].as_str().expect("cwd")), real(&tree), "thread.json에 바뀐 작업 폴더를 적는다");
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

// ── 모델 · 생각 깊이(restart 01c-5 · 스토리 34) ───────────────────────────────────────────
//
// Codex의 모델과 생각 깊이는 `configOptions`의 `model` · `reasoning_effort`다 — claude `--model` · `--effort`가 아니다. 칩이 채팅의 값을 그리므로
// 그 값은 Session을 열 때마다 넣는다.

/// 그 세션이 받은 모드 · 설정 바꾸기를 `(메서드, 칸, 값)`으로.
fn settings_of(sandbox: &Sandbox, session: &str) -> Vec<(String, String, String)> {
    let text = |value: &Value| value.as_str().unwrap_or_default().to_owned();
    sandbox
        .acp_settings(session)
        .iter()
        .map(|setting| match setting["method"].as_str() {
            Some("session/set_mode") => (text(&setting["method"]), "mode".to_owned(), text(&setting["params"]["modeId"])),
            _ => (text(&setting["method"]), text(&setting["params"]["configId"]), text(&setting["params"]["value"])),
        })
        .collect()
}

#[test]
fn codex_채팅의_모델과_생각_깊이는_codex의_설정으로_넣고_다시_열_때도_넣는다() {
    let sandbox = Sandbox::new();
    let (thread, _) = yesterday(&sandbox);
    let session = sandbox.thread_session_id(&thread);

    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/resume", &[]));
    host.set_thread_model(&thread, "gpt-6-astra").expect("떠 있지 않은 채팅의 모델");
    host.set_thread_effort(&thread, "ultra").expect("Codex가 보낸 생각 깊이 — claude `--effort`에는 없는 값이다");
    host.send_to_thread(&thread, "What word did I ask you to remember? Reply with that one word.").expect("보내기");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.set_thread_effort(&thread, "low").expect("떠 있는 채팅의 생각 깊이");
    host.shut_down();

    let set = |method: &str, field: &str, value: &str| (method.to_owned(), field.to_owned(), value.to_owned());
    assert_eq!(
        settings_of(&sandbox, &session),
        [
            set("session/set_mode", "mode", "workspace-write"),
            set("session/set_mode", "mode", "workspace-write"),
            set("session/set_config_option", "model", "gpt-6-astra"),
            set("session/set_config_option", "reasoning_effort", "ultra"),
            set("session/set_config_option", "reasoning_effort", "low"),
        ],
        "어제 연 세션 · 재개한 세션에 채팅의 값을 넣고, 떠 있는 세션에는 바꾼 것을 곧바로 넣는다"
    );
    assert_eq!(sandbox.acp_launches().len(), 2, "생각 깊이를 바꾸려고 다시 띄우지 않는다");
    let file = sandbox.thread_json(&thread);
    assert_eq!((&file["model"], &file["effort"]), (&json!("gpt-6-astra"), &json!("low")));
}

// ── 작업공간이 함께 쓰는 물어보는 정도(restart 01c-5 · 스토리 27) ─────────────────────────────
//
// 물어보는 정도는 작업공간의 채팅이 함께 쓰는 Claude의 값이다. Codex 채팅은 그 값을 보내지도 바꾸지도 받지도 않는다 — Codex 모드는 채팅마다 따로다.

/// 작업공간 `cart`의 물어보는 정도.
fn cart_level(sandbox: &Sandbox) -> Value {
    let dot = sandbox.work_dir("cart").join(".policy.json");
    std::fs::read_to_string(dot).map_or(Value::Null, |text| serde_json::from_str::<Value>(&text).unwrap()["mode"].clone())
}

#[test]
fn codex_채팅은_첫_말과_함께_고른_정도도_칩의_바꾸기도_작업공간의_정도로_보내지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    atelier_core::update_policy(&sandbox.data_root(), atelier_core::PolicyPlace::Work("cart"), |policy| policy.mode = Some("always".into()))
        .expect("작업공간의 정도");
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/edit", &[]));

    let picks = StartPicks { mode: Some(AskLevel::Auto), ..codex() };
    let first = "Use apply_patch to create a file named hello.txt in the current folder containing exactly `hi`. Do nothing else.";
    let thread = host.start_thread_picking(first, &[], ThreadLink::Work { slug: "cart".into() }, picks).expect("Codex 채팅의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    assert_eq!(cart_level(&sandbox), "always", "첫 말과 함께 온 정도가 작업공간의 값을 바꾸지 않는다");
    assert!(of_kind(&record, "mode").is_empty(), "「Policy를 … 바꿈」 줄이 서지 않는다");

    let refused = host.set_thread_mode(&thread, AskLevel::Plan);
    host.shut_down();
    assert!(matches!(refused, Err(HostError::Setting(_))), "Codex 채팅의 칩은 물어보는 정도를 바꾸지 않는다: {refused:?}");
    assert_eq!(cart_level(&sandbox), "always");
    assert!(of_kind(&sandbox.thread_record(&thread), "mode").is_empty());
    assert_eq!(thread_level(&sandbox, &thread), Value::Null, "채팅 파일에도 정도를 적지 않는다");
}

/// 그 채팅 파일의 물어보는 정도 칸 — 작업공간 없는 채팅의 값이다.
fn thread_level(sandbox: &Sandbox, thread: &str) -> Value {
    sandbox.thread_json(thread)["mode"].clone()
}

#[test]
fn 같은_작업공간의_claude_채팅이_계획으로_들고_나도_codex_세션에는_claude의_모드가_가지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // Claude 채팅의 변환기 자리에도 같은 가짜를 둔다 — 두 채팅이 받은 모드 바꾸기를 같은 영수증으로 읽는다.
    let shell = sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[("FAKE_ACP_VERSION", env!("CARGO_PKG_VERSION"))]);
    let agent = atelier_acp::TranslatorCommand::new(env!("CARGO_BIN_EXE_fake-acp-agent"), Vec::<String>::new());
    let host = sandbox.host_builder_with_translator(shell, agent, |_| {}).build();
    let in_cart = || ThreadLink::Work { slug: "cart".into() };

    let claude = host
        .start_thread_picking("Reply with exactly one word: ok", &[], in_cart(), StartPicks::default())
        .expect("Claude 채팅");
    sandbox.wait_thread_kind(&claude, "turn-end", 1);
    let codex_chat = host.start_thread_picking("Reply with exactly one word: ok", &[], in_cart(), codex()).expect("Codex 채팅");
    sandbox.wait_thread_kind(&codex_chat, "turn-end", 1);

    host.set_thread_mode(&claude, AskLevel::Plan).expect("작업공간을 계획으로");
    host.set_thread_mode(&claude, AskLevel::Always).expect("계획에서 나감");
    host.shut_down();

    assert_eq!(sandbox.acp_modes(&sandbox.thread_session_id(&claude)), ["plan", "default"], "Claude 채팅의 Session은 따른다");
    assert_eq!(sandbox.acp_modes(&sandbox.thread_session_id(&codex_chat)), ["workspace-write"], "Codex 세션은 제 모드 그대로다");
    assert!(of_kind(&sandbox.thread_record(&codex_chat), "config").len() == 1, "Codex 채팅에 Claude의 모드 줄이 서지 않는다");
}

// ── 앱 기능 도구(01c-7) ──────────────────────────────────────────────────────────────
//
// 녹음 `mcp`는 앱 서버(`atelier-thread`)의 `rename_thread`를 「환불 API 버그」로 부른 턴이다 — 도구 줄 → 제목도 입력도 없는 MCP 승인 요청 → 답 →
// 도구 줄의 끝. `FAKE_ACP_MCP_CALL`이 그 부르기의 서버 · 도구 · 인자를 바꿔 낸다(가짜 ACP의 머리말).

/// 녹음 `mcp`를 재생하는 Codex 채팅의 첫 말 — `call`이 있으면 녹음의 MCP 부르기를 그것으로 바꾼다.
fn mcp_thread(sandbox: &Sandbox, call: Option<Value>, link: ThreadLink) -> (ConversationHost, String) {
    let call = call.map(|call| call.to_string());
    let extra: Vec<(&str, &str)> = call.iter().map(|call| ("FAKE_ACP_MCP_CALL", call.as_str())).collect();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/mcp", &extra));
    let thread = host.start_thread_picking("환불이 두 번 빠져요", &[], link, codex()).expect("Codex 채팅의 첫 말");
    (host, thread)
}

#[test]
fn codex의_앱_서버_도구는_카드_없이_허용되어_앱_기능_도구를_지나고_도구_줄을_한도까지_기다리지_않는다() {
    let sandbox = Sandbox::new();
    let started = Instant::now();
    let (host, thread) = mcp_thread(&sandbox, None, ThreadLink::NoWork);
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let took = started.elapsed();
    host.shut_down();

    let judged = of_kind(&record, "permission");
    assert_eq!(judged.len(), 1, "카드가 서지 않는다:\n{}", common::lines_text(&record));
    let payload = &judged[0]["payload"];
    assert_eq!(
        (&payload["state"], &payload["optionId"], &payload["reason"]),
        (&json!("decided"), &json!("allow_once"), &json!("앱 기능 도구")),
        "앞선 도구 줄의 서버가 앱 서버라 「한 번만 허용」으로 닫는다: {payload}"
    );
    assert_eq!(payload["toolCall"]["rawInput"]["server"], "atelier-thread", "판정이 읽은 것은 같은 id로 앞서 온 도구 줄의 서버다: {payload}");
    assert_eq!(sandbox.thread_json(&thread)["title"], "환불 API 버그", "녹음의 인자로 앱 기능 도구를 지났다");
    let called = sandbox.acp_mcp(&sandbox.thread_session_id(&thread));
    assert_eq!((called.len(), &called[0]["tool"]), (1, &json!("rename_thread")), "{called:?}");
    // 도구 줄 대기(`tool_lines.rs`)가 `mcp.<서버>.<도구>` 제목을 읽지 못하면 부르기마다 5초를 기다린다(01c-1의 실측).
    assert!(took < Duration::from_secs(5), "앱 기능 도구 줄에서 한도(5초)를 기다리지 않는다: {took:?}");
}

#[test]
fn codex의_다른_서버_mcp_도구는_앱이_허용하지_않고_카드가_선다() {
    let sandbox = Sandbox::new();
    let (host, thread) = mcp_thread(&sandbox, Some(json!({"server": "github"})), ThreadLink::NoWork);
    let asked = first_permission(&sandbox, &thread);
    let payload = asked["payload"].clone();
    host.answer_thread_permission(&thread, payload["requestId"].as_str().expect("요청 id"), "allow_once").expect("한 번만 허용");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert_eq!(
        (&payload["state"], &payload["card"], &payload["policy"]),
        (&json!("asked"), &json!("command"), &json!("")),
        "앱 서버가 아니면 묻는다 — `_meta.is_mcp_tool_approval`은 같아도: {payload}"
    );
    assert_eq!(payload["toolCall"]["title"], "mcp.github.rename_thread", "{payload}");
    let kinds: Vec<&str> = payload["request"]["options"].as_array().unwrap().iter().filter_map(|option| option["kind"].as_str()).collect();
    assert_eq!(kinds, ["allow_once", "allow_always", "allow_always", "reject_once"], "선택지는 Codex가 보낸 그대로다");
    assert_ne!(sandbox.thread_json(&thread)["title"], "환불 API 버그", "앱 기능 도구를 지나지 않았다");
}

#[test]
fn 작업공간의_정도가_묻지_않음이어도_codex_채팅의_service_붙이기는_묻지_않고_넣지_않고_카드로_묻는다() {
    // Claude 채팅이라면 「묻지 않음」 · 지금 Service 없음 · 맞는 Service가 넘긴 것 하나뿐이라 묻지 않고 넣는다(`thread_service_host.rs`).
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    atelier_core::update_policy(&sandbox.data_root(), atelier_core::PolicyPlace::Work("cart"), |policy| policy.mode = Some("auto".into()))
        .expect("작업공간의 정도");
    let services = atelier_core::services_in(&sandbox.data_root());
    std::fs::create_dir_all(&services).unwrap();
    std::fs::write(services.join("결제-서비스.md"), "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\n---\n").unwrap();
    let call = json!({"tool": "set_service", "arguments": {"service": "결제-서비스", "projects": [], "reason": "환불은 결제 서비스 쪽 일이에요"}});
    let (host, thread) = mcp_thread(&sandbox, Some(call), ThreadLink::Work { slug: "cart".into() });

    let card = |record: &[Value]| {
        of_kind(record, "question").into_iter().find(|line| line["payload"]["card"] == "service" && line["payload"]["state"] == "asked").cloned()
    };
    let asked = card(&sandbox.wait_thread_record(&thread, |record| card(record).is_some())).expect("Service 카드");
    let request = asked["payload"]["requestId"].as_str().expect("요청 id");
    host.answer_service(&thread, request, ServiceChoice::Later).expect("나중에");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert!(of_kind(&record, "service").is_empty(), "묻지 않고 넣은 Service 줄이 없다:\n{}", common::lines_text(&record));
    let work: Value = serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("cart").join("work.json")).unwrap()).unwrap();
    assert!(work.get("service").is_none(), "작업공간의 Service가 그대로다: {work}");
}

// ── 앱이 거절한 턴(01c-7) ──────────────────────────────────────────────────────────────
//
// codex-acp는 앱의 거절도 거부 선택지(`reject_once`)로만 받아 턴을 `cancelled`로 끝내고, 답의 `_meta.atelier`를 읽지 않아 까닭이 Codex에 닿지
// 않는다. 그래서 Host가 그 턴의 끝 줄에 까닭을 단다 — 사람이 거부한 턴과 갈린다.

/// 녹음 `edit`의 둘째 말 — 작업공간 밖(녹음한 자리의 `outside/`) 파일을 편집한다. 녹음에서는 사람이 거부했다.
const OUTSIDE_EDIT: &str = "Use apply_patch to create the file /Users/USER/.atelier/works/atelier-restart/spec/구현-노트/녹음-codex-2.2.2/outside/edit.txt \
                            containing exactly `hi`. Do not use shell commands. Do nothing else.";

/// 기록 축복 — 작업공간에 이은 Codex 채팅이 작업 폴더 안에 묻지 않고 쓴 턴 뒤, 작업공간 밖 파일을 편집하려다 앱이 거절해 멈춘 턴(녹음 `edit`의
/// 두 턴). 화면의 L2가 이 기록으로 「앱이 막아서 멈췄어요」와 「앱이 막음」 안내를 본다.
#[test]
fn 작업공간_밖_편집은_앱이_묻지_않고_거절하고_그_턴은_까닭을_단_끝_줄로_끝나며_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/edit", &[]));
    let first = "Use apply_patch to create a file named hello.txt in the current folder containing exactly `hi`. Do nothing else.";
    let thread =
        host.start_thread_picking(first, &[], ThreadLink::Work { slug: "cart".into() }, codex()).expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread(&thread, OUTSIDE_EDIT).expect("둘째 말");
    // 거부된 도구의 끝 줄(`failed`)은 턴의 답 뒤에 온다(01c-1의 실측) — 그 줄까지 기다린다.
    let late = |line: &Value| line["payload"]["update"]["status"] == "failed";
    let record = sandbox.wait_thread_record(&thread, |record| record.iter().any(late));
    host.shut_down();

    let outside = "/Users/USER/.atelier/works/atelier-restart/spec/구현-노트/녹음-codex-2.2.2/outside/edit.txt";
    let reason = format!("작업공간 밖의 파일이라 고칠 수 없어요: {outside} — 이 작업공간의 worktree · spec 폴더 안에서만 고쳐요");
    let judged: Vec<&Value> = of_kind(&record, "permission").into_iter().map(|line| &line["payload"]).collect();
    assert_eq!(judged.len(), 1, "카드가 서지 않는다:\n{}", common::lines_text(&record));
    assert_eq!(
        (&judged[0]["state"], &judged[0]["optionId"], &judged[0]["reason"]),
        (&json!("decided"), &json!("cancel"), &json!(reason)),
        "`kind: edit`로 온 밖 편집은 거부 선택지로 닫는다"
    );
    let ends: Vec<&Value> = of_kind(&record, "turn-end").into_iter().map(|line| &line["payload"]).collect();
    assert_eq!(ends.len(), 2);
    assert!(ends[0].get("appRefusal").is_none(), "앱이 거절하지 않은 턴: {}", ends[0]);
    assert_eq!(
        (&ends[1]["stopReason"], &ends[1]["cancelledByUs"], &ends[1]["appRefusal"]),
        (&json!("cancelled"), &json!(false), &json!(reason)),
        "앱이 거절해 멈춘 턴은 그 까닭을 단다"
    );
    let ended_at = record.iter().position(|line| line["kind"] == "turn-end" && line["payload"]["appRefusal"].is_string()).unwrap();
    assert!(record[ended_at + 1..].iter().any(late), "늦게 온 도구의 끝은 턴 끝 뒤의 update 줄로 선다:\n{}", common::lines_text(&record));

    let session = sandbox.thread_session_id(&thread);
    let settled = common::commands_after_each_opened(&record);
    common::assert_record("thread-codex-refused", &common::fix_thread_record(&settled, &sandbox.data_root(), &thread, &[&session]));
}

#[test]
fn 사람이_거부한_codex_턴은_앱이_거절한_까닭_없이_끝난다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.login_shell_for_login("deny-cancels", common::NO_BROWSER, &[]));
    let thread = host.start_thread_picking("고쳐 줘", &[], ThreadLink::NoWork, codex()).expect("Codex 채팅의 첫 말");
    let asked = first_permission(&sandbox, &thread);
    assert_eq!(asked["payload"]["state"], "asked", "{asked}");
    host.answer_thread_permission(&thread, asked["payload"]["requestId"].as_str().expect("요청 id"), "cancel").expect("거부");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let end = &of_kind(&record, "turn-end")[0]["payload"];
    assert_eq!((&end["stopReason"], &end["cancelledByUs"]), (&json!("cancelled"), &json!(false)), "{end}");
    assert!(end.get("appRefusal").is_none(), "사람의 거부에는 앱의 까닭이 없다: {end}");
}

// ── `start_editing`(01c-8) ───────────────────────────────────────────────────────────
//
// Codex의 쓸 수 있는 자리는 세션을 열 때 정해진다 — 이번 턴에 만든 worktree는 그 밖이다. 그래서 Codex 채팅의 설명과 결과는 「이번 턴을 마치면 다음
// 턴부터 worktree에서 고친다」다. Claude 채팅의 말(「이번 턴에는 돌려받은 worktree 안을 절대 경로로 고친다」)은 `thread_project.rs`가 잰다.

/// 그 도구 목록에서 그 도구의 설명.
fn guide_of(tools: &Value, tool: &str) -> String {
    let found = tools.as_array().expect("도구 목록").iter().find(|one| one["name"] == tool).expect("그 도구");
    found["description"].as_str().expect("설명").to_owned()
}

#[test]
fn codex_채팅의_start_editing은_이번_턴을_마치면_다음_턴부터_worktree에서_고친다고_말한다() {
    let sandbox = Sandbox::new();
    sandbox.register_project("api");
    let root = sandbox.data_root();
    let (works, archive, projects) = (atelier_core::works_in(&root), atelier_core::archive_in(&root), atelier_core::projects_in(&root));
    atelier_core::start_work_deferred(&works, &archive, &projects, "카트", Some("cart"), &["api".to_owned()], Some("fix/cart"))
        .expect("worktree 없는 작업공간");
    let call = json!({"tool": "start_editing", "arguments": {"project": "api"}});
    let (host, thread) = mcp_thread(&sandbox, Some(call), ThreadLink::Work { slug: "cart".into() });
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let called = sandbox.acp_mcp(&sandbox.thread_session_id(&thread));
    let guide = guide_of(&called[0]["tools"], "start_editing");
    assert!(guide.contains("이번 턴을 마치면 다음 턴부터"), "{guide}");
    assert!(!guide.contains("이번 턴에는 돌려받은 worktree 안을 절대 경로로 고친다"), "Codex에는 틀린 말이다: {guide}");
    let said = called[0]["call"]["content"][0]["text"].as_str().unwrap();
    assert!(said.starts_with("`api`에 worktree를 만들었다"), "{said}");
    assert!(said.contains("이번 턴을 마치면 다음 턴부터"), "{said}");
    assert!(!said.contains("이번 턴에는 이 절대 경로로 고친다"), "Codex에는 틀린 말이다: {said}");
}

#[test]
fn codex_채팅이_연_작업_폴더의_worktree면_start_editing은_이번_턴에도_고친다고_말한다() {
    let sandbox = Sandbox::new();
    sandbox.register_project("api");
    work_with_trees(&sandbox, "cart", &["api"]);
    let call = json!({"tool": "start_editing", "arguments": {"project": "api"}});
    let (host, thread) = mcp_thread(&sandbox, Some(call), ThreadLink::Work { slug: "cart".into() });
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let said = tool_results(&sandbox, &thread)[0]["content"][0]["text"].as_str().unwrap().to_owned();
    assert!(said.starts_with("`api` worktree가 이미 있다"), "{said}");
    assert!(said.contains("이번 턴에도 이 자리에서 고친다"), "세션을 연 작업 폴더라 쓸 수 있는 자리다: {said}");
}

#[test]
fn codex_채팅에서_읽기만_하기를_고르면_다음_턴을_기다리거나_읽을_때_묻는다고_말하지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.register_project("api");
    sandbox.register_project("web");
    work_with_trees(&sandbox, "cart", &["api"]);
    let call = json!({"tool": "start_editing", "arguments": {"project": "web"}});
    let (host, thread) = mcp_thread(&sandbox, Some(call), ThreadLink::Work { slug: "cart".into() });
    let asked = sandbox.wait_thread_record(&thread, |record| !card_lines(record, "project", "asked").is_empty());
    let request = card_lines(&asked, "project", "asked")[0]["payload"]["requestId"].as_str().unwrap().to_owned();
    host.answer_project(&thread, &request, ProjectChoice::ReadOnly).expect("읽기만 하기");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let said = tool_results(&sandbox, &thread)[0]["content"][0]["text"].as_str().unwrap().to_owned();
    assert!(said.starts_with("사람이 `web`을 읽기만 하기로 했다"), "{said}");
    assert!(!said.contains("다음 턴부터") && !said.contains("사람에게 묻는다"), "Codex에는 그 폴더를 넘기지 않고 읽을 때 묻지 않는다: {said}");
}

// ── 사람을 기다리는 카드의 한도(01c-8) ─────────────────────────────────────────────────
//
// Codex는 MCP 도구를 300초에서 끊는다. Codex 채팅에서 카드로 사람을 기다리는 앱 기능 도구는 그 전에 카드를 닫고 사람이 답하지 않았다는 결과를
// 돌려준다. 앱의 한도는 280초이고, 시험은 짧은 한도로 잰다.

/// 시험의 카드 한도.
const CARD_LIMIT: Duration = Duration::from_millis(300);

/// 녹음 `mcp`의 부르기를 `call`로 바꿔 재생하는 Codex 채팅의 첫 말 — 카드 한도가 `limit`인 호스트다.
fn waiting_thread(sandbox: &Sandbox, call: Value, link: ThreadLink, limit: Duration) -> (ConversationHost, String) {
    let call = call.to_string();
    let shell = sandbox.codex_login_shell("codex-acp-2.2.2/mcp", &[("FAKE_ACP_MCP_CALL", &call)]);
    let host = sandbox.host_builder(shell, |_| {}).card_limit(limit).build();
    let thread = host.start_thread_picking("환불이 두 번 빠져요", &[], link, codex()).expect("Codex 채팅의 첫 말");
    (host, thread)
}

/// Host가 내미는 Work 만들기 제안 — Project 없이 기획만이다.
fn plan_proposal() -> Value {
    json!({"tool": "propose_work", "arguments": {"title": "환불 API 버그 수정", "slug": "refund-api", "reason": "여러 파일을 고쳐요"}})
}

/// 그 카드 갈래의 그 상태 줄들.
fn card_lines<'a>(record: &'a [Value], card: &str, state: &str) -> Vec<&'a Value> {
    of_kind(record, "question").into_iter().filter(|line| line["payload"]["card"] == card && line["payload"]["state"] == state).collect()
}

/// 그 채팅의 Codex가 부른 앱 기능 도구의 결과 — 부른 차례대로.
fn tool_results(sandbox: &Sandbox, thread: &str) -> Vec<Value> {
    sandbox.acp_mcp(&sandbox.thread_session_id(thread)).into_iter().map(|call| call["call"].clone()).collect()
}

/// 기록 축복 — 작업공간 제안 카드가 한도에 닫힌 Codex 턴(녹음 `mcp`의 부르기를 `propose_work`로 바꿨다). 화면의 L2가 이 기록으로 카드가 걷힌
/// 자리의 결정 줄 「답이 없어 닫음 · Codex는 5분까지만 기다려요」를 본다.
#[test]
fn codex_채팅의_작업공간_제안_카드는_한도에_닫히고_사람이_답하지_않았으니_다시_묻지_말라는_결과를_돌려준다() {
    let sandbox = Sandbox::new();
    let (host, thread) = waiting_thread(&sandbox, plan_proposal(), ThreadLink::NoWork, CARD_LIMIT);
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let asked = card_lines(&record, "work", "asked");
    let withdrawn = card_lines(&record, "work", "withdrawn");
    assert_eq!((asked.len(), withdrawn.len()), (1, 1), "카드가 서고 닫힌다:\n{}", common::lines_text(&record));
    assert_eq!(
        withdrawn[0]["payload"],
        json!({"state": "withdrawn", "requestId": asked[0]["payload"]["requestId"], "card": "work", "reason": "timeout"}),
        "닫힌 까닭은 한도다 — 화면이 카드를 걷고 결정 줄을 남긴다"
    );
    let results = tool_results(&sandbox, &thread);
    assert_eq!(results.len(), 1, "{results:?}");
    assert_eq!(results[0]["isError"], true, "{}", results[0]);
    let said = results[0]["content"][0]["text"].as_str().unwrap();
    assert!(said.starts_with("사람이 답하지 않았다"), "{said}");
    assert!(said.contains("다시 묻지 않는다"), "280초마다 카드가 다시 서지 않게: {said}");
    assert!(!sandbox.work_dir("refund-api").exists(), "아무것도 만들지 않았다");
    assert!(sandbox.thread_json(&thread).get("work").is_none_or(Value::is_null));

    let (session, request) = (sandbox.thread_session_id(&thread), asked[0]["payload"]["requestId"].as_str().unwrap().to_owned());
    let settled = common::commands_after_each_opened(&record);
    let fixed = common::fix_thread_record(&settled, &sandbox.data_root(), &thread, &[&session]);
    let fixed: Vec<Value> =
        fixed.iter().map(|line| serde_json::from_str(&line.to_string().replace(&request, "fake-request")).unwrap()).collect();
    common::assert_record("thread-codex-unanswered", &fixed);
}

/// 놓일 때 그 문 파일을 세운다.
struct Opens<'a>(&'a Path);

impl Drop for Opens<'_> {
    fn drop(&mut self) {
        let _ = std::fs::write(self.0, "");
    }
}

#[test]
fn 사람이_답해_worktree를_만드는_중에_한도가_차면_카드를_닫지_않고_그_답이_끝나기를_기다린다() {
    let limit = Duration::from_secs(1);
    let sandbox = Sandbox::new();
    sandbox.register_project("api");
    let web = sandbox.register_project("web");
    work_with_trees(&sandbox, "cart", &["api"]);
    // 「붙이고 고치기」의 worktree 짓기를 git 훅이 문 파일이 설 때까지 붙잡는다.
    let (began, gate) = (web.join("checkout-began"), web.join("checkout-gate"));
    let hook = web.join(".git/hooks/post-checkout");
    common::write_script(&hook, &format!("#!/bin/sh\ntouch '{}'\nwhile [ ! -e '{}' ]; do sleep 0.05; done\n", began.display(), gate.display()));
    std::fs::set_permissions(&hook, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let call = json!({"tool": "start_editing", "arguments": {"project": "web", "reason": "주문 화면의 환불 버튼"}});
    let (host, thread) = waiting_thread(&sandbox, call, ThreadLink::Work { slug: "cart".into() }, limit);

    let asked = sandbox.wait_thread_record(&thread, |record| !card_lines(record, "project", "asked").is_empty());
    let request = card_lines(&asked, "project", "asked")[0]["payload"]["requestId"].as_str().unwrap().to_owned();
    let making = std::thread::scope(|scope| {
        // 시험이 어디서 실패해도 문을 연다 — 붙잡힌 답을 기다리느라 시험이 멈추지 않게.
        let _open = Opens(&gate);
        let answering = scope.spawn(|| host.answer_project(&thread, &request, ProjectChoice::Attach));
        common::wait_until("worktree 짓기가 시작된다", || if began.exists() { Ok(()) } else { Err(String::new()) });
        std::thread::sleep(limit + Duration::from_millis(500));
        let making = sandbox.thread_record(&thread);
        std::fs::write(&gate, "").unwrap();
        answering.join().unwrap().expect("붙이고 고치기");
        making
    });
    assert!(card_lines(&making, "project", "withdrawn").is_empty(), "만드는 중에는 닫지 않는다:\n{}", common::lines_text(&making));
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert!(card_lines(&record, "project", "withdrawn").is_empty(), "{}", common::lines_text(&record));
    assert_eq!(card_lines(&record, "project", "answered").len(), 1);
    let results = tool_results(&sandbox, &thread);
    assert_ne!(results[0]["isError"], true, "사람이 답한 결과다: {}", results[0]);
    let said = results[0]["content"][0]["text"].as_str().unwrap();
    assert!(said.starts_with("사람이 `web`을 이 Work에 붙였다. worktree를 만들었다"), "{said}");
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
        [EngineState { agent: Agent::Codex, found: true, logged_in: Some(false), missing: vec![] }],
        "Claude의 엔진 상태는 건드리지 않는다 — Claude 채팅에 로그인 카드가 서지 않는다"
    );

    sandbox.log_in(Agent::Codex);
    assert!(matches!(host.check_engine(Agent::Codex, true), Ok(EngineCheck::Found { logged_in: true, .. })));
    assert_eq!(common::opened_hows(&sandbox.thread_record(&thread)), ["new"], "Codex를 다시 확인하면 기다리던 채팅이 뜬다");
    assert!(host.thread(&thread).unwrap().live);
    host.shut_down();
}

// ── Runtime 없음(restart 01c-9) ─────────────────────────────────────────────────────
//
// 스펙 「01c — Codex」 Runtime 없음 — 선 채팅은 세션을 열 때 확인한다. 열다 못 찾으면 그 Runtime의 엔진 상태가 빠진 것과 함께 알려져, 화면이
// 그 채팅의 입력창 자리에 설치 안내 카드를 세운다. Claude 엔진 상태는 건드리지 않는다.

/// Codex를 찾지 못하는 로그인 셸 — PATH에 가짜 claude만 있다.
fn claude_only_shell(sandbox: &Sandbox) -> atelier_acp::ShellSource {
    sandbox.claude_login_shell("normal", &[])
}

/// 그 엔진 상태가 그 Runtime의 「못 찾음」이고 빠진 것에 `codex-acp`가 드나.
fn codex_missing(states: &[EngineState]) -> bool {
    matches!(states, [state] if state.agent == Agent::Codex
        && !state.found
        && state.logged_in.is_none()
        && state.missing.iter().any(|program| program.name == "codex-acp"))
}

#[test]
fn codex를_찾지_못하면_새_채팅을_열_때_codex의_못_찾음이_빠진_것과_함께_알려진다() {
    let sandbox = Sandbox::new();
    let (host, events) = sandbox.host_with_events(claude_only_shell(&sandbox));

    let started = host.start_thread_picking("첫 말", &[], ThreadLink::NoWork, codex());
    assert!(matches!(started, Err(HostError::EngineMissing { agent: Agent::Codex, .. })), "{started:?}");
    let states = events.engine_states();
    assert!(codex_missing(&states), "Codex의 것 하나만 알린다: {states:?}");
}

#[test]
fn 선_codex_채팅은_세션을_열_때_찾지_못하면_codex의_못_찾음이_알려진다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[]));
    let thread = host.start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex()).expect("첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    // 앱을 다시 켰는데 codex-acp가 사라졌다 — 다음 말이 세션을 열다 못 찾는다.
    let (host, events) = sandbox.host_with_events(claude_only_shell(&sandbox));
    let sent = host.send_to_thread(&thread, "다음 말");
    assert!(matches!(sent, Err(HostError::EngineMissing { agent: Agent::Codex, .. })), "{sent:?}");
    let states = events.engine_states();
    assert!(codex_missing(&states), "Codex의 것 하나만 알린다: {states:?}");
}

// ── 판(restart 01c-11 · 스토리 43) ─────────────────────────────────────────────────────
//
// 스펙 「01c — Codex」 판 — 실측한 `codex-acp` 2.2.2와 `codex` 0.162.1이 시험한 판이다. 연 Codex의 `agentInfo.version`이나 `codex --version`이
// 다르면 Runtime 경고(01b-8의 `stderr` 줄)를 적고 대화는 막지 않는다. 시험한 판이면 아무것도 적지 않는다 — 축복한 Codex 기록(`thread-codex` 등)에
// `stderr` 줄이 없다. Claude는 판을 보지 않는다 — 축복한 Claude 기록에도 없다.

/// 그 판들의 가짜로 새 Codex 채팅의 첫 턴을 돌린 기록.
fn first_turn_with(extra: &[(&str, &str)]) -> Vec<Value> {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/turns", extra));
    let thread = host
        .start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, codex())
        .expect("판이 달라도 첫 말은 간다");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    record
}

/// 경고가 턴 사이(열림 뒤 · 첫 말 앞)에 한 줄로 서고 첫 턴은 녹음대로 끝났다.
fn assert_warned_and_answered(record: &[Value], warning: &str) {
    assert_eq!(common::payloads_of(record, "stderr"), [json!({"line": warning})], "{}", common::lines_text(record));
    let at = first_at(record, "stderr");
    assert!(first_at(record, "session") < at && at < first_at(record, "sent"), "턴 사이에 선다:\n{}", common::lines_text(record));
    assert_eq!(of_kind(record, "turn-end")[0]["payload"]["stopReason"], "end_turn", "대화는 막히지 않는다");
    assert_eq!(answer_of(record, 1), "ok");
}

#[test]
fn codex_acp가_시험한_판과_다르면_열_때_runtime_경고가_서고_대화는_막히지_않는다() {
    let record = first_turn_with(&[("FAKE_ACP_VERSION", "2.5.0")]);

    assert_warned_and_answered(
        &record,
        "시험하지 않은 Codex 판이에요 — codex-acp 2.5.0(시험한 판 2.2.2). 대화는 그대로 이어 가지만 다르게 움직일 수 있어요",
    );
}

#[test]
fn codex가_시험한_판과_다르면_열_때_runtime_경고가_서고_둘_다_다르면_한_줄에_둘을_적는다() {
    let record = first_turn_with(&[("FAKE_CODEX_VERSION", "0.170.0")]);
    assert_warned_and_answered(
        &record,
        "시험하지 않은 Codex 판이에요 — codex 0.170.0(시험한 판 0.162.1). 대화는 그대로 이어 가지만 다르게 움직일 수 있어요",
    );

    let record = first_turn_with(&[("FAKE_ACP_VERSION", "2.5.0"), ("FAKE_CODEX_VERSION", "0.170.0")]);
    assert_warned_and_answered(
        &record,
        "시험하지 않은 Codex 판이에요 — codex-acp 2.5.0(시험한 판 2.2.2) · codex 0.170.0(시험한 판 0.162.1). 대화는 그대로 이어 가지만 다르게 움직일 수 있어요",
    );
}

// ── 대화 정리(restart 01c-11 · 스토리 52) ───────────────────────────────────────────────
//
// 스펙 「01b — 대화 정리」 — 두 Runtime을 한 모양으로 맞춘다. Codex의 `tool_call`(`Compact conversation`, `think`)이 그 모양이고, Claude 변환기가
// `status: "compacting"`을 같은 줄로 옮긴다. 01b-4가 뜬 claude 2.1.316의 `/compact`와 01c-1이 뜬 codex-acp 2.2.2의 `/compact`를 Host에 흘려 기록된
// 줄을 맞댄다. 두 녹음 모두 셋째 말이 `/compact`다.

/// 턴에 서는 update — 화면의 접기가 턴의 줄로 읽는 것(`fold.ts`의 `TURN_UPDATES`)과 도구 줄의 끝. 사용량 · 세션 정보 · 명령 목록은 턴의 표다.
const TURN_LINES: [&str; 6] = ["tool_call", "tool_call_update", "agent_message_chunk", "agent_thought_chunk", "plan", "plan_update"];

/// 그 채팅의 셋째 턴(`/compact`)에 기록된 턴의 줄 — 대화 정리 줄의 id는 Runtime이 짓는 값이라 `정리`로 바꾼다 — 과 그 턴의 끝 까닭.
fn compact_turn(sandbox: &Sandbox, host: &ConversationHost, thread: &str, words: [&str; 2]) -> (Vec<Value>, Value) {
    for (turn, said) in words.into_iter().enumerate() {
        sandbox.wait_thread_kind(thread, "turn-end", turn + 1);
        host.send_to_thread(thread, said).expect("이어 말하기");
    }
    let record = sandbox.wait_thread_kind(thread, "turn-end", 3);
    let ends: Vec<usize> = record.iter().enumerate().filter(|(_, line)| line["kind"] == "turn-end").map(|(at, _)| at).collect();
    let turn = &record[ends[1] + 1..ends[2]];
    let lines = turn
        .iter()
        .filter(|line| line["kind"] == "update")
        .map(|line| line["payload"]["update"].clone())
        .filter(|update| TURN_LINES.iter().any(|kind| update["sessionUpdate"] == *kind))
        .map(|mut update| {
            if update.get("toolCallId").is_some() {
                update["toolCallId"] = json!("정리");
            }
            update
        })
        .collect();
    (lines, record[ends[2]]["payload"]["stopReason"].clone())
}

#[test]
fn claude와_codex의_대화_정리는_같은_acp_줄을_만든다() {
    let first = "Remember the word lantern. Reply with exactly one word: ok";
    let words = ["Say one short sentence about lanterns.", "/compact"];

    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.316/stream-compact")]));
    let thread = host.start_thread(first, ThreadLink::NoWork).expect("Claude 채팅의 첫 말");
    let claude = compact_turn(&sandbox, &host, &thread, words);
    host.shut_down();

    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.codex_login_shell("codex-acp-2.2.2/compact", &[]));
    let thread = host.start_thread_picking(first, &[], ThreadLink::NoWork, codex()).expect("Codex 채팅의 첫 말");
    let codex = compact_turn(&sandbox, &host, &thread, words);
    host.shut_down();

    let shape = vec![
        json!({"sessionUpdate": "tool_call", "toolCallId": "정리", "title": "Compact conversation", "kind": "think", "status": "in_progress"}),
        json!({"sessionUpdate": "tool_call_update", "toolCallId": "정리", "status": "completed"}),
    ];
    assert_eq!(codex, (shape, json!("end_turn")), "codex-acp 2.2.2의 정리 턴은 끝나는 정리 줄 하나다");
    assert_eq!(claude, codex, "Claude의 정리 턴이 Codex와 같은 줄을 만든다");
}
