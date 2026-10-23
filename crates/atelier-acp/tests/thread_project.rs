//! L1 — 처음 고칠 때 그 Project에 worktree가 생기고, Work 밖 Project는 묻는다(v1 티켓 32 · 구현 스펙 §7 S13 · §11 S21 · S22 · §5 「작업
//! 폴더가 바뀔 때」).
//!
//! - Thread 도구 「Project 고치기 시작」(`start_editing`)이 Work에 있는 Project를 받으면 묻지 않고 그 Project에만 worktree를 만들고,
//!   `work` 줄 「api-server에 worktree를 만듦 · 브랜치」를 남기고, 그 경로를 돌려준다.
//! - Work에 없는 Project면 Work 밖 Project 카드가 `question` 줄(`card: project`)로 서고, 도구는 사람이 고를 때까지 기다린다 — 붙이고
//!   고치기 · 읽기만 하기 · 아니요.
//! - 작업 폴더가 바뀌면(worktree가 섰다 · 읽기만 폴더를 더했다) 다음 턴에 그 Session을 새 작업 폴더에서 이어 연다(S11 · 실측-작업폴더.md).
//!
//! 시험은 호스트의 Thread 명령과 Thread 폴더(`thread.json` · `events.jsonl`) · works 폴더 · 등록한 저장소 · 가짜 claude의 영수증만 본다.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use atelier_acp::{ConversationHost, HostError, ProjectChoice, ThreadLink};
use common::{has_pair, of_kind, receipt_args, Sandbox, RECORDED_PLACE};
use serde_json::{json, Value};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ndescription: 시험의 Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// Host가 Work 밖 web-app을 고치려 한다(캔버스 Cards 보드 「Work 밖 Project」).
fn edit_web_app() -> Value {
    json!({"tool": "start_editing", "arguments": {"project": "web-app", "reason": "환불 버튼이 두 번 눌리는 문제는 web-app에 있어요"}})
}

/// 가짜 claude가 턴마다 앞머리에서 부를 Thread 도구들(`FAKE_CLAUDE_MCP_CALL`)과 되감을 원문. 편집(`Write`)의 경로는 claude의 작업
/// 폴더로 옮긴다.
fn calling(sandbox: &Sandbox, fixture: &str, calls: &[Value]) -> atelier_acp::ShellSource {
    let calls = Value::Array(calls.to_vec()).to_string();
    sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", fixture), ("FAKE_CLAUDE_MCP_CALL", &calls), ("FAKE_CLAUDE_REBASE", RECORDED_PLACE)],
    )
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

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Work `refund-api`를 worktree 없이 세운다(S21 · v1 티켓 29) — Project는 적되 「읽기만」이다.
fn deferred_work(sandbox: &Sandbox, projects: &[&str]) {
    let root = sandbox.data_root();
    let projects: Vec<String> = projects.iter().map(|one| (*one).to_owned()).collect();
    atelier_core::start_work_deferred(
        &atelier_core::works_in(&root),
        &atelier_core::archive_in(&root),
        &atelier_core::projects_in(&root),
        "환불 API 버그 수정",
        Some("refund-api"),
        &projects,
        Some("fix/refund-api"),
    )
    .expect("worktree 없는 Work");
}

fn in_refund() -> ThreadLink {
    ThreadLink::Work { slug: "refund-api".into() }
}

fn tree(sandbox: &Sandbox, project: &str) -> PathBuf {
    sandbox.work_dir("refund-api").join("trees").join(project)
}

fn work_json(sandbox: &Sandbox) -> Value {
    serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("refund-api").join("work.json")).unwrap()).unwrap()
}

/// Work 밖 Project 카드(`question` · `card: project`)의 그 상태 줄이 나올 때까지 기다린다.
fn wait_card(sandbox: &Sandbox, thread: &str, state: &str) -> Value {
    let of_state = |record: &[Value]| {
        of_kind(record, "question").into_iter().find(|line| line["payload"]["card"] == "project" && line["payload"]["state"] == state).cloned()
    };
    let record = sandbox.wait_thread_record(thread, |record| of_state(record).is_some());
    of_state(&record).unwrap()
}

