import { Settings, type LucideIcon } from "lucide-react";
import { navItems, type NavKey } from "@/components/shell/nav-items";
import { SETTINGS_ENTRY } from "@/features/settings/pages";
import { isAtOrUnder } from "@/lib/path-prefix";

/**
 * 모드 축. **값은 `"atelier"` 하나다**(ui-refresh 결정 3 · 22) — 축을 걷는 동안 값만 먼저 좁혔다.
 * 함수의 모양을 남겨 둔 것은 쓰는 쪽을 묶음으로 옮기는 동안 컴파일러가 남은 자리를 짚게 하려는 것이고,
 * 이 파일은 그 일이 끝나면 사라진다.
 *
 * **문자열 표기가 코어의 것과 같은 소문자다** — 이 값이 그대로 Tauri 명령의 `mode` 인자로
 * 나가 Rust `Mode`(`crates/atelier-core/src/mode.rs`)로 역직렬화된다.
 */
export type Mode = "atelier";

/**
 * nav 항목이 갈 수 있는 주소. **좁은 유니온이어야 한다** — 셸이 이 값을 그대로
 * `navigate({ to })`로 넘기는데, `string`으로 두면 라우터가 주소를 못 좁혀 그 자리에서
 * L0가 빨개진다(그리고 넓히면 오타 난 주소가 타입 검사를 통과한다).
 */
type NavTo = (typeof navItems)[number]["to"];

/**
 * nav 줄에 서는 항목의 규격.
 *
 * `key`가 `NavKey`인 것은 셸이 활성 항목을 그 어휘로만 말하기 때문이다(`Sidebar`의
 * `activeKey`) — 그 밖의 key를 여기 적으면 그 항목은 영영 활성 표시를 못 받는데,
 * 화면으로는 「가끔 강조가 안 된다」로만 보인다.
 */
interface NavItem {
  readonly key: NavKey;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly to: NavTo;
}

/**
 * ⌘K 팔레트의 「가는 곳」 줄. nav 항목에 설정 한 줄이 얹힌 것이다.
 *
 * **`to`가 `NavTo`와 같은 이유로 좁은 유니온이다** — 팔레트가 고른 줄의 주소를 그대로
 * `navigate({ to })`로 넘기므로(`hit-target.ts`), `string`으로 두면 라우터가 주소를 못 좁혀
 * 그 자리에서 L0가 빨개진다. 설정 한 줄만 `NavTo` 밖이라 여기서 얹는다 — 아래 `SETTINGS_PLACE`와
 * 같은 상수(`SETTINGS_ENTRY`)를 읽으므로 둘이 갈릴 수 없다.
 */
interface PaletteDestination {
  readonly key: string;
  readonly label: string;
  /**
   * 그 줄의 글리프. **사이드바가 같은 목적지에 세우는 것과 같은 것이다**(`spec-search`의
   * 결정 17) — 같은 것이 두 화면에서 두 얼굴이면 안 된다. `icon`을 규격이 요구하므로,
   * 설정 한 줄을 아이콘 없이 얹으면 `destinationIcon`이 아니라 **그 선언이** L0에 걸린다.
   */
  readonly icon: LucideIcon;
  readonly to: NavTo | typeof SETTINGS_ENTRY;
}

/**
 * 화면 여섯. **`to` 리터럴이 박히는 자리는 여기 하나여야 한다** — 정규화 리다이렉트·nav·팔레트
 * 도착·사이드바 행·행 강조가 각자 문자열을 들면, 주소 하나를 고칠 때 여섯 자리를 사람이 기억해야 한다.
 */
interface ModeRoutes {
  /** 상주 목록 화면(`작업`). 무선택 주소라 정규화가 붙는다. */
  readonly list: string;
  /** 그 항목 하나. 라우트 템플릿이라 `$slug`가 그대로 실린다. */
  readonly item: string;
  readonly terminal: string;
  /** `Processes`(프로세스 결정 8 · 9). 화면은 앱 전체를 보인다. */
  readonly processes: string;
  readonly archive: string;
  readonly archiveItem: string;
}

/**
 * 클립보드로 나가는 참조의 앞머리. 뒤에 `<slug>/`가 붙는다 — 형식을 짓는 것은 계속
 * `features/works/refs.ts`이고 여기는 **어느 루트인가**만 든다.
 *
 * **MCP 서버 지침과 한 몸이다.** 앱이 복사해 준 참조를 에이전트가 그대로 여는 것이 이 값의
 * 쓸모라, 지침이 읽는 뿌리와 갈리면 없는 경로가 된다. `instructions.rs`의
 * `the_instructions_read_the_roots_the_app_writes`가 이 파일을 **글자로** 읽어 그 결합을
 * 지킨다 — 아래 표의 값이나 이 두 필드 이름을 갈면 같은 커밋에서 지침도 함께 갱신해야 한다.
 */
