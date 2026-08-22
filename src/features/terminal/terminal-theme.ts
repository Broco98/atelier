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
// **두 벌이다 — 밝게 / 어둡게, 기본은 어둡게**(결정 54). ANSI 16색은 우리가 고르지 않는다:
// 라이트는 VS Code Light+, 다크는 VS Code Dark+의 터미널 팔레트를 그대로 옮겨 적었다
// (vscode `terminalColorRegistry.ts`의 `ansiColorMap`). 각 바탕에서 읽히도록 이미 조정된
// 한 벌씩이라 우리가 열여섯 개를 새로 고르는 것보다 낫다. **우리가 정하는 것은 배경·전경·
// 커서·선택 넷뿐이다.**
//
// **가져오지 못한 것 하나 — 대비 바닥.** VS Code는 이 팔레트를 `minimumContrastRatio` 기본값
// **4.5**와 함께 출하해서(`terminalConfiguration.ts`) 바탕에 묻히는 색을 런타임에 끌어올린다.
// 우리는 색 열여섯만 옮겼고 그 바닥은 안 왔다 — xterm의 기본값은 `1`(= 아무것도 하지 않는다,
// `xterm.d.ts`의 `minimumContrastRatio`)이고 `createInstance`가 그 옵션을 주지 않는다. 그래서
// **다크에서 ANSI 검정(SGR 30·40, `#000000`)이 `#1e1e1e` 바탕 위 1.26:1로 묻힌다.** 기본이
// 라이트였을 땐 같은 검정이 흰 바탕 위 21:1이라 없던 문제고, 기본을 어둡게로 옮긴 이 판이
// 새로 만든 경로다. 앱 안에서 `claude`·`codex`를 돌리는 것이 이 터미널의 존재 이유라 ANSI
// 색은 실제로 많이 쓰인다.
// 여기서 다크 `black`을 밝은 회색으로 바꾸는 안은 **택하지 않았다** — 결정 54의 「열여섯 색을
// 우리가 고르지 않는다」와 어긋난다. 고칠 자리는 `terminal-store.ts`의 `new Terminal({ … })`에
// `minimumContrastRatio: 4.5` 한 줄이고, 그 파일은 이 트랙이 만지지 않으므로 **다음 트랙에
// 넘긴다.**
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

  black: "#000000", // 이 바탕 위 1.26:1로 묻힌다 — 머리말 「가져오지 못한 것 하나」를 볼 것

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

// **기본은 어둡게**(결정 54). `terminal-store.ts`가 import하는 이름이 이것이라, 여기서
// 다크를 가리키게 하는 것만으로 store를 한 줄도 안 고치고 기본이 바뀐다. 고르는 길
// (설정의 「테마: 밝게 / 어둡게」)이 생기면 그 화면은 이 별칭이 아니라 위 두 이름을 쓴다.
export const terminalTheme: ITheme = terminalThemeDark;
