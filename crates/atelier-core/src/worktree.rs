//! **워크트리 읽기** — files 칸이 보는 워크트리의 트리(git-integration 판 01).
//!
//! 모든 함수는 work slug와 프로젝트 slug로 워크트리를 찾는다 — work 목록이 쓰는 자리(`works::worktrees_dir`)와 같은
//! 길이다. 화면에는 좁힌 뷰 타입만 보낸다(결정 「git 호출은 Rust」). 워크트리가 없거나 git이 실패한 것은 `Err`가 아니라
//! **답의 갈래**다 — 화면이 구획마다 그 까닭을 그린다. `Err`는 부른 쪽이 틀렸을 때(밖을 가리키는 slug)뿐이다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::{Error, Result};

/// 트리 항목의 종류. 심링크는 따라가지 않고 그 자리의 항목으로 둔다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeEntryKind {
    File,
    Folder,
    Symlink,
    /// 하위 모듈 — 다른 저장소라 펼치지 않는다(구현 스펙 S3).
    Submodule,
}

/// 트리 항목 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub name: String,
    /// 워크트리 기준 상대 경로 — 조각은 `/`로 잇는다.
    pub path: String,
    pub kind: WorktreeEntryKind,
    /// gitignore에 걸렸는가. 걸린 폴더 안의 것은 모두 걸린 것이다.
    pub ignored: bool,
    /// 폴더의 자식 — 폴더 먼저 · 이름순. **`None`이면 아직 안 읽은 폴더다**(걸린 폴더 — 펼칠 때 한 겹 읽는다). 폴더가 아니면
    /// 빈 목록이다.
    pub children: Option<Vec<WorktreeEntry>>,
}

/// 트리 목록의 답.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorktreeTree {
    /// 워크트리 뿌리 바로 아래의 항목들.
    Listed { entries: Vec<WorktreeEntry> },
    /// 그 프로젝트의 워크트리 폴더가 없다.
    WorktreeMissing,
    /// 폴더는 있지만 읽지 못했다 — 저장소가 아니거나 git이 실패했다.
    Unreadable { reason: String },
}

/// 워크트리 하나의 전체 트리(구현 스펙 「코어 — 워크트리 읽기 › 트리 목록」).
///
/// **gitignore 판정은 git 자신에게 묻는다**(S1) — 중첩 `.gitignore` · `.git/info/exclude` · 전역 제외를 git과 똑같이
/// 가르려면 그 길뿐이다. 두 번 부른다.
/// - 걸리지 않은 것: 추적 중 + 추적 안 됐지만 걸리지 않은 것.
/// - 걸린 것: 맨 위에서 처음 걸리는 자리만, 폴더는 폴더째. 걸린 폴더는 자식을 읽지 않은 채 둔다.
///
/// 점 파일은 그대로 들어오고, `.git`은 git이 내놓지 않아 저절로 빠진다. 빈 폴더는 git이 몰라 없다(S2). 정렬(폴더 먼저,
/// 이름순)은 화면이 아니라 여기서 한다(S4).
pub fn list_worktree_tree(works_root: &Path, slug: &str, project: &str) -> Result<WorktreeTree> {
    let dir = worktree_dir(works_root, slug, project)?;
    if !dir.is_dir() {
        return Ok(WorktreeTree::WorktreeMissing);
    }
    // 저장소가 아닌 폴더에서 git은 위로 올라가 바깥 저장소를 읽는다 — 그 답은 이 폴더의 트리가 아니다. 뿌리에 `.git`(워크트리면
    // 연결 파일)이 있어야 이 폴더가 저장소의 뿌리다.
    if !dir.join(".git").exists() {
        return Ok(WorktreeTree::Unreadable { reason: "not a git repository".to_string() });
    }
    let listed = ls_files(&dir, &["--cached", "--others", "--exclude-standard"]).and_then(|unignored| {
        ls_files(&dir, &["--others", "--ignored", "--exclude-standard", "--directory"])
            .map(|ignored| (unignored, ignored))
    });
    let (unignored, ignored) = match listed {
        Ok(both) => both,
        Err(reason) => return Ok(WorktreeTree::Unreadable { reason }),
    };

    let mut root = Folder::default();
    for rel in &unignored {
        // 끝이 `/`인 것은 추적 안 된 안쪽 저장소다 — git이 들어가지 않는다. 하위 모듈과 같이 펼치지 않는다.
        if let Some(nested) = rel.strip_suffix('/') {
            root.insert(nested, Slot::Leaf { kind: WorktreeEntryKind::Submodule, ignored: false });
            continue;
        }
        // **`--cached`는 디스크에서 지운 추적 파일도 낸다** — 디스크에 없는 것은 트리에 없다.
        let Ok(meta) = std::fs::symlink_metadata(dir.join(rel)) else { continue };
        let kind = if meta.file_type().is_symlink() {
            WorktreeEntryKind::Symlink
        } else if meta.is_dir() {
            // 추적 파일 자리가 폴더면 하위 모듈(gitlink)이다
            WorktreeEntryKind::Submodule
        } else {
            WorktreeEntryKind::File
        };
        root.insert(rel, Slot::Leaf { kind, ignored: false });
    }
    for rel in &ignored {
        match rel.strip_suffix('/') {
            Some(folder) => root.insert(folder, Slot::Unread),
            None => {
                let Ok(meta) = std::fs::symlink_metadata(dir.join(rel)) else { continue };
                let kind = if meta.file_type().is_symlink() { WorktreeEntryKind::Symlink } else { WorktreeEntryKind::File };
                root.insert(rel, Slot::Leaf { kind, ignored: true });
            }
        }
    }
    Ok(WorktreeTree::Listed { entries: root.into_entries("") })
}

