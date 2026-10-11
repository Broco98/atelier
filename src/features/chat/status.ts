import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { chatRecordStore, chatUnseenStore, conversationKey, linesOf } from "./chat-store";
import { foldOf, type ChatModel } from "./fold";
import { conversationsQuery } from "./hooks";
import type { Conversation } from "./types";

// 대화의 상태(three-axes 티켓 23 · S23) — 대화 탭의 상태 점과 레일 `chat`의 점이 읽는다. **화면이 기록에서 계산한다**: 접은 기록
// (`foldOf` — 대화 몸과 같은 값)과, 화면이 메모리에 쥔 「봤다」(`chatUnseenStore`)에서 나온다.
//
// 말은 이 표 하나에서 온다. 셸의 신호 말(`SIGNAL_LABEL` — 「도는 중 · 확인할 것」)을 빌리지 않는다: 대화의 상태는 넷이고 「이어 붙이는
// 중」이 셸에는 없다.

/** 대화의 상태 넷. 쉬고 있고 볼 것도 없으면 상태가 없다(`null`). */
export type ConversationStatus = "connecting" | "working" | "waiting" | "done";

/** 상태의 말 — 대화 탭의 접근성 이름이 「이름 — 상태」로 싣는다(스토리 118). */
export const STATUS_LABEL: Readonly<Record<ConversationStatus, string>> = {
  connecting: "이어 붙이는 중",
  working: "일하는 중",
  waiting: "나를 기다림",
  done: "끝남",
};

/**
 * 대화 목록이 「에이전트가 이 앱에 떠 있지 않다」고 말했으면 그때의 마지막 seq(`fold.ts`의 `goneThrough`). 앱을 다시 켠 뒤의
 * 기록은 그 seq까지 열린 채 남은 턴과 물음을 끝난 것으로 접는다 — 그러지 않으면 끊긴 턴이 「일하는 중」으로 영영 남는다.
 */
export const goneThrough = (conversation: Conversation): number | null => (conversation.live ? null : conversation.lastSeq);

/**
 * 상태 하나 — 겹치면 사람에게 더 급한 것이 이긴다. 답할 권한 요청이 있으면 턴도 돌지만 「나를 기다림」이고, 새 턴이 돌면 앞 턴의
 * 「끝남」은 그 턴이 끝날 때까지 「일하는 중」 뒤에 숨는다.
 */
export function statusOf(model: ChatModel, unseen: boolean): ConversationStatus | null {
  if (model.pending.length > 0) return "waiting";
  if (model.running) return "working";
  if (model.connecting) return "connecting";
  return unseen ? "done" : null;
}

/** 그 대화의 접은 기록 — 대화 몸과 같은 값이다(같은 줄은 한 번만 접는다). 기록을 읽는 것은 대화 몸이다(`useRecordLines`). */
export function useConversationModel(work: string, conversation: Conversation): ChatModel {
  const lines = useStore(chatRecordStore, (state) => linesOf(state, conversationKey(work, conversation.id)));
  return foldOf(lines, goneThrough(conversation));
}

/** 그 대화의 상태 — 대화 탭의 점. */
export function useConversationStatus(work: string, conversation: Conversation): ConversationStatus | null {
  const model = useConversationModel(work, conversation);
  const unseen = useStore(chatUnseenStore, (state) => state[conversationKey(work, conversation.id)] === true);
  return statusOf(model, unseen);
}

/** 레일 `chat` 칸의 점이 말하는 것 — 그 work의 어느 대화가 나를 기다리거나(`waiting`) 끝났다(`done`). 기다림이 이긴다. */
export type WorkChatSignal = "waiting" | "done";

/**
 * 그 work의 대화들이 레일에 말할 것(결정 10). 대화 목록을 읽은 work면 그 대화들을, 아직 안 읽었으면(대화창을 연 적 없다) 기록
 * 줄 이벤트로 쌓인 대화들을 본다. 레일은 대화창이 보일 때 점을 세우지 않는다 — 그 판단은 무엇이 보이는지 아는 화면의 것이다.
 * **목록을 읽지 않는다** — 대화창은 처음 보일 때 목록을 읽는다(티켓 17).
 */
export function useWorkChatSignal(work: string | null): WorkChatSignal | null {
  const listed = useQuery({ ...conversationsQuery(work ?? ""), enabled: false }).data;
  const unseen = useStore(chatUnseenStore, (state) => state);
  return useStore(chatRecordStore, (state) => {
    if (!work) return null;
    const conversations: { id: string; gone: number | null }[] = listed
      ? listed.map((one) => ({ id: one.id, gone: goneThrough(one) }))
      : Object.keys(state.lines)
          .filter((key) => key.startsWith(conversationKey(work, "")))
          .map((key) => ({ id: key.slice(conversationKey(work, "").length), gone: null }));
    let done = false;
    for (const { id, gone } of conversations) {
      const key = conversationKey(work, id);
      const status = statusOf(foldOf(linesOf(state, key), gone), unseen[key] === true);
      if (status === "waiting") return "waiting";
      if (status === "done") done = true;
    }
    return done ? "done" : null;
  });
}

/**
 * 대화를 닫기 전에 묻는 말(S25 · 스토리 11) — 턴이 돌거나 답하지 않은 승인이 걸려 있으면 그 말, 아니면 `null`(묻지 않고 닫는다). 닫으면
 * 에이전트가 꺼져 도는 턴이 끊기고 걸린 물음이 거둬진다. 둘 다면 사람이 답할 물음을 말한다 — 상태 점과 같은 차례다.
 */
export function closeNotice(model: ChatModel): string | null {
  if (model.pending.length > 0) return "답하지 않은 승인이 있어요 — 닫으면 그 물음이 거둬져요. 닫을까요?";
  if (model.running) return "에이전트가 일하는 중이에요 — 닫으면 그 턴이 끊겨요. 닫을까요?";
  return null;
}
