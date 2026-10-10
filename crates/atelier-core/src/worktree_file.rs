//! **워크트리 읽기 — 파일 읽기**(git-integration 판 01). 파일 탭의 본문이 읽는 것이다.
//!
//! work slug와 프로젝트 slug로 워크트리를 찾는다 — work 목록이 쓰는 자리(`works::worktrees_dir`)와 같은 길이다. 화면에는
//! 좁힌 뷰 타입만 보낸다(결정 「git 호출은 Rust」). 파일이 없거나 워크트리가 없는 것은 `Err`가 아니라 **답의 갈래**다 — 화면이
//! 탭 안에 그 까닭을 그린다(스토리 61). `Err`는 부른 쪽이 틀렸을 때(밖을 가리키는 slug · `..` · 절대 경로)뿐이다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{Error, Result};

/// 파일 읽기의 답. 이미지 · 바이너리 · UTF-8 아님 · 너무 큼은 다음 장(09)이 가른다 — 이 장에서 UTF-8로 못 읽는 것은
/// 「읽지 못함」이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorktreeFile {
    /// 내용과 줄 수. 줄 수는 끝의 줄바꿈 뒤 빈 줄을 세지 않는다.
    Text { content: String, lines: usize },
    /// 파일이 없다 — 지워졌거나 주소가 없는 경로를 가리킨다. 탭은 남고 「지워진 파일」이 뜬다.
    Missing,
    /// 그 프로젝트의 워크트리 폴더가 없다(그 work에 없는 프로젝트도 같다).
    WorktreeMissing,
    /// 심링크의 실제 대상이 워크트리 밖이다 — **읽지 않는다**(스토리 78). 대상은 `~` 축약 표기다.
    OutsideLink { target: String },
    /// 있는데 읽지 못했다 — 폴더이거나, UTF-8이 아니거나, 디스크가 거절했다.
    Unreadable { reason: String },
}

/// 워크트리 파일 하나를 읽는다(구현 스펙 「코어 — 워크트리 읽기 › 파일 읽기」).
///
/// **경로 가드가 두 겹이다.** 먼저 글자로 — 상대 경로이고 일반 조각만이어야 한다(spec 읽기의 `safe_rel`과 같은 규칙,
/// `..` · 절대 경로는 `Err`). 그 위에 **실제 경로를 풀어 워크트리 안인지 본다** — 글자 가드는 심링크를 막지 못해서, 안쪽
/// 이름이 밖을 가리키면 그 대상을 읽게 된다. 밖이면 읽지 않고 「바깥 링크 + 대상」이다. 워크트리 안을 가리키는 링크는
/// 그대로 따라가 읽는다.
pub fn read_worktree_file(works_root: &Path, slug: &str, project: &str, rel_path: &str) -> Result<WorktreeFile> {
    let rel = crate::works::safe_rel(rel_path)?;
    let dir = worktree_dir(works_root, slug, project)?;
    if !dir.is_dir() {
        return Ok(WorktreeFile::WorktreeMissing);
    }
    // 양쪽을 다 푼다 — macOS 임시 폴더(`/var/…` → `/private/var/…`)처럼 뿌리 자체가 링크를 지나면 한쪽만 푼 비교는
    // 늘 「밖」이다.
    let root = match dir.canonicalize() {
        Ok(root) => root,
        Err(e) => return Ok(WorktreeFile::Unreadable { reason: e.to_string() }),
    };
    let real = match dir.join(rel).canonicalize() {
        Ok(real) => real,
        // 끊긴 링크도 여기로 온다 — 가리키는 것이 없으니 읽을 것도 없다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(WorktreeFile::Missing),
        Err(e) => return Ok(WorktreeFile::Unreadable { reason: e.to_string() }),
    };
    if !real.starts_with(&root) {
        return Ok(WorktreeFile::OutsideLink { target: crate::paths::collapse_home(&real) });
    }
    if real.is_dir() {
        return Ok(WorktreeFile::Unreadable { reason: "is a directory".to_string() });
    }
    let bytes = match std::fs::read(&real) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(WorktreeFile::Missing),
        Err(e) => return Ok(WorktreeFile::Unreadable { reason: e.to_string() }),
    };
    Ok(match String::from_utf8(bytes) {
        Ok(content) => WorktreeFile::Text { lines: content.lines().count(), content },
        Err(_) => WorktreeFile::Unreadable { reason: "not UTF-8".to_string() },
    })
}

