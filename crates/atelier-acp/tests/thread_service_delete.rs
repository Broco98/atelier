//! L1 — Service 지우기 · 되돌리기와 「지워짐」 · 「되돌림」 줄(03 티켓 07 · 구현 스펙 §9 · §14 · S10).
//!
//! - 지우면 그 Service에 이은 Work · Work 없는 Thread의 칸이 비고, 그 Service로 읽던 Thread마다(Work면 그 Work의 Thread마다) 「지워짐」 줄이
//!   선다. 다음 말은 「Service 없음」의 범위(등록된 Project 전부)로 같은 Session을 이어 연다.
//! - 되돌리면 비웠던 칸 가운데 아직 빈 것에 다시 적고 그 Thread마다 「되돌림」 줄이 선다.
//! - 앱 밖에서 Service 파일이 사라졌으면 그 Thread의 다음 말을 보낼 때 칸을 비우고 「지워짐」 줄을 남긴다 — 반쯤 비운 채 남은 연결도 이
//!   길로 닫힌다.
//!
//! 시험은 호스트의 명령과 Thread 폴더(`thread.json` · `events.jsonl`) · `work.json` · 가짜 claude의 영수증만 본다.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use atelier_acp::{HostError, ThreadLink};
use common::{has_pair, of_kind, receipt_args, Sandbox};
use serde_json::{json, Value};

/// 결제 서비스 Service — web-app · api-server(캔버스 ④ 「결제 서비스」).
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

fn service_file(sandbox: &Sandbox, slug: &str) -> PathBuf {
    atelier_core::services_in(&sandbox.data_root()).join(format!("{slug}.md"))
}

/// Service 파일 하나를 둔다.
fn service(sandbox: &Sandbox, slug: &str, text: &str) {
    let file = service_file(sandbox, slug);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, text).unwrap();
}

/// Work `refund-api`를 worktree 없이 세운다.
fn refund_work(sandbox: &Sandbox) {
    let root = sandbox.data_root();
    atelier_core::start_work_deferred(
        &atelier_core::works_in(&root),
        &atelier_core::archive_in(&root),
        &atelier_core::projects_in(&root),
        "환불 API 버그 수정",
        Some("refund-api"),
        &[],
        Some("fix/refund-api"),
    )
    .expect("worktree 없는 Work");
}

fn in_refund() -> ThreadLink {
    ThreadLink::Work { slug: "refund-api".into() }
}

fn work_service(sandbox: &Sandbox) -> Value {
    let work: Value = serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("refund-api").join("work.json")).unwrap()).unwrap();
    work.get("service").cloned().unwrap_or(Value::Null)
}

fn thread_service(sandbox: &Sandbox, thread: &str) -> Value {
    sandbox.thread_json(thread).get("service").cloned().unwrap_or(Value::Null)
}

/// Host Session의 claude가 마지막으로 뜬 때의 받은 인자.
fn last_args(sandbox: &Sandbox, thread: &str) -> Vec<String> {
    receipt_args(&sandbox.claude_receipt(&sandbox.thread_session_id(thread)))
}

/// 함께 연 폴더들(`--add-dir`) — 받은 차례대로.
fn added_dirs(args: &[String]) -> Vec<PathBuf> {
    args.windows(2).filter(|pair| pair[0] == "--add-dir").map(|pair| PathBuf::from(&pair[1])).collect()
}

fn service_lines(sandbox: &Sandbox, thread: &str) -> Vec<Value> {
    of_kind(&sandbox.thread_record(thread), "service").into_iter().map(|line| line["payload"].clone()).collect()
}

/// 마지막으로 보낸 말의 머리말 가운데 「- Service:」 줄 — 다시 연 Session의 첫 말이라 머리말이 붙어 있다.
fn last_service_preamble(sandbox: &Sandbox, thread: &str) -> String {
    let record = sandbox.thread_record(thread);
    let text = of_kind(&record, "sent").last().expect("보낸 말")["payload"]["prompt"][0]["text"].as_str().expect("머리말").to_owned();
    text.lines().find(|line| line.starts_with("- Service:")).unwrap_or_else(|| panic!("Service 줄이 없다:\n{text}")).to_owned()
}

