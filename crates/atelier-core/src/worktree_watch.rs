//! **워크트리 읽기 — 감시 경로 판정**(git-integration 판 01 티켓 10). 워처가 디바운스 한 번에 모은 경로들을 받아, gitignore에
//! 걸리지 않은 변경이 있었던 워크트리 — (work slug, 프로젝트) 쌍 — 을 돌려준다. 앱은 쌍마다 `worktree:changed`를 쏘고, 화면은
//! 그 워크트리를 보고 있을 때만 다시 읽는다.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};

use serde::Serialize;

use crate::worktree::worktree_dir;

/// 걸리지 않은 변경이 있었던 워크트리 하나 — `worktree:changed`의 실음이다(화면은 `{ slug, project }`로 받는다).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct WorktreeChange {
    pub slug: String,
    pub project: String,
}

/// 감시 경로 판정(구현 스펙 「코어 — 워크트리 읽기 › 감시 경로 판정」). 쌍은 한 번씩, (slug, 프로젝트) 차례로 온다.
///
/// 1. **구조.** `<slug>/<워크트리 폴더>/<프로젝트>/…` 모양만 남긴다 — 그 밖(spec · `work.json` · 순서 파일)은 `works:changed`의
///    몫이다. 워크트리 뿌리의 `.git`(연결 파일)은 버린다. 트리에 서지 않는 것이다. 다른 저장소(하위 모듈 · 안쪽 저장소) 안도
///    버린다 — 트리는 그것을 펼치지 않고, git은 하위 모듈 안의 경로에 답하지 못한다(`in_other_repository`).
/// 2. **빠른 길(S6).** 마지막 트리 목록이 알려 준 「걸린 맨 위 폴더」 아래는 git에 묻지 않고 버린다 — 빌드 폭주의 대부분이
///    여기서 끝난다(`learn_ignored_folders`). 들고 있지 않으면 빠른 길 없이 묻는다.
/// 3. **gitignore.** 워크트리마다 남은 경로를 **한 번에** git에 묻는다(S1) — 빌드가 수천 경로를 쏟아도 워크트리당 git 한
///    번이다. 하나라도 걸리지 않았으면 그 쌍을 낸다.
///
/// git이 답하지 못하면(워크트리가 사라졌거나 저장소가 아니다) **바뀐 것으로 친다** — 화면이 다시 읽어 「워크트리 없음」을
/// 그리는 편이, 사라진 워크트리를 낡은 트리로 두는 것보다 낫다.
pub fn worktree_changes(works_root: &Path, paths: &[PathBuf]) -> Vec<WorktreeChange> {
    changes_asking(works_root, paths, &mut ignored_by_git)
}

/// gitignore를 git에 묻는 자리(경계) — 워크트리 하나와 그 기준 경로들을 받아 **걸린 것**을 돌려준다. 답하지 못하면 `None`이다.
/// 판정은 이것을 워크트리마다 한 번 부른다 — 검사가 그 수를 세려고 이 자리를 갈아 끼운다.
type AskIgnored<'a> = dyn FnMut(&Path, &[String]) -> Option<HashSet<String>> + 'a;

fn changes_asking(works_root: &Path, paths: &[PathBuf], ignored: &mut AskIgnored) -> Vec<WorktreeChange> {
    // FSEvents가 주는 경로는 링크를 푼 꼴이다(`/var/…` → `/private/var/…`) — 뿌리도 두 꼴로 견준다.
    let real_root = works_root.canonicalize().ok();
    let mut by_worktree: BTreeMap<WorktreeChange, BTreeSet<String>> = BTreeMap::new();
    for path in paths {
        let rel = path
            .strip_prefix(works_root)
            .ok()
            .or_else(|| real_root.as_deref().and_then(|root| path.strip_prefix(root).ok()));
        if let Some((change, rel)) = rel.and_then(in_worktree) {
            by_worktree.entry(change).or_default().insert(rel);
        }
    }
    by_worktree
        .into_iter()
        .filter(|(change, rels)| match worktree_dir(works_root, &change.slug, &change.project) {
            Ok(dir) => any_unignored(&dir, rels, ignored),
            Err(_) => false,
        })
        .map(|(change, _)| change)
        .collect()
}

