import { describe, expect, it } from "vitest";
import { since } from "./since";

// 사이드바 Thread 줄의 시각(캔버스 Screen-Home 보드) — 지금 시각을 받아 거리를 말하는 순수 함수다. 시각대는 검사가 도는 곳의 것이라
// 자정을 가르는 경우는 같은 시각대의 `Date`로 짓는다.
describe("Thread 줄의 시각", () => {
  const now = new Date(2026, 9, 23, 15, 0, 0).getTime();
  const at = (date: Date) => date.toISOString();

  it("한 시간 안은 분, 하루 안은 시간이다", () => {
    expect(since(at(new Date(2026, 9, 23, 14, 59, 30)), now)).toBe("방금");
    expect(since(at(new Date(2026, 9, 23, 14, 58, 0)), now)).toBe("2분");
    expect(since(at(new Date(2026, 9, 23, 13, 30, 0)), now)).toBe("1시간");
    expect(since(at(new Date(2026, 9, 22, 16, 0, 0)), now)).toBe("23시간");
  });

  it("하루가 넘으면 어제 · 이번 주 요일 · 월일이다", () => {
    expect(since(at(new Date(2026, 9, 22, 9, 0, 0)), now)).toBe("어제");
    expect(since(at(new Date(2026, 9, 19, 9, 0, 0)), now)).toBe("월");
    expect(since(at(new Date(2026, 9, 3, 9, 0, 0)), now)).toBe("10월 3일");
  });

  it("읽지 못한 시각은 비운다", () => {
    expect(since("아무 글", now)).toBe("");
  });
});
