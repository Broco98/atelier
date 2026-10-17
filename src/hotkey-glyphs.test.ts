/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { blankComments } from "./blank-comments";

// **단축키 글자 지킴**(codex-ds 결정 19 · 스펙 「Testing Decisions」 경계 ② · 티켓 26). 단축키는 `src/lib/hotkeys.json` 한 장에만 적고,
// 툴팁(`Hint`의 `shortcut`) · 메뉴 단축키 칸(`DropdownMenuItem`의 `shortcut`) · 안내 문장의 Kbd(`HOTKEYS.<항목>.glyph`)가 그 표를
// 읽는다. 표 밖에서 손으로 적은 단축키는 표와 조용히 갈린다 — 키를 옮긴 날 메뉴 바는 새 키를, 그 툴팁은 옛 키를 가르친다. 그래서
// 표 밖의 이 꼴들을 막는다.
//   - **수식키 글리프**(⌘ ⌃ ⌥ ⇧)가 든 글자 — `"⌘Enter"` · `<Kbd>⌘T</Kbd>` · `"⌥↑"`. 화면에 서는 수식키 글자는 단축키 표의 것뿐이다.
//   - **`aria-keyshortcuts`의 리터럴 값** — `aria-keyshortcuts="Meta+K"`. 그 값은 표의 `aria`이고 `Hint` · 메뉴 항목이 단다.
//   - **Kbd 안의 날글자** — `<Kbd>Esc</Kbd>` · `<Kbd>{"Esc"}</Kbd>`. 수식키가 없는 키(F2 · Esc)도 표의 항목이다. Kbd 안은 표를 읽는
//     식(`{HOTKEYS.<항목>.glyph}`)이어야 하고, 문자열 식(`{"…"}` · ``{`…`}``)은 날글자와 같다.
// 셋 다 빌드도 타입 검사도 조용하다(`Hint` · 메뉴 항목의 `shortcut`은 표의 항목 이름만 받아 타입이 먼저 막지만, 문장 속 글자와
// 속성 값은 타입이 못 본다).
//
// **목록 안 움직임 안내는 막지 않는다** — 검색 팔레트 바닥 줄의 「↑↓ 고르기 · ↵ 열기」는 단축키가 아니라 목록 안 키라 표에 없다
// (`hotkeys.ts` 머리말). 수식키가 없는 화살표 · ↵ 글리프는 그래서 이 그물에 안 걸린다.
//
// 세는 곳은 `src`의 소스(테스트 빼고)이고 **주석은 세지 않는다**(`blank-comments.ts`) — 주석은 「⌘K가 연다」처럼 키를 이름으로
// 적는 자리다. 표(`hotkeys.json`)는 소스가 아니라 데이터라 세는 곳 밖이다. 테스트는 사람이 보는 글자를 그대로 적어 재므로 뺀다.

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// 주석을 지운 원문들 — `file`은 저장소 뿌리에서 잰 경로다.
const sources = sourceFiles(join(root, "src")).map((path) => ({
  file: path.slice(root.length),
  text: blankComments(readFileSync(path, "utf8")),
}));

