use std::path::{Path, PathBuf};

use crate::work::{parse_work, render_work, TreeView, Work, WorkStatus, WorkView};
use crate::{collapse_home, expand_home, git, slugify, Error, Result};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeError {
    pub project: String,
    pub message: String,
}

/// start/attach의 결과. 검증 통과 후 개별 워크트리 생성 실패는
/// 전체 실패가 아니라 `errors`로 보고된다 (성공분 유지, 재실행 멱등).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkReport {
    #[serde(flatten)]
    pub view: WorkView,
    pub errors: Vec<TreeError>,
}

pub fn start_work(
    works_root: &Path,
    projects_root: &Path,
    title: &str,
    project_slugs: &[String],
    branch: Option<&str>,
) -> Result<WorkReport> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Validation("title must not be empty".into()));
    }
    std::fs::create_dir_all(works_root)?;

    // 같은 제목의 work가 있으면 이어서 생성(멱등), 없으면 새로 만든다
    let existing_work = find_by_title(works_root, title)?;
    let resuming = existing_work.is_some();
    let mut work = match existing_work {
        Some(mut work) => {
            for p in project_slugs {
                if !work.projects.contains(p) {
                    work.projects.push(p.clone());
                }
            }
            work
        }
        None => {
            let slug = unique_dir_slug(works_root, &slugify(title));
            Work {
                slug,
                title: title.to_string(),
                status: WorkStatus::Active,
                branch: None,
                created_at: chrono::Local::now().format("%Y-%m-%d").to_string(),
                projects: project_slugs.to_vec(),
                extra: Default::default(),
            }
        }
    };
    // 프로젝트가 없으면 워크트리도 없다. 쓰지도 않을 브랜치를 저장소에 남기지 않으려고
    // 이름을 정하지 않고 미룬다 — 첫 프로젝트가 붙을 때 확정된다 (attach_project).
    let nothing_to_decide =
        work.projects.is_empty() && work.branch.is_none() && branch.is_none();
    work.branch = if nothing_to_decide { None } else { Some(decide_branch(&work, branch)?) };

    // 사전검증: 워크트리가 없는 프로젝트 전부를 먼저 검사하고, 하나라도 실패면 아무것도 만들지 않는다
    let dir = works_root.join(&work.slug);
    let pending: Vec<&String> =
        work.projects.iter().filter(|p| !dir.join("trees").join(p.as_str()).is_dir()).collect();
    let mut reasons = Vec::new();
    let mut repos = Vec::new();
    // 브랜치가 미정이면 프로젝트도 없다 — 검사할 워크트리가 아예 없다는 뜻이다
    if let Some(branch) = work.branch.as_deref() {
        for p in &pending {
            match validate_for_tree(projects_root, p, branch, resuming) {
                Ok(repo_base) => repos.push(repo_base),
                Err(reason) => reasons.push(format!("{p}: {reason}")),
            }
        }
    }
    if !reasons.is_empty() {
        return Err(Error::Validation(reasons.join("; ")));
    }

    std::fs::create_dir_all(spec_dir(&dir))?;
    // 빈 trees/는 "망가진 워크트리"로 읽힌다 — 만들 것이 있을 때만 만든다
    if !pending.is_empty() {
        std::fs::create_dir_all(dir.join("trees"))?;
    }
    write_work(works_root, &work)?;

    // 검증을 통과한 뒤의 개별 실패는 성공분을 유지한 채 보고만 한다
    let mut errors = Vec::new();
    if let Some(branch) = work.branch.as_deref() {
        for (p, (repo, base)) in pending.iter().zip(repos) {
            let tree = dir.join("trees").join(p.as_str());
            if let Err(message) = git::worktree_add(&repo, &tree, branch, &base) {
                errors.push(TreeError { project: p.to_string(), message });
            }
        }
    }

    // 소유권상 work를 다시 읽지 않고 뷰만 파생
    let view = to_view(works_root, work);
    Ok(WorkReport { view, errors })
}

/// 이름을 **무엇으로** 정할지 답하는 유일한 지점. 돌려주기만 하고 저장은 호출부가 한다.
///
/// | work의 branch | 넘긴 branch | 결과 |
/// |---|---|---|
/// | 있음 | 없음 / 같은 값 | 기존 브랜치 그대로 |
/// | 있음 | 다른 값 | 거부 — 한 work는 브랜치 하나를 공유한다 |
/// | 없음 | 있음 | 그 값으로 확정 |
/// | 없음 | 없음 | slug로 확정 |
///
/// **이름을 지금 정할지 말지**는 표 밖, 호출부의 결정이다. 워크트리가 생기지 않는
/// start_work 경로는 이 함수를 부르지 않고 미정으로 남긴다 (`nothing_to_decide`) —
/// 마지막 행의 slug 폴백은 워크트리를 당장 만들어야 해서 이름이 필요할 때의 이야기다.
fn decide_branch(work: &Work, given: Option<&str>) -> Result<String> {
    match (work.branch.as_deref(), given) {
        (Some(current), Some(given)) if given != current => Err(Error::Validation(format!(
            "work '{}' already uses branch '{current}'",
            work.slug
        ))),
        (Some(current), _) => Ok(current.to_string()),
        (None, Some(given)) => Ok(given.to_string()),
        (None, None) => Ok(work.slug.clone()),
    }
}

