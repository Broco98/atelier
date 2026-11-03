import { createFileRoute } from "@tanstack/react-router";
import ServiceEditor from "@/features/services/ServiceEditor";

// `/services/new`는 새 Service — 「직접 만들기」다(03 구현 스펙 §13 · §14). 빈 틀의 Service 파일을 고치기 화면에 연다. 저장하면 그 글의 이름에서
// slug가 서고 그 상세로 간다. 상세(`/services/$slug`)보다 이 주소가 먼저라 core는 새 Service의 slug로 `new`를 쓰지 않는다(`new_service_slug`). 목록 ·
// 상세의 틀(`/services`) 밖에 따로 선 화면이다(restart 03-3 — `services_`).
export const Route = createFileRoute("/services_/new")({ component: () => <ServiceEditor slug={null} /> });
