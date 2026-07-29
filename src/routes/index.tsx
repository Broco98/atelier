import { createFileRoute, redirect } from "@tanstack/react-router";

// 앱 진입("/")을 프로젝트 목록으로 정규화한다.
// beforeLoad에서 던진 redirect는 라우터가 사용자 옵션과 무관하게 항상 REPLACE로 커밋하므로
// 히스토리가 늘지 않는다 — 시작 직후 뒤로가기는 아무 일도 하지 않는다.
// 이 성질은 라이브러리 내부 규칙이라 router.test.ts가 고정한다.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/projects" });
  },
});
