import { Store } from "@tanstack/react-store";
import { ALL_MODES, placeModeOf, routesOf, slugOf } from "@/mode";
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
 * `/settings`가 언제나 Atelier라, Maison에서 설정을 열고 「앱으로 돌아가기」를 누르면 Atelier로
 * 가고, 설정을 연 채 누른 ⌘K는 저쪽 세계를 뒤진다. 마지막 모드는 여전히 Maison인데 화면만
 * 조용히 세계를 건너는 것이다.
 *
 * 저장소를 읽는 것은 `placeModeOf`가 `null`을 주는 자리(`/`·`/settings`)뿐이다. 그 화면에
 * 머무는 동안 값이 낡을 수 없다 — 세계 밖 주소는 `rememberVisit`이 어느 칸에도 안 적으므로
 * 마지막 모드가 안 바뀐다. 설정의 「앱으로 돌아가기」가 어느 세계로 갈지도 이 값이다(UI개선 결정 27).
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

/**
 * 세그먼트로 저쪽 세계에 건너갈 때 **하는 이동 전체**. 같은 세계를 다시 골랐으면 `null`이고,
 * 그때 셸은 아무 데도 안 간다.
 *
 * **목적지를 아는 자리가 「같은 세계면 0칸」도, 씨앗도 함께 정한다.** 세그먼트(`ModeSwitch`)는 선
 * 칸을 눌러도 그대로 알리고 — 두 칸이 각자 목적지를 가진 두 세계라 그 파일은 목적지를 모른다 —
 * 판정은 여기 하나다. 두 자리로 갈리면 한쪽만 고친 날 **지금 세계의 마지막 주소로 push가 한 칸**
 * 쌓이고, 뒤로가기를 눌러도 화면이 그대로인 죽은 칸이 된다(nav가 `key === activeKey`를
 * `AppShell`에 둔 것과 같은 이유이고, 같은 함정이다).
 *
 * 셸이 이 값을 `navigate`에 **그대로 넘긴다**. 목적지만 돌려주고 나머지를 셸이 짓게 두면 이
 * 함수를 재는 검사들이 초록인 채로 화면의 규칙만 갈린다.
 *
 * 떠나온 세계를 **인자로 받는다** — 셸은 이미 `shellMode`로 떠나온 세계를 들고 있으므로 그것을
 * 그대로 넘긴다(`selectWork`가 모드를 받는 이유와 같은 계통이다). 설정에는 세그먼트가 없어(UI개선
 * 결정 21) 이 함수가 세계 밖 주소에서 불리는 일은 없다.
 *
 * 목적지 몸통은 `modeEntryTarget`이다 — 이 함수가 더하는 것은 「같은 세계면 `null`」 하나다.
 */
export function modeSwitchTarget(
  from: Mode,
  pick: Mode,
): { to: string; search?: WorkSearch } | null {
  if (pick === from) return null;
  return modeEntryTarget(pick);
}

/**
 * 그 세계로 **들어갈 때 하는 이동 전체** — 세그먼트(`modeSwitchTarget`)와 설정의 「앱으로
 * 돌아가기」(UI개선 결정 27)가 함께 딛는 몸통이다.
 *
 * **같은 세계여도 값을 준다.** 돌아가기는 늘 떠나온 세계로 가므로, 「같은 세계면 `null`」이 여기
 * 들어 있으면 그 버튼이 어느 화면에서 들어왔든 아무 데도 안 간다 — 그 가름은 세그먼트 몫이라
 * 그쪽에만 있다. 앱 셸은 이 함수를 부르기만 한다: 셸이 `lastPlace`를 읽고 목적지를 스스로 지으면
 * 이 함수를 재는 검사들이 초록인 채로 화면의 규칙만 갈린다(`AppShell.test.ts`).
 *
 * 마지막 주소가 없으면 그 세계의 **목록 주소**다(앱을 켜자마자 ⌘, 등). 무선택 주소라 도착하자마자
 * 정규화 리다이렉트를 한 번 더 타지만 그 리다이렉트가 replace라 히스토리는 그래도 한 칸이다
 * (`router.test.ts`). 마지막 자리 기억은 세계를 싣는 **모든 주소**를 적으므로(`rememberVisit`)
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
  const to = shellStore.state.lastPlace[mode] ?? routesOf(mode).list;
  // 목록·터미널·아카이브 주소에는 씨앗이 없다 — `slugOf`가 `null`을 주는 것이 그 사실이고,
  // 그 화면들은 `search`를 안 쓴다. 첫 화면(무선택 주소)도 여기로 떨어져 정규화가 씨앗을 얹는다.
  const slug = slugOf(to);
  return slug === null ? { to } : { to, search: recallSearch(mode, slug) };
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
