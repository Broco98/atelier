import { expandHome } from "@/features/works/doc-refs";
import type { ToolEntry } from "./fold";

// 도구 줄의 화면 값(three-axes 티켓 18) — 접은 도구 호출(`ToolEntry`: 처음 온 `tool_call`에 뒤의 `tool_call_update`를 덮어 합친 값)을
// 문구 · 아이콘 · 안의 것(명령 출력 · diff · MCP 출력)으로 옮기는 **순수 함수**다. 그리는 것은 `ToolRow`다.
//
// **엔진 이름이 아니라 ACP 모양으로 가른다**(three-axes 결정 16). 갈래는 ACP 도구 `kind`(`execute` · `read` · `edit` · `delete` ·
// `move` · `search` · `fetch` · `think` · `switch_mode` · `other`)이고, 엔진이 `_meta`에 더 싣는 것은 그 모양 그대로 읽는다:
// - **MCP 호출** — Claude 변환기는 `_meta.claudeCode.toolName`에 `mcp__<서버>__<도구>`를 싣고(티켓 14), codex-acp 2.2.2는
//   `_meta.is_mcp_tool_call`과 `rawInput{server, tool, arguments}`를 싣는다(`McpToolReporter` — 제목은 `mcp.<서버>.<도구>`, kind는
//   `execute`). MCP는 kind보다 먼저 가른다 — codex의 MCP 호출은 kind가 `execute`라 명령 출력 상자로 빠지면 안 된다.
// - **서브에이전트** — Claude 변환기가 `_meta.claudeCode.subagent{subagentType, description}`을 싣는다(kind `think`).
// - **스킬** — `_meta.claudeCode.toolName`이 `Skill`이다(캔버스 Tools 보드의 「grilling 스킬 읽음」).
//
// **문구는 진행형 → 완료형**(스토리 39)이고 실패는 색이 아니라 문장이다 — 「~하지 못함」(캔버스 Tools 보드). 끝나지 않은 상태
// (`pending` · `in_progress` · 상태 없음)는 진행형이다. **제목이 빈 도구 줄**(실측 함정 49 — codex의 title 빈 execute)은 kind로 짓는다:
// 명령이면 「명령」, 파일 도구면 「파일」, 그 밖은 「도구」가 문구의 자리를 채운다.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** 도구 줄의 때 — 도는 중 · 끝남 · 실패. */
export type ToolState = "running" | "done" | "failed";

/** 도구 줄 앞의 아이콘 갈래(캔버스 Tools 보드의 아이콘 지도). */
export type ToolIcon = "execute" | "read" | "edit" | "search" | "fetch" | "mcp" | "skill" | "subagent" | "other";

/**
 * 도구 줄의 문구 — 한 문장이지만 **대상**(파일 이름 · 명령)의 자리를 갈라 둔다. 대상이 스펙 창이 열 수 있는 파일이면 그 자리에
 * 파일 링크가 선다(스토리 77).
 */
export interface ToolPhrase {
  before: string;
  /** 문구 안의 대상 — 없으면(「검색함」) null이다. */
  subject: string | null;
  after: string;
  /** 대상이 파일이면 그 경로(엔진이 준 그대로), 아니면 null. */
  file: string | null;
}

/** diff 한 줄 — 더함 · 지움 · 둘레(바뀌지 않은 줄), 그리고 둘레를 줄여 건너뛴 자리. */
export type DiffLine = { type: "add" | "del" | "ctx"; text: string } | { type: "gap"; count: number };

/** 편집 도구의 diff 내용 하나(ACP `{type: "diff", path, oldText, newText}`) — 줄 단위로 견준 값. */
export interface DiffPiece {
  path: string;
  /** 옛 글을 모른다 — 새로 쓴 파일이거나 옛 글을 싣지 않은 편집이다(Claude Write, 변환기 S2). */
  written: boolean;
  lines: DiffLine[];
  added: number;
  deleted: number;
}

