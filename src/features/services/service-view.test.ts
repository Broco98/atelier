import { describe, expect, it } from "vitest";
import {
  CARD_GRAPH,
  HOST_MAKE,
  listShows,
  scopeMenu,
  serviceDetailMenu,
  serviceFile,
  serviceGraph,
  serviceMenu,
  serviceRowMenu,
  serviceStarts,
  serviceSummary,
  shownServices,
} from "./service-view";
import type { SharedService, Service } from "./types";

const service = (over: Partial<Service> = {}): Service => ({
  slug: "결제-서비스",
  name: "결제 서비스",
  projects: ["web-app", "api-server"],
  createdAt: "2026-10-24",
  createdBy: null,
  description: "",
  problems: [],
  ...over,
});

const shared = (slug: string, name: string, overlap: string[], projects: string[]): SharedService => ({
  slug,
  name,
  overlap,
  projects,
});

/** 노드를 (종류, 이름, x, y)로 — 자리는 시안 F1-SpaceDetail의 배치(열 x 82 · 262 · 442 · 628, 가운데 y 104, 줄 사이 50)다. */
const placed = (graph: ReturnType<typeof serviceGraph>) => graph.nodes.map((node) => [node.kind, node.name, node.x, node.y]);

describe("관계 그래프", () => {
  it("Service가 가운데, Project가 둘레, 같은 Project를 쓰는 다른 Service가 점선으로 그 Project 곁에 선다", () => {
    const graph = serviceGraph(service(), [shared("사내-도구", "사내 도구", ["api-server"], ["api-server", "backoffice"])]);
    expect(placed(graph)).toEqual([
      ["service", "결제 서비스", 82, 104],
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

  it("고치기 화면의 카드는 좁은 판(520)에 세 열(72 · 260 · 448)이고, 다른 Service의 다른 Project는 그리지 않는다", () => {
    // 시안 F1-SpaceEdit의 미리보기 카드(`graph_box(520)` · `layout(… { X: [72, 260, 448], NW: 112 })`)
    const graph = serviceGraph(
      service({ projects: ["web-app", "api-server", "backoffice"] }),
      [shared("사내-도구", "사내 도구", ["api-server", "backoffice"], ["api-server", "backoffice", "admin"])],
      CARD_GRAPH,
    );
    expect(placed(graph)).toEqual([
      ["service", "결제 서비스", 72, 104],
      ["project", "web-app", 260, 54],
      ["project", "api-server", 260, 104],
      ["project", "backoffice", 260, 154],
      ["other", "사내 도구", 448, 129],
    ]);
    expect(graph.height).toBe(224);
  });

  it("빈 Service는 Service 노드 하나다", () => {
    const graph = serviceGraph(service({ projects: [] }), []);
    expect(placed(graph)).toEqual([["service", "결제 서비스", 82, 104]]);
    expect(graph.edges).toEqual([]);
  });

  it("다른 Service끼리 50보다 가까우면 아래로 밀고, 겹치지 않는 Project가 여럿이면 한 노드로 접는다", () => {
    const graph = serviceGraph(service(), [
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
    const graph = serviceGraph(service({ projects }), [shared("x", "엑스", ["i"], ["i"])]);
    const column = graph.nodes.filter((node) => node.x === 262);
    expect(column.map((node) => node.name)).toEqual(["a", "b", "c", "d", "e", "f", "외 3개"]);
    expect(column[0].y).toBeGreaterThanOrEqual(36);
    // 접힌 Project를 쓰는 다른 Service는 「외 N개」 곁에 선다
    const more = column[6];
    expect(graph.edges).toContainEqual({ from: more.key, to: "o:x", muted: true });
    expect(graph.height).toBeGreaterThan(236);
    expect(Math.max(...graph.nodes.map((node) => node.y)) + 18).toBeLessThan(graph.height - 40);
  });
});

// 03 코드 리뷰 P4 · §8 — 읽을 수 없는 파일 하나는 그 줄만 「문제 있음」으로 서고(core), 목록을 아예 읽지 못하면 그 까닭이 선다 — 「아직 Service가
// 없어요」는 Service가 정말 없을 때만이다.
describe("Service 목록 판", () => {
  it("목록을 읽지 못하면 오류다 — 빈 목록 안내가 아니다", () => {
    expect(listShows({ isPending: false, isError: true, count: 0 })).toBe("error");
  });

  // restart 03-3 — 처음 읽는 중은 뼈대 자리다(공용 목록 틀 — 300ms 넘을 때만 선다). 한때(03) 읽는 중에도 빈 표였다.
  it("다 읽어 Service가 없으면 빈 목록 안내, 있으면 표, 처음 읽는 중이면 뼈대 자리다", () => {
    expect(listShows({ isPending: false, isError: false, count: 0 })).toBe("empty");
    expect(listShows({ isPending: false, isError: false, count: 2 })).toBe("table");
    expect(listShows({ isPending: true, isError: false, count: 0 })).toBe("loading");
  });

  // 찾기(시안 「Service 찾기」 — 03 코드 리뷰 D1에서 목록 부품 밖으로 꺼냈다). Projects 목록의 찾기(`shownProjects`)와 같은 규칙이다.
  const all = [
    service(),
    service({ slug: "사내-도구", name: "사내 도구", projects: ["backoffice"], description: "운영팀이 쓰는 Admin" }),
    service({ slug: "원장", name: "", projects: ["ledger"] }),
  ];
  it("찾기는 이름 · slug · 설명 · 적힌 Project 가운데 하나라도 그 글을 품으면 남긴다 — 대소문자 · 앞뒤 빈칸은 보지 않는다", () => {
    expect(shownServices(all, "결제").map((one) => one.slug)).toEqual(["결제-서비스"]);
    expect(shownServices(all, "원장").map((one) => one.slug)).toEqual(["원장"]);
    expect(shownServices(all, "  admin ").map((one) => one.slug)).toEqual(["사내-도구"]);
    expect(shownServices(all, "API").map((one) => one.slug)).toEqual(["결제-서비스"]);
  });

  it("빈 찾기는 모두 · 맞는 것이 없으면 빈 목록이다", () => {
    expect(shownServices(all, " ")).toHaveLength(3);
    expect(shownServices(all, "없는 글")).toEqual([]);
  });
});

describe("Service 메뉴(03 §5 · §10)", () => {
  const services = [
    service(),
    service({ slug: "사내-도구", name: "사내 도구", projects: ["api-server", "backoffice"] }),
    service({ slug: "깨진", name: "", projects: ["web-app"], problems: [{ line: 3, kind: "unknownProject", project: "x", message: "등록되지 않은 Project예요" }] }),
  ];

  it("Service가 있으면 맨 위가 「Service 빼기」이고, Service마다 이름 · 적힌 Project가 서며 지금 것에 ✓, 문제 있는 Service에 「문제 있음」이 붙는다", () => {
    expect(serviceMenu(services, "결제-서비스", 3)).toEqual({
      top: { kind: "remove", label: "Service 빼기", note: "등록된 Project 3개를 모두 읽어요", current: false },
      rows: [
        { slug: "결제-서비스", name: "결제 서비스", projects: "web-app · api-server", troubled: false, current: true },
        { slug: "사내-도구", name: "사내 도구", projects: "api-server · backoffice", troubled: false, current: false },
        { slug: "깨진", name: "깨진", projects: "web-app", troubled: true, current: false },
      ],
    });
  });

  it("Service가 없으면 맨 위 「Service 없음」이 지금 것이다 — 적힌 Service의 파일이 없어도 Service 없음이다(§7 규칙 1)", () => {
    for (const current of [null, "지운-것"]) {
      const menu = serviceMenu(services, current, 3);
      expect(menu.top).toEqual({ kind: "none", label: "Service 없음", note: "등록된 Project 3개를 모두 읽어요", current: true });
      expect(menu.rows?.some((row) => row.current)).toBe(false);
    }
  });

  it("Service가 하나도 없으면 줄 목록이 없고(「대화로 Service 만들기」 자리), 등록된 Project가 없으면 그렇다고 말한다", () => {
    expect(serviceMenu([], null, 0)).toEqual({
      top: { kind: "none", label: "Service 없음", note: "등록된 Project가 없어요", current: true },
      rows: null,
    });
  });

  it("빈 Service는 Project 자리에 없다고 말한다", () => {
    expect(serviceMenu([service({ projects: [] })], null, 2).rows?.[0].projects).toBe("Project 없음");
  });

});

// 시안 Composer 「범위 메뉴」 칸의 글 그대로다 — 범위 없음 · Service 줄 · Project 줄.
describe("범위 메뉴", () => {
  const services = [
    service(),
    service({ slug: "깨진", name: "", projects: [], problems: [{ line: 3, kind: "unknownProject", project: "x", message: "등록되지 않은 Project예요" }] }),
  ];
  const projects = [
    { slug: "atelier", name: "Atelier", path: "~/MyProjects/atelier" },
    { slug: "backend", name: "backend", path: "~/work/payments/backend" },
  ];
  const NONE = { pick: null, name: "범위 없음", note: "등록된 Project 전부", troubled: false };
  const PAYMENTS = { pick: { kind: "service", slug: "결제-서비스" }, name: "결제 서비스", note: "Service · Project 2개", troubled: false };
  const BROKEN = { pick: { kind: "service", slug: "깨진" }, name: "깨진", note: "Service · Project 없음", troubled: true };
  const ATELIER = { pick: { kind: "project", slug: "atelier" }, name: "Atelier", note: "Project · ~/MyProjects/atelier", troubled: false };
  const BACKEND = { pick: { kind: "project", slug: "backend" }, name: "backend", note: "Project · ~/work/payments/backend", troubled: false };

  it("범위 없음 · Service · Project 차례로 서고 지금 것에 ✓다", () => {
    expect(scopeMenu(services, projects, null, true)).toEqual([
      { ...NONE, current: true },
      { ...PAYMENTS, current: false },
      { ...BROKEN, current: false },
      { ...ATELIER, current: false },
      { ...BACKEND, current: false },
    ]);
    const current = (held: Parameters<typeof scopeMenu>[2]) => scopeMenu(services, projects, held, true).filter((row) => row.current).map((row) => row.name);
    expect(current({ kind: "service", slug: "결제-서비스" })).toEqual(["결제 서비스"]);
    expect(current({ kind: "project", slug: "backend" })).toEqual(["backend"]);
  });

  it("같은 slug의 Service와 Project를 가른다", () => {
    const both = scopeMenu([service({ slug: "atelier", name: "앱" })], projects, { kind: "project", slug: "atelier" }, true);
    expect(both.filter((row) => row.current).map((row) => row.pick)).toEqual([{ kind: "project", slug: "atelier" }]);
  });

  it("작업공간을 고른 동안은 Project 줄이 서지 않는다 — Project 범위는 작업공간 밖의 값이다", () => {
    expect(scopeMenu(services, projects, null, false).map((row) => row.name)).toEqual(["범위 없음", "결제 서비스", "깨진"]);
  });

  it("등록된 Project가 없으면 범위 없음이 그렇게 말한다", () => {
    expect(scopeMenu([], [], null, true)).toEqual([{ ...NONE, note: "등록된 Project가 없어요", current: true }]);
  });
});

// 03 구현 스펙 §14 · S16 · 티켓 06 — Service 화면의 시작 단추는 첫 화면(`/`)을 씨앗과 함께 연다. 보내기는 사람이 한다.
describe("Service 화면의 시작 단추가 여는 첫 화면", () => {
  it("「대화로 만들기」는 Work 없는 대화에 Service를 만들어 달라는 말을 넣는다(S16)", () => {
    expect(HOST_MAKE).toEqual({
      new: "thread",
      say: "Service를 만들고 싶어요. 등록된 Project를 읽고 초안(이름 · Project · 설명)을 보여 주세요.",
    });
  });

  // restart 03-3 · 스토리 8 · 13 · 117 · 스펙 「01a — 범위와 새 채팅」 「만드는 길」 — 줄과 상세 머리의 「작업공간 만들기」 · 「새 채팅」은 그 Service 범위의
  // 새 채팅이고, 상세 Projects 묶음의 「Project 넣기」는 `?new=thread` · `?service=` · `?say=`로 그 Service를 고친다는 말을 채워 연다.
  it("「작업공간 만들기」는 그 Service를 고른 「새 작업공간」, 「새 채팅」은 그 Service 범위의 작업공간 없는 채팅이다", () => {
    expect(serviceStarts(service())).toMatchObject({
      work: { new: "work", service: "결제-서비스" },
      thread: { new: "thread", service: "결제-서비스" },
    });
  });

  it("「Project 넣기」는 그 Service에 Project를 넣고 싶다는 말이 채워진 새 채팅이다 — 이름이 없는(읽을 수 없는) 파일은 slug로 부른다", () => {
    expect(serviceStarts(service()).addProject).toEqual({ new: "thread", service: "결제-서비스", say: "결제 서비스에 Project를 넣고 싶어요. " });
    expect(serviceStarts(service({ name: "" })).addProject.say).toBe("결제-서비스에 Project를 넣고 싶어요. ");
  });
});

// restart 03-3 · 보드 PlaceSheet 「세 화면」 — 이름 옆은 「Project 수와 이름」이다. 수와 이름은 등록된 Project만이다(등록되지 않은 것은 상세의 경고가 말한다).
describe("Service 줄의 이름 옆", () => {
  const registered = [{ slug: "backend", name: "backend" }, { slug: "front", name: "Front 앱" }];
  it("넣은 Project의 수와 이름이다 — 이름은 등록부의 이름이다", () => {
    expect(serviceSummary(service({ projects: ["backend", "front"] }), registered)).toBe("Project 2개 · backend · Front 앱");
  });

  it("등록되지 않은 Project는 세지 않고, 넣은 것이 없으면 그렇게 말한다", () => {
    const troubled = service({
      projects: ["front", "legacy-api"],
      problems: [{ line: 3, kind: "unknownProject", project: "legacy-api", message: "등록되지 않은 Project예요" }],
    });
    expect(serviceSummary(troubled, registered)).toBe("Project 1개 · Front 앱");
    expect(serviceSummary(service({ projects: [] }), registered)).toBe("Project 없음");
  });
});

// restart 03-3 · 보드 PlaceSheet 「⋯ 메뉴」 · Places `MENUS.services` — 「파일로 고치기 · 경로 복사 · 삭제…」. 파일로 고치기는 ⋯ 메뉴와 상세 경고에서 닿는다(스펙).
describe("Service의 ⋯", () => {
  it("목록 줄은 파일로 고치기 · 경로 복사 · 삭제…다", () => {
    expect(serviceRowMenu().map((item) => [item.act, item.label])).toEqual([
      ["edit-file", "파일로 고치기"],
      ["copy-path", "경로 복사"],
      ["delete", "삭제…"],
    ]);
  });

  it("상세는 이름 바꾸기 · 설명 고치기 뒤에 목록 줄의 셋이다 — 칸 단위로 고칠 수 없는 파일이면 고치기 둘이 빠진다", () => {
    expect(serviceDetailMenu(service()).map((item) => item.label)).toEqual(["이름 바꾸기", "설명 고치기", "파일로 고치기", "경로 복사", "삭제…"]);
    const broken = service({ problems: [{ line: 1, kind: "unclosedFrontmatter", message: "frontmatter가 닫히지 않았어요" }] });
    expect(serviceDetailMenu(broken).map((item) => item.label)).toEqual(["파일로 고치기", "경로 복사", "삭제…"]);
  });

  it("경로 복사는 Service 파일들의 폴더 아래 그 slug의 파일이다", () => {
    expect(serviceFile("~/.atelier/services", "결제-서비스")).toBe("~/.atelier/services/결제-서비스.md");
  });
});
