//! L1 — Host가 대화로 Project · Space를 추가하고 고친다(03 티켓 12 · 구현 스펙 §12 · S13): Thread 도구 「Project 추가」 · 「Project 고치기」 ·
//! 「Space 만들기」 · 「Space 고치기」.
//!
//! - 네 도구는 화면과 같은 core 함수를 부르고 같은 파일을 같은 꼴로 쓴다. 승인 카드를 세우지 않는다(S13).
//! - 「Project 추가」는 폴더를 살핀다 — 이미 등록된 폴더는 바꾸지 않고, git이 아닌 폴더 · 저장소의 하위 폴더는 질문 카드(`question` · `card:
//!   project-add`)로 묻고 사람이 고른 대로 한다.
//! - 없는 기준 브랜치 · 문제 있는 Space는 실패하고 그 까닭(고를 수 있는 브랜치 · 문제)을 Host에게 준다.
//! - 해낸 설정마다 흐름에 결과 카드 줄(`setting`)이 하나 선다 — 무엇을 했나 · 대상 slug · 이름 · 첫 줄 · 둘째 줄.
//! - 지우는 도구는 없다 — 머리말이 그 화면을 안내하라고 지시한다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 폴더(`events.jsonl`) · Project · Space 파일 · 가짜 claude의 MCP 영수증만 본다.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use atelier_acp::{ConversationHost, HostError, ProjectAddChoice, ThreadLink};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ndescription: 시험의 Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 결제 서비스 Space — web-app · api-server(캔버스 ④ 「결제 서비스」).
const PAYMENTS: &str = "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\ncreatedAt: 2026-10-23\n---\n\n결제와 환불을 한 흐름으로 다뤄요.\n";

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

