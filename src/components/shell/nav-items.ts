import { Activity, Archive, Folder, SquareTerminal, type LucideIcon } from "lucide-react";

// **이 넷은 사람 메뉴의 항목이다**(v1 구현 스펙 S27 · 티켓 07). 한때 사이드바 위의 main nav였고, v1에서 사이드바는 검색 ·
// 새 Thread · Work · Thread가 차지하고 지금 화면들은 바닥 사람 줄의 메뉴로 갔다(`Sidebar.tsx`의 `PersonMenu`). 차례는 그대로다.
//
// Works 항목은 없다. 사이드바에 작업 목록이 통째로 상주하고 그 섹션 헤더('작업')가
// Works 화면으로 가는 링크를 겸하므로, Works는 같은 곳으로 가는 두 번째 버튼이었다.
// 앞으로 늘어날 목적지(Wiki·Review·History)는 이 배열에 한 줄 넣는 일이다.
//
// **설정은 그 한 줄이 아니다.** 결정 51이 그 안을 기각하고 따로 선 자리를 줬다 — 「설정은 이
// 목적지들과 성질이 다르다」를 자리로 말하는 것이다. 사람 메뉴에서도 구분선 뒤 끝에 따로 선다.
//
// Archive는 그 반대 이유로 여기 있다 — 치운 작업은 차가운 보관물이라 사이드바 목록에
// 상주할 이유가 없고, 상주시키면 아래 목록이 "지금 하는 일"이라는 성질을 잃는다.
// 아이콘은 ⋯ 메뉴의 '아카이브'와 같은 것을 쓴다: 하는 일과 가는 곳이 같은 대상이다.
// `to`는 목적지이자 **활성 판정의 접두사**다 — 어느 항목이 켜지는지와 어디로 가는지가
// 한 줄에서 나온다. 둘을 따로 적으면 AppShell에 같은 key를 두 번 훑는 분기가 생긴다.
/**
 * 사람 메뉴 `Terminal`의 이름. **상수로 꺼내 둔 것은 읽는 자리가 둘이기 때문이다** — 이 배열과
 * 알림 띠다(#204, 결정 13의 다섯째): 최상위 셸이 부르면 띠의 제목 자리에 이 말이
 * 서고, 누르면 이 항목이 가는 그 화면으로 간다. 두 자리에 글자를 각각 적으면 이름을 고치는
 * 날 한쪽만 바뀌어 「같은 곳」이 화면에서 두 이름을 갖는다.
 *
 * 대문자인 것은 CONTEXT.md의 표기다 — 사람 메뉴가 가는 곳의 이름은 대문자이고, 탭 줄에서
 * 「무엇을 볼까」를 고르는 `spec`은 소문자다.
 */
export const TERMINAL_LABEL = "Terminal";

export const navItems = [
  { key: "projects", label: "Projects", icon: Folder, to: "/projects" },
  { key: "terminal", label: TERMINAL_LABEL, icon: SquareTerminal, to: "/terminal" },
  // **`Terminal` 다음, `Archive` 앞**(프로세스 스펙 S43) — 셸과 가까운 곳에 두고, 차가운 보관물(위 Archive 주석)은 끝에 둔다.
  { key: "processes", label: "Processes", icon: Activity, to: "/processes" },
  { key: "archive", label: "Archive", icon: Archive, to: "/archive" },
] as const satisfies readonly {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string;
}[];

export type NavKey = (typeof navItems)[number]["key"];

/**
 * 그 nav 항목의 규격. **화면의 머리 카드가 제 이름 · 아이콘을 여기서 읽는다**(`Frame`의 `HeadSlot` — 고른 것이 없으면 화면
 * 이름이고 아이콘은 nav의 그것이다). nav와 머리 카드가 각자 글자를 들면 이름을 고치는 날 한쪽만 바뀌어 「같은 곳」이 화면에서
 * 두 이름을 갖는다(위 `TERMINAL_LABEL`과 같은 까닭). 배열에 없는 key는 타입이 막는다.
 */
export function navItem(key: NavKey): (typeof navItems)[number] {
  return navItems.find((item) => item.key === key)!;
}
