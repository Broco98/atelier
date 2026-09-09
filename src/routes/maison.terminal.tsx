import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import TerminalPage from "@/features/terminal/TerminalPage";

// `terminal.tsx`와 같은 이유로 평평한 파일이다 — 결정 16이 「셸 목록은 주소에 넣지 않는다」
// 이므로 `/maison/terminal`에도 자식이 영영 없다.
export const Route = createFileRoute("/maison/terminal")({
  component: MaisonTerminalRoute,
});

function MaisonTerminalRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  // 이 화면의 셸은 **Maison의 최상위**다(결정 10). 같은 컴포넌트가 `/terminal`도 그리므로
  // 갈리는 것은 이 값 하나이고, 여기서 빠지면 두 주소가 같은 셸 목록을 나눠 쓴다.
  return <TerminalPage mode="maison" sidebarOpen={sidebarOpen} />;
}
