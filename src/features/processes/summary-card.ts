import { NOT_READ, formatCpu, formatHeadCpu, formatMemory } from "./metrics";
import type { ProcessRow, ProcessSnapshot, TrendPoint } from "./types";

// **`Processes` 요약 카드의 수와 추이**(프로세스 결정 10 · 프로세스 스펙 「화면 구성 › 요약 카드」 · 티켓 30). 순수 함수다.
//
// **카드는 새 박자를 걸지 않는다.** 화면이 이미 받는 둘에서 읽는다 — 어느 수를 어디서 읽는지가 이 파일의 결정이다.
// - 2초 스냅샷(화면 표본): **머리(합계 CPU) · 그 나눔 · 아틀리에 CPU · 메모리 합계 · 앱 본체 · 「웹뷰 제외」**(restart 03-5 「한 표본」 —
//   화면을 보는 동안 머리와 줄과 메모리 카드가 같은 2초 표본에서 선다. 한때 10초 요약에서 읽었다. 머리는 맥 전체를 나눈 합계다 — restart
//   03-6), 손볼 것(확정 고아 · 출처 불명 — restart 03-11).
//   같은 화면의 줄 · 묶음(31 · 32)이 이 스냅샷으로 서므로 카드와 줄이 다른 표본을 말하지 않는다.
// - 10초 요약의 고리(배경 표본): 추이 — 맥 전체 CPU와 아틀리에 CPU의 1시간치(`useProcessTrend`). nav 옆 숫자는 10초 요약이라 화면을 보는
//   동안 카드의 합계와 한 박자 어긋날 수 있다.
// 한때 셸 타일(셸 수 · 도는 중 · 주인 잃은 셸)이 스토어도 읽었다 — 시안 Processes의 카드는 CPU · 메모리 · 손볼 것 셋이다(restart 03-11).

/** 「손볼 것」 카드의 수와 말(restart 03-11 · 시안 Processes). */
export interface StrayFigures {
  /** 「N개」. 첫 스냅샷 전에는 「—」다 — 「0개」라 하면 모르는 것을 없다고 한다. */
  count: string;
  note: string;
  /** 하나라도 있다 — 카드 이름 줄의 아이콘이 기다림의 잉크다. */
  any: boolean;
}

/** 묶음(키 → 행들)의 행 수. */
function rowsIn(groups: Record<string, ReadonlyArray<ProcessRow>>): number {
  return Object.values(groups).reduce((count, rows) => count + rows.length, 0);
}

/**
 * **손볼 것 카드**(restart 03-11 · 시안 Processes 「손볼 것」) — 주인 없이 남은 프로세스, 곧 판정의 확정 고아와 출처 불명이다(CONTEXT
 * 「고아」). 화면의 「손볼 것」 구획이 같은 것을 세우고 거기서 끝낸다. 예외 · 다른 인스턴스는 안 든다 — 보기만 하는 묶음이다.
 */
export function strayFigures(snapshot: ProcessSnapshot | undefined): StrayFigures {
  if (snapshot === undefined) return { count: NOT_READ, note: "", any: false };
  const count = rowsIn(snapshot.verdict.orphans.confirmed) + rowsIn(snapshot.verdict.orphans.unknown);
  return {
    count: `${count}개`,
    note: count > 0 ? "주인 없이 남은 프로세스 · 아래에서 끝낼 수 있어요" : "남은 것이 없어요",
    any: count > 0,
  };
}

/** 요약 카드의 머리 값 — 한 스냅샷에서 읽은 글자(restart 03-5). 첫 스냅샷 전에는 모두 「—」다(10초 요약으로 메우지 않는다). */
export interface CardFigures {
  /**
   * 머리 — 합계 CPU, 정수 %(restart 03-6). 읽은 합이 맥 전체 측정값을 안 넘은 표본은 그 측정값이고, 넘은 표본은 읽은 합이다(스펙 「합이
   * 맞는다」 — 줄을 더한 것과 머리가 같다).
   */
  cpu: string;
  /**
   * 머리 아래 줄 — 눈금(맥 전체 · 코어 수), 또는 왜 숫자가 없는지(첫 스냅샷 전 · 첫 표본 · macOS 밖). 첫 표본까지는 무엇을 기다리는지 말한다
   * (restart 03-9 · 스토리 130).
   */
  cpuNote: string;
  /** 아틀리에 메모리 합계. */
  memory: string;
  /** 앱 본체의 메모리. */
  app: string;
  /** 앱 본체에 웹뷰를 못 셌다 — 모르면 거짓이다(붙일 말이 없다). */
  webviewExcluded: boolean;
}

