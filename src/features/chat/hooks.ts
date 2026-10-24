import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { chatApi, onChatEngine, onChatQueue, onChatRecord } from "./api";
import {
  announce,
  chatQueueStore,
  chatRecordStore,
  conversationKey,
  linesOf,
  markChosen,
  markFinished,
  mergeLines,
  setQueue,
} from "./chat-store";
import { describeApproval } from "./approval";
import { applyChanges, changedFiles } from "./changes";
import { listedConversation, replaceConversation } from "./conversation-list";
import { applyEngineEvent, checkEngine, isLoginRequired, markLoginRequired } from "./engine-store";
import { finalMessages, foldConversation, headline } from "./fold";
import type { Agent, Conversation, QueuedMessage, RecordLine } from "./types";

// 대화창이 대화 호스트에서 읽는 것(three-axes 티켓 17). 명령은 `api.ts`이고, 여기는 그것을 화면의 수명에 잇는다. 그 work의 대화
// 목록과 그 수명(목록 읽기 · 새 대화 · 닫기 · 기록 읽기)은 `conversation-list.ts`가 쥔다.

/**
 * 에이전트 바꾸기(three-axes 티켓 19 · 스토리 23) — 첫 말 전에만 된다. 바꾸기 전에 새 엔진을 확인해 둔다(티켓 22): 찾았어도 로그인이
 * 안 됐으면 바뀐 대화 자리에 곧바로 로그인 카드가 선다. 못 찾았으면 호스트가 바꾸지 않고 그 까닭을 돌려준다. 답(새 엔진으로 연
 * 대화 — 이름도 다시 붙는다)으로 대화 목록을 고친다.
 */
export function useSwitchAgent() {
  return useMutation({
    mutationFn: async ({ work, conversation, agent }: { work: string; conversation: string; agent: Agent }) => {
      await checkEngine(agent, false).catch(() => null);
      return chatApi.switchAgent(work, conversation, agent);
    },
    onSuccess: (conversation, { work }) => replaceConversation(work, conversation),
  });
}

/** 칩의 바꾸기 하나 — 칸과 값. 계획은 켬 · 끔이다. */
export type ChoiceChange = { field: "model" | "mode"; value: string } | { field: "plan"; value: boolean };

/**
 * 모델 · 모드 · 계획 바꾸기(three-axes 티켓 19 · 스토리 26 · 30 · 31 · 32) — 값은 그 대화의 것이고 설정의 기본값은 그대로다. 답(바뀐
 * 대화)으로 대화 목록을 고치고, 그 답의 마지막 seq를 「사람이 고른 때」로 적어 둔다(`markChosen`).
 */
export function useChangeChoice() {
  return useMutation({
    mutationFn: ({ work, conversation, change }: { work: string; conversation: string; change: ChoiceChange }) => {
      if (change.field === "plan") return chatApi.setPlan(work, conversation, change.value);
      if (change.field === "model") return chatApi.setModel(work, conversation, change.value);
      return chatApi.setMode(work, conversation, change.value);
    },
    onSuccess: (conversation, { work, change }) => {
      replaceConversation(work, conversation);
      markChosen(conversationKey(work, conversation.id), change.field, conversation.lastSeq);
    },
  });
}

/**
 * **기록 줄 이벤트를 받는 자리 — 앱에 하나다**(`AppShell`이 부른다). 어느 work의 어느 대화든 받아 스토어에 쌓는다 — 다른 work에
 * 가 있어도 쌓여야 돌아왔을 때 그사이 흐른 줄이 보인다(스토리 14 · 15). 턴 끝 줄이면 한 번 알리고(스토리 121), 고친 곳 줄이면
 * 그 work에 표시를 세우고(티켓 26), 로그인 필요 줄이면 그 엔진을 「안 됨」으로 돌린다(티켓 22). 턴 끝 · 죽음 줄이면 그 대화에
 * 「끝남」을 세운다(티켓 23) — 모두 처음 보는 seq일 때만이다.
 */
