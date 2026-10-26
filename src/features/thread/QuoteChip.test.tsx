import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftQuoteChip, quoteHead, SentQuoteChip } from "./QuoteChip";

// 인용 칩(v1 티켓 35 · S41 — three-axes 티켓 27의 칩을 Thread 입력창으로 옮겼다) — 넓힌 카드의 문서에서 고른 글이 입력창 위에, 보낸 뒤에는
// 말풍선 위에 「❝앞부분…❞ · 파일」로 선다.

const quote = { file: "design.md", start: 3, end: 4, text: "차감은 결제사 응답 뒤\n한 번만 한다. 남은 금액은 refunded_amount로 계산한다." };

describe("인용 칩", () => {
  it("앞부분은 줄바꿈 · 겹친 빈칸을 한 칸으로 접고 24자에서 자른다", () => {
    expect(quoteHead(quote.text)).toBe("차감은 결제사 응답 뒤 한 번만 한다. 남은…");
    expect(quoteHead("  짧은 글 ")).toBe("짧은 글");
  });

  it("입력창의 칩은 「인용 빼기」 ×를 달고, 도움말은 파일 · 줄 범위 · 고른 글 전부다", () => {
    const markup = renderToStaticMarkup(<DraftQuoteChip quote={quote} onDrop={() => {}} />);
    expect(markup).toContain("❝차감은 결제사 응답 뒤 한 번만 한다. 남은…❞ · design.md");
    expect(markup).toContain('aria-label="인용 빼기"');
    expect(markup).toContain('title="design.md 3–4줄\n차감은 결제사 응답 뒤\n한 번만 한다.');
  });

  it("보낸 말 위의 칩은 빼는 단추가 없고, 한 줄이면 「3줄」이다", () => {
    const markup = renderToStaticMarkup(<SentQuoteChip quote={{ ...quote, end: 3 }} />);
    expect(markup).not.toContain("인용 빼기");
    expect(markup).toContain('title="design.md 3줄');
  });
});