/// `git ls-files -z`의 경로들. 읽기 전용 관례대로 `--no-optional-locks`를 하위 명령 앞에 둔다(`git.rs`의 상태 읽기와 같다).
/// `-z`라 따옴표 치기가 없고(한글 이름 그대로) 끝의 NUL이 빈 조각으로 남지 않게 거른다.
fn ls_files(dir: &Path, args: &[&str]) -> std::result::Result<Vec<String>, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["--no-optional-locks", "ls-files", "-z"])
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(out
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .collect())
}

/// 트리를 세우는 동안의 폴더 — 이름 → 자리. 정렬은 항목으로 옮길 때 한 번 한다.
#[derive(Default)]
struct Folder {
    slots: BTreeMap<String, Slot>,
}

enum Slot {
    Leaf { kind: WorktreeEntryKind, ignored: bool },
    Folder(Folder),
    /// 걸린 폴더 — 자식을 읽지 않은 채 둔다.
    Unread,
}

impl Folder {
    /// 경로 하나를 제자리에 넣는다. 사이 폴더는 걸리지 않은 폴더로 선다.
    ///
    /// **걸린 폴더 아래는 넣지 않는다.** 안의 것이 모두 걸린 폴더를 git은 폴더째 내면서 그 안의 파일을 한 번 더 따로 낼 때가
    /// 있다(`logs/`와 `logs/a.log`) — 트리에는 맨 위에서 처음 걸리는 자리 하나만 선다.
    fn insert(&mut self, rel: &str, slot: Slot) {
        let (head, rest) = match rel.split_once('/') {
            Some((head, rest)) => (head, Some(rest)),
            None => (rel, None),
        };
        match rest {
            None => {
                self.slots.entry(head.to_string()).or_insert(slot);
            }
            Some(rest) => {
                let child = self.slots.entry(head.to_string()).or_insert_with(|| Slot::Folder(Folder::default()));
                if let Slot::Folder(folder) = child {
                    folder.insert(rest, slot);
                }
            }
        }
    }

    /// 항목으로 옮긴다 — 폴더(하위 모듈 포함) 먼저, 그다음 이름순이다(S4). 이름은 대소문자를 가리지 않고 견주고, 같으면 글자
    /// 그대로 견준다 — 탐색기의 순서다.
    fn into_entries(self, parent: &str) -> Vec<WorktreeEntry> {
        let mut entries: Vec<WorktreeEntry> = self
            .slots
            .into_iter()
            .map(|(name, slot)| {
                let path = if parent.is_empty() { name.clone() } else { format!("{parent}/{name}") };
                let (kind, ignored, children) = match slot {
                    Slot::Leaf { kind, ignored } => (kind, ignored, Some(Vec::new())),
                    Slot::Unread => (WorktreeEntryKind::Folder, true, None),
                    Slot::Folder(folder) => (WorktreeEntryKind::Folder, false, Some(folder.into_entries(&path))),
                };
                WorktreeEntry { name, path, kind, ignored, children }
            })
            .collect();
        entries.sort_by(|a, b| {
            let folder = |entry: &WorktreeEntry| {
                matches!(entry.kind, WorktreeEntryKind::Folder | WorktreeEntryKind::Submodule)
            };
            folder(b)
                .cmp(&folder(a))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });
        entries
    }
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

    fn run_git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
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

    /// 파일 하나를 쓴다 — 사이 폴더도 함께 만든다.
    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn commit_all(worktree: &Path) {
        run_git(worktree, &["add", "."]);
        run_git(worktree, &["commit", "-m", "more"]);
    }

    fn listed(works: &Path) -> Vec<WorktreeEntry> {
        match list_worktree_tree(works, "w", "fe").unwrap() {
            WorktreeTree::Listed { entries } => entries,
            other => panic!("트리가 읽히지 않았다: {other:?}"),
        }
    }