/// 지워짐 줄 — 지운 Service(slug · 이름)와 지운 뒤의 범위(「Service 없음」 — 등록된 Project 전부).
fn deleted_line(name: &str, work: Option<&str>) -> Value {
    json!({"change": "deleted", "service": "결제-서비스", "name": name, "before": "결제-서비스", "work": work,
           "projects": ["api-server", "backoffice", "web-app"], "registered": 3})
}

fn restored_line(work: Option<&str>) -> Value {
    json!({"change": "restored", "service": "결제-서비스", "name": "결제 서비스", "before": null, "work": work,
           "projects": ["web-app", "api-server"], "registered": 3})
}

#[test]
fn service를_지우면_비운_곳마다_지워짐_줄이_서고_다음_말은_service_없음의_범위로_같은_session을_이어_연다() {
    let sandbox = Sandbox::new();
    let web = register(&sandbox, "web-app");
    let api = register(&sandbox, "api-server");
    let back = register(&sandbox, "backoffice");
    service(&sandbox, "결제-서비스", PAYMENTS);
    service(&sandbox, "사내-도구", "---\nname: 사내 도구\nprojects:\n  - backoffice\n---\n");
    refund_work(&sandbox);
    let host = sandbox.host(two_turns(&sandbox));
    let loose = host.start_thread("환불 금액 확인해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&loose, "turn-end", 1);
    host.set_thread_service(&loose, Some("결제-서비스")).expect("붙이기");
    host.send_to_thread(&loose, "결제 서비스만 봐 줘").expect("붙인 뒤의 말");
    sandbox.wait_thread_kind(&loose, "turn-end", 2);
    assert_eq!(added_dirs(&last_args(&sandbox, &loose)), [web.clone(), api.clone()], "지우기 전 — 그 Service의 Project만");
    let first = host.start_thread("환불부터", in_refund()).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&first, "turn-end", 1);
    let second = host.start_thread("설계 문서도", in_refund()).expect("같은 Work의 둘째 Thread");
    sandbox.wait_thread_kind(&second, "turn-end", 1);
    host.set_work_service("refund-api", Some("결제-서비스")).expect("Work에 붙이기");
    let other = host.start_thread("운영 화면", ThreadLink::NoWork).expect("다른 Service의 Thread");
    sandbox.wait_thread_kind(&other, "turn-end", 1);
    host.set_thread_service(&other, Some("사내-도구")).expect("다른 Service");
    let before: Vec<usize> = [&loose, &first, &second, &other].iter().map(|thread| service_lines(&sandbox, thread).len()).collect();

    let deleted = host.delete_service("결제-서비스").expect("지우기");

    assert_eq!(deleted.service.name, "결제 서비스");
    assert!(!service_file(&sandbox, "결제-서비스").exists());
    assert_eq!((work_service(&sandbox), thread_service(&sandbox, &loose)), (Value::Null, Value::Null), "연결이 「Service 없음」이 된다");
    assert_eq!(service_lines(&sandbox, &loose)[before[0]..], [deleted_line("결제 서비스", None)]);
    for (thread, seen) in [(&first, before[1]), (&second, before[2])] {
        assert_eq!(service_lines(&sandbox, thread)[seen..], [deleted_line("결제 서비스", Some("refund-api"))], "그 Work의 Thread마다(S9)");
    }
    assert_eq!(service_lines(&sandbox, &other).len(), before[3], "다른 Service의 Thread에는 서지 않는다");
    assert_eq!(thread_service(&sandbox, &other), "사내-도구");

    let session = sandbox.thread_session_id(&loose);
    host.send_to_thread(&loose, "이어서 봐 줘").expect("지운 뒤의 말");
    sandbox.wait_thread_kind(&loose, "turn-end", 3);
    let args = last_args(&sandbox, &loose);
    assert!(has_pair(&args, "--resume", &session), "대화는 그대로 — 같은 Session을 이어 연다: {args:?}");
    assert_eq!(added_dirs(&args), [api.clone(), back.clone(), web.clone()], "「Service 없음」의 범위 — 등록된 Project 전부");
    assert_eq!(last_service_preamble(&sandbox, &loose), "- Service: 없음 — 등록된 Project 3개를 모두 읽는다", "Host가 Service가 없어진 것을 듣는다");

    let restored = host.restore_service("결제-서비스").expect("되돌리기");
    assert_eq!(restored.service.name, "결제 서비스");
    assert_eq!(std::fs::read_to_string(service_file(&sandbox, "결제-서비스")).unwrap(), PAYMENTS);
    assert_eq!((work_service(&sandbox), thread_service(&sandbox, &loose)), (json!("결제-서비스"), json!("결제-서비스")));
    assert_eq!(service_lines(&sandbox, &loose).last().unwrap(), &restored_line(None));
    for thread in [&first, &second] {
        assert_eq!(service_lines(&sandbox, thread).last().unwrap(), &restored_line(Some("refund-api")));
    }
    assert_eq!(service_lines(&sandbox, &other).len(), before[3]);

    host.send_to_thread(&loose, "다시 결제 서비스만").expect("되돌린 뒤의 말");
    sandbox.wait_thread_kind(&loose, "turn-end", 4);
    host.shut_down();
    assert_eq!(added_dirs(&last_args(&sandbox, &loose)), [web, api], "다시 그 Service의 Project만 읽는다");

    assert_eq!(host.restore_service("결제-서비스"), Err(HostError::ServiceNotFound("결제-서비스".into())), "되돌릴 것이 없다");
    assert_eq!(host.delete_service("없는-것"), Err(HostError::ServiceNotFound("없는-것".into())));
}

