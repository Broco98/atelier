import { appToasts } from "./app-toast";
import type { ToastAction } from "./app-toast";

/**
 * **`Processes`로 가는 문 하나**(프로세스 스펙 S15 · S14 · 티켓 32). 토스트의 [보기] 셋 — 시작 정리(티켓 10) · 주인 잃은
 * 셸(티켓 12) · 셸 스스로 끝남(티켓 13) — 과 띠의 주인 잃은 셸 줄(`useGoToShell`)이 이 문을 지난다.
 *
 * **길은 앱 셸이 건다**(`onViewProcesses`). 토스트는 스토어 · 순수 모듈이 짓는데(React 밖) 라우터는 앱 셸이 쥔다 — 토스트의
 * 알림 문(`appToasts`)을 모듈에 하나 둔 것과 같은 까닭이다. 걸린 길이 없으면(앱 셸이 서기 전) 아무 일도 없다.
 *
 * **가서 할 일은 닿은 순간에 한다**(`arrived` — develop 머지). 이동은 막힐 수 있다: spec 레이아웃 편집기의 떠날 때 확인이 저장하지
 * 않은 초안을 두고 떠나는 이동을 붙잡는다(`useConfirmLeave`). 길은 `arrived`를 **이동이 닿은 순간에만** 부른다 — 막혀 머물면
 * 안 부른다(`whenArrived`의 `processes` 칸).
 */
type ViewRoute = (arrived: () => void) => void;

let view: ViewRoute | null = null;

/**
 * 가는 길을 건다 — 푸는 함수를 돌려준다. **마지막에 건 것 하나다.** 풀기는 **제가 건 길만** 뗀다: StrictMode(dev)는 앱 셸의
 * 이펙트를 걸었다 풀었다 다시 거는데, 먼저 건 것을 푸는 손이 나중에 건 길을 떼면 [보기]가 아무 데도 안 간다.
 */
export function onViewProcesses(go: ViewRoute): () => void {
  view = go;
  return () => {
    if (view === go) view = null;
  };
}

/**
 * `Processes`로 간다. 닿으면 `arrived`를 부른다 — 막히면 안 부른다. 걸린 길이 없으면 아무 일도 없다(`arrived`도 안 부른다) —
 * 던지지 않는다.
 */
export function viewProcesses(arrived: () => void = () => {}): void {
  view?.(arrived);
}

/** [보기]의 글자. */
export const VIEW_LABEL = "보기";

/**
 * 토스트의 [보기]. 누르면 `Processes`로 가고, **닿으면** 그 토스트를 내린다 — 가서도 토스트가 남으면 본 알림이 화면을 가린다.
 *
 * **먼저 내리지 않는다**(develop 머지). 앱 토스트는 앱 셸에 서서 설정 화면에도 서고, spec 레이아웃 편집기의 떠날 때 확인이
 * 이동을 막을 수 있다. 먼저 내리면 [계속 편집]으로 머물 때 토스트가 사라진다 — 누를 때까지 남는 동작 토스트(프로세스 스펙
 * P2)라 되살릴 길이 없고, 주인 잃은 셸 토스트는 그 [모두 닫기]까지 함께 잃는다. 막히지 않으면 닿음은 이동을 거는 그 자리에서
 * 와서 예전처럼 곧바로 내려간다.
 */
export function viewAction(toastId: string): ToastAction {
  return {
    label: VIEW_LABEL,
    run: () => viewProcesses(() => appToasts.close(toastId)),
  };
}
