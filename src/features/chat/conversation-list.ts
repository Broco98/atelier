import { useEffect } from "react";
import { Store, useStore } from "@tanstack/react-store";
import { readDefaultAgent } from "@/features/settings/chat-settings";
import { chatApi } from "./api";
import { conversationKey, forgetFinished, mergeLines } from "./chat-store";
import { chatEngineStore, checkEngine, checkEngineOnce } from "./engine-store";
import type { Agent, Conversation, EngineCheck } from "./types";

// 그 work의 대화 목록과 그 수명(three-axes 티켓 17 · 22 · 25) — 대화창이 그리는 것의 주인이다.
//
// 대화창은 두 자리에 함께 선다. 작업 패널은 숨은 채 늘 마운트돼 있고 key가 없어 work를 옮겨도 같은 인스턴스이며, `chat` 탭이
// 가운데에 하나 더 띄운다. 그래서 목록 읽기 · 첫 대화 · 새 대화와 그 앞의 엔진 확인 · 닫기 · 못 찾아 열지 못한 대화 · 기록 읽기와
// 그 진행 · 호스트가 거절한 글을 화면 인스턴스가 아니라 **work마다 여기 하나**로 둔다. 대화창은 이 상태를 읽고 동작을 부르는
// 화면이라, 몇 번 마운트되든 같은 것을 보이고 일은 한 번 일어난다. 저장하지 않는다 — 앱을 다시 켜면 없다.

/** 그 work의 대화창이 그리는 것 — 같은 work의 대화창은 어디에 서든 같은 값을 읽는다. */
export interface ConversationList {
  /** 열린 대화들 — 만든 순서다. 목록을 아직 읽지 못했으면 비어 있다. */
  conversations: readonly Conversation[];
  /** 켜진 대화 — 고른 대화, 고르지 않았으면 첫 대화다. */
  active: Conversation | null;
  /**
   * 열려다 못 연 대화의 에이전트 — 엔진을 못 찾아 대화를 만들지 않았다(three-axes 티켓 22). 그동안 대화창 자리에 그 엔진의 안내
   * 카드가 서고, 그 엔진을 찾으면(「다시 확인」의 답이든 엔진 상태 이벤트든) 여기서 그때 대화를 한 번 연다(스토리 102). 그 work의
   * 대화창이 서 있을 때만 연다 — 다른 work에 있는 동안 찾았으면 화면 밖에서 에이전트를 띄우지 않고, 그 work로 돌아와 대화창이 설
   * 때 연다. 새 대화를 여는 중이면 그 일이 정한다. 대화 탭을 고르면 거둔다.
   */
  wanted: Agent | null;
  /** 목록을 아직 읽지 못했다 — 처음 보이기 전이거나 읽는 중이다. 읽기가 거절됐으면 거짓이고 그 글이 `problem`에 선다. */
  reading: boolean;
  /** 새 대화를 여는 중이다 — 기본 에이전트를 읽거나, 엔진을 확인하거나, 만든다. 그동안 `+`가 잠긴다. */
  opening: boolean;
  /**
   * 호스트가 거절한 글 — 목록 읽기 · 만들기 · 닫기 순으로 하나다. 호스트의 오류는 화면에 보일 글이다. 같은 일을 다시 시작하면
   * 그 글이 걷힌다. 못 찾음 · 로그인은 여기 들지 않는다 — 안내 카드가 말한다.
   */
  problem: string | null;
}

/** work 하나의 상태. */
interface WorkConversations {
  /** 대화 목록 — 호스트에서 읽었거나, 이 앱이 만들기 · 닫기 · 바꾸기의 답으로 고친 것. 아직 모르면 없다. */
  list?: readonly Conversation[];
  /** 목록을 읽는 중이다. */
  reading: boolean;
  /** 고른 대화. */
  chosen?: string;
  wanted?: Agent;
  /** 도는 새 대화 열기의 수. */
  opening: number;
  /** 일마다 호스트가 거절한 글. */
  refused: { list?: string; open?: string; close?: string };
  /** 기록을 못 읽은 대화 — 다음에 대화창이 보일 때 다시 읽는다. */
  unread: readonly string[];
}