/** 수식키 글리프 — 단축키 표의 `glyph`가 앞에 다는 넷. */
const MODIFIER_GLYPH = /[⌘⌃⌥⇧]/g;
/** `aria-keyshortcuts`에 문자열을 바로 준 자리 — JSX 속성(`="…"` · `={"…"}` · ``={`…`}``)과 객체 키(`"aria-keyshortcuts": "…"`). */
const LITERAL_ARIA = /aria-keyshortcuts["']?\s*[=:]\s*\{?\s*["'`]/g;
/** Kbd 안에 표를 읽는 식이 아니라 글자가 선 자리 — 날글자(`<Kbd>Esc</Kbd>`)와 문자열 식(`<Kbd>{"Esc"}</Kbd>` · ``<Kbd>{`F2`}</Kbd>``). */
const LITERAL_KBD = /<Kbd\b[^>]*>\s*(?:[^\s{<]|\{\s*["'`])/g;

// 어긴 자리를 `파일:줄: 글자`로 센다.
function offenders(pattern: RegExp, from: { file: string; text: string }[] = sources): string[] {
  return from.flatMap(({ file, text }) =>
    [...text.matchAll(pattern)].map((m) => `${file}:${text.slice(0, m.index).split("\n").length}: ${m[0]}`),
  );
}

describe("꼴이 막을 것을 막는다", () => {
  // 꼴이 새면 아래 「0건」이 저절로 초록이다 — 막아야 할 표본과 놓아줘야 할 표본을 함께 센다.
  const sample = (text: string) => [{ file: "표본", text: blankComments(text) }];
  it.each([
    ['<Hint shortcut="⌘Enter" />', MODIFIER_GLYPH],
    ["<Kbd>⌘T</Kbd>", MODIFIER_GLYPH],
    ['{ keys: "⌥↑" }', MODIFIER_GLYPH],
    ["<Kbd>⌃Tab</Kbd>·<Kbd>⌘W</Kbd>", MODIFIER_GLYPH],
    ['aria-keyshortcuts="Meta+K"', LITERAL_ARIA],
    ['aria-keyshortcuts={"Meta+K"}', LITERAL_ARIA],
    ["aria-keyshortcuts={`Meta+${key}`}", LITERAL_ARIA],
    ['{ "aria-keyshortcuts": "F2" }', LITERAL_ARIA],
    ["<Kbd>Esc</Kbd>", LITERAL_KBD],
    ['<Kbd className="x">F2</Kbd>', LITERAL_KBD],
    ['<Kbd>{"Esc"}</Kbd>', LITERAL_KBD],
    ["<Kbd>{'Esc'}</Kbd>", LITERAL_KBD],
    ["<Kbd>{`F2`}</Kbd>", LITERAL_KBD],
  ] as const)("%s를 센다", (text, pattern) => {
    expect(offenders(pattern, sample(text)).length).toBeGreaterThan(0);
  });

  it.each([
    ["<Kbd>{HOTKEYS.newShell.glyph}</Kbd>", LITERAL_KBD],
    ["aria-keyshortcuts={hotkey?.aria}", LITERAL_ARIA],
    ['<Hint shortcut="search" />', MODIFIER_GLYPH],
    ["// ⌘K가 팔레트를 연다", MODIFIER_GLYPH],
    ["{/* <Kbd>⌘T</Kbd> */}", MODIFIER_GLYPH],
    ["「↑↓ 고르기 · ↵ 열기」", MODIFIER_GLYPH],
  ] as const)("%s는 안 센다", (text, pattern) => {
    expect(offenders(pattern, sample(text))).toEqual([]);
  });
});

it("검사가 실제로 소스를 읽는다", () => {
  // 주석 지우기가 새서 원문을 통째로 지우면 아래 「0건」이 저절로 초록이다 — 표를 읽는 자리가 주석 밖에서 실제로 보인다.
  expect(sources.length).toBeGreaterThan(100);
  expect(offenders(/shortcut="\w+"/g).length).toBeGreaterThan(3);
  expect(offenders(/<Kbd>\{HOTKEYS\.\w+\.glyph\}<\/Kbd>/g).length).toBeGreaterThan(0);
});

describe("단축키 글자는 표에서만 온다", () => {
  it("수식키 글리프(⌘ ⌃ ⌥ ⇧)를 손으로 적지 않는다", () => {
    expect(offenders(MODIFIER_GLYPH)).toEqual([]);
  });

  it("aria-keyshortcuts 값을 손으로 적지 않는다", () => {
    expect(offenders(LITERAL_ARIA)).toEqual([]);
  });

  it("Kbd 안에 글자를 손으로 적지 않는다", () => {
    expect(offenders(LITERAL_KBD)).toEqual([]);
  });
});
