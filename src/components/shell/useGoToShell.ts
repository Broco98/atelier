import { useCallback } from "react";
import { useRouter, type NavigateOptions } from "@tanstack/react-router";
import { modeOfOwner, slugOfOwner } from "@/features/terminal/shell-registry";
import type { ShellOwner } from "@/features/terminal/shell-registry";
import { focusShell, isOrphanedShell, selectShell } from "@/features/terminal/terminal-store";
import { recallSearch, tabSearch } from "@/routes/-work-search";
import { modeOf, routesOf, slugOf } from "@/mode";
import { whenArrived } from "@/lib/arrival";
import { viewProcesses } from "./processes-view";

/**
 * **셸로 가는 길 하나**(결정 13의 넷째 · 다섯째 · 프로세스 결정 16). 알림 띠의 줄을 누를 때와 ⌘J(방금 부른 셸로 —
 * 티켓 23)가 같은 이것을 부른다. 판 03의 알림 클릭(되는 날)과 판 04 `Processes`의 [이동]도 여기로 온다 — 길마다 적으면
 * 한쪽만 포커스를 잃거나 한쪽만 주인 잃은 셸로 간다.
 *
 * **둘로 갈린 일 하나다**: 셸을 켜는 것은 스토어의 일이라 주소와 무관하고, 화면을 옮기는 것은 주소를 쥔 쪽의 일이다 —
 * `WorksPage`의 `dropHere`가 같은 분담을 이미 쓰고 있다.
 *
 * **spec을 보고 있었으면 터미널로 밀어낸다**(결정 13의 넷째) — 결정 10의 알림 클릭 규칙과 같은 자리로 간다. **분할은 안
 * 건드린다**: 분할 중이면 두 열이 이미 서 있으므로 바뀌는 것은 터미널 열의 탭 하나뿐이고, 분할을 자동으로 여는 안은 「사람이
 * 안 시킨 레이아웃 변경」이라 기각됐다.
 *
 * 주소를 짓는 모양이 둘인 것은 work이 같은가로 갈리기 때문이다 — 같으면 보던 문서와 분할을 지켜야 해서 **함수형**이고
 * (결정 15가 그 형태를 못박았다), 다르면 그 work의 마지막 화면을 씨앗으로 삼는다(`recallSearch`, 결정 77·97). `dropInto`가 같은
 * 갈림을 같은 모양으로 쓴다. **이 자리가 `recallSearch`를 부르는 여섯 문 중 하나다** — 그쪽 머리말이 그 문들을 이름으로 세고
 * 있으니 여기가 늘거나 줄면 그 목록도 함께 고친다. 같은 work 안에서는 `replace`다(결정 13) — 탭을 한 번 옮겼는데 되돌리는 데
 * 뒤로가기를 두 번 눌러야 하는 일이 없다. 화면이 통째로 바뀌는 쪽은 히스토리를 남긴다.
 *
 * **세계는 셸의 것이다 — 지금 선 화면의 것이 아니다.** 띠는 이 세계의 셸만 세우지만(`bandRows`), ⌘J가 기억한 셸은 저쪽
 * 세계의 것일 수 있다(알림도 두 세계를 함께 판정한다). 그래서 목적지와 씨앗은 셸 주인의 세계로 짓고, 「같은 work인가」도
 * 세계까지 견준다 — slug만 보면 두 세계의 같은 이름 work이 같은 자리로 읽혀 저쪽 화면의 검색 값을 이쪽에 싣는다. 지금 주소는
 * **부를 때** 읽는다(`router.state`) — 구독하면 주소가 바뀔 때마다 부르는 화면이 다시 그려진다(`navigateGuardingSettings`와
 * 같은 수법).
 *
 * **키보드 포커스도 데려간다**(티켓 16 · 프로세스 스펙 S21). 지금 보고 있는 셸이면 그 자리에서, 다른 탭 · 다른 work의 셸이면
 * 화면이 옮겨져 그 셸이 붙는 순간 온다(`focusShell`). 셸을 켜기 **전에** 부른다 — 요청이 먼저 적혀 있으면 켜기가 언제 붙기를
 * 부르든 그 붙음이 요청을 본다. 주인 잃은 셸 갈림(`isOrphanedShell`) **뒤에** 부른다 — 앞에 두면 붙을 화면이 없는 셸에 기다리는
 * 포커스가 남아, 그 셸이 닫히거나 새 요청이 올 때까지 다른 셸이 붙어도 포커스를 못 받는다. 이웃 work(`sidebar-active-band`)이
 * 띠 처리기를 옮기면 이 함수를 부르는 줄만 옮기면 된다 — 한때 이 몸통이 `Sidebar.tsx`의 띠 처리기(`useOpenBand`) 안에 있었다.
 *
 * **켜기와 요청은 이동이 닿은 순간이다**(`whenArrived` — develop 머지). spec 레이아웃 편집기의 떠날 때 확인이 이동을 막을 수
 * 있어서다(`useConfirmLeave`). 한때 이동을 걸기 전에 켜고 요청했는데, 그러면 [계속 편집]에 막혀도 그 work의 탭은 바뀐 채,
 * 요청은 그 셸을 기다리는 채 남아 다음에 붙는 다른 셸이 포커스를 못 받았다 — 주인 잃은 셸 갈림 뒤에 둔 까닭과 같은 함정이
 * 막힌 이동 뒤에서 다시 열린 것이다. 닿음은 새 화면이 그려지기 전에 오므로 막히지 않는 길은 예전과 같다: 켜진 셸로 화면이
 * 처음부터 서고, 요청은 그 셸이 붙기 전에 적힌다. 목적지는 이동과 같은 옵션으로 한 번 지어(`buildLocation`) 닿은 주소와 견준다.
 *
 * **주인 잃은 셸은 화면 이동 전에 갈린다**(프로세스 스펙 S14 · 티켓 12 · 32). 그 work은 목록에 없어 가면 없는 work으로 간다 —
 * 대신 `Processes`로 간다: 그 화면의 주인 잃은 셸 묶음이 그 셸을 들고 [모두 닫기]를 든다. 가는 길은 토스트의 [보기]와 같은
 * 문이다(`viewProcesses`). 셸도 켜지 않는다: 켜 봐야 보일 화면이 없다. 판 01~03에서는 그 세계의 주인 잃은 셸 토스트를 다시
 * 세우고 화면은 그대로였다.
 */
export default function useGoToShell(): (shell: { id: number; owner: ShellOwner }) => void {
  const router = useRouter();

  return useCallback(
    ({ id, owner }) => {
      if (isOrphanedShell(id)) {
        viewProcesses();
        return;
      }
      const go = (target: NavigateOptions) => {
        whenArrived(router, router.buildLocation(target).href, () => {
          focusShell(id);
          selectShell(id);
        });
        void router.navigate(target);
      };
      const mode = modeOfOwner(owner);
      const routes = routesOf(mode);
      const slug = slugOfOwner(owner);
      if (slug === null) {
        go({ to: routes.terminal });
        return;
      }
      const pathname = router.state.location.pathname;
      const here = modeOf(pathname) === mode && slugOf(pathname) === slug;
      go({
        to: routes.item,
        params: { slug },
        search: here
          ? (prev: object) => tabSearch(prev, "terminal")
          : tabSearch(recallSearch(mode, slug), "terminal"),
        replace: here,
      });
    },
    [router],
  );
}
