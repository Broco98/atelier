//! **Work의 변경** — Work 카드의 변경 칸과 넓힌 카드의 diff가 읽는 것(v1 구현 스펙 §12 · S23).
//!
//! **기준은 PR에 들어갈 것과 같다**(S23). Project마다 worktree를 base 브랜치와 견주되, base의 끝이 아니라 **갈라진 커밋**
//! (`merge-base`)과 견주고, 커밋한 것 · 커밋하지 않은 것 · git이 아직 모르는 새 파일을 하나로 합친다. Agent가 커밋하기 전에도
//! 고친 것이 보이고, 커밋한 뒤에도 사라지지 않는다.
//!
//! 화면에는 좁힌 뷰 타입만 보낸다(git-integration 결정 「git 호출은 Rust」). worktree가 없거나 base를 모르거나 git이 실패한
//! 것은 `Err`가 아니라 **답의 갈래**다 — 화면이 칸마다 그 까닭을 그린다. `Err`는 부른 쪽이 틀렸을 때(없는 Work · 밖을
//! 가리키는 slug · 경로)뿐이다. git-integration의 다음 판(changes 칸)이 이것을 넓힌다.

use std::path::Path;
use std::process::Command;
use std::time::SystemTime;

use serde::Serialize;

use crate::worktree::worktree_dir;
use crate::worktree_file::{BINARY_SNIFF_LEN, READ_LIMIT};
use crate::Result;

/// Project 하나의 변경. 화면에는 한 겹으로 간다 — `{ project, kind, …갈래의 필드 }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChanges {
    pub project: String,
    #[serde(flatten)]
    pub changes: Changes,
}

/// 변경 읽기의 답.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Changes {
    /// base(`base`는 그 브랜치 이름) 대비 바뀐 파일들. **늦게 고친 파일이 앞이다**(스토리 109 「새로 바뀐 파일이 맨 위로」) —
    /// 고친 시각이 같으면 경로순, 지운 파일은 시각이 없어 맨 뒤다. 바뀐 것이 없으면 빈 목록이다.
    Listed { base: String, files: Vec<ChangedFile> },
    /// 그 Project의 worktree가 없다 — 읽기만 하는 Project다(S21). 고친 적이 없으니 변경이 없다.
    WorktreeMissing,
    /// base를 찾지 못해 견줄 수 없다. Project에 적힌(또는 `origin/HEAD`의) base 이름을 알면 싣는다 — 그 이름이 이 저장소에
    /// 없는 것이다. 모든 파일을 변경이라 하지 않는다.
    BaseUnknown { base: Option<String> },
    /// git이 실패했다.
    Unreadable { reason: String },
}

/// 바뀐 파일 하나. 경로는 worktree 기준이고 조각은 `/`로 잇는다.
///
/// 줄 수는 **세지 못하면 없다**(`null`) — 바이너리이거나, git이 아직 모르는 새 파일이 파일 읽기의 상한을 넘는다. 0으로 적으면
/// 「바뀐 줄 없음」으로 읽힌다. 둘은 늘 함께 있거나 함께 없다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
}

/// Work의 변경 — `projects`에 적힌 순서로 Project마다 하나(v1 구현 스펙 §12 · S23).
///
/// base는 Project 등록의 base 브랜치이고, 등록이 사라졌으면 그 worktree의 `origin/HEAD`다(아카이브 기록과 같은 물러섬).
/// 다시 읽는 때는 부르는 쪽이 정한다 — worktree가 바뀌면 지금 오는 `worktree:changed`로 다시 부른다.
pub fn list_work_changes(works_root: &Path, projects_root: &Path, slug: &str) -> Result<Vec<ProjectChanges>> {
    let work = crate::works::read_work(works_root, slug)?;
    work.projects
        .iter()
        .map(|project| {
            let worktree = worktree_dir(works_root, slug, project)?;
            Ok(ProjectChanges { project: project.clone(), changes: project_changes(projects_root, project, &worktree) })
        })
        .collect()
}

