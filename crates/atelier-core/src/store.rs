use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::project::{parse_project, render_project, Project, ProjectView};
use crate::{collapse_home, expand_home, git, slugify, Error, GitInfo, Result};

pub struct ProjectPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub base_branch: Option<String>,
}

/// 프로젝트 목록의 **순서와 걷는 법**. 무거운 것은 안 단다 — 폴더마다 git을 캐묻는 것은
/// `to_view`이고(`git::detect`), **글자마다 부르는 자리는 그것을 탈 수 없다.** 검색의 프로젝트
/// 층이 이것을 부른다(결정 23): 순서를 거기서 다시 적으면 팔레트가 Projects 화면과 어긋난다.
///
/// **폴더가 없으면 빈 목록이다 — 만들지 않는다**(`read_works`와 같은 규칙).
pub(crate) fn read_projects(root: &Path) -> Result<Vec<Project>> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut projects = Vec::new();
    for entry in entries {
        let entry = entry?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') || !file_name.ends_with(".md") {
            continue;
        }
        let slug = file_name.trim_end_matches(".md").to_string();
        let content = std::fs::read_to_string(entry.path())?;
        // AI가 망가뜨린 파일 하나가 전체 목록을 막지 않도록 파싱 실패는 건너뜀
        if let Ok(project) = parse_project(&slug, &content) {
            projects.push(project);
        }
    }
    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(projects)
}

pub fn list_projects(root: &Path) -> Result<Vec<ProjectView>> {
    std::fs::create_dir_all(root)?;
    Ok(read_projects(root)?.into_iter().map(to_view).collect())
}

/// 등록된 Project마다 (slug, 폴더) — 폴더는 `~`를 푼 경로다. **git을 묻지 않는다** — Thread 엔진의 판정이 받은 편집마다 「이 경로가
/// 등록된 Project 안인가」를 본다(v1 티켓 22). 데이터 루트를 받는다. 못 읽으면 빈 목록이다.
pub fn project_folders(data_root: &Path) -> Vec<(String, PathBuf)> {
    read_projects(&crate::paths::projects_in(data_root))
        .unwrap_or_default()
        .into_iter()
        .map(|project| (project.slug, expand_home(&project.path)))
        .collect()
}

pub fn get_project(root: &Path, slug: &str) -> Result<ProjectView> {
    Ok(to_view(read_project(root, slug)?))
}

/// 고른 폴더가 무엇인가 — 갈래 하나다(03 구현 스펙 §15 「폴더 살피기」). Project 추가 창이 폴더를 고르는 순간 묻고, 그 갈래로 글과
/// 단추를 바꾼다(§16) — 추가를 누르기 전에, worktree를 만들 때가 아니라 지금 안다(스토리 105 · 107).
///
/// `path`는 모두 화면에 서는 꼴이다 — 심볼릭 링크를 푼 자리를 `~`로 줄였다(Project 파일의 `path`와 같은 꼴). 그 값을 그대로 추가에
/// 넘겨도 된다(`add_project`가 `~`를 푼다).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FolderLook {
    /// git 저장소의 뿌리 — 추가하면 기준 브랜치가 `base_branch`다(`origin/HEAD` → 지금 브랜치 → `main`). 원격은 이름들(`remotes`)과
    /// `origin`의 owner/repo(`git.remote_slug`)다.
    Repo { path: String, base_branch: String, remotes: Vec<String>, git: GitInfo },
    /// git 저장소 안의 하위 폴더 — 뿌리(`root`)로 바꿀지 사람이 고른다. 그대로 추가하면 이 폴더가 Project가 되고, 기준 브랜치는 그
    /// 저장소의 것(`base_branch`)이다(스토리 109 · 110).
    Subfolder { path: String, root: String, base_branch: String },
    /// git 저장소가 아니다 — 「git init 하고 추가」로만 추가된다(스토리 107 · 108).
    NotGit { path: String },
    /// 이미 등록된 폴더 — 그 Project다. 추가 대신 「열기」가 선다(스토리 111). 다른 갈래보다 먼저 본다: git을 보기 전 판에서 등록된
    /// git 아닌 폴더도 이 갈래다.
    Registered { path: String, project: ProjectView },
    /// 폴더가 없다 — 지웠거나 옮겼거나, 폴더가 아닌 파일이다. `path`는 받은 경로 그대로다(풀 링크가 없다).
    Missing { path: String },
}

