import table from "./hotkeys.json";

// **단축키 표 — 앱의 단축키는 곁의 `hotkeys.json` 한 장에만 적는다**(codex-ds 결정 19 · 스펙 §8 · S16). macOS 메뉴 바(`src-tauri/src/
// lib.rs`가 빌드 때 그 파일을 싣는다) · 메뉴 오른쪽 단축키 칸(`DropdownMenuItem`의 `shortcut`) · 툴팁(`Hint`의 `shortcut`) · 키 판정
// (`searchHotkey` · `shellHotkey` · `shellNavKey` · `recallHotkey` · `togglesPanel` · ⌘B · 항목 옮기기)이 그 표를 읽어, 어디서 본
// 단축키든 같다. 키를 하나 옮길 때 고치는 곳이 그 한 장이다. 한때 이 사실들은 메뉴 바(`lib.rs`가 손으로 적은 목록과 ⌘,) · 툴팁
// 글자 · 화면별 keydown에 따로 적혀 있었다.
//
// **표가 JSON인 것은 두 언어가 함께 읽어서다.** 주석을 못 다는 대신 항목의 뜻을 여기 적는다. 항목은 이름(`HotkeyId`)마다 하나이고
// 드는 것은 다섯이다.
// - `code` — 물리 키(`KeyboardEvent.code`). **`key`가 아니라 `code`로 본다**: 한글 입력기가 켜져 있으면 `key`가 자모로 온다. 한 키가
//   두 자리에 있으면(숫자 패드 Enter) 판정은 둘을 같은 `code`로 본다(`SAME_KEY`) — 메뉴 바의 가속키는 본 자판 Enter만 받는다.
// - `mods` — 함께 눌러야 하는 수식키. 판정은 **넷이 꼭 맞을 때만** 그 키다 — 하나라도 더 붙으면 아니다(⌘⇧K는 ⌘K가 아니고, 셸 몫의
//   화음을 근거 없이 넓히지 않는다 — in-app-terminal 결정 29). 차례는 ⌃ ⌥ ⇧ ⌘(macOS가 메뉴에 적는 차례)다.
// - `glyph` — 보이는 글자(⌘K). 툴팁 Kbd · 메뉴 단축키 칸 · 안내 문장이 이것을 그대로 쓴다. `code` · `mods`에서 나오는 글자와 같은지는
//   `hotkeys.test.ts`가 본다.
// - `aria` — `aria-keyshortcuts` 값(Meta+K). 스크린리더가 듣는 쪽이고, 같은 검사가 본다.
// - `menu` — macOS 메뉴 바 View 메뉴의 라벨이고, `null`이면 View 메뉴에 서지 않는다. 이 표와 그 검사들에서 「메뉴 바 항목」은 이 칸이
//   있는 줄이다 — 프레임에 포커스가 들어가도 메뉴가 대신 받아 되살린다(`menu-hotkey.ts`). 차례가 곧 View 메뉴의 차례다 — 검색이 처음,
//   ⌘J가 숫자 앞, 숫자가 끝이다(`lib.rs`의 검사).
//
// **⌘,(`settings`)는 메뉴 바에 서되 View 메뉴가 아니다** — 앱 메뉴의 Settings…다. 자리는 macOS 관습(About 아래)이고, 되살림 항목이
// 아니라 설정을 여는 항목이라 `menu`가 없다. `lib.rs`의 `build_menu`가 이 줄에서 가속키만 만든다(`SETTINGS_ACCELERATOR`). 웹뷰의
// keydown에는 오지 않는 키라(OS 메뉴가 먼저 먹는다 — `lib.rs`의 `SETTINGS_MENU_ID`) 판정 함수가 없다.
//
// 메뉴 바에 서지 않는 것들과 그 까닭(`lib.rs`의 `MENU_HOTKEYS` 독이 메뉴 쪽 사정을 든다):
// - ⌘W — 그 메뉴 항목이 있으면 OS가 웹뷰보다 먼저 먹어 창이 닫히고 셸이 전부 죽는다.
// - ⌃Tab · ⌃⇧Tab — 항목은 서는데 accelerator 경로만 죽는다(실측).
// - F2(이름 바꾸기) · ⇧F10과 메뉴 키(대상 메뉴) — 무엇에 거는지가 포커스에 달려 있다(codex-ds 스펙 §8). 뜻은 티켓 27 · 28이 잇는다.
// - ⌥↑ ⌥↓ ⌥← ⌥→(spec 레이아웃 편집기 트리의 항목 옮기기) · Esc(떠 있는 창 닫기) — 한 화면 안의 키다.
//
// **표 밖에 남는 키는 단축키가 아니거나 앱이 적지 않은 키다.**
// - 목록 안 ↑↓ · ↵ — 목록 안 움직임이다(검색 팔레트 바닥 줄의 「↑↓ 고르기 · ↵ 열기」, 메뉴 부품의 줄 옮기기). 새 단축키는 F2 · ⇧F10 ·
//   메뉴 키뿐이라는 것(결정 19)이 그 가름을 말한다.
// - 입력 칸 · 셸 안의 편집 키 — 프로젝트 설명 칸의 ⌘Enter(저장) · Esc(그만두기, `ProjectDetail`), 셸에 줄 바꿈 바이트를 보내는
//   ⇧Enter(`shellRewrite`). 그 칸에 글을 쓰는 동안만 뜻이 있다.
// - macOS 기본 메뉴 항목의 키(Edit의 ⌘Z · ⌘C · ⌘V · ⌘A, 앱 메뉴의 ⌘H · ⌘Q, Window의 ⌘M …) — Tauri의 기본 항목이 OS 관습대로 달고
//   앱은 적지 않는다(`lib.rs`의 `build_menu`).
//
// **값 import는 JSON 한 장뿐이다.** 셸 레지스트리처럼 DOM 없는 순수 모듈이 이것을 값으로 들이므로(`shell-registry.test.ts`의 소스 스캔이
// 이 파일까지 본다) 여기서 React · DOM을 끌어오지 않는다.

