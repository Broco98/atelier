import { signalOf } from "@/features/terminal/shell-attention";
import { liveOwnerlessOf, type ShellsState } from "@/features/terminal/shell-registry";
import { NOT_READ, formatCpu, formatHeadCpu, formatMemory } from "./metrics";
import type { ProcessRow, ProcessSnapshot, TrendPoint } from "./types";

// **`Processes` 요약 카드의 수와 추이**(프로세스 결정 10 · 프로세스 스펙 「화면 구성 › 요약 카드」 · 티켓 30). 순수 함수다.
//
// **카드는 새 박자를 걸지 않는다.** 화면이 이미 받는 셋에서 읽는다 — 어느 수를 어디서 읽는지가 이 파일의 결정이다.
// - 2초 스냅샷(화면 표본): **머리(맥 전체 CPU) · 아틀리에 CPU · 메모리 합계 · 앱 본체 · 「웹뷰 제외」**(restart 03-5 「한 표본」 — 화면을
//   보는 동안 머리와 줄과 메모리 카드가 같은 2초 표본에서 선다. 한때 10초 요약에서 읽었다), 셸 수(풀) · 확정 고아 수 · 출처 불명 수.
//   같은 화면의 줄 · 묶음(31 · 32)이 이 스냅샷으로 서므로 카드와 줄이 다른 표본을 말하지 않는다.
// - 10초 요약의 고리(배경 표본): 추이 — 맥 전체 CPU와 아틀리에 CPU의 1시간치(`useProcessTrend`). nav 옆 숫자는 10초 요약이라 화면을 보는
//   동안 카드의 합계와 한 박자 어긋날 수 있다.
// - 스토어: 「도는 중」인 셸 수(셸 상태 — 레지스트리의 문 `signalOf`), 주인 잃은 셸 수(`liveOwnerlessOf`). 둘 다 스토어만 아는 사실이다.

/** 요약 카드의 수. 스냅샷에서 세는 수는 첫 스냅샷 전에 `null`이다 — 「0」이라 하면 모르는 것을 없다고 한다. */
export interface CardCounts {
  /** 풀의 셸 — 화면 밖 셸까지. */
  shells: number | null;
  /** 셸 상태가 「도는 중」인 셸(훅 · OSC가 말한 것). 명령이 도는 것과 다르다 — 그것은 셸 상태가 아니다. */
  working: number;
  /** 주인 잃은 셸 중 아직 살아 있는 것. */
  ownerlessShells: number;
  confirmed: number | null;
  unknown: number | null;
}

/** 묶음(키 → 행들)의 행 수. */
function rowsIn(groups: Record<string, ReadonlyArray<ProcessRow>>): number {
  return Object.values(groups).reduce((count, rows) => count + rows.length, 0);
}

export function cardCounts(state: ShellsState, snapshot: ProcessSnapshot | undefined): CardCounts {
  return {
    shells: snapshot ? snapshot.pool.length : null,
    // 셸 상태는 레지스트리가 내놓는 문으로 읽는다 — 끝난 칸에 남은 도는 중을 가리는 자리가 거기다(소스 스캔이 막는 길).
    working: state.shells.filter((shell) => signalOf(shell) === "working").length,
    ownerlessShells: liveOwnerlessOf(state).length,
    confirmed: snapshot ? rowsIn(snapshot.verdict.orphans.confirmed) : null,
    unknown: snapshot ? rowsIn(snapshot.verdict.orphans.unknown) : null,
  };
}

