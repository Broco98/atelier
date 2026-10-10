import { useStore } from "@tanstack/react-store";
import { CircleAlert, Cpu, MemoryStick, SquareTerminal, type LucideIcon } from "lucide-react";
import { terminalStore } from "@/features/terminal/terminal-store";
import { cn } from "@/lib/utils";
import { useProcessTrend, useSummaryCache } from "./hooks";
import { NOT_READ, formatCpu, formatMemory } from "./metrics";
import { WEBVIEW_EXCLUDED, appBodyNote, cardCounts, sparkline, trendLabel, type SparkBox } from "./summary-card";
import type { ProcessSnapshot, TrendPoint } from "./types";

/**
 * **`Processes` 맨 위 요약 카드**(프로세스 결정 10 · 티켓 30) — 합계와 지난 1시간 추이, CPU, 셸 수 · 도는 중 · 주인 잃은 셸 · 확정 고아 ·
 * 출처 불명, 앱 본체.
 *
 * **타일 넷이다**(ui-refresh 결정 16 · 「같은 날 더 정한 것」 Processes 다시 그림, DS `.at-pr-tiles`): 메모리 합계(넓다 — 오른쪽 칸이 추이)
 * · CPU · 셸 · 고아. 타일마다 이름 줄 → 큰 수 → 아래 줄이고, 옅은 면(`surface-under`)이다. 수를 무엇으로 세는지는 그대로다.
 *
 * **새 박자를 걸지 않는다.** 화면이 이미 받는 스냅샷(부모가 넘긴다), nav 메타가 10초마다 가져오는 요약의 캐시, 스토어에서 읽는다 —
 * 어느 수를 어디서 읽는지는 `cardCounts`의 머리말. 추이만 따로 묻는데, 요약이 올 때마다 한 번이다(`useProcessTrend`).
 */
