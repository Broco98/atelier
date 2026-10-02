import { createFileRoute, redirect } from "@tanstack/react-router";

// 앱 진입("/")을 **늘 작업 목록**으로 정규화한다. 저장소에 지운 모드 이름(`last-mode`)이 남아 있어도
// 그렇다 — 여기서는 저장소를 읽지 않는다.
// 목적지가 무선택 주소라 거기서 한 번 더 정규화된다: 이번 세션에서 마지막으로 보던 항목,
// 없으면 목록 첫 항목.
//
// **동기여야 한다.** async로 만들면 아래 REPLACE 성질이 사라지고(라우터가 다른
// 갈래로 커밋한다), 시작 직후 뒤로가기가 빈 칸으로 떨어진다.
//
// beforeLoad에서 던진 redirect는 라우터가 사용자 옵션과 무관하게 항상 REPLACE로 커밋하므로
// 히스토리가 늘지 않는다 — 시작 직후 뒤로가기는 아무 일도 하지 않는다.
// 이 성질은 라이브러리 내부 규칙이라 router.test.ts가 고정한다.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/works" });
  },
});
