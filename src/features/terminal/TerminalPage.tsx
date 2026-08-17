import { useEffect, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import PageHeader from "@/components/shell/PageHeader";
import ShellTabs from "./ShellTabs";
import { shellEndLabels } from "./shell-registry";
import {
  attachShell,
  closeShell,
  detachShell,
  ensureShell,
  openNewShell,
  selectShell,
  terminalStore,
} from "./terminal-store";

// 이 컴포넌트가 소유하는 것은 **자리 하나뿐이다.** 셸도 xterm도 terminal-store가 들고 있어
// 이 화면이 사라져도 그대로 산다(결정 20·21). 여기서 하는 일은 활성 칸의 집을 자리에 들이고
// 갈아탈 때·나갈 때 도로 빼는 것이다.
function TerminalPage({ sidebarOpen }: { sidebarOpen: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 좁히지 않고 통째로 읽는다 — 탭 줄이 목록과 활성을 함께 쓰므로 좁혀 봐야 같은 값이다.
  // **셀렉터를 빼면 컴파일이 안 된다** — 이 버전의 `useStore`는 인자 둘을 요구한다(TS2554).
  // 그러니 이 항등 셀렉터는 지울 수 있는 중간자가 아니다.
  // 새 상태를 **바뀔 때만** 만드는 것은 레지스트리가 지킨다(patch가 무변화에 같은 객체를
  // 돌려준다). 그래서 이 셀렉터는 프롬프트마다 오는 같은 타이틀에 다시 그리지 않는다.
  const state = useStore(terminalStore, (whole) => whole);
  const activeId = state.activeId;

  // **화면에 들어올 때만** 「없으면 하나 띄운다」다. 마지막 칸을 `×`로 닫은 자리에서는
  // 뜨지 않는다 — 닫자마자 새 셸이 뜨면 `×`가 무의미해진다.
  useEffect(() => {
    ensureShell();
  }, []);

  // 갈아탈 때도 이 이펙트가 돈다: 먼저 이전 칸의 집을 빼고, 그 다음 새 칸의 집을 들인다.
  // 뺀다고 죽지 않는다는 것이 판 01이 만든 성질이다.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || activeId === null) return;
    attachShell(host, activeId);
    return () => detachShell(activeId);
  }, [activeId]);

  const active = state.shells.find((shell) => shell.id === activeId);
  const notice = active ? (shellEndLabels(active)?.notice ?? null) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <PageHeader root="Terminal" inset={!sidebarOpen} />
        <ShellTabs
          state={state}
          onSelect={selectShell}
          onClose={closeShell}
          onOpen={openNewShell}
        />
        {/* 이 줄은 **비어 있어도 자리를 차지한다.** 죽은 셸의 마지막 화면을 그대로 두라는
            것이 결정 22인데, 조건부로 끼워 넣으면 나타나는 순간 컨테이너가 그만큼 낮아지고
            ResizeObserver가 그 화면을 한두 행 줄여 다시 흐르게 한다. 높이를 고정하면 없다.
            탭의 꼬리표(`42`)가 어느 칸인지를 말하고, 이 줄이 그 한 문장을 말한다. */}
        <div className="h-5 shrink-0 px-4 text-[12px] text-muted-foreground">{notice}</div>
        <div ref={hostRef} className="min-h-0 min-w-0 flex-1 px-4 pb-3" />
      </main>
    </div>
  );
}

export default TerminalPage;
