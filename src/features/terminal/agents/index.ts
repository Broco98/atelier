import type { ShellHookState } from "../types";
import { claude } from "./claude";
import { codex } from "./codex";
import type { AgentAdapter, AgentSignal } from "./types";

export { subagentOf } from "./payload";

const ADAPTERS: Readonly<Record<string, AgentAdapter>> = { claude, codex };

export function foldHookState(state: ShellHookState | null): AgentSignal | null {
  if (!state) return null;
  return ADAPTERS[state.agent]?.fold(state) ?? null;
}
