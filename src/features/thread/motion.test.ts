import { describe, expect, it } from "vitest";
import { arrive, type WordClock } from "./motion";

// 낱말 도착의 차례(v1 티켓 43 · Motion 보드 「단어 도착」 — 단어 사이 70ms). 흐르는 답은 조각으로 오고, 한 조각의 낱말들은 앞 낱말보다
// 사이만큼 늦게 선다. 보드의 값(사이 70 · 단어 도착 500)을 그대로 넣어 잰다.
const GAP = 70;
const CAP = 500;
const empty: WordClock = { delays: [], next: 0 };

describe("낱말 도착 차례", () => {
  it("한 번에 온 낱말들은 앞 낱말보다 사이만큼 늦게 선다", () => {
    expect(arrive(empty, 3, 1000, GAP, CAP).delays).toEqual([0, 70, 140]);
  });

  it("다음 조각의 낱말은 앞 조각의 마지막 낱말이 선 뒤 사이만큼 뒤에 선다 — 앞 낱말을 앞지르지 않는다", () => {
    const first = arrive(empty, 3, 1000, GAP, CAP); // 1000 · 1070 · 1140에 선다
    const second = arrive(first, 5, 1100, GAP, CAP);
    // 넷째는 1210(= 1140 + 70), 다섯째는 1280에 선다 — 1100에 온 조각이라 늦음은 110 · 180이다.
    expect(second.delays).toEqual([0, 70, 140, 110, 180]);
  });

  it("앞 낱말이 다 선 뒤에 온 조각은 곧바로 서기 시작한다", () => {
    const first = arrive(empty, 2, 1000, GAP, CAP);
    expect(arrive(first, 4, 5000, GAP, CAP).delays.slice(2)).toEqual([0, 70]);
  });

  it("밀린 늦음은 끝을 넘지 않는다 — 빨리 흐르면 끝에 닿은 낱말들이 함께 선다", () => {
    const delays = arrive(empty, 10, 0, GAP, CAP).delays;
    expect(delays).toEqual([0, 70, 140, 210, 280, 350, 420, 490, 500, 500]);
  });

  it("이미 센 낱말은 다시 세지 않는다 — 다시 그려도 늦음이 그대로다", () => {
    const first = arrive(empty, 3, 1000, GAP, CAP);
    expect(arrive(first, 3, 1300, GAP, CAP)).toBe(first);
    expect(arrive(first, 2, 1300, GAP, CAP)).toBe(first);
  });
});
