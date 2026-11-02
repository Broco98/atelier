/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Quote } from "@/features/works/QuotePick";
import { threadApi } from "./api";
import { attachmentStore, attachmentsOf, setAttachments } from "./attachments";
import { forgetNewChat, newChatKey } from "./new-chat";
import { sendDraft } from "./send-draft";
import { setDraft, setQuote, threadUiStore } from "./thread-store";
import type { Attachment, StartPicks, ThreadLink } from "./types";

// 엔진은 앱 명령으로만 닿는다 — 채팅을 세우는 명령의 답(id · 거절)을 시험이 정한다.
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

// restart 02a-11 · 구현 스펙 「02a — 오른쪽 자리」 — 작업공간의 새 채팅 탭은 첫 말 전에 넓힌 카드에서 문서를 읽고, 고른 글이 그 탭의 입력창에
// 인용으로 붙는다. 첫 말은 채팅을 세우는 명령(`thread_start`)으로 가므로 인용도 그 명령에 실린다. 인용이 틀리면 엔진이 채팅을 세우지 않고
// 거절하고(L1 `thread_quote.rs`), 입력창은 거둔 글 · 첨부 · 인용 칩을 그 탭에 되돌린다 — 사람이 고쳐 다시 보낸다.
describe("새 채팅 탭의 첫 말과 인용", () => {
  const key = newChatKey(9001);
  const link: ThreadLink = { kind: "work", slug: "plan" };
  const picks: StartPicks = { runtime: "claude-code", mode: null, model: null, effort: null, service: null, project: null };
  const quote: Quote = { file: "design.md", start: 3, end: 4, text: "차감은 결제사 응답 뒤 한 번만 한다." };
  const file: Attachment = { path: "/tmp/영수증.png", size: 2048, folder: false };
  /** 새 채팅의 첫 말 — 입력창이 거둔 것을 채팅을 세우는 명령에 넘긴다(`NewChat`의 `start`와 같은 길). */
  const start = async (text: string, attachments: readonly Attachment[], quoted: Quote | null) => {
    await threadApi.start(text, attachments, link, picks, quoted);
  };
  const shown = () => ({
    draft: threadUiStore.state.drafts[key] ?? "",
    quote: threadUiStore.state.quotes[key] ?? null,
    attachments: attachmentsOf(attachmentStore.state, key),
  });

  afterEach(() => {
    forgetNewChat(key);
    invoke.mockReset();
  });

  it("첫 말과 함께 인용이 채팅을 세우는 명령에 가고, 그 탭의 입력창은 비어 있다", async () => {
    setDraft(key, "이 부분부터 보자 ");
    setQuote(key, quote);
    invoke.mockResolvedValueOnce("20261103-090000");
    await sendDraft(key, start);
    expect(invoke).toHaveBeenCalledWith("thread_start", {
      text: "이 부분부터 보자",
      attachments: [],
      link,
      runtime: "claude-code",
      mode: null,
      model: null,
      effort: null,
      service: null,
      project: null,
      quote,
    });
    expect(shown()).toEqual({ draft: "", quote: null, attachments: [] });
  });

  it("인용이 틀려 채팅을 세우지 못하면 쓰던 글 · 첨부 · 인용 칩이 그 탭의 입력창에 남는다", async () => {
    setDraft(key, "이 부분부터 보자");
    setQuote(key, quote);
    setAttachments(key, [file]);
    let refuse: (reason: string) => void = () => {};
    invoke.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    const sending = sendDraft(key, start);
    // 보내는 동안 입력창은 비어 있다 — 같은 말을 두 번 보내지 않게.
    expect(shown()).toEqual({ draft: "", quote: null, attachments: [] });
    refuse("인용한 파일이 spec 폴더 안에 있지 않습니다");
    await expect(sending).rejects.toBe("인용한 파일이 spec 폴더 안에 있지 않습니다");
    expect(shown()).toEqual({ draft: "이 부분부터 보자", quote, attachments: [file] });
  });

  it("인용이 없으면 명령의 인용 칸은 `null`이다", async () => {
    setDraft(key, "그냥 시작");
    invoke.mockResolvedValueOnce("20261103-090001");
    await sendDraft(key, start);
    expect(invoke).toHaveBeenCalledWith("thread_start", expect.objectContaining({ text: "그냥 시작", quote: null }));
  });

  // 누름은 정적 그림에 없다(jsdom이 없다) — 입력창이 이 길로 보내고, 새 채팅의 첫 말이 거둔 인용을 채팅을 세우는 명령에 넘기는 배선은
  // 리터럴로 못박는다.
  it("입력창은 이 길로 보내고, 새 채팅의 첫 말은 거둔 인용을 채팅을 세우는 명령에 넘긴다", () => {
    const read = (file: string) => readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
    expect(read("ThreadComposer.tsx")).toContain("sendDraft(draftKey, onSend)");
    const screen = read("ThreadScreen.tsx");
    expect(screen).toContain("const start = async (text: string, attachments: readonly Attachment[], quote: Quote | null) => {");
    expect(screen).toContain("threadApi.start(text, attachments, link, { ...picks, mode, ...startScope(link, hold, shown) }, quote)");
  });
});
