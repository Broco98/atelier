import { Folder, Zap, type LucideIcon } from "lucide-react";

// Works가 먼저다 — 바로 아래 상주하는 것이 작업 목록인데 그 사이에 무관한 항목이 끼면
// 읽기가 어긋난다. 항목 추가는 이 배열에 한 줄 넣는 일이고, 늘어난 만큼은 목록이 스크롤로 흡수한다.
export const navItems = [
  { key: "works", label: "Works", icon: Zap },
  { key: "projects", label: "Projects", icon: Folder },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];

export type NavKey = (typeof navItems)[number]["key"];
