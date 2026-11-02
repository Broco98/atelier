import { describe, expect, it } from "vitest";
import { lockedWork, startLink, startPlaceholder } from "./work-chip";

// 입력창 Work 칩 — 어디서 일할지는 주소 씨앗이 정한다(구현 스펙 「01a — 범위와 새 채팅」). 고르는 스위치는 없고 씨앗이 없으면 작업공간 없는 채팅이다.
// 첫 말 뒤에는 잠겨 보이기만 한다(03 §5 · S3).

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

describe("잠긴 Work 칩 — 첫 말 뒤(03 §5 · S3)", () => {
  it("Work에 이은 Thread는 그 Work 이름이다 — 제목을 아직 모르면 slug다", () => {
    expect(lockedWork("refund-api", "환불 API 버그 수정", false)).toEqual({
      kind: "work",
      slug: "refund-api",
      label: "환불 API 버그 수정",
    });
    expect(lockedWork("refund-api", null, false)).toEqual({ kind: "work", slug: "refund-api", label: "refund-api" });
  });

  it("Work 없는 Thread는 「작업공간 없이 대화」다", () => {
    expect(lockedWork(null, null, false)).toEqual({ kind: "no-work", label: "작업공간 없이 대화" });
  });

  it("「새 작업공간」으로 시작해 아직 Work가 서지 않았으면 「새 작업공간」이고, Work 만들기 카드를 받아들이면 그 Work 이름이 된다", () => {
    expect(lockedWork(null, null, true)).toEqual({ kind: "new-work", label: "새 작업공간" });
    expect(lockedWork("refund-api", "환불 API 버그 수정", true)).toEqual({
      kind: "work",
      slug: "refund-api",
      label: "환불 API 버그 수정",
    });
  });
});
