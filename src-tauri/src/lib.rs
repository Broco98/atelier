mod commands;
mod watcher;

use std::sync::Arc;

use atelier_acp::{SessionManager, SessionPaths};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 데이터 루트의 생김새는 atelier-core만 안다. 여기서는 그것이 알려준 자리를 넘길 뿐이다.
            let to_screen = app.handle().clone();
            app.manage(Arc::new(SessionManager::new(
                SessionPaths {
                    sessions: atelier_core::sessions_dir(),
                    projects: atelier_core::projects_dir(),
                    adapters_file: atelier_core::adapters_file(),
                },
                // 조각 하나가 화면으로 간다. 파일에 쌓이는 줄과 **같은 값**이라 재생과
                // 라이브가 화면에서 같은 렌더러를 탄다.
                Arc::new(move |session_id: &str, index: usize, line: &serde_json::Value| {
                    let _ = to_screen.emit(
                        "session:update",
                        serde_json::json!({"sessionId": session_id, "index": index, "line": line}),
                    );
                }),
            )));
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
            commands::prompt_session,
            commands::answer_permission,
            commands::read_session_updates,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 앱이 닫히면 에이전트도 함께 닫는다. 상태가 떨어지기를 기대하지 않는다 —
            // 프로세스가 그냥 끝나면 소멸자는 돌지 않는다.
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<Arc<SessionManager>>().close_all();
            }
        });
}