fn request_of(asked: &Value) -> String {
    asked["payload"]["requestId"].as_str().expect("요청 id").to_owned()
}

/// 그 Session의 claude가 부른 도구의 답 — 부른 차례대로.
fn answers(sandbox: &Sandbox, thread: &str) -> Vec<Value> {
    sandbox.claude_mcp(&sandbox.thread_session_id(thread, "host")).into_iter().map(|call| call["call"].clone()).collect()
}

fn said(answer: &Value) -> &str {
    answer["content"][0]["text"].as_str().expect("글 결과")
}

/// Host Session의 claude가 마지막으로 뜬 때의 받은 인자와 작업 폴더.
fn last_launch(sandbox: &Sandbox, thread: &str) -> (Vec<String>, PathBuf) {
    let receipt = sandbox.claude_receipt(&sandbox.thread_session_id(thread, "host"));
    (receipt_args(&receipt), PathBuf::from(receipt["cwd"].as_str().expect("cwd")))
}

fn real(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| panic!("없다: {}", path.display()))
}

#[test]
fn work에_있는_project를_처음_고치면_묻지_않고_그_project에만_worktree가_서고_시스템_줄이_남고_도구가_그_경로를_돌려준다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let api = register(&sandbox, "api-server");
    register(&sandbox, "web-app");
    deferred_work(&sandbox, &["api-server", "web-app"]);
    let start = json!({"tool": "start_editing", "arguments": {"project": "api-server"}});
    let host = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[start]));

    let thread = host.start_thread("환불 API 버그 고쳐줘", in_refund()).expect("Work에 이은 Thread");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert!(tree(&sandbox, "api-server").join(".git").is_file(), "api-server에 git worktree가 선다");
    assert!(!tree(&sandbox, "web-app").exists(), "읽기만 한 Project에는 worktree가 생기지 않는다(스토리 98)");
    assert!(git(&api, &["branch", "--list", "fix/refund-api"]).contains("fix/refund-api"), "Work의 브랜치로 선다");
    assert!(of_kind(&record, "question").is_empty(), "Work에 있는 Project는 묻지 않는다(S21)");
    let lines = of_kind(&record, "work");
    assert_eq!(lines.len(), 1, "{}", common::lines_text(&record));
    assert!(lines[0].get("who").is_none(), "시스템 줄이다(S8): {}", lines[0]);
    assert_eq!(
        lines[0]["payload"],
        json!({"state": "worktree", "project": "api-server", "branch": "fix/refund-api",
               "path": tree(&sandbox, "api-server")}),
        "시스템 줄 「api-server에 worktree를 만듦 · fix/refund-api」가 이것을 읽는다"
    );

    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "{answer}");
    assert!(said(answer).contains(&tree(&sandbox, "api-server").display().to_string()), "도구가 그 worktree 경로를 돌려준다: {answer}");
}

