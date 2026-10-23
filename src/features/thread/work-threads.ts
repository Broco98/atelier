import type { ThreadSummary } from "./types";

// 사이드바 Work 묶음이 품는 Thread(v1 티켓 37 · 구현 스펙 §13 · 스토리 104 · 캔버스 「Thread 목록과 아바타」 보드)의 **순수 함수**다. Work 줄
// 오른쪽에 그 Work에 이은 Thread 수가 서고, ▸로 펼치면 그 Thread들이 Work 아래에 두 줄로 선다. Work 줄을 누르면 그 Work에서 가장 최근의
// Thread로 가고, 없으면 그 Work에 이은 새 Thread로 간다. 자료는 사이드바 Thread 묶음과 같은 목록 요약(`work`)이다 — Thread 묶음은 Work
// 없는 Thread만 세우므로 두 묶음이 겹치지 않는다.
// **읽기만 된 Thread(보관되거나 지워진 Work의 것 — v1 티켓 38)는 어디에도 들지 않는다** — 사이드바에서 빠지고 ⌘K로 연다(S43). 그 Work는
// 목록에도 없지만, 보관이 막 일어나 Work 목록이 아직 옛 것인 동안에도 그 줄이 그런 Thread를 세거나 품지 않는다.

/** 이 묶음이 품는 Thread인가 — 어느 Work에 이었고 읽기만이 아니다. */
const nestable = (thread: ThreadSummary): thread is ThreadSummary & { work: string } =>
  thread.work !== null && thread.readOnly === null;

/** Work마다 이은 Thread 수 — 이은 Thread가 없는 Work는 칸이 없다. */
export function threadCounts(threads: readonly ThreadSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const thread of threads) {
    if (nestable(thread)) counts[thread.work] = (counts[thread.work] ?? 0) + 1;
  }
  return counts;
}

/**
 * 그 Work에 이은 Thread — 목록의 차례(엔진의 차례, 선 때 새것부터) 그대로다. 마지막 말로 다시 세우지 않는다: 줄은 자리를 지키고 상태
 * 칸만 바뀐다(스토리 134 — Thread 묶음과 같다).
 */
export function threadsOf(threads: readonly ThreadSummary[], work: string): ThreadSummary[] {
  return threads.filter((thread) => nestable(thread) && thread.work === work);
}

/** Work 줄을 누르면 갈 곳 — 그 Thread, 또는 그 Work를 고른 새 Thread. */
export type WorkLanding = { kind: "thread"; id: string } | { kind: "new"; work: string };

/**
 * Work 줄을 누르면 갈 곳(구현 스펙 §13 「가장 최근의 Thread」). 최근은 **마지막 말의 때**다(`lastSaid` — 부르는 쪽이 기록에서 읽어
 * 건넨다) — 하던 대화로 돌아가는 길이라 선 때가 아니다. 말이 아직 없으면 선 때로 견주고, 때가 같으면 목록의 앞(새것)이다. 열 수 없는
 * Thread로는 가지 않는다 — 그런 Thread뿐이거나 하나도 없으면 그 Work에 이은 새 Thread다.
 */
export function landingOf(
  threads: readonly ThreadSummary[],
  work: string,
  lastAt: (thread: string) => string | null,
): WorkLanding {
  let latest: { id: string; at: number } | null = null;
  for (const thread of threadsOf(threads, work)) {
    if (thread.broken !== null) continue;
    const at = Date.parse(lastAt(thread.id) ?? thread.createdAt);
    if (latest === null || at > latest.at) latest = { id: thread.id, at };
  }
  return latest === null ? { kind: "new", work } : { kind: "thread", id: latest.id };
}
