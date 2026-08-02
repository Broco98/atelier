import { createFileRoute } from "@tanstack/react-router";
import ArchiveView from "./-archive-view";

// 보고 있는 문서도 주소에 둔다 — Works와 같은 이유이고 같은 규칙이다
// (`routes/works.$slug.tsx`의 주석이 정본). 같은 문서를 어느 화면에서 열든
// 뒤로가기가 다르게 굴면 안 된다.
interface ArchiveSearch {
  file?: string;
}

export const Route = createFileRoute("/archive/$slug")({
  component: ArchiveRoute,
  validateSearch: (search: Record<string, unknown>): ArchiveSearch =>
    typeof search.file === "string" && search.file ? { file: search.file } : {},
});

function ArchiveRoute() {
  const { slug } = Route.useParams();
  const { file } = Route.useSearch();
  return <ArchiveView slug={slug} file={file ?? null} />;
}
