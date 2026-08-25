import { useNavigate, useRouterState } from "@tanstack/react-router";
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

  // 본문이 지금 이 가지를 보여주는가 — 켜진 행 표시를 그때만 준다. 남의 work의 가지를
  // 펼쳐 놓았을 때 그쪽 활성 칸까지 강조되면 「지금 보고 있는 것」이 한 화면에 둘이 된다.
  const showing = useRouterState({
    select: (routerState) => {
      const { pathname, search } = routerState.location;
      if (owner === null) return pathname.startsWith("/terminal");
      // 슬러그에 한글이 들어가므로 경로에서 떼어낸 뒤 디코드한다(SidebarWorkList와 같은 규칙).
      const open = pathname.startsWith("/works/")
        ? decodeURIComponent(pathname.slice("/works/".length))
        : null;
      return open === owner && (search as { tab?: string }).tab === "terminal";
    },
  });

  // 본문을 이 가지로 옮긴다. 이미 이 work을 보고 있으면 `replace`다 — 탭을 한 번 눌렀는데
  // 되돌리는 데 뒤로가기를 두 번 눌러야 하는 일이 없다(결정 13). 남의 work이면 진짜 이동이라
  // 히스토리를 만든다.
  const go = () => {
    if (owner === null) {
      void navigate({ to: "/terminal" });
      return;
    }
    void navigate({
      to: "/works/$slug",
      params: { slug: owner },
      search: { tab: "terminal" as const },
      replace: showing,
    });
  };

  return (
    // 들여쓰기는 이 상자 하나가 준다 — 행은 자기 여백만 갖는다(ShellList 머리말).
    <div className="flex flex-col gap-[3px] pl-[18px]">
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
    </div>
  );
}

export default ShellBranch;
