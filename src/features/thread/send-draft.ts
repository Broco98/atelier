import type { Quote } from "@/features/works/QuotePick";
import { attachmentStore, attachmentsOf, setAttachments } from "./attachments";
import { setDraft, setQuote, threadUiStore } from "./thread-store";
import type { Attachment } from "./types";

/** 입력창이 거둔 말을 보내는 길 — 선 채팅이면 그 채팅에 말하기, 새 채팅이면 채팅을 세우는 첫 말이다. */
export type SendDraft = (text: string, attachments: readonly Attachment[], quote: Quote | null) => Promise<void>;

/**
 * **입력창의 말을 보낸다**(v1 티켓 05 · 06 · 35) — 그 열쇠(`draftKey`)의 글(앞뒤 빈칸을 뗀다) · 첨부 · 인용을 거두어 입력창을 비우고 `send`에
 * 건넨다. 보내는 동안 입력창이 비어 있어 같은 말을 두 번 보내지 않는다. **거절되면 거둔 것을 그대로 되돌리고** 거절을 다시 던진다 — 쓰던
 * 글과 칩이 남아 사람이 고쳐 다시 보낸다. 새 채팅의 첫 말도 같다(restart 02a-11 — 작업공간의 새 채팅 탭에서 붙인 인용이 틀리면 엔진이 채팅을
 * 세우지 않고 거절한다).
 */
export function sendDraft(key: string, send: SendDraft): Promise<void> {
  const text = (threadUiStore.state.drafts[key] ?? "").trim();
  const attached = attachmentsOf(attachmentStore.state, key);
  const quoted = threadUiStore.state.quotes[key] ?? null;
  setDraft(key, "");
  setAttachments(key, []);
  if (quoted) setQuote(key, null);
  return send(text, attached, quoted).catch((error: unknown) => {
    setDraft(key, text);
    setAttachments(key, attached);
    if (quoted) setQuote(key, quoted);
    throw error;
  });
}
