mod chat;
mod commands;
mod hooks;
mod processes;
/// **밖으로 열린 유일한 모듈이다.** 최상위 터미널이 어디서 뜨는지는 살아 있는 셸
/// 없이는 못 재고, 그 검사는 `ATELIER_HOME`을 세워야 해서 단위 테스트 프로세스에 둘 수
/// 없다(같은 프로세스의 다른 테스트 루트까지 함께 옮긴다). 그래서 통합 테스트
/// (`tests/top_terminal.rs`)가 자기 프로세스에서 이 모듈을 부른다.
pub mod pty;
mod quit;
mod settings;
mod shells;
mod startup;
mod terminate;
mod watcher;
mod webview;

use std::sync::Arc;

use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

use processes::service::ProcessService;

/// `atelier ▸ Settings…`(⌘,)의 id — 메뉴를 세우는 곳과 그 클릭을 받는 곳 둘이 이 문자열로만
/// 이어져 있다.
///
/// **이 항목이 셸에 포커스가 있어도 듣는 유일한 길이다**(결정 51). 아래 주석이 말하는
/// 「OS 메뉴가 웹뷰보다 먼저 먹는다」를 이번에는 유리하게 쓴다 — 그 성질 때문에 웹뷰의
/// keydown으로는 ⌘,를 잡을 수 없고, 터미널을 쓰다 「글꼴이 작네」 하고 여는 흐름이 정확히
/// 그 상황이다.
const SETTINGS_MENU_ID: &str = "settings";

/// 창 하나의 라벨. `tauri.conf.json`이 라벨을 안 적어 Tauri의 기본값(`main`)이다. 그 창을 다시 찾는 자리 둘 — ⌘Q · Dock 종료의
/// 확인 창을 사람 앞에 세우는 `terminate.rs`와 WebContent의 pid를 묻는 `webview.rs` — 가 이 한 값을 쓴다. 둘 다 macOS 몫이다.
#[cfg(target_os = "macos")]
const MAIN_WINDOW: &str = "main";

/// 프레임에 포커스가 갔을 때 죽던 단축키들을 되살리는 항목의 id 접두사.
///
/// **뒤에 붙는 것은 그 키의 `KeyboardEvent.code`다** (`hotkey:KeyB` · `hotkey:Digit3`).
/// 그렇게 두면 프런트가 받은 문자열을 **그대로** 합성 keydown의 `code`에 넣을 수 있어,
/// 「메뉴 항목 ↔ 키」를 잇는 짝이 따로 안 생긴다 — 메뉴 항목도 프런트의 판정도 같은 단축키
/// 표(`HOTKEY_TABLE`)의 code를 쓴다. 프런트는 그 code로 표의 항목을 되찾아 수식키를 싣는다
/// (`menu-hotkey.ts`).
const HOTKEY_PREFIX: &str = "hotkey:";

/// **단축키 표 — 데이터 한 장**(codex-ds 결정 19 · 스펙 S16). 프런트가 import하는 바로 그 파일을
/// 빌드 때 싣는다 — macOS 메뉴 바 · 메뉴 오른쪽 단축키 칸 · 툴팁 · 키 판정이 이 한 장을 읽어,
/// 어디서 본 단축키든 같다. 항목마다 드는 것(키 코드 · 수식키 · 보이는 글자 · `aria-keyshortcuts`
/// 값 · 메뉴 바 라벨)과 그 뜻은 곁의 `src/lib/hotkeys.ts` 머리말이 든다. 여기서 읽는 것은 View
/// 메뉴 라벨(`menu`)이 있는 줄(`MENU_HOTKEYS`)과 앱 메뉴 Settings…의 `settings` 줄(`SETTINGS_ACCELERATOR`)이고,
/// **표의 차례가 곧 View 메뉴의 차례다.**
///
/// **`pnpm tauri dev` 중에 이 파일을 고치면 프런트만 따라온다.** 프런트는 vite가 곧바로 다시 읽지만, tauri CLI가
/// Rust를 다시 빌드하려고 지켜보는 것은 Cargo 워크스페이스 멤버의 폴더(`src-tauri` · `crates/*`)이고 이 파일은 그 밖
/// (`src/lib`)이라 메뉴 바는 옛 표 그대로다. dev를 다시 띄우면 실린다 — cargo는 `include_str!`한 파일을 따라가 다음
/// 빌드에 새 표를 싣는다.
///
/// **차례는 `serde_json`의 `preserve_order`가 지킨다**(Cargo.toml — 그 기능을 켠 까닭은
/// `hooks.rs`의 것이다). 그 기능이 빠지면 표가 이름순으로 읽혀 메뉴가 조용히 섞이는데, 그
/// 자리는 아래 차례 검사(`검색이_메뉴의_맨_앞이다` · `번호_항목이_메뉴_뒤쪽에_몰려_있다`)가 문다.
const HOTKEY_TABLE: &str = include_str!("../../src/lib/hotkeys.json");

/// 표의 한 줄 가운데 메뉴 바가 읽는 것. 보이는 글자 · `aria-keyshortcuts` 값은 화면의 몫이라 안 읽는다.
#[derive(serde::Deserialize)]
struct HotkeyRow {
    code: String,
    mods: Vec<Modifier>,
    /// View 메뉴의 라벨. 없으면(`null`) View 메뉴에 서지 않는다 — Settings…(⌘,)는 이것이 없이 앱 메뉴에 선다(`build_menu`).
    menu: Option<String>,
}

/// 수식키 넷 — 표에는 소문자 이름으로 적힌다(`"meta"` …).
#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
enum Modifier {
    Ctrl,
    Alt,
    Shift,
    Meta,
}

/// View 메뉴에 서는 항목 하나 — 표의 한 줄에서 나온다.
struct MenuHotkey {
    /// `KeyboardEvent.code` — 항목 id의 꼬리이고 프런트에 실어 보내는 값이다.
    code: String,
    /// 메뉴에 적히는 이름.
    label: String,
    mods: Vec<Modifier>,
}

/// 메뉴 바에 되살리는 키들 — 표에서 `menu`가 있는 줄을 표의 차례대로.
///
/// **accelerator는 표에 안 적는다 — `accelerator_of`가 code와 수식키에서 만든다.** 손으로 적으면
/// 두 문자열이 한 줄에 나란히 서서 눈으로는 잘 맞아 보이는데, 어긋나는 순간 사람이 누른 키와
/// 앱이 도는 동작이 **다른 키가 된다.**
///
/// 이름은 `CONTEXT.md`의 말이다. ⌘1~9가 옮기는 것은 **탭**이다 — 「work·터미널 화면 본문 카드
/// 머리의 한 칸. `spec`과 셸들이 거기 선다」가 그 문서의 정의이고 ⌘1이 spec, ⌘2~9가 셸이라
/// 정확히 겹친다. **「열」이 아니다**: 열은 분할했을 때만 생기고 늘 둘이라 아홉이 될 수 없고,
/// 그 문서가 열을 「칸·패널·페인」으로 부르지 말라고 못 박고 있다.
///
/// **⌘W는 메뉴 바에 없다**(표의 `closeShell` 줄에 `menu`가 없다). 창이 닫히면 이 앱은 창이
/// 하나뿐이라 그대로 종료되고 돌던 셸이 전부 죽는다(`build_menu` 주석의 그 사고). 실측으로는
/// 커스텀 id 항목이 `performClose:`에 안 매여 창이 살아 있었지만 **dev 빌드에서만 쟀고**, 얻는
/// 것이 「칸 닫기」 하나인데 잃을 수 있는 것이 셸 전부라 저울이 한쪽으로 명백히 기운다.
///
/// **⌃Tab·⌃⇧Tab도 없다.** 항목이 제대로 서는데도(AX로 `mods=12 vk=48`을 확인했다)
/// **accelerator 경로만 죽는다** — 실제로 던져서 0/6 · 0/3이었다.
///
/// **F2 · ⇧F10 · 메뉴 키도 없다**(codex-ds 스펙 §8). 이름 바꾸기와 대상 메뉴는 무엇에 거는지가
/// 포커스에 달려 있어 메뉴 바 한 줄로 설 자리가 없다. 화면 안 키(⌥화살표 · Esc)도 같다.
///
/// **⇧⇧는 여기 실을 수 없었고, 그래서 키를 바꿨다**(결정 1·2). 「같은 수식키를 300ms 안에
/// 두 번」은 몸짓이라 accelerator 문법에 실을 자리가 없고, `Shift+Shift`는 파싱에 실패한다.
/// 그런데 Tauri가 그 오류를 조용히 버려(`menu/normal.rs`의 `parse().ok()`) **단축키 없는
/// 항목이 선다** — 빌드가 통과하는 것이 곧 등록된 것이 아니다. 그 사실이 이 목록의 성질을
/// 하나 못 박는다: **여기 실을 수 있느냐가 여는 키를 고르는 조건**이었고, ⌘K는 실린다.
///
/// **`Search`가 맨 앞이다**(결정 3). 화면을 안 타고 어디서나 여는 유일한 항목이라 목록 첫
/// 줄에 서는 것이 읽힌다 — 나머지는 전부 「지금 이 화면의」 무엇이다. 그 자리를 검사가
/// 못 박는다(`검색이_메뉴의_맨_앞이다`): 다음 사람이 표를 알파벳순으로 정리하면 조용히 밀린다.
///
/// **⌘J는 「방금 부른 셸로」다**(프로세스 결정 16 · 프로세스 스펙 P3 · 티켓 23) — 가장 최근에 사람을 부른 셸로 가서 키보드
/// 포커스를 그 셸에 준다. OS 알림을 누르는 길이 안 되는(판 03 선행 시험) 자리를 이 키가 맡는다. **앱 안 단축키다** — 전역
/// 단축키로 두지 않는다: 앱이 앞에 있을 때만 먹고, 알림을 보고 앱으로 넘어온 뒤 누르는 흐름이다. 이 항목이 셸에 포커스가
/// 있어도 듣는 길인 것은 위 다른 항목과 같다. 번호 항목들 **앞**에 선다 — 금이 첫 번호 앞에 그어지므로 뒤에 두면 번호들
/// 사이에 끼고, 그 자리는 `방금_부른_셸로가_번호_항목들_앞에_선다`가 못 박는다. 이름은 코드의 말(`callingShells`의 「부른다」)을
/// 영어로 옮긴 것이다 — View 메뉴의 다른 항목처럼 영어다.
///
/// **이름이 `MENU_HOTKEYS`인 것은 프런트의 `HOTKEYS`와 가르려는 것이다** — 그쪽은 표 전부이고(`src/lib/hotkeys.ts`), 이것은 그
/// 가운데 View 메뉴 줄뿐이다.
static MENU_HOTKEYS: std::sync::LazyLock<Vec<MenuHotkey>> = std::sync::LazyLock::new(|| menu_hotkeys(HOTKEY_TABLE));

