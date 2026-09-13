import { Archive, Settings, SquareTerminal, type LucideIcon } from "lucide-react";
import { navItems, type NavKey } from "@/components/shell/nav-items";
import { SETTINGS_ENTRY } from "@/features/settings/pages";
import { isAtOrUnder } from "@/lib/path-prefix";

/**
 * 어느 세계의 것인가. **화면이 아니라 루트를 가르는 축**이다(결정 1) — 같은 컴포넌트가 다른
 * 디렉터리를 읽는다. 값은 둘뿐이고 레지스트리가 아니다(결정 5).
 *
 * **문자열 표기가 코어의 것과 같은 소문자다** — 이 값이 그대로 Tauri 명령의 `mode` 인자로
 * 나가 Rust `Mode`(`crates/atelier-core/src/mode.rs`)로 역직렬화된다. 프런트에서만 읽기 좋은
 * 다른 표기(`"Maison"` 같은)를 쓰면 그 자리마다 변환이 필요하고, 한 자리가 잊으면 명령이
 * 검증 오류로 떨어진다.
 */
export type Mode = "atelier" | "maison";

/**
 * nav 항목이 갈 수 있는 주소. **좁은 유니온이어야 한다** — 셸이 이 값을 그대로
 * `navigate({ to })`로 넘기는데, `string`으로 두면 라우터가 주소를 못 좁혀 그 자리에서
 * L0가 빨개진다(그리고 넓히면 오타 난 주소가 타입 검사를 통과한다).
 */
type NavTo = (typeof navItems)[number]["to"] | (typeof MAISON_ROUTES)["terminal" | "archive"];

/**
 * nav 줄에 서는 항목의 규격. 모드가 갈려도 **규격은 하나다**(결정 6) — 갈리는 것은 배열뿐이다.
 *
 * `key`가 `NavKey`인 것은 셸이 활성 항목을 그 어휘로만 말하기 때문이다(`Sidebar`의
 * `activeKey`) — Maison에만 있는 key를 여기 적으면 그 항목은 영영 활성 표시를 못 받는데,
 * 화면으로는 「가끔 강조가 안 된다」로만 보인다. 지금 두 배열의 key가 같은 우물에서 나오는
 * 것을 L0가 지킨다.
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
 * 그 모드의 화면 다섯. **`to` 리터럴이 박히는 자리는 여기 하나여야 한다** — 정규화
 * 리다이렉트·nav·팔레트 도착·사이드바 행·행 강조가 각자 문자열을 들면, Maison 주소 하나를
 * 고칠 때 여섯 자리를 사람이 기억해야 한다.
 */
interface ModeRoutes {
  /** 상주 목록 화면(Atelier `작업` · Maison `Rooms`). 무선택 주소라 정규화가 붙는다. */
  readonly list: string;
  /** 그 항목 하나. 라우트 템플릿이라 `$slug`가 그대로 실린다. */
  readonly item: string;
  readonly terminal: string;
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
  readonly nav: readonly NavItem[];
  readonly palette: readonly PaletteDestination[];
  readonly routes: ModeRoutes;
  readonly refs: ModeRefs;
  /** 이 세계에 프로젝트라는 것이 있는가 (결정 17). 아래 `hasProjects` 머리말이 이유다. */
  readonly projects: boolean;
}

/**
 * URL이 모드의 정본이다(결정 8). Maison은 `/maison/...`, Atelier는 **지금 주소 그대로**.
 *
 * 어느 쪽 표에서도 이 접두사를 다시 안 쓴다 — 「모든 Maison 주소는 `modeOf`가 Maison으로
 * 읽는다」를 테스트가 잡으므로, 상수를 나눠 쓰는 것보다 그 검사가 그물이 촘촘하다.
 */
const MAISON_PREFIX = "/maison";

const ATELIER_ROUTES = {
  list: "/works",
  item: "/works/$slug",
  terminal: "/terminal",
  archive: "/archive",
  archiveItem: "/archive/$slug",
} as const satisfies ModeRoutes;

const MAISON_ROUTES = {
  list: "/maison/rooms",
  item: "/maison/rooms/$slug",
  terminal: "/maison/terminal",
  archive: "/maison/archive",
  archiveItem: "/maison/archive/$slug",
} as const satisfies ModeRoutes;

/**
 * Maison nav는 `Terminal`·`Archive` 둘이다(결정 6). `Projects`가 없는 것은 빠뜨린 게 아니라
 * **이 세계에 프로젝트가 없기 때문**이다(결정 17) — Room은 토픽이고 저장소에 안 붙는다.
 *
 * Atelier 벌은 `nav-items.ts`가 계속 든다 — 그 파일의 주석이 「Works 항목은 왜 없는가」·
 * 「설정은 왜 여기 없는가」를 이미 못박고 있고, 그것을 여기로 옮기면 이유가 배열에서 떨어진다.
 * 대신 그 배열의 `to`가 아래 라우트 표와 어긋나지 않는지는 테스트가 본다.
 *
 * 아이콘은 Atelier의 같은 항목과 **같은 것**이다 — 하는 일이 같은데 세계마다 그림이 다르면
 * 세그먼트를 눌렀을 때 nav가 통째로 바뀐 것처럼 읽힌다.
 */
