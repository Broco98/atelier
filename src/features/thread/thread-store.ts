import { Store } from "@tanstack/react-store";
import type { Quote } from "@/features/works/QuotePick";
import { streamOfUpdate } from "./fold";
import { isObject } from "./json";
import type { DocWriting, FlowChunk, QueuedMessage, RecordLine, ThreadView } from "./types";

// Thread 화면의 모듈 스토어(v1 티켓 05) — 화면 컴포넌트 밖에 산다.
//
// - **기록 줄은 앱 층이 받는다.** Thread는 엔진에서 돌고(다른 화면에 가 있어도), 돌아오면 그사이 흐른 줄이 다 보여야 한다. 구독은
//   `AppShell` 하나(`useThreadFeeds`)이고 그 줄이 여기 쌓인다. Thread를 열 때 읽은 기록도 같은 자리에 합친다 — 두 길이 겹치므로
//   **seq로 합친다**(같은 seq는 한 줄이다).
// - **흐르는 글은 기록 줄과 따로 둔다**(스펙 「01b — 스트리밍」). 조각은 기록 줄이 아니라 접기를 다시 돌리지 않고, 구독은 흐름 꼬리의 작은 부품
//   하나다 — 조각이 오는 동안 앞선 턴이 다시 그려지지 않는다.
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

/** 지금 흐르는 글 하나 — 받은 조각을 이은 것이다. 기록 줄이 되면 지운다. */
export type FlowingText = Omit<FlowChunk, "offset">;

/** Thread마다의 흐르는 글. Session 하나에 흐름은 하나다. */
export const threadFlowStore = new Store<Readonly<Record<string, FlowingText>>>({});

/**
 * 조각 하나를 흐르는 글에 잇는다 — 조각 이벤트든 열 때 읽은 진행 글이든. 오프셋으로 이으므로 둘이 겹쳐도 글이 두 번 서지 않고, 이미 든 글은
 * 고치지 않는다(멱등). 앞 글이 빠져 잇지 못하면 `false`다 — 새로 그린 화면이 이벤트를 듣기 전에 나간 조각이 그렇다.
 */
export function addChunk(thread: string, { stream, kind, offset, text }: FlowChunk): boolean {
  const flowing = threadFlowStore.state[thread];
  const have = flowing?.stream === stream ? flowing.text : null;
  if (offset > (have?.length ?? 0)) return false;
  if (have !== null && offset + text.length <= have.length) return true;
  const joined = (have ?? "").slice(0, offset) + text;
  threadFlowStore.setState((state) => ({ ...state, [thread]: { stream, kind, text: joined } }));
  return true;
}

/** 그 기록 줄이 마친 흐름이면 흐르는 글을 지운다 — 글은 이제 그 줄에 있다. 기록 줄 이벤트에만 쓴다: 기록을 다시 읽은 줄은 앱을 다시 켜기 전의 번호일 수 있다. */
export function finishFlow(thread: string, line: RecordLine): void {
  const flowing = threadFlowStore.state[thread];
  if (flowing === undefined || streamOf(line) !== flowing.stream) return;
  threadFlowStore.setState(({ [thread]: _done, ...rest }) => rest);
}

/** 엔진이 버린 흐름이면 흐르는 글을 지운다 — 그 글은 기록 줄이 되지 않는다(restart 01b-10). */
export function discardFlow(thread: string, stream: number): void {
  if (threadFlowStore.state[thread]?.stream !== stream) return;
  threadFlowStore.setState(({ [thread]: _gone, ...rest }) => rest);
}

/**
 * 열 때 읽은 진행 글을 흐르는 글에 잇는다 — 기록을 합친 뒤에 부른다. 읽는 사이 그 흐름이 기록 줄이 됐으면 버린다. 그 줄은 늘 읽은 `lastSeq` 뒤에
 * 선다 — 번호는 앱을 다시 켜면 1부터라 그 앞의 줄과 겹칠 수 있다.
 */
export function settleFlowing({ id, lastSeq, flowing }: ThreadView): void {
  if (!flowing) return;
  const written = linesOf(threadRecordStore.state, id).some((line) => line.seq > lastSeq && streamOf(line) === flowing.stream);
  if (!written) addChunk(id, flowing);
}

