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
  return (
    <WorksView
      slug={slug}
      file={search.file ?? null}
      tab={tab}
      // 파일 탭은 분할에 안 든다 — 본문에 선다(git-integration 티켓 04). 손으로 적은 주소가 둘을 함께 말해도 파일 탭이 이긴다.
      split={tab === "code" ? null : splitOf(search)}
      code={tab === "code" ? codeOf(search) : null}
    />
  );
}
