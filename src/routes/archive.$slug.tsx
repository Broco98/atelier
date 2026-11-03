import { createFileRoute } from "@tanstack/react-router";
import ArchiveDetail from "@/features/archive/ArchiveDetail";
import { validateFileSearch } from "./-file-search";

// `/archive/$slug`는 Archive 상세다(restart 03-4 · 스토리 120). `?file=`이 읽는 문서다 — 상세의 「문서」 트리 · 문서 안 링크 · 검색(⌘K의 아카이브 문서 줄 —
// `hitTarget`)이 이 값을 쓴다. 검증기는 Works와 같은 것이다(경로의 뜻이 하나다).
export const Route = createFileRoute("/archive/$slug")({
  component: ArchiveRoute,
  validateSearch: validateFileSearch,
});

function ArchiveRoute() {
  const { slug } = Route.useParams();
  const { file } = Route.useSearch();
  return <ArchiveDetail key={slug} slug={slug} file={file ?? null} />;
}
