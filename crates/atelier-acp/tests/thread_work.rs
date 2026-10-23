//! L1 — Work와 이어짐(v1 티켓 30 · 구현 스펙 §7 S13 · §11 · S21): Thread 도구 「Project 목록」 · 「Work 읽기」 · 「Work 만들기 제안」.
//!
//! - Host가 「Work 만들기 제안」을 부르면 Work 만들기 카드가 `question` 줄로 서고, 도구는 사람이 고를 때까지 기다린다.
//! - 「Work 만들기」 — core가 worktree 없이 Work를 만들고(v1 티켓 29), `thread.json`의 `work`가 서고, `work` 줄 「Work … 을 만들고 이
//!   Thread에 연결함」이 남고, 도구가 만든 Work를 돌려준다.
//! - 「Work 없이 계속」 — 아무것도 만들지 않고, 도구가 「사용자가 Work 없이 계속하기로 함」을 돌려준다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 폴더(`thread.json` · `events.jsonl`) · works 폴더 · 등록한 저장소 · 가짜 claude의 MCP 영수증만
//! 본다.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use atelier_acp::{ConversationHost, HostError, ThreadLink, WorkChoice};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ndescription: 시험의 Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 가짜 claude가 첫 턴 앞머리에서 차례로 부를 Thread 도구들 — `FAKE_CLAUDE_MCP_CALL`.
fn calling(sandbox: &Sandbox, calls: &[Value]) -> atelier_acp::ShellSource {
    let calls = Value::Array(calls.to_vec()).to_string();
    sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools"), ("FAKE_CLAUDE_MCP_CALL", &calls)])
}

fn tool(name: &str, arguments: Value) -> Value {
    json!({"tool": name, "arguments": arguments})
}

/// 「환불 API 버그 고쳐줘」에 Host가 내미는 제안 — api-server를 고를 Project로 추천한다(캔버스 Cards 보드 「Work 만들기」).
fn refund_proposal() -> Value {
    tool(
        "propose_work",
        json!({
            "title": "환불 API 버그 수정",
            "slug": "refund-api",
            "reason": "고칠 Project와 브랜치를 골라 두었어요",
            "branch": "fix/refund-api",
            "projects": [{"slug": "api-server", "reason": "refund.service.ts가 여기 있어요"}],
        }),
    )
}