/// 폴더 살피기(`FolderLook`). 경로는 `~`로 시작해도 된다. 실패하지 않는다 — 읽지 못한 폴더는 「폴더가 없음」이다.
pub fn inspect_folder(root: &Path, folder: &Path) -> FolderLook {
    let asked = expand(folder);
    let Some(folder) = asked.canonicalize().ok().filter(|folder| folder.is_dir()) else {
        return FolderLook::Missing { path: collapse_home(&asked) };
    };
    if let Some(project) = registered(root, &folder) {
        return FolderLook::Registered { path: collapse_home(&folder), project: to_view(project) };
    }
    let (Some(top), Some(git)) = (git::toplevel(&folder).and_then(|top| top.canonicalize().ok()), git::detect(&folder)) else {
        return FolderLook::NotGit { path: collapse_home(&folder) };
    };
    if top != folder {
        return FolderLook::Subfolder {
            path: collapse_home(&folder),
            root: collapse_home(&top),
            base_branch: default_base(&folder, Some(&git)),
        };
    }
    FolderLook::Repo {
        path: collapse_home(&folder),
        base_branch: default_base(&folder, Some(&git)),
        remotes: git::remotes(&folder),
        git,
    }
}

/// 「git init 하고 추가」 — git이 아닌 폴더를 빈 저장소로 세운다(`git::init_main`). 실패하면 이번에 세운 `.git`을 걷고 git의 글로
/// 실패한다 — 반쯤 세운 저장소(커밋 없는 `main`)가 남으면 그 폴더는 다음에 「저장소」로 보이지만 Work의 브랜치가 갈라질 커밋이 없다.
///
/// `.git`이 이미 있는데 git이 저장소로 읽지 못하는 폴더(깨진 저장소)는 세우지 않는다 — 다시 세우면 사람의 저장소를 고친다.
fn init_git(folder: &Path) -> Result<GitInfo> {
    let dot_git = folder.join(".git");
    if dot_git.symlink_metadata().is_ok() {
        return Err(Error::Git(format!("{} has a .git that git cannot read", collapse_home(folder))));
    }
    if let Err(said) = git::init_main(folder) {
        let _ = std::fs::remove_dir_all(&dot_git);
        return Err(Error::Git(said));
    }
    git::detect(folder).ok_or_else(|| Error::Git(format!("could not read {} as a git repository", collapse_home(folder))))
}

/// 그 폴더(심볼릭 링크를 푼 자리)를 이미 등록한 Project. 못 읽는 등록부는 빈 것으로 본다.
fn registered(root: &Path, folder: &Path) -> Option<Project> {
    read_projects(root).unwrap_or_default().into_iter().find(|project| expand_home(&project.path) == folder)
}

/// 받은 경로의 `~`를 푼다 — 화면 · 바깥 MCP가 주는 경로는 `~`로 줄인 꼴일 수 있다(`FolderLook`의 `path`).
fn expand(path: &Path) -> PathBuf {
    expand_home(&path.to_string_lossy())
}

/// 등록할 때의 기준 브랜치 — `origin/HEAD`가 가리키는 것, 없으면 지금 브랜치, 그것도 없으면 `main`이다.
fn default_base(folder: &Path, git: Option<&GitInfo>) -> String {
    git::origin_head(folder)
        .or_else(|| git.and_then(|g| g.current_branch.clone()))
        .unwrap_or_else(|| "main".to_string())
}

/// 추가할 때 사람이 고른 것(03 구현 스펙 §15 「추가」). 기본값은 「이름은 폴더 이름 · git 저장소만」이다.
#[derive(Debug, Clone, Default)]
pub struct AddProject {
    /// 「Project 이름」 칸 — 비었거나 없으면 폴더 이름이다. 이름만 정한다: slug(파일 이름)는 늘 폴더 이름에서 짓는다.
    pub name: Option<String>,
    /// 「git init 하고 추가」 — git 저장소가 아닌 폴더는 이것이 참일 때만 받는다. 그때 `git init -b main`과 빈 첫 커밋(「init」)을
    /// 하고 기준 브랜치 `main`으로 등록한다. 이미 저장소면 아무것도 하지 않는다.
    pub init_git: bool,
}

/// 있는 git 저장소를 이름 없이 등록한다 — `add_project`의 기본 갈래(`AddProject::default()`).
pub fn create_project(root: &Path, folder: &Path) -> Result<ProjectView> {
    add_project(root, folder, AddProject::default())
}

