import { createFileRoute } from "@tanstack/react-router";
import ProjectsView from "./-projects-view";

export const Route = createFileRoute("/projects/$slug")({ component: ProjectRoute });

function ProjectRoute() {
  const { slug } = Route.useParams();
  return <ProjectsView slug={slug} />;
}