/// 커밋 하나가 있는 git 저장소를 세워 Project로 등록한다 — 등록한 Project의 slug는 폴더 이름이다.
fn register(sandbox: &Sandbox, name: &str, description: &str) -> PathBuf {
    let folder = sandbox.data_root().parent().unwrap().join("repos").join(name);
    std::fs::create_dir_all(&folder).unwrap();
    git(&folder, &["init", "-q", "-b", "main"]);
    git(&folder, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
    let projects = atelier_core::projects_in(&sandbox.data_root());
    let view = atelier_core::create_project(&projects, &folder).expect("Project 등록");
    if !description.is_empty() {
        let patch = atelier_core::ProjectPatch { name: None, description: Some(description.to_owned()), base_branch: None };
        atelier_core::update_project(&projects, &view.project.slug, patch).expect("설명");
    }
    folder
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Work 만들기 카드(`question` · `card: work`)의 그 상태 줄이 나올 때까지 기다린다.
fn wait_card(sandbox: &Sandbox, thread: &str, state: &str) -> Value {
    let of_state = |record: &[Value]| {
        of_kind(record, "question").into_iter().find(|line| line["payload"]["card"] == "work" && line["payload"]["state"] == state).cloned()
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

fn create(projects: &[&str], branch: &str) -> WorkChoice {
    WorkChoice::Create { projects: projects.iter().map(|one| (*one).to_owned()).collect(), branch: Some(branch.to_owned()) }
}

fn started(sandbox: &Sandbox, calls: &[Value]) -> (ConversationHost, String) {
    let host = sandbox.host(calling(sandbox, calls));
    let thread = host.start_thread("환불 API 버그 고쳐줘", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread)
}

#[test]
fn host가_work_만들기를_제안하면_카드가_서고_사람이_만들면_worktree_없는_work가_서고_thread가_이어지며_도구가_그_work를_돌려준다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let api = register(&sandbox, "api-server", "결제 · 환불 API");
    register(&sandbox, "web-app", "환불 버튼 화면");
    let (host, thread) = started(&sandbox, &[refund_proposal()]);

    let asked = wait_card(&sandbox, &thread, "asked");
    assert_eq!(asked["who"], "host", "제안한 Agent가 줄의 who다(S8)");
    let card = &asked["payload"];
    assert_eq!(card["title"], "환불 API 버그 수정");
    assert_eq!(card["slug"], "refund-api");
    assert_eq!(card["reason"], "고칠 Project와 브랜치를 골라 두었어요");
    assert_eq!(card["branch"], "fix/refund-api");
    assert_eq!(
        card["projects"],
        json!([
            {"slug": "api-server", "name": "api-server", "description": "결제 · 환불 API", "recommended": true,
             "reason": "refund.service.ts가 여기 있어요", "branches": ["main"]},
            {"slug": "web-app", "name": "web-app", "description": "환불 버튼 화면", "recommended": false,
             "reason": null, "branches": ["main"]},
        ]),
        "카드는 등록된 Project를 모두 싣는다 — Host 추천이 먼저 그 까닭과 함께, 나머지는 넣을 수 있게(스토리 90)"
    );
    assert!(of_kind(&sandbox.thread_record(&thread), "turn-end").is_empty(), "도구는 사람이 고를 때까지 기다린다 — 턴이 돈다");

    // 사람이 web-app을 넣고 만든다.
    host.answer_work(&thread, &request_of(&asked), create(&["api-server", "web-app"], "fix/refund-api")).expect("Work 만들기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let work: Value = serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("refund-api").join("work.json")).unwrap()).unwrap();
    assert_eq!(work["title"], "환불 API 버그 수정");
    assert_eq!(work["projects"], json!(["api-server", "web-app"]), "카드에서 넣은 Project가 든다");
    assert_eq!(work["branch"], "fix/refund-api");
    assert!(!sandbox.work_dir("refund-api").join("trees").exists(), "worktree는 처음 고칠 때 만든다(S21)");
    assert!(!git(&api, &["branch", "--list", "fix/refund-api"]).contains("fix/refund-api"), "저장소에 브랜치도 아직 없다");
    assert!(sandbox.work_dir("refund-api").join("spec").is_dir(), "spec 폴더는 선다");

    assert_eq!(sandbox.thread_json(&thread)["work"], "refund-api", "Thread와 Work의 연결은 thread.json의 work 한 곳이다(§19)");
    let answered = wait_card(&sandbox, &thread, "answered");
    assert_eq!(
        answered["payload"],
        json!({"state": "answered", "requestId": request_of(&asked), "card": "work", "choice": "create",
               "work": "refund-api", "projects": ["api-server", "web-app"], "branch": "fix/refund-api"})
    );
    let linked = of_kind(&record, "work");
    assert_eq!(linked.len(), 1, "{}", common::lines_text(&record));
    assert!(linked[0].get("who").is_none(), "사람이 고른 일이라 work 줄에 who가 없다(S8): {}", linked[0]);
    assert_eq!(
        linked[0]["payload"],
        json!({"state": "created", "slug": "refund-api", "title": "환불 API 버그 수정", "branch": "fix/refund-api",
               "projects": ["api-server", "web-app"]}),
        "시스템 줄 「Work 환불 API 버그 수정을 만들고 이 Thread에 연결함」이 이것을 읽는다"
    );
    let at = |line: &Value| record.iter().position(|seen| seen == line).unwrap();
    let ended = record.iter().position(|line| line["kind"] == "turn-end").unwrap();
    assert!(at(linked[0]) < ended, "Work는 그 턴 안에서 선다:\n{}", common::lines_text(&record));

    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "{answer}");
    let text = answer["content"][0]["text"].as_str().unwrap();
    let spec = sandbox.work_dir("refund-api").join("spec");
    assert!(text.contains("refund-api") && text.contains(&spec.display().to_string()), "도구가 만든 Work와 spec 폴더를 돌려준다:\n{text}");
    assert!(text.contains("api-server") && text.contains("읽기만"), "Project마다 아직 읽기만이라고 알린다:\n{text}");
}

#[test]
fn work_없이_계속을_고르면_아무것도_만들지_않고_도구가_사용자가_work_없이_계속하기로_함을_돌려준다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server", "");
    let (host, thread) = started(&sandbox, &[refund_proposal()]);

    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_work(&thread, &request_of(&asked), WorkChoice::Continue).expect("Work 없이 계속");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    assert!(!sandbox.work_dir("refund-api").exists(), "Work가 서지 않는다(스토리 92)");
    assert!(sandbox.thread_json(&thread).get("work").is_none_or(Value::is_null), "Thread는 Work 없이 이어 간다");
    assert!(of_kind(&record, "work").is_empty(), "{}", common::lines_text(&record));
    assert_eq!(
        wait_card(&sandbox, &thread, "answered")["payload"],
        json!({"state": "answered", "requestId": request_of(&asked), "card": "work", "choice": "continue"}),
        "결정한 뒤 「Work 없이 계속함」이 이 줄을 읽는다"
    );
    let answer = &answers(&sandbox, &thread)[0];
    assert_ne!(answer["isError"], true, "고른 것이지 실패가 아니다: {answer}");
    assert!(
        answer["content"][0]["text"].as_str().unwrap().starts_with("사용자가 Work 없이 계속하기로 함"),
        "도구 결과로 그렇게 돌려준다(§11): {answer}"
    );
    assert_eq!(
        host.answer_work(&thread, &request_of(&asked), WorkChoice::Continue),
        Err(HostError::QuestionClosed { thread: thread.clone(), request: request_of(&asked) }),
        "닫힌 카드에는 답하지 못한다"
    );
}

#[test]
fn 만들지_못하면_아무것도_적지_않고_카드가_그대로_서며_고쳐서_다시_고르면_선다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let api = register(&sandbox, "api-server", "");
    git(&api, &["branch", "fix/refund-api"]);
    let (host, thread) = started(&sandbox, &[refund_proposal()]);

    let asked = wait_card(&sandbox, &thread, "asked");
    let refused = host.answer_work(&thread, &request_of(&asked), create(&["api-server"], "fix/refund-api"));
    assert!(matches!(&refused, Err(HostError::WorkNotCreated(why)) if why.contains("fix/refund-api")), "{refused:?}");
    assert!(!sandbox.work_dir("refund-api").exists(), "아무것도 만들지 않는다");
    assert!(sandbox.thread_json(&thread).get("work").is_none_or(Value::is_null));
    let record = sandbox.thread_record(&thread);
    assert!(
        of_kind(&record, "question").iter().all(|line| line["payload"]["state"] == "asked"),
        "카드는 그대로 서 있다: {}",
        common::lines_text(&record)
    );

    host.answer_work(&thread, &request_of(&asked), create(&["api-server"], "fix/refund-api-2")).expect("고친 브랜치로 만든다");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    assert_eq!(sandbox.thread_json(&thread)["work"], "refund-api");
    let work: Value = serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("refund-api").join("work.json")).unwrap()).unwrap();
    assert_eq!(work["branch"], "fix/refund-api-2", "카드에서 고친 브랜치가 든다(스토리 90)");
}

