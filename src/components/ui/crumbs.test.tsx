import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Crumbs } from "./crumbs";

// 카드 머리의 브레드크럼 캡슐(ui-refresh 결정 5 · 6). 지금 선 곳을 **글자로** 말하는 자리라
// 누르는 칸이 없고, 조각의 순서와 「어느 것이 지금 선 곳인가」가 이 부품이 지키는 전부다.
const draw = (items: readonly string[], icon?: React.ReactNode) =>
  renderToStaticMarkup(<Crumbs items={items} icon={icon} />);

/** 조각의 여는 태그와 글자 — 꺾쇠(svg)는 조각이 아니다. */
function pieces(markup: string): { tag: string; text: string }[] {
  return [...markup.matchAll(/<(span|b)\b([^>]*)>([^<]*)<\/\1>/g)].map((m) => ({
    tag: `<${m[1]}${m[2]}>`,
    text: m[3],
  }));
}

describe("Crumbs", () => {
  it("위치를 이름 붙은 nav 하나로 말한다", () => {
    const markup = draw(["ui-refresh", "spec", "overview.md"]);
    expect(markup).toMatch(/^<nav\b[^>]*aria-label="위치"/);
    // 보여 주기만 한다 — 누르는 칸이 생기면 사이드바 nav의 버튼 찾기와 겹친다(판 04 spec).
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<a ");
  });

  it("조각이 받은 순서대로 서고 사이마다 꺾쇠가 하나씩 선다", () => {
    const markup = draw(["ui-refresh", "spec", "overview.md"]);
    expect(pieces(markup).map((piece) => piece.text)).toEqual(["ui-refresh", "spec", "overview.md"]);
    expect(markup.match(/lucide-chevron-right/g)).toHaveLength(2);
  });

  it("마지막 조각만 굵고 본문 글자색이다", () => {
    const [first, second, last] = pieces(draw(["Settings", "spec 레이아웃", "Atelier"]));
    for (const piece of [first, second]) {
      expect(piece.tag).not.toContain("font-medium");
      expect(piece.tag).not.toContain("text-foreground");
    }
    expect(last.tag).toContain("font-medium");
    expect(last.tag).toContain("text-foreground");
    // 긴 이름은 마지막 조각에서 말줄임으로 접힌다 — 앞 조각은 줄지 않는다.
    expect(last.tag).toContain("truncate");
  });

  it("조각이 하나면 꺾쇠 없이 그 조각이 지금 선 곳이다", () => {
    const markup = draw(["Processes"]);
    expect(markup).not.toContain("lucide-chevron-right");
    expect(pieces(markup)).toEqual([expect.objectContaining({ text: "Processes" })]);
    expect(pieces(markup)[0].tag).toContain("font-medium");
  });

  it("앞 아이콘 칸은 준 때만 선다", () => {
    expect(draw(["Works"])).not.toContain('data-slot="crumbs-icon"');
    const markup = draw(["Works"], <svg data-testid="mark" />);
    expect(markup).toMatch(/data-slot="crumbs-icon"[^>]*>\s*<svg data-testid="mark"/);
    // 아이콘은 조각보다 앞이다.
    expect(markup.indexOf("crumbs-icon")).toBeLessThan(markup.indexOf(">Works<"));
  });
});
