import { createFileRoute } from "@tanstack/react-router";
import SpaceEditor from "@/features/spaces/SpaceEditor";

// `/spaces/$slug/edit`는 그 Space의 관계 편집이다(03 구현 스펙 §13 · §14) — Space 파일을 글 그대로 고치는 화면. 상세 아래에 겹쳐 서지 않는
// 따로 선 화면이다(`$slug_` — 상세의 자식이 아니다).
export const Route = createFileRoute("/spaces/$slug_/edit")({ component: SpaceEditRoute });

function SpaceEditRoute() {
  const { slug } = Route.useParams();
  return <SpaceEditor key={slug} slug={slug} />;
}
