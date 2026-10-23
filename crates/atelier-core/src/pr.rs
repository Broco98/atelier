//! **Work의 PR** — Work 카드의 PR 줄과 PR 카드가 읽는 것(v1 구현 스펙 §12 · S24).
//!
//! Work의 브랜치에 선 PR을 Project마다 `gh`로 읽는다. **새 인증을 들이지 않는다**(S24) — 사용자가 터미널에서 쓰는 `gh`의
//! 로그인을 그대로 빌린다. 그래서 `gh`가 없거나 로그인돼 있지 않으면 PR을 읽을 길이 없고, 그것은 실패가 아니라 「없음」이다:
//! 화면은 PR 줄을 그리지 않는다.
//!
//! 읽는 때(턴 끝 · 카드가 열릴 때 · 열린 동안 60초마다)는 부르는 쪽이 정한다 — 여기는 한 번 읽기만 한다.

use std::ffi::OsStr;
use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::worktree::worktree_dir;
use crate::Result;

/// Project 하나의 PR. 화면에는 한 겹으로 간다 — `{ project, kind, …PR의 필드 }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPr {
    pub project: String,
    #[serde(flatten)]
    pub pr: PrLookup,
}

/// PR 읽기의 답. `Err`가 아니라 갈래다 — 부른 쪽이 틀린 것(없는 Work · 밖을 가리키는 slug)만 `Err`다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PrLookup {
    /// 그 브랜치에 가장 최근에 선 PR(열림 · 닫힘 · 병합됨 모두).
    Found(PullRequest),
    /// 없음 — 그 브랜치에 PR이 없거나, `gh`가 없거나, 로그인돼 있지 않거나, worktree가 없다(읽기만 하는 Project, S21).
    Absent,
    /// `gh`가 다른 까닭으로 실패했다 — 네트워크 · GitHub 저장소가 아님 · 모르는 답. 화면은 없음처럼 그리지 않지만, PR을
    /// 지켜보는 쪽(v1 티켓 36의 `pr` 줄)이 한 번 끊긴 읽기를 「PR이 사라졌다」로 읽지 않게 없음과 가른다.
    Unreadable { reason: String },
}

/// PR 하나 — PR 카드(제목 · 번호 · 브랜치 · +/− · 파일 수 · 리뷰 · CI, 스토리 124)와 Work 카드의 PR 줄이 그리는 만큼만 좁혔다. Thread의
/// `pr` 줄이 이 꼴을 그대로 싣고, 엔진이 다시 켤 때 그 줄에서 읽어 「이미 본 상태」를 되찾는다(v1 티켓 36).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    /// 「GitHub에서 열기」가 여는 주소.
    pub url: String,
    pub state: PrState,
    pub head_branch: String,
    pub base_branch: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub ci: Ci,
    /// 리뷰어마다 마지막 리뷰를 센다 — 같은 사람이 두 번 승인해도 하나다.
    pub approvals: u32,
    pub changes_requested: u32,
    /// 병합된 시각(ISO 8601). 병합되지 않았으면 없다.
    pub merged_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrState {
    #[serde(alias = "OPEN")]
    Open,
    #[serde(alias = "CLOSED")]
    Closed,
    #[serde(alias = "MERGED")]
    Merged,
}

/// CI 상태 — 화면이 색 없이 문장으로 말하는 넷이다(스토리 125: 「CI 확인 중」 · 「CI 통과」 · 「CI 실패」).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Ci {
    /// 검사가 없다 — CI 문장을 그리지 않는다.
    NoChecks,
    /// 실패는 없고 아직 도는 검사가 있다.
    Pending,
    /// 모든 검사가 끝나 통과했다(건너뜀 · 중립 포함).
    Passing,
    /// 하나라도 실패했다 — 도는 검사가 남았어도 실패다. 실패한 검사의 이름을 싣는다(「e2e 테스트 1개가 실패했어요」).
    Failing { failed: Vec<String> },
}

