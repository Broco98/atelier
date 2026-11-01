import { describe, expect, it } from "vitest";
import { firstMention, mentionOf, recipientOf } from "./mentions";

// 멘션 · 받는 이(v1 티켓 14 · 구현 스펙 §14 · S9) — 화면이 엔진과 같은 규칙으로 받는 이를 읽는다. seam은 순수 함수들이다: 멘션
// 문법(`firstMention`), 받는 이(`recipientOf`), 보낸 말의 칠(`mentionOf`). 멘션 문법의 기대는 엔진 단위 시험(`host/thread.rs`
// `first_mention`)과 같은 예다.

/** 이 Thread에 앉은 참여자 — Project에서 온 테스터는 `api/tester`로도 부른다. */
const seated = [
  { handle: "host", from: "library" as const },
  { handle: "reviewer", from: "library" as const },
  { handle: "tester", from: { project: "api" } },
];

describe("멘션 문법은 엔진과 같다", () => {
  it("말의 첫 멘션 — 조사는 남기고 끝의 문장 부호는 뗀다", () => {
    expect(firstMention("@reviewer 봐 줘. @host는 기다려")?.name).toBe("reviewer");
    expect(firstMention("다 됐으면 (@api-server/reviewer).")?.name).toBe("api-server/reviewer");
    expect(firstMention("끝나면 @reviewer.")?.name).toBe("reviewer");
    expect(firstMention("@reviewer가 봐 줘")?.name).toBe("reviewer가");
    expect(firstMention("me@example.com으로 보내 줘")).toBeNull();
    expect(firstMention("`@media` 쿼리를 고쳐 줘")).toBeNull();
    expect(firstMention('```\n@app.route("/")\n```\n@tester 돌려 줘')?.name).toBe("tester");
    expect(firstMention("@ 혼자 선 골뱅이")).toBeNull();
    expect(firstMention("멘션 없는 말")).toBeNull();
  });
});

describe("받는 이", () => {
  it("멘션이 없으면 Host다(null)", () => {
    expect(recipientOf("그냥 말", seated)).toBeNull();
  });

  it("멘션 이름의 가장 긴 앞부분 가운데 앉은 이름이다 — 조사가 붙어도 고른다", () => {
    // 입력칸이 칩으로 칠할 자리는 `@`부터 고른 이름 끝까지다 — 조사는 칠하지 않는다.
    expect(recipientOf("@reviewer가 봐 줘", seated)).toMatchObject({
      mention: "reviewer가",
      agent: { handle: "reviewer" },
      at: { start: 0, end: 9 },
    });
    expect(recipientOf("끝나면 @reviewer.", seated)).toMatchObject({ agent: { handle: "reviewer" }, at: { start: 4, end: 13 } });
    expect(recipientOf("@api/tester 돌려", seated)).toMatchObject({ agent: { handle: "tester" } });
    expect(recipientOf("@tester 돌려", seated)).toMatchObject({ agent: { handle: "tester" } });
  });

  it("앉은 이름이 없으면 멘션 그대로다", () => {
    expect(recipientOf("@nobody 봐", seated)).toEqual({ mention: "nobody", agent: null, at: { start: 0, end: 7 } });
  });
});

describe("보낸 말의 멘션", () => {
  it("말풍선이 칠할 자리는 첫 멘션의 `@`부터 그 턴에 답한 이의 이름 끝까지다 — 조사 · Project 이름도 가른다", () => {
    expect(mentionOf("@reviewer가 봐 줘", "reviewer")).toEqual({ start: 0, end: 9 });
    expect(mentionOf("끝나면 @api/tester 돌려", "tester")).toEqual({ start: 4, end: 15 });
    // 받는 이가 아닌 이름(엔진이 Host에게 보냈다)은 칠하지 않는다.
    expect(mentionOf("@hostname 봐 줘", "host")).toEqual({ start: 0, end: 5 });
    expect(mentionOf("@nobody 봐", "host")).toBeNull();
    expect(mentionOf("그냥 말", "host")).toBeNull();
  });
});
