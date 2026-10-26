import { describe, expect, it } from "vitest";
import { addProject, projectAddStore } from "./add-store";
import type { ProjectView } from "./types";

const notes = { slug: "notes", name: "notes" } as ProjectView;

// 추가 창은 여는 길이 몇이든 하나다(03 구현 스펙 §16) — 부르는 쪽은 추가한 Project를 답으로 받는다(Space 상세가 그 Space에 넣는다).
describe("addProject", () => {
  it("창을 그 폴더로 열고, 추가하면 그 Project로 끝난다", async () => {
    const asked = addProject("~/Documents/notes");
    expect(projectAddStore.state?.folder).toBe("~/Documents/notes");
    projectAddStore.state?.done(notes);
    expect(await asked).toBe(notes);
    expect(projectAddStore.state).toBeNull();
  });

  it("닫으면 null이다", async () => {
    const asked = addProject();
    projectAddStore.state?.done(null);
    expect(await asked).toBeNull();
  });

  it("떠 있는 창에 폴더가 오면 같은 창이 그 폴더로 서고, 앞서 기다리던 쪽도 같은 답을 받는다", async () => {
    const first = addProject();
    const before = projectAddStore.state?.seq ?? 0;
    const dropped = addProject("~/Code/web");
    expect(projectAddStore.state?.folder).toBe("~/Code/web");
    expect(projectAddStore.state?.seq).toBeGreaterThan(before);
    projectAddStore.state?.done(notes);
    expect(await first).toBe(notes);
    expect(await dropped).toBe(notes);
  });
});
