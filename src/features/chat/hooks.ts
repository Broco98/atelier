import { useEffect } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { chatApi, onChatQueue, onChatRecord } from "./api";
import {
  announce,
  chatQueueStore,
  chatRecordStore,
  chooseConversation,
  claimRecordRead,
  conversationKey,
  linesOf,
  mergeLines,
  releaseRecordRead,
  setQueue,
} from "./chat-store";
import { applyChanges, changedFiles } from "./changes";
import { finalMessages, foldConversation, headline } from "./fold";
import type { Agent, Conversation, QueuedMessage, RecordLine } from "./types";

// 대화창이 대화 호스트에서 읽는 것(three-axes 티켓 17). 명령은 `api.ts`이고, 여기는 그것을 화면의 수명에 잇는다.

/**
 * 그 work의 열린 대화들 — 만든 순서다. 열쇠는 `["chat", …]`이다: `["works", …]` 아래에 두면 `works:changed`가 올 때마다 함께
 * 낡아 다시 읽힌다(감시가 `agents/`를 빼도 spec을 쓰는 동안은 온다).
 *
 * **스스로 다시 읽지 않는다**(`staleTime: Infinity`). 목록이 바뀌는 것은 이 화면이 부른 새 대화 · 대화 닫기뿐이고, 그 응답으로
 * 캐시를 고친다(`useCreateConversation` · `useCloseConversation`). 창 포커스마다 다시 읽으면 고친 캐시를 덮는다.
 */
export const conversationsQuery = (work: string) =>
  queryOptions({
    queryKey: ["chat", "list", work],
    queryFn: () => chatApi.list(work),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

/** 대화 목록 — `enabled`가 거짓이면 읽지 않는다(대화창은 처음 보일 때 읽는다). 이미 읽은 것은 그대로 준다. */
export function useConversations(work: string, enabled: boolean) {
  return useQuery({ ...conversationsQuery(work), enabled });
}

/** 새 대화 — 만들고 곧바로 띄운다(S8). 만든 대화를 목록 끝에 붙이고 그 대화를 고른다. */
export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ work, agent }: { work: string; agent: Agent }) => chatApi.create(work, agent),
    onSuccess: (conversation, { work }) => {
      queryClient.setQueryData<Conversation[]>(conversationsQuery(work).queryKey, (old = []) =>
        old.some((one) => one.id === conversation.id) ? old : [...old, conversation],
      );
      chooseConversation(work, conversation.id);
    },
  });
}

/** 대화 닫기 — 에이전트를 끈다. 기록은 남는다. 닫힌 대화를 목록에서 뺀다. */
export function useCloseConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ work, conversation }: { work: string; conversation: string }) => chatApi.close(work, conversation),
    onSuccess: (_, { work, conversation }) => {
      queryClient.setQueryData<Conversation[]>(conversationsQuery(work).queryKey, (old = []) =>
        old.filter((one) => one.id !== conversation),
      );
    },
  });
}

/**
 * 그 대화의 기록 줄 — 처음 설 때 기록을 한 번 읽어(「0 다음부터」) 스토어에 합치고, 그 뒤는 앱 층이 받은 기록 줄 이벤트가
 * 잇는다. 같은 seq는 한 줄로 합쳐지므로 읽기와 이벤트가 겹쳐도 줄이 두 번 서지 않는다.
 */
export function useRecordLines(work: string, conversation: string): readonly RecordLine[] {
  const key = conversationKey(work, conversation);
  const lines = useStore(chatRecordStore, (state) => linesOf(state, key));
  useEffect(() => {
    if (!claimRecordRead(key)) return;
    chatApi.readRecord(work, conversation, 0).then(
      (read) => mergeLines(work, conversation, read),
      () => releaseRecordRead(key),
    );
  }, [key, work, conversation]);
  return lines;
}

/**
 * **기록 줄 이벤트를 받는 자리 — 앱에 하나다**(`AppShell`이 부른다). 어느 work의 어느 대화든 받아 스토어에 쌓는다 — 다른 work에
 * 가 있어도 쌓여야 돌아왔을 때 그사이 흐른 줄이 보인다(스토리 14 · 15). 턴 끝 줄이면 한 번 알리고(스토리 121), 고친 곳 줄이면
 * 그 work에 표시를 세운다(티켓 26) — 둘 다 처음 보는 seq일 때만이다.
 */
export function useChatRecordFeed(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = onChatRecord(({ work, conversation, line }) => {
      const key = conversationKey(work, conversation);
      const known = linesOf(chatRecordStore.state, key).some((one) => one.seq === line.seq);
      mergeLines(work, conversation, [line]);
      if (known) return;
      if (line.kind === "turn-end") announceTurnEnd(queryClient, work, conversation);
      // 고친 곳(티켓 26) — 표시는 이벤트로 온 `changes`로만 선다. 처음 그릴 때 읽은 기록의 것은 지난 턴이라 세우지 않는다(S19).
      if (line.kind === "changes") applyChanges(work, changedFiles(line.payload));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);
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

/** 턴 끝 알림의 글 — 대화 이름 · 머리줄 · 턴 끝 메시지. 마크다운 표식은 소리로 읽히지 않게 걷는다. */
function announceTurnEnd(queryClient: QueryClient, work: string, conversation: string): void {
  const { turns } = foldConversation(linesOf(chatRecordStore.state, conversationKey(work, conversation)));
  const turn = turns[turns.length - 1];
  if (!turn?.end) return;
  const name =
    queryClient
      .getQueryData<Conversation[]>(conversationsQuery(work).queryKey)
      ?.find((one) => one.id === conversation)?.name ?? "대화";
  const answer = finalMessages(turn)
    .map((entry) => (entry.kind === "message" ? entry.text : ""))
    .join("\n")
    .replace(/[`*_#>]/g, "")
    .trim();
  // 스스로 이어 간 턴은 그렇다고 말한다 — 보내지 않은 턴이 왜 끝났다고 알리는지 듣는 사람이 안다(S4 · three-axes 티켓 20).
  const head = turn.selfContinued ? `${name} · 스스로 이어 감 · ${headline(turn.end)}` : `${name} · ${headline(turn.end)}`;
  announce([head, answer].filter(Boolean).join(" — "));
}