/// worktree 하나의 변경. git을 세 번 부른다 — 갈라진 커밋 · 추적하는 파일의 증감 · 아직 모르는 파일.
fn project_changes(projects_root: &Path, project: &str, worktree: &Path) -> Changes {
    if !worktree.is_dir() {
        return Changes::WorktreeMissing;
    }
    let base = match resolve_base(projects_root, project, worktree) {
        Ok(base) => base,
        Err(base) => return Changes::BaseUnknown { base },
    };
    // 커밋 하나만 주면 git은 그 커밋과 **작업 폴더**를 견준다 — 커밋한 것과 index · 작업 폴더의 것이 한 번에 든다.
    // `-z`는 경로를 감싸거나 이스케이프하지 않는다(한글 · 탭이 든 이름). 이름 바꾸기는 지움 + 새 파일로 둔다 — 새 이름이 아직
    // git이 모르는 파일이면 어차피 그렇게 갈리므로, 한 가지 모양으로 맞춘다.
    let tracked = match git(worktree, &["diff", "--numstat", "--no-renames", "-z", &base.fork]) {
        Ok(out) => out,
        Err(reason) => return Changes::Unreadable { reason },
    };
    // 아직 모르는 파일은 위 diff에 없다. gitignore에 걸린 것은 변경이 아니다(`--exclude-standard`).
    let untracked = match git(worktree, &["ls-files", "--others", "--exclude-standard", "-z"]) {
        Ok(out) => out,
        Err(reason) => return Changes::Unreadable { reason },
    };
    let mut files: Vec<ChangedFile> = tracked
        .split('\0')
        .filter_map(|record| {
            // `더한\t뺀\t경로` — 바이너리는 두 수가 `-`라 풀리지 않아 없음이 된다.
            let mut parts = record.splitn(3, '\t');
            let (added, deleted, path) = (parts.next()?, parts.next()?, parts.next()?);
            Some(ChangedFile {
                path: path.to_string(),
                additions: added.parse().ok(),
                deletions: deleted.parse().ok(),
            })
        })
        .collect();
    files.extend(untracked.split('\0').filter(|path| !path.is_empty()).map(|path| {
        let lines = new_file_lines(&worktree.join(path));
        ChangedFile { path: path.to_string(), additions: lines, deletions: lines.map(|_| 0) }
    }));
    let mut dated: Vec<(Option<SystemTime>, ChangedFile)> = files
        .into_iter()
        .map(|one| (std::fs::symlink_metadata(worktree.join(&one.path)).and_then(|meta| meta.modified()).ok(), one))
        .collect();
    // 늦은 시각이 앞 · 시각이 없으면(지운 파일) 뒤 · 같으면 경로순.
    dated.sort_by(|(a_at, a), (b_at, b)| b_at.cmp(a_at).then_with(|| a.path.cmp(&b.path)));
    Changes::Listed { base: base.name, files: dated.into_iter().map(|(_, one)| one).collect() }
}

/// 한 파일 diff의 답.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FileDiff {
    /// git의 unified diff 한 파일 — 화면의 diff 보기(`@pierre/diffs`의 `PatchDiff`)가 그대로 받는다. 목록의 +/−와 같은
    /// 알고리즘(git)이 낸 덩어리라 둘이 어긋나지 않는다.
    Patch { patch: String },
    /// 바이너리 — git의 「Binary files … differ」 한 줄을 diff 보기에 넘기지 않는다.
    Binary,
    /// patch가(새 파일이면 그 파일이) 파일 읽기의 상한을 넘는다 — 다시 지은 잠금 파일 하나가 화면을 멈추지 않게 싣지 않는다.
    TooLarge,
    /// base와 같다 — 목록이 낡았거나(그 사이 되돌렸다) · gitignore에 걸렸거나 · 없는 경로다.
    Unchanged,
    /// 그 Project의 worktree가 없다(읽기만 하는 Project).
    WorktreeMissing,
    /// base를 찾지 못했다(`Changes::BaseUnknown`과 같다).
    BaseUnknown { base: Option<String> },
    /// git이 실패했다.
    Unreadable { reason: String },
}

