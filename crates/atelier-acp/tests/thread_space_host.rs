//! L1 — Host가 다루는 Project로 Space를 붙인다(03 티켓 08 · 구현 스펙 §11 · S11 · S12): Thread 도구 「Space 목록」 · 「Space 붙이기」.
//!
//! - 「Space 목록」은 Space마다 slug · 이름 · Project · 설명 첫 줄과 이 Thread의 지금 Space를 돌려준다.
//! - 「Space 붙이기」의 후보는 다루는 Project를 모두 담은 Space들(없으면 하나라도 담은 Space들)이고, Host가 넘긴 Space가 추천이다.
//!   - 물어보는 정도가 「알아서」 · 지금 Space 없음 · 후보가 넘긴 것 하나뿐이면 묻지 않고 붙이고 Space 줄 「붙임」(`attached`)을 남긴다.
//!   - 그 밖에는 질문 카드(`question` · `card: space`)가 서고 도구는 사람이 고를 때까지 기다린다 — 고른 답은 답 줄 하나로 접히고 Space
//!     줄을 따로 남기지 않는다. 「나중에」는 아무것도 바꾸지 않는다. 이미 붙어 있으면 「알아서」에서도 묻는다(S11).
//!   - Work에 이은 Thread면 그 Work의 Space가 바뀐다 — 그 Work의 다른 Thread에는 Space 줄이 선다(S9).
//!
//! 시험은 호스트의 Thread 명령과 Thread 폴더(`thread.json` · `events.jsonl`) · `work.json` · 가짜 claude의 MCP 영수증만 본다.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use atelier_acp::{AskLevel, ConversationHost, HostError, SpaceChoice, SpacePick, StartPicks, ThreadLink};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ndescription: 시험의 Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 결제 서비스 Space — web-app · api-server(캔버스 ④ 「결제 서비스」).
const PAYMENTS: &str =
    "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\ncreatedAt: 2026-10-23\n---\n\n결제와 환불을 한 흐름으로 다뤄요.\n둘째 줄.\n";

/// 사내 도구 Space — api-server · backoffice(캔버스 ④ 「사내 도구」).
const TOOLS: &str = "---\nname: 사내 도구\nprojects:\n  - api-server\n  - backoffice\n---\n";

/// 가짜 claude가 첫 턴 앞머리에서 차례로 부를 Thread 도구들 — `FAKE_CLAUDE_MCP_CALL`.
fn calling(sandbox: &Sandbox, calls: &[Value]) -> atelier_acp::ShellSource {
    let calls = Value::Array(calls.to_vec()).to_string();
    sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools"), ("FAKE_CLAUDE_MCP_CALL", &calls)])
}

fn tool(name: &str, arguments: Value) -> Value {
    json!({"tool": name, "arguments": arguments})
}

/// 환불은 web-app과 api-server에 걸쳐 있다 — Host가 결제 서비스를 추천한다.
fn set_payments(projects: &[&str]) -> Value {
    tool("set_space", json!({"space": "결제-서비스", "projects": projects, "reason": "환불은 결제 서비스 쪽 일이에요"}))
}

