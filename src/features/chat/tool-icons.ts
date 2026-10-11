import { BookOpen, Bot, Command, Globe, Map as MapIcon, Pencil, Search, Terminal, Wrench, type LucideIcon } from "lucide-react";
import type { ToolIcon } from "./tool-view";

// 도구의 아이콘 지도(캔버스 Tools 보드) — 도구 줄(`ToolRow`)과 승인 카드(`ApprovalCard`)가 함께 쓴다. 같은 도구는 줄에서도 카드에서도
// 같은 아이콘이다. 계획 승인(「이 계획대로 할까요?」)만 카드의 갈래다.
export const TOOL_ICONS: Readonly<Record<ToolIcon | "plan", LucideIcon>> = {
  execute: Terminal,
  read: BookOpen,
  edit: Pencil,
  search: Search,
  fetch: Globe,
  mcp: Command,
  skill: Wrench,
  subagent: Bot,
  plan: MapIcon,
  other: Wrench,
};
