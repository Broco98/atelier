import { useEffect } from "react";
import PageHeader from "@/components/shell/PageHeader";
import TerminalPane from "./TerminalPane";
import {
  activeIdOf,
  opensShellFromWindow,
  shellForNav,
  shellNavFromWindow,
  shellsOf,
  TOP_TERMINAL,
} from "./shell-registry";
import { openNewShell, selectShell, terminalStore } from "./terminal-store";

// 최상위 터미널(`/terminal`). Work에 매이지 않은 셸들이 사는 화면이고, cwd는 백엔드의
// 데이터 루트다(결정 12·25). 본문은 Work의 터미널과 **같은 컴포넌트**다.
//
// **머리행이 돌아왔다**(결정 72). 앞 판은 이 자리를 가로 탭 줄이 겸했다 — 브레드크럼에
// 적을 것이 `Terminal` 한 낱말뿐이라 44px 한 층을 아끼려던 것이었는데, 셸을 고르는 자리가
// 사이드바 가지로 가면서 그 줄 자체가 없어졌다. 그러면 이 화면 맨 위에 창을 끌 영역도
// 신호등을 피할 여백도 남지 않는다 — 둘 다 그 줄이 물려받고 있던 몫이라, 자리를 다시
// `PageHeader`에 돌려준다.
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

  /**
   * ⌘1~9와 ⌃Tab이 **이 화면의 셸**을 고른다(결정 78·79·109).
   *
   * work 화면과 갈리는 자리가 ⌘1 하나다 — 거기서는 그것이 spec이지만 이 화면에는 문서가
   * 없어 ⌘1부터가 셸이다. 그 어긋남을 여기서 흡수한다: 판정은 한 벌이고 무엇을 세는지만
   * 화면이 정한다.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const nav = shellNavFromWindow(e);
      if (!nav) return;
      e.preventDefault();
      const state = terminalStore.state;
      const shells = shellsOf(state, null);
      // 첫 셸이 ⌘1이다 — 이 화면에는 문서가 없어 자리를 밀지 않는다.
      const next = shellForNav(shells, activeIdOf(state, null), nav, 1);
      if (next !== null) selectShell(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* 왼쪽에 남은 것이 사이드바뿐이다 — 그게 접히면 본문이 창 왼쪽 끝에 붙는다 */}
        <PageHeader root="Terminal" inset={!sidebarOpen} />
        <TerminalPane work={null} />
      </main>
    </div>
  );
}

export default TerminalPage;