/// 사람의 저장소 자리 — 데이터 루트 곁의 `repos/`(축복 기록에서는 `~/MyProjects`가 된다). 링크를 푼 자리다.
fn repos(sandbox: &Sandbox) -> PathBuf {
    let dir = sandbox.data_root().parent().unwrap().join("repos");
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

/// 커밋 하나가 있는 git 저장소를 세운다 — 아직 등록하지 않는다.
fn repo(sandbox: &Sandbox, name: &str) -> PathBuf {
    let folder = repos(sandbox).join(name);
    std::fs::create_dir_all(&folder).unwrap();
    git(&folder, &["init", "-q", "-b", "main"]);
    git(&folder, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
    folder
}

/// 저장소를 세워 Project로 등록한다 — 등록한 Project의 slug는 폴더 이름이다.
fn register(sandbox: &Sandbox, name: &str) -> PathBuf {
    let folder = repo(sandbox, name);
    atelier_core::create_project(&projects(sandbox), &folder).expect("Project 등록");
    folder
}

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

fn projects(sandbox: &Sandbox) -> PathBuf {
    atelier_core::projects_in(&sandbox.data_root())
}

/// Space 파일 하나를 둔다.
fn space(sandbox: &Sandbox, slug: &str, text: &str) {
    let spaces = atelier_core::spaces_in(&sandbox.data_root());
    std::fs::create_dir_all(&spaces).unwrap();
    std::fs::write(spaces.join(format!("{slug}.md")), text).unwrap();
}

fn space_text(sandbox: &Sandbox, slug: &str) -> Option<String> {
    std::fs::read_to_string(atelier_core::spaces_in(&sandbox.data_root()).join(format!("{slug}.md"))).ok()
}

fn project_text(sandbox: &Sandbox, slug: &str) -> Option<String> {
    std::fs::read_to_string(projects(sandbox).join(format!("{slug}.md"))).ok()
}

/// Work 없는 새 Thread — 첫 턴에 Host가 `calls`를 부른다.
fn thread_calling(sandbox: &Sandbox, calls: &[Value]) -> (ConversationHost, String) {
    sandbox.library_agent("host", HOST_MD);
    let host = sandbox.host(calling(sandbox, calls));
    let thread = host.start_thread("설정 좀 해 줘", ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread)
}

/// 첫 턴이 끝난 기록 — 호스트를 끈다.
fn first_turn(sandbox: &Sandbox, host: ConversationHost, thread: &str) -> Vec<Value> {
    let record = sandbox.wait_thread_kind(thread, "turn-end", 1);
    host.shut_down();
    record
}

/// 그 Session의 claude가 부른 도구의 답 — 부른 차례대로 (실패인가, 글).
fn answers(sandbox: &Sandbox, thread: &str) -> Vec<(bool, String)> {
    sandbox
        .claude_mcp(&sandbox.thread_session_id(thread, "host"))
        .into_iter()
        .map(|call| (call["call"]["isError"] == true, call["call"]["content"][0]["text"].as_str().expect("글 결과").to_owned()))
        .collect()
}

/// 결과 카드 줄(`setting`)들.
fn settings(record: &[Value]) -> Vec<&Value> {
    of_kind(record, "setting")
}

#[test]
fn git_저장소를_추가하면_화면과_같은_project_파일이_서고_결과_카드_한_장이_남는다() {
    let sandbox = Sandbox::new();
    let folder = repo(&sandbox, "landing-page");
    let add = tool("add_project", json!({"path": folder, "description": "랜딩 페이지 — 가입 흐름"}));
    let (host, thread) = thread_calling(&sandbox, &[add]);
    let record = first_turn(&sandbox, host, &thread);

    let view = atelier_core::get_project(&projects(&sandbox), "landing-page").expect("등록된 Project");
    assert_eq!(view.project.path, atelier_core::collapse_home(&folder));
    assert_eq!(view.project.base_branch, "main");
    assert_eq!(view.project.description, "랜딩 페이지 — 가입 흐름");
    assert_eq!(
        project_text(&sandbox, "landing-page").unwrap(),
        atelier_core::render_project(&view.project),
        "화면의 추가와 같은 꼴(core 추가 · 고치기)로 쓴다"
    );
    assert!(of_kind(&record, "question").is_empty() && of_kind(&record, "permission").is_empty(), "묻지 않는다(S13)");
    let lines = settings(&record);
    assert_eq!(lines.len(), 1, "{}", common::lines_text(&record));
    assert_eq!(lines[0]["who"], "host", "한 Agent가 줄의 who다");
    assert_eq!(
        lines[0]["payload"],
        json!({
            "action": "project-added", "slug": "landing-page", "name": "landing-page",
            "title": "Project를 추가했어요 — landing-page",
            "detail": format!("{} · git 레포 · 기준 브랜치 main", atelier_core::collapse_home(&folder)),
        }),
        "흐름의 결과 카드가 이것을 그린다"
    );
    let (refused, said) = &answers(&sandbox, &thread)[0];
    assert!(!refused, "{said}");
    assert!(said.starts_with("Project `landing-page`(landing-page)를 추가했다"), "{said}");
}

#[test]
fn 이미_등록된_폴더는_이름도_설명도_바꾸지_않고_그렇다고_말하며_결과_카드가_없다() {
    let sandbox = Sandbox::new();
    let folder = register(&sandbox, "web-app");
    let before = project_text(&sandbox, "web-app").unwrap();
    let add = tool("add_project", json!({"path": folder, "name": "다른 이름", "description": "덮으면 안 된다"}));
    let (host, thread) = thread_calling(&sandbox, &[add]);
    let record = first_turn(&sandbox, host, &thread);

    assert_eq!(project_text(&sandbox, "web-app").unwrap(), before, "아무것도 바꾸지 않는다(스토리 61)");
    assert!(settings(&record).is_empty() && of_kind(&record, "question").is_empty(), "{}", common::lines_text(&record));
    let (refused, said) = &answers(&sandbox, &thread)[0];
    assert!(!refused, "실패가 아니라 그렇다는 말이다: {said}");
    assert!(said.starts_with("이미 등록된 폴더다 — Project `web-app`(web-app)"), "{said}");
    assert!(said.ends_with("아무것도 바꾸지 않았다."), "{said}");
}

#[test]
fn 없는_폴더는_도구의_실패다() {
    let sandbox = Sandbox::new();
    let gone = repos(&sandbox).join("nowhere");
    let (host, thread) = thread_calling(&sandbox, &[tool("add_project", json!({"path": gone}))]);
    let record = first_turn(&sandbox, host, &thread);

    assert!(settings(&record).is_empty());
    let (refused, said) = &answers(&sandbox, &thread)[0];
    assert!(*refused && said.starts_with("폴더가 없다: `"), "{said}");
}

/// Project 추가 카드(`question` · `card: project-add`)의 그 상태 줄이 나올 때까지 기다린다.
fn wait_card(sandbox: &Sandbox, thread: &str, state: &str) -> Value {
    let of_state = |record: &[Value]| {
        of_kind(record, "question")
            .into_iter()
            .find(|line| line["payload"]["card"] == "project-add" && line["payload"]["state"] == state)
            .cloned()
    };
    let record = sandbox.wait_thread_record(thread, |record| of_state(record).is_some());
    of_state(&record).unwrap()
}

fn request_of(asked: &Value) -> String {
    asked["payload"]["requestId"].as_str().expect("요청 id").to_owned()
}

/// git이 아닌 폴더 — 메모 몇 장이 든다.
fn notes(sandbox: &Sandbox) -> PathBuf {
    let folder = repos(sandbox).join("notes");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("todo.md"), "할 일\n").unwrap();
    folder
}

/// 이 실행의 git 전역 설정 — 이름 · 이메일만 든 한 장(엔진이 같은 프로세스에서 git으로 첫 커밋을 한다). 시스템 설정도 끈다(기계마다
/// 다른 `init.defaultBranch` · 훅이 끼지 않게 — core `project_add.rs`와 같은 꼴).
fn git_identity() {
    static ONCE: OnceLock<PathBuf> = OnceLock::new();
    ONCE.get_or_init(|| {
        let file = std::env::temp_dir().join(format!("atelier-thread-setting-{}.gitconfig", std::process::id()));
        std::fs::write(&file, "[user]\n\tname = t\n\temail = t@t\n").unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &file);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        file
    });
}

