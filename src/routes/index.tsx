import { createFileRoute, redirect } from "@tanstack/react-router";
import { lastMode } from "@/components/shell/shell-store";
import { routesOf } from "@/mode";

// 앱 진입("/")을 **마지막으로 있던 세계의 첫 화면**으로 정규화한다. 그 세계에서 무엇이
// 본업인지는 목록 화면이 알고 있다 — Atelier는 작업, Maison은 Rooms.
// 목적지가 무선택 주소라 거기서 한 번 더 정규화된다: 이번 세션에서 마지막으로 보던 항목,
// 없으면 초안이 아닌 첫 항목.
//
// 읽기는 **동기여야 한다.** async로 만들면 아래 REPLACE 성질이 사라지고(라우터가 다른
// 갈래로 커밋한다), 시작 직후 뒤로가기가 빈 칸으로 떨어진다. 저장소 접근이 던지는 것을
// 삼키는 것은 `lastMode`가 하고, 그래서 여기에는 try가 없다.
//
// beforeLoad에서 던진 redirect는 라우터가 사용자 옵션과 무관하게 항상 REPLACE로 커밋하므로
// 히스토리가 늘지 않는다 — 시작 직후 뒤로가기는 아무 일도 하지 않는다.
// 이 성질은 라이브러리 내부 규칙이라 router.test.ts가 고정한다.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: routesOf(lastMode()).list });
  },
});
