import { useQuery } from "@tanstack/react-query";
import { searchApi } from "./api";

/**
 * 팔레트가 그릴 줄들.
 *
 * **캐시를 남기지 않는다**(`gcTime: 0`). 인덱스도 캐시도 안 두기로 한 이유가 「세션이 밖에서
 * 문서를 고쳐도 늘 최신」인데, 결과를 쥐고 있으면 그 성질이 프런트에서 되살아난다 —
 * 팔레트를 닫았다 여는 사이에 spec이 바뀌는 것이 이 앱의 정상 상태다. 훑는 값이 2.69MB에
 * 10~20ms라 다시 묻는 값이 싸다.
 *
 * 팔레트가 떠 있는 동안에만 마운트되므로, 여는 것이 곧 다시 묻는 것이다.
 */
export function useSearchHits() {
  return useQuery({ queryKey: ["search"], queryFn: searchApi.run, gcTime: 0 });
}
