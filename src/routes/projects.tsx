import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import ProjectsPage from "@/features/projects/ProjectsPage";
import { selectProject, selectWork, shellStore } from "@/components/shell/shell-store";

export const Route = createFileRoute("/projects")({ component: ProjectsRoute });

// 셸 상태를 페이지 props로 옮겨주는 얇은 래퍼. 페이지 자체는 건드리지 않는다.
function ProjectsRoute() {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const projectSlug = useStore(shellStore, (state) => state.projectSlug);

  return (
    <ProjectsPage
      sidebarOpen={sidebarOpen}
      selectedSlug={projectSlug}
      onSelect={selectProject}
      onOpenWork={(slug) => {
        if (slug) selectWork(slug);
        void navigate({ to: "/works" });
      }}
    />
  );
}
