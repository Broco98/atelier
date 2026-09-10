// `~/.atelier/settings.json` 한 장의 모양 (결정 53). **정본은 `src-tauri/src/settings.rs`**이고
// 여기는 그 응답의 타입이다 — 파일에 무엇이 들어가는지는 그쪽 주석이 말한다.

export type TerminalTheme = "light" | "dark";

// 결정 52가 연 것만 있다 — 글꼴 · 크기 · 테마. 스크롤백은 열지 않았다(모양이 아니라
// 메모리 값이다).
export interface TerminalSettings {
  // 고르지 않았으면 `null`이다. **기본 글꼴 이름은 여기에도 백엔드에도 없다** — 그 값은
  // 폴백 사슬과 함께 `terminal-defaults.ts`가 들고 있다(`FONT_FAMILY`).
  // **이름 하나가 아니라 목록으로 쓰인다**: 고른 이름 뒤에 늘 같은 꼬리가 붙는다(결정 56).
  // 합치는 자리는 그 파일의 `terminalLook` 하나다.
  fontFamily: string | null;
  // 같은 규칙이다 — 기본은 `terminal-defaults.ts`의 `FONT_SIZE`.
  fontSize: number | null;
  // 이 하나만 파일이 비어도 값이 정해져 온다 — 기본은 어둡게다(결정 54).
  theme: TerminalTheme;
}

// 알림 구획 (#206 · 결정 10). **둘뿐이다** — 켬/끔과 소리 켬/끔. 「배경일 때만」 같은 셋째
// 선택은 없다(스토리 67).
//
// **둘 다 `null`이 「안 골랐다」이고 기본(둘 다 켬)은 프런트가 든다.** 백엔드는 고른 것만
// 적으므로(`settings.rs`의 `skip_serializing_if`) 여기에 기본을 적어 두면 값을 정하는 자리가
// 둘이 된다 — 그 하나를 `notificationChoice`가 진다(`SettingsPage.tsx`).
export interface NotificationSettings {
  enabled: boolean | null;
  sound: boolean | null;
}

export interface Settings {
  terminal: TerminalSettings;
  // **없을 수 있다.** 아무것도 안 고른 파일에는 이 구획이 통째로 없고(`settings.rs`의
  // `is_empty`) 백엔드는 읽은 그대로 실어 보낸다 — 「있다」고 적으면 지금까지 쓰던 설정
  // 파일 전부에서 이 타입이 거짓말이 된다.
  notifications?: NotificationSettings;
}
