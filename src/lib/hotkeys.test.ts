import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchHotkey, shellHotkey, shellNavKey } from "@/features/terminal/shell-registry";
import { recallHotkey } from "@/features/terminal/shell-recall";
import { togglesPanel } from "@/components/shell/PanelToggle";
import { opensTargetMenu } from "@/components/ui/context-menu";
import { HOTKEYS, menuHotkeyOf, pressed, TAB_HOTKEYS, type HotkeyId, type Modifier } from "./hotkeys";

// codex-ds 티켓 26 — **단축키 표**(`hotkeys.json`, 결정 19 · 스펙 S16 · 「Testing Decisions」 경계 ③). 표는 데이터 한 장이고, 메뉴 바
// (`lib.rs`) · 툴팁 · 메뉴 단축키 칸 · 키 판정이 그것을 읽는다. 여기서 재는 것은 둘이다.
// - **표가 제 말과 맞는가** — 보이는 글자와 `aria-keyshortcuts` 값이 키 코드 · 수식키에서 나온 것과 같다. 표에 손으로 적은 글자가 키와
//   어긋나면(⌘K 줄에 ⌘J) 툴팁 · 메뉴가 사람에게 틀린 키를 가르친다.
// - **판정 함수가 아는 키가 모두 표에 있는가** — 판정이 표 밖의 키를 받으면 그 키는 툴팁에도 메뉴 바에도 없는 숨은 단축키가 된다.
//   판정마다 키 전부(아래 `키들` × 수식키 열여섯)를 넣어 받는 것을 모으고, 그것이 표의 항목인지 본다.
//
// **보이는 글자를 표에 적고 여기서 맞대는 것은 accelerator와 다르다**(`lib.rs`의 `accelerator를_수식키와_code에서_만든다`가 그 칸을
// 걷은 사연을 든다). 표는 사람이 읽는 한 장이라 키 옆에 그 글자가 서야 하고(스펙 §8), 글자에는 고른 이름이 섞여 있다(Esc · Menu ·
// ↩가 아니라 Enter) — 아래 `keyGlyphOf`가 그 고름을 못박는다.
//
// 메뉴 바 쪽(차례 · ⌘W 없음 · F2 · ⇧F10이 메뉴 바에 없음)은 `src-tauri/src/lib.rs`의 테스트가 표에서 만든 메뉴를 재고, 화면 쪽(툴팁 ·
// 메뉴 칸의 글자와 값)은 L3 `e2e/hotkeys.spec.ts`가 잰다.

const ids = Object.keys(HOTKEYS) as HotkeyId[];

/** 수식키의 차례와 글자 · `aria-keyshortcuts` 이름 — macOS가 메뉴에 적는 차례(⌃ ⌥ ⇧ ⌘)다. */
const MODIFIERS: { mod: Modifier; glyph: string; aria: string }[] = [
  { mod: "ctrl", glyph: "⌃", aria: "Control" },
  { mod: "alt", glyph: "⌥", aria: "Alt" },
  { mod: "shift", glyph: "⇧", aria: "Shift" },
  { mod: "meta", glyph: "⌘", aria: "Meta" },
];

/** 구두점 키의 글자 — 보이는 글자도 `aria-keyshortcuts`(그 키의 `KeyboardEvent.key`)도 이것이다. */
const PUNCTUATION: Record<string, string> = { Comma: "," };

/** 키 코드에서 나온 보이는 글자의 키 부분 — 글자 · 숫자 · 구두점은 그 글자, 화살표는 화살표, 나머지는 이름(Esc · Menu만 줄인다). */
function keyGlyphOf(code: string): string {
  const named: Record<string, string> = {
    ...PUNCTUATION,
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Escape: "Esc",
    ContextMenu: "Menu",
  };
  return /^(?:Key|Digit)(.)$/.exec(code)?.[1] ?? named[code] ?? code;
}

/** 키 코드에서 나온 `aria-keyshortcuts`의 키 부분 — 글자 · 숫자 · 구두점은 그 글자, 나머지는 `KeyboardEvent.key`의 이름(코드와 같다). */
function keyAriaOf(code: string): string {
  return /^(?:Key|Digit)(.)$/.exec(code)?.[1] ?? PUNCTUATION[code] ?? code;
}

