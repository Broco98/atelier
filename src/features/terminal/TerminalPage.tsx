import { useEffect, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import PageHeader from "@/components/shell/PageHeader";
import type { ShellsState } from "./shell-registry";
import { mountShell, terminalStore, unmountShell } from "./terminal-store";

// 활성 셸의 상태를 그 줄에 적을 한 문장으로 옮긴다(결정 22·23). 문자열 하나라 `useStore`가
// 값으로 비교한다 — 매 렌더 새 객체를 만들어 스스로를 다시 부르는 경로가 없다.
function selectNotice(state: ShellsState): string | null {
  const status = state.shells.find((shell) => shell.id === state.activeId)?.status;
  if (!status) return null;
  if (status.kind === "failed") return status.reason;
  if (status.kind === "exited") {
    return status.exit.signal !== null
      ? `신호로 종료 — ${status.exit.signal}`
      : `종료 코드 ${status.exit.exitCode}`;
  }
  return null;
}

// 이 컴포넌트가 소유하는 것은 **자리 하나뿐이다.** 셸도 xterm도 terminal-store가 들고 있어
// 이 화면이 사라져도 그대로 산다(결정 20·21). 여기서 하는 일은 그 집을 자리에 들이고
// 나갈 때 도로 빼는 것이다.
function TerminalPage({ sidebarOpen }: { sidebarOpen: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const notice = useStore(terminalStore, selectNotice);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const id = mountShell(host);
    return () => unmountShell(id);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <PageHeader root="Terminal" inset={!sidebarOpen} />
        {/* 이 줄은 **비어 있어도 자리를 차지한다.** 죽은 셸의 마지막 화면을 그대로 두라는
            것이 결정 22인데, 조건부로 끼워 넣으면 나타나는 순간 컨테이너가 그만큼 낮아지고
            ResizeObserver가 그 화면을 한두 행 줄여 다시 흐르게 한다. 높이를 고정하면 없다. */}
        <div className="h-5 shrink-0 px-4 text-[12px] text-muted-foreground">{notice}</div>
        <div ref={hostRef} className="min-h-0 min-w-0 flex-1 px-4 pb-3" />
      </main>
    </div>
  );
}

export default TerminalPage;
