import { describe, expect, it } from "vitest";
import {
  emptyListCopy,
  emptyScreenCopy,
  hasProjectFilter,
  narrowedNotice,
} from "./archive-copy";

describe("아카이브 빈 자리 — Atelier", () => {
  // **한 글자도 안 바뀌어야 한다.** 그래서 글자 그대로 적는다.
  it("문구가 그대로다", () => {
    expect(emptyListCopy("atelier")).toEqual({
      title: "아직 치운 작업이 없어요",
      body: "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.",
    });
    expect(emptyScreenCopy("atelier")).toEqual({
      title: "아직 치운 작업이 없어요",
      body: "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 워크트리는 정리되고 스펙과 기록이 여기 남아요.",
    });
  });
});

describe("좁혀서 0개일 때", () => {
  // 이 값이 화면의 필터 버튼과 아래 문장을 **함께** 켠다 — 갈라 두면 필터는 서는데 좁혀도
  // 아무 말 안 하는 판(또는 그 반대)이 한쪽 커밋만으로 난다.
  it("프로젝트 필터가 선다", () => {
    expect(hasProjectFilter("atelier")).toBe(true);
  });

  it("검색어가 있으면 검색 쪽 문장이다", () => {
    expect(narrowedNotice("atelier", true)).toBe("검색 결과가 없어요");
  });

  it("Atelier에서 검색어가 없으면 좁힌 것은 필터다", () => {
    expect(narrowedNotice("atelier", false)).toBe("해당 프로젝트의 아카이브가 없어요");
  });
});
