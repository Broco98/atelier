import { threadApi } from "./api";
import type { QuitCounts } from "./types";

// 앱 종료 확인 창의 Thread 몫(S40 · three-axes 티켓 23). 종료하면 Thread의 Agent도 함께 꺼진다 — 쉬는 Session은 다시 켜면 말을 보낼
// 때 되살아나 잃을 것이 없지만, 도는 턴은 끊기고 대기 중인 말은 메모리에만 있어 사라지고 답하지 않은 승인은 거둬진다. 그 셋을 센다.
// 창과 「묻는 중」 표시는 `components/shell/quit-request.ts`가 들고, 여기는 셈과 그 줄의 말만 든다.

/** 셀 것이 없다 — 셈이 거절됐을 때도 이것이다. */
export const NOTHING_TO_LOSE: QuitCounts = { running: 0, queued: 0, approvals: 0 };

/**
 * Thread 셈 — 엔진이 앱 전체에서 한 번에 답한다. **거절되면 0으로 센다**: 여기서 던지면 종료 확인 창이 안 뜨고, 안전판이
 * 없어서(UI개선 결정 31) 창이 못 뜨는 길은 곧 앱을 끌 수 없는 길이다(`countQuitShells`의 머리말과 같은 까닭).
 */
export function countThreadsForQuit(): Promise<QuitCounts> {
  return threadApi.quitCounts().catch(() => NOTHING_TO_LOSE);
}

/**
 * 종료 확인 창의 Thread 줄 — 「턴이 도는 Agent N · 대기 중인 말 N · 답하지 않은 승인 N」. **셋 다 0이면 없다**(`undefined`) — 잃을
 * 것이 없으면 적지 않는다. 하나라도 있으면 셋을 다 적는다: 셸 줄이 「명령이 도는 셸 0」을 적는 것과 같은 꼴이다. 턴은 Agent의 것이라
 * 세는 말은 Agent다(Session은 Agent 하나의 맥락이다 — `CONTEXT.md`).
 */
export function threadQuitNotice({ running, queued, approvals }: QuitCounts): string | undefined {
  if (running === 0 && queued === 0 && approvals === 0) return undefined;
  return `턴이 도는 Agent ${running} · 대기 중인 말 ${queued} · 답하지 않은 승인 ${approvals}`;
}