/// Project 추가(03 구현 스펙 §15). 화면의 추가 창 · 바깥 MCP `atelier_add_project` · Host가 이 하나를 부른다.
///
/// - **git 저장소가 아닌 폴더는 「git init 할까」가 참일 때만 받는다** — 아니면 `NotGitRepo`다. 등록한 뒤 Work를 만들 때에야 실패하지
///   않게 지금 거절한다.
/// - 저장소의 하위 폴더는 그대로 받는다 — 사람이 「그대로 추가」를 골랐다(뿌리로 바꾸는 것은 추가 창이 묻는다).
/// - 이미 등록된 폴더는 그 Project를 그대로 돌려준다(멱등) — 이름 · 설명을 덮지 않는다.
/// - 경로는 `~`로 시작해도 된다. 심볼릭 링크를 푼 자리를 `~`로 줄여 적는다.
pub fn add_project(root: &Path, folder: &Path, add: AddProject) -> Result<ProjectView> {
    let asked = expand(folder);
    let folder = asked
        .canonicalize()
        .ok()
        .filter(|folder| folder.is_dir())
        .ok_or_else(|| Error::FolderMissing(collapse_home(&asked)))?;
    std::fs::create_dir_all(root)?;

    if let Some(project) = registered(root, &folder) {
        return Ok(to_view(project));
    }
    let git = match git::detect(&folder) {
        Some(git) => git,
        None if add.init_git => init_git(&folder)?,
        None => return Err(Error::NotGitRepo(collapse_home(&folder))),
    };

    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());
    let slug = unique_slug(root, &slugify(&name));
    let name = add.name.map(|name| name.trim().to_string()).filter(|name| !name.is_empty()).unwrap_or(name);
    let base_branch = default_base(&folder, Some(&git));

    let project = Project {
        slug,
        name,
        path: collapse_home(&folder),
        base_branch,
        created_at: chrono::Local::now().format("%Y-%m-%d").to_string(),
        description: String::new(),
        extra: Default::default(),
    };
    write_project(root, &project)?;
    Ok(to_view(project))
}

/// 새로 만들 자리 — 추가 창의 「새로 만들기」가 이름을 칠 때마다 묻는다(03 구현 스펙 §16 · 스토리 112 · 114). 경로는 모두 화면에 서는
/// 꼴(`~`로 줄인 것)이다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectPlace {
    /// 부모 폴더 — 「위치 바꾸기」로 고른 것을 화면의 꼴로 다시 적는다.
    pub parent: String,
    /// 만들 폴더(`<부모>/<폴더 이름>`). 이름이 비었으면 없다.
    pub path: Option<String>,
    /// 그 자리에 무엇이 이미 있다 — 그러면 「새로 만들기」는 만들지 않는다(`new_project`의 `AlreadyExists`).
    pub taken: bool,
}

/// 새로 만들 자리(`NewProjectPlace`). 폴더 이름을 짓는 규칙은 `new_project`와 하나다.
pub fn new_project_place(parent: &Path, name: &str) -> NewProjectPlace {
    let parent = expand(parent);
    let folder = (!name.trim().is_empty()).then(|| parent.join(slugify(name)));
    NewProjectPlace {
        parent: collapse_home(&parent),
        taken: folder.as_ref().is_some_and(|folder| folder.symlink_metadata().is_ok()),
        path: folder.as_deref().map(collapse_home),
    }
}

/// 새로 만들기(03 구현 스펙 §15) — `<부모>/<폴더>`를 만들고 `git init -b main` · 빈 첫 커밋(「init」)을 한 뒤 등록한다(기준 브랜치
/// `main`). 폴더 이름은 이름에서 짓는다(`slugify` — 「Landing Page」는 `landing-page`). 부모는 `~`로 시작해도 되고, 없으면 만든다.
///
/// - 그 자리에 무엇이 있으면(폴더든 파일이든) 만들지 않고 `AlreadyExists`다 — 있는 폴더를 덮지 않는다. 추가 창은 그때 「그 폴더를
///   추가할까요?」로 간다.
/// - git이 실패하면(사람의 git 이름 · 이메일이 없으면 첫 커밋이 실패한다) **이번에 만든 폴더를 모두 지우고** git의 글로 실패한다 — 빈
///   폴더가 남지 않는다. 없던 부모를 함께 만들었으면 그것도 지운다.
pub fn new_project(root: &Path, parent: &Path, name: &str) -> Result<ProjectView> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::EmptyName);
    }
    let folder = expand(parent).join(slugify(name));
    if folder.symlink_metadata().is_ok() {
        return Err(Error::AlreadyExists(collapse_home(&folder)));
    }
    // 이번에 새로 서는 가장 위 폴더 — 실패하면 여기부터 걷는다.
    let made = folder.ancestors().take_while(|one| one.symlink_metadata().is_err()).last().unwrap_or(&folder).to_path_buf();
    std::fs::create_dir_all(&folder)?;
    if let Err(said) = git::init_main(&folder) {
        let _ = std::fs::remove_dir_all(&made);
        return Err(Error::Git(said));
    }
    add_project(root, &folder, AddProject { name: Some(name.to_string()), init_git: false })
}

