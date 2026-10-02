import { describe, expect, it } from "vitest";
import { ARCHIVE_COPY, narrowedNotice } from "./archive-copy";

describe("아카이브 빈 자리", () => {
  // **한 글자도 안 바뀌어야 한다.** 그래서 글자 그대로 적는다.
  it("문구가 그대로다", () => {
    expect(ARCHIVE_COPY.emptyList).toEqual({
      title: "아직 치운 작업이 없어요",
      body: "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.",
    });
    expect(ARCHIVE_COPY.emptyScreen).toEqual({
      title: "아직 치운 작업이 없어요",
      body: "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 워크트리는 정리되고 스펙과 기록이 여기 남아요.",
    });
  });
});

describe("좁혀서 0개일 때", () => {
  it("검색어가 있으면 검색 쪽 문장이다", () => {
    expect(narrowedNotice(true)).toBe("검색 결과가 없어요");
  });

  it("검색어가 없으면 좁힌 것은 필터다", () => {
    expect(narrowedNotice(false)).toBe("해당 프로젝트의 아카이브가 없어요");
  });
});