#[test]
fn git이_아닌_폴더는_질문_카드로_묻고_git_init_하고_추가를_고르면_빈_저장소를_세워_main으로_등록한다() {
    git_identity();
    let sandbox = Sandbox::new();
    let folder = notes(&sandbox);
    let (host, thread) = thread_calling(&sandbox, &[tool("add_project", json!({"path": folder}))]);

    let asked = wait_card(&sandbox, &thread, "asked");
    assert_eq!(asked["who"], "host");
    let mut card = asked["payload"].clone();
    card.as_object_mut().unwrap().remove("requestId");
    let path = atelier_core::collapse_home(&folder);
    assert_eq!(
        card,
        json!({"state": "asked", "card": "project-add", "look": "notGit", "path": path, "folder": "notes", "root": null}),
        "화면 추가 창과 같은 물음 — 「notes는 git 저장소가 아니에요」"
    );
    assert!(project_text(&sandbox, "notes").is_none(), "고르기 전에는 등록하지 않는다");
    assert!(of_kind(&sandbox.thread_record(&thread), "turn-end").is_empty(), "도구는 사람이 고를 때까지 기다린다");
    assert_eq!(
        host.answer_project_add(&thread, &request_of(&asked), ProjectAddChoice::Root),
        Err(HostError::ProjectNotAdded("이 카드에 없는 답이에요 — root".into())),
        "git이 아닌 폴더에 뿌리는 없다 — 카드는 그대로 선다"
    );

    host.answer_project_add(&thread, &request_of(&asked), ProjectAddChoice::Init).expect("git init 하고 추가");
    let record = first_turn(&sandbox, host, &thread);
    assert!(folder.join(".git").is_dir(), "빈 저장소를 세운다");
    assert!(folder.join("todo.md").is_file(), "파일은 그대로다");
    let view = atelier_core::get_project(&projects(&sandbox), "notes").expect("등록된 Project");
    assert_eq!(view.project.base_branch, "main");
    assert_eq!(
        wait_card(&sandbox, &thread, "answered")["payload"],
        json!({"state": "answered", "requestId": request_of(&asked), "card": "project-add", "choice": "init", "project": "notes"})
    );
    let lines = settings(&record);
    assert_eq!(lines.len(), 1, "{}", common::lines_text(&record));
    assert_eq!(lines[0]["payload"]["title"], "Project를 추가했어요 — notes");
    assert_eq!(lines[0]["payload"]["detail"], format!("{path} · git 레포 · 기준 브랜치 main"));
    let (refused, said) = &answers(&sandbox, &thread)[0];
    assert!(!refused && said.starts_with("Project `notes`(notes)를 추가했다"), "{said}");
}