#[test]
fn work_밖_project는_카드로_묻고_붙이고_고치기면_붙여_worktree를_만들고_다음_턴은_그_worktree에서_이어_열려_편집이_허용된다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server");
    register(&sandbox, "web-app");
    deferred_work(&sandbox, &["api-server"]);
    std::fs::write(sandbox.work_dir("refund-api").join(".policy.json"), json!({"mode": "edits"}).to_string()).unwrap();
    let host = sandbox.host(calling(&sandbox, "2.1.309/permission-stdio", &[edit_web_app()]));
    let thread = host.start_thread("환불 버튼이 두 번 눌려요", in_refund()).expect("Work에 이은 Thread");

    let asked = wait_card(&sandbox, &thread, "asked");
    assert_eq!(asked["who"], "host", "물은 Agent가 줄의 who다(S8)");
    assert_eq!(
        asked["payload"],
        json!({"state": "asked", "requestId": request_of(&asked), "card": "project", "project": "web-app", "name": "web-app",
               "reason": "환불 버튼이 두 번 눌리는 문제는 web-app에 있어요", "work": "refund-api", "workProjects": ["api-server"]}),
        "카드는 고치려는 Project와 까닭, 이 Work의 Project(「아니요, api-server에서만 고쳐 주세요」)를 싣는다"
    );
    assert!(!tree(&sandbox, "web-app").exists(), "묻는 동안에는 아무것도 하지 않는다");

    host.answer_project(&thread, &request_of(&asked), ProjectChoice::Attach).expect("붙이고 고치기");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    assert_eq!(work_json(&sandbox)["projects"], json!(["api-server", "web-app"]), "web-app이 이 Work에 붙는다");
    assert!(tree(&sandbox, "web-app").join(".git").is_file(), "붙인 Project에 worktree가 선다");
    assert!(!tree(&sandbox, "api-server").exists(), "고치지 않은 Project에는 worktree가 없다");
    let record = sandbox.thread_record(&thread);
    assert_eq!(
        wait_card(&sandbox, &thread, "answered")["payload"],
        json!({"state": "answered", "requestId": request_of(&asked), "card": "project", "choice": "attach", "project": "web-app"}),
        "결정한 뒤 「web-app을 이 Work에 붙임」이 이 줄을 읽는다"
    );
    let lines: Vec<Value> = of_kind(&record, "work").into_iter().map(|line| line["payload"].clone()).collect();
    assert_eq!(
        lines,
        [
            json!({"state": "attached", "project": "web-app"}),
            json!({"state": "worktree", "project": "web-app", "branch": "fix/refund-api", "path": tree(&sandbox, "web-app")}),
        ]
    );
    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "{answer}");
    assert!(said(answer).contains(&tree(&sandbox, "web-app").display().to_string()), "{answer}");
    let (_, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&sandbox.work_dir("refund-api").join("spec")), "이 턴의 작업 폴더는 그대로다 — 다음 턴부터 옮긴다");

    // 다음 턴 — 같은 Session을 새 작업 폴더(그 worktree)에서 이어 연다(S11 「바꿔 이어 열기」).
    let session = sandbox.thread_session_id(&thread, "host");
    host.send_to_thread(&thread, "고쳐 줘").expect("다음 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();
    let (args, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&tree(&sandbox, "web-app")), "다음 턴은 그 worktree에서 일한다");
    assert!(has_pair(&args, "--resume", &session), "같은 Session을 이어 연다 — 앞 맥락을 기억한다: {args:?}");
    assert!(has_pair(&args, "--add-dir", &sandbox.work_dir("refund-api").join("spec").display().to_string()), "{args:?}");
    assert_eq!(sandbox.thread_session_id(&thread, "host"), session);
    assert_eq!(sandbox.participant(&thread, "host")["cwd"], json!(tree(&sandbox, "web-app")), "thread.json은 지금 작업 폴더를 적는다");
    let sent = of_kind(&record, "sent");
    let prompt = sent[1]["payload"]["prompt"].to_string();
    assert!(
        prompt.contains(&format!("Project `web-app`: worktree `{}`", tree(&sandbox, "web-app").display())),
        "옮겨 연 Session에는 머리말을 다시 붙여 새 자리를 알린다: {prompt}"
    );

    // 붙인 뒤에는 그 worktree 안의 편집이 허용된다(§9 2번 칸).
    let decided: Vec<&Value> =
        of_kind(&record, "permission").into_iter().filter(|line| line["payload"]["state"] == "decided").collect();
    let last = decided.last().expect("판정 줄");
    assert_eq!((last["payload"]["optionId"].clone(), last["payload"]["reason"].clone()), (json!("allow_once"), json!("편집은 허용")));
    let path = last["payload"]["request"]["toolCall"]["rawInput"]["file_path"].as_str().unwrap_or_default().to_owned();
    assert!(Path::new(&path).starts_with(real(&tree(&sandbox, "web-app"))), "worktree 안의 편집이다: {path}");
}

