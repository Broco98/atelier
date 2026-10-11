import { chatApi } from "./api";
import type { ChatQuitCounts } from "./types";

// 앱 종료 확인 창의 대화 몫(three-axes 티켓 23 · S13). 종료하면 대화의 에이전트도 함께 꺼진다 — 쉬는 대화는 다시 켜면 말을 보낼 때
// 되살아나 잃을 것이 없지만, 도는 턴은 끊기고 대기 중인 말은 메모리에만 있어 사라지고 답하지 않은 승인은 거둬진다. 그 셋을 센다.
// 창과 「묻는 중」 표시는 `components/shell/quit-request.ts`가 들고, 여기는 셈과 그 줄의 말만 든다.

/** 셀 것이 없다 — 셈이 거절됐을 때도 이것이다. */
export const NO_CHATS_TO_LOSE: ChatQuitCounts = { running: 0, queued: 0, approvals: 0 };

/**
 * 대화 셈 — 대화 호스트가 앱 전체에서 한 번에 답한다. **거절되면 0으로 센다**: 여기서 던지면 종료 확인 창이 안 뜨고, 안전판이
 * 없어서(UI개선 결정 31) 창이 못 뜨는 길은 곧 앱을 끌 수 없는 길이다(`countQuitShells`의 머리말과 같은 까닭).
 */
export function countChatsForQuit(): Promise<ChatQuitCounts> {
  return chatApi.quitCounts().catch(() => NO_CHATS_TO_LOSE);
}

/**
 * 종료 확인 창의 대화 줄 — 「턴이 도는 대화 N · 대기 중인 말 N · 답하지 않은 승인 N」. **셋 다 0이면 없다**(`undefined`) — 잃을 것이
 * 없는 대화는 적지 않는다. 하나라도 있으면 셋을 다 적는다: 셸 줄이 「명령이 도는 셸 0」을 적는 것과 같은 꼴이다. 「대화」 · 「턴」은
 * `CONTEXT.md`의 말이다.
 */
export function chatQuitNotice({ running, queued, approvals }: ChatQuitCounts): string | undefined {
  if (running === 0 && queued === 0 && approvals === 0) return undefined;
  return `턴이 도는 대화 ${running} · 대기 중인 말 ${queued} · 답하지 않은 승인 ${approvals}`;
}
