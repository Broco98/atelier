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
// **키가 아예 없는 것이 「안 골랐다」다** — `terminal` 구획과 규칙이 갈리는 자리다. 백엔드가
// 이 구획의 필드에만 `skip_serializing_if = "Option::is_none"`을 달아 안 고른 값을 줄째
// 빼기 때문이고(`settings.rs`, 그 규칙을 `unchosen_notification_values_are_not_written`이
// 지킨다), 그래서 여기 오는 값은 `null`이 아니라 **없음**이다. 위 `TerminalSettings`처럼
// `boolean | null`로 적으면 이 타입이 응답의 모양을 거짓말하고, 그 거짓말은 `enabled === null`을
// 「안 골랐다」로 읽는 다음 코드에서 영영 참이 안 되는 분기로 나타난다.
//
// **기본(둘 다 켬)은 프런트가 든다.** 여기에 기본을 적어 두면 값을 정하는 자리가 둘이 된다 —
// 그 하나를 `notificationChoice`가 진다(`notifications.ts`).
export interface NotificationSettings {
  enabled?: boolean;
  sound?: boolean;
}

export interface Settings {
  terminal: TerminalSettings;
  // **없을 수 있다.** 아무것도 안 고른 파일에는 이 구획이 통째로 없고(`settings.rs`의
  // `is_empty`) 백엔드는 읽은 그대로 실어 보낸다 — 「있다」고 적으면 지금까지 쓰던 설정
  // 파일 전부에서 이 타입이 거짓말이 된다.
  notifications?: NotificationSettings;
}

// 에이전트 훅이 지금 어디에 어떻게 깔려 있나 (#207 · 구현 결정 8). **정본은
// `src-tauri/src/hooks.rs`의 `HookStatus`**이고 여기는 그 응답의 타입이다.
//
// **앱이 따로 기억하는 값이 아니다.** 부를 때마다 설정 파일을 읽어 만든 것이라, 사람이
// 파일을 손으로 고쳐도 다음 조회가 그것을 그대로 말한다.
export interface HookStatus {
  /** `claude` · `codex`. */
  agent: string;
  /** 사람이 읽는 경로 — `~/.claude/settings.json`. */
  path: string;
  installed: boolean;
  /**
   * 파일이 깨져 **판정도 설치도 못 했으면** 그 까닭. 그때 `installed`는 `false`지만
   * 뜻은 「안 깔렸다」가 아니라 **「모른다」**다 — 화면이 그 둘을 갈라 적는다.
   */
  error: string | null;
  /** 그 파일에 실제로 들어가는 글자(스토리 73). 백엔드의 병합 함수가 낸 값 그대로다. */
  preview: string;
}