/// 커밋 하나가 있는 git 저장소를 세워 Project로 등록한다 — 등록한 Project의 slug는 폴더 이름이다.
fn register(sandbox: &Sandbox, name: &str) -> PathBuf {
    let folder = sandbox.data_root().parent().unwrap().join("repos").join(name);
    std::fs::create_dir_all(&folder).unwrap();
    git(&folder, &["init", "-q", "-b", "main"]);
    git(&folder, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
    atelier_core::create_project(&atelier_core::projects_in(&sandbox.data_root()), &folder).expect("Project 등록");
    folder.canonicalize().unwrap()
}

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

/// Space 파일 하나를 둔다.
fn space(sandbox: &Sandbox, slug: &str, text: &str) {
    let spaces = atelier_core::spaces_in(&sandbox.data_root());
    std::fs::create_dir_all(&spaces).unwrap();
    std::fs::write(spaces.join(format!("{slug}.md")), text).unwrap();
}

/// 캔버스 ④의 자리 — Project 셋(web-app · api-server · backoffice)과 Space 둘(결제 서비스 · 사내 도구).
fn payments_world(sandbox: &Sandbox) -> (PathBuf, PathBuf, PathBuf) {
    sandbox.library_agent("host", HOST_MD);
    let web = register(sandbox, "web-app");
    let api = register(sandbox, "api-server");
    let back = register(sandbox, "backoffice");
    space(sandbox, "결제-서비스", PAYMENTS);
    space(sandbox, "사내-도구", TOOLS);
    (web, api, back)
}

/// 그 Session의 claude가 부른 도구의 답 — 부른 차례대로.
fn answers(sandbox: &Sandbox, thread: &str) -> Vec<Value> {
    sandbox.claude_mcp(&sandbox.thread_session_id(thread, "host")).into_iter().map(|call| call["call"].clone()).collect()
}

fn said(answer: &Value) -> &str {
    answer["content"][0]["text"].as_str().expect("글 결과")
}

#[test]
fn space_목록은_space마다_slug_이름_project_설명_첫_줄과_이_thread의_지금_space를_돌려준다() {
    let sandbox = Sandbox::new();
    payments_world(&sandbox);
    let host = sandbox.host(calling(&sandbox, &[tool("list_spaces", json!({}))]));
    let picked = StartPicks { space: Some(SpacePick { slug: Some("결제-서비스".into()) }), ..StartPicks::default() };
    let thread = host.start_thread_picking("환불 금액 확인해 줘", &[], ThreadLink::NoWork, picked).expect("Space를 고른 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "{answer}");
    let listed: Value = serde_json::from_str(said(answer)).expect("Space 목록은 JSON이다");
    assert_eq!(
        listed,
        json!({
            "current": {"slug": "결제-서비스", "name": "결제 서비스"},
            "spaces": [
                {"slug": "결제-서비스", "name": "결제 서비스", "projects": ["web-app", "api-server"], "description": "결제와 환불을 한 흐름으로 다뤄요."},
                {"slug": "사내-도구", "name": "사내 도구", "projects": ["api-server", "backoffice"], "description": null},
            ],
        }),
        "Project는 Thread 도구가 받는 slug다 — 설명은 첫 줄만"
    );
}

/// Host Session의 claude가 마지막으로 뜬 때 함께 연 폴더들(`--add-dir`) — 받은 차례대로.
fn added_dirs(sandbox: &Sandbox, thread: &str) -> Vec<PathBuf> {
    let args = common::receipt_args(&sandbox.claude_receipt(&sandbox.thread_session_id(thread, "host")));
    args.windows(2).filter(|pair| pair[0] == "--add-dir").map(|pair| PathBuf::from(&pair[1])).collect()
}

fn space_lines(sandbox: &Sandbox, thread: &str) -> Vec<Value> {
    of_kind(&sandbox.thread_record(thread), "space").into_iter().map(|line| line["payload"].clone()).collect()
}

/// 「알아서」로 시작한 Work 없는 Thread — 첫 턴에 Host가 `calls`를 부른다.
fn auto_thread(sandbox: &Sandbox, calls: &[Value], picks: StartPicks) -> (ConversationHost, String) {
    let host = sandbox.host(calling(sandbox, calls));
    let picks = StartPicks { mode: Some(AskLevel::Auto), ..picks };
    let thread = host.start_thread_picking("환불이 두 번 빠지는 버그 고쳐 줘", &[], ThreadLink::NoWork, picks).expect("새 Thread의 첫 말");
    (host, thread)
}

#[test]
fn 알아서이고_space가_없고_맞는_space가_넘긴_것_하나뿐이면_묻지_않고_붙이고_붙임_줄_하나만_남긴다() {
    let sandbox = Sandbox::new();
    let (web, api, _) = payments_world(&sandbox);
    let (host, thread) = auto_thread(&sandbox, &[set_payments(&["web-app", "api-server"])], StartPicks::default());
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert!(of_kind(&record, "question").is_empty(), "묻지 않는다: {}", common::lines_text(&record));
    assert_eq!(sandbox.thread_json(&thread)["space"], "결제-서비스", "Thread 파일의 space만 고친다");
    let lines = of_kind(&record, "space");
    assert_eq!(lines.len(), 1, "{}", common::lines_text(&record));
    assert!(lines[0].get("who").is_none(), "Space 줄은 시스템 줄이다(S8): {}", lines[0]);
    assert_eq!(
        lines[0]["payload"],
        json!({"change": "attached", "space": "결제-서비스", "name": "결제 서비스", "before": null, "work": null,
               "projects": ["web-app", "api-server"], "registered": 3}),
        "흐름의 「결제 서비스 Space에 넣었어요 — web-app · api-server를 읽어요」가 이것을 읽는다"
    );
    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "{answer}");
    assert!(said(answer).starts_with("Space `결제-서비스`(결제 서비스)에 넣었다"), "{answer}");
    assert!(said(answer).contains("web-app, api-server"), "다음 말부터 읽는 Project를 알린다: {answer}");

    // 다음 말부터 그 Space의 Project만 함께 연다.
    let host = sandbox.host(calling(&sandbox, &[]));
    host.send_to_thread(&thread, "고쳐 줘").expect("둘째 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();
    assert_eq!(added_dirs(&sandbox, &thread), [web, api]);
}

/// Space 질문 카드(`question` · `card: space`)의 그 상태 줄이 나올 때까지 기다린다.
fn wait_card(sandbox: &Sandbox, thread: &str, state: &str) -> Value {
    let of_state = |record: &[Value]| {
        of_kind(record, "question").into_iter().find(|line| line["payload"]["card"] == "space" && line["payload"]["state"] == state).cloned()
    };
    let record = sandbox.wait_thread_record(thread, |record| of_state(record).is_some());
    of_state(&record).unwrap()
}

fn request_of(asked: &Value) -> String {
    asked["payload"]["requestId"].as_str().expect("요청 id").to_owned()
}

/// 매번 묻기(기본)로 시작한 Work 없는 Thread — 첫 턴에 Host가 `calls`를 부른다.
fn asking_thread(sandbox: &Sandbox, calls: &[Value]) -> (ConversationHost, String) {
    let host = sandbox.host(calling(sandbox, calls));
    let thread = host.start_thread("환불이 두 번 빠지는 버그 고쳐 줘", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread)
}

#[test]
fn 알아서가_아니면_질문_카드가_추천_후보_space_없이로_서고_고른_답은_한_줄로_접히며_다음_말부터_그_space를_읽는다() {
    let sandbox = Sandbox::new();
    let (_, api, back) = payments_world(&sandbox);
    let (host, thread) = asking_thread(&sandbox, &[set_payments(&["api-server"])]);

    let asked = wait_card(&sandbox, &thread, "asked");
    assert_eq!(asked["who"], "host", "물은 Agent가 줄의 who다(S8)");
    let mut card = asked["payload"].clone();
    card.as_object_mut().unwrap().remove("requestId");
    assert_eq!(
        card,
        json!({
            "state": "asked", "card": "space", "recommended": "결제-서비스",
            "spaces": [
                {"slug": "결제-서비스", "name": "결제 서비스", "projects": ["web-app", "api-server"]},
                {"slug": "사내-도구", "name": "사내 도구", "projects": ["api-server", "backoffice"]},
            ],
            "registered": 3, "current": null, "reason": "환불은 결제 서비스 쪽 일이에요",
        }),
        "후보는 api-server를 담은 Space 둘 — 넘긴 Space가 추천으로 맨 앞이다. 「Space 없이」는 등록된 Project 수로 선다"
    );
    assert!(of_kind(&sandbox.thread_record(&thread), "turn-end").is_empty(), "도구는 사람이 고를 때까지 기다린다 — 턴이 돈다");
    assert_eq!(sandbox.thread_json(&thread).get("space"), None, "고르기 전에는 아무것도 바꾸지 않는다");

    // 사람이 추천이 아닌 사내 도구를 고른다.
    host.answer_space(&thread, &request_of(&asked), SpaceChoice::Space("사내-도구".into())).expect("고르기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    assert_eq!(sandbox.thread_json(&thread)["space"], "사내-도구", "고른 Space가 Thread 파일에 선다");
    assert_eq!(
        wait_card(&sandbox, &thread, "answered")["payload"],
        json!({"state": "answered", "requestId": request_of(&asked), "card": "space", "choice": "space",
               "space": "사내-도구", "name": "사내 도구"}),
        "접힌 카드 「✓ 어느 Space에서 할까요? · 사내 도구」가 이것을 읽는다"
    );
    assert!(of_kind(&record, "space").is_empty(), "질문 카드로 고른 Space는 Space 줄을 따로 남기지 않는다(§9): {}", common::lines_text(&record));
    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "{answer}");
    assert!(said(answer).starts_with("사람이 Space `사내-도구`(사내 도구)를 골랐다"), "{answer}");
    assert!(said(answer).contains("api-server, backoffice"), "{answer}");
    assert_eq!(
        host.answer_space(&thread, &request_of(&asked), SpaceChoice::Later),
        Err(HostError::QuestionClosed { thread: thread.clone(), request: request_of(&asked) }),
        "닫힌 카드에는 답하지 못한다"
    );

    // 다음 말부터 고른 Space의 Project만 함께 연다.
    let host = sandbox.host(calling(&sandbox, &[]));
    host.send_to_thread(&thread, "고쳐 줘").expect("둘째 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();
    assert_eq!(added_dirs(&sandbox, &thread), [api, back]);
}

#[test]
fn 이미_붙어_있으면_알아서에서도_묻고_나중에는_아무것도_바꾸지_않는다() {
    let sandbox = Sandbox::new();
    let (_, api, back) = payments_world(&sandbox);
    let picked = StartPicks { space: Some(SpacePick { slug: Some("사내-도구".into()) }), ..StartPicks::default() };
    let (host, thread) = auto_thread(&sandbox, &[set_payments(&["web-app", "api-server"])], picked);

    let asked = wait_card(&sandbox, &thread, "asked");
    assert_eq!(asked["payload"]["current"], json!({"slug": "사내-도구", "name": "사내 도구"}), "지금 Space를 싣는다");
    assert_eq!(
        asked["payload"]["spaces"],
        json!([{"slug": "결제-서비스", "name": "결제 서비스", "projects": ["web-app", "api-server"]}]),
        "맞는 Space가 넘긴 것 하나뿐이어도 사람이 고른 Space를 몰래 바꾸지 않는다(S11)"
    );
    host.answer_space(&thread, &request_of(&asked), SpaceChoice::Later).expect("나중에");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert_eq!(sandbox.thread_json(&thread)["space"], "사내-도구", "「나중에」는 아무것도 바꾸지 않는다");
    assert!(of_kind(&record, "space").is_empty(), "{}", common::lines_text(&record));
    assert_eq!(
        wait_card(&sandbox, &thread, "answered")["payload"],
        json!({"state": "answered", "requestId": request_of(&asked), "card": "space", "choice": "later", "space": null, "name": null})
    );
    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "고른 것이지 실패가 아니다: {answer}");
    assert!(said(answer).starts_with("사람이 나중에 정하기로 함"), "{answer}");
    assert!(said(answer).contains("지금 Space `사내-도구`(사내 도구)다"), "{answer}");
    let _ = (api, back);
}

#[test]
fn 넘긴_것이_지금과_같으면_묻지_않고_바꾸지_않으며_없는_space나_등록되지_않은_project는_도구의_실패다() {
    let sandbox = Sandbox::new();
    payments_world(&sandbox);
    let picked = StartPicks { space: Some(SpacePick { slug: Some("결제-서비스".into()) }), ..StartPicks::default() };
    let calls = [
        set_payments(&["web-app"]),
        tool("set_space", json!({"space": "정산", "projects": ["api-server"]})),
        tool("set_space", json!({"space": "결제-서비스", "projects": ["landing-page"]})),
    ];
    let host = sandbox.host(calling(&sandbox, &calls));
    let thread = host.start_thread_picking("환불 봐 줘", &[], ThreadLink::NoWork, picked).expect("Space를 고른 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert!(of_kind(&record, "question").is_empty() && of_kind(&record, "space").is_empty(), "{}", common::lines_text(&record));
    let said: Vec<(bool, String)> =
        answers(&sandbox, &thread).iter().map(|answer| (answer["isError"] == true, said(answer).to_owned())).collect();
    assert_eq!(said[0], (false, "지금 Space `결제-서비스`(결제 서비스)다 — 바꾸지 않았다.".to_owned()));
    assert!(said[1].0 && said[1].1.contains("없는 Space다: 정산") && said[1].1.contains("결제-서비스, 사내-도구"), "{:?}", said[1]);
    assert!(said[2].0 && said[2].1.contains("등록되지 않은 Project다: landing-page"), "{:?}", said[2]);
}

/// Work `refund-api`를 worktree 없이 세운다(S21).
fn refund_work(sandbox: &Sandbox) {
    let root = sandbox.data_root();
    atelier_core::start_work_deferred(
        &atelier_core::works_in(&root),
        &atelier_core::archive_in(&root),
        &atelier_core::projects_in(&root),
        "환불 API 버그 수정",
        Some("refund-api"),
        &["api-server".to_owned()],
        Some("fix/refund-api"),
    )
    .expect("worktree 없는 Work");
}

fn work_json(sandbox: &Sandbox) -> Value {
    serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("refund-api").join("work.json")).unwrap()).unwrap()
}

fn in_refund() -> ThreadLink {
    ThreadLink::Work { slug: "refund-api".into() }
}

#[test]
fn work에_이은_thread에서_붙이면_그_work의_space가_되고_그_work의_thread마다_줄이_선다() {
    let sandbox = Sandbox::new();
    payments_world(&sandbox);
    refund_work(&sandbox);
    // 그 Work의 다른 Thread — 먼저 말해 둔다.
    let host = sandbox.host(calling(&sandbox, &[]));
    let other = host.start_thread("설계 문서부터", in_refund()).expect("같은 Work의 다른 Thread");
    sandbox.wait_thread_kind(&other, "turn-end", 1);
    host.shut_down();

    // 「알아서」 Work — 묻지 않고 그 Work에 붙인다.
    let host = sandbox.host(calling(&sandbox, &[set_payments(&["web-app", "api-server"])]));
    let thread = host
        .start_thread_asking("환불이 두 번 빠지는 버그 고쳐 줘", &[], in_refund(), Some(AskLevel::Auto))
        .expect("Work에 이은 Thread");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    assert!(of_kind(&record, "question").is_empty(), "{}", common::lines_text(&record));
    assert_eq!(work_json(&sandbox)["space"], "결제-서비스", "그 Work의 Space가 된다(스토리 56)");
    assert_eq!(sandbox.thread_json(&thread).get("space"), None, "Work에 이은 Thread의 칸은 쓰지 않는다");
    let attached = json!({"change": "attached", "space": "결제-서비스", "name": "결제 서비스", "before": null, "work": "refund-api",
                          "projects": ["web-app", "api-server"], "registered": 3});
    for one in [&thread, &other] {
        assert_eq!(space_lines(&sandbox, one), [attached.clone()], "그 Work의 Thread마다 같은 줄이 선다(S9)");
    }

    // 매번 묻기로 돌아가 카드로 바꾼다 — 물은 Thread에는 접힌 카드만, 그 Work의 다른 Thread에는 바꿈 줄이 선다.
    let host = sandbox.host(calling(&sandbox, &[tool("set_space", json!({"space": "사내-도구", "projects": ["api-server"]}))]));
    host.set_thread_mode(&thread, AskLevel::Always).expect("매번 묻기");
    host.send_to_thread(&thread, "사내 도구 쪽에서 볼래").expect("둘째 말");
    let asked = wait_card(&sandbox, &thread, "asked");
    assert_eq!(asked["payload"]["current"], json!({"slug": "결제-서비스", "name": "결제 서비스"}));
    host.answer_space(&thread, &request_of(&asked), SpaceChoice::Space("사내-도구".into())).expect("고르기");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();
    assert_eq!(work_json(&sandbox)["space"], "사내-도구");
    assert_eq!(space_lines(&sandbox, &thread).len(), 1, "물은 Thread에는 줄을 더 남기지 않는다 — 접힌 카드가 그 줄이다");
    assert_eq!(
        space_lines(&sandbox, &other).last().unwrap(),
        &json!({"change": "changed", "space": "사내-도구", "name": "사내 도구", "before": "결제-서비스", "work": "refund-api",
                "projects": ["api-server", "backoffice"], "registered": 3}),
        "그 Work의 다른 Thread는 범위가 바뀌어 줄이 선다(S9)"
    );
}

#[test]
fn space_없이를_고르면_space를_빼고_다음_말부터_등록된_project를_모두_읽는다() {
    let sandbox = Sandbox::new();
    payments_world(&sandbox);
    let picked = StartPicks { space: Some(SpacePick { slug: Some("결제-서비스".into()) }), ..StartPicks::default() };
    let host = sandbox.host(calling(&sandbox, &[tool("set_space", json!({"space": null, "projects": ["backoffice"]}))]));
    let thread = host.start_thread_picking("백오피스도 봐야 해", &[], ThreadLink::NoWork, picked).expect("Space를 고른 첫 말");
    let asked = wait_card(&sandbox, &thread, "asked");
    assert_eq!(asked["payload"]["recommended"], Value::Null, "넘긴 Space가 없으면 「Space 없이」가 추천이다");
    host.answer_space(&thread, &request_of(&asked), SpaceChoice::Without).expect("Space 없이");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert_eq!(sandbox.thread_json(&thread).get("space"), None, "빼면 칸째 빠진다");
    assert!(of_kind(&record, "space").is_empty());
    assert_eq!(wait_card(&sandbox, &thread, "answered")["payload"]["choice"], "none");
    let answer = &answers(&sandbox, &thread)[0];
    assert!(said(answer).starts_with("사람이 Space 없이 하기로 했다 — 다음 말부터 등록된 Project 3개를 모두 읽는다"), "{answer}");
    assert_eq!(
        host.answer_space(&thread, "없는-요청", SpaceChoice::Without),
        Err(HostError::QuestionClosed { thread: thread.clone(), request: "없는-요청".into() })
    );
}

#[test]
fn 머리말은_space_목록과_space_붙이기를_알리고_다루는_project가_정해지면_붙이라고_지시한다() {
    let sandbox = Sandbox::new();
    payments_world(&sandbox);
    let host = sandbox.host(calling(&sandbox, &[]));
    let thread = host.start_thread("환불 봐 줘", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let preamble = of_kind(&record, "sent")[0]["payload"]["prompt"][0]["text"].as_str().expect("머리말").to_owned();
    let lines: Vec<&str> = preamble.lines().collect();
    let tools = lines.iter().position(|line| line.starts_with("- Thread 도구:")).expect("도구 블록");
    let space = lines.iter().position(|line| line.starts_with("- Space:")).expect("Space 줄");
    assert!(space < tools, "Space 줄 뒤에 도구 블록이 선다:\n{preamble}");
    assert!(lines.iter().any(|line| line.trim_start().starts_with("- `list_spaces`()")), "{preamble}");
    assert!(lines.iter().any(|line| line.trim_start().starts_with("- `set_space`(space, projects, reason)")), "{preamble}");
    assert!(
        preamble.contains(
            "다루는 Project가 정해지면 `list_spaces`로 그 Project를 담은 Space를 보고 `set_space`로 붙인다. 이미 붙어 있으면 바꿀 까닭이 \
             있을 때만 부른다."
        ),
        "지시(§11):\n{preamble}"
    );
    assert!(preamble.contains("\n- Work: 없음 — 이 Thread 폴더에서 일한다: `"), "Work 줄의 꼴은 그대로다(L3 `workTitleOf`):\n{preamble}");
}

/// 기록 축복(S26 꼴) — 매번 묻기 Thread에서 Host가 「Space 붙이기」로 묻고 사람이 추천(결제 서비스)을 고른 턴이 검사 자료로 선다. 화면
/// L2(`fold.test.ts`)와 끝 e2e(13)의 L3가 이 파일을 흘려 질문 카드 「어느 Space에서 할까요?」(답하기 전까지) · 접힌 줄 「✓ 어느 Space에서
/// 할까요? · 결제 서비스」를 그린다.
#[test]
fn host가_space를_묻고_사람이_고른_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    payments_world(&sandbox);
    let (host, thread) = asking_thread(&sandbox, &[set_payments(&["api-server"])]);
    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_space(&thread, &request_of(&asked), SpaceChoice::Space("결제-서비스".into())).expect("고르기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread, "host");
    let fixed = common::fix_thread_record(&settled(&record), &sandbox.data_root(), &thread, &[&session]);
    let fixed: Vec<Value> = fixed
        .iter()
        .map(|line| serde_json::from_str(&line.to_string().replace(&request_of(&asked), "fake-request")).unwrap())
        .collect();
    common::assert_record("thread-space-ask", &fixed);
}

/// 기록 축복 — 「알아서」 Thread에서 Host가 묻지 않고 Space를 붙인 턴(Space 줄 「붙임」). L3가 이 파일을 흘려 「결제 서비스 Space에
/// 넣었어요 — web-app · api-server를 읽어요」를 그린다.
#[test]
fn host가_묻지_않고_space를_붙인_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    payments_world(&sandbox);
    let (host, thread) = auto_thread(&sandbox, &[set_payments(&["web-app", "api-server"])], StartPicks::default());
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread, "host");
    let fixed = common::fix_thread_record(&settled(&record), &sandbox.data_root(), &thread, &[&session]);
    common::assert_record("thread-space-attached", &fixed);
}

/// 축복 자료의 차례를 하나로 둔다 — 명령 목록 줄(`available_commands_update`)은 Session을 연 답 뒤에 따로 와 그 뒤의 `sent`와 엇갈린다.
/// 그 줄 앞의 가장 가까운 열림 줄 바로 뒤로 옮기고 seq를 다시 센다(`thread_space.rs`와 같은 꼴).
fn settled(record: &[Value]) -> Vec<Value> {
    let is_commands = |line: &Value| line["payload"]["update"]["sessionUpdate"] == "available_commands_update";
    let mut lines: Vec<Value> = Vec::new();
    for line in record {
        if !is_commands(line) {
            lines.push(line.clone());
            continue;
        }
        let opened = lines.iter().rposition(|one| one["payload"]["state"] == "opened").expect("앞선 열림 줄");
        let at = lines[opened + 1..].iter().position(|one| !is_commands(one)).map_or(lines.len(), |n| opened + 1 + n);
        lines.insert(at, line.clone());
    }
    for (n, line) in lines.iter_mut().enumerate() {
        line["seq"] = json!(n + 1);
    }
    lines
}
