import { Store } from "@tanstack/react-store";

const SIDEBAR_OPEN_KEY = "sidebar-open";

// 셸이 소유하는 상태. 라우트 트리의 뿌리(AppShell)와 각 라우트가 함께 읽는데
// <Outlet/> 너머로는 props를 내릴 수 없어 스토어에 둔다.
//
// 수명이 둘 섞여 있다 — sidebarOpen은 "설정"이라 localStorage에 영속하고,
// 선택 slug는 "위치"라 세션 동안만 산다. 선택 slug는 다음 티켓에서 URL이 정본이 되면
// 무선택 주소를 정규화할 때 쓰는 "탭별 마지막 본 항목" 기억으로 남는다.
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

export function selectProject(slug: string | null) {
  shellStore.setState((state) => ({ ...state, projectSlug: slug }));
}

export function selectWork(slug: string | null) {
  shellStore.setState((state) => ({ ...state, workSlug: slug }));
}