/// 워크트리 자리. 프로젝트 slug도 work slug와 같은 검사를 지난다 — 경로 조각이 되기 때문이다.
fn worktree_dir(works_root: &Path, slug: &str, project: &str) -> Result<PathBuf> {
    if !crate::slug::is_safe_slug(project) {
        return Err(Error::Validation(format!("invalid project: {project}")));
    }
    Ok(crate::works::worktrees_dir(&crate::works::work_dir(works_root, slug)?).join(project))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// works 테스트의 저장소 만들기를 본뜬다 — 저장소 `fe`(커밋된 `a.txt` 하나)를 프로젝트로 등록하고, work `w`를 시작해
    /// 진짜 git 워크트리를 만든다. 돌려주는 것은 임시 폴더(살아 있어야 한다) · works 루트 · 워크트리 자리다.
    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let works = tmp.path().join("works");
        let projects = tmp.path().join("projects");
        let repo = tmp.path().join("fe");
        std::fs::create_dir_all(&repo).unwrap();
        run_git(&repo, &["init", "-b", "main"]);
        run_git(&repo, &["config", "user.email", "t@t.t"]);
        run_git(&repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("a.txt"), "x").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "init"]);
        crate::create_project(&projects, &repo).unwrap();
        crate::start_work(
            &works,
            &tmp.path().join("archive"),
            &projects,
            "files",
            Some("w"),
            &["fe".to_string()],
            Some("feat/files"),
        )
        .unwrap();
        let worktree = works.join("w").join("trees").join("fe");
        assert!(worktree.join(".git").is_file(), "워크트리가 서지 않았다 — 뿌리의 `.git`이 연결 파일이 아니다");
        (tmp, works, worktree)
    }

    fn write(root: &Path, rel: &str, body: &[u8]) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn read(works: &Path, rel: &str) -> WorktreeFile {
        read_worktree_file(works, "w", "fe", rel).unwrap()
    }

    #[test]
    fn a_text_file_comes_with_its_content_and_line_count() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "src/main.ts", "const a = 1;\nconst b = 2;\n// 끝\n".as_bytes());

        assert_eq!(
            read(&works, "src/main.ts"),
            WorktreeFile::Text { content: "const a = 1;\nconst b = 2;\n// 끝\n".to_string(), lines: 3 }
        );
        // 끝에 줄바꿈이 없어도 마지막 줄을 센다 — 빈 파일은 0줄이다
        write(&worktree, "one.txt", b"only");
        assert_eq!(read(&works, "one.txt"), WorktreeFile::Text { content: "only".to_string(), lines: 1 });
        write(&worktree, "empty.txt", b"");
        assert_eq!(read(&works, "empty.txt"), WorktreeFile::Text { content: String::new(), lines: 0 });
    }

    #[test]
    fn a_missing_file_is_missing_not_an_error() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "gone.txt", b"x");
        std::fs::remove_file(worktree.join("gone.txt")).unwrap();

        assert_eq!(read(&works, "gone.txt"), WorktreeFile::Missing);
        assert_eq!(read(&works, "no/such/dir.txt"), WorktreeFile::Missing);
    }

    #[test]
    fn a_project_without_a_worktree_is_worktree_missing() {
        let (_tmp, works, _worktree) = setup();
        // 그 work에 없는 프로젝트 — 주소가 가리킬 수 있다(티켓 04)
        assert_eq!(read_worktree_file(&works, "w", "be", "a.txt").unwrap(), WorktreeFile::WorktreeMissing);
    }

    #[test]
    fn dot_dot_and_absolute_paths_are_refused() {
        let (_tmp, works, _worktree) = setup();
        for bad in ["../fe/a.txt", "src/../../a.txt", "/etc/hosts", "", "./a.txt"] {
            assert!(
                matches!(read_worktree_file(&works, "w", "fe", bad), Err(Error::Validation(_))),
                "{bad:?}가 거절되지 않았다"
            );
        }
        // 프로젝트 · work slug도 경로 조각이다
        assert!(matches!(read_worktree_file(&works, "w", "../fe", "a.txt"), Err(Error::Validation(_))));
        assert!(matches!(read_worktree_file(&works, "../w", "fe", "a.txt"), Err(Error::WorkNotFound(_))));
    }

    #[test]
    #[cfg(unix)]
    fn a_link_out_of_the_worktree_is_not_read() {
        let (tmp, works, worktree) = setup();
        let secret = tmp.path().join("secret.txt");
        std::fs::write(&secret, "do not read").unwrap();
        std::os::unix::fs::symlink(&secret, worktree.join("out.txt")).unwrap();
        // 폴더 링크를 지나 밖으로 나가는 경로도 같다
        std::os::unix::fs::symlink(tmp.path(), worktree.join("up")).unwrap();

        let target = crate::paths::collapse_home(&secret.canonicalize().unwrap());
        assert_eq!(read(&works, "out.txt"), WorktreeFile::OutsideLink { target: target.clone() });
        assert_eq!(read(&works, "up/secret.txt"), WorktreeFile::OutsideLink { target });
    }

    #[test]
    #[cfg(unix)]
    fn a_link_inside_the_worktree_is_read_as_text() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "docs/real.md", b"# real\n");
        std::os::unix::fs::symlink("docs/real.md", worktree.join("alias.md")).unwrap();

        assert_eq!(read(&works, "alias.md"), WorktreeFile::Text { content: "# real\n".to_string(), lines: 1 });
    }
}
