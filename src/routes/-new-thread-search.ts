import type { ThreadLink } from "@/features/thread/types";

// 새 Thread 주소(`/`)의 search — **처음 고를 곳**(Work 칩의 씨앗)이다. 라우트(`index.tsx`)가 검증하고 화면을 세우며, 앱 셸의 「새 Thread로 가는
// 길」(⌘N · 위 줄 「새 Thread」)과 그 행의 고른 모양이 「지금 씨앗 없는 새 Thread인가」를 같은 규칙으로 읽는다(02 코드 리뷰 S1). 규칙이 둘이면
// 한쪽만 씨앗을 아는 날 가드가 키를 삼킨다 — 한때 가드가 주소의 경로(`/`)만 봐서, 씨앗을 단 새 Thread에서 ⌘N이 먹지 않았다.

/**
 * 씨앗은 씨앗일 뿐이라 칩에서 다른 것을 고르면 그것이 간다(주소는 그대로다). 모르는 모양은 없는 것과 같다.
 * - `?work=<slug>` — 그 Work(v1 티켓 34). 요약 카드 「…」의 「이 Work에서 새 Thread」 · 이은 Thread가 없는 Work 줄이 그 Work를 고른 채 연다.
 * - `?new=work` — 「새 Work」(02 구현 스펙 S5 · 티켓 05). 사이드바 Work 묶음 머리의 +가 연다 — 첫 말을 받으면 Host가 Work로 묶는다.
 *   둘이 함께 오면 이것이다(+는 늘 이것만 싣는다).
 */
export interface NewThreadSearch {
  work?: string;
  new?: "work";
}

export function validateNewThreadSearch(search: Record<string, unknown>): NewThreadSearch {
  const seed = seedOf(search);
  if (seed.kind === "new-work") return { new: "work" };
  return seed.kind === "work" ? { work: seed.slug } : {};
}

/** 주소가 말하는 처음 고를 곳. 검증기가 주소를 청소하지 않아(`-work-search.ts`의 `viewTab` 머리말) 읽는 자리도 이것으로 눕힌다. */
export function seedOf(search: { work?: unknown; new?: unknown }): ThreadLink {
  if (search.new === "work") return { kind: "new-work" };
  return typeof search.work === "string" && search.work !== "" ? { kind: "work", slug: search.work } : { kind: "no-work" };
}

/**
 * **지금 씨앗 없는 새 Thread에 서 있나**(02 구현 스펙 §4 · 스토리 10) — ⌘N과 위 줄 「새 Thread」가 가는 곳이다. 그렇다면 둘은 아무것도 하지
 * 않고(같은 주소가 히스토리에 한 칸 더 쌓이지 않게), 그 행은 고른 모양이다. 씨앗을 단 새 Thread(`/?work=` · `/?new=work`)는 아니다 — 거기서
 * 누르면 씨앗이 걷힌 첫 화면으로 간다. 주소는 라우터가 읽은 그대로(`location` — 검증 전)라 씨앗도 `seedOf`로 눕혀 읽는다.
 */
export function isBlankNewThread(location: { pathname: string; search: { work?: unknown; new?: unknown } }): boolean {
  return location.pathname === "/" && seedOf(location.search).kind === "no-work";
}