#[test]
fn 읽기만_하기면_work에_붙이지_않고_worktree도_만들지_않으며_다음_턴부터_project_폴더를_함께_연다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server");
    let web = register(&sandbox, "web-app");
    deferred_work(&sandbox, &["api-server"]);
    let host = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[edit_web_app()]));
    let thread = host.start_thread("환불 버튼이 두 번 눌려요", in_refund()).expect("Work에 이은 Thread");

    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_project(&thread, &request_of(&asked), ProjectChoice::ReadOnly).expect("읽기만 하기");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    assert_eq!(work_json(&sandbox)["projects"], json!(["api-server"]), "Work에 붙지 않는다");
    assert!(!tree(&sandbox, "web-app").exists());
    assert_eq!(sandbox.thread_json(&thread)["readOnlyProjects"], json!(["web-app"]), "읽기만 한 Project는 이 Thread에 적는다");
    // 화면이 받는 Thread 보기에서 읽기만 Project는 「읽기만 된 Thread」(v1 티켓 38의 `readOnly`)와 다른 칸이다.
    let view = serde_json::to_value(host.thread(&thread).expect("Thread 보기")).expect("JSON");
    assert_eq!((view["readOnly"].clone(), view["readOnlyProjects"].clone()), (Value::Null, json!(["web-app"])), "{view}");
    assert_eq!(wait_card(&sandbox, &thread, "answered")["payload"]["choice"], "read");
    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "고른 것이지 실패가 아니다: {answer}");
    assert!(said(answer).contains(&web.display().to_string()) && said(answer).contains("읽기만"), "{answer}");

    host.send_to_thread(&thread, "어디가 문제야?").expect("다음 말");
    // 다음 턴에도 같은 도구를 부르면 다시 묻는다 — 사람이 마음을 바꿀 수 있다.
    let record = sandbox.wait_thread_record(&thread, |record| {
        of_kind(record, "question").iter().filter(|line| line["payload"]["state"] == "asked").count() == 2
    });
    let again = of_kind(&record, "question").into_iter().rfind(|line| line["payload"]["state"] == "asked").unwrap().clone();
    let (args, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&sandbox.work_dir("refund-api").join("spec")), "작업 폴더는 그대로 spec 폴더다");
    assert!(has_pair(&args, "--add-dir", &web.display().to_string()), "다음 턴부터 Project 폴더를 함께 연다: {args:?}");
    host.answer_project(&thread, &request_of(&again), ProjectChoice::Decline).expect("아니요");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();
}

/// 끝 점검 ④(v1 티켓 39) — 읽기만 하기로 둔 Project를 같은 Thread에서 다시 물어 붙이면 그 Project는 더 이상 이 Thread의 읽기만 Project가
/// 아니다. 남아 있으면 다음 턴에 원본 폴더(main 체크아웃)를 worktree와 함께 열어, 같은 Project가 두 자리에 선다.
#[test]
fn 읽기만_하기_뒤_다시_물어_붙이고_고치기면_읽기만_목록에서_빠지고_다음_턴에는_원본_폴더를_함께_열지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server");
    let web = register(&sandbox, "web-app");
    deferred_work(&sandbox, &["api-server"]);
    let host = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[edit_web_app()]));
    let thread = host.start_thread("환불 버튼이 두 번 눌려요", in_refund()).expect("Work에 이은 Thread");
    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_project(&thread, &request_of(&asked), ProjectChoice::ReadOnly).expect("읽기만 하기");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);

    host.send_to_thread(&thread, "그래도 web-app을 고쳐 줘").expect("다음 말");
    let record = sandbox.wait_thread_record(&thread, |record| {
        of_kind(record, "question").iter().filter(|line| line["payload"]["state"] == "asked").count() == 2
    });
    let again = of_kind(&record, "question").into_iter().rfind(|line| line["payload"]["state"] == "asked").unwrap().clone();
    host.answer_project(&thread, &request_of(&again), ProjectChoice::Attach).expect("붙이고 고치기");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    assert_eq!(sandbox.thread_json(&thread).get("readOnlyProjects"), None, "붙인 Project는 읽기만이 아니다");
    let view = serde_json::to_value(host.thread(&thread).expect("Thread 보기")).expect("JSON");
    assert_eq!(view["readOnlyProjects"], Value::Null, "{view}");

    host.send_to_thread(&thread, "이어서 해 줘").expect("셋째 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 3);
    let (args, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&tree(&sandbox, "web-app")), "worktree에서 이어 연다");
    assert!(!has_pair(&args, "--add-dir", &web.display().to_string()), "원본 폴더는 함께 열지 않는다: {args:?}");
    host.shut_down();
}

