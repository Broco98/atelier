import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import ProcessesPage from "@/features/processes/ProcessesPage";

// `terminal.tsx`와 같은 평평한 파일이다 — 이 화면에는 자식 주소도 search 파라미터도 없다(티켓 26).
//
// 화면은 앱 전체를 보인다(프로세스 결정 9).
export const Route = createFileRoute("/processes")({
  component: ProcessesRoute,
});

// 셸 상태를 읽는 것은 라우트 층의 일이고 feature 화면은 prop으로 받는다(`terminal.tsx`와 같다).
function ProcessesRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <ProcessesPage sidebarOpen={sidebarOpen} />;
}