const IDLE: WorkConversations = { reading: false, opening: 0, refused: {}, unread: [] };
const NO_CONVERSATIONS: readonly Conversation[] = [];

const conversationListStore = new Store<Readonly<Record<string, WorkConversations>>>({});

const stateOf = (work: string): WorkConversations => conversationListStore.state[work] ?? IDLE;

function update(work: string, change: (state: WorkConversations) => WorkConversations): void {
  conversationListStore.setState((all) => ({ ...all, [work]: change(all[work] ?? IDLE) }));
}

/** 목록을 고쳐 쓴다 — 고친 목록은 읽은 목록이다(목록 읽기의 거절 글이 걷힌다). */
const withList = (state: WorkConversations, list: readonly Conversation[]): WorkConversations => ({
  ...state,
  list,
  refused: { ...state.refused, list: undefined },
});

const activeOf = (list: readonly Conversation[], chosen: string | undefined): Conversation | null =>
  list.find((one) => one.id === chosen) ?? list[0] ?? null;

/**
 * 그 work의 대화창 — 그릴 것을 읽는다. `visible`은 그 대화창이 지금 보이는가다. **처음 보일 때** 목록을 읽고(숨은 채 마운트돼
 * 있는 동안은 호스트를 부르지 않는다), 대화 없는 work면 기본 에이전트로 대화 하나를 연다(S8 · 스토리 2). 보이는 동안 켜진 대화의
 * 엔진을 처음 보이면 그 엔진을 확인한다 — 앱이 도는 동안 엔진마다 한 번이고(`checkEngineOnce`), 그 뒤는 엔진 상태 이벤트가 잇는다.
 */
export function useConversationList(work: string, visible: boolean): ConversationList {
  const state = useStore(conversationListStore, (all) => all[work] ?? IDLE);
  useEffect(() => stand(work), [work]);
  useEffect(() => {
    if (visible) show(work);
  }, [work, visible]);
  const conversations = state.list ?? NO_CONVERSATIONS;
  const active = activeOf(conversations, state.chosen);
  const activeAgent = active?.agent ?? null;
  useEffect(() => {
    if (visible && activeAgent) checkEngineOnce(activeAgent);
  }, [visible, activeAgent]);
  return {
    conversations,
    active,
    wanted: state.wanted ?? null,
    reading: state.list === undefined && state.refused.list === undefined,
    opening: state.opening > 0,
    problem: state.refused.list ?? state.refused.open ?? state.refused.close ?? null,
  };
}

/** 대화창이 보였다 — 목록을 아직 모르면 읽고, 기록을 못 읽은 대화가 있으면 다시 읽는다. 몇 번 불러도 같다. */
function show(work: string): void {
  const state = stateOf(work);
  if (state.list === undefined) {
    if (!state.reading) void readList(work);
    return;
  }
  for (const conversation of state.unread) void readRecord(work, conversation);
}

/**
 * 목록을 읽는다 — 목록이 바뀌는 것은 이 앱이 부른 새 대화 · 닫기 · 바꾸기뿐이고 그 답으로 고치므로, **읽은 뒤로는 다시 읽지
 * 않는다**. 읽은 대화마다 기록을 읽는다. 대화가 없으면 첫 대화를 연다 — 목록은 work마다 한 번 읽으므로 이것도 work마다 한 번이다:
 * 대화를 다 닫은 뒤 다시 와도 저절로 열지 않는다(사람이 닫은 것을 되살리지 않는다).
 *
 * **거절되면 저절로 다시 묻지 않는다.** 로컬 IPC라 곧 다시 물어도 같은 답이고, 웹뷰 조회의 기본(세 번 더, 1 · 2 · 4초 쉼)이면 그
 * 7초 동안 「읽는 중」으로 말없이 잠긴다 — 그 글을 곧바로 세우고, 대화창이 다시 보일 때 다시 읽는다(`show`).
 */
async function readList(work: string): Promise<void> {
  update(work, (state) => ({ ...state, reading: true }));
  let list: readonly Conversation[];
  try {
    list = await chatApi.list(work);
  } catch (error) {
    update(work, (state) => ({ ...state, reading: false, refused: { ...state.refused, list: String(error) } }));
    return;
  }
  update(work, (state) => ({ ...withList(state, list), reading: false }));
  for (const conversation of list) void readRecord(work, conversation.id);
  if (list.length === 0) void openConversation(work);
}