/// Work의 PR들 — `projects`에 적힌 순서로 Project마다 하나(v1 구현 스펙 §12 · S24).
///
/// **그 Project의 worktree에서 `gh pr list --head <Work 브랜치>`를 부른다.** `gh`는 그 자리의 git 원격으로 GitHub 저장소를
/// 찾는다. `pr view <브랜치>`가 아니라 `pr list`인 것은 「PR이 없음」이 성공(빈 목록)으로 오게 해서다 — `pr view`는 그것을
/// 실패로 답해, 네트워크 실패와 가르려면 오류 글을 읽어야 한다. `--state all`이라 닫히고 병합된 PR도 오고(스토리 127), 그중
/// 가장 최근 것 하나를 본다.
///
/// `search_path`는 `gh`를 찾을 PATH다 — 주면 자식의 PATH가 되고 `gh`도 거기서 찾는다. **Finder에서 띄운 앱의 PATH는
/// launchd의 빈약한 것**이라 Homebrew의 `gh`가 안 보인다. 앱은 대화 호스트가 읽어 쥔 로그인 셸의 PATH를 넘긴다(에이전트를
/// 찾는 것과 같은 PATH). `None`이면 이 프로세스의 PATH다.
pub fn read_work_prs(works_root: &Path, slug: &str, search_path: Option<&OsStr>) -> Result<Vec<ProjectPr>> {
    let work = crate::works::read_work(works_root, slug)?;
    work.projects
        .iter()
        .map(|project| {
            let worktree = worktree_dir(works_root, slug, project)?;
            let pr = match &work.branch {
                // worktree가 없으면 이 Work의 브랜치를 고친 적이 없다(S21) — PR이 있을 까닭이 없어 부르지 않는다.
                Some(branch) if worktree.is_dir() => gh_pr(&worktree, branch, search_path),
                _ => PrLookup::Absent,
            };
            Ok(ProjectPr { project: project.clone(), pr })
        })
        .collect()
}

/// `gh pr list --json`에 묻는 필드 — 아래 `GhPr`가 읽는 것만이다. 리뷰는 리뷰어마다 마지막 것(`latestReviews`)을 묻는다.
const GH_FIELDS: &str =
    "number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles,mergedAt,latestReviews,statusCheckRollup";

/// 로그인돼 있지 않을 때 `gh`가 끝나는 코드(`gh help exit-codes` 「4: authentication required」). 오류 글이 아니라 코드로
/// 가른다 — 글은 판마다 바뀐다.
const GH_AUTH_REQUIRED: i32 = 4;

fn gh_pr(worktree: &Path, branch: &str, search_path: Option<&OsStr>) -> PrLookup {
    let mut gh = Command::new("gh");
    gh.current_dir(worktree)
        .args(["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", GH_FIELDS]);
    if let Some(path) = search_path {
        gh.env("PATH", path);
    }
    let out = match gh.output() {
        Ok(out) => out,
        // `gh`가 없다 — 위에서 worktree가 있음을 보았으므로 없는 것은 실행 파일이다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return PrLookup::Absent,
        Err(e) => return PrLookup::Unreadable { reason: e.to_string() },
    };
    if out.status.code() == Some(GH_AUTH_REQUIRED) {
        return PrLookup::Absent;
    }
    if !out.status.success() {
        return PrLookup::Unreadable { reason: String::from_utf8_lossy(&out.stderr).trim().to_string() };
    }
    match serde_json::from_slice::<Vec<GhPr>>(&out.stdout) {
        Ok(found) => found.into_iter().next().map_or(PrLookup::Absent, |pr| PrLookup::Found(pr.into())),
        Err(e) => PrLookup::Unreadable { reason: e.to_string() },
    }
}

/// `gh`가 내는 PR 하나 — GitHub의 필드 이름 그대로다. 화면에는 좁힌 `PullRequest`로 간다. 목록 필드는 `null`로도 온다.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPr {
    number: u64,
    title: String,
    url: String,
    state: PrState,
    head_ref_name: String,
    base_ref_name: String,
    #[serde(default)]
    additions: u64,
    #[serde(default)]
    deletions: u64,
    #[serde(default)]
    changed_files: u64,
    #[serde(default)]
    merged_at: Option<String>,
    #[serde(default)]
    latest_reviews: Option<Vec<GhReview>>,
    #[serde(default)]
    status_check_rollup: Option<Vec<GhCheck>>,
}