#[test]
fn 추가하지_않기를_고르면_아무것도_하지_않는다() {
    let sandbox = Sandbox::new();
    let folder = notes(&sandbox);
    let (host, thread) = thread_calling(&sandbox, &[tool("add_project", json!({"path": folder}))]);
    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_project_add(&thread, &request_of(&asked), ProjectAddChoice::Decline).expect("추가하지 않기");
    let record = first_turn(&sandbox, host, &thread);

    assert!(!folder.join(".git").exists() && project_text(&sandbox, "notes").is_none());
    assert!(settings(&record).is_empty());
    assert_eq!(wait_card(&sandbox, &thread, "answered")["payload"]["choice"], "decline");
    assert_eq!(wait_card(&sandbox, &thread, "answered")["payload"]["project"], Value::Null);
    let (refused, said) = &answers(&sandbox, &thread)[0];
    assert!(!refused && said.starts_with("사람이 추가하지 않기로 했다"), "{said}");
    assert_eq!(
        host_closed(&sandbox, &thread, &request_of(&asked)),
        Err(HostError::QuestionClosed { thread: thread.clone(), request: request_of(&asked) }),
        "닫힌 카드에는 답하지 못한다"
    );
}

/// 끈 호스트 뒤에 새 호스트로 닫힌 카드에 답한다.
fn host_closed(sandbox: &Sandbox, thread: &str, request: &str) -> Result<(), HostError> {
    let host = sandbox.host(calling(sandbox, &[]));
    let answered = host.answer_project_add(thread, request, ProjectAddChoice::Decline);
    host.shut_down();
    answered
}

#[test]
fn 저장소의_하위_폴더는_뿌리_그대로_추가하지_않기를_묻고_뿌리_폴더로_추가하면_그_저장소를_등록한다() {
    let sandbox = Sandbox::new();
    let api = repo(&sandbox, "api-server");
    let docs = api.join("docs");
    std::fs::create_dir_all(&docs).unwrap();
    let (host, thread) = thread_calling(&sandbox, &[tool("add_project", json!({"path": docs, "name": "API 서버"}))]);

    let asked = wait_card(&sandbox, &thread, "asked");
    assert_eq!(asked["payload"]["look"], "subfolder");
    assert_eq!(asked["payload"]["folder"], "docs");
    assert_eq!(asked["payload"]["root"], atelier_core::collapse_home(&api), "「api-server 저장소 안의 폴더예요」 — 뿌리를 싣는다");
    host.answer_project_add(&thread, &request_of(&asked), ProjectAddChoice::Root).expect("뿌리 폴더로 추가");
    let record = first_turn(&sandbox, host, &thread);

    let view = atelier_core::get_project(&projects(&sandbox), "api-server").expect("뿌리가 Project다");
    assert_eq!(view.project.path, atelier_core::collapse_home(&api));
    assert_eq!(view.project.name, "API 서버", "Host가 준 이름은 고른 폴더에 든다");
    assert!(project_text(&sandbox, "docs").is_none());
    assert_eq!(settings(&record)[0]["payload"]["title"], "Project를 추가했어요 — API 서버");
}

