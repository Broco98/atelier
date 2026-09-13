mod commands;
mod hooks;
/// **밖으로 열린 유일한 모듈이다.** 최상위 터미널이 어느 세계에서 뜨는지는 살아 있는 셸
/// 없이는 못 재고, 그 검사는 `ATELIER_HOME`을 세워야 해서 단위 테스트 프로세스에 둘 수
/// 없다(같은 프로세스의 다른 테스트 루트까지 함께 옮긴다). 그래서 통합 테스트
/// (`tests/top_terminal.rs`)가 자기 프로세스에서 이 모듈을 부른다.
pub mod pty;
mod quit;
mod settings;
mod shells;
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
/// **⌃Tab·⌃⇧Tab은 없다.** 항목이 제대로 서는데도(AX로 `mods=12 vk=48`을 확인했다)
/// **accelerator 경로만 죽는다** — 실제로 던져서 0/6 · 0/3이었다.
///
/// **⇧⇧는 여기 실을 수 없었고, 그래서 키를 바꿨다**(결정 1·2). 「같은 수식키를 300ms 안에
/// 두 번」은 몸짓이라 accelerator 문법에 실을 자리가 없고, `Shift+Shift`는 파싱에 실패한다.
/// 그런데 Tauri가 그 오류를 조용히 버려(`menu/normal.rs`의 `parse().ok()`) **단축키 없는
/// 항목이 선다** — 빌드가 통과하는 것이 곧 등록된 것이 아니다. 그 사실이 이 표의 성질을
/// 하나 못 박는다: **여기 실을 수 있느냐가 여는 키를 고르는 조건**이었고, ⌘K는 실린다.
///
/// **`Search`가 맨 앞이다**(결정 3). 화면을 안 타고 어디서나 여는 유일한 항목이라 목록 첫
/// 줄에 서는 것이 읽힌다 — 나머지는 전부 「지금 이 화면의」 무엇이다. 그 자리를 검사가
/// 못 박는다(`검색이_표의_맨_앞이다`): 메뉴를 세우는 함수가 tauri 핸들을 요구해 단위 검사가
/// 안 태우므로, 다음 사람이 표를 알파벳순으로 정리하면 조용히 밀린다.
const HOTKEYS: &[(&str, &str)] = &[
    ("KeyK", "Search"),
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
        // **빨간 버튼은 창을 닫지 않고 묻는다**(결정 14 · #223). 창이 하나라 닫기 = 종료이고,
        // 그 한 번에 돌던 셸이 전부 죽는다. 막고 이벤트만 쏜다 — 묻는 것은 프런트의 확인 창이다
        // (`quit-request.ts`). 「확인됨」이 서 있으면 막지 않는다 — #224의 `terminate:` 훅과 같은
        // 규칙 한 벌이다. `quit_app`의 `app.exit`는 지금 이 자리를 안 지난다(`quit.rs`의 `confirm`).
        //
        // ⌘Q·메뉴 Quit·Dock 종료는 여기로 안 온다 — tao가 `ExitRequested` 없이 바로 끝낸다(tauri#9198).
        // 그 길은 #224가 델리게이트 훅으로 같은 이벤트를 쏘게 붙인다.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !quit::confirmed() {
                    api.prevent_close();
                    let _ = window.app_handle().emit(quit::REQUESTED_EVENT, ());
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 셸이 부르는 것을 **앱 밖에서도** 알리는 채널(#206 · 결정 10). 판정은 프런트의 순수
        // 함수 하나가 하고(`shell-notify.ts`) 여기는 그 답이 나갈 길을 열어 둘 뿐이다.
        .plugin(tauri_plugin_notification::init())
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

            // 셸이 **스스로 말하는** 길(#201). 위 둘이 앱이 물어서 아는 값이라면 이쪽은
            // 에이전트의 훅이 파일 한 장을 놓고 가는 길이고, 여기가 그 길의 세 자리다.
            let root = atelier_core::data_root();
            // (1) 지난 실행이 남긴 상태 파일을 걷는다. PTY 번호는 실행마다 0부터 다시
            // 나므로 안 걷으면 지난 실행의 `…-0.json`이 이번 첫 셸에 붙어 **뜨자마자
            // 사람을 부르는 셸**이 생긴다. 접두사는 반드시 셸 ID를 짓는 그 함수에서 온다 —
            // 여기서 시각을 다시 재면 두 값이 갈려 살아 있는 셸의 파일을 지운다.
            shells::sweep(&root, pty::instance_prefix());
            // (2) 훅 스크립트를 홈에 세운다. **설치 버튼(다음 티켓)이 아니라 여기서** 쓰는
            // 이유는 두 가지다 — 사람이 손으로 훅을 걸어 보려면 걸 것이 이미 있어야 하고,
            // 앱을 고쳐도 사용자 홈의 스크립트가 낡은 채 남아 있으면 안 된다. 스크립트는
            // 아무 설정에도 안 걸려 있으면 그냥 안 불리는 파일이라 세워 두는 것이 무해하다.
            if let Err(e) = shells::write_hook_script(&root) {
                eprintln!("atelier: {e}");
            }
            // (3) 상태 폴더를 본다. 배선은 위 둘과 같은 길이다 — 스레드 하나가 emit하고
            // 프런트가 `listen`으로 받는다. **접두사를 함께 넘긴다**: 읽는 쪽이 그것을
            // 안 보면 이번 실행의 것만 싣는다는 보장이 (1)의 파괴적 청소에만 걸려 있게 되고,
            // 앱이 둘 뜬 동안에는 남의 인스턴스가 놓고 간 파일이 그대로 실려 나간다.
            shells::watch(app.handle().clone(), shells::shells_dir(&root), pty::instance_prefix());
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
            commands::move_work,
            commands::archive_work,
            commands::remove_work,
            commands::read_spec_file,
            commands::list_archive,
            commands::list_archived_docs,
            commands::read_archived_file,
            commands::search,
            commands::touch_recent_work,
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_command_running,
            commands::read_settings,
            commands::write_settings,
            commands::agent_hooks,
            commands::install_agent_hooks,
            commands::uninstall_agent_hooks,
            commands::quit_app,
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
        assert_eq!(accelerator_of("KeyK"), "CmdOrCtrl+K");
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

    /// **셸 신호의 세 자리가 앱이 뜰 때 다 서는가.** 셋 다 헤드리스로는 못 돌린다 —
    /// `run()`은 창과 웹뷰가 있어야 하고, 여기 없으면 나는 일은 조용한 무음이다: 훅을 깔
    /// 스크립트가 홈에 없고(사람이 「설치했는데 아무 일도 안 난다」를 만난다), 지난 실행의
    /// 상태 파일이 남아 뜨자마자 사람을 부르는 셸이 생기고, 감시가 없어 셸이 무슨 말을 해도
    /// 화면이 조용하다. 그래서 **자리로** 잰다(`pty.rs`의 순서 검사와 같은 방식).
    #[test]
    fn the_shell_signal_is_wired_when_the_app_comes_up() {
        let setup = setup_source();

        assert!(
            setup.contains("shells::write_hook_script(&root)"),
            "훅 스크립트를 안 쓴다 — 사용자가 걸 것이 홈에 없다"
        );
        assert!(
            setup.contains("shells::sweep(&root, pty::instance_prefix())"),
            "지난 실행의 상태 파일을 안 걷는다 — 뜨자마자 사람을 부르는 셸이 생긴다"
        );
        assert!(
            setup.contains(
                "shells::watch(app.handle().clone(), shells::shells_dir(&root), pty::instance_prefix())"
            ),
            "상태 폴더를 안 보거나 접두사 없이 본다 — 셸이 말해도 화면까지 안 오거나, 남의 인스턴스 것까지 온다"
        );
    }

    // 「정리가 접두사를 따로 재지 않는다」를 `!setup_source().contains("SystemTime")`으로 재던
    // 검사가 여기 있었다. **걷었다.** 위 검사가 호출 문자열을 통째로 못박으므로 그것이 잡는
    // 변형은 전부 위가 먼저 잡고, 반대로 그것만 통과하는 변형은 널려 있었다 — `"atelier"` 같은
    // 고정 접두사도, `chrono`로 잰 값도 `SystemTime`이라는 토큰을 안 쓴다. 두 접두사가 갈리는
    // 것은 이제 `shells.rs`의 `a_sweep_keeps_the_file_a_live_shell_is_named_with`가 **값으로**
    // 잰다 — 진짜 셸 ID로 이름 지은 파일이 진짜 접두사의 쓸기에서 살아남는가.

    /// `setup` 클로저의 본문. 소스 스캔이 **테스트 모듈까지 흘러가면 제 문자열을 읽고 스스로
    /// 통과하므로**(pty.rs의 `body_of`가 같은 자리를 막는다) 자르는 자리를 한 곳에 둔다.
    fn setup_source() -> &'static str {
        let src = include_str!("lib.rs");
        let body = src
            .split_once(".setup(|app| {")
            .expect("여는 표식이 있다")
            .1
            .split_once("\n        })")
            .expect("닫는 표식이 있다")
            .0;
        assert!(
            !body.contains("mod tests"),
            "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다"
        );
        body
    }

    /// **알림 채널이 앱에 걸려 있는가**(#206 · 결정 10). 이것도 헤드리스로는 못 돌린다 —
    /// 플러그인이 빠지면 나는 일은 조용한 무음이다: 프런트가 `sendNotification`을 불러도
    /// 웹뷰에 폴리필이 안 깔려 브라우저의 `Notification`이 받고, 권한 없는 그 객체는
    /// **아무 소리도 안 내고 오류도 안 낸다.** 그래서 자리로 잰다(위 검사와 같은 방식).
    #[test]
    fn 알림_채널이_빌더에_걸려_있다() {
        assert!(
            builder_source().contains(".plugin(tauri_plugin_notification::init())"),
            "알림 플러그인이 안 걸려 있다 — 프런트가 울려도 아무 소리가 안 난다"
        );
    }

    /// **권한이 안 열려 있으면 그 호출은 거절당한다.** capabilities는 사람이 손으로 적는
    /// JSON이라 오타 하나로 조용히 빠지고, 그 실패는 앱을 띄워야만 보인다.
    ///
    /// **파싱해서 본다 — 글자 찾기가 아니다.** 파일이 깨지거나 `permissions`가 배열이
    /// 아니게 되면 여기서 터진다(fail-closed). 문자열로 훑으면 주석이나 다른 구획에 같은
    /// 글자가 있어도 통과한다.
    #[test]
    fn 알림과_배지의_권한이_열려_있다() {
        let src = include_str!("../capabilities/default.json");
        let cap: serde_json::Value = serde_json::from_str(src).expect("capabilities가 JSON이다");
        let perms: Vec<&str> = cap["permissions"]
            .as_array()
            .expect("permissions가 배열이다")
            .iter()
            .map(|one| one.as_str().expect("권한 하나는 문자열이다"))
            .collect();
        for want in ["notification:default", "core:window:allow-set-badge-count"] {
            assert!(perms.contains(&want), "{want}가 capabilities에 없다 — {perms:?}");
        }
    }

    /// 빌더에 무엇이 걸렸는지를 볼 소스. 자르는 이유는 `setup_source`와 같다 — 테스트
    /// 모듈까지 흘러가면 스캔이 **제 문자열을 읽고 스스로 통과한다.**
    fn builder_source() -> &'static str {
        let src = include_str!("lib.rs");
        let body = src
            .split_once("tauri::Builder::default()")
            .expect("여는 표식이 있다")
            .1
            .split_once("#[cfg(test)]")
            .expect("닫는 표식이 있다")
            .0;
        assert!(
            !body.contains("mod tests"),
            "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다"
        );
        body
    }

    /// **빨간 버튼이 창을 닫지 않고 묻게 걸려 있는가**(결정 14 · #223). `run()`은 창이
    /// 있어야 돌아 헤드리스로 못 태운다 — 빠지면 나는 일은 조용한 옛 동작이다: 빨간 버튼 한 번에
    /// 앱이 꺼지고 돌던 셸이 전부 죽는다. 그래서 위 검사들처럼 **자리로** 잰다.
    ///
    /// 막는 조건이 「확인됨」인 것도 함께 본다 — #224의 `terminate:` 훅과 같은 규칙을 쓰게. 이 조건이
    /// 지금 풀어 주는 길은 없다: tauri-runtime-wry 2.11의 `app.exit`는 `CloseRequested`를 안 지난다.
    #[test]
    fn 빨간_버튼이_창을_막고_종료_요청을_쏜다() {
        let builder = builder_source();
        assert!(
            builder.contains("tauri::WindowEvent::CloseRequested { api, .. }"),
            "창 닫기 요청을 안 받는다 — 빨간 버튼이 묻지 않고 끈다"
        );
        assert!(
            builder.contains("if !quit::confirmed() {"),
            "창 닫기를 「확인됨」으로 가르지 않는다"
        );
        assert!(builder.contains("api.prevent_close();"), "창 닫기를 안 막는다");
        assert!(
            builder.contains(".emit(quit::REQUESTED_EVENT, ())"),
            "종료 요청 이벤트를 안 쏜다 — 창은 막혔는데 아무도 안 묻는다(앱을 끌 길이 없다)"
        );
    }

    /// 살리기로 한 것이 다 있는가 — 표가 조용히 줄어드는 것을 막는다.
    /// 무엇이 왜 빠졌는지는 `HOTKEYS` 독이 든다.
    #[test]
    fn 살리기로_한_키가_다_있다() {
        let codes: Vec<&str> = HOTKEYS.iter().map(|(code, _)| *code).collect();
        for want in ["KeyK", "KeyB", "KeyT", "Enter"] {
            assert!(codes.contains(&want), "{want}가 표에 없다");
        }
        for n in 1..=9 {
            let want = format!("Digit{n}");
            assert!(codes.contains(&want.as_str()), "{want}가 표에 없다");
        }
    }

    /// 결정 3. **`Search`가 View 메뉴 맨 위다.** 다른 항목이 전부 「지금 이 화면의」 무엇인데
    /// 이것만 화면을 안 타고 어디서나 열어서, 목록 첫 줄에 서는 것이 읽힌다.
    ///
    /// **자리를 세는 검사가 여기 필요한 이유가 있다.** 메뉴를 실제로 세우는 `build_menu`는
    /// tauri 핸들을 요구해 단위 검사가 못 태우므로, 표의 순서가 곧 화면의 순서인데 그 순서를
    /// 아무도 안 본다 — 다음 사람이 표를 알파벳순으로 정리하면 조용히 밀린다.
    /// 위 「다 있다」는 자리를 안 보므로 이것을 대신하지 못한다.
    #[test]
    fn 검색이_표의_맨_앞이다() {
        assert_eq!(HOTKEYS[0], ("KeyK", "Search"));
    }

    /// **구분선이 한 자리에만 그어진다.** `build_menu`는 「첫 `Digit*` 항목 앞」에서 한 번만
    /// 금을 긋는데(자리를 안 세고 갈래로 가른다), 그 규칙이 뜻대로 되려면 번호 항목들이
    /// **표 뒤쪽에 몰려 있어야** 한다. 섞이면 금이 엉뚱한 자리에 서고 뒤에 오는 번호들이
    /// 얼개 항목들과 한 무리로 읽힌다 — 눈으로만 보이는 어긋남이라 아무도 안 잡는다.
    ///
    /// ⌘K를 맨 앞에 끼운 것이 금을 안 움직인다는 것도 이 성질이 말한다.
    #[test]
    fn 번호_항목이_표_뒤쪽에_몰려_있다() {
        let first_digit =
            HOTKEYS.iter().position(|(code, _)| code.starts_with("Digit")).expect("번호 항목이 없다");
        assert!(
            HOTKEYS[first_digit..].iter().all(|(code, _)| code.starts_with("Digit")),
            "번호 항목 사이에 다른 항목이 끼었다 — 구분선이 엉뚱한 자리에 선다"
        );
    }
}
