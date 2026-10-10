import { createFileRoute } from "@tanstack/react-router";
import WorksView from "./-works-view";
import { splitOf, validateWorkSearch, viewTab } from "./-work-search";

export const Route = createFileRoute("/works/$slug")({
  component: WorkRoute,
  // 공용 `validateFileSearch`가 아니라 Works 전용이다 — `tab`은 아카이브와 나누지 않는다(결정 14).
  validateSearch: validateWorkSearch,
});

function WorkRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  // 모르는 값을 눕히는 자리는 `viewTab`·`splitOf` 둘뿐이다 — 검증기가 주소를 청소하지 않는다.
  return (
    <WorksView
      slug={slug}
      file={search.file ?? null}
      tab={viewTab(search)}
      split={splitOf(search)}
    />
  );
}
