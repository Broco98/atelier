import type { ITheme } from "@xterm/xterm";
import type { TerminalTheme } from "@/features/settings/types";

// **xterm 테마 색의 정본은 여기다 — `index.css`가 아니다.**
//
// xterm이 요구하는 것은 ANSI 16색인데 앱 팔레트에는 대응물이 하나도 없다. 그것을
// `index.css`에 넣으면 이 모듈 하나만 읽는 토큰이 스무 개 늘어 그 파일이 "앱 팔레트의
// 단일 출처"라는 성질을 잃는다. 선례가 같다 — mermaid도 자기 테마를 CSS가 아니라
// `MermaidBlock.tsx`의 `theme: "neutral"`로 정한다.
//
// `getComputedStyle`로 토큰을 읽어 채우는 안은 기각했다. xterm의 `css.toColor`는 `#rrggbb`·`rgb()`·`rgba()`만
// 직접 파싱하고 나머지는 캔버스 litmus 경로로 떨어진다 — 그 경로는 Node에서 던지고 알파가 255가 아니어도 던진다.
// 토큰이 그 표기라는 보장이 없다(`color-mix(…)`로 만든 토큰도 있다).
//
// **두 벌이다 — 밝게 / 어둡게, 기본은 어둡게**(결정 54). ANSI 16색은 우리가 고르지 않는다:
// 라이트는 VS Code Light+, 다크는 VS Code Dark+의 터미널 팔레트를 그대로 옮겨 적었다
// (vscode `terminalColorRegistry.ts`의 `ansiColorMap`). 흰 바탕 · `#1e1e1e` 바탕에서 읽히도록
// 조정된 한 벌씩이라 우리가 열여섯 개를 새로 고르는 것보다 낫다 — 다크 바탕은 지금 Codex의 `#181818`로
// 한 단 더 어둡지만(검정의 대비가 1.26 → 1.18) 그 차이는 아래 대비 바닥이 메운다. **우리가 정하는 것은
// 배경·전경·커서·선택 넷뿐이다.**
//
// **팔레트와 함께 와야 하는 것 하나 — 대비 바닥.** VS Code는 이 팔레트를
// `minimumContrastRatio` 기본값 **4.5**와 함께 출하해서(`terminalConfiguration.ts`) 바탕에
// 묻히는 색을 런타임에 끌어올린다. 우리가 옮긴 것은 색 열여섯뿐이고 xterm의 기본값은
// `1`(= 아무것도 하지 않는다, `xterm.d.ts`의 `minimumContrastRatio`)이라, 그 바닥이 없으면
// **다크에서 ANSI 검정(SGR 30·40, `#000000`)이 `#181818` 바탕 위 1.18:1로 묻힌다.** 기본이
// 라이트였을 땐 같은 검정이 흰 바탕 위 21:1이라 없던 문제고, 기본을 어둡게로 옮긴 이 판이
// 새로 만든 경로다. 앱 안에서 `claude`·`codex`를 돌리는 것이 이 터미널의 존재 이유라 ANSI
// 색은 실제로 많이 쓰인다.
// **그 한 줄은 이제 와 있다** — `terminal-store.ts`의 `createInstance`가 `new Terminal({ … })`에
// `minimumContrastRatio: 4.5`를 준다. 여기서 다크 `black`을 밝은 회색으로 바꾸는 안은
// **택하지 않았다** — 결정 54의 「열여섯 색을 우리가 고르지 않는다」와 어긋난다: 팔레트는
// 그대로 두고 그리는 순간의 바닥만 준다.
//
// **다크의 넷 중 앱과 이어진 것은 바탕과 커서다.** 앱은 라이트 한 벌로 나가지만(codex-ds 결정 17 — `.dark`는 아무도
// 켜지 않는다) `index.css`의 `.dark`는 DS 다크 값이라, 다크 바탕은 DS 다크 `term-bg`(= 다크 `surface`)이고 커서는
// 두 벌 모두 `accent`다. 전경 · 선택은 16색과 같은 출처(VS Code Dark+)와 반투명 한 겹으로 둔다(아래).

export const terminalThemeLight: ITheme = {
  // 아래 넷은 앱과 어긋나면 안 된다 — 짝을 여기 적어 둔다 (index.css, DS 터미널 낱말 `term-*`). 짝은 `theme-tokens.test.ts`가 본다.
  // 흐린 글자(SGR 2)는 칸이 없다 — xterm이 전경을 반만 칠해 그리므로 `--term-dim`(= `--fg-tertiary`, 본문 50%)과 저절로 같다.
  background: "#ffffff", // --term-bg(= --surface, 카드 면)
  foreground: "#1a1c1f", // --term-fg(= --fg, 본문)
  cursor: "#339cff", // --accent
  selectionBackground: "rgba(26, 28, 31, 0.12)", // --fill-active

  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

export const terminalThemeDark: ITheme = {
  // 넷 중 **바탕과 커서가 앱과 이어져 있다**(머리말). 전경은 16색과 같은 출처(VS Code Dark+)에서 가져와
  // 한 벌을 흩뜨리지 않고, 선택은 앱의 방식을 따른다.
  background: "#181818", // DS 다크 --term-bg(= 다크 --surface, 카드 면)
  foreground: "#cccccc", // VS Code Dark+ 워크벤치 `foreground`
  cursor: "#339cff", // --accent 그대로(결정 54). 이 바탕 위 대비 6.2:1이라 얇은 막대도 보인다
  // 라이트가 VS Code의 선택색이 아니라 앱 `--fill-active`(검정 12%)를 쓰므로 그 **모양**을
  // 따라간다 — 색이 아니라 반투명 한 겹. 흰색 9%면 바탕에서 벌어지는 정도가 라이트와 같다
  // (바탕 대비 1.29, 라이트는 1.27).
  selectionBackground: "rgba(255, 255, 255, 0.09)",

  black: "#000000", // 맨 색으로는 이 바탕 위 1.18:1이다 — 그리는 순간 대비 바닥이 끌어올린다(머리말)

  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

/**
 * 고른 이름을 한 벌로 옮긴다.
 *
 * **`terminalTheme`(다크 별칭)이 있던 자리다.** 그 별칭은 store를 못 만지는 트랙이 「기본은
 * 어둡게」(결정 54)를 한 줄로 말하려고 뒀던 것이고, 이제 store가 고른 값을 직접 받으므로
 * 지웠다 — 남겨 두면 「기본은 어둡게」가 두 곳(별칭과 `terminalLook`)에 적힌다.
 * **그 기본은 이제 `terminal-defaults.ts`의 `terminalLook`이 혼자 답한다**(설정 파일을 못 읽는
 * 자리까지 그 함수가 한 번에 답한다).
 *
 * 대응을 함수 하나로 두는 이유: store와 설정 화면의 미리보기가 같은 삼항을 각자 적으면 한쪽만
 * 뒤집혀도 조용하다 — 밝게가 어둡게로 그려지는 것은 오류가 아니라 그냥 다른 화면이다.
 */
export function terminalThemeFor(theme: TerminalTheme): ITheme {
  return theme === "light" ? terminalThemeLight : terminalThemeDark;
}
