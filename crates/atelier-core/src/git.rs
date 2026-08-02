use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub remote_slug: Option<String>,
    pub current_branch: Option<String>,
    pub local_branches: Vec<String>,
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn detect(dir: &Path) -> Option<GitInfo> {
    git(dir, &["rev-parse", "--is-inside-work-tree"])?;
    let remote_url = git(dir, &["remote", "get-url", "origin"]);
    let current_branch = git(dir, &["branch", "--show-current"]).filter(|s| !s.is_empty());
    let local_branches = git(dir, &["for-each-ref", "--format=%(refname:short)", "refs/heads"])
        .map(|s| s.lines().map(str::to_string).collect())
        .unwrap_or_default();
    Some(GitInfo {
        remote_slug: remote_url.as_deref().and_then(parse_remote_slug),
        current_branch,
        local_branches,
    })
}

/// `origin/HEAD`가 가리키는 기본 브랜치 이름 (예: "main")
pub fn origin_head(dir: &Path) -> Option<String> {
    git(dir, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .and_then(|s| s.split_once('/').map(|(_, b)| b.to_string()))
}

pub(crate) fn branch_exists(repo: &Path, name: &str) -> bool {
    git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")]).is_some()
}

/// git이 브랜치 이름으로 받아들이는가. 규칙(`..`, 공백, `~^:?*[`, `.lock` 끝 등)을
/// 여기서 다시 쓰면 git과 어긋나므로 git에게 직접 묻는다. 저장소가 필요 없는 문법 검사다.
pub(crate) fn is_valid_branch_name(name: &str) -> bool {
    match Command::new("git")
        .args(["check-ref-format", &format!("refs/heads/{name}")])
        .output()
    {
        Ok(out) => out.status.success(),
        // git을 못 띄운 것은 이름이 나쁘다는 뜻이 아니다. 여기서 거부하면 git이 없는 환경에서
        // 모든 work 시작이 "invalid branch name"으로 죽어, 진짜 원인을 가린다. 판단을 보류하고
        // 워크트리 생성이 제 이름으로 실패하게 둔다.
        Err(_) => true,
    }
}

pub(crate) fn rev_exists(repo: &Path, rev: &str) -> bool {
    git(repo, &["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")]).is_some()
}

