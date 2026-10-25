import { describe, expect, it } from "vitest";
import type { ProjectView } from "@/features/projects/types";
import { addMenu, createdLine, spaceGraph } from "./space-view";
import type { SharedSpace, Space } from "./types";

const space = (over: Partial<Space> = {}): Space => ({
  slug: "결제-서비스",
  name: "결제 서비스",
  projects: ["web-app", "api-server"],
  createdAt: "2026-10-24",
  createdBy: null,
  description: "",
  problems: [],
  ...over,
});

const shared = (slug: string, name: string, overlap: string[], projects: string[]): SharedSpace => ({
  slug,
  name,
  overlap,
  projects,
});

/** 노드를 (종류, 이름, x, y)로 — 자리는 시안 F1-SpaceDetail의 배치(열 x 82 · 262 · 442 · 628, 가운데 y 104, 줄 사이 50)다. */
const placed = (graph: ReturnType<typeof spaceGraph>) => graph.nodes.map((node) => [node.kind, node.name, node.x, node.y]);

describe("관계 그래프", () => {
  it("Space가 가운데, Project가 둘레, 같은 Project를 쓰는 다른 Space가 점선으로 그 Project 곁에 선다", () => {
    const graph = spaceGraph(space(), [shared("사내-도구", "사내 도구", ["api-server"], ["api-server", "backoffice"])]);
    expect(placed(graph)).toEqual([
      ["space", "결제 서비스", 82, 104],
      ["project", "web-app", 262, 79],
      ["project", "api-server", 262, 129],
      ["other", "사내 도구", 442, 129],
      ["extra", "backoffice", 628, 129],
    ]);
    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.muted])).toEqual([
      ["s:결제-서비스", "p:web-app", false],
      ["s:결제-서비스", "p:api-server", false],
      ["p:api-server", "o:사내-도구", true],
      ["o:사내-도구", "e:사내-도구", true],
    ]);
    expect(graph.nodes.find((node) => node.kind === "other")?.to).toBe("사내-도구");
    expect(graph.height).toBe(236);
  });

  it("빈 Space는 Space 노드 하나다", () => {
    const graph = spaceGraph(space({ projects: [] }), []);
    expect(placed(graph)).toEqual([["space", "결제 서비스", 82, 104]]);
    expect(graph.edges).toEqual([]);
  });

  it("다른 Space끼리 50보다 가까우면 아래로 밀고, 겹치지 않는 Project가 여럿이면 한 노드로 접는다", () => {
    const graph = spaceGraph(space(), [
      shared("a", "가", ["api-server"], ["api-server", "backoffice", "admin"]),
      shared("b", "나", ["api-server"], ["api-server"]),
    ]);
    expect(placed(graph).filter(([kind]) => kind === "other" || kind === "extra")).toEqual([
      ["other", "가", 442, 129],
      ["extra", "backoffice 외 1개", 628, 129],
      ["other", "나", 442, 179],
    ]);
  });

  it("Project가 일곱을 넘으면 여섯과 「외 N개」로 접고, 그래프가 노드만큼 길어진다", () => {
    const projects = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const graph = spaceGraph(space({ projects }), [shared("x", "엑스", ["i"], ["i"])]);
    const column = graph.nodes.filter((node) => node.x === 262);
    expect(column.map((node) => node.name)).toEqual(["a", "b", "c", "d", "e", "f", "외 3개"]);
    expect(column[0].y).toBeGreaterThanOrEqual(36);
    // 접힌 Project를 쓰는 다른 Space는 「외 N개」 곁에 선다
    const more = column[6];
    expect(graph.edges).toContainEqual({ from: more.key, to: "o:x", muted: true });
    expect(graph.height).toBeGreaterThan(236);
    expect(Math.max(...graph.nodes.map((node) => node.y)) + 18).toBeLessThan(graph.height - 40);
  });
});

const project = (slug: string): ProjectView => ({
  slug,
  name: slug,
  path: `~/MyProjects/${slug}`,
  baseBranch: "main",
  createdAt: "2026-10-01",
  description: "",
  git: null,
  missing: false,
});

describe("넣기 메뉴", () => {
  it("아직 묶이지 않은 등록된 Project를 등록부 차례로 보인다", () => {
    const menu = addMenu(space(), [project("api-server"), project("backoffice"), project("web-app"), project("docs")]);
    expect(menu.candidates.map((one) => one.slug)).toEqual(["backoffice", "docs"]);
    expect(menu.allIn).toBe(false);
  });

  it("다 넣었으면 그렇다고 말한다", () => {
    expect(addMenu(space(), [project("web-app"), project("api-server")])).toEqual({ candidates: [], allIn: true });
  });
});

describe("만든 이 · 만든 때", () => {
  const today = new Date(2026, 9, 26, 15, 0);
  it("Host가 만들었으면 Host와 만듦, 아니면 직접 만듦", () => {
    expect(createdLine(space({ createdBy: "host" }), today)).toEqual({ host: true, by: "Host와 만듦", when: "2일 전" });
    expect(createdLine(space({ createdAt: "2026-10-26" }), today)).toEqual({ host: false, by: "직접 만듦", when: "오늘" });
    expect(createdLine(space({ createdAt: "2026-10-25" }), today).when).toBe("어제");
    expect(createdLine(space({ createdAt: "2025-12-01" }), today).when).toBe("2025. 12. 1.");
    expect(createdLine(space({ createdAt: "" }), today).when).toBe("");
  });
});
