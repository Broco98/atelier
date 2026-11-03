import { describe, expect, it } from "vitest";
import { FIRST_SORT, nextSort, placeDate, placeDay, placeWhen, sortPlaces, type PlaceSort } from "./place-list";

// 공용 목록 틀의 갈래(restart 03-1 · 보드 PlaceSheet 「규격」 · 「움직임과 조작」 · Places) — 줄의 차례, 열 머리를 누른 뒤의 정렬, 시각 칸의 글.
// Projects · Services · Archive가 함께 쓴다. 기대 글은 보드의 글자 그대로다(「12분」 · 「3일」 · 「2주」 · 「4주」).

describe("정렬", () => {
  it("처음은 최근 활동이 새것부터다", () => {
    expect(FIRST_SORT).toEqual({ key: "when", dir: "desc" });
  });

  it("같은 칸을 다시 누르면 방향이 뒤집히고, 다른 칸을 누르면 이름은 가나다순 · 시각은 새것부터로 선다", () => {
    expect(nextSort(FIRST_SORT, "when")).toEqual({ key: "when", dir: "asc" });
    expect(nextSort({ key: "when", dir: "asc" }, "when")).toEqual({ key: "when", dir: "desc" });
    expect(nextSort(FIRST_SORT, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "when")).toEqual({ key: "when", dir: "desc" });
  });

  const rows = [
    { name: "front", when: "2026-10-30T09:00:00.000+09:00" },
    { name: "atelier", when: "2026-11-03T08:48:00.000+09:00" },
    { name: "옛 관리자", when: null },
    { name: "backend", when: "2026-10-31T12:00:00.000+09:00" },
    { name: "hub-docs", when: null },
  ];
  const order = (sort: PlaceSort) => sortPlaces(rows, sort, (row) => row.name, (row) => row.when).map((row) => row.name);

  it("시각 순이면 활동이 없는 줄은 어느 방향이든 끝에 이름 순으로 선다", () => {
    expect(order(FIRST_SORT)).toEqual(["atelier", "backend", "front", "옛 관리자", "hub-docs"]);
    expect(order({ key: "when", dir: "asc" })).toEqual(["front", "backend", "atelier", "옛 관리자", "hub-docs"]);
  });

  // 한국어 차례(보드 `localeCompare(…, 'ko')`) — 한글이 영문보다 앞이다.
  it("이름 순은 한국어 차례다", () => {
    expect(order({ key: "name", dir: "asc" })).toEqual(["옛 관리자", "atelier", "backend", "front", "hub-docs"]);
    expect(order({ key: "name", dir: "desc" })).toEqual(["hub-docs", "front", "backend", "atelier", "옛 관리자"]);
  });

  it("받은 목록을 고치지 않는다", () => {
    const before = rows.map((row) => row.name);
    order({ key: "name", dir: "desc" });
    expect(rows.map((row) => row.name)).toEqual(before);
  });
});

// 시각대는 검사가 도는 곳의 것이라 지금과 그때를 같은 시각대의 `Date`로 짓는다.
describe("최근 활동 칸의 글", () => {
  const now = new Date(2026, 10, 3, 9, 0, 0).getTime();
  const at = (date: Date) => date.toISOString();

  it("한 시간 안은 분, 하루 안은 시간이다", () => {
    expect(placeWhen(at(new Date(2026, 10, 3, 8, 59, 30)), now)).toBe("방금");
    expect(placeWhen(at(new Date(2026, 10, 3, 8, 48, 0)), now)).toBe("12분");
    expect(placeWhen(at(new Date(2026, 10, 3, 7, 30, 0)), now)).toBe("1시간");
    expect(placeWhen(at(new Date(2026, 10, 2, 9, 30, 0)), now)).toBe("23시간");
  });

  // 하루 넘고 이틀 안은 「어제」다(보드 Places 상세 줄 「3시간」 다음의 「어제」 — restart 03-12b). 한때 「1일」이었다.
  it("하루가 넘으면 어제, 이틀부터 일, 일주일이 넘으면 주, 다섯 주부터는 날짜다", () => {
    expect(placeWhen(at(new Date(2026, 10, 2, 9, 0, 0)), now)).toBe("어제");
    expect(placeWhen(at(new Date(2026, 10, 1, 9, 30, 0)), now)).toBe("어제");
    expect(placeWhen(at(new Date(2026, 10, 1, 9, 0, 0)), now)).toBe("2일");
    expect(placeWhen(at(new Date(2026, 9, 31, 8, 0, 0)), now)).toBe("3일");
    expect(placeWhen(at(new Date(2026, 9, 27, 9, 0, 0)), now)).toBe("1주");
    expect(placeWhen(at(new Date(2026, 9, 20, 9, 0, 0)), now)).toBe("2주");
    expect(placeWhen(at(new Date(2026, 9, 5, 9, 0, 0)), now)).toBe("4주");
    expect(placeWhen(at(new Date(2026, 8, 29, 9, 0, 0)), now)).toBe("9월 29일");
    expect(placeWhen(at(new Date(2025, 11, 30, 9, 0, 0)), now)).toBe("2025년 12월 30일");
  });

  it("활동이 없거나 읽지 못한 시각은 「—」다", () => {
    expect(placeWhen(null, now)).toBe("—");
    expect(placeWhen("아무 글", now)).toBe("—");
  });

  it("앞으로의 시각(시계가 어긋난 기록)은 방금이다", () => {
    expect(placeWhen(at(new Date(2026, 10, 3, 9, 5, 0)), now)).toBe("방금");
  });
});

describe("상세 위 카드의 날짜", () => {
  it("저장된 날(`YYYY-MM-DD`)을 해까지 적은 날로 말한다(보드 「2026년 3월 2일」)", () => {
    expect(placeDay("2026-03-02")).toBe("2026년 3월 2일");
    expect(placeDay("2025-12-31")).toBe("2025년 12월 31일");
  });

  it("읽지 못한 날은 「—」다", () => {
    expect(placeDay("")).toBe("—");
    expect(placeDay("어제")).toBe("—");
  });
});

// Archive의 시각 칸은 「보관한 날」이다(restart 03-4 · 보드 Places Archive 「10월 28일」 · 「9월 30일」 · 「—」) — 거리가 아니라 그날이다.
describe("보관한 날 칸의 글", () => {
  const now = new Date(2026, 10, 3, 9, 0, 0).getTime();

  it("올해의 날은 「M월 D일」이다 — 오늘 · 어제도 거리로 말하지 않는다", () => {
    expect(placeDate("2026-10-28", now)).toBe("10월 28일");
    expect(placeDate("2026-11-03", now)).toBe("11월 3일");
    expect(placeDate("2026-01-05", now)).toBe("1월 5일");
  });

  it("지난해의 날은 해까지 적는다", () => {
    expect(placeDate("2025-12-31", now)).toBe("2025년 12월 31일");
  });

  it("날이 없거나 읽지 못하면 「—」다", () => {
    expect(placeDate(null, now)).toBe("—");
    expect(placeDate("어제", now)).toBe("—");
  });
});