/// `atelier ▸ Settings…`의 가속키 — 표의 `settings` 줄(⌘,)에서 만든다. 그 줄은 View 메뉴 라벨이 없다: 자리는 macOS 관습(앱
/// 메뉴 About 아래)이고, 되살림 항목(`hotkey:`)이 아니라 `settings:open`을 쏘는 항목이라 `view_entries`의 몫이 아니다.
static SETTINGS_ACCELERATOR: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    let row = hotkey_rows(HOTKEY_TABLE)
        .into_iter()
        .find_map(|(id, row)| (id == "settings").then_some(row))
        .expect("단축키 표에 settings 줄이 있다");
    accelerator_of(&row.mods, &row.code)
});

/// 표의 줄들 — `(이름, 줄)`을 표의 차례대로. 표가 깨졌으면 **던진다** — 프런트도 같은 파일을 빌드 때 읽어
/// 그 전에 멎지만, 여기서 조용히 빈 메뉴를 세우면 단축키가 통째로 사라진 앱이 뜬다.
fn hotkey_rows(table: &str) -> Vec<(String, HotkeyRow)> {
    let rows: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(table).expect("단축키 표가 이름 → 항목의 JSON이다");
    rows.into_iter()
        .map(|(id, row)| {
            let row: HotkeyRow =
                serde_json::from_value(row).unwrap_or_else(|err| panic!("단축키 표의 {id} 줄을 못 읽는다: {err}"));
            (id, row)
        })
        .collect()
}

/// 표에서 View 메뉴 항목을 뽑는다 — 라벨(`menu`)이 있는 줄을 표의 차례대로.
fn menu_hotkeys(table: &str) -> Vec<MenuHotkey> {
    hotkey_rows(table)
        .into_iter()
        .filter_map(|(_, row)| row.menu.map(|label| MenuHotkey { code: row.code, label, mods: row.mods }))
        .collect()
}

/// 표의 한 줄에서 그 키의 accelerator를 만든다 — 수식키 다음에 키.
///
/// **프런트의 `keyOfCode`와 짝이지만 만드는 것이 다르다** — 그쪽은 `code`에서 `key`를,
/// 이쪽은 `code`에서 accelerator 문자열을 만든다. 같은 해체(`Digit*` · `Key*`)를 두 언어가
/// 각각 하는 것은 그 사이에 건널 다리가 없어서다: 메뉴를 세우는 것은 Rust이고 이벤트를
/// 만드는 것은 프런트다. **잇는 끈은 `code` 문자열 하나**이고, 그것이 `HOTKEY_PREFIX`가
/// id에 code를 그대로 싣는 이유다. ⌘는 `CmdOrCtrl`이다 — macOS에서 ⌘다.
fn accelerator_of(mods: &[Modifier], code: &str) -> String {
    let key = code.strip_prefix("Digit").or_else(|| code.strip_prefix("Key")).unwrap_or(code);
    let mut parts: Vec<&str> = mods
        .iter()
        .map(|one| match one {
            Modifier::Ctrl => "Ctrl",
            Modifier::Alt => "Alt",
            Modifier::Shift => "Shift",
            Modifier::Meta => "CmdOrCtrl",
        })
        .collect();
    // Enter처럼 이름이 곧 키인 것들은 그대로 붙는다.
    parts.push(key);
    parts.join("+")
}

/// View 메뉴의 한 칸 — 금이거나 항목이거나.
#[derive(Debug, PartialEq)]
enum ViewEntry<'a> {
    Line,
    Item { id: String, label: &'a str, accelerator: String },
}

