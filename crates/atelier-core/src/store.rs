use std::path::Path;

use crate::project::{parse_project, render_project, Project, ProjectView};
use crate::{collapse_home, expand_home, git, slugify, Error, Result};

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
pub fn read_projects(root: &Path) -> Result<Vec<Project>> {
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

pub fn get_project(root: &Path, slug: &str) -> Result<ProjectView> {
    Ok(to_view(read_project(root, slug)?))
}

pub fn create_project(root: &Path, folder: &Path) -> Result<ProjectView> {
    let folder = folder
        .canonicalize()
        .map_err(|_| Error::FolderMissing(folder.display().to_string()))?;
    if !folder.is_dir() {
        return Err(Error::FolderMissing(folder.display().to_string()));
    }
    std::fs::create_dir_all(root)?;

    // 멱등: 같은 폴더가 이미 등록돼 있으면 기존 프로젝트 반환
    for view in list_projects(root)? {
        if expand_home(&view.project.path) == folder {
            return Ok(view);
        }
    }

    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());
    let slug = unique_slug(root, &slugify(&name));
    let base_branch = git::origin_head(&folder)
        .or_else(|| git::detect(&folder).and_then(|g| g.current_branch))
        .unwrap_or_else(|| "main".to_string());

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

fn read_project(root: &Path, slug: &str) -> Result<Project> {
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

    fn setup() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("projects");
        let folder = tmp.path().join("my-app");
        std::fs::create_dir_all(&folder).unwrap();
        (tmp, root, folder)
    }

    #[test]
    fn create_then_list_and_get() {
        let (_tmp, root, folder) = setup();
        let created = create_project(&root, &folder).unwrap();
        assert_eq!(created.project.slug, "my-app");
        assert_eq!(created.project.name, "my-app");
        assert_eq!(created.project.base_branch, "main"); // git 없는 폴더 → 폴백
        assert!(!created.missing);
        assert!(created.git.is_none());

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
        std::fs::create_dir_all(other.join("my-app")).unwrap();
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
