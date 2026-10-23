import { Store } from "@tanstack/react-store";
import type { QueuedMessage, RecordLine } from "./types";

// Thread 화면의 모듈 스토어(v1 티켓 05) — three-axes 대화 스토어(`chat/chat-store.ts`)와 같은 까닭으로 화면 컴포넌트 밖에 산다.
//
// - **기록 줄은 앱 층이 받는다.** Thread는 엔진에서 돌고(다른 화면에 가 있어도), 돌아오면 그사이 흐른 줄이 다 보여야 한다. 구독은
//   `AppShell` 하나(`useThreadFeeds`)이고 그 줄이 여기 쌓인다. Thread를 열 때 읽은 기록도 같은 자리에 합친다 — 두 길이 겹치므로
//   **seq로 합친다**(같은 seq는 한 줄이다).
// - **입력 중인 글 · 펼친 작업 로그는 Thread 열쇠로 둔다** — 저장하지 않는다(앱을 다시 켜면 없다). 아직 id가 없는 새 Thread의 글은
//   `NEW_THREAD` 열쇠다.

/** 새 Thread(`/`)의 열쇠 — 첫 말을 보내기 전에는 id가 없다. */
export const NEW_THREAD = "";

const NO_LINES: readonly RecordLine[] = [];

/** Thread마다의 기록 줄 — seq 순서, seq마다 한 줄. */
export const threadRecordStore = new Store<Readonly<Record<string, readonly RecordLine[]>>>({});

export const linesOf = (state: Readonly<Record<string, readonly RecordLine[]>>, thread: string): readonly RecordLine[] =>
  state[thread] ?? NO_LINES;

/** 기록 줄을 합친다 — 기록 읽기의 답이든 기록 줄 이벤트든. 이미 있는 seq는 버린다(멱등). 바뀐 것이 없으면 상태를 그대로 둔다. */
export function mergeLines(thread: string, incoming: readonly RecordLine[]): void {
  if (incoming.length === 0) return;
  threadRecordStore.setState((state) => {
    const have = linesOf(state, thread);
    const merged = merge(have, incoming);
    return merged === have ? state : { ...state, [thread]: merged };
  });
}

function merge(have: readonly RecordLine[], incoming: readonly RecordLine[]): readonly RecordLine[] {
  // 흐르는 줄은 거의 늘 끝에 붙는다 — 그 길은 정렬 없이 잇는다.
  const last = have.length > 0 ? have[have.length - 1].seq : 0;
  let ascending = true;
  for (let i = 0; i < incoming.length; i += 1) {
    if (incoming[i].seq <= (i === 0 ? last : incoming[i - 1].seq)) ascending = false;
  }
  if (ascending) return [...have, ...incoming];
  const bySeq = new Map(have.map((line) => [line.seq, line]));
  let changed = false;
  for (const line of incoming) {
    if (bySeq.has(line.seq)) continue;
    bySeq.set(line.seq, line);
    changed = true;
  }
  return changed ? [...bySeq.values()].sort((a, b) => a.seq - b.seq) : have;
}

/**
 * Thread마다 · 참여자마다의 대기 줄 — 대기 줄 바뀜 이벤트가 실어 온 그 Session의 대기 줄 전체. 이벤트가 한 번이라도 온 Thread는 여기
 * 값이 이기고, 아직 안 왔으면 Thread를 열 때 읽은 `queue`다.
 */
export const threadQueueStore = new Store<Readonly<Record<string, Readonly<Record<string, readonly QueuedMessage[]>>>>>({});

export function setQueue(thread: string, who: string, queue: readonly QueuedMessage[]): void {
  threadQueueStore.setState((state) => ({ ...state, [thread]: { ...state[thread], [who]: queue } }));
}

interface UiState {
  /** Thread마다 입력 중인 글. */
  drafts: Readonly<Record<string, string>>;
  /** 펼친 작업 로그 — Thread 열쇠 + 턴 열쇠. 끝난 턴은 접혀 있고, 머리줄을 누르면 여기 든다. */
  expanded: Readonly<Record<string, true>>;
}

export const threadUiStore = new Store<UiState>({ drafts: {}, expanded: {} });

export function setDraft(thread: string, text: string): void {
  threadUiStore.setState((state) => ({ ...state, drafts: { ...state.drafts, [thread]: text } }));
}

export const turnKey = (thread: string, turn: string) => `${thread}\u0000${turn}`;

export function toggleTurn(key: string, open?: boolean): void {
  threadUiStore.setState((state) => {
    const { [key]: was, ...rest } = state.expanded;
    const next = open ?? !was;
    return { ...state, expanded: next ? { ...rest, [key]: true } : rest };
  });
}