/**
 * 그 대화의 기록을 한 번 읽어(「0 다음부터」) 기록 줄 스토어에 합친다 — 그 뒤는 앱 층이 받은 기록 줄 이벤트가 잇는다. 같은 seq는
 * 한 줄로 합쳐지므로 읽기와 이벤트가 겹쳐도 줄이 두 번 서지 않는다(`mergeLines`). 읽지 못하면 다음에 대화창이 보일 때 다시 읽는다.
 */
async function readRecord(work: string, conversation: string): Promise<void> {
  update(work, (state) => ({ ...state, unread: state.unread.filter((one) => one !== conversation) }));
  try {
    mergeLines(work, conversation, await chatApi.readRecord(work, conversation, 0));
  } catch {
    update(work, (state) => ({ ...state, unread: [...state.unread, conversation] }));
  }
}

/** 새 대화를 여는 일 하나 — 도는 동안 `+`가 잠긴다. */
async function opening(work: string, task: () => Promise<void>): Promise<void> {
  update(work, (state) => ({ ...state, opening: state.opening + 1 }));
  try {
    await task();
  } finally {
    update(work, (state) => ({ ...state, opening: state.opening - 1 }));
  }
}

/**
 * 새 대화 — `+`와 첫 대화(S8). 대화를 열기 전에 그 엔진을 확인한다(three-axes 티켓 22 「언제 확인하나」): 못 찾았으면 대화를 만들지
 * 않고(호스트도 거절한다) 그 엔진을 원한다 — 대화창 자리에 안내 카드가 선다. 찾았으면 로그인이 안 됐어도 연다: Codex는 호스트가
 * 로그인 필요 줄을 적고, 어느 엔진이든 그 대화 자리에 로그인 카드가 선다. 확인이 거절되면(로그인 셸을 못 읽음) 그대로 열어
 * 호스트의 거절을 보인다.
 *
 * 에이전트를 주지 않으면 설정 「대화」의 기본 에이전트다(three-axes 결정 16 · 티켓 25). 열 때마다 설정 파일을 다시 읽어, 바꾼
 * 설정이 다음 `+`부터 들고 두 자리의 대화창이 같은 값을 본다. 모델 · 모드 기본값은 호스트가 새 대화 때 같은 파일에서 읽는다.
 */
export function openConversation(work: string, agent?: Agent): Promise<void> {
  return opening(work, async () => {
    const chosen = agent ?? (await readDefaultAgent());
    let check: EngineCheck | null = null;
    try {
      check = await checkEngine(chosen, false);
    } catch {
      // 호스트의 거절은 만들기에서 다시 서서 그 글이 보인다.
    }
    if (check?.state === "missing") {
      update(work, (state) => ({ ...state, wanted: chosen }));
      return;
    }
    update(work, (state) => ({ ...state, wanted: undefined }));
    await create(work, chosen);
  });
}

/** 만들고 곧바로 띄운다 — 만든 대화를 목록 끝에 붙이고 그 대화를 고른 뒤, 그 기록을 읽는다. */
async function create(work: string, agent: Agent): Promise<void> {
  update(work, (state) => ({ ...state, refused: { ...state.refused, open: undefined } }));
  let conversation: Conversation;
  try {
    conversation = await chatApi.create(work, agent);
  } catch (error) {
    update(work, (state) => ({ ...state, refused: { ...state.refused, open: String(error) } }));
    return;
  }
  const known = stateOf(work).list?.some((one) => one.id === conversation.id) ?? false;
  update(work, (state) => {
    const list = state.list ?? NO_CONVERSATIONS;
    return { ...withList(state, known ? list : [...list, conversation]), chosen: conversation.id };
  });
  if (!known) void readRecord(work, conversation.id);
}

// 대화창이 선 work마다 선 대화창의 수 — 숨은 채 마운트된 작업 패널과 `chat` 탭은 둘 다 고른 work의 것이라, 여기 든 work가 화면에
// 선 work다. 원하던 대화는 여기 든 work에서만 연다.
const standing = new Map<string, number>();

