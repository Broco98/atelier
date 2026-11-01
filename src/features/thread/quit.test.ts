import { describe, expect, it } from "vitest";
import { threadQuitNotice } from "./quit";

// 종료 확인 창의 채팅 줄 — 잃을 것을 세는 말에 Agent가 없다(스토리 2).
describe("종료 확인의 채팅 줄", () => {
  it("도는 턴 · 대기 중인 말 · 답하지 않은 승인을 센다", () => {
    expect(threadQuitNotice({ running: 2, queued: 3, approvals: 1 })).toBe("도는 턴 2 · 대기 중인 말 3 · 답하지 않은 승인 1");
  });

  it("셋 다 0이면 적지 않는다", () => {
    expect(threadQuitNotice({ running: 0, queued: 0, approvals: 0 })).toBeUndefined();
  });
});
