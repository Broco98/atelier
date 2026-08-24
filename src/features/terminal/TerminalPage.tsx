import { useEffect } from "react";
import TerminalPane from "./TerminalPane";
import { opensShellFromWindow, TOP_TERMINAL } from "./shell-registry";
import { openNewShell } from "./terminal-store";

// 최상위 터미널(`/terminal`). Work에 매이지 않은 셸들이 사는 화면이고, cwd는 백엔드의
// 데이터 루트다(결정 12·25). 본문은 Work의 터미널 탭과 **같은 컴포넌트**다.
//
// **머리행이 없다 — 탭 줄이 그 자리다.** 이 화면의 브레드크럼에 적을 것은 `Terminal`
// 하나뿐인데, 그 한 낱말은 사이드바에서 이미 켜져 있는 항목이 말한다. 같은 말을 두 번
// 하려고 44px 한 층을 더 쓰는 대신 탭 줄을 그 층으로 올렸다. 창을 끄는 영역과 신호등
// 피하기는 탭 줄이 물려받는다(ShellTabs의 `titlebar`).
//
// Work의 터미널 탭은 이렇게 하지 않는다 — 그쪽 머리행에는 작업 이름·상태·뷰 탭이 있어
// 지울 것이 없다.
function TerminalPage({ sidebarOpen }: { sidebarOpen: boolean }) {
  // ⌘T — **셸이 0개여도 통한다**(결정 93). 그 키는 지금까지 xterm의 키 핸들러에만 붙어
  // 있어, 마지막 칸을 `×`로 닫은 화면에는 들을 사람이 없었다.
  //
  // 이 화면에는 옮길 본문이 없다(결정 98이 work 화면에 준 절반) — 본문이 이미 터미널이고
  // 여는 자리도 하나뿐이다. 언제 듣고 언제 비켜야 하는지는 `opensShellFromWindow`가 혼자
  // 안다: 셸 안에서는 xterm이 이미 열고 `stopPropagation`으로 여기까지 못 오게 막는다.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!opensShellFromWindow(e)) return;
      e.preventDefault();
      openNewShell(TOP_TERMINAL);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <TerminalPane work={null} titlebar={{ inset: !sidebarOpen }} />
      </main>
    </div>
  );
}

export default TerminalPage;
