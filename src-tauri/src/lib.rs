mod commands;
mod watcher;

use std::sync::Arc;

use atelier_acp::{SessionManager, SessionPaths};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 데이터 루트의 생김새는 atelier-core만 안다. 여기서는 그것이 알려준 자리를 넘길 뿐이다.
    let sessions = Arc::new(SessionManager::new(SessionPaths {
        sessions: atelier_core::sessions_dir(),
        projects: atelier_core::projects_dir(),
        adapters_file: atelier_core::adapters_file(),
    }));
    let on_exit = Arc::clone(&sessions);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sessions)
        .setup(|app| {
            watcher::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::get_project,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::open_project_folder,
            commands::list_works,
            commands::get_work,
            commands::set_work_status,
            commands::read_spec_file,
            commands::list_sessions,
            commands::create_session,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            // 앱이 닫히면 에이전트도 함께 닫는다. 상태가 떨어지기를 기대하지 않는다 —
            // 프로세스가 그냥 끝나면 소멸자는 돌지 않는다.
            if matches!(event, tauri::RunEvent::Exit) {
                on_exit.close_all();
            }
        });
}
