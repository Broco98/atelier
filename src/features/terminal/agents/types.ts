import type { ShellHookState } from "../types";

/**
 * 정규 이벤트 아홉. **에이전트별 페이로드는 여기까지만 온다** — 어느 훅 이름이 어느 정규
 * 이벤트인지는 어댑터가 알고, 그 뒤 「그래서 화면값이 무엇이 되는가」는 `shell-attention.ts`
 * 하나가 안다. 에이전트를 더할 때 느는 것이 어댑터 한 파일뿐인 것은 그 가름 덕이다.
 *
 * 이름마다 **무엇이 됐는가**가 아니라 **무슨 일이 났는가**를 말한다(프로세스 결정 13의 전이 표 — 결과 칸은 상태
 * 기계가 든다):
 * - `start` 사람이 말을 넣었다 · `tool` 도구가 돈다(기다림이 풀린다) · `waiting` 사람이 답해야 한다
 * - `stop` 턴이 멈췄다 · `stopFailure` 턴이 API 오류로 멈췄다
 * - `subagent` 서브에이전트가 뜨거나 졌다 — **수는 여기 없다**: 처리기가 id 집합으로 접어 상태 파일에 싣고
 *   (`ShellHookState.subagents`) 상태 기계가 그 칸을 읽는다. 어댑터는 사건 이름만 본다.
 * - `interrupt` 사람이 끊었다 · `clear` 대화를 지웠다(`/clear`) · `end` 세션이 끝났다
 *
 * **옛 판에는 다섯이었고 `stop`과 `waiting`이 둘 다 「나를 기다림」이었다**(terminal-activity-signal 결정 3의 표 ·
 * 같은 work 결정 12). 프로세스 결정 13이 이렇게 고쳤다: 턴의 끝은 사람이 답할 것이 아니라 **아직 안 본 결과**(확인할
 * 것)이고, 기다림은 사람이 답해야 할 때(승인 · elicitation · `AskUserQuestion`)만 선다. 그래서 두 이름은 이제
 * 결과까지 갈린다.
 */
export type CanonicalEvent =
  | "start"
  | "tool"
  | "waiting"
  | "stop"
  | "stopFailure"
  | "subagent"
  | "interrupt"
  | "clear"
  | "end";

/**
 * 기다림이 선 **창** — 사람이 무엇에 답하나(프로세스 티켓 25 리뷰 반영). 승인 추론(`shell-attention.ts`의 `inferApproval`)이 이 값 하나로
 * 창을 가린다 — 판 03 선행 시험의 「권한 창의 키」 표는 권한 창을 잰 것이라 다른 창의 키는 읽지 않는다.
 *
 * - `permission` — 권한 창. 도구 하나를 허락할지 묻고, 첫째 선택지가 늘 `Yes`다(프로세스 티켓 18의 표 · 2.1.283 소스).
 * - `question` — 물음 창. 에이전트가 사람에게 답을 묻는다(`AskUserQuestion` · MCP Elicitation). 첫째는 첫 물음의 첫
 *   선택지이고, `AskUserQuestion`은 답을 고르면 다음 물음으로 넘어가 마지막 뒤에 제출 화면을 세운다(2.1.283 소스) — 물음이
 *   여럿이면 첫 답 뒤에도 창이 남는다.
 */
export type DialogKind = "permission" | "question";

/**
 * 어댑터가 접어 낸 것. **`message`가 `null`이면 「직전 것을 그대로 둔다」**이지 「지운다」가
 * 아니다 — 지우는 규칙(`clear` · `interrupt` · `end`)은 정규 이벤트에 매여 있어 어댑터가 아니라
 * `shell-attention.ts`가 든다. `stopFailure`의 `message`는 오류 상세 한 줄이고, 「오류로 끝남」을 앞에 붙이는
 * 것도 그쪽이다.
 *
 * **기다림만 창(`dialog`)을 싣고, 늘 싣는다.** 비워 둘 수 있는 자리면 기다림을 내는 길(어댑터 · OSC)이 하나 늘 때 그 값을
 * 빠뜨려도 조용히 통과한다. 모르는 쪽(OSC — 훅 없는 codex의 승인 요청, 도구 이름을 못 읽은 요청)은 `null`을 적는다.
 */
export type AgentSignal =
  | { event: "waiting"; message: string | null; dialog: DialogKind | null }
  | { event: Exclude<CanonicalEvent, "waiting">; message: string | null };

/** 에이전트 하나의 훅 페이로드를 정규 이벤트로 접는 자리. **모르는 이벤트는 `null`이다.** */
export interface AgentAdapter {
  fold(state: ShellHookState): AgentSignal | null;
}
