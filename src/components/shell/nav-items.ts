import { Folder, Inbox, Zap, type LucideIcon } from "lucide-react";

export const navItems = [
  { key: "review", label: "Review", icon: Inbox },
  { key: "projects", label: "Projects", icon: Folder },
  { key: "works", label: "Works", icon: Zap },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];

export type NavKey = (typeof navItems)[number]["key"];
