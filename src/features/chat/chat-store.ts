import { Store } from "@tanstack/react-store";
import type { ChoiceField } from "./chips";
import type { Agent, QueuedMessage, Quote, RecordLine } from "./types";

// 대화창의 모듈 스토어(three-axes 티켓 17). 화면 컴포넌트 밖에 사는 까닭이 둘이다.
//
// - **기록 줄은 앱 층이 받는다.** 다른 work로 가도 대화는 호스트에서 돌고(스토리 14), 돌아오면 그사이 흐른 줄이 다 보여야
//   한다(스토리 15). 대화창이 저마다 구독하면 보이지 않는 work의 줄이 버려진다 — 구독은 `AppShell` 하나(`useChatRecordFeed`)이고
//   그 줄이 여기 쌓인다. 처음 그릴 때 읽은 기록도 같은 자리에 합친다. 실물도 「구독 → 기록 읽기」 순서라 두 길이 겹치므로
//   **seq로 합친다**(같은 seq는 한 줄이다).
// - **작업 패널에는 key가 없다.** work를 옮겨도 같은 패널 인스턴스라, 입력 중인 글 · 고른 대화 · 펼친 턴을 컴포넌트 상태에 두면
//   work를 오갈 때 섞이거나 사라진다. 그래서 대화(또는 work) 열쇠로 여기 둔다. 저장하지 않는다 — 앱을 다시 켜면 없다.

/** 대화 하나의 열쇠 — work와 대화 id. */
export const conversationKey = (work: string, conversation: string) => `${work}\u0000${conversation}`;

const NO_LINES: readonly RecordLine[] = [];

interface RecordState {
  lines: Readonly<Record<string, readonly RecordLine[]>>;
}

/** 대화마다의 기록 줄 — seq 순서, seq마다 한 줄. */
export const chatRecordStore = new Store<RecordState>({ lines: {} });

export const linesOf = (state: RecordState, key: string): readonly RecordLine[] => state.lines[key] ?? NO_LINES;

