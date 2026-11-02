import { createFileRoute } from "@tanstack/react-router";
import WorksView from "./-works-view";
import { codeOf, opensWork, threadOf, validateWorkSearch, viewTab } from "./-work-search";

export const Route = createFileRoute("/works/$slug")({
  component: WorkRoute,
  // 공용 `validateFileSearch`가 아니라 Works 전용이다 — `tab`은 아카이브와 나누지 않는다(결정 14).
  validateSearch: validateWorkSearch,
});

function WorkRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  // 모르는 값을 눕히는 자리는 `viewTab`·`codeOf`·`threadOf` 셋뿐이다 — 검증기가 주소를 청소하지 않는다. 옛 `split`은 읽지 않는다(restart
  // 02a-13 — 분할이 걷혔다).
  const tab = viewTab(search);
  return (
    <WorksView
      slug={slug}
      file={search.file ?? null}
      tab={tab}
      // 파일 탭은 본문(`tab=code`)에 선다(git-integration S12). 그 밖의 `code`는 뜻이 없다.
      code={tab === "code" ? codeOf(search) : null}
      // 채팅 탭도 같다(restart 02a-4) — 본문(`tab=chat`)에 선다.
      thread={tab === "chat" ? threadOf(search) : null}
      // 탭도 채팅도 적지 않은 주소 — 작업공간을 처음 여는 규칙이 탭을 세운다. `tab=chat`만 적은 주소는 새 채팅 탭이다(restart 02a-8).
      opening={opensWork(search)}
    />
  );
}