/** macOS 밖이라 맥 전체를 재지 않았을 때의 말(스펙 「Out of Scope」). */
export const NOT_MEASURED = "측정 안 됨";

/**
 * **요약 카드의 머리 값을 한 스냅샷에서 읽는다**(restart 03-5 「한 표본」 · 스토리 122). 머리는 합계 CPU(정수 — restart 03-6: 줄을 더한
 * 것)이고, 아래 줄이 그 눈금을 말한다 — 첫 표본은 두 번 재야 알고, macOS 밖은 「측정 안 됨」이다. 아틀리에 CPU · 메모리 합계 · 앱 본체도
 * 같은 장의 것이다.
 */
export function cardFigures(snapshot: ProcessSnapshot | undefined): CardFigures {
  if (snapshot === undefined) {
    return { cpu: NOT_READ, cpuNote: "첫 표본을 찍는 중이에요", memory: NOT_READ, app: NOT_READ, webviewExcluded: false };
  }
  const { mac, atelier, breakdown } = snapshot;
  const total = breakdown.total.cpu;
  // 코어 몇 개만큼인지 — 맥 전체 = 100의 합계에 코어 수를 곱한 것이다(시안 Processes 「코어 10개 중 3.3개만큼」).
  const cpuNote =
    mac === null
      ? NOT_MEASURED
      : mac.cpu === null || total === null
        ? "두 번 재야 알 수 있어요 · 곧 채워져요"
        : `맥 전체 · 코어 ${mac.cores}개 중 ${((total * mac.cores) / 100).toFixed(1)}개만큼`;
  return {
    cpu: formatHeadCpu(total),
    cpuNote,
    memory: formatMemory(atelier.total),
    app: formatMemory(atelier.app),
    webviewExcluded: atelier.webviewExcluded,
  };
}

/** CPU 카드의 나눔 — 아틀리에 · 다른 앱 · 시스템 · 못 읽음 · 여유, 정수 %(시안 Processes의 범례). 모르면 모두 「—」다. */
export interface CpuLegend {
  atelier: string;
  others: string;
  system: string;
  idle: string;
}

/**
 * **CPU 카드의 나눔**(restart 03-6 · 스토리 123) — 머리 숫자(합계)를 아틀리에 · 다른 앱 · 시스템 · 못 읽음으로 나누고, 남은 것이 여유다.
 * 머리처럼 정수다. **셋을 더하면 머리 숫자다** — 아틀리에와 다른 앱을 반올림하고, 시스템 · 못 읽음은 머리에서 그 둘을 뺀 정수다(따로
 * 반올림하면 3 + 10 + 5가 머리 18과 갈린다 — 시안 Processes와 같은 셈). **여유는 0 아래로 내려가지 않는다**(스펙 「합이 맞는다」) —
 * 읽은 합이 측정값을 넘어 합계가 100을 넘는 표본이 있다. 합계를 모르면(첫 표본 · macOS 밖) 모두 「—」다.
 */
export function cpuLegend(snapshot: ProcessSnapshot | undefined): CpuLegend {
  const total = snapshot?.breakdown.total.cpu ?? null;
  if (snapshot === undefined || total === null) {
    return { atelier: NOT_READ, others: NOT_READ, system: NOT_READ, idle: NOT_READ };
  }
  const head = Math.round(total);
  const atelier = Math.round(snapshot.atelier.cpu ?? 0);
  const others = Math.round(snapshot.breakdown.apps.reduce((sum, app) => sum + (app.cpu ?? 0), 0));
  const percent = (value: number) => `${value}%`;
  return {
    atelier: percent(atelier),
    others: percent(others),
    system: percent(Math.max(0, head - atelier - others)),
    idle: percent(Math.max(0, 100 - head)),
  };
}

