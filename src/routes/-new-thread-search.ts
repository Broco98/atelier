import type { ThreadLink } from "@/features/thread/types";

// 새 Thread 주소(`/`)의 search — **시작할 곳**, **범위**와 **입력 글**이다. 라우트(`index.tsx`)가 검증하고 화면을 세우며, 앱 셸의
// 「새 채팅으로 가는 길」(⌘N · 위 칸 「새 채팅」)과 그 행의 고른 모양이 「지금 씨앗 없는 새 채팅인가」를 같은 규칙으로 읽는다(02 코드
// 리뷰 S1). 규칙이 둘이면 한쪽만 씨앗을 아는 날 가드가 키를 삼킨다 — 한때 가드가 주소의 경로(`/`)만 봐서, 씨앗을 단 새 Thread에서 ⌘N이
// 먹지 않았다.

/**
 * 범위는 씨앗일 뿐이라 칩에서 바꾸면 그것이 간다(주소는 그대로다). 시작할 곳은 주소가 말한다 — 「새 작업공간」 칩의 ×가 주소를 `?new=thread`로 바꾼다
 * (`withoutNewWork`). 모르는 모양은 없는 것과 같다. 씨앗이 없는 새 채팅은 작업공간 없는 채팅이다.
 * - `?work=<slug>` — 그 Work(v1 티켓 34). 요약 카드 「…」의 「이 작업공간에서 새 채팅」 · 이은 Thread가 없는 Work 줄이 그 Work에서 연다.
 * - `?new=work` — 「작업공간 만들기」. 사이드바 Work 묶음 머리의 + · Service 상세가 연다 — 「새 작업공간」 칩이 서고 ×로 빼면 그냥 새 채팅이다. 첫 말을
 *   받으면 Runtime이 Work로 묶는다. `?work=`와 함께 오면 이것이다.
 * - `?new=thread` — 「새 채팅」. 어디에도 묶지 않고 범위와 입력 글을 실어 연다 — 씨앗이 없는 새 채팅과 같은 화면이다.
 * - `?say=<글>` — 입력 글(03 §5). 입력창에 그 글을 넣는다 — 누구도 대신 보내지 않는다.
 * - `?service=<slug>` — 범위 칩이 처음 쥘 Service(03 §5 · §14). Service 상세의 「작업공간 만들기」(`?new=work&service=`) · 「대화로 고치기」
 *   (`?new=thread&service=&say=`)가 그 Service를 고른 채 연다. 첫 말과 함께 간다(`service-chip.ts`의 `holdOf`).
 * - `?project=<slug>` — 범위 칩이 처음 쥘 Project. Service와 함께 서지 않으므로 `?service=`가 있으면 읽지 않는다.
 */
export interface NewThreadSearch {
  work?: string;
  new?: "work" | "thread";
  say?: string;
  service?: string;
  project?: string;
}

/** 주소가 말하는 처음 것 — 시작할 곳(없으면 `null` — 작업공간 없는 채팅이다), 입력 글, 범위 칩의 씨앗(Service나 Project — 없으면 `null`). */
export interface NewThreadSeed {
  link: ThreadLink | null;
  say: string | null;
  service: string | null;
  project: string | null;
}

/** 씨앗을 주소의 search로 편다 — `seedOf`의 반대쪽이다. */
function searchOf({ link, say, service, project }: NewThreadSeed): NewThreadSearch {
  return {
    ...(link?.kind === "new-work" && { new: "work" as const }),
    ...(link?.kind === "no-work" && { new: "thread" as const }),
    ...(link?.kind === "work" && { work: link.slug }),
    ...(say !== null && { say }),
    ...(service !== null && { service }),
    ...(project !== null && { project }),
  };
}

export function validateNewThreadSearch(search: Record<string, unknown>): NewThreadSearch {
  return searchOf(seedOf(search));
}

/** 라우터가 읽은 그대로의 search — 검증 전이라 모르는 모양이 올 수 있다. */
type SeedSearch = { [Key in keyof NewThreadSearch]?: unknown };

/** 주소가 말하는 처음 것. 검증기가 주소를 청소하지 않아(`-work-search.ts`의 `viewTab` 머리말) 읽는 자리도 이것으로 눕힌다. */
export function seedOf(search: SeedSearch): NewThreadSeed {
  const say = typeof search.say === "string" && search.say !== "" ? search.say : null;
  const service = typeof search.service === "string" && search.service !== "" ? search.service : null;
  const project = service === null && typeof search.project === "string" && search.project !== "" ? search.project : null;
  if (search.new === "work") return { link: { kind: "new-work" }, say, service, project };
  if (typeof search.work === "string" && search.work !== "") return { link: { kind: "work", slug: search.work }, say, service, project };
  return { link: search.new === "thread" ? { kind: "no-work" } : null, say, service, project };
}

/**
 * 목록 줄의 「작업공간 만들기」 · 「새 채팅」(restart 03-1 · 스토리 8 · 13) — 그 범위(Project 또는 Service)를 고른 새 채팅의 주소다. 「작업공간 만들기」는
 * 「새 작업공간」 칩과 함께(`?new=work`), 「새 채팅」은 작업공간 없이(`?new=thread`) 연다.
 */
export function startSearch(start: "work" | "thread", scope: { project: string } | { service: string }): NewThreadSearch {
  return { new: start, ...scope };
}

/** 「새 작업공간」 칩을 ×로 뺀 주소 — 시작할 곳만 그냥 새 채팅(`?new=thread`)으로 바꾸고 범위와 입력 글은 그대로다. */
export function withoutNewWork(seed: NewThreadSeed): NewThreadSearch {
  return searchOf({ ...seed, link: { kind: "no-work" } });
}

/**
 * 새 채팅 화면의 열쇠 — 씨앗이 바뀌면 화면을 새로 세워 고른 것이 남지 않고 다른 입력 글 · 범위를 다시 넣는다. `?new=work`와 `?new=thread`만 같은 열쇠다:
 * 「새 작업공간」 칩을 빼거나 다시 세워도 고른 범위 · 모드 · 쓴 글이 남아야 한다. 씨앗이 없는 `/`는 다른 열쇠다 — ⌘N은 고른 것까지 걷는다.
 */
export function newThreadKey({ link, say, service, project }: NewThreadSeed): string {
  const place = link === null ? "" : link.kind === "work" ? `work:${link.slug}` : "new";
  return [place, say, service, project].join("\u0000");
}

/**
 * **지금 씨앗 없는 새 Thread에 서 있나**(02 구현 스펙 §4 · 스토리 10) — ⌘N과 위 칸 「새 채팅」이 가는 곳이다. 그렇다면 둘은 아무것도 하지
 * 않고(같은 주소가 히스토리에 한 칸 더 쌓이지 않게), 그 행은 고른 모양이다. 씨앗을 단 새 Thread(`/?work=` · `/?new=work` · `/?new=thread` ·
 * `/?say=` · `/?service=` · `/?project=`)는 아니다 — 거기서 누르면 씨앗이 걷힌 첫 화면으로 간다. 주소는 라우터가 읽은 그대로(`location` — 검증 전)라
 * 씨앗도 `seedOf`로 눕혀 읽는다.
 */
export function isBlankNewThread(location: { pathname: string; search: SeedSearch }): boolean {
  const seed = seedOf(location.search);
  return location.pathname === "/" && seed.link === null && seed.say === null && seed.service === null && seed.project === null;
}