#[test]
fn 카드를_세울_수_없는_제안은_그_까닭을_도구의_실패로_돌려주고_카드를_세우지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server", "");
    sandbox.work("cart", &[]);
    let unknown = tool("propose_work", json!({"title": "t", "slug": "t-1", "reason": "r", "projects": [{"slug": "web-app"}]}));
    let taken = tool("propose_work", json!({"title": "t", "slug": "cart", "reason": "r"}));
    let (host, thread) = started(&sandbox, &[unknown, taken]);
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let record = sandbox.thread_record(&thread);
    assert!(of_kind(&record, "question").is_empty(), "{}", common::lines_text(&record));
    let said: Vec<(Value, String)> = answers(&sandbox, &thread)
        .into_iter()
        .map(|answer| (answer["isError"].clone(), answer["content"][0]["text"].as_str().unwrap().to_owned()))
        .collect();
    assert_eq!(said[0].0, true);
    assert!(said[0].1.contains("web-app") && said[0].1.contains("api-server"), "모르는 Project와 등록된 Project를 알린다: {}", said[0].1);
    assert_eq!(said[1].0, true);
    assert!(said[1].1.contains("cart") && said[1].1.contains("이미 있다"), "{}", said[1].1);

    // Work에 이은 Thread에서는 제안하지 못한다 — 그 Work를 읽는다.
    let host = sandbox.host(calling(&sandbox, &[refund_proposal()]));
    let linked = host.start_thread("이어서 하자", ThreadLink::Work { slug: "cart".into() }).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&linked, "turn-end", 1);
    host.shut_down();
    let answer = &answers(&sandbox, &linked)[0];
    assert_eq!(answer["isError"], true, "{answer}");
    assert!(answer["content"][0]["text"].as_str().unwrap().contains("이미 Work `cart`에 이어져 있다"), "{answer}");
}