/** CPU 카드의 쌓인 막대 — 조각마다 폭(맥 전체 = 100의 %)과 막대의 이름. */
export interface CpuStack {
  atelier: number;
  others: number;
  system: number;
  label: string;
}

/**
 * **CPU 카드의 쌓인 막대**(restart 03-11 · 시안 Processes `.pr-stack`) — 아틀리에 · 다른 앱 · 시스템 · 못 읽음을 맥 전체 = 100의 폭으로 잇고,
 * 남은 홈이 여유다. 폭은 반올림 전 값이다(소수 둘째 자리까지). 읽은 합이 100을 넘는 표본은 앞 조각부터 채우고 넘는 몫을 자른다 — 막대 밖으로
 * 안 나간다. 이름은 나눔의 정수(`cpuLegend`)로 말한다. 합계를 모르면 빈 막대다.
 */
export function cpuStack(snapshot: ProcessSnapshot | undefined): CpuStack {
  const total = snapshot?.breakdown.total.cpu ?? null;
  if (snapshot === undefined || total === null) return { atelier: 0, others: 0, system: 0, label: "재는 중" };
  const parts = [
    snapshot.atelier.cpu ?? 0,
    snapshot.breakdown.apps.reduce((sum, app) => sum + (app.cpu ?? 0), 0),
    snapshot.breakdown.system.cpu ?? 0,
  ];
  let room = 100;
  const [atelier, others, system] = parts.map((part) => {
    const width = Math.min(Math.max(0, part), room);
    room -= width;
    return Math.round(width * 100) / 100;
  });
  const legend = cpuLegend(snapshot);
  return {
    atelier,
    others,
    system,
    label: `맥 전체 ${formatHeadCpu(total)} 사용 — 아틀리에 ${legend.atelier}, 다른 앱 ${legend.others}, 시스템과 못 읽은 것 ${legend.system}`,
  };
}

/** 스파크라인이 보이는 폭 — 1시간(「지난 1시간」). 고리도 1시간치다(360점, 10초마다). */
export const TREND_SPAN_MS = 60 * 60 * 1000;

/** 스파크라인의 상자 — 폭과 높이(px), 선 두께 때문에 위아래로 비우는 안쪽 여백. */
export interface SparkBox {
  width: number;
  height: number;
  inset: number;
}

/** 추이의 두 선 — 맥 전체 CPU와 아틀리에 CPU의 점들(x, y). */
export interface TrendLines {
  mac: Array<[number, number]>;
  atelier: Array<[number, number]>;
}

/**
 * **지난 1시간 CPU 추이의 두 선**(restart 03-11 · 스펙 「추이」 · 시안 ProcessSheet) — 맥 전체 CPU와 아틀리에 CPU다. 순수 함수다.
 * - **가로는 시각이다.** 마지막 점이 오른쪽 끝이고 왼쪽 끝이 그보다 1시간 전이다. 앱을 켠 지 5분이면 오른쪽 12분의 1에만 선다 —
 *   5분치를 폭 전체로 늘리면 「지난 1시간」이 거짓이다. 1시간보다 앞선 점(맥이 잠든 사이 고리가 넓어졌다)은 뺀다.
 * - **세로는 0~100 고정 축이다.** 두 선이 같은 축이라 견줄 수 있다 — 한때 선마다 제 최댓값으로 늘렸다(그러면 두 선의 높이가 서로 다른
 *   눈금이다). 100이 위 가장자리이고, 읽은 합이 측정값을 넘은 표본(100을 넘는다)도 그 위로 안 나간다.
 */
export function sparkline(points: ReadonlyArray<TrendPoint>, { width, height, inset }: SparkBox): TrendLines {
  const shown = drawnPoints(points);
  const last = shown[shown.length - 1];
  if (last === undefined) return { mac: [], atelier: [] };
  const start = last.at - TREND_SPAN_MS;
  const span = height - inset * 2;
  const at = (point: TrendPoint, value: number): [number, number] => [
    ((point.at - start) / TREND_SPAN_MS) * width,
    inset + (1 - Math.min(100, Math.max(0, value)) / 100) * span,
  ];
  return { mac: shown.map((point) => at(point, point.mac)), atelier: shown.map((point) => at(point, point.atelier)) };
}

