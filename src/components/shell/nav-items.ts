import { Archive, Folder, SquareTerminal, type LucideIcon } from "lucide-react";

// Works 항목은 없다. 바로 아래에 작업 목록이 통째로 상주하고 그 섹션 헤더('작업')가
// Works 화면으로 가는 링크를 겸하므로, nav의 Works는 같은 곳으로 가는 두 번째 버튼이었다.
// 앞으로 늘어날 목적지(Wiki·Review·History)는 이 배열에 한 줄 넣는 일이고,
// 늘어난 만큼은 아래 목록이 스크롤로 흡수한다.
//
// Archive는 그 반대 이유로 여기 있다 — 치운 작업은 차가운 보관물이라 사이드바 목록에
// 상주할 이유가 없고, 상주시키면 아래 목록이 "지금 하는 일"이라는 성질을 잃는다.
// 아이콘은 ⋯ 메뉴의 '아카이빙'과 같은 것을 쓴다: 하는 일과 가는 곳이 같은 대상이다.
// `to`는 목적지이자 **활성 판정의 접두사**다 — 어느 항목이 켜지는지와 어디로 가는지가
// 한 줄에서 나온다. 둘을 따로 적으면 AppShell에 같은 key를 두 번 훑는 분기가 생긴다.
export const navItems = [
  { key: "projects", label: "Projects", icon: Folder, to: "/projects" },
  { key: "terminal", label: "Terminal", icon: SquareTerminal, to: "/terminal" },
  { key: "archive", label: "Archive", icon: Archive, to: "/archive" },
] as const satisfies readonly {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string;
}[];

export type NavKey = (typeof navItems)[number]["key"];
