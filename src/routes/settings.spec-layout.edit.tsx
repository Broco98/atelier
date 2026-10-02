import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import SpecLayoutEditor from "@/features/spec-layout/SpecLayoutEditor";

// 「spec 레이아웃」의 편집기(spec 레이아웃 티켓 11). 설정 한 열(620px)의 본문이 아니라 이 하위 주소의
// 별도 화면이다 — 설정 nav는 그대로 서고 「spec 레이아웃」이 켜져 있다(`settingsItemOf`). 레이아웃은 하나라
// 주소에 어느 레이아웃인지가 없다 — 고정 경로다(ui-refresh 결정 23).
export const Route = createFileRoute("/settings/spec-layout/edit")({
  component: EditorRoute,
});

// 셸 상태를 읽는 것은 라우트 층의 일이다(`-settings-view.tsx`와 같다).
function EditorRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <SpecLayoutEditor sidebarOpen={sidebarOpen} />;
}
