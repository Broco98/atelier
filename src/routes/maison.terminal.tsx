import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import TerminalPage from "@/features/terminal/TerminalPage";

// `terminal.tsx`와 같은 이유로 평평한 파일이다 — 결정 16이 「셸 목록은 주소에 넣지 않는다」
// 이므로 `/maison/terminal`에도 자식이 영영 없다.
//
// 이 화면은 아직 `mode`를 안 받는다: 상주 셸의 소유자(`shell-registry.ts`)를 모드별로 가르는
// 것은 이 티켓 밖이고, 넘길 곳이 없는 값을 prop으로 세워 두면 「받는데 안 쓴다」가 된다.
export const Route = createFileRoute("/maison/terminal")({
  component: MaisonTerminalRoute,
});

function MaisonTerminalRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <TerminalPage sidebarOpen={sidebarOpen} />;
}