export function useChatRecordFeed(): void {
  useEffect(() => {
    const unlisten = onChatRecord(({ work, conversation, line }) => {
      const key = conversationKey(work, conversation);
      const known = linesOf(chatRecordStore.state, key).some((one) => one.seq === line.seq);
      mergeLines(work, conversation, [line]);
      if (known) return;
      if (line.kind === "turn-end") announceTurnEnd(work, conversation);
      // 턴이 끝났다(죽음으로 끊긴 것도) — 그 대화를 지금 보고 있지 않으면 「끝남」이 선다(S23 · three-axes 티켓 23).
      if (line.kind === "turn-end" || isDeath(line)) markFinished(key);
      // 권한 물음 — 승인 카드가 선다. 에이전트가 나를 기다리는 것을 알림으로 듣는다(스토리 120 · three-axes 티켓 21).
      if (line.kind === "permission") announceApproval(work, conversation, line);
      // 고친 곳(티켓 26) — 표시는 이벤트로 온 `changes`로만 선다. 처음 그릴 때 읽은 기록의 것은 지난 턴이라 세우지 않는다(S19).
      if (line.kind === "changes") applyChanges(work, changedFiles(line.payload));
      // 로그인 필요 줄은 그 엔진의 「로그인 안 됨」이다 — 같은 엔진의 대화 자리에 다 안내 카드가 선다(three-axes 티켓 22).
      if (isLoginRequired(line)) {
        const agent = listedConversation(work, conversation)?.agent;
        if (agent) markLoginRequired(agent);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}

/**
 * **엔진 상태 이벤트를 받는 자리 — 앱에 하나다**(`AppShell`이 부른다, three-axes 티켓 22). 찾음 · 로그인 · 로그인 진행은 대화가
 * 아니라 엔진의 것이라 엔진 스토어에 앉히고, 그 엔진의 안내 카드가 다 따라 바뀐다. 대화창이 저마다 들으면 하나만 받는다.
 */
export function useChatEngineFeed(): void {
  useEffect(() => {
    const unlisten = onChatEngine(applyEngineEvent);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}

/**
 * 그 대화의 대기 줄(three-axes 티켓 20) — 대기 줄 바뀜 이벤트가 온 대화는 그 값, 아직 안 왔으면 대화 목록이 실어 온 값이다.
 * 대기 줄은 기록에 없어(S13) 다시 그릴 때도 이 둘로 그린다.
 */
export function useQueue(work: string, conversation: Conversation): readonly QueuedMessage[] {
  const key = conversationKey(work, conversation.id);
  const fed = useStore(chatQueueStore, (state) => state[key]);
  return fed ?? conversation.queue;
}

/**
 * **대기 줄 바뀜 이벤트를 받는 자리 — 앱에 하나다**(`AppShell`이 부른다, three-axes 티켓 20). 기록 줄처럼 어느 work의 어느 대화든
 * 받아 스토어에 둔다 — 다른 work에 가 있는 동안 턴이 끝나 대기 말이 가도, 돌아오면 줄어든 대기 줄이 보인다.
 */
export function useChatQueueFeed(): void {
  useEffect(() => {
    const unlisten = onChatQueue(({ work, conversation, queue }) => setQueue(work, conversation, queue));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}

/** 에이전트 프로세스가 죽었다는 `session` 줄인가. */
function isDeath(line: RecordLine): boolean {
  return line.kind === "session" && (line.payload as { state?: unknown } | null)?.state === "died";
}

/** 그 대화의 이름 — 읽은 대화 목록에서. 모르면 「대화」다. */
function conversationName(work: string, conversation: string): string {
  return listedConversation(work, conversation)?.name ?? "대화";
}

/**
 * 승인 카드가 설 때의 알림 — 대화 이름 · 카드가 묻는 말 · 무엇을 하려는지(명령 · 경로). 카드와 같은 값(`describeApproval`)을 말한다.
 * 이미 닫힌 물음(같은 seq 묶음에서 답이 먼저 접힌 것)은 알리지 않는다.
 */
function announceApproval(work: string, conversation: string, line: RecordLine): void {
  const payload = line.payload as { state?: unknown; requestId?: unknown } | null;
  if (payload?.state !== "asked") return;
  const { pending } = foldConversation(linesOf(chatRecordStore.state, conversationKey(work, conversation)));
  const request = pending.find((one) => one.requestId === payload.requestId);
  if (!request) return;
  const view = describeApproval(request);
  const head = `${conversationName(work, conversation)} · ${view.title}`;
  announce(view.subject ? `${head} — ${view.subject}` : head);
}

/** 턴 끝 알림의 글 — 대화 이름 · 머리줄 · 턴 끝 메시지. 마크다운 표식은 소리로 읽히지 않게 걷는다. */
function announceTurnEnd(work: string, conversation: string): void {
  const { turns } = foldConversation(linesOf(chatRecordStore.state, conversationKey(work, conversation)));
  const turn = turns[turns.length - 1];
  if (!turn?.end) return;
  const name = conversationName(work, conversation);
  const answer = finalMessages(turn)
    .map((entry) => (entry.kind === "message" ? entry.text : ""))
    .join("\n")
    .replace(/[`*_#>]/g, "")
    .trim();
  // 스스로 이어 간 턴은 그렇다고 말한다 — 보내지 않은 턴이 왜 끝났다고 알리는지 듣는 사람이 안다(S4 · three-axes 티켓 20).
  const head = turn.selfContinued ? `${name} · 스스로 이어 감 · ${headline(turn.end)}` : `${name} · ${headline(turn.end)}`;
  announce([head, answer].filter(Boolean).join(" — "));
}
