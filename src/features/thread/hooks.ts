import { useEffect, useMemo } from "react";
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { searchApi } from "@/features/search/api";
import { settingsApi } from "@/features/settings/api";
import { saveSettingsSection } from "@/features/settings/save-section";
import type { ProjectPr } from "@/features/works/types";
import { onThreadEngine, onThreadList, onThreadQueue, onThreadRecord, onWorkWriting, threadApi } from "./api";
import { askLevelOf } from "./chips";
import { applyEngineEvent, isLoginRequired, markLoginRequired } from "./engine-store";
import { isObject } from "./json";
import { prLineOf } from "./pr";
import { linesOf, mergeLines, threadQueueStore, threadRecordStore, setQueue, setWriting } from "./thread-store";
import type { AgentRoster, AskLevel, Participant, QueuedMessage, RecordLine, ThreadSummary, ThreadView } from "./types";
import { waitingOrder, type ThreadReading, type Waiting } from "./waiting";
import { workPrsKey } from "./summary-card";
import { recentWorks, type RecentWork } from "./work-chip";

// Thread 화면이 엔진에서 읽는 것(v1 티켓 05). 명령은 `api.ts`이고, 여기는 그것을 화면의 수명과 쿼리 캐시에 잇는다.

const THREADS_KEY = ["threads"] as const;
/** Agent 목록(`list_agents`)의 열쇠 머리 — 뒤에 범위(`work`)가 붙는다. @ 메뉴와 Library 화면이 같은 캐시를 읽는다. */
export const AGENTS_KEY = ["agents"] as const;
/** Agent 파일 원문(`read_agent_file`)의 열쇠 머리 — 뒤에 범위와 부르는 이름이 붙는다(Library 화면). */
export const AGENT_FILE_KEY = ["agent-file"] as const;
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

/** 쿼리 결과마다 답만 — 모듈에 하나라 `useQueries`가 결과가 바뀔 때만 다시 묶는다. */
const viewsOnly = (results: readonly { data?: ThreadView }[]) => results.map((result) => result.data);

/**
 * 나를 기다리는 Thread들 — 기다린 순서(v1 티켓 42, 차례는 `waiting.ts`의 `waitingOrder`). 사이드바 위 줄 「내 차례」 행의 수와
 * 「내 차례만」 목록이 읽는다.
 *
 * **모든 Thread를 Thread를 열 때와 같은 읽기로 읽는다**(`threadQuery` — 사이드바 줄 · Thread 화면과 같은 캐시) — Work에 이은 Thread도
 * 기다리는 Thread이고(보드 「내 차례만」), 그 기록은 Work 묶음이 접혀 있어도 있어야 수가 맞는다. 기록 줄 스토어 전체를 구독하므로 어느
 * Thread든 줄이 흐르면 다시 센다 — 바뀌지 않은 Thread는 다시 접지 않는다(`waitingOrder`).
 */
export function useWaiting(): Waiting[] {
  const { data: threads = [] } = useThreads();
  const views = useQueries({
    queries: threads.map((thread) => ({ ...threadQuery(thread.id), enabled: thread.broken === null })),
    combine: viewsOnly,
  });
  const records = useStore(threadRecordStore, (state) => state);
  return useMemo(() => {
    const viewOf = new Map(threads.map((thread, at) => [thread.id, views[at]]));
    return waitingOrder(threads, (id) => readingOf(records, viewOf.get(id), id));
  }, [threads, views, records]);
}

/**
 * 지금 나를 기다리는 Thread들 — 누른 순간에 읽는다(⌘J, `AppShell`). 구독하지 않는다: 셸이 기록 줄마다 다시 그려지지 않게. 캐시에 든
 * 것만 센다 — 읽기는 사이드바(`useWaiting`)가 건다.
 */
export function waitingNow(queryClient: QueryClient): Waiting[] {
  const threads = queryClient.getQueryData<ThreadSummary[]>(THREADS_KEY) ?? [];
  const records = threadRecordStore.state;
  return waitingOrder(threads, (id) => readingOf(records, queryClient.getQueryData<ThreadView>(threadKey(id)), id));
}

function readingOf(
  records: Readonly<Record<string, readonly RecordLine[]>>,
  view: ThreadView | undefined,
  thread: string,
): ThreadReading | null {
  return view ? { lines: linesOf(records, thread), view } : null;
}

/**
 * 요약 하나를 목록 캐시에 앉힌다 — 있으면 바꾸고, 없으면 맨 앞(새것이 먼저)에 넣는다. 그 Thread를 연 캐시의 이름 · 이은 Work도 따라
 * 바꾼다(Work 만들기 카드로 Thread가 Work에 이어졌다 — v1 티켓 30). 읽기만인 까닭도 따라 바꾼다(이은 Work가 보관됐다 — v1 티켓 38).
 * **참여자가 바뀌었으면 연 Thread를 다시 읽는다**(v1 티켓 14) — 멘션으로 들어온 Agent의 참여자 줄(`thread.json` — 온 곳 · 모델 · 생각
 * 깊이)은 요약에 없다. 그것이 있어야 머리 카드의 얼굴 · @ 메뉴의 「이 Thread에 있음」 · 그 Agent의 모델 칩이 선다.
 */
