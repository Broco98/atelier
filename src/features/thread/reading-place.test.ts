import { describe, expect, it } from "vitest";
import { atBottom, followStep, leavingPlace, stuckAfter } from "./reading-place";

// restart 02a-6 — 숨은 채팅 탭은 내려가고 굴림 자리는 탭이 쥔다. 바닥을 따라가던 탭은 바닥을, 위로 올려 읽던 탭은 위에서 잰 거리를 쥔다.
describe("읽던 자리", () => {
  // 내용 1000 · 보이는 높이 400이면 바닥은 600이다. 남은 거리가 24까지면 바닥이다(Motion 보드 — 24에서 끊기고 붙는다).
  it("남은 거리가 24까지면 바닥이다", () => {
    expect(atBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(atBottom({ scrollTop: 576, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(atBottom({ scrollTop: 575, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  it("내용이 상자보다 짧으면 바닥이다", () => {
    expect(atBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true);
  });

  it("바닥을 따라가던 탭은 바닥을, 위로 올려 읽던 탭은 그 거리를 쥔다", () => {
    expect(leavingPlace(true, 600)).toEqual({ kind: "bottom" });
    expect(leavingPlace(false, 480)).toEqual({ kind: "at", top: 480 });
  });
});

// restart 02b-7 — 바닥 따라가기(Motion 보드 「바닥 따라가기」 · 구현 스펙 「02b — 대화창」). 프레임마다 남은 거리의 18%씩, 최소 1px 내려간다.
// 동작 줄이기면 그 프레임에 바닥으로 바로 간다. 남은 거리가 반 px 아래면 바닥에 닿은 것이다.
describe("바닥 따라가기 한 걸음", () => {
  // 내용 2000 · 보이는 높이 400 — 바닥은 1600이다.
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 2000, clientHeight: 400 });

  it("남은 거리의 18%만큼 내려간다", () => {
    expect(followStep(box(600), false)).toBe(780);
    expect(followStep(box(1500), false)).toBe(1518);
  });

  it("남은 거리가 짧아도 1px은 내려간다", () => {
    expect(followStep(box(1596), false)).toBe(1597);
  });

  // WebKit은 굴림 거리의 소수를 버린다(125.8 → 125) — 그대로 건네면 걸음마다 18%보다 덜 가고 끝 10px은 1px씩 간다.
  it("다음 자리는 정수 px로 반올림한다", () => {
    expect(followStep(box(899), false)).toBe(1025);
    expect(followStep(box(1590), false)).toBe(1592);
  });

  it("바닥을 지나 내려가지 않는다", () => {
    expect(followStep(box(1599.3), false)).toBe(1600);
  });

  it("바닥에 닿았으면 걸음이 없다", () => {
    expect(followStep(box(1600), false)).toBeNull();
    expect(followStep(box(1599.6), false)).toBeNull();
    expect(followStep({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 }, false)).toBeNull();
  });

  it("동작 줄이기면 그 프레임에 바닥으로 간다", () => {
    expect(followStep(box(600), true)).toBe(1600);
  });

  it("1000 남은 거리는 몇십 프레임 안에 바닥에 닿는다", () => {
    let top = 600;
    let frames = 0;
    for (let next = followStep(box(top), false); next !== null; next = followStep(box(top), false)) {
      top = next;
      frames += 1;
    }
    expect(top).toBe(1600);
    // 0.82^n × 1000이 5.5 아래로 줄고(26걸음) 1px씩 다섯 남짓을 더 간다.
    expect(frames).toBeGreaterThan(25);
    expect(frames).toBeLessThan(40);
  });
});

// 위로 굴려 바닥에서 24px 넘게 멀어지면 끊기고, 바닥 24px 안으로 돌아오면 다시 붙는다(Motion 보드). 따라가는 동안 글이 늘어 바닥이 잠깐
// 24 넘게 멀어져도 끊기지 않는다 — 끊는 것은 사람이 위로 굴린 것뿐이다.
describe("바닥에 붙어 있나", () => {
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 2000, clientHeight: 400 });

  it("위로 굴려 24 넘게 멀어지면 끊긴다", () => {
    expect(stuckAfter(true, 1600, box(1500))).toBe(false);
  });

  it("위로 굴려도 바닥 24 안이면 붙어 있다", () => {
    expect(stuckAfter(true, 1600, box(1580))).toBe(true);
  });

  it("따라가는 동안 글이 늘어 멀어진 것은 끊지 않는다", () => {
    // 따라가기가 1200까지 내렸는데 그사이 글이 늘어 바닥이 400 남았다 — 위로 굴린 것이 아니다.
    expect(stuckAfter(true, 1100, box(1200))).toBe(true);
    // 1px 아래의 흔들림(반올림)도 위로 굴린 것이 아니다.
    expect(stuckAfter(true, 1200.6, box(1200))).toBe(true);
  });

  it("끊긴 뒤에는 바닥 24 안으로 돌아와야 붙는다", () => {
    expect(stuckAfter(false, 1000, box(1400))).toBe(false);
    expect(stuckAfter(false, 1400, box(1576))).toBe(true);
  });

  it("글이 줄어 바닥에 닿으면 붙는다", () => {
    expect(stuckAfter(false, 900, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });
});
