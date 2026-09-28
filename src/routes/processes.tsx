import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import ProcessesPage from "@/features/processes/ProcessesPage";

// `terminal.tsx`와 같은 평평한 파일이다 — 이 화면에는 자식 주소도 search 파라미터도 없다(티켓 26).
//
// **두 세계의 주소가 같은 화면을 연다**(프로세스 결정 9 · `maison.processes.tsx`). 주소가 둘인 것은 각 세계의 nav가 자기
// 접두사로 가서 nav를 눌러 세계를 떠나지 않게 하려는 것이지, 화면이 세계를 가르기 때문이 아니다 — 화면은 앱 전체를 보인다.
// 넘기는 세계는 **차례**만 정한다: 지금 세계가 맨 위에 선다(티켓 27).
export const Route = createFileRoute("/processes")({
  component: ProcessesRoute,
});

// 셸 상태를 읽는 것은 라우트 층의 일이고 feature 화면은 prop으로 받는다(`terminal.tsx`와 같다).
function ProcessesRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  // **주소가 세계의 정본이다**(life-mode 결정 8) — 그 리터럴을 여기서 한 번만 적는다.
  return <ProcessesPage mode="atelier" sidebarOpen={sidebarOpen} />;
}
