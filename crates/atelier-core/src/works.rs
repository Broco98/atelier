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
pub struct StartReport {
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
) -> Result<StartReport> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Validation("title must not be empty".into()));
    }
    if project_slugs.is_empty() {
        return Err(Error::Validation("at least one project is required".into()));
    }
    std::fs::create_dir_all(works_root)?;

    // 같은 제목의 work가 있으면 이어서 생성(멱등), 없으면 새로 만든다
    let work = match find_by_title(works_root, title)? {
        Some(existing) => {
            if let Some(b) = branch {
                if b != existing.branch {
                    return Err(Error::Validation(format!(
                        "work '{}' already uses branch '{}'",
                        existing.slug, existing.branch
                    )));
                }
            }
            let mut work = existing;
            for p in project_slugs {
                if !work.projects.contains(p) {
                    work.projects.push(p.clone());
                }
            }
            work
        }
        None => {
            let slug = unique_dir_slug(works_root, &slugify(title));
            let branch = branch.unwrap_or(&slug).to_string();
            Work {
                slug,
                title: title.to_string(),
                status: WorkStatus::Active,
                branch,
                created_at: chrono::Local::now().format("%Y-%m-%d").to_string(),
                projects: project_slugs.to_vec(),
                extra: Default::default(),
            }
        }
    };

    // 사전검증: 워크트리가 없는 프로젝트 전부를 먼저 검사하고, 하나라도 실패면 아무것도 만들지 않는다
    let dir = works_root.join(&work.slug);
    let pending: Vec<&String> =
        work.projects.iter().filter(|p| !dir.join("trees").join(p.as_str()).is_dir()).collect();
    let mut reasons = Vec::new();
    let mut repos = Vec::new();
    for p in &pending {
        match validate_for_tree(projects_root, p, &work.branch) {
            Ok(repo_base) => repos.push(repo_base),
            Err(reason) => reasons.push(format!("{p}: {reason}")),
        }
    }
    if !reasons.is_empty() {
        return Err(Error::Validation(reasons.join("; ")));
    }

    std::fs::create_dir_all(dir.join("spec"))?;
    std::fs::create_dir_all(dir.join("trees"))?;
    write_work(works_root, &work)?;

    // 검증을 통과한 뒤의 개별 실패는 성공분을 유지한 채 보고만 한다
    let mut errors = Vec::new();
    for (p, (repo, base)) in pending.iter().zip(repos) {
        let tree = dir.join("trees").join(p.as_str());
        if let Err(message) = git::worktree_add(&repo, &tree, &work.branch, &base) {
            errors.push(TreeError { project: p.to_string(), message });
        }
    }

    // 소유권상 work를 다시 읽지 않고 뷰만 파생
    let view = to_view(works_root, work);
    Ok(StartReport { view, errors })
}

/// 검증 통과 시 (저장소 절대경로, baseBranch) 반환
fn validate_for_tree(
    projects_root: &Path,
    project_slug: &str,
    branch: &str,
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
    if git::branch_exists(&repo, branch) {
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

/// slug가 경로 요소를 포함하면 데이터 루트 밖으로 탈출할 수 있으므로 차단한다.
fn work_dir(works_root: &Path, slug: &str) -> Result<PathBuf> {
    let valid = !slug.is_empty()
        && !slug.starts_with('.')
        && !slug.contains('/')
        && !slug.contains('\\');
    if !valid {
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
    WorkView { spec_files: spec_files(&dir), work, trees }
}

/// spec/ 아래 파일들의 상대 경로 (정렬, dotfile 제외)
fn spec_files(work_dir: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect_files(&work_dir.join("spec"), "", &mut files);
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

pub fn attach_project(
    works_root: &Path,
    projects_root: &Path,
    slug: &str,
    project_slug: &str,
) -> Result<StartReport> {
    let mut work = read_work(works_root, slug)?;
    let dir = works_root.join(&work.slug);
    let tree = dir.join("trees").join(project_slug);

    let mut errors = Vec::new();
    if !tree.is_dir() {
        let (repo, base) = validate_for_tree(projects_root, project_slug, &work.branch)
            .map_err(|reason| Error::Validation(format!("{project_slug}: {reason}")))?;
        std::fs::create_dir_all(dir.join("trees"))?;
        if let Err(message) = git::worktree_add(&repo, &tree, &work.branch, &base) {
            errors.push(TreeError { project: project_slug.to_string(), message });
        }
    }
    if !work.projects.iter().any(|p| p == project_slug) {
        work.projects.push(project_slug.to_string());
        write_work(works_root, &work)?;
    }
    Ok(StartReport { view: to_view(works_root, work), errors })
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
    Ok(std::fs::read_to_string(dir.join("spec").join(rel))?)
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
        assert_eq!(w.branch, "feat/cart");
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
        assert_eq!(report.view.work.branch, "cart-add");
        let tree = works.join("cart-add/trees/fe");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "cart-add");
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

    #[test]
    fn attach_adds_project_with_tree_and_is_idempotent() {
        let (tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", &slugs(&["fe"]), Some("feat/cart")).unwrap();

        let report = attach_project(&works, &projects, "카트", "be").unwrap();
        assert!(report.errors.is_empty());
        assert_eq!(report.view.work.projects, vec!["fe", "be"]);
        let tree = works.join("카트/trees/be");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "feat/cart");

        // 이미 붙은 프로젝트 재attach → 멱등
        let again = attach_project(&works, &projects, "카트", "be").unwrap();
        assert!(again.errors.is_empty());
        assert_eq!(again.view.work.projects, vec!["fe", "be"]);

        // 검증 실패(미등록 프로젝트) → 에러, projects 불변
        assert!(matches!(
            attach_project(&works, &projects, "카트", "nope"),
            Err(Error::Validation(_))
        ));
        assert_eq!(get_work(&works, "카트").unwrap().work.projects, vec!["fe", "be"]);
        drop(tmp);
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
    fn start_with_different_title_gets_unique_slug() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트 추가", &slugs(&["fe"]), None).unwrap();
        // slugify 결과가 같지만 제목이 다르면 별개 work
        let report =
            start_work(&works, &projects, "카트/추가", &slugs(&["be"]), Some("b2")).unwrap();
        assert_eq!(report.view.work.slug, "카트-추가-2");
    }
}
