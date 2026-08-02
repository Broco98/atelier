import { useRouter } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { RouterHistory } from "@tanstack/react-router";

// 라우터는 `useCanGoBack`만 준다 — "앞으로 갈 곳이 있는가"는 여기서 직접 센다.
// 히스토리 항목이 자기 위치를 `state.__TSR_index`로 공개하므로, 지금까지 도달한
// 최대 인덱스보다 뒤에 있으면 앞이 남아 있다는 뜻이다.
//
// 갱신 규칙은 히스토리 스택이 잘리는 시점 하나로 갈린다:
// - PUSH는 뒤따르던 항목을 통째로 버린다 → 최대치가 그 자리로 내려온다
// - REPLACE는 그 칸만 덮어쓴다 → 뒤따르던 항목이 남으므로 최대치를 건드리지 않는다
// - BACK/FORWARD/GO는 자리만 옮긴다
//
// 인덱스로 세는 이상 살아 있는 back-forward 목록과 어긋날 여지가 남는다. 라우터의
// `useCanGoBack`도 `__TSR_index !== 0`이 전부라 같은 성질을 갖는다 — 한쪽만 특별히
// 방어하면 비대칭만 생긴다. 상류에 `canGoForward`를 넣는 논의가 있으니(TanStack/router#3196)
// 들어오면 이 파일을 통째로 지우고 호출부의 import만 갈아끼운다. 그래서 라우터 옆에 따로 둔다.
const stores = new WeakMap<RouterHistory, Store<boolean>>();

// 최대치는 웹뷰보다 오래 살아야 한다. 웹뷰가 다시 뜨면(macOS 기본 우클릭 메뉴에 Reload가 있고
// wry가 그것을 막지 않는다) 이 모듈은 새로 만들어지지만 세션 히스토리는 그대로 남는다.
// 그때 최대치를 지금 서 있는 자리로 초기화하면, 앞으로 갈 곳이 있는데도 버튼이 흐린 채 굳고
// 되돌릴 방법이 마우스 사이드 버튼밖에 없다 (실물 웹뷰 리로드로 확인했다).
//
// sessionStorage인 이유는 수명이 정확히 맞아서다 — 세션 히스토리와 함께 살고 앱을 다시 켜면
// 사라진다. 라우터의 스크롤 복원도 같은 이유로 sessionStorage를 쓴다.
const MAX_INDEX_KEY = "history-max-index";

// 읽기·쓰기 모두 실패해도 그만이다. sessionStorage는 용량 한도(실측 5MiB)에서 던질 수 있고,
// 라우트 트리를 Node에서 import하는 테스트에는 아예 없다. 특히 쓰기는 히스토리의 구독자 목록
// 안에서 도는 코드라, 예외가 새면 뒤에 등록된 구독자(라우터의 load)가 실행되지 않는다.
const readMaxIndex = () => {
  try {
    const saved = Number(sessionStorage.getItem(MAX_INDEX_KEY));
    return Number.isSafeInteger(saved) ? saved : 0;
  } catch {
    return 0;
  }
};

const writeMaxIndex = (value: number) => {
  try {
    sessionStorage.setItem(MAX_INDEX_KEY, String(value));
  } catch {
    // 세션에 못 남기면 리로드 뒤 앞을 잊을 뿐, 이번 세션 동작에는 지장이 없다
  }
};

// 저장된 값을 window.history.length로 위쪽에서 자르고 싶어지는데, 하면 안 된다.
// WKWebView는 back-forward 목록을 100칸에서 자르고 오래된 항목을 버린다 — 270번 이동하면
// __TSR_index는 270인데 length는 100에 고정된다(실측). 클램프를 넣으면 그 세션에서
// 앞으로 갈 칸이 실제로 남아 있는데 버튼이 흐려진다. 이 기능이 필요한 바로 그 상황이다.

// history 하나당 한 번만 구독한다. 구독을 끊지 않는 이유 — 셈의 기준인 최대 인덱스가
// 히스토리와 같은 수명을 가져야 한다. 컴포넌트 수명에 묶으면 다시 마운트될 때
// 최대치가 현재 위치로 초기화되어, 앞으로 갈 곳이 있는데도 버튼이 흐려진다.
//
// 렌더 중에 구독이 걸리지만(useCanGoForward), 라우터의 자체 구독자보다 뒤에 붙는다:
// RouterProvider의 첫 커밋에는 매칭이 없어 이 컴포넌트가 아예 그려지지 않고, 그 사이
// Transitioner가 이펙트에서 먼저 구독한다(계측으로 확인). 순서가 중요한 이유는 router-core가
// "구독자가 하나도 없을 때만 스스로 load한다"로 동작하기 때문이다. 만약 앞으로 router.history를
// 런타임에 갈아끼우게 되면 이 순서가 뒤집히므로, 그때는 재구독 지점을 명시해야 한다.
export function trackCanGoForward(history: RouterHistory): Store<boolean> {
  const existing = stores.get(history);
  if (existing) return existing;

  const start = history.location.state.__TSR_index;
  // 남아 있던 기록은 지금 서 있는 자리보다 앞설 때만 뜻이 있다
  let maxIndex = Math.max(start, readMaxIndex());
  const store = new Store(start < maxIndex);
  history.subscribe(({ location, action }) => {
    const index = location.state.__TSR_index;
    maxIndex = action.type === "PUSH" ? index : Math.max(maxIndex, index);
    // 저장보다 먼저 화면에 반영한다 — 저장이 실패해도 버튼은 살아 있어야 한다
    store.setState(() => index < maxIndex);
    writeMaxIndex(maxIndex);
  });
  stores.set(history, store);
  return store;
}

export function useCanGoForward(): boolean {
  return useStore(trackCanGoForward(useRouter().history), (value) => value);
}