/// 검증 통과 시 (저장소 절대경로, baseBranch) 반환.
/// `allow_existing_branch`: 기존 work의 재개/attach는 부분 실패로 브랜치만 남은
/// 상태를 이어가야 하므로 브랜치 충돌을 허용한다 (worktree_add가 채택).
fn validate_for_tree(
    projects_root: &Path,
    project_slug: &str,
    branch: &str,
    allow_existing_branch: bool,
) -> std::result::Result<(PathBuf, String), String> {
    let view = crate::get_project(projects_root, project_slug)
        .map_err(|_| "project not registered".to_string())?;
    if view.missing {
        return Err(format!("folder does not exist: {}", view.project.path));
    }
    let repo = expand_home(&view.project.path);
    if view.git.is_none() {
        return Err("not a git repository".to_string());
    }
    let base = view.project.base_branch;
    if !git::rev_exists(&repo, &base) {
        return Err(format!("baseBranch '{base}' does not exist"));
    }
    if !allow_existing_branch && git::branch_exists(&repo, branch) {
        return Err(format!("branch '{branch}' already exists"));
    }
    Ok((repo, base))
}

fn find_by_title(works_root: &Path, title: &str) -> Result<Option<Work>> {
    for view in list_works(works_root)? {
        if view.work.title == title {
            return Ok(Some(view.work));
        }
    }
    Ok(None)
}

fn unique_dir_slug(works_root: &Path, base: &str) -> String {
    let mut slug = base.to_string();
    let mut n = 2;
    while works_root.join(&slug).exists() {
        slug = format!("{base}-{n}");
        n += 1;
    }
    slug
}

fn work_dir(works_root: &Path, slug: &str) -> Result<PathBuf> {
    if !crate::slug::is_safe_slug(slug) {
        return Err(Error::WorkNotFound(slug.to_string()));
    }
    Ok(works_root.join(slug))
}

fn read_work(works_root: &Path, slug: &str) -> Result<Work> {
    let path = work_dir(works_root, slug)?.join("work.json");
    let content =
        std::fs::read_to_string(&path).map_err(|_| Error::WorkNotFound(slug.to_string()))?;
    parse_work(slug, &content)
}

/// 같은 디렉토리 tmp 파일 → rename 원자적 쓰기 (projects와 동일 규칙)
fn write_work(works_root: &Path, work: &Work) -> Result<()> {
    let dir = works_root.join(&work.slug);
    let tmp_path = dir.join(".work.json.tmp");
    std::fs::write(&tmp_path, render_work(work))?;
    std::fs::rename(&tmp_path, dir.join("work.json"))?;
    Ok(())
}

fn to_view(works_root: &Path, work: Work) -> WorkView {
    let dir = works_root.join(&work.slug);
    let trees = work
        .projects
        .iter()
        .map(|p| {
            let tree = dir.join("trees").join(p);
            let exists = tree.is_dir();
            TreeView {
                project: p.clone(),
                path: collapse_home(&tree),
                exists,
                dirty: exists && git::is_dirty(&tree),
            }
        })
        .collect();
    WorkView { spec_dir: collapse_home(&spec_dir(&dir)), spec_files: spec_files(&dir), work, trees }
}

/// spec 문서를 두는 디렉터리. 뷰가 알려주는 위치와 목록이 읽는 위치가 어긋나지
/// 않도록 경로를 만드는 곳은 여기 하나다 (work_dir와 같은 규칙).
fn spec_dir(work_dir: &Path) -> PathBuf {
    work_dir.join("spec")
}

/// spec/ 아래 파일들의 상대 경로 (정렬, dotfile 제외)
fn spec_files(work_dir: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect_files(&spec_dir(work_dir), "", &mut files);
    files.sort();
    files
}

fn collect_files(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, &rel, out);
        } else {
            out.push(rel);
        }
    }
}

