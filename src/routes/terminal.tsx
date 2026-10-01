import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import TerminalPage from "@/features/terminal/TerminalPage";

// `.index` 파일이 아니라 평평한 파일이다 — 결정 16이 「셸 목록은 주소에 넣지 않는다」이므로
// `/terminal`에는 자식이 영영 없다. search 파라미터도 갖지 않는다.
export const Route = createFileRoute("/terminal")({
  component: TerminalRoute,
});

// 셸 상태를 읽는 것은 라우트 층의 일이고 feature 화면은 prop으로 받는다 —
// ProjectsPage·WorksPage·ArchivePage가 전부 그 모양이다(`-works-view.tsx` 등).
// 이 라우트는 넘길 것이 하나뿐이라 별도 `-terminal-view.tsx`를 두지 않는다.
function TerminalRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <TerminalPage sidebarOpen={sidebarOpen} />;
}
