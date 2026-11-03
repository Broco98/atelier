import { describe, expect, it } from "vitest";
import { startLink, startPlaceholder } from "./work-chip";

// 새 채팅이 시작할 곳 — 어디서 일할지는 주소 씨앗이 정한다(구현 스펙 「01a — 범위와 새 채팅」). 고르는 스위치는 없고 씨앗이 없으면 작업공간 없는
// 채팅이다. 첫 말 뒤 입력창에는 Work 칩이 없다(restart 02b-2 · 시안 Thread 보드).

describe("새 채팅이 시작할 곳", () => {
  it("씨앗이 없으면 작업공간 없는 채팅이다", () => {
    expect(startLink(null)).toEqual({ kind: "no-work" });
  });

  it("씨앗이 있으면 그것이다", () => {
    expect(startLink({ kind: "new-work" })).toEqual({ kind: "new-work" });
    expect(startLink({ kind: "no-work" })).toEqual({ kind: "no-work" });
    expect(startLink({ kind: "work", slug: "refund-api" })).toEqual({ kind: "work", slug: "refund-api" });
  });

  it("입력창 안내가 시작할 곳을 따른다", () => {
    expect(startPlaceholder({ kind: "no-work" }, null)).toBe("무엇이든 요청하세요");
    expect(startPlaceholder({ kind: "new-work" }, null)).toBe("만들 기능이나 고칠 문제를 적어 주세요");
    expect(startPlaceholder({ kind: "work", slug: "refund-api" }, "환불 API 버그 수정")).toBe("환불 API 버그 수정에서 무엇을 할까요?");
  });

  it("제목을 아직 모르는 Work는 slug로 선다", () => {
    expect(startPlaceholder({ kind: "work", slug: "refund-api" }, null)).toBe("refund-api에서 무엇을 할까요?");
  });
});
