import { destinationsOf } from "@/mode";
import type { Mode } from "@/mode";
import type { Destination } from "./types";

// 「가는 곳」 층을 **그 세계의 표에서 푼다.** 코어는 `key`만 주고받고, **라벨과 라우트는
// 프런트에 머문다**(결정 21) — 되돌려 보내면 정본이 둘이 되고, 어긋나는 날 어느 쪽이 맞는지
// 아무도 모른다.
//
// 재료는 `@/mode`의 `destinationsOf(mode)` **한 표다.** 한때 여기에 `navItems`에 설정 한 줄을
// 얹은 배열을 따로 적어 뒀고, 세계가 하나이던 동안에는 그것으로 충분했다. 세계가 둘이 되면서
// 그 배열은 「Atelier의 것」이 됐다 — 그대로 두면 Maison에서 누른 ⇧⇧에도 `Projects`가 서고
// (그 세계에 프로젝트는 없다 — 결정 17), 고른 줄이 Atelier 주소로 데려간다.
//
// **설정 한 줄을 얹는 자리는 계속 그 표 안이다**(`mode.ts`의 `SETTINGS_PLACE`). 「사이드바
// nav 줄에 서는가」와 「팔레트가 갈 수 있는가」는 다른 물음이고 설정에서 그 둘의 답이
// 갈리는데, 결정 51이 그 배열 **안에서** 설정을 기각하고 사이드바 바닥에 고정된 자리를 줬기
// 때문이다. 갈 수 있는 화면인 것은 그대로라, 그 한 줄이 nav 밖에서 얹힌다.

/**
 * 코어에 건네는 「무엇이 있는가」. **순서도 그대로다** — 코어는 이 순서로 「가는 곳」 줄을
 * 세우므로(`search.rs`의 `destination_hits`), 이 순서가 곧 팔레트에 서는 순서다.
 *
 * **주소는 안 싣는다**(결정 21). 모드마다 새 배열이 나오는 것은 값이 모드에서 파생되기
 * 때문이고, 그래도 질의 키에 안 실어도 되는 이유는 `mode`가 이미 그 키에 있어서다(`hooks.ts`).
 */
export function destinationsFor(mode: Mode): Destination[] {
  return destinationsOf(mode).map(({ key, label }) => ({ key, label }));
}

/**
 * 목적지 줄에 서는 말. 모르는 `key`는 **지어내지 않고 그대로 보여 준다** — 코어는 여기서
 * 건넨 것만 돌려주므로 그런 줄은 계약이 깨진 것이고, 그때 화면이 조용히 그럴듯한 말을
 * 지어내면 어디가 어긋났는지 보이지 않는다.
 */
export function destinationLabel(mode: Mode, key: string): string {
  return destinationsOf(mode).find((place) => place.key === key)?.label ?? key;
}

/**
 * 그 목적지의 주소. **그 세계의 표만 훑는다** — 세계를 안 보면 Maison에서 고른 `Archive`
 * 줄이 Atelier의 `/archive`로 가고, 그 이동은 오류 하나 없이 세계를 건넌다.
 *
 * 못 찾으면 `null`이다. 부르는 쪽(`hit-target.ts`)이 그때 아무 데도 안 간다 — 갈 곳을
 * 지어내면 엉뚱한 화면으로 데려가고, 그것이 조용하다.
 */
export function destinationTo(mode: Mode, key: string) {
  return destinationsOf(mode).find((place) => place.key === key)?.to ?? null;
}
