import { describe, expect, it } from "vitest";
import { projectsQuery } from "./hooks";

// **조회를 끄는 갈래가 없다** — 프로젝트는 늘 있는 값이다(ui-refresh 결정 22). 조회 옵션은 훅 밖에 있어(라우트가 렌더 전에
// 목록을 확보한다) 값으로 잰다 — 이 저장소의 L2에는 DOM이 없어 훅을 돌려 볼 수 없다.
describe("projectsQuery", () => {
  it("늘 켜진다", () => {
    expect(projectsQuery().enabled ?? true).toBe(true);
  });
});
