import { Store } from "@tanstack/react-store";
import type { RecordLine } from "./types";

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
}

export const chatUiStore = new Store<UiState>({ active: {}, drafts: {}, expanded: {} });

export function chooseConversation(work: string, conversation: string): void {
  chatUiStore.setState((state) => ({ ...state, active: { ...state.active, [work]: conversation } }));
}

export function setDraft(key: string, text: string): void {
  chatUiStore.setState((state) => ({ ...state, drafts: { ...state.drafts, [key]: text } }));
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
