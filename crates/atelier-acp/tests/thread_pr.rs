//! L1 — Work의 PR과 `pr` 줄(v1 티켓 36 · 구현 스펙 §12 S24 · §4 `pr`). 엔진이 Work의 PR을 `gh`로 읽고, 처음 보인 PR과 상태 변화를 그
//! Work에서 가장 최근에 말한 Thread에 `pr` 줄로 남긴다. 이 줄이 Thread의 PR 카드가 된다(스토리 124).
//!
//! - 읽는 때: Work에 이은 Thread에서 턴이 끝날 때(엔진이 스스로), 그리고 화면이 부를 때(Work 카드가 열릴 때 · 열린 동안 60초마다 —
//!   [`ConversationHost::read_work_prs`]).
//! - 같은 상태는 다시 적지 않는다. 없음(`gh`가 없다 · 로그인이 풀렸다) · 읽지 못함(네트워크)은 상태 변화가 아니다. 앱을 다시 켜도 기록에
//!   남은 상태는 다시 적지 않는다.
//!
//! **진짜 `gh` · GitHub는 부르지 않는다.** 가짜 `gh`는 로그인 셸의 PATH에만 있다 — 엔진이 그 PATH로 찾지 않으면 PR이 읽히지 않는다.
//! 답은 시험이 파일로 바꿔 넣는다. 시험은 호스트의 답과 Thread 기록만 본다.

mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use atelier_acp::{ConversationHost, ShellSource, ThreadLink};
use atelier_core::{Ci, PrLookup};
use common::{of_kind, LoginShell, Sandbox};
use serde_json::{json, Value};

const HOST_MD: &str = "---\nname: Host\n---\n\n너는 시험 Thread의 Host다.\n";
/// 시험의 Work — Project `api`의 worktree가 브랜치 `fix/refund`로 서 있다.
const WORK: &str = "refund";

/// 가짜 `gh` — 시험이 넣어 둔 답(`out`)을 찍고 그 코드(`code`)로 끝난다.
struct Gh {
    dir: PathBuf,
}

impl Gh {
    /// 가짜 `gh`를 심은 PATH 폴더와 그 손잡이.
    fn plant(sandbox: &Sandbox) -> (Gh, PathBuf) {
        let bin = sandbox.bin("gh-bin");
        let dir = sandbox.bin("gh-answers");
        let script = format!(
            "#!/bin/sh\n/bin/cat '{dir}/out'\nexit \"$(/bin/cat '{dir}/code')\"\n",
            dir = dir.display()
        );
        let gh = bin.join("gh");
        common::write_script(&gh, &script);
        fs::set_permissions(&gh, fs::Permissions::from_mode(0o755)).unwrap();
        let gh = Gh { dir };
        gh.answer("[]", 0);
        (gh, bin)
    }

    fn answer(&self, out: &str, code: i32) {
        fs::write(self.dir.join("out"), out).unwrap();
        fs::write(self.dir.join("code"), code.to_string()).unwrap();
    }

    /// 브랜치 `fix/refund`에 선 PR #142 — `gh pr list --json`이 실제로 내는 필드 이름 그대로다.
    fn pr(&self, state: &str, merged_at: &str, checks: &str) {
        self.answer(
            &format!(
                r#"[{{"number": 142, "title": "부분 환불 이중 차감 수정", "url": "https://github.com/team/api/pull/142",
                    "state": "{state}", "headRefName": "fix/refund", "baseRefName": "main", "additions": 48, "deletions": 12,
                    "changedFiles": 3, "mergedAt": {merged_at}, "latestReviews": [{{"state": "APPROVED"}}],
                    "statusCheckRollup": {checks}}}]"#
            ),
            0,
        );
    }
}

const PENDING: &str = r#"[{"__typename": "CheckRun", "name": "e2e", "status": "IN_PROGRESS", "conclusion": ""}]"#;
const FAILING: &str = r#"[{"__typename": "CheckRun", "name": "e2e", "status": "COMPLETED", "conclusion": "FAILURE"}]"#;
const PASSING: &str = r#"[{"__typename": "CheckRun", "name": "e2e", "status": "COMPLETED", "conclusion": "SUCCESS"}]"#;

