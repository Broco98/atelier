import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocCard } from "./DocCard";

// 대화 속 문서 카드(v1 티켓 35 · 스토리 102 · 캔버스 Messages 보드 「파일과 첨부 — Agent가 만든 파일」) — 정적 마크업으로 글을 잰다. 누르면
// 넓힌 카드에서 그 문서가 열린다(그 길은 `ThreadScreen`이 건다).

const none = () => {};

describe("대화 속 문서 카드", () => {
  it("이름 · 「Host가 만듦 · 32줄 · 같이 고칠 수 있어요」 · 「열기」가 선다(보드 글자 그대로)", () => {
    const markup = renderToStaticMarkup(<DocCard doc={{ path: "design.md", lines: 32, who: "host" }} name="Host" onOpen={none} />);
    expect(markup).toMatch(/<button type="button" data-doc-card="design.md"/);
    expect(markup).toMatch(/>design.md<.*>Host가 만듦 · 32줄 · 같이 고칠 수 있어요<.*>열기</);
  });

  it("받침 있는 이름에는 「이」를 단다", () => {
    const markup = renderToStaticMarkup(
      <DocCard doc={{ path: "notes/review.md", lines: 3, who: "reviewer" }} name="리뷰어 진" onOpen={none} />,
    );
    expect(markup).toContain(">notes/review.md<");
    expect(markup).toContain("리뷰어 진이 만듦 · 3줄");
  });
});
