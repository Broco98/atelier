import type { ITheme } from "@xterm/xterm";
import type { TerminalTheme } from "@/features/settings/types";

// **xterm 테마 색의 정본은 여기다 — `index.css`가 아니다.**
//
// xterm이 요구하는 것은 ANSI 16색인데 앱 팔레트에는 대응물이 하나도 없다. 그것을
// `index.css`에 넣으면 이 모듈 하나만 읽는 토큰이 스무 개 늘어 그 파일이 "앱 팔레트의
// 단일 출처"라는 성질을 잃는다. 선례가 같다 — mermaid도 자기 테마를 CSS가 아니라
// `MermaidBlock.tsx`의 `theme: "neutral"`로 정한다.
//
// `getComputedStyle`로 토큰을 읽어 채우는 안은 기각했다. `--background`가 `oklch(1 0 0)`인데
// xterm의 `css.toColor`는 `#rrggbb`·`rgb()`·`rgba()`만 직접 파싱하고 나머지는 캔버스 litmus
// 경로로 떨어진다 — 그 경로는 Node에서 던지고 알파가 255가 아니어도 던진다.
//
// **두 벌이다 — 밝게 / 어둡게, 기본은 어둡게**(결정 54). ANSI 16색은 우리가 고르지 않는다:
// 라이트는 VS Code Light+, 다크는 VS Code Dark+의 터미널 팔레트를 그대로 옮겨 적었다
// (vscode `terminalColorRegistry.ts`의 `ansiColorMap`). 각 바탕에서 읽히도록 이미 조정된
// 한 벌씩이라 우리가 열여섯 개를 새로 고르는 것보다 낫다. **우리가 정하는 것은 배경·전경·
// 커서·선택 넷뿐이다.**
//
// **팔레트와 함께 와야 하는 것 하나 — 대비 바닥.** VS Code는 이 팔레트를
// `minimumContrastRatio` 기본값 **4.5**와 함께 출하해서(`terminalConfiguration.ts`) 바탕에
// 묻히는 색을 런타임에 끌어올린다. 우리가 옮긴 것은 색 열여섯뿐이고 xterm의 기본값은
// `1`(= 아무것도 하지 않는다, `xterm.d.ts`의 `minimumContrastRatio`)이라, 그 바닥이 없으면
// **다크에서 ANSI 검정(SGR 30·40, `#000000`)이 `#1e1e1e` 바탕 위 1.26:1로 묻힌다.** 기본이
// 라이트였을 땐 같은 검정이 흰 바탕 위 21:1이라 없던 문제고, 기본을 어둡게로 옮긴 이 판이
// 새로 만든 경로다. 앱 안에서 `claude`·`codex`를 돌리는 것이 이 터미널의 존재 이유라 ANSI
// 색은 실제로 많이 쓰인다.
// **그 한 줄은 이제 와 있다** — `terminal-store.ts`의 `createInstance`가 `new Terminal({ … })`에
// `minimumContrastRatio: 4.5`를 준다. 여기서 다크 `black`을 밝은 회색으로 바꾸는 안은
// **택하지 않았다** — 결정 54의 「열여섯 색을 우리가 고르지 않는다」와 어긋난다: 팔레트는
// 그대로 두고 그리는 순간의 바닥만 준다.
//
// **다크에는 짝이 될 앱 토큰이 없다 — 앱이 라이트 한 벌뿐이기 때문이다.** `index.css`에
// `.dark` 블록이 있지만 아무도 켜지 않고, 그 블록은 shadcn 기본값이라 켜면 `--primary`가
// 거의 흰색이 되어 앱의 색이 사라진다. 앱 전체 다크는 팔레트를 새로 고르는 판 하나짜리
// 일이고 결정 54가 기각했다. 그래서 다크의 넷 중 앱과 이어진 것은 **커서 하나**뿐이다 —
// 그 하나를 `--primary`로 못박아 앱과의 연결을 남긴다.

export const terminalThemeLight: ITheme = {
  // 아래 넷은 앱과 어긋나면 안 된다 — 짝을 여기 적어 둔다 (index.css)
  background: "#ffffff", // --background: oklch(1 0 0)
  foreground: "#1a1a1e", // --foreground
  cursor: "#5e6ad2", // --primary
  selectionBackground: "rgba(20, 20, 28, 0.09)", // --state-3

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
  // 넷 중 **커서만 앱과 이어져 있다** — 배경·전경·선택에는 짝이 될 토큰이 없다(머리말).
  // 그래서 배경·전경은 16색과 같은 출처(VS Code Dark+)에서 가져와 한 벌을 흩뜨리지 않고,
  // 선택 하나만 앱의 방식을 따른다.
  background: "#1e1e1e", // VS Code Dark+ `editor.background` — 16색이 이 바탕에서 조정됐다
  foreground: "#cccccc", // VS Code Dark+ 워크벤치 `foreground`
  cursor: "#5e6ad2", // --primary 그대로(결정 54). 이 바탕 위 대비 3.5:1이라 얇은 막대도 보인다
  // 라이트가 VS Code의 선택색이 아니라 앱 `--state-3`(검정 9%)을 쓰므로 그 **모양**을
  // 따라간다 — 색이 아니라 반투명 한 겹. 같은 9%를 흰색으로 뒤집으면 어두운 바탕에서
  // 오히려 조금 더 벌어진다(바탕 대비 1.30, 라이트는 1.20).
  selectionBackground: "rgba(255, 255, 255, 0.09)",

  black: "#000000", // 맨 색으로는 이 바탕 위 1.26:1이다 — 그리는 순간 대비 바닥이 끌어올린다(머리말)

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
