import { createFileRoute } from "@tanstack/react-router";
import ServiceList from "@/features/services/ServiceList";

// `/services`는 Service 목록이다(03 구현 스펙 §14) — 사이드바 위 칸 「Services」가 여기로 온다. 목록 화면이지만 고른 것으로 넘기지 않는다: 줄을
// 눌러야 상세(`/services/$slug`)다. 틀(머리 줄 · 흰 판)은 앱 셸이 그린다.
export const Route = createFileRoute("/services/")({ component: ServiceList });
