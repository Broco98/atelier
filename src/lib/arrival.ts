import type { RegisteredRouter } from "@tanstack/react-router";

/**
 * **이동이 닿으면 할 일**(develop 머지 — 프로세스 스펙 S21 · S15와 spec 레이아웃 결정 27의 짝). 이동을 거는 쪽이 이동 **때문에**
 * 하는 일을 **이동이 실제로 닿은 순간**으로 미룬다. 길이 둘이다(칸 — `ArrivalSlot`):
 *
 * - `shell` — 셸로 가는 길(`useGoToShell`)이 그 셸을 켜고 포커스를 요청하는 것.
 * - `processes` — 토스트의 [보기](`viewAction`)가 그 토스트를 내리는 것. 먼저 내리면 막혀 머물 때 누를 때까지 남는 동작
 *   토스트(프로세스 스펙 P2)가 되살릴 길 없이 사라진다 — 주인 잃은 셸 토스트면 그 [모두 닫기]까지.
 *
 * **왜 미루나.** 이동은 막힐 수 있다 — spec 레이아웃 편집기는 저장하지 않은 초안을 두고 떠나는 이동을 라우터의 막기
 * 하나로 붙잡고 묻는다(`useConfirmLeave`). 이동을 걸기 전에 켜고 요청해 두면, 사람이 [계속 편집]으로 머물러도 그 둘이
 * 남는다: 사람이 안 시킨 탭 바뀜과, 그 셸이 붙거나 닫힐 때까지 다른 셸이 붙어도 포커스를 못 받게 하는 기다리는 포커스다
 * (`focusOnAttach`의 첫 줄). 토스트를 먼저 내리면 머물러도 토스트가 없다 — 앱 토스트는 앱 셸에 서서 설정 화면에도 선다.
 * 두 쪽은 각자 옳았고 짝이 깨졌다 — 막기는 이동을 건 쪽에 막았다고 알리지 않고, 막힌 이동의 `navigate` 약속은 다음 이동이
 * 닿을 때까지 안 풀린다.
 *
 * **닿음은 라우터의 `onBeforeNavigate`로 본다.** 이동이 막기를 지나 히스토리에 적힌 순간 — 막기가 없으면 `navigate`를 부른
 * 그 자리에서, 막기가 물었으면 답한 뒤에 — 그리고 새 화면이 그려지기 **전에** 온다. 주소가 그대로인 이동(보고 있던 화면)도
 * 히스토리 없이 라우터를 다시 돌려 이것이 온다. 그래서 막히지 않은 길은 예전과 같다: 켜진 셸로 새 화면이 처음부터 서고,
 * 요청은 그 셸이 붙기 전에 적힌다.
 *
 * **막히면 거둔다 — 막는 쪽이 알린다**(`announceStay`). 거두지 않으면 다음에 닿는 이동이 같은 주소일 때(「앱으로 돌아가기」가
 * 들어오기 전의 그 work 화면으로 간다) 사람이 물리친 요청이 되살아난다. 그래서 「다음 닿음이 그 주소면」만으로는 모자라다.
 *
 * - **다음 닿음 하나가 끝낸다.** 그 주소가 아니면 할 일 없이 거둔다 — 사이에 다른 이동이 닿았으면 그 요청은 낡았다.
 * - **칸마다 한 번에 하나다.** 같은 칸의 새 요청이 앞의 것을 덮는다(기다리는 포커스와 같은 규칙 — `nextPendingFocus`). **칸이
 *   다르면 서로 안 덮는다** — 셸로 가는 요청이 [보기]의 토스트 내리기를 지우거나 그 반대가 되지 않게 칸을 가른다. 머묾은
 *   모든 칸을 거둔다: 막힌 이동은 하나이고, 그것을 기다리던 일은 무엇이든 낡았다.
 */

/** 이 모듈이 라우터에서 쓰는 것 — 이동 사건 구독 하나. 검사가 제 라우터를 준다. */
type ArrivalRouter = Pick<RegisteredRouter, "subscribe">;

/** 기다리는 닿음의 칸 — 이동을 거는 길마다 하나다(머리말). */
export type ArrivalSlot = "shell" | "processes";

/** 칸마다 기다리는 닿음을 거두는 함수. 칸이 비어 있으면 그 칸에 기다리는 것이 없다. */
const settles = new Map<ArrivalSlot, () => void>();

/**
 * 다음 이동이 `href`(라우터 안 주소 — `ParsedLocation.href`)에 닿으면 `arrive`를 한 번 부른다. **이동을 걸기 전에 부른다** —
 * 막기가 없으면 닿음이 `navigate` 안에서 곧바로 온다. `slot`에 앞서 기다리던 것이 있으면 그것을 덮는다.
 */
export function whenArrived(router: ArrivalRouter, href: string, arrive: () => void, slot: ArrivalSlot): void {
  settles.get(slot)?.();
  const end = () => {
    off();
    if (settles.get(slot) === end) settles.delete(slot);
  };
  const off = router.subscribe("onBeforeNavigate", ({ toLocation }) => {
    end();
    if (toLocation.href === href) arrive();
  });
  settles.set(slot, end);
}

/**
 * 떠나는 이동을 막았다 — 사람이 머문다. **이동을 막는 쪽이 막는 그 순간 부른다**([계속 편집] · 저장하고 나가려다 저장이
 * 안 됨). 모든 칸의 기다리던 닿음을 할 일 없이 거둔다.
 */
export function announceStay(): void {
  for (const end of [...settles.values()]) end();
}
