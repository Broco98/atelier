import { useEffect } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { onThreadEngine, onThreadList, onThreadQueue, onThreadRecord, threadApi } from "./api";
import { applyEngineEvent, isLoginRequired, markLoginRequired } from "./engine-store";
import { mergeLines, threadQueueStore, setQueue } from "./thread-store";
import type { AgentRoster, Participant, QueuedMessage, ThreadSummary, ThreadView } from "./types";

// Thread 화면이 엔진에서 읽는 것(v1 티켓 05). 명령은 `api.ts`이고, 여기는 그것을 화면의 수명과 쿼리 캐시에 잇는다.

const THREADS_KEY = ["threads"] as const;
const threadKey = (thread: string) => ["thread", thread] as const;

/** 모든 Thread의 요약 — 사이드바의 Thread 묶음. 엔진이 요약 이벤트로 고쳐 주므로 다시 읽지 않는다(`useThreadFeeds`). */
export const threadsQuery = () =>
  queryOptions({ queryKey: THREADS_KEY, queryFn: threadApi.list, staleTime: Infinity, refetchOnWindowFocus: false });

/**
 * Thread 하나 — `get` 다음에 `readRecord(0)`이다(구현 스펙 §18 「여는 차례」). 읽은 기록은 기록 줄 스토어에 seq로 합치고, 그 뒤는 앱 층이
 * 받은 기록 줄 이벤트가 잇는다. 한 번 읽으면 다시 읽지 않는다 — 이름 · 참여자는 바꾸기의 답과 요약 이벤트가 캐시를 고친다.
 */
export const threadQuery = (thread: string) =>
  queryOptions({
    queryKey: threadKey(thread),
    queryFn: async () => {
      const view = await threadApi.get(thread);
      mergeLines(thread, await threadApi.readRecord(thread, 0));
      return view;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

export const useThreads = () => useQuery(threadsQuery());
export const useThread = (thread: string) => useQuery(threadQuery(thread));

/**
 * 요약 하나를 목록 캐시에 앉힌다 — 있으면 바꾸고, 없으면 맨 앞(새것이 먼저)에 넣는다. 그 Thread를 연 캐시의 이름도 따라 바꾼다.
 * **참여자가 바뀌었으면 연 Thread를 다시 읽는다**(v1 티켓 14) — 멘션으로 들어온 Agent의 참여자 줄(`thread.json` — 온 곳 · 모델 · 생각
 * 깊이)은 요약에 없다. 그것이 있어야 머리 카드의 얼굴 · @ 메뉴의 「이 Thread에 있음」 · 그 Agent의 모델 칩이 선다.
 */
function putSummary(queryClient: QueryClient, summary: ThreadSummary): void {
  queryClient.setQueryData<ThreadSummary[]>(THREADS_KEY, (list) => {
    if (!list) return list;
    const at = list.findIndex((one) => one.id === summary.id);
    if (at < 0) return [summary, ...list];
    const next = [...list];
    next[at] = summary;
    return next;
  });
  queryClient.setQueryData<ThreadView>(threadKey(summary.id), (view) =>
    view && view.title !== summary.title ? { ...view, title: summary.title } : view,
  );
  const view = queryClient.getQueryData<ThreadView>(threadKey(summary.id));
  if (view && view.participants.map((one) => one.handle).join("\n") !== summary.handles.join("\n")) {
    void queryClient.invalidateQueries({ queryKey: threadKey(summary.id) });
  }
}

/**
 * **Thread 엔진의 이벤트를 받는 자리 — 앱에 하나다**(`AppShell`이 부른다). 기록 줄 · 대기 줄은 어느 Thread든 스토어에 쌓고(다른 화면에
 * 가 있어도 돌아오면 그사이 흐른 줄이 보인다), 요약은 사이드바의 목록을 고치고, 엔진 상태는 안내 카드의 바탕이 된다.
 */
export function useThreadFeeds(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = [
      onThreadRecord(({ thread, line }) => {
        mergeLines(thread, [line]);
        if (isLoginRequired(line)) markLoginRequired();
      }),
      onThreadQueue(({ thread, who, queue }) => setQueue(thread, who, queue)),
      onThreadList((summary) => putSummary(queryClient, summary)),
      onThreadEngine(applyEngineEvent),
    ];
    return () => {
      for (const one of unlisten) void one.then((fn) => fn());
    };
  }, [queryClient]);
}

/** 그 Thread의 대기 줄 — 참여자마다의 것을 차례로 잇는다. 이벤트가 온 Session은 그 값, 아니면 열 때 읽은 값이다. */
export function useQueue(view: ThreadView): readonly (QueuedMessage & { who: string })[] {
  const fed = useStore(threadQueueStore, (state) => state[view.id]);
  const queues = { ...view.queues, ...fed };
  return Object.entries(queues).flatMap(([who, queue]) => queue.map((message) => ({ ...message, who })));
}

/** 이름 바꾸기 — 답(바뀐 요약)으로 목록과 연 Thread의 이름을 고친다. */
export function useRenameThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ thread, title }: { thread: string; title: string }) => threadApi.rename(thread, title),
    onSuccess: (summary) => putSummary(queryClient, summary),
  });
}

/** 칩의 바꾸기 하나 — 모델 또는 생각 깊이. */
export type ChipChange = { field: "model"; value: string } | { field: "effort"; value: string };

/** 모델 · 생각 깊이 바꾸기(스토리 33) — 답(바뀐 참여자 줄)으로 연 Thread의 참여자를 갈아 끼운다. */
export function useChangeChip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ thread, who, change }: { thread: string; who: string; change: ChipChange }) =>
      change.field === "model"
        ? threadApi.setModel(thread, who, change.value)
        : threadApi.setEffort(thread, who, change.value),
    onSuccess: (participant: Participant, { thread }) => {
      queryClient.setQueryData<ThreadView>(threadKey(thread), (view) =>
        view
          ? {
              ...view,
              participants: view.participants.map((one) => (one.handle === participant.handle ? participant : one)),
            }
          : view,
      );
    },
  });
}

/**
 * 부를 수 있는 Agent(v1 티켓 11 · 14) — 그 Thread의 범위(`work`가 없으면 Library만)다. 파일은 사람이 언제든 고치므로 30초가 지난 값은 다음에
 * 쓸 때 다시 읽는다. 못 읽으면(사라진 Work) `null`이다 — @ 메뉴는 앉은 참여자만, 얼굴은 handle에서 정한 것으로 선다.
 */
export function useAgentRoster(work: string | null): AgentRoster | null {
  const { data } = useQuery({
    queryKey: ["agents", work],
    queryFn: () => threadApi.agents(work),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return data ?? null;
}