/// 한 파일의 diff — 변경 목록과 같은 기준(갈라진 커밋 ↔ 작업 폴더, S23)이다. 목록에 서는 것(커밋한 것 · 작업 중인 것 · 지운
/// 것 · git이 아직 모르는 새 파일)은 모두 diff가 있다.
///
/// 경로는 worktree 기준 상대 경로이고 `..` · 절대 경로는 `Err`다(spec 읽기의 `safe_rel`과 같은 규칙). git에는 **글자 그대로**
/// 넘긴다 — git은 경로를 glob으로도 읽어 `app/[id]/page.tsx`의 diff에 `app/i/page.tsx`를 섞는다.
pub fn read_work_diff(
    works_root: &Path,
    projects_root: &Path,
    slug: &str,
    project: &str,
    rel_path: &str,
) -> Result<FileDiff> {
    let rel = crate::works::safe_rel(rel_path)?.to_string_lossy().into_owned();
    let worktree = worktree_dir(works_root, slug, project)?;
    if !worktree.is_dir() {
        return Ok(FileDiff::WorktreeMissing);
    }
    let base = match resolve_base(projects_root, project, &worktree) {
        Ok(base) => base,
        Err(base) => return Ok(FileDiff::BaseUnknown { base }),
    };
    match git(&worktree, &[&PATCH_ARGS[..], &[&base.fork, "--", &rel]].concat()) {
        Ok(patch) if patch.is_empty() => {}
        Ok(patch) => return Ok(from_patch(patch)),
        Err(reason) => return Ok(FileDiff::Unreadable { reason }),
    }
    // git이 아직 모르는 파일은 위 diff가 비어 있다. 걸리지 않은 새 파일일 때만 빈 파일과 견준다.
    match git(&worktree, &["ls-files", "--others", "--exclude-standard", "-z", "--", &rel]) {
        Ok(listed) if listed.split('\0').any(|path| path == rel) => {}
        Ok(_) => return Ok(FileDiff::Unchanged),
        Err(reason) => return Ok(FileDiff::Unreadable { reason }),
    }
    // 큰 새 파일은 git을 부르기 전에 크기로 가른다 — patch가 그 파일 전체라 git이 다 읽고 나서야 버리게 된다.
    if std::fs::symlink_metadata(worktree.join(&rel)).is_ok_and(|meta| meta.len() > READ_LIMIT) {
        return Ok(FileDiff::TooLarge);
    }
    Ok(match new_file_patch(&worktree, &rel) {
        Ok(patch) => from_patch(patch),
        Err(reason) => FileDiff::Unreadable { reason },
    })
}

/// git이 낸 patch를 답의 갈래로 가른다. 바이너리는 덩어리(`@@`)가 없고 「Binary files」 줄이 있다 — 내용 줄은 늘 `+` · `-` ·
/// 빈칸으로 시작하므로 그 줄과 헷갈리지 않는다.
fn from_patch(patch: String) -> FileDiff {
    if patch.is_empty() {
        return FileDiff::Unchanged;
    }
    if patch.len() as u64 > READ_LIMIT {
        return FileDiff::TooLarge;
    }
    let mut lines = patch.lines();
    if !lines.clone().any(|line| line.starts_with("@@")) && lines.any(|line| line.starts_with("Binary files ")) {
        return FileDiff::Binary;
    }
    FileDiff::Patch { patch }
}

/// git이 아직 모르는 새 파일의 patch — 빈 파일(`/dev/null`)과 견준다. 머리가 추적하는 새 파일과 같은 꼴이다(`new file mode` ·
/// `--- /dev/null`). `--no-index`는 다르면 1로 끝나므로 그것도 성공이다.
fn new_file_patch(worktree: &Path, rel: &str) -> std::result::Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(worktree)
        .args(PATCH_ARGS)
        .args(["--no-index", "--", "/dev/null", rel])
        .output()
        .map_err(|e| e.to_string())?;
    match out.status.code() {
        Some(0 | 1) => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}

/// patch를 내는 `git diff`의 인자 — **사용자의 git 설정이 바꾸는 모양을 걷는다.** diff 보기가 읽는 꼴은 하나다.
/// - `core.quotePath=false`: 없으면 한글 이름이 머리에서 8진 이스케이프로 감싸진다.
/// - `--no-ext-diff` · `--no-color`: 바깥 diff 도구 · `color.diff=always`가 patch를 patch 아닌 것으로 바꾼다.
/// - `--src-prefix` · `--dst-prefix`: `diff.noprefix` · `diff.mnemonicPrefix`가 `a/` · `b/`를 바꾼다.
/// - `--no-renames`: 변경 목록과 같은 모양(지움 + 새 파일)이다.
const PATCH_ARGS: [&str; 8] = [
    "-c",
    "core.quotePath=false",
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--no-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
];

/// 견줄 자리 — base 브랜치 이름과, 그것과 worktree HEAD가 갈라진 커밋.
struct Base {
    name: String,
    fork: String,
}

