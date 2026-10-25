import type { ProjectView } from "@/features/projects/types";
import type { NewThreadSearch } from "@/routes/-new-thread-search";
import type { SharedSpace, Space } from "./types";

// Space 화면이 그리는 것을 값으로 짓는 순수 함수들(03 구현 스펙 §14) — 그래프 배치 · 넣기 메뉴 · 만든 이 줄 · Work 묶음 · 시작 단추가 여는
// 첫 화면, 그리고 Work 화면 머리 · Space 칩이 여는 Space 메뉴(§5 · §10). 화면 부품은 이 값을 그리기만 한다(L2가 잰다).

/** 화면이 부르는 이름 — 읽을 수 없는 파일은 이름이 없어 slug다. */
export function spaceName(space: Pick<Space, "slug" | "name">): string {
  return space.name.trim() === "" ? space.slug : space.name;
}

// ── 관계 그래프 ──────────────────────────────────────────────────────────────────────────────────────────────────
//
// 시안 F1-SpaceDetail의 배치 그대로다(보드 스크립트 `layout`): 너비 720의 판에 네 열 — Space(82) · Project(262) · 다른 Space(442) ·
// 그 Space의 다른 Project(628). 노드는 너비 124 · 높이 36이다. 고치기 화면의 미리보기 카드는 같은 규칙을 좁은 판에 세 열로 그린다
// (`CARD_GRAPH`). Project는 가운데 줄(y 104)을 두고 50 간격으로 퍼지고, 다른 Space는
// 겹치는 Project들의 가운데에 서되 앞 Space와 50보다 가까우면 아래로 밀린다.
//
// 시안이 그리지 않은 많을 때(스펙 「위험 — 관계 그래프의 배치」): 한 열이 일곱을 넘으면 여섯과 「외 N개」로 접고, 판은 노드만큼 길어진다.
// 다른 Space의 겹치지 않는 Project는 그 Space 곁 한 노드다 — 여럿이면 「backoffice 외 1개」로 접어 이웃 Space의 노드와 겹치지 않는다.

export const NODE_HEIGHT = 36;

/**
 * 그래프 판 하나의 배치 — 층의 폭 · 열의 가운데 x · 노드 폭 · 판의 기본 키 · 마지막 노드 아래로 남기는 자리(범례 줄과 그 위 여백). 넷째
 * 열이 없으면 다른 Space의 다른 Project를 그리지 않는다.
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

export function spaceGraph(space: Space, shared: readonly SharedSpace[], layout: GraphLayout = DETAIL_GRAPH): SpaceGraph {
  const COLUMNS = layout.columns;
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
 * Space 목록 판이 그리는 것(§14 · S15 · §8) — 목록을 읽지 못했으면 그 까닭(`error`), 다 읽어 Space가 없으면 안내 한 줄과 「새 Space」
 * (`empty`), 그 밖(읽는 중 포함)은 표다. 읽을 수 없는 파일 하나는 목록을 깨지 않고 그 줄만 「문제 있음」으로 선다(core).
 */
export function listShows(list: { isPending: boolean; isError: boolean; count: number }): "error" | "empty" | "table" {
  if (list.isError) return "error";
  return !list.isPending && list.count === 0 ? "empty" : "table";
}

// ── 넣기 메뉴 ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 「넣기」 메뉴의 줄 — 아직 묶이지 않은 등록된 Project(등록부 차례). 넣을 것이 없으면 그 까닭 한 줄(`note`) — 다 넣었으면 「등록된 Project를
 * 모두 넣었어요」(스토리 152 · 153), 등록된 Project가 하나도 없으면 「등록된 Project가 없어요」(Space 메뉴의 같은 갈래 글 — 03 결정 05).
 */