/** 기록 줄을 합친다 — 기록 읽기의 답이든 기록 줄 이벤트든. 이미 있는 seq는 버린다(멱등). 바뀐 것이 없으면 상태를 그대로 둔다. */
export function mergeLines(work: string, conversation: string, incoming: readonly RecordLine[]): void {
  if (incoming.length === 0) return;
  const key = conversationKey(work, conversation);
  chatRecordStore.setState((state) => {
    const have = linesOf(state, key);
    const merged = merge(have, incoming);
    return merged === have ? state : { lines: { ...state.lines, [key]: merged } };
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

// 대화마다 기록을 한 번만 읽는다 — 그 뒤는 기록 줄 이벤트가 잇는다. 읽기가 실패하면 다음에 그 대화가 설 때 다시 읽는다.
const readRecords = new Set<string>();
export function claimRecordRead(key: string): boolean {
  if (readRecords.has(key)) return false;
  readRecords.add(key);
  return true;
}
export function releaseRecordRead(key: string): void {
  readRecords.delete(key);
}

/**
 * 대화마다의 대기 줄(three-axes 티켓 20) — 대기 줄 바뀜 이벤트가 실어 온 그 대화의 대기 줄 전체. 대기 줄은 기록에 없고 호스트
 * 메모리에만 있어(S13) 처음 그릴 때는 대화 목록의 `queue`로 그린다. 이벤트가 한 번이라도 온 대화는 여기 값이 이긴다 — 목록은
 * 한 번만 읽어(`staleTime: Infinity`) 그 뒤의 바뀜을 모른다. 이벤트는 기록 줄처럼 앱 층이 받는다(`useChatQueueFeed`).
 */
export const chatQueueStore = new Store<Readonly<Record<string, readonly QueuedMessage[]>>>({});

export function setQueue(work: string, conversation: string, queue: readonly QueuedMessage[]): void {
  const key = conversationKey(work, conversation);
  chatQueueStore.setState((state) => ({ ...state, [key]: queue }));
}

// 대화 없는 work에서 대화창을 **처음** 열 때만 기본 에이전트로 대화 하나를 연다(S8) — work마다 앱이 도는 동안 한 번이다. 대화를
// 다 닫은 뒤 다시 와도 저절로 열지 않는다(사람이 닫은 것을 되살리지 않는다). StrictMode가 이펙트를 두 번 돌려도 하나다.
const firstOpened = new Set<string>();
export function claimFirstConversation(work: string): boolean {
  if (firstOpened.has(work)) return false;
  firstOpened.add(work);
  return true;
}

interface UiState {
  /** work마다 고른 대화. 없으면 첫 대화다. */
  active: Readonly<Record<string, string>>;
  /** 대화마다 입력 중인 글(스토리 12). */
  drafts: Readonly<Record<string, string>>;
  /** 펼친 턴 — 대화 열쇠 + 턴 열쇠. 턴이 끝나면 접혀 있고, 머리줄을 누르면 여기 든다. */
  expanded: Readonly<Record<string, true>>;
  /**
   * work마다 열려다 못 연 대화의 에이전트 — 엔진을 못 찾아 대화를 만들지 않았다(three-axes 티켓 22). 그동안 대화창 자리에 그
   * 엔진의 안내 카드가 서고, 「다시 확인」으로 찾으면 그때 대화를 연다(스토리 102). 대화 탭을 고르면 거둔다.
   */
  wanted: Readonly<Record<string, Agent>>;
  /**
   * work마다 입력창에 붙은 인용(three-axes 티켓 27) — 그 work의 **지금 대화**의 입력창에 칩으로 선다. 인용은 하나라 새로 고르면
   * 바뀐다. 대화가 아니라 work의 열쇠인 것은, 스펙 창에서 고르는 때에는 대화창이 아직 대화를 읽지 않았을 수 있어서다(처음 여는
   * work면 첫 대화가 그 뒤에 선다).
   */
  quotes: Readonly<Record<string, Quote>>;
  /**
   * 대화마다 이 앱이 도는 동안 사람이 칩으로 바꾼 칸과 그 바꾸기 답의 마지막 seq(three-axes 티켓 19). 바꾼 값은 대화 목록에
   * 남지만 언제 골랐는지는 적혀 있지 않다 — 띄우지 않은 대화에서 바꾸면 기록에 줄도 서지 않는다. 그래서 칩은 이 seq로 「이 값이
   * 기록의 어느 줄보다 늦은가」를 안다(`chips.ts`의 `currentChoice`).
   */
  chosen: Readonly<Record<string, Partial<Record<ChoiceField, number>>>>;
}

export const chatUiStore = new Store<UiState>({ active: {}, drafts: {}, expanded: {}, wanted: {}, quotes: {}, chosen: {} });

/** 사람이 칩으로 그 칸을 바꿨다 — 바꾸기 답이 실어 온 기록의 마지막 seq 뒤의 일이다. */
export function markChosen(key: string, field: ChoiceField, afterSeq: number): void {
  chatUiStore.setState((state) => ({
    ...state,
    chosen: { ...state.chosen, [key]: { ...state.chosen[key], [field]: afterSeq } },
  }));
}

export function wantConversation(work: string, agent: Agent): void {
  chatUiStore.setState((state) => ({ ...state, wanted: { ...state.wanted, [work]: agent } }));
}

export function dropWanted(work: string): void {
  takeWanted(work);
}

/**
 * 열려다 못 연 대화를 거두고, 거둔 것이 이 부름이면 그 에이전트를 돌려준다(이미 없으면 `null`). 엔진을 찾은 소식에 대화를 여는 쪽이
 * 쓴다 — 같은 work의 대화창이 둘(작업 패널은 숨은 채 마운트되고 `chat` 탭이 가운데에 하나 더) 서 있어도 하나만 연다.
 */
export function takeWanted(work: string): Agent | null {
  const agent = chatUiStore.state.wanted[work] ?? null;
  if (agent === null) return null;
  chatUiStore.setState((state) => {
    const wanted = { ...state.wanted };
    delete wanted[work];
    return { ...state, wanted };
  });
  return agent;
}

export function chooseConversation(work: string, conversation: string): void {
  chatUiStore.setState((state) => ({ ...state, active: { ...state.active, [work]: conversation } }));
}

export function setDraft(key: string, text: string): void {
  chatUiStore.setState((state) => ({ ...state, drafts: { ...state.drafts, [key]: text } }));
}

/** 문서에서 고른 자리를 그 work의 입력창에 붙인다 — 있던 인용은 바뀐다. */
export function setQuote(work: string, quote: Quote): void {
  chatUiStore.setState((state) => ({ ...state, quotes: { ...state.quotes, [work]: quote } }));
}

/** 인용을 뗀다 — 칩의 ×, 그리고 그 인용을 실어 보낸 때. */
export function dropQuote(work: string): void {
  chatUiStore.setState((state) => {
    if (!(work in state.quotes)) return state;
    const quotes = { ...state.quotes };
    delete quotes[work];
    return { ...state, quotes };
  });
}

/** 보내지 못한 인용을 되붙인다 — 그사이 새로 고른 인용이 있으면 그것을 둔다. */
export function restoreQuote(work: string, quote: Quote): void {
  chatUiStore.setState((state) => (work in state.quotes ? state : { ...state, quotes: { ...state.quotes, [work]: quote } }));
}

export const turnKey = (key: string, turn: string) => `${key}\u0000${turn}`;

export function toggleTurn(key: string): void {
  chatUiStore.setState((state) => {
    const { [key]: was, ...rest } = state.expanded;
    return { ...state, expanded: was ? rest : { ...rest, [key]: true } };
  });
}

interface Announcement {
  /** 알릴 때마다 오른다 — 같은 글을 두 번 알려도 새 알림으로 선다. */
  id: number;
  text: string;
}

/**
 * 턴 끝 알림(스토리 121) — 흐르는 답은 조각마다 알리지 않고 턴이 끝날 때 **한 번** 알린다. 알림 자리는 대화창 밖 한 곳
 * (`ChatAnnouncer`)이라 같은 대화가 작업 패널과 `chat` 탭에 함께 서도 두 번 울리지 않는다. 처음 그릴 때 읽은 기록의 턴 끝은
 * 알리지 않는다 — 이미 지난 일이다. 알리는 것은 기록 줄 이벤트로 온 턴 끝뿐이다.
 */
export const chatAnnouncementStore = new Store<Announcement | null>(null);

export function announce(text: string): void {
  chatAnnouncementStore.setState((last) => ({ id: (last?.id ?? 0) + 1, text }));
}

/**
 * 끝났는데 아직 보지 않은 대화(three-axes 티켓 23 · S23 「끝남」) — 대화 열쇠. 「봤다」는 화면이 메모리에 쥔다: 저장하지 않아 앱을
 * 다시 켜거나 화면을 새로고침하면 없다. 기록 줄 이벤트로 온 턴 끝(과 죽음)이 세우고(`markFinished`), 그 대화를 보면 지운다.
 * 처음 그릴 때 읽은 기록의 턴 끝은 세우지 않는다 — 이미 지난 일이다(턴 끝 알림 · 고친 곳과 같은 규칙).
 */
export const chatUnseenStore = new Store<Readonly<Record<string, true>>>({});

// 지금 보이는 대화들 — 대화 열쇠마다 그 대화를 보이는 자리의 수(작업 패널과 `chat` 탭이 같은 대화를 함께 보일 수 있다). 보는
// 동안 끝난 턴은 「끝남」이 서지 않는다.
const viewing = new Map<string, number>();

/** 그 대화의 턴이 끝났다 — 지금 보이지 않으면 「끝남」을 세운다. */
export function markFinished(key: string): void {
  if ((viewing.get(key) ?? 0) > 0) return;
  chatUnseenStore.setState((state) => (state[key] ? state : { ...state, [key]: true }));
}

/** 그 대화를 보이기 시작한다 — 「끝남」을 지우고, 보는 동안 끝난 턴에는 세우지 않는다. 돌려준 함수로 보기를 끝낸다. */
export function seeConversation(key: string): () => void {
  viewing.set(key, (viewing.get(key) ?? 0) + 1);
  forgetFinished(key);
  return () => {
    const left = (viewing.get(key) ?? 1) - 1;
    if (left > 0) viewing.set(key, left);
    else viewing.delete(key);
  };
}

/** 「끝남」을 지운다 — 그 대화를 보았거나 닫았다. */
export function forgetFinished(key: string): void {
  chatUnseenStore.setState((state) => {
    if (!state[key]) return state;
    const rest = { ...state };
    delete rest[key];
    return rest;
  });
}
