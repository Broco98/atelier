mod commands;
mod pty;
mod settings;
mod watcher;

use std::sync::Arc;

use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// `atelier ▸ Settings…`(⌘,)의 id — 메뉴를 세우는 곳과 그 클릭을 받는 곳 둘이 이 문자열로만
/// 이어져 있다.
///
/// **이 항목이 셸에 포커스가 있어도 듣는 유일한 길이다**(결정 51). 아래 주석이 말하는
/// 「OS 메뉴가 웹뷰보다 먼저 먹는다」를 이번에는 유리하게 쓴다 — 그 성질 때문에 웹뷰의
/// keydown으로는 ⌘,를 잡을 수 없고, 터미널을 쓰다 「글꼴이 작네」 하고 여는 흐름이 정확히
/// 그 상황이다.
const SETTINGS_MENU_ID: &str = "settings";

/// macOS 기본 메뉴에서 **`Close Window`(⌘W)만 뺀 것.**
///
/// 그 항목이 있으면 ⌘W를 **OS 메뉴가 웹뷰보다 먼저 먹는다.** 프런트에서
/// `preventDefault`를 해도 소용이 없다 — 키가 페이지까지 오지 않는다. 창이 닫히고, 이 앱은
/// 창이 하나뿐이라 그대로 종료되며 **돌던 셸이 전부 죽는다**(실물에서 그렇게 잃었다).
///
/// 비워 두면 그 키가 웹뷰까지 와서 터미널이 「이 칸 닫기」로 쓴다(`shellHotkey`). 두 자리가
/// 함께여야 성립하므로 한쪽만 되돌리면 조용히 옛 동작으로 간다.
///
/// 나머지는 기본 메뉴와 같은 것을 손으로 세운다 — 메뉴를 통째로 지우면 **⌘C·⌘V·⌘A가
/// 함께 죽는다.** 창을 닫는 길은 신호등의 빨간 버튼과 ⌘Q로 남는다.
fn build_menu<R: tauri::Runtime>(handle: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    // ⌘,는 macOS가 「환경설정」으로 약속해 둔 키다 — 우리가 고른 값이 아니라 그 관습이다.
    // 자리도 관습을 따라 About 바로 아래다.
    let settings = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;

    let app = SubmenuBuilder::new(handle, "atelier")
        .about(Some(AboutMetadata::default()))
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // `close_window()`가 **없다.** 위 주석이 그 자리의 전부다.
    let window = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .fullscreen()
        .build()?;

    MenuBuilder::new(handle).items(&[&app, &edit, &window]).build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_menu)
        // 여기서 창을 직접 만지지 않고 **이벤트만 쏜다** — 어디로 갈지는 프런트의 라우터가
        // 안다(`/settings`). 배선은 `watcher.rs`가 `works:changed`를 쏘고 프런트가 `listen`으로
        // 받는 그 길과 같다(AppShell).
        .on_menu_event(|app, event| {
            if event.id() == SETTINGS_MENU_ID {
                let _ = app.emit("settings:open", ());
            }
        })
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
            commands::pty_command_running,
            commands::read_settings,
            commands::write_settings,
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
