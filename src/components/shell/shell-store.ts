import { Store } from "@tanstack/react-store";

const SIDEBAR_OPEN_KEY = "sidebar-open";

// 셸이 소유하는 상태. 라우트 트리의 뿌리(AppShell)와 각 라우트가 함께 읽는데
// <Outlet/> 너머로는 props를 내릴 수 없어 스토어에 둔다.
//
// 수명이 둘 섞여 있다 — sidebarOpen은 "설정"이라 localStorage에 영속하고,
// slug 둘은 "위치"라 세션 동안만 산다.
//
// slug 둘은 더 이상 선택의 정본이 아니다 — 정본은 URL이다. 여기 남은 것은
// "이번 세션에서 그 탭에서 마지막으로 보던 항목"이라는 기억이고, 항목이 지정되지 않은
// 주소(/works, /projects)를 어디로 정규화할지 정할 때만 읽힌다.
export interface ShellState {
  sidebarOpen: boolean;
  projectSlug: string | null;
  workSlug: string | null;
}

// 라우트 트리를 Node(DOM 없음)에서 import하는 테스트가 있으므로 모듈 최상위에서 터지지 않게 한다
const hasLocalStorage = typeof localStorage !== "undefined";

export const shellStore = new Store<ShellState>({
  sidebarOpen: !hasLocalStorage || localStorage.getItem(SIDEBAR_OPEN_KEY) !== "0",
  projectSlug: null,
  workSlug: null,
});

export function toggleSidebar() {
  shellStore.setState((state) => {
    const sidebarOpen = !state.sidebarOpen;
    if (hasLocalStorage) localStorage.setItem(SIDEBAR_OPEN_KEY, sidebarOpen ? "1" : "0");
    return { ...state, sidebarOpen };
  });
}

// 화면에 실제로 띄운 항목을 기억한다. 목록이 갱신될 때마다 불리므로 값이 같으면 그대로 둔다.
export function selectProject(slug: string | null) {
  shellStore.setState((state) =>
    state.projectSlug === slug ? state : { ...state, projectSlug: slug },
  );
}

export function selectWork(slug: string | null) {
  shellStore.setState((state) =>
    state.workSlug === slug ? state : { ...state, workSlug: slug },
  );
}

// 항목이 지정되지 않은 주소를 어느 항목으로 고쳐 쓸지 정하는 유일한 규칙.
// 마지막으로 보던 것이 아직 살아 있으면 그것, 아니면 목록 첫 항목, 목록이 비었으면 없음.
// 로드 시점(beforeLoad)과 목록 갱신 시점(뷰)이 같은 답을 내도록 한 곳에 둔다.
//
// isPreferred를 주면 "아무도 고르지 않았을 때" 고를 후보를 그쪽으로 좁힌다 — works가
// 초안을 건너뛰는 데 쓴다. 마지막으로 보던 것에는 걸리지 않으므로, 직접 연 초안은 유지된다.
// 후보가 하나도 없으면 그냥 첫 항목으로 떨어진다 (초안뿐인 목록에서 빈 화면을 띄우지 않는다).
//
// "목록 첫 항목"은 백엔드가 준 순서 기준이다. 화면이 그 위에 정렬이나 필터를 얹으면 여기서
// 고른 항목과 목록이 보여주는 첫 항목이 갈린다 — 실제로 그랬고(#58), 그래서 그 둘을 없앴다.
// 이 등식은 work-sections.test.ts가 splitWorkSections와 이 함수를 나란히 불러 지킨다.
export function pickSlug<T extends { slug: string }>(
  lastSeen: string | null,
  items: ReadonlyArray<T>,
  isPreferred?: (item: T) => boolean,
): string | null {
  if (lastSeen && items.some((item) => item.slug === lastSeen)) return lastSeen;
  if (isPreferred) {
    const preferred = items.find(isPreferred);
    if (preferred) return preferred.slug;
  }
  return items[0]?.slug ?? null;
}
