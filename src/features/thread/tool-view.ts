import { spoken, type ToolEntry } from "./fold";
import { isObject, nonEmpty, type Json } from "./json";

// 도구 줄의 화면 값(v1 티켓 05 · 캔버스 WorkLog 보드) — 접은 도구 호출(`ToolEntry`)을 문구 · 안의 것(명령 출력 · diff · MCP 보낸 값과
// 받은 값)으로 옮기는 **순수 함수**다. 그리는 것은 `WorkLog.tsx`다.
//
// three-axes 도구 줄(`chat/tool-view.ts`)을 옮겨 왔다 — ACP 모양으로 가르는 규칙(MCP를 kind보다 먼저 · 서브에이전트 · 스킬 · 제목이 빈
// 줄)은 그대로다. 달라진 것은 보드의 말이다:
// - **문구는 「대상 + 동사」다** — 대상(파일 이름 · 명령 · MCP 도구)이 앞에 고정폭으로 서고 동사가 뒤에 선다(「refund.service.ts 읽음」 ·
//   「pnpm test refunds 실행함」). 하는 중에는 현재형(「읽는 중」 · 「고치는 중」 · 「실행 중」 · 「부르는 중」), 끝나면 과거형이다.
// - **아이콘이 없다.** 보드의 작업 로그는 글자만이다(캔버스 Screen-Thread 보드의 아이콘 줄과 갈린다 — WorkLog 보드가 그 부품의 정본이다).
// - **실패 · 중단 · 거절은 색이 아니라 문장이다** — 「실행하지 못함 · 코드 종료 1」(동사만 진하게), 「중단함 · 12초」, 「실행하지 않음 ·
//   내가 거절함」.
// - **명령 출력의 끝 줄은 종료 코드와 걸린 시간이다**(「코드 종료 0 · 4.2초」). Claude Code는 종료 코드를 주지 않아 그때는 「끝남」 ·
//   「실패」다.
// - **Agent 부르기 Thread 도구(`atelier-thread.call_agent`)는 「@reviewer에게 맡기는 중」이다**(v1 티켓 17) — 맡긴 일이 그 Agent에게
//   전해지면 호출 줄이 이 줄의 자리를 대신하고(`fold.ts`), 그 전(들이는 중 · Session을 여는 중)과 거절된 부르기만 이 줄로 선다.
//   거절 까닭은 MCP 상자의 받은 값이다.
// - **Work와 이어지는 Thread 도구 셋도 사람의 말이다**(v1 티켓 30) — 「Project 3개 목록 확인함」 · 「Work 읽음」 · 「Work 만들기를 묻는 중」.

/** 도구 줄의 때 — 도는 중 · 끝남 · 실패 · 끊김(끝을 받기 전에 그 Session이 사라졌다). */
export type ToolState = "running" | "done" | "failed" | "cut";

/**
 * 도구 줄의 문구 — 「앞 글 · 대상 · 동사 · 꼬리」. 대상은 고정폭이면(`mono`) 파일 · 명령 · MCP 도구이고, 아니면 사람의 말(웹 검색어 ·
 * Agent 이름)이다. 실패한 줄은 동사가 진하다(`failed`).
 */
export interface ToolPhrase {
  before: string;
  subject: string | null;
  mono: boolean;
  verb: string;
  tail: string;
  failed: boolean;
}

/** diff 한 줄 — 더함 · 지움 · 둘레(바뀌지 않은 줄), 그리고 둘레를 줄여 건너뛴 자리. */
export type DiffLine = { type: "add" | "del" | "ctx"; text: string } | { type: "gap"; count: number };

/** 편집 도구의 diff 내용 하나(ACP `{type: "diff", path, oldText, newText}`) — 줄 단위로 견준 값. */
export interface DiffPiece {
  path: string;
  /** 옛 글을 모른다 — 새로 쓴 파일이거나 옛 글을 싣지 않은 편집이다(Claude Write). */
  written: boolean;
  lines: DiffLine[];
  added: number;
  deleted: number;
}