/// `path`에 `branch` 워크트리 생성. 브랜치가 없으면 `base`에서 분기해 만들고,
/// 이미 있으면(부분 실패 잔재 등) 그 브랜치를 채택한다.
pub(crate) fn worktree_add(
    repo: &Path,
    path: &Path,
    branch: &str,
    base: &str,
) -> std::result::Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(["worktree", "add"]);
    if branch_exists(repo, branch) {
        cmd.arg(path).arg(branch);
    } else {
        cmd.args(["-b", branch]).arg(path).arg(base);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 커밋 안 된 변경이 있는지. git 저장소가 아니거나 판단 불가면 보수적으로 dirty 취급.
pub(crate) fn is_dirty(dir: &Path) -> bool {
    match git(dir, &["status", "--porcelain"]) {
        Some(s) => !s.is_empty(),
        None => true,
    }
}

/// dirty 판정에 걸린 항목 하나.
pub(crate) struct DirtyEntry {
    /// git이 아직 모르는 파일(`??`). **`git stash`는 `-u` 없이 이것을 못 치운다** —
    /// 이 구분이 없으면 읽는 쪽이 안 듣는 처방을 골라 똑같이 막히고 이유를 모른다.
    pub untracked: bool,
    pub path: String,
}

/// 커밋 안 됐거나 아예 추적되지 않는 항목들. `is_dirty`가 참일 때 **무엇 때문인지**를 준다 —
/// 워크트리 경로만 주면 사용자가 직접 가서 확인해야 한다. 판단 불가면 `None`.
pub(crate) fn dirty_files(dir: &Path) -> Option<Vec<DirtyEntry>> {
    // `-uall`이 없으면 추적 안 된 디렉터리가 `docs/` 한 줄로 접혀, 무엇 때문인지를
    // 알려준다는 목적을 못 채운다. 목록이 길어지는 것은 호출부가 잘라 낸다.
    // `core.quotePath=false`가 없으면 한글 파일명이 8진 이스케이프로 나와 역시 못 읽는다 —
    // 이 게이트가 실제로 잡는 파일들이 바로 한글 계획·리서치 문서다.
    let out = git(
        dir,
        &["-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all"],
    )?;
    // porcelain v1은 `XY <경로>`이지만 고정 오프셋으로 자르면 안 된다: `git()`이 출력 전체를
    // trim해서 **첫 줄만** 앞 공백이 깎인다(` M a.txt` → `M a.txt`). 그러면 그 줄의 경로
    // 첫 글자가 잘려 나간다 — 실제로 `a.txt`가 `.txt`로 나갔다. 상태 두 글자를 떼고 남은
    // 공백을 지우는 쪽이 깎인 줄과 안 깎인 줄을 함께 견딘다.
    Some(
        out.lines()
            .filter_map(|line| {
                let code = line.get(..2)?;
                let path = line.get(2..)?.trim_start();
                (!path.is_empty()).then(|| DirtyEntry {
                    untracked: code.trim_start() == "??",
                    path: path.to_string(),
                })
            })
            .collect(),
    )
}

/// 워크트리 제거. 브랜치는 건드리지 않는다.
pub(crate) fn worktree_remove(worktree: &Path, force: bool) -> std::result::Result<(), String> {
    let common = git(worktree, &["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .ok_or_else(|| format!("not a git worktree: {}", worktree.display()))?;
    let repo = Path::new(&common)
        .parent()
        .ok_or_else(|| format!("cannot resolve repo for: {}", worktree.display()))?
        .to_path_buf();
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&repo).args(["worktree", "remove"]);
    if force {
        cmd.arg("--force");
    }
    let out = cmd.arg(worktree).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 브랜치가 base에 반영된 방식.
pub(crate) enum BaseState {
    /// 머지 커밋을 통해 들어갔다. `merges`는 그런 머지가 몇 번 있었는지.
    Merged { sha: String, subject: String, merges: usize },
    /// base에 도달했지만 이 브랜치를 들여온 머지 커밋이 없다 — fast-forward로 들어갔거나,
    /// 애초에 브랜치에 커밋이 없어 base의 옛 커밋을 그대로 가리킨다. 어느 쪽이든 브랜치의
    /// 시작점을 git에게 물을 방법이 없으므로 커밋 범위를 특정할 수 없다.
    NoMergeCommit,
    /// base에서 이 커밋들을 찾지 못했다 — 미반영이거나, 스쿼시·리베이스로 SHA가 바뀌었다.
    NotMerged,
    /// base 자체를 알 수 없어 판정하지 못했다. 좌표는 그대로 남는다.
    BaseUnknown,
}

/// 아카이브 기록이 쓰는 워크트리 좌표. **워크트리가 살아 있을 때만** 뽑을 수 있다.
pub(crate) struct WorktreeRecord {
    /// 워크트리가 실제로 서 있는 커밋. 선언 브랜치와 어긋날 수 있어 따로 적는다.
    pub head: String,
    /// 선언 브랜치의 끝. 그 브랜치가 저장소에 없으면 `None`이고, 분석은 `head`로 물러선다 —
    /// 없는 브랜치의 끝인 양 HEAD를 적으면 기계가 진실인 척하는 것이다.
    pub branch_tip: Option<String>,
    /// 실제 분석 대상 (`branch_tip`이 없으면 `head`)
    pub tip: String,
    pub base_sha: Option<String>,
    pub state: BaseState,
    /// (짧은 SHA, 제목)
    pub commits: Vec<(String, String)>,
    pub files: Vec<String>,
    pub insertions: u64,
    pub deletions: u64,
}

/// base 히스토리에서 **이 브랜치를 들여온** 머지 커밋들 (최신 → 오래된 순).
///
/// 범위를 `tip..base`로 좁히면 안 된다. 머지된 뒤 워크트리에서 브랜치를 base로 동기화하면
/// (이미 다 머지된 브랜치라 fast-forward된다) 브랜치 ref가 자기 머지 커밋 **위로** 올라가
/// 그 머지가 범위 밖으로 나간다. 실측에서 6커밋·33파일짜리 work가 "커밋 0개"로 기록됐다.
///
/// 이름으로 후보를 좁히고 **구조로 확인한다.** 이름만 보면 접두 관계 브랜치(`feat/x`와
/// `feat/x-followup`)가 서로의 머지를 자기 것으로 삼는다 — 그 머지가 들여온 쪽(`^2`)이
/// 이 브랜치 끝에 포함돼 있어야 한다. 구조만 보는 것도 안 된다(크로스 머지 오탐).
fn merges_that_brought_in(worktree: &Path, branch: &str, base_sha: &str, tip: &str) -> Vec<String> {
    let listed = git(
        worktree,
        &["rev-list", "--merges", "--fixed-strings", &format!("--grep={branch}"), base_sha],
    )
    .unwrap_or_default();
    listed
        .lines()
        .filter(|sha| {
            git(worktree, &["merge-base", "--is-ancestor", &format!("{sha}^2"), tip]).is_some()
                && git(worktree, &["log", "-1", "--format=%s", sha])
                    .is_some_and(|subject| takes_branch_as_source(&subject, branch))
        })
        .map(str::to_string)
        .collect()
}

/// 이 브랜치가 머지의 **들어가는 쪽**인가.
///
/// 이름을 **비교하지 않고 꺼낸다.** 포함 여부로 보면 셋이 한꺼번에 틀린다:
/// - 접두 관계 — `feat/a`가 `feat/ab`의 머지를 자기 것으로 삼는다
/// - revert 브랜치 — `revert-12-feat/a`의 머지가 `feat/a` 것으로 기록된다
/// - 방향 — `Merge branch 'develop' into feat/a`는 브랜치가 **받는** 쪽이라 둘째 부모가
///   base다. 그 범위를 쓰면 base의 커밋이 통째로 이 work 것이 된다.
///   (실측: `feat/navigation-location`이 방향을 안 보면 55커밋, 정답은 6커밋)
///
/// 꺼낸 이름이 정확히 일치할 때만 채택하므로 셋이 함께 막힌다. 대신 관습적이지 않은
/// 머지 제목은 아무것도 못 꺼내 "반영 안 됨"으로 남는다 — **적게 말하는 쪽**이고,
/// 커밋·파일 좌표 자체는 어느 경우든 보존된다.
fn takes_branch_as_source(subject: &str, branch: &str) -> bool {
    merged_branch(subject) == Some(branch)
}

/// 머지 커밋 제목에서 **들여온 브랜치 이름**을 꺼낸다. git과 GitHub이 쓰는 세 형태만 읽는다.
fn merged_branch(subject: &str) -> Option<&str> {
    // Merge pull request #12 from owner/feat/x  — 소유자 한 마디를 떼면 나머지가 이름이다
    if let Some(rest) = subject.split_once(" from ").map(|(_, r)| r) {
        if subject.starts_with("Merge pull request #") {
            return rest.split_once('/').map(|(_, b)| b.trim());
        }
    }
    // Merge branch 'feat/x' [into y] / Merge remote-tracking branch 'origin/feat/x' [into y]
    let quoted = subject.split_once('\'').and_then(|(_, r)| r.split_once('\'')).map(|(b, _)| b)?;
    if subject.starts_with("Merge remote-tracking branch") {
        // 원격 이름 한 마디를 뗀다 — 'origin/feat/x' 는 브랜치 feat/x 다
        return quoted.split_once('/').map(|(_, b)| b);
    }
    subject.starts_with("Merge branch").then_some(quoted)
}

/// 워크트리 HEAD가 `base`에 대해 어떤 위치인지와, 그 브랜치가 담은 커밋·파일·증감.
/// 워크트리를 읽을 수 없을 때만 `None` — 없는 좌표를 지어내지 않는다.
///
/// 분석은 **선언 브랜치의 끝**을 따른다. 워크트리 HEAD가 아니다 — 워크트리는 릴리스
/// 브랜치 같은 데로 흘러가 있을 수 있고, 실제로 그런 work가 있다. HEAD는 관측된 사실로
/// 따로 기록한다.
///
/// `base`가 없거나 못 읽어도 **좌표는 남긴다.** 커밋 목록을 통째로 담기로 한 이유가
/// "프로젝트를 등록 해제하면 SHA로 복원이 안 된다"였는데, 그 경우에 아무것도 안 남기면
/// 그 결정이 산 것을 그대로 잃는다.
pub(crate) fn inspect_worktree(
    worktree: &Path,
    base: Option<&str>,
    branch: Option<&str>,
) -> Option<WorktreeRecord> {
    let head = git(worktree, &["rev-parse", "HEAD"])?;
    let branch_tip =
        branch.and_then(|b| git(worktree, &["rev-parse", "--verify", &format!("refs/heads/{b}")]));
    let tip = branch_tip.clone().unwrap_or_else(|| head.clone());
    // 원격을 먼저 본다. 로컬 base ref는 뒤처져 있기 일쑤고(이 저장소에서도 실제로 그랬다),
    // 뒤처진 ref로 판정하면 **원격에서 이미 머지된 work가 "미반영"으로 영구히 굳는다** —
    // 아카이브에는 되돌리기가 없다. 원격이 없으면 로컬로 물러선다.
    let base_sha = base.and_then(|b| {
        git(worktree, &["rev-parse", &format!("origin/{b}^{{commit}}")])
            .or_else(|| git(worktree, &["rev-parse", &format!("{b}^{{commit}}")]))
    });

    let Some(base_sha) = base_sha else {
        return Some(WorktreeRecord {
            head,
            branch_tip,
            tip,
            base_sha: None,
            state: BaseState::BaseUnknown,
            commits: Vec::new(),
            files: Vec::new(),
            insertions: 0,
            deletions: 0,
        });
    };

    // `--is-ancestor`는 종료 코드로 답한다 — git()이 실패를 None으로 접는 성질을 그대로 쓴다.
    let reached_base = git(worktree, &["merge-base", "--is-ancestor", &tip, &base_sha]).is_some();

    // 각 머지가 들여온 구간. 커밋은 `from..to`, 변경은 `from...to`(분기점 기준)로 본다.
    let (state, ranges) = if reached_base {
        let found = branch
            .map(|b| merges_that_brought_in(worktree, b, &base_sha, &tip))
            .unwrap_or_default();
        match found.first() {
            // 같은 브랜치가 여러 번 머지됐으면 **각 머지의 구간을 합집합으로** 모은다.
            // 하나로 이어 붙이면 그 사이 base가 나아간 커밋까지 딸려 들어온다.
            Some(newest) => {
                let subject =
                    git(worktree, &["log", "-1", "--format=%s", newest]).unwrap_or_default();
                let ranges: Vec<(String, String)> =
                    found.iter().map(|sha| (format!("{sha}^1"), format!("{sha}^2"))).collect();
                let state =
                    BaseState::Merged { sha: newest.clone(), subject, merges: found.len() };
                (state, ranges)
            }
            // 범위를 비워 둔다 — 머지 커밋의 존재를 가정하면 빈 결과가 깨진 범위 인자가 된다.
            None => (BaseState::NoMergeCommit, Vec::new()),
        }
    } else {
        (BaseState::NotMerged, vec![(base_sha.clone(), tip.clone())])
    };
    let base_sha = Some(base_sha);

    let mut commits: Vec<(String, String)> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let (mut insertions, mut deletions) = (0, 0);
    for (from, to) in &ranges {
        let log = git(worktree, &["log", "--format=%h%x09%s", &format!("{from}..{to}")])
            .unwrap_or_default();
        for (sha, subject) in log.lines().filter_map(|l| l.split_once('\t')) {
            if !commits.iter().any(|(seen, _)| seen == sha) {
                commits.push((sha.to_string(), subject.to_string()));
            }
        }
        // `core.quotePath`를 끄지 않으면 비ASCII 파일명이 `"\355\225\234..."` 8진 이스케이프로
        // 나온다. 이 저장소의 실제 문서 파일명이 한글이라 기록이 읽을 수 없게 된다.
        let numstat = git(
            worktree,
            &["-c", "core.quotePath=false", "diff", "--numstat", &format!("{from}...{to}")],
        )
        .unwrap_or_default();
        for line in numstat.lines() {
            let mut parts = line.splitn(3, '\t');
            let (Some(added), Some(deleted), Some(path)) =
                (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            // 바이너리는 증감이 `-`로 나온다 — 세지 않고 파일 목록에는 남긴다
            insertions += added.parse::<u64>().unwrap_or(0);
            deletions += deleted.parse::<u64>().unwrap_or(0);
            // 여러 머지에 걸쳐 같은 파일이 바뀌었으면 목록에는 한 번만 (증감은 합산이 맞다)
            if !files.iter().any(|seen| seen == path) {
                files.push(path.to_string());
            }
        }
    }
    Some(WorktreeRecord {
        head,
        branch_tip,
        tip,
        base_sha,
        state,
        commits,
        files,
        insertions,
        deletions,
    })
}

fn parse_remote_slug(url: &str) -> Option<String> {
    let url = url.trim_end_matches(".git");
    let tail = if let Some((_, t)) = url.split_once("://") {
        t.split_once('/').map(|(_, path)| path)?
    } else if let Some((_, t)) = url.split_once(':') {
        t
    } else {
        return None;
    };
    let mut parts = tail.rsplit('/');
    let repo = parts.next()?;
    let owner = parts.next()?;
    Some(format!("{owner}/{repo}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn run(dir: &Path, args: &[&str]) {
        let ok = Command::new("git").arg("-C").arg(dir).args(args)
            .output().unwrap().status.success();
        assert!(ok, "git {args:?} failed");
    }

    fn init_repo(dir: &Path) {
        run(dir, &["init", "-b", "main"]);
        run(dir, &["config", "user.email", "t@t.t"]);
        run(dir, &["config", "user.name", "t"]);
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        run(dir, &["add", "."]);
        run(dir, &["commit", "-m", "init"]);
    }

    #[test]
    fn non_repo_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(detect(dir.path()).is_none());
    }

    /// 머지 제목 판독. 이 판정 하나가 `record.md`의 "base 반영"과 커밋 범위를 정하고,
    /// 아카이브는 되돌릴 수 없으므로 틀린 값이 영구히 굳는다.
    #[test]
    fn a_merge_is_ours_only_when_the_subject_names_this_branch_as_the_source() {
        let ours = "feat/a";

        // 들여온 쪽이 우리다
        assert!(takes_branch_as_source("Merge pull request #12 from Broco98/feat/a", ours));
        assert!(takes_branch_as_source("Merge branch 'feat/a'", ours));
        assert!(takes_branch_as_source("Merge branch 'feat/a' into develop", ours));

        // 접두 관계 — 남의 머지를 삼키면 안 된다
        assert!(!takes_branch_as_source("Merge pull request #13 from Broco98/feat/ab", ours));
        assert!(!takes_branch_as_source("Merge branch 'feat/a-followup' into develop", ours));

        // revert 브랜치 — 이름을 품고 있지만 우리 것이 아니다
        assert!(!takes_branch_as_source("Merge pull request #14 from Broco98/revert-12-feat/a", ours));

        // 방향이 반대 — 우리가 **받는** 쪽이면 둘째 부모는 base다
        assert!(!takes_branch_as_source("Merge branch 'develop' into feat/a", ours));
        assert!(!takes_branch_as_source(
            "Merge remote-tracking branch 'origin/develop' into feat/a",
            ours
        ));

        // 원격 추적 브랜치로 우리를 들여온 경우는 우리 것이다
        assert!(takes_branch_as_source("Merge remote-tracking branch 'origin/feat/a'", ours));

        // 관습을 벗어난 제목은 아무것도 안 꺼낸다 — 적게 말한다
        assert!(!takes_branch_as_source("feat/a 를 합침", ours));
    }

    #[test]
    fn detects_branch_and_remote() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path());
        run(dir.path(), &["remote", "add", "origin", "git@github.com:team/billing.git"]);
        let info = detect(dir.path()).unwrap();
        assert_eq!(info.current_branch.as_deref(), Some("main"));
        assert_eq!(info.remote_slug.as_deref(), Some("team/billing"));
        assert_eq!(info.local_branches, vec!["main".to_string()]);
    }

    #[test]
    fn origin_head_resolves_default_branch() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path());
        run(dir.path(), &["remote", "add", "origin", "git@github.com:team/billing.git"]);
        run(dir.path(), &["update-ref", "refs/remotes/origin/main", "HEAD"]);
        run(dir.path(), &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
        assert_eq!(origin_head(dir.path()).as_deref(), Some("main"));
    }

    #[test]
    fn parses_remote_url_shapes() {
        assert_eq!(parse_remote_slug("https://github.com/owner/repo.git").as_deref(), Some("owner/repo"));
        assert_eq!(parse_remote_slug("git@gitlab.com:group/proj.git").as_deref(), Some("group/proj"));
        assert_eq!(parse_remote_slug("ssh://git@host.com/owner/repo").as_deref(), Some("owner/repo"));
    }
}
