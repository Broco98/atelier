import { describe, expect, it } from "vitest";
import { archivedDay, archivedDayText, dayHeading } from "./archive-days";

// 아카이브 목록의 날짜 소제목과 행의 치운 날(codex-ds 스펙 S11). 화면(L3 `archive-docs.spec.ts`)은 한 「오늘」(수요일 2026-08-12)에서
// 소제목이 서고 차례가 뒤집히는 것만 본다 — 주의 경계(월요일부터 · 일요일인 오늘 · 해를 걸친 주)와 읽히지 않는 값은 여기서 잰다.
// 「오늘」은 지역 달력으로 세운다(`new Date(y, m, d, h)`) — 함수가 지역 날짜로 읽으므로 기계의 시간대와 상관없이 같은 답이다.

/** 그날 정오(지역) — 「오늘」이 그날의 어느 때여도 주의 경계는 같아야 한다(아래 「밤」 검사). */
const 그날 = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

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

describe("치운 날의 글자(archivedDayText)", () => {
  it("작업이 만들어진 날과 같은 꼴이다 — 시각이 붙어도 날만 읽는다", () => {
    expect(archivedDayText("2026-08-10")).toBe("8월 10일");
    expect(archivedDayText("2026-12-03T08:00:00Z")).toBe("12월 3일");
  });

  it("날이 없으면 null이다 — 행의 둘째 줄에는 상태만 선다", () => {
    expect(archivedDayText(null)).toBeNull();
    expect(archivedDayText("없음")).toBeNull();
  });
});

describe("날짜 소제목(dayHeading)", () => {
  // 수요일 2026-08-12 — 이번 주는 월요일 8-10부터다.
  const 수요일 = 그날(2026, 8, 12);

  it("오늘이 든 주(월요일부터)의 날은 「이번 주」다", () => {
    expect(dayHeading("2026-08-10", 수요일)).toBe("이번 주");
    expect(dayHeading("2026-08-12", 수요일)).toBe("이번 주");
  });

  it("월요일 앞의 일요일은 같은 달이어도 달 이름이다", () => {
    expect(dayHeading("2026-08-09", 수요일)).toBe("8월");
    expect(dayHeading("2026-08-01", 수요일)).toBe("8월");
  });

  it("올해의 그 밖은 달 이름이고, 지난해부터는 해와 달이다", () => {
    expect(dayHeading("2026-07-30", 수요일)).toBe("7월");
    expect(dayHeading("2026-01-01", 수요일)).toBe("1월");
    expect(dayHeading("2025-12-31", 수요일)).toBe("2025년 12월");
    expect(dayHeading("2019-03-04", 수요일)).toBe("2019년 3월");
  });

  it("앞날(시계가 어긋난 기계에서 적힌 날)도 「이번 주」에 든다", () => {
    expect(dayHeading("2026-08-20", 수요일)).toBe("이번 주");
    expect(dayHeading("2027-02-01", 수요일)).toBe("이번 주");
  });

  it("날이 없으면 「날짜 없음」이다", () => {
    expect(dayHeading(null, 수요일)).toBe("날짜 없음");
    expect(dayHeading(archivedDay("어제"), 수요일)).toBe("날짜 없음");
  });

  // 주의 첫날이 월요일이라 일요일인 오늘은 그 주의 **끝**이다 — `getDay()`가 일요일을 0으로 세어, 그대로 빼면 이번 주가 오늘 하루로 줄고
  // 엿새 앞의 월요일이 지난주로 빠진다.
  it("일요일인 오늘은 그 주의 끝이다 — 이번 주는 엿새 앞의 월요일부터다", () => {
    const 일요일 = 그날(2026, 8, 16);
    expect(dayHeading("2026-08-10", 일요일)).toBe("이번 주");
    expect(dayHeading("2026-08-16", 일요일)).toBe("이번 주");
    expect(dayHeading("2026-08-09", 일요일)).toBe("8월");
  });

  it("월요일인 오늘은 그 주의 처음이다 — 어제(일요일)는 지난주다", () => {
    const 월요일 = 그날(2026, 8, 10);
    expect(dayHeading("2026-08-10", 월요일)).toBe("이번 주");
    expect(dayHeading("2026-08-09", 월요일)).toBe("8월");
  });

  it("해를 걸친 주에서는 지난해의 날도 「이번 주」다 — 그 밖의 지난해는 해와 달이다", () => {
    // 목요일 2026-01-01 — 이번 주는 월요일 2025-12-29부터다.
    const 새해 = 그날(2026, 1, 1);
    expect(dayHeading("2025-12-29", 새해)).toBe("이번 주");
    expect(dayHeading("2025-12-31", 새해)).toBe("이번 주");
    expect(dayHeading("2025-12-28", 새해)).toBe("2025년 12월");
  });

  it("오늘의 어느 때여도 경계는 같다 — 자정 직전의 오늘에도 월요일 0시가 이번 주의 처음이다", () => {
    const 밤 = 그날(2026, 8, 12, 23);
    expect(dayHeading("2026-08-10", 밤)).toBe("이번 주");
    expect(dayHeading("2026-08-09", 밤)).toBe("8월");
    const 새벽 = 그날(2026, 8, 10, 0);
    expect(dayHeading("2026-08-10", 새벽)).toBe("이번 주");
  });
});