#[test]
fn 하위_폴더를_그대로_추가하면_그_폴더가_project다() {
    let sandbox = Sandbox::new();
    let docs = repo(&sandbox, "api-server").join("docs");
    std::fs::create_dir_all(&docs).unwrap();
    let (host, thread) = thread_calling(&sandbox, &[tool("add_project", json!({"path": docs}))]);
    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_project_add(&thread, &request_of(&asked), ProjectAddChoice::AsIs).expect("그대로 추가");
    let record = first_turn(&sandbox, host, &thread);

    assert_eq!(atelier_core::get_project(&projects(&sandbox), "docs").expect("하위 폴더가 Project다").project.path, atelier_core::collapse_home(&docs));
    assert_eq!(wait_card(&sandbox, &thread, "answered")["payload"]["choice"], "as-is");
    assert_eq!(settings(&record).len(), 1);
}

#[test]
fn 없는_기준_브랜치는_쓰지_않고_고를_수_있는_브랜치를_돌려주며_있는_브랜치면_고치고_결과_카드를_남긴다() {
    let sandbox = Sandbox::new();
    let web = register(&sandbox, "web-app");
    git(&web, &["branch", "develop"]);
    let before = project_text(&sandbox, "web-app").unwrap();
    let calls = [
        tool("edit_project", json!({"project": "web-app", "baseBranch": "release/2.5"})),
        tool("edit_project", json!({"project": "billing", "description": "결제"})),
        tool("edit_project", json!({"project": "web-app", "baseBranch": "develop"})),
        tool("edit_project", json!({"project": "web-app", "baseBranch": "develop"})),
        tool("edit_project", json!({"project": "web-app", "name": "웹 앱", "description": "환불 버튼 화면\n둘째 줄"})),
    ];
    let (host, thread) = thread_calling(&sandbox, &calls);
    let record = first_turn(&sandbox, host, &thread);
    let said = answers(&sandbox, &thread);

    assert!(said[0].0, "없는 기준 브랜치는 도구의 실패다: {}", said[0].1);
    assert_eq!(
        said[0].1,
        "기준 브랜치 `release/2.5`는 web-app 저장소에 없다 — 바꾸지 않았다. 고를 수 있는 브랜치: 로컬 develop, main. Atelier는 fetch하지 \
         않는다 — 원격 브랜치는 origin/<이름> 그대로 준다.",
        "고를 수 있는 브랜치를 글로 준다(스토리 63)"
    );
    assert!(said[1].0 && said[1].1.starts_with("등록되지 않은 Project다: billing — 등록된 Project(list_projects): web-app"), "{}", said[1].1);
    assert!(!said[2].0 && said[2].1.starts_with("Project `web-app`을 고쳤다"), "{}", said[2].1);
    assert_eq!(said[3], (false, "바뀐 것이 없다 — Project `web-app`는 그대로다.".to_owned()), "같은 값이면 카드가 없다");
    let view = atelier_core::get_project(&projects(&sandbox), "web-app").unwrap();
    assert_eq!((view.project.name.as_str(), view.project.base_branch.as_str()), ("웹 앱", "develop"));
    assert_eq!(view.project.description, "환불 버튼 화면\n둘째 줄");
    assert_ne!(project_text(&sandbox, "web-app").unwrap(), before);
    assert_eq!(project_text(&sandbox, "web-app").unwrap(), atelier_core::render_project(&view.project), "화면의 고치기와 같은 꼴");

    let cards: Vec<Value> = settings(&record).iter().map(|line| line["payload"].clone()).collect();
    assert_eq!(
        cards,
        [
            json!({"action": "project-edited", "slug": "web-app", "name": "web-app",
                   "title": "web-app의 기준 브랜치를 develop으로 바꿨어요", "detail": "새 Work부터 develop에서 갈라져요"}),
            json!({"action": "project-edited", "slug": "web-app", "name": "웹 앱",
                   "title": "웹 앱의 이름 · 설명을 바꿨어요", "detail": "파일 이름(web-app.md)과 경로는 그대로예요 · 환불 버튼 화면"}),
        ],
        "해낸 고침마다 카드 한 장 — 실패 · 바뀐 것 없음에는 없다"
    );
}

