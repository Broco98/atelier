import { Folder, type LucideIcon } from "lucide-react";

// Works 항목은 없다. 바로 아래에 작업 목록이 통째로 상주하고 그 섹션 헤더('작업')가
// Works 화면으로 가는 링크를 겸하므로, nav의 Works는 같은 곳으로 가는 두 번째 버튼이었다.
// 앞으로 늘어날 목적지(Wiki·Review·History)는 이 배열에 한 줄 넣는 일이고,
// 늘어난 만큼은 아래 목록이 스크롤로 흡수한다.
export const navItems = [
  { key: "projects", label: "Projects", icon: Folder },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];

export type NavKey = (typeof navItems)[number]["key"];
