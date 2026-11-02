import { unreadNote } from "./breakdown";
import { SNAPSHOT_EVERY_MS } from "./hooks";
import type { ProcessSnapshot } from "./types";

// **믿을 수 있는 표시**(restart 03-9 · 스토리 129 ~ 133 · 스펙 「03 — Processes › 믿을 수 있는 표시」 · 시안 ProcessSheet 「표본 상태」 ·
// Processes의 머리 · 안내 띠). 화면이 받는 스냅샷 쿼리의 상태에서 머리가 무엇을 말할지 가른다 — 잰 시각, 첫 표본을 기다림, 값이 멎음. 순수
// 함수다. 값이 멎는 길은 둘이다(`beatOf`).
// - **물음이 실패한다** — 박자(2초)는 실패해도 돌아 실패가 2초마다 온다. 멈춤의 「지금」은 마지막 실패가 온 때라 시계가 필요 없다 —
//   「N초째」도 그 박자로 오른다(시안도 2초씩 오른다). 「경과의 지금은 스냅샷이 도착한 때다」(`ProcessesPage`)와 같은 수법이다.
// - **물음이 안 끝난다**(멎은 IPC) — react-query의 박자가 묻는 중인 물음에 묶여 실패도 새 값도 안 온다. 그래서 화면이 묻는 동안만 도는
//   가벼운 시계(`AskClock` — `SampleStatus`의 `useSampleBeat`)가 「지금」을 준다.

/**
 * 멈춤이라 말하기까지 새 값 없이 견디는 때 — 화면 박자(2초) 셋. 그보다 짧은 실패는 박자를 놓친 것이라 마지막 값을 그대로 둔다(스펙 「실패한
 * 스냅샷은 6초 넘게 새 값이 없으면 멈춤 상태로 말한다」).
 */
export const STALL_AFTER_MS = 6_000;

/**
 * 머리의 표본 상태.
 * - `waiting` — 첫 표본을 기다린다: 첫 스냅샷이 아직 없거나, 왔지만 CPU를 두 번 재야 알아 머리가 아직 「—」다(시안 「첫 표본」).
 * - `live` — 값이 오고 있다. 마지막으로 잰 시각을 말한다.
 * - `stalled` — 실패가 이어져 `STALL_AFTER_MS` 넘게 새 값이 없다(시안 「멈춤」). 숫자는 옅어지고 안내 띠가 다시 읽기를 낸다.
 *   `measuredAt`은 화면에 남은 숫자를 잰 때다 — 값이 한 번도 안 왔으면 없다.
 */
export type SampleBeat =
  | { kind: "waiting" }
  | { kind: "live"; measuredAt: number }
  | { kind: "stalled"; quietMs: number; measuredAt: number | null };

/**
 * 스냅샷 쿼리의 상태 중 머리가 읽는 칸 — react-query의 쿼리 결과(`useQuery`)와 쿼리 상태(`getQueryState`)가 둘 다 이 모양이다. 마지막 값과 그
 * 값이 온 때, 마지막 실패가 온 때(없으면 0).
 */
export interface SnapshotState {
  data?: ProcessSnapshot | undefined;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  /** 묻는 중인가 — react-query의 `fetchStatus`. `fetching`일 때만 화면의 시계(`AskClock`)를 읽는다. */
  fetchStatus?: "fetching" | "paused" | "idle";
}

/**
 * **묻는 동안의 시계** — 지금 묻는 중인 물음이 나간 때와 지금(에포크 ms). 화면이 묻는 동안만 돌린다(`useSampleBeat`). 물음이 안 끝나는
 * 멈춤을 가르는 데만 쓴다.
 */
export interface AskClock {
  askedAt: number;
  now: number;
}