export interface ToolView {
  state: ToolState;
  icon: ToolIcon;
  phrase: ToolPhrase;
  /** 문구 한 줄 — 도구 줄의 이름이다. */
  label: string;
  /** 명령 출력 상자(셸) — 명령이 아니면 null. */
  shell: { command: string | null; output: string; status: string | null; ok: boolean } | null;
  /** 편집 도구의 diff들. */
  diffs: DiffPiece[];
  /** MCP 호출 — 서버 · 도구 이름과 원본 출력. MCP가 아니면 null. */
  mcp: { server: string; tool: string; output: string } | null;
  /** 그 밖의 글 출력 — 실패한 도구의 오류 글 · 서브에이전트가 돌려준 글. 펼쳐야 보인다. */
  text: string | null;
  /** 지운 파일(`delete`)의 줄인가 — 줄 끝 점의 색이 갈린다. */
  removed: boolean;
}

export function describeTool(tool: ToolEntry): ToolView {
  const call = tool.call;
  const state: ToolState = call.status === "completed" ? "done" : call.status === "failed" ? "failed" : "running";
  const meta = isObject(call._meta) ? call._meta : {};
  const claudeCode = isObject(meta.claudeCode) ? meta.claudeCode : {};
  const toolName = nonEmpty(claudeCode.toolName);
  const rawInput = isObject(call.rawInput) ? call.rawInput : {};
  const title = nonEmpty(call.title);
  const kind = typeof call.kind === "string" ? call.kind : "other";
  const content = Array.isArray(call.content) ? call.content.filter(isObject) : [];
  const contentText = content
    .map((item) => (item.type === "content" && isObject(item.content) && item.content.type === "text" ? item.content.text : null))
    .filter((text): text is string => typeof text === "string")
    .join("\n");
  const base = { state, diffs: [] as DiffPiece[], shell: null, mcp: null, text: null, removed: false };

  const mcp = mcpOf(toolName, rawInput, meta, title);
  if (mcp) {
    const phrase = sentence(OTHER_VERBS, state, mcp.server, null, " 통합", ` · ${mcp.tool}`);
    return { ...base, icon: "mcp", phrase, label: phraseText(phrase), mcp: { ...mcp, output: mcpOutput(call, contentText) } };
  }

  const fallbackText = state === "failed" && contentText !== "" ? contentText : null;
  const subagent = isObject(claudeCode.subagent) ? claudeCode.subagent : null;
  if (subagent) {
    const type = nonEmpty(subagent.subagentType);
    const who = type ? `${type} 서브에이전트` : "서브에이전트";
    const what = nonEmpty(subagent.description) ?? title;
    const phrase = sentence(SUBAGENT_VERBS, state, who, null, "", what ? ` · ${what}` : "");
    return { ...base, icon: "subagent", phrase, label: phraseText(phrase), text: contentText || null };
  }
  if (toolName === "Skill" && nonEmpty(rawInput.skill)) {
    const phrase = sentence(SKILL_VERBS, state, nonEmpty(rawInput.skill), null);
    return { ...base, icon: "skill", phrase, label: phraseText(phrase), text: fallbackText };
  }

  const diffs = content.filter((item) => item.type === "diff" && typeof item.path === "string").map(diffPiece);
  const output = tool.output !== "" ? tool.output : contentText;
  const terminal = content.some((item) => item.type === "terminal");
  if (kind === "execute" || terminal || tool.output !== "") {
    const command = title ?? commandOf(rawInput.command);
    const phrase = sentence(EXECUTE_VERBS, state, command ?? "명령", null);
    return { ...base, icon: "execute", phrase, label: phraseText(phrase), shell: shellOf(call, meta, state, command, output) };
  }

  const files = [...new Set([...locationsOf(call), ...diffs.map((piece) => piece.path)])];
  const onlyFile = files.length === 1 ? files[0] : null;
  const fileSubject = onlyFile ? baseName(onlyFile) : files.length > 1 ? `파일 ${files.length}개` : null;
  const fileText = (fallback: string): string => fileSubject ?? title ?? fallback;
  const withFile = (verbs: Verbs, subject: string, icon: ToolIcon, extra: Partial<ToolView> = {}): ToolView => {
    const phrase = sentence(verbs, state, subject, fileSubject === subject ? onlyFile : null);
    return { ...base, icon, phrase, label: phraseText(phrase), text: fallbackText, ...extra };
  };
  switch (kind) {
    case "read":
      return withFile(READ_VERBS, fileText("파일"), "read");
    case "edit":
    case "delete": {
      const removed = kind === "delete";
      const written = !removed && diffs.length > 0 && diffs.every((piece) => piece.written);
      const verbs = removed ? DELETE_VERBS : written ? WRITE_VERBS : EDIT_VERBS;
      return withFile(verbs, fileText("파일"), "edit", { diffs, removed, text: diffs.length > 0 ? null : fallbackText });
    }
    case "move":
      return withFile(MOVE_VERBS, fileText("파일"), "edit");
    case "search":
      return withFile(SEARCH_VERBS, title ?? "", "search");
    case "fetch":
      return withFile(FETCH_VERBS, title ?? "", "fetch");
    case "think":
      return withFile(THINK_VERBS, title ?? "", "other");
    case "switch_mode":
      return withFile(MODE_VERBS, "", "other");
    default:
      return withFile(OTHER_VERBS, title ?? toolName ?? "도구", "other");
  }
}

