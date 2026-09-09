import { createFileRoute } from "@tanstack/react-router";
import ArchiveView from "./-archive-view";
import { validateFileSearch } from "./-file-search";

export const Route = createFileRoute("/maison/archive/$slug")({
  component: MaisonArchiveRoute,
  validateSearch: validateFileSearch,
});

function MaisonArchiveRoute() {
  const { slug } = Route.useParams();
  const { file } = Route.useSearch();
  return <ArchiveView mode="maison" slug={slug} file={file ?? null} />;
}
