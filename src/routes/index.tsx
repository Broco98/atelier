import { createFileRoute, redirect } from "@tanstack/react-router";

// 앱 진입("/")을 작업 목록으로 정규화한다 — 작업이 이 앱의 본업이고 프로젝트는 설정에 가깝다.
// 목적지가 무선택 주소라 거기서 한 번 더 정규화된다: 이번 세션에서 마지막으로 보던 작업,
// 없으면 초안이 아닌 첫 작업.
// beforeLoad에서 던진 redirect는 라우터가 사용자 옵션과 무관하게 항상 REPLACE로 커밋하므로
// 히스토리가 늘지 않는다 — 시작 직후 뒤로가기는 아무 일도 하지 않는다.
// 이 성질은 라이브러리 내부 규칙이라 router.test.ts가 고정한다.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/works" });
  },
});
