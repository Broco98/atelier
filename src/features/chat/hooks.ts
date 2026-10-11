import { useEffect } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { chatApi, onChatRecord } from "./api";
import {
  announce,
  chatRecordStore,
  chooseConversation,
  claimRecordRead,
  conversationKey,
  linesOf,
  mergeLines,
  releaseRecordRead,
} from "./chat-store";
import { finalMessages, foldConversation, headline } from "./fold";
import type { Agent, Conversation, RecordLine } from "./types";

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
 * 가 있어도 쌓여야 돌아왔을 때 그사이 흐른 줄이 보인다(스토리 14 · 15). 턴 끝 줄이면 한 번 알린다(스토리 121).
 */
export function useChatRecordFeed(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = onChatRecord(({ work, conversation, line }) => {
      const key = conversationKey(work, conversation);
      const known = linesOf(chatRecordStore.state, key).some((one) => one.seq === line.seq);
      mergeLines(work, conversation, [line]);
      if (line.kind === "turn-end" && !known) announceTurnEnd(queryClient, work, conversation);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);
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
  announce([`${name} · ${headline(turn.end)}`, answer].filter(Boolean).join(" — "));
}
