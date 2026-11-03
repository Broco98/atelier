import { afterEach, describe, expect, it } from "vitest";
import { addAttachments, attachmentsOf, attachmentStore } from "./attachments";
import { forgetNewChat, newChatKey, newChatStore, type NewChatChoice } from "./new-chat";
import { NEW_THREAD, setDraft, setQuote, threadUiStore } from "./thread-store";

// restart 02a-8 — **새 채팅 탭의 글 열쇠.** 입력 중인 글 · 첨부 · 인용은 열쇠로 산다. 새 채팅 탭은 탭마다 제 열쇠를 쓰고 홈(`/`)은 `NEW_THREAD`를
// 그대로 쓴다 — 한 열쇠를 나눠 쓰면 작업공간 A에서 쓴 글이 B의 새 채팅 탭과 홈에 함께 서고 B에서 보낼 수 있다. 탭을 닫으면 그 열쇠의 것을 지운다.

const file = (path: string) => ({ path, folder: false, size: 1 });

afterEach(() => {
  threadUiStore.setState(() => ({ drafts: {}, expanded: {}, filled: null, quotes: {}, mentions: {} }));
  attachmentStore.setState(() => ({}));
  newChatStore.setState(() => ({}));
});

/** Codex를 고른 새 채팅 탭의 것 — 범위는 고르지 않았다. */
const codex: NewChatChoice = {
  picks: { runtime: "codex", mode: null, model: null, effort: null },
  hold: { loose: null, work: null },
  starting: null,
};

describe("새 채팅 탭의 글 열쇠", () => {
  it("탭마다 다르고 홈의 열쇠와도 다르다", () => {
    expect(newChatKey(3)).not.toBe(newChatKey(4));
    expect(newChatKey(3)).not.toBe(NEW_THREAD);
    expect(newChatKey(3)).toBe(newChatKey(3));
  });

  it("작업공간 A의 새 채팅 탭에 쓴 글과 첨부는 B의 새 채팅 탭과 홈에 서지 않는다", () => {
    const a = newChatKey(3);
    const b = newChatKey(4);
    setDraft(a, "A에서 쓰던 말");
    addAttachments(a, [file("/tmp/a.png")]);
    expect(threadUiStore.state.drafts[b]).toBeUndefined();
    expect(threadUiStore.state.drafts[NEW_THREAD]).toBeUndefined();
    expect(attachmentsOf(attachmentStore.state, b)).toEqual([]);
    expect(attachmentsOf(attachmentStore.state, NEW_THREAD)).toEqual([]);
  });

  it("탭을 닫으면 그 탭의 글 · 첨부 · 인용 · 고른 것을 지우고 다른 열쇠의 것은 그대로다", () => {
    const a = newChatKey(3);
    const b = newChatKey(4);
    setDraft(a, "닫을 탭의 말");
    setDraft(b, "남을 탭의 말");
    setDraft(NEW_THREAD, "홈의 말");
    addAttachments(a, [file("/tmp/a.png")]);
    addAttachments(b, [file("/tmp/b.png")]);
    setQuote(a, { file: "spec.md", start: 1, end: 1, text: "고른 글" });
    newChatStore.setState(() => ({ [a]: codex, [b]: codex }));

    forgetNewChat(a);

    expect(threadUiStore.state.drafts).toEqual({ [b]: "남을 탭의 말", [NEW_THREAD]: "홈의 말" });
    expect(threadUiStore.state.quotes[a]).toBeUndefined();
    expect(attachmentStore.state[a]).toBeUndefined();
    expect(attachmentsOf(attachmentStore.state, b)).toEqual([file("/tmp/b.png")]);
    expect(newChatStore.state).toEqual({ [b]: codex });
  });

  it("지울 것이 없으면 스토어가 그대로다", () => {
    const ui = threadUiStore.state;
    const attached = attachmentStore.state;
    const chosen = newChatStore.state;
    forgetNewChat(newChatKey(9));
    expect(threadUiStore.state).toBe(ui);
    expect(attachmentStore.state).toBe(attached);
    expect(newChatStore.state).toBe(chosen);
  });
});