/// 견줄 자리를 찾는다. 찾지 못하면 `Err`에 base 이름(알면)이 든다.
///
/// **원격의 base를 먼저 본다**(아카이브 기록의 `inspect_worktree`와 같다). PR이 견주는 것이 원격의 base이고, 로컬 base는
/// 뒤처져 있기 일쑤다. Work 브랜치가 원격 base를 받아 왔는데(`git pull origin main`) 뒤처진 로컬과 견주면, 받아 온 남의
/// 커밋이 모두 이 Work의 변경으로 선다. 원격이 없으면 로컬로 물러선다.
///
/// 끝이 아니라 **갈라진 커밋**과 견준다 — Work를 시작한 뒤 base에 쌓인 커밋을 이 Work가 지운 것으로 세지 않게.
fn resolve_base(projects_root: &Path, project: &str, worktree: &Path) -> std::result::Result<Base, Option<String>> {
    let name = crate::get_project(projects_root, project)
        .ok()
        .map(|view| view.project.base_branch)
        .or_else(|| crate::git::origin_head(worktree))
        .ok_or(None)?;
    let fork = [format!("origin/{name}"), name.clone()]
        .iter()
        .find_map(|rev| git(worktree, &["merge-base", rev, "HEAD"]).ok())
        .map(|out| out.trim().to_string());
    match fork {
        Some(fork) => Ok(Base { name, fork }),
        None => Err(Some(name)),
    }
}

/// git이 아직 모르는 새 파일의 줄 수(git의 numstat에 없으므로 여기서 센다). 세지 못하면 `None`이다 — 보통 파일이 아니거나 ·
/// 파일 읽기의 상한을 넘거나(열지 않는다 — 걸리지 않은 로그 하나가 목록 읽기를 멈추지 않게) · 바이너리다. 바이너리 판정은
/// git과 같다(앞 8000바이트의 NUL, 파일 읽기와 같은 창).
fn new_file_lines(path: &Path) -> Option<u64> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > READ_LIMIT {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes[..bytes.len().min(BINARY_SNIFF_LEN)].contains(&0) {
        return None;
    }
    Some(count_lines(&bytes))
}

/// 줄 수 — 끝에 줄바꿈이 없는 마지막 줄도 한 줄이다(git의 numstat과 같다).
fn count_lines(bytes: &[u8]) -> u64 {
    let breaks = bytes.iter().filter(|byte| **byte == b'\n').count() as u64;
    breaks + u64::from(bytes.last().is_some_and(|last| *last != b'\n'))
}