/// 시험의 자리 — Library의 Host, 브랜치가 선 Work 하나, 가짜 claude와 가짜 `gh`가 든 로그인 PATH.
fn setup() -> (Sandbox, Gh, ShellSource) {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let dir = sandbox.work(WORK, &["api"]);
    let mut work: Value = serde_json::from_str(&fs::read_to_string(dir.join("work.json")).unwrap()).unwrap();
    work["branch"] = json!("fix/refund");
    fs::write(dir.join("work.json"), work.to_string()).unwrap();
    let (gh, gh_bin) = Gh::plant(&sandbox);
    let claude = sandbox.claude_bin();
    let receipts = sandbox.claude_receipts();
    let env = [("FAKE_CLAUDE_SCENARIO", "normal"), ("FAKE_CLAUDE_RECEIPTS", receipts.to_str().unwrap())];
    let path = [claude.as_path(), gh_bin.as_path(), Path::new("/usr/bin"), Path::new("/bin")];
    let shell = ShellSource::Path(sandbox.login_shell_with_env(LoginShell::Normal, &path, &env));
    (sandbox, gh, shell)
}

/// 그 Work에 이은 새 Thread — 첫 말의 턴이 끝날 때까지 기다린다.
fn thread_in_work(sandbox: &Sandbox, host: &ConversationHost, text: &str) -> String {
    let thread = host.start_thread(text, ThreadLink::Work { slug: WORK.into() }).expect("Work에 이은 Thread");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    thread
}

fn pr_lines(sandbox: &Sandbox, thread: &str) -> Vec<Value> {
    of_kind(&sandbox.thread_record(thread), "pr").into_iter().cloned().collect()
}

fn read(host: &ConversationHost) -> PrLookup {
    let mut prs = host.read_work_prs(WORK).expect("Work의 PR");
    assert_eq!(prs.len(), 1, "Project 하나다: {prs:?}");
    prs.remove(0).pr
}

/// §12 「Work의 Thread에서 턴이 끝날 때」 — 턴이 끝나면 엔진이 PR을 읽고, 처음 보인 PR을 그 Thread에 `pr` 줄로 남긴다. 줄은 시스템의
/// 줄(`who` 없음)이고 PR 카드가 그리는 것(제목 · 번호 · 브랜치 · +/− · 파일 수 · 리뷰 · CI · 주소)을 모두 싣는다. 턴 끝 줄 뒤에 선다.
#[test]
fn 턴이_끝나면_pr을_읽어_처음_보인_pr을_그_thread에_pr_줄로_남긴다() {
    let (sandbox, gh, shell) = setup();
    gh.pr("OPEN", "null", PENDING);
    let host = sandbox.host(shell);

    let thread = host.start_thread("PR까지 올려줘", ThreadLink::Work { slug: WORK.into() }).expect("Work에 이은 Thread");
    let record = sandbox.wait_thread_kind(&thread, "pr", 1);

    let line = of_kind(&record, "pr")[0];
    assert_eq!(line.get("who"), None, "시스템의 줄이다");
    assert_eq!(
        line["payload"],
        json!({
            "work": WORK, "project": "api", "first": true,
            "number": 142, "title": "부분 환불 이중 차감 수정", "url": "https://github.com/team/api/pull/142",
            "state": "open", "headBranch": "fix/refund", "baseBranch": "main",
            "additions": 48, "deletions": 12, "changedFiles": 3,
            "ci": {"kind": "pending"}, "approvals": 1, "changesRequested": 0, "mergedAt": null,
        }),
    );
    let turn_end = of_kind(&record, "turn-end")[0];
    assert!(line["seq"].as_u64() > turn_end["seq"].as_u64(), "턴 끝 줄 뒤에 선다");

    host.shut_down();
}

