import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AskCount, AskNext } from "./AskTurnMarks";

// 물음 차례의 표시(스펙 「02b — 대화창」 · 구현 지도 「물음 차례」) — 사람을 기다리는 카드의 차례라 남고, 얼굴과 이름 문구만 뺐다. 글은 `asks.test.ts`의
// `nextOf`가 재고, 여기서는 줄이 그 글만 든 것을 잰다.
describe("물음 차례의 표시", () => {
  const words = (markup: string) => markup.replace(/<[^>]*>/g, "");

  it("다음 줄은 얼굴과 이름 없이 무엇을 기다리는지만 말한다", () => {
    const markup = renderToStaticMarkup(<AskNext line={{ subject: "pnpm playwright test", mono: true, what: "실행을 기다려요" }} />);
    expect(words(markup)).toBe("다음 · pnpm playwright test 실행을 기다려요");
    expect(markup).not.toContain("<svg");
  });

  it("대상이 없는 다음 줄은 기다리는 것만이다", () => {
    expect(words(renderToStaticMarkup(<AskNext line={{ subject: null, mono: false, what: "질문의 답을 기다려요" }} />))).toBe("다음 · 질문의 답을 기다려요");
  });

  it("묶음 안의 자리는 그대로 「1 / 2」다", () => {
    expect(words(renderToStaticMarkup(<AskCount count={{ at: 1, total: 2 }} />))).toBe("1 / 2");
  });
});