#[test]
fn 되돌리는_사이_같은_slug가_다시_쓰였으면_거절하고_줄을_남기지_않는다() {
    let sandbox = Sandbox::new();
    register(&sandbox, "web-app");
    service(&sandbox, "결제-서비스", PAYMENTS);
    let host = sandbox.host(two_turns(&sandbox));
    let thread = host.start_thread("환불 금액 확인해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.set_thread_service(&thread, Some("결제-서비스")).expect("붙이기");
    host.delete_service("결제-서비스").expect("지우기");
    service(&sandbox, "결제-서비스", "---\nname: 새 결제\nprojects: []\n---\n");
    let seen = service_lines(&sandbox, &thread).len();

    let refused = host.restore_service("결제-서비스");
    host.shut_down();

    assert!(matches!(&refused, Err(HostError::Record(why)) if why == "slug is in use again: 결제-서비스"), "{refused:?}");
    assert_eq!(service_lines(&sandbox, &thread).len(), seen, "되돌리지 않았으면 줄도 없다");
    assert_eq!(thread_service(&sandbox, &thread), Value::Null);
}

#[test]
fn 손으로_지운_service_파일은_그_thread의_다음_말에서_칸을_비우고_지워짐_줄을_남기며_범위가_넓어진다() {
    let sandbox = Sandbox::new();
    let web = register(&sandbox, "web-app");
    let api = register(&sandbox, "api-server");
    let back = register(&sandbox, "backoffice");
    service(&sandbox, "결제-서비스", PAYMENTS);
    refund_work(&sandbox);
    let host = sandbox.host(two_turns(&sandbox));
    let loose = host.start_thread("환불 금액 확인해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&loose, "turn-end", 1);
    host.set_thread_service(&loose, Some("결제-서비스")).expect("붙이기");
    host.send_to_thread(&loose, "결제 서비스만 봐 줘").expect("붙인 뒤의 말");
    sandbox.wait_thread_kind(&loose, "turn-end", 2);
    assert_eq!(added_dirs(&last_args(&sandbox, &loose)), [web.clone(), api.clone()], "지우기 전 — 그 Service의 Project만");
    let first = host.start_thread("환불부터", in_refund()).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&first, "turn-end", 1);
    let second = host.start_thread("설계 문서도", in_refund()).expect("같은 Work의 둘째 Thread");
    sandbox.wait_thread_kind(&second, "turn-end", 1);
    host.set_work_service("refund-api", Some("결제-서비스")).expect("Work에 붙이기");
    let seen: Vec<usize> = [&loose, &first, &second].iter().map(|thread| service_lines(&sandbox, thread).len()).collect();

    std::fs::remove_file(service_file(&sandbox, "결제-서비스")).unwrap();
    assert_eq!(service_lines(&sandbox, &loose).len(), seen[0], "파일이 사라진 것만으로는 아무것도 적지 않는다");

    let session = sandbox.thread_session_id(&loose);
    host.send_to_thread(&loose, "이어서 봐 줘").expect("Work 없는 Thread의 다음 말");
    sandbox.wait_thread_kind(&loose, "turn-end", 3);
    assert_eq!(thread_service(&sandbox, &loose), Value::Null, "칸을 비운다");
    assert_eq!(service_lines(&sandbox, &loose)[seen[0]..], [deleted_line("결제-서비스", None)], "파일이 없어 이름은 slug로 말한다");
    let record = sandbox.thread_record(&loose);
    let line_at = record.iter().rposition(|line| line["kind"] == "service").unwrap();
    let sent_at = record.iter().rposition(|line| line["kind"] == "sent").unwrap();
    assert!(line_at < sent_at, "줄은 그 말보다 먼저 선다 — 그 말부터 넓어진 범위를 읽는다");
    let args = last_args(&sandbox, &loose);
    assert!(has_pair(&args, "--resume", &session), "같은 Session을 이어 연다: {args:?}");
    assert_eq!(added_dirs(&args), [api.clone(), back.clone(), web.clone()], "「Service 없음」의 범위로 넓어진다");
    assert_eq!(last_service_preamble(&sandbox, &loose), "- Service: 없음 — 등록된 Project 3개를 모두 읽는다", "Host가 Service가 없어진 것을 듣는다");
    assert_eq!(service_lines(&sandbox, &first).len(), seen[1], "다른 Thread는 제 다음 말에서 닫힌다");

    host.send_to_thread(&first, "이어서").expect("Work에 이은 Thread의 다음 말");
    sandbox.wait_thread_kind(&first, "turn-end", 2);
    assert_eq!(work_service(&sandbox), Value::Null, "Work의 칸을 비운다");
    for (thread, seen) in [(&first, seen[1]), (&second, seen[2])] {
        assert_eq!(service_lines(&sandbox, thread)[seen..], [deleted_line("결제-서비스", Some("refund-api"))], "그 Work의 Thread마다");
    }
    assert_eq!(service_lines(&sandbox, &loose).len(), seen[0] + 1, "Work의 연결을 닫아도 Work 없는 Thread에는 서지 않는다");
    host.send_to_thread(&second, "문서도 이어서").expect("닫힌 뒤의 말");
    sandbox.wait_thread_kind(&second, "turn-end", 2);
    host.shut_down();
    assert_eq!(service_lines(&sandbox, &second).len(), seen[2] + 1, "닫힌 연결은 다시 줄을 남기지 않는다");
    assert_eq!(added_dirs(&last_args(&sandbox, &first)), [api, back, web], "worktree 없는 Work는 spec 폴더에서 일하고 등록된 Project 전부를 읽는다");
}

/// 기록 축복(S26 꼴) — Work 없는 Thread에서 이은 Service를 지우고(「지워짐」 줄 · 다음 말이 등록된 Project 전부로 이어 연다) 되돌린 기록이
/// 검사 자료로 선다. 화면 L2(`fold.test.ts`)와 끝 e2e(13)의 L3가 이 파일을 흘려 「결제 서비스 Service가 지워져 Service 없이 이어가요 — 대화는
/// 그대로예요」 · 「결제 서비스 Service를 되돌렸어요 — 다시 web-app · api-server를 읽어요」를 그린다(캔버스 F4-KitChat 「Service가 지워짐」).
#[test]
fn service를_지우고_되돌린_대화의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    register(&sandbox, "web-app");
    register(&sandbox, "api-server");
    register(&sandbox, "backoffice");
    service(&sandbox, "결제-서비스", PAYMENTS);
    let host = sandbox.host(two_turns(&sandbox));
    let thread = host.start_thread("환불 금액 확인해 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.set_thread_service(&thread, Some("결제-서비스")).expect("붙이기");
    host.delete_service("결제-서비스").expect("지우기");
    host.send_to_thread(&thread, "Service 없이 이어서 봐 줘").expect("둘째 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 2);
    host.restore_service("결제-서비스").expect("되돌리기");
    let record = sandbox.thread_record(&thread);
    host.shut_down();

    let session = sandbox.thread_session_id(&thread);
    let fixed = common::fix_thread_record(&common::commands_after_each_opened(&record), &sandbox.data_root(), &thread, &[&session]);
    common::assert_record("thread-service-deleted", &fixed);
}