#[test]
fn 사람이_thread를_멈추면_서_있는_카드를_거두고_도구는_사람이_멈춤을_돌려준다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server", "");
    let (host, thread) = started(&sandbox, &[refund_proposal()]);

    let asked = wait_card(&sandbox, &thread, "asked");
    host.stop_thread(&thread).expect("멈추기");
    let withdrawn = wait_card(&sandbox, &thread, "withdrawn");
    assert_eq!(
        withdrawn["payload"],
        json!({"state": "withdrawn", "requestId": request_of(&asked), "card": "work", "reason": "stopped"}),
        "화면이 카드를 걷는다"
    );
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    let answer = &answers(&sandbox, &thread)[0];
    assert_eq!(answer["isError"], true, "{answer}");
    assert!(answer["content"][0]["text"].as_str().unwrap().starts_with("사람이 멈춤"), "{answer}");
    assert!(!sandbox.work_dir("refund-api").exists());
}

#[test]
fn project_목록은_등록된_project와_그_브랜치를_돌려주고_work_읽기는_이은_work의_spec_폴더와_project를_돌려준다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let api = register(&sandbox, "api-server", "결제 · 환불 API");
    git(&api, &["branch", "fix/login-timeout"]);
    let calls = [tool("list_projects", json!({})), tool("get_work", json!({}))];

    let (host, thread) = started(&sandbox, &calls);
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();
    let said = answers(&sandbox, &thread);
    let projects: Value = serde_json::from_str(said[0]["content"][0]["text"].as_str().unwrap()).expect("Project 목록은 JSON이다");
    assert_eq!(projects[0]["slug"], "api-server");
    assert_eq!(projects[0]["description"], "결제 · 환불 API");
    assert_eq!(projects[0]["git"]["localBranches"], json!(["fix/login-timeout", "main"]), "브랜치 이름 규칙이 여기서 나온다");
    assert!(said[1]["content"][0]["text"].as_str().unwrap().contains("아직 Work에 이어지지 않았다"), "{}", said[1]);

    let work = sandbox.work("cart", &["api-server"]);
    std::fs::remove_dir_all(work.join("trees")).unwrap();
    let host = sandbox.host(calling(&sandbox, &calls[1..]));
    let linked = host.start_thread("이어서 하자", ThreadLink::Work { slug: "cart".into() }).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&linked, "turn-end", 1);
    host.shut_down();
    let read = answers(&sandbox, &linked)[0]["content"][0]["text"].as_str().unwrap().to_owned();
    assert!(read.contains("`cart`") && read.contains(&work.join("spec").display().to_string()), "{read}");
    assert!(read.contains("Project `api-server`: 읽기만"), "worktree가 없는 Project는 읽기만이다(S21): {read}");
}

