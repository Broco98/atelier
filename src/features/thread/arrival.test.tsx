import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Arrival, ArrivalScope, Arriving, settledPlace } from "./arrival";
import { DraftQuoteChip } from "./QuoteChip";

// 정적 마크업 seam — **움직임은 상태가 바뀐 그 자리에서만 일어난다**(v1 티켓 43 · Motion 보드 머리말). 화면이 처음 설 때 그려진 것(Thread를
// 열 때 이미 있던 줄 · 칩 · 얼굴)은 움직이지 않고, 화면이 선 뒤에 새로 선 것만 들어서는 움직임을 단다. 정적 렌더는 효과를 돌리지 않으므로
// `ArrivalScope` 안은 늘 「처음 설 때」이고, 「선 뒤」는 화면이 선 자리(`settledPlace`)를 바로 준다. 움직임의 박자는 `tokens.test.ts`가 본다.

const settled = (node: ReactNode, place = settledPlace()) =>
  renderToStaticMarkup(<Arrival.Provider value={place}>{node}</Arrival.Provider>);
const firstPaint = (node: ReactNode) => renderToStaticMarkup(<ArrivalScope>{node}</ArrivalScope>);
const quote = { file: "design.md", start: 9, end: 10, text: "부분 환불을 두 번 하면 잔액이 두 번 빠짐" };

describe("들어서는 움직임", () => {
  it("화면이 처음 설 때 그려진 것은 움직이지 않는다", () => {
    expect(firstPaint(<Arriving motion="chip-in">칩</Arriving>)).toBe("<div>칩</div>");
  });

  it("화면이 선 뒤에 선 것은 그 움직임으로 선다", () => {
    expect(settled(<Arriving motion="chip-in" className="flex">칩</Arriving>)).toBe('<div class="chip-in flex">칩</div>');
    expect(settled(<Arriving as="li" motion="chip-in">칩</Arriving>)).toBe('<li class="chip-in">칩</li>');
  });

  it("같은 이름으로 이미 섰던 것이 자리를 옮겨 다시 서면 움직이지 않는다", () => {
    // 턴이 끝나 결정 줄이 접힌 턴으로 옮겨 서는 때 — 그 줄의 이름(기록 줄의 열쇠)은 이 자리에서 이미 섰다.
    const place = { ...settledPlace(), seen: new Set(["d7"]) };
    expect(settled(<Arriving motion="chip-in" arrival="d7">결정</Arriving>, place)).toBe("<div>결정</div>");
    expect(settled(<Arriving motion="chip-in" arrival="d8">결정</Arriving>, place)).toBe('<div class="chip-in">결정</div>');
  });

  it("화면 밖(자리를 주지 않은 곳)에서는 움직이지 않는다", () => {
    expect(renderToStaticMarkup(<Arriving motion="row-in">줄</Arriving>)).toBe("<div>줄</div>");
  });

  it("입력창에 붙은 인용은 칩으로 나타난다(칩 나타남)", () => {
    expect(settled(<DraftQuoteChip quote={quote} onDrop={() => {}} />)).toContain("chip-in");
    expect(firstPaint(<DraftQuoteChip quote={quote} onDrop={() => {}} />)).not.toContain("chip-in");
  });
});
