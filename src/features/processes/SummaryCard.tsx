import { CircleAlert, Cpu, MemoryStick, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProcessTrend } from "./hooks";
import { STALE_FIGURE } from "./tree-rows";
import {
  WEBVIEW_EXCLUDED,
  appBodyNote,
  cardFigures,
  cpuLegend,
  cpuStack,
  sparkline,
  strayFigures,
  trendLabel,
  type SparkBox,
} from "./summary-card";
import type { ProcessSnapshot, TrendPoint } from "./types";

/**
 * **`Processes` 맨 위 카드**(프로세스 결정 10 · 티켓 30 · restart 03-5 · 03-11 — 시안 Processes `.pr-cards`) — CPU 카드 하나와 그 옆에 위아래로
 * 메모리 · 손볼 것 카드다(1.7 : 1, 사이 8). 카드마다 옅은 면(`surface-under`) · `radius-card` · 0.5px `border` 안쪽 링 · 안쪽 14 · 16이고, 이름 줄
 * (12 `fg-tertiary` · 아이콘 14) → 큰 수 → 아래 줄(12 `fg-tertiary`)이다. 큰 수는 값이 멎으면 옅어진다(`STALE_FIGURE` — restart 03-9).
 *
 * - **CPU** — 큰 수는 합계 CPU(정수 — 줄을 더한 것, restart 03-6), 아래 줄이 그 눈금(코어 몇 개만큼)이다. 오른쪽에 지난 1시간 추이의 두 선
 *   (맥 전체 · 아틀리에 — 0~100 고정 축), 밑에 쌓인 막대와 범례가 그 CPU를 아틀리에 · 다른 앱 · 시스템 · 못 읽음 · 여유로 나눈다.
 * - **메모리** — 아틀리에 전체(줄과 같은 2초 스냅샷 — restart 03-5). 무엇을 셌는지(웹뷰 · WebKit 도우미)는 아래 줄의 툴팁이 말한다(S39).
 * - **손볼 것** — 주인 없이 남은 프로세스(확정 고아 · 출처 불명)의 수. 아래 「손볼 것」 구획에서 끝낸다.
 *
 * 한때 타일 넷(CPU · 메모리 합계 · 셸 · 고아)이 한 줄로 섰다(DS `.at-tiles`). **새 박자를 걸지 않는다** — 화면이 받는 스냅샷(부모가 넘긴다)을
 * 읽고, 추이만 요약이 올 때마다 한 번 묻는다(`useProcessTrend`).
 */
export default function SummaryCard({ snapshot }: { snapshot: ProcessSnapshot | undefined }) {
  const { data: trend } = useProcessTrend();
  const figures = cardFigures(snapshot);
  const legend = cpuLegend(snapshot);
  const stack = cpuStack(snapshot);
  const strays = strayFigures(snapshot);

  return (
    <section aria-label="요약" className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-2">
      <div className={cn(CARD, "gap-2.5")}>
        <div className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <CardName icon={Cpu}>CPU</CardName>
            <p data-figure="cpu" className={cn("text-heading-xl whitespace-nowrap tabular-nums", STALE_FIGURE)}>
              {figures.cpu}
            </p>
            <p data-figure="cpu-note" className={NOTE}>
              {figures.cpuNote}
            </p>
          </div>
          <Trend points={trend ?? []} />
        </div>
        {/* 쌓인 막대(시안 `.pr-stack`) — 8 · 알약 · 홈 `fill-soft` · 조각 사이 2. 폭만 400ms로 옮겨 간다(`duration-bar`). 이름이 나눔을 읽는다. */}
        <div role="img" aria-label={stack.label} data-figure="stack" className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-fill-soft">
          <StackPart width={stack.atelier} className="bg-accent-solid" />
          <StackPart width={stack.others} className="bg-fg-tertiary" />
          <StackPart width={stack.system} className="bg-fill-active" />
        </div>
        <p data-figure="legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary tabular-nums">
          <LegendItem chip="bg-accent-solid" name="아틀리에" value={legend.atelier} />
          <LegendItem chip="bg-fg-tertiary" name="다른 앱" value={legend.others} />
          <LegendItem chip="bg-fill-active" name="시스템 · 못 읽음" value={legend.system} />
          <LegendItem chip="bg-fill-soft inset-ring-[0.5px] inset-ring-border-heavy" name="여유" value={legend.idle} />
        </p>
      </div>
      <div className="grid min-w-0 grid-rows-2 gap-2">
        <div className={cn(CARD, "gap-2.5")}>
          <CardName icon={MemoryStick}>메모리</CardName>
          <p data-figure="total" className={cn(SMALL_FIGURE, STALE_FIGURE)}>
            {figures.memory}
          </p>
          {/* 툴팁은 `title`이다 — 누를 것 없는 글자라 앱 툴팁(`Hint`)의 트리거로 세우면 포커스와 역할이 새로 생긴다(`sidebar-active-band` S29). */}
          <p
            data-figure="app"
            title={snapshot ? appBodyNote(figures.webviewExcluded, snapshot.body.webkit) : undefined}
            className={NOTE}
          >
            아틀리에 전체 · 활성 상태 보기와 같은 값{figures.webviewExcluded && ` · ${WEBVIEW_EXCLUDED}`}
          </p>
        </div>
        <div className={cn(CARD, "gap-2.5")}>
          <CardName icon={CircleAlert}>손볼 것</CardName>
          <p data-figure="strays" className={cn(SMALL_FIGURE, STALE_FIGURE)}>
            {strays.count}
          </p>
          <p data-figure="strays-note" className={NOTE}>
            {strays.note}
          </p>
        </div>
      </div>
    </section>
  );
}

