import { expect, test, type Page } from "./evidence";

import { WORKS } from "./fixtures";
import { ipcCallArgs, replaceAnswer, unknownIpcCalls, 툴팁 } from "./harness";
import { conversationRow, linesThrough, record, sentLine, streamLines } from "./chat-records";
import { openWorkChat, 대화탭, 입력칸, 작업패널 } from "./chat-screen";
import type { Conversation, RecordLine } from "@/features/chat/types";

// three-axes 티켓 19 — **칩과 「/」 메뉴로 에이전트 · 모델 · 모드 · 계획을 고른다**(스토리 23 · 24 · 25 · 27 · 28 · 29 · 30 · 31 · 33 ·
// 34 · 36).
//
// 대화 호스트는 목업 백엔드의 답과 이 검사가 쏘는 기록 줄 이벤트로 선다. 칩과 메뉴의 원천은 기록이다(S15) — L1이 남긴 「Claude 두
// 턴」(티켓 14)과 「Codex 계획」(티켓 09)의 열림 줄(모드 · configOptions)과 명령 목록(`available_commands_update`)을 그대로 쏜다
// (S26). 재는 것은 역할 · 접근성 이름 · 보이는 글 · 나간 명령의 인자다.

const plainWork = WORKS[1];

const 단추 = (page: Page, name: string) => 작업패널(page).getByRole("button", { name, exact: true });
/** 칩이 연 메뉴 — 포털로 `body`에 선다. */
const 메뉴 = (page: Page) => page.getByRole("menu");
const 메뉴줄 = (page: Page) => 메뉴(page).getByRole("menuitemradio");
/** 뜬 메뉴의 줄 이름들 — 메뉴가 선 것을 먼저 본다(줄은 메뉴와 함께 한 번에 선다). */
async function 줄이름들(page: Page): Promise<(string | null)[]> {
  await expect(메뉴(page)).toBeVisible();
  return 메뉴줄(page).evaluateAll((all) => all.map((el) => el.getAttribute("aria-label")));
}

const LOCKED = "첫 말 뒤에는 바꿀 수 없어요. 다른 에이전트는 +로 열어요";

// L1이 남긴 「Claude 두 턴」(S26) — 띄우는 중 · 열림(모드 다섯 · configOptions의 모델 열셋 · initialize 원문) · 명령 목록 145 뒤에 두
// 턴이 돈다.
const claudeTwoTurns = record("claude-two-turns");
const CLAUDE_SENT = claudeTwoTurns.find((line) => line.kind === "sent")!.seq;
/** 첫 말 전의 Claude 대화 — 기록은 열림 줄과 명령 목록까지다. */
const claudeFresh = conversationRow({ id: "c-claude-fresh", agent: "claude", name: "Claude", lastSeq: CLAUDE_SENT - 1 });

// L1이 남긴 「Codex 계획」(S26) — 띄우는 중 · 계정 · 열림(모드 넷 · configOptions의 모델 둘과 collaboration_mode) · 명령 목록 뒤에
// 사람이 계획을 켠 config 줄, 그리고 계획 턴이 돈다. 턴 끝 뒤에 명령 목록이 한 번 더 온다.
const codexPlan = record("codex-plan");

/** 그 work의 대화창을 연다 — 대화 목록은 `row` 하나, 기록 읽기는 `read`다. */
const openChat = (page: Page, row: Conversation, read: readonly RecordLine[]): Promise<void> =>
  openWorkChat(page, [row], { [row.id]: read });

/** 기록 줄들의 seq를 `from`부터 다시 매긴다 — 다른 기록의 줄을 이 대화의 끝에 잇는다. */
const renumber = (lines: readonly RecordLine[], from: number): RecordLine[] =>
  lines.map((line, at) => ({ ...line, seq: from + at }));