/** 요약 카드의 머리 값 — 한 스냅샷에서 읽은 글자(restart 03-5). 첫 스냅샷 전에는 모두 「—」다(10초 요약으로 메우지 않는다). */
export interface CardFigures {
  /** 머리 — 맥 전체 CPU, 정수 %. */
  cpu: string;
  /** 머리 아래 줄 — 눈금(맥 전체 · 코어 수), 또는 왜 숫자가 없는지(첫 스냅샷 전 · 첫 표본 · macOS 밖). */
  cpuNote: string;
  /** 아틀리에 CPU — 줄과 같은 소수 한 자리. */
  atelierCpu: string;
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
 * **요약 카드의 머리 값을 한 스냅샷에서 읽는다**(restart 03-5 「한 표본」 · 스토리 122). 머리는 맥 전체 CPU(정수)이고, 아래 줄이 그 눈금을
 * 말한다 — 첫 표본은 두 번 재야 알고, macOS 밖은 「측정 안 됨」이다. 아틀리에 CPU · 메모리 합계 · 앱 본체도 같은 장의 것이다.
 */
export function cardFigures(snapshot: ProcessSnapshot | undefined): CardFigures {
  if (snapshot === undefined) {
    return { cpu: NOT_READ, cpuNote: "재는 중", atelierCpu: NOT_READ, memory: NOT_READ, app: NOT_READ, webviewExcluded: false };
  }
  const { mac, atelier } = snapshot;
  const cpuNote =
    mac === null ? NOT_MEASURED : mac.cpu === null ? "두 번 재야 알 수 있어요" : `맥 전체 · 코어 ${mac.cores}개`;
  return {
    cpu: formatHeadCpu(mac?.cpu ?? null),
    cpuNote,
    atelierCpu: formatCpu(atelier.cpu),
    memory: formatMemory(atelier.total),
    app: formatMemory(atelier.app),
    webviewExcluded: atelier.webviewExcluded,
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

/**
 * **지난 1시간 스파크라인의 점들**(x, y) — 맥 전체 CPU의 선이다(restart 03-5 — 점이 메모리 합계에서 CPU 둘로 바뀌었다. 아틀리에 CPU와 두
 * 선을 0~100 고정 축에 그리는 것은 03-11이다). 순수 함수다.
 * - **가로는 시각이다.** 마지막 점이 오른쪽 끝이고 왼쪽 끝이 그보다 1시간 전이다. 앱을 켠 지 5분이면 오른쪽 12분의 1에만 선다 —
 *   5분치를 폭 전체로 늘리면 「지난 1시간」이 거짓이다. 1시간보다 앞선 점(맥이 잠든 사이 고리가 넓어졌다)은 뺀다.
 * - **세로는 0부터 가장 큰 값까지다.** 가장 작은 값을 바닥에 두지 않는다 — 그러면 작은 흔들림이 절벽처럼 선다. 모두 0이면 바닥에
 *   눕는다.
 */
export function sparkline(points: ReadonlyArray<TrendPoint>, { width, height, inset }: SparkBox): Array<[number, number]> {
  const shown = drawnPoints(points);
  const last = shown[shown.length - 1];
  if (last === undefined) return [];
  const start = last.at - TREND_SPAN_MS;
  const top = Math.max(...shown.map((point) => point.mac));
  const span = height - inset * 2;
  return shown.map((point) => [
    ((point.at - start) / TREND_SPAN_MS) * width,
    inset + (top > 0 ? 1 - point.mac / top : 1) * span,
  ]);
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
 * 스파크라인의 접근성 이름 — **그린 점**의 처음과 끝 맥 전체 CPU다(`drawnPoints`). 선의 모양은 눈의 것이고, 귀에는 얼마에서 얼마로
 * 왔는지가 남는다. 1시간보다 오래된 점(맥이 잠든 사이 고리가 넓어졌다)은 선에 없으니 이름에도 없다.
 */
export function trendLabel(points: ReadonlyArray<TrendPoint>): string {
  const shown = drawnPoints(points);
  const first = shown[0];
  const end = shown[shown.length - 1];
  return first && end
    ? `지난 1시간 맥 전체 CPU 추이, ${formatCpu(first.mac)}에서 ${formatCpu(end.mac)}`
    : "지난 1시간 맥 전체 CPU 추이, 아직 없음";
}

/** 앱 본체에 웹뷰를 못 셌을 때 값 옆에 붙는 말(프로세스 스펙 S39). */
export const WEBVIEW_EXCLUDED = "웹뷰 제외";

/**
 * 앱 본체의 툴팁(S39) — 무엇을 세고 무엇을 안 세는지. **GPU와 Networking 프로세스는 세지 않는다** — 활성 상태 보기가 앱에 묶어 보이는
 * 합보다 작은 까닭이 이것이다. 웹뷰를 못 셌으면 그것도 말한다.
 */
export function appBodyNote(webviewExcluded: boolean): string {
  const counted = webviewExcluded
    ? "웹뷰(WebContent)를 못 셌어요 — Rust 본체만이에요."
    : "Rust 본체와 웹뷰(WebContent)를 세요.";
  return `${counted} WebKit의 GPU · Networking 프로세스는 세지 않아서 활성 상태 보기의 앱 합과 차이가 나요.`;
}