/** 그 work의 대화창이 섰다 — 그새 원하던 엔진을 찾았으면 연다. 내려가는 손을 돌려준다(이펙트의 정리). */
function stand(work: string): () => void {
  standing.set(work, (standing.get(work) ?? 0) + 1);
  openFoundWanted(work);
  return () => {
    const left = (standing.get(work) ?? 1) - 1;
    if (left > 0) standing.set(work, left);
    else standing.delete(work);
  };
}

// 못 찾은 엔진을 찾았다 — 「다시 확인」의 답이든 엔진 상태 이벤트든 엔진 스토어에 앉는다. 대화창이 선 work가 그 엔진을 원했으면
// 그때 대화를 하나 연다. 엔진 스토어를 듣는 자리가 여기 하나라, 같은 work의 대화창이 몇 개 서 있어도 한 번이다.
chatEngineStore.subscribe(() => {
  for (const work of standing.keys()) openFoundWanted(work);
});

/**
 * 원하던 엔진을 찾았으면 그 대화를 연다. 새 대화를 여는 중이면 열지 않는다 — 그 일의 엔진 확인이 답을 앉히는 순간(스토어는 듣는
 * 쪽을 곧바로 부른다) 여기가 불리는데, 같은 엔진이면 그 일이 만들고 다른 엔진이면 사람이 방금 고른 쪽이 원함을 갈아 쓴다.
 */
function openFoundWanted(work: string): void {
  const state = stateOf(work);
  const agent = state.wanted;
  if (!agent || state.opening > 0 || chatEngineStore.state[agent]?.found !== true) return;
  update(work, (current) => ({ ...current, wanted: undefined }));
  void opening(work, () => create(work, agent));
}

/** 대화 닫기(S25) — 에이전트를 끈다. 기록은 남는다. 닫힌 대화를 목록에서 빼고, 켜진 대화였으면 그 옆(뒤, 없으면 앞)이 켜진다. */
export async function closeConversation(work: string, conversation: string): Promise<void> {
  update(work, (state) => ({ ...state, refused: { ...state.refused, close: undefined } }));
  try {
    await chatApi.close(work, conversation);
  } catch (error) {
    update(work, (state) => ({ ...state, refused: { ...state.refused, close: String(error) } }));
    return;
  }
  update(work, (state) => {
    const list = state.list ?? NO_CONVERSATIONS;
    const at = list.findIndex((one) => one.id === conversation);
    const next = at >= 0 && activeOf(list, state.chosen)?.id === conversation ? (list[at + 1] ?? list[at - 1]) : undefined;
    return { ...withList(state, list.filter((one) => one.id !== conversation)), chosen: next?.id ?? state.chosen };
  });
  // 닫은 대화는 볼 것이 없다 — 레일 `chat`의 점이 닫은 대화의 「끝남」으로 서지 않게(three-axes 티켓 23).
  forgetFinished(conversationKey(work, conversation));
}

/** 대화 탭을 골랐다 — 그 대화가 켜지고, 못 찾아 열지 못한 대화의 카드를 거둔다. */
export function chooseConversation(work: string, conversation: string): void {
  update(work, (state) => ({ ...state, chosen: conversation, wanted: undefined }));
}

/** 목록의 그 대화를 호스트가 돌려준 대화로 갈아 끼운다 — 칩의 바꾸기 답이 바뀐 대화다(three-axes 티켓 19). */
export function replaceConversation(work: string, conversation: Conversation): void {
  update(work, (state) =>
    withList(
      state,
      (state.list ?? NO_CONVERSATIONS).map((one) => (one.id === conversation.id ? conversation : one)),
    ),
  );
}

/** 목록에 있는 그 대화 — 목록을 아직 읽지 않았거나 없는 대화면 `undefined`다. 묻지 않는다(읽은 목록만 본다). */
export function listedConversation(work: string, conversation: string): Conversation | undefined {
  return stateOf(work).list?.find((one) => one.id === conversation);
}

/** 그 work의 읽은 대화 목록 — 아직 읽지 않았으면 `undefined`다. **읽지 않는다** — 대화창은 처음 보일 때 목록을 읽는다. */
export function useListedConversations(work: string | null): readonly Conversation[] | undefined {
  return useStore(conversationListStore, (all) => (work ? all[work]?.list : undefined));
}
