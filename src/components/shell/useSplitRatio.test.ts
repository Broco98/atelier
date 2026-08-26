import { describe, expect, it } from "vitest";
import { nextRatio, SPLIT_MIN } from "./useSplitRatio";

// 드래그 한 번의 비율. 훅 밖에 있는 이유는 `nextWidth`와 같다 — 부호가 뒤집혀도 화면은
// 멀쩡히 그려져서, 포인터를 흉내내지 않고 방향을 검사할 자리가 여기뿐이다.

const drag = (dx: number, from = 0.5, hostWidth = 1000) =>
  nextRatio({ startRatio: from, startX: 100, clientX: 100 + dx, hostWidth, min: SPLIT_MIN });

describe("경계를 끄는 방향", () => {
  it("오른쪽으로 끌면 왼쪽 열이 커진다", () => {
    expect(drag(100)).toBeCloseTo(0.6);
  });

  it("왼쪽으로 끌면 작아진다", () => {
    expect(drag(-100)).toBeCloseTo(0.4);
  });

  it("안 움직이면 그대로다", () => {
    expect(drag(0, 0.42)).toBe(0.42);
  });

  // 이동은 **상자 폭에 대한 몫**이다 — 같은 픽셀을 끌어도 창이 넓으면 덜 움직인다.
  it("같은 이동도 상자가 넓으면 덜 움직인다", () => {
    expect(drag(100, 0.5, 2000)).toBeCloseTo(0.55);
  });
});

describe("한 열이 사라지지 않게 막는다", () => {
  // 결정 88이 걱정한 것이 이 값이다 — 터미널이 너무 좁으면 `claude` TUI가 깨진다.
  it("양쪽 모두 하한을 지킨다", () => {
    expect(drag(-9999)).toBe(SPLIT_MIN);
    expect(drag(9999)).toBe(1 - SPLIT_MIN);
  });
});

// 상자를 아직 못 읽은 순간이 실재한다(첫 그림 전). 0으로 나누면 비율이 무한이 되고,
// 그 값이 그대로 CSS 폭으로 나간다.
describe("상자 폭을 못 읽었을 때", () => {
  it("움직이지 않는다", () => {
    expect(nextRatio({ startRatio: 0.4, startX: 0, clientX: 300, hostWidth: 0, min: SPLIT_MIN }))
      .toBe(0.4);
  });
});