/**
 * **머리의 표본 상태를 가른다.** 마지막 값이 온 때부터(값이 한 번도 안 왔으면 화면을 연 때 `openedAt`부터) `STALL_AFTER_MS`를 넘게 새 값이
 * 없으면 멈춤이다. 그 「없음」은 둘 중 하나로 안다.
 * - 마지막 물음이 실패했다(실패가 값보다 늦게 왔다) — 그 실패가 온 때까지를 센다.
 * - 묻는 중인 물음이 안 끝났다(`fetchStatus: "fetching"`) — 화면의 시계(`clock`)의 지금까지를 센다. **그 물음이 한 박자(2초)를 넘게
 *   걸렸을 때만이다** — 화면을 떠났다 돌아오면 캐시의 옛 값이 선 채 새 물음이 나가는데, 그 물음이 끝나기까지의 짧은 틈에 「60초째 새 값이
 *   없어요」가 번쩍이지 않게. 쉬는 박자(창이 가려짐)는 묻는 중이 아니라 시계를 안 읽는다.
 *
 * 멈춤이 아니면 받은 값으로 가른다 — 없거나 첫 표본(맥 전체 CPU를 아직 모른다)이면 기다림, 그 밖은 그 장을 잰 시각이다. macOS 밖은 맥 전체가
 * 없어(`mac: null`) 기다려도 CPU가 안 오니 잰 시각을 말한다.
 *
 * 앱을 떠났다 돌아와 캐시에 남은 옛 값이 섰는데 다시 묻기가 실패하면 곧바로 멈춤이다 — 보이는 숫자가 6초보다 오래됐고 새로 못 읽었다.
 */
export function beatOf(state: SnapshotState, openedAt: number, clock: AskClock | null = null): SampleBeat {
  const snapshot = state.data;
  const since = snapshot ? state.dataUpdatedAt : openedAt;
  const failedAt = state.errorUpdatedAt > state.dataUpdatedAt ? state.errorUpdatedAt : null;
  const hungAt =
    state.fetchStatus === "fetching" && clock !== null && clock.now - clock.askedAt > SNAPSHOT_EVERY_MS ? clock.now : null;
  const quietMs = Math.max(failedAt ?? -Infinity, hungAt ?? -Infinity) - since;
  if (quietMs > STALL_AFTER_MS) {
    return { kind: "stalled", quietMs, measuredAt: snapshot ? snapshot.measuredAt : null };
  }
  if (snapshot === undefined || (snapshot.mac !== null && snapshot.mac.cpu === null)) return { kind: "waiting" };
  return { kind: "live", measuredAt: snapshot.measuredAt };
}

/** 이 기계의 시각으로 시 · 분 · 초(24시) — 「14:02:31」. */
export function clockOf(epochMs: number): string {
  const at = new Date(epochMs);
  return [at.getHours(), at.getMinutes(), at.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

/** **머리의 글자**(시안 Processes `pr-beat`) — 「재는 중」 · 「14:02:31에 잰 값 · 2초마다」 · 「8초째 새 값이 없어요」. */
export function beatText(beat: SampleBeat): string {
  switch (beat.kind) {
    case "waiting":
      return "재는 중";
    case "live":
      return `${clockOf(beat.measuredAt)}에 잰 값 · ${SNAPSHOT_EVERY_MS / 1000}초마다`;
    case "stalled":
      return `${Math.floor(beat.quietMs / 1000)}초째 새 값이 없어요`;
  }
}

/** 안내 띠 하나 — 글과, 다시 읽기를 낼지. */
export interface SampleNote {
  text: string;
  retry: boolean;
}

/**
 * **안내 띠**(시안 Processes `pr-note` · ProcessSheet 「멈춤」 · 「일부 못 읽음」) — 띠는 하나이고 멈춤이 먼저다.
 * - 멈춤: 무엇이 멎었고 아래 숫자가 언제 잰 것인지 말하고, 다시 읽기를 낸다(스토리 131 · 132). 값이 한 번도 안 왔으면 아래 숫자가 없다.
 * - 못 읽음: 못 읽은 수와 까닭(스토리 133 — `unreadNote`). **권한 없음처럼 박자마다 남는 까닭이 있을 때만 선다.** 그사이 끝난 것만이면 안
 *   세운다 — 같은 uid의 프로세스는 늘 뜨고 져 이 맥에서 박자 몇에 하나꼴로 1 ~ 8개가 그렇다. 그것만으로 띠가 섰다 졌다 하면 아래 표가 띠의
 *   높이만큼 오르내려, 누르려던 줄 대신 다른 줄의 [끝내기]를 누른다. 그 수는 시스템 · 못 읽음 줄이 늘 말한다(`systemNote`).
 */
export function sampleNote(beat: SampleBeat, snapshot: ProcessSnapshot | undefined): SampleNote | null {
  if (beat.kind === "stalled") {
    const lead = "앱이 프로세스 표를 읽지 못하고 있어요.";
    const text = beat.measuredAt === null ? lead : `${lead} 아래 숫자는 ${clockOf(beat.measuredAt)}에 잰 값이에요.`;
    return { text, retry: true };
  }
  if (snapshot === undefined || snapshot.unread.denied + snapshot.unread.other === 0) return null;
  const text = unreadNote(snapshot);
  return text === null ? null : { text, retry: false };
}
