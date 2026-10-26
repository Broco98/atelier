import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusMark, type StatusMarkKind } from "./status-mark";

// **상태 표시**(02 구현 스펙 §4 · S11 · 캔버스 Components 「사이드바 줄」) — 사이드바 줄 오른쪽 끝에 서는 표시 하나가 무엇을 말하는가를
// 정적 마크업으로 본다. 어느 상태를 그릴지 고르는 것은 `status.ts`의 `markOf`(Thread 줄)와 `work-mark.ts`의 `workMark`(Work 줄)이고, 여기로는
// 고른 결과만 들어온다. 크기 · 색 · 자리는 시안 비교(`시안-비교/05`)와 L3가 잰다.

const draw = (kind: StatusMarkKind | null) => renderToStaticMarkup(<StatusMark kind={kind} />);
/** 태그를 걷은 보이는 글. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** 그림으로 서는 표시의 접근성 이름들(`role="img"`). */
const imagesOf = (html: string) =>
  [...html.matchAll(/<[^>]*role="img"[^>]*>/g)].map((tag) => /aria-label="([^"]*)"/.exec(tag[0])?.[1] ?? null);

describe("상태 표시", () => {
  it("내 차례는 「내 차례」 글자 알약이다", () => {
    const html = draw("mine");
    expect(textOf(html)).toBe("내 차례");
    expect(imagesOf(html)).toEqual([]);
  });

  it("도는 중은 「작업 중」이라는 이름의 스피너 하나다", () => {
    const html = draw("working");
    expect(textOf(html)).toBe("");
    expect(imagesOf(html)).toEqual(["작업 중"]);
  });

  it("실패는 「실패」 글자다", () => {
    const html = draw("failed");
    expect(textOf(html)).toBe("실패");
    expect(imagesOf(html)).toEqual([]);
  });

  it("새 결과는 「새 결과」라는 이름의 점 하나다", () => {
    const html = draw("new");
    expect(textOf(html)).toBe("");
    expect(imagesOf(html)).toEqual(["새 결과"]);
  });

  it("표시할 상태가 없으면(멈춤 · 조용함) 아무것도 서지 않는다", () => {
    expect(draw(null)).toBe("");
  });

  it("넷이 저마다 다른 표식으로 선다 — 검사와 시안 비교가 이것으로 집는다", () => {
    const kinds: StatusMarkKind[] = ["mine", "working", "failed", "new"];
    expect(kinds.map((kind) => /data-mark="([^"]*)"/.exec(draw(kind))?.[1])).toEqual(kinds);
  });
});
