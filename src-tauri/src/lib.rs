mod commands;
mod pty;
mod watcher;

use std::sync::Arc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(pty::PtyPool::default()))
        .setup(|app| {
            watcher::start(app.handle().clone());
            Ok(())
        })
        // 웹뷰가 다시 뜨면 옛 페이지가 쥐고 있던 채널이 죽는다 — 그 순간 셸을 거두지 않으면
        // Rust 쪽 자식만 살아남아 고아가 된다(결정 18). `pnpm tauri dev`의 Vite full reload와
        // ⌘R이 매번 그 경로다. SPA 라우트 이동은 navigation commit이 아니라서 안 걸리고,
        // 결정 20의 「화면을 옮기는 것만으로는 안 죽는다」가 바로 그 성질에 기대고 있다.
        // 첫 로드에도 오지만 그때 레지스트리는 비어 있어 즉시 돌아온다.
        //
        // **스레드에 넘기지 않는다.** 회수는 SIGHUP과 SIGKILL 사이에 유예를 두는데, 그 사이
        // 앱이 닫히면 스레드가 함께 사라져 **SIGKILL을 아무도 못 보낸다.** 회수를 시작한
        // 쪽이 레지스트리를 이미 비웠으므로 아래 종료 훅도 그것을 대신 끝내 주지 못한다.
        // 리로드 직후 창을 닫는 짧은 창에서 정확히 그렇게 고아가 남는다.
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                pty::reap_all(&webview.state::<Arc<pty::PtyPool>>());
            }
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
            commands::set_work_title,
            commands::set_work_status,
            commands::archive_work,
            commands::remove_work,
            commands::read_spec_file,
            commands::list_archive,
            commands::list_archived_docs,
            commands::read_archived_file,
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 앱이 닫히면 셸도 함께 닫는다. 상태가 떨어지기를 기대하지 않는다 — 프로세스가
            // 그냥 끝나면 소멸자는 돌지 않는다. **여기서는 반드시 동기로** 거둔다: 스레드에
            // 넘기면 프로세스가 끝나며 그 스레드도 함께 사라져 아무도 신호를 못 보낸다.
            if matches!(event, tauri::RunEvent::Exit) {
                pty::reap_all(&app.state::<Arc<pty::PtyPool>>());
            }
        });
}