pub fn list_works(works_root: &Path) -> Result<Vec<WorkView>> {
    std::fs::create_dir_all(works_root)?;
    let mut views = Vec::new();
    for entry in std::fs::read_dir(works_root)? {
        let entry = entry?;
        let slug = entry.file_name().to_string_lossy().to_string();
        if slug.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        // AI가 망가뜨린 파일 하나가 전체 목록을 막지 않도록 파싱 실패는 건너뜀
        if let Ok(work) = read_work(works_root, &slug) {
            views.push(to_view(works_root, work));
        }
    }
    views.sort_by(|a, b| {
        b.work.created_at.cmp(&a.work.created_at).then_with(|| a.work.slug.cmp(&b.work.slug))
    });
    Ok(views)
}

pub fn get_work(works_root: &Path, slug: &str) -> Result<WorkView> {
    Ok(to_view(works_root, read_work(works_root, slug)?))
}

pub fn update_work_status(works_root: &Path, slug: &str, status: WorkStatus) -> Result<WorkView> {
    let mut work = read_work(works_root, slug)?;
    work.status = status;
    write_work(works_root, &work)?;
    Ok(to_view(works_root, work))
}

/// 프로젝트를 붙인다. `branch`는 **브랜치가 아직 미정인 work를 위한 것**이다 —
/// 코드를 건드릴 때가 되어서야 저장소 관례에 맞는 이름을 고르게 한다.
/// 이미 정해진 work에 다른 이름을 넘기면 거부된다 (decide_branch의 규칙표).
pub fn attach_project(
    works_root: &Path,
    projects_root: &Path,
    slug: &str,
    project_slug: &str,
    branch: Option<&str>,
) -> Result<WorkReport> {
    let mut work = read_work(works_root, slug)?;
    let dir = works_root.join(&work.slug);
    let tree = dir.join("trees").join(project_slug);
    // 워크트리를 만들려면 이름이 있어야 한다 — 미정이던 work는 여기서 확정된다.
    let branch = decide_branch(&work, branch)?;

    // 만들 워크트리가 있을 때만 검증한다. 실패하면 여기서 끝나고 아무것도 쓰지 않는다.
    let pending_tree = if tree.is_dir() {
        None
    } else {
        Some(
            validate_for_tree(projects_root, project_slug, &branch, true)
                .map_err(|reason| Error::Validation(format!("{project_slug}: {reason}")))?,
        )
    };
    // 확정은 조건 없이 저장한다 (결정표에 조건이 없다). 워크트리 생성 **전**이라
    // 생성이 실패해도 다음 시도가 같은 이름을 쓴다 — 성공분 유지·재실행 멱등이라는
    // 부분 실패 계약과 같은 결이다.
    if work.branch.is_none() {
        work.branch = Some(branch.clone());
        write_work(works_root, &work)?;
    }

    let mut errors = Vec::new();
    if let Some((repo, base)) = pending_tree {
        std::fs::create_dir_all(dir.join("trees"))?;
        if let Err(message) = git::worktree_add(&repo, &tree, &branch, &base) {
            errors.push(TreeError { project: project_slug.to_string(), message });
        }
    }
    if !work.projects.iter().any(|p| p == project_slug) {
        work.projects.push(project_slug.to_string());
        write_work(works_root, &work)?;
    }
    Ok(WorkReport { view: to_view(works_root, work), errors })
}

pub fn remove_work(works_root: &Path, slug: &str, force: bool) -> Result<()> {
    let work = read_work(works_root, slug)?;
    let dir = works_root.join(&work.slug);

    let existing: Vec<PathBuf> = work
        .projects
        .iter()
        .map(|p| dir.join("trees").join(p))
        .filter(|t| t.is_dir())
        .collect();

    if !force {
        let dirty: Vec<String> = existing
            .iter()
            .filter(|t| git::is_dirty(t))
            .map(|t| collapse_home(t))
            .collect();
        if !dirty.is_empty() {
            return Err(Error::DirtyTrees(dirty.join(", ")));
        }
    }
    for tree in &existing {
        git::worktree_remove(tree, force).map_err(Error::Git)?;
    }
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}