#[test]
fn thread에서_고른_물어보는_정도는_이은_work로_옮겨_간다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server", "");
    let host = sandbox.host(calling(&sandbox, &[refund_proposal()]));
    let thread = host
        .start_thread_asking("환불 API 버그 고쳐줘", &[], ThreadLink::NoWork, Some(atelier_acp::AskLevel::Edits))
        .expect("편집은 허용으로 시작한 Thread");

    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_work(&thread, &request_of(&asked), WorkChoice::Create { projects: Vec::new(), branch: None }).expect("기획만인 Work");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    assert_eq!(
        host.thread(&thread).expect("Thread").ask_level,
        atelier_acp::AskLevel::Edits,
        "이은 뒤로는 Work의 정도를 쓴다(S18) — 고른 정도가 말없이 바뀌지 않는다"
    );
    host.shut_down();
    let work: Value = serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("refund-api").join("work.json")).unwrap()).unwrap();
    assert_eq!(work["projects"], json!([]), "Project 없이 기획만으로 Work가 선다(스토리 97)");
    assert!(work.get("branch").is_none_or(Value::is_null), "Project가 없으면 브랜치를 정하지 않는다");
}

/// 기록 축복(S26 꼴) — Host가 첫 턴에서 Work 만들기를 제안하고, 사람이 web-app을 넣어 만든 기록이 검사 자료로 선다. 화면 L2(`fold.test.ts`)와
/// PR ④의 L3(v1 티켓 40)가 이 파일을 `thread:record`로 흘려 카드 · 결정 줄 · 시스템 줄 「Work … 을 만들고 이 Thread에 연결함」을 그린다.
#[test]
fn work_만들기를_제안하고_만든_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "api-server", "결제 · 환불 API");
    register(&sandbox, "web-app", "환불 버튼 화면");
    let (host, thread) = started(&sandbox, &[refund_proposal()]);

    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_work(&thread, &request_of(&asked), create(&["api-server", "web-app"], "fix/refund-api")).expect("Work 만들기");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread, "host");
    let fixed = common::fix_thread_record(&settled(&record), &sandbox.data_root(), &thread, &[&session]);
    let fixed: Vec<Value> = fixed
        .iter()
        .map(|line| serde_json::from_str(&line.to_string().replace(&request_of(&asked), "fake-request")).unwrap())
        .collect();
    common::assert_record("thread-work", &fixed);
}

/// 축복 자료의 차례를 하나로 둔다 — 매번 갈리는 두 차례를 앞 줄 뒤로 옮기고 seq를 다시 센다.
/// - 명령 목록 줄(`available_commands_update`)은 Session을 연 답 뒤에 따로 와 첫 말의 `sent`와 엇갈린다 → 열림 줄 바로 뒤.
/// - 카드 줄(`question` `asked`)은 도구 호출(중계 서버 → 소켓)이 적고 도구 줄은 claude의 stdout(변환기 → ACP)이 적어 둘이 엇갈린다 →
///   그 도구 줄 바로 뒤.
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
    after(&|line| line["kind"] == "question" && line["payload"]["state"] == "asked", &|line| {
        line["payload"]["update"]["sessionUpdate"] == "tool_call"
    });
    for (n, line) in lines.iter_mut().enumerate() {
        line["seq"] = json!(n + 1);
    }
    lines
}
