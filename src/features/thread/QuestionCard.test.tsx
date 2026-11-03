import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AskedQuestion, PendingQuestion } from "./fold";
import QuestionCard from "./QuestionCard";

// 질문 카드(restart 02b-5 · Cards 보드 「질문」) — 승인 카드와 같은 겉(`.ra-ask`)에 「질문」 · 물음, 아래 줄은 선택지 알약 · 빈칸 · 「나중에」 · 「직접
// 쓰기」다. 채팅은 Runtime 세션 하나라 얼굴이 없고, 카드의 이름은 Runtime 이름이다(스토리 2).

const ONE: AskedQuestion = {
  question: "세 번 실패한 뒤에는 어떻게 할까요?",
  description: null,
  multiSelect: false,
  options: [
    { label: "배너만 띄우기", description: "사이드바 신호는 두지 않아요" },
    { label: "배너와 알림", description: null },
    { label: "조용히 멈추기", description: null },
  ],
};

const request = (questions: AskedQuestion[]): PendingQuestion => ({ card: "question", requestId: "0", toolCall: {}, questions });

const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => words(match[1]));

describe("질문 카드", () => {
  it("「질문」 · 차례 · 물음, 아래 줄은 선택지 알약 · 나중에 · 직접 쓰기다 — 고르는 것이 곧 답이라 「답하기」가 없다", () => {
    const html = renderToStaticMarkup(<QuestionCard thread="t" name="Claude Code" request={request([ONE])} count={{ at: 1, total: 2 }} />);
    expect(html).toContain('aria-label="Claude Code의 질문"');
    expect(words(html)).toBe("질문 1 / 2 세 번 실패한 뒤에는 어떻게 할까요? 배너만 띄우기 배너와 알림 조용히 멈추기 나중에 직접 쓰기");
    expect(buttons(html)).toEqual(["배너만 띄우기", "배너와 알림", "조용히 멈추기", "나중에", "직접 쓰기"]);
    // 선택지의 설명은 알약에 마우스를 올리면 선다.
    expect(html).toContain('title="사이드바 신호는 두지 않아요"');
  });

  it("여럿 고르는 물음은 고른 뒤 「답하기 ↵」로 보낸다 — 모두 답하기 전에는 잠겨 있다", () => {
    const html = renderToStaticMarkup(<QuestionCard thread="t" name="Claude Code" request={request([{ ...ONE, multiSelect: true }])} />);
    expect(buttons(html)).toEqual(["배너만 띄우기", "배너와 알림", "조용히 멈추기", "직접 쓰기", "나중에", "답하기 ↵"]);
    expect(html).toMatch(/role="checkbox" aria-checked="false"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>답하기/);
  });
});
