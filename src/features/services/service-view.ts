import type { ProjectView } from "@/features/projects/types";
import { startSearch, type NewThreadSearch } from "@/routes/-new-thread-search";
import type { ScopePick } from "./scope";
import type { SharedService, Service, ServiceProblemKind } from "./types";

// Service 화면이 그리는 것을 값으로 짓는 순수 함수들(03 구현 스펙 §14 · restart 03-3) — 고치기 화면 카드의 그래프 배치 · 목록 줄 · ⋯ 메뉴 · 시작 단추가
// 여는 첫 화면, 그리고 Work 화면 머리의 Service 메뉴(§10)와 범위 칩의 범위 메뉴. 상세의 묶음 · 위 카드 · 경고는 `service-detail.ts`다. 화면 부품은 이
// 값을 그리기만 한다(L2가 잰다).

/** 화면이 부르는 이름 — 읽을 수 없는 파일은 이름이 없어 slug다. */
export function serviceName(service: Pick<Service, "slug" | "name">): string {
  return service.name.trim() === "" ? service.slug : service.name;
}

// ── 관계 그래프 ──────────────────────────────────────────────────────────────────────────────────────────────────
//
// 시안 F1-SpaceDetail의 배치 그대로다(보드 스크립트 `layout`): 너비 720의 판에 네 열 — Service(82) · Project(262) · 다른 Service(442) ·
// 그 Service의 다른 Project(628). 노드는 너비 124 · 높이 36이다. 고치기 화면의 미리보기 카드는 같은 규칙을 좁은 판에 세 열로 그린다
// (`CARD_GRAPH`). Project는 가운데 줄(y 104)을 두고 50 간격으로 퍼지고, 다른 Service는
// 겹치는 Project들의 가운데에 서되 앞 Service와 50보다 가까우면 아래로 밀린다.
//
// 시안이 그리지 않은 많을 때(스펙 「위험 — 관계 그래프의 배치」): 한 열이 일곱을 넘으면 여섯과 「외 N개」로 접고, 판은 노드만큼 길어진다.
// 다른 Service의 겹치지 않는 Project는 그 Service 곁 한 노드다 — 여럿이면 「backoffice 외 1개」로 접어 이웃 Service의 노드와 겹치지 않는다.

export const NODE_HEIGHT = 36;

/**
 * 그래프 판 하나의 배치 — 층의 폭 · 열의 가운데 x · 노드 폭 · 판의 기본 키 · 마지막 노드 아래로 남기는 자리(범례 줄과 그 위 여백). 넷째
 * 열이 없으면 다른 Service의 다른 Project를 그리지 않는다.
 */
export interface GraphLayout {
  width: number;
  columns: readonly [number, number, number] | readonly [number, number, number, number];
  nodeWidth: number;
  baseHeight: number;
  bottomRoom: number;
}

/** 상세의 「관계」 판 — 시안 F1-SpaceDetail. */
export const DETAIL_GRAPH: GraphLayout = { width: 720, columns: [82, 262, 442, 628], nodeWidth: 124, baseHeight: 236, bottomRoom: 64 };

/** 고치기 화면의 미리보기 카드 — 시안 F1-SpaceEdit(`graph_box(520)` · 열 72 · 260 · 448 · 노드 112 · 판 224). 좁은 카드라 셋째 열까지다. */
export const CARD_GRAPH: GraphLayout = { width: 520, columns: [72, 260, 448], nodeWidth: 112, baseHeight: 224, bottomRoom: 52 };

/** 가운데 줄 — 시안 그대로. */
const MIDDLE = 104;
const GAP = 50;
/** 첫 노드의 가운데가 판 위에서 떨어지는 가장 작은 값 — 노드 반 높이 18 + 여백 18. */
const TOP = 36;
/** 한 열에 서는 노드의 끝 — 넘으면 앞 여섯과 「외 N개」다. */
const COLUMN_LIMIT = 7;

export type GraphNodeKind = "service" | "project" | "other" | "extra" | "more";

export interface GraphNode {
  key: string;
  kind: GraphNodeKind;
  name: string;
  /** 노드 가운데의 자리. */
  x: number;
  y: number;
  /** 점선 Service면 그 Service의 slug — 누르면 그쪽으로 옮겨 간다. */
  to?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** 다른 Service로 이어지는 점선. */
  muted: boolean;
}

