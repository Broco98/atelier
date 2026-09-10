import { settingsApi } from "@/features/settings/api";
import { notificationChoice } from "@/features/settings/notifications";
import type { NotifyChoice } from "@/features/settings/notifications";

/**
 * `~/.atelier/settings.json`의 `notifications` 구획이 알림 배선에 도착하는 자리(#206).
 * 자리를 가르는 이유는 `terminal-settings.ts`와 같다 — 읽는 쪽이 React가 아니고(알림을 쏘는
 * 것은 `terminal-store.ts`의 모듈 구독이다), 설정 화면이 그 배선을 직접 부르면 `@xterm/*`가
 * 그 화면에 딸려 온다.
 *
 * **다른 것 하나 — 여기는 `Store`가 아니다.** 저쪽은 스토어이고 이 모듈만 평범한 모듈 값인
 * 것은 읽는 쪽의 모양 때문이다: 알림 배선은 **한 함수 안에서 두 값을 함께 읽는다**(셸 목록과
 * 이 설정). `@tanstack/store`의 `subscribe`는 콜백을 반응형 effect 안에서 돌리므로, 그 콜백이
 * 읽은 **모든** 스토어가 그 구독의 의존이 된다(0.9.3의 `atom.js` — alien-signals) — 그래서
 * 이것이 스토어이면 구독 한 줄을 지워도 다른 줄이 대신 도는 그림이 되고, 실제로 그렇게 됐다:
 * `terminalStore.subscribe(…)`를 지운 채로 L3가 통째로 초록이었다(2026-09-10 실측). 검사가
 * 무엇을 재는지 모르게 되는 자리라 값을 평범하게 든다.
 *
 * **기본이 여기 앉아 있는 것**은 파일을 못 읽는 동안에도 알림이 울려야 하기 때문이다 —
 * 「안 골랐으면 둘 다 켬」(결정 10)이고, 그 기본을 정하는 자리는 `notificationChoice` 하나다.
 */
let choice: NotifyChoice = { enabled: true, sound: true };

/** 지금 고른 값. **`.state`가 아니라 함수인 것**은 위 머리말의 그 추적 때문이다. */
export function notifyChoice(): NotifyChoice {
  return choice;
}

const listeners = new Set<() => void>();

/**
 * 값이 바뀌면 알려 준다 — 배선이 배지를 그 자리에서 맞추기 위해서다. 끈 순간 독에 수가
 * 남아 있으면 「껐는데 아직 부른다」로 읽힌다.
 *
 * **해지가 없다.** 거는 쪽이 `terminal-store.ts`의 모듈 최상위 한 줄뿐이고 모듈 본문은
 * 앱이 사는 동안 한 번만 돌기 때문이다 — 그래서 여기는 `openRejectedListeners`(저쪽은 React
 * 이펙트가 마운트마다 걸어서 해지 함수를 돌려준다)와 **다른 물건**이다. Set인 것도 같은
 * 자리의 값이다: 해지가 없는 API에서는 같은 함수를 두 번 거는 것이 곧 새는 것이라, 한 번만
 * 돌게 접어 둔다.
 *
 * **React에서 걸지 마라.** 이 모양으로는 언마운트에서 뗄 길이 없다 — 화면이 이 값을 봐야
 * 하는 날이 오면 그때 `onShellOpenRejected`처럼 해지 함수를 돌려주게 고쳐야 한다.
 */
export function onNotifySettingsChanged(listen: () => void): void {
  listeners.add(listen);
}

/** 고른 값을 알림 배선에 먹인다 — 설정 화면이 **저장에 성공한 뒤** 부른다. */
export function applyNotifySettings(next: NotifyChoice): void {
  choice = next;
  for (const listen of listeners) listen();
}

/**
 * 앱이 뜰 때 **한 번** 읽는다(`main.tsx`).
 *
 * **읽기가 한 번 더 도는 것을 감수한다** — 바로 옆 `loadTerminalSettings`가 같은 파일을
 * 읽는다. 한 번으로 합치려면 둘 중 하나가 다른 구획을 알아야 하는데, 그러면 이 모듈이
 * 셸 설정을 알거나 저쪽이 알림 배선을 알게 된다. 앱이 뜰 때 도는 작은 JSON 한 장이라
 * 값이 그 결합보다 싸다.
 *
 * **못 읽어도 알림은 돈다.** 깨진 파일은 실패로 오고(경로를 실은 에러), 여기서 멈추면
 * 설정 한 장 때문에 신호가 통째로 죽는다 — 기본값(둘 다 켬)으로 흐르고 이유만 남긴다.
 * 고칠 자리를 말하는 것은 설정 화면의 몫이다.
 */
export async function loadNotifySettings(): Promise<void> {
  try {
    applyNotifySettings(notificationChoice(await settingsApi.read()));
  } catch (error) {
    console.warn("atelier: 설정을 못 읽었다 — 알림은 기본값으로 간다", error);
  }
}
