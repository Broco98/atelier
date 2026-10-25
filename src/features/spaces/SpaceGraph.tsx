import type { ReactNode } from "react";
import { Book, Layers } from "lucide-react";
import { particle } from "@/lib/particle";
import { cn } from "@/lib/utils";
import { DETAIL_GRAPH, NODE_HEIGHT, spaceGraph, type GraphLayout, type GraphNode } from "./space-view";
import type { SharedSpace, Space } from "./types";

// 관계 그래프(03 구현 스펙 §14 · 시안 F1-SpaceDetail `.graph` · F4-SpaceEmpty) — 배치는 순수 함수(`spaceGraph`)가 짓고 여기는 그리기만 한다.
// 옅은 점 판(둥글기 16 · 1px 선) 가운데에 배치 폭(상세 720)의 층이 서고, 노드는 그 층 위 제 자리에, 선은 층 하나를 덮는 SVG의 곡선이다. 판
// 아래에 범례와(다른 Space가 있으면) 「점선 Space를 누르면 그쪽으로 옮겨 가요」가 선다. 빈 Space는 Space 노드 하나와 「아직 Project가
// 없어요 · 넣기」다.
//
// 고치기 화면의 미리보기 카드(§13 · 시안 F1-SpaceEdit)도 같은 그림이다 — 카드 배치(`CARD_GRAPH`)로, 카드 조각이라 판의 테두리 · 둥글기가
// 없고, 미리보기라 점선 Space를 눌러 옮겨 가지 않는다(안내 줄도 없다).

export function SpaceGraph({
  space,
  shared,
  onOpenSpace,
  emptyAdd,
  layout = DETAIL_GRAPH,
  tinted = false,
}: {
  space: Space;
  shared: readonly SharedSpace[];
  /** 점선 Space를 누르면 — 그 Space의 상세로 간다. 없으면 점선 Space는 누르지 않는 노드다(미리보기). */
  onOpenSpace?: (slug: string) => void;
  /** 빈 Space의 「넣기」 — 넣기 메뉴를 그 자리에 세운다. */
  emptyAdd?: ReactNode;
  /** 배치 — 상세(기본) · 고치기 화면의 카드(`CARD_GRAPH` — 카드 조각이라 판의 겉이 없다). */
  layout?: GraphLayout;
  /** 고치기 화면에서 커서가 projects 줄에 있다 — 판에 옅은 파랑을 덮는다(시안 `.lk.g.on .graph`). */
  tinted?: boolean;
}) {
  const graph = spaceGraph(space, shared, layout);
  const at = new Map(graph.nodes.map((node) => [node.key, node]));
  const hasOthers = graph.nodes.some((node) => node.kind === "other");
  const card = layout !== DETAIL_GRAPH;
  const half = layout.nodeWidth / 2;
  return (
    <div
      role="img"
      aria-label={`${space.name || space.slug} Space와 Project ${space.projects.length}개의 관계`}
      className={cn("relative overflow-hidden graph-dots", !card && "rounded-2xl border border-separator-soft")}
      style={{ height: graph.height }}
    >
      {tinted && <div aria-hidden className="absolute inset-0 bg-piece-soft" />}
      <div className="absolute top-0 left-1/2" style={{ width: layout.width, height: graph.height, marginLeft: -layout.width / 2 }}>
        <svg aria-hidden className="absolute inset-0 overflow-visible" width={layout.width} height={graph.height}>
          {graph.edges.map((edge) => {
            const from = at.get(edge.from)!;
            const to = at.get(edge.to)!;
            const x1 = from.x + half;
            const x2 = to.x - half;
            const middle = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.from}→${edge.to}`}
                d={`M${x1} ${from.y}C${middle} ${from.y} ${middle} ${to.y} ${x2} ${to.y}`}
                fill="none"
                strokeDasharray={edge.muted ? "4 4" : undefined}
                className={cn("stroke-1", edge.muted ? "stroke-graph-edge-muted" : "stroke-graph-edge")}
              />
            );
          })}
        </svg>
        {graph.nodes.map((node) => (
          <Node key={node.key} node={node} width={layout.nodeWidth} onOpenSpace={onOpenSpace} />
        ))}
      </div>
      {space.projects.length === 0 && (
        <div className="absolute top-1/2 left-1/2 flex -translate-x-1/4 -translate-y-1/2 items-center gap-2.5 text-chat-meta whitespace-nowrap text-fg-secondary">
          아직 Project가 없어요
          {emptyAdd}
        </div>
      )}
      <div className="absolute bottom-2.5 left-3.5 flex items-center gap-3.5 text-xs text-fg-tertiary">
        <span className="flex items-center gap-1.5">
          <i aria-hidden className="inline-block w-4.5 border-t border-fg-faint" />이 Space에 들어 있음
        </span>
        <span className="flex items-center gap-1.5">
          <i aria-hidden className="inline-block w-4.5 border-t border-dashed border-fg-faint" />
          다른 Space에서도 씀
        </span>
      </div>
      {hasOthers && onOpenSpace && (
        <div className="absolute right-3.5 bottom-2.5 text-xs text-fg-tertiary">점선 Space를 누르면 그쪽으로 옮겨 가요</div>
      )}
    </div>
  );
}

/**
 * 노드 하나 — 36 · 둥글기 10 · 1px 선 · 흰 면(시안 `.gn`). 이 Space는 짙은 면(`.me`), 다른 Space는 점선이고 누르면 그쪽으로 간다(`.other.go`),
 * 그 Space의 다른 Project · 접힌 「외 N개」는 옅다(`.extra`).
 */
function Node({ node, width, onOpenSpace }: { node: GraphNode; width: number; onOpenSpace?: (slug: string) => void }) {
  const style = { left: node.x - width / 2, top: node.y - NODE_HEIGHT / 2, width };
  const look = cn(
    "absolute flex h-9 items-center gap-1.5 rounded-lg border px-3 text-chat-meta",
    node.kind === "space" && "border-fg bg-fg font-medium text-fg-inverse shadow-card",
    (node.kind === "project" || node.kind === "extra" || node.kind === "more") && "border-border-heavy bg-surface text-fg shadow-100",
    (node.kind === "extra" || node.kind === "more") && "opacity-45 shadow-none",
    node.kind === "other" && "border-dashed border-fg-faint bg-surface text-fg",
    node.kind === "other" && onOpenSpace && "transition-colors hover:border-solid hover:bg-fill-soft focus-ring",
  );
  const glyph =
    node.kind === "space" || node.kind === "other" ? (
      <Layers aria-hidden className="size-3.5 shrink-0" />
    ) : node.kind === "more" ? null : (
      <Book aria-hidden className="size-3.5 shrink-0 text-fg-icon" />
    );
  const name = <span className="min-w-0 truncate">{node.name}</span>;
  if (node.kind === "other" && node.to && onOpenSpace) {
    const to = node.to;
    return (
      <button type="button" title={`${node.name}${particle(node.name, "으로", "로")} 옮겨 가기`} onClick={() => onOpenSpace(to)} className={look} style={style}>
        {glyph}
        {name}
      </button>
    );
  }
  return (
    <div className={look} style={style} title={node.name}>
      {glyph}
      {name}
    </div>
  );
}
