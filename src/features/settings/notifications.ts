import type { NotificationSettings, Settings } from "./types";

// 알림 설정을 **읽고 고치는 규칙 둘**(#206 · 결정 10). 화면(`SettingsPage.tsx`)과 셸 쪽
// 배선(`features/terminal/notify-settings.ts`)이 같은 규칙을 딛어야 해서 화면에서 꺼냈다 —
// 저쪽은 앱이 뜰 때 도는 자리라 React 화면을 딸고 올 수 없다.

/** 고른 것만 담긴 파일에서 **실제로 쓰이는 값** 둘. */
export interface NotifyChoice {
  enabled: boolean;
  sound: boolean;
}

/**
 * 알림 구획도 **읽은 것 위에 얹는다** — `patchTerminal`과 같은 규칙이고 같은 이유다
 * (모르는 키가 저장 한 번에 사라지지 않는다).
 *
 * 다른 것 하나: **구획이 아예 없을 수 있다.** 아무것도 안 고른 파일에는 `notifications`가
 * 통째로 없으므로(`settings.rs`의 `is_empty`) 펼칠 것이 없는 자리에서 시작한다. 그때
 * 만들어 얹는 것이 이 함수이고, 그래서 부르는 쪽은 구획의 유무를 몰라도 된다.
 */
export function patchNotifications(
  settings: Settings,
  patch: Partial<NotificationSettings>,
): Settings {
  // **캐스트가 없다.** 있던 자리는 타입이 「둘 다 늘 있다」고 적어 두던 때의 흔적이었다 —
  // 안 고른 값은 키째 없으므로(`types.ts`) 펼친 결과가 그대로 이 타입이다.
  return { ...settings, notifications: { ...settings.notifications, ...patch } };
}

/**
 * **알림의 기본을 드는 유일한 자리**(결정 10 — 둘 다 켬). 백엔드는 「사용자가 고른 것만」
 * 적으므로(`settings.rs`의 `skip_serializing_if`) **키가 없는 것**이 「안 골랐다」이지
 * 「껐다」가 아니다.
 *
 * **`??`다 — `||`가 아니다.** 껐다는 선택(`false`)이 `||`에서는 조용히 켬으로 돌아오고,
 * 화면에서는 「껐는데 다시 켜졌다」로만 보인다.
 */
export function notificationChoice(settings: Settings): NotifyChoice {
  return {
    enabled: settings.notifications?.enabled ?? true,
    sound: settings.notifications?.sound ?? true,
  };
}
