import { useEffect, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import ShellTabs from "./ShellTabs";
import { activeIdOf, shellEndLabels, shellsOf, TOP_TERMINAL, workShellOrigin } from "./shell-registry";
import type { ShellOrigin } from "./shell-registry";
import {
  attachShell,
  closeShell,
  detachShell,
  ensureShell,
  openNewShell,
  selectShell,
  terminalStore,
} from "./terminal-store";
import type { WorkView } from "@/features/works/types";

/**
 * 터미널 본문 — 탭 줄, 종료 줄, 셸이 들어앉는 자리. **머리행은 없다**: 최상위 터미널은
 * `/terminal`의 `PageHeader`를, Work의 터미널 탭은 `WorksPage`의 머리행을 이미 이고 있다.
 *
 * 이 컴포넌트가 소유하는 것은 **자리 하나뿐이다.** 셸도 xterm도 terminal-store가 들고 있어
 * 이 화면이 사라져도 그대로 산다(결정 20·21). 여기서 하는 일은 활성 칸의 집을 자리에 들이고
 * 갈아탈 때·나갈 때 도로 빼는 것이다.
 *
 * **`work` 하나가 나머지를 전부 정한다** — 소유자·cwd·프로젝트 목록이 거기서 나온다.
 * `null`이면 최상위 터미널이다.
 */
function TerminalPane({
  work,
  titlebar,
}: {
  work: WorkView | null;
  /** 탭 줄이 창 타이틀바를 겸하는가. 최상위 터미널만 그렇다 — ShellTabs의 같은 이름 참조. */
  titlebar?: { inset: boolean };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 좁히지 않고 통째로 읽는다 — 탭 줄이 앱 전체 상한을 세야 해서 어차피 전부 필요하다(결정 30).
  // **셀렉터를 빼면 컴파일이 안 된다** — 이 버전의 `useStore`는 인자 둘을 요구한다(TS2554).
  // 그러니 이 항등 셀렉터는 지울 수 있는 중간자가 아니다.
  // 새 상태를 **바뀔 때만** 만드는 것은 레지스트리가 지킨다(patch가 무변화에 같은 객체를
  // 돌려준다). 그래서 이 셀렉터는 프롬프트마다 오는 같은 타이틀에 다시 그리지 않는다.
  const state = useStore(terminalStore, (whole) => whole);
  const owner = work?.slug ?? null;
  const activeId = activeIdOf(state, owner);

  // **화면에 들어올 때만** 「없으면 하나 띄운다」다. 마지막 칸을 `×`로 닫은 자리에서는
  // 뜨지 않는다 — 닫자마자 새 셸이 뜨면 `×`가 무의미해진다.
  //
  // 의존성이 `owner` 하나인 것은 의도다. `work`는 목록이 갱신될 때마다 새 객체로 오는데
  // (dirty·exists를 다시 재서 온다) 그때마다 이 이펙트가 돌면 `×`로 비운 화면에 셸이
  // 저절로 돌아온다. 여기서 읽는 것은 그 순간의 `work`이고, 소유자가 그대로면 cwd도 그대로다.
  useEffect(() => {
    const origin = originOf(work, null);
    if (origin) ensureShell(origin);
  }, [owner]);

  // 갈아탈 때도 이 이펙트가 돈다: 먼저 이전 칸의 집을 빼고, 그 다음 새 칸의 집을 들인다.
  // 뺀다고 죽지 않는다는 것이 판 01이 만든 성질이다.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || activeId === null) return;
    attachShell(host, activeId);
    return () => detachShell(activeId);
  }, [activeId]);

  const active = shellsOf(state, owner).find((shell) => shell.id === activeId);
  const notice = active ? (shellEndLabels(active)?.notice ?? null) : null;

  return (
    <>
      <ShellTabs
        state={state}
        owner={owner}
        titlebar={titlebar}
        // **`worktrees`에서 뽑는다 — `projects`가 아니다.** `workShellOrigin`이 갈리는 기준이
        // `worktrees`라, 둘이 어긋나면 메뉴는 열리는데 고른 값으로 셸이 안 생긴다 —
        // 눌러도 아무 일이 없는 버튼(결정 11·21이 금지하는 것)이 된다. 코어가 둘을 1:1로
        // 만들어 주지만(works.rs의 to_view) 그 사실을 여기서 다시 믿지 않는다.
        projects={work?.worktrees.map((tree) => tree.project) ?? []}
        onSelect={selectShell}
        onClose={closeShell}
        onOpen={(project) => {
          const origin = originOf(work, project);
          if (origin) openNewShell(origin);
        }}
      />
      {/* 이 줄은 **비어 있어도 자리를 차지한다.** 죽은 셸의 마지막 화면을 그대로 두라는
          것이 결정 22인데, 조건부로 끼워 넣으면 나타나는 순간 컨테이너가 그만큼 낮아지고
          ResizeObserver가 그 화면을 한두 행 줄여 다시 흐르게 한다. 높이를 고정하면 없다.
          탭의 꼬리표(`42`)가 어느 칸인지를 말하고, 이 줄이 그 한 문장을 말한다. */}
      <div className="h-5 shrink-0 px-4 text-[12px] text-muted-foreground">{notice}</div>
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1 px-4 pb-3" />
    </>
  );
}

/** Work가 없으면 최상위 터미널이다 — 그 자리는 백엔드의 데이터 루트다(결정 25). */
function originOf(work: WorkView | null, project: string | null): ShellOrigin | null {
  return work ? workShellOrigin(work, project) : TOP_TERMINAL;
}

export default TerminalPane;