pub fn update_project(root: &Path, slug: &str, patch: ProjectPatch) -> Result<ProjectView> {
    let mut project = read_project(root, slug)?;
    if let Some(name) = patch.name {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::EmptyName);
        }
        project.name = name.to_string();
    }
    if let Some(description) = patch.description {
        project.description = description;
    }
    if let Some(base_branch) = patch.base_branch {
        project.base_branch = base_branch;
    }
    write_project(root, &project)?;
    Ok(to_view(project))
}

pub fn delete_project(root: &Path, slug: &str) -> Result<()> {
    let path = project_path(root, slug)?;
    if !path.exists() {
        return Err(Error::NotFound(slug.to_string()));
    }
    std::fs::remove_file(path)?;
    Ok(())
}

/// Project 파일 하나. `get_project`와 달리 git을 캐묻지 않는다 — Agent 범위(`agents::scope`)가 폴더 자리만 읽는다.
pub(crate) fn read_project(root: &Path, slug: &str) -> Result<Project> {
    let path = project_path(root, slug)?;
    let content =
        std::fs::read_to_string(&path).map_err(|_| Error::NotFound(slug.to_string()))?;
    parse_project(slug, &content)
}

fn project_path(root: &Path, slug: &str) -> Result<std::path::PathBuf> {
    if !crate::slug::is_safe_slug(slug) {
        return Err(Error::NotFound(slug.to_string()));
    }
    Ok(root.join(format!("{slug}.md")))
}

/// 같은 디렉토리 tmp 파일 → rename 원자적 쓰기 (스펙 §3)
fn write_project(root: &Path, project: &Project) -> Result<()> {
    let final_path = root.join(format!("{}.md", project.slug));
    let tmp_path = root.join(format!(".{}.md.tmp", project.slug));
    std::fs::write(&tmp_path, render_project(project))?;
    std::fs::rename(&tmp_path, &final_path)?;
    Ok(())
}

fn to_view(project: Project) -> ProjectView {
    let abs = expand_home(&project.path);
    let missing = !abs.is_dir();
    let git = if missing { None } else { git::detect(&abs) };
    ProjectView { project, git, missing }
}

