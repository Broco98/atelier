import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import ProcessesPage from "@/features/processes/ProcessesPage";

// `processes.tsx`와 **같은 화면**이다(프로세스 결정 9) — 이 주소는 Maison nav가 자기 접두사로 가는 자리일 뿐이다. 그래서 두
// 파일이 넘기는 것이 같다: 세계를 넘기지 않는다(`maison.terminal.tsx`는 넘긴다 — 그 화면의 셸은 세계의 것이다).
export const Route = createFileRoute("/maison/processes")({
  component: MaisonProcessesRoute,
});

function MaisonProcessesRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <ProcessesPage sidebarOpen={sidebarOpen} />;
}