/** 카드 — 시안 `.pr-card`: 옅은 면 · `radius-card` · 0.5px `border` 안쪽 링 · 안쪽 14 · 16. */
const CARD = "flex min-w-0 flex-col rounded-card bg-surface-under px-4 py-3.5 inset-ring-[0.5px] inset-ring-border";

/** 카드의 아래 줄 — 12 `fg-tertiary`(시안 `.pr-sub`). */
const NOTE = "min-w-0 text-xs text-fg-tertiary";

/** 옆 카드의 큰 수 — 시안 `.pr-card.small .pr-big`(22 · 600). 앱 글자 단에 22가 없어 가까운 `heading-md`(20/26)로 선다. */
const SMALL_FIGURE = "text-heading-md whitespace-nowrap tabular-nums";

/** 카드의 이름 줄 — 12 `fg-tertiary`와 앞 아이콘 14(시안 `.pr-lab`). */
function CardName({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-tertiary">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** 쌓인 막대의 한 조각 — 폭(맥 전체 = 100의 %)만 옮겨 간다. */
function StackPart({ width, className }: { width: number; className: string }) {
  return (
    <span
      data-cpu-bar=""
      className={cn("block h-full min-w-0 transition-[width] duration-bar ease-panel", className)}
      style={{ width: `${width}%` }}
    />
  );
}

/** 범례의 한 조각 — 색 칩 8(모서리 2)과 이름 · 정수 %(`cpuLegend` — 시안 `.pr-legend`). */
function LegendItem({ chip, name, value }: { chip: string; name: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-2xs", chip)} />
      {name} {value}
    </span>
  );
}

/** 추이 칸의 상자 — 시안 `.pr-spark`(240 × 48)의 좌표다. 선은 늘어나도 1.25px 그대로다(`non-scaling-stroke`). */
const BOX: SparkBox = { width: 240, height: 48, inset: 2 };

/**
 * **지난 1시간 CPU 추이**(restart 03-11 · 스펙 「추이」 · 시안 Processes `.pr-spark`) — 두 선이 한 0~100 축에 선다(`sparkline`): 맥 전체(`fg-tertiary`)와
 * 아틀리에(`accent-solid`). 가로는 시각이라 앱을 켠 지 얼마 안 되면 선이 오른쪽에만 있다. 한때 맥 전체 한 선을 최댓값 눈금으로 채워 그렸다.
 */
function Trend({ points }: { points: ReadonlyArray<TrendPoint> }) {
  const lines = sparkline(points, BOX);
  const at = ([x, y]: [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  return (
    <svg
      role="img"
      aria-label={trendLabel(points)}
      data-figure="trend"
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      preserveAspectRatio="none"
      className="block h-12 w-60 shrink-0 overflow-visible"
    >
      {[
        { line: lines.mac, ink: "stroke-fg-tertiary", name: "mac" },
        { line: lines.atelier, ink: "stroke-accent-solid", name: "atelier" },
      ].map(
        ({ line, ink, name }) =>
          line.length > 0 && (
            <polyline
              key={name}
              data-line={name}
              points={line.map(at).join(" ")}
              fill="none"
              strokeWidth={1.25}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className={ink}
            />
          ),
      )}
    </svg>
  );
}
