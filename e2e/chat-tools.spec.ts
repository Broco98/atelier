import { expect, test, type Page } from "./evidence";

import type { Conversation, RecordLine } from "@/features/chat/types";
import type { WorkView } from "@/features/works/types";
import { answerByArg, WORKS } from "./fixtures";
import { unknownIpcCalls } from "./harness";
import { cartWork, conversationRow, handToolTurn, linesAfter, linesThrough, record, specCopy, streamLines } from "./chat-records";
import { openWorkChat, 작업패널 } from "./chat-screen";

// three-axes 티켓 18 — **도구 줄이 진행형에서 완료형으로 바뀌고, 출력 · diff · MCP를 보인다**(스토리 39 · 40 · 41 · 42 · 77).
//
// 자료는 L1이 남긴 기록이다(S26): 「Claude 두 턴」(티켓 14 — 둘째 턴이 Write · Read · Bash를 부른다)과 「Codex 한 턴」(티켓 04 —
// `echo atelier`의 출력이 `terminal_output_delta`로 온다), 그리고 「고친 곳」(티켓 06 — spec 파일을 고친 Codex 편집 diff). 실패 ·
// MCP · 빈 제목은 그 기록에 없어 변환기와 codex-acp 2.2.2가 내는 모양대로 손으로 짓는다(`chat-records.ts`). 재는 것은 역할 · 접근성
// 이름 · 보이는 글이다 — 도구 줄은 그 문구를 이름으로 단 묶음이다.

const plainWork = WORKS[1];

/** 도구 줄 — 진행형 · 완료형 문구를 이름으로 단 묶음이다. */
const 도구줄 = (page: Page, phrase: string) => 작업패널(page).getByRole("group", { name: phrase, exact: true });
const 머리줄 = (page: Page, name: string) => 작업패널(page).getByRole("button", { name, exact: true });

/** 그 work의 대화창을 연다 — 대화 목록은 `row` 하나, 기록 읽기는 `read`다. `spec`이 있으면 그 사본을 스펙 창의 파일로 쓴다. */
function openChat(
  page: Page,
  row: Conversation,
  read: readonly RecordLine[],
  work: WorkView = plainWork,
  spec?: { bodies: Record<string, string>; file: string },
): Promise<void> {
  return openWorkChat(page, [row], { [row.id]: read }, {
    work,
    answers: { list_works: [work], ...(spec ? { read_spec_file: answerByArg("path", spec.bodies) } : {}) },
    file: spec?.file,
  });
}

/** 기록에서 `after` 뒤부터 `through`까지의 줄. */
const between = (lines: readonly RecordLine[], after: number, through: number) =>
  lines.filter((line) => line.seq > after && line.seq <= through);

// 「Claude 두 턴」의 둘째 턴 — 보낸 말(10) · 생각 · Write(12 → 13) · 생각 · Read(15 → 16) · 생각 · Bash(18 → 19) · 생각 · 답 「4」 ·
// 사용량 · 턴 끝(13초). 기록이 바뀌면 seq가 아니라 도구 호출 id로 다시 찾도록, 줄을 그 모양으로 집는다.
const twoTurns = record("claude-two-turns");
const SECOND_SENT = twoTurns.filter((line) => line.kind === "sent")[1].seq;
/** 그 도구의 `tool_call` · `tool_call_update` 줄의 seq — 둘째 턴의 n번째 도구. */
function toolSeqs(lines: readonly RecordLine[], n: number): { call: number; update: number } {
  const updateOf = (line: RecordLine) => (line.payload as { update?: Record<string, unknown> }).update;
  const calls = lines.filter((line) => line.kind === "update" && updateOf(line)?.sessionUpdate === "tool_call");
  const call = calls[n];
  const id = updateOf(call)!.toolCallId;
  const update = lines.find((line) => updateOf(line)?.sessionUpdate === "tool_call_update" && updateOf(line)?.toolCallId === id)!;
  return { call: call.seq, update: update.seq };
}
const WRITE = toolSeqs(twoTurns, 0);
const READ = toolSeqs(twoTurns, 1);
const BASH = toolSeqs(twoTurns, 2);
const WC = "wc -c /tmp/gate/ws/g3/wt/notes.txt";
const claude = conversationRow({ id: "c-tools-claude", agent: "claude", name: "Claude", lastSeq: SECOND_SENT + 1 });