/**
 * 문구의 동사 셋 — 진행형 · 완료형 · 실패. `{}`가 대상의 자리다. 완료형에서 동사가 앞에 서는 것(「편집함 overview.md」)은 캔버스
 * Tools 보드를 따른다.
 */
type Verbs = Record<ToolState, string>;
const EXECUTE_VERBS: Verbs = { running: "{} 실행 중", done: "{} 실행 완료", failed: "{} 실행하지 못함" };
const READ_VERBS: Verbs = { running: "{} 읽는 중", done: "{} 읽음", failed: "{} 읽지 못함" };
const EDIT_VERBS: Verbs = { running: "{} 수정 중", done: "편집함 {}", failed: "{} 수정하지 못함" };
const WRITE_VERBS: Verbs = { running: "{} 작성 중", done: "작성함 {}", failed: "{} 작성하지 못함" };
const DELETE_VERBS: Verbs = { running: "{} 삭제 중", done: "삭제됨 {}", failed: "{} 삭제하지 못함" };
const MOVE_VERBS: Verbs = { running: "{} 옮기는 중", done: "{} 옮김", failed: "{} 옮기지 못함" };
const SEARCH_VERBS: Verbs = { running: "{} 검색 중", done: "{} 검색함", failed: "{} 검색하지 못함" };
const FETCH_VERBS: Verbs = { running: "{} 가져오는 중", done: "{} 가져옴", failed: "{} 가져오지 못함" };
const THINK_VERBS: Verbs = { running: "{} 생각 중", done: "{} 생각함", failed: "{} 생각하지 못함" };
const MODE_VERBS: Verbs = { running: "{} 모드 바꾸는 중", done: "{} 모드 바꿈", failed: "{} 모드 바꾸지 못함" };
const SKILL_VERBS: Verbs = { running: "{} 스킬 읽는 중", done: "{} 스킬 읽음", failed: "{} 스킬 읽지 못함" };
/** 그 밖의 도구 — MCP 호출도 이 동사다(「atelier 통합 사용함 · atelier_list_works」). */
const OTHER_VERBS: Verbs = { running: "{} 사용 중", done: "{} 사용함", failed: "{} 사용하지 못함" };
const SUBAGENT_VERBS: Verbs = { running: "{}에게 맡기는 중", done: "{}에게 맡김", failed: "{}에게 맡기지 못함" };

/**
 * 동사 셋에 대상을 넣는다. 대상이 비었으면 그 자리와 붙은 빈칸을 지운다(「검색함」). `subjectTail` · `tail`은 대상 바로 뒤 ·
 * 문장 끝에 붙는 글이다(MCP의 「 통합」 · 「 · 도구」).
 */
function sentence(
  verbs: Verbs,
  state: ToolState,
  subject: string | null,
  file: string | null,
  subjectTail = "",
  tail = "",
): ToolPhrase {
  const [head, rest] = verbs[state].split("{}");
  if (!subject) return { before: (head + rest).trim() + tail, subject: null, after: "", file: null };
  return { before: head, subject, after: subjectTail + rest + tail, file };
}

/** 문구 한 줄. */
export const phraseText = (phrase: ToolPhrase): string => `${phrase.before}${phrase.subject ?? ""}${phrase.after}`;

