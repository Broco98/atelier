import { useStore } from "@tanstack/react-store";
import { CircleAlert, Cpu, MemoryStick, SquareTerminal, type LucideIcon } from "lucide-react";
import { terminalStore } from "@/features/terminal/terminal-store";
import { cn } from "@/lib/utils";
import { useProcessTrend } from "./hooks";
import { NOT_READ } from "./metrics";
import { STALE_FIGURE } from "./tree-rows";
import {
  WEBVIEW_EXCLUDED,
  appBodyNote,
  cardCounts,
  cardFigures,
  cpuLegend,
  sparkline,
  trendLabel,
  type SparkBox,
} from "./summary-card";
import type { ProcessSnapshot, TrendPoint } from "./types";

/**
 * **`Processes` 맨 위 요약 카드**(프로세스 결정 10 · 티켓 30 · restart 03-5) — 맥 전체 CPU와 지난 1시간 추이, 아틀리에 CPU, 메모리 합계 ·
 * 앱 본체, 셸 수 · 도는 중 · 주인 잃은 셸 · 확정 고아 · 출처 불명.
 *
 * **타일 넷이다**(DS `ProcessTree` · `.at-tiles` · `.at-tile`, codex-ds 티켓 22): CPU · 메모리 합계 · 셸 · 고아. 같은 폭의 칸 다섯에
 * 10씩 떨어져 한 줄로 서고, CPU가 두 칸을 차지한다(그 오른쪽이 추이 — restart 03-5: 추이의 점이 CPU라 한때의 메모리 합계 타일에서
 * 옮겼다). 타일마다 이름 줄 → 큰 수 → 아래 줄이고, 옅은 면(`surface-under`) · `radius-xl` · 0.5px `border` 안쪽 링 · 안쪽 14 · 16이다.
 * 시안의 마감(두 선 · 0~100 축 · 쌓인 막대)은 03-11이다.
 *
 * **새 박자를 걸지 않는다.** 화면이 이미 받는 스냅샷(부모가 넘긴다)과 스토어에서 읽는다 — **머리와 메모리 카드는 줄과 같은 2초
 * 스냅샷이다**(restart 03-5 「한 표본」 — `cardFigures`). 어느 수를 어디서 읽는지는 `summary-card.ts`의 머리말. 추이만 따로 묻는데,
 * 요약이 올 때마다 한 번이다(`useProcessTrend`).
 */
export default function SummaryCard({ snapshot }: { snapshot: ProcessSnapshot | undefined }) {
  const { data: trend } = useProcessTrend();
  const figures = cardFigures(snapshot);
  const legend = cpuLegend(snapshot);
  const counts = cardCounts(useStore(terminalStore, (state) => state), snapshot);
  // 못 센 수(스냅샷 전)는 「—」다 — 「0」이면 모르는 것을 없다고 한다.
  const countOrDash = (count: number | null) => (count === null ? NOT_READ : String(count));
  // 고아(CONTEXT 「고아」)는 확정 고아와 출처 불명을 함께 부르는 말이다 — 고아 타일의 큰 수가 그 합이다.
  const strays = counts.confirmed === null || counts.unknown === null ? null : counts.confirmed + counts.unknown;

  return (
    <section aria-label="요약" className="grid grid-cols-5 gap-2.5">
      {/* 넓은 타일 — 이름 줄 밑에서 왼쪽이 큰 수 · 아래 줄, 오른쪽이 추이다(DS 미리보기의 넓은 타일 — 둘 사이 16). 큰 수는 합계
          CPU(정수 — 맥 전체를 나눈 줄의 합, restart 03-6)이고 아래 줄이 그 눈금 — 또는 왜 숫자가 없는지(첫 표본 · macOS 밖) — 이다. 그 밑의
          나눔이 그 CPU를 아틀리에 · 다른 앱 · 시스템 · 못 읽음 · 여유로 가른다(시안 Processes의 범례 — 쌓인 막대는 03-11). */}
      <div className={cn(TILE, "col-span-2")}>
        <TileName icon={Cpu}>CPU</TileName>
        <div className="flex min-w-0 flex-1 items-end gap-4">
          <div className="flex shrink-0 flex-col gap-1">
            <Figure data-figure="cpu" text={figures.cpu} />
            <p className={TILE_NOTE}>
              <span data-figure="cpu-note">{figures.cpuNote}</span>
            </p>
          </div>
          <Trend points={trend ?? []} />
        </div>
        {/* 나눔은 타일의 폭 전체에 선다(시안 Processes의 범례 — 카드 밑) — 큰 수 칸에 두면 추이가 좁아진다. */}
        <p data-figure="legend" className={cn(TILE_NOTE, "mt-1")}>
          <LegendItem name="아틀리에" value={legend.atelier} />
          <Dot />
          <LegendItem name="다른 앱" value={legend.others} />
          <Dot />
          <LegendItem name="시스템 · 못 읽음" value={legend.system} />
          <Dot />
          <LegendItem name="여유" value={legend.idle} />
        </p>
      </div>
      {/* 메모리 합계 — 아틀리에 전체, 줄과 같은 2초 스냅샷이다(restart 03-5). 아래 줄이 앱 본체 — Rust 본체 + 웹뷰(WebContent와 앱이
          책임지는 WebKit 도우미 — restart 03-8). 무엇을 셌는지(도우미를 못 찾았으면 GPU · Networking을 안 센다는 것)를 툴팁이 말한다(S39). 툴팁은 `title`이다 — 누를 것 없는 글자라 앱 툴팁(`Hint`)의 트리거로
          세우면 포커스와 역할이 새로 생긴다(`sidebar-active-band` S29와 같은 까닭). */}
      <div className={TILE}>
        <TileName icon={MemoryStick}>메모리 합계</TileName>
        <Figure data-figure="total" text={figures.memory} />
        <p data-figure="app" title={snapshot ? appBodyNote(figures.webviewExcluded, snapshot.body.webkit) : undefined} className={TILE_NOTE}>
          앱 본체 <span className="tabular-nums">{figures.app}</span>
          {figures.webviewExcluded && <span className="ml-1.5">({WEBVIEW_EXCLUDED})</span>}
        </p>
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
          점(`dot-wait` — 7, DS `.at-dot.wait`)이 선다 — 손볼 것이 있다는 표시라 nav 메타의 점과 같은 색이다. */}
      <div className={TILE}>
        <TileName icon={CircleAlert}>고아</TileName>
        <Figure text={strays === null ? NOT_READ : `${strays}개`} />
        <p className={TILE_NOTE}>
          {strays !== null && strays > 0 && <span aria-hidden className="size-1.75 shrink-0 rounded-full bg-dot-wait" />}
          <span data-figure="confirmed">확정 고아 {countOrDash(counts.confirmed)}</span>
          <Dot />
          <span data-figure="unknown">출처 불명 {countOrDash(counts.unknown)}</span>
        </p>
      </div>
    </section>
  );
}

