import type { ThreadSummary } from "@/features/thread/types";

// **작업공간의 「최근 활동」**(restart 03-2 · 03-3 · 스펙 「03 — 목록과 상세」 「마지막 활동 시각은 작업공간과 채팅의 활동에서 짓는다. 저장하지
// 않는다」) — 그 작업공간에 이은 채팅의 마지막 줄 가운데 가장 늦은 것이다. Project 상세 · Service 상세의 작업공간 묶음이 함께 읽는다.

/** 채팅이 활동으로 세이나 — 깨지지 않고 읽기만(보관한 작업공간의 것)이 아니며 시각을 읽을 수 있다. */
export const countsAsActivity = (thread: ThreadSummary) =>
  thread.broken === null && thread.readOnly === null && !Number.isNaN(Date.parse(thread.lastAt));

/** 작업공간마다 그 작업공간에 이은 채팅의 가장 늦은 마지막 줄. */
export function workActivity(threads: readonly ThreadSummary[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const thread of threads) {
    if (thread.work === null || !countsAsActivity(thread)) continue;
    const held = latest.get(thread.work);
    if (held === undefined || Date.parse(thread.lastAt) > Date.parse(held)) latest.set(thread.work, thread.lastAt);
  }
  return latest;
}
