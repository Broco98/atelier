import type { ThreadSummary } from "./types";

/**
 * **채팅의 이름** — 사이드바의 채팅 줄 · 작업공간의 채팅 탭 · Processes의 채팅 줄(restart 03-7)이 같은 말을 쓴다. 채팅 목록(사이드바와
 * 같은 캐시)의 요약에서 읽는다: 이름이 없으면 「새 채팅」, 깨진 채팅이면 「열 수 없는 채팅」(무엇이 깨졌는지는 열면 말한다), 목록에 아직
 * 없으면 「채팅」이다.
 */
export function chatName(summary: Pick<ThreadSummary, "title" | "broken"> | undefined): string {
  if (!summary) return "채팅";
  return summary.broken ? "열 수 없는 채팅" : summary.title || "새 채팅";
}
