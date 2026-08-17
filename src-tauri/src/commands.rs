use std::path::PathBuf;
use std::sync::Arc;

use atelier_acp::{SessionManager, SessionView};
use atelier_core::{
    archive_dir, projects_dir, works_dir, ArchiveEntry, ProjectPatch, ProjectView, StartPoint,
    WorkView,
};

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

/// 표시 이름만 바꾼다. slug와 워크트리 경로는 그대로다 (update_project와 같은 규칙).
#[tauri::command]
pub async fn set_work_title(slug: String, title: String) -> CmdResult<WorkView> {
    atelier_core::update_work_title(&works_dir(), &slug, &title).map_err(err)
}

#[tauri::command]
pub async fn set_work_status(slug: String, status: String) -> CmdResult<WorkView> {
    let status = status.parse().map_err(err)?;
    atelier_core::update_work_status(&works_dir(), &slug, status).map_err(err)
}

/// 아카이브 보존소로 **옮긴다.** 워크트리는 정리되고 브랜치·spec·기록은 남는다.
/// 되돌리기가 없으므로 force도 없다 — 커밋 안 된 변경이 있으면 어느 파일인지 말하며 거부한다.
#[tauri::command]
pub async fn archive_work(slug: String) -> CmdResult<()> {
    atelier_core::archive_work(&works_dir(), &archive_dir(), &projects_dir(), &slug)
        .map(|_| ())
        .map_err(err)
}

/// 통째로 지운다. MCP 도구와 같이 force를 노출하지 않는다 (atelier_remove_work와 같은 계약).
#[tauri::command]
pub async fn remove_work(slug: String) -> CmdResult<()> {
    atelier_core::remove_work(&works_dir(), &slug, false).map_err(err)
}

#[tauri::command]
pub async fn read_spec_file(slug: String, path: String) -> CmdResult<String> {
    atelier_core::read_spec_file(&works_dir(), &slug, &path).map_err(err)
}

/// 아카이브 목록. **경량이다** — spec 파일 목록도 워크트리도 담지 않는다.
/// 아카이브는 쌓이기만 하므로 목록 조회가 무거워지면 갈수록 나빠진다.
#[tauri::command]
pub async fn list_archive() -> CmdResult<Vec<ArchiveEntry>> {
    atelier_core::list_archive(&archive_dir()).map_err(err)
}

/// 아카이브된 work가 가진 문서 경로들. 상세 화면의 머리말(제목·상태·언제 치웠는지)은
/// 목록이 이미 들고 있으므로 단건 조회를 따로 두지 않는다.
#[tauri::command]
pub async fn list_archived_docs(slug: String) -> CmdResult<Vec<String>> {
    atelier_core::list_archived_docs(&archive_dir(), &slug).map_err(err)
}

/// 아카이브된 work의 문서 하나. 경로는 **work 루트 기준**이다 (`record.md`, `spec/overview.md`) —
/// 기록이 spec 밖에 있어서, 화면이 둘을 한 트리로 보여주려면 창구가 하나여야 한다.
#[tauri::command]
pub async fn read_archived_file(slug: String, path: String) -> CmdResult<String> {
    atelier_core::read_work_file(&archive_dir(), &slug, &path).map_err(err)
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
pub async fn resume_session(
    manager: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> CmdResult<SessionView> {
    let manager = Arc::clone(&manager);
    // `create_session`과 같은 이유로 블로킹 실행기에서 기다린다 — 다시 띄우는 것도 패키지
    // 실행기를 거치므로 오래 걸릴 수 있다.
    tauri::async_runtime::spawn_blocking(move || manager.resume(&session_id).map_err(err))
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
