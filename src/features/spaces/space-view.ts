import type { ProjectView } from "@/features/projects/types";
import type { SharedSpace, Space } from "./types";

// Space 화면이 그리는 것을 값으로 짓는 순수 함수들(03 구현 스펙 §14) — 그래프 배치 · 넣기 메뉴 · 만든 이 줄. 화면 부품은 이 값을 그리기만
// 한다(L2가 잰다).

/** 화면이 부르는 이름 — 읽을 수 없는 파일은 이름이 없어 slug다. */
export function spaceName(space: Pick<Space, "slug" | "name">): string {
  return space.name.trim() === "" ? space.slug : space.name;
}

// ── 관계 그래프 ──────────────────────────────────────────────────────────────────────────────────────────────────
//
// 시안 F1-SpaceDetail의 배치 그대로다(보드 스크립트 `layout`): 너비 720의 판에 네 열 — Space(82) · Project(262) · 다른 Space(442) ·
// 그 Space의 다른 Project(628). 노드는 너비 124 · 높이 36이다. Project는 가운데 줄(y 104)을 두고 50 간격으로 퍼지고, 다른 Space는
// 겹치는 Project들의 가운데에 서되 앞 Space와 50보다 가까우면 아래로 밀린다.
//
// 시안이 그리지 않은 많을 때(스펙 「위험 — 관계 그래프의 배치」): 한 열이 일곱을 넘으면 여섯과 「외 N개」로 접고, 판은 노드만큼 길어진다.
// 다른 Space의 겹치지 않는 Project는 그 Space 곁 한 노드다 — 여럿이면 「backoffice 외 1개」로 접어 이웃 Space의 노드와 겹치지 않는다.

export const GRAPH_WIDTH = 720;
export const NODE_WIDTH = 124;
export const NODE_HEIGHT = 36;
const COLUMNS = [82, 262, 442, 628] as const;
/** 판의 기본 키 · 가운데 줄 — 시안 그대로. */
const BASE_HEIGHT = 236;
const MIDDLE = 104;
const GAP = 50;
/** 첫 노드의 가운데가 판 위에서 떨어지는 가장 작은 값 — 노드 반 높이 18 + 여백 18. */
const TOP = 36;
/** 마지막 노드 아래로 남기는 자리 — 범례 줄(아래 10 · 글 16)과 그 위 여백. */
const BOTTOM_ROOM = 64;
/** 한 열에 서는 노드의 끝 — 넘으면 앞 여섯과 「외 N개」다. */
const COLUMN_LIMIT = 7;

export type GraphNodeKind = "space" | "project" | "other" | "extra" | "more";

export interface GraphNode {
  key: string;
  kind: GraphNodeKind;
  name: string;
  /** 노드 가운데의 자리. */
  x: number;
  y: number;
  /** 점선 Space면 그 Space의 slug — 누르면 그쪽으로 옮겨 간다. */
  to?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** 다른 Space로 이어지는 점선. */
  muted: boolean;
}

export interface SpaceGraph {
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

export function spaceGraph(space: Space, shared: readonly SharedSpace[]): SpaceGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const projects = fold(space.projects);
  const columnSize = projects.shown.length + (projects.folded.length > 0 ? 1 : 0);
  const middle = Math.max(MIDDLE, TOP + ((columnSize - 1) * GAP) / 2);

  const me: GraphNode = { key: `s:${space.slug}`, kind: "space", name: spaceName(space), x: COLUMNS[0], y: middle };
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

  // 다른 Space — 겹치는 Project 노드들의 가운데, 위에서부터 차례로, 앞 것과 50은 띄운다.
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
    const extra = other.projects.filter((slug) => !space.projects.includes(slug));
    if (extra.length > 0) {
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
  return { height: Math.max(BASE_HEIGHT, lowest + NODE_HEIGHT / 2 + BOTTOM_ROOM), nodes, edges };
}

// ── 넣기 메뉴 ────────────────────────────────────────────────────────────────────────────────────────────────────

/** 「넣기」 메뉴의 줄 — 아직 묶이지 않은 등록된 Project(등록부 차례). 다 넣었으면 그렇다고 말한다(스토리 152 · 153). */
export function addMenu(space: Pick<Space, "projects">, registered: readonly ProjectView[]) {
  const candidates = registered.filter((project) => !space.projects.includes(project.slug));
  return { candidates, allIn: candidates.length === 0 };
}

// ── 만든 이 · 만든 때 ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 상세 제목 아래 줄(스토리 144) — 만든 이(`createdBy: host`면 Host와 만듦 · H 얼굴, 아니면 직접 만듦)와 만든 때. 파일의 `createdAt`은
 * 날짜라 때는 날 단위다 — 오늘 · 어제 · N일 전(한 달 안), 그보다 오래면 날짜다.
 */
export function createdLine(space: Pick<Space, "createdAt" | "createdBy">, now: Date) {
  const host = space.createdBy === "host";
  return { host, by: host ? "Host와 만듦" : "직접 만듦", when: daysAgo(space.createdAt, now) };
}

function daysAgo(createdAt: string, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(createdAt);
  if (!match) return "";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const then = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 30) return `${days}일 전`;
  return `${year}. ${month}. ${day}.`;
}
