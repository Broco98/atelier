import { describe, expect, it } from "vitest";
import type { ProjectView } from "@/features/projects/types";
import { addMenu, CARD_GRAPH, createdLine, HOST_MAKE, listShows, shownSpaces, spaceGraph, spaceMenu, spaceStarts, spaceWorks } from "./space-view";
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

  it("고치기 화면의 카드는 좁은 판(520)에 세 열(72 · 260 · 448)이고, 다른 Space의 다른 Project는 그리지 않는다", () => {
    // 시안 F1-SpaceEdit의 미리보기 카드(`graph_box(520)` · `layout(… { X: [72, 260, 448], NW: 112 })`)
    const graph = spaceGraph(
      space({ projects: ["web-app", "api-server", "backoffice"] }),
      [shared("사내-도구", "사내 도구", ["api-server", "backoffice"], ["api-server", "backoffice", "admin"])],
      CARD_GRAPH,
    );
    expect(placed(graph)).toEqual([
      ["space", "결제 서비스", 72, 104],
      ["project", "web-app", 260, 54],
      ["project", "api-server", 260, 104],
      ["project", "backoffice", 260, 154],
      ["other", "사내 도구", 448, 129],
    ]);
    expect(graph.height).toBe(224);
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

// 03 코드 리뷰 P4 · §8 — 읽을 수 없는 파일 하나는 그 줄만 「문제 있음」으로 서고(core), 목록을 아예 읽지 못하면 그 까닭이 선다 — 「아직 Space가
// 없어요」는 Space가 정말 없을 때만이다.
describe("Space 목록 판", () => {
  it("목록을 읽지 못하면 오류다 — 빈 목록 안내가 아니다", () => {
    expect(listShows({ isPending: false, isError: true, count: 0 })).toBe("error");
  });

  it("다 읽어 Space가 없으면 빈 목록 안내, 있거나 읽는 중이면 표다", () => {
    expect(listShows({ isPending: false, isError: false, count: 0 })).toBe("empty");
    expect(listShows({ isPending: false, isError: false, count: 2 })).toBe("table");
    expect(listShows({ isPending: true, isError: false, count: 0 })).toBe("table");
  });

  // 찾기(시안 「Space 찾기」 — 03 코드 리뷰 D1에서 목록 부품 밖으로 꺼냈다). Projects 목록의 찾기(`shownProjects`)와 같은 규칙이다.
  const all = [
    space(),
    space({ slug: "사내-도구", name: "사내 도구", projects: ["backoffice"], description: "운영팀이 쓰는 Admin" }),
    space({ slug: "원장", name: "", projects: ["ledger"] }),
  ];
  it("찾기는 이름 · slug · 설명 · 적힌 Project 가운데 하나라도 그 글을 품으면 남긴다 — 대소문자 · 앞뒤 빈칸은 보지 않는다", () => {
    expect(shownSpaces(all, "결제").map((one) => one.slug)).toEqual(["결제-서비스"]);
    expect(shownSpaces(all, "원장").map((one) => one.slug)).toEqual(["원장"]);
    expect(shownSpaces(all, "  admin ").map((one) => one.slug)).toEqual(["사내-도구"]);
    expect(shownSpaces(all, "API").map((one) => one.slug)).toEqual(["결제-서비스"]);
  });

  it("빈 찾기는 모두 · 맞는 것이 없으면 빈 목록이다", () => {
    expect(shownSpaces(all, " ")).toHaveLength(3);
    expect(shownSpaces(all, "없는 글")).toEqual([]);
  });
});

describe("넣기 메뉴", () => {
  it("아직 묶이지 않은 등록된 Project를 등록부 차례로 보인다", () => {
    const menu = addMenu(space(), [project("api-server"), project("backoffice"), project("web-app"), project("docs")]);
    expect(menu.candidates.map((one) => one.slug)).toEqual(["backoffice", "docs"]);
    expect(menu.note).toBeNull();
  });

  it("다 넣었으면 그렇다고 말한다", () => {
    expect(addMenu(space(), [project("web-app"), project("api-server")])).toEqual({ candidates: [], note: "등록된 Project를 모두 넣었어요" });
  });

  // 03 코드 리뷰 P9 · 스토리 153 — 넣을 것이 없는 것은 같아도, 등록된 Project가 하나도 없으면 「모두 넣었어요」가 사실이 아니다.
  it("등록된 Project가 없으면 「모두 넣었어요」가 아니라 없다고 말한다", () => {
    expect(addMenu(space(), [])).toEqual({ candidates: [], note: "등록된 Project가 없어요" });
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

describe("Space 메뉴(03 §5 · §10)", () => {
  const spaces = [
    space(),
    space({ slug: "사내-도구", name: "사내 도구", projects: ["api-server", "backoffice"] }),
    space({ slug: "깨진", name: "", projects: ["web-app"], problems: [{ line: 3, kind: "unknownProject", project: "x", message: "등록되지 않은 Project예요" }] }),
  ];

  it("Space가 있으면 맨 위가 「Space 빼기」이고, Space마다 이름 · 적힌 Project가 서며 지금 것에 ✓, 문제 있는 Space에 「문제 있음」이 붙는다", () => {
    expect(spaceMenu(spaces, "결제-서비스", 3)).toEqual({
      top: { kind: "remove", label: "Space 빼기", note: "등록된 Project 3개를 모두 읽어요", current: false },
      rows: [
        { slug: "결제-서비스", name: "결제 서비스", projects: "web-app · api-server", troubled: false, current: true },
        { slug: "사내-도구", name: "사내 도구", projects: "api-server · backoffice", troubled: false, current: false },
        { slug: "깨진", name: "깨진", projects: "web-app", troubled: true, current: false },
      ],
    });
  });

  it("Space가 없으면 맨 위 「Space 없음」이 지금 것이다 — 적힌 Space의 파일이 없어도 Space 없음이다(§7 규칙 1)", () => {
    for (const current of [null, "지운-것"]) {
      const menu = spaceMenu(spaces, current, 3);
      expect(menu.top).toEqual({ kind: "none", label: "Space 없음", note: "등록된 Project 3개를 모두 읽어요", current: true });
      expect(menu.rows?.some((row) => row.current)).toBe(false);
    }
  });

  it("Space가 하나도 없으면 줄 목록이 없고(「Host와 Space 만들기」 자리), 등록된 Project가 없으면 그렇다고 말한다", () => {
    expect(spaceMenu([], null, 0)).toEqual({
      top: { kind: "none", label: "Space 없음", note: "등록된 Project가 없어요", current: true },
      rows: null,
    });
  });

  it("빈 Space는 Project 자리에 없다고 말한다", () => {
    expect(spaceMenu([space({ projects: [] })], null, 2).rows?.[0].projects).toBe("Project 없음");
  });

  // 트레이의 Space 칩이 여는 메뉴(06 · F4-KitComposer 「Space 칩 메뉴」) — 맨 위가 늘 「Space 없음」이고 곁말이 「… 읽기」다. 빼기는 칩의 ×가 한다.
  it("Space 칩의 메뉴는 맨 위가 늘 「Space 없음 — 등록된 Project N개 읽기」이고 지금이면 ✓다", () => {
    expect(spaceMenu(spaces, null, 3, "chip").top).toEqual({ kind: "none", label: "Space 없음", note: "등록된 Project 3개 읽기", current: true });
    const picked = spaceMenu(spaces, "결제-서비스", 3, "chip");
    expect(picked.top).toEqual({ kind: "none", label: "Space 없음", note: "등록된 Project 3개 읽기", current: false });
    expect(picked.rows?.find((row) => row.current)?.slug).toBe("결제-서비스");
    expect(spaceMenu([], null, 0, "chip").top).toEqual({ kind: "none", label: "Space 없음", note: "등록된 Project가 없어요", current: true });
  });
});

describe("Space 상세의 Work 묶음", () => {
  it("이 Space에 이은 Work만 목록 차례로 선다", () => {
    const works = [
      { slug: "a", space: "결제-서비스" },
      { slug: "b" },
      { slug: "c", space: "사내-도구" },
      { slug: "d", space: "결제-서비스" },
    ];
    expect(spaceWorks(works, "결제-서비스").map((work) => work.slug)).toEqual(["a", "d"]);
    expect(spaceWorks(works, "없는-것")).toEqual([]);
  });
});

// 03 구현 스펙 §14 · S16 · S17 · 티켓 06 — Space 화면의 시작 단추는 첫 화면(`/`)을 씨앗과 함께 연다. 보내기는 사람이 한다.
describe("Space 화면의 시작 단추가 여는 첫 화면", () => {
  it("「Host와 만들기」는 Work 없는 대화에 Space를 만들어 달라는 말을 넣는다(S16)", () => {
    expect(HOST_MAKE).toEqual({
      new: "thread",
      say: "Space를 만들고 싶어요. 등록된 Project를 읽고 초안(이름 · Project · 설명)을 보여 주세요.",
    });
  });

  it("상세의 「새 Work」는 그 Space를 고른 「새 Work」, 「Host와 고치기」는 그 Space를 붙인 Work 없는 대화와 고쳐 달라는 말이다(S17)", () => {
    expect(spaceStarts(space())).toEqual({
      newWork: { new: "work", space: "결제-서비스" },
      hostEdit: { new: "thread", space: "결제-서비스", say: "결제 서비스 Space를 고치고 싶어요. " },
    });
    // 이름이 없는(읽을 수 없는) 파일은 slug로 부른다.
    expect(spaceStarts(space({ name: "" })).hostEdit.say).toBe("결제-서비스 Space를 고치고 싶어요. ");
  });
});