describe("표가 제 말과 맞는다", () => {
  // 앵커: 표가 비어 있으면 아래 `it.each`가 하나도 안 돌고 초록이다.
  it("항목이 있다 — 지금 단축키와 새 셋(F2 · ⇧F10 · 메뉴 키), 편집 메뉴 · 터미널 메뉴가 단축키 칸에 적는 편집 넷", () => {
    expect(ids.length).toBeGreaterThan(14);
    for (const id of ["search", "rename", "openMenu", "menuKey", "cut", "copy", "paste", "selectAll"] as const)
      expect(ids).toContain(id);
  });

  it.each(ids)("%s — 수식키는 넷 가운데서 ⌃ ⌥ ⇧ ⌘ 차례로 한 번씩 적는다", (id) => {
    const order = MODIFIERS.map(({ mod }) => mod);
    const mods = HOTKEYS[id].mods;
    expect(mods.every((one) => order.includes(one)), `${mods}`).toBe(true);
    expect([...mods].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual([...new Set(mods)]);
  });

  it.each(ids)("%s — 보이는 글자가 키 코드에서 나온 글자다", (id) => {
    const { code, mods, glyph } = HOTKEYS[id];
    const lead = MODIFIERS.filter(({ mod }) => mods.includes(mod)).map((one) => one.glyph).join("");
    expect(glyph).toBe(lead + keyGlyphOf(code));
  });

  it.each(ids)("%s — aria-keyshortcuts 값이 키 코드에서 나온 값이다", (id) => {
    const { code, mods, aria } = HOTKEYS[id];
    const lead = MODIFIERS.filter(({ mod }) => mods.includes(mod)).map((one) => one.aria);
    expect(aria).toBe([...lead, keyAriaOf(code)].join("+"));
  });

  // 같은 화음이 두 항목이면 판정은 앞의 것만 보고, 툴팁은 두 이름으로 같은 키를 가르친다.
  it("같은 화음이 두 번 없다", () => {
    const chords = ids.map((id) => `${HOTKEYS[id].mods.join("+")} ${HOTKEYS[id].code}`);
    expect(new Set(chords).size).toBe(chords.length);
  });

  // 메뉴는 항목 id에 code를 싣고 프런트는 그 code로 항목을 되찾는다(`menuHotkeyOf`) — 겹치면 뒤 항목의 클릭이 앞 항목으로 간다.
  it("메뉴 바 항목끼리는 키 코드도 라벨도 겹치지 않는다", () => {
    const bar = ids.map((id) => HOTKEYS[id]).filter((one) => one.menu !== null);
    expect(bar.length, "메뉴 바 항목이 없다").toBeGreaterThan(0);
    expect(new Set(bar.map((one) => one.code)).size).toBe(bar.length);
    expect(new Set(bar.map((one) => one.menu)).size).toBe(bar.length);
    for (const one of bar) expect(menuHotkeyOf(one.code)).toBe(one);
  });

  // 편집 넷은 macOS Edit 메뉴(`lib.rs`의 `build_menu`가 기본 항목으로 세운다)의 키다 — View 메뉴에도 서면 한 키에 메뉴 항목이 둘이다.
  it("메뉴 바에 서지 않는 항목의 키 코드로는 메뉴 바 항목을 못 찾는다", () => {
    for (const id of ["closeShell", "cut", "copy", "paste", "selectAll"] as const) {
      expect(HOTKEYS[id].menu, id).toBeNull();
      expect(menuHotkeyOf(HOTKEYS[id].code), id).toBeNull();
    }
  });

  // ⌘1~9의 번호는 차례에서 나온다(`shellNavKey`) — 차례가 섞이면 ⌘3이 둘째 칸으로 간다.
  it("탭 번호 키는 ⌘1부터 ⌘9까지 차례대로다", () => {
    expect(TAB_HOTKEYS.map((id) => HOTKEYS[id].code)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `Digit${n}`));
  });
});

describe("판정은 표의 키를 꼭 맞게 본다", () => {
  const chord = (code: string, mods: readonly Modifier[]) => ({
    code,
    ctrlKey: mods.includes("ctrl"),
    altKey: mods.includes("alt"),
    shiftKey: mods.includes("shift"),
    metaKey: mods.includes("meta"),
  });

  it.each(ids)("%s — 표의 화음이면 그 항목이다", (id) => {
    expect(pressed(chord(HOTKEYS[id].code, HOTKEYS[id].mods), id)).toBe(true);
  });

  // 한 키의 두 자리 — 숫자 패드 Enter(맥북은 fn+Return)는 `code`만 갈린 같은 Enter다. 숫자 패드 숫자는 ⌘1~9가 아니다(줄 위 숫자 키만).
  it("숫자 패드 Enter는 표의 Enter다 — 숫자 패드 숫자는 탭 번호 키가 아니다", () => {
    expect(pressed(chord("NumpadEnter", ["meta"]), "panel")).toBe(true);
    expect(pressed(chord("Numpad1", ["meta"]), "tab1")).toBe(false);
  });

  // 수식키가 하나라도 더 붙거나 빠지면 아니다 — ⌘⇧K는 ⌘K가 아니다(셸 몫의 화음을 근거 없이 넓히지 않는다).
  it.each(ids)("%s — 수식키가 하나라도 갈리면 아니다", (id) => {
    const { code, mods } = HOTKEYS[id];
    for (const { mod } of MODIFIERS) {
      const flipped = mods.includes(mod) ? mods.filter((one) => one !== mod) : [...mods, mod];
      expect(pressed(chord(code, flipped), id), mod).toBe(false);
    }
  });
});