/// View 메뉴에 무엇이 어느 차례로 서는가 — `build_menu`가 이것을 **그대로** 세운다.
///
/// 메뉴를 실제로 세우는 일은 tauri 핸들을 요구해 단위 검사가 못 태운다. 그래서 세울 것을 여기서
/// 다 정하고(차례 · 금 · id · accelerator) `build_menu`는 받아 그리기만 한다 — 검사가 재는 것이
/// 곧 메뉴에 서는 것이다.
fn view_entries(hotkeys: &[MenuHotkey]) -> Vec<ViewEntry<'_>> {
    let mut entries = Vec::new();
    let mut drew_line = false;
    for hotkey in hotkeys {
        // 얼개를 만지는 것들(⌘B·⌘↩·⌘T)과 탭 번호 사이에 금 하나. **자리를 세지 않는다** —
        // 「번호가 처음 나오는 곳」이 곧 그 경계라, 항목을 끼워도 금이 따라 움직인다.
        if !drew_line && hotkey.code.starts_with("Digit") {
            entries.push(ViewEntry::Line);
            drew_line = true;
        }
        entries.push(ViewEntry::Item {
            id: format!("{HOTKEY_PREFIX}{}", hotkey.code),
            label: &hotkey.label,
            accelerator: accelerator_of(&hotkey.mods, &hotkey.code),
        });
    }
    entries
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
    // 자리도 관습을 따라 About 바로 아래다. 키는 다른 단축키처럼 표의 줄(`settings`)에서 온다.
    let settings = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "Settings…")
        .accelerator(SETTINGS_ACCELERATOR.as_str())
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
    // 프런트에 남는다 — 같은 키가 화면마다 다른 것을 가리키므로(`menu-hotkey.ts` 머리말) 동작을
    // 여기 두면 그 갈래가 Rust로 새고, 화면이 하나 늘 때마다 두 언어를 고쳐야 한다. 단축키 표도
    // 동작은 안 든다 — 키와 그 글자 · 라벨뿐이다.
    //
    // 무엇이 어느 차례로 서는지는 단축키 표에서 `view_entries`가 정한다 — 여기는 받아 그리기만 한다.
    let mut view = SubmenuBuilder::new(handle, "View");
    for entry in view_entries(&MENU_HOTKEYS) {
        view = match entry {
            ViewEntry::Line => view.separator(),
            ViewEntry::Item { id, label, accelerator } => {
                view.item(&MenuItemBuilder::with_id(id, label).accelerator(accelerator).build(handle)?)
            }
        };
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
    // 시작 보고를 붙잡아 두는 자리(프로세스 스펙 S11)와, 그 보고가 기다릴 몫 둘 — 시작 정리(티켓 10)와 훅 맞춤(티켓 21).
    // **몫은 웹뷰가 서기 전에 센다** — 웹뷰는 셋업의 앱 몫(아래 `.setup`)보다 먼저 서고(`tauri::app::setup`이 창을 먼저 짓는다),
    // 프런트는 뜨자마자 보고를 묻는다. 셋업 안에서 세면 그 사이에 온 물음이 그 일을 안 기다리고 빈 보고를 받을 자리가 생긴다.
    // 스레드에 넘길 수 있게 풀과 같이 `Arc`다.
    let report = Arc::new(startup::ReportHolder::default());
    let cleanup = report.chore();
    let hook_sync = report.chore();
    // PTY 풀 — 셸을 쥔 자리. 명령은 앱에 건 것(`manage`)을 `State`로 찾고, 셋업은 스레드 · 알림 · 기록 · 정리에 **바로 이 값을**
    // 건넨다. 빌더 앞에서 한 번 세워 셋업이 앱에서 다시 찾지 않는다(위 `report`와 같다).
    let pool = Arc::new(pty::PtyPool::default());
    // 프로세스 서비스 — `Processes` 화면과 nav 메타가 읽는 값(스냅샷 · 요약 · 추이 · 정리 기록)을 모으는 자리. **위 풀을 본다**(셸
    // 목록 · 인스턴스 기록). 풀과 따로 앱에 걸고, 읽는 명령(`processes_snapshot` · `_summary` · `_trend` · `_cleanup_log`)이 `State`로
    // 찾는다 — 끝내는 `processes_end`는 셸 명령처럼 풀을 찾는다(서비스는 아무것도 안 끝낸다). 셋업이 WebContent를 묻는 길과 배경
    // 표본을 건다.
    let process_service = Arc::new(ProcessService::new(Arc::clone(&pool)));
    // 대화 호스트 — 대화창의 몸통(three-axes 티켓 05). 풀처럼 빌더 앞에서 한 번 세워 앱에 건다: 웹뷰는 셋업보다 먼저 서고
    // 프런트는 뜨자마자 대화 목록을 묻는다 — 셋업 안에서 걸면 그 사이 대화 명령이 `state not managed`로 거절된다.
    // 호스트가 내보내는 것은 채널에 받아 두었다가 셋업이 건 스레드 하나가 화면으로 쏜다(`chat::announce`) — 앱 핸들이 아직
    // 없어도 버려지는 것이 없고, 한 스레드라 기록 줄의 차례가 지켜진다. Claude 대화의 변환기가 이 실행 파일 자신이라
    // `current_exe`는 여기서, 이 한 번만 읽는다(워크플로 §1).
    let (chat_events, chat_inbox) = std::sync::mpsc::channel();
    let chats = Arc::new(chat::host(std::env::current_exe().unwrap_or_default(), chat_events));
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
                // 다르고 그 갈래는 프런트에만 있다 — 여기서 아는 것은 「이 code가 눌렸다」뿐이다.
                let _ = app.emit("hotkey:menu", code.to_string());
            }
        })
        // **빨간 버튼은 창을 닫지 않고 묻는다**(결정 14 · #223). 창이 하나라 닫기 = 종료이고,
        // 그 한 번에 돌던 셸이 전부 죽는다. 막고 이벤트만 쏜다 — 묻는 것은 프런트의 확인 창이다
        // (`quit-request.ts`). 「확인됨」이 서 있으면 막지 않는다 — #224의 `terminate:` 훅과 같은
        // 규칙 한 벌이다. `quit_app`의 `app.exit`는 지금 이 자리를 안 지난다(`quit.rs`의 `confirm`).
        //
        // ⌘Q·메뉴 Quit·Dock 종료는 여기로 안 온다 — tao가 `ExitRequested` 없이 바로 끝낸다(tauri#9198).
        // 그 길은 아래 셋업의 델리게이트 훅(`terminate.rs`)이 같은 이벤트를 쏜다.
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
        // 입력칸 · 터미널 메뉴의 붙여넣기가 클립보드를 읽는 길(codex-ds 스펙 S9). 열린 권한은 읽기 하나다(`capabilities`).
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::clone(&pool))
        .manage(Arc::clone(&process_service))
        // 시작 보고를 붙잡아 두는 자리 — 위에서 몫을 센 그 자리다. 시작 때의 일(정리 · 훅 맞춤)이 여기에 결과를 채운다.
        .manage(Arc::clone(&report))
        // 대화 호스트 — 대화 명령이 `State`로 찾고, 종료 훅이 끈다. 위에서 세운 그 하나다.
        .manage(Arc::clone(&chats))
        .setup(move |app| {
            // ⌘Q·메뉴 Quit·Dock 종료도 묻게 한다(결정 14 · #224). **셋업 안이어야 한다** — 셋업은
            // `applicationDidFinishLaunching:` 안에서 돌아 이때 앱 델리게이트가 이미 붙어 있다.
            terminate::install(app.handle());
            // 진행 중 루트의 감시는 work가 사라진 소식을 대화 호스트에게도 넘긴다(three-axes 티켓 11) — 빌더 앞에서 세운 그 하나다.
            watcher::start(app.handle().clone(), Arc::clone(&chats));
            // 대화 호스트가 내보낸 것(기록 줄)을 화면으로 쏜다 — 위 감시와 같은 길이다: 스레드 하나가 emit하고 프런트가
            // `listen`으로 받는다. 빌더 앞에서 받아 둔 채널을 건넨다.
            chat::announce(app.handle().clone(), chat_inbox);
            // 도는 명령을 1초마다 재서 **바뀐 셸만** 쏜다(adr-04). 배선은 바로 위 watcher와
            // 같은 길이다 — 스레드 하나가 emit하고 프런트가 `listen`으로 받는다.
            //
            // 풀을 여기서 건넨다. 스레드가 `state()`로 스스로 찾게 두면 그것이 등록되기
            // 전에 뜰 수 있는 코드가 되고, 그때 나는 것은 조용한 패닉 하나다 — 폴링이
            // 통째로 죽는데 앱은 멀쩡히 돈다.
            pty::watch_running(app.handle().clone(), Arc::clone(&pool));
            // 셸이 스스로 끝나며 그 셸에서 띄운 것을 끝냈을 때 알릴 길을 건다(프로세스 스펙 S49 · P4 · 티켓 13). 같은 길이다 —
            // 끝내기의 뒤 스레드가 emit하고 프런트가 `listen`으로 받는다. 셸은 웹뷰가 뜬 뒤에 띄우므로 여기가 먼저다.
            pty::announce_ends(app.handle().clone(), &pool);

            // 셸이 **스스로 말하는** 길(#201). 위 둘이 앱이 물어서 아는 값이라면 이쪽은
            // 에이전트의 훅이 파일 한 장을 놓고 가는 길이고, 여기가 그 길의 세 자리다.
            let root = atelier_core::data_root();
            // (1) 죽은 실행이 남긴 상태 파일을 걷는다. PTY 번호는 실행마다 0부터 다시
            // 나므로 안 걷으면 지난 실행의 `…-0.json`이 이번 첫 셸에 붙어 **뜨자마자
            // 사람을 부르는 셸**이 생긴다. 이 실행의 세대는 반드시 셸 키를 짓는 그 값(`shell_key::generation`)이다 —
            // 여기서 시각을 다시 재면 두 값이 갈려 살아 있는 셸의 파일을 지운다. 이 줄이 그 값을 처음 잡아 세대가 곧 앱이
            // 뜬 시각이 된다. 인스턴스 기록으로 가린
            // 살아 있는 다른 실행(함께 뜬 dev 빌드 · 설치본)의 세대도 남긴다 — 지우면 그 셸의 띠 상태가
            // 사라진다(프로세스 스펙 S10 · 티켓 11).
            shells::sweep(&root, &processes::instances::live_generations(&root));
            // (2) 훅 스크립트를 홈에 세운다. **설치 버튼(다음 티켓)이 아니라 여기서** 쓰는
            // 이유는 두 가지다 — 사람이 손으로 훅을 걸어 보려면 걸 것이 이미 있어야 하고,
            // 앱을 고쳐도 사용자 홈의 스크립트가 낡은 채 남아 있으면 안 된다. 스크립트는
            // 아무 설정에도 안 걸려 있으면 그냥 안 불리는 파일이라 세워 두는 것이 무해하다.
            // 옛 python 처리기와 새 처리기를 함께 세운다(티켓 19 · 21) — 옛 줄을 부르는 설정(옛 빌드가 깐 것, 아직 안 맞춘 것)이
            // 남아 있는 동안 옛 파일도 서 있어야 한다(옛 스크립트 파일은 지우지 않는다).
            //
            // 세웠으면 **이미 깐 훅을 지금 목록으로 맞춘다**(프로세스 결정 15 · 티켓 21) — 위에서 센 몫으로, 뒤 스레드에서. 우리
            // 훅이 하나도 없는 설정은 안 건드린다. 처리기를 세운 뒤에만 맞추는 것은, 설정만 새 경로를 가리키면 에이전트가 매 턴
            // 없는 파일을 부르기 때문이다. 못 세웠으면 몫은 빈손으로 끝나고 맞춤은 다음 실행으로 미뤄진다. 데이터 루트를 옮긴
            // 실행(`ATELIER_HOME`)도 몫이 빈손으로 끝난다 — 모든 실행이 함께 부르는 진짜 설정을 임시 루트의 처리기로 돌려 놓지
            // 않게, 그 가름은 맞춤이 스스로 한다(`startup::sync_hooks`).
            match shells::write_hook_scripts(&root) {
                Ok(()) => startup::sync_hooks(hook_sync, hooks::agent_home(), root.clone()),
                Err(e) => {
                    eprintln!("atelier: {e}");
                    drop(hook_sync);
                }
            }
            // (3) 상태 폴더를 본다. 배선은 위 둘과 같은 길이다 — 스레드 하나가 emit하고
            // 프런트가 `listen`으로 받는다. **접두사를 함께 넘긴다**: 읽는 쪽이 그것을
            // 안 보면 이번 실행의 것만 싣는다는 보장이 (1)의 파괴적 청소에만 걸려 있게 되고,
            // 앱이 둘 뜬 동안에는 남의 인스턴스가 놓고 간 파일이 그대로 실려 나간다.
            shells::watch(app.handle().clone(), shells::shells_dir(&root), processes::shell_key::generation());

            // Library의 기본 Agent 파일(`host.md` · `reviewer.md`)을 없을 때만 세운다(v1 구현 스펙 S14). 있으면 사람이 고친 것이라
            // 건드리지 않는다. 못 세우면 적고 지나간다 — 다음 실행이 다시 세운다.
            if let Err(e) = atelier_core::ensure_default_agents(&root) {
                eprintln!("atelier: {e}");
            }

            // 인스턴스 기록을 연다(프로세스 결정 6 · 프로세스 스펙 S52). 이 실행의 셸 키가 디스크에 서야 함께 뜬 다른
            // 빌드의 판정이 이 실행의 셸 자손을 고아로 안 본다. 시작 정리는 이 줄 **뒤에** 선다 — 기록이 먼저다.
            // 셸은 프런트가 뜬 뒤에야 불리지만, 그보다 먼저 올린 키가 있어도 여는 쓰기가 함께 적는다(`Record::open`).
            pty::open_record(&pool, &root, &app.package_info().version.to_string());
            // 시작 정리(프로세스 결정 6 · 티켓 10). 지난 실행이 남긴 확정 고아를 뒤 스레드에서 끝내고, 죽은 실행의 기록을 지우고,
            // 끝낸 것을 위에서 센 몫으로 시작 보고에 싣는다. **기록을 연 뒤다** — 연 뒤라야 남의 기록이 읽힌다. 이 실행의 셸은
            // 안 본다: 웹뷰가 곧 첫 셸을 띄운다.
            startup::clean_up(cleanup, Arc::clone(&pool));
            // nav 메타의 배경 표본(프로세스 결정 10 · 11 · 티켓 29). 앱 전체 메모리 합계와 손볼 것(출처 불명 · `●`를 켜는 기록)을 10초마다
            // 모은다 — 화면이 닫혀 있어도 돈다. **기록을 연 뒤다** — 먼저 모으면 판정이 남의 기록을 못 읽어 함께 뜬 다른 빌드의 셸
            // 자손이 모두 출처 불명으로 서고, 뜨자마자 `●`가 선다. 첫 장은 시작 정리의 기록을 못 볼 수 있다 — 다음 장(10초)이 본다.
            //
            // 표본을 걸기 **전에** 웹뷰에게 WebContent의 pid를 물을 길을 건다(프로세스 스펙 S39 · 티켓 30) — 앱 본체 = Rust 본체 +
            // WebContent. 늦게 걸면 첫 장이 「웹뷰 제외」로 서고 추이의 첫 점이 그만큼 낮다. 묻는 것은 표본마다 메인 스레드로 간다 —
            // 이 setup이 메인 스레드를 쥔 동안 도는 첫 표본은 답을 못 받아, 표본이 그 장을 미루고 곧 다시 모은다(`sample_once`).
            let asker = app.handle().clone();
            process_service.ask_web_content_with(move || webview::content_pid(&asker));
            Arc::clone(&process_service).sample_in_background();
            Ok(())
        })
        // 웹뷰가 다시 뜨면 옛 페이지가 쥐고 있던 채널이 죽는다 — 그 순간 셸을 거두지 않으면
        // Rust 쪽 자식만 살아남아 고아가 된다(in-app-terminal 결정 18 — 정리 시점은 앱 종료 · 새로고침
        // 둘이었고, 프로세스 결정 3이 셸 닫기를, 프로세스 결정 6이 앱 시작을, 둘이 함께 셸 스스로 끝남(프로세스
        // 스펙 S49)을 더했다). `pnpm tauri dev`의
        // Vite full reload와 ⌘R이 매번 그 경로다. SPA 라우트 이동은 navigation commit이 아니라서 안 걸리고,
        // in-app-terminal 결정 20의 「화면을 옮기는 것만으로는 안 죽는다」가 바로 그 성질에 기대고 있다(프로세스
        // 결정 7이 입력 없는 자동 셸만 예외로 두었다 — 그 셸은 프런트가 떠남을 보고 셸 닫기 길로 닫는다).
        // 첫 로드에도 오지만 그때 레지스트리는 비어 있어 즉시 돌아온다.
        //
        // **유예는 뒤 스레드로 보낸다**(프로세스 스펙 S5) — 풀은 그 자리에서 비우고 판정까지 한 뒤
        // 돌아와, 새로고침이 2초를 멈추지 않는다. 그 사이 앱이 닫히면 뒤 스레드가 함께 사라지지만,
        // 그 끝내기는 진행 중인 끝내기 목록에 올라 있어 아래 종료 훅이 SIGKILL까지 마감한다. 예전에
        // 여기서 「스레드에 넘기지 않는다」고 했던 까닭(리로드 직후 창을 닫으면 SIGKILL을 아무도 못
        // 보낸다)을 그 목록이 닫는다.
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                pty::end_for_reload(&webview.state::<Arc<pty::PtyPool>>());
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
            commands::list_worktree_tree,
            commands::list_worktree_folder,
            commands::list_archive,
            commands::list_archived_docs,
            commands::read_archived_file,
            commands::open_work_folder,
            commands::open_archived_spec_folder,
            commands::read_worktree_file,
            commands::search,
            commands::touch_recent_work,
            commands::list_agents,
            commands::read_agent_file,
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_first_input,
            commands::pty_close_check,
            commands::pty_close_checks,
            commands::processes_snapshot,
            commands::processes_summary,
            commands::processes_trend,
            commands::processes_cleanup_log,
            commands::processes_end,
            commands::read_settings,
            commands::write_settings,
            commands::default_process_exceptions,
            commands::agent_hooks,
            commands::install_agent_hooks,
            commands::uninstall_agent_hooks,
            commands::spec_layout_state,
            commands::revert_spec_layout,
            commands::read_spec_layout,
            commands::write_spec_layout,
            commands::render_spec_layout,
            commands::quit_app,
            commands::startup_report,
            commands::chat_check_engine,
            commands::chat_list,
            commands::chat_read_record,
            commands::chat_new,
            commands::chat_switch_agent,
            commands::chat_send,
            commands::chat_close,
            commands::chat_stop,
            commands::chat_edit_queued,
            commands::chat_delete_queued,
            commands::chat_send_now,
            commands::chat_answer_permission,
            commands::chat_set_model,
            commands::chat_set_mode,
            commands::chat_set_plan,
            commands::chat_engine_lists,
            commands::chat_quit_counts,
            commands::chat_start_login,
            commands::chat_cancel_login,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 앱이 닫히면 셸도 함께 닫는다(in-app-terminal 결정 18 — 정리 시점은 앱 종료 · 새로고침 둘이었고, 프로세스
            // 결정 3이 셸 닫기를, 프로세스 결정 6이 앱 시작을, 둘이 함께 셸 스스로 끝남(프로세스 스펙 S49)을 더했다. 앱 시작의
            // 정리는 위 셋업의 `startup::clean_up`, 셸 스스로 끝남은 그 셸의 리더 스레드가 한다).
            // 상태가 떨어지기를 기대하지 않는다 — 프로세스가 그냥 끝나면 소멸자는 돌지 않는다. **여기서는 반드시 동기로**
            // 끝낸다: 스레드에 넘기면 프로세스가 끝나며 그 스레드도 함께 사라져 아무도 신호를 못 보낸다.
            // 다른 길(셸 닫기 · 새로고침 · 셸 스스로 끝남 · 시작 정리 · 손으로 끝내기)이 뒤로 보낸 끝내기(진행 중인 끝내기)도
            // 여기서 남은 유예만 기다려 마감한다.
            //
            // 인스턴스 기록도 여기서 닫는다(`end_for_exit` 안) — 「못 끝냄」이 없으면 지우고, 있으면 다음 실행의 시작
            // 정리가 한 번 더 해 보게 남긴다. 정리 기록(「앱 종료」 사건)도 `end_for_exit` 안에서 적는다 — 그래서 돌려받는
            // 결과(못 끝냄 포함)는 여기서 안 읽는다. 그 결과로 재는 것은 풀 배선 장면이다.
            //
            // 대화 에이전트도 여기서 끈다(three-axes 결정 19 · 티켓 05) — 셸 표식이 없어 셸 정리가 끄지 않는다. 호스트는 모든
            // 대화의 stdin을 한꺼번에 닫고 1초를 한 번만 기다린 뒤 그룹째 SIGKILL한다. 셸 정리와 겹쳐 기다리려고 스레드로
            // 띄우고, **셸 정리 뒤에 반드시 기다린다** — 위의 「동기로」와 같은 까닭이다.
            if matches!(event, tauri::RunEvent::Exit) {
                let chats = Arc::clone(&app.state::<Arc<atelier_acp::ConversationHost>>());
                let chats_ended = std::thread::spawn(move || chats.shut_down());
                let _ = pty::end_for_exit(&app.state::<Arc<pty::PtyPool>>());
                let _ = chats_ended.join();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 표에서 만든 View 메뉴의 항목 — `(code, 라벨, accelerator)`를 메뉴의 차례대로. 금은 뺀다.
    /// **재는 것은 `build_menu`가 그리는 그것이다**(`view_entries`) — 표를 따로 읽어 재면 메뉴를 만드는 길이 틀려도 초록이다.
    fn view_items() -> Vec<(String, String, String)> {
        view_entries(&MENU_HOTKEYS)
            .into_iter()
            .filter_map(|entry| match entry {
                ViewEntry::Line => None,
                ViewEntry::Item { id, label, accelerator } => {
                    let code = id.strip_prefix(HOTKEY_PREFIX).expect("항목 id가 접두사로 시작한다").to_string();
                    Some((code, label.to_string(), accelerator))
                }
            })
            .collect()
    }

    /// 표의 모든 줄 — `(이름, 줄)`을 표의 차례대로. 메뉴 바가 안 읽는 줄(⌘W · F2 …)까지 본다.
    fn table_rows() -> Vec<(String, serde_json::Value)> {
        let rows: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(HOTKEY_TABLE).expect("단축키 표가 JSON이다");
        rows.into_iter().collect()
    }

    /// 표에서 그 키(수식키 + code)의 줄. 앵커로 쓴다 — 그 줄이 표에 있어야 「메뉴 바에 없다」가 뜻이 있다.
    fn row_of(code: &str, mods: &[&str]) -> serde_json::Value {
        table_rows()
            .into_iter()
            .map(|(_, row)| row)
            .find(|row| row["code"] == code && row["mods"] == serde_json::json!(mods))
            .unwrap_or_else(|| panic!("{mods:?} {code} 줄이 표에 없다"))
    }

    /// **⌘W가 메뉴 바에 있으면 안 된다** (#153). 근거는 `MENU_HOTKEYS` 독이 든다 — 여기가 막는 것은
    /// 표를 늘리다 무심코 그 줄에 라벨을 다는 것이고, 그 한 줄의 값이 **돌던 셸 전부**다.
    /// ⌘W 줄 자체는 표에 있다 — 판정(`shellHotkey`)과 메뉴 단축키 칸이 그 줄을 읽는다.
    #[test]
    fn 메뉴에_cmd_w가_없다() {
        assert!(row_of("KeyW", &["meta"])["menu"].is_null(), "⌘W 줄에 메뉴 바 라벨이 있다");
        for (code, label, accelerator) in view_items() {
            assert_ne!(code, "KeyW", "{label}이 ⌘W를 든다");
            assert_ne!(accelerator, "CmdOrCtrl+W", "{label}이 ⌘W를 든다");
        }
    }

    /// `accelerator_of`가 muda가 아는 문자열을 만드는가 — 수식키 다음에 키.
    ///
    /// **한때 이 자리에 「표의 셋째 칸이 code와 짝이 맞는가」가 있었다.** 그 검사의 본문이
    /// 곧 유도 함수였다 — 검사가 유도를 알고 있다면 그 유도는 코드에 있어야 한다. 셋째 칸을
    /// 걷고 `accelerator_of`를 세우면서 그 검사도 함께 사라졌고, 남은 것이 이것이다. 단축키 표에도
    /// accelerator 칸은 없다.
    #[test]
    fn accelerator를_수식키와_code에서_만든다() {
        use Modifier::*;
        assert_eq!(accelerator_of(&[Meta], "KeyK"), "CmdOrCtrl+K");
        assert_eq!(accelerator_of(&[Meta], "Digit1"), "CmdOrCtrl+1");
        assert_eq!(accelerator_of(&[Meta], "Enter"), "CmdOrCtrl+Enter");
        assert_eq!(accelerator_of(&[Ctrl, Shift], "Tab"), "Ctrl+Shift+Tab");
        assert_eq!(accelerator_of(&[Shift], "F10"), "Shift+F10");
        assert_eq!(accelerator_of(&[], "F2"), "F2");
        // muda는 `Comma`를 그 키로 읽는다(`,`와 같은 키 — muda 0.19 `parse_code`).
        assert_eq!(accelerator_of(&[Meta], "Comma"), "CmdOrCtrl+Comma");
    }

    /// **Settings…(⌘,)의 가속키도 표에서 나온다**(codex-ds 결정 19) — 표의 `settings` 줄이다. 그 줄은 View 메뉴에 서지 않는다:
    /// 앱 메뉴의 관습 자리에 서고, 되살림 항목이 아니라 `settings:open`을 쏜다(`SETTINGS_MENU_ID`).
    #[test]
    fn 설정의_가속키가_표의_settings_줄에서_나온다() {
        assert_eq!(SETTINGS_ACCELERATOR.as_str(), "CmdOrCtrl+Comma");
        assert!(row_of("Comma", &["meta"])["menu"].is_null(), "⌘, 줄에 View 메뉴 라벨이 있다");
        assert!(view_items().iter().all(|(code, _, _)| code != "Comma"), "⌘,가 View 메뉴에 선다");
    }

    /// **`build_menu`에 손으로 적은 가속키가 없다**(codex-ds 결정 19) — 메뉴의 가속키는 모두 표의 줄에서 만든다(`accelerator_of`).
    /// 문자열을 바로 적으면 표와 조용히 갈린다 — 키를 옮긴 날 메뉴는 옛 키를, 툴팁 · 판정은 새 키를 가르친다.
    #[test]
    fn build_menu에_손으로_적은_가속키가_없다() {
        let body = without_comment_lines(body_of(include_str!("lib.rs"), "fn build_menu<", "\n}\n"));
        assert!(body.contains(".accelerator("), "가속키를 다는 자리를 못 찾았다 — 아래 견줌이 저절로 초록이다");
        assert!(!body.contains(".accelerator(\""), "build_menu가 가속키를 문자열로 적는다");
    }

    /// **표에서 만든 메뉴의 가속키가 지금 단축키 그대로다** — ⌘K · ⌘B · ⌘↩ · ⌘T · ⌘J · ⌘1~9. 표를 옮기며 수식키 하나가 빠지면
    /// (⌘ 없는 K) 메뉴가 그 키를 먹어 글자를 못 치게 되는데, 빌드도 다른 검사도 그것을 말하지 않는다.
    #[test]
    fn 메뉴의_가속키가_지금_단축키다() {
        let accelerators: Vec<String> = view_items().into_iter().map(|(_, _, accelerator)| accelerator).collect();
        let mut want: Vec<String> =
            ["K", "B", "Enter", "T", "J"].iter().map(|key| format!("CmdOrCtrl+{key}")).collect();
        want.extend((1..=9).map(|n| format!("CmdOrCtrl+{n}")));
        assert_eq!(accelerators, want);
    }

    /// id가 겹치면 뒤 항목의 클릭이 앞 항목으로 간다 — 메뉴는 그것을 오류로 말하지 않는다.
    #[test]
    fn id가_겹치지_않는다() {
        let mut ids: Vec<String> = view_items().into_iter().map(|(code, _, _)| code).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "메뉴 바에 같은 code가 두 번 선다");
    }

    /// **표의 메뉴 바 항목이 모두 메뉴에 선다**(codex-ds 스펙 「Testing Decisions」 경계 ③) — 라벨이 있는 줄이 빠짐없이, 표의
    /// 차례대로, 그 라벨로. 메뉴를 만드는 길(`menu_hotkeys` · `view_entries`)이 줄을 흘리면 프런트는 그 키를 메뉴 바 키로 알고
    /// 되돌림을 기다리는데(`menu-hotkey.ts`) 메뉴에는 그 항목이 없다.
    #[test]
    fn 표의_메뉴_바_항목이_모두_메뉴에_선다() {
        let want: Vec<(String, String)> = table_rows()
            .into_iter()
            .filter_map(|(_, row)| {
                let label = row["menu"].as_str()?.to_string();
                Some((row["code"].as_str().expect("code가 문자열이다").to_string(), label))
            })
            .collect();
        assert!(!want.is_empty(), "표에 메뉴 바 항목이 없다 — 아래 견줌이 빈 목록끼리 초록이다");
        let got: Vec<(String, String)> = view_items().into_iter().map(|(code, label, _)| (code, label)).collect();
        assert_eq!(got, want);
    }

    /// **F2 · ⇧F10 · 메뉴 키는 메뉴 바에 없다**(codex-ds 스펙 §8) — 이름 바꾸기와 대상 메뉴는 무엇에 거는지가 포커스에 달려 있다.
    /// 세 줄 자체는 표에 있다(앵커) — 메뉴 단축키 칸과 판정이 그 줄을 읽는다(뜻은 티켓 27 · 28).
    #[test]
    fn f2와_shift_f10과_메뉴_키는_메뉴_바에_없다() {
        for (code, mods) in [("F2", &[][..]), ("F10", &["shift"][..]), ("ContextMenu", &[][..])] {
            assert!(row_of(code, mods)["menu"].is_null(), "{mods:?} {code} 줄에 메뉴 바 라벨이 있다");
            assert!(
                view_items().iter().all(|(one, _, _)| one != code),
                "{code}가 메뉴 바에 선다"
            );
        }
    }

    /// **⌘X · ⌘C · ⌘V · ⌘A는 View 메뉴에 없고 Edit 메뉴의 기본 항목이다**(codex-ds 스펙 S9). 네 줄은 표에 있다 — 입력칸 · 터미널
    /// 메뉴의 단축키 칸이 그 글자를 읽는다. 키를 받는 것은 Edit 메뉴의 기본 항목이라 View 메뉴에도 서면 한 키에 메뉴 항목이 둘이다.
    #[test]
    fn 편집_넷은_view_메뉴에_없고_edit_메뉴의_기본_항목이다() {
        for code in ["KeyX", "KeyC", "KeyV", "KeyA"] {
            assert!(row_of(code, &["meta"])["menu"].is_null(), "⌘ {code} 줄에 View 메뉴 라벨이 있다");
            assert!(view_items().iter().all(|(one, _, _)| one != code), "{code}가 View 메뉴에 선다");
        }
        let body = without_comment_lines(body_of(include_str!("lib.rs"), "fn build_menu<", "\n}\n"));
        for item in [".cut()", ".copy()", ".paste()", ".select_all()"] {
            assert!(body.contains(item), "Edit 메뉴에 {item}가 없다 — 그 키가 웹뷰의 편집에 안 닿는다");
        }
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
            setup.contains("shells::write_hook_scripts(&root)"),
            "훅 스크립트를 안 쓴다 — 사용자가 걸 것이 홈에 없다"
        );
        assert!(
            setup.contains("shells::sweep(&root, &processes::instances::live_generations(&root))"),
            "지난 실행의 상태 파일을 안 걷거나, 살아 있는 다른 실행의 것까지 걷는다 — 뜨자마자 사람을 부르는 셸이 생기거나, \
             함께 뜬 다른 빌드의 셸 띠 상태가 사라진다"
        );
        assert!(
            setup.contains(
                "shells::watch(app.handle().clone(), shells::shells_dir(&root), processes::shell_key::generation())"
            ),
            "상태 폴더를 안 보거나 접두사 없이 본다 — 셸이 말해도 화면까지 안 오거나, 남의 인스턴스 것까지 온다"
        );
    }

    /// **인스턴스 기록이 앱이 뜰 때 열린다**(프로세스 스펙 S52). 안 열면 조용하다 — 셸은 잘 뜨고 닫히는데 이 실행의
    /// 키가 디스크에 없어, 함께 뜬 다른 빌드의 판정이 이 실행의 셸 자손을 「출처 불명」으로 본다. 여는 자리도
    /// 헤드리스로는 못 돌리니(`run()`) 자리로 잰다. 여는 쪽의 동작(연 뒤 키가 오르고 내린다)은 `pty.rs`의 실물 장면이 잰다.
    #[test]
    fn the_instance_record_opens_when_the_app_comes_up() {
        assert!(
            setup_source().contains("pty::open_record(&pool, &root, &app.package_info().version.to_string())"),
            "인스턴스 기록을 안 연다 — 다른 빌드가 이 실행의 셸 자손을 출처 불명으로 본다"
        );
    }

    /// **셸 스스로 끝남의 알림이 앱이 뜰 때 걸린다**(프로세스 스펙 S49 · P4 · 티켓 13). 안 걸면 조용하다 — 셸이 `exit`로 끝나며
    /// dev 서버를 끝내고 정리 기록에도 적는데, 풀의 알림 자리가 비어 프런트에 아무것도 안 간다. L3는 이벤트를 손으로 쏘고
    /// 실물 장면은 제 함수를 걸어 받으니 둘 다 이 줄을 안 지난다. 헤드리스로는 못 돌리니(`run()`) 자리로 잰다.
    #[test]
    fn the_ended_processes_are_announced_once_the_app_comes_up() {
        assert!(
            setup_source().contains("pty::announce_ends(app.handle().clone(), &pool);"),
            "셸 스스로 끝남의 알림을 안 건다 — 셸이 스스로 끝나며 띄운 것을 끝내도 토스트가 안 선다"
        );
    }

    // 「정리가 접두사를 따로 재지 않는다」를 `!setup_source().contains("SystemTime")`으로 재던
    // 검사가 여기 있었다. **걷었다.** 위 검사가 호출 문자열을 통째로 못박으므로 그것이 잡는
    // 변형은 전부 위가 먼저 잡고, 반대로 그것만 통과하는 변형은 널려 있었다 — `"atelier"` 같은
    // 고정 접두사도, `chrono`로 잰 값도 `SystemTime`이라는 토큰을 안 쓴다. 두 접두사가 갈리는
    // 것은 이제 `shells.rs`의 `a_sweep_keeps_the_file_a_live_shell_is_named_with`가 **값으로**
    // 잰다 — 진짜 셸 ID로 이름 지은 파일이 진짜 접두사의 쓸기에서 살아남는가.

    /// **셋업이 건네는 풀과 프로세스 서비스가 앱에 건 바로 그것이고, 서비스는 그 풀을 본다.** 명령은 앱에 건 두 값을 `State`로
    /// 찾는다 — 셸 명령(`pty_*` · `processes_end`)은 풀을, 읽기 명령(`processes_snapshot` · `_summary` · `_trend` · `_cleanup_log`)은
    /// 서비스를. 셋업은 도는 명령의 감시 · 셸 스스로 끝남의 알림 · 인스턴스 기록 · 시작 정리에 풀을, WebContent 물음 · 배경 표본에
    /// 서비스를 건넨다. 어느 둘이 어긋나도 조용하다 — 셸은 명령의 풀에서 뜨는데 그 키는 연 적 없는 기록에 오르거나, `Processes`
    /// 화면이 빈 풀을 판정한다. `manage` 하나가 빠지면 그 명령은 부를 때마다 `state not managed`로 거절되는데 L3는 고정 표가 답해
    /// 못 본다. 그래서 둘은 `run`에 하나씩이고(빌더 앞), 서비스는 그 풀로 서고, 앱에 둘 다 걸고, 셋업은 앱에서 다시 찾지 않는다.
    /// 셋업은 헤드리스로 못 돌리니 자리로 잰다.
    #[test]
    fn the_setup_hands_on_the_pool_and_the_service_the_app_manages() {
        let run = run_source();
        let builder = run.find("tauri::Builder::default()").expect("빌더가 있다");
        for (made, what) in [
            ("let pool = Arc::new(pty::PtyPool::default());", "풀"),
            ("let process_service = Arc::new(ProcessService::new(Arc::clone(&pool)));", "이 풀을 보는 프로세스 서비스"),
        ] {
            let at = run.find(made).unwrap_or_else(|| panic!("{what}을 빌더 앞에서 한 번 세우지 않는다"));
            assert!(at < builder, "{what}({at})을 빌더({builder}) 뒤에서 세운다");
        }
        assert_eq!(run.matches("PtyPool::default()").count(), 1, "풀을 둘 세운다 — 셋업 · 서비스 · 명령이 다른 풀을 본다");
        assert_eq!(run.matches("ProcessService::new(").count(), 1, "서비스를 둘 세운다 — 배경 표본과 요약 명령이 다른 자리를 본다");
        for (managed, what) in [(".manage(Arc::clone(&pool))", "풀"), (".manage(Arc::clone(&process_service))", "프로세스 서비스")] {
            assert!(
                run.contains(managed),
                "{what}을 앱에 안 건다 — 그것을 찾는 명령이 부를 때마다 `state not managed`로 거절된다"
            );
        }
        let setup = setup_source();
        assert!(
            !setup.contains("PtyPool>>()") && !setup.contains("ProcessService>>()"),
            "셋업이 앱에서 풀이나 서비스를 다시 찾는다 — 빌더 앞의 값을 건네라"
        );
    }

    /// **대화 호스트는 빌더 앞에서 한 번 서고, 앱에 걸리고, 셋업은 그것이 내보내는 것을 화면으로 쏠 스레드만 건다**
    /// (three-axes 티켓 05). 웹뷰는 셋업보다 먼저 서고 프런트는 뜨자마자 대화 목록을 묻는다 — 셋업 안에서 걸면 그 사이 대화
    /// 명령이 `state not managed`로 거절되고, L3는 고정 표가 답해 못 본다. 호스트가 둘이면 명령과 종료 훅이 다른 에이전트를
    /// 본다. 변환기 명령이 이 실행 파일 자신이라 `current_exe`는 여기서 한 번만 읽는다(워크플로 §1). 셋업은 헤드리스로 못
    /// 돌리니 자리로 잰다. 호스트 자체는 크레이트 `atelier-acp`의 L1이 잰다.
    #[test]
    fn the_chat_host_stands_once_before_the_builder_and_the_app_holds_it() {
        let run = run_source();
        let builder = run.find("tauri::Builder::default()").expect("빌더가 있다");
        let made = run
            .find("let chats = Arc::new(chat::host(std::env::current_exe().unwrap_or_default(), chat_events));")
            .expect("대화 호스트를 이 실행 파일과 이벤트 채널로 세우지 않는다");
        assert!(made < builder, "대화 호스트({made})를 빌더({builder}) 뒤에서 세운다");
        assert_eq!(run.matches("chat::host(").count(), 1, "대화 호스트를 둘 세운다 — 명령과 종료 훅이 다른 에이전트를 본다");
        assert_eq!(run.matches("current_exe()").count(), 1, "`current_exe`를 진입점 밖에서도 읽는다");
        assert!(
            run.contains(".manage(Arc::clone(&chats))"),
            "대화 호스트를 앱에 안 건다 — 대화 명령이 부를 때마다 `state not managed`로 거절된다"
        );
        let setup = setup_source();
        assert!(
            setup.contains("chat::announce(app.handle().clone(), chat_inbox);"),
            "호스트가 내보낸 것을 화면으로 쏠 스레드를 안 건다 — 답이 흘러도 화면이 조용하다"
        );
        assert!(!setup.contains("ConversationHost>>()"), "셋업이 앱에서 대화 호스트를 다시 찾는다 — 빌더 앞의 값을 건네라");
    }

    /// **감시는 앱이 쥔 그 대화 호스트에게 work가 사라진 소식을 넘긴다**(three-axes 티켓 11 · S10). 사이드바의 아카이브 · 삭제도,
    /// 앱 밖 MCP의 아카이브도 앱이 아는 길은 진행 중 루트의 감시뿐이다 — 셋업이 호스트를 안 넘기면 쉬던 대화의 에이전트가 앱을 끌
    /// 때까지 남는다. 넘기는 것은 빌더 앞에서 세운 그 하나다. 셋업은 헤드리스로 못 돌리니 자리로 잰다. 감시가 소식마다 호스트를 묻는
    /// 규칙은 `watcher.rs`의 단위 검사가, 사라진 work의 대화를 끄는 것은 크레이트 `atelier-acp`의 L1이 잰다.
    #[test]
    fn the_watcher_hands_vanished_works_to_the_chat_host_the_app_holds() {
        let setup = setup_source();
        assert!(
            setup.contains("watcher::start(app.handle().clone(), Arc::clone(&chats));"),
            "감시가 대화 호스트를 받지 않는다 — 아카이브한 work의 쉬던 대화가 앱을 끌 때까지 남는다"
        );
    }

    /// **앱이 닫히면 대화 에이전트도 남김없이 꺼진다**(three-axes 결정 19 · 티켓 05). 셸 정리(`pty::end_for_exit`)는 셸 표식을
    /// 문 것만 끄는데 대화 에이전트는 표식이 없다 — 호스트 끄기가 빠지면 앱을 끈 뒤에도 에이전트가 산다. 둘을 겹쳐 기다리려고
    /// 호스트 끄기를 스레드로 띄우고, **셸 정리 뒤에 반드시 기다린다** — 안 기다리면 프로세스가 끝나며 그 스레드도 사라져
    /// SIGKILL을 아무도 못 보낸다(종료 훅 머리말의 「동기로」). `run()`은 헤드리스로 못 돌리니 자리로 잰다. 호스트 끄기 자체
    /// (stdin 닫기 → 1초 → 그룹째 SIGKILL, 후손 0)는 크레이트 `atelier-acp`의 L1이 잰다.
    #[test]
    fn the_exit_hook_ends_the_chat_agents_beside_the_shells() {
        let run = run_source();
        let exit = run
            .split_once(".run(|app, event| {")
            .expect("앱의 이벤트 훅이 있다")
            .1
            .split_once("if matches!(event, tauri::RunEvent::Exit) {")
            .expect("종료 갈래가 있다")
            .1;
        let held = exit
            .find("let chats = Arc::clone(&app.state::<Arc<atelier_acp::ConversationHost>>());")
            .expect("종료 갈래가 앱이 쥔 대화 호스트를 찾지 않는다 — 명령이 띄운 에이전트가 아닌 것을 끈다");
        let ended = exit.find("std::thread::spawn(move || chats.shut_down());").expect("종료 갈래가 대화 호스트를 안 끈다");
        let shells = exit.find("pty::end_for_exit(").expect("종료 갈래가 셸을 안 닫는다");
        let joined = exit.find("chats_ended.join();").expect("종료 갈래가 호스트 끄기를 안 기다린다 — 스레드가 프로세스와 함께 사라진다");
        assert!(
            held < ended && ended < shells && shells < joined,
            "호스트 찾기({held}) → 호스트 끄기({ended}) → 셸 정리({shells}) → 기다림({joined}) 차례가 아니다"
        );
    }

    /// **진입점은 Tauri를 짓기 전에 첫 인자로 갈라, 정확히 `acp-claude`면 Claude 변환기가 된다**(three-axes 티켓 13, 워크플로
    /// S4 · G17). 대화 호스트가 Claude 대화마다 이 실행 파일 자신을 `acp-claude`로 띄운다(`chat::host`) — 띄우는 쪽과 가르는 쪽이
    /// 같은 상수(`atelier_acp::CLAUDE_TRANSLATOR_MODE`)를 쓰는지도 잰다. Tauri를 지은 뒤에 가르면
    /// 대화마다 Dock 아이콘이 서고 기동이 무거워진다. 갈래가 부르는 함수는 L1이 호스트에 넘기는 변환기 시험 bin과 **같은 함수**다
    /// — 그래야 L1이 잰 변환기가 앱이 띄우는 변환기다. `main`은 헤드리스로 못 돌리니 자리로 잰다. 변환기 자체(플래그 · stdin
    /// `initialize` · 가리기 · stdin EOF)는 크레이트 `atelier-acp`의 L1이 잰다.
    #[test]
    fn the_entry_point_becomes_the_claude_translator_before_tauri_on_acp_claude() {
        let main = without_comment_lines(include_str!("main.rs"));
        let branch = main
            .find("if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new(atelier_acp::CLAUDE_TRANSLATOR_MODE)) {")
            .expect("진입점이 첫 인자가 정확히 하위 모드 상수인지로 가르지 않는다");
        assert_eq!(atelier_acp::CLAUDE_TRANSLATOR_MODE, "acp-claude", "하위 모드의 이름은 `acp-claude`다");
        assert!(
            without_comment_lines(include_str!("chat.rs"))
                .contains("TranslatorCommand::new(exe, [atelier_acp::CLAUDE_TRANSLATOR_MODE])"),
            "대화 호스트가 진입점이 가르는 상수와 다른 인자로 변환기를 띄운다 — 앱의 Claude 대화가 열리지 않는다"
        );
        let translator = main
            .find("std::process::exit(atelier_acp::run_claude_translator());")
            .expect("`acp-claude` 갈래가 변환기의 진입 함수를 부르고 그 종료 코드로 끝나지 않는다");
        let tauri = main.find("atelier_lib::run()").expect("Tauri로 가는 길이 있다");
        assert!(branch < translator && translator < tauri, "갈래({branch}) → 변환기({translator}) → Tauri({tauri}) 차례가 아니다");
        assert!(
            !main[..branch].contains("print"),
            "갈래 앞에서 stdout에 쓴다 — `acp-claude`의 stdout은 곧 ACP 선이다"
        );
        let test_bin = without_comment_lines(include_str!("../../crates/atelier-acp/src/bin/claude-translator.rs"));
        assert!(
            test_bin.contains("std::process::exit(atelier_acp::run_claude_translator())"),
            "변환기 시험 bin이 진입점과 다른 함수를 부른다 — L1이 잰 변환기가 앱이 띄우는 변환기가 아니다"
        );
    }

    /// **화면 새로고침은 대화를 끄지 않는다**(three-axes 구현 스펙 S9). 셸은 새로고침에 거두지만 대화는 기록에서 다시 그린다
    /// — 새로고침 정리가 호스트를 부르면 ⌘R 한 번에 돌던 턴이 끊긴다. 자리로 잰다.
    #[test]
    fn a_page_reload_leaves_the_chat_host_alone() {
        let reload = builder_source()
            .split_once(".on_page_load(")
            .expect("새로고침 정리가 있다")
            .1
            .split_once(".invoke_handler(")
            .expect("새로고침 정리의 끝이 있다")
            .0
            .to_string();
        assert!(reload.contains("pty::end_for_reload("), "새로고침 정리를 못 읽었다 — 자른 자리가 샜다");
        assert!(
            !reload.contains("chat") && !reload.contains("ConversationHost"),
            "새로고침 정리가 대화 호스트를 부른다 — ⌘R 한 번에 돌던 대화가 끊긴다"
        );
    }

    /// `run`의 본문(주석 줄 없이). 자르는 까닭은 `setup_source`와 같다.
    fn run_source() -> String {
        let src = include_str!("lib.rs");
        let body = src
            .split_once("pub fn run() {")
            .expect("`run`이 있다")
            .1
            .split_once("#[cfg(test)]")
            .expect("테스트 모듈의 머리")
            .0;
        assert!(
            !body.contains("mod tests"),
            "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다"
        );
        without_comment_lines(body)
    }

    /// `setup` 클로저의 본문. 소스 스캔이 **테스트 모듈까지 흘러가면 제 문자열을 읽고 스스로
    /// 통과하므로**(pty.rs의 `body_of`가 같은 자리를 막는다) 자르는 자리를 한 곳에 둔다.
    fn setup_source() -> String {
        let src = include_str!("lib.rs");
        let body = src
            .split_once(".setup(move |app| {")
            .expect("여는 표식이 있다")
            .1
            .split_once("\n        })")
            .expect("닫는 표식이 있다")
            .0;
        assert!(
            !body.contains("mod tests"),
            "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다"
        );
        without_comment_lines(body)
    }

    /// 소스를 잘라 함수 하나의 본문만 돌려준다 — `start`에서 `end`까지. **가드가 여기 사는 것이 요점이다.**
    ///
    /// 파일을 읽어 자기 자신을 검사하는 방식은 조용히 새는 자리가 하나 있다: 소스 스캔이 찾는 리터럴은 그것을 찾는 `assert`의
    /// 문자열로도 그 파일에 있으므로, 슬라이스가 테스트 모듈까지 흘러가면 검사가 제 문장을 읽고 스스로 통과한다. 표식이 사라진
    /// 경우는 두 `expect`가 막고, 표식은 있는데 끝이 흘러간 경우는 아래 `assert`가 막는다. 호출자마다 이 줄을 옮겨 적게 두면
    /// 언젠가 한 곳이 빠지므로 — 실제로 `pty.rs`에서 한 번 빠졌다 — 슬라이스를 뽑는 유일한 자리에 둔다. `pty.rs`와
    /// `processes/service.rs`의 자리 핀이 이것을 지난다.
    pub(crate) fn body_of(src: &'static str, start: &str, end: &str) -> &'static str {
        let body = src
            .split_once(start)
            .expect("여는 표식이 있다")
            .1
            .split_once(end)
            .expect("닫는 표식이 있다")
            .0;
        assert!(
            !body.contains("mod tests"),
            "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다"
        );
        body
    }

    /// 주석 줄(`//`로 시작하는 줄)을 비운다. 자리 검사가 **주석 처리된 호출에 속지 않게** —
    /// `// terminate::install(app.handle());`로 꺼 두어도 글자는 남아 검사가 통과한다(fail-closed).
    /// `terminate.rs`의 자리 검사도 이것을 쓴다. 다리(`atelier-test-bridge`)는 크레이트가 달라 사본을 든다.
    pub(crate) fn without_comment_lines(body: &str) -> String {
        body.lines()
            .map(|line| if line.trim_start().starts_with("//") { "" } else { line })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn 자리_검사는_주석_처리된_호출에_안_속는다() {
        let body = "            // terminate::install(app.handle());\n            watcher::start(app.handle().clone());";
        let code = without_comment_lines(body);
        assert!(!code.contains("terminate::install(app.handle());"), "주석으로 꺼 둔 호출을 살아 있다고 읽는다");
        assert!(code.contains("watcher::start(app.handle().clone());"), "주석이 아닌 줄까지 지운다");
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

    /// **클립보드 플러그인이 앱에 걸려 있는가**(codex-ds 스펙 S9). 빠지면 입력칸 · 터미널 메뉴의 붙여넣기가 「없는 명령」으로
    /// 거절당하고, 메뉴는 그 실패를 삼켜 아무것도 안 붙인다 — 앱을 띄워야만 보이는 무음이라 자리로 잰다.
    #[test]
    fn 클립보드_플러그인이_빌더에_걸려_있다() {
        assert!(
            builder_source().contains(".plugin(tauri_plugin_clipboard_manager::init())"),
            "클립보드 플러그인이 안 걸려 있다 — 메뉴의 붙여넣기가 아무것도 안 붙인다"
        );
    }

    /// **열린 클립보드 권한은 읽기 하나다.** 쓰기(복사 · 잘라내기)는 웹 클립보드로 나가고, 플러그인의 기본 권한 묶음은 비어 있다 —
    /// 읽기를 안 열면 붙여넣기가 거절당하고, 더 열면 쓰지 않는 길이 열린다.
    #[test]
    fn 클립보드는_읽기_권한만_열려_있다() {
        let src = include_str!("../capabilities/default.json");
        let cap: serde_json::Value = serde_json::from_str(src).expect("capabilities가 JSON이다");
        let clipboard: Vec<&str> = cap["permissions"]
            .as_array()
            .expect("permissions가 배열이다")
            .iter()
            .map(|one| one.as_str().expect("권한 하나는 문자열이다"))
            .filter(|one| one.starts_with("clipboard-manager:"))
            .collect();
        assert_eq!(clipboard, ["clipboard-manager:allow-read-text"]);
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
    fn builder_source() -> String {
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
        without_comment_lines(body)
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

    /// **⌘Q·메뉴 Quit·Dock 종료의 훅이 셋업 안에서 붙는가**(결정 14 · #224). 훅 자체는 AppKit이 있어야
    /// 돌아 헤드리스로 못 태운다 — 빠지면 나는 일은 조용한 옛 동작이다: ⌘Q 한 번에 묻지 않고 꺼진다.
    /// 셋업 밖(예: `run` 앞)으로 옮기면 델리게이트가 아직 없어 붙이기가 한 줄 로그로 끝나므로 자리까지 본다.
    #[test]
    fn 셋업이_종료_훅을_붙인다() {
        assert!(
            setup_source().contains("terminate::install(app.handle());"),
            "셋업이 `terminate:` 훅을 안 붙인다 — ⌘Q·메뉴 Quit·Dock이 묻지 않고 끈다"
        );
    }

    /// 살리기로 한 것이 다 있는가 — 메뉴 바가 조용히 줄어드는 것을 막는다.
    /// 무엇이 왜 빠졌는지는 `MENU_HOTKEYS` 독이 든다.
    #[test]
    fn 살리기로_한_키가_다_있다() {
        let codes: Vec<String> = view_items().into_iter().map(|(code, _, _)| code).collect();
        for want in ["KeyK", "KeyB", "KeyT", "KeyJ", "Enter"] {
            assert!(codes.iter().any(|one| one == want), "{want}가 메뉴 바에 없다");
        }
        for n in 1..=9 {
            let want = format!("Digit{n}");
            assert!(codes.contains(&want), "{want}가 메뉴 바에 없다");
        }
    }

    /// 결정 3. **`Search`가 View 메뉴 맨 위다.** 다른 항목이 전부 「지금 이 화면의」 무엇인데
    /// 이것만 화면을 안 타고 어디서나 열어서, 목록 첫 줄에 서는 것이 읽힌다.
    ///
    /// **자리를 세는 검사가 여기 필요한 이유가 있다.** 표의 순서가 곧 메뉴의 순서인데, 다음 사람이
    /// 표를 알파벳순으로 정리하면 조용히 밀린다. 위 「다 있다」는 자리를 안 보므로 이것을 대신하지 못한다.
    /// 재는 것은 표가 아니라 표에서 만든 메뉴의 첫 칸이다 — 금이 맨 앞에 끼어도 빨개진다.
    #[test]
    fn 검색이_메뉴의_맨_앞이다() {
        match view_entries(&MENU_HOTKEYS).first() {
            Some(ViewEntry::Item { id, label, accelerator }) => {
                assert_eq!((id.as_str(), *label, accelerator.as_str()), ("hotkey:KeyK", "Search", "CmdOrCtrl+K"));
            }
            other => panic!("View 메뉴의 첫 칸이 검색이 아니다 — {other:?}"),
        }
    }

    /// **구분선이 한 자리에만 그어진다.** `view_entries`는 「첫 `Digit*` 항목 앞」에서 한 번만
    /// 금을 긋는데(자리를 안 세고 갈래로 가른다), 그 규칙이 뜻대로 되려면 번호 항목들이
    /// **표 뒤쪽에 몰려 있어야** 한다. 섞이면 금이 엉뚱한 자리에 서고 뒤에 오는 번호들이
    /// 얼개 항목들과 한 무리로 읽힌다 — 눈으로만 보이는 어긋남이라 아무도 안 잡는다.
    ///
    /// ⌘K를 맨 앞에 끼운 것이 금을 안 움직인다는 것도 이 성질이 말한다.
    #[test]
    fn 번호_항목이_메뉴_뒤쪽에_몰려_있다() {
        let entries = view_entries(&MENU_HOTKEYS);
        let lines: Vec<usize> =
            entries.iter().enumerate().filter(|(_, entry)| **entry == ViewEntry::Line).map(|(at, _)| at).collect();
        assert_eq!(lines.len(), 1, "금이 한 번이 아니다 — {lines:?}");
        let digit = |entry: &ViewEntry| matches!(entry, ViewEntry::Item { id, .. } if id.starts_with("hotkey:Digit"));
        assert!(!entries[..lines[0]].iter().any(digit), "금 앞에 번호 항목이 있다");
        assert!(
            entries[lines[0] + 1..].iter().all(digit),
            "번호 항목 사이에 다른 항목이 끼었다 — 구분선이 엉뚱한 자리에 선다"
        );
    }

    /// **「방금 부른 셸로」(⌘J)가 번호 항목들 앞에 선다**(프로세스 스펙 P3 · 티켓 23). 금은 「첫 `Digit*` 항목 앞」에 한 번만
    /// 그어지므로(`번호_항목이_메뉴_뒤쪽에_몰려_있다`), 번호 뒤에 붙이면 그 검사가 빨개지고 번호 사이에 끼우면 금이 엉뚱한 자리에
    /// 선다. 자리를 못 박는 것은 위 「맨 앞이다」와 같은 까닭이다 — 표의 순서가 곧 메뉴의 순서다.
    #[test]
    fn 방금_부른_셸로가_번호_항목들_앞에_선다() {
        let items = view_items();
        let at = items.iter().position(|(code, _, _)| code == "KeyJ").expect("⌘J가 메뉴 바에 없다");
        let first_digit = items.iter().position(|(code, _, _)| code.starts_with("Digit")).expect("번호 항목이 없다");
        assert!(at < first_digit, "⌘J({at})가 번호 항목({first_digit}) 뒤에 있다");
        assert_eq!(items[at].1, "Last Calling Shell");
    }

    /// **시작 보고의 자리가 앱에 서는가**(프로세스 스펙 S11). 명령은 그 자리를 `State`로 찾는데, `manage`가
    /// 빠지면 Tauri는 부를 때마다 거절하고(`state not managed`) 프런트는 그 거절을 「알릴 것 없음」으로
    /// 삼킨다 — 시작 때 무엇을 치워도 토스트가 영영 안 선다. L3는 고정 표가 답하고 L4는 다리가 거절하므로
    /// 이 빠짐을 어느 층도 못 본다. 그래서 셸 신호의 세 자리처럼 **자리로** 잰다.
    ///
    /// **시작 때 할 일의 몫을 그 자리에서, 빌더보다 먼저 센다** — 시작 정리(티켓 10)와 훅 맞춤(티켓 21). 웹뷰는 셋업의 앱 몫보다
    /// 먼저 선다 — 셋업 안에서 세면 그 사이에 온 물음이 그 일을 안 기다리고 빈 보고를 받는다. 다른 자리에서 세면 묻는 쪽이 그
    /// 몫을 영영 모른다.
    #[test]
    fn the_startup_report_has_a_holder_when_the_app_comes_up() {
        let run = run_source();
        let holder = run.find("let report = Arc::new(startup::ReportHolder::default());").expect("시작 보고의 자리를 안 세운다");
        let builder = run.find("tauri::Builder::default()").expect("빌더가 있다");
        for (chore, what) in [("let cleanup = report.chore();", "시작 정리"), ("let hook_sync = report.chore();", "훅 맞춤")] {
            let counted = run.find(chore).unwrap_or_else(|| panic!("{what}의 몫을 그 자리에서 안 센다"));
            assert!(
                holder < counted && counted < builder,
                "{what}의 몫을 빌더보다 먼저 세지 않는다 — 웹뷰가 먼저 서서 묻는 사이 그 일을 안 기다린다"
            );
        }
        assert!(
            run.contains(".manage(Arc::clone(&report))"),
            "몫을 센 그 자리를 앱에 안 건다 — 프런트가 물을 때마다 거절되거나, 다른 자리가 몫을 모른다"
        );
    }

    /// **훅 맞춤은 처리기가 디스크에 선 뒤에만 돈다**(티켓 21). 맞춤은 사용자의 설정이 새 처리기(`<데이터 루트>/hooks/…zsh`)를
    /// 가리키게 고친다 — 그 파일을 못 세웠는데 설정만 고치면 에이전트가 매 턴 없는 파일을 부르고, 처리기는 fail-open이라 그것이
    /// 어디에도 안 보인다. 그래서 세우기가 된 갈래에서만 맞춘다. 고칠 설정은 진짜 홈의 것(`hooks::agent_home`)이고 처리기는 이
    /// 실행의 데이터 루트의 것이다. 셋업은 헤드리스로 못 돌리니(`run()`) 자리로 잰다 — 맞춤이 무엇을 쓰는지는 `startup.rs`의
    /// `the_hook_sync_runs_on_the_homes_it_is_given_and_reports_what_it_wrote`가 임시 홈에서 재고, 루트를 옮긴 실행(`ATELIER_HOME`)이
    /// 진짜 설정을 안 건드리는 것은 `a_run_on_a_moved_data_root_leaves_the_homes_hooks_alone`이, 이 줄이 건네는 두 입력이 설치본에서
    /// 기본 자리로 읽히는 것은 `the_installed_apps_home_and_root_are_synced`가 잰다.
    #[test]
    fn the_hook_sync_runs_once_the_handler_stands() {
        let setup = setup_source();
        let written = setup.find("match shells::write_hook_scripts(&root) {").expect("처리기를 세운 결과로 가르지 않는다");
        let synced = setup
            .find("Ok(()) => startup::sync_hooks(hook_sync, hooks::agent_home(), root.clone()),")
            .expect("처리기를 세운 갈래에서 위에서 센 몫으로 훅 맞춤을 안 부른다 — 이미 깐 훅이 옛 처리기에 남거나 보고가 그것을 안 기다린다");
        assert!(written < synced, "훅 맞춤({synced})이 처리기 세우기({written})보다 앞에 있다");
        assert_eq!(setup.matches("startup::sync_hooks(").count(), 1, "훅 맞춤을 두 번 부른다");
    }

    /// **앱이 뜰 때마다 Library의 기본 Agent 파일을 세운다**(v1 구현 스펙 S14 · v1 티켓 03). 이 줄이 빠지면 처음 실행한 사람의
    /// Library에 `host.md`가 없어 Host가 서지 않는데, 그것은 첫 말을 보낼 때에야 드러난다. 세우는 규칙(없을 때만 · 있는 파일은
    /// 덮지 않음)은 core `agents.rs`의 시험이 임시 폴더에서 잰다. 셋업은 헤드리스로 못 돌리니 자리로 잰다.
    #[test]
    fn the_default_agents_stand_in_the_library_on_every_launch() {
        let setup = setup_source();
        assert_eq!(
            setup.matches("atelier_core::ensure_default_agents(&root)").count(),
            1,
            "셋업이 이 실행의 데이터 루트로 기본 Agent 파일을 한 번 세우지 않는다"
        );
    }

    /// **시작 정리는 인스턴스 기록을 연 뒤에 돈다**(프로세스 스펙 「시작 시 확정 고아 자동 정리」 · 티켓 10). 먼저 돌면 남의
    /// 기록을 못 읽어(`Record::records`가 빈 목록) 모든 떠돌이가 출처 불명이 되고, 크래시한 실행의 고아가 영영 안 치워진다
    /// — 조용하다. 셋업은 헤드리스로 못 돌리니(`run()`) 자리로 잰다. 정리가 무엇을 고르고 끝내는지는 `pty.rs`의 실물 장면
    /// `Startup`이 잰다.
    #[test]
    fn the_startup_cleanup_runs_after_the_record_opens() {
        let setup = setup_source();
        let opened = setup.find("pty::open_record(").expect("인스턴스 기록을 여는 줄이 있다");
        let cleaned = setup
            .find("startup::clean_up(cleanup, Arc::clone(&pool));")
            .expect("셋업이 시작 정리를 위에서 센 몫으로 안 부른다 — 지난 실행의 고아가 안 치워지거나 보고가 그것을 안 기다린다");
        assert!(opened < cleaned, "시작 정리({cleaned})가 기록을 열기({opened}) 전에 돈다 — 남의 기록을 못 읽는다");
    }

    /// **nav 메타의 배경 표본은 인스턴스 기록을 연 뒤에 건다**(티켓 29). 먼저 걸면 첫 판정이 남의 기록을 못 읽어(`Record::records`가
    /// 빈 목록) 함께 뜬 다른 빌드(dev · 설치본)의 셸 자손이 모두 출처 불명으로 서고 — 뜨자마자 `●`가 선다. 표본이 한 번뿐이어야 박자가
    /// 하나다(10초). 셋업은 헤드리스로 못 돌리니 자리로 잰다. 모으는 순서는 `processes::service`의 핀이 잰다.
    #[test]
    fn the_background_sample_starts_after_the_record_opens() {
        let setup = setup_source();
        let opened = setup.find("pty::open_record(").expect("인스턴스 기록을 여는 줄이 있다");
        let sampled = setup
            .find("Arc::clone(&process_service).sample_in_background();")
            .expect("셋업이 배경 표본을 안 건다 — 화면이 닫혀 있으면 nav 메타의 합계가 안 바뀐다");
        assert!(opened < sampled, "배경 표본({sampled})이 기록을 열기({opened}) 전에 걸린다 — 첫 장이 남의 셸 자손을 출처 불명으로 본다");
        assert_eq!(setup.matches("sample_in_background(").count(), 1, "배경 표본을 두 번 건다 — 박자가 둘이다");
    }

    /// **웹뷰에게 WebContent를 물을 길은 배경 표본보다 먼저 건다**(프로세스 스펙 S39 · 티켓 30). 안 걸면 조용하다 — 요약은 잘 서는데
    /// 앱 본체가 늘 Rust 본체뿐이고 「웹뷰 제외」가 영영 붙는다. 늦게 걸면 첫 장이 웹뷰 없이 서 추이의 첫 점이 그만큼 낮다. 묻는
    /// 함수는 창을 다시 찾는 앱 핸들을 쥔다 — 창을 쥐면 그 창이 다시 서도 옛 창에 묻는다. 셋업은 헤드리스로 못 돌리니 자리로 잰다.
    /// 물음이 앱 본체에 드는 것은 `processes::service`의 실물 검사가, SPI가 이 맥에 있는지는 `webview.rs`의 검사가 잰다.
    #[test]
    fn the_web_content_is_asked_for_before_the_background_sample_starts() {
        let setup = setup_source();
        let asked = setup
            .find("process_service.ask_web_content_with(move || webview::content_pid(&asker));")
            .expect("셋업이 웹뷰에게 WebContent를 물을 길을 안 건다 — 앱 본체가 늘 「웹뷰 제외」다");
        let sampled = setup.find("sample_in_background(").expect("배경 표본을 건다");
        assert!(asked < sampled, "물을 길({asked})이 배경 표본({sampled}) 뒤에 걸린다 — 첫 장이 웹뷰 없이 선다");
        assert!(setup.contains("let asker = app.handle().clone();"), "묻는 함수가 앱 핸들이 아닌 것을 쥔다");
    }
}