/** MCP 호출의 서버 · 도구 — Claude `mcp__<서버>__<도구>`, codex-acp `rawInput{server, tool}`(머리말). */
function mcpOf(toolName: string | null, rawInput: Json, meta: Json, title: string | null): { server: string; tool: string } | null {
  const named = toolName?.match(/^mcp__(.+?)__(.+)$/);
  if (named) return { server: named[1], tool: named[2] };
  const server = nonEmpty(rawInput.server);
  const tool = nonEmpty(rawInput.tool);
  if (server && tool && (meta.is_mcp_tool_call === true || title?.startsWith("mcp.") === true)) return { server, tool };
  return null;
}

/**
 * MCP 호출의 원본 출력 — Claude는 결과 글이 글 내용으로 오고, codex-acp는 `rawOutput{result, error}`(MCP `CallToolResult`)로 온다.
 * JSON이면 들여 써서 보인다.
 */
function mcpOutput(call: Json, contentText: string): string {
  if (contentText !== "") return pretty(contentText);
  const raw = call.rawOutput;
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return pretty(raw);
  if (isObject(raw)) {
    const error = raw.error;
    if (error !== undefined && error !== null) return isObject(error) && typeof error.message === "string" ? error.message : pretty(error);
    const result = isObject(raw.result) ? raw.result : null;
    const blocks = result && Array.isArray(result.content) ? result.content.filter(isObject) : [];
    const texts = blocks.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : null));
    if (texts.length > 0 && texts.every((text) => text !== null)) return pretty(texts.join("\n"));
    if (result && result.structuredContent !== undefined) return pretty(result.structuredContent);
    if (result) return pretty(result);
  }
  return pretty(raw);
}

/** JSON 글이면 두 칸 들여 쓴 글로, 값이면 그 JSON으로, 아니면 그대로. */
function pretty(value: unknown): string {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
}

/** 명령 글 — codex는 배열(`["/bin/zsh", "-lc", "echo atelier"]`)로도 준다. 비었으면 null(실측 함정 49). */
function commandOf(command: unknown): string | null {
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    const shell = command.length === 3 && /^-l?c$/.test(command[1]) ? command[2] : command.join(" ");
    return nonEmpty(shell);
  }
  return nonEmpty(command);
}

/**
 * 명령 출력 상자의 값 — `$` 명령 · 출력 · 오른쪽 아래 상태. 상태는 끝난 뒤에만 선다: 종료 코드가 0이 아니면 「코드 종료 N」,
 * 끝났으면 「성공」, 실패했는데 코드를 모르면 「실패」다. 종료 코드는 codex의 `_meta.terminal_exit` · `rawOutput.exit_code`에서 온다.
 */
function shellOf(call: Json, meta: Json, state: ToolState, command: string | null, output: string): NonNullable<ToolView["shell"]> {
  const exit = isObject(meta.terminal_exit) ? meta.terminal_exit.exit_code : isObject(call.rawOutput) ? call.rawOutput.exit_code : null;
  const code = typeof exit === "number" ? exit : null;
  let status: string | null = null;
  if (state !== "running") {
    if (code !== null && code !== 0) status = `코드 종료 ${code}`;
    else status = state === "failed" ? "실패" : "성공";
  }
  return { command, output: output.replace(/\n+$/, ""), status, ok: status === "성공" };
}

/** 도구가 다루는 파일들 — ACP `locations[].path`. */
function locationsOf(call: Json): string[] {
  const locations = Array.isArray(call.locations) ? call.locations.filter(isObject) : [];
  return locations.map((location) => location.path).filter((path): path is string => typeof path === "string" && path !== "");
}

/** 경로의 마지막 이름 — 도구 줄에는 이름만, 전체 경로는 diff 머리에 선다(캔버스 Tools 보드). */
export const baseName = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/** diff 둘레 — 바뀐 줄 앞뒤로 남기는 바뀌지 않은 줄 수. 그보다 먼 줄은 건너뛴 자리 하나로 접는다. */
const CONTEXT = 3;
/** 줄 단위로 견주는 가운데 토막의 한도(옛 줄 수 × 새 줄 수) — 넘으면 통째로 지우고 더한 것으로 보인다. */
const LCS_LIMIT = 250_000;