export function putSummary(queryClient: QueryClient, summary: ThreadSummary): void {
  queryClient.setQueryData<ThreadSummary[]>(THREADS_KEY, (list) => {
    if (!list) return list;
    const at = list.findIndex((one) => one.id === summary.id);
    if (at < 0) return [summary, ...list];
    const next = [...list];
    next[at] = summary;
    return next;
  });
  queryClient.setQueryData<ThreadView>(threadKey(summary.id), (view) =>
    view && (view.title !== summary.title || view.work !== summary.work || view.readOnly !== summary.readOnly)
      ? { ...view, title: summary.title, work: summary.work, readOnly: summary.readOnly }
      : view,
  );
  const view = queryClient.getQueryData<ThreadView>(threadKey(summary.id));
  if (view && view.participants.map((one) => one.handle).join("\n") !== summary.handles.join("\n")) {
    void queryClient.invalidateQueries({ queryKey: threadKey(summary.id) });
  }
}

/**
 * **Thread 엔진의 이벤트를 받는 자리 — 앱에 하나다**(`AppShell`이 부른다). 기록 줄 · 대기 줄은 어느 Thread든 스토어에 쌓고(다른 화면에
 * 가 있어도 돌아오면 그사이 흐른 줄이 보인다), 요약은 사이드바의 목록을 고치고, 엔진 상태는 안내 카드의 바탕이 된다. 문서 쓰는 중은
 * Work마다 쌓는다 — 요약 카드가 떠 있지 않아도 열면 지금 쓰는 문서가 보인다(v1 티켓 34).
 */
export function useThreadFeeds(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = [
      onThreadRecord(({ thread, line }) => {
        mergeLines(thread, [line]);
        if (isLoginRequired(line)) markLoginRequired();
        followRecordLine(queryClient, thread, line);
      }),
      onThreadQueue(({ thread, who, queue }) => setQueue(thread, who, queue)),
      onThreadList((summary) => putSummary(queryClient, summary)),
      onThreadEngine(applyEngineEvent),
      onWorkWriting(({ work, writing }) => setWriting(work, writing)),
    ];
    return () => {
      for (const one of unlisten) void one.then((fn) => fn());
    };
  }, [queryClient]);
}

/**
 * 기록 줄 하나가 쿼리 캐시에 미치는 것 — 줄을 스토어에 쌓는 것은 부르는 쪽(`useThreadFeeds`)이다.
 *
 * - Agent가 Library에 Agent를 저장했다(v1 티켓 19) — @ 메뉴 · Library 화면의 목록과 파일을 다시 읽는다. 엔진은 Library가 바뀌었다는
 *   이벤트를 따로 내지 않는다 — 이 줄이 그 알림이다.
 * - 물어보는 정도가 바뀌었다(`mode` 줄) — 칩이 읽는 연 Thread의 정도를 고친다(`putAskLevel`). 사람이 칩으로 바꾼 것은 바꾸기의 답이
 *   이미 고쳤고, 엔진이 스스로 바꾼 것(v1 티켓 26 — 계획만에서 「계획대로 구현」을 고르면 매번 묻기로 나간다)은 이 줄이 유일한 알림이다.
 * - 그 Work의 PR이 처음 보였거나 상태가 바뀌었다(`pr` 줄, v1 티켓 36) — 요약 카드가 읽어 둔 PR의 그 Project 줄을 줄의 PR로 갈아 끼운다.
 *   턴 끝의 읽기는 엔진이 하므로 카드가 `gh`를 다시 부르지 않는다. 카드가 아직 읽지 않은 Work는 그대로 둔다 — 열 때 읽는다.
 */