#[derive(Deserialize)]
struct GhReview {
    #[serde(default)]
    state: String,
}

/// 검사 하나 — GitHub Actions 같은 `CheckRun`(`name` · `status` · `conclusion`)이거나, 옛 상태 API의 `StatusContext`
/// (`context` · `state`)다. 둘을 한 모양으로 읽고 `state`가 있는지로 가른다.
#[derive(Deserialize)]
struct GhCheck {
    #[serde(default)]
    name: String,
    #[serde(default)]
    context: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    conclusion: String,
    #[serde(default)]
    state: String,
}

impl From<GhPr> for PullRequest {
    fn from(pr: GhPr) -> Self {
        let reviews = pr.latest_reviews.unwrap_or_default();
        let count = |state: &str| reviews.iter().filter(|review| review.state == state).count() as u32;
        PullRequest {
            number: pr.number,
            title: pr.title,
            url: pr.url,
            state: pr.state,
            head_branch: pr.head_ref_name,
            base_branch: pr.base_ref_name,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
            ci: ci_of(&pr.status_check_rollup.unwrap_or_default()),
            approvals: count("APPROVED"),
            changes_requested: count("CHANGES_REQUESTED"),
            // `gh`는 병합되지 않은 PR의 시각을 `null`이나 0001년으로 준다 — 병합됐을 때만 싣는다.
            merged_at: if pr.state == PrState::Merged { pr.merged_at } else { None },
        }
    }
}

/// 검사 하나의 판정.
enum Verdict {
    Pass,
    Fail,
    Wait,
}

