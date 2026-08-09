use std::path::PathBuf;
use std::sync::Arc;

use atelier_acp::{SessionManager, SessionView};
use atelier_core::{projects_dir, works_dir, ProjectPatch, ProjectView, StartPoint, WorkView};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
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
pub async fn list_sessions(
    manager: tauri::State<'_, Arc<SessionManager>>,
) -> CmdResult<Vec<SessionView>> {
    manager.list().map_err(err)
}

#[tauri::command]
pub async fn create_session(
    manager: tauri::State<'_, Arc<SessionManager>>,
    project_slug: String,
) -> CmdResult<SessionView> {
    let manager = Arc::clone(&manager);
    // 에이전트를 띄우고 핸드셰이크가 끝나기를 기다리는 동안 막힌다. `npx`가 패키지를 내려받는
    // 첫 실행은 오래 걸리므로 비동기 일꾼이 아니라 블로킹 전용 실행기에서 기다린다.
    tauri::async_runtime::spawn_blocking(move || {
        manager
            .start(StartPoint::Project { slug: project_slug })
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn prompt_session(
    manager: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    text: String,
) -> CmdResult<()> {
    let manager = Arc::clone(&manager);
    // 턴이 끝날 때까지 막힌다. 그동안의 조각들은 `session:update` 이벤트로 먼저 간다.
    tauri::async_runtime::spawn_blocking(move || manager.prompt(&session_id, &text).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn cancel_session(
    manager: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> CmdResult<()> {
    // 중단은 기다리는 일이 아니다 — 알림 한 줄을 보내고 곧바로 돌아온다. 턴이 실제로 끝나는
    // 것은 `prompt_session`을 붙잡고 있는 쪽이 돌아오는 것으로 보인다.
    manager.cancel(&session_id).map_err(err)
}

#[tauri::command]
pub async fn answer_permission(
    manager: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    request_id: String,
    option_id: String,
) -> CmdResult<()> {
    // 답을 돌려주는 것은 기다리는 일이 아니다 — 상대에게 한 줄 보내고 곧바로 돌아온다.
    manager
        .answer_permission(&session_id, &request_id, &option_id)
        .map_err(err)
}

#[tauri::command]
pub async fn read_session_updates(
    manager: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> CmdResult<Vec<serde_json::Value>> {
    manager.updates(&session_id).map_err(err)
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
