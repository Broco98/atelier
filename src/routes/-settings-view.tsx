import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import SettingsPage from "@/features/settings/SettingsPage";
import type { SettingsItemKey } from "@/features/settings/pages";

// 셸 상태를 읽는 것은 라우트 층의 일이고 feature 화면은 prop으로 받는다 —
// TerminalPage·ProjectsPage·ArchivePage가 전부 그 모양이다.
//
// 항목이 prop인 것은 **주소가 항목의 정본이기 때문이다**(UI개선 결정 22) — 설정 nav 항목마다
// 라우트 파일이 하나씩 있어(표는 `SETTINGS_ITEMS`) 각자 제 리터럴을 한 번씩 적는다. 화면이 주소를
// 다시 읽으면 구독이 하나 는다.
function SettingsView({ item }: { item: SettingsItemKey }) {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <SettingsPage sidebarOpen={sidebarOpen} item={item} />;
}

export default SettingsView;
