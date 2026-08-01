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
    let out = git(dir, &["status", "--porcelain", "--untracked-files=all"])?;
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
    /// 머지 커밋을 통해 들어갔다
    Merged { sha: String, subject: String },
    /// base에 도달했지만 이 브랜치를 들여온 머지 커밋이 없다 — fast-forward로 들어갔거나,
    /// 애초에 브랜치에 커밋이 없어 base의 옛 커밋을 그대로 가리킨다. 어느 쪽이든 브랜치의
    /// 시작점을 git에게 물을 방법이 없으므로 커밋 범위를 특정할 수 없다.
    NoMergeCommit,
    /// 반영되지 않았다 — 미반영이거나 스쿼시 머지
    NotMerged,
}

/// 아카이브 기록이 쓰는 워크트리 좌표. **워크트리가 살아 있을 때만** 뽑을 수 있다.
pub(crate) struct WorktreeRecord {
    /// 워크트리가 실제로 서 있는 커밋. 선언 브랜치와 어긋날 수 있어 따로 적는다.
    pub head: String,
    /// 분석 대상 — 선언 브랜치의 끝. 브랜치를 찾을 수 없으면 `head`.
    pub tip: String,
    pub base_sha: String,
    pub state: BaseState,
    /// (짧은 SHA, 제목)
    pub commits: Vec<(String, String)>,
    pub files: Vec<String>,
    pub insertions: u64,
    pub deletions: u64,
}

/// 워크트리 HEAD가 `base`에 대해 어떤 위치인지와, 그 브랜치가 담은 커밋·파일·증감.
/// 저장소를 읽을 수 없으면 `None` — 없는 좌표를 지어내지 않는다.
///
/// 분석은 **선언 브랜치의 끝**을 따른다. 워크트리 HEAD가 아니다 — 워크트리는 릴리스
/// 브랜치 같은 데로 흘러가 있을 수 있고, 실제로 그런 work가 있다. HEAD는 관측된 사실로
/// 따로 기록한다.
pub(crate) fn inspect_worktree(
    worktree: &Path,
    base: &str,
    branch: Option<&str>,
) -> Option<WorktreeRecord> {
    let head = git(worktree, &["rev-parse", "HEAD"])?;
    let base_sha = git(worktree, &["rev-parse", &format!("{base}^{{commit}}")])?;
    let tip = branch
        .and_then(|b| git(worktree, &["rev-parse", "--verify", &format!("refs/heads/{b}")]))
        .unwrap_or_else(|| head.clone());

    // `--is-ancestor`는 종료 코드로 답한다 — git()이 실패를 None으로 접는 성질을 그대로 쓴다.
    let reached_base = git(worktree, &["merge-base", "--is-ancestor", &tip, &base_sha]).is_some();

    // (from, to). 커밋은 `from..to`, 변경은 `from...to`(분기점 기준)로 본다.
    let (state, range) = if reached_base {
        // 브랜치를 base로 들여온 머지 커밋을 역추적한다. **`--first-parent`를 붙이면
        // 안 된다** — 브랜치가 중간 브랜치를 거쳐 올라온 중첩 병합에서 결과가 사라진다.
        let merges = git(
            worktree,
            &["rev-list", "--ancestry-path", "--merges", &format!("{tip}..{base_sha}")],
        )
        .unwrap_or_default();
        // 오래된 것부터, 두 조건을 모두 만족하는 머지를 찾는다.
        //
        // ① tip이 그 머지의 **첫 부모 쪽에 이미 있으면 안 된다** — 있으면 머지 전에 이미
        //    base에 있었다는 뜻이라, 이 브랜치를 들여온 머지가 아니라 뒤따라온 남의 머지다.
        // ② 머지 커밋이 **이 브랜치 이름을 말해야 한다.** ①만으로는 부족하다 — 커밋이 하나도
        //    없는 브랜치는 분기 시점의 커밋을 가리키는데, 그 커밋이 크로스 머지(main↔develop)로
        //    남의 브랜치에 들어가면 그 머지가 ①을 통과한다. 실제 데이터에서 커밋 0개짜리
        //    work가 develop 커밋 40개를 자기 것으로 삼았다. 이름은 우리가 가진 사실이므로
        //    형식을 추측하는 것이 아니다. 못 찾으면 침묵한다 — 틀린 귀속보다 낫다.
        let brought_in = branch.and_then(|branch| {
            merges.lines().rev().find(|sha| {
                git(worktree, &["merge-base", "--is-ancestor", &tip, &format!("{sha}^1")]).is_none()
                    && git(worktree, &["log", "-1", "--format=%s", sha])
                        .is_some_and(|subject| subject.contains(branch))
            })
        });
        match brought_in {
            Some(sha) => {
                let subject = git(worktree, &["log", "-1", "--format=%s", sha]).unwrap_or_default();
                let range = (format!("{sha}^1"), format!("{sha}^2"));
                (BaseState::Merged { sha: sha.to_string(), subject }, Some(range))
            }
            // 범위를 비워 둔다 — 머지 커밋의 존재를 가정하면 빈 결과가 깨진 범위 인자가 된다.
            None => (BaseState::NoMergeCommit, None),
        }
    } else {
        (BaseState::NotMerged, Some((base_sha.clone(), tip.clone())))
    };

    let mut commits = Vec::new();
    let mut files = Vec::new();
    let (mut insertions, mut deletions) = (0, 0);
    if let Some((from, to)) = &range {
        let log = git(worktree, &["log", "--format=%h%x09%s", &format!("{from}..{to}")])
            .unwrap_or_default();
        commits = log
            .lines()
            .filter_map(|l| l.split_once('\t'))
            .map(|(sha, subject)| (sha.to_string(), subject.to_string()))
            .collect();
        let numstat =
            git(worktree, &["diff", "--numstat", &format!("{from}...{to}")]).unwrap_or_default();
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
            files.push(path.to_string());
        }
    }
    Some(WorktreeRecord { head, tip, base_sha, state, commits, files, insertions, deletions })
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
