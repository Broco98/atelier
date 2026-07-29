use std::path::{Path, PathBuf};

use crate::work::{parse_work, render_work, WorktreeView, Work, WorkStatus, WorkView};
use crate::{collapse_home, expand_home, git, slugify, Error, Result};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeError {
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
    pub errors: Vec<WorktreeError>,
}

/// `slug`를 주면 그것이 디렉터리명이자 브랜치 기본값이고, **재개 판정의 정본**이다.
/// 생략하면 지금까지처럼 제목에서 파생하고 제목으로 재개를 판정한다.
///
/// 제목은 바뀔 수 있으므로 멱등 키가 될 수 없다(`update_work_title` 참조). slug는
/// 불변이라 될 수 있다 — 그래서 slug를 아는 호출자는 제목이 어떻게 바뀌었든 재개된다.
pub fn start_work(
    works_root: &Path,
    projects_root: &Path,
    title: &str,
    slug: Option<&str>,
    project_slugs: &[String],
    branch: Option<&str>,
) -> Result<WorkReport> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Validation("title must not be empty".into()));
    }
    if project_slugs.is_empty() {
        return Err(Error::Validation("at least one project is required".into()));
    }
    // slug는 디렉터리명이 된다 — 경로 구분자가 통과하면 데이터 루트 밖에 폴더가 생긴다.
    let slug = slug.map(str::trim);
    if let Some(slug) = slug {
        if !crate::slug::is_safe_slug(slug) {
            return Err(Error::Validation(format!(
                "invalid slug '{slug}': it becomes a folder name, so it must not be empty, \
                 start with '.', or contain '/' or '\\'"
            )));
        }
    }
    std::fs::create_dir_all(works_root)?;

    // 재개 판정: slug가 있으면 slug가 정본, 없을 때만 제목으로 찾는다 (멱등)
    let existing_work = match slug {
        Some(slug) => match read_work(works_root, slug) {
            Ok(work) => Some(work),
            Err(Error::WorkNotFound(_)) => None,
            // 망가진 work.json을 "없음"으로 읽으면 그 위에 덮어쓴다 — 그대로 올린다
            Err(e) => return Err(e),
        },
        None => find_by_title(works_root, title)?,
    };
    let resuming = existing_work.is_some();
    let work = match existing_work {
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
            // slug를 명시했으면 그대로 쓴다 — 이미 있으면 위에서 재개했을 것이므로
            // 여기까지 온 이상 충돌이 아니다. 중복 회피 접미사는 파생 slug에만 붙인다.
            let slug = match slug {
                Some(slug) => slug.to_string(),
                None => unique_dir_slug(works_root, &slugify(title)),
            };
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
        match validate_for_worktree(projects_root, p, &work.branch, resuming) {
            Ok(repo_base) => repos.push(repo_base),
            Err(reason) => reasons.push(format!("{p}: {reason}")),
        }
    }
    if !reasons.is_empty() {
        return Err(Error::Validation(reasons.join("; ")));
    }

    std::fs::create_dir_all(spec_dir(&dir))?;
    std::fs::create_dir_all(dir.join("trees"))?;
    write_work(works_root, &work)?;

    // 검증을 통과한 뒤의 개별 실패는 성공분을 유지한 채 보고만 한다
    let mut errors = Vec::new();
    for (p, (repo, base)) in pending.iter().zip(repos) {
        let worktree = dir.join("trees").join(p.as_str());
        if let Err(message) = git::worktree_add(&repo, &worktree, &work.branch, &base) {
            errors.push(WorktreeError { project: p.to_string(), message });
        }
    }

    // 소유권상 work를 다시 읽지 않고 뷰만 파생
    let view = to_view(works_root, work);
    Ok(WorkReport { view, errors })
}

