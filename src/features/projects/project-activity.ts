import type { ThreadSummary } from "@/features/thread/types";
import type { WorkView } from "@/features/works/types";

// **Project의 「최근 활동」**(restart 03-1 · 스펙 「03 — 목록과 상세」 · 스토리 113) — 작업공간과 채팅의 활동에서 짓고 저장하지 않는다. 활동은 채팅의
// 마지막 줄 시각(`ThreadSummary.lastAt`)이다 — 작업공간의 활동은 그 작업공간에 이은 채팅의 것이다(작업공간을 만든 날은 날짜뿐이라 거리를 말할 수
// 없다). 그 Project에 닿는 채팅은 둘이다.
//   - 그 Project를 고치는 진행 중인 작업공간(`WorkView.projects`)에 이은 채팅. 보관되거나 지워진 작업공간의 채팅(읽기만)은 세지 않는다.
//   - 그 Project를 범위로 연 작업공간 밖 채팅(`ThreadSummary.project`). Service 범위 채팅은 Service의 활동이다(03-3).
// 활동이 없는 Project는 `null` — 목록은 「—」를 세우고 시각 순의 끝에 둔다(`place-list.ts`).

/** Project slug마다 가장 늦은 활동 시각 — 받은 차례 그대로 모든 slug에 칸이 선다. */
export function projectActivity(
  projects: readonly string[],
  works: readonly Pick<WorkView, "slug" | "projects">[],
  threads: readonly ThreadSummary[],
): Record<string, string | null> {
  const projectsOfWork = new Map(works.map((work) => [work.slug, work.projects]));
  const latest: Record<string, { at: string; ms: number } | null> = Object.fromEntries(projects.map((slug) => [slug, null]));
  const note = (slug: string, at: string, ms: number) => {
    if (!(slug in latest)) return;
    const held = latest[slug];
    if (held === null || ms > held.ms) latest[slug] = { at, ms };
  };
  for (const thread of threads) {
    const ms = Date.parse(thread.lastAt);
    if (thread.broken !== null || thread.readOnly !== null || Number.isNaN(ms)) continue;
    if (thread.work !== null) for (const slug of projectsOfWork.get(thread.work) ?? []) note(slug, thread.lastAt, ms);
    else if (thread.project !== null) note(thread.project, thread.lastAt, ms);
  }
  return Object.fromEntries(Object.entries(latest).map(([slug, held]) => [slug, held?.at ?? null]));
}
