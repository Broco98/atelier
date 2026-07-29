import { createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import AppShell from "@/components/shell/AppShell";

// 셸(사이드바·상태바·타이틀바 컨트롤)은 라우트 트리의 뿌리에 있다 — 탭을 오가도 언마운트되지 않는다.
// context의 queryClient는 무선택 주소를 정규화할 때 목록을 읽는 데 쓴다 (routes/works.index.tsx).
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: AppShell,
});