#[test]
fn space를_만들면_만든_이가_host인_파일이_서고_문제가_있으면_만들지_않고_그_문제를_돌려준다() {
    let sandbox = Sandbox::new();
    register(&sandbox, "api-server");
    let calls = [
        tool("create_space", json!({"name": "정산", "projects": ["api-server", "billing"]})),
        tool("create_space", json!({"name": "정산", "projects": ["api-server"], "description": "월말 정산을 다뤄요."})),
        tool("create_space", json!({"name": "정산", "projects": []})),
    ];
    let (host, thread) = thread_calling(&sandbox, &calls);
    let record = first_turn(&sandbox, host, &thread);
    let said = answers(&sandbox, &thread);

    assert!(said[0].0, "{}", said[0].1);
    assert_eq!(
        said[0].1,
        "Space 파일에 문제가 있어요 — 5행 등록되지 않은 Project예요(billing) — 만들지 않았다. 등록된 Project(list_projects): api-server",
        "화면 · 저장과 같은 문제의 말"
    );
    let text = space_text(&sandbox, "정산").expect("만든 Space 파일");
    assert!(text.starts_with("---\nname: 정산\nprojects:\n  - api-server\ncreatedAt: "), "{text}");
    assert!(text.ends_with("\ncreatedBy: host\n---\n\n월말 정산을 다뤄요.\n"), "만든 이는 host다(S6): {text}");
    assert!(space_text(&sandbox, "정산-2").is_some(), "같은 이름이면 화면과 같이 -2(스토리 69)");
    assert!(!said[1].0 && said[1].1.starts_with("Space `정산`(정산)을 만들었다"), "{}", said[1].1);

    let spaces = atelier_core::spaces_in(&sandbox.data_root());
    let cards: Vec<Value> = settings(&record).iter().map(|line| line["payload"].clone()).collect();
    assert_eq!(
        cards,
        [
            json!({"action": "space-created", "slug": "정산", "name": "정산", "title": "Space를 만들었어요 — 정산",
                   "detail": format!("api-server · {}", atelier_core::collapse_home(&spaces.join("정산.md")))}),
            json!({"action": "space-created", "slug": "정산-2", "name": "정산", "title": "Space를 만들었어요 — 정산",
                   "detail": format!("Project 없음 · {}", atelier_core::collapse_home(&spaces.join("정산-2.md")))}),
        ]
    );
}

#[test]
fn space를_고치면_고친_칸만_바뀌고_결과_카드가_project_수와_함께_쓰는_space를_말한다() {
    let sandbox = Sandbox::new();
    for name in ["web-app", "api-server", "backoffice"] {
        register(&sandbox, name);
    }
    let payments = format!("{PAYMENTS}\n<!-- 손으로 적은 주석 -->\n");
    space(&sandbox, "결제-서비스", &payments);
    space(&sandbox, "사내-도구", TOOLS);
    let calls = [
        tool("edit_space", json!({"space": "결제-서비스", "add": ["backoffice"]})),
        tool("edit_space", json!({"space": "결제-서비스", "add": ["billing"]})),
        tool("edit_space", json!({"space": "정산", "remove": ["web-app"]})),
        tool("edit_space", json!({"space": "결제-서비스", "add": ["backoffice"]})),
    ];
    let (host, thread) = thread_calling(&sandbox, &calls);
    let record = first_turn(&sandbox, host, &thread);
    let said = answers(&sandbox, &thread);

    assert_eq!(
        space_text(&sandbox, "결제-서비스").unwrap(),
        payments.replace("  - api-server\n", "  - api-server\n  - backoffice\n"),
        "그 항목 줄만 끼운다 — 주석 · 나머지 글은 그대로(화면 상세의 넣기와 같은 core 고치기)"
    );
    assert!(!said[0].0 && said[0].1.starts_with("Space `결제-서비스`(결제 서비스)를 고쳤다 — Project: web-app, api-server, backoffice"), "{}", said[0].1);
    assert!(said[1].0 && said[1].1.contains("등록되지 않은 Project예요(billing)") && said[1].1.contains("고치지 않았다"), "{}", said[1].1);
    assert!(said[2].0 && said[2].1.starts_with("없는 Space다: 정산 — Space(list_spaces): 결제-서비스, 사내-도구"), "{}", said[2].1);
    assert_eq!(said[3], (false, "바뀐 것이 없다 — Space `결제-서비스`는 그대로다.".to_owned()));
    let cards: Vec<Value> = settings(&record).iter().map(|line| line["payload"].clone()).collect();
    assert_eq!(
        cards,
        [json!({"action": "space-edited", "slug": "결제-서비스", "name": "결제 서비스", "title": "결제 서비스에 backoffice를 넣었어요",
                "detail": "Project 3 · 함께 쓰는 Space 1"})],
        "캔버스 F4-KitChat 「Space 고침」 칸 — 「관계 보기」"
    );
}

