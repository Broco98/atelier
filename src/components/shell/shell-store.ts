import { Store } from "@tanstack/react-store";
import { readStored, writeStored } from "@/lib/stored";
import { workSlugOf } from "@/lib/path-prefix";
import { modeFrom, placeModeOf } from "@/mode";
import { recallSearch } from "@/routes/-work-search";
import type { WorkSearch } from "@/routes/-work-search";
import type { Mode } from "@/mode";

const SIDEBAR_OPEN_KEY = "sidebar-open";
const LAST_MODE_KEY = "last-mode";

// 셸이 소유하는 상태. 라우트 트리의 뿌리(AppShell)와 각 라우트가 함께 읽는데
// <Outlet/> 너머로는 props를 내릴 수 없어 스토어에 둔다.
//
// 수명이 둘 섞여 있다 — sidebarOpen은 "설정"이라 localStorage에 영속하고,
// 위치 기억(slug·주소)은 세션 동안만 산다.
//
// 위치 기억은 더 이상 선택의 정본이 아니다 — 정본은 URL이다. 여기 남은 것은
// "이번 세션에서 그 탭에서 마지막으로 보던 항목"이라는 기억이고, 항목이 지정되지 않은
// 주소(/works, /projects, /archive)를 어디로 정규화할지 정할 때만 읽힌다.
export interface ShellState {
  sidebarOpen: boolean;
  projectSlug: string | null;
  workSlug: string | null;
  archiveSlug: string | null;
  /**
   * **마지막으로 서 있던 주소.** 설정의 「앱으로 돌아가기」가 어디로 데려갈지가 여기서 나온다
   * (없으면 첫 화면).
   *
   * 위치이지 설정이 아니라 세션에만 산다 — 앱을 껐다 켜면 첫 화면으로 뜬다. 주소까지 영속시키면
   * 어제 보던 문서가 오늘의 첫 화면이 된다.
   */
  lastPlace: Record<Mode, string | null>;
}

// 저장소를 만지는 문은 `readStored` · `writeStored`뿐이다(`lib/stored.ts`) — 부를 때마다 확인하고
// 던지는 것을 삼킨다. 사생활 모드처럼 접근이 던지는 저장소에서도 앱이 뜬다.

export const shellStore = new Store<ShellState>({
  sidebarOpen: readStored(SIDEBAR_OPEN_KEY) !== "0",
  projectSlug: null,
  workSlug: null,
  archiveSlug: null,
  lastPlace: { atelier: null },
});

export function toggleSidebar() {
  shellStore.setState((state) => {
    const sidebarOpen = !state.sidebarOpen;
    writeStored(SIDEBAR_OPEN_KEY, sidebarOpen ? "1" : "0");
    return { ...state, sidebarOpen };
  });
}

/**
 * 마지막으로 있던 모드. `/`가 이 값을 읽어 첫 화면을 정한다.
 *
 * 적힌 값은 `modeFrom`으로 **검증해** 읽는다 — 모르는 값이면 Atelier다. 지운 모드 이름이 남아 있어도
 * 그렇다(ui-refresh 결정 23 — 남은 키는 해가 없다).
 */
export function lastMode(): Mode {
  return modeFrom(readStored(LAST_MODE_KEY)) ?? "atelier";
}

/**
 * 셸이 드는 모드. **모드를 안 싣는 주소에서는 떠나온 모드를 이어 든다.**
 *
 * 저장소를 읽는 것은 `placeModeOf`가 `null`을 주는 자리(`/`·`/settings`)뿐이다. 모드 밖 주소는
 * `rememberVisit`이 어느 칸에도 안 적는다.
 */
export function shellMode(pathname: string): Mode {
  return placeModeOf(pathname) ?? lastMode();
}

/**
 * 이 주소에 도착했다고 적어 둔다 — **마지막 모드(영속)와 마지막 주소(세션)를 함께.**
 *
 * 모드를 안 싣는 주소(`/`·`/settings`)는 **어느 칸에도 안 적는다**(`placeModeOf`) — 적으면 설정을
 * 열었다는 이유로 「앱으로 돌아가기」가 설정으로 돌아간다.
 */
export function rememberVisit(pathname: string): void {
  const mode = placeModeOf(pathname);
  if (!mode) return;
  writeStored(LAST_MODE_KEY, mode);
  shellStore.setState((state) =>
    state.lastPlace[mode] === pathname
      ? state
      : { ...state, lastPlace: { ...state.lastPlace, [mode]: pathname } },
  );
}

