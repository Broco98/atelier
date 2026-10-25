import type { ReactNode } from "react";
import { Book, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { GRAPH_WIDTH, NODE_HEIGHT, NODE_WIDTH, spaceGraph, type GraphNode } from "./space-view";
import type { SharedSpace, Space } from "./types";

// 관계 그래프(03 구현 스펙 §14 · 시안 F1-SpaceDetail `.graph` · F4-SpaceEmpty) — 배치는 순수 함수(`spaceGraph`)가 짓고 여기는 그리기만 한다.
// 옅은 점 판(둥글기 16 · 1px 선) 가운데에 너비 720의 층이 서고, 노드는 그 층 위 제 자리에, 선은 층 하나를 덮는 SVG의 곡선이다. 판 아래에
// 범례와(다른 Space가 있으면) 「점선 Space를 누르면 그쪽으로 옮겨 가요」가 선다. 빈 Space는 Space 노드 하나와 「아직 Project가 없어요 ·
// 넣기」다.

export function SpaceGraph({
  space,
  shared,
  onOpenSpace,
  emptyAdd,
}: {
  space: Space;
  shared: readonly SharedSpace[];
  /** 점선 Space를 누르면 — 그 Space의 상세로 간다. */
  onOpenSpace: (slug: string) => void;
  /** 빈 Space의 「넣기」 — 넣기 메뉴를 그 자리에 세운다. */
  emptyAdd: ReactNode;
}) {
  const graph = spaceGraph(space, shared);
  const at = new Map(graph.nodes.map((node) => [node.key, node]));
  const hasOthers = graph.nodes.some((node) => node.kind === "other");
  return (
    <div
      role="img"
      aria-label={`${space.name || space.slug} Space와 Project ${space.projects.length}개의 관계`}
      className="relative overflow-hidden rounded-2xl border border-separator-soft graph-dots"
      style={{ height: graph.height }}
    >
      <div className="absolute top-0 left-1/2" style={{ width: GRAPH_WIDTH, height: graph.height, marginLeft: -GRAPH_WIDTH / 2 }}>
        <svg aria-hidden className="absolute inset-0 overflow-visible" width={GRAPH_WIDTH} height={graph.height}>
          {graph.edges.map((edge) => {
            const from = at.get(edge.from)!;
            const to = at.get(edge.to)!;
            const x1 = from.x + NODE_WIDTH / 2;
            const x2 = to.x - NODE_WIDTH / 2;
            const middle = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.from}→${edge.to}`}
                d={`M${x1} ${from.y}C${middle} ${from.y} ${middle} ${to.y} ${x2} ${to.y}`}
                fill="none"
                strokeDasharray={edge.muted ? "4 4" : undefined}
                className={cn("stroke-1", edge.muted ? "stroke-fg-placeholder" : "stroke-fg-faint")}
              />
            );
          })}
        </svg>
        {graph.nodes.map((node) => (
          <Node key={node.key} node={node} onOpenSpace={onOpenSpace} />
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
      {hasOthers && (
        <div className="absolute right-3.5 bottom-2.5 text-xs text-fg-tertiary">점선 Space를 누르면 그쪽으로 옮겨 가요</div>
      )}
    </div>
  );
}

/**
 * 노드 하나 — 36 · 둥글기 10 · 1px 선 · 흰 면(시안 `.gn`). 이 Space는 짙은 면(`.me`), 다른 Space는 점선이고 누르면 그쪽으로 간다(`.other.go`),
 * 그 Space의 다른 Project · 접힌 「외 N개」는 옅다(`.extra`).
 */
function Node({ node, onOpenSpace }: { node: GraphNode; onOpenSpace: (slug: string) => void }) {
  const style = { left: node.x - NODE_WIDTH / 2, top: node.y - NODE_HEIGHT / 2, width: NODE_WIDTH };
  const look = cn(
    "absolute flex h-9 items-center gap-1.5 rounded-lg border px-3 text-chat-meta",
    node.kind === "space" && "border-fg bg-fg font-medium text-fg-inverse shadow-card",
    (node.kind === "project" || node.kind === "extra" || node.kind === "more") && "border-border-heavy bg-surface text-fg shadow-100",
    (node.kind === "extra" || node.kind === "more") && "opacity-45 shadow-none",
    node.kind === "other" && "border-dashed border-fg-faint bg-surface text-fg transition-colors hover:border-solid hover:bg-fill-soft focus-ring",
  );
  const glyph =
    node.kind === "space" || node.kind === "other" ? (
      <Layers aria-hidden className="size-3.5 shrink-0" />
    ) : node.kind === "more" ? null : (
      <Book aria-hidden className="size-3.5 shrink-0 text-fg-icon" />
    );
  const name = <span className="min-w-0 truncate">{node.name}</span>;
  if (node.kind === "other" && node.to) {
    const to = node.to;
    return (
      <button type="button" title={`${node.name}로 옮겨 가기`} onClick={() => onOpenSpace(to)} className={look} style={style}>
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