    /// 트리를 깊이 우선으로 편 줄들 — 경로 하나에 한 줄이다. 폴더는 끝에 `/`, 아직 안 읽은 폴더는 거기에 `…`, 걸린 것은
    /// 앞에 `!`이다. 순서가 곧 화면의 순서다.
    fn lines(entries: &[WorktreeEntry]) -> Vec<String> {
        let mut out = Vec::new();
        for entry in entries {
            let mark = if entry.ignored { "!" } else { "" };
            match (&entry.kind, &entry.children) {
                (WorktreeEntryKind::Folder, Some(children)) => {
                    out.push(format!("{mark}{}/", entry.path));
                    out.extend(lines(children));
                }
                (WorktreeEntryKind::Folder, None) => out.push(format!("{mark}{}/…", entry.path)),
                _ => out.push(format!("{mark}{}", entry.path)),
            }
        }
        out
    }

    fn find<'a>(entries: &'a [WorktreeEntry], path: &str) -> Option<&'a WorktreeEntry> {
        entries.iter().find_map(|entry| {
            if entry.path == path {
                Some(entry)
            } else {
                entry.children.as_deref().and_then(|children| find(children, path))
            }
        })
    }

    #[test]
    fn tracked_untracked_and_dot_files_come_unignored() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, ".github/x.yml", "on: push");
        commit_all(&worktree);
        // 추적 안 된 파일 — 걸리지 않았다
        write(&worktree, "new.txt", "n");

        assert_eq!(lines(&listed(&works)), [".github/", ".github/x.yml", "a.txt", "new.txt"]);
        let x = find(&listed(&works), ".github/x.yml").cloned().unwrap();
        assert_eq!((x.name.as_str(), x.kind), ("x.yml", WorktreeEntryKind::File));
    }

    #[test]
    fn gitignore_nested_gitignore_and_info_exclude_rules_come_ignored() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, ".gitignore", "dist/\n.env\n");
        write(&worktree, "pkg/.gitignore", "gen/\n");
        write(&worktree, "pkg/keep.txt", "k");
        commit_all(&worktree);
        write(&worktree, "dist/app.js", "a");
        write(&worktree, ".env", "SECRET=1");
        write(&worktree, "pkg/gen/out.rs", "o");
        write(&worktree, "scratch.md", "s");
        // `.git/info/exclude`는 워크트리들이 함께 쓰는 공용 git 폴더에 있다
        let common = PathBuf::from(run_git(&worktree, &["rev-parse", "--path-format=absolute", "--git-common-dir"]));
        std::fs::write(common.join("info").join("exclude"), "scratch.md\n").unwrap();

        assert_eq!(
            lines(&listed(&works)),
            ["!dist/…", "pkg/", "!pkg/gen/…", "pkg/.gitignore", "pkg/keep.txt", "!.env", ".gitignore", "a.txt", "!scratch.md"]
        );
    }

    #[test]
    fn an_ignored_folder_is_one_unread_entry_whatever_it_holds() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, ".gitignore", "target/\n");
        commit_all(&worktree);
        for n in 0..40 {
            write(&worktree, &format!("target/debug/deps/f{n}.o"), "o");
        }
        write(&worktree, "target/release/app", "bin");

        let entries = listed(&works);
        assert_eq!(lines(&entries), ["!target/…", ".gitignore", "a.txt"]);
        let target = find(&entries, "target").unwrap();
        assert_eq!((target.kind, target.ignored, &target.children), (WorktreeEntryKind::Folder, true, &None));
    }

    #[test]
    fn a_folder_holding_only_ignored_files_is_one_ignored_folder() {
        // 폴더 자신은 규칙에 안 걸려도 안의 것이 모두 걸렸으면 git은 그 폴더를 걸린 것으로 낸다(`git status --ignored`와 같다).
        // 그 안의 파일이 한 번 더 따로 나와도 트리에는 폴더 하나만 선다.
        let (_tmp, works, worktree) = setup();
        write(&worktree, ".gitignore", "*.log\n");
        commit_all(&worktree);
        write(&worktree, "logs/a.log", "l");
        write(&worktree, "mixed/a.log", "l");
        write(&worktree, "mixed/ok.txt", "k");

        assert_eq!(
            lines(&listed(&works)),
            ["!logs/…", "mixed/", "!mixed/a.log", "mixed/ok.txt", ".gitignore", "a.txt"]
        );
    }

    #[test]
    fn there_is_no_dot_git_no_empty_folder_and_no_deleted_file() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "gone.txt", "g");
        commit_all(&worktree);
        // 지운 추적 파일 — git의 색인에는 아직 있다
        std::fs::remove_file(worktree.join("gone.txt")).unwrap();
        std::fs::create_dir_all(worktree.join("empty/deeper")).unwrap();

        assert_eq!(lines(&listed(&works)), ["a.txt"]);
    }

    #[test]
    fn folders_come_first_then_names_in_order() {
        let (_tmp, works, worktree) = setup();
        for rel in ["b.txt", "Zeta/z.txt", "alpha/a.txt", "B.md", ".hidden", "src/z.rs", "src/lib/x.rs", "src/a.rs"] {
            write(&worktree, rel, "x");
        }

        assert_eq!(
            lines(&listed(&works)),
            [
                "alpha/",
                "alpha/a.txt",
                "src/",
                "src/lib/",
                "src/lib/x.rs",
                "src/a.rs",
                "src/z.rs",
                "Zeta/",
                "Zeta/z.txt",
                ".hidden",
                "a.txt",
                "B.md",
                "b.txt",
            ]
        );
    }

    #[test]
    fn symlinks_and_submodules_are_entries_that_do_not_unfold() {
        let (tmp, works, worktree) = setup();
        let sub = tmp.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        run_git(&sub, &["init", "-b", "main"]);
        run_git(&sub, &["config", "user.email", "t@t.t"]);
        run_git(&sub, &["config", "user.name", "t"]);
        write(&sub, "s.txt", "s");
        run_git(&sub, &["add", "."]);
        run_git(&sub, &["commit", "-m", "s"]);
        run_git(
            &worktree,
            &["-c", "protocol.file.allow=always", "submodule", "add", sub.to_str().unwrap(), "libs/sub"],
        );
        std::os::unix::fs::symlink("a.txt", worktree.join("link.txt")).unwrap();
        // 추적 안 된 안쪽 저장소도 다른 저장소다
        std::fs::create_dir_all(worktree.join("nested")).unwrap();
        run_git(&worktree.join("nested"), &["init", "-b", "main"]);
        write(&worktree, "nested/n.txt", "n");

        let entries = listed(&works);
        assert_eq!(lines(&entries), ["libs/", "libs/sub", "nested", ".gitmodules", "a.txt", "link.txt"]);
        for path in ["libs/sub", "nested"] {
            let entry = find(&entries, path).unwrap();
            assert_eq!((entry.kind, &entry.children), (WorktreeEntryKind::Submodule, &Some(vec![])), "{path}");
        }
        assert_eq!(find(&entries, "link.txt").unwrap().kind, WorktreeEntryKind::Symlink);
    }

    #[test]
    fn a_missing_worktree_answers_worktree_missing() {
        let (_tmp, works, worktree) = setup();
        // 이 work에 없는 프로젝트, 그리고 지워진 워크트리
        assert_eq!(list_worktree_tree(&works, "w", "be").unwrap(), WorktreeTree::WorktreeMissing);
        assert_eq!(list_worktree_tree(&works, "nope", "fe").unwrap(), WorktreeTree::WorktreeMissing);
        std::fs::remove_dir_all(&worktree).unwrap();
        assert_eq!(list_worktree_tree(&works, "w", "fe").unwrap(), WorktreeTree::WorktreeMissing);
    }

    #[test]
    fn a_folder_that_is_not_a_repository_answers_unreadable() {
        // 저장소가 아닌 폴더에서 git은 위로 올라가 바깥 저장소를 읽는다 — 그 답을 이 워크트리의 트리로 내면 안 된다
        let (_tmp, works, _worktree) = setup();
        let plain = works.join("w").join("trees").join("plain");
        write(&plain, "x.txt", "x");

        assert!(matches!(
            list_worktree_tree(&works, "w", "plain").unwrap(),
            WorktreeTree::Unreadable { reason } if !reason.is_empty()
        ));
    }

    #[test]
    fn slugs_that_point_outside_are_refused() {
        let (_tmp, works, _worktree) = setup();
        assert!(matches!(list_worktree_tree(&works, "w", "../fe"), Err(Error::Validation(_))));
        assert!(matches!(list_worktree_tree(&works, "..", "fe"), Err(Error::WorkNotFound(_))));
    }

    #[test]
    fn the_answer_is_a_kind_tagged_camel_case_value() {
        // 화면의 판별 합집합(`kind`)과 한 글자도 다르지 않아야 한다
        let (_tmp, works, _worktree) = setup();
        let json = serde_json::to_value(list_worktree_tree(&works, "w", "fe").unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "listed",
                "entries": [{ "name": "a.txt", "path": "a.txt", "kind": "file", "ignored": false, "children": [] }]
            })
        );
        let missing = serde_json::to_value(list_worktree_tree(&works, "w", "be").unwrap()).unwrap();
        assert_eq!(missing, serde_json::json!({ "kind": "worktreeMissing" }));
    }
}