/**
 * 앱으로 **들어갈 때 하는 이동 전체** — 설정의 「앱으로 돌아가기」(UI개선 결정 27)가 딛는 몸통이다.
 * 앱 셸은 이 함수를 부르기만 한다: 셸이 `lastPlace`를 읽고 목적지를 스스로 지으면 이 함수를 재는
 * 검사들이 초록인 채로 화면의 규칙만 갈린다(`AppShell.test.ts`).
 *
 * 마지막 주소가 없으면 **목록 주소**다(앱을 켜자마자 ⌘, 등). 무선택 주소라 도착하자마자
 * 정규화 리다이렉트를 한 번 더 타지만 그 리다이렉트가 replace라 히스토리는 그래도 한 칸이다
 * (`router.test.ts`). 마지막 자리 기억은 모드를 싣는 **모든 주소**를 적으므로(`rememberVisit`)
 * `/projects`·`/terminal`·`/archive`에서 들어온 설정도 그 주소로 돌아간다.
 *
 * **항목 주소면 그 항목의 마지막 화면을 씨앗으로 얹는다**(결정 77·97). `lastPlace`가 드는 것은
 * pathname뿐이라(`rememberVisit`) 그냥 두면 빈 `search`로 도착하고, 도착한 주소를 적어 두는
 * effect(`-works-view`의 `rememberView`)가 그 기본값으로 **기억을 덮어쓴다** — 한 번 왕복한
 * work은 그 뒤로 어느 문으로 열어도 spec 기본 화면으로 뜬다. `recallSearch` 머리말이 이름까지
 * 붙여 경고한 「빠뜨린 문 하나」가 정확히 이 모양이고, Projects 문이 실제로 그랬다. 설정에서
 * 돌아간 work이 보던 탭으로 서는 것도 이 씨앗이다.
 */
export function modeEntryTarget(mode: Mode): { to: string; search?: WorkSearch } {
  const to = shellStore.state.lastPlace[mode] ?? "/works";
  // 목록·터미널·아카이브 주소에는 씨앗이 없다 — `workSlugOf`가 `null`을 주는 것이 그 사실이고,
  // 그 화면들은 `search`를 안 쓴다. 첫 화면(무선택 주소)도 여기로 떨어져 정규화가 씨앗을 얹는다.
  const slug = workSlugOf(to);
  return slug === null ? { to } : { to, search: recallSearch(slug) };
}

// 화면에 실제로 띄운 항목을 기억한다. 목록이 갱신될 때마다 불리므로 값이 같으면 그대로 둔다.
export function selectProject(slug: string | null) {
  shellStore.setState((state) =>
    state.projectSlug === slug ? state : { ...state, projectSlug: slug },
  );
}

export function selectWork(slug: string | null) {
  shellStore.setState((state) => (state.workSlug === slug ? state : { ...state, workSlug: slug }));
}

export function selectArchive(slug: string | null) {
  shellStore.setState((state) =>
    state.archiveSlug === slug ? state : { ...state, archiveSlug: slug },
  );
}

// 항목이 지정되지 않은 주소를 어느 항목으로 고쳐 쓸지 정하는 유일한 규칙.
// 마지막으로 보던 것이 아직 살아 있으면 그것, 아니면 목록 첫 항목, 목록이 비었으면 없음.
// 로드 시점(beforeLoad)과 목록 갱신 시점(뷰)이 같은 답을 내도록 한 곳에 둔다.
//
// 한때 「아무도 안 골랐을 때 고를 후보」를 좁히는 선호 술어를 받았다 — works가 초안을 건너뛰는
// 데 썼다. 초안이 다른 작업들 사이에 서면서(UI개선 결정 5·6) 그 건너뛰기가 보이는 첫 줄과 열리는
// 것을 도리어 가르게 되어 인자째 걷었다. 목록마다 다른 규칙이 없다는 것이 이 함수의 모양이다.
//
// "목록 첫 항목"은 백엔드가 준 순서 기준이다. 화면이 그 위에 정렬이나 필터를 얹으면 여기서
// 고른 항목과 목록이 보여주는 첫 항목이 갈린다 — 실제로 그랬고(#58), 그래서 그 둘을 없앴다.
// 이 등식은 work-sections.test.ts가 splitWorkSections와 이 함수를 나란히 불러 지킨다.
export function pickSlug<T extends { slug: string }>(
  lastSeen: string | null,
  items: ReadonlyArray<T>,
): string | null {
  if (lastSeen && items.some((item) => item.slug === lastSeen)) return lastSeen;
  return items[0]?.slug ?? null;
}