pub fn read_spec_file(works_root: &Path, slug: &str, rel_path: &str) -> Result<String> {
    let dir = work_dir(works_root, slug)?;
    if !dir.join("work.json").is_file() {
        return Err(Error::WorkNotFound(slug.to_string()));
    }
    let rel = Path::new(rel_path);
    let safe = !rel_path.is_empty()
        && rel.is_relative()
        && rel.components().all(|c| matches!(c, std::path::Component::Normal(_)));
    if !safe {
        return Err(Error::Validation(format!("invalid spec path: {rel_path}")));
    }
    Ok(std::fs::read_to_string(spec_dir(&dir).join(rel))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn init_repo(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        run_git(dir, &["init", "-b", "main"]);
        run_git(dir, &["config", "user.email", "t@t.t"]);
        run_git(dir, &["config", "user.name", "t"]);
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "init"]);
    }

    /// tempdir 아래 works/·projects/ 루트와 git 저장소 2개(fe, be)를 프로젝트로 등록
    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let works = tmp.path().join("works");
        let projects = tmp.path().join("projects");
        for name in ["fe", "be"] {
            let repo = tmp.path().join(name);
            init_repo(&repo);
            crate::create_project(&projects, &repo).unwrap();
        }
        (tmp, works, projects)
    }

    fn slugs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn start_creates_meta_spec_and_worktrees() {
        let (tmp, works, projects) = setup();
        let report = start_work(&works, &projects, "카트 아이템 추가", &slugs(&["fe", "be"]), Some("feat/cart"))
            .unwrap();
        assert!(report.errors.is_empty());

        let w = &report.view.work;
        assert_eq!(w.slug, "카트-아이템-추가");
        assert_eq!(w.title, "카트 아이템 추가");
        assert_eq!(w.status, WorkStatus::Active);
        assert_eq!(w.branch.as_deref(), Some("feat/cart"));
        assert_eq!(w.projects, vec!["fe", "be"]);

        let dir = works.join(&w.slug);
        assert!(dir.join("work.json").is_file());
        assert!(dir.join("spec").is_dir());
        for (i, proj) in ["fe", "be"].iter().enumerate() {
            let tree = dir.join("trees").join(proj);
            assert!(tree.is_dir(), "worktree missing for {proj}");
            // 워크트리는 공유 브랜치명으로, 각 저장소의 baseBranch(main) 커밋에서 분기
            assert_eq!(run_git(&tree, &["branch", "--show-current"]), "feat/cart");
            let base = run_git(&tmp.path().join(proj), &["rev-parse", "main"]);
            assert_eq!(run_git(&tree, &["rev-parse", "HEAD"]), base);
            let t = &report.view.trees[i];
            assert_eq!(t.project, *proj);
            assert!(t.exists);
            assert!(!t.dirty);
        }
    }

    #[test]
    fn start_defaults_branch_to_slug() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &projects, "Cart Add", &slugs(&["fe"]), None).unwrap();
        assert_eq!(report.view.work.branch.as_deref(), Some("cart-add"));
        let tree = works.join("cart-add/trees/fe");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "cart-add");
    }

    /// 문턱 낮추기의 핵심 — 아이디어 한 줄에도 갈 곳이 생긴다.
    /// 워크트리도, 빈 `trees/`도, **쓰지도 않을 브랜치도** 만들지 않는다.
    #[test]
    fn start_without_projects_creates_only_the_work_and_its_spec() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &projects, "언젠가 해볼 것", &[], None).unwrap();
        assert!(report.errors.is_empty());

        let w = &report.view.work;
        assert_eq!(w.slug, "언젠가-해볼-것");
        assert_eq!(w.branch, None, "an unused branch must not be invented");
        assert!(w.projects.is_empty());
        assert!(report.view.trees.is_empty());
        // 직교성: 프로젝트가 없다고 draft가 되지 않는다. 상태는 선언되는 것이고,
        // 프로젝트 없이 진행 중인 리서치 work가 draft로 오표기되면 안 된다.
        assert_eq!(w.status, WorkStatus::Active);

        let dir = works.join(&w.slug);
        assert!(dir.join("work.json").is_file());
        assert!(dir.join("spec").is_dir());
        assert!(!dir.join("trees").exists(), "an empty trees/ reads as a broken worktree");

        // 파일에는 branch 키가 아예 없다
        let file = std::fs::read_to_string(dir.join("work.json")).unwrap();
        assert!(!file.contains("branch"), "undecided branch must not be persisted: {file}");

        // 조회도 같은 모양이고 specDir는 그대로 내려온다
        let view = get_work(&works, &w.slug).unwrap();
        assert_eq!(view.work.branch, None);
        assert!(view.trees.is_empty());
        assert!(expand_home(&view.spec_dir).is_dir());
    }

    /// 브랜치 이름만 미리 정해 두는 것도 된다. 그래도 붙일 프로젝트가 없으면
    /// 워크트리는 생기지 않는다 — 브랜치 확정과 워크트리 생성은 별개다.
    #[test]
    fn start_without_projects_still_records_an_explicit_branch() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &projects, "미리 정한 것", &[], Some("feat/planned")).unwrap();
        assert_eq!(report.view.work.branch.as_deref(), Some("feat/planned"));
        assert!(!works.join("미리-정한-것/trees").exists());
    }

    /// 프로젝트가 없으면 지울 워크트리도 없다 — 폴더만 사라지고 git 경고도 없다.
    #[test]
    fn remove_project_less_work_deletes_only_its_folder() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "아이디어", &[], None).unwrap();
        remove_work(&works, "아이디어", false).unwrap();
        assert!(!works.join("아이디어").exists());
    }

    /// 이미 만들어 둔 work는 마이그레이션 없이 그대로 읽힌다.
    #[test]
    fn existing_work_files_still_parse_and_keep_unknown_fields() {
        let (_tmp, works, _projects) = setup();
        let dir = works.join("옛날-작업");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("work.json"),
            r#"{"title":"옛날 작업","status":"active","branch":"feat/old","createdAt":"2026-01-02","projects":["fe"],"customField":"keep-me"}"#,
        )
        .unwrap();

        let view = get_work(&works, "옛날-작업").unwrap();
        assert_eq!(view.work.branch.as_deref(), Some("feat/old"));
        assert_eq!(view.work.projects, vec!["fe"]);

        // 상태만 바꿔 다시 써도 모르는 필드와 브랜치가 그대로다
        update_work_status(&works, "옛날-작업", WorkStatus::Review).unwrap();
        let file = std::fs::read_to_string(dir.join("work.json")).unwrap();
        assert!(file.contains("keep-me"), "unknown field lost: {file}");
        assert!(file.contains("feat/old"), "branch lost: {file}");
    }

    #[test]
    fn start_validation_failure_creates_nothing() {
        let (tmp, works, projects) = setup();
        // be 저장소에 충돌 브랜치를 미리 만들어 사전검증이 실패하게 한다
        run_git(&tmp.path().join("be"), &["branch", "feat/cart"]);
        let result = start_work(&works, &projects, "카트", &slugs(&["fe", "be"]), Some("feat/cart"));
        assert!(matches!(result, Err(Error::Validation(_))), "expected validation error");
        // 아무것도 만들지 않는다 — fe 워크트리도, work 디렉터리도
        assert!(!works.join("카트").exists());
        assert!(!git::branch_exists(&tmp.path().join("fe"), "feat/cart"));
    }

    #[test]
    fn start_rejects_unknown_project() {
        let (_tmp, works, projects) = setup();
        let result = start_work(&works, &projects, "카트", &slugs(&["nope"]), None);
        assert!(matches!(result, Err(Error::Validation(_))));
        assert!(!works.join("카트").exists());
    }

    #[test]
    fn start_resumes_missing_trees_idempotently() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), Some("feat/cart")).unwrap();
        // 같은 제목으로 재실행 + 프로젝트 추가 → 새 slug가 아니라 기존 work에 이어서 생성
        let report =
            start_work(&works, &projects, "카트", &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
        assert!(report.errors.is_empty());
        assert_eq!(report.view.work.slug, "카트");
        assert_eq!(report.view.work.projects, vec!["fe", "be"]);
        assert!(works.join("카트/trees/fe").is_dir());
        assert!(works.join("카트/trees/be").is_dir());
        assert!(!works.join("카트-2").exists());
    }

    #[test]
    fn list_derives_dirty_and_spec_files_and_sorts() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "첫 작업", &slugs(&["fe"]), Some("b1")).unwrap();
        start_work(&works, &projects, "둘째 작업", &slugs(&["be"]), Some("b2")).unwrap();

        // 워크트리에 커밋 안 된 변경 → dirty, spec 파일 → specFiles
        std::fs::write(works.join("첫-작업/trees/fe/new.txt"), "x").unwrap();
        std::fs::create_dir_all(works.join("첫-작업/spec/sub")).unwrap();
        std::fs::write(works.join("첫-작업/spec/overview.md"), "# o").unwrap();
        std::fs::write(works.join("첫-작업/spec/sub/arch.md"), "# a").unwrap();
        std::fs::write(works.join("첫-작업/spec/.hidden"), "x").unwrap();

        let listed = list_works(&works).unwrap();
        assert_eq!(listed.len(), 2);
        // createdAt 동일 → slug 오름차순
        assert_eq!(listed[0].work.slug, "둘째-작업");

        let first = get_work(&works, "첫-작업").unwrap();
        assert!(first.trees[0].dirty);
        assert_eq!(first.spec_files, vec!["overview.md", "sub/arch.md"]);
        let second = get_work(&works, "둘째-작업").unwrap();
        assert!(!second.trees[0].dirty);
        assert!(second.spec_files.is_empty());

        assert!(matches!(get_work(&works, "없음"), Err(Error::WorkNotFound(_))));
        assert!(matches!(get_work(&works, "../탈출"), Err(Error::WorkNotFound(_))));
    }

    /// spec 폴더의 다섯 이름은 **표시 계층**의 약속이다. 커널은 정렬된 상대 경로
    /// 목록만 주고, 관습에 없는 폴더도 빠뜨리지 않는다.
    #[test]
    fn spec_files_stay_a_flat_sorted_list_whatever_the_folder_names_are() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &[], None).unwrap();
        let spec = works.join("카트/spec");
        for dir in ["01-첫-판/tickets", "02-둘째-판", "research", "explanation", "잡동사니"] {
            std::fs::create_dir_all(spec.join(dir)).unwrap();
        }
        for (path, body) in [
            ("overview.md", "# o"),
            ("01-첫-판/plan.md", "p"),
            ("01-첫-판/tickets/t1.md", "t"),
            ("02-둘째-판/plan.md", "p"),
            ("research/api.md", "r"),
            ("explanation/why.md", "w"),
            ("잡동사니/메모.md", "m"),
        ] {
            std::fs::write(spec.join(path), body).unwrap();
        }

        let mut expected = vec![
            "overview.md",
            "01-첫-판/plan.md",
            "01-첫-판/tickets/t1.md",
            "02-둘째-판/plan.md",
            "research/api.md",
            "explanation/why.md",
            "잡동사니/메모.md",
        ];
        expected.sort();
        assert_eq!(get_work(&works, "카트").unwrap().spec_files, expected);
    }

    #[test]
    fn update_status_persists() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), None).unwrap();
        let view = update_work_status(&works, "카트", WorkStatus::Review).unwrap();
        assert_eq!(view.work.status, WorkStatus::Review);
        assert_eq!(get_work(&works, "카트").unwrap().work.status, WorkStatus::Review);
        // 자유 전환: done → active 도 허용
        update_work_status(&works, "카트", WorkStatus::Done).unwrap();
        let back = update_work_status(&works, "카트", WorkStatus::Active).unwrap();
        assert_eq!(back.work.status, WorkStatus::Active);
        assert!(matches!(
            update_work_status(&works, "없음", WorkStatus::Done),
            Err(Error::WorkNotFound(_))
        ));
    }

    /// draft는 **선언된** 상태다. 지정해도 프로젝트·브랜치·워크트리는 하나도 건드리지
    /// 않고, 프로젝트가 붙어 있어도 draft일 수 있다 (직교성).
    #[test]
    fn draft_is_declared_and_changes_nothing_else() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), Some("feat/cart")).unwrap();

        let view = update_work_status(&works, "카트", WorkStatus::Draft).unwrap();
        assert_eq!(view.work.status, WorkStatus::Draft);
        assert_eq!(view.work.projects, vec!["fe"]);
        assert_eq!(view.work.branch.as_deref(), Some("feat/cart"));
        assert!(view.trees[0].exists, "draft must not touch the worktrees");
        assert_eq!(get_work(&works, "카트").unwrap().work.status, WorkStatus::Draft);

        // 되돌아오는 것도 자유다 — 전이 제약은 없다
        let back = update_work_status(&works, "카트", WorkStatus::Active).unwrap();
        assert_eq!(back.work.status, WorkStatus::Active);
    }

    #[test]
    fn attach_adds_project_with_tree_and_is_idempotent() {
        let (tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), Some("feat/cart")).unwrap();

        let report = attach_project(&works, &projects, "카트", "be", None).unwrap();
        assert!(report.errors.is_empty());
        assert_eq!(report.view.work.projects, vec!["fe", "be"]);
        let tree = works.join("카트/trees/be");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "feat/cart");

        // 이미 붙은 프로젝트 재attach → 멱등
        let again = attach_project(&works, &projects, "카트", "be", None).unwrap();
        assert!(again.errors.is_empty());
        assert_eq!(again.view.work.projects, vec!["fe", "be"]);

        // 검증 실패(미등록 프로젝트) → 에러, projects 불변
        assert!(matches!(
            attach_project(&works, &projects, "카트", "nope", None),
            Err(Error::Validation(_))
        ));
        assert_eq!(get_work(&works, "카트").unwrap().work.projects, vec!["fe", "be"]);
        drop(tmp);
    }

    /// 빈손으로 시작한 work가 코드를 건드릴 때가 되어서야 저장소 관례에 맞는 이름을
    /// 고른다. draft → active 경로가 여기서 처음 끝까지 뚫린다.
    #[test]
    fn attach_fixes_the_branch_of_a_project_less_work() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "Late Branch", &[], None).unwrap();
        assert_eq!(get_work(&works, "late-branch").unwrap().work.branch, None);

        // 미정 + 명시 → 그 값으로 확정·저장되고 워크트리가 생긴다
        let report = attach_project(&works, &projects, "late-branch", "fe", Some("feat/late")).unwrap();
        assert!(report.errors.is_empty(), "{report:?}");
        assert_eq!(report.view.work.branch.as_deref(), Some("feat/late"));
        assert_eq!(get_work(&works, "late-branch").unwrap().work.branch.as_deref(), Some("feat/late"));
        let tree = works.join("late-branch/trees/fe");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "feat/late");

        // 이미 정해진 뒤에 다른 이름은 거부된다 — 한 work는 브랜치 하나를 공유한다
        assert!(matches!(
            attach_project(&works, &projects, "late-branch", "be", Some("feat/other")),
            Err(Error::Validation(_))
        ));
        let after = get_work(&works, "late-branch").unwrap();
        assert_eq!(after.work.branch.as_deref(), Some("feat/late"));
        assert_eq!(after.work.projects, vec!["fe"], "a refused attach must change nothing");
        assert!(!works.join("late-branch/trees/be").exists());

        // 같은 값을 넘기는 것은 기존 동작 그대로다
        let same = attach_project(&works, &projects, "late-branch", "be", Some("feat/late")).unwrap();
        assert!(same.errors.is_empty(), "{same:?}");
        assert_eq!(same.view.work.projects, vec!["fe", "be"]);
    }

    /// 미정 work에 이름을 생략하면 slug로 확정된다 (규칙표 마지막 행).
    #[test]
    fn attach_without_a_branch_name_falls_back_to_the_slug() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "Late Branch", &[], None).unwrap();
        let report = attach_project(&works, &projects, "late-branch", "fe", None).unwrap();
        assert_eq!(report.view.work.branch.as_deref(), Some("late-branch"));
    }

    /// 확정은 워크트리를 만들기 **전에** 저장한다. 생성이 실패해도 다음 시도가
    /// 같은 이름을 쓰게 하기 위해서다 (부분 실패 보고 계약과 같은 결).
    #[test]
    fn attach_saves_the_branch_before_it_tries_the_worktree() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "Late Branch", &[], None).unwrap();
        // 워크트리가 놓일 자리를 파일로 막아 git worktree add를 실패시킨다
        let tree = works.join("late-branch/trees/fe");
        std::fs::create_dir_all(tree.parent().unwrap()).unwrap();
        std::fs::write(&tree, "blocker").unwrap();

        let report =
            attach_project(&works, &projects, "late-branch", "fe", Some("feat/late")).unwrap();
        assert_eq!(report.errors.len(), 1, "the worktree must have failed: {report:?}");
        assert_eq!(
            get_work(&works, "late-branch").unwrap().work.branch.as_deref(),
            Some("feat/late"),
            "the fixed branch must survive a failed worktree"
        );

        // 원인을 치우고 이름 없이 재시도해도 slug가 아니라 확정된 이름을 쓴다
        std::fs::remove_file(&tree).unwrap();
        let retry = attach_project(&works, &projects, "late-branch", "fe", None).unwrap();
        assert!(retry.errors.is_empty(), "{retry:?}");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "feat/late");
    }

    /// 결정표에는 "워크트리를 만들 때만"이라는 조건이 없다. 자리가 이미 차 있으면
    /// 만들 것은 없지만 확정된 이름은 그래도 남아야 한다 — 안 남으면 프로젝트는
    /// 붙었는데 branch가 null인 work가 생긴다.
    #[test]
    fn attach_saves_the_branch_even_when_the_tree_is_already_there() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "Late Branch", &[], None).unwrap();
        // 자리를 미리 채워 둔다 — attach는 만들 워크트리가 없다고 판단한다
        std::fs::create_dir_all(works.join("late-branch/trees/fe")).unwrap();

        let report =
            attach_project(&works, &projects, "late-branch", "fe", Some("feat/late")).unwrap();
        assert!(report.errors.is_empty(), "{report:?}");
        assert_eq!(report.view.work.branch.as_deref(), Some("feat/late"));
        let stored = get_work(&works, "late-branch").unwrap().work;
        assert_eq!(
            stored.branch.as_deref(),
            Some("feat/late"),
            "the decision must be stored even with no worktree to create"
        );
        assert_eq!(stored.projects, ["fe"]);
    }

    /// 직교성 회귀 가드 — 진행 상태는 사람과 세션이 선언한다. 프로젝트가 붙었다고
    /// 저절로 active가 되지 않는다.
    #[test]
    fn attach_does_not_change_the_status() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "Draft Work", &[], None).unwrap();
        update_work_status(&works, "draft-work", WorkStatus::Draft).unwrap();

        let report =
            attach_project(&works, &projects, "draft-work", "fe", Some("feat/draft")).unwrap();
        assert_eq!(report.view.work.status, WorkStatus::Draft);
        assert_eq!(get_work(&works, "draft-work").unwrap().work.status, WorkStatus::Draft);
    }

    #[test]
    fn remove_refuses_dirty_trees_unless_forced() {
        let (tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
        std::fs::write(works.join("카트/trees/be/wip.txt"), "uncommitted").unwrap();

        let result = remove_work(&works, "카트", false);
        assert!(matches!(result, Err(Error::DirtyTrees(_))), "dirty tree must be refused");
        assert!(works.join("카트").exists(), "refused remove must not delete anything");

        remove_work(&works, "카트", true).unwrap();
        assert!(!works.join("카트").exists());
        // 브랜치는 유지된다 (복구 가능)
        assert!(git::branch_exists(&tmp.path().join("fe"), "feat/cart"));
        assert!(git::branch_exists(&tmp.path().join("be"), "feat/cart"));
        // 저장소에 워크트리 잔재가 남지 않는다
        let wt = run_git(&tmp.path().join("fe"), &["worktree", "list"]);
        assert!(!wt.contains("trees/fe"), "stale worktree entry: {wt}");
    }

    #[test]
    fn remove_clean_work_without_force() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), None).unwrap();
        remove_work(&works, "카트", false).unwrap();
        assert!(!works.join("카트").exists());
        assert!(list_works(&works).unwrap().is_empty());
        assert!(matches!(remove_work(&works, "카트", false), Err(Error::WorkNotFound(_))));
    }

    #[test]
    fn read_spec_file_reads_and_guards_traversal() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), None).unwrap();
        std::fs::create_dir_all(works.join("카트/spec/sub")).unwrap();
        std::fs::write(works.join("카트/spec/overview.md"), "# 개요\n").unwrap();
        std::fs::write(works.join("카트/spec/sub/arch.md"), "# 구조\n").unwrap();

        assert_eq!(read_spec_file(&works, "카트", "overview.md").unwrap(), "# 개요\n");
        assert_eq!(read_spec_file(&works, "카트", "sub/arch.md").unwrap(), "# 구조\n");
        assert!(matches!(
            read_spec_file(&works, "카트", "../work.json"),
            Err(Error::Validation(_))
        ));
        assert!(matches!(
            read_spec_file(&works, "카트", "/etc/hosts"),
            Err(Error::Validation(_))
        ));
        assert!(read_spec_file(&works, "카트", "없는파일.md").is_err());
        assert!(matches!(
            read_spec_file(&works, "없는작업", "overview.md"),
            Err(Error::WorkNotFound(_))
        ));
    }

    #[test]
    fn resume_adopts_leftover_branch_instead_of_dead_ending() {
        let (tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), Some("feat/cart")).unwrap();
        // 부분 실패 잔재 시뮬레이션: be에 브랜치만 만들어지고 워크트리는 없는 상태
        run_git(&tmp.path().join("be"), &["branch", "feat/cart"]);

        // 재실행이 "branch already exists"로 막히면 영구 dead-end — 기존 브랜치를 채택해야 한다
        let report =
            start_work(&works, &projects, "카트", &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
        assert!(report.errors.is_empty(), "resume must adopt the existing branch: {:?}", report.errors);
        let tree = works.join("카트/trees/be");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "feat/cart");

        // attach도 동일하게 기존 브랜치를 채택한다
        run_git(&tmp.path().join("fe"), &["worktree", "remove", "--force", works.join("카트/trees/fe").to_str().unwrap()]);
        run_git(&tmp.path().join("fe"), &["worktree", "prune"]);
        let report = attach_project(&works, &projects, "카트", "fe", None).unwrap();
        assert!(report.errors.is_empty(), "attach must adopt the existing branch: {:?}", report.errors);
    }

    #[test]
    fn view_reports_spec_dir_next_to_spec_files() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), None).unwrap();
        std::fs::write(works.join("카트/spec/overview.md"), "# 개요\n").unwrap();

        let view = get_work(&works, "카트").unwrap();
        // 위치는 추측이 아니라 응답에서 온다 (V5)
        assert_eq!(view.spec_dir, collapse_home(&works.join("카트/spec")));
        assert!(expand_home(&view.spec_dir).is_dir());
        // specFiles는 그 디렉터리 기준 상대 경로다
        assert_eq!(view.spec_files, vec!["overview.md"]);

        // wire 계약: camelCase specDir
        let json = serde_json::to_value(&view).unwrap();
        assert!(json["specDir"].is_string(), "specDir missing: {json}");

        // list_works도 같은 값을 준다
        let listed = list_works(&works).unwrap();
        assert_eq!(listed[0].spec_dir, view.spec_dir);
    }

    #[test]
    fn start_with_different_title_gets_unique_slug() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트 추가", &slugs(&["fe"]), None).unwrap();
        // slugify 결과가 같지만 제목이 다르면 별개 work
        let report =
            start_work(&works, &projects, "카트/추가", &slugs(&["be"]), Some("b2")).unwrap();
        assert_eq!(report.view.work.slug, "카트-추가-2");
    }
}
