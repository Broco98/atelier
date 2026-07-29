import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./query-client";

// history를 넘기지 않으면 브라우저에서 createBrowserHistory()가 자동 생성된다.
// 그것이 곧 마우스 사이드 버튼이 동작하는 이유다 — wry가 window.history.back()을
// 직접 호출하고 라우터가 popstate로 받는다.
export const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
