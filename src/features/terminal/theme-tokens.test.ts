/// <reference types="node" />
// 이 파일만 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { cssBlocks, resolved } from "@/css-tokens";
import type { CssScope } from "@/css-tokens";
import { fontList, SYSTEM_MONO } from "@/system-font";
import { FONT_FAMILY } from "./terminal-defaults";
import { terminalThemeDark, terminalThemeFor, terminalThemeLight } from "./terminal-theme";

// 터미널의 글꼴과 색은 **두 곳에 적혀 있다** — 앱 팔레트인 `index.css`와, xterm이 요구하는
// 모양으로 옮겨 적은 `terminal-theme.ts`/`terminal-defaults.ts`다. 옮겨 적은 쪽이 뒤처져도
// 타입 검사도 화면도 조용하다: 색이 조금 어긋난 터미널은 "원래 그런가 보다"로 읽힌다.
// 그 짝을 여기서 고정한다 — 이 저장소가 파일 간 불변조건을 다루는 방식 그대로다
// (src/tauri-commands.test.ts의 invoke↔Rust 배선, src/state-scale.test.ts).
//
// **소스를 읽는 것은 `index.css` 하나다.** 나머지 둘은 import한다: 값 import가 없는 모듈이라
// 런타임에 아무것도 딸려오지 않고(`terminal-theme.ts`는 `import type` 둘, `terminal-defaults.ts`도
// 그렇다), 소스 정규식은 「어느 벌의 `foreground`인지」를 선언 순서로만 구분하게 되어 조용히
// 틀릴 수 있다.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const blocks = cssBlocks(readFileSync(root + "src/index.css", "utf8"));

// 그 범위(라이트 `:root` · 다크 `.dark`)에서 **실제로 풀리는 값**이다 — `--term-bg: var(--surface)` 같은 별칭은 끝까지
// 따라간다(`src/css-tokens.ts`). 다크 벌은 다크 범위와 견준다 — 지금 두 범위의 `--accent`가 같아도, `.dark`가 제 값을
// 갖는 날 라이트 값과 견주던 검사는 초록인 채 다크 커서만 앱에서 떨어진다.
const cssToken = (name: string, scope: CssScope = "light") => resolved(blocks, scope, name);

// `@theme`에 선 값(글꼴) — 라이트 · 다크 범위가 아니다.
const themeToken = (name: string) => {
  const value = blocks.find((block) => block.head.includes("@theme inline"))?.decls.get(`--${name}`);
  if (value === undefined) throw new Error(`index.css의 @theme inline에서 --${name}을 찾지 못했다`);
  return value;
};

describe("터미널이 앱 팔레트에서 옮겨 적은 값", () => {
  // **이 짝은 일부러 끊겨 있다.** 여기 있던 검사는 「터미널 글꼴 목록이 `--font-mono`와
  // 같다」였는데, 결정 55가 터미널만 `JetBrainsMonoNL Nerd Font`로 옮기고 앱 전체 mono는
  // 남겼다 — 아이콘이 필요한 곳은 터미널 하나고, 문서 코드 블록·경로·spec 원문에는 필요 없다
  // (`index.css` 머리말의 「`--font-mono`는 터미널 글꼴을 따르지 않는다」). 앱 전체 mono는 이제
  // 시스템 mono 줄이다(codex-ds 결정 3 — 글꼴도 캔버스 값). 그 줄은 `src/system-font.ts`가 DS에서 옮겨 들고, L3
  // `system-font`가 같은 줄로 실제 요소를 잰다.
  //
  // 그래서 지키는 것을 「같다」에서 **「갈라진 채로 있다」**로 뒤집는다. 터미널 글꼴을 다시
  // 만지는 사람이 「짝이 어긋났네」 하고 `--font-mono`까지 끌고 가면 앱의 모노 글자가 전부
  // 아이콘 글꼴로 바뀌는데, 그 변화는 화면 어디에도 「바꿨다」고 적히지 않는다.
  it("앱 전체 --font-mono는 시스템 mono 줄이고 터미널 글꼴을 따라가지 않는다", () => {
    const appMono = fontList(themeToken("font-mono"));
    expect(appMono, `--font-mono가 시스템 mono 줄이 아니다: ${appMono}`).toBe(fontList(SYSTEM_MONO));
    expect(appMono, "터미널 글꼴이 앱 전체 mono를 함께 끌고 갔다").not.toBe(fontList(FONT_FAMILY));
  });

  // 티켓이 「앱과 어긋나면 안 되는 넷」으로 못박은 짝들이다(결정 33) — 바탕 = 카드 면, 글자 = 본문, 커서 = 강조,
  // 고름 = 면 알파. 앱 쪽 이름은 DS의 터미널 낱말(`term-bg` · `term-fg` · `term-dim`)과 Codex 토큰(`accent` · `fill-active`)이다
  // (codex-ds 티켓 06). 넷 다 xterm이 직접 읽는 표기(`#rrggbb` · `rgba()`)라 글자 그대로 견준다. 흐린 글자는 xterm이 글자색에서
  // 만든다(맨 아래). 다크 바탕은 L3가 칠해진 색으로 잰다(`e2e/frame.spec.ts`).
  it("background가 --term-bg(카드 면)와 같다", () => {
    expect(terminalThemeLight.background).toBe(cssToken("term-bg"));
  });

  it("foreground가 --term-fg(본문)와 같다", () => {
    expect(terminalThemeLight.foreground).toBe(cssToken("term-fg"));
  });

  it("cursor가 --accent와 같다", () => {
    expect(terminalThemeLight.cursor).toBe(cssToken("accent"));
  });

  it("selectionBackground이 --fill-active와 같다", () => {
    expect(terminalThemeLight.selectionBackground).toBe(cssToken("fill-active"));
  });

  // **흐린 글자(SGR 2)는 테마에 칸이 없다** — xterm이 글자색을 반만 칠해 그린다(DOM 그리기의 `.xterm-dim`, WebGL 그리기의
  // `DIM_OPACITY` — 둘 다 0.5). DS의 흐린 글자 `term-dim`(= `fg-tertiary`)이 바로 본문의 50%라, 글자색이 `term-fg`면 흐린
  // 글자는 저절로 `term-dim`이다. 그 셈을 여기서 견준다 — `fg-tertiary`의 알파가 바뀌거나 글자색이 본문에서 떨어지는 날 둘이 갈린다.
  it("흐린 글자(글자색의 반)가 --term-dim과 같다", () => {
    const XTERM_DIM_OPACITY = 0.5;
    const found = terminalThemeLight.foreground?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
    if (!found) throw new Error(`#rrggbb가 아니다: ${terminalThemeLight.foreground}`);
    const [r, g, b] = found.slice(1).map((channel) => parseInt(channel, 16));
    expect(`rgba(${r}, ${g}, ${b}, ${XTERM_DIM_OPACITY})`).toBe(cssToken("term-dim"));
  });
});

