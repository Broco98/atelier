import { navItems } from "@/components/shell/nav-items";
import type { Destination } from "./types";

/**
 * 「가는 곳」 층의 **정본은 여기 한 자리다**(결정 21). 코어는 `key`만 주고받고, **라벨과
 * 라우트는 프런트에 머문다** — 되돌려 보내면 정본이 둘이 되고, 어긋나는 날 어느 쪽이 맞는지
 * 아무도 모른다.
 *
 * 재료를 `nav-items.ts`에서 그대로 뜨는 것이 이 모듈의 전부다. 목적지가 늘면 그 배열에 한 줄
 * 넣는 일로 끝나야 하고(그 파일이 못 박아 둔 것이다), 여기에 목록을 다시 적으면 그 약속이
 * 깨진다 — 늘어난 목적지가 사이드바에는 서고 팔레트에는 안 서는 어긋남은 화면에 티가 안 난다.
 */

/** 코어에 건네는 「무엇이 있는가」. 순서도 그대로다 — 코어는 이 순서로 줄을 세운다. */
export const destinations: Destination[] = navItems.map(({ key, label }) => ({ key, label }));

/**
 * 목적지 줄에 서는 말. 모르는 `key`는 **지어내지 않고 그대로 보여 준다** — 코어는 여기서
 * 건넨 것만 돌려주므로 그런 줄은 계약이 깨진 것이고, 그때 화면이 조용히 그럴듯한 말을
 * 지어내면 어디가 어긋났는지 보이지 않는다.
 */
export function destinationLabel(key: string): string {
  return navItems.find((item) => item.key === key)?.label ?? key;
}

/** 그 목적지의 주소. 라우트도 `nav-items.ts`가 정본이다 — 사이드바가 가는 곳과 같다. */
export function destinationTo(key: string): (typeof navItems)[number]["to"] | null {
  return navItems.find((item) => item.key === key)?.to ?? null;
}