export interface ServiceGraph {
  layout: GraphLayout;
  height: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const spread = (count: number, center: number, gap: number) =>
  Array.from({ length: count }, (_, index) => center + (index - (count - 1) / 2) * gap);

/** 열 하나를 일곱까지 — 넘으면 앞 여섯과 접힌 수. */
function fold<T>(items: readonly T[]): { shown: T[]; folded: T[] } {
  if (items.length <= COLUMN_LIMIT) return { shown: [...items], folded: [] };
  return { shown: items.slice(0, COLUMN_LIMIT - 1), folded: items.slice(COLUMN_LIMIT - 1) };
}

export function serviceGraph(service: Service, shared: readonly SharedService[], layout: GraphLayout = DETAIL_GRAPH): ServiceGraph {
  const COLUMNS = layout.columns;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const projects = fold(service.projects);
  const columnSize = projects.shown.length + (projects.folded.length > 0 ? 1 : 0);
  const middle = Math.max(MIDDLE, TOP + ((columnSize - 1) * GAP) / 2);

  const me: GraphNode = { key: `s:${service.slug}`, kind: "service", name: serviceName(service), x: COLUMNS[0], y: middle };
  nodes.push(me);
  // Project 이름 → 그 이름이 선 노드(접힌 것은 「외 N개」 노드).
  const at = new Map<string, GraphNode>();
  const ys = spread(columnSize, middle, GAP);
  projects.shown.forEach((slug, index) => {
    const node: GraphNode = { key: `p:${slug}`, kind: "project", name: slug, x: COLUMNS[1], y: ys[index] };
    nodes.push(node);
    at.set(slug, node);
  });
  if (projects.folded.length > 0) {
    const more: GraphNode = {
      key: "p:…",
      kind: "more",
      name: `외 ${projects.folded.length}개`,
      x: COLUMNS[1],
      y: ys[columnSize - 1],
    };
    nodes.push(more);
    for (const slug of projects.folded) at.set(slug, more);
  }
  for (const node of nodes.slice(1)) edges.push({ from: me.key, to: node.key, muted: false });

  // 다른 Service — 겹치는 Project 노드들의 가운데, 위에서부터 차례로, 앞 것과 50은 띄운다.
  const placedOthers = shared
    .map((other) => {
      const linked = [...new Set(other.overlap.flatMap((slug) => at.get(slug) ?? []))];
      const y = linked.reduce((sum, node) => sum + node.y, 0) / Math.max(linked.length, 1);
      return { other, linked, y };
    })
    .filter(({ linked }) => linked.length > 0)
    .sort((a, b) => a.y - b.y);
  placedOthers.forEach((one, index) => {
    if (index > 0 && one.y - placedOthers[index - 1].y < GAP) one.y = placedOthers[index - 1].y + GAP;
  });
  const others = fold(placedOthers);
  for (const { other, linked, y } of others.shown) {
    const node: GraphNode = { key: `o:${other.slug}`, kind: "other", name: other.name, x: COLUMNS[2], y, to: other.slug };
    nodes.push(node);
    for (const from of linked) edges.push({ from: from.key, to: node.key, muted: true });
    const extra = other.projects.filter((slug) => !service.projects.includes(slug));
    if (COLUMNS.length === 4 && extra.length > 0) {
      const name = extra.length === 1 ? extra[0] : `${extra[0]} 외 ${extra.length - 1}개`;
      nodes.push({ key: `e:${other.slug}`, kind: "extra", name, x: COLUMNS[3], y });
      edges.push({ from: node.key, to: `e:${other.slug}`, muted: true });
    }
  }
  if (others.folded.length > 0) {
    const last = others.shown[others.shown.length - 1].y;
    nodes.push({ key: "o:…", kind: "more", name: `외 ${others.folded.length}개`, x: COLUMNS[2], y: last + GAP });
  }

  const lowest = Math.max(...nodes.map((node) => node.y));
  return { layout, height: Math.max(layout.baseHeight, lowest + NODE_HEIGHT / 2 + layout.bottomRoom), nodes, edges };
}

// ── 목록 판 ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Service 목록 판이 그리는 것(§14 · S15 · §8 · restart 03-3) — 목록을 읽지 못했으면 그 까닭(`error`), 처음 읽는 중이면 뼈대 자리(`loading` — 공용 목록
 * 틀이 300ms 넘을 때만 세운다), 다 읽어 Service가 없으면 빈 목록의 할 일(`empty`), 그 밖은 표다. 읽을 수 없는 파일 하나는 목록을 깨지 않고 그 줄로
 * 선다(core) — 그 일은 상세의 경고가 말한다.
 */
