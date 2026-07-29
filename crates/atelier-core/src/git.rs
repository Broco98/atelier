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
