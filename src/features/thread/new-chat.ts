import { useCallback, useRef, useState } from "react";
import { Store, useStore } from "@tanstack/react-store";
import type { Quote } from "@/features/works/QuotePick";
import { attachmentStore } from "./attachments";
import type { NewThreadPicks } from "./chips";
import type { ScopeHold } from "./service-chip";
import { threadUiStore } from "./thread-store";
import type { Attachment } from "./types";

// **새 채팅 탭의 글 열쇠**(restart 02a-8 · 구현 스펙 「02a — 새 채팅의 글」). 입력 중인 글 · 첨부 · 인용은 열쇠로 산다(`thread-store` ·
// `attachments`). 채팅이면 채팅 id이고, 홈(`/`)의 새 채팅은 `NEW_THREAD`다. 작업공간의 새 채팅 탭은 **탭마다** 제 열쇠를 쓴다 — 한 열쇠를
// 나눠 쓰면 작업공간 A에서 쓴 글이 B의 새 채팅 탭과 홈에 함께 서고 B에서 보낼 수 있다. 열쇠는 묶음 칸의 id로 짓는다 — 칸 id는 앱이 도는
// 동안 다시 쓰지 않아(`shell-registry`의 `nextId`) 닫았다 새로 연 탭이 옛 글을 받지 않는다.
//
// **고른 값도 같은 열쇠로 산다**(구현 스펙 「02a — 숨은 탭」 · `newChatStore`) — 고른 Runtime · 모델 · 생각 깊이 · 모드 · 범위와 보내는 중인 첫
// 말이다. 같은 작업공간 안에서는 숨은 새 채팅 탭의 몸을 내리지 않지만, 작업공간을 옮기거나 작업공간 화면을 떠나면 몸이 내려간다. 그때 고른 값이
// 몸의 지역 상태면 Codex를 고른 탭이 Claude로 돌아온 채 보내지고 Runtime이 잠긴다.

/** 그 새 채팅 탭의 글 열쇠 — 묶음 칸의 id로 짓는다. 채팅 id(시각 꼴)와도 홈의 `NEW_THREAD`(빈 글자)와도 겹치지 않는다. */
export const newChatKey = (tab: number): string => `new-chat:${tab}`;

/** 보내는 중인 첫 말 — 답(새 채팅의 id)이 오기까지 보낸 말풍선과 「채팅을 시작하는 중」이 서고 입력창이 잠긴다. */
export interface NewChatSending {
  text: string;
  attachments: readonly Attachment[];
  quote: Quote | null;
}

/** 새 채팅이 첫 말 전에 고른 것 — 칩(`picks`), 범위(`hold`), 보내는 중인 첫 말(`starting`). */
export interface NewChatChoice {
  picks: NewThreadPicks;
  hold: ScopeHold;
  starting: NewChatSending | null;
}

/** 작업공간의 새 채팅 탭이 고른 것 — 탭의 글 열쇠(`newChatKey`)마다다. 탭이 처음 고르기 전에는 없다(몸이 처음 값을 쓴다). */
export const newChatStore = new Store<Readonly<Record<string, NewChatChoice>>>({});

/**
 * 새 채팅이 고른 것과 그것을 바꾸는 손. `kept`(작업공간의 새 채팅 탭의 글 열쇠)가 있으면 그 열쇠로 `newChatStore`에 쥔다 — 몸이 내려가도 돌아오면
 * 그대로이고, 보내는 중에 내려가도 답이 오는 대로 적힌다. 없으면(홈) 몸의 지역 상태다 — 「새 채팅」 · ⌘N이 몸을 새로 세워 비운다(`NewThreadScreen`).
 * `initial`은 처음 한 번만 읽는다.
 */
export function useNewChatChoice(
  kept: string | null,
  initial: NewChatChoice,
): [NewChatChoice, (change: (now: NewChatChoice) => NewChatChoice) => void] {
  const first = useRef(initial).current;
  const [local, setLocal] = useState(first);
  const stored = useStore(newChatStore, (state) => (kept === null ? undefined : state[kept]));
  const change = useCallback(
    (update: (now: NewChatChoice) => NewChatChoice) => {
      if (kept === null) setLocal(update);
      else newChatStore.setState((state) => ({ ...state, [kept]: update(state[kept] ?? first) }));
    },
    [kept, first],
  );
  return [kept === null ? local : (stored ?? first), change];
}

/**
 * 그 열쇠의 글 · 첨부 · 인용 · 넣은 언급 · 고른 것을 지운다 — 새 채팅 탭을 닫았거나 그 탭이 채팅이 됐다(보낸 뒤라 비어 있다). 다른 열쇠의 것은
 * 그대로다. 지울 것이 없으면 스토어를 건드리지 않는다 — 구독한 입력창이 깨어나지 않게.
 */
export function forgetNewChat(key: string): void {
  threadUiStore.setState((state) => {
    if (!(key in state.drafts) && !(key in state.quotes) && !(key in state.mentions) && state.filled !== key) return state;
    const { [key]: _draft, ...drafts } = state.drafts;
    const { [key]: _quote, ...quotes } = state.quotes;
    const { [key]: _mentions, ...mentions } = state.mentions;
    return { ...state, drafts, quotes, mentions, filled: state.filled === key ? null : state.filled };
  });
  attachmentStore.setState((state) => {
    if (!(key in state)) return state;
    const { [key]: _gone, ...rest } = state;
    return rest;
  });
  newChatStore.setState((state) => {
    if (!(key in state)) return state;
    const { [key]: _gone, ...rest } = state;
    return rest;
  });
}
