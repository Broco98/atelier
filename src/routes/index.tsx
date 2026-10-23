import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import { NewThreadScreen } from "@/features/thread/ThreadScreen";

// `/`는 **새 Thread**다(v1 구현 스펙 §13 · S26) — 앱은 늘 여기로 열린다. 한때 이 자리는 작업 목록으로 넘기기만 하는 주소였고
// (`/works`로 리다이렉트 → 이번 세션의 마지막 work), 그 마지막 자리 기억을 v1 티켓 05가 걷었다. 저장소를 읽지 않는 것은 그대로다 —
// 앞 판이 남긴 키(`last-mode`)가 있어도 그대로 둔다(ui-refresh 결정 23, `router.test.ts`).
export const Route = createFileRoute("/")({
  component: NewThreadRoute,
});

// 셸 상태를 읽는 것은 라우트 층의 일이고 feature 화면은 prop으로 받는다(`terminal.tsx`와 같다).
function NewThreadRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <NewThreadScreen sidebarOpen={sidebarOpen} />;
}
