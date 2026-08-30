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

/// 프레임에 포커스가 갔을 때 죽던 단축키들을 되살리는 항목의 id 접두사.
///
/// **뒤에 붙는 것은 그 키의 `KeyboardEvent.code`다** (`hotkey:KeyB` · `hotkey:Digit3`).
/// 그렇게 두면 프런트가 받은 문자열을 **그대로** 합성 keydown의 `code`에 넣을 수 있어,
/// 「메뉴 항목 ↔ 키」를 잇는 표가 어느 쪽에도 안 생긴다. 표가 생기면 키를 하나 옮길 때마다
/// 두 언어를 함께 고쳐야 한다.
const HOTKEY_PREFIX: &str = "hotkey:";

/// 되살리는 키들 — `(code, 메뉴에 적히는 이름, accelerator)`.
///
/// **⌘W는 여기 없다.** 창이 닫히면 이 앱은 창이 하나뿐이라 그대로 종료되고 돌던 셸이 전부
/// 죽는다(`build_menu` 주석의 그 사고). 실측으로는 커스텀 id 항목이 `performClose:`에 안 매여
/// 창이 살아 있었지만 **dev 빌드에서만 쟀고**, 얻는 것이 「칸 닫기」 하나인데 잃을 수 있는
/// 것이 셸 전부라 저울이 한쪽으로 명백히 기운다.
///
/// **⌃Tab·⌃⇧Tab·⇧⇧도 없다 — 넣어도 안 분다.** ⌃ 계열은 항목이 제대로 서는데도 accelerator
/// 경로가 죽고(실측 0/6 · 0/3), ⇧⇧는 「같은 수식키를 300ms 안에 두 번」이라는 몸짓이라
/// accelerator 문법에 실을 자리가 아예 없다. `Shift+Shift`는 파싱에 실패하는데 Tauri가 그
/// 오류를 조용히 버려(`menu/normal.rs`의 `parse().ok()`) **단축키 없는 항목이 선다** —
/// 빌드가 통과하는 것이 곧 등록된 것이 아니다.
///
/// 이름이 중립적인 것은 **메뉴가 화면을 모르기 때문이다.** ⌘1~9는 works에서 문서와 셸을
/// 가리키지만 다른 화면에는 없고, ⌘↩은 화면마다 접는 패널이 다르다. 그 표는 프런트에만 산다.
const HOTKEYS: &[(&str, &str, &str)] = &[
    ("KeyB", "Sidebar", "CmdOrCtrl+B"),
    ("Enter", "Expand Body", "CmdOrCtrl+Enter"),
    ("KeyT", "New Shell", "CmdOrCtrl+T"),
    ("Digit1", "Pane 1", "CmdOrCtrl+1"),
    ("Digit2", "Pane 2", "CmdOrCtrl+2"),
    ("Digit3", "Pane 3", "CmdOrCtrl+3"),
    ("Digit4", "Pane 4", "CmdOrCtrl+4"),
    ("Digit5", "Pane 5", "CmdOrCtrl+5"),
    ("Digit6", "Pane 6", "CmdOrCtrl+6"),
    ("Digit7", "Pane 7", "CmdOrCtrl+7"),
    ("Digit8", "Pane 8", "CmdOrCtrl+8"),
    ("Digit9", "Pane 9", "CmdOrCtrl+9"),
];

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

    // **이 메뉴가 서는 이유는 보이기 위해서가 아니다**(#153). spec 문서의 `<iframe>`에
    // 포커스가 들어가면 그 안에서 친 키가 부모 창을 못 넘어와 앱 단축키가 통째로 죽는데,
    // OS 메뉴는 그 경계를 모른다 — 위 `SETTINGS_MENU_ID` 주석이 「OS 메뉴가 웹뷰보다 먼저
    // 먹는다」고 적어 둔 그 성질을 여기서 한 번 더 유리하게 쓴다.
    //
    // **항목이 동작을 들지 않는다.** 아래 `on_menu_event`가 「그 키가 눌렸다」만 쏘고 판정은
    // 프런트에 남는다 — 같은 키가 화면마다 다른 것을 가리키므로(HOTKEYS 주석) 동작을 여기
    // 두면 그 표가 Rust로 새고, 화면이 하나 늘 때마다 두 언어를 고쳐야 한다.
    let mut view = SubmenuBuilder::new(handle, "View");
    for (i, (code, label, accel)) in HOTKEYS.iter().enumerate() {
        // 셋(⌘B·⌘↩·⌘T)과 칸 번호 사이에 금 하나 — 앞의 셋은 화면의 얼개를 만지고
        // 뒤의 아홉은 그 안에서 자리를 옮긴다.
        if i == 3 {
            view = view.separator();
        }
        let item = MenuItemBuilder::with_id(format!("{HOTKEY_PREFIX}{code}"), label)
            .accelerator(accel)
            .build(handle)?;
        view = view.item(&item);
    }
    let view = view.build()?;

    // `close_window()`가 **없다.** 위 주석이 그 자리의 전부다.
    let window = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .fullscreen()
        .build()?;

    MenuBuilder::new(handle).items(&[&app, &edit, &view, &window]).build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_menu)
        // 여기서 창을 직접 만지지 않고 **이벤트만 쏜다** — 어디로 갈지는 프런트의 라우터가
        // 안다(`/settings`). 배선은 `watcher.rs`가 `works:changed`를 쏘고 프런트가 `listen`으로
        // 받는 그 길과 같다(AppShell).
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == SETTINGS_MENU_ID {
                let _ = app.emit("settings:open", ());
            } else if let Some(code) = id.strip_prefix(HOTKEY_PREFIX) {
                // **키 이름 하나만 실어 보낸다**(#153). 이 키가 무엇을 가리키는지는 화면마다
                // 다르고 그 표는 프런트에만 있다 — 여기서 아는 것은 「이 code가 눌렸다」뿐이다.
                let _ = app.emit("hotkey:menu", code.to_string());
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(pty::PtyPool::default()))
        .setup(|app| {
            watcher::start(app.handle().clone());
            // 도는 명령을 1초마다 재서 **바뀐 셸만** 쏜다(adr-04). 배선은 바로 위 watcher와
            // 같은 길이다 — 스레드 하나가 emit하고 프런트가 `listen`으로 받는다.
            //
            // 풀을 여기서 건넨다. 스레드가 `state()`로 스스로 찾게 두면 그것이 등록되기
            // 전에 뜰 수 있는 코드가 되고, 그때 나는 것은 조용한 패닉 하나다 — 폴링이
            // 통째로 죽는데 앱은 멀쩡히 돈다.
            pty::watch_running(app.handle().clone(), Arc::clone(&app.state::<Arc<pty::PtyPool>>()));
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
            commands::set_work_pinned,
            commands::archive_work,
            commands::remove_work,
            commands::read_spec_file,
            commands::list_archive,
            commands::list_archived_docs,
            commands::read_archived_file,
            commands::search,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// **⌘W가 이 표에 있으면 안 된다** (#153).
    ///
    /// 있으면 OS 메뉴가 웹뷰보다 먼저 그 키를 먹는다. 커스텀 id 항목이라 `performClose:`에
    /// 안 매인다는 것이 실측이지만 **dev 빌드에서만 쟀고**, 틀리면 창이 닫히고 이 앱은 창이
    /// 하나뿐이라 그대로 종료되며 **돌던 셸이 전부 죽는다** — 실물에서 한 번 그렇게 잃었다.
    /// 얻는 것은 「칸 닫기」 하나다.
    ///
    /// 눈으로는 표를 늘리다 무심코 한 줄 더 적는 것을 못 막는다. 이 검사가 그 자리다.
    #[test]
    fn 표에_cmd_w가_없다() {
        for (code, label, accel) in HOTKEYS {
            assert_ne!(*code, "KeyW", "{label}이 ⌘W를 든다");
            assert!(!accel.ends_with("+W"), "{label}의 accelerator가 ⌘W다: {accel}");
        }
    }

    /// **accelerator와 code가 짝이 맞아야 한다.**
    ///
    /// 어긋나면 메뉴는 accelerator대로 키를 잡는데 프런트에는 code가 실려 가, 사람이 누른
    /// 키와 앱이 도는 동작이 **다른 키가 된다.** 두 문자열이 한 줄에 나란히 있어서 눈으로는
    /// 잘 맞아 보이는 종류의 어긋남이다.
    #[test]
    fn accelerator가_code와_짝이_맞는다() {
        for (code, label, accel) in HOTKEYS {
            let expected = if let Some(n) = code.strip_prefix("Digit") {
                format!("CmdOrCtrl+{n}")
            } else if let Some(c) = code.strip_prefix("Key") {
                format!("CmdOrCtrl+{c}")
            } else {
                // Enter처럼 이름이 곧 키인 것들.
                format!("CmdOrCtrl+{code}")
            };
            assert_eq!(*accel, expected, "{label}의 code와 accelerator가 어긋난다");
        }
    }

    /// id가 겹치면 뒤 항목의 클릭이 앞 항목으로 간다 — 메뉴는 그것을 오류로 말하지 않는다.
    #[test]
    fn id가_겹치지_않는다() {
        let mut ids: Vec<&str> = HOTKEYS.iter().map(|(code, _, _)| *code).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "HOTKEYS에 같은 code가 두 번 있다");
    }

    /// 살리기로 한 넷이 다 있는가 — 표가 조용히 줄어드는 것을 막는다.
    ///
    /// **⌃Tab·⌃⇧Tab·⇧⇧는 여기 없다.** 넣어도 안 분다(실측 0/6 · 0/3 · 0/4) — ⌃ 계열은
    /// 항목이 서는데도 accelerator 경로가 죽고, ⇧⇧는 「같은 수식키를 300ms 안에 두 번」이라는
    /// 몸짓이라 accelerator 문법에 자리가 없다. 그 셋은 카드가 계속 안내한다.
    #[test]
    fn 살리기로_한_키가_다_있다() {
        let codes: Vec<&str> = HOTKEYS.iter().map(|(code, _, _)| *code).collect();
        for want in ["KeyB", "KeyT", "Enter"] {
            assert!(codes.contains(&want), "{want}가 표에 없다");
        }
        for n in 1..=9 {
            let want = format!("Digit{n}");
            assert!(codes.contains(&want.as_str()), "{want}가 표에 없다");
        }
    }
}
