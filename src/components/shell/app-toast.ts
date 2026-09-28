import { Toast } from "@base-ui/react/toast";
import { TOAST_TIMEOUT_MS } from "@/components/ui/toast";

// **어느 화면에서든 서는 토스트**(프로세스 스펙 P2 (나)). 이 work이 알리는 것 — 시작 정리, 주인 잃은 셸, 셸이
// 스스로 끝남, 훅 갱신, 「그 셸은 닫혔어요」 — 은 사람이 어느 화면에 있든 닿아야 한다. 그래서 자리가 앱
// 셸에 하나다(`AppToasts.tsx`).
//
// **작업 · 아카이브 화면의 복사 토스트는 여기로 안 온다.** 그쪽은 제 화면 안의 일을 말하고, 앱 토스트 부품의
// `showToast`로 제 화면의 자리에 한 장만 선다(`components/ui/toast.tsx` — `sidebar-active-band` S14 · S26). 이 파일은 그쪽
// 매니저를 모르고, 그쪽도 이 매니저를 모른다. 모양만 한 정의를 나눠 쓴다(`AppToasts`).

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
 * 알릴 것 하나. 문장은 **부르는 쪽이 짓는다** — work과 Room을 세계에 따라 갈라 적어야 하는데(프로세스
 * 스펙 S45), 그 세계는 지금 선 화면이 아니라 알림의 주인(아카이브된 work 등)의 것이라 부르는 쪽만 안다.
 * 낱말은 `itemNameOf(mode)`(`features/works/work-sections.ts`)에서 가져온다.
 *
 * **알림마다 제 id를 단다** — 같은 id로 다시 오면 새로 쌓이지 않고 그 자리를 고친다. 알리는 자리가 이펙트 · 이벤트라 같은
 * 알림이 거푸 온다(StrictMode의 두 번 · 거푸 누름). 그래서 짧은 토스트도 id가 필수다 — id 없이 매번 새로 서는 알림을 부르는
 * 자리가 없었다.
 */
export type AppNotice =
  | {
      id: string;
      text: string;
    }
  | {
      /**
       * **동작 토스트는 자기 id를 쓴다** — 같은 알림이 다시 오면(주인 잃은 셸이 늘었다 등) 그 자리를 고친다.
       * 누르거나 닫을 때까지 남으므로 id 없이 쌓이면 사람이 하나씩 닫아야 한다.
       */
      id: string;
      text: string;
      /**
       * 토스트의 버튼들 — 받은 차례로 선다(앞이 주된 동작이다). 누른 뒤 토스트를 닫을지는 부르는 쪽이 정한다
       * (`appToasts.close(id)`).
       */
      actions: readonly [ToastAction, ...ToastAction[]];
    };

/** 토스트의 버튼 하나. */
export interface ToastAction {
  label: string;
  run: () => void;
}

/**
 * 동작 토스트가 버튼들을 싣는 데이터. Base UI의 동작 칸(`actionProps`)은 하나뿐이라 — 주인 잃은 셸 토스트는 [모두 닫기]와
 * [보기] 둘을 든다(티켓 32 · 프로세스 스펙 S15) — 버튼들은 토스트의 `data`에 싣고 목록이 그린다(`AppToasts`).
 */
interface ActionsData {
  actions: ReadonlyArray<ToastAction>;
}

/**
 * 알릴 것을 매니저가 받는 모양으로. **수명은 버튼이 정한다**: 버튼 없는 토스트는 작업 · 아카이브 화면의 복사 토스트와 같은
 * 시간(`components/ui/toast.tsx`의 `TOAST_TIMEOUT_MS`)만큼 짧게 서고, 버튼이 든 토스트는 저절로 내려가지 않는다
 * (`timeout: 0`) — 1.6초 뒤에 사라지면 [모두 닫기]를 누를 틈이 없다.
 */
export function toastOptionsOf(notice: AppNotice): Parameters<typeof appToasts.add>[0] {
  if ("actions" in notice) {
    const data: ActionsData = { actions: notice.actions };
    return { id: notice.id, title: notice.text, timeout: 0, data };
  }
  return { id: notice.id, title: notice.text, timeout: TOAST_TIMEOUT_MS };
}

/**
 * 토스트의 데이터에서 버튼들을 읽는다 — 이 모양(`toastOptionsOf`가 실은 것)이 아니면 없다. 같은 매니저에 다른 데이터가 실린
 * 날에도 목록이 엉뚱한 것을 버튼으로 그리지 않는다.
 */
export function toastActionsOf(data: unknown): ReadonlyArray<ToastAction> {
  if (typeof data !== "object" || data === null || !("actions" in data)) return [];
  const { actions } = data as { actions: unknown };
  return Array.isArray(actions) ? (actions as ToastAction[]) : [];
}

/** 토스트 하나를 세운다. 앱 셸이 서기 전에 부르면 버려진다(`appToasts`의 머리말). */
export function showAppToast(notice: AppNotice): void {
  appToasts.add(toastOptionsOf(notice));
}

/**
 * 떠 있는 토스트의 글자를 고친다 — **떠 있을 때만이다.** 없는 id와 닫히는 중인 id에는 아무 일도 안 한다: Base UI 토스트 저장소가
 * 거른다(`store.js`의 `updateToastInternal`). **새로 세우지 않는다** — 사람이 이미 닫은 동작 토스트를 되살리지 않고 수만 맞출 때
 * 쓴다(주인 잃은 셸이 닫힌 뒤의 N). 같은 id로 다시 세우는 것은 `showAppToast`다.
 */
export function retextAppToast(id: string, text: string): void {
  appToasts.update(id, { title: text });
}
