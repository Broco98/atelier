import { useStore } from "@tanstack/react-store";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useProcessTrend, useSummaryCache } from "./hooks";
import { UNKNOWN, formatCpu, formatMemory } from "./metrics";
import { shellCount } from "./shell-tree";
import { WEBVIEW_EXCLUDED, appBodyNote, cardCounts, sparkline, type SparkBox } from "./summary-card";
import type { ProcessSnapshot, TrendPoint } from "./types";

/**
 * **`Processes` 맨 위 요약 카드**(프로세스 결정 10 · 티켓 30) — 합계와 지난 1시간 추이, CPU, 셸 수 · 도는 중 · 주인 잃은 셸 · 확정 고아 ·
 * 출처 불명, 앱 본체. 결정 10 그림의 「아틀리에 합계 3.4GB ▁▂▃▅▆▇ 지난 1시간 CPU 42% / 셸 12 · 도는 중 3 · …」이다.
 *
 * **새 박자를 걸지 않는다.** 화면이 이미 받는 스냅샷(부모가 넘긴다), nav 메타가 10초마다 가져오는 요약의 캐시, 스토어에서 읽는다 —
 * 어느 수를 어디서 읽는지는 `cardCounts`의 머리말. 추이만 따로 묻는데, 요약이 올 때마다 한 번이다(`useProcessTrend`).
 */
export default function SummaryCard({ snapshot }: { snapshot: ProcessSnapshot | undefined }) {
  const { data: summary } = useSummaryCache();
  const { data: trend } = useProcessTrend();
  const counts = cardCounts(useStore(terminalStore, (state) => state), snapshot);
  const known = (count: number | null) => (count === null ? UNKNOWN : String(count));

  return (
    <section aria-label="요약" className="mt-4 rounded-[12px] border bg-panel px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <p data-figure="total" className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-[12.5px] text-muted-foreground">합계</span>
          <span className="text-[18px] font-semibold tabular-nums">{formatMemory(summary?.total ?? null)}</span>
        </p>
        <Sparkline points={trend ?? []} />
        <span className="shrink-0 text-[12px] text-tertiary">지난 1시간</span>
        <span className="flex-1" />
        <p data-figure="cpu" className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-[12.5px] text-muted-foreground">CPU</span>
          <span className="text-[14px] font-medium tabular-nums">{formatCpu(summary?.cpu ?? null)}</span>
        </p>
      </div>
      {/* 수들은 한 줄에 간격으로 잇는다 — 항목마다 「이름 수」 한 조각이라 스크린리더도 목록으로 그대로 읽는다(가운뎃점을 글자로
          넣으면 그것까지 읽는다). 셸 수의 말은 「셸 N개」다(CONTEXT 「셸」). 고아는 확정 고아와 출처 불명으로 갈라 적는다(CONTEXT 「고아」). */}
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
        <li data-figure="shells">{counts.shells === null ? `셸 ${UNKNOWN}` : shellCount(counts.shells)}</li>
        <li data-figure="working">도는 중 {counts.working}</li>
        <li data-figure="orphaned-shells">주인 잃은 셸 {counts.orphanedShells}</li>
        <li data-figure="confirmed">확정 고아 {known(counts.confirmed)}</li>
        <li data-figure="unknown">출처 불명 {known(counts.unknown)}</li>
        {/* 앱 본체 — Rust 본체 + 웹뷰(WebContent). GPU · Networking은 세지 않는다는 것을 툴팁이 말한다(S39). */}
        <li data-figure="app" title={summary ? appBodyNote(summary.webviewExcluded) : undefined}>
          앱 본체 <span className="tabular-nums">{formatMemory(summary?.app ?? null)}</span>
          {summary?.webviewExcluded && <span className="ml-1.5 text-tertiary">({WEBVIEW_EXCLUDED})</span>}
        </li>
      </ul>
    </section>
  );
}

const BOX: SparkBox = { width: 120, height: 20, inset: 1.5 };

/**
 * 지난 1시간 합계 한 줄(`sparkline` — 가로는 시각, 세로는 0부터). 선은 글자 토큰의 옅은 색이다 — 강조가 아니라 흐름을 보는 줄이다.
 * 점이 하나면 선이 안 서서 끝점에 작은 점을 찍는다. 추이가 없으면(macOS 밖 · 앱이 막 떴다) 자리만 둔다.
 */
function Sparkline({ points }: { points: ReadonlyArray<TrendPoint> }) {
  const line = sparkline(points, BOX);
  const last = line[line.length - 1];
  const first = points[0];
  const end = points[points.length - 1];
  // 이름은 처음과 끝의 합계다 — 선의 모양은 눈의 것이고, 귀에는 얼마에서 얼마로 왔는지가 남는다.
  const label =
    first && end ? `지난 1시간 합계 추이, ${formatMemory(first.total)}에서 ${formatMemory(end.total)}` : "지난 1시간 합계 추이, 아직 없음";
  return (
    <svg
      role="img"
      aria-label={label}
      data-figure="trend"
      width={BOX.width}
      height={BOX.height}
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      className="shrink-0 overflow-visible text-muted-foreground"
    >
      {/* 바닥(0)을 1시간 폭 전체에 옅게 긋는다 — 앱을 켠 지 얼마 안 되어 선이 오른쪽에만 있을 때, 그 선이 1시간 중 얼마인지를
          읽게 한다. */}
      <line
        x1={0}
        x2={BOX.width}
        y1={BOX.height - BOX.inset}
        y2={BOX.height - BOX.inset}
        stroke="currentColor"
        strokeWidth={1}
        className="text-border"
      />
      {line.length > 0 && (
        <polyline
          points={line.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {last && <circle cx={last[0]} cy={last[1]} r={2} fill="currentColor" />}
    </svg>
  );
}
