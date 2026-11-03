import { isObject, nonEmpty, type Json } from "./json";

// 도구 줄이 무엇을 부르나(01c-2 · 구현 스펙 「Claude 전제 넓히기」) — 도구 줄 · 승인 카드 · 접기가 같은 칸을 같은 규칙으로 읽는 **순수 함수**다.
// 화면에서 `_meta.claudeCode`의 도구 이름 · 서브에이전트를 읽는 곳은 여기 하나다.
// - ACP 칸에 Runtime이 무엇이든 같은 뜻으로 실리는 값은 그것을 먼저 읽는다 — MCP 이름이다(`mcpOf`).
// - 그런 값이 없는 것만 Claude 메타로 읽는다 — Claude 내장 도구의 이름(`Skill` · `WebSearch` · `ToolSearch`)과 서브에이전트다. ACP에는 도구 이름 ·
//   서브에이전트 칸이 없고, codex-acp 2.2.2도 AIR가 아닌 클라이언트에는 싣지 않는다. 제목을 도구 이름으로 먼저 읽지 않는다 — Claude의 `Agent` ·
//   `Bash` 제목은 모델이 쓴 글이라 다른 도구 이름을 흉내 낼 수 있다.

/** MCP 호출 하나 — 서버 · 도구와 도구에 보낸 값. */
export interface McpCall {
  server: string;
  tool: string;
  /** 도구에 보낸 값 — codex-acp는 `rawInput.arguments`, Claude는 `rawInput` 그대로다. */
  input: Json;
}

/** 도구 호출 원문에서 갈래를 가르는 칸들. */
export interface ToolFields {
  meta: Json;
  /** Claude 변환기가 실은 도구 이름(`_meta.claudeCode.toolName`) — ACP에 칸이 없는 이름이다. 다른 Runtime의 줄은 null이다. */
  toolName: string | null;
  /** MCP 호출이면 그 서버 · 도구 · 보낸 값. */
  mcp: McpCall | null;
  /** 서브에이전트에게 맡기는 줄이면 맡은 이의 갈래(모르면 `type`이 null) — Claude 변환기가 실은 `subagent`로만 읽는다. */
  subagent: { type: string | null } | null;
  rawInput: Json;
  title: string | null;
  kind: string;
}

export function toolFields(call: Json): ToolFields {
  const meta = isObject(call._meta) ? call._meta : {};
  const claudeCode = isObject(meta.claudeCode) ? meta.claudeCode : {};
  const rawInput = isObject(call.rawInput) ? call.rawInput : {};
  const title = nonEmpty(call.title);
  const toolName = nonEmpty(claudeCode.toolName);
  return {
    meta,
    toolName,
    mcp: mcpOf(title, rawInput, toolName),
    subagent: isObject(claudeCode.subagent) ? { type: nonEmpty(claudeCode.subagent.subagentType) } : null,
    rawInput,
    title,
    kind: typeof call.kind === "string" ? call.kind : "other",
  };
}

/**
 * MCP 호출의 서버 · 도구 · 보낸 값. MCP가 아니면 null.
 * - 표준 값 먼저 — 제목이 `mcp.<서버>.<도구>`이고 `rawInput`의 `server` · `tool`이 그 둘이다. 보낸 값은 `rawInput.arguments`다(codex-acp 2.2.2,
 *   `spec/research/runtime-실측.md`). 제목과 입력이 서로 맞아야 MCP다 — 입력에 `server` · `tool` 칸이 든 다른 도구를 MCP로 읽지 않는다.
 * - 없으면 Claude 도구 이름 `mcp__<서버>__<도구>`이고, Claude 도구 이름이 없는 줄은 제목을 그 이름으로 읽는다. 보낸 값은 `rawInput` 그대로다.
 */
function mcpOf(title: string | null, rawInput: Json, toolName: string | null): McpCall | null {
  const server = nonEmpty(rawInput.server);
  const tool = nonEmpty(rawInput.tool);
  if (server && tool && title === `mcp.${server}.${tool}`) {
    return { server, tool, input: isObject(rawInput.arguments) ? rawInput.arguments : {} };
  }
  const named = (toolName ?? title)?.match(/^mcp__(.+?)__(.+)$/);
  return named ? { server: named[1], tool: named[2], input: rawInput } : null;
}
