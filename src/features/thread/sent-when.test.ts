import { describe, expect, it } from "vitest";
import { sentWhen } from "./sent-when";

// 내 말의 말 머리 시각(restart 02b-6 · Cards 보드 「내 말 — 호버」의 「오후 2:14」). 오늘 보낸 말은 시각만, 어제는 「어제」를, 그 앞은 월일을 앞에
// 붙인다 — 다시 연 채팅의 지난 말이 오늘의 시각으로 읽히지 않게.

const now = new Date(2026, 9, 23, 16, 30).getTime();
const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();

describe("보낸 말의 시각", () => {
  it("오늘 보낸 말은 시각만이다", () => {
    expect(sentWhen(at(2026, 9, 23, 14, 14), now)).toBe("오후 2:14");
    expect(sentWhen(at(2026, 9, 23, 9, 5), now)).toBe("오전 9:05");
  });

  it("어제 보낸 말은 「어제」를 붙인다", () => {
    expect(sentWhen(at(2026, 9, 22, 18, 12), now)).toBe("어제 오후 6:12");
  });

  it("그 앞은 월일을 붙인다", () => {
    expect(sentWhen(at(2026, 9, 20, 14, 14), now)).toBe("10월 20일 오후 2:14");
  });

  it("읽지 못하는 시각은 빈 글이다", () => {
    expect(sentWhen("어제쯤", now)).toBe("");
  });
});