function diffPiece(item: Json): DiffPiece {
  const path = item.path as string;
  const written = typeof item.oldText !== "string";
  const before = splitLines(typeof item.oldText === "string" ? item.oldText : "");
  const after = splitLines(typeof item.newText === "string" ? item.newText : "");
  const full = lineDiff(before, after);
  return {
    path,
    written,
    lines: folded(full),
    added: full.filter((line) => line.type === "add").length,
    deleted: full.filter((line) => line.type === "del").length,
  };
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Change = { type: "add" | "del" | "ctx"; text: string };

/** 줄 단위 diff — 같은 머리 · 꼬리를 떼고, 가운데를 가장 긴 공통 줄(LCS)로 견준다. */
function lineDiff(before: readonly string[], after: readonly string[]): Change[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;
  const oldMid = before.slice(head, before.length - tail);
  const newMid = after.slice(head, after.length - tail);
  const ctx = (text: string): Change => ({ type: "ctx", text });
  return [
    ...before.slice(0, head).map(ctx),
    ...middle(oldMid, newMid),
    ...before.slice(before.length - tail).map(ctx),
  ];
}

function middle(oldMid: readonly string[], newMid: readonly string[]): Change[] {
  const n = oldMid.length;
  const m = newMid.length;
  const del = (text: string): Change => ({ type: "del", text });
  const add = (text: string): Change => ({ type: "add", text });
  if (n === 0 || m === 0 || n * m > LCS_LIMIT) return [...oldMid.map(del), ...newMid.map(add)];
  // 뒤에서부터 채운 LCS 길이 표 — (i, j)에서 끝까지의 공통 줄 수.
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        oldMid[i] === newMid[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const out: Change[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldMid[i] === newMid[j]) {
      out.push({ type: "ctx", text: oldMid[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push(del(oldMid[i]));
      i += 1;
    } else {
      out.push(add(newMid[j]));
      j += 1;
    }
  }
  while (i < n) out.push(del(oldMid[i++]));
  while (j < m) out.push(add(newMid[j++]));
  return out;
}

/** 바뀐 줄에서 `CONTEXT`보다 먼 둘레를 건너뛴 자리로 접는다. */
function folded(changes: readonly Change[]): DiffLine[] {
  const near = changes.map(() => false);
  changes.forEach((change, at) => {
    if (change.type === "ctx") return;
    for (let k = Math.max(0, at - CONTEXT); k <= Math.min(changes.length - 1, at + CONTEXT); k += 1) near[k] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  changes.forEach((change, at) => {
    if (change.type === "ctx" && !near[at]) {
      skipped += 1;
      return;
    }
    if (skipped > 0) out.push({ type: "gap", count: skipped });
    skipped = 0;
    out.push(change);
  });
  if (skipped > 0) out.push({ type: "gap", count: skipped });
  return out;
}

/**
 * 도구가 다룬 경로 → 스펙 창이 여는 spec 폴더 기준 경로. spec 폴더 밖이면 null이다 — 스펙 창은 spec 폴더만 보인다. 코어는 spec
 * 폴더를 홈 축약 표기(`~/.atelier/…`)로 내려 주고, 엔진은 대개 절대 경로를 준다(기록의 고정값 사본은 홈 축약이다) — 둘 다 견준다.
 */
export function specPathOf(path: string, specDir: string, home: string | null): string | null {
  const roots = [specDir];
  if (home) roots.push(expandHome(specDir, home));
  for (const root of roots) {
    const prefix = `${root.replace(/\/+$/, "")}/`;
    if (path.startsWith(prefix) && path.length > prefix.length) return path.slice(prefix.length);
  }
  return null;
}

/** 도구 줄의 파일이 열릴 줄 — ACP `locations[].line`(1부터). 모르면 null이다. */
export function lineOf(tool: ToolEntry, path: string): number | null {
  const locations = Array.isArray(tool.call.locations) ? tool.call.locations.filter(isObject) : [];
  const line = locations.find((location) => location.path === path)?.line;
  return typeof line === "number" && line >= 1 ? line : null;
}