export function followRecordLine(queryClient: QueryClient, thread: string, line: RecordLine): void {
  if (line.kind === "library") {
    void queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
    void queryClient.invalidateQueries({ queryKey: AGENT_FILE_KEY });
  }
  if (line.kind === "mode" && isObject(line.payload)) {
    const level = askLevelOf(line.payload.mode);
    if (level) putAskLevel(queryClient, thread, level.value);
  }
  const pr = line.kind === "pr" ? prLineOf(line.payload) : null;
  if (pr) {
    const { work, first: _, ...found } = pr;
    queryClient.setQueryData<ProjectPr[]>(workPrsKey(work), (prs) =>
      prs?.map((one) => (one.project === found.project ? { ...found, kind: "found" } : one)),
    );
  }
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

/**
 * 읽은 자리 적기(v1 티켓 41 · S38) — 답(바뀐 요약)으로 목록을 고친다. 사이드바의 「새 결과」가 걷힌다. 바뀌었으면 요약 이벤트도 같은
 * 값을 싣는다. 적지 못해도 화면은 그대로다 — 부르는 쪽(Thread 화면)이 다음에 맨 아래를 볼 때 다시 적는다.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ thread, seq }: { thread: string; seq: number }) => threadApi.markRead(thread, seq),
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
 * 물어보는 정도 바꾸기(v1 티켓 23) — 연 Thread의 지금 정도를 고친다. Work에 이은 Thread면 정도가 그 Work의 것이라, 같은 Work에 이은
 * 다른 Thread의 연 캐시도 함께 고친다(엔진은 바꾼 Thread에만 `mode` 줄을 적는다).
 */
export function useSetMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ thread, mode }: { thread: string; mode: AskLevel }) => threadApi.setMode(thread, mode),
    onSuccess: (_, { thread, mode }) => putAskLevel(queryClient, thread, mode),
  });
}

/** 연 Thread의 지금 정도를 고친다 — Work에 이은 Thread면 정도가 그 Work의 것이라 같은 Work에 이은 다른 Thread의 연 캐시도 함께다. */
function putAskLevel(queryClient: QueryClient, thread: string, mode: AskLevel): void {
  const work = queryClient.getQueryData<ThreadView>(threadKey(thread))?.work ?? null;
  for (const [key, view] of queryClient.getQueriesData<ThreadView>({ queryKey: ["thread"] })) {
    if (view && (view.id === thread || (work !== null && view.work === work))) {
      queryClient.setQueryData<ThreadView>(key, { ...view, askLevel: mode });
    }
  }
}

/**
 * 부를 수 있는 Agent(v1 티켓 11 · 14) — 그 Thread의 범위(`work`가 없으면 Library만)다. 파일은 사람이 언제든 고치므로 30초가 지난 값은 다음에
 * 쓸 때 다시 읽는다. 못 읽으면(사라진 Work) `null`이다 — @ 메뉴는 앉은 참여자만, 얼굴은 handle에서 정한 것으로 선다.
 */
export function useAgentRoster(work: string | null): AgentRoster | null {
  const { data } = useQuery({
    queryKey: [...AGENTS_KEY, work],
    queryFn: () => threadApi.agents(work),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return data ?? null;
}

/**
 * Work 칩 메뉴의 최근 Work(v1 티켓 31) — 빈 질의 검색의 Work 줄 차례(고정 먼저 → 마지막으로 연 차례)에 이은 Thread 수를 단다. 새 Thread
 * 화면에 설 때마다 다시 읽는다. Thread 수는 사이드바와 같은 목록 캐시에서 센다. 못 읽으면 최근 Work 없이 두 줄만 선다.
 */
export function useRecentWorks(): RecentWork[] {
  const { data: threads } = useThreads();
  const { data } = useQuery({
    queryKey: ["recent-works"],
    queryFn: () => searchApi.run("", []),
    staleTime: 0,
    retry: false,
  });
  return data ? recentWorks(data.hits, threads ?? []) : [];
}

/**
 * 그 Work의 지금 물어보는 정도(v1 티켓 31 · S18) — 새 Thread에서 최근 Work를 고르면 물어보는 정도 칩이 이것을 보인다. Work를 고르지
 * 않았으면 읽지 않는다(`null`). 읽기 전 · 못 읽으면 `null`이다.
 */
export function useWorkMode(work: string | null): AskLevel | null {
  const { data } = useQuery({
    queryKey: ["work-mode", work],
    queryFn: () => threadApi.workMode(work ?? ""),
    enabled: work !== null,
    staleTime: 0,
    retry: false,
  });
  return work === null ? null : (data ?? null);
}

const DECISIONS_SEEN_KEY = ["settings", "seen", "decisions"] as const;

/**
 * 「결정은 내가 합니다」 카드를 봤나(v1 티켓 30 · S31) — 앱 설정의 본 표(`seen.decisions`)다. 아직 읽지 못했으면 null이다. 못 읽으면(깨진
 * 설정 파일) 본 것으로 친다 — 고칠 자리는 설정 화면이 말하고, 이 카드가 그 파일을 덮어쓰지 않게.
 */
export function useDecisionsSeen(): boolean | null {
  const { data } = useQuery({
    queryKey: DECISIONS_SEEN_KEY,
    queryFn: async () => {
      try {
        return (await settingsApi.read()).seen?.decisions === true;
      } catch {
        return true;
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return data ?? null;
}

/** 「결정은 내가 합니다」 카드를 봤다고 적는다 — 설정의 다른 구획 · 모르는 칸은 그대로다(`saveSettingsSection`). */
export function useMarkDecisionsSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => saveSettingsSection("seen", (latest) => ({ ...latest, decisions: true })),
    onMutate: () => queryClient.setQueryData(DECISIONS_SEEN_KEY, true),
  });
}
