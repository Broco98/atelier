import { createFileRoute } from "@tanstack/react-router";
import ArchiveView from "./-archive-view";

export const Route = createFileRoute("/archive/$slug")({ component: ArchiveRoute });

function ArchiveRoute() {
  const { slug } = Route.useParams();
  return <ArchiveView slug={slug} />;
}