test("에이전트 칩: 첫 말 전에는 Claude Code와 Codex를 골라 바꾸기 명령이 그 인자로 가고, 첫 말 뒤에는 잠겨 눌러도 아무 일이 없고 툴팁이 까닭을 말한다", async ({
  page,
}) => {
  await openChat(page, claudeFresh, linesThrough(claudeTwoTurns, CLAUDE_SENT - 1));
  const 에이전트칩 = 단추(page, "에이전트 Claude Code");
  await expect(에이전트칩).toHaveAttribute("aria-haspopup", "menu");
  await 에이전트칩.click();
  expect(await 줄이름들(page)).toEqual(["Claude Code", "Codex"]);
  await expect(메뉴(page).getByRole("menuitemradio", { name: "Claude Code", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // 고르면 호스트의 에이전트 바꾸기로 간다 — 답은 새 엔진으로 다시 연 대화다(이름도 호스트가 다시 짓는다).
  const switched = conversationRow({ id: claudeFresh.id, agent: "codex", name: "Codex", lastSeq: CLAUDE_SENT - 1 });
  await replaceAnswer(page, "chat_switch_agent", switched);
  await 메뉴(page).getByRole("menuitemradio", { name: "Codex", exact: true }).click();
  await expect(단추(page, "에이전트 Codex")).toBeVisible();
  expect((await ipcCallArgs(page, "chat_switch_agent", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: claudeFresh.id, agent: "codex" },
  ]);
  await expect(대화탭(page, "Codex")).toBeVisible();
  await expect(입력칸(page)).toHaveAttribute("placeholder", "Codex에게 요청하세요");

  // 바꾸면 기록에 사람이 바꾼 에이전트(config 줄)가 서고, 새 엔진의 띄우는 중 · 열림이 이어진다 — 칩의 목록은 새 엔진의 것이다.
  const config: RecordLine = { seq: CLAUDE_SENT, at: claudeTwoTurns[0].at, kind: "config", payload: { agent: "codex" } };
  const codexOpened = renumber(linesThrough(codexPlan, 4), CLAUDE_SENT + 1);
  await streamLines(page, plainWork.slug, claudeFresh.id, [config, ...codexOpened]);
  await expect(단추(page, "모드 Auto review")).toBeVisible();

  // 첫 말 뒤에는 잠긴다 — 누르면 아무 일도 없고(메뉴가 서지 않는다), 툴팁과 설명이 까닭을 말한다.
  const sentSeq = CLAUDE_SENT + 1 + codexOpened.length;
  await streamLines(page, plainWork.slug, claudeFresh.id, [sentLine(sentSeq, "hello.txt를 만들어 줘")]);
  const 잠긴칩 = 단추(page, "에이전트 Codex");
  await expect(잠긴칩).toHaveAttribute("aria-disabled", "true");
  await expect(잠긴칩).toHaveAccessibleDescription(LOCKED);
  await expect(잠긴칩).not.toHaveAttribute("aria-haspopup", "menu");
  await 잠긴칩.hover();
  await expect(툴팁(page)).toHaveText(LOCKED);
  // Playwright는 `aria-disabled` 버튼을 누를 수 없는 것으로 보고 기다린다 — 사람이 누른 것처럼 밀어 넣어 「아무 일도 없음」을 잰다.
  await 잠긴칩.click({ force: true });
  await expect(메뉴(page)).toHaveCount(0);
  expect(await ipcCallArgs(page, "chat_switch_agent", "work")).toHaveLength(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("모델 · 모드 칩(Claude): 목록이 기록의 열림 줄 그대로다 — 모드 다섯에 bypassPermissions가 없고, 모델 열셋 끝에 캐시 한 줄이 있고, 「계획」 토글은 없다", async ({
  page,
}) => {
  await openChat(page, claudeFresh, linesThrough(claudeTwoTurns, CLAUDE_SENT - 1));
  // 모드 — 엔진의 이름 그대로 다섯(three-axes 결정 16). 변환기가 내지 않는 bypassPermissions는 없다. 칩 글자는 열림 줄의 지금 모드다.
  await 단추(page, "모드 auto").click();
  expect(await 줄이름들(page)).toEqual(["default", "acceptEdits", "auto", "dontAsk", "plan"]);
  await expect(메뉴(page).getByRole("menuitemradio", { name: "auto", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);

  // 모델 — configOptions `model`의 선택지 그대로 열셋, 칩 글자는 지금 값(`default`)의 이름이다. 목록 끝에 캐시 한 줄(실측 함정 37).
  await 단추(page, "모델 Default (recommended)").click();
  expect(await 줄이름들(page)).toEqual([
    "Default (recommended)",
    "Opus 5.5",
    "Fable 5.1",
    "Sonnet 5.5",
    "Haiku 5.5",
    "Haiku 4.5",
    "Sonnet 5",
    "Opus 5",
    "Fable 5",
    "Opus 4.8",
    "Opus 4.7",
    "Opus 4.6",
    "Sonnet 4.6",
  ]);
  await expect(메뉴(page).getByRole("menuitemradio", { name: "Opus 5.5", exact: true })).toHaveAccessibleDescription(
    "For complex work and everyday tasks",
  );
  expect(await 메뉴(page).evaluate((menu) => menu.lastElementChild?.textContent)).toBe("바꾼 첫 턴은 캐시를 다시 써서 더 들어요");
  await page.keyboard.press("Escape");
  // Claude에는 「계획」 토글이 없다 — Claude의 계획은 모드(`plan`)다.
  await expect(단추(page, "계획")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("「계획」 토글(Codex): configOptions `collaboration_mode`에서 서고 사람이 켠 값(config 줄)이 켜짐이다 — 모드는 넷, 모델 목록에는 캐시 줄이 없다", async ({
  page,
}) => {
  // 「Codex 계획」의 사람이 계획을 켠 config 줄까지 — 첫 말 전이다.
  const codex = conversationRow({ id: "c-codex-plan", agent: "codex", name: "Codex", plan: true, lastSeq: 5 });
  await openChat(page, codex, linesThrough(codexPlan, 5));
  await expect(단추(page, "계획")).toHaveAttribute("aria-pressed", "true");
  await 단추(page, "모드 Auto review").click();
  expect(await 줄이름들(page)).toEqual(["Read-only", "Workspace access", "Auto review", "Full access"]);
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);
  await 단추(page, "모델 6.1 Sol").click();
  expect(await 줄이름들(page)).toEqual(["6.1 Sol", "6 Astra"]);
  await expect(메뉴(page).getByText("바꾼 첫 턴은 캐시를 다시 써서 더 들어요")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);

  // 누르면 계획 바꾸기로 끄는 값이 간다. 답(바뀐 대화)으로 토글이 꺼진다.
  await replaceAnswer(page, "chat_set_plan", { ...codex, plan: false });
  await 단추(page, "계획").click();
  await expect(단추(page, "계획")).toHaveAttribute("aria-pressed", "false");
  expect((await ipcCallArgs(page, "chat_set_plan", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: codex.id, plan: false },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("바꾸기: 모드 · 모델을 고르면 그 값이 바꾸기 명령의 인자로 가고 칩이 바뀐 값이 되며(설정의 기본값은 그대로다), 엔진이 스스로 바꾼 모드(`current_mode_update`)를 모드 칩이 따른다", async ({
  page,
}) => {
  await openChat(page, claudeFresh, linesThrough(claudeTwoTurns, CLAUDE_SENT - 1));
  await replaceAnswer(page, "chat_set_mode", { ...claudeFresh, mode: "plan" });
  await 단추(page, "모드 auto").click();
  await 메뉴(page).getByRole("menuitemradio", { name: "plan", exact: true }).click();
  await expect(단추(page, "모드 plan")).toBeVisible();
  expect((await ipcCallArgs(page, "chat_set_mode", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: claudeFresh.id, mode: "plan" },
  ]);

  await replaceAnswer(page, "chat_set_model", { ...claudeFresh, mode: "plan", model: "sonnet" });
  await 단추(page, "모델 Default (recommended)").click();
  await 메뉴(page).getByRole("menuitemradio", { name: "Sonnet 5.5", exact: true }).click();
  await expect(단추(page, "모델 Sonnet 5.5")).toBeVisible();
  expect((await ipcCallArgs(page, "chat_set_model", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: claudeFresh.id, model: "sonnet" },
  ]);
  // 값은 그 대화의 것이다 — 설정 파일(새 대화의 기본값)은 쓰지 않는다(스토리 32).
  expect(await ipcCallArgs(page, "write_settings", "settings")).toEqual([]);

  // Claude가 스스로 모드를 바꿨다(계획 승인 뒤 등) — 변환기가 옮긴 `current_mode_update`가 오면 칩이 그 모드다.
  const modeUpdate: RecordLine = {
    seq: CLAUDE_SENT,
    at: claudeTwoTurns[0].at,
    kind: "update",
    payload: { sessionId: "claude-session", update: { sessionUpdate: "current_mode_update", currentModeId: "acceptEdits" } },
  };
  await streamLines(page, plainWork.slug, claudeFresh.id, [modeUpdate]);
  await expect(단추(page, "모드 acceptEdits")).toBeVisible();
  await expect(단추(page, "모델 Sonnet 5.5")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const 명령메뉴 = (page: Page) => 작업패널(page).getByRole("listbox", { name: "명령", exact: true });
const 명령줄 = (page: Page) => 명령메뉴(page).getByRole("option");
const 명령이름들 = async (page: Page) => {
  await expect(명령메뉴(page)).toBeVisible();
  return 명령줄(page).evaluateAll((all) => all.map((el) => el.getAttribute("aria-label")));
};

test("「/」 메뉴: 「/」를 치면 그 엔진의 명령이 설명과 함께 서고, 친 글자로 이름과 별칭을 찾으며, 고르면 보내지 않고 입력칸이 `/이름 `이 되어 인자를 이어 쓴다", async ({
  page,
}) => {
  await openChat(page, claudeFresh, linesThrough(claudeTwoTurns, CLAUDE_SENT - 1));
  // 「/」 하나면 명령 목록 전부가 엔진의 차례로 선다 — 줄마다 이름과 설명(`initialize.commands[].description`)이다.
  await 입력칸(page).fill("/");
  expect((await 명령이름들(page)).slice(0, 3)).toEqual(["/ask-matt", "/chief-of-staff", "/claude-handoff"]);
  await expect(명령줄(page)).toHaveCount(145);
  const grilling = 명령메뉴(page).getByRole("option", { name: "/grilling", exact: true });
  await expect(grilling).toContainText("Grill the user relentlessly about a plan, decision, or idea.");
  // 켜진 줄은 입력칸이 가리킨다 — 포커스는 입력칸에 남는다.
  await expect(입력칸(page)).toBeFocused();
  await expect(명령줄(page).first()).toHaveAttribute("aria-selected", "true");
  const firstId = await 명령줄(page).first().getAttribute("id");
  await expect(입력칸(page)).toHaveAttribute("aria-activedescendant", firstId!);

  // 친 글자로 찾는다 — 이름이 그 글자로 시작하는 것.
  await 입력칸(page).fill("/gri");
  expect(await 명령이름들(page)).toEqual(["/grill-me", "/grill-with-docs", "/grilling"]);
  // 누르면 입력칸이 `/이름 `이 되고 메뉴가 걷힌다 — 보내지 않는다.
  await 명령메뉴(page).getByRole("option", { name: "/grilling", exact: true }).click();
  await expect(입력칸(page)).toHaveValue("/grilling ");
  await expect(명령메뉴(page)).toHaveCount(0);
  await expect(입력칸(page)).toBeFocused();

  // 별칭으로도 찾는다 — `/cost`는 `usage`의 별칭이다(`_meta.aliases`). ↓ · Enter로 고른다.
  await 입력칸(page).fill("/cost");
  expect(await 명령이름들(page)).toEqual(["/usage"]);
  await expect(명령메뉴(page).getByRole("option", { name: "/usage", exact: true })).toHaveAccessibleDescription(
    "Show session cost, plan usage, and what's contributing to your limits",
  );
  await 입력칸(page).press("Enter");
  await expect(입력칸(page)).toHaveValue("/usage ");
  await expect(명령메뉴(page)).toHaveCount(0);

  // ↓로 줄을 옮긴다 — 이름으로 시작하는 것 뒤에 이름이 품은 것이 선다.
  await 입력칸(page).fill("/comp");
  expect(await 명령이름들(page)).toEqual(["/compact", "/computer-use", "/autocompact"]);
  await 입력칸(page).press("ArrowDown");
  await expect(명령메뉴(page).getByRole("option", { name: "/computer-use", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await 입력칸(page).press("Tab");
  await expect(입력칸(page)).toHaveValue("/computer-use ");

  // Esc는 메뉴만 걷는다 — 친 글은 남는다.
  await 입력칸(page).fill("/re");
  await expect(명령메뉴(page)).toBeVisible();
  await 입력칸(page).press("Escape");
  await expect(명령메뉴(page)).toHaveCount(0);
  await expect(입력칸(page)).toHaveValue("/re");
  expect(await ipcCallArgs(page, "chat_send", "work")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("띄우지 않은 대화: 앱을 다시 켠 뒤 기록만 있는 대화에서도 칩과 「/」 메뉴가 지난 목록으로 서고, 대화 목록에 남은 사람의 값(띄우지 않은 채 바꾼 것)이 칩의 값이다", async ({
  page,
}) => {
  // 다시 켠 뒤의 「Codex 계획」 대화 — 에이전트는 떠 있지 않고(기록 줄 이벤트가 오지 않는다), 기록 읽기가 지난 기록 전부를 답한다.
  // 사람은 띄우지 않은 채 모델을 바꾸고 계획을 껐다 — 기록에는 줄이 없고 대화 목록에만 남았다(티켓 09).
  const restarted = conversationRow({
    id: "c-codex-restarted",
    agent: "codex",
    name: "Codex",
    model: "gpt-6-astra",
    plan: false,
    lastSeq: codexPlan[codexPlan.length - 1].seq,
  });
  await openChat(page, restarted, codexPlan);
  await expect(단추(page, "에이전트 Codex")).toHaveAttribute("aria-disabled", "true");
  await expect(단추(page, "모드 Auto review")).toBeVisible();
  await expect(단추(page, "모델 6 Astra")).toBeVisible();
  await expect(단추(page, "계획")).toHaveAttribute("aria-pressed", "false");
  await 단추(page, "모델 6 Astra").click();
  expect(await 줄이름들(page)).toEqual(["6.1 Sol", "6 Astra"]);
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);

  // 「/」 메뉴는 기록의 마지막 명령 목록이다 — Codex의 내장 명령과 스킬(`$` 표지).
  await 입력칸(page).fill("/");
  expect(await 명령이름들(page)).toEqual(["/plan", "/mcp", "/review", "/compact", "$probe-skill"]);
  await expect(명령메뉴(page).getByRole("option", { name: "/review", exact: true })).toContainText(
    "Review uncommitted changes, or review with custom instructions.",
  );
  // 스킬은 표지를 떼고도 찾고, 고르면 엔진이 준 이름 그대로 들어간다 — codex-acp는 `$` 이름을 명령으로 보지 않고 모델에게 넘긴다.
  await 입력칸(page).fill("/probe");
  expect(await 명령이름들(page)).toEqual(["$probe-skill"]);
  await 입력칸(page).press("Enter");
  await expect(입력칸(page)).toHaveValue("$probe-skill ");
  expect(await ipcCallArgs(page, "chat_set_model", "work")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
