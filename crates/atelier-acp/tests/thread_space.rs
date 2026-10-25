//! L1 — 읽는 범위와 Space 줄(03 티켓 05 · 구현 스펙 §7 · §9 · S9).
//!
//! - Thread의 Session이 읽기로 함께 여는 폴더는 읽는 범위 함수 하나에서 나온다 — Work 없는 Thread는 Thread 폴더 + 범위, Work에 이은
//!   Thread는 지금의 작업 폴더(worktree · `trees/` · spec) + spec 폴더 + 범위다.
//! - 머리말에 「- Space: …」 한 줄이 Work 줄 뒤에 선다 — Work 줄의 꼴은 그대로다(L3 `workTitleOf`가 그 줄을 읽는다).
//! - Space를 붙이고 · 바꾸고 · 빼면 그 파일의 `space`만 고치고 흐름에 Space 줄(`space`)을 남긴다. Work의 Space를 바꾸면 그 Work의 Thread
//!   마다 남는다(S9). 범위가 바뀐 Session은 다음 말에서 같은 Session을 새 자리로 이어 연다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 폴더(`thread.json` · `events.jsonl`) · `work.json` · 가짜 claude의 영수증만 본다.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use atelier_acp::{HostError, ThreadLink};
use common::{has_pair, of_kind, receipt_args, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md`.
const HOST_MD: &str = "---\nname: Host\ndescription: 시험의 Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 결제 서비스 Space — web-app · api-server(캔버스 ④ 「결제 서비스」).
const PAYMENTS: &str = "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\ncreatedAt: 2026-10-23\n---\n\n결제와 환불을 한 흐름으로 다뤄요.\n";

/// 두 턴을 되감는 가짜 claude.
fn two_turns(sandbox: &Sandbox) -> atelier_acp::ShellSource {
    sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")])
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

/// Work `refund-api`를 worktree 없이 세운다(S21) — `trees`에 든 Project만 worktree 자리(폴더)를 세운다.
fn refund_work(sandbox: &Sandbox, projects: &[&str], trees: &[&str]) -> PathBuf {
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
    let dir = sandbox.work_dir("refund-api");
    for tree in trees {
        std::fs::create_dir_all(dir.join("trees").join(tree)).unwrap();
    }
    dir
}

fn in_refund() -> ThreadLink {
    ThreadLink::Work { slug: "refund-api".into() }
}

fn work_json(sandbox: &Sandbox) -> Value {
    serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("refund-api").join("work.json")).unwrap()).unwrap()
}

/// Host Session의 claude가 마지막으로 뜬 때의 받은 인자와 작업 폴더.
fn last_launch(sandbox: &Sandbox, thread: &str) -> (Vec<String>, PathBuf) {
    let receipt = sandbox.claude_receipt(&sandbox.thread_session_id(thread, "host"));
    (receipt_args(&receipt), PathBuf::from(receipt["cwd"].as_str().expect("cwd")))
}

/// 함께 연 폴더들(`--add-dir`) — 받은 차례대로.
fn added_dirs(args: &[String]) -> Vec<PathBuf> {
    args.windows(2).filter(|pair| pair[0] == "--add-dir").map(|pair| PathBuf::from(&pair[1])).collect()
}

fn real(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| panic!("없다: {}", path.display()))
}

/// `n`째 보낸 말의 머리말 가운데 「- Space:」 줄.
fn space_preamble(record: &[Value], n: usize) -> String {
    let sent = of_kind(record, "sent");
    let text = sent[n]["payload"]["prompt"][0]["text"].as_str().expect("머리말").to_owned();
    text.lines().find(|line| line.starts_with("- Space:")).unwrap_or_else(|| panic!("Space 줄이 없다:\n{text}")).to_owned()
}

fn space_lines(sandbox: &Sandbox, thread: &str) -> Vec<Value> {
    of_kind(&sandbox.thread_record(thread), "space").into_iter().map(|line| line["payload"].clone()).collect()
}

#[test]
fn work_없는_thread에_space를_붙이면_다음_말부터_같은_session을_그_space의_project만_함께_열어_잇고_머리말이_space를_알린다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let web = register(&sandbox, "web-app");
    let api = register(&sandbox, "api-server");
    let back = register(&sandbox, "backoffice");
    space(&sandbox, "결제-서비스", PAYMENTS);
    let host = sandbox.host(two_turns(&sandbox));
    let thread = host.start_thread("환불 금액 확인해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let session = sandbox.thread_session_id(&thread, "host");
    assert_eq!(added_dirs(&last_launch(&sandbox, &thread).0), [api.clone(), back.clone(), web.clone()], "Space가 없으면 등록된 Project 전부");
    assert_eq!(space_preamble(&record, 0), "- Space: 없음 — 등록된 Project 3개를 모두 읽는다");

    host.set_thread_space(&thread, Some("결제-서비스")).expect("Space 붙이기");
    assert_eq!(sandbox.thread_json(&thread)["space"], "결제-서비스", "그 Thread 파일의 space만 고친다");
    let line = of_kind(&sandbox.thread_record(&thread), "space").last().map(|line| (*line).clone()).expect("Space 줄");
    assert!(line.get("who").is_none(), "사람이 바꾼 시스템 줄이다(S8): {line}");
    assert_eq!(
        line["payload"],
        json!({"change": "changed", "space": "결제-서비스", "name": "결제 서비스", "before": null, "work": null,
               "projects": ["web-app", "api-server"], "registered": 3}),
        "흐름의 「Space를 결제 서비스로 바꿨어요 — 다음 차례부터 web-app · api-server를 읽어요」가 이것을 읽는다"
    );
    host.set_thread_space(&thread, Some("결제-서비스")).expect("같은 Space");
    assert_eq!(space_lines(&sandbox, &thread).len(), 1, "같은 Space로 다시 붙이면 아무것도 남기지 않는다");

    host.send_to_thread(&thread, "다시 봐 줘").expect("둘째 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    let (args, cwd) = last_launch(&sandbox, &thread);
    assert!(has_pair(&args, "--resume", &session), "같은 Session을 이어 연다 — 앞 맥락을 기억한다: {args:?}");
    assert_eq!(cwd, real(&sandbox.thread_dir(&thread)), "작업 폴더는 그대로 Thread 폴더다");
    assert_eq!(added_dirs(&args), [web.clone(), api.clone()], "다음 말부터 그 Space의 Project만 — 적힌 차례로");
    let file = atelier_core::spaces_in(&sandbox.data_root()).join("결제-서비스.md");
    assert_eq!(
        space_preamble(&record, 1),
        format!("- Space: 결제 서비스(`{}`) — 읽는 Project: web-app, api-server", file.display()),
        "다시 연 Session의 머리말이 새 범위를 알린다"
    );

    host.set_thread_space(&thread, None).expect("Space 빼기");
    assert_eq!(sandbox.thread_json(&thread).get("space"), None, "빼면 칸째 빠진다");
    assert_eq!(
        space_lines(&sandbox, &thread).last().unwrap(),
        &json!({"change": "removed", "space": null, "name": null, "before": "결제-서비스", "work": null,
                "projects": ["api-server", "backoffice", "web-app"], "registered": 3}),
        "「Space를 뺐어요 — 다음 차례부터 등록된 Project 3개를 읽어요」"
    );
    host.send_to_thread(&thread, "이제 다 봐 줘").expect("셋째 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 3);
    host.shut_down();
    assert_eq!(added_dirs(&last_launch(&sandbox, &thread).0), [api, back, web]);

    assert_eq!(
        host.set_thread_space(&thread, Some("없는-것")),
        Err(HostError::SpaceNotFound("없는-것".into())),
        "없는 Space는 붙이지 않는다"
    );
    assert_eq!(space_lines(&sandbox, &thread).len(), 2, "거절하면 아무것도 남기지 않는다");
}

#[test]
fn work에_이은_thread는_spec_폴더와_읽는_범위를_함께_열고_worktree가_선_project는_worktree에서_일하며_고칠_자리는_그대로다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let web = register(&sandbox, "web-app");
    let api = register(&sandbox, "api-server");
    let back = register(&sandbox, "backoffice");
    let docs = register(&sandbox, "docs");
    let gone = register(&sandbox, "gone");
    std::fs::remove_dir_all(&gone).unwrap();
    space(&sandbox, "결제-서비스", "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\n  - gone\n---\n");
    let work = refund_work(&sandbox, &["api-server", "backoffice"], &["api-server"]);
    let host = sandbox.host(two_turns(&sandbox));

    // Space 없는 Work — 등록된 Project 전부를 읽되, worktree가 선 api-server는 worktree에서 일한다.
    let thread = host.start_thread("환불 API 버그 고쳐줘", in_refund()).expect("Work에 이은 Thread");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let (args, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&work.join("trees/api-server")), "worktree 하나면 그 worktree에서 일한다(S11 그대로)");
    assert_eq!(added_dirs(&args), [work.join("spec"), back.clone(), docs.clone(), web.clone()], "spec 폴더 + 등록된 Project 전부(폴더가 사라진 gone은 빼고)");
    assert_eq!(space_preamble(&record, 0), "- Space: 없음 — 등록된 Project 5개를 모두 읽는다");
    let preamble = of_kind(&record, "sent")[0]["payload"]["prompt"][0]["text"].as_str().unwrap().to_owned();
    let work_line = preamble.lines().position(|line| line == "- Work: `refund-api` — 환불 API 버그 수정").expect("Work 줄의 꼴은 그대로다");
    let space_line = preamble.lines().position(|line| line.starts_with("- Space:")).unwrap();
    assert!(work_line < space_line, "Space 줄은 Work 줄 뒤에 선다:\n{preamble}");

    // Work 밖 Project 카드에서 「읽기만 하기」로 허락한 docs는 Space 밖이어도 읽는다.
    atelier_core::update_thread(&sandbox.data_root(), &thread, |file| file.read_only_projects = vec!["docs".into()]).unwrap();
    host.set_work_space("refund-api", Some("결제-서비스")).expect("Work에 Space 붙이기");
    assert_eq!(work_json(&sandbox)["space"], "결제-서비스", "Work 파일의 space만 고친다");
    assert_eq!(sandbox.thread_json(&thread).get("space"), None, "Work에 이은 Thread의 칸은 쓰지 않는다");
    host.send_to_thread(&thread, "다시 봐 줘").expect("둘째 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();
    let (args, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&work.join("trees/api-server")));
    assert_eq!(
        added_dirs(&args),
        [work.join("spec"), web.clone(), back.clone(), docs.clone()],
        "Space의 web-app(api-server는 worktree, gone은 폴더 없음) + worktree 없는 Work의 backoffice + 읽기만 docs"
    );
    let file = atelier_core::spaces_in(&sandbox.data_root()).join("결제-서비스.md");
    assert_eq!(space_preamble(&record, 1), format!("- Space: 결제 서비스(`{}`) — 읽는 Project: web-app, backoffice, docs", file.display()));
    assert_eq!(
        space_lines(&sandbox, &thread),
        [json!({"change": "changed", "space": "결제-서비스", "name": "결제 서비스", "before": null, "work": "refund-api",
                "projects": ["web-app", "backoffice", "docs"], "registered": 5})]
    );
    let _ = api;
}

#[test]
fn work의_space를_바꾸면_그_work의_thread마다_space_줄이_서고_다른_thread에는_서지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "web-app");
    register(&sandbox, "api-server");
    register(&sandbox, "backoffice");
    space(&sandbox, "결제-서비스", PAYMENTS);
    space(&sandbox, "사내-도구", "---\nname: 사내 도구\nprojects:\n  - api-server\n  - backoffice\n---\n");
    refund_work(&sandbox, &[], &[]);
    let host = sandbox.host(two_turns(&sandbox));
    let first = host.start_thread("환불부터", in_refund()).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&first, "turn-end", 1);
    let second = host.start_thread("설계 문서도", in_refund()).expect("같은 Work의 둘째 Thread");
    sandbox.wait_thread_kind(&second, "turn-end", 1);
    let loose = host.start_thread("다른 이야기", ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&loose, "turn-end", 1);

    host.set_work_space("refund-api", Some("결제-서비스")).expect("붙이기");
    // Work에 이은 Thread에서 바꾸면(Space 칩 — 스토리 42) 그 Work의 Space가 바뀐다.
    host.set_thread_space(&second, Some("사내-도구")).expect("바꾸기");
    host.shut_down();

    assert_eq!(work_json(&sandbox)["space"], "사내-도구");
    for thread in [&first, &second] {
        assert_eq!(sandbox.thread_json(thread).get("space"), None);
        assert_eq!(
            space_lines(&sandbox, thread),
            [
                json!({"change": "changed", "space": "결제-서비스", "name": "결제 서비스", "before": null, "work": "refund-api",
                       "projects": ["web-app", "api-server"], "registered": 3}),
                json!({"change": "changed", "space": "사내-도구", "name": "사내 도구", "before": "결제-서비스", "work": "refund-api",
                       "projects": ["api-server", "backoffice"], "registered": 3}),
            ],
            "그 Work의 Thread마다 같은 줄이 선다(S9)"
        );
    }
    assert!(space_lines(&sandbox, &loose).is_empty(), "다른 Thread에는 서지 않는다");
    assert_eq!(host.set_work_space("nope", None), Err(HostError::WorkNotFound("nope".into())));
}

#[test]
fn 빈_space와_문제_있는_space는_읽을_수_있는_project만_함께_연다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "web-app");
    let api = register(&sandbox, "api-server");
    space(&sandbox, "빈-것", "---\nname: 빈 것\nprojects: []\n---\n");
    space(&sandbox, "반쯤", "---\nname: 반쯤\nprojects:\n  - billing\n  - api-server\n---\n");
    let work = refund_work(&sandbox, &[], &[]);
    atelier_core::update_work_space(&atelier_core::works_in(&sandbox.data_root()), "refund-api", Some("빈-것")).unwrap();
    let host = sandbox.host(two_turns(&sandbox));
    let thread = host.start_thread("문서부터", in_refund()).expect("Work에 이은 Thread");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let (args, cwd) = last_launch(&sandbox, &thread);
    assert_eq!(cwd, real(&work.join("spec")), "worktree 없는 Work는 spec 폴더에서 일한다");
    assert!(added_dirs(&args).is_empty(), "빈 Space는 읽는 Project가 없다 — spec 폴더는 작업 폴더라 다시 열지 않는다: {args:?}");
    let file = atelier_core::spaces_in(&sandbox.data_root()).join("빈-것.md");
    assert_eq!(space_preamble(&record, 0), format!("- Space: 빈 것(`{}`) — 읽는 Project: 없음", file.display()));

    host.set_work_space("refund-api", Some("반쯤")).expect("문제 있는 Space도 붙인다");
    host.send_to_thread(&thread, "다시").expect("둘째 말");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.shut_down();
    assert_eq!(added_dirs(&last_launch(&sandbox, &thread).0), [api], "등록되지 않은 billing은 읽을 수 없다");
    let file = atelier_core::spaces_in(&sandbox.data_root()).join("반쯤.md");
    assert_eq!(
        space_preamble(&record, 1),
        format!("- Space: 반쯤(`{}`) — 읽는 Project: api-server — 파일에 문제가 있어 읽을 수 있는 Project만 읽는다", file.display())
    );
}

/// 기록 축복(S26 꼴) — Work 없는 Thread에서 사람이 Space를 붙이고(다음 말이 같은 Session을 새 자리로 이어 연다) 다시 뺀 기록이 검사
/// 자료로 선다. 화면 L2(`fold.test.ts`)와 끝 e2e(13)의 L3가 이 파일을 흘려 Space 줄 「Space를 결제 서비스로 바꿨어요 — …」 · 「Space를
/// 뺐어요 — …」를 그린다.
#[test]
fn space를_붙이고_뺀_대화의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    register(&sandbox, "web-app");
    register(&sandbox, "api-server");
    register(&sandbox, "backoffice");
    space(&sandbox, "결제-서비스", PAYMENTS);
    let host = sandbox.host(two_turns(&sandbox));
    let thread = host.start_thread("환불 금액 확인해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.set_thread_space(&thread, Some("결제-서비스")).expect("붙이기");
    host.send_to_thread(&thread, "결제 서비스만 봐 줘").expect("둘째 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.set_thread_space(&thread, None).expect("빼기");
    let record = sandbox.thread_record(&thread);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread, "host");
    let fixed = common::fix_thread_record(&settled(&record), &sandbox.data_root(), &thread, &[&session]);
    common::assert_record("thread-space", &fixed);
}

/// 축복 자료의 차례를 하나로 둔다 — 명령 목록 줄(`available_commands_update`)은 Session을 연 답 뒤에 따로 와 그 뒤의 `sent`와 엇갈린다.
/// 다시 연 Session도 한 번 더 낸다 — 그 줄 앞의 가장 가까운 열림 줄 바로 뒤로 옮기고 seq를 다시 센다(`commands_after_opened`는 첫 열림
/// 뒤로만 옮긴다).
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
