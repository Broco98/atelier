import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import WorksPage from "@/features/works/WorksPage";
import { selectProject, selectWork, shellStore } from "@/components/shell/shell-store";

export const Route = createFileRoute("/works")({ component: WorksRoute });

// 셸 상태를 페이지 props로 옮겨주는 얇은 래퍼. 페이지 자체는 건드리지 않는다.
function WorksRoute() {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const workSlug = useStore(shellStore, (state) => state.workSlug);

  return (
    <WorksPage
      sidebarOpen={sidebarOpen}
      selectedSlug={workSlug}
      onSelect={selectWork}
      onOpenProject={(slug) => {
        selectProject(slug);
        void navigate({ to: "/projects" });
      }}
    />
  );
}