export interface ToolView {
  state: ToolState;
  /** 물은 권한이 답을 기다리나 — 문구가 「승인을 기다리는 중」이고 반짝이지 않는다(v1 티켓 24 · 캔버스 Approval 보드). */
  waiting: boolean;
  /** 묶음 줄에 드는 갈래 — 읽기 · 찾기만 이어지면 묶인다(`log.ts`). */
  group: "read" | "search" | null;
  phrase: ToolPhrase;
  /** 명령 출력 상자 — 명령이 아니면 null. `status`는 끝 줄(「코드 종료 0 · 4.2초」)이고 도는 동안은 null이다. */
  shell: { command: string | null; output: string; status: string | null; bad: boolean } | null;
  /** 편집 도구의 diff들. */
  diffs: DiffPiece[];
  /**
   * MCP 호출 — 이름(`서버.도구`) · 보낸 값 · 받은 값. 받은 값이 JSON이면 고정폭으로 선다(`receivedCode`) — 글이면 본문 글꼴이다(보드
   * 「MCP 호출」). MCP가 아니면 null.
   */
  mcp: { name: string; sent: string; received: string; receivedCode: boolean } | null;
  /** 그 밖의 글 출력 — 실패한 도구의 오류 글 · 서브에이전트가 돌려준 글. 펼쳐야 보인다. */
  text: string | null;
}

/** 도구 호출 원문에서 갈래를 가르는 칸들 — 도구 줄과 승인 카드가 같은 칸을 같은 규칙으로 읽는다. */
export interface ToolFields {
  meta: Json;
  claudeCode: Json;
  toolName: string | null;
  rawInput: Json;
  title: string | null;
  kind: string;
}

export function toolFields(call: Json): ToolFields {
  const meta = isObject(call._meta) ? call._meta : {};
  const claudeCode = isObject(meta.claudeCode) ? meta.claudeCode : {};
  return {
    meta,
    claudeCode,
    toolName: nonEmpty(claudeCode.toolName),
    rawInput: isObject(call.rawInput) ? call.rawInput : {},
    title: nonEmpty(call.title),
    kind: typeof call.kind === "string" ? call.kind : "other",
  };
}

/** 동사 셋 — 하는 중 · 끝남 · 실패. 거절된 줄은 「~하지 않음」이다(`refused`). */
interface Verbs {
  running: string;
  done: string;
  failed: string;
  refused: string;
}
const EXECUTE: Verbs = { running: "실행 중", done: "실행함", failed: "실행하지 못함", refused: "실행하지 않음" };
const READ: Verbs = { running: "읽는 중", done: "읽음", failed: "읽지 못함", refused: "읽지 않음" };
const EDIT: Verbs = { running: "고치는 중", done: "수정함", failed: "수정하지 못함", refused: "수정하지 않음" };
const WRITE: Verbs = { running: "쓰는 중", done: "작성함", failed: "작성하지 못함", refused: "작성하지 않음" };
const DELETE: Verbs = { running: "지우는 중", done: "지움", failed: "지우지 못함", refused: "지우지 않음" };
const MOVE: Verbs = { running: "옮기는 중", done: "옮김", failed: "옮기지 못함", refused: "옮기지 않음" };
const SEARCH: Verbs = { running: "찾는 중", done: "찾음", failed: "찾지 못함", refused: "찾지 않음" };
const WEB: Verbs = { running: "찾는 중", done: "찾아봄", failed: "찾아보지 못함", refused: "찾아보지 않음" };
const FETCH: Verbs = { running: "가져오는 중", done: "가져옴", failed: "가져오지 못함", refused: "가져오지 않음" };
const MCP: Verbs = { running: "부르는 중", done: "불러옴", failed: "부르지 못함", refused: "부르지 않음" };
const SKILL: Verbs = { running: "스킬 읽는 중", done: "스킬 읽음", failed: "스킬 읽지 못함", refused: "스킬 읽지 않음" };
const SUBAGENT: Verbs = { running: "에게 맡기는 중", done: "에게 맡김", failed: "에게 맡기지 못함", refused: "에게 맡기지 않음" };
const THINK: Verbs = { running: "생각하는 중", done: "생각함", failed: "생각하지 못함", refused: "생각하지 않음" };
const MODE: Verbs = { running: "모드 바꾸는 중", done: "모드 바꿈", failed: "모드 바꾸지 못함", refused: "모드 바꾸지 않음" };
const OTHER: Verbs = { running: "쓰는 중", done: "씀", failed: "쓰지 못함", refused: "쓰지 않음" };

/** Agent 부르기 Thread 도구(v1 티켓 16)의 `서버.도구` 이름. */
const CALL_AGENT = "atelier-thread.call_agent";

