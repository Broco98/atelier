import type { ITheme } from "@xterm/xterm";

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
// ANSI 16색은 VS Code Light+의 터미널 팔레트다. 흰 바탕에서 읽히도록 이미 조정된 한 벌이라
// 우리가 열여섯 개를 새로 고르는 것보다 낫다. 다크는 앱이 아직 출하하지 않으므로 없다.
export const terminalTheme: ITheme = {
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