interface ModeRefs {
  readonly work: string;
  readonly archive: string;
}

interface ModeShape {
  /**
   * 화면에 적는 이름. **대문자 영어다**(US 59). 이름이지 값이 아니다 — 명령으로 나가는 것은 위
   * `Mode`의 소문자 그대로다.
   */
  readonly name: string;
  readonly nav: readonly NavItem[];
  readonly palette: readonly PaletteDestination[];
  readonly routes: ModeRoutes;
  readonly refs: ModeRefs;
  /** 이 모드에 프로젝트라는 것이 있는가 (결정 17). */
  readonly projects: boolean;
}

const ATELIER_ROUTES = {
  list: "/works",
  item: "/works/$slug",
  terminal: "/terminal",
  processes: "/processes",
  archive: "/archive",
  archiveItem: "/archive/$slug",
} as const satisfies ModeRoutes;

/**
 * 설정은 **모드 밖이다** — `/settings`는 모드를 싣지 않는 주소다(아래 `MODELESS_PLACES`).
 *
 * 목적지는 **첫 항목이 아니라 `/settings` 그대로다** — 첫 항목으로 치환하는 것은 라우트이고
 * (`settings.index.tsx`), 설정 안에서 이 줄을 고르면 무동작인 것은 셸의 문(`navigate-guarding-settings.ts`)이
 * 이 주소를 알아보기 때문이다. 그래서 리터럴을 여기 다시 적지 않고 그쪽 `SETTINGS_ENTRY`를 그대로
 * 쓴다 — 둘이 갈리면 가드가 조용히 안 문다.
 *
 * 팔레트 목록의 **맨 뒤**인 것은 `destinations.ts`의 그 자리 그대로다 — 코어가 건넨 순서로
 * 줄을 세우므로 그 순서가 사이드바를 위에서 아래로 읽은 순서와 같다.
 */
const SETTINGS_PLACE = {
  key: "settings",
  label: "Settings",
  // 라벨·라우트·글리프 셋 다 **사이드바 바닥의 그 버튼에서 온 값이다** — 설정으로 가는 길이
  // 둘인데 이름이나 도착지나 얼굴이 갈리면 「같은 곳」이라는 것이 화면에서 안 읽힌다.
  icon: Settings,
  to: SETTINGS_ENTRY,
} as const satisfies PaletteDestination;

/**
 * **모드의 파생을 전부 드는 한 표.** 줄은 하나다(ui-refresh 결정 3).
 */
const TABLE = {
  atelier: {
    name: "Atelier",
    nav: navItems,
    palette: [...navItems, SETTINGS_PLACE],
    routes: ATELIER_ROUTES,
    refs: { work: "~/.atelier/works/", archive: "~/.atelier/archive/" },
    projects: true,
  },
} as const satisfies Record<Mode, ModeShape>;

/**
 * 모드 전부(`["atelier"]`). **표에서 뽑는다** — 캐스트가 안전한 것은 위 `satisfies Record<Mode, ModeShape>`가
 * 키를 정확히 못박기 때문이다.
 */
export const ALL_MODES = Object.keys(TABLE) as Mode[];

/**
 * 밖에서 온 글자가 가리키는 모드 — 모르는 글자면 `null`이다. 저장소에 남은 마지막 모드
 * (`lastMode`), 편집기 주소의 id(`/settings/spec-layout/$id`, spec 레이아웃 결정 25), 백엔드가 준
 * 레이아웃 상태의 id(`spec-layout/api.ts`)가 이것을 읽는다.
 *
 * `ALL_MODES`로 **검증한다**: 캐스트로 두면 저장소에 남은 옛 값(`last-mode`에 남은 지운 모드 이름)이나 손으로
 * 고친 문자열이 그대로 모드가 되어, 표에 없는 키로 파생을 찾다 `undefined`가 화면까지 간다. 모르는
 * 글자를 어디로 눕힐지는 부르는 자리가 정한다 — 마지막 모드는 Atelier로, 편집기 주소는 「spec 레이아웃」
 * 페이지로 간다.
 *
 * 「쓰는 자리가 하나면 그 파일로, 둘이면 공용으로」(`shell-meta.tsx` 머리말) — 편집기 주소가 둘째
 * 자리가 된 날 셸 스토어에서 이 표로 올라왔다.
 */
export function modeFrom(text: string | null): Mode | null {
  return ALL_MODES.find((mode) => mode === text) ?? null;
}

/** 이 주소의 모드. 값이 하나라 늘 `"atelier"`다 — 모양만 남았다. */
export function modeOf(_pathname: string): Mode {
  return "atelier";
}

