import { createFileRoute } from "@tanstack/react-router";
import WorksView from "./-works-view";

// 보고 있는 **문서**도 주소에 둔다. URL이 위치의 정본이라는 결정(이슈 #25)이 파일까지
// 미치는 이유는 하나다 — 문서 링크를 따라 들어갔으면 뒤로가기로 돌아올 수 있어야 한다.
// 링크가 없던 시절에는 문서를 옮기는 길이 트리뿐이라 이 값이 없어도 티가 나지 않았다.
//
// 값이 없으면 기본 문서(overview.md)를 본다는 뜻이다. 빈 문자열도 같은 뜻이라 여기서
// 걸러 내보내지 않는다 — 화면 쪽에서 한 번 더 판단하지 않아도 되게.
interface WorkSearch {
  file?: string;
}

export const Route = createFileRoute("/works/$slug")({
  component: WorkRoute,
  validateSearch: (search: Record<string, unknown>): WorkSearch =>
    typeof search.file === "string" && search.file ? { file: search.file } : {},
});

function WorkRoute() {
  const { slug } = Route.useParams();
  const { file } = Route.useSearch();
  return <WorksView slug={slug} file={file ?? null} />;
}
