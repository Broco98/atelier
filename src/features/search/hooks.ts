import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { searchApi } from "./api";

/**
 * 한 질의가 무엇을 어떻게 물어 오는가. **옵션을 값으로 떼어 둔 것은 seam이다** — 이 저장소의
 * L2에는 DOM이 없어 훅을 렌더할 수 없고, 아래 두 규칙은 훅이 아니라 이 옵션이 정한다.
 * `QueryObserver`에 그대로 물리면 둘 다 잴 수 있다(hooks.test.ts).
 *
 * - **질의가 키에 실린다**(결정 29). 늦게 온 답은 **자기 질의의 자리**에 앉으므로 지금 질의의
 *   화면을 못 덮는다 — 디바운스로 호출을 줄이는 대신 순서 뒤바뀜만 막는다. 키에서 질의를
 *   빼는 순간 이 성질이 통째로 사라지고, 그 실패는 빨리 칠 때만 드물게 보인다.
 * - **앞 답이 다음 답이 올 때까지 서 있는다**(`keepPreviousData`). 키가 바뀔 때마다 목록이
 *   비면 글자 하나마다 「맞는 것이 없습니다」가 깜빡이는데, 그것은 「치는 동안 즉시 따라온다」의
 *   반대다.
 *
 * **캐시를 남기지 않는다**(`gcTime: 0`). 인덱스도 캐시도 안 두기로 한 이유가 「세션이 밖에서
 * 문서를 고쳐도 늘 최신」인데, 결과를 쥐고 있으면 그 성질이 프런트에서 되살아난다 — 팔레트를
 * 닫았다 여는 사이에 spec이 바뀌는 것이 이 앱의 정상 상태다. 훑는 값이 2.69MB에 10~20ms라
 * 다시 묻는 값이 싸다.
 */
export function searchQuery(query: string) {
  return {
    queryKey: ["search", query],
    queryFn: () => searchApi.run(query),
    gcTime: 0,
    placeholderData: keepPreviousData,
  };
}

/** 팔레트가 그릴 줄들. 팔레트가 떠 있는 동안에만 마운트되므로, 여는 것이 곧 다시 묻는 것이다. */
export function useSearchHits(query: string) {
  return useQuery(searchQuery(query));
}
