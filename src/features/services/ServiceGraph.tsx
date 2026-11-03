import { Book, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_HEIGHT, serviceGraph, type GraphLayout, type GraphNode } from "./service-view";
import type { SharedService, Service } from "./types";

// 관계 그래프(03 구현 스펙 §13 · 시안 F1-SpaceEdit) — 파일로 고치기 화면의 미리보기 카드가 그린다. 배치는 순수 함수(`serviceGraph`)가 짓고 여기는
// 그리기만 한다. 옅은 점 판 가운데에 배치 폭의 층이 서고, 노드는 그 층 위 제 자리에, 선은 층 하나를 덮는 SVG의 곡선이다. 판 아래에 범례가 선다.
// 빈 Service는 Service 노드 하나와 「아직 Project가 없어요」다. 미리보기라 점선 Service는 누르지 않는 노드다.
//
// 한때(03) Service 상세도 이 그래프를 그렸다(판 720 · 둥글기 16 · 점선 Service를 누르면 그쪽으로 · 빈 Service의 「넣기」). restart 03-3이 상세에서
// 지웠다 — 같은 것을 Projects · 함께 쓰는 Service 묶음이 보인다(스펙 「03 — 목록과 상세」).

export function ServiceGraph({
  service,
  shared,
  layout,
  tinted = false,
}: {
  service: Service;
  shared: readonly SharedService[];
  /** 배치 — 고치기 화면의 카드(`CARD_GRAPH` — 카드 조각이라 판의 겉이 없다). */
  layout: GraphLayout;
  /** 고치기 화면에서 커서가 projects 줄에 있다 — 판에 옅은 파랑을 덮는다(시안 `.lk.g.on .graph`). */
  tinted?: boolean;
}) {
  const graph = serviceGraph(service, shared, layout);
  const at = new Map(graph.nodes.map((node) => [node.key, node]));
  const half = layout.nodeWidth / 2;
  return (
    <div
      role="img"
      aria-label={`${service.name || service.slug} Service와 Project ${service.projects.length}개의 관계`}
      className="relative overflow-hidden graph-dots"
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
          <Node key={node.key} node={node} width={layout.nodeWidth} />
        ))}
      </div>
      {service.projects.length === 0 && (
        <div className="absolute top-1/2 left-1/2 flex -translate-x-1/4 -translate-y-1/2 items-center gap-2.5 text-chat-meta whitespace-nowrap text-fg-secondary">
          아직 Project가 없어요
        </div>
      )}
      <div className="absolute bottom-2.5 left-3.5 flex items-center gap-3.5 text-xs text-fg-tertiary">
        <span className="flex items-center gap-1.5">
          <i aria-hidden className="inline-block w-4.5 border-t border-fg-faint" />이 Service에 들어 있음
        </span>
        <span className="flex items-center gap-1.5">
          <i aria-hidden className="inline-block w-4.5 border-t border-dashed border-fg-faint" />
          다른 Service에서도 씀
        </span>
      </div>
    </div>
  );
}

/**
 * 노드 하나 — 36 · 둥글기 10 · 1px 선 · 흰 면(시안 `.gn`). 이 Service는 짙은 면(`.me`), 다른 Service는 점선(`.other`), 그 Service의 다른 Project ·
 * 접힌 「외 N개」는 옅다(`.extra`).
 */
function Node({ node, width }: { node: GraphNode; width: number }) {
  const style = { left: node.x - width / 2, top: node.y - NODE_HEIGHT / 2, width };
  const look = cn(
    "absolute flex h-9 items-center gap-1.5 rounded-lg border px-3 text-chat-meta",
    node.kind === "service" && "border-fg bg-fg font-medium text-fg-inverse shadow-card",
    (node.kind === "project" || node.kind === "extra" || node.kind === "more") && "border-border-heavy bg-surface text-fg shadow-100",
    (node.kind === "extra" || node.kind === "more") && "opacity-45 shadow-none",
    node.kind === "other" && "border-dashed border-fg-faint bg-surface text-fg",
  );
  const glyph =
    node.kind === "service" || node.kind === "other" ? (
      <Layers aria-hidden className="size-3.5 shrink-0" />
    ) : node.kind === "more" ? null : (
      <Book aria-hidden className="size-3.5 shrink-0 text-fg-icon" />
    );
  return (
    <div className={look} style={style} title={node.name}>
      {glyph}
      <span className="min-w-0 truncate">{node.name}</span>
    </div>
  );
}
