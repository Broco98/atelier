import { Folder, Zap, type LucideIcon } from "lucide-react";

export const navItems = [
  { key: "projects", label: "Projects", icon: Folder },
  { key: "works", label: "Works", icon: Zap },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];

export type NavKey = (typeof navItems)[number]["key"];