export function listShows(list: { isPending: boolean; isError: boolean; count: number }): "error" | "loading" | "empty" | "table" {
  if (list.isError) return "error";
  if (list.isPending) return "loading";
  return list.count === 0 ? "empty" : "table";
}

/**
 * 그 Service의 Project — 파일에 적힌 차례 그대로, **등록된 것만**이다(restart 03-3). 등록되지 않은 Project는 core 검사가 문제(`unknownProject`)로
 * 말하므로(S7 — 화면은 따로 검사하지 않는다) 그 문제의 Project를 뺀다. 그 일은 상세의 경고가 말하고 「파일로 고치기」로 고친다(보드 Places
 * `DETAILS.admin` — 적힌 셋 가운데 등록된 둘만 「Project 2개」 · 줄로 선다). 목록 줄 · 상세 · Project 상세의 Service 줄이 같은 수를 센다.
 */
export function serviceMembers(service: Pick<Service, "projects" | "problems">): string[] {
  const unknown = new Set(service.problems.flatMap((problem) => (problem.kind === "unknownProject" && problem.project ? [problem.project] : [])));
  return service.projects.filter((slug) => !unknown.has(slug));
}

/**
 * 목록 줄의 이름 옆(restart 03-3 · 보드 PlaceSheet 「세 화면」 「이름 옆 — Project 수와 이름」 · Places `DATA.services`) — 「Project 2개 · backend ·
 * front」. 이름은 등록부의 이름이다(아직 못 읽었으면 slug). 넣은 것이 없으면 「Project 없음」이다.
 */
export function serviceSummary(service: Pick<Service, "projects" | "problems">, registered: readonly Pick<ProjectView, "slug" | "name">[]): string {
  const members = serviceMembers(service);
  if (members.length === 0) return "Project 없음";
  const names = members.map((slug) => registered.find((one) => one.slug === slug)?.name ?? slug);
  return [`Project ${members.length}개`, ...names].join(" · ");
}

// ── ⋯ 메뉴 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 목록 줄 ⋯의 항목이 하는 일 — 파일로 고치기(고치기 화면) · 경로 복사(그 Service 파일) · 삭제…(확인 창). */
export type ServiceAct = "edit-file" | "copy-path" | "delete";

/** 상세 ⋯의 항목이 하는 일 — 목록 줄의 셋에 상세에서만 고치는 둘(이름 · 설명)을 더한다. */
export type ServiceDetailAct = "rename" | "describe" | ServiceAct;

/**
 * 목록 줄의 ⋯(restart 03-3 · 보드 PlaceSheet 「⋯ 메뉴」 · Places `MENUS.services`) — 「파일로 고치기 · 경로 복사 · 삭제…」. 세 줄이 같은 줄이다 — 한때(03)
 * 「관계 편집」과 선 아래 빨간 「삭제…」였다. 삭제는 메뉴 안에만 있고 창이 한 번 더 묻는다.
 */
export function serviceRowMenu(): { act: ServiceAct; label: string }[] {
  return [
    { act: "edit-file", label: "파일로 고치기" },
    { act: "copy-path", label: "경로 복사" },
    { act: "delete", label: "삭제…" },
  ];
}

/** 칸 단위로 고칠 자리를 찾을 수 없는 문제 — 닫히지 않은 frontmatter · YAML이 아님 · 글로 읽을 수 없는 파일. 이때는 파일로만 고친다. */
const UNEDITABLE: ReadonlySet<ServiceProblemKind> = new Set(["unclosedFrontmatter", "badYaml", "unreadable"]);

/** 이름 · 설명 · Project 빼기를 칸 단위로 고칠 수 있나(core `update_service`가 그 칸만 바꾼다) — 아니면 「파일로 고치기」만이다. */
export function editableInPlace(service: Pick<Service, "problems">): boolean {
  return !service.problems.some((problem) => UNEDITABLE.has(problem.kind));
}