const MAISON_NAV = [
  { key: "terminal", label: "Terminal", icon: SquareTerminal, to: MAISON_ROUTES.terminal },
  { key: "archive", label: "Archive", icon: Archive, to: MAISON_ROUTES.archive },
] as const satisfies readonly NavItem[];

/**
 * 설정은 **모드 밖이다.** `settings.json`이 공용이고(결정 20의 「루트 바로 아래 그대로」),
 * `/settings`에는 모드 접두사가 안 붙는다 — 그래서 `modeOf`가 이 주소에서 모드를 못 읽는다.
 * 설정에는 세그먼트가 없고(UI개선 결정 21), 설정이 지니는 모드는 떠나온 모드 하나다 — 「앱으로
 * 돌아가기」가 그리로 간다.
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
 * **모드의 파생을 전부 드는 한 표.** 흩어 두면 화면이 하나 늘 때마다 「여기도 모드를 봐야
 * 하나」를 사람이 기억해야 하고, 가장 먼저 잊는 자리에서 두 세계가 섞인다 — 스펙이 필드로
 * 가르는 안을 기각한 이유와 같다.
 *
 * `satisfies Record<Mode, ModeShape>`가 그 그물이다: 칸을 하나 더하면 **두 모드가 다 채워야**
 * L0가 초록이 되고, 모드를 빠뜨리거나 없는 모드를 적어도 그 자리에서 걸린다.
 */
const TABLE = {
  atelier: {
    nav: navItems,
    palette: [...navItems, SETTINGS_PLACE],
    routes: ATELIER_ROUTES,
    refs: { work: "~/.atelier/works/", archive: "~/.atelier/archive/" },
    projects: true,
  },
  maison: {
    nav: MAISON_NAV,
    palette: [...MAISON_NAV, SETTINGS_PLACE],
    routes: MAISON_ROUTES,
    refs: { work: "~/.atelier/maison/rooms/", archive: "~/.atelier/maison/archive/" },
    projects: false,
  },
} as const satisfies Record<Mode, ModeShape>;

/**
 * 두 모드 전부. **표에서 뽑는다** — 손으로 적은 목록은 표와 조용히 어긋날 수 있다. 캐스트가
 * 안전한 것은 위 `satisfies Record<Mode, ModeShape>`가 키를 정확히 이 둘로 못박기 때문이다.
 */
export const ALL_MODES = Object.keys(TABLE) as Mode[];

/**
 * 이 주소는 어느 세계인가. **정확히 `/maison`이거나 `/maison/`으로 시작할 때만** Maison이다 —
 * `startsWith("/maison")` 하나로 두면 `/maisonette` 같은 미래의 주소가 조용히 Maison이 되고,
 * 그때 화면은 「가끔 Maison으로 뜬다」로만 보인다.
 *
 * 모르는 주소는 Atelier다(`/settings`도 여기로 떨어진다) — Atelier 주소는 접두사가 없어서
 * 「Maison이 아니면 Atelier」 말고 다른 규칙을 세울 수 없다.
 */
export function modeOf(pathname: string): Mode {
  return isAtOrUnder(pathname, MAISON_PREFIX) ? "maison" : "atelier";
}

/**
 * 주소가 가리키는 항목의 slug. 목록 주소(`/works`·`/maison/rooms`)와 다른 화면에서는 `null`이다.
 *
 * **두 모드를 한 함수가 읽는다** — 모드를 먼저 판정하고 그 모드의 목록 주소를 앞머리로 쓴다.
 * 갈래를 둘로 적으면 한쪽에서만 `decodeURIComponent`를 잊는 사고가 그대로 재현된다(슬러그에
 * 한글이 들어가고, 읽는 자리가 사이드바 강조와 가지 판정 둘이다).
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
 * 이 세계에 **프로젝트라는 것이 있는가**(결정 17). Room은 토픽이고 저장소에 안 붙어서,
 * 프로젝트도 브랜치도 워크트리도 Maison에는 자리가 없다.
 *
 * **물음에 이름을 준 것이 요점이다.** 이 판정이 화면 여섯과 훅 하나에 흩어져 있었고
 * (정보 탭의 구획과 브랜치 줄 · ⓘ 팝오버 · 사이드바 hover 카드 · 본문의 등록 안내 ·
 * 아카이브의 프로젝트 메타 · `+`가 여는 워크트리 목록 · 프로젝트 쿼리의 `enabled`),
 * 전부 세계 이름을 리터럴로 맞대는 **같은 모양**이었다 — 같은 물음이 일곱 자리에서 각자
 * 늙는다는 뜻이라, 한 자리에 새 갈래가 필요해지는 날 나머지가 조용히 뒤처진다.
 * (그 모양을 여기 산문으로도 안 적는다: `mode.test.ts`의 소스 스캔이 파싱 없이 글자만 보고,
 * 파싱이 필요 없게 좁힌 것이 그 검사가 fail-closed인 근거다.)
 * 세계 이름과 그 세계의 성질을 가르는 일이기도 하다: 셋째 세계가 생기면 이 표의 칸 하나가
 * 답을 정하고, 리터럴 비교였다면 일곱 자리를 모두 찾아 고쳐야 한다.
 *
 * 판정은 「프로젝트가 0개인가」가 **아니다.** 손으로 고친 work.json이나 저쪽 세계에서 옮겨 온
 * 폴더가 Room에도 프로젝트 이름을 실어 올 수 있어서, 값으로만 가르면 그날 그 화면에만 저
 * 세계의 개념이 되살아난다.
 */
