import { navItems } from "@/components/shell/nav-items";
import type { Destination } from "./types";

/**
 * 「가는 곳」 층의 **정본은 여기 한 자리다**(결정 21). 코어는 `key`만 주고받고, **라벨과
 * 라우트는 프런트에 머문다** — 되돌려 보내면 정본이 둘이 되고, 어긋나는 날 어느 쪽이 맞는지
 * 아무도 모른다.
 *
 * 재료의 대부분을 `nav-items.ts`에서 그대로 뜬다. 목적지가 늘면 그 배열에 한 줄 넣는 일로
 * 끝나야 하고(그 파일이 못 박아 둔 것이다), 여기에 목록을 다시 적으면 그 약속이 깨진다 —
 * 늘어난 목적지가 사이드바에는 서고 팔레트에는 안 서는 어긋남은 화면에 티가 안 난다.
 *
 * **그런데 그 배열 하나로 답할 수 없는 물음이 있다.** 「사이드바 nav 줄에 서는가」와
 * 「팔레트가 갈 수 있는가」는 다른 물음이고, **설정에서 그 둘의 답이 갈린다**: 결정 51이
 * 설정을 `navItems` 안에서 기각하고 사이드바 **바닥에 고정**된 자리를 줬지만(「설정은 이
 * 목적지들과 성질이 다르다」를 위치로 말하는 것이다), **갈 수 있는 화면인 것은 그대로다.**
 *
 * 그래서 **`navItems`를 안 고치고 여기서 한 줄을 얹는다.** 그 배열에 넣으면 설정이 nav 줄에
 * 서 버려 결정 51이 깨지고, 안 얹으면 팔레트가 설정에 못 간다. nav 줄은 계속 `navItems`만
 * 읽으므로 재료가 갈리지 않는다 — 갈리는 것은 **이 한 줄뿐**이고, 그 이유가 이 문단이다.
 * 「navItems에 넣으면 되잖아」로 되돌리면 결정 51이 조용히 죽는다.
 */
const places = [
  ...navItems,
  // 라벨과 라우트는 **사이드바 바닥의 그 버튼에서 온 값이다**(`Sidebar.tsx`의
  // `label="Settings"` · `AppShell.tsx`의 `to: "/settings"`) — 설정으로 가는 길이 둘인데
  // 이름이나 도착지가 갈리면 「같은 곳」이라는 것이 화면에서 안 읽힌다.
  //
  // **맨 뒤인 것도 그 자리 그대로다.** 코어는 건넨 순서로 줄을 세우므로(`search.rs`의
  // `destination_hits`), 「가는 곳」 줄들의 순서가 사이드바를 위에서 아래로 읽은 순서와 같다.
  { key: "settings", label: "Settings", to: "/settings" },
] as const satisfies readonly { key: string; label: string; to: string }[];

/** 코어에 건네는 「무엇이 있는가」. 순서도 그대로다 — 코어는 이 순서로 줄을 세운다. */
export const destinations: Destination[] = places.map(({ key, label }) => ({ key, label }));

/**
 * 목적지 줄에 서는 말. 모르는 `key`는 **지어내지 않고 그대로 보여 준다** — 코어는 여기서
 * 건넨 것만 돌려주므로 그런 줄은 계약이 깨진 것이고, 그때 화면이 조용히 그럴듯한 말을
 * 지어내면 어디가 어긋났는지 보이지 않는다.
 */
export function destinationLabel(key: string): string {
  return places.find((item) => item.key === key)?.label ?? key;
}

/**
 * 그 목적지의 주소. **`navItems`가 아니라 위 목록을 훑는다** — 설정은 그 배열에 없어서,
 * `navItems`만 보면 팔레트 목록에는 뜨는데 Enter가 아무 일도 안 하는 줄이 된다.
 */
export function destinationTo(key: string): (typeof places)[number]["to"] | null {
  return places.find((item) => item.key === key)?.to ?? null;
}