export function addMenu(space: Pick<Space, "projects">, registered: readonly ProjectView[]) {
  const candidates = registered.filter((project) => !space.projects.includes(project.slug));
  const note = candidates.length > 0 ? null : registered.length === 0 ? "등록된 Project가 없어요" : "등록된 Project를 모두 넣었어요";
  return { candidates, note };
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

// ── Space 메뉴 ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Space 메뉴의 Space 한 줄 — 이름 · 적힌 Project(「web-app · api-server」) · 문제 있음 · 지금 것(✓). */
export interface SpaceMenuRow {
  slug: string;
  name: string;
  projects: string;
  troubled: boolean;
  current: boolean;
}

export interface SpaceMenu {
  /**
   * 맨 위 줄 — Space가 있으면 「Space 빼기」, 없으면 지금 것인 「Space 없음」(✓)이다. 곁말은 빼면 읽는 것(「등록된 Project 3개를 모두
   * 읽어요」)이다.
   */
  top: { label: "Space 빼기" | "Space 없음"; note: string; current: boolean };
  /** 「Space — 고르면 그 안의 Project만 읽어요」 아래의 줄들 — Space가 하나도 없으면 `null`이고 그 자리에 「Host와 Space 만들기」가 선다. */
  rows: SpaceMenuRow[] | null;
}

/**
 * Space 메뉴(시안 F4-WorkSpaced · F4-WorkNoSpace — Work 화면 머리 줄이 열고, 트레이의 Space 칩이 같은 부품을 쓴다). `current`는 지금 이은
 * Space의 slug다 — 그 파일이 없으면 Space가 없는 것이다(§7 규칙 1). 문제 있는 Space도 선다 — 고르면 읽을 수 있는 Project만 읽는다(§5). 적힌
 * Project는 등록되지 않은 것도 적힌 그대로다(파일의 말).
 *
 * 맨 위 줄은 여는 자리(`place`)를 따른다 — Work 화면(`work`)은 Space가 있으면 「Space 빼기 · 등록된 Project 3개를 모두 읽어요」, Space 칩
 * (`chip` — F4-KitComposer 「Space 칩 메뉴」)은 늘 고르는 줄 「Space 없음 · 등록된 Project 3개 읽기」다(빼기는 칩의 ×가 한다).
 */
export function spaceMenu(
  spaces: readonly Space[],
  current: string | null,
  registered: number,
  place: "work" | "chip" = "work",
): SpaceMenu {
  const on = spaces.some((one) => one.slug === current) ? current : null;
  const reads = place === "chip" ? "개 읽기" : "개를 모두 읽어요";
  const note = registered > 0 ? `등록된 Project ${registered}${reads}` : "등록된 Project가 없어요";
  return {
    top: on && place === "work" ? { label: "Space 빼기", note, current: false } : { label: "Space 없음", note, current: on === null },
    rows:
      spaces.length === 0
        ? null
        : spaces.map((one) => ({
            slug: one.slug,
            name: spaceName(one),
            projects: one.projects.length > 0 ? one.projects.join(" · ") : "Project 없음",
            troubled: one.problems.length > 0,
            current: one.slug === on,
          })),
  };
}

// ── 시작 단추 ───────────────────────────────────────────────────────────────────────────────────────────────────
//
// Space 화면의 시작 단추(§14)는 첫 화면(`/`)을 씨앗과 함께 연다 — Work 칩 · Space 칩 · 입력 글을 미리 넣을 뿐 보내지 않는다. 보내기는 사람이
// 한다(S16 — 사람이 말을 더할 수 있다).

/**
 * 「Host와 만들기」(§14 S16 — 목록 「새 Space ⌄」의 기본 · Space 메뉴에 Space가 하나도 없을 때의 「Host와 Space 만들기」) — Work 칩 「Work 없이
 * 대화」와 이 입력 글. Host는 등록된 Project를 읽고 초안을 말로 보인다(만드는 도구는 12).
 */
export const HOST_MAKE: NewThreadSearch = {
  new: "thread",
  say: "Space를 만들고 싶어요. 등록된 Project를 읽고 초안(이름 · Project · 설명)을 보여 주세요.",
};

/**
 * Space 상세 머리의 둘(§14) — 「새 Work」는 Work 칩 「새 Work」 · Space 칩 「◇ 결제 서비스 ×」(스토리 159), 「Host와 고치기」(S17)는 그 Space를
 * 붙인 Work 없는 대화에 고쳐 달라는 말(끝에 빈칸 — 사람이 이어 쓴다)이다. Host는 그 Space의 Project를 읽은 채 시작한다.
 */
export function spaceStarts(space: Pick<Space, "slug" | "name">): { newWork: NewThreadSearch; hostEdit: NewThreadSearch } {
  return {
    newWork: { new: "work", space: space.slug },
    hostEdit: { new: "thread", space: space.slug, say: `${spaceName(space)} Space를 고치고 싶어요. ` },
  };
}

// ── Work 묶음 ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Space 상세의 「Work」 묶음(§14) — 이 Space에 이은 진행 중인 Work(`work.json`의 `space`), Work 목록의 차례 그대로다. 보관한 Work는 목록에 없다.
 */
export function spaceWorks<W extends { space?: string }>(works: readonly W[], slug: string): W[] {
  return works.filter((work) => work.space === slug);
}