export function hasProjects(mode: Mode): boolean {
  return TABLE[mode].projects;
}

/**
 * 그 모드의 nav 배열. 그리는 것은 사이드바이고 여기는 **무엇이 서는가**만 든다.
 *
 * 셸이 이것으로 활성 항목을 고르고 클릭의 목적지도 찾는다 — 그 두 물음의 답이 한 배열에서
 * 나와야 Maison에서 nav를 눌렀을 때 Atelier로 튀지 않는다(`nav-items.ts`의 「`to`는 목적지이자
 * 활성 판정의 접두사」가 모드별로 그대로 이어진다).
 */
export function navItemsOf(mode: Mode): readonly NavItem[] {
  return TABLE[mode].nav;
}

/**
 * 사이드바에서 그 항목을 눌렀을 때 갈 곳. **그 세계의 배열만 본다** — Maison에서 Terminal을
 * 눌렀는데 Atelier의 `/terminal`로 가면 nav 한 번에 세계를 떠난다.
 *
 * 한때 못 찾으면 Atelier 벌로 떨어지는 **되돌림**이 있었다. 사이드바가 두 세계 모두에
 * Atelier 배열을 그리던 동안(#183 전) Maison 화면에도 `Projects`가 서 있어서, 아무 데도 안
 * 보내면 눌리는데 아무 일도 안 일어나는 버튼이 됐기 때문이다. #183이 사이드바를 모드 배열로
 * 옮기면서 그 항목이 화면에서 사라졌고 되돌림도 함께 걷었다 — 남겨 두면 그 항목이 어떤
 * 이유로든 되살아나는 날 조용히 세계를 건넌다(결정 17: Maison에 프로젝트는 없다).
 * 없으면 `undefined`이고, 부르는 쪽(`AppShell`)이 이미 그때 아무 데도 안 간다.
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

/** 그 모드의 화면 주소 다섯. 반환 타입이 리터럴 유니온이라 라우터의 `to`로 그대로 나간다. */
export function routesOf(mode: Mode): (typeof TABLE)[Mode]["routes"] {
  return TABLE[mode].routes;
}

/** 그 모드의 참조 앞머리. 뒤에 `<slug>/`를 붙이는 것은 `refs.ts`의 일이다. */
export function refPrefixesOf(mode: Mode): ModeRefs {
  return TABLE[mode].refs;
}

/**
 * 모드를 **안 싣는** 주소. `modeOf`는 모르는 주소를 Atelier로 눕히는데(접두사가 없는 쪽이
 * Atelier라 다른 규칙을 세울 수 없다), 그 기본값을 「마지막으로 어느 세계에 있었나」로 적으면
 * Maison에서 설정을 한 번 열었다는 이유로 다음 실행이 Atelier로 뜬다.
 *
 * Atelier 주소에는 접두사가 없어 **예외를 세는 수밖에 없다.** 이 둘이 세계 밖 화면의 전부다 —
 * `/`는 어디로 갈지 정하기만 하고 머물지 않는 자리이고, `settings.json`은 두 세계가 함께
 * 쓴다(결정 20). 화면이 하나 더 세계 밖에 서는 날 이 배열이 그 자리다.
 */
const MODELESS_PLACES = ["/", SETTINGS_PLACE.to] as const;

/**
 * 이 주소가 선 화면의 세계. **모드를 안 싣는 주소에는 `null`이다** — `modeOf`와 다른 점이
 * 그것 하나다.
 *
 * 「지금 어느 세계를 보고 있나」를 묻는 자리(셸의 nav·세그먼트·팔레트, 그리고 설정의 「앱으로
 * 돌아가기」)는 이 함수에 **마지막 모드를 얹어** 쓴다 — `shell-store`의 `shellMode`가 그 합성이다.
 * 설정이 지니는 모드는 떠나온 모드인데, `modeOf`로 물으면 `/settings`가 언제나 Atelier라 Maison에서
 * 들어온 설정이 Atelier로 돌아가고 팔레트가 저쪽 세계를 뒤진다. 「어느 세계에 있었다고 적어 둘
 * 것인가」를 묻는 자리는 아무것도 안 얹고 이 함수 그대로다 — 적는 일에는 기본값이 거짓말이
 * 된다.
 */
export function placeModeOf(pathname: string): Mode | null {
  if (modeOf(pathname) === "maison") return "maison";
  const outside = MODELESS_PLACES.some((place) => isAtOrUnder(pathname, place));
  return outside ? null : "atelier";
}
