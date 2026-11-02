import type { ThreadSummary } from "@/features/thread/types";
import type { WorkView } from "@/features/works/types";

// **Service의 「최근 활동」**(restart 03-2 · 스펙 「03 — 목록과 상세」 「마지막 활동 시각은 작업공간과 채팅의 활동에서 짓는다. 저장하지 않는다」) —
// Project의 것(`projectActivity`)과 같은 셈이다. 그 Service에 닿는 채팅은 둘이다.
//   - 그 Service를 쓰는 작업공간(`WorkView.service`)에 이은 채팅.
//   - 그 Service를 범위로 연 작업공간 밖 채팅(`ThreadSummary.service`).
// 그 Service에 든 Project만 범위로 고른 채팅은 그 Project의 활동이다 — Service의 활동이 아니다. 깨진 채팅 · 읽기만인 채팅(보관한 작업공간의
// 것)은 세지 않는다. 활동이 없는 Service는 `null`이다. Project 상세의 Service 줄이 처음 읽는다(03-2) — Services 목록(03-3)도 이것을 쓴다.

/** Service slug마다 가장 늦은 활동 시각 — 받은 차례 그대로 모든 slug에 칸이 선다. */
export function serviceActivity(
  services: readonly string[],
  works: readonly Pick<WorkView, "slug" | "service">[],
  threads: readonly ThreadSummary[],
): Record<string, string | null> {
  const serviceOfWork = new Map(works.map((work) => [work.slug, work.service ?? null]));
  const latest: Record<string, { at: string; ms: number } | null> = Object.fromEntries(services.map((slug) => [slug, null]));
  for (const thread of threads) {
    const ms = Date.parse(thread.lastAt);
    if (thread.broken !== null || thread.readOnly !== null || Number.isNaN(ms)) continue;
    const slug = thread.work !== null ? (serviceOfWork.get(thread.work) ?? null) : thread.service;
    if (slug === null || !(slug in latest)) continue;
    const held = latest[slug];
    if (held === null || ms > held.ms) latest[slug] = { at: thread.lastAt, ms };
  }
  return Object.fromEntries(Object.entries(latest).map(([slug, held]) => [slug, held?.at ?? null]));
}