/**
 * 상세 머리의 ⋯(restart 03-3 · 보드 Places 상세 머리의 `.ra-tbtn` — 항목은 그려지지 않았다) — 「이름 바꾸기 · 설명 고치기」 뒤에 목록 줄의 ⋯가 그대로
 * 선다(Project 상세 `detailMenu`와 같은 짜임). 칸 단위로 고칠 수 없는 파일이면 고치기 둘이 빠진다.
 */
export function serviceDetailMenu(service: Pick<Service, "problems">): { act: ServiceDetailAct; label: string }[] {
  const edits = editableInPlace(service)
    ? [
        { act: "rename", label: "이름 바꾸기" } as const,
        { act: "describe", label: "설명 고치기" } as const,
      ]
    : [];
  return [...edits, ...serviceRowMenu()];
}

/** ⋯ 「경로 복사」가 쓰는 그 Service 파일 — Service 파일들의 폴더(core가 홈을 `~`로 접어 준다) 아래 `<slug>.md`다. */
export function serviceFile(folder: string, slug: string): string {
  return `${folder.replace(/\/+$/, "")}/${slug}.md`;
}

/**
 * 찾기(시안 「Service 찾기」) — 이름 · slug · 설명 · 적힌 Project 가운데 하나라도 그 글을 품으면 남는다(대소문자 무시). 빈 찾기는 모두다.
 * Projects 목록의 찾기(`shownProjects`)와 같은 규칙이다.
 */
export function shownServices<S extends Pick<Service, "name" | "slug" | "description" | "projects">>(services: readonly S[], query: string): S[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...services];
  return services.filter((service) => [service.name, service.slug, service.description, ...service.projects].some((one) => one.toLowerCase().includes(needle)));
}

// ── Service 메뉴 ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Service 메뉴의 Service 한 줄 — 이름 · 적힌 Project(「web-app · api-server」) · 문제 있음 · 지금 것(✓). */
export interface ServiceMenuRow {
  slug: string;
  name: string;
  projects: string;
  troubled: boolean;
  current: boolean;
}

export interface ServiceMenu {
  /**
   * 맨 위 줄 — Service가 있으면 「Service 빼기」(`remove` — 누르면 뺀다), 없으면 지금 것인 「Service 없음」(`none` — 고르는 줄, ✓)이다. 곁말은 빼면
   * 읽는 것(「등록된 Project 3개를 모두 읽어요」)이다. 그리는 쪽은 갈래(`kind`)로 줄의 꼴을 고른다 — 화면 글을 열쇠로 삼지 않는다.
   */
  top: { kind: "remove"; label: "Service 빼기"; note: string; current: false } | { kind: "none"; label: "Service 없음"; note: string; current: boolean };
  /** 「Service — 고르면 그 안의 Project만 읽어요」 아래의 줄들 — Service가 하나도 없으면 `null`이고 그 자리에 「대화로 Service 만들기」가 선다. */
  rows: ServiceMenuRow[] | null;
}

/**
 * Service 메뉴(시안 F4-WorkSpaced · F4-WorkNoSpace — Work 화면 머리 줄이 연다). `current`는 지금 이은 Service의 slug다 — 그 파일이 없으면 Service가
 * 없는 것이다(§7 규칙 1). 문제 있는 Service도 선다 — 고르면 읽을 수 있는 Project만 읽는다(§5). 적힌 Project는 등록되지 않은 것도 적힌 그대로다(파일의
 * 말).
 */
export function serviceMenu(services: readonly Service[], current: string | null, registered: number): ServiceMenu {
  const on = services.some((one) => one.slug === current) ? current : null;
  const note = registered > 0 ? `등록된 Project ${registered}개를 모두 읽어요` : "등록된 Project가 없어요";
  return {
    top: on ? { kind: "remove", label: "Service 빼기", note, current: false } : { kind: "none", label: "Service 없음", note, current: true },
    rows:
      services.length === 0
        ? null
        : services.map((one) => ({
            slug: one.slug,
            name: serviceName(one),
            projects: one.projects.length > 0 ? one.projects.join(" · ") : "Project 없음",
            troubled: one.problems.length > 0,
            current: one.slug === on,
          })),
  };
}

// ── 범위 메뉴 ───────────────────────────────────────────────────────────────────────────────────────────────────

