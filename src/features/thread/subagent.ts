import type { ToolEntry } from "./fold";
import { isObject, text, type Json } from "./json";

// 서브에이전트의 안쪽 줄(01b-7 · 스토리 63 · 캔버스 Tools 보드 「서브에이전트」) — 변환기는 서브에이전트 안에서 일어난 일을 대화의 줄로 내지 않고
// 그 도구 줄의 update `_meta.claudeCode.event`에 Claude 원문으로 싣는다(`translator/stream.rs`의 `relay`). 여기는 그 원문의 도구 호출 · 결과를
// 변환기가 바깥 도구에 내는 ACP 몸과 같은 꼴로 옮기는 **순수 함수**다. 그래야 안쪽 줄도 도구 줄과 같은 길(`describeTool` · `ToolRows`)로 그린다.
//
// 표는 변환기의 것과 같은 말을 한다(`kind` · `file_of` · `diff`) — `fold.test.ts`가 엔진이 쓴 기록의 도구 줄마다 두 길의 화면 값을 견준다. 제목은
// 짓지 않는다 — 도구 줄의 문구는 입력 · 다루는 파일에서 나온다.
// 서브에이전트의 말(`text`)은 옮기지 않는다. 스토리가 보려는 것은 안쪽 도구이고, 돌려준 글은 바깥 줄이 든다.

/** 도구 이름 → ACP 도구 갈래(`translator/stream.rs`의 `kind`). 표에 없으면 `other`다. */
const KINDS: Record<string, string> = {
  Bash: "execute",
  Read: "read",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Glob: "search",
  Grep: "search",
  WebFetch: "fetch",
  WebSearch: "fetch",
  Agent: "think",
  Task: "think",
  EnterPlanMode: "switch_mode",
  ExitPlanMode: "switch_mode",
};

/** 파일을 다루는 도구 → 그 입력 칸(`translator/stream.rs`의 `file_of`). */
const FILE_FIELDS: Record<string, string | undefined> = {
  Read: "file_path",
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/**
 * 바깥 도구 줄의 update 하나 → 그 안쪽 줄의 ACP 몸들 — 안쪽 도구 호출은 `tool_call`, 결과는 `tool_call_update`와 같은 꼴이다. 안쪽 줄이 아니거나
 * 도구 일이 없는 줄(서브에이전트의 말 · `task_*`)이면 비어 있다. `known`은 이미 쥔 안쪽 도구 줄들이다.
 */
export function innerCalls(update: Json, known: readonly ToolEntry[]): Json[] {
  const meta = isObject(update._meta) ? update._meta : {};
  const claudeCode = isObject(meta.claudeCode) ? meta.claudeCode : {};
  const event = isObject(claudeCode.event) ? claudeCode.event : {};
  const message = isObject(event.message) ? event.message : {};
  const blocks = Array.isArray(message.content) ? message.content.filter(isObject) : [];
  if (event.type === "assistant") return blocks.filter((block) => block.type === "tool_use").map(toolCall);
  if (event.type === "user") return blocks.filter((block) => block.type === "tool_result").map((block) => toolResult(block, known));
  return [];
}

function toolCall(block: Json): Json {
  const name = text(block.name) ?? "";
  const input = isObject(block.input) ? block.input : {};
  const field = FILE_FIELDS[name];
  const path = field === undefined ? null : text(input[field]);
  const diffs = path === null ? [] : diffsOf(name, path, input);
  const subagent = name === "Agent" || name === "Task";
  return {
    toolCallId: block.id,
    kind: KINDS[name] ?? "other",
    status: "in_progress",
    rawInput: input,
    ...(diffs.length > 0 && { content: diffs }),
    ...(path !== null && { locations: [{ path }] }),
    _meta: {
      claudeCode: {
        toolName: name,
        ...(subagent && { subagent: { subagentType: input.subagent_type, description: input.description } }),
      },
    },
  };
}

/** 편집 도구의 diff 내용 — 입력에 든 조각 그대로다. `Write`는 옛 글을 모른다. */
function diffsOf(name: string, path: string, input: Json): Json[] {
  const piece = (oldText: unknown, newText: unknown): Json => ({ type: "diff", path, oldText, newText });
  if (name === "Edit") return [piece(input.old_string, input.new_string)];
  if (name === "Write") return [piece(null, input.content)];
  if (name !== "MultiEdit" || !Array.isArray(input.edits)) return [];
  return input.edits.filter(isObject).map((edit) => piece(edit.old_string, edit.new_string));
}

/** 결과를 덮어 합치므로, 성공한 편집은 결과 글을 싣지 않는다 — 실으면 diff가 「파일을 고쳤습니다」 글로 바뀐다. */
function toolResult(block: Json, known: readonly ToolEntry[]): Json {
  const failed = block.is_error === true;
  const body: Json = { toolCallId: block.tool_use_id, status: failed ? "failed" : "completed" };
  const called = known.find((tool) => tool.toolCallId === block.tool_use_id);
  const content = outputOf(block.content);
  if (content.length > 0 && (failed || !holdsDiff(called))) body.content = content;
  return body;
}

const holdsDiff = (tool: ToolEntry | undefined): boolean =>
  Array.isArray(tool?.call.content) && tool.call.content.some((item) => isObject(item) && item.type === "diff");

/** `tool_result`의 내용(글자 하나이거나 블록 배열) → ACP 글 내용들. 글이 아닌 블록은 싣지 않는다. */
function outputOf(content: unknown): Json[] {
  const piece = (value: unknown): Json => ({ type: "content", content: { type: "text", text: value } });
  if (typeof content === "string") return [piece(content)];
  if (!Array.isArray(content)) return [];
  return content.filter(isObject).flatMap((block) => (block.type === "text" ? [piece(block.text)] : []));
}