/**
 * 스파크라인이 그리는 점 — 마지막 점에서 거꾸로 1시간(`TREND_SPAN_MS`) 안의 것. 선(`sparkline`)과 그 이름(`trendLabel`)이 이 한 규칙을
 * 읽는다 — 따로 고르면 귀에 남는 구간이 눈의 선과 갈린다.
 */
function drawnPoints(points: ReadonlyArray<TrendPoint>): ReadonlyArray<TrendPoint> {
  const last = points[points.length - 1];
  if (last === undefined) return [];
  const start = last.at - TREND_SPAN_MS;
  return points.filter((point) => point.at >= start);
}

/**
 * 추이의 접근성 이름 — **그린 점**의 처음과 끝, 두 선 모두다(`drawnPoints`). 선의 모양은 눈의 것이고, 귀에는 얼마에서 얼마로 왔는지가
 * 남는다. 1시간보다 오래된 점(맥이 잠든 사이 고리가 넓어졌다)은 선에 없으니 이름에도 없다.
 */
export function trendLabel(points: ReadonlyArray<TrendPoint>): string {
  const shown = drawnPoints(points);
  const first = shown[0];
  const end = shown[shown.length - 1];
  return first && end
    ? `지난 1시간 CPU 추이, 맥 전체 ${formatCpu(first.mac)}에서 ${formatCpu(end.mac)}, 아틀리에 ${formatCpu(first.atelier)}에서 ${formatCpu(end.atelier)}`
    : "지난 1시간 CPU 추이, 아직 없음";
}

/** 앱 본체에 웹뷰를 못 셌을 때 값 옆에 붙는 말(프로세스 스펙 S39). */
export const WEBVIEW_EXCLUDED = "웹뷰 제외";

/** WebKit 도우미를 못 찾았을 때 툴팁이 덧붙이는 말 — 활성 상태 보기가 앱에 묶어 보이는 합보다 작은 까닭(S39). */
const WEBKIT_UNCOUNTED = "WebKit의 GPU · Networking 프로세스는 세지 않아서 활성 상태 보기의 앱 합과 차이가 나요.";

/**
 * **웹뷰 줄의 글자**(restart 03-8 · 시안 Processes 「WebContent · GPU · Networking」) — WebContent 뒤에 함께 센 WebKit 도우미의 갈래
 * (스냅샷의 `body.webkit`)를 잇는다. 앱이 책임지는 WebContent가 더 있어도(WebKit이 미리 띄운 것) 한 번만 적는다.
 */
export function webviewParts(webkit: ReadonlyArray<string>): string {
  return [...new Set(["WebContent", ...webkit])].join(" · ");
}

/**
 * 앱 본체의 툴팁(S39) — 무엇을 세고 무엇을 안 세는지. 앱이 책임지는 WebKit 도우미(`webkit` — 스냅샷의 `body.webkit`)를 셌으면 웹뷰가
 * 그것까지다(restart 03-8). 못 찾았으면(책임 프로세스를 묻는 함수가 없다 · 셸에서 띄운 개발 빌드) **GPU와 Networking 프로세스는 세지
 * 않는다**고 말한다 — 활성 상태 보기가 앱에 묶어 보이는 합보다 작은 까닭이 이것이다. 웹뷰(WebContent)를 못 셌으면 그것도 말한다.
 */
export function appBodyNote(webviewExcluded: boolean, webkit: ReadonlyArray<string>): string {
  const helpers = webkit.filter((kind) => kind !== "WebContent");
  const counted = webviewExcluded
    ? `웹뷰(WebContent)를 못 셌어요 — ${helpers.length > 0 ? `Rust 본체와 ${helpers.join(" · ")}만이에요.` : "Rust 본체만이에요."}`
    : `Rust 본체와 웹뷰(${webviewParts(webkit)})를 세요.`;
  return webkit.length > 0 ? counted : `${counted} ${WEBKIT_UNCOUNTED}`;
}
