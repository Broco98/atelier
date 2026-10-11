import { createFileRoute } from "@tanstack/react-router";
import WorksView from "./-works-view";
import { codeOf, splitOf, validateWorkSearch, viewTab } from "./-work-search";

export const Route = createFileRoute("/works/$slug")({
  component: WorkRoute,
  // 공용 `validateFileSearch`가 아니라 Works 전용이다 — `tab`은 아카이브와 나누지 않는다(결정 14).
  validateSearch: validateWorkSearch,
});

function WorkRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  // 모르는 값을 눕히는 자리는 `viewTab`·`splitOf`·`codeOf` 셋뿐이다 — 검증기가 주소를 청소하지 않는다.
  const tab = viewTab(search);
  const split = splitOf(search);
  return (
    <WorksView
      slug={slug}
      file={search.file ?? null}
      tab={tab}
      split={split}
      // 파일 탭은 본문(`tab=code`)이나 분할의 **묶음 열**에 선다(git-integration S12 · 티켓 07). 그 밖의 `code`는 뜻이 없다.
      code={tab === "code" || split !== null ? codeOf(search) : null}
    />
  );
}
