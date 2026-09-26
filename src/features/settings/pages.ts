import { Bell, FolderTree, SquareTerminal, Webhook, type LucideIcon } from "lucide-react";
import { isAtOrUnder } from "@/lib/path-prefix";

/**
 * 설정으로 들어가는 주소. **문 셋이 다 여기로 간다**(사이드바 바닥 · ⌘, · 팔레트) — 첫 항목으로
 * 치환되는 것은 라우트(`settings.index.tsx`)의 일이고, 문은 어느 항목이 첫째인지 모른다.
 * 팔레트 목적지(`mode.ts`의 `SETTINGS_PLACE`)도 리터럴을 다시 적지 않고 이 값을 가져다 쓴다.
 */
export const SETTINGS_ENTRY = "/settings";

/**
 * 설정 nav 항목 넷(UI개선 결정 21·22). 항목 하나 = 페이지 하나 = 주소 하나다.
 *
 * **라벨은 한국어다**(결정 21의 이름 그대로) — main nav의 대문자 층도, 탭 줄의 소문자 가족도
 * 아니다(`CONTEXT.md` 표기 절). `터미널`은 설정 항목의 이름이고, 문장에서는 「터미널 설정」으로
 * 써서 화면 「터미널」과 가른다. `spec 레이아웃`의 소문자 `spec`은 「spec 폴더」와 같은 쓰임이다.
 *
 * **`spec 레이아웃`은 맨 뒤다**(spec 레이아웃 티켓 08). `/settings`는 첫 항목으로 넘기므로
 * (`settings.index.tsx`), 앞에 서면 설정을 여는 문 셋이 모두 이 페이지에 선다.
 *
 * 사이드바의 설정 nav와 본문 머리(`Settings / 터미널`)가 **이 표 하나**를 읽는다 — 둘이 각자
 * 라벨을 들면 이름을 고치는 날 한쪽만 바뀐다.
 */
export const SETTINGS_ITEMS = [
  { key: "terminal", label: "터미널", icon: SquareTerminal, to: "/settings/terminal" },
  { key: "notifications", label: "알림", icon: Bell, to: "/settings/notifications" },
  { key: "hooks", label: "에이전트 훅", icon: Webhook, to: "/settings/hooks" },
  { key: "spec-layout", label: "spec 레이아웃", icon: FolderTree, to: "/settings/spec-layout" },
] as const satisfies readonly {
  key: string;
  label: string;
  icon: LucideIcon;
  to: `${typeof SETTINGS_ENTRY}/${string}`;
}[];

export type SettingsItemKey = (typeof SETTINGS_ITEMS)[number]["key"];

/** 그 항목의 규격. 표에 없는 key는 타입이 막는다. */
export function settingsItem(key: SettingsItemKey): (typeof SETTINGS_ITEMS)[number] {
  return SETTINGS_ITEMS.find((item) => item.key === key)!;
}

/**
 * 이 주소가 선 설정 항목. 설정 밖이거나 치환 전의 `/settings`면 `null`이다.
 *
 * **원시값을 돌려준다** — 앱 셸이 이것을 주소 select로 구독하므로(`AppShell.tsx`) 객체를 주면
 * 주소가 바뀔 때마다 셸 전체가 리렌더한다. 그리고 이 값 하나가 「사이드바가 설정 nav인가」와
 * 「어느 항목이 켜졌나」를 함께 답한다 — 둘을 따로 구독하면 구독이 하나 는다.
 */
export function settingsItemOf(pathname: string): SettingsItemKey | null {
  return SETTINGS_ITEMS.find((item) => item.to === pathname)?.key ?? null;
}

/**
 * 설정 안인가. 치환 전의 `/settings`도 안이다 — 문의 가드(`navigate-guarding-settings.ts`)가 묻는 것이
 * 이것이고, 그 가드는 「보던 항목에 머문다」를 지키려고 있다.
 */
export function inSettings(pathname: string): boolean {
  return isAtOrUnder(pathname, SETTINGS_ENTRY);
}
