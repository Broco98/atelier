import { Store } from "@tanstack/react-store";
import { ALL_MODES, placeModeOf } from "@/mode";
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
// 주소(/works, /maison/rooms, /projects)를 어디로 정규화할지 정할 때만 읽힌다.
export interface ShellState {
  sidebarOpen: boolean;
  projectSlug: string | null;
  /**
   * **모드별로 갈라 든다.** 한 칸으로 두면 Atelier에서 마지막으로 보던 slug가 `/maison/rooms`
   * 정규화에 새어 들어, 그 slug가 Room 목록에 없으면 첫 Room으로 떨어지고 있으면 **다른
   * 세계의 이름을 가진 Room**이 열린다 — 목록과 본문이 어긋난 채 화면은 멀쩡해 보인다.
   *
   * `Record<Mode, …>`라 모드가 하나 느는 날 칸을 빠뜨리면 L0가 잡는다.
   */
  workSlug: Record<Mode, string | null>;
  archiveSlug: Record<Mode, string | null>;
  /**
   * 그 모드에서 **마지막으로 서 있던 주소.** 세그먼트가 저쪽 세계로 건너갈 때 어디로
   * 데려갈지가 여기서 나온다(없으면 그 모드의 첫 화면).
   *
   * 위치이지 설정이 아니라 세션에만 산다 — 앱을 껐다 켜면 마지막 **모드**만 남고(localStorage)
   * 그 세계의 첫 화면으로 뜬다. 주소까지 영속시키면 어제 보던 문서가 오늘의 첫 화면이 된다.
   */
  lastPlace: Record<Mode, string | null>;
}

// 저장소를 만지는 문이 이 둘뿐이다. **부를 때마다 확인하고 던지는 것을 삼킨다** —
// 있는지 한 번만 보고 모듈 상수로 굳히면 나중에 심어진 저장소를 영영 못 보고(라우터 테스트가
// 케이스마다 심는다), try 없이 만지면 사생활 모드처럼 **존재하지만 접근이 던지는** 저장소에서
// 앱이 통째로 안 뜬다.
function readStored(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // 적어 두지 못하는 것은 이번 실행의 편의를 잃는 일일 뿐이다 — 여기서 던지면 그 편의를
    // 위해 화면이 죽는다.
  }
}

export const shellStore = new Store<ShellState>({
  sidebarOpen: readStored(SIDEBAR_OPEN_KEY) !== "0",
  projectSlug: null,
  workSlug: { atelier: null, maison: null },
  archiveSlug: { atelier: null, maison: null },
  lastPlace: { atelier: null, maison: null },
});

export function toggleSidebar() {
  shellStore.setState((state) => {
    const sidebarOpen = !state.sidebarOpen;
    writeStored(SIDEBAR_OPEN_KEY, sidebarOpen ? "1" : "0");
    return { ...state, sidebarOpen };
  });
}

/**
 * 마지막으로 있던 세계. **영속이다** — 사이드바 접힘이 설정이라 남고 slug가 위치라 안 남는
 * 그 구분에서 모드는 설정 쪽이다(결정 9는 기동을 넘어 기억하라고 했다). `/`가 이 값을 읽어
 * 첫 화면을 정한다.
 *
 * 적힌 값을 `ALL_MODES`로 **검증한다**: 캐스트로 두면 저장소에 남은 옛 값이나 손으로 고친
 * 문자열이 그대로 모드가 되어, 표에 없는 키로 파생을 찾다 `undefined`가 화면까지 간다.
 */
export function lastMode(): Mode {
  const stored = readStored(LAST_MODE_KEY);
  return ALL_MODES.find((mode) => mode === stored) ?? "atelier";
}

/**
 * 셸이 드는 세계. **모드를 안 싣는 주소에서는 떠나온 세계를 이어 든다** — `modeOf`로 물으면
 * `/settings`가 언제나 Atelier라, Maison에서 설정을 열고 nav의 `Archive`를 누르면 Atelier의
 * `/archive`로 간다. 마지막 모드는 여전히 Maison인데 화면만 조용히 세계를 건너는 것이고,
 * AppShell이 「nav 한 번에 세계를 안 떠난다」고 적어 둔 그 계약이 거기서 깨진다.
 *
 * 저장소를 읽는 것은 `placeModeOf`가 `null`을 주는 자리(`/`·`/settings`)뿐이다. 그 화면에
 * 머무는 동안 값이 낡을 수 없다 — 세계 밖 주소는 `rememberVisit`이 어느 칸에도 안 적으므로
 * 마지막 모드가 안 바뀐다. `/settings`에서 세그먼트가 무엇을 켤지도 이 값이다(#183).
 */
export function shellMode(pathname: string): Mode {
  return placeModeOf(pathname) ?? lastMode();
}

/**
 * 이 주소에 도착했다고 적어 둔다 — **마지막 모드(영속)와 그 모드의 마지막 주소(세션)를 함께.**
 * 두 칸이 한 문으로만 갱신되므로 「모드는 바뀌었는데 주소는 저쪽 것」이 될 수 없다.
 *
 * 모드를 안 싣는 주소(`/`·`/settings`)는 **어느 칸에도 안 적는다**(`placeModeOf`) — `modeOf`의
 * 기본값을 적으면 Maison에서 설정을 열었다는 이유로 다음 실행이 Atelier로 뜬다.
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

// 화면에 실제로 띄운 항목을 기억한다. 목록이 갱신될 때마다 불리므로 값이 같으면 그대로 둔다.
export function selectProject(slug: string | null) {
  shellStore.setState((state) =>
    state.projectSlug === slug ? state : { ...state, projectSlug: slug },
  );
}

// 모드가 인자인 것은 **화면이 자기 세계를 알기 때문이다** — 주소에서 모드를 다시 읽으면
// 이동 중인 프레임에서 떠나는 주소의 모드로 적힐 수 있다.
export function selectWork(mode: Mode, slug: string | null) {
  shellStore.setState((state) =>
    state.workSlug[mode] === slug
      ? state
      : { ...state, workSlug: { ...state.workSlug, [mode]: slug } },
  );
}

export function selectArchive(mode: Mode, slug: string | null) {
  shellStore.setState((state) =>
    state.archiveSlug[mode] === slug
      ? state
      : { ...state, archiveSlug: { ...state.archiveSlug, [mode]: slug } },
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
