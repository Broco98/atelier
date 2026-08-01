import { createFileRoute } from "@tanstack/react-router";
import WorksView from "./-works-view";

export const Route = createFileRoute("/works/$slug")({ component: WorkRoute });

function WorkRoute() {
  const { slug } = Route.useParams();
  return <WorksView slug={slug} />;
}
