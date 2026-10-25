import { createFileRoute } from "@tanstack/react-router";
import { NewThreadScreen } from "@/features/thread/ThreadScreen";
import { seedOf, validateNewThreadSearch } from "./-new-thread-search";

// `/`는 **새 Thread**다(v1 구현 스펙 §13 · S26) — 앱은 늘 여기로 열린다. 한때 이 자리는 작업 목록으로 넘기기만 하는 주소였고
// (`/works`로 리다이렉트 → 이번 세션의 마지막 work), 그 마지막 자리 기억을 v1 티켓 05가 걷었다. 저장소를 읽지 않는 것은 그대로다 —
// 앞 판이 남긴 키(`last-mode`)가 있어도 그대로 둔다(ui-refresh 결정 23, `router.test.ts`).
//
// search는 **처음 고를 곳**(Work 칩의 씨앗 — `?work=<slug>` · `?new=work`)이다. 그 규칙은 `-new-thread-search.ts` 한 곳이다 — 앱 셸의 ⌘N과
// 사이드바 위 줄 「새 Thread」가 같은 규칙으로 「씨앗 없는 새 Thread인가」를 읽는다(02 코드 리뷰 S1).
export const Route = createFileRoute("/")({
  component: NewThreadRoute,
  validateSearch: validateNewThreadSearch,
});

// 틀(머리 줄 · 흰 판)은 앱 셸이 그려 화면이 사이드바 상태를 읽지 않는다(02 구현 스펙 §3).
function NewThreadRoute() {
  const seed = seedOf(Route.useSearch());
  // 씨앗이 바뀌면 화면을 새로 세운다 — `/?work=a`에서 `/`나 `/?work=b` · `/?new=work`로 가도 고른 곳이 남지 않는다.
  const key = seed.kind === "work" ? `work:${seed.slug}` : seed.kind;
  return <NewThreadScreen key={key} seed={seed} />;
}