/** 그 기록 줄이 합친 흐름의 번호(`update._meta.atelier.stream`) — 턴 안의 조각 줄만 있다. */
function streamOf(line: RecordLine): number | null {
  if (line.kind !== "update" || !isObject(line.payload)) return null;
  return streamOfUpdate(line.payload.update);
}

/**
 * Thread마다의 대기 줄 — 대기 줄 바뀜 이벤트가 실어 온 그 Session의 대기 줄 전체. 이벤트가 한 번이라도 온 Thread는 여기 값이 이기고,
 * 아직 안 왔으면 Thread를 열 때 읽은 `queue`다.
 */
export const threadQueueStore = new Store<Readonly<Record<string, readonly QueuedMessage[]>>>({});

export function setQueue(thread: string, queue: readonly QueuedMessage[]): void {
  threadQueueStore.setState((state) => ({ ...state, [thread]: queue }));
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
  /**
   * 사람이 고른 작업 로그의 펼침 — Thread 열쇠 + 턴 열쇠. 고른 적이 없는 턴은 그 턴의 처음 모양이다 — 끝난 턴은 접혀 있고 멈춘 턴은 펼쳐 있다(restart 02b-1).
   * 머리줄을 누르면 고른 쪽이 여기 든다.
   */
  expanded: Readonly<Record<string, boolean>>;
  /** 바깥이 글을 채운 입력창(`fillDraft`) — 그 입력칸이 한 번 포커스를 받고(`takeFill`) 비운다. */
  filled: string | null;
  /** Thread마다 입력창에 붙은 인용(v1 티켓 35 · S41) — 넓힌 카드의 문서에서 고른 글. 하나만 붙는다 — 새로 고르면 갈아 끼운다. */
  quotes: Readonly<Record<string, Quote>>;
}

export const threadUiStore = new Store<UiState>({ drafts: {}, expanded: {}, filled: null, quotes: {} });

export function setDraft(thread: string, text: string): void {
  threadUiStore.setState((state) => ({ ...state, drafts: { ...state.drafts, [thread]: text } }));
}

/**
 * 바깥에서 입력창에 글을 채운다 — 주소의 입력 글 씨앗(`?say=`)과 PR 카드의 「고쳐 달라고 하기」가 넣는다. 그 입력칸은 채운 글 끝에
 * 커서를 두고 포커스를 받는다(`ThreadComposer`). 그 입력창이 아직 서지 않았으면(새 Thread로 가는 중) 선 뒤에 받는다.
 */
export function fillDraft(thread: string, text: string): void {
  threadUiStore.setState((state) => ({ ...state, drafts: { ...state.drafts, [thread]: text }, filled: thread }));
}

/**
 * 입력창에 인용을 붙인다(v1 티켓 35 · S41 — 넓힌 카드 문서의 「❝ 이 자리를 두고 말하기」). 앞의 인용은 갈아 끼우고, 그 입력칸이 한 번
 * 포커스를 받는다(`fillDraft`와 같은 길) — 고른 손이 곧바로 이어 쓴다. `null`이면 뗀다.
 */
export function setQuote(thread: string, quote: Quote | null): void {
  threadUiStore.setState((state) => {
    const { [thread]: _was, ...rest } = state.quotes;
    return quote === null ? { ...state, quotes: rest } : { ...state, quotes: { ...rest, [thread]: quote }, filled: thread };
  });
}

/** 채운 입력창이 포커스를 받았다 — 다음 채우기까지 다시 받지 않는다. */
export function takeFill(): void {
  threadUiStore.setState((state) => (state.filled === null ? state : { ...state, filled: null }));
}

export const turnKey = (thread: string, turn: string) => `${thread}\u0000${turn}`;

/** 작업 로그를 펼치거나 접는다 — `open`이 없으면 고른 쪽을 뒤집는다(고른 적이 없으면 펼친다). 처음 모양이 펼친 턴은 부르는 쪽이 `open`을 준다. */
export function toggleTurn(key: string, open?: boolean): void {
  threadUiStore.setState((state) => ({ ...state, expanded: { ...state.expanded, [key]: open ?? state.expanded[key] !== true } }));
}