fn unique_slug(root: &Path, base: &str) -> String {
    let mut slug = base.to_string();
    let mut n = 2;
    while root.join(format!("{slug}.md")).exists() {
        slug = format!("{base}-{n}");
        n += 1;
    }
    slug
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 커밋 없는 저장소(브랜치 `main`) — 추가는 git 저장소만 받는다(03 구현 스펙 §15). 살피기 · 추가의 갈래는 `tests/project_add.rs`가
    /// 잰다. 여기는 등록부 파일의 읽기 · 쓰기다.
    fn git_repo(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        let ok = std::process::Command::new("git").arg("-C").arg(dir).args(["init", "-q", "-b", "main"]).status().unwrap();
        assert!(ok.success(), "git init");
    }

    fn setup() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("projects");
        let folder = tmp.path().join("my-app");
        git_repo(&folder);
        (tmp, root, folder)
    }

    #[test]
    fn create_then_list_and_get() {
        let (_tmp, root, folder) = setup();
        let created = create_project(&root, &folder).unwrap();
        assert_eq!(created.project.slug, "my-app");
        assert_eq!(created.project.name, "my-app");
        assert_eq!(created.project.base_branch, "main"); // origin/HEAD가 없으면 지금 브랜치
        assert!(!created.missing);
        assert_eq!(created.git.and_then(|git| git.current_branch).as_deref(), Some("main"));

        let listed = list_projects(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(get_project(&root, "my-app").unwrap().project.slug, "my-app");
    }

    #[test]
    fn create_is_idempotent_for_same_path() {
        let (_tmp, root, folder) = setup();
        let a = create_project(&root, &folder).unwrap();
        let b = create_project(&root, &folder).unwrap();
        assert_eq!(a.project.slug, b.project.slug);
        assert_eq!(list_projects(&root).unwrap().len(), 1);
    }

    #[test]
    fn slug_collision_gets_suffix() {
        let (_tmp, root, folder) = setup();
        create_project(&root, &folder).unwrap();
        let other = folder.parent().unwrap().join("nested");
        git_repo(&other.join("my-app"));
        let b = create_project(&root, &other.join("my-app")).unwrap();
        assert_eq!(b.project.slug, "my-app-2");
    }

    #[test]
    fn update_patches_description_and_base_branch() {
        let (_tmp, root, folder) = setup();
        create_project(&root, &folder).unwrap();
        let updated = update_project(&root, "my-app", ProjectPatch {
            name: None,
            description: Some("설명".into()),
            base_branch: Some("develop".into()),
        }).unwrap();
        assert_eq!(updated.project.description, "설명");
        assert_eq!(updated.project.base_branch, "develop");
        // 디스크 반영 확인
        assert_eq!(get_project(&root, "my-app").unwrap().project.description, "설명");
    }

    #[test]
    fn update_patches_name_trimmed_and_keeps_slug() {
        let (_tmp, root, folder) = setup();
        create_project(&root, &folder).unwrap();
        let updated = update_project(&root, "my-app", ProjectPatch {
            name: Some("  결제 서비스  ".into()),
            description: None,
            base_branch: None,
        }).unwrap();
        assert_eq!(updated.project.name, "결제 서비스"); // trim 적용
        assert_eq!(updated.project.slug, "my-app"); // slug 불변
        // 디스크 반영 + 다른 필드 유지 확인
        let reread = get_project(&root, "my-app").unwrap();
        assert_eq!(reread.project.name, "결제 서비스");
        assert_eq!(reread.project.base_branch, "main");
    }

    #[test]
    fn update_rejects_blank_name() {
        let (_tmp, root, folder) = setup();
        create_project(&root, &folder).unwrap();
        let result = update_project(&root, "my-app", ProjectPatch {
            name: Some("   ".into()),
            description: None,
            base_branch: None,
        });
        assert!(matches!(result, Err(crate::Error::EmptyName)));
        // 실패 시 기존 이름 유지
        assert_eq!(get_project(&root, "my-app").unwrap().project.name, "my-app");
    }

    #[test]
    fn delete_removes_file_and_missing_slug_errors() {
        let (_tmp, root, folder) = setup();
        create_project(&root, &folder).unwrap();
        delete_project(&root, "my-app").unwrap();
        assert!(list_projects(&root).unwrap().is_empty());
        assert!(matches!(delete_project(&root, "my-app"), Err(crate::Error::NotFound(_))));
        assert!(matches!(get_project(&root, "nope"), Err(crate::Error::NotFound(_))));
    }

    #[test]
    fn missing_folder_is_flagged_and_invalid_file_skipped_in_list() {
        let (_tmp, root, folder) = setup();
        create_project(&root, &folder).unwrap();
        std::fs::remove_dir_all(&folder).unwrap();
        assert!(list_projects(&root).unwrap()[0].missing);
        // 깨진 파일은 목록에서 건너뜀
        std::fs::write(root.join("broken.md"), "not frontmatter").unwrap();
        assert_eq!(list_projects(&root).unwrap().len(), 1);
    }

    #[test]
    fn create_rejects_nonexistent_folder() {
        let (_tmp, root, _f) = setup();
        assert!(matches!(
            create_project(&root, std::path::Path::new("/no/such/dir")),
            Err(crate::Error::FolderMissing(_))
        ));
    }

    #[test]
    fn rejects_path_traversal_slugs() {
        let (_tmp, root, folder) = setup();
        create_project(&root, &folder).unwrap();
        let outside = root.parent().unwrap().join("victim.md");
        std::fs::write(&outside, "x").unwrap();
        assert!(matches!(delete_project(&root, "../victim"), Err(crate::Error::NotFound(_))));
        assert!(outside.exists(), "traversal must not delete outside the data root");
        assert!(matches!(get_project(&root, "../victim"), Err(crate::Error::NotFound(_))));
        assert!(matches!(get_project(&root, ".hidden"), Err(crate::Error::NotFound(_))));
    }

    #[test]
    fn write_leaves_no_tmp_files() {
        let (_tmp, root, folder) = setup();
        create_project(&root, &folder).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(&root).unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }
}