/** Work와 이어지는 Thread 도구 셋(v1 티켓 30)의 `서버.도구` 이름 — 사람의 말로 선다(캔버스 화면 2 「Project 3개 목록 확인함」). */
const LIST_PROJECTS = "atelier-thread.list_projects";
const GET_WORK = "atelier-thread.get_work";
const PROPOSE_WORK = "atelier-thread.propose_work";
const CHECK: Verbs = { running: "확인하는 중", done: "확인함", failed: "확인하지 못함", refused: "확인하지 않음" };
const ASK: Verbs = { running: "묻는 중", done: "물음", failed: "묻지 못함", refused: "묻지 않음" };

export function describeTool(tool: ToolEntry): ToolView {
  const call = tool.call;
  const state: ToolState =
    call.status === "completed" ? "done" : call.status === "failed" ? "failed" : tool.cut ? "cut" : "running";
  const fields = toolFields(call);
  const { meta, claudeCode, toolName, rawInput, title, kind } = fields;
  const content = Array.isArray(call.content) ? call.content.filter(isObject) : [];
  const contentText = content
    .map((item) => (item.type === "content" && isObject(item.content) && item.content.type === "text" ? item.content.text : null))
    .filter((one): one is string => typeof one === "string")
    .join("\n");
  const took = elapsed(tool);
  const exitCode = exitOf(call, meta);
  // 줄의 끝 — 멈춤 · 거절 · 실패의 꼬리와 동사를 여기서 정한다(머리말).
  const say = (verbs: Verbs, subject: string | null, mono: boolean, before = ""): ToolPhrase => {
    const phrase = (verb: string, tail = "", failed = false): ToolPhrase => ({ before, subject, mono, verb, tail, failed });
    if (tool.denied) return phrase(verbs.refused, " · 내가 거절함");
    if (tool.asking) return phrase("승인을 기다리는 중");
    if (tool.stop === "stopped") return phrase("중단함", took ? ` · ${took}` : "");
    if (state === "running") return phrase(verbs.running);
    if (state === "done") return phrase(verbs.done);
    return phrase(verbs.failed, exitCode !== null && exitCode !== 0 ? ` · 코드 종료 ${exitCode}` : "", true);
  };
  const base = { state, waiting: tool.asking, group: null, diffs: [] as DiffPiece[], shell: null, mcp: null, text: null };

  const mcp = mcpOf(fields);
  if (mcp) {
    const name = `${mcp.server}.${mcp.tool}`;
    const sent = Object.keys(rawInput).length > 0 ? pretty(rawInput) : "";
    const received = mcpOutput(call, contentText);
    const box = { name, sent, received, receivedCode: /^[[{]/.test(received.trim()) };
    if (name === CALL_AGENT) {
      const handle = nonEmpty(rawInput.handle)?.replace(/^@/, "");
      return { ...base, phrase: say(SUBAGENT, handle ? `@${handle}` : "Agent", false), mcp: box };
    }
    if (name === LIST_PROJECTS) {
      const count = state === "done" ? listedCount(received) : null;
      return { ...base, phrase: say(CHECK, count === null ? "Project 목록" : `Project ${count}개 목록`, false), mcp: box };
    }
    if (name === GET_WORK) return { ...base, phrase: say(READ, "Work", false), mcp: box };
    // 카드가 선 동안 서는 줄이다 — 사람이 고르면 결정 줄이 이 줄의 자리를 대신한다(`fold.ts`). 거절된 제안만 이 줄로 남는다.
    if (name === PROPOSE_WORK) return { ...base, phrase: say(ASK, "Work 만들기를", false), mcp: box };
    return { ...base, phrase: say(MCP, name, true), mcp: box };
  }

  const fallbackText = state === "failed" && contentText !== "" ? contentText : null;
  const subagent = isObject(claudeCode.subagent) ? claudeCode.subagent : null;
  if (subagent) {
    const type = nonEmpty(subagent.subagentType);
    return { ...base, phrase: say(SUBAGENT, type ?? "Agent", false), text: contentText || null };
  }
  if (toolName === "Skill" && nonEmpty(rawInput.skill)) {
    return { ...base, phrase: say(SKILL, nonEmpty(rawInput.skill), true), text: fallbackText };
  }
  if (toolName === "WebSearch") {
    const query = nonEmpty(rawInput.query) ?? title;
    if (state === "running" && !tool.denied && tool.stop === null) {
      return { ...base, phrase: say(WEB, null, false, "웹에서 "), text: fallbackText };
    }
    return { ...base, phrase: say(WEB, query, false, "웹에서 "), text: fallbackText };
  }

  const diffs = diffsOf(call);
  const output = tool.output !== "" ? tool.output : contentText;
  const terminal = content.some((item) => item.type === "terminal");
  if (kind === "execute" || terminal || tool.output !== "") {
    const command = title ?? commandOf(rawInput.command);
    return {
      ...base,
      phrase: say(EXECUTE, command ?? "명령", true),
      shell: shellOf(state, command, output, exitCode, took),
    };
  }

  const files = [...new Set([...locationsOf(call), ...diffs.map((piece) => piece.path)])];
  const onlyFile = files.length === 1 ? files[0] : null;
  const fileSubject = onlyFile ? baseName(onlyFile) : files.length > 1 ? `파일 ${files.length}개` : null;
  switch (kind) {
    case "read":
      return { ...base, group: "read", phrase: say(READ, fileSubject ?? title ?? "파일", fileSubject !== null), text: fallbackText };
    case "edit":
    case "delete": {
      const removed = kind === "delete";
      const written = !removed && diffs.length > 0 && diffs.every((piece) => piece.written);
      const verbs = removed ? DELETE : written ? WRITE : EDIT;
      return {
        ...base,
        phrase: say(verbs, fileSubject ?? title ?? "파일", fileSubject !== null),
        diffs,
        text: diffs.length > 0 ? null : fallbackText,
      };
    }
    case "move":
      return { ...base, phrase: say(MOVE, fileSubject ?? title ?? "파일", fileSubject !== null), text: fallbackText };
    case "search":
      // 변환기의 제목은 「Search <무늬>」 · 「Find <무늬>」다(`translator/stream.rs`) — 보드는 무늬만 든다(「RefundService 찾음」).
      return { ...base, group: "search", phrase: say(SEARCH, nonEmpty(rawInput.pattern) ?? title, true), text: fallbackText };
    case "fetch":
      return { ...base, phrase: say(FETCH, nonEmpty(rawInput.url) ?? title, true), text: fallbackText };
    case "think":
      return { ...base, phrase: say(THINK, title, false), text: fallbackText };
    case "switch_mode":
      return { ...base, phrase: say(MODE, null, false), text: fallbackText };
    default:
      return { ...base, phrase: say(OTHER, title ?? toolName ?? "도구", true), text: fallbackText };
  }
}

/**
 * 도구 줄이 걸린 시간 — 시작한 줄과 끝난 줄의 시각 사이다(마우스를 올린 줄의 오른쪽 · 명령 출력의 끝 줄 · 「중단함 · 12초」). 10초
 * 아래는 소수 한 자리(「4.2초」), 그 위는 말로(「1분 12초」)다. 끝나지 않았으면 null이다.
 */
export function elapsed(tool: ToolEntry): string | null {
  if (tool.endedAt === null) return null;
  const ms = Math.max(0, Date.parse(tool.endedAt) - Date.parse(tool.startedAt));
  if (Number.isNaN(ms)) return null;
  return ms < 10_000 ? `${(Math.round(ms / 100) / 10).toFixed(1)}초` : spoken(ms);
}

/** 문구 한 줄 — 도구 줄의 이름이고 보조 기술이 읽는 글이다. `에게`로 시작하는 동사는 대상에 붙는다(「리뷰어에게 맡김」). */
export function phraseText(phrase: ToolPhrase): string {
  const gap = phrase.subject !== null && !phrase.verb.startsWith("에게") ? " " : "";
  return `${phrase.before}${phrase.subject ?? ""}${gap}${phrase.verb}${phrase.tail}`;
}

/** 받은 값이 JSON 목록이면 그 수 — 「Project 3개 목록 확인함」. 목록이 아니면(등록된 Project가 없다는 글) null이다. */
function listedCount(received: string): number | null {
  try {
    const parsed: unknown = JSON.parse(received);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/** MCP 호출의 서버 · 도구 — Claude `mcp__<서버>__<도구>`, codex-acp `rawInput{server, tool}`. MCP가 아니면 null. */
export function mcpOf({ toolName, rawInput, meta, title }: ToolFields): { server: string; tool: string } | null {
  const named = toolName?.match(/^mcp__(.+?)__(.+)$/);
  if (named) return { server: named[1], tool: named[2] };
  const server = nonEmpty(rawInput.server);
  const tool = nonEmpty(rawInput.tool);
  if (server && tool && (meta.is_mcp_tool_call === true || title?.startsWith("mcp.") === true)) return { server, tool };
  return null;
}

/** MCP 호출의 받은 값 — 글 내용, 또는 `rawOutput`(MCP `CallToolResult`). JSON이면 들여 써서 보인다. */
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
    if (texts.length > 0 && texts.every((one) => one !== null)) return pretty(texts.join("\n"));
    if (result && result.structuredContent !== undefined) return pretty(result.structuredContent);
    if (result) return pretty(result);
  }
  return pretty(raw);
}

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

/** 명령 글 — codex는 배열(`["/bin/zsh", "-lc", "echo atelier"]`)로도 준다. 비었으면 null. 승인 카드도 쓴다. */
export function commandOf(command: unknown): string | null {
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    const shell = command.length === 3 && /^-l?c$/.test(command[1]) ? command[2] : command.join(" ");
    return nonEmpty(shell);
  }
  return nonEmpty(command);
}

/** 종료 코드 — codex의 `_meta.terminal_exit` · `rawOutput.exit_code`. 모르면 null(Claude Code는 싣지 않는다). */
function exitOf(call: Json, meta: Json): number | null {
  const exit = isObject(meta.terminal_exit) ? meta.terminal_exit.exit_code : isObject(call.rawOutput) ? call.rawOutput.exit_code : null;
  return typeof exit === "number" ? exit : null;
}

/** 명령 출력 상자의 값 — 끝 줄은 끝난 뒤에만 선다(머리말). 0이 아닌 종료 코드와 실패는 진하다(`bad`). */
function shellOf(
  state: ToolState,
  command: string | null,
  output: string,
  code: number | null,
  took: string | null,
): NonNullable<ToolView["shell"]> {
  let head: string | null = null;
  if (state === "cut") head = "끊김";
  else if (state !== "running") head = code !== null ? `코드 종료 ${code}` : state === "failed" ? "실패" : "끝남";
  const status = head === null ? null : took && state !== "cut" ? `${head} · ${took}` : head;
  const bad = state === "failed" || state === "cut" || (code !== null && code !== 0);
  return { command, output: output.replace(/\n+$/, ""), status, bad };
}

/** 도구가 다루는 파일들 — ACP `locations[].path`. 승인 카드도 쓴다. */
export function locationsOf(call: Json): string[] {
  const locations = Array.isArray(call.locations) ? call.locations.filter(isObject) : [];
  return locations.map((location) => location.path).filter((path): path is string => typeof path === "string" && path !== "");
}

/** 편집 도구의 diff 내용이 가리키는 파일들 — 내용 차례대로. 승인 카드가 쓴다. */
export function diffPathsOf(call: Json): string[] {
  const content = Array.isArray(call.content) ? call.content.filter(isObject) : [];
  return content
    .filter((item) => item.type === "diff")
    .map((item) => nonEmpty(item.path))
    .filter((path): path is string => path !== null);
}

/** 편집 도구의 diff 내용들(ACP `{type: "diff", path, oldText, newText}`)을 줄 단위로 견준 값 — 변경 상자와 승인 카드의 파일 카드가 쓴다. */
export function diffsOf(call: Json): DiffPiece[] {
  const content = Array.isArray(call.content) ? call.content.filter(isObject) : [];
  return content.filter((item) => item.type === "diff" && typeof item.path === "string").map(diffPiece);
}

/** 경로의 마지막 이름 — 도구 줄에는 이름만, 전체 경로는 diff 머리에 선다. */
export const baseName = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/**
 * 변경 상자 머리의 경로(WorkLog 보드 「src/refunds/refund.service.ts」) — 그 Session의 작업 폴더 안이면 그 폴더에서 본 자리, 밖이면
 * 받은 그대로다. Work의 Thread에서는 worktree가 작업 폴더라 저장소에서 본 자리가 된다.
 */
export function shownPath(path: string, cwd: string | null): string {
  if (!cwd) return path;
  const root = `${cwd.replace(/\/+$/, "")}/`;
  return path.startsWith(root) && path.length > root.length ? path.slice(root.length) : path;
}

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

function splitLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
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
  const ctx = (line: string): Change => ({ type: "ctx", text: line });
  return [...before.slice(0, head).map(ctx), ...middle(oldMid, newMid), ...before.slice(before.length - tail).map(ctx)];
}

function middle(oldMid: readonly string[], newMid: readonly string[]): Change[] {
  const n = oldMid.length;
  const m = newMid.length;
  const del = (line: string): Change => ({ type: "del", text: line });
  const add = (line: string): Change => ({ type: "add", text: line });
  if (n === 0 || m === 0 || n * m > LCS_LIMIT) return [...oldMid.map(del), ...newMid.map(add)];
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
