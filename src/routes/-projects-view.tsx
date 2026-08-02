import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import ProjectsPage from "@/features/projects/ProjectsPage";
import { useProjects } from "@/features/projects/hooks";
import { pickSlug, selectProject, shellStore } from "@/components/shell/shell-store";

// /projects와 /projects/$slug가 그리는 화면은 같다 — works 쪽과 같은 구조다 (-works-view.tsx 참조)
function ProjectsView({ slug }: { slug: string | null }) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const { data: projects = [], isPending, isFetching } = useProjects();

  const exists = slug !== null && projects.some((project) => project.slug === slug);

  const goTo = (next: string | null, replace = false) =>
    void (next
      ? navigate({ to: "/projects/$slug", params: { slug: next }, replace })
      : navigate({ to: "/projects", replace }));

  // 주소와 화면을 목록 변화에 맞춰 계속 붙여 둔다 (근거는 -works-view.tsx 주석)
  useEffect(() => {
    if (slug !== null && exists) {
      selectProject(slug);
      return;
    }
    if (isPending || isFetching) return;
    const next = pickSlug(shellStore.state.projectSlug, projects);
    if (next === slug) return;
    goTo(next, true);
    // goTo는 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
  }, [slug, exists, isPending, isFetching, projects]);

  return (
    <ProjectsPage
      sidebarOpen={sidebarOpen}
      selectedSlug={exists ? slug : null}
      // 목록 클릭(next=slug)은 이동이라 push, 선택 해제(next=null, 보던 프로젝트를 제거함)는
      // "보던 대상이 사라짐"이라 replace다 — push하면 지운 프로젝트를 가리키는 죽은 칸이 남아
      // 뒤로가기 한 번이 아무 일도 하지 않게 된다
      onSelect={(next) => goTo(next, next === null)}
      onOpenWork={(work) =>
        void (work
          ? navigate({ to: "/works/$slug", params: { slug: work } })
          : navigate({ to: "/works" }))
      }
    />
  );
}

export default ProjectsView;
