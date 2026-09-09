import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Mode } from "@/mode";
import { searchApi } from "./api";
import { destinationsFor } from "./destinations";

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
 * 닫았다 여는 사이에 spec이 바뀌는 것이 이 앱의 정상 상태다. 다시 묻는 값이 싸서 잃는 것이
 * 없다 — **실측은 코어 주석 한 자리에만 있다**(`search.rs`의 `search`). 여기에 숫자를 베끼면
 * 뒤지는 것이 느는 날 한쪽만 거짓이 된다.
 *
 * **실패하면 다시 묻지 않는다**(`retry: false`). 디바운스가 없다는 것이 결정 29의 판단인데,
 * 기본값(3회 + 백오프)을 그대로 두면 백엔드가 실패하는 동안 **글자 하나마다 최대 네 번**이
 * 나간다 — `search`는 부를 때마다 코퍼스 전량을 읽는 명령이다. 잃는 것도 없다: 인덱스도
 * 캐시도 없어 **다음 타자가 곧 다음 시도**이고, 그것이 `gcTime: 0`을 고른 근거와 같은 결이다.
 * 대신 실패를 화면이 받아야 한다 — 안 그러면 재시도도 안 하고 아무 말도 안 하는 자리가 된다
 * (`SearchPalette.tsx`의 `state`).
 *
 * **세계도 키에 실린다.** 질의를 키에 넣은 이유(늦게 온 답이 자기 자리에 앉는다)가 여기서
 * 한 겹 더 필요하다 — 두 세계가 같은 키를 쓰면 `가`로 물은 Atelier의 답이 Maison에서 `가`를
 * 칠 때 캐시에서 그대로 선다. `gcTime: 0`이 그것을 다 막지는 못한다: 캐시를 안 남기는 것과
 * **지금 살아 있는 질의를 나눠 쓰는 것**은 다른 이야기라, 세계를 건넌 직후가 정확히 그
 * 자리다. 키에서 `mode`를 빼는 변형은 hooks.test.ts가 문다.
 */
export function searchQuery(mode: Mode, query: string) {
  return {
    // **세계가 질의보다 앞이다** — 뒤지는 루트를 고르는 값이라 명령의 인자 순서와 같다
    // (`api.ts`의 `run`). 사람이 키를 읽을 때도 좁은 것에서 넓은 것 순으로 읽힌다.
    queryKey: ["search", mode, query],
    // **묻는 목적지도 그 세계의 것이다**(`destinations.ts`) — Atelier의 목록을 그대로 보내면
    // 코어가 Maison에서도 `Projects` 줄을 세우고(그 세계에 프로젝트는 없다 — 결정 17),
    // 그 줄은 뜨는데 갈 곳이 없다.
    //
    // 그래도 **키에는 안 실린다**(결정 21). 목적지가 모드에서 파생되는 값이라 같은 모드면
    // 언제나 같고, 모드는 이미 위 키에 있다 — 키에 넣으면 `mode`를 두 번 적는 것이다.
    queryFn: () => searchApi.run(mode, query, destinationsFor(mode)),
    gcTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  };
}

/**
 * 팔레트가 그릴 줄들. 팔레트가 떠 있는 동안에만 마운트되므로, 여는 것이 곧 다시 묻는 것이다 —
 * **세계를 건넌 뒤 처음 여는 ⇧⇧가 저쪽 결과를 안 스치는 나머지 절반이 이 성질이다**(위 키가
 * 절반). 한 관찰자가 계속 살아 있으면 `keepPreviousData`가 키를 갈아탄 한 프레임 동안 앞
 * 세계의 목록을 세운다.
 */
export function useSearchHits(mode: Mode, query: string) {
  return useQuery(searchQuery(mode, query));
}
