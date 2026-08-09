import { createFileRoute } from "@tanstack/react-router";
import WorksView from "./-works-view";
import { validateFileSearch } from "./-file-search";

export const Route = createFileRoute("/works/$slug")({
  component: WorkRoute,
  validateSearch: validateFileSearch,
});

function WorkRoute() {
  const { slug } = Route.useParams();
  const { file } = Route.useSearch();
  return <WorksView slug={slug} file={file ?? null} />;
}
