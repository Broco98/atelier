import type { ShellHookState } from "../types";

/**
 * 정규 이벤트 다섯. **에이전트별 페이로드는 여기까지만 온다** — 어느 훅 이름이 어느 정규
 * 이벤트인지는 어댑터가 알고, 그 뒤 「그래서 화면값이 무엇이 되는가」는 `shell-attention.ts`
 * 하나가 안다. 에이전트를 더할 때 느는 것이 어댑터 한 파일뿐인 것은 그 가름 덕이다.
 *
 * `waiting`과 `stop`은 **둘 다 「나를 기다림」이 된다**. 그런데도 이름이 둘인 것은 message가
 * 나오는 자리가 달라서다 — `waiting`은 지금 묻는 것(도구 이름 · elicitation 문구)을 싣고,
 * `stop`은 방금 한 말의 첫 줄을 싣거나(`Stop`) 직전 것을 그대로 둔다(`Interrupt`). 스펙의
 * 전이 표는 그 줄들의 「정규 이벤트」 칸을 셋 다 `waiting`으로 적었지만 같은 문장이 정규
 * 이벤트를 **다섯**이라 세므로, 다섯째 이름이 앉을 자리는 여기다.
 */
export type CanonicalEvent = "start" | "waiting" | "stop" | "end" | "clear";

/**
 * 어댑터가 접어 낸 것. **`message`가 `null`이면 「직전 것을 그대로 둔다」**이지 「지운다」가
 * 아니다 — 지우는 것은 `clear` 하나뿐이고 그 규칙은 정규 이벤트에 매여 있어 어댑터가 아니라
 * `shell-attention.ts`가 든다.
 */
export interface AgentSignal {
  event: CanonicalEvent;
  message: string | null;
}

/** 에이전트 하나의 훅 페이로드를 정규 이벤트로 접는 자리. **모르는 이벤트는 `null`이다.** */
export interface AgentAdapter {
  fold(state: ShellHookState): AgentSignal | null;
}