/// 워크트리 뿌리 자신의 워크트리 기준 경로 — 빈 경로다.
const ROOT: &str = "";

/// works 루트 기준 경로가 워크트리 안이면 그 쌍과 워크트리 기준 경로(조각은 `/`). 워크트리 폴더 이름은 work 목록이 쓰는
/// 자리(`works::worktrees_dir`)에서 읽는다 — 여기 다시 적지 않는다.
fn in_worktree(rel: &Path) -> Option<(WorktreeChange, String)> {
    let slug = match rel.components().next()? {
        Component::Normal(slug) => slug.to_str()?,
        _ => return None,
    };
    let trees = crate::works::worktrees_dir(&crate::works::work_dir(Path::new(""), slug).ok()?);
    let mut parts = rel.strip_prefix(trees).ok()?.components();
    let project = match parts.next()? {
        Component::Normal(project) => project.to_str()?,
        _ => return None,
    };
    if !crate::slug::is_safe_slug(project) {
        return None;
    }
    let rest = parts
        .map(|part| match part {
            Component::Normal(part) => Some(part.to_string_lossy()),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    // 워크트리 뿌리 자체와 그 `.git`은 트리에 서지 않는다
    if rest.first().is_none_or(|first| first == ".git") {
        return None;
    }
    Some((WorktreeChange { slug: slug.to_string(), project: project.to_string() }, rest.join("/")))
}

/// 그 워크트리의 경로들 가운데 걸리지 않은 것이 있는가.
fn any_unignored(dir: &Path, rels: &BTreeSet<String>, ignored: &mut AskIgnored) -> bool {
    // `.gitignore`가 바뀌었으면 마지막 트리 목록이 알려 준 걸린 폴더가 더 맞지 않을 수 있다 — 다음 트리 목록까지 빠른 길을 버린다.
    // **한 `.gitignore`가 가르는 것은 제 폴더 아래뿐이라** 빠른 길의 폴더를 품은 것만 그렇다. 그런 `.gitignore`는 걸린 폴더의
    // 위라 그 자신이 걸리지 않은 변경이고, 이 쌍이 나가 화면이 보고 있으면 곧바로 트리를 다시 읽어 새로 알려 준다. 걸린 폴더 안의
    // 것(pnpm이 쓰는 `node_modules/…/.gitignore`, venv의 `.venv/.gitignore`)은 git이 읽지도 않고 그 자신도 걸린 것이라 쌍이 나가지
    // 않는다 — 버리면 다시 배울 트리 목록이 오지 않아, 이어지는 폭주가 모두 git으로 간다. 다른 저장소 안의 것도 이 워크트리의
    // 규칙이 아니다(트리 목록은 다른 저장소 안을 읽지 않아 그 아래에 빠른 길의 폴더가 없다).
    let known = known_ignored_folders(dir);
    let rules_changed = rels
        .iter()
        .filter_map(|rel| ruled_folder(rel))
        .any(|ruled| known.iter().any(|folder| ruled == ROOT || is_under(folder, ruled)));
    let folders = if rules_changed {
        forget_ignored_folders(dir);
        Vec::new()
    } else {
        known
    };
    // 다른 저장소 안인지는 빠른 길 **뒤에** 본다 — 빠른 길은 글자만 견주고 이것은 디스크를 본다. 빌드 폭주는 대개 빠른 길에서
    // 끝난다.
    let mut repos = HashMap::new();
    let mut in_other = |rel: &str| in_other_repository(dir, rel, &mut repos);
    let asked: Vec<String> = rels
        .iter()
        .filter(|rel| !folders.iter().any(|folder| is_under(rel, folder)))
        .filter(|rel| !in_other(rel))
        .cloned()
        .collect();
    if asked.is_empty() {
        return false;
    }
    // 뿌리에 `.git`이 없으면 git이 위로 올라가 바깥 저장소의 규칙으로 답한다(트리 목록과 같은 까닭) — 묻지 않는다.
    if !dir.join(".git").exists() {
        return true;
    }
    match ignored(dir, &asked) {
        Some(hit) => asked.iter().any(|rel| !hit.contains(rel)),
        None => true,
    }
}

/// 워크트리마다 **규칙에 걸린 맨 위 폴더들**(빠른 길 — S6). 앱 프로세스 안의 값이고, 트리 목록이 쓰고(`learn_ignored_folders`)
/// 판정이 읽는다. 앱을 다시 켜면 비어 있다 — 그때는 화면이 트리를 읽을 때까지 빠른 길 없이 묻는다.
static IGNORED_FOLDERS: LazyLock<Mutex<HashMap<PathBuf, Vec<String>>>> = LazyLock::new(Default::default);

/// 트리 목록이 알아낸 걸린 폴더(맨 위에서 처음 걸리는 자리)를 빠른 길로 들인다 — 트리 목록을 읽을 때마다 새로 쓴다.
///
/// **규칙에 걸린 폴더만 들인다.** 트리 목록의 걸린 폴더에는 안의 것이 모두 걸려 폴더째 나온 것(`*.log`만 든 `logs/`)도 있다 —
/// 그 안에 새로 생긴 `logs/new.txt`는 걸리지 않았으므로 빠른 길이 버리면 git과 답이 갈린다. 폴더 이름을 git에 한 번 물어 규칙에
/// 걸린 것만 남긴다(서 있는 폴더라 `target/` 같은 폴더 규칙도 맞는다). 규칙에 걸린 폴더 아래는 무엇이 생겨도 걸린다 — git은
/// 걸린 폴더 안을 다시 들이지 않는다.
pub(crate) fn learn_ignored_folders(dir: &Path, candidates: Vec<String>) {
    let folders = if candidates.is_empty() {
        Some(Vec::new())
    } else {
        ignored_by_git(dir, &candidates)
            .map(|hit| candidates.into_iter().filter(|folder| hit.contains(folder)).collect())
    };
    let mut known = IGNORED_FOLDERS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    match folders {
        Some(folders) => known.insert(dir.to_path_buf(), folders),
        None => known.remove(dir),
    };
}

/// 그 워크트리의 빠른 길을 버린다 — 트리를 읽지 못했거나 규칙이 바뀌었다.
pub(crate) fn forget_ignored_folders(dir: &Path) {
    IGNORED_FOLDERS.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(dir);
}

fn known_ignored_folders(dir: &Path) -> Vec<String> {
    IGNORED_FOLDERS.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).get(dir).cloned().unwrap_or_default()
}

/// `rel`이 **다른 저장소 안**인가 — 하위 모듈이나 추적 안 된 안쪽 저장소. 워크트리 뿌리 아래 폴더 가운데 `.git`(연결 파일이든
/// 폴더든)을 든 것이 있으면 그렇다 — git이 안쪽 저장소를 알아보는 길과 같다. 트리는 그 저장소를 펼치지 않는 한 항목으로
/// 세우므로(S3) 그 안의 변경은 트리의 소식이 아니다. 그리고 **git에 묻지 못한다**: `check-ignore`는 하위 모듈 안의 경로를 받으면
/// 판정 없이 죽는다(128, `Pathspec … is in submodule …`). 하위 모듈 안에서 돈 빌드의 경로가 묶음에 하나만 섞여도 워크트리 전체가
/// 「답하지 못함」 — 곧 바뀐 것 — 이 되어, 빌드 내내 묶음마다 신호가 나갔다.
///
/// 빠른 길과 달리 트리 목록이 알려 주기를 기다리지 않고 디스크로 본다 — 앱을 막 켜 빠른 길이 없을 때도 git이 죽으면 안 되어서다.
/// 묶음 하나 안에서 같은 폴더는 한 번만 본다(`repos`) — 빌드 폭주의 경로는 몇 안 되는 폴더 아래에 몰린다.
///
/// 초기화하지 않은 하위 모듈(빈 폴더)에는 `.git`이 없어 알아보지 못한다 — 그 안에 무엇이 생기면 git이 죽어 바뀐 것으로 친다. 빈
/// 하위 모듈 안에서 빌드가 돌 일은 없다.
fn in_other_repository(dir: &Path, rel: &str, repos: &mut HashMap<String, bool>) -> bool {
    rel.match_indices('/').any(|(at, _)| {
        let folder = &rel[..at];
        if let Some(&repo) = repos.get(folder) {
            return repo;
        }
        let repo = dir.join(folder).join(".git").exists();
        repos.insert(folder.to_string(), repo);
        repo
    })
}

/// `rel`이 `.gitignore`면 그 규칙이 가르는 폴더 — 제 폴더다(뿌리의 것이면 `ROOT`).
fn ruled_folder(rel: &str) -> Option<&str> {
    if rel == ".gitignore" { Some(ROOT) } else { rel.strip_suffix("/.gitignore") }
}

/// `rel`이 `folder` **아래**인가. 폴더 자신은 아니다 — 지워진 폴더는 폴더 규칙(`target/`)에 안 걸려 git이 걸리지 않았다고
/// 답한다(트리에서 그 행이 사라진다). 빠른 길도 그 답을 git에 맡긴다.
fn is_under(rel: &str, folder: &str) -> bool {
    rel.strip_prefix(folder).is_some_and(|rest| rest.starts_with('/'))
}

/// `git check-ignore --stdin -z` — 걸린 경로만 NUL로 갈라 돌려준다. 추적 중인 파일은 걸린 것으로 나오지 않는다(`--no-index`를 쓰지
/// 않는다) — 추적 파일의 변경은 걸리지 않은 변경이다. 하나도 안 걸렸으면 종료 코드가 1이고 그것도 답이다.
///
/// 들일 경로가 수천이어도 한 번에 넣는다. 쓰기는 따로 된 스레드가 한다 — git은 읽는 대로 답을 쓰므로, 다 넣을 때까지 답을 안
/// 읽으면 답이 파이프를 채워 서로 기다린다.
fn ignored_by_git(dir: &Path, rels: &[String]) -> Option<HashSet<String>> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["--no-optional-locks", "check-ignore", "--stdin", "-z"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let input: Vec<u8> = rels.iter().flat_map(|rel| rel.bytes().chain([0])).collect();
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let out = child.wait_with_output().ok()?;
    writer.join().ok()?.ok()?;
    if !matches!(out.status.code(), Some(0 | 1)) {
        return None;
    }
    Some(
        out.stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| String::from_utf8_lossy(path).into_owned())
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// works 테스트의 저장소 만들기를 본뜬다 — 저장소 `fe` · `be`를 프로젝트로 등록하고, work `w`를 둘에 걸쳐 시작해 진짜 git
    /// 워크트리를 만든다. 두 저장소 모두 `target/` · `node_modules/`를 거르는 `.gitignore`가 커밋돼 있다. 돌려주는 것은 임시
    /// 폴더(살아 있어야 한다)와 works 루트다.
    fn setup() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let works = tmp.path().join("works");
        let projects = tmp.path().join("projects");
        for name in ["fe", "be"] {
            let repo = tmp.path().join(name);
            std::fs::create_dir_all(&repo).unwrap();
            run_git(&repo, &["init", "-b", "main"]);
            run_git(&repo, &["config", "user.email", "t@t.t"]);
            run_git(&repo, &["config", "user.name", "t"]);
            std::fs::write(repo.join(".gitignore"), "target/\nnode_modules/\n").unwrap();
            std::fs::write(repo.join("a.txt"), "x").unwrap();
            run_git(&repo, &["add", "."]);
            run_git(&repo, &["commit", "-m", "init"]);
            crate::create_project(&projects, &repo).unwrap();
        }
        crate::start_work(
            &works,
            &tmp.path().join("archive"),
            &projects,
            "files",
            Some("w"),
            &["fe".to_string(), "be".to_string()],
            Some("feat/files"),
        )
        .unwrap();
        assert!(works.join("w/trees/fe/.git").is_file(), "워크트리가 서지 않았다");
        (tmp, works)
    }

    /// works 루트 기준 경로들 — 워처가 받는 것처럼 절대 경로다.
    fn paths(works: &Path, rels: &[&str]) -> Vec<PathBuf> {
        rels.iter().map(|rel| works.join(rel)).collect()
    }

    fn change(slug: &str, project: &str) -> WorktreeChange {
        WorktreeChange { slug: slug.to_string(), project: project.to_string() }
    }

    #[test]
    fn a_change_outside_the_worktrees_names_no_worktree() {
        let (_tmp, works) = setup();
        let batch = paths(&works, &["w/work.json", "w/spec/overview.md", ".order.json", "w/trees"]);
        assert_eq!(worktree_changes(&works, &batch), []);
        // works 루트 밖도 없다
        assert_eq!(worktree_changes(&works, &[works.parent().unwrap().join("projects/fe.md")]), []);
    }

    #[test]
    fn an_unignored_file_change_names_its_worktree() {
        let (_tmp, works) = setup();
        std::fs::write(works.join("w/trees/fe/new.txt"), "n").unwrap();
        assert_eq!(worktree_changes(&works, &paths(&works, &["w/trees/fe/new.txt"])), [change("w", "fe")]);
        // 지운 파일도 변경이다 — 판정은 디스크가 아니라 git의 규칙으로 한다
        assert_eq!(worktree_changes(&works, &paths(&works, &["w/trees/be/gone/old.rs"])), [change("w", "be")]);
    }

    #[test]
    fn changes_only_under_ignored_folders_name_no_worktree() {
        // 빌드가 `target/`에 쏟고 설치가 `node_modules/`에 쏟는다 — 트리에 걸린 폴더 하나로 서는 그 안은 소식이 아니다(스토리 83)
        let (_tmp, works) = setup();
        let batch = paths(
            &works,
            &[
                "w/trees/fe/target/debug/deps/a.o",
                "w/trees/fe/target/debug/build/x/out",
                "w/trees/fe/node_modules/react/index.js",
                "w/trees/be/target/release/app",
                // 워크트리 뿌리의 `.git` — 연결 파일이다
                "w/trees/fe/.git",
            ],
        );
        assert_eq!(worktree_changes(&works, &batch), []);
    }

    #[test]
    fn a_mixed_batch_names_each_worktree_with_an_unignored_change_once() {
        let (_tmp, works) = setup();
        let batch = paths(
            &works,
            &[
                "w/trees/fe/target/debug/a.o",
                "w/trees/fe/src/lib.rs",
                "w/trees/fe/src/main.rs",
                "w/trees/fe/target/debug/b.o",
                // `be`는 걸린 곳만 바뀌었다
                "w/trees/be/node_modules/x/index.js",
                "w/trees/be/target/debug/c.o",
                // 점 파일도 트리에 서므로 소식이다
                "w/trees/fe/.env.local",
                "w/spec/overview.md",
            ],
        );
        assert_eq!(worktree_changes(&works, &batch), [change("w", "fe")]);
        // 둘 다 바뀌었으면 둘이다 — 쌍마다 한 번
        let both = paths(&works, &["w/trees/be/b.txt", "w/trees/fe/a.txt", "w/trees/be/c.txt", "w/trees/fe/d.txt"]);
        assert_eq!(worktree_changes(&works, &both), [change("w", "be"), change("w", "fe")]);
    }

    /// `fe` 워크트리에 다른 저장소 둘을 둔다 — 초기화된 채 커밋된 하위 모듈 `libs/sub`와 추적 안 된 안쪽 저장소 `nested`. 트리는
    /// 둘 다 펼치지 않는 한 항목으로 세운다(`worktree.rs`의 `symlinks_and_submodules_are_entries_that_do_not_unfold`).
    fn with_other_repositories(tmp: &Path, works: &Path) {
        let sub = tmp.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        run_git(&sub, &["init", "-b", "main"]);
        run_git(&sub, &["config", "user.email", "t@t.t"]);
        run_git(&sub, &["config", "user.name", "t"]);
        std::fs::write(sub.join("s.txt"), "s").unwrap();
        run_git(&sub, &["add", "."]);
        run_git(&sub, &["commit", "-m", "sub"]);
        let fe = works.join("w/trees/fe");
        run_git(&fe, &["-c", "protocol.file.allow=always", "submodule", "add", sub.to_str().unwrap(), "libs/sub"]);
        run_git(&fe, &["commit", "-m", "sub"]);
        assert!(fe.join("libs/sub/.git").is_file(), "하위 모듈이 초기화되지 않았다");
        std::fs::create_dir_all(fe.join("nested")).unwrap();
        run_git(&fe.join("nested"), &["init", "-b", "main"]);
    }

    #[test]
    fn changes_inside_a_submodule_or_a_nested_repository_name_no_worktree() {
        // 하위 모듈 안에서 빌드가 `target/`에 쏟아도 소식이 아니다(스토리 83). git은 하위 모듈 안의 경로를 받으면 판정 없이
        // 죽는다(128, `Pathspec … is in submodule`) — 그것이 「답하지 못함」으로 읽혀 묶음마다 바뀐 것으로 나가면 안 된다
        let (tmp, works) = setup();
        with_other_repositories(tmp.path(), &works);
        let inside = [
            "w/trees/fe/libs/sub/target/debug/a.o",
            "w/trees/fe/libs/sub/node_modules/x/index.js",
            "w/trees/fe/libs/sub/.git",
            // 트리에 펼쳐지지 않는 저장소라 그 안의 편집도 트리의 소식이 아니다
            "w/trees/fe/libs/sub/src/lib.rs",
            "w/trees/fe/nested/src/main.rs",
        ];
        // 하위 모듈 안의 경로 하나가 걸린 곳만 바뀐 묶음 전체를 「바뀜」으로 넘기지 않는다
        let ignored_and_inside = paths(&works, &["w/trees/fe/target/debug/a.o", "w/trees/fe/libs/sub/target/debug/a.o"]);
        let mixed = paths(&works, &["w/trees/fe/libs/sub/target/debug/a.o", "w/trees/fe/src/lib.rs"]);
        let check = |when: &str| {
            assert_eq!(worktree_changes(&works, &paths(&works, &inside)), [], "{when}: 다른 저장소 안만");
            assert_eq!(worktree_changes(&works, &ignored_and_inside), [], "{when}: 걸린 곳 + 하위 모듈 안");
            assert_eq!(worktree_changes(&works, &mixed), [change("w", "fe")], "{when}: 걸리지 않은 변경이 섞임");
        };
        check("빠른 길 없이");
        crate::list_worktree_tree(&works, "w", "fe").unwrap();
        check("빠른 길로");
    }

    #[test]
    fn a_gitignore_inside_another_repository_keeps_the_fast_path() {
        // 하위 모듈의 규칙은 이 워크트리의 트리를 가르지 않는다 — 소식도 아니고, 트리 목록이 알려 준 걸린 폴더도 그대로 맞다
        let (tmp, works) = setup();
        with_other_repositories(tmp.path(), &works);
        std::fs::create_dir_all(works.join("w/trees/fe/target/debug")).unwrap();
        crate::list_worktree_tree(&works, "w", "fe").unwrap();
        assert_eq!(counted(&works, &paths(&works, &["w/trees/fe/libs/sub/.gitignore"])), (vec![], 0));
        assert_eq!(counted(&works, &paths(&works, &["w/trees/fe/target/debug/a.o"])), (vec![], 0));
    }

    #[test]
    fn a_worktree_git_cannot_answer_for_counts_as_changed() {
        // 워크트리가 통째로 지워지면 그 안의 경로가 쏟아지고 git은 답하지 못한다 — 화면이 다시 읽어 「워크트리 없음」을 그린다
        let (_tmp, works) = setup();
        std::fs::remove_dir_all(works.join("w/trees/be")).unwrap();
        assert_eq!(
            worktree_changes(&works, &paths(&works, &["w/trees/be/target/debug/a.o", "w/trees/be/a.txt"])),
            [change("w", "be")]
        );
    }

    #[test]
    fn paths_named_through_the_resolved_root_are_judged_the_same() {
        // FSEvents는 링크를 푼 경로를 준다 — macOS 임시 폴더면 `/var/…`가 `/private/var/…`로 온다
        let (_tmp, works) = setup();
        let real = works.canonicalize().unwrap();
        let batch = vec![real.join("w/trees/fe/src/new.rs"), real.join("w/trees/be/target/x.o")];
        assert_eq!(worktree_changes(&works, &batch), [change("w", "fe")]);
    }

    /// 판정을 git 부름 수를 세며 돌린다 — 묻는 자리(`ignored_by_git`)는 진짜 그대로다.
    fn counted(works: &Path, batch: &[PathBuf]) -> (Vec<WorktreeChange>, usize) {
        let mut asks = 0;
        let changes = changes_asking(works, batch, &mut |dir, rels| {
            asks += 1;
            ignored_by_git(dir, rels)
        });
        (changes, asks)
    }

    /// 빌드 폭주 한 묶음 — `fe`의 `target/` 아래 수천 경로와 걸리지 않은 하나, `be`의 `node_modules/` 아래 수천 경로.
    fn storm(works: &Path, with_source: bool) -> Vec<PathBuf> {
        let mut rels: Vec<String> = (0..3000).map(|n| format!("w/trees/fe/target/debug/deps/f{n}.o")).collect();
        rels.extend((0..2000).map(|n| format!("w/trees/be/node_modules/pkg{n}/index.js")));
        if with_source {
            rels.push("w/trees/fe/src/lib.rs".to_string());
        }
        rels.iter().map(|rel| works.join(rel)).collect()
    }

    #[test]
    fn thousands_of_paths_ask_git_once_per_worktree() {
        let (_tmp, works) = setup();
        let (changes, asks) = counted(&works, &storm(&works, true));
        assert_eq!(changes, [change("w", "fe")]);
        assert_eq!(asks, 2, "워크트리마다 한 번이어야 한다");
    }

    #[test]
    fn after_a_tree_listing_a_storm_under_ignored_folders_asks_git_nothing() {
        // 빠른 길(S6) — 마지막 트리 목록이 알려 준 걸린 맨 위 폴더 아래는 git에 묻지 않고 버린다
        let (_tmp, works) = setup();
        for project in ["fe", "be"] {
            let tree = works.join("w/trees").join(project);
            std::fs::create_dir_all(tree.join("target/debug/deps")).unwrap();
            std::fs::create_dir_all(tree.join("node_modules/pkg0")).unwrap();
            crate::list_worktree_tree(&works, "w", project).unwrap();
        }
        assert_eq!(counted(&works, &storm(&works, false)), (vec![], 0));
        // 걸리지 않은 것이 섞이면 그것만 묻는다 — 그 워크트리 하나다
        assert_eq!(counted(&works, &storm(&works, true)), (vec![change("w", "fe")], 1));
    }

    #[test]
    fn the_fast_path_answers_as_git_does() {
        let (_tmp, works) = setup();
        let fe = works.join("w/trees/fe");
        // `logs/`는 이름이 규칙에 걸리지 않았지만 안의 것이 모두 걸려 트리에 걸린 폴더로 선다 — 그 안의 새 파일은 걸리지 않을 수 있다
        std::fs::write(fe.join(".gitignore"), "target/\nnode_modules/\n*.log\n").unwrap();
        for rel in ["logs/a.log", "target/debug/a.o", "node_modules/x/i.js"] {
            let path = fe.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "x").unwrap();
        }
        let cases: [(&[&str], &[WorktreeChange]); 5] = [
            (&["w/trees/fe/target/debug/b.o", "w/trees/fe/node_modules/y/i.js"], &[]),
            (&["w/trees/fe/logs/b.log"], &[]),
            (&["w/trees/fe/logs/new.txt"], &[change("w", "fe")]),
            // 걸린 폴더 자신 — 서 있는 동안은 걸린 것이다
            (&["w/trees/fe/target"], &[]),
            (&["w/trees/fe/target/x.o", "w/trees/fe/src/a.rs"], &[change("w", "fe")]),
        ];
        for (batch, expected) in cases {
            assert_eq!(worktree_changes(&works, &paths(&works, batch)), expected, "빠른 길 없이 {batch:?}");
        }
        crate::list_worktree_tree(&works, "w", "fe").unwrap();
        for (batch, expected) in cases {
            assert_eq!(worktree_changes(&works, &paths(&works, batch)), expected, "빠른 길로 {batch:?}");
        }
    }

    #[test]
    fn a_gitignore_change_drops_the_fast_path_until_the_next_listing() {
        // 규칙이 바뀌면 마지막 트리 목록이 알려 준 걸린 폴더는 더 맞지 않을 수 있다 — `target/`을 풀면 그 안이 소식이다
        let (_tmp, works) = setup();
        let fe = works.join("w/trees/fe");
        std::fs::create_dir_all(fe.join("target/debug")).unwrap();
        crate::list_worktree_tree(&works, "w", "fe").unwrap();
        assert_eq!(worktree_changes(&works, &paths(&works, &["w/trees/fe/target/debug/a.o"])), []);

        std::fs::write(fe.join(".gitignore"), "node_modules/\n").unwrap();
        assert_eq!(worktree_changes(&works, &paths(&works, &["w/trees/fe/.gitignore"])), [change("w", "fe")]);
        assert_eq!(worktree_changes(&works, &paths(&works, &["w/trees/fe/target/debug/a.o"])), [change("w", "fe")]);
    }

    #[test]
    fn a_gitignore_that_rules_no_fast_path_folder_keeps_the_fast_path() {
        // 한 `.gitignore`가 가르는 것은 제 폴더 아래뿐이다. 걸린 폴더 안의 것(pnpm이 쓰는 `node_modules/…/.gitignore`, venv의
        // `.venv/.gitignore`)은 git이 읽지도 않고, 그 자신도 걸린 것이라 쌍이 나가지 않는다 — 빠른 길을 버리면 다시 배울 트리
        // 목록이 오지 않아 이어지는 설치 · 빌드 폭주가 모두 git으로 간다
        let (_tmp, works) = setup();
        let fe = works.join("w/trees/fe");
        let pnpm = "node_modules/.pnpm/lru_map@0.4.1/node_modules/lru_map";
        std::fs::create_dir_all(fe.join(pnpm)).unwrap();
        std::fs::create_dir_all(fe.join("target/debug")).unwrap();
        crate::list_worktree_tree(&works, "w", "fe").unwrap();
        let install = [format!("w/trees/fe/{pnpm}/.gitignore"), format!("w/trees/fe/{pnpm}/index.js")];
        let install: Vec<&str> = install.iter().map(String::as_str).collect();
        assert_eq!(counted(&works, &paths(&works, &install)), (vec![], 0));
        assert_eq!(counted(&works, &paths(&works, &["w/trees/fe/target/debug/a.o"])), (vec![], 0));

        // 빠른 길의 폴더를 품지 않은 폴더의 `.gitignore`도 그렇다 — 그 자신은 걸리지 않은 변경이라 쌍은 나간다
        std::fs::create_dir_all(fe.join("docs")).unwrap();
        std::fs::write(fe.join("docs/.gitignore"), "*.pdf\n").unwrap();
        assert_eq!(counted(&works, &paths(&works, &["w/trees/fe/docs/.gitignore"])), (vec![change("w", "fe")], 1));
        assert_eq!(counted(&works, &paths(&works, &["w/trees/fe/target/debug/a.o"])), (vec![], 0));
    }

    #[test]
    fn a_gitignore_over_a_nested_fast_path_folder_drops_the_fast_path() {
        // `target/`은 어느 깊이에서도 걸린다 — 트리 목록이 `sub/target`을 빠른 길로 알려 준다. `sub/.gitignore`가 그것을 풀면 그 안이
        // 소식이다(아래 `.gitignore`의 규칙이 위의 것을 이긴다)
        let (_tmp, works) = setup();
        let fe = works.join("w/trees/fe");
        std::fs::create_dir_all(fe.join("sub/target/debug")).unwrap();
        std::fs::write(fe.join("sub/a.rs"), "x").unwrap();
        crate::list_worktree_tree(&works, "w", "fe").unwrap();
        assert_eq!(counted(&works, &paths(&works, &["w/trees/fe/sub/target/debug/a.o"])), (vec![], 0));

        std::fs::write(fe.join("sub/.gitignore"), "!target/\n").unwrap();
        assert_eq!(worktree_changes(&works, &paths(&works, &["w/trees/fe/sub/.gitignore"])), [change("w", "fe")]);
        assert_eq!(
            worktree_changes(&works, &paths(&works, &["w/trees/fe/sub/target/debug/a.o"])),
            [change("w", "fe")]
        );
    }
}
