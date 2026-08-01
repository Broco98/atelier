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

/// 커밋 안 된 항목들의 경로. `is_dirty`가 참일 때 **무엇 때문인지**를 준다 —
/// 워크트리 경로만 주면 사용자가 직접 가서 확인해야 한다. 판단 불가면 `None`.
pub(crate) fn dirty_files(dir: &Path) -> Option<Vec<String>> {
    // porcelain v1은 `XY <경로>` — 상태 두 글자와 공백 뒤가 경로다.
    // `-uall`이 없으면 추적 안 된 디렉터리가 `docs/` 한 줄로 접혀, 무엇 때문인지를
    // 알려준다는 목적을 못 채운다. 목록이 길어지는 것은 호출부가 잘라 낸다.
    // `core.quotePath=false`가 없으면 한글 파일명이 8진 이스케이프로 나와 역시 못 읽는다 —
    // 이 게이트가 실제로 잡는 파일들이 바로 한글 계획·리서치 문서다.
    let out = git(
        dir,
        &["-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all"],
    )?;
    Some(out.lines().filter_map(|line| line.get(3..)).map(str::to_string).collect())
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

/// 이 브랜치가 머지의 **들어가는 쪽**인가. `Merge branch 'develop' into feat/x`처럼 브랜치가
/// **받는 쪽**이면 둘째 부모는 base이지 이 브랜치가 아니고, 그 범위를 쓰면 base의 커밋이
/// 통째로 이 work 것이 된다. 브랜치가 base로 동기화된 뒤에는 ref만으로 방향을 알 수 없어
/// (브랜치와 base가 같은 커밋을 가리킨다) 여기서는 머지 메시지의 방향을 읽는다.
/// 실측: `feat/navigation-location`이 이 필터 없이 55커밋(정답 6커밋)으로 기록됐다.
fn takes_branch_as_source(subject: &str, branch: &str) -> bool {
    !subject.contains(&format!("into {branch}"))
        && !subject.contains(&format!("into '{branch}'"))
        && subject.contains(branch)
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
    let base_sha = base.and_then(|b| git(worktree, &["rev-parse", &format!("{b}^{{commit}}")]));

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
