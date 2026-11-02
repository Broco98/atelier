import { describe, expect, it } from "vitest";
import { seedOf, startSearch, validateNewThreadSearch } from "./-new-thread-search";

// 목록 줄의 「작업공간 만들기」 · 「새 채팅」(restart 03-1 · 스토리 8 · 13 · 01a-13 · 01a-14의 씨앗) — 그 범위가 골라진 새 채팅의 주소다. 「작업공간
// 만들기」는 「새 작업공간」 칩과 함께, 「새 채팅」은 작업공간 없이 연다. 주소를 검증기에 다시 넣어도 같은 씨앗이다(라우트가 그대로 받는다).
describe("범위를 고른 새 채팅의 주소", () => {
  it("Project 줄의 작업공간 만들기는 「새 작업공간」 칩과 그 Project 범위로 연다", () => {
    const search = startSearch("work", { project: "web-app" });
    expect(seedOf(validateNewThreadSearch({ ...search }))).toEqual({
      link: { kind: "new-work" },
      say: null,
      service: null,
      project: "web-app",
    });
  });

  it("Project 줄의 새 채팅은 작업공간 없이 그 Project 범위로 연다", () => {
    expect(seedOf(validateNewThreadSearch({ ...startSearch("thread", { project: "web-app" }) }))).toEqual({
      link: { kind: "no-work" },
      say: null,
      service: null,
      project: "web-app",
    });
  });

  it("Service 범위도 같은 길이다", () => {
    expect(seedOf(startSearch("thread", { service: "payments" }))).toMatchObject({ service: "payments", project: null });
  });
});