/// 검증 통과 시 (저장소 절대경로, baseBranch) 반환.
/// `allow_existing_branch`: 기존 work의 재개/attach는 부분 실패로 브랜치만 남은
/// 상태를 이어가야 하므로 브랜치 충돌을 허용한다 (worktree_add가 채택).
fn validate_for_worktree(
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
    let worktrees = work
        .projects
        .iter()
        .map(|p| {
            let worktree = dir.join("trees").join(p);
            let exists = worktree.is_dir();
            WorktreeView {
                project: p.clone(),
                path: collapse_home(&worktree),
                exists,
                dirty: exists && git::is_dirty(&worktree),
            }
        })
        .collect();
    WorkView {
        spec_dir: collapse_home(&spec_dir(&dir)),
        spec_files: spec_files(&dir),
        work,
        worktrees,
    }
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

/// 표시 이름만 바꾼다. **slug는 건드리지 않는다** — 디렉터리명이 slug의 원천이라
/// 바꾸면 git이 등록해 둔 워크트리 경로와 배포된 spec 참조가 전부 깨진다
/// (프로젝트의 `update_project`가 파일명을 건드리지 않는 것과 같은 규칙).
pub fn update_work_title(works_root: &Path, slug: &str, title: &str) -> Result<WorkView> {
    let mut work = read_work(works_root, slug)?;
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Validation("title must not be empty".into()));
    }
    work.title = title.to_string();
    write_work(works_root, &work)?;
    Ok(to_view(works_root, work))
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
) -> Result<WorkReport> {
    let mut work = read_work(works_root, slug)?;
    let dir = works_root.join(&work.slug);
    let worktree = dir.join("trees").join(project_slug);

    let mut errors = Vec::new();
    if !worktree.is_dir() {
        let (repo, base) = validate_for_worktree(projects_root, project_slug, &work.branch, true)
            .map_err(|reason| Error::Validation(format!("{project_slug}: {reason}")))?;
        std::fs::create_dir_all(dir.join("trees"))?;
        if let Err(message) = git::worktree_add(&repo, &worktree, &work.branch, &base) {
            errors.push(WorktreeError { project: project_slug.to_string(), message });
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
            return Err(Error::DirtyWorktrees(dirty.join(", ")));
        }
    }
    for worktree in &existing {
        git::worktree_remove(worktree, force).map_err(Error::Git)?;
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
        let report = start_work(&works, &projects, "카트 아이템 추가", None, &slugs(&["fe", "be"]), Some("feat/cart"))
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
            let worktree = dir.join("trees").join(proj);
            assert!(worktree.is_dir(), "worktree missing for {proj}");
            // 워크트리는 공유 브랜치명으로, 각 저장소의 baseBranch(main) 커밋에서 분기
            assert_eq!(run_git(&worktree, &["branch", "--show-current"]), "feat/cart");
            let base = run_git(&tmp.path().join(proj), &["rev-parse", "main"]);
            assert_eq!(run_git(&worktree, &["rev-parse", "HEAD"]), base);
            let t = &report.view.worktrees[i];
            assert_eq!(t.project, *proj);
            assert!(t.exists);
            assert!(!t.dirty);
        }
    }

    #[test]
    fn start_defaults_branch_to_slug() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &projects, "Cart Add", None, &slugs(&["fe"]), None).unwrap();
        assert_eq!(report.view.work.branch, "cart-add");
        let worktree = works.join("cart-add/trees/fe");
        assert_eq!(run_git(&worktree, &["branch", "--show-current"]), "cart-add");
    }

    #[test]
    fn start_validation_failure_creates_nothing() {
        let (tmp, works, projects) = setup();
        // be 저장소에 충돌 브랜치를 미리 만들어 사전검증이 실패하게 한다
        run_git(&tmp.path().join("be"), &["branch", "feat/cart"]);
        let result = start_work(&works, &projects, "카트", None, &slugs(&["fe", "be"]), Some("feat/cart"));
        assert!(matches!(result, Err(Error::Validation(_))), "expected validation error");
        // 아무것도 만들지 않는다 — fe 워크트리도, work 디렉터리도
        assert!(!works.join("카트").exists());
        assert!(!git::branch_exists(&tmp.path().join("fe"), "feat/cart"));
    }

    #[test]
    fn start_rejects_unknown_project() {
        let (_tmp, works, projects) = setup();
        let result = start_work(&works, &projects, "카트", None, &slugs(&["nope"]), None);
        assert!(matches!(result, Err(Error::Validation(_))));
        assert!(!works.join("카트").exists());
    }

    #[test]
    fn start_resumes_missing_worktrees_idempotently() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", None, &slugs(&["fe"]), Some("feat/cart")).unwrap();
        // 같은 제목으로 재실행 + 프로젝트 추가 → 새 slug가 아니라 기존 work에 이어서 생성
        let report =
            start_work(&works, &projects, "카트", None, &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
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
        start_work(&works, &projects, "첫 작업", None, &slugs(&["fe"]), Some("b1")).unwrap();
        start_work(&works, &projects, "둘째 작업", None, &slugs(&["be"]), Some("b2")).unwrap();

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
        assert!(first.worktrees[0].dirty);
        assert_eq!(first.spec_files, vec!["overview.md", "sub/arch.md"]);
        let second = get_work(&works, "둘째-작업").unwrap();
        assert!(!second.worktrees[0].dirty);
        assert!(second.spec_files.is_empty());

        assert!(matches!(get_work(&works, "없음"), Err(Error::WorkNotFound(_))));
        assert!(matches!(get_work(&works, "../탈출"), Err(Error::WorkNotFound(_))));
    }

    #[test]
    fn update_status_persists() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
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
    fn attach_adds_project_with_worktree_and_is_idempotent() {
        let (tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", None, &slugs(&["fe"]), Some("feat/cart")).unwrap();

        let report = attach_project(&works, &projects, "카트", "be").unwrap();
        assert!(report.errors.is_empty());
        assert_eq!(report.view.work.projects, vec!["fe", "be"]);
        let worktree = works.join("카트/trees/be");
        assert_eq!(run_git(&worktree, &["branch", "--show-current"]), "feat/cart");

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
    fn remove_refuses_dirty_worktrees_unless_forced() {
        let (tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", None, &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
        std::fs::write(works.join("카트/trees/be/wip.txt"), "uncommitted").unwrap();

        let result = remove_work(&works, "카트", false);
        assert!(matches!(result, Err(Error::DirtyWorktrees(_))), "dirty worktree must be refused");
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
        start_work(&works, &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
        remove_work(&works, "카트", false).unwrap();
        assert!(!works.join("카트").exists());
        assert!(list_works(&works).unwrap().is_empty());
        assert!(matches!(remove_work(&works, "카트", false), Err(Error::WorkNotFound(_))));
    }

    #[test]
    fn read_spec_file_reads_and_guards_traversal() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
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
        start_work(&works, &projects, "카트", None, &slugs(&["fe"]), Some("feat/cart")).unwrap();
        // 부분 실패 잔재 시뮬레이션: be에 브랜치만 만들어지고 워크트리는 없는 상태
        run_git(&tmp.path().join("be"), &["branch", "feat/cart"]);

        // 재실행이 "branch already exists"로 막히면 영구 dead-end — 기존 브랜치를 채택해야 한다
        let report =
            start_work(&works, &projects, "카트", None, &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
        assert!(report.errors.is_empty(), "resume must adopt the existing branch: {:?}", report.errors);
        let worktree = works.join("카트/trees/be");
        assert_eq!(run_git(&worktree, &["branch", "--show-current"]), "feat/cart");

        // attach도 동일하게 기존 브랜치를 채택한다
        run_git(&tmp.path().join("fe"), &["worktree", "remove", "--force", works.join("카트/trees/fe").to_str().unwrap()]);
        run_git(&tmp.path().join("fe"), &["worktree", "prune"]);
        let report = attach_project(&works, &projects, "카트", "fe").unwrap();
        assert!(report.errors.is_empty(), "attach must adopt the existing branch: {:?}", report.errors);
    }

    #[test]
    fn view_reports_spec_dir_next_to_spec_files() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
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
        start_work(&works, &projects, "카트 추가", None, &slugs(&["fe"]), None).unwrap();
        // slugify 결과가 같지만 제목이 다르면 별개 work
        let report =
            start_work(&works, &projects, "카트/추가", None, &slugs(&["be"]), Some("b2")).unwrap();
        assert_eq!(report.view.work.slug, "카트-추가-2");
    }
}