/// git을 부른다. 출력은 다듬지 않는다 — `-z` 출력의 첫 경로가 공백으로 시작하면 trim이 그것을 깎는다(`git.rs`의 `dirty_files`가
/// 겪은 것).
///
/// 전역 옵션 둘을 늘 단다.
/// - `--no-optional-locks`: 읽기만 하는 diff가 낡은 stat을 고치느라 `index.lock`을 쥐지 않게(프로세스 결정 18 ①). Work 카드는
///   worktree가 바뀔 때마다 이것을 읽고, 그 순간 Agent의 `git commit`과 겹친다.
/// - `--literal-pathspecs`: 경로를 glob으로 풀지 않는다(`read_work_diff`).
fn git(dir: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["--no-optional-locks", "--literal-pathspecs"])
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn commit_all(dir: &Path, message: &str) {
        run_git(dir, &["add", "-A"]);
        run_git(dir, &["commit", "-m", message]);
    }

    /// 임시 자리 — 저장소 `fe`(`main`에 `a.txt` 두 줄)를 Project로 등록하고 Work `w`(브랜치 `feat/x`)를 시작해 진짜
    /// worktree를 세운다.
    struct Place {
        _tmp: tempfile::TempDir,
        works: PathBuf,
        projects: PathBuf,
        repo: PathBuf,
        worktree: PathBuf,
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
        write(&repo, "a.txt", "one\ntwo\n");
        commit_all(&repo, "init");
        crate::create_project(&projects, &repo).unwrap();
        crate::start_work(
            &works,
            &tmp.path().join("archive"),
            &projects,
            "changes",
            Some("w"),
            &["fe".to_string()],
            Some("feat/x"),
        )
        .unwrap();
        let worktree = works.join("w").join("trees").join("fe");
        assert!(worktree.join(".git").is_file(), "worktree가 서지 않았다");
        Place { _tmp: tmp, works, projects, repo, worktree }
    }

    fn file(path: &str, additions: u64, deletions: u64) -> ChangedFile {
        ChangedFile { path: path.to_string(), additions: Some(additions), deletions: Some(deletions) }
    }

    fn listed(place: &Place) -> (String, Vec<ChangedFile>) {
        let mut all = list_work_changes(&place.works, &place.projects, "w").unwrap();
        assert_eq!(all.len(), 1, "Project 하나다: {all:?}");
        let one = all.remove(0);
        assert_eq!(one.project, "fe");
        match one.changes {
            Changes::Listed { base, files } => (base, files),
            other => panic!("목록이 아니다: {other:?}"),
        }
    }

    fn sorted_by_path(mut files: Vec<ChangedFile>) -> Vec<ChangedFile> {
        files.sort_by(|a, b| a.path.cmp(&b.path));
        files
    }

    /// S23 — 커밋한 것 · 고쳤지만 커밋하지 않은 것 · git이 아직 모르는 새 파일이 모두 base 대비 변경이다.
    #[test]
    fn 커밋한_것과_작업_중인_것을_함께_base_대비로_센다() {
        let place = setup();
        write(&place.worktree, "b.txt", "1\n2\n3\n");
        commit_all(&place.worktree, "b");
        write(&place.worktree, "a.txt", "one\nTWO\n");
        write(&place.worktree, "new/c.txt", "x\ny\n");

        let (base, files) = listed(&place);
        assert_eq!(base, "main");
        assert_eq!(
            sorted_by_path(files),
            vec![file("a.txt", 1, 1), file("b.txt", 3, 0), file("new/c.txt", 2, 0)],
        );
    }

    fn touch(path: &Path, secs: u64) {
        let at = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(secs);
        std::fs::File::options().write(true).open(path).unwrap().set_modified(at).unwrap();
    }

    /// 스토리 109 — 새로 바뀐 파일이 맨 위로 들어온다. 고친 시각이 늦은 것이 앞이고, 지운 파일은 시각이 없어 맨 뒤다.
    #[test]
    fn 늦게_고친_파일이_앞이고_지운_파일은_맨_뒤다() {
        let place = setup();
        write(&place.worktree, "z-old.txt", "1\n");
        write(&place.worktree, "m-new.txt", "1\n");
        commit_all(&place.worktree, "two files");
        write(&place.worktree, "b-newest.txt", "1\n");
        std::fs::remove_file(place.worktree.join("a.txt")).unwrap();
        touch(&place.worktree.join("z-old.txt"), 1_000_000_000);
        touch(&place.worktree.join("m-new.txt"), 1_500_000_000);
        touch(&place.worktree.join("b-newest.txt"), 1_700_000_000);

        let (_, files) = listed(&place);
        let paths: Vec<&str> = files.iter().map(|one| one.path.as_str()).collect();
        assert_eq!(paths, ["b-newest.txt", "m-new.txt", "z-old.txt", "a.txt"]);
        assert_eq!(files[3], file("a.txt", 0, 2), "지운 파일은 base의 줄을 모두 뺀다");
    }

    /// 바이너리는 줄을 세지 않는다 — 커밋한 것은 git이 `-`로 답하고, git이 아직 모르는 새 파일은 같은 판정(앞 8000바이트의
    /// NUL)을 여기서 한다. 세지 못한 수를 0으로 적으면 「바뀐 줄 없음」으로 읽힌다.
    #[test]
    fn 바이너리는_커밋했든_새_파일이든_줄_수가_없다() {
        let place = setup();
        std::fs::write(place.worktree.join("committed.bin"), b"\x00\x01\x02").unwrap();
        commit_all(&place.worktree, "bin");
        std::fs::write(place.worktree.join("fresh.bin"), b"PNG\x00\n\n").unwrap();

        let (_, files) = listed(&place);
        let unknown = |path: &str| ChangedFile { path: path.to_string(), additions: None, deletions: None };
        assert_eq!(sorted_by_path(files), vec![unknown("committed.bin"), unknown("fresh.bin")]);
    }

    /// 너무 큰 새 파일(파일 읽기의 상한을 넘는 것)은 열지 않는다 — 걸리지 않은 로그 하나가 목록 읽기를 멈추지 않게. 세지
    /// 못했으니 줄 수가 없다.
    #[test]
    fn 상한을_넘는_새_파일은_열지_않고_줄_수가_없다() {
        let place = setup();
        let line = "0123456789abcdef\n";
        let big = line.repeat(usize::try_from(READ_LIMIT).unwrap() / line.len() + 1);
        write(&place.worktree, "big.log", &big);
        write(&place.worktree, "small.txt", "1\n");

        let (_, files) = listed(&place);
        assert_eq!(
            sorted_by_path(files),
            vec![ChangedFile { path: "big.log".to_string(), additions: None, deletions: None }, file("small.txt", 1, 0)],
        );
    }

    /// 견주는 자리는 base의 끝이 아니라 **갈라진 커밋**이다 — Work를 시작한 뒤 base에 쌓인 커밋은 이 Work의 변경이 아니다.
    /// base의 끝과 견주면 남이 base에 들인 파일이 「이 Work가 지웠다」로 선다.
    #[test]
    fn base가_앞서_나가도_그_뒤의_커밋은_변경이_아니다() {
        let place = setup();
        write(&place.repo, "elsewhere.txt", "1\n2\n");
        commit_all(&place.repo, "main moves on");
        write(&place.worktree, "mine.txt", "1\n");

        let (_, files) = listed(&place);
        assert_eq!(files, vec![file("mine.txt", 1, 0)]);
    }

    /// PR에 들어갈 것과 같은 기준(S23) — base는 원격의 것을 먼저 본다. Work 브랜치가 원격 base를 받아 왔는데(`git pull origin
    /// main`) 로컬 base가 뒤처져 있으면, 로컬과 견줄 때 받아 온 남의 커밋이 모두 이 Work의 변경으로 선다.
    #[test]
    fn 받아_온_원격_base의_커밋은_변경이_아니다() {
        let place = setup();
        // 원격 base가 앞서 나갔다 — 로컬 `main`은 그대로다.
        run_git(&place.repo, &["checkout", "-q", "-b", "upstream"]);
        write(&place.repo, "theirs.txt", "1\n2\n3\n");
        commit_all(&place.repo, "upstream work");
        run_git(&place.repo, &["update-ref", "refs/remotes/origin/main", "upstream"]);
        run_git(&place.repo, &["checkout", "-q", "main"]);
        // Work 브랜치가 그것을 받아 온다.
        write(&place.worktree, "mine.txt", "1\n");
        commit_all(&place.worktree, "mine");
        run_git(&place.worktree, &["merge", "-q", "--no-edit", "origin/main"]);

        let (base, files) = listed(&place);
        assert_eq!(base, "main");
        assert_eq!(files, vec![file("mine.txt", 1, 0)]);
    }

    /// S21 — worktree가 없는 Project는 읽기만 하는 Project다. 고친 적이 없으니 변경이 없고, 화면은 그 칸을 그리지 않는다.
    /// 화면에는 갈래 이름 `kind`와 camelCase 필드로 간다.
    #[test]
    fn worktree가_없는_project는_읽기만이고_화면에는_kind로_간다() {
        let place = setup();
        let mut work = crate::read_work(&place.works, "w").unwrap();
        work.projects.push("api".to_string());
        std::fs::write(place.works.join("w").join("work.json"), crate::render_work(&work)).unwrap();
        write(&place.worktree, "mine.txt", "1\n");

        let all = list_work_changes(&place.works, &place.projects, "w").unwrap();
        assert_eq!(
            serde_json::to_value(&all).unwrap(),
            serde_json::json!([
                {
                    "project": "fe",
                    "kind": "listed",
                    "base": "main",
                    "files": [{ "path": "mine.txt", "additions": 1, "deletions": 0 }],
                },
                { "project": "api", "kind": "worktreeMissing" },
            ]),
        );
    }

    /// base를 모르면 견줄 수 없다 — 모든 파일을 변경이라 하지 않고 「base를 모름」이라 답한다. Project 등록이 사라졌고
    /// `origin/HEAD`도 없으면 이름부터 없고, 적힌 base가 저장소에 없으면 그 이름을 싣는다.
    ///
    /// 적힌 base가 없는 자리는 기준 브랜치로 고른 뒤 그 브랜치를 지운 것이다 — 고치기는 저장소에 있는 브랜치만 받는다(03 구현 스펙 §15).
    #[test]
    fn base를_찾지_못하면_base를_모름이다() {
        let place = setup();
        run_git(&place.repo, &["branch", "develop"]);
        crate::update_project(
            &place.projects,
            "fe",
            crate::ProjectPatch { name: None, description: None, base_branch: Some("develop".to_string()) },
        )
        .unwrap();
        run_git(&place.repo, &["branch", "-D", "develop"]);
        let answer = |place: &Place| list_work_changes(&place.works, &place.projects, "w").unwrap().remove(0).changes;
        assert_eq!(answer(&place), Changes::BaseUnknown { base: Some("develop".to_string()) });

        std::fs::remove_file(place.projects.join("fe.md")).unwrap(); // 등록부에서 사라진다
        assert_eq!(answer(&place), Changes::BaseUnknown { base: None });
    }

    fn diff(place: &Place, path: &str) -> FileDiff {
        read_work_diff(&place.works, &place.projects, "w", "fe", path).unwrap()
    }

    /// patch에서 머리(`diff --git` · `index` …)를 뺀 덩어리들 — 머리의 `index` 줄은 blob 해시라 글자로 견줄 수 없다.
    fn hunks(answer: &FileDiff) -> &str {
        match answer {
            FileDiff::Patch { patch } => &patch[patch.find("@@").expect("덩어리가 없다")..],
            other => panic!("patch가 아니다: {other:?}"),
        }
    }

    /// 한 파일의 diff는 변경 목록과 같은 기준이다(S23) — 커밋한 것과 커밋하지 않은 것을 합쳐 갈라진 커밋과 견준다.
    #[test]
    fn 한_파일의_diff는_커밋한_것과_작업_중인_것을_합친다() {
        let place = setup();
        write(&place.worktree, "a.txt", "one\ntwo\nthree\n");
        commit_all(&place.worktree, "three");
        write(&place.worktree, "a.txt", "ONE\ntwo\nthree\n");

        let answer = diff(&place, "a.txt");
        assert_eq!(hunks(&answer), "@@ -1,2 +1,3 @@\n-one\n+ONE\n two\n+three\n");
    }

    /// git이 아직 모르는 새 파일도 변경 목록에 서므로 diff가 있다 — 모두 더한 줄이고, 머리가 「새 파일」이다.
    #[test]
    fn git이_모르는_새_파일의_diff는_모두_더한_줄이다() {
        let place = setup();
        write(&place.worktree, "new/c.txt", "x\ny\n");

        let answer = diff(&place, "new/c.txt");
        let FileDiff::Patch { patch } = &answer else { panic!("patch가 아니다: {answer:?}") };
        assert!(patch.starts_with("diff --git a/new/c.txt b/new/c.txt\nnew file mode"), "{patch}");
        assert!(patch.contains("--- /dev/null\n+++ b/new/c.txt\n"), "{patch}");
        assert_eq!(hunks(&answer), "@@ -0,0 +1,2 @@\n+x\n+y\n");
    }

    /// base와 같으면 「바뀐 것 없음」이다 — 목록이 낡았을 때(그 사이 되돌렸다) 빈 diff 보기 대신 그 까닭이 뜬다.
    /// gitignore에 걸린 파일은 변경 목록에 없으므로 diff도 없고, 없는 경로도 같다.
    #[test]
    fn base와_같거나_걸렸거나_없는_파일은_바뀐_것_없음이다() {
        let place = setup();
        write(&place.worktree, ".gitignore", "*.log\n");
        commit_all(&place.worktree, "ignore");
        write(&place.worktree, "debug.log", "noise\n");

        assert_eq!(diff(&place, "a.txt"), FileDiff::Unchanged);
        assert_eq!(diff(&place, "debug.log"), FileDiff::Unchanged);
        assert_eq!(diff(&place, "nowhere.txt"), FileDiff::Unchanged);
    }

    /// 바이너리는 덩어리가 없다 — git의 「Binary files … differ」 한 줄을 diff 보기에 넘기지 않고 갈래로 답한다. 커밋한 것이든
    /// 새 파일이든 같다.
    #[test]
    fn 바이너리의_diff는_바이너리다() {
        let place = setup();
        std::fs::write(place.worktree.join("committed.bin"), b"\x00\x01").unwrap();
        commit_all(&place.worktree, "bin");
        std::fs::write(place.worktree.join("fresh.bin"), b"PNG\x00").unwrap();

        assert_eq!(diff(&place, "committed.bin"), FileDiff::Binary);
        assert_eq!(diff(&place, "fresh.bin"), FileDiff::Binary);
    }

    /// 파일 읽기의 상한을 넘는 diff는 싣지 않는다 — 다시 지은 잠금 파일 하나가 화면을 멈추지 않게. 새 파일은 git을 부르기 전에
    /// 크기로 가른다.
    #[test]
    fn 상한을_넘는_diff는_너무_큼이다() {
        let place = setup();
        let line = "0123456789abcdef\n";
        let big = line.repeat(usize::try_from(READ_LIMIT).unwrap() / line.len() + 1);
        write(&place.worktree, "lock.txt", &big);
        commit_all(&place.worktree, "lock");
        write(&place.worktree, "fresh.log", &big);

        // 틀리면 몇 MB의 patch를 찍지 않게 갈래 이름만 견준다.
        let kind = |path: &str| serde_json::to_value(diff(&place, path)).unwrap()["kind"].clone();
        assert_eq!(kind("lock.txt"), "tooLarge");
        assert_eq!(kind("fresh.log"), "tooLarge");
    }

    /// 지운 파일도 변경 목록에 서므로(맨 뒤) diff가 있다 — base의 줄을 모두 뺀다.
    #[test]
    fn 지운_파일의_diff는_모두_뺀_줄이다() {
        let place = setup();
        std::fs::remove_file(place.worktree.join("a.txt")).unwrap();

        let answer = diff(&place, "a.txt");
        let FileDiff::Patch { patch } = &answer else { panic!("patch가 아니다: {answer:?}") };
        assert!(patch.contains("deleted file mode"), "{patch}");
        assert_eq!(hunks(&answer), "@@ -1,2 +0,0 @@\n-one\n-two\n");
    }

    /// 경로는 글자 그대로다 — git은 경로를 glob으로도 읽어 `[id]`를 「i나 d 한 글자」로 푼다. 라우트 폴더(`app/[id]/page.tsx`)
    /// 옆에 `app/i/page.tsx`가 있으면 한 파일의 diff에 남의 파일이 섞인다. 커밋한 파일과 새 파일 둘 다다.
    #[test]
    fn 대괄호가_든_경로도_글자_그대로_그_파일_하나만_찾는다() {
        let place = setup();
        write(&place.worktree, "app/[id]/page.tsx", "a\n");
        write(&place.worktree, "app/i/page.tsx", "a\n");
        commit_all(&place.worktree, "route");
        write(&place.worktree, "app/[id]/page.tsx", "b\n");
        write(&place.worktree, "app/i/page.tsx", "z\n");
        write(&place.worktree, "app/[slug]/new.tsx", "c\n");
        write(&place.worktree, "app/s/new.tsx", "d\n");

        assert_eq!(hunks(&diff(&place, "app/[id]/page.tsx")), "@@ -0,0 +1 @@\n+b\n");
        assert_eq!(hunks(&diff(&place, "app/[slug]/new.tsx")), "@@ -0,0 +1 @@\n+c\n");
    }

    /// 한글 이름은 목록에도 diff 머리에도 글자 그대로다 — git은 비ASCII 이름을 `"\355\225\234…"` 8진 이스케이프로 감싸고,
    /// 그러면 diff 보기의 머리가 읽을 수 없는 이름이 된다. Work의 문서 이름이 흔히 한글이다.
    #[test]
    fn 한글_이름은_목록에도_diff_머리에도_글자_그대로다() {
        let place = setup();
        write(&place.worktree, "문서/설계.md", "가\n");
        commit_all(&place.worktree, "doc");
        write(&place.worktree, "문서/설계.md", "나\n");

        let (_, files) = listed(&place);
        assert_eq!(files, vec![file("문서/설계.md", 1, 0)]);
        let FileDiff::Patch { patch } = diff(&place, "문서/설계.md") else { panic!("patch가 아니다") };
        assert!(patch.starts_with("diff --git a/문서/설계.md b/문서/설계.md\n"), "{patch}");
    }

    /// 부른 쪽이 틀린 것(밖을 가리키는 경로 · slug)만 `Err`다. 읽기만 하는 Project는 답의 갈래다.
    #[test]
    fn 밖을_가리키는_경로는_거절하고_worktree가_없으면_그렇게_답한다() {
        let place = setup();
        for path in ["../fe/a.txt", "/etc/hosts", ""] {
            assert!(read_work_diff(&place.works, &place.projects, "w", "fe", path).is_err(), "{path:?}를 받았다");
        }
        assert!(read_work_diff(&place.works, &place.projects, "w", "../w", "a.txt").is_err());
        assert_eq!(
            read_work_diff(&place.works, &place.projects, "w", "api", "a.txt").unwrap(),
            FileDiff::WorktreeMissing,
        );
    }
}
