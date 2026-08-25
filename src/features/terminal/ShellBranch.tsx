import { useNavigate, useRouterState } from "@tanstack/react-router";
import { TreeIndent } from "@/components/shell/sidebar-tree";
import { tabSearch, workSlugOf } from "@/routes/-work-search";
import { useStore } from "@tanstack/react-store";
import ShellList from "./ShellList";
import { TOP_TERMINAL, workShellOrigin } from "./shell-registry";
import { openNewShell, requestCloseShell, selectShell, terminalStore } from "./terminal-store";
import type { WorkView } from "@/features/works/types";

/**
 * 사이드바 가지의 **속** — 셸 행들과 `+ 새 셸`이다(결정 71·72).
 *
 * **터미널 스토어를 구독하는 자리가 이 가지 하나다.** 목록(`SidebarWorkList`)이 구독하지
 * 않는 것은 값이 자주 흔들려서다: 셸은 프롬프트마다 OSC 타이틀을 쏘고 `claude`는 도는 동안
 * 그것을 계속 갈아 끼운다. 목록이 구독하면 그때마다 **모든 work 행이** 다시 그려진다.
 * 앞 판의 `PanelShells`가 같은 이유로 같은 모양이었다(결정 42의 슬롯 계약).
 *
 * 좁히지 않고 통째로 읽는 것은 목록이 **앱 전체** 상한을 세야 해서다(결정 30).
 * **셀렉터를 빼면 컴파일이 안 된다** — 이 버전의 `useStore`는 인자 둘을 요구한다(TS2554).
 *
 * **이동도 여기서 한다.** 행을 누르면 그 셸이 켜지고 **본문이 그 셸로 간다** — 남의 work의
 * 행이면 그 work로 함께 옮겨 간다(결정 101: 「남의 work 항목을 건드리면 그 work로 간다」).
 * 부르는 쪽에 콜백으로 올려 보내지 않는 것은 `SidebarWorkList`를 터미널에서 떼어 두기
 * 위해서다 — 그 파일이 이 모듈을 import하면 `@xterm/*`가 따라 들어와 정적 마크업 검사가
 * 서지 못한다(ShellList 머리말과 같은 계약).
 */
function ShellBranch({ work }: { work: WorkView | null }) {
  const state = useStore(terminalStore, (whole) => whole);
  const navigate = useNavigate();
  const owner = work?.slug ?? null;

  /**
   * 지금 **이 가지의 화면을 보고 있는가.** 둘로 갈라 읽는다 — `onThisWork`는 「이 work에
   * 있는가」이고 `showing`은 「본문이 이 가지인가」다. 하나로 합치면 아래 `go`가 같은
   * work 안에서 문서를 보다 셸을 누른 경우를 **남의 work으로 가는 것과 똑같이** 다루고,
   * 그러면 보던 문서가 조용히 떨어진다(결정 15가 막으려는 사고 그 자체다).
   *
   * **따로 구독한다.** 객체 하나로 묶어 돌려주면 매번 새 객체라 걸러내지 못해 주소가
   * 바뀔 때마다 이 가지가 다시 그려진다(AppShell의 같은 주석).
   */
  const onThisWork = useRouterState({
    select: (routerState) => {
      const { pathname } = routerState.location;
      return owner === null ? pathname.startsWith("/terminal") : workSlugOf(pathname) === owner;
    },
  });
  // 켜진 행 표시를 이때만 준다. 남의 work의 가지를 펼쳐 놓았을 때 그쪽 활성 칸까지
  // 강조되면 「지금 보고 있는 것」이 한 화면에 둘이 된다.
  const onTerminal = useRouterState({
    select: (routerState) => (routerState.location.search as { tab?: string }).tab === "terminal",
  });
  const showing = owner === null ? onThisWork : onThisWork && onTerminal;

  /**
   * 본문을 이 가지로 옮긴다.
   *
   * **이 work을 보던 중이면 보던 문서를 지킨다.** 이 라우터는 `search`에 객체를 주면 기존
   * search를 통째로 버려서, 문서를 읽다 셸 행을 누르면 `file`이 조용히 떨어진다 — 그리고
   * `spec` 잎으로 돌아왔을 때 읽던 문서가 아니라 기본 문서가 열린다(결정 15). 함수형으로
   * 얹으면 그 사고가 설 자리가 없다.
   *
   * **남의 work이면 빈 자리에서 시작한다**(결정 77) — 문서 경로는 그 work 안에서만 뜻이
   * 있어서 딸려가면 새 work에 없는 파일을 가리킨 채 주소만 남는다.
   *
   * `replace`도 같은 갈래를 탄다: 같은 work 안의 전환은 히스토리를 안 쌓고(결정 13),
   * 남의 work으로 가는 것은 진짜 이동이라 돌아올 자리를 만든다.
   */
  const go = () => {
    if (owner === null) {
      void navigate({ to: "/terminal" });
      return;
    }
    void navigate({
      to: "/works/$slug",
      params: { slug: owner },
      search: onThisWork
        ? (prev) => tabSearch(prev, "terminal")
        : { tab: "terminal" as const },
      replace: onThisWork,
    });
  };

  return (
    <TreeIndent>
      <ShellList
        state={state}
        owner={owner}
        // **`worktrees`에서 뽑는다 — `projects`가 아니다.** `workShellOrigin`이 갈리는 기준이
        // `worktrees`라, 둘이 어긋나면 메뉴는 열리는데 고른 값으로 셸이 안 생긴다 — 눌러도
        // 아무 일이 없는 버튼(결정 11·21이 금지하는 것)이 된다.
        projects={work?.worktrees.map((tree) => tree.project) ?? []}
        showing={showing}
        onSelect={(id) => {
          selectShell(id);
          go();
        }}
        onClose={requestCloseShell}
        onOpen={(project) => {
          // 프로젝트가 여럿인데 안 골랐으면 셸이 설 자리가 안 정해진다 — 그때는 열지도,
          // 본문을 옮기지도 않는다(결정 24).
          const origin = work ? workShellOrigin(work, project) : TOP_TERMINAL;
          if (!origin) return;
          openNewShell(origin);
          go();
        }}
      />
    </TreeIndent>
  );
}

export default ShellBranch;
