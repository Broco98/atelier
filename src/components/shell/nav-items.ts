import { Folder, Terminal, Zap, type LucideIcon } from "lucide-react";

export const navItems = [
  { key: "projects", label: "Projects", icon: Folder },
  { key: "works", label: "Works", icon: Zap },
  // 세션은 Work에 딸린 부속물이 아니라 독립된 것이므로 최상위에 둔다
  { key: "sessions", label: "Sessions", icon: Terminal },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];

export type NavKey = (typeof navItems)[number]["key"];