/// 「처음 · 변화 · 같은 것은 반복하지 않음」 — 화면이 부르는 읽기(카드가 열릴 때 · 60초마다)도 같은 규칙으로 적는다. 상태(CI · 열림/병합됨 ·
/// 리뷰 수)가 바뀌면 `first: false`로 한 줄, 같으면 아무것도 적지 않는다. 없음(`gh` 4 — 로그인이 풀림) · 읽지 못함(네트워크)은 변화가
/// 아니다 — 그 뒤 같은 PR이 다시 읽혀도 「처음 보인 PR」로 적지 않는다.
#[test]
fn 같은_상태는_다시_적지_않고_바뀐_상태만_적으며_없음과_읽지_못함은_변화가_아니다() {
    let (sandbox, gh, shell) = setup();
    gh.pr("OPEN", "null", PENDING);
    let host = sandbox.host(shell);
    let thread = thread_in_work(&sandbox, &host, "PR까지 올려줘");
    sandbox.wait_thread_kind(&thread, "pr", 1);

    assert!(matches!(read(&host), PrLookup::Found(pr) if pr.ci == Ci::Pending), "읽은 PR을 돌려준다");
    assert_eq!(pr_lines(&sandbox, &thread).len(), 1, "같은 상태는 다시 적지 않는다");

    gh.pr("OPEN", "null", FAILING);
    read(&host);
    let lines = pr_lines(&sandbox, &thread);
    assert_eq!(lines.len(), 2, "CI가 실패로 바뀌면 한 줄");
    assert_eq!(lines[1]["payload"]["first"], false);
    assert_eq!(lines[1]["payload"]["ci"], json!({"kind": "failing", "failed": ["e2e"]}));

    gh.answer("", 1);
    assert!(matches!(read(&host), PrLookup::Unreadable { .. }));
    gh.answer("", 4);
    assert_eq!(read(&host), PrLookup::Absent);
    gh.pr("OPEN", "null", FAILING);
    read(&host);
    assert_eq!(pr_lines(&sandbox, &thread).len(), 2, "끊긴 읽기 뒤에 같은 PR이 다시 와도 적지 않는다");

    gh.pr("OPEN", "null", PASSING);
    read(&host);
    let lines = pr_lines(&sandbox, &thread);
    assert_eq!(lines.len(), 3, "끊긴 뒤의 변화는 적는다");
    assert_eq!((&lines[2]["payload"]["first"], &lines[2]["payload"]["ci"]), (&json!(false), &json!({"kind": "passing"})));

    host.shut_down();
}

/// 본 상태는 기록이 정본이다 — 앱을 다시 켜도(새 호스트) 기록에 남은 상태는 다시 적지 않고, 그 뒤의 변화만 적는다.
#[test]
fn 앱을_다시_켜도_기록에_남은_상태는_다시_적지_않는다() {
    let (sandbox, gh, shell) = setup();
    gh.pr("OPEN", "null", FAILING);
    let host = sandbox.host(shell.clone());
    let thread = thread_in_work(&sandbox, &host, "PR까지 올려줘");
    sandbox.wait_thread_kind(&thread, "pr", 1);
    host.shut_down();
    drop(host);

    let host = sandbox.host(shell);
    read(&host);
    assert_eq!(pr_lines(&sandbox, &thread).len(), 1, "다시 켠 뒤 같은 상태");

    gh.pr("MERGED", r#""2026-10-23T06:02:00Z""#, PASSING);
    read(&host);
    let lines = pr_lines(&sandbox, &thread);
    assert_eq!(lines.len(), 2);
    assert_eq!(
        (&lines[1]["payload"]["first"], &lines[1]["payload"]["state"], &lines[1]["payload"]["mergedAt"]),
        (&json!(false), &json!("merged"), &json!("2026-10-23T06:02:00Z")),
        "병합됨은 그 시각과 함께"
    );

    host.shut_down();
}

/// §12 「그 Work에서 가장 최근에 말한 Thread에」 — 같은 Work에 Thread가 여럿이면 줄은 마지막에 말이 오간 Thread 하나에만 선다.
#[test]
fn pr_줄은_그_work에서_가장_최근에_말한_thread에_선다() {
    let (sandbox, gh, shell) = setup();
    gh.pr("OPEN", "null", PENDING);
    let host = sandbox.host(shell);
    let first = thread_in_work(&sandbox, &host, "PR까지 올려줘");
    sandbox.wait_thread_kind(&first, "pr", 1);

    let later = thread_in_work(&sandbox, &host, "리뷰해 줘");
    gh.pr("OPEN", "null", PASSING);
    read(&host);

    let lines = sandbox.wait_thread_kind(&later, "pr", 1);
    assert_eq!(of_kind(&lines, "pr")[0]["payload"]["ci"], json!({"kind": "passing"}), "나중에 말한 Thread에 선다");
    assert_eq!(of_kind(&lines, "pr")[0]["payload"]["first"], false, "그 Work에서는 이미 본 PR이다");
    assert_eq!(pr_lines(&sandbox, &first).len(), 1, "앞 Thread에는 더 서지 않는다");

    host.shut_down();
}