#[test]
fn 머리말은_설정_도구_넷을_알리고_지우기_부탁에는_화면을_안내하라고_하며_space는_초안부터_보이라고_한다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_calling(&sandbox, &[]);
    let record = first_turn(&sandbox, host, &thread);

    let preamble = of_kind(&record, "sent")[0]["payload"]["prompt"][0]["text"].as_str().expect("머리말").to_owned();
    let lines: Vec<&str> = preamble.lines().map(str::trim_start).collect();
    for head in [
        "- `add_project`(path, name, description)",
        "- `edit_project`(project, name, description, baseBranch)",
        "- `create_space`(name, projects, description)",
        "- `edit_space`(space, name, description, add, remove)",
    ] {
        assert!(lines.iter().any(|line| line.starts_with(head)), "{head}:\n{preamble}");
    }
    assert!(
        preamble.contains("Project 제거 · Space 삭제를 부탁받으면 지우지 않고 그 화면을 안내한다 — 예: 「Project 제거는 화면에서만 할 수 있어요. 메뉴 › Projects에서 api-server의 ⋯ › 제거를 눌러 주세요.」"),
        "지우는 도구는 없다 — 화면을 안내한다(스토리 67):\n{preamble}"
    );
    assert!(preamble.contains("Space를 만들기 전에 초안을 보이고 사람이 좋다고 하면 만든다"), "{preamble}");
    assert!(preamble.contains("\n- Work: 없음 — 이 Thread 폴더에서 일한다: `"), "Work 줄의 꼴은 그대로다(L3 `workTitleOf`):\n{preamble}");
}

/// 캔버스 ④ F4-KitChat 「대화로 한 설정 — 결과 카드」의 자리 — Project 셋(web-app의 기준 브랜치는 develop) · Space 둘 · 아직 등록하지 않은
/// 저장소 landing-page.
fn kit_world(sandbox: &Sandbox) -> PathBuf {
    let web = register(sandbox, "web-app");
    git(&web, &["branch", "develop"]);
    let patch = atelier_core::ProjectPatch { name: None, description: None, base_branch: Some("develop".into()) };
    atelier_core::update_project(&projects(sandbox), "web-app", patch).expect("기준 브랜치 develop");
    register(sandbox, "api-server");
    register(sandbox, "backoffice");
    space(sandbox, "결제-서비스", PAYMENTS);
    space(sandbox, "사내-도구", TOOLS);
    repo(sandbox, "landing-page")
}

