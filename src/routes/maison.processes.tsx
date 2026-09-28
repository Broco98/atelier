import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import ProcessesPage from "@/features/processes/ProcessesPage";

// `processes.tsx`와 **같은 화면**이다(프로세스 결정 9) — 이 주소는 Maison nav가 자기 접두사로 가는 자리일 뿐이다. 세계를 넘기는
// 것은 **차례** 때문이다(티켓 27): 지금 세계가 맨 위에 선다. 무엇을 보이는지는 같다 — `maison.terminal.tsx`가 넘기는 세계는 그
// 화면의 셸을 가르지만, 여기서는 앱 전체의 셸 중 어느 세계를 먼저 세울지만 정한다.
export const Route = createFileRoute("/maison/processes")({
  component: MaisonProcessesRoute,
});

function MaisonProcessesRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <ProcessesPage mode="maison" sidebarOpen={sidebarOpen} />;
}
