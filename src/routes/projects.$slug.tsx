import { createFileRoute } from "@tanstack/react-router";
import ProjectDetail from "@/features/projects/ProjectDetail";

// `/projects/$slug`는 Project 상세다(03 구현 스펙 §16). slug는 파일 이름이라 만든 뒤 바뀌지 않는다 — 이름을 고쳐도 주소는 그대로다.
export const Route = createFileRoute("/projects/$slug")({ component: ProjectRoute });

function ProjectRoute() {
  const { slug } = Route.useParams();
  return <ProjectDetail key={slug} slug={slug} />;
}
