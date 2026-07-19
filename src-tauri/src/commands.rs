use std::path::PathBuf;

use atelier_core::{projects_dir, works_dir, ProjectPatch, ProjectView, WorkView};

type CmdResult<T> = Result<T, String>;

fn err(e: atelier_core::Error) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn list_projects() -> CmdResult<Vec<ProjectView>> {
    atelier_core::list_projects(&projects_dir()).map_err(err)
}

#[tauri::command]
pub async fn get_project(slug: String) -> CmdResult<ProjectView> {
    atelier_core::get_project(&projects_dir(), &slug).map_err(err)
}

#[tauri::command]
pub async fn create_project(folder: String) -> CmdResult<ProjectView> {
    atelier_core::create_project(&projects_dir(), &PathBuf::from(folder)).map_err(err)
}

#[tauri::command]
pub async fn update_project(
    slug: String,
    name: Option<String>,
    description: Option<String>,
    base_branch: Option<String>,
) -> CmdResult<ProjectView> {
    atelier_core::update_project(
        &projects_dir(),
        &slug,
        ProjectPatch { name, description, base_branch },
    )
    .map_err(err)
}

#[tauri::command]
pub async fn delete_project(slug: String) -> CmdResult<()> {
    atelier_core::delete_project(&projects_dir(), &slug).map_err(err)
}

#[tauri::command]
pub async fn list_works() -> CmdResult<Vec<WorkView>> {
    atelier_core::list_works(&works_dir()).map_err(err)
}

#[tauri::command]
pub async fn get_work(slug: String) -> CmdResult<WorkView> {
    atelier_core::get_work(&works_dir(), &slug).map_err(err)
}

#[tauri::command]
pub async fn set_work_status(slug: String, status: String) -> CmdResult<WorkView> {
    let status = status.parse().map_err(err)?;
    atelier_core::update_work_status(&works_dir(), &slug, status).map_err(err)
}

#[tauri::command]
pub async fn read_spec_file(slug: String, path: String) -> CmdResult<String> {
    atelier_core::read_spec_file(&works_dir(), &slug, &path).map_err(err)
}

#[tauri::command]
pub async fn open_project_folder(app: tauri::AppHandle, slug: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let view = atelier_core::get_project(&projects_dir(), &slug).map_err(err)?;
    if view.missing {
        return Err("폴더가 존재하지 않습니다".to_string());
    }
    let abs = atelier_core::expand_home(&view.project.path);
    app.opener()
        .open_path(abs.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