/** 표의 항목 이름 — `hotkeys.json`의 키다. 없는 이름은 타입이 막는다. */
export type HotkeyId = keyof typeof table;

/** 수식키 넷. 표에는 ⌃ ⌥ ⇧ ⌘ 차례로 적는다. */
export type Modifier = "ctrl" | "alt" | "shift" | "meta";

/** 표의 한 줄. 무엇을 드는지는 머리말이 적는다. */
export interface Hotkey {
  code: string;
  mods: readonly Modifier[];
  glyph: string;
  aria: string;
  menu: string | null;
}

export const HOTKEYS = table as Record<HotkeyId, Hotkey>;

/**
 * 판정이 키에서 보는 것 전부 — 물리 키와 수식키 넷. `KeyboardEvent`를 이름으로 받지 않는 것은 DOM 없는 환경에서 객체 리터럴 하나로
 * 부르려는 것이다(`shell-registry.ts`의 `KeyPress`와 같은 까닭).
 */
export interface KeyChord {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * 한 키가 두 자리에 있는 것 — 숫자 패드의 Enter(맥북은 fn+Return)는 `code`만 `NumpadEnter`로 갈리고 `key`는 같은 Enter다. 표의
 * `Enter`는 두 자리를 다 받는다 — ⌘Enter 판정이 `key`를 보던 때도 그랬고, 셸 입력의 판정도 숫자 패드 Enter를 Enter로 읽는다
 * (`shell-input`). 숫자 패드 숫자는 넣지 않는다 — ⌘1~9는 표에 앞서서도 줄 위 숫자 키(`Digit*`)만 받았다.
 */
const SAME_KEY: Readonly<Record<string, string>> = { NumpadEnter: "Enter" };

/**
 * 그 키가 표의 그 항목인가 — `code`가 같고(한 키의 두 자리는 같은 `code`로 본다 — `SAME_KEY`) 수식키 넷이 꼭 맞을 때만이다.
 *
 * **눌렀는가(`keydown`)는 안 본다.** 「무슨 키인가」만 답한다 — `keydown`에서만 듣는 자리는 그대로 두고, 이벤트 종류를 함께 받는
 * 판정(`searchHotkey` …)은 저마다 그것을 먼저 거른다.
 */
export function pressed(event: KeyChord, id: HotkeyId): boolean {
  const { code, mods } = HOTKEYS[id];
  return (
    (SAME_KEY[event.code] ?? event.code) === code &&
    event.ctrlKey === mods.includes("ctrl") &&
    event.altKey === mods.includes("alt") &&
    event.shiftKey === mods.includes("shift") &&
    event.metaKey === mods.includes("meta")
  );
}

/** ⌘1~9 — 차례가 곧 번호다(⌘1이 맨 앞). 한 화면 안에서 본문을 옮기는 키다(`shellNavKey`). */
export const TAB_HOTKEYS = [
  "tab1",
  "tab2",
  "tab3",
  "tab4",
  "tab5",
  "tab6",
  "tab7",
  "tab8",
  "tab9",
] as const satisfies readonly HotkeyId[];

/** 메뉴 바 항목(View 메뉴에 서는 줄) 가운데 물리 키가 `code`인 것. 메뉴 바 항목끼리는 `code`가 겹치지 않는다(`hotkeys.test.ts`). */
export function menuHotkeyOf(code: string): Hotkey | null {
  return Object.values(HOTKEYS).find((one) => one.menu !== null && one.code === code) ?? null;
}
