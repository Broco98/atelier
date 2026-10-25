import { createFileRoute } from "@tanstack/react-router";
import { NewThreadScreen } from "@/features/thread/ThreadScreen";
import type { ThreadLink } from "@/features/thread/types";

// `/`는 **새 Thread**다(v1 구현 스펙 §13 · S26) — 앱은 늘 여기로 열린다. 한때 이 자리는 작업 목록으로 넘기기만 하는 주소였고
// (`/works`로 리다이렉트 → 이번 세션의 마지막 work), 그 마지막 자리 기억을 v1 티켓 05가 걷었다. 저장소를 읽지 않는 것은 그대로다 —
// 앞 판이 남긴 키(`last-mode`)가 있어도 그대로 둔다(ui-refresh 결정 23, `router.test.ts`).
export const Route = createFileRoute("/")({
  component: NewThreadRoute,
  validateSearch: validateNewThreadSearch,
});

/**
 * 새 Thread의 **처음 고를 곳**(Work 칩의 씨앗)이다. 씨앗일 뿐이라 칩에서 다른 것을 고르면 그것이 간다(주소는 그대로다). 모르는 모양은
 * 없는 것과 같다.
 * - `?work=<slug>` — 그 Work(v1 티켓 34). 요약 카드 「…」의 「이 Work에서 새 Thread」가 그 Work를 고른 채 새 Thread를 연다.
 * - `?new=work` — 「새 Work」(02 구현 스펙 S5 · 티켓 05). 사이드바 Work 묶음 머리의 +가 연다 — 첫 말을 받으면 Host가 Work로 묶는다.
 *   둘이 함께 오면 이것이다(+는 늘 이것만 싣는다).
 */
interface NewThreadSearch {
  work?: string;
  new?: "work";
}

function validateNewThreadSearch(search: Record<string, unknown>): NewThreadSearch {
  const seed = seedOf(search);
  if (seed.kind === "new-work") return { new: "work" };
  return seed.kind === "work" ? { work: seed.slug } : {};
}

/** 주소가 말하는 처음 고를 곳. 검증기가 주소를 청소하지 않아(`-work-search.ts`의 `viewTab` 머리말) 읽는 자리도 이것으로 눕힌다. */
function seedOf(search: { work?: unknown; new?: unknown }): ThreadLink {
  if (search.new === "work") return { kind: "new-work" };
  return typeof search.work === "string" && search.work !== "" ? { kind: "work", slug: search.work } : { kind: "no-work" };
}

// 틀(머리 줄 · 흰 판)은 앱 셸이 그려 화면이 사이드바 상태를 읽지 않는다(02 구현 스펙 §3).
function NewThreadRoute() {
  const seed = seedOf(Route.useSearch());
  // 씨앗이 바뀌면 화면을 새로 세운다 — `/?work=a`에서 `/`나 `/?work=b` · `/?new=work`로 가도 고른 곳이 남지 않는다.
  const key = seed.kind === "work" ? `work:${seed.slug}` : seed.kind;
  return <NewThreadScreen key={key} seed={seed} />;
}
