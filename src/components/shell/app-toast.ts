import { Toast } from "@base-ui/react/toast";

// **어느 화면에서든 서는 토스트**(프로세스 스펙 P2 (나)). 이 work이 알리는 것 — 시작 정리, 주인 잃은 셸, 셸이
// 스스로 끝남, 훅 갱신, 「그 셸은 닫혔어요」 — 은 사람이 어느 화면에 있든 닿아야 한다. 그래서 자리가 앱
// 셸에 하나다(`AppToasts.tsx`).
//
// **작업 · 아카이브 화면의 복사 토스트는 여기로 안 온다.** 그쪽은 제 화면 안의 일을 말하고, 이웃 work
// (`sidebar-active-band`)이 그 자리를 옮기고 있다 — 이 파일은 그쪽을 모른다.

/**
 * 이 work의 토스트가 나가는 **유일한 문**. 모듈에 하나 둔다 — React 밖(스토어 · 이벤트 처리기)에서도 알릴 수
 * 있어야 해서다. 이 매니저는 자기 Provider(`AppToasts`) 하나에만 이어지고, 그 Provider는 Viewport만
 * 감싼다 — 까닭은 그 파일이 든다.
 *
 * **구독자가 없을 때 온 것은 버린다**(Base UI `createToastManager`는 쌓아 두지 않는다). 앱 셸이 서기 전의
 * 일은 스토어에 두고 셸이 서서 읽는다(`startup-report.ts`).
 */
export const appToasts = Toast.createToastManager();

/**
 * 버튼 없는 토스트가 서 있는 시간 — 작업 · 아카이브 화면의 복사 토스트와 같은 값이다(`WorksPage.tsx`). 한
 * 앱에서 두 토스트가 다른 빠르기로 사라지면 어느 쪽이 느린지가 눈에 걸린다.
 */
export const SHORT_TOAST_MS = 1600;

/**
 * 알릴 것 하나. 문장은 **부르는 쪽이 짓는다** — work과 Room을 세계에 따라 갈라 적어야 하는데(프로세스
 * 스펙 S45), 그 세계는 지금 선 화면이 아니라 알림의 주인(아카이브된 work 등)의 것이라 부르는 쪽만 안다.
 * 낱말은 `itemNameOf(mode)`(`features/works/work-sections.ts`)에서 가져온다.
 */
export type AppNotice =
  | {
      /** 같은 id로 다시 오면 새로 쌓이지 않고 그 자리를 고친다. 없으면 매번 새로 선다. */
      id?: string;
      text: string;
    }
  | {
      /**
       * **동작 토스트는 자기 id를 쓴다** — 같은 알림이 다시 오면(주인 잃은 셸이 늘었다 등) 그 자리를 고친다.
       * 누르거나 닫을 때까지 남으므로 id 없이 쌓이면 사람이 하나씩 닫아야 한다.
       */
      id: string;
      text: string;
      /** 토스트의 버튼. 누른 뒤 토스트를 닫을지는 부르는 쪽이 정한다(`appToasts.close(id)`). */
      action: { label: string; run: () => void };
    };

/**
 * 알릴 것을 매니저가 받는 모양으로. **수명은 버튼이 정한다**: 버튼 없는 토스트는 짧게 서고, 버튼이 든
 * 토스트는 저절로 내려가지 않는다(`timeout: 0`) — 1.6초 뒤에 사라지면 [모두 닫기]를 누를 틈이 없다.
 */
export function toastOptionsOf(notice: AppNotice): Parameters<typeof appToasts.add>[0] {
  if ("action" in notice) {
    const { label, run } = notice.action;
    return { id: notice.id, title: notice.text, timeout: 0, actionProps: { children: label, onClick: run } };
  }
  return { id: notice.id, title: notice.text, timeout: SHORT_TOAST_MS };
}

/** 토스트 하나를 세운다. 앱 셸이 서기 전에 부르면 버려진다(`appToasts`의 머리말). */
export function showAppToast(notice: AppNotice): void {
  appToasts.add(toastOptionsOf(notice));
}
