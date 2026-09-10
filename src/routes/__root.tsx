import { createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import AppShell from "@/components/shell/AppShell";
import { rememberVisit } from "@/components/shell/shell-store";

// 셸(사이드바·상태바·타이틀바 컨트롤)은 라우트 트리의 뿌리에 있다 — 탭을 오가도 언마운트되지 않는다.
// context의 queryClient는 무선택 주소를 정규화할 때 목록을 읽는 데 쓴다 (routes/works.index.tsx).
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // **어느 세계에 있었는지를 적는 자리가 여기 하나다.** 뿌리의 beforeLoad는 어느 주소로 가든
  // 반드시 지나고 리다이렉트를 따라 다시 도므로, 마지막에 적히는 것은 실제로 머무는 주소다.
  // 화면(컴포넌트)에서 적으면 렌더가 필요해 라우터 테스트가 못 보고, 라우트마다 적으면
  // 화면이 하나 느는 날 잊는다.
  //
  // 모드를 안 싣는 주소는 `rememberVisit`이 걸러낸다 — 이 자리는 `/`도 지나므로, 거르지
  // 않으면 진입 정규화가 자기가 방금 읽을 값을 먼저 덮어쓴다.
  beforeLoad: ({ location }) => {
    rememberVisit(location.pathname);
  },
  component: AppShell,
});
