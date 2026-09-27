import { signalOf } from "@/features/terminal/shell-attention";
import { liveOwnerlessOf, type ShellsState } from "@/features/terminal/shell-registry";
import { ALL_MODES } from "@/mode";
import type { ProcessRow, ProcessSnapshot, TrendPoint } from "./types";

// **`Processes` 요약 카드의 수와 추이**(프로세스 결정 10 · 프로세스 스펙 「화면 구성 › 요약 카드」 · 티켓 30). 순수 함수다.
//
// **카드는 새 박자를 걸지 않는다.** 화면이 이미 받는 셋에서 읽는다 — 어느 수를 어디서 읽는지가 이 파일의 결정이다.
// - 10초 요약(배경 표본, nav 메타와 같은 장): 합계 · CPU · 앱 본체 · 「웹뷰 제외」 · 추이. nav 옆 숫자와 카드의 합계가 늘 같다.
// - 2초 스냅샷(화면 표본): 셸 수(풀) · 확정 고아 수 · 출처 불명 수. 같은 화면의 묶음(31 · 32)이 이 스냅샷으로 서므로 카드와 묶음이 다른
//   수를 말하지 않는다. 출처 불명은 요약에도 있지만(`unknown`) 그쪽은 10초 박자다.
// - 스토어: 「도는 중」인 셸 수(셸 상태 — 레지스트리의 문 `signalOf`), 주인 잃은 셸 수(`liveOwnerlessOf`). 둘 다 스토어만 아는 사실이다.

/** 요약 카드의 수. 스냅샷에서 세는 수는 첫 스냅샷 전에 `null`이다 — 「0」이라 하면 모르는 것을 없다고 한다. */
export interface CardCounts {
  /** 풀의 셸 — 두 세계의 것과 화면 밖 셸까지. */
  shells: number | null;
  /** 셸 상태가 「도는 중」인 셸(훅 · OSC가 말한 것). 명령이 도는 것과 다르다 — 그것은 셸 상태가 아니다. */
  working: number;
  /** 주인 잃은 셸 중 아직 도는 것 — 두 세계의 것. */
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
    ownerlessShells: ALL_MODES.reduce((count, mode) => count + liveOwnerlessOf(state, mode).length, 0),
    confirmed: snapshot ? rowsIn(snapshot.verdict.orphans.confirmed) : null,
    unknown: snapshot ? rowsIn(snapshot.verdict.orphans.unknown) : null,
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
 * **지난 1시간 스파크라인의 점들**(x, y). 순수 함수다.
 * - **가로는 시각이다.** 마지막 점이 오른쪽 끝이고 왼쪽 끝이 그보다 1시간 전이다. 앱을 켠 지 5분이면 오른쪽 12분의 1에만 선다 —
 *   5분치를 폭 전체로 늘리면 「지난 1시간」이 거짓이다. 1시간보다 앞선 점(맥이 잠든 사이 고리가 넓어졌다)은 뺀다.
 * - **세로는 0부터 가장 큰 값까지다.** 합계가 서서히 차오르는 것을 보려는 줄이라(프로세스 결정 11) 가장 작은 값을 바닥에 두지 않는다
 *   — 그러면 몇 MB 흔들림이 절벽처럼 선다. 모두 0이면 바닥에 눕는다.
 */
export function sparkline(points: ReadonlyArray<TrendPoint>, { width, height, inset }: SparkBox): Array<[number, number]> {
  const last = points[points.length - 1];
  if (last === undefined) return [];
  const start = last.at - TREND_SPAN_MS;
  const shown = points.filter((point) => point.at >= start);
  const top = Math.max(...shown.map((point) => point.total));
  const span = height - inset * 2;
  return shown.map((point) => [
    ((point.at - start) / TREND_SPAN_MS) * width,
    inset + (top > 0 ? 1 - point.total / top : 1) * span,
  ]);
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
