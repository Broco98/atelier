import { describe, expect, it } from "vitest";
import { archivedDay } from "./archive-days";

// 치운 날의 하루 — 목록의 「보관한 날」 칸 · 차례와 상세의 위 카드가 읽는다(restart 03-4). 글로 바꾸는 것은 `placeDate` · `placeDay`의 몫이다.

describe("치운 날의 하루(archivedDay)", () => {
  it("코어가 적는 지역 날짜(YYYY-MM-DD)는 그대로다", () => {
    expect(archivedDay("2026-08-10")).toBe("2026-08-10");
  });

  it("뒤에 시각이 붙은 값도 앞의 날짜로 읽는다", () => {
    expect(archivedDay("2026-08-10T23:59:00+09:00")).toBe("2026-08-10");
    expect(archivedDay("2026-08-10 09:00")).toBe("2026-08-10");
  });

  it("날짜가 없거나 날짜로 읽히지 않으면 null이다 — 없는 날을 지어내지 않는다", () => {
    expect(archivedDay(null)).toBeNull();
    expect(archivedDay("")).toBeNull();
    expect(archivedDay("2026-8-1")).toBeNull();
    expect(archivedDay("8월 10일")).toBeNull();
    expect(archivedDay("어제")).toBeNull();
  });
});
