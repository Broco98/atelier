import { Store } from "@tanstack/react-store";
import type { DocWriting, QueuedMessage, RecordLine } from "./types";

// Thread 화면의 모듈 스토어(v1 티켓 05) — 화면 컴포넌트 밖에 산다.
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

/**
 * Work마다 지금 쓰는 중인 문서(v1 티켓 34) — `work:writing` 이벤트가 실어 온 그 Work의 목록 전체. 마지막 것이 이긴다. 엔진의 메모리에만
 * 있어 읽는 명령이 없다 — 화면을 새로 그리면(⌘R) 다음 이벤트까지 비어 있다(쓰는 중은 몇 초다).
 */
export const workWritingStore = new Store<Readonly<Record<string, readonly DocWriting[]>>>({});

export function setWriting(work: string, writing: readonly DocWriting[]): void {
  workWritingStore.setState((state) => ({ ...state, [work]: writing }));
}

/** 그 Work의 지금 쓰는 중 목록 — 없으면 빈 목록(같은 값)이다. */
export const writingOf = (state: Readonly<Record<string, readonly DocWriting[]>>, work: string): readonly DocWriting[] =>
  state[work] ?? NO_WRITING;
const NO_WRITING: readonly DocWriting[] = [];

interface UiState {
  /** Thread마다 입력 중인 글. */
  drafts: Readonly<Record<string, string>>;
  /** 펼친 작업 로그 — Thread 열쇠 + 턴 열쇠. 끝난 턴은 접혀 있고, 머리줄을 누르면 여기 든다. */
  expanded: Readonly<Record<string, true>>;
  /** 바깥이 글을 채운 입력창(`fillDraft`) — 그 입력칸이 한 번 포커스를 받고(`takeFill`) 비운다. */
  filled: string | null;
}

export const threadUiStore = new Store<UiState>({ drafts: {}, expanded: {}, filled: null });

export function setDraft(thread: string, text: string): void {
  threadUiStore.setState((state) => ({ ...state, drafts: { ...state.drafts, [thread]: text } }));
}

/**
 * 바깥에서 입력창에 글을 채운다 — 「새 Agent 만들기」(v1 티켓 19)가 새 Thread의 입력창에 맡기는 말을 넣는다. 그 입력칸은 채운 글 끝에
 * 커서를 두고 포커스를 받는다(`ThreadComposer`). 그 입력창이 아직 서지 않았으면(새 Thread로 가는 중) 선 뒤에 받는다.
 */
export function fillDraft(thread: string, text: string): void {
  threadUiStore.setState((state) => ({ ...state, drafts: { ...state.drafts, [thread]: text }, filled: thread }));
}

/** 채운 입력창이 포커스를 받았다 — 다음 채우기까지 다시 받지 않는다. */
export function takeFill(): void {
  threadUiStore.setState((state) => (state.filled === null ? state : { ...state, filled: null }));
}

export const turnKey = (thread: string, turn: string) => `${thread}\u0000${turn}`;

export function toggleTurn(key: string, open?: boolean): void {
  threadUiStore.setState((state) => {
    const { [key]: was, ...rest } = state.expanded;
    const next = open ?? !was;
    return { ...state, expanded: next ? { ...rest, [key]: true } : rest };
  });
}
