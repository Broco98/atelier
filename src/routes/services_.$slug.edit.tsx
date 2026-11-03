import { createFileRoute } from "@tanstack/react-router";
import ServiceEditor from "@/features/services/ServiceEditor";

// `/services/$slug/edit`는 그 Service의 파일로 고치기다(03 구현 스펙 §13 · §14 · restart 03-3) — Service 파일을 글 그대로 고치는 화면. 상세의 ⋯와 경고의
// 「파일로 고치기」가 연다. 목록 · 상세의 틀(`/services` — 목록과 상세가 한 자리를 번갈아 쓴다) 밖에 따로 선 화면이다(`services_` — 틀의 자식이 아니다).
export const Route = createFileRoute("/services_/$slug/edit")({ component: ServiceEditRoute });

function ServiceEditRoute() {
  const { slug } = Route.useParams();
  return <ServiceEditor key={slug} slug={slug} />;
}