// ── 판정 함수가 아는 키 ⊂ 표 ──

/** 판정에 넣어 볼 키 — 글자 · 숫자 · 기능 키 · 화살표와 그 밖의 흔한 키. 판정이 이 밖의 키를 받을 수도 있지만, 표 밖의 단축키가 생기는 길은 이것들이다. */
const 키들 = [
  ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => `Key${c}`),
  ...[..."0123456789"].map((d) => `Digit${d}`),
  ...Array.from({ length: 12 }, (_, n) => `F${n + 1}`),
  ...["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  // 쪽 넘기기 · 처음 · 끝 · 끼우기 — ⌃PageDown · ⌃PageUp은 탭 넘기기에 흔한 화음이다.
  ...["PageUp", "PageDown", "Home", "End", "Insert"],
  ...["Enter", "NumpadEnter", "Tab", "Escape", "Space", "Backspace", "Delete", "ContextMenu"],
  ...["Comma", "Period", "Slash", "Backslash", "BracketLeft", "BracketRight", "Backquote", "Minus", "Equal", "Semicolon", "Quote"],
];

/** 수식키 넷의 조합 열여섯. */
const 조합들: Modifier[][] = Array.from({ length: 16 }, (_, bits) =>
  MODIFIERS.filter((_, at) => bits & (1 << at)).map(({ mod }) => mod),
);

/** 판정이 받는 화음 — `mods code` 꼴. */
function 아는키(judge: (event: ReturnType<typeof keydown>) => unknown): string[] {
  return 키들.flatMap((code) =>
    조합들.filter((mods) => Boolean(judge(keydown(code, mods)))).map((mods) => `${mods.join("+")} ${code}`),
  );
}

/** 판정 하나에 넣는 키 — 판정마다 보는 필드가 달라 모두 싣는다. 자리는 평범한 요소다(입력 칸 · 셸이 아니다). */
function keydown(code: string, mods: readonly Modifier[]) {
  return {
    type: "keydown",
    code,
    ctrlKey: mods.includes("ctrl"),
    altKey: mods.includes("alt"),
    shiftKey: mods.includes("shift"),
    metaKey: mods.includes("meta"),
    target: new EventTarget(),
  };
}

const 표의화음 = new Set(ids.map((id) => `${HOTKEYS[id].mods.join("+")} ${HOTKEYS[id].code}`));

/** 한 키의 두 자리 — 받은 화음을 표와 견줄 때 숫자 패드 Enter를 Enter로 접는다(위 「숫자 패드 Enter는 표의 Enter다」). */
const 같은키: Record<string, string> = { NumpadEnter: "Enter" };
const 표에있다 = (chord: string) => {
  const [mods, code] = chord.split(" ");
  return 표의화음.has(`${mods} ${같은키[code] ?? code}`);
};

describe("판정 함수가 아는 키는 모두 표에 있다", () => {
  // `togglesPanel`은 입력 자리를 `instanceof`로 가른다 — 노드에는 그 생성자가 없어 세워 둔다(`PanelToggle.test`와 같다).
  beforeEach(() => {
    vi.stubGlobal("HTMLTextAreaElement", class extends EventTarget {});
    vi.stubGlobal("HTMLInputElement", class extends EventTarget {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 앵커는 판정마다 받는 키의 수다 — 0이면 아래 「⊂」가 저절로 초록이다.
  it.each([
    ["검색(searchHotkey)", searchHotkey, 1],
    ["셸(shellHotkey)", shellHotkey, 14],
    ["셸 넘기기(shellNavKey)", shellNavKey, 11],
    ["부르는 셸(recallHotkey)", recallHotkey, 1],
    // ⌘Enter와 ⌘ + 숫자 패드 Enter — 한 키의 두 자리다.
    ["패널(togglesPanel)", togglesPanel, 2],
    // ⇧F10과 메뉴 키 — 포커스한 대상의 메뉴를 연다(codex-ds 티켓 27).
    ["대상 메뉴(opensTargetMenu)", opensTargetMenu, 2],
  ] as const)("%s", (_이름, judge, count) => {
    const known = 아는키(judge as (event: ReturnType<typeof keydown>) => unknown);
    expect(known).toHaveLength(count);
    expect(known.filter((one) => !표에있다(one))).toEqual([]);
  });
});
