import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceSkeleton, PlaceStage } from "./PlaceList";

// 공용 목록 틀(restart 03-1 · 보드 PlaceSheet 「움직임과 조작」 · 「처음 읽는 중」) — seam은 그린 꼴(markup)이다. 장면이 바뀔 때의 움직임
// (`place-in` · `place-back`)과 계산된 시간 · 곡선은 L3 · live가 잰다(이 저장소의 L2에는 DOM이 없다).

const classOf = (html: string, marker: string) => html.match(new RegExp(`<div([^>]*)>${marker}`))?.[1] ?? "";

describe("목록과 상세의 자리", () => {
  it("상세가 서면 목록은 마운트된 채 보이지도 닿지도 않고, 곧장 상세로 온 자리는 움직이지 않는다", () => {
    const html = renderToStaticMarkup(<PlaceStage list={<p>목록</p>} detail={<p>상세</p>} detailKey="web-app" />);
    const list = classOf(html, "<p>목록");
    expect(list).toContain('inert=""');
    expect(list).toMatch(/\binvisible\b/);
    expect(classOf(html, "<p>상세")).not.toMatch(/\bplace-in\b/);
  });

  it("상세가 없으면 목록만 서고, 처음 선 목록은 움직이지 않는다", () => {
    const html = renderToStaticMarkup(<PlaceStage list={<p>목록</p>} detail={<p>상세</p>} detailKey={null} />);
    expect(html).not.toContain("상세");
    const list = classOf(html, "<p>목록");
    expect(list).not.toContain("inert");
    expect(list).not.toMatch(/\b(invisible|place-back)\b/);
  });
});

describe("처음 읽는 중의 뼈대", () => {
  it("열 머리는 누르지 않는 글이고 줄 넷이 선다", () => {
    const html = renderToStaticMarkup(<PlaceSkeleton whenLabel="최근 활동" />);
    expect(html).not.toContain("<button");
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).toBe("이름 최근 활동");
    expect(html.match(/skeleton-sweep/g)).toHaveLength(8);
  });
});