export default function SummaryCard({ snapshot }: { snapshot: ProcessSnapshot | undefined }) {
  const { data: summary } = useSummaryCache();
  const { data: trend } = useProcessTrend();
  const counts = cardCounts(useStore(terminalStore, (state) => state), snapshot);
  // 못 센 수(스냅샷 전)는 「—」다 — 「0」이면 모르는 것을 없다고 한다.
  const countOrDash = (count: number | null) => (count === null ? NOT_READ : String(count));
  // 고아(CONTEXT 「고아」)는 확정 고아와 출처 불명을 함께 부르는 말이다 — 고아 타일의 큰 수가 그 합이다.
  const strays = counts.confirmed === null || counts.unknown === null ? null : counts.confirmed + counts.unknown;

  return (
    <section aria-label="요약" className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-2">
      {/* 넓은 타일 — 왼쪽이 이름 · 큰 수 · 아래 줄, 오른쪽 칸 전체가 추이다(DS `.at-pr-tile.wide`). */}
      <div className={cn(TILE, "flex-row items-end gap-6")}>
        <div className="flex shrink-0 flex-col gap-0.5">
          <TileName icon={MemoryStick}>메모리 합계</TileName>
          <Figure data-figure="total" text={formatMemory(summary?.total ?? null)} />
          {/* 앱 본체 — Rust 본체 + 웹뷰(WebContent). GPU · Networking은 세지 않는다는 것을 툴팁이 말한다(S39). 툴팁은 `title`이다 —
              누를 것 없는 글자라 앱 툴팁(`Hint`)의 트리거로 세우면 포커스와 역할이 새로 생긴다(`sidebar-active-band` S29와 같은 까닭). */}
          <p data-figure="app" title={summary ? appBodyNote(summary.webviewExcluded) : undefined} className={TILE_NOTE}>
            앱 본체 <span className="tabular-nums">{formatMemory(summary?.app ?? null)}</span>
            {summary?.webviewExcluded && <span className="ml-1.5 text-fg-tertiary">({WEBVIEW_EXCLUDED})</span>}
          </p>
        </div>
        <Trend points={trend ?? []} />
      </div>
      {/* CPU는 아래 줄이 없다 — 10초 요약의 값이라 「지금」이라 적으면 2초 화면과 섞여 읽힌다(판 06 문구 표 R3). */}
      <div className={TILE}>
        <TileName icon={Cpu}>CPU</TileName>
        <Figure data-figure="cpu" text={formatCpu(summary?.cpu ?? null)} />
      </div>
      {/* 셸 수는 풀의 셸이다(화면 밖 셸까지) — 세는 말 「셸 N개」(CONTEXT 「셸」)가 이름 줄과 큰 수로 갈려 선다. 아래 줄의 두 수는
          스토어의 것이다. 가운뎃점은 눈의 것이라 읽지 않는다. */}
      <div className={TILE}>
        <TileName icon={SquareTerminal}>셸</TileName>
        <Figure data-figure="shells" text={counts.shells === null ? NOT_READ : `${counts.shells}개`} />
        <p className={TILE_NOTE}>
          <span data-figure="working">도는 중 {counts.working}</span>
          <Dot />
          <span data-figure="ownerless-shells">주인 잃은 셸 {counts.ownerlessShells}</span>
        </p>
      </div>
      {/* 고아는 확정 고아와 출처 불명의 합이고, 아래 줄이 둘을 갈라 적는다(CONTEXT 「고아」, 판 06 문구 표 R4). 하나라도 있으면 기다림
          점(`dot-wait`)이 선다 — 손볼 것이 있다는 표시라 nav 메타의 점과 같은 색이다. */}
      <div className={TILE}>
        <TileName icon={CircleAlert}>고아</TileName>
        <Figure text={strays === null ? NOT_READ : `${strays}개`} />
        <p className={TILE_NOTE}>
          {strays !== null && strays > 0 && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-dot-wait" />}
          <span data-figure="confirmed">확정 고아 {countOrDash(counts.confirmed)}</span>
          <Dot />
          <span data-figure="unknown">출처 불명 {countOrDash(counts.unknown)}</span>
        </p>
      </div>
    </section>
  );
}

/** 타일 하나 — 옅은 면(DS `.at-pr-tile`). 넓은 타일(메모리 합계)은 이것을 가로로 눕혀 오른쪽에 추이를 둔다. */
const TILE = "flex min-w-0 flex-col gap-0.5 rounded-2xl bg-surface-under px-4.5 pt-3.5 pb-4";

/** 타일의 아래 줄 — 수 조각을 6px 틈으로 잇는다. */
const TILE_NOTE = "flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-fg-secondary";

function TileName({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary">
      <Icon aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
      {children}
    </span>
  );
}

/** 아래 줄의 가운뎃점 — 눈으로 조각을 가른다. 스크린리더는 조각만 읽는다. */
function Dot() {
  return <span aria-hidden>·</span>;
}

/**
 * 타일의 큰 수 — 숫자는 크게, 단위(`GB` · `%` · `개`)는 작게 그린다. **글자는 이어 붙는다**: 요소의 글자가 표기 함수의 결과
 * (`formatMemory` · `formatCpu`) 그대로라, nav 옆 숫자와 같은 글자를 L3가 이 요소에서 읽는다. 못 읽은 값(「—」)은 단위가 없다.
 */
function Figure({ text, ...rest }: { text: string; "data-figure"?: string }) {
  const [, value = text, unit = ""] = /^(.*\d)(\D*)$/.exec(text) ?? [];
  return (
    <p className="mt-1.5 text-heading-lg whitespace-nowrap tabular-nums" {...rest}>
      {value}
      {unit && <span className="ml-0.5 text-sm font-medium text-fg-secondary">{unit}</span>}
    </p>
  );
}

/**
 * 추이 칸의 상자 — 그리는 좌표의 폭과 높이(px), 선 두께 때문에 위아래로 비우는 안쪽 여백. 폭은 좌표일 뿐이다: 그림은 칸의 폭으로
 * 늘어나고(`preserveAspectRatio="none"`) 선은 늘어나도 1.5px 그대로다(`non-scaling-stroke`). 높이는 칸의 높이(48) 그대로다.
 */
const BOX: SparkBox = { width: 400, height: 48, inset: 1.5 };

/**
 * 지난 1시간 합계(`sparkline` — 가로는 시각, 세로는 0부터) — 넓은 타일의 오른쪽 칸을 채운다(DS `.at-pr-tile.wide .chart`). 선은
 * Codex `accent`이고 그 밑을 옅게 채운다. 바닥(0)은 1시간 폭 전체에 긋는다 — 앱을 켠 지 얼마 안 되어 선이 오른쪽에만 있을 때, 그 선이
 * 1시간 중 얼마인지를 읽게 한다. 축 양끝이 「지난 1시간」 · 「지금」이다(판 06 문구 표 R2).
 *
 * 끝점은 그림 밖의 점이다 — 그림은 가로로 늘어나서 그 안의 원은 타원이 된다. 점이 하나면 선이 안 서서 끝점만 선다. 추이가 없으면
 * (macOS 밖 · 앱이 막 떴다) 바닥과 축만 선다.
 */
function Trend({ points }: { points: ReadonlyArray<TrendPoint> }) {
  const line = sparkline(points, BOX);
  const first = line[0];
  const last = line[line.length - 1];
  const floor = BOX.height - BOX.inset;
  const at = ([x, y]: [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  // 채움은 선 밑에서 바닥까지다 — 선의 끝점 둘을 바닥으로 내려 닫는다.
  const area: Array<[number, number]> = first && last ? [...line, [last[0], floor], [first[0], floor]] : [];
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-end gap-1 self-stretch">
      <div className="relative h-12">
        <svg
          role="img"
          // 이름은 그린 점의 처음과 끝 합계다(`trendLabel`) — 선과 같은 구간이다.
          aria-label={trendLabel(points)}
          data-figure="trend"
          viewBox={`0 0 ${BOX.width} ${BOX.height}`}
          preserveAspectRatio="none"
          className="block size-full overflow-visible"
        >
          <line
            x1={0}
            x2={BOX.width}
            y1={floor}
            y2={floor}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className="stroke-border"
          />
          {line.length > 1 && <polygon points={area.map(at).join(" ")} className="fill-(--accent)/8" />}
          {line.length > 0 && (
            <polyline
              points={line.map(at).join(" ")}
              fill="none"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-(--accent)"
            />
          )}
        </svg>
        {last && (
          <span
            aria-hidden
            className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--accent)"
            style={{ left: `${(last[0] / BOX.width) * 100}%`, top: last[1] }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-fg-tertiary">
        <span>지난 1시간</span>
        <span>지금</span>
      </div>
    </div>
  );
}