test("진행형 → 완료형: `tool_call`이 오면 도구 줄이 진행형 문구로 서고, `tool_call_update`가 끝을 알리면 완료형 문구로 바뀐다", async ({
  page,
}) => {
  await openChat(page, claude, linesThrough(twoTurns, SECOND_SENT + 1));

  // Write — 옛 글을 모르는 편집(diff `oldText: null`)이라 「작성」이다.
  await streamLines(page, plainWork.slug, claude.id, between(twoTurns, SECOND_SENT + 1, WRITE.call));
  await expect(도구줄(page, "notes.txt 작성 중")).toBeVisible();
  await streamLines(page, plainWork.slug, claude.id, between(twoTurns, WRITE.call, WRITE.update));
  await expect(도구줄(page, "작성함 notes.txt")).toBeVisible();
  await expect(도구줄(page, "notes.txt 작성 중")).toHaveCount(0);

  // Read.
  await streamLines(page, plainWork.slug, claude.id, between(twoTurns, WRITE.update, READ.call));
  await expect(도구줄(page, "notes.txt 읽는 중")).toBeVisible();
  await streamLines(page, plainWork.slug, claude.id, between(twoTurns, READ.call, READ.update));
  await expect(도구줄(page, "notes.txt 읽음")).toBeVisible();
  await expect(도구줄(page, "notes.txt 읽는 중")).toHaveCount(0);

  // Bash — 명령은 명령 글 그대로가 제목이다.
  await streamLines(page, plainWork.slug, claude.id, between(twoTurns, READ.update, BASH.call));
  await expect(도구줄(page, `${WC} 실행 중`)).toBeVisible();
  await streamLines(page, plainWork.slug, claude.id, between(twoTurns, BASH.call, BASH.update));
  await expect(도구줄(page, `${WC} 실행 완료`)).toBeVisible();
  await expect(도구줄(page, `${WC} 실행 중`)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 그 줄 안의 명령 출력 상자. */
const 명령출력 = (row: ReturnType<typeof 도구줄>) => row.getByRole("figure", { name: "명령 출력", exact: true });

test("실패: 실패한 호출은 「~하지 못함」 문구로 서고, 펼친 출력 상자의 상태 글이 실패를 말한다 — 종료 코드를 알면 그 코드다", async ({
  page,
}) => {
  const empty = conversationRow({ id: "c-tools-fail", agent: "claude", name: "Claude", lastSeq: 0 });
  await openChat(page, empty, []);
  const turn = handToolTurn(
    1,
    "타입 검사를 돌려 줘",
    [
      // Claude — `is_error` `tool_result`를 변환기가 `failed` update로 옮긴다. 출력은 글 내용으로 온다.
      {
        sessionUpdate: "tool_call",
        toolCallId: "toolu_hand_fail",
        title: "pnpm typecheck",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "pnpm typecheck", description: "Type-check" },
        _meta: { claudeCode: { toolName: "Bash" } },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_hand_fail",
        status: "failed",
        content: [{ type: "content", content: { type: "text", text: "Exit code 2\nsrc/x.tsx(41,7): error TS2322" } }],
      },
      // Codex — 종료 코드가 `_meta.terminal_exit`로 온다(codex-acp 2.2.2).
      {
        sessionUpdate: "tool_call",
        toolCallId: "exec-hand-fail",
        name: "exec_command",
        kind: "execute",
        title: "cargo test",
        status: "in_progress",
        content: [{ type: "terminal", terminalId: "exec-hand-fail" }],
        rawInput: { command: "cargo test", cwd: "/tmp/fake-worktree" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "exec-hand-fail",
        status: "failed",
        _meta: {
          terminal_output_delta: { data: "test result: FAILED. 3 passed; 1 failed\n", terminal_id: "exec-hand-fail" },
          terminal_exit: { exit_code: 101, signal: null, terminal_id: "exec-hand-fail" },
        },
      },
    ],
    "타입 검사가 실패했어요.",
    4000,
  );
  // 턴이 도는 동안 — 끝나면 줄들이 머리줄 아래로 접힌다.
  await streamLines(page, plainWork.slug, empty.id, turn.slice(0, -2));

  const claudeRow = 도구줄(page, "pnpm typecheck 실행하지 못함");
  await expect(claudeRow).toBeVisible();
  await expect(명령출력(claudeRow)).toContainText("error TS2322");
  await expect(명령출력(claudeRow).getByText("실패", { exact: true })).toBeVisible();

  const codexRow = 도구줄(page, "cargo test 실행하지 못함");
  await expect(codexRow).toBeVisible();
  await expect(명령출력(codexRow)).toContainText("test result: FAILED");
  await expect(명령출력(codexRow).getByText("코드 종료 101", { exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L1이 남긴 「Codex 한 턴」 — `echo atelier`의 출력이 `tool_call_update`의 `_meta.terminal_output_delta`로 온다(실측 함정 49).
const codexOneTurn = record("codex-one-turn");
const CODEX_TOOL = toolSeqs(codexOneTurn, 0);
const codex = conversationRow({ id: "c-tools-codex", agent: "codex", name: "Codex", lastSeq: CODEX_TOOL.update });

test("출력(Codex): 명령의 출력 조각이 그 줄 안의 출력 상자에 붙고, 끝나면 「성공」이며, 줄을 누르면 출력이 접히고 펴진다", async ({
  page,
}) => {
  // Codex — 출력 조각이 줄 안의 출력 상자에 붙고, 끝나면 「성공」이다. 턴은 아직 돈다(접히지 않는다).
  await openChat(page, codex, linesThrough(codexOneTurn, CODEX_TOOL.update));
  const echo = 도구줄(page, "echo atelier 실행 완료");
  await expect(echo).toBeVisible();
  await expect(echo.getByRole("button", { name: /echo atelier 실행 완료/ })).toHaveAttribute("aria-expanded", "true");
  await expect(명령출력(echo)).toContainText("$ echo atelier");
  await expect(명령출력(echo).getByText("atelier", { exact: true })).toBeVisible();
  await expect(명령출력(echo).getByText("성공", { exact: true })).toBeVisible();
  // 줄을 누르면 출력이 접히고, 다시 누르면 펴진다.
  await echo.getByRole("button", { name: /echo atelier 실행 완료/ }).click();
  await expect(명령출력(echo)).toHaveCount(0);
  await echo.getByRole("button", { name: /echo atelier 실행 완료/ }).click();
  await expect(명령출력(echo)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("출력 · diff(Claude): Bash의 출력은 결과 글로, Write의 diff는 입력 조각으로 지은 더한 줄로 보인다", async ({ page }) => {
  await openChat(page, claude, linesThrough(twoTurns, SECOND_SENT + 1));
  await streamLines(page, plainWork.slug, claude.id, between(twoTurns, SECOND_SENT + 1, BASH.update));

  // Write — 옛 글을 모르니 지운 줄은 없고, 새 글 「gate」가 더한 줄이다.
  const write = 도구줄(page, "작성함 notes.txt");
  const diff = write.getByRole("figure", { name: "notes.txt diff", exact: true });
  await expect(diff).toBeVisible();
  await expect(diff.getByRole("insertion")).toHaveText(["gate"]);
  await expect(diff.getByRole("deletion")).toHaveCount(0);
  await expect(write).toContainText("+1 -0");

  // Bash — 출력이 결과 글로 왔다.
  const wc = 도구줄(page, `${WC} 실행 완료`);
  await expect(명령출력(wc)).toContainText(`$ ${WC}`);
  await expect(명령출력(wc)).toContainText("4 /tmp/gate/ws/g3/wt/notes.txt");
  await expect(명령출력(wc).getByText("성공", { exact: true })).toBeVisible();
  // Read는 안의 것이 없다 — 펼칠 것이 없는 줄이다. 파일이 spec 폴더 밖(워크트리)이라 스펙 창이 열 수 없어 링크도 아니다.
  await expect(도구줄(page, "notes.txt 읽음").getByRole("button")).toHaveCount(0);
  await expect(도구줄(page, "notes.txt 읽음").getByRole("figure")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("MCP: MCP 도구 호출이 「서버 통합 · 도구」 문구로 구별되고(두 엔진의 모양 모두), 펼치면 원본 출력이 보이며, 명령 출력 상자로 빠지지 않는다", async ({
  page,
}) => {
  const empty = conversationRow({ id: "c-tools-mcp", agent: "claude", name: "Claude", lastSeq: 0 });
  await openChat(page, empty, []);
  const claudeCall = {
    sessionUpdate: "tool_call",
    toolCallId: "toolu_hand_mcp",
    title: "mcp__atelier__atelier_list_works",
    kind: "other",
    status: "in_progress",
    rawInput: {},
    _meta: { claudeCode: { toolName: "mcp__atelier__atelier_list_works" } },
  };
  // Claude — 변환기는 MCP 도구의 제목을 도구 이름 그대로 두고 `_meta.claudeCode.toolName`에 싣는다(티켓 14).
  await streamLines(page, plainWork.slug, empty.id, handToolTurn(1, "work 목록을 봐 줘", [claudeCall], "", 1000).slice(0, 2));
  await expect(도구줄(page, "atelier 통합 사용 중 · atelier_list_works")).toBeVisible();
  const rest = handToolTurn(
    1,
    "work 목록을 봐 줘",
    [
      claudeCall,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_hand_mcp",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: '{"works":[{"slug":"three-axes","status":"active"}]}' } }],
      },
      // Codex — codex-acp 2.2.2는 MCP 호출을 kind `execute` · 제목 `mcp.<서버>.<도구>` · `rawInput{server, tool, arguments}` ·
      // `_meta.is_mcp_tool_call`로 내고, 끝은 `rawOutput{result, error}`다(`McpToolReporter`).
      {
        sessionUpdate: "tool_call",
        toolCallId: "call_hand_mcp",
        kind: "execute",
        title: "mcp.atelier.atelier_get_work",
        status: "in_progress",
        rawInput: { server: "atelier", tool: "atelier_get_work", arguments: { slug: "nope" } },
        _meta: { is_mcp_tool_call: true },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_hand_mcp",
        status: "failed",
        rawInput: { server: "atelier", tool: "atelier_get_work", arguments: { slug: "nope" } },
        rawOutput: { result: null, error: { message: "work를 찾지 못했습니다: nope" } },
      },
    ],
    "목록을 가져왔어요.",
    3000,
  );
  await streamLines(page, plainWork.slug, empty.id, rest.slice(2, -2));

  // Claude의 MCP 호출 — ⌘ 줄. 원본 출력은 펼쳐야 보인다(JSON은 들여 써서).
  const list = 도구줄(page, "atelier 통합 사용함 · atelier_list_works");
  await expect(list).toBeVisible();
  await expect(도구줄(page, "atelier 통합 사용 중 · atelier_list_works")).toHaveCount(0);
  const toggle = list.getByRole("button", { name: /atelier 통합 사용함/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const output = list.getByRole("figure", { name: "atelier_list_works 출력", exact: true });
  await expect(output).toHaveCount(0);
  await toggle.click();
  await expect(output).toBeVisible();
  await expect(output).toContainText('"slug": "three-axes"');
  await expect(명령출력(list)).toHaveCount(0);

  // Codex의 MCP 호출 — kind가 `execute`여도 명령 줄이 아니라 MCP 줄이고, 실패는 「~하지 못함」이다.
  const get = 도구줄(page, "atelier 통합 사용하지 못함 · atelier_get_work");
  await expect(get).toBeVisible();
  await expect(명령출력(get)).toHaveCount(0);
  await get.getByRole("button", { name: /atelier 통합 사용하지 못함/ }).click();
  await expect(get.getByRole("figure", { name: "atelier_get_work 출력", exact: true })).toContainText("work를 찾지 못했습니다: nope");
  await expect(작업패널(page).getByRole("group", { name: /mcp\.atelier/ })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("서브에이전트: Agent 도구 줄도 진행형 → 완료형이고(맡긴 일과 서브에이전트 갈래), 안에서 일어난 일은 흐름에 섞이지 않으며, 돌려준 글은 펼치면 보인다", async ({
  page,
}) => {
  const empty = conversationRow({ id: "c-tools-agent", agent: "claude", name: "Claude", lastSeq: 0 });
  await openChat(page, empty, []);
  // 변환기가 옮긴 모양(티켓 14 · 실측 T14) — `Agent` 호출은 kind `think`, 제목은 맡긴 일의 설명이고 `_meta.claudeCode.subagent`가
  // 붙는다. 서브에이전트 안의 줄(`task_progress` 등)은 그 도구 줄의 `_meta.claudeCode.event`로 실린 update다.
  const base = { toolName: "Agent", subagent: { subagentType: "general-purpose", description: "셋째 줄 읽기" } };
  const turn = handToolTurn(
    1,
    "Agent 도구로 셋째 줄을 읽어 와",
    [
      {
        sessionUpdate: "tool_call",
        toolCallId: "toolu_hand_agent",
        title: "셋째 줄 읽기",
        kind: "think",
        status: "in_progress",
        rawInput: { subagent_type: "general-purpose", description: "셋째 줄 읽기", prompt: "note.md의 셋째 줄을 읽어 와" },
        _meta: { claudeCode: base },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_hand_agent",
        _meta: { claudeCode: { ...base, event: { type: "system", subtype: "task_progress", last_tool_name: "Read" } } },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_hand_agent",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "[Subagent hand-back] 셋째 줄은 「gamma」다." } }],
      },
    ],
    "셋째 줄은 gamma예요.",
    5000,
  );
  await streamLines(page, plainWork.slug, empty.id, turn.slice(0, 3));
  await expect(도구줄(page, "general-purpose 서브에이전트에게 맡기는 중 · 셋째 줄 읽기")).toBeVisible();
  await streamLines(page, plainWork.slug, empty.id, turn.slice(3, 4));
  const row = 도구줄(page, "general-purpose 서브에이전트에게 맡김 · 셋째 줄 읽기");
  await expect(row).toBeVisible();
  await expect(작업패널(page).getByText("gamma", { exact: false })).toHaveCount(0);
  await row.getByRole("button", { name: /서브에이전트에게 맡김/ }).click();
  await expect(row).toContainText("[Subagent hand-back] 셋째 줄은 「gamma」다.");
  // 돌려준 글은 명령의 출력이 아니다 — 그 상자의 이름은 보이는 라벨처럼 「출력」이다.
  await expect(row.getByRole("figure", { name: "출력", exact: true })).toContainText("[Subagent hand-back]");
  await expect(명령출력(row)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("빈 제목: 제목이 빈 도구 줄(codex의 title 빈 명령)은 kind로 지은 문구를 보인다", async ({ page }) => {
  const empty = conversationRow({ id: "c-tools-untitled", agent: "codex", name: "Codex", lastSeq: 0 });
  await openChat(page, empty, []);
  // 실측 A2(`codex-acp-2.2.2-turns.jsonl`)의 그 줄 모양 — title도 명령도 빈 execute(실측 함정 49).
  const call = {
    sessionUpdate: "tool_call",
    toolCallId: "exec-hand-untitled",
    name: "exec_command",
    kind: "execute",
    title: "",
    status: "in_progress",
    content: [{ type: "terminal", terminalId: "exec-hand-untitled" }],
    rawInput: { command: "", cwd: "/tmp/fake-worktree" },
    _meta: { terminal_info: { cwd: "/tmp/fake-worktree", terminal_id: "exec-hand-untitled" } },
  };
  const done = {
    sessionUpdate: "tool_call_update",
    toolCallId: "exec-hand-untitled",
    status: "completed",
    _meta: { terminal_exit: { exit_code: 0, signal: null, terminal_id: "exec-hand-untitled" } },
  };
  const turn = handToolTurn(1, "확인해 줘", [call, done], "확인했어요.", 2000);
  await streamLines(page, plainWork.slug, empty.id, turn.slice(0, 2));
  await expect(도구줄(page, "명령 실행 중")).toBeVisible();
  await streamLines(page, plainWork.slug, empty.id, turn.slice(2, 3));
  await expect(도구줄(page, "명령 실행 완료")).toBeVisible();
  await expect(도구줄(page, "명령 실행 중")).toHaveCount(0);
  // 빈 이름의 줄은 없다.
  await expect(작업패널(page).locator('[role="group"][aria-label=""]')).toHaveCount(0);
  await expect(작업패널(page).locator('[role="group"][aria-label=" 실행 완료"]')).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("접힘: 턴이 끝나면 도구 줄도 「N초 동안 작업함」 머리줄 아래로 접히고, 머리줄을 누르면 다시 선다", async ({ page }) => {
  await openChat(page, claude, linesThrough(twoTurns, SECOND_SENT + 1));
  await streamLines(page, plainWork.slug, claude.id, between(twoTurns, SECOND_SENT + 1, BASH.update));
  await expect(도구줄(page, `${WC} 실행 완료`)).toBeVisible();

  // 턴 끝 — 도구 줄 셋이 접히고 턴 끝 메시지(마지막 도구 호출 뒤의 답 「4」)만 펼쳐져 있다.
  await streamLines(page, plainWork.slug, claude.id, linesAfter(twoTurns, BASH.update));
  const header = 머리줄(page, "13초 동안 작업함");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  for (const phrase of ["작성함 notes.txt", "notes.txt 읽음", `${WC} 실행 완료`]) await expect(도구줄(page, phrase)).toHaveCount(0);
  await expect(작업패널(page).getByText("4", { exact: true })).toBeVisible();

  await header.click();
  for (const phrase of ["작성함 notes.txt", "notes.txt 읽음", `${WC} 실행 완료`]) await expect(도구줄(page, phrase)).toBeVisible();
  await header.click();
  await expect(도구줄(page, `${WC} 실행 완료`)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L1이 남긴 「고친 곳」(티켓 06) — 가짜 Codex가 spec 폴더에 새 문서를 쓰고(`drafts/idea.md`) · `plan.md`를 두 번 고치고 · `old.md`를
// 지운다. 편집 diff의 경로는 spec 폴더 안이다(고정값 사본이라 홈 축약 표기다). 스펙 창의 본문은 그 턴 뒤의 사본이다.
const changes = record("changes");
const changesSpec = specCopy("changes");
const CHANGES_SENT = changes.find((line) => line.kind === "sent")!.seq;


/** 기록의 머리말이 말하는 work — slug `cart`. */
const cart = cartWork(changesSpec, "keep.md");
const cartCodex = conversationRow({ id: "c-tools-cart", agent: "codex", name: "Codex", lastSeq: CHANGES_SENT - 1 });
const 문서 = (page: Page) => page.getByRole("main", { name: "문서", exact: true });

test("파일 링크 · diff: spec 파일을 고친 편집이 지운 줄 · 더한 줄의 diff로 보이고, 도구 줄의 파일을 누르면 스펙 창이 그 파일을 연다", async ({
  page,
}) => {
  await openChat(page, cartCodex, linesThrough(changes, CHANGES_SENT - 1), cart, { bodies: changesSpec.bodies, file: "keep.md" });
  await expect(문서(page).getByRole("heading", { name: "그대로 둘 문서" })).toBeVisible({ timeout: 20_000 });
  await streamLines(page, cart.slug, cartCodex.id, linesAfter(changes, CHANGES_SENT - 1));
  await 머리줄(page, "11초 동안 작업함").click();

  // plan.md의 첫 고침 — 옛 글 「첫 문단이다.」가 지운 줄, 새 두 줄이 더한 줄이다. 그 밖의 줄은 둘레다.
  const firstEdit = 도구줄(page, "편집함 plan.md").first();
  const diff = firstEdit.getByRole("figure", { name: "plan.md diff", exact: true });
  await expect(diff.getByRole("deletion")).toHaveText(["첫 문단이다."]);
  await expect(diff.getByRole("insertion")).toHaveText(["요약 한 줄.", "첫 문단을 고쳤다."]);
  await expect(firstEdit).toContainText("+2 -1");
  // 새 문서와 지운 문서.
  await expect(도구줄(page, "작성함 idea.md").getByRole("figure", { name: "idea.md diff" }).getByRole("insertion")).toHaveText([
    "# 아이디어",
    "",
    "새로 쓴 문서다.",
  ]);
  const removed = 도구줄(page, "삭제됨 old.md");
  await expect(removed.getByRole("figure", { name: "old.md diff" }).getByRole("deletion")).toHaveText(["# 지울 문서"]);
  // 지운 파일은 열 것이 없다 — 링크가 아니다.
  await expect(removed.getByRole("figure").getByRole("button")).toHaveCount(0);

  // diff 머리의 파일(spec 폴더 기준 경로)을 누르면 스펙 창이 그 파일을 연다 — 문서 링크와 같은 길이라 주소에 남는다.
  await diff.getByRole("button", { name: "plan.md", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${cart.slug}\\?.*file=plan\\.md`));
  await expect(문서(page).getByRole("heading", { name: "계획" })).toBeVisible();

  // 읽기 도구 줄의 파일 — 엔진은 절대 경로를 준다(홈을 편 spec 폴더 안). 누르면 그 파일이 열린다.
  const last = changes[changes.length - 1].seq;
  await streamLines(
    page,
    cart.slug,
    cartCodex.id,
    handToolTurn(
      last + 1,
      "idea.md를 읽어 줘",
      [
        {
          sessionUpdate: "tool_call",
          toolCallId: "read-hand-idea",
          kind: "read",
          title: "Read file '/Users/tester/.atelier/works/cart/spec/drafts/idea.md'",
          status: "in_progress",
          locations: [{ path: "/Users/tester/.atelier/works/cart/spec/drafts/idea.md" }],
        },
        { sessionUpdate: "tool_call_update", toolCallId: "read-hand-idea", status: "completed" },
      ],
      "읽었어요.",
      1000,
    ).slice(0, 3),
  );
  await 도구줄(page, "idea.md 읽음").getByRole("button", { name: "idea.md", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${cart.slug}\\?.*file=drafts%2Fidea\\.md`));
  await expect(문서(page).getByRole("heading", { name: "아이디어" })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
