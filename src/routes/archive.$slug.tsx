import { createFileRoute } from "@tanstack/react-router";
import ArchiveView from "./-archive-view";
import { validateFileSearch } from "./-file-search";

export const Route = createFileRoute("/archive/$slug")({
  component: ArchiveRoute,
  validateSearch: validateFileSearch,
});

function ArchiveRoute() {
  const { slug } = Route.useParams();
  const { file } = Route.useSearch();
  return <ArchiveView slug={slug} file={file ?? null} />;
}