/// 검사들을 CI 상태 하나로 모은다. 갈래는 `gh pr checks`와 같다 — 성공 · 중립 · 건너뜀은 통과, 실패 · 오류 · 취소 · 시간 초과 ·
/// 조치 필요 · 시작 실패는 실패, 끝나지 않은 것은 도는 중이다. 그 밖의 결론(`STALE` 같은)은 세지 않는다.
fn ci_of(checks: &[GhCheck]) -> Ci {
    let mut failed = Vec::new();
    let (mut waiting, mut passed) = (false, false);
    for check in checks {
        let verdict = if check.state.is_empty() {
            match (check.status.as_str(), check.conclusion.as_str()) {
                ("COMPLETED", "SUCCESS" | "NEUTRAL" | "SKIPPED") => Verdict::Pass,
                ("COMPLETED", "FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE") => Verdict::Fail,
                ("COMPLETED", _) => continue,
                _ => Verdict::Wait,
            }
        } else {
            match check.state.as_str() {
                "SUCCESS" => Verdict::Pass,
                "FAILURE" | "ERROR" => Verdict::Fail,
                "PENDING" | "EXPECTED" => Verdict::Wait,
                _ => continue,
            }
        };
        match verdict {
            Verdict::Pass => passed = true,
            Verdict::Fail => failed.push(if check.name.is_empty() { check.context.clone() } else { check.name.clone() }),
            Verdict::Wait => waiting = true,
        }
    }
    if !failed.is_empty() {
        Ci::Failing { failed }
    } else if waiting {
        Ci::Pending
    } else if passed {
        Ci::Passing
    } else {
        Ci::NoChecks
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// 임시 자리 — 저장소 `fe`를 Project로 등록하고 Work `w`(브랜치 `feat/x`)의 worktree를 세운다. `bin`은 가짜 `gh`를 심는
    /// 폴더이고, 시험은 이것만 PATH로 준다 — 시험하는 기계의 진짜 `gh`(그리고 GitHub)로 새지 않는다.
    struct Place {
        tmp: tempfile::TempDir,
        works: PathBuf,
        worktree: PathBuf,
        bin: PathBuf,
    }

    fn setup() -> Place {
        let tmp = tempfile::tempdir().unwrap();
        let works = tmp.path().join("works");
        let projects = tmp.path().join("projects");
        let repo = tmp.path().join("fe");
        std::fs::create_dir_all(&repo).unwrap();
        run_git(&repo, &["init", "-b", "main"]);
        run_git(&repo, &["config", "user.email", "t@t.t"]);
        run_git(&repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("a.txt"), "x\n").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "init"]);
        crate::create_project(&projects, &repo).unwrap();
        crate::start_work(&works, &tmp.path().join("archive"), &projects, "pr", Some("w"), &["fe".to_string()], Some("feat/x"))
            .unwrap();
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let worktree = works.join("w").join("trees").join("fe");
        Place { tmp, works, worktree, bin }
    }

    impl Place {
        /// 가짜 `gh`를 심는다 — 받은 자리(`pwd`)와 인자를 영수증에 한 줄씩 적고, `stdout`을 찍고 `code`로 끝난다. PATH가 `bin`
        /// 하나라 셸 밖 명령은 절대 경로로 부른다.
        fn plant_gh(&self, stdout: &str, code: i32) {
            let script = format!(
                "#!/bin/sh\necho \"@$(pwd -P)\" >> '{receipt}'\nfor arg in \"$@\"; do echo \"$arg\" >> '{receipt}'; done\n/bin/cat <<'GH_OUT'\n{stdout}\nGH_OUT\nexit {code}\n",
                receipt = self.receipt().display(),
            );
            self.install_gh(&script);
        }

        /// 실패하는 가짜 `gh` — `stderr`에 까닭을 찍고 `code`로 끝난다.
        fn plant_failing_gh(&self, stderr: &str, code: i32) {
            self.install_gh(&format!("#!/bin/sh\necho '{stderr}' >&2\nexit {code}\n"));
        }

        fn install_gh(&self, script: &str) {
            let gh = self.bin.join("gh");
            // 쓰기는 자식 `sh`가 한다 — 이 프로세스가 쓰기 fd를 연 동안 다른 시험 스레드가 fork하면 그 자식이 exec할 때까지 fd를
            // 쥐어, 막 쓴 `gh`를 부르면 Linux가 「Text file busy」로 막는다(`atelier-acp` `tests/common`의 `write_script`).
            let mut writer = Command::new("/bin/sh")
                .args(["-c", "cat > \"$0\"", &gh.display().to_string()])
                .stdin(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            std::io::Write::write_all(&mut writer.stdin.take().unwrap(), script.as_bytes()).unwrap();
            assert!(writer.wait().unwrap().success(), "가짜 gh를 쓰지 못했다");
            std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        fn receipt(&self) -> PathBuf {
            self.tmp.path().join("gh-receipt")
        }

        /// 가짜 `gh`가 받은 부름들 — 부름마다 첫 줄이 자리, 나머지가 인자다.
        fn gh_calls(&self) -> Vec<Vec<String>> {
            let text = std::fs::read_to_string(self.receipt()).unwrap_or_default();
            let mut calls: Vec<Vec<String>> = Vec::new();
            for line in text.lines() {
                match line.strip_prefix('@') {
                    Some(at) => calls.push(vec![at.to_string()]),
                    None => calls.last_mut().expect("자리 줄이 먼저 온다").push(line.to_string()),
                }
            }
            calls
        }

        fn read(&self) -> PrLookup {
            let mut all = read_work_prs(&self.works, "w", Some(self.bin.as_os_str())).unwrap();
            assert_eq!(all.len(), 1, "Project 하나다: {all:?}");
            let one = all.remove(0);
            assert_eq!(one.project, "fe");
            one.pr
        }
    }

    /// `gh pr list --json …`가 PR 하나를 낼 때의 모양 — GitHub이 실제로 돌려주는 필드 이름 그대로다(필요 없는 필드도 섞여 온다).
    const OPEN_PR: &str = r#"[{
        "number": 142,
        "title": "부분 환불 이중 차감 수정",
        "url": "https://github.com/team/fe/pull/142",
        "state": "OPEN",
        "headRefName": "feat/x",
        "baseRefName": "main",
        "additions": 48,
        "deletions": 12,
        "changedFiles": 3,
        "mergedAt": null,
        "latestReviews": [
            {"author": {"login": "kim"}, "state": "APPROVED"},
            {"author": {"login": "lee"}, "state": "COMMENTED"}
        ],
        "statusCheckRollup": [
            {"__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS", "workflowName": "CI"},
            {"__typename": "CheckRun", "name": "e2e", "status": "IN_PROGRESS", "conclusion": "", "workflowName": "CI"}
        ]
    }]"#;

    /// S24 — Work 브랜치의 PR을 그 worktree에서 `gh`로 읽는다. 번호 · 제목 · 상태 · CI · 리뷰 · +/− · 파일 수가 온다.
    #[test]
    fn 열린_pr을_worktree에서_gh로_읽는다() {
        let place = setup();
        place.plant_gh(OPEN_PR, 0);

        assert_eq!(
            place.read(),
            PrLookup::Found(PullRequest {
                number: 142,
                title: "부분 환불 이중 차감 수정".to_string(),
                url: "https://github.com/team/fe/pull/142".to_string(),
                state: PrState::Open,
                head_branch: "feat/x".to_string(),
                base_branch: "main".to_string(),
                additions: 48,
                deletions: 12,
                changed_files: 3,
                ci: Ci::Pending,
                approvals: 1,
                changes_requested: 0,
                merged_at: None,
            }),
        );
        let calls = place.gh_calls();
        assert_eq!(calls.len(), 1, "gh를 한 번 불렀어야 한다: {calls:?}");
        let call = &calls[0];
        assert_eq!(PathBuf::from(&call[0]), place.worktree.canonicalize().unwrap(), "worktree에서 불러야 한다");
        let args = call[1..].join(" ");
        assert!(args.starts_with("pr list --head feat/x --state all --limit 1 --json "), "{args}");
    }

    /// S24 「없으면 줄이 없다」 — 그 브랜치에 PR이 없으면 없음이다.
    #[test]
    fn 그_브랜치에_pr이_없으면_없음이다() {
        let place = setup();
        place.plant_gh("[]", 0);
        assert_eq!(place.read(), PrLookup::Absent);
    }

    /// S24 — `gh`가 없으면 없음이다. 새 인증을 들이지 않으므로 PR을 읽을 길이 없고, 화면은 PR 줄을 그리지 않는다.
    #[test]
    fn gh가_없으면_없음이다() {
        let place = setup();
        assert_eq!(place.read(), PrLookup::Absent);
    }

    /// S24 — `gh`에 로그인돼 있지 않으면 없음이다. `gh`는 그때 4로 끝난다(`gh help exit-codes` 「4: authentication required」).
    #[test]
    fn gh에_로그인돼_있지_않으면_없음이다() {
        let place = setup();
        place.plant_failing_gh("To get started with GitHub CLI, please run:  gh auth login", 4);
        assert_eq!(place.read(), PrLookup::Absent);
    }

    /// 그 밖의 실패(네트워크 · GitHub 저장소가 아님)는 없음이 아니라 읽지 못함이다 — 화면은 둘 다 그리지 않지만, PR을 지켜보는
    /// 쪽(엔진의 `pr` 줄)이 한 번 끊긴 읽기를 「PR이 사라졌다」로 읽지 않게 가른다.
    #[test]
    fn gh가_다른_까닭으로_실패하면_읽지_못함이다() {
        let place = setup();
        place.plant_failing_gh("error connecting to api.github.com", 1);
        assert_eq!(place.read(), PrLookup::Unreadable { reason: "error connecting to api.github.com".to_string() });
    }

    /// 검사 목록 하나로 PR 하나를 지은 `gh`의 답.
    fn with_checks(state: &str, merged_at: &str, checks: &str) -> String {
        format!(
            r#"[{{"number": 7, "title": "t", "url": "u", "state": "{state}", "headRefName": "feat/x", "baseRefName": "main",
                "additions": 1, "deletions": 0, "changedFiles": 1, "mergedAt": {merged_at}, "latestReviews": [],
                "statusCheckRollup": {checks}}}]"#
        )
    }

    fn found(place: &Place) -> PullRequest {
        match place.read() {
            PrLookup::Found(pr) => pr,
            other => panic!("PR이 없다: {other:?}"),
        }
    }

    /// 스토리 125 — CI 상태는 문장이 되므로 넷으로 가른다. 실패가 하나라도 있으면 실패이고(무엇이 실패했는지 이름을 싣는다),
    /// 아니고 도는 것이 있으면 확인 중, 모두 끝나 통과했으면 통과, 검사가 없으면 없음이다. GitHub Actions의 `CheckRun`과 옛 상태
    /// API의 `StatusContext`를 같이 읽는다.
    #[test]
    fn ci는_실패_확인_중_통과_검사_없음으로_갈린다() {
        let place = setup();
        let ci = |checks: &str| {
            place.plant_gh(&with_checks("OPEN", "null", checks), 0);
            found(&place).ci
        };

        assert_eq!(
            ci(r#"[
                {"__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS"},
                {"__typename": "CheckRun", "name": "e2e", "status": "COMPLETED", "conclusion": "FAILURE"},
                {"__typename": "CheckRun", "name": "lint", "status": "QUEUED", "conclusion": ""},
                {"__typename": "StatusContext", "context": "ci/legacy", "state": "ERROR"}
            ]"#),
            Ci::Failing { failed: vec!["e2e".to_string(), "ci/legacy".to_string()] },
        );
        assert_eq!(
            ci(r#"[
                {"__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS"},
                {"__typename": "StatusContext", "context": "ci/legacy", "state": "PENDING"}
            ]"#),
            Ci::Pending,
        );
        assert_eq!(
            ci(r#"[
                {"__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS"},
                {"__typename": "CheckRun", "name": "docs", "status": "COMPLETED", "conclusion": "SKIPPED"},
                {"__typename": "StatusContext", "context": "ci/legacy", "state": "SUCCESS"}
            ]"#),
            Ci::Passing,
        );
        assert_eq!(ci("[]"), Ci::NoChecks);
        assert_eq!(ci("null"), Ci::NoChecks);
    }

    /// 스토리 127 — 병합된 PR은 병합됨과 그 시각이다. 병합되지 않은 PR의 시각은 싣지 않는다(`gh`가 빈 시각을 0001년으로 줄 때가
    /// 있다).
    #[test]
    fn 병합된_pr은_병합됨과_그_시각이다() {
        let place = setup();
        place.plant_gh(&with_checks("MERGED", r#""2026-10-20T06:02:00Z""#, "[]"), 0);
        let merged = found(&place);
        assert_eq!((merged.state, merged.merged_at.as_deref()), (PrState::Merged, Some("2026-10-20T06:02:00Z")));

        place.plant_gh(&with_checks("CLOSED", r#""0001-01-01T00:00:00Z""#, "[]"), 0);
        let closed = found(&place);
        assert_eq!((closed.state, closed.merged_at), (PrState::Closed, None));
    }

    /// S21 — worktree가 없는 Project는 이 Work의 브랜치를 고친 적이 없다. PR이 있을 까닭이 없어 `gh`를 부르지 않고 없음이다.
    /// 화면에는 Project와 갈래 이름 `kind`, PR의 필드가 한 겹으로 간다.
    #[test]
    fn 읽기만_하는_project는_gh를_부르지_않고_화면에는_한_겹으로_간다() {
        let place = setup();
        let mut work = crate::read_work(&place.works, "w").unwrap();
        work.projects.push("api".to_string());
        std::fs::write(place.works.join("w").join("work.json"), crate::render_work(&work)).unwrap();
        place.plant_gh(&with_checks("OPEN", "null", "[]"), 0);

        let all = read_work_prs(&place.works, "w", Some(place.bin.as_os_str())).unwrap();
        assert_eq!(place.gh_calls().len(), 1, "worktree가 있는 Project에서만 부른다");
        assert_eq!(
            serde_json::to_value(&all).unwrap(),
            serde_json::json!([
                {
                    "project": "fe",
                    "kind": "found",
                    "number": 7,
                    "title": "t",
                    "url": "u",
                    "state": "open",
                    "headBranch": "feat/x",
                    "baseBranch": "main",
                    "additions": 1,
                    "deletions": 0,
                    "changedFiles": 1,
                    "ci": { "kind": "noChecks" },
                    "approvals": 0,
                    "changesRequested": 0,
                    "mergedAt": null,
                },
                { "project": "api", "kind": "absent" },
            ]),
        );
    }
}
