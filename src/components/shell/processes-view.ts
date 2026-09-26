import { routesOf } from "@/mode";
import { appToasts } from "./app-toast";
import type { ToastAction } from "./app-toast";
import { shellMode } from "./shell-store";

/**
 * **`Processes`로 가는 문 하나**(프로세스 스펙 S15 · S14 · 티켓 32). 토스트의 [보기] 셋 — 시작 정리(티켓 10) · 주인 잃은
 * 셸(티켓 12) · 셸 스스로 끝남(티켓 13) — 과 띠의 주인 잃은 셸 줄(`useGoToShell`)이 이 문을 지난다.
 *
 * **길은 앱 셸이 건다**(`onViewProcesses`). 토스트는 스토어 · 순수 모듈이 짓는데(React 밖) 라우터는 앱 셸이 쥔다 — 토스트의
 * 알림 문(`appToasts`)을 모듈에 하나 둔 것과 같은 까닭이다. 걸린 길이 없으면(앱 셸이 서기 전) 아무 일도 없다.
 */
let view: (() => void) | null = null;

/**
 * 가는 길을 건다 — 푸는 함수를 돌려준다. **마지막에 건 것 하나다.** 풀기는 **제가 건 길만** 뗀다: StrictMode(dev)는 앱 셸의
 * 이펙트를 걸었다 풀었다 다시 거는데, 먼저 건 것을 푸는 손이 나중에 건 길을 떼면 [보기]가 아무 데도 안 간다.
 */
export function onViewProcesses(go: () => void): () => void {
  view = go;
  return () => {
    if (view === go) view = null;
  };
}

/** `Processes`로 간다. 걸린 길이 없으면 아무 일도 없다 — 던지지 않는다. */
export function viewProcesses(): void {
  view?.();
}

/**
 * 가는 주소 — **지금 세계의** `Processes`다. 화면은 앱 전체를 보이므로(프로세스 결정 9) 보러 가려고 세계를 건너지 않는다.
 * 세계는 셸이 드는 것과 같이 읽는다(`shellMode`): 설정(`/settings`)은 세계 밖이라 마지막 세계의 주소다.
 */
export function processesAddress(pathname: string): string {
  return routesOf(shellMode(pathname)).processes;
}

/** [보기]의 글자. */
export const VIEW_LABEL = "보기";

/** 토스트의 [보기]. 누르면 그 토스트를 내리고 `Processes`로 간다 — 가서도 토스트가 남으면 본 알림이 화면을 가린다. */
export function viewAction(toastId: string): ToastAction {
  return {
    label: VIEW_LABEL,
    run: () => {
      appToasts.close(toastId);
      viewProcesses();
    },
  };
}