/**
 * 타일 하나 — DS `.at-tile`: 옅은 면 · `radius-xl` · 0.5px `border` 안쪽 링 · 안쪽 14 · 16, 이름 줄 · 큰 수 · 아래 줄 사이 4. 넓은
 * 타일(CPU — restart 03-5, 한때 메모리 합계)은 이름 줄 밑을 가로로 갈라 오른쪽에 추이를 둔다.
 */
const TILE = "flex min-w-0 flex-col gap-1 rounded-xl bg-surface-under px-4 py-3.5 inset-ring-[0.5px] inset-ring-border";

/** 타일의 아래 줄 — 12 `fg-tertiary`(DS `.at-tile .s` — 메타라 옅은 글자, DS README 「대비」). 수 조각을 6px 틈으로 잇는다. */
const TILE_NOTE = "flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-fg-tertiary";

/** 타일의 이름 줄 — 12 `fg-tertiary`와 앞 아이콘 14(DS `.at-tile .k`). */
function TileName({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-tertiary">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** CPU 나눔의 한 조각 — 이름과 정수 %(`cpuLegend`). */
function LegendItem({ name, value }: { name: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      {name} <span className="tabular-nums">{value}</span>
    </span>
  );
}

/** 아래 줄의 가운뎃점 — 눈으로 조각을 가른다. 스크린리더는 조각만 읽는다. */
function Dot() {
  return <span aria-hidden>·</span>;
}

/**
 * 타일의 큰 수 — 숫자는 `heading-lg`, 단위(`GB` · `%` · `개`)는 14 · 500 `fg-secondary`다(DS `.at-tile .v`). 값이 멎으면 옅어진다(`STALE_FIGURE`
 * — restart 03-9). **글자는 이어 붙는다**:
 * 요소의 글자가 표기 함수의 결과(`formatMemory` · `formatHeadCpu`) 그대로라, 스냅샷의 값을 같은 함수로 적은 글자를 L3가 이 요소에서
 * 읽는다. 못 읽은 값(「—」)은 단위가 없다.
 */
function Figure({ text, ...rest }: { text: string; "data-figure"?: string }) {
  const [, value = text, unit = ""] = /^(.*\d)(\D*)$/.exec(text) ?? [];
  return (
    <p className={cn("text-heading-lg whitespace-nowrap tabular-nums", STALE_FIGURE)} {...rest}>
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
 * 지난 1시간 맥 전체 CPU(`sparkline` — 가로는 시각, 세로는 0부터) — 넓은 타일의 오른쪽 칸을 채운다. 선은 `accent-solid`이고 그 밑을
 * `accent-soft`로 채운다(DS 미리보기의 넓은 타일 추이). 아틀리에 CPU의 둘째 선과 0~100 고정 축은 03-11이다. 바닥(0)은 1시간 폭 전체에 긋는다 — 앱을 켠 지 얼마 안 되어 선이 오른쪽에만
 * 있을 때, 그 선이 1시간 중 얼마인지를 읽게 한다. 채움이 불투명한 면이라 바닥을 채움 위에 긋는다. 축 양끝이 「지난 1시간」 ·
 * 「지금」이다(판 06 문구 표 R2).
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
          {line.length > 1 && <polygon points={area.map(at).join(" ")} className="fill-accent-soft" />}
          <line
            x1={0}
            x2={BOX.width}
            y1={floor}
            y2={floor}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className="stroke-border"
          />
          {line.length > 0 && (
            <polyline
              points={line.map(at).join(" ")}
              fill="none"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-accent-solid"
            />
          )}
        </svg>
        {last && (
          <span
            aria-hidden
            className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-solid"
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