/**
 * 주소가 가리키는 항목의 slug. 목록 주소(`/works`)와 다른 화면에서는 `null`이다.
 *
 * `decodeURIComponent`를 잊지 않는다 — 슬러그에 한글이 들어가고, 읽는 자리가 사이드바 강조와
 * 가지 판정 둘이다.
 *
 * 첫 칸만 본다 — slug는 경로의 한 칸이고, 뒤에 더 붙은 주소는 그 항목의 하위 화면이지
 * 다른 slug가 아니다.
 */
export function slugOf(pathname: string): string | null {
  const prefix = `${routesOf(modeOf(pathname)).list}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split("/")[0];
  return segment ? decodeURIComponent(segment) : null;
}

/**
 * 이 모드에 **프로젝트라는 것이 있는가**(결정 17). 값이 하나라 늘 참이다 — 갈래를 펴는 일은 쓰는 쪽을
 * 옮기는 커밋이 한다(ui-refresh 결정 22).
 */
export function hasProjects(mode: Mode): boolean {
  return TABLE[mode].projects;
}

/**
 * 화면에 적는 모드의 이름(`Atelier`). 설정 「spec 레이아웃」의 행 머리와 `Processes`의 세계 줄이 이것을
 * 읽는다. 문장 안에서도 이 대문자 그대로다(CONTEXT 「표기」).
 */
export function modeNameOf(mode: Mode): string {
  return TABLE[mode].name;
}

/**
 * 그 모드의 nav 배열. 그리는 것은 사이드바이고 여기는 **무엇이 서는가**만 든다.
 *
 * 셸이 이것으로 활성 항목을 고르고 클릭의 목적지도 찾는다 — 두 물음의 답이 한 배열에서 나온다
 * (`nav-items.ts`의 「`to`는 목적지이자 활성 판정의 접두사」).
 */
export function navItemsOf(mode: Mode): readonly NavItem[] {
  return TABLE[mode].nav;
}

/**
 * 사이드바에서 그 항목을 눌렀을 때 갈 곳. 없으면 `undefined`이고, 부르는 쪽(`AppShell`)이 그때
 * 아무 데도 안 간다.
 */
export function navTargetOf(mode: Mode, key: NavKey): NavTo | undefined {
  return navItemsOf(mode).find((item) => item.key === key)?.to;
}

/**
 * 그 모드의 팔레트 「가는 곳」. **nav 배열과 같지 않다** — 설정은 nav 줄에 안 서지만(결정 51)
 * 갈 수 있는 화면인 것은 그대로라, 그 한 줄이 여기서만 얹힌다.
 *
 * 팔레트가 코어에 건네는 목록도, 고른 줄을 라벨과 주소로 푸는 것도 **이 표 하나에서**
 * 나온다(`features/search/destinations.ts`). 목적지 표가 둘이면 늘어난 목적지가 목록에는
 * 서는데 Enter가 아무 일도 안 하고, 그 어긋남은 목록만 보면 안 보인다.
 */
export function destinationsOf(mode: Mode): readonly PaletteDestination[] {
  return TABLE[mode].palette;
}

/** 그 모드의 화면 주소 여섯. 반환 타입이 리터럴 유니온이라 라우터의 `to`로 그대로 나간다. */
export function routesOf(mode: Mode): (typeof TABLE)[Mode]["routes"] {
  return TABLE[mode].routes;
}

/** 그 모드의 참조 앞머리. 뒤에 `<slug>/`를 붙이는 것은 `refs.ts`의 일이다. */
export function refPrefixesOf(mode: Mode): ModeRefs {
  return TABLE[mode].refs;
}

/**
 * 모드를 **안 싣는** 주소. 그 기본값을 「마지막으로 있던 자리」로 적으면 설정을 한 번 열었다는 이유로
 * 돌아갈 자리가 설정이 된다.
 *
 * `/`는 어디로 갈지 정하기만 하고 머물지 않는 자리이고, `settings.json`은 앱 전체의 것이다(결정 20).
 */
const MODELESS_PLACES = ["/", SETTINGS_PLACE.to] as const;

/**
 * 이 주소가 선 화면의 모드. **모드를 안 싣는 주소에는 `null`이다** — `modeOf`와 다른 점이 그것 하나다.
 *
 * 「지금 어느 모드를 보고 있나」를 묻는 자리(셸의 nav·팔레트, 그리고 설정의 「앱으로 돌아가기」)는 이 함수에
 * **마지막 모드를 얹어** 쓴다 — `shell-store`의 `shellMode`가 그 합성이다. 「어디에 있었다고 적어 둘 것인가」를
 * 묻는 자리는 아무것도 안 얹고 이 함수 그대로다 — 적는 일에는 기본값이 거짓말이 된다.
 */
export function placeModeOf(pathname: string): Mode | null {
  const outside = MODELESS_PLACES.some((place) => isAtOrUnder(pathname, place));
  return outside ? null : "atelier";
}
