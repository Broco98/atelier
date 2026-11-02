import { attachmentStore } from "./attachments";
import { threadUiStore } from "./thread-store";

// **새 채팅 탭의 글 열쇠**(restart 02a-8 · 구현 스펙 「02a — 새 채팅의 글」). 입력 중인 글 · 첨부 · 인용은 열쇠로 산다(`thread-store` ·
// `attachments`). 채팅이면 채팅 id이고, 홈(`/`)의 새 채팅은 `NEW_THREAD`다. 작업공간의 새 채팅 탭은 **탭마다** 제 열쇠를 쓴다 — 한 열쇠를
// 나눠 쓰면 작업공간 A에서 쓴 글이 B의 새 채팅 탭과 홈에 함께 서고 B에서 보낼 수 있다. 열쇠는 묶음 칸의 id로 짓는다 — 칸 id는 앱이 도는
// 동안 다시 쓰지 않아(`shell-registry`의 `nextId`) 닫았다 새로 연 탭이 옛 글을 받지 않는다.

/** 그 새 채팅 탭의 글 열쇠 — 묶음 칸의 id로 짓는다. 채팅 id(시각 꼴)와도 홈의 `NEW_THREAD`(빈 글자)와도 겹치지 않는다. */
export const newChatKey = (tab: number): string => `new-chat:${tab}`;

/**
 * 그 열쇠의 글 · 첨부 · 인용 · 넣은 언급을 지운다 — 새 채팅 탭을 닫았거나 그 탭이 채팅이 됐다(보낸 뒤라 비어 있다). 다른 열쇠의 것은 그대로다. 지울 것이
 * 없으면 스토어를 건드리지 않는다 — 구독한 입력창이 깨어나지 않게.
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
}
