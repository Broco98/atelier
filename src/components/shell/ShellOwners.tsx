import { useEffect } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { worksQuery } from "@/features/works/hooks";
import { settleOwners } from "@/features/terminal/terminal-store";
import { forgetVanishedViews } from "@/routes/-work-search";

/**
 * **주인 확인을 거는 자리**(프로세스 결정 4 · 프로세스 스펙 S13 · 티켓 12). 그리는 것은 없다.
 *
 * MCP로 아카이브 · 삭제된 work은 다른 프로세스가 한 일이라, 앱은 `works:changed` 뒤의 **목록 재조회**로만 안다. 그래서
 * 앱 루트가 목록 쿼리의 **결과**를 구독한다 — 새 결과가 성공으로 앉을 때마다 주인을 잃은 셸을 다룬다(`settleOwners`).
 * 이벤트를 따로 듣지 않는다: 재조회가 실패했거나 아직이면 판단할 것이 없고(fail-closed), 성공한 결과는 어느 길로
 * 앉았든(이벤트 · mutation 뒤의 무효화) 같은 사실을 말한다.
 *
 * **목록은 여기서 관찰한다** — 무효화는 관찰자가 있는 쿼리만 다시 부른다. 사이드바도 같은 목록을 보지만, 이 판정이 화면
 * 하나의 배치에 기대지 않게 루트가 직접 든다(같은 키라 조회는 늘지 않는다).
 *
 * **사라진 work의 화면 기억도 여기서 걷는다**(git-integration 판 01 — `forgetVanishedViews`). 묶음에서 그 work의 파일 탭이
 * 빠지는 것(`settleOwners`)과 같은 사실에서 나온 짝이다: 둘 중 하나만 남아도 같은 slug로 선 새 work에 옛 파일 탭이 선다. UI
 * 아카이브 · 삭제도 목록을 다시 앉히므로 이 길 하나가 두 길을 다 덮는다.
 *
 * **앱 셸 안에 두지 않고 제 파일에 선다** — `ShellReclaim`과 같은 까닭이다(앱 셸의 구독 수를 못박아 두었다).
 */
function ShellOwners() {
  const queryClient = useQueryClient();
  useQuery(worksQuery());

  // **성공으로 앉은 목록만** 본다. 목록인지는 키의 해시로 가른다 — 키가 `worksQuery`에서만 나오므로 여기서 키 모양을
  // 다시 적지 않는다. 결과는 캐시에서 **목록의 타입으로** 다시 읽는다.
  useEffect(() => {
    const list = worksQuery().queryKey;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (hashKey(list) !== event.query.queryHash) return;
      const result = queryClient.getQueryState(list);
      void settleOwners(result);
      if (result?.data) forgetVanishedViews(result.data.map((work) => work.slug));
    });
  }, [queryClient]);

  return null;
}

export default ShellOwners;
