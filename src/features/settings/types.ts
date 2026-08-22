// `~/.atelier/settings.json` 한 장의 모양 (결정 53). **정본은 `src-tauri/src/settings.rs`**이고
// 여기는 그 응답의 타입이다 — 파일에 무엇이 들어가는지는 그쪽 주석이 말한다.

export type TerminalTheme = "light" | "dark";

// 결정 52가 연 것만 있다 — 글꼴 · 크기 · 테마. 스크롤백은 열지 않았다(모양이 아니라
// 메모리 값이다).
export interface TerminalSettings {
  // 고르지 않았으면 `null`이다. **기본 글꼴 이름은 여기에도 백엔드에도 없다** — 그 값은
  // 폴백 사슬과 함께 `terminal-store.ts`가 들고 있고(`FONT_FAMILY`), 결정 55가 그것을
  // 바꾼다. 쓰는 쪽이 `settings.terminal.fontFamily ?? FONT_FAMILY`로 읽는다.
  fontFamily: string | null;
  // 같은 규칙이다 — 기본은 `terminal-store.ts`의 `FONT_SIZE`.
  fontSize: number | null;
  // 이 하나만 파일이 비어도 값이 정해져 온다 — 기본은 어둡게다(결정 54).
  theme: TerminalTheme;
}

export interface Settings {
  terminal: TerminalSettings;
}