/// 축복 자료로 굳힌다 — 사람의 저장소 자리(`repos/`)는 `~/MyProjects`로, 데이터 루트는 `~/.atelier`로, 카드의 요청 id는 `fake-request`로.
fn fixed_record(sandbox: &Sandbox, thread: &str, record: &[Value], request: Option<&str>) -> Vec<Value> {
    let repos = repos(sandbox).display().to_string();
    let homed: Vec<Value> = settled(record)
        .iter()
        .map(|line| {
            let mut text = line.to_string().replace(&repos, "~/MyProjects");
            if let Some(request) = request {
                text = text.replace(request, "fake-request");
            }
            serde_json::from_str(&text).unwrap()
        })
        .collect();
    let session = sandbox.thread_session_id(thread, "host");
    common::fix_thread_record(&homed, &sandbox.data_root(), thread, &[&session])
}

/// 기록 축복(S26 꼴) — 한 턴에 Host가 Project를 추가하고 · 기준 브랜치를 고치고 · Space를 만들고 · Space에 Project를 넣는다. 화면 L2
/// (`fold.test.ts`)와 끝 e2e(13)의 L3가 이 파일을 흘려 결과 카드 넷(캔버스 F4-KitChat)을 그린다.
#[test]
fn host가_대화로_한_설정_넷의_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    let landing = kit_world(&sandbox);
    let calls = [
        tool("add_project", json!({"path": landing})),
        tool("edit_project", json!({"project": "web-app", "baseBranch": "main"})),
        tool("edit_space", json!({"space": "결제-서비스", "add": ["backoffice"]})),
        tool("create_space", json!({"name": "정산", "projects": ["api-server"], "description": "월말 정산을 다뤄요."})),
    ];
    let (host, thread) = thread_calling(&sandbox, &calls);
    let record = first_turn(&sandbox, host, &thread);
    let cards: Vec<(&Value, &Value)> =
        settings(&record).iter().map(|line| (&line["payload"]["title"], &line["payload"]["detail"])).collect();
    assert_eq!(
        cards,
        [
            (&json!("Project를 추가했어요 — landing-page"), &json!(format!("{}/landing-page · git 레포 · 기준 브랜치 main", repos(&sandbox).display()))),
            (&json!("web-app의 기준 브랜치를 main으로 바꿨어요"), &json!("새 Work부터 main에서 갈라져요")),
            (&json!("결제 서비스에 backoffice를 넣었어요"), &json!("Project 3 · 함께 쓰는 Space 1")),
            (&json!("Space를 만들었어요 — 정산"), &json!(format!("api-server · {}", atelier_core::spaces_in(&sandbox.data_root()).join("정산.md").display()))),
        ],
        "캔버스 F4-KitChat 결과 카드 넷의 첫 줄"
    );
    common::assert_record("thread-setting", &fixed_record(&sandbox, &thread, &record, None));
}

/// 기록 축복 — Host가 git이 아닌 폴더를 추가하려 해 질문 카드로 묻고 사람이 「git init 하고 추가」를 고른 턴. L3가 이 파일을 흘려 질문 카드
/// 「notes는 git 저장소가 아니에요. 어떻게 할까요?」(답하기 전까지) · 접힌 줄 · 결과 카드를 그린다.
#[test]
fn host가_git이_아닌_폴더를_묻고_사람이_git_init_하고_추가를_고른_턴의_기록이_검사_자료와_같다() {
    git_identity();
    let sandbox = Sandbox::new();
    let folder = notes(&sandbox);
    let (host, thread) = thread_calling(&sandbox, &[tool("add_project", json!({"path": folder}))]);
    let asked = wait_card(&sandbox, &thread, "asked");
    host.answer_project_add(&thread, &request_of(&asked), ProjectAddChoice::Init).expect("git init 하고 추가");
    let record = first_turn(&sandbox, host, &thread);

    common::assert_record("thread-project-add", &fixed_record(&sandbox, &thread, &record, Some(&request_of(&asked))));
}

/// 축복 자료의 차례를 하나로 둔다 — 명령 목록 줄(`available_commands_update`)은 Session을 연 답 뒤에 따로 와 그 뒤의 `sent`와 엇갈린다.
/// 그 줄 앞의 가장 가까운 열림 줄 바로 뒤로 옮기고 seq를 다시 센다(`thread_space_host.rs`와 같은 꼴).
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
