import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { screenOwner } from "@/features/terminal/shell-leave";
import { closeUnusedShells } from "@/features/terminal/terminal-store";

/**
 * **떠남을 재는 자리**(프로세스 결정 7 · 프로세스 스펙 S17). 라우터의 현재 owner가 바뀌는 순간, 떠나온 owner의
 * 안 쓴 자동 셸을 닫는다. 그리는 것은 없다.
 *
 * **앱 루트 한 자리에서 잰다 — 터미널 패인이 아니다.** 같은 work 안에서 spec 탭으로 바꿀 때도 패인이 내려가는데
 * 그것은 떠남이 아니고, 패인은 떠나온 owner와 옮겨 간 owner를 둘 다 알지 못한다. 앱 셸은 어느 화면에서든 서
 * 있어 모든 이동을 본다.
 *
 * **앱 셸 안에 두지 않고 제 파일에 선다.** 앱 셸의 리렌더 최적화가 라우터 구독을 셋으로 못박아 두었다
 * (`AppShell.test.ts`). 여기 구독은 owner 하나를 원시값으로 좁혀, 주소가 바뀌어도 owner가 그대로면(spec 탭 · 문서
 * 고르기) 이 조각만 다시 그려지지도 않는다.
 *
 * **읽는 것은 도착한 주소(`resolvedLocation`)다 — 가는 중인 주소(`location`)가 아니다.** 가는 중에는 떠나는 화면이
 * 아직 그려져 있다. 그때 그 화면의 마지막 셸을 닫으면 work 화면은 「마지막 셸이 방금 사라졌다」로 읽고 제 spec
 * 탭으로 돌아가(`shellsEmptied`), 사람이 가려던 이동을 덮어쓴다(L3에서 실제로 그렇게 떠나지 못했다). 도착한 뒤에는
 * 떠나온 화면이 이미 내려가 있다.
 *
 * 앞 owner는 ref로 든다. StrictMode가 마운트 때 이펙트를 두 번 돌려도 그때는 앞과 뒤가 같아 아무것도 안 닫는다.
 * 앱이 뜨고 첫 주소가 도착하기 전은 owner가 없는 것으로 읽는다 — 그 사이에 떠난 셸은 없다.
 */
function ShellReclaim() {
  const owner = useRouterState({
    select: (state) => {
      const arrived = state.resolvedLocation?.pathname;
      return arrived === undefined ? null : screenOwner(arrived);
    },
  });
  const left = useRef(owner);
  useEffect(() => {
    const from = left.current;
    left.current = owner;
    closeUnusedShells(from, owner);
  }, [owner]);
  return null;
}

export default ShellReclaim;