/** 범위 메뉴의 한 줄 — 고르면 쥘 것(범위 없음은 `null`) · 이름 · 곁말 · 문제 있음 · 지금 것(✓). */
export interface ScopeMenuRow {
  pick: ScopePick;
  name: string;
  note: string;
  troubled: boolean;
  current: boolean;
}

/**
 * 범위 메뉴(시안 Composer 「범위 메뉴」) — 새 채팅의 범위 칩이 연다. 범위 없음 · Service · Project 차례다. `held`는 칩이 보이는 범위이고, 그것이 없으면
 * 범위 없음이 지금 것이다. 작업공간을 고른 동안은 Project 줄이 서지 않는다(`withProjects`) — Project 범위는 작업공간 밖의 값이다.
 */
export function scopeMenu(
  services: readonly Service[],
  projects: readonly Pick<ProjectView, "slug" | "name" | "path">[],
  held: ScopePick,
  withProjects: boolean,
): ScopeMenuRow[] {
  const isHeld = (pick: ScopePick) => pick?.kind === held?.kind && pick?.slug === held?.slug;
  const service = (one: Service): ScopeMenuRow => {
    const pick = { kind: "service", slug: one.slug } as const;
    const count = one.projects.length > 0 ? `Project ${one.projects.length}개` : "Project 없음";
    return { pick, name: serviceName(one), note: `Service · ${count}`, troubled: one.problems.length > 0, current: isHeld(pick) };
  };
  const project = (one: Pick<ProjectView, "slug" | "name" | "path">): ScopeMenuRow => {
    const pick = { kind: "project", slug: one.slug } as const;
    return { pick, name: one.name, note: `Project · ${one.path}`, troubled: false, current: isHeld(pick) };
  };
  const rows = [...services.map(service), ...(withProjects ? projects.map(project) : [])];
  const none: ScopeMenuRow = {
    pick: null,
    name: "범위 없음",
    note: projects.length > 0 ? "등록된 Project 전부" : "등록된 Project가 없어요",
    troubled: false,
    current: !rows.some((row) => row.current),
  };
  return [none, ...rows];
}

// ── 시작 단추 ───────────────────────────────────────────────────────────────────────────────────────────────────
//
// Service 화면의 시작 단추(§14)는 첫 화면(`/`)을 씨앗과 함께 연다 — 「새 작업공간」 칩 · 범위 칩 · 입력 글을 미리 넣을 뿐 보내지 않는다. 보내기는 사람이
// 한다(S16 — 사람이 말을 더할 수 있다).

/**
 * 「대화로 만들기」(§14 S16 — 목록 「새 Service ⌄」의 기본 · Service 메뉴에 Service가 하나도 없을 때의 「대화로 Service 만들기」) — 작업공간 없는
 * 채팅과 이 입력 글. Host는 등록된 Project를 읽고 초안을 말로 보인다(만드는 도구는 12).
 */
export const HOST_MAKE: NewThreadSearch = {
  new: "thread",
  say: "Service를 만들고 싶어요. 등록된 Project를 읽고 초안(이름 · Project · 설명)을 보여 주세요.",
};

/**
 * 그 Service에서 시작하는 셋(restart 03-3 · 스토리 8 · 13 · 117 · 스펙 「01a — 범위와 새 채팅」 「만드는 길」) — 목록 줄과 상세 머리의 「작업공간 만들기」
 * (그 Service를 고른 「새 작업공간」 칩 — `startSearch`) · 「새 채팅」(그 Service 범위의 작업공간 없는 채팅), 상세 Projects 묶음의 「Project 넣기」(그
 * Service를 고친다는 말을 채운 새 채팅 — 끝에 빈칸, 사람이 이어 쓴다). Runtime은 그 Service의 Project를 읽은 채 시작하고 Service 도구로 파일을 고친다.
 * 한때(03) 상세 머리에 「대화로 고치기」(「… Service를 고치고 싶어요.」)가 있었고, 「넣기」는 등록된 Project를 곧바로 넣는 메뉴였다.
 */
export function serviceStarts(service: Pick<Service, "slug" | "name">): { work: NewThreadSearch; thread: NewThreadSearch; addProject: NewThreadSearch } {
  return {
    work: startSearch("work", { service: service.slug }),
    thread: startSearch("thread", { service: service.slug }),
    addProject: { new: "thread", service: service.slug, say: `${serviceName(service)}에 Project를 넣고 싶어요. ` },
  };
}
