import { Settings, type LucideIcon } from "lucide-react";
import { navItems } from "@/components/shell/nav-items";
import { SETTINGS_ENTRY } from "@/features/settings/pages";
import type { Destination } from "./types";

// 「가는 곳」 층의 **표 하나.** 코어는 `key`만 주고받고, **라벨과 라우트는 프런트에 머문다**(결정 21) —
// 되돌려 보내면 정본이 둘이 되고, 어긋나는 날 어느 쪽이 맞는지 아무도 모른다. 코어에 건네는 목록도,
// 고른 줄을 라벨 · 글리프 · 주소로 푸는 것도 이 표에서 나온다 — 목적지 표가 둘이면 늘어난 목적지가 목록에는
// 서는데 Enter가 아무 일도 안 하고, 그 어긋남은 목록만 보면 안 보인다.
//
// **nav 넷은 사이드바와 같은 배열을 읽는다**(`nav-items.ts`). 설정 한 줄은 그 배열 밖에서 얹힌다 —
// 「사이드바 nav 줄에 서는가」와 「팔레트가 갈 수 있는가」는 다른 물음이고 설정에서 그 둘의 답이 갈린다:
// 결정 51이 그 배열 **안에서** 설정을 기각하고 사이드바 바닥에 고정된 자리를 줬지만, 갈 수 있는 화면인 것은 그대로다.

/** 팔레트의 「가는 곳」 줄 하나. */
interface Place {
  readonly key: string;
  readonly label: string;
  /**
   * 그 줄의 글리프. **사이드바가 같은 목적지에 세우는 것과 같은 것이다**(`spec-search`의
   * 결정 17) — 같은 것이 두 화면에서 두 얼굴이면 안 된다.
   */
  readonly icon: LucideIcon;
  /**
   * **좁은 유니온이다** — 팔레트가 고른 줄의 주소를 그대로 `navigate({ to })`로 넘기므로(`hit-target.ts`),
   * `string`으로 두면 라우터가 주소를 못 좁혀 그 자리에서 L0가 빨개진다(그리고 넓히면 오타 난 주소가 타입 검사를 통과한다).
   */
  readonly to: (typeof navItems)[number]["to"] | typeof SETTINGS_ENTRY;
}

/**
 * 설정 한 줄. 라벨 · 라우트 · 글리프 셋 다 **사이드바 바닥의 그 버튼에서 온 값이다** — 설정으로 가는 길이
 * 둘인데 이름이나 도착지나 얼굴이 갈리면 「같은 곳」이라는 것이 화면에서 안 읽힌다.
 *
 * 목적지는 **첫 항목이 아니라 `/settings` 그대로다** — 첫 항목으로 치환하는 것은 라우트이고
 * (`settings.index.tsx`), 설정 안에서 이 줄을 고르면 무동작인 것은 셸의 문(`navigate-guarding-settings.ts`)이
 * 이 주소를 알아보기 때문이다. 그래서 리터럴을 여기 다시 적지 않고 그쪽 `SETTINGS_ENTRY`를 그대로
 * 쓴다 — 둘이 갈리면 가드가 조용히 안 문다.
 */
const SETTINGS_PLACE = {
  key: "settings",
  label: "Settings",
  icon: Settings,
  to: SETTINGS_ENTRY,
} as const satisfies Place;

/**
 * 팔레트가 갈 수 있는 곳 — nav 넷 뒤에 설정 한 줄. **순서가 곧 팔레트의 순서다** — 코어가 건넨 순서로
 * 줄을 세우므로(`search.rs`의 `destination_hits`) 설정이 맨 뒤인 것은 사이드바 바닥의 그 자리 그대로다.
 */
const PLACES: readonly Place[] = [...navItems, SETTINGS_PLACE];

/**
 * 코어에 건네는 「무엇이 있는가」. **주소는 안 싣는다**(결정 21). 늘 같은 값이라 질의 키에도 안 실린다(`hooks.ts`).
 */
export const CORE_DESTINATIONS: Destination[] = PLACES.map(({ key, label }) => ({ key, label }));

/**
 * 그 `key`의 자리. **되찾기가 셋이라 훑는 자리를 하나로 둔다** — 라벨·글리프·주소가 각자
 * `find`를 부르면 「어느 목록을 훑는가」가 세 곳에 살고, 설정이 `navItems` 밖에 사는 지금
 * 한 곳만 그 배열로 되돌아가도 **그 줄만 조용히 빠진다**.
 *
 * 모르는 `key`가 `undefined`인 것은 **계약이 깨졌다는 뜻이다** — 코어는 여기서 건넨 것만
 * 돌려준다. 그때 무엇을 보여 줄지는 되찾는 쪽이 각자 정한다.
 */
function placeOf(key: string) {
  return PLACES.find((item) => item.key === key);
}

/**
 * 목적지 줄에 서는 말. 모르는 `key`는 **지어내지 않고 그대로 보여 준다** — 코어는 여기서
 * 건넨 것만 돌려주므로 그런 줄은 계약이 깨진 것이고, 그때 화면이 조용히 그럴듯한 말을
 * 지어내면 어디가 어긋났는지 보이지 않는다.
 */
export function destinationLabel(key: string): string {
  return placeOf(key)?.label ?? key;
}

/**
 * 그 목적지의 글리프. 모르는 `key`는 `null`이라 그 줄이 **빈 슬롯**을 든다:
 * 글자 시작점은 층을 가로질러 하나여야 하므로 자리는 그대로 예약된다.
 *
 * **코어에 건네는 것은 계속 `key`와 `label` 둘뿐이다.** 글리프는 React 컴포넌트라 IPC로
 * 나갈 수도 없고, 나갈 이유도 없다 — 「무엇이 있는가」는 코어가 알아야 하지만 「어떻게
 * 생겼나」는 화면의 것이다.
 */
export function destinationIcon(key: string): LucideIcon | null {
  return placeOf(key)?.icon ?? null;
}

/**
 * 그 목적지의 주소. 못 찾으면 `null`이다. 부르는 쪽(`hit-target.ts`)이 그때 아무 데도 안 간다 — 갈 곳을
 * 지어내면 엉뚱한 화면으로 데려가고, 그것이 조용하다.
 */
export function destinationTo(key: string) {
  return placeOf(key)?.to ?? null;
}
