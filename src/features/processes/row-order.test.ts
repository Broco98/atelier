import { describe, expect, it } from "vitest";
import { holdOrder } from "./row-order";

// restart 03-10 — **포인터가 표 위에 있는 동안 줄 순서가 멈춘다**(스토리 135 · 시안 ProcessSheet 「보기와 움직임」). 표본 값으로 서는 줄
// (다른 앱 — CPU 순)은 박자마다 자리를 바꾼다. 누르려는 줄이 도망가면 엉뚱한 것을 끝낸다. 멈춘 동안은 멈춘 순간의 차례를 지킨다.

describe("줄 순서 멈춤", () => {
  // 멈추지 않았으면 이 표본의 차례 그대로다.
  it("멈추지 않았으면 이 표본의 차례다", () => {
    expect(holdOrder(null, ["b", "a", "c"])).toEqual({ order: ["b", "a", "c"], held: false });
  });

  // 멈춘 동안 값이 바뀌어 이 표본의 차례가 달라져도 멈춘 차례로 선다. 「멈췄다」는 그 차례가 이 표본의 차례와 다를 때다 — 화면이 「줄 순서를
  // 잠시 멈췄어요」를 그때 말한다.
  it("멈춘 동안 이 표본의 차례가 달라져도 멈춘 차례로 선다", () => {
    expect(holdOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual({ order: ["a", "b", "c"], held: true });
    expect(holdOrder(["a", "b", "c"], ["a", "b", "c"])).toEqual({ order: ["a", "b", "c"], held: false });
  });

  // 멈춘 동안 새로 선 줄은 끝에 붙는다 — 이미 선 줄을 밀지 않는다. 빠진 줄은 빠진다(그 프로세스가 없다).
  it("새 줄은 끝에 붙고 빠진 줄은 빠진다", () => {
    expect(holdOrder(["a", "b", "c"], ["d", "c", "a", "e"])).toEqual({ order: ["a", "c", "d", "e"], held: true });
  });
});
