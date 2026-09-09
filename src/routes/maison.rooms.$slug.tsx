import { createFileRoute } from "@tanstack/react-router";
import WorksView from "./-works-view";
import { splitOf, validateWorkSearch, viewTab } from "./-work-search";

// 검색 검증기는 Atelier와 **그대로 공유한다**(스펙) — 문서·탭·분할은 세계가 갈려도 같은 축이다.
export const Route = createFileRoute("/maison/rooms/$slug")({
  component: RoomRoute,
  validateSearch: validateWorkSearch,
});

function RoomRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  return (
    <WorksView
      mode="maison"
      slug={slug}
      file={search.file ?? null}
      tab={viewTab(search)}
      split={splitOf(search)}
    />
  );
}
