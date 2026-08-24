import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import SettingsPage from "@/features/settings/SettingsPage";

// `/terminal`과 같은 평평한 파일이다 — 설정에는 고를 항목이 없어 자식도 search 파라미터도
// 영영 없다. 값은 주소가 아니라 `~/.atelier/settings.json`이 들고 있다(결정 53).
export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

// 셸 상태를 읽는 것은 라우트 층의 일이고 feature 화면은 prop으로 받는다 —
// TerminalPage·ProjectsPage·ArchivePage가 전부 그 모양이다.
function SettingsRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <SettingsPage sidebarOpen={sidebarOpen} />;
}
