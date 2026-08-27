import { useEffect } from "react";
import { useStore } from "@tanstack/react-store";
import ShellTabs from "./ShellTabs";
import TerminalPane from "./TerminalPane";
import {
  activeIdOf,
  closesShellFromWindow,
  opensShellFromWindow,
  sameBranch,
  shellForNav,
  shellNavFromWindow,
  shellsOf,
  TOP_TERMINAL,
} from "./shell-registry";
import { openNewShell, requestCloseShell, selectShell, terminalStore } from "./terminal-store";

// 최상위 터미널(`/terminal`). Work에 매이지 않은 셸들이 사는 화면이고, cwd는 백엔드의
// 데이터 루트다(결정 12·25). 본문은 Work의 터미널과 **같은 컴포넌트**다.
//
// **머리행이 탭 줄이다**(결정 8 · adr-03) — 그것도 work 화면과 같은 컴포넌트이고, 갈리는
// 것은 맨 앞 한 칸뿐이다: 이 화면에는 문서가 없어 `spec` 칸이 없고 ⌘1부터가 셸이다.
//
// **이 44px 한 층의 내력을 적어 둔다 — 안 적으면 다음 사람이 되돌린다.** 처음에 이 자리를
// 겸하던 것이 가로 탭 줄이었다(브레드크럼에 적을 것이 `Terminal` 한 낱말뿐이라 층을 아끼려던
// 것 — 결정 44). 셸을 고르는 자리가 사이드바 가지로 가면서 그 줄이 없어지자 창을 끌 영역도
// 신호등을 피할 여백도 남지 않아, 자리를 `PageHeader`에 돌려줬다(결정 72). 이번 판이 셸을
// 고르는 자리를 화면 안으로 되돌리므로(adr-03) 그 층을 다시 탭 줄이 가져간다 — 브레드크럼은
// 함께 사라지지만 두 몫(창 드래그·신호등 회피)은 이제 조건이 아니라 그 줄의 성질이다
// (ShellTabs 머리말).
//
// **셸이 0개일 때 여는 자리는 이 줄의 `+` 하나다**(결정 19). 한때 본문 가운데에도 목록이
// 덮여 있었는데(결정 102), 그 자리의 근거가 「탭 줄이 걷힌 뒤로 여는 길이 여기뿐이다」
// 하나여서 이 판이 그 줄을 되살리며 사라졌다. 본문에 남은 것은 조작이 아니라 **비었다는
// 표시와 여는 법**이고, 상한에 닿았을 때의 문장도 거기서 읽힌다 — `TerminalPane`의 주석이
// 사정을 든다.
function TerminalPage({ sidebarOpen }: { sidebarOpen: boolean }) {
  /**
   * 탭 줄이 그리는 것 — **스토어를 구독하는 자리가 화면이다.** 줄 자체는 상태와 콜백만
   * 받는다(ShellTabs 머리말): 그 파일이 terminal-store를 import하면 `@xterm/*`와 그 CSS가
   * 따라 들어와 정적 마크업 검사가 통째로 죽는다.
   *
   * 좁히지 않고 통째로 읽는 것은 그 줄이 **앱 전체** 상한을 세야 해서다(결정 30). 대신
   * 다시 그릴지는 `sameBranch`가 가른다 — 셸은 프롬프트마다 OSC 타이틀을 쏘는데 남의
   * work의 타이틀 하나에 이 화면이 다시 그려질 이유가 없다. `WorksPage`가 같은 자리에서
   * 같은 것을 한다.
   *
   * 한때 여기서 `activeShellOf`로 **칸 하나**를 구독했다 — 브레드크럼 말단에 켜진 셸의
   * 이름을 적으려던 것이었는데(결정 72), 그 자리가 브레드크럼과 함께 통째로 없어졌다.
   */
  const shellState = useStore(
    terminalStore,
    (whole) => whole,
    (a, b) => sameBranch(a, b, null),
  );

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
      // 첫 셸이 ⌘1이다 — 이 화면에는 문서가 없어 자리를 밀지 않는다. 아래 탭 줄도 같은
      // 이유로 셸부터 세우므로(`spec={null}`) 보이는 순서와 이 키가 고르는 것이 같다.
      const next = shellForNav(shells, activeIdOf(state, null), nav, 1);
      if (next !== null) selectShell(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * ⌘W — **켜진 칸을 닫는다**(결정 13). 이 화면에도 겨눌 칸이 서게 된 것이 그 근거다(adr-03).
   *
   * **`shellClosedByTab`(WorksPage)을 부르지 않는다.** 그 함수가 가르는 것은 「`spec`이
   * 켜져 있으면 아무 일도 안 한다」인데 이 화면에는 그 칸이 없고, 게다가 `owner`가 `null`이면
   * 그 함수는 언제나 `null`을 돌려준다 — 고른 작업이 없는 work 화면의 ⌘W가 **여기 셸을**
   * 죽이지 않게 막는 가드다. 그것을 여기서 부르면 이 키가 조용히 아무 일도 안 한다.
   *
   * 닫는 길은 여전히 `requestCloseShell` 하나다 — 확인 창을 우회하는 길을 새로 만들지
   * 않는다(결정 92가 `closeShell`을 밖으로 안 내보내는 그 이유). 셸 안에서는 xterm 핸들러가
   * 이미 같은 함수로 보내고 `stopPropagation`으로 여기까지 안 올라오므로 창이 두 번 안 뜬다.
   *
   * **겨눌 칸이 없으면 `preventDefault`도 안 부른다.** 이 앱의 메뉴에는 `close_window()`가
   * 없어(src-tauri/src/lib.rs) ⌘W는 원래 아무 일도 안 하는 키다 — 삼키는 시늉을 해 두면
   * 나중에 그 자리에 무엇이 생겼을 때 왜 안 오는지가 이 줄에 숨는다.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!closesShellFromWindow(e)) return;
      const id = activeIdOf(terminalStore.state, null);
      if (id === null) return;
      e.preventDefault();
      void requestCloseShell(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <ShellTabs
          state={shellState}
          // 이 화면의 셸은 Work에 안 매인다 — `shellsOf`의 계약상 그 소유자가 `null`이다.
          owner={null}
          // 물어볼 프로젝트가 없다 — `+`가 곧바로 연다. 묻게 하는 조건은 워크트리가 둘 이상인
          // work뿐이고(결정 24) 이 화면은 work가 아니다.
          projects={[]}
          // **맨 앞 한 칸이 없다**(결정 8). 문서가 없어 셸부터 서고, 그래서 ⌘1이 첫 셸이다 —
          // 위 `shellForNav(…, 1)`과 같은 비대칭 하나다.
          spec={null}
          // 본문이 늘 셸이다 — work 화면처럼 문서로 갈아탈 자리가 없어 조건이 아니다.
          showing
          // 왼쪽에 남은 것이 사이드바뿐이다 — 그게 접히면 이 줄이 창 왼쪽 끝에 붙는다
          inset={!sidebarOpen}
          onSelect={selectShell}
          // 확인을 거치는 길 하나다(결정 92) — ⌘W도 같은 함수로 온다.
          onClose={requestCloseShell}
          onOpen={() => openNewShell(TOP_TERMINAL)}
        />
        <TerminalPane work={null} />
      </main>
    </div>
  );
}

export default TerminalPage;
