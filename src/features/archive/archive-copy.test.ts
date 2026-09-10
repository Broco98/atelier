import { describe, expect, it } from "vitest";
import {
  emptyListCopy,
  emptyScreenCopy,
  hasProjectFilter,
  narrowedNotice,
} from "./archive-copy";

describe("아카이브 빈 자리 — Atelier", () => {
  // **한 글자도 안 바뀌어야 한다.** 세계를 가르면서 기존 문구가 함께 다듬어지면, 이 판의
  // 리뷰에서 「Maison만 건드렸다」와 화면이 어긋난다. 그래서 글자 그대로 적는다.
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

describe("아카이브 빈 자리 — Maison", () => {
  it("Room 어휘로 말한다", () => {
    expect(emptyListCopy("maison")).toEqual({
      title: "아직 치운 Room이 없어요",
      body: "끝난 Room의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.",
    });
    expect(emptyScreenCopy("maison")).toEqual({
      title: "아직 치운 Room이 없어요",
      body: "끝난 Room의 ⋯ 메뉴에서 아카이빙하면 스펙과 기록이 여기 남아요.",
    });
  });

  // 낱말 하나가 세계를 새게 한다. 「작업」은 저쪽 세계의 이름이고(결정 6), 「워크트리」는
  // Room에 아예 없는 것이라(결정 17) 그 말을 읽은 사용자는 없는 것을 찾아 나선다.
  it.each([
    ["작업", "저쪽 세계의 이름"],
    ["워크트리", "Room에 없는 것"],
    ["프로젝트", "Maison에 없는 것"],
  ])("빈 자리 어디에도 「%s」가 없다", (word) => {
    for (const screen of [emptyListCopy("maison"), emptyScreenCopy("maison")]) {
      expect(screen.title).not.toContain(word);
      expect(screen.body).not.toContain(word);
    }
    expect(narrowedNotice("maison", true)).not.toContain(word);
    expect(narrowedNotice("maison", false)).not.toContain(word);
  });
});

describe("좁혀서 0개일 때", () => {
  // 프로젝트 필터는 Atelier에만 선다. 이 값이 화면의 필터 버튼과 아래 문장을 **함께** 켠다 —
  // 갈라 두면 필터는 서는데 좁혀도 아무 말 안 하는 판(또는 그 반대)이 한쪽 커밋만으로 난다.
  it("필터가 서는 세계는 Atelier뿐이다", () => {
    expect(hasProjectFilter("atelier")).toBe(true);
    expect(hasProjectFilter("maison")).toBe(false);
  });

  it("검색어가 있으면 검색 쪽 문장이다", () => {
    expect(narrowedNotice("atelier", true)).toBe("검색 결과가 없어요");
    expect(narrowedNotice("maison", true)).toBe("검색 결과가 없어요");
  });

  it("Atelier에서 검색어가 없으면 좁힌 것은 필터다", () => {
    expect(narrowedNotice("atelier", false)).toBe("해당 프로젝트의 아카이브가 없어요");
  });

  // **Maison에서는 검색어 없이 이 갈래에 닿을 수 없다.** 그래도 값을 물으면 죽은 문장이
  // 아니라 실제로 뜰 수 있는 문장이 나와야 한다 — 필터 문장을 두 세계에 그대로 둔 판이
  // 여기서 빨개진다.
  it("Maison에는 필터가 좁혔다는 말이 없다", () => {
    expect(narrowedNotice("maison", false)).toBe("검색 결과가 없어요");
    expect(narrowedNotice("maison", false)).not.toContain("필터");
  });
});
