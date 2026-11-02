import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Arrival, settledPlace } from "./arrival";
import { DocCard } from "./DocCard";

// 대화 속 문서 카드(v1 티켓 35 · 스토리 102 · 캔버스 Messages 보드 「파일과 첨부 — Agent가 만든 파일」) — 정적 마크업으로 글을 잰다. 누르면
// 넓힌 카드에서 그 문서가 열린다(그 길은 `ThreadScreen`이 건다).

const none = () => {};

describe("대화 속 문서 카드", () => {
  it("이름 · 「Claude Code가 만듦 · 32줄 · 같이 고칠 수 있어요」 · 「열기」가 선다(보드 글자 그대로)", () => {
    const markup = renderToStaticMarkup(<DocCard doc={{ path: "design.md", lines: 32 }} name="Claude Code" onOpen={none} />);
    expect(markup).toMatch(/<button type="button" data-doc-card="design.md"/);
    expect(markup).toMatch(/>design.md<.*>Claude Code가 만듦 · 32줄 · 같이 고칠 수 있어요<.*>열기</);
  });

  it("받침 있는 이름에는 「이」를 단다", () => {
    const markup = renderToStaticMarkup(
      <DocCard doc={{ path: "notes/review.md", lines: 3 }} name="리뷰어 진" onOpen={none} />,
    );
    expect(markup).toContain(">notes/review.md<");
    expect(markup).toContain("리뷰어 진이 만듦 · 3줄");
  });
});

// ChatCards 보드 「문서 카드」(restart 02b-6 · `.ra-dcard`) — 폭 420까지 · 안쪽 10 12 10 10 · 둥근 12 · 0.5 링 · 흰 면(가리키면 `fill-soft`), 왼쪽
// 40 상자(둥근 8 · `fill-soft`, 가리키면 `fill-hover`)의 문서 글리프 15. 한때 둥근 16 · 상자 둥근 10 · 글리프 16이었다. 대화가 선 뒤에 새로 서면
// 아래 12에서 올라온다(Motion 「문서 · PR 카드가 선다」 — 320ms `card-rise`).
describe("문서 카드의 모양", () => {
  const classes = (markup: string, pattern: RegExp) => pattern.exec(markup)?.[1].split(" ") ?? [];
  const markup = renderToStaticMarkup(<DocCard doc={{ path: "design.md", lines: 32 }} name="Claude Code" onOpen={none} />);

  it("카드는 둥근 12 · 0.5 링 · 흰 면이고 가리키면 옅은 면이다", () => {
    expect(classes(markup, /<button[^>]*class="([^"]*)"/)).toEqual(
      expect.arrayContaining(["group", "max-w-105", "rounded-xl", "bg-surface", "shadow-hairline", "hover:bg-fill-soft", "py-2.5", "pr-3", "pl-2.5", "gap-3"]),
    );
  });

  it("글리프 상자는 40 · 둥근 8이고 카드를 가리키면 한 단 짙어진다 — 글리프는 15다", () => {
    const box = classes(markup, /<span class="([^"]*size-10[^"]*)"/);
    expect(box).toEqual(expect.arrayContaining(["rounded-md", "bg-fill-soft", "group-hover:bg-fill-hover", "transition-colors"]));
    expect(markup).toMatch(/<svg[^>]*class="[^"]*\bsize-3\.75\b/);
  });

  it("대화가 선 뒤에 새로 선 카드는 아래에서 올라온다", () => {
    expect(markup).not.toContain("card-rise");
    const arrived = renderToStaticMarkup(
      <Arrival.Provider value={settledPlace()}>
        <DocCard doc={{ path: "design.md", lines: 32 }} name="Claude Code" onOpen={none} />
      </Arrival.Provider>,
    );
    expect(classes(arrived, /<button[^>]*class="([^"]*)"/)).toContain("card-rise");
  });
});
