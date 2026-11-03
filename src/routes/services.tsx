import { createFileRoute } from "@tanstack/react-router";
import ServicesPlace from "@/features/services/ServiceList";

// `/services`는 Services의 틀이다(restart 03-3 · 스펙 「03 — 목록과 상세」) — 사이드바 위 칸 「Services」가 여기로 온다. 목록과 상세(`/services/$slug`)가
// 한 자리를 번갈아 쓴다: 목록은 이 틀이 늘 그리고(상세가 선 동안에는 숨는다 — 찾는 글 · 정렬 · 스크롤이 남는다), 상세는 자식 라우트가 그린다. 고른
// 것으로 넘기지 않는다: 줄을 눌러야 상세다. 고치기 화면 둘(`/services/new` · `/services/$slug/edit`)은 이 틀 밖이다(`services_.…`). 머리 줄 · 카드
// 자리는 앱 셸이 그린다.
export const Route = createFileRoute("/services")({ component: ServicesPlace });