const ANSI_16 = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

// 정확한 휘도가 아니라 세 채널 평균이다 — 여기서 가리려는 것은 「바탕과 글자가 뒤바뀌었나」
// 하나라 이걸로 충분하고, 감마를 들이면 검사가 읽기만 어려워진다.
function brightness(hex: string | undefined): number {
  const found = hex?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (!found) throw new Error(`#rrggbb가 아니다: ${hex}`);
  return (parseInt(found[1], 16) + parseInt(found[2], 16) + parseInt(found[3], 16)) / 3;
}

// 다크에서 이 파일이 앱과 견주는 짝은 커서 하나라(바탕은 L3가 잰다), 나머지는 **두 벌 사이**를 견준다 — 한 벌만
// 고치고 다른 벌을 잊는 것이 이 파일이 썩는 방식이기 때문이다.
describe("터미널 테마 두 벌", () => {
  // 여기 있던 「기본은 어둡게다」(다크 별칭이 다크를 가리키는가)의 자리다. 그 별칭은 store가
  // 고른 값을 직접 받게 되면서 지워졌고, **「기본은 어둡게」(결정 54)는 `terminalLook`으로
  // 옮겨 갔다**(`terminal-defaults.test.ts`가 그것을 본다).
  //
  // 여기 남은 것은 이름 → 한 벌의 대응이다. 뒤집혀도 타입 검사에는 아무 티가 안 나고, 화면에는
  // 「밝게를 골랐는데 어둡다」로만 보인다 — 오류가 아니라 그냥 다른 화면이라 조용하다.
  it("이름이 제 벌을 고른다", () => {
    expect(terminalThemeFor("dark")).toBe(terminalThemeDark);
    expect(terminalThemeFor("light")).toBe(terminalThemeLight);
  });

  it("두 벌이 같은 키 집합을 갖는다", () => {
    expect(Object.keys(terminalThemeDark).sort()).toEqual(Object.keys(terminalThemeLight).sort());
  });

  it("ANSI 16색이 두 벌 모두에 빠짐없이 있다", () => {
    for (const [name, set] of [
      ["밝게", terminalThemeLight],
      ["어둡게", terminalThemeDark],
    ] as const) {
      for (const key of ANSI_16) {
        expect(set[key], `${name}에 ${key}가 없다`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  // 결정 54가 「커서는 앱 강조색 그대로」로 못박았다(그때 이름은 `--primary` — 지금은 Codex `accent`를 가리키는
  // 별칭이다). 그 연결이 끊기면 다크 터미널의 커서만 앱과 다른 파랑이 된다.
  it("다크 커서가 앱 다크 범위의 --accent와 같다", () => {
    expect(terminalThemeDark.cursor).toBe(cssToken("accent", "dark"));
  });

  it("밝게는 바탕이 글자보다 밝고, 어둡게는 그 반대다", () => {
    expect(brightness(terminalThemeLight.background)).toBeGreaterThan(
      brightness(terminalThemeLight.foreground),
    );
    expect(brightness(terminalThemeDark.background)).toBeLessThan(
      brightness(terminalThemeDark.foreground),
    );
  });

  // 한 벌을 통째로 베낀 뒤 배경만 어둡게 바꾸는 것이 가장 그럴듯하게 썩는 길이다. Light+와
  // Dark+가 실제로 같은 값을 쓰는 것은 셋(black·red·brightBlack)뿐이고 나머지 열셋은 다르다.
  const SHARED_16: readonly string[] = ["black", "red", "brightBlack"];

  it("다크 16색이 라이트를 베낀 것이 아니다", () => {
    for (const key of ANSI_16) {
      if (SHARED_16.includes(key)) continue;
      expect(terminalThemeDark[key], `${key}가 두 벌에서 같다`).not.toBe(terminalThemeLight[key]);
    }
  });
});
