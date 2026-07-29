import { createRootRoute } from "@tanstack/react-router";
import AppShell from "@/components/shell/AppShell";

// 셸(사이드바·상태바·타이틀바 컨트롤)은 라우트 트리의 뿌리에 있다 — 탭을 오가도 언마운트되지 않는다.
export const Route = createRootRoute({ component: AppShell });