#[test]
fn 아니요면_아무것도_바꾸지_않고_도구가_이_work의_project에서만_고치라는_거절_글을_돌려준다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server");
    register(&sandbox, "web-app");
    deferred_work(&sandbox, &["api-server"]);
    let host = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[edit_web_app()]));
    let thread = host.start_thread("환불 버튼이 두 번 눌려요", in_refund()).expect("Work에 이은 Thread");

    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_project(&thread, &request_of(&asked), ProjectChoice::Decline).expect("아니요");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert_eq!(work_json(&sandbox)["projects"], json!(["api-server"]));
    assert!(!tree(&sandbox, "web-app").exists());
    assert!(sandbox.thread_json(&thread).get("readOnlyProjects").is_none(), "{}", sandbox.thread_json(&thread));
    assert_eq!(wait_card(&sandbox, &thread, "answered")["payload"]["choice"], "decline");
    assert!(of_kind(&sandbox.thread_record(&thread), "work").is_empty());
    let answer = &answers(&sandbox, &thread)[0];
    assert_eq!(answer["isError"], true, "거절 글이다(S22): {answer}");
    assert!(said(answer).contains("web-app") && said(answer).contains("api-server"), "{answer}");
    assert_eq!(
        host.answer_project(&thread, &request_of(&asked), ProjectChoice::Attach),
        Err(HostError::QuestionClosed { thread: thread.clone(), request: request_of(&asked) }),
        "닫힌 카드에는 답하지 못한다"
    );
}

#[test]
fn work가_없는_thread나_등록되지_않은_project는_카드를_세우지_않고_그_까닭을_도구의_실패로_돌려준다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server");
    let unknown = json!({"tool": "start_editing", "arguments": {"project": "billing"}});
    let host = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[edit_web_app(), unknown.clone()]));
    let thread = host.start_thread("환불 버튼이 두 번 눌려요", ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    let answer = &answers(&sandbox, &thread)[0];
    assert_eq!(answer["isError"], true, "{answer}");
    assert!(said(answer).contains("propose_work"), "Work부터 만들라고 알린다: {answer}");

    deferred_work(&sandbox, &["api-server"]);
    let host = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[unknown]));
    let thread = host.start_thread("이어서", in_refund()).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    assert!(of_kind(&sandbox.thread_record(&thread), "question").is_empty());
    let answer = &answers(&sandbox, &thread)[0];
    assert_eq!(answer["isError"], true, "{answer}");
    assert!(said(answer).contains("billing") && said(answer).contains("api-server"), "모르는 Project와 등록된 Project를 알린다: {answer}");
}

#[test]
fn 사람이_thread를_멈추면_서_있는_work_밖_project_카드를_거두고_도구는_사람이_멈춤을_돌려준다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server");
    register(&sandbox, "web-app");
    deferred_work(&sandbox, &["api-server"]);
    let host: ConversationHost = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[edit_web_app()]));
    let thread = host.start_thread("환불 버튼이 두 번 눌려요", in_refund()).expect("Work에 이은 Thread");

    let asked = wait_card(&sandbox, &thread, "asked");
    host.stop_thread(&thread).expect("멈추기");
    assert_eq!(
        wait_card(&sandbox, &thread, "withdrawn")["payload"],
        json!({"state": "withdrawn", "requestId": request_of(&asked), "card": "project", "reason": "stopped"})
    );
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    let answer = &answers(&sandbox, &thread)[0];
    assert!(said(answer).starts_with("사람이 멈춤"), "{answer}");
    assert!(!tree(&sandbox, "web-app").exists());
}

