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

/// 되살리는 키들 — `(code, 메뉴에 적히는 이름)`.
///
/// **accelerator는 안 적는다 — `accelerator_of`가 code에서 만든다.** 손으로 적으면 두
/// 문자열이 한 줄에 나란히 서서 눈으로는 잘 맞아 보이는데, 어긋나는 순간 사람이 누른 키와
/// 앱이 도는 동작이 **다른 키가 된다.**
///
/// 이름은 `CONTEXT.md`의 말이다. ⌘1~9가 옮기는 것은 **탭**이다 — 「work·터미널 화면 머리행의
/// 한 칸. `spec`과 셸들이 거기 선다」가 그 문서의 정의이고 ⌘1이 spec, ⌘2~9가 셸이라
/// 정확히 겹친다. **「열」이 아니다**: 열은 분할했을 때만 생기고 늘 둘이라 아홉이 될 수 없고,
/// 그 문서가 열을 「칸·패널·페인」으로 부르지 말라고 못 박고 있다.
///
/// **⌘W는 여기 없다.** 창이 닫히면 이 앱은 창이 하나뿐이라 그대로 종료되고 돌던 셸이 전부
/// 죽는다(`build_menu` 주석의 그 사고). 실측으로는 커스텀 id 항목이 `performClose:`에 안 매여
/// 창이 살아 있었지만 **dev 빌드에서만 쟀고**, 얻는 것이 「칸 닫기」 하나인데 잃을 수 있는
/// 것이 셸 전부라 저울이 한쪽으로 명백히 기운다.
///
/// **⌃Tab·⌃⇧Tab·⇧⇧도 없다 — 셋의 사정이 다르다.**
///  - ⌃Tab·⌃⇧Tab은 항목이 제대로 서는데도(AX로 `mods=12 vk=48`을 확인했다) **accelerator
///    경로만 죽는다** — 실제로 던져서 0/6 · 0/3이었다.
///  - ⇧⇧는 **등록 자체가 안 된다.** 「같은 수식키를 300ms 안에 두 번」이라는 몸짓이라
///    accelerator 문법에 실을 자리가 없고, `Shift+Shift`는 파싱에 실패한다. 그런데 Tauri가
///    그 오류를 조용히 버려(`menu/normal.rs`의 `parse().ok()`) **단축키 없는 항목이 선다** —
///    빌드가 통과하는 것이 곧 등록된 것이 아니다. 그러니 눌러도 안 불리는 것은 결과가 아니라
///    **당연한 귀결**이고, 프로브가 4번 던져 확인한 것은 그 귀결이지 별도의 사실이 아니다.
const HOTKEYS: &[(&str, &str)] = &[
    ("KeyB", "Sidebar"),
    ("Enter", "Panel"),
    ("KeyT", "New Shell"),
    ("Digit1", "Tab 1"),
    ("Digit2", "Tab 2"),
    ("Digit3", "Tab 3"),
    ("Digit4", "Tab 4"),
    ("Digit5", "Tab 5"),
    ("Digit6", "Tab 6"),
    ("Digit7", "Tab 7"),
    ("Digit8", "Tab 8"),
    ("Digit9", "Tab 9"),
];

/// `KeyboardEvent.code`에서 그 키의 accelerator를 만든다.
///
/// **프런트의 `keyOfCode`와 짝이지만 만드는 것이 다르다** — 그쪽은 `code`에서 `key`를,
/// 이쪽은 `code`에서 accelerator 문자열을 만든다. 같은 해체(`Digit*` · `Key*`)를 두 언어가
/// 각각 하는 것은 그 사이에 건널 다리가 없어서다: 메뉴를 세우는 것은 Rust이고 이벤트를
/// 만드는 것은 프런트다. **잇는 끈은 `code` 문자열 하나**이고, 그것이 `HOTKEY_PREFIX`가
/// id에 code를 그대로 싣는 이유다.
fn accelerator_of(code: &str) -> String {
    if let Some(n) = code.strip_prefix("Digit") {
        format!("CmdOrCtrl+{n}")
    } else if let Some(c) = code.strip_prefix("Key") {
        format!("CmdOrCtrl+{c}")
    } else {
        // Enter처럼 이름이 곧 키인 것들.
        format!("CmdOrCtrl+{code}")
    }
}

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
    let mut drew_line = false;
    for (code, label) in HOTKEYS {
        // 얼개를 만지는 것들(⌘B·⌘↩·⌘T)과 탭 번호 사이에 금 하나. **자리를 세지 않는다** —
        // 「번호가 처음 나오는 곳」이 곧 그 경계라, 항목을 끼워도 금이 따라 움직인다.
        if !drew_line && code.starts_with("Digit") {
            view = view.separator();
            drew_line = true;
        }
        let item = MenuItemBuilder::with_id(format!("{HOTKEY_PREFIX}{code}"), label)
            .accelerator(accelerator_of(code))
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

    /// **⌘W가 이 표에 있으면 안 된다** (#153). 근거는 `HOTKEYS` 독이 든다 — 여기가 막는 것은
    /// 표를 늘리다 무심코 한 줄 더 적는 것이고, 그 한 줄의 값이 **돌던 셸 전부**다.
    #[test]
    fn 표에_cmd_w가_없다() {
        for (code, label) in HOTKEYS {
            assert_ne!(*code, "KeyW", "{label}이 ⌘W를 든다");
        }
    }

    /// `accelerator_of`가 muda가 아는 문자열을 만드는가.
    ///
    /// **한때 이 자리에 「표의 셋째 칸이 code와 짝이 맞는가」가 있었다.** 그 검사의 본문이
    /// 곧 유도 함수였다 — 검사가 유도를 알고 있다면 그 유도는 코드에 있어야 한다. 셋째 칸을
    /// 걷고 `accelerator_of`를 세우면서 그 검사도 함께 사라졌고, 남은 것이 이것이다.
    #[test]
    fn accelerator를_code에서_만든다() {
        assert_eq!(accelerator_of("Digit1"), "CmdOrCtrl+1");
        assert_eq!(accelerator_of("Digit9"), "CmdOrCtrl+9");
        assert_eq!(accelerator_of("KeyB"), "CmdOrCtrl+B");
        assert_eq!(accelerator_of("KeyT"), "CmdOrCtrl+T");
        assert_eq!(accelerator_of("Enter"), "CmdOrCtrl+Enter");
    }

    /// id가 겹치면 뒤 항목의 클릭이 앞 항목으로 간다 — 메뉴는 그것을 오류로 말하지 않는다.
    #[test]
    fn id가_겹치지_않는다() {
        let mut ids: Vec<&str> = HOTKEYS.iter().map(|(code, _)| *code).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "HOTKEYS에 같은 code가 두 번 있다");
    }

    /// 살리기로 한 넷이 다 있는가 — 표가 조용히 줄어드는 것을 막는다.
    /// 무엇이 왜 빠졌는지는 `HOTKEYS` 독이 든다.
    #[test]
    fn 살리기로_한_키가_다_있다() {
        let codes: Vec<&str> = HOTKEYS.iter().map(|(code, _)| *code).collect();
        for want in ["KeyB", "KeyT", "Enter"] {
            assert!(codes.contains(&want), "{want}가 표에 없다");
        }
        for n in 1..=9 {
            let want = format!("Digit{n}");
            assert!(codes.contains(&want.as_str()), "{want}가 표에 없다");
        }
    }
}
