import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invalidateArchive } from "@/features/archive/hooks";
import { invalidateWorks } from "@/features/works/hooks";
import type { Mode } from "@/mode";
import { specLayoutApi } from "./api";

// ["spec-layout"]으로 시작하는 쿼리(상태, 뒤에 붙을 레이아웃 읽기)가 한 번에 무효화된다 — 레이아웃
// 폴더가 바뀌면 둘 다 낡는다(구현 스펙 3절).
const SPEC_LAYOUT_KEY = ["spec-layout"] as const;

/**
 * 레이아웃이 바뀌었다고 알리는 **유일한 문**(구현 스펙 3절). 레이아웃 폴더의 감시(`layouts:changed`)도,
 * 앱이 레이아웃을 되돌리거나(티켓 10) 저장하는 것(티켓 11)도 여기를 탄다.
 *
 * **레이아웃에서 나온 것을 모두 지운다** — 레이아웃 상태·읽기 쿼리, 그리고 spec 트리를 싣고 오는 work
 * 목록과 아카이브 문서 목록이다. 쓰는 레이아웃이 바뀌면 spec 트리도 바뀌기 때문이다. 두 세계를 다
 * 지우는 것은 이벤트가 하나라서다: 어느 모드의 폴더가 바뀌었는지 모른다.
 *
 * work 목록과 아카이브는 **제 문을 지난다**(`invalidateWorks`·`invalidateArchive`). 키를 여기서 직접
 * 지우면 옮기기가 떠 있을 때 미루는 규칙(`invalidateWorks`의 머리말)을 건너뛰어, 옛 순서가 옮기기
 * 응답을 덮을 수 있다.
 *
 * 돌려주는 promise는 셋이 다 끝날 때 풀린다 — 기다릴지 말지는 부르는 쪽이 정한다(그 짝들과 같다).
 */
export function invalidateSpecLayout(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: SPEC_LAYOUT_KEY }),
    invalidateWorks(queryClient),
    invalidateArchive(queryClient),
  ]).then(() => undefined);
}

/**
 * 레이아웃 폴더의 감시를 듣는다 — `layouts:changed`가 오면 위 문을 연다. 에이전트가 레이아웃을
 * 저장하거나 사람이 손으로 고치면, 열려 있는 설정의 「spec 레이아웃」과 spec 패널 탭, 아카이브 문서
 * 트리가 [다시 읽기] 없이 따라온다(spec 레이아웃 결정 22).
 *
 * **셸이 한 번만 부른다**(구현 스펙 3절 — 구독은 앱 전역에 하나). 편집기(티켓 15)도 따로 듣지 않고,
 * 여기서 다시 읽힌 읽기 쿼리로 밖 변경을 판정한다. L3 하네스의 이벤트 쏘기가 그 이벤트의 마지막 구독
 * 하나만 부르는 것도 까닭이다 — 구독이 둘이면 L3가 한쪽만 깨워 다른 쪽을 잴 수 없다. 이 둘은
 * `hooks.test.ts`가 소스로 센다.
 *
 * 배선은 work 목록의 `works:changed` 구독(`useWorks`)과 같다.
 */
export function useFollowLayoutChanges() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = listen("layouts:changed", () => {
      // 이벤트에는 기다릴 사람이 없다 — works 쪽 리스너와 같다.
      void invalidateSpecLayout(queryClient);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);
}

/**
 * 모드 둘의 레이아웃 상태. **신선도를 시간에 맡기지 않는다**(`staleTime` 없음) — 설정의 「spec
 * 레이아웃」 페이지를 열 때마다 새로 읽고, 레이아웃 폴더가 바뀌면(`useFollowLayoutChanges`) 다시 읽고,
 * [다시 읽기]가 다시 부른다. 에이전트가 레이아웃을 고쳤는데 옛 상태가 서 있으면 사람은 부탁이 안
 * 먹었다고 읽는다.
 */
export const specLayoutStatesQuery = () =>
  queryOptions({
    queryKey: [...SPEC_LAYOUT_KEY, "states"],
    queryFn: specLayoutApi.states,
  });

/**
 * 모드의 레이아웃을 기본값으로 되돌린다(티켓 10) — 그 모드의 레이아웃 폴더를 지운다. 확인은 부르는 쪽이
 * 먼저 묻는다(`askRevert`).
 *
 * 되돌린 뒤 **위 문 하나를 연다**(`invalidateSpecLayout`) — 행이 「내장본 그대로」로 돌아오고, spec
 * 트리를 싣고 오는 work 목록과 아카이브 문서가 내장본으로 다시 갈린다. 감시 이벤트(`layouts:changed`)도
 * 곧 오지만 기다리지 않는다: 감시가 놓쳐도, 감시가 없는 L4 다리에서도 되돌린 쪽이 스스로 다시 읽는다.
 * 문의 promise를 돌려주므로 `mutateAsync`는 다시 읽기가 끝난 뒤에 풀린다 — 되돌렸다는 알림이 옛 행
 * 위에 서지 않는다.
 */
export function useRevertSpecLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Mode) => specLayoutApi.revert(id),
    onSuccess: () => invalidateSpecLayout(queryClient),
  });
}
