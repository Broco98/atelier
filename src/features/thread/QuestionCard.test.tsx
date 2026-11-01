import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PendingQuestion } from "./fold";
import QuestionCard from "./QuestionCard";

// 질문 카드의 머리 — 채팅은 Runtime 세션 하나라 얼굴이 없고, 카드의 이름은 Runtime 이름이다(스토리 2).
describe("질문 카드", () => {
  const request: PendingQuestion = {
    card: "question",
    requestId: "0",
    toolCall: {},
    questions: [{ question: "어느 화면에 보일까요?", description: null, multiSelect: false, options: [{ label: "주문 상세", description: null }] }],
  };

  it("얼굴 없이 물음이 서고, 카드 이름은 Runtime 이름으로 선다", () => {
    const markup = renderToStaticMarkup(<QuestionCard thread="t" name="Claude Code" request={request} count={{ at: 1, total: 2 }} />);
    expect(markup).toContain('aria-label="Claude Code의 질문"');
    expect(markup).toContain("어느 화면에 보일까요?");
    expect(markup).toContain("1 / 2");
    expect(markup).not.toContain("<svg");
  });
});