#[test]
fn work_없이_시작한_thread가_턴_가운데_work에_이어지면_다음_턴은_같은_session을_spec_폴더에서_이어_연다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let propose = json!({"tool": "propose_work", "arguments": {"title": "환불 API 버그 수정", "slug": "refund-api", "reason": "문서부터"}});
    let host = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[propose]));
    let thread = host.start_thread("환불 API 버그 고쳐줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    let asked = sandbox.wait_thread_record(&thread, |record| {
        of_kind(record, "question").iter().any(|line| line["payload"]["state"] == "asked")
    });
    let request = of_kind(&asked, "question")[0]["payload"]["requestId"].as_str().unwrap().to_owned();
    host.answer_work(&thread, &request, atelier_acp::WorkChoice::Create { projects: Vec::new(), branch: None }).expect("Work 만들기");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let (_, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&sandbox.thread_dir(&thread)), "이은 턴의 작업 폴더는 Thread 폴더 그대로다(v1 티켓 30)");

    let session = sandbox.thread_session_id(&thread, "host");
    host.send_to_thread(&thread, "설계 문서부터 써 줘").expect("다음 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();
    let (args, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&sandbox.work_dir("refund-api").join("spec")), "worktree 없는 Work의 작업 폴더는 spec 폴더다(S11)");
    assert!(has_pair(&args, "--resume", &session), "앞선 조사를 기억하게 같은 Session을 이어 연다(스토리 100): {args:?}");
    let prompt = of_kind(&record, "sent")[1]["payload"]["prompt"].to_string();
    assert!(prompt.contains("- Work: `refund-api`"), "옮겨 연 Session에 이은 Work를 알린다: {prompt}");
}

/// 기록 축복(S26 꼴) — Host가 첫 턴에서 Work 밖 web-app을 고치려 하고, 사람이 「붙이고 고치기」를 고른 기록이 검사 자료로 선다. 화면
/// L2(`fold.test.ts`)와 PR ④의 L3(v1 티켓 40)가 이 파일을 `thread:record`로 흘려 Work 밖 Project 카드 · 결정 줄 「web-app을 이 Work에
/// 붙임」 · 시스템 줄 「web-app에 worktree를 만듦 · fix/refund-api」를 그린다.
#[test]
fn work_밖_project를_붙이고_고친_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server");
    register(&sandbox, "web-app");
    deferred_work(&sandbox, &["api-server"]);
    let host = sandbox.host(calling(&sandbox, "2.1.309/twoturn-tools", &[edit_web_app()]));
    let thread = host.start_thread("환불 버튼이 두 번 눌려요", in_refund()).expect("Work에 이은 Thread");

    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_project(&thread, &request_of(&asked), ProjectChoice::Attach).expect("붙이고 고치기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread, "host");
    let fixed = common::fix_thread_record(&settled(&record), &sandbox.data_root(), &thread, &[&session]);
    let fixed: Vec<Value> = fixed
        .iter()
        .map(|line| serde_json::from_str(&line.to_string().replace(&request_of(&asked), "fake-request")).unwrap())
        .collect();
    common::assert_record("thread-project", &fixed);
}

/// 축복 자료의 차례를 하나로 둔다 — 매번 갈리는 차례를 앞 줄 뒤로 옮기고 seq를 다시 센다(`thread_work.rs`의 `settled`와 같다).
/// - 명령 목록 줄(`available_commands_update`)은 Session을 연 답 뒤에 따로 와 첫 말의 `sent`와 엇갈린다 → 열림 줄 바로 뒤.
///
/// 카드 줄(`question` `asked`)은 도구 호출(중계 서버 → 소켓)이 적고 도구 줄은 claude의 stdout(변환기 → ACP)이 적지만 옮기지 않는다
/// — 엔진이 그 도구 줄이 적힌 뒤에 부르기를 받는다(코드 리뷰 1차 A3).
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
