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
