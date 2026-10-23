import { seenOf, statusOf, type Seen, type ThreadStatus } from "./status";
import type { RecordLine, ThreadSummary, ThreadView } from "./types";

// 「내 차례」 거르기와 ⌘J(v1 티켓 42 · 구현 스펙 §13 S28 · §17 · 스토리 131 · 132 · 캔버스 Sidebar 보드 「내 차례만」) — 나를 기다리는
// Thread를 **기다리기 시작한 순서로** 세우고(`waitingOrder`), ⌘J가 그 차례에서 어디로 갈지 고르는(`jumpTarget`) **순수 함수**들이다.
// 사이드바의 마디 수 · 「내 차례만」 목록 · ⌘J가 모두 이 한 차례를 읽어, 셋이 다른 말을 하지 않는다.
//
// - **내 차례인가는 사이드바 줄의 상태와 같은 판정이다**(`statusOf`의 첫 갈래 — v1 티켓 41). 기다린 때는 그 물음 줄의 시각이다.
// - **Work에 이은 Thread도 든다** — 보드 「내 차례만」의 「환불 API 버그 고쳐줘」는 Work 아래 Thread다. 「전체」에서는 Work 아래에 서고
//   (v1 티켓 37), 「내 차례」에서는 한 줄에 섞여 기다린 순서로 선다.
// - 깨진 Thread와 아직 읽지 않은 Thread(기록 · 살아 있음을 모른다)는 들지 않는다 — 모르는 것을 기다린다고 하지 않는다.
// - 보관되거나 지워진 Work의 Thread(읽기만, v1 티켓 38)도 들지 않는다 — 그 Thread는 사이드바에서 빠지고 ⌘K로 연다(S43).

/** Thread 하나를 읽은 것 — 기록 줄과 엔진이 준 살아 있음 · 기록 끝(`thread_get`). */
export interface ThreadReading {
  lines: readonly RecordLine[];
  view: Pick<ThreadView, "live" | "lastSeq">;
}

/** 나를 기다리는 Thread 하나 — 기다리기 시작한 때와 기다리는 것(「승인 · pnpm prisma migrate dev」). */
export interface Waiting {
  thread: ThreadSummary;
  since: string;
  text: string;
}

/** 기다리는 Thread들을 기다리기 시작한 때가 이른 것부터. 때가 같으면 목록의 차례다. */
export function waitingOrder(
  threads: readonly ThreadSummary[],
  readingOf: (thread: string) => ThreadReading | null,
): Waiting[] {
  const waiting: Waiting[] = [];
  for (const thread of threads) {
    if (thread.broken !== null || thread.readOnly !== null) continue;
    const reading = readingOf(thread.id);
    if (reading === null) continue;
    const status = statusFor(reading.lines, seenOf(reading.view, thread.lastRead));
    if (status?.kind === "mine") waiting.push({ thread, since: status.since, text: status.text });
  }
  return waiting.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

/** 기록 줄 배열마다 마지막으로 센 상태 — 기록 줄 스토어는 바뀐 Thread의 배열만 새로 짓는다(`mergeLines`). */
const counted = new WeakMap<readonly RecordLine[], { seen: Seen; status: ThreadStatus | null }>();

/**
 * `statusOf`와 같은 답을, 기록 줄도 엔진의 두 값도 그대로인 Thread는 다시 접지 않고 낸다. 마디의 수와 「내 차례만」 목록은 **어느 Thread든**
 * 기록 줄이 하나 흐를 때마다 다시 세는데, 그때 바뀐 것은 그 한 Thread다 — 나머지를 줄마다 다시 접으면 Thread 수만큼 접기가 돈다.
 */
function statusFor(lines: readonly RecordLine[], seen: Seen): ThreadStatus | null {
  const hit = counted.get(lines);
  if (hit && hit.seen.goneThrough === seen.goneThrough && hit.seen.lastRead === seen.lastRead) return hit.status;
  const status = statusOf(lines, seen);
  counted.set(lines, { seen, status });
  return status;
}

/** ⌘J가 갈 곳 — 그 Thread, 셸 쪽 길(방금 부른 셸로 — 그 길의 규칙 그대로), 또는 아무 데도(`null`). */
export type Jump = { kind: "thread"; id: string } | { kind: "shell" } | null;

/**
 * ⌘J가 갈 곳(S28 · 스토리 132 · 보드 「다음 내 차례로 건너뛰기」). `order`는 기다린 순서의 Thread id, `here`는 지금 보는 Thread(없으면
 * `null`), `shell`은 방금 부른 셸이 지금 떠 있나다.
 *
 * - **내 차례가 없으면 셸 쪽 길이다** — 「지금처럼」: 부른 셸로 가고, 그 셸이 닫혔으면 「그 셸은 닫혔어요」, 부른 셸이 없으면 아무것도
 *   하지 않는다(`shell-recall.ts`의 `recallTarget`). 그 갈래는 그 길이 정한다.
 * - **내 차례 Thread 밖이면 가장 오래 기다린 Thread다.** 안이면 기다린 순서의 다음 Thread로 건너뛴다 — 답하지 않고 넘기는 길이다(답하면
 *   그 Thread는 차례에서 빠지므로 다음 ⌘J는 다시 맨 앞부터다).
 * - **마지막 Thread 다음은 부른 셸이다** — 「내 차례 Thread 다음에 셸」(S28 표). 부른 셸이 없으면(닫혔어도) 처음 Thread로 돈다: 닫힌 셸을
 *   알리는 것은 그 셸로 가려 할 때의 말이고, 기다리는 Thread가 남았는데 키가 아무 일도 안 하면 건너뛰기가 막힌다. 처음 Thread가 지금 보는
 *   그것이면 갈 곳이 없다.
 */
export function jumpTarget(order: readonly string[], here: string | null, shell: boolean): Jump {
  if (order.length === 0) return { kind: "shell" };
  const at = here === null ? -1 : order.indexOf(here);
  if (at < order.length - 1) return { kind: "thread", id: order[at + 1] };
  if (shell) return { kind: "shell" };
  return order[0] === here ? null : { kind: "thread", id: order[0] };
}
