import { createFileRoute, redirect } from "@tanstack/react-router";
import { projectsQuery } from "@/features/projects/hooks";
import { pickSlug, shellStore } from "@/components/shell/shell-store";
import ProjectsView from "./-projects-view";

// works.index.tsx와 같은 규칙 — 근거는 그쪽 주석에 적었다
export const Route = createFileRoute("/projects/")({
  beforeLoad: async ({ context }) => {
    const projects = await context.queryClient
      .ensureQueryData(projectsQuery)
      .catch(() => []);
    const slug = pickSlug(shellStore.state.projectSlug, projects);
    if (slug) throw redirect({ to: "/projects/$slug", params: { slug } });
  },
  component: ProjectsIndexRoute,
});

function ProjectsIndexRoute() {
  return <ProjectsView slug={null} />;
}
