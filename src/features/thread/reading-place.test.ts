import { describe, expect, it } from "vitest";
import { atBottom, leavingPlace } from "./reading-place";

// restart 02a-6 — 숨은 채팅 탭은 내려가고 굴림 자리는 탭이 쥔다. 바닥을 따라가던 탭은 바닥을, 위로 올려 읽던 탭은 위에서 잰 거리를 쥔다.
describe("읽던 자리", () => {
  // 내용 1000 · 보이는 높이 400이면 바닥은 600이다. 남은 거리가 24 아래면 바닥이다(Motion 보드 — 24에서 끊기고 붙는다).
  it("남은 거리가 24 아래면 바닥이다", () => {
    expect(atBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(atBottom({ scrollTop: 577, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(atBottom({ scrollTop: 576, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  it("내용이 상자보다 짧으면 바닥이다", () => {
    expect(atBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true);
  });

  it("바닥을 따라가던 탭은 바닥을, 위로 올려 읽던 탭은 그 거리를 쥔다", () => {
    expect(leavingPlace(true, 600)).toEqual({ kind: "bottom" });
    expect(leavingPlace(false, 480)).toEqual({ kind: "at", top: 480 });
  });
});
