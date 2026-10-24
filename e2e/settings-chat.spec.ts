import { expect, test, type Page } from "./evidence";
import { answerByArg, WORKS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls, 머리카드 } from "./harness";
import { conversationRow } from "./chat-records";
import { 대화탭줄 } from "./chat-screen";
import { terminalSettings } from "@/features/settings/settings-fixture";
import type { EngineLists } from "@/features/chat/types";
import type { Settings } from "@/features/settings/types";

// three-axes 티켓 25 — **설정 「대화」에서 새 대화의 기본값을 고른다**(three-axes 결정 16 · 스토리 111 · 112 · 113).
//
// 이 층이 재는 것은 화면이다 — 행 셋이 서고, 고른 값이 저장 명령의 인자로 나가고, 목록이 없는 엔진은 「엔진 기본값」만 고를 수
// 있다. 그리고 `+`가 설정의 기본 에이전트를 새 대화 명령에 싣는다. 새 대화가 그 모델 · 모드로 열리는지(플래그 · `set_*`)는 L1이
// 진짜 설정 파일로 잰다(`crates/atelier-acp/tests/new_conversation_defaults.rs`).

/** Claude의 엔진 목록 — 판 02 실측(`claude-two-turns.jsonl`의 열림 줄)의 앞 셋과 모드 다섯이다. */
const CLAUDE_LISTS: EngineLists = {
  models: [
    { value: "default", name: "Default (recommended)", description: "Opus 5.5 · Best for everyday, complex tasks" },
    { value: "opus", name: "Opus 5.5", description: "For complex work and everyday tasks" },
    { value: "sonnet", name: "Sonnet 5.5", description: "Most efficient for simpler tasks" },
  ],
  modes: [
    { id: "default", name: "default" },
    { id: "acceptEdits", name: "acceptEdits" },
    { id: "auto", name: "auto" },
    { id: "dontAsk", name: "dontAsk" },
    { id: "plan", name: "plan" },
  ],
};

/** Codex는 세션을 한 번도 연 적 없다 — 엔진 목록 파일에 몫이 없어 빈 목록이다(S16). */
const NEVER_OPENED: EngineLists = { models: [], modes: [] };

const 대화설정 = (page: Page) => page.getByRole("group", { name: "대화 설정", exact: true });
const 고르기 = (page: Page, name: string) => 대화설정(page).getByRole("combobox", { name, exact: true });
/** 고르기 칩에 선 지금 값 — 칩 글자에는 화살표 아이콘의 글자가 붙어 오므로 값 칸만 읽는다. */
const 값 = (page: Page, name: string) => 고르기(page, name).locator('[data-slot="select-value"]');
const 목록 = (page: Page) => page.getByRole("listbox");
const 에이전트칩 = (page: Page, name: "Claude Code" | "Codex") =>
  대화설정(page).getByRole("group", { name: "기본 에이전트", exact: true }).getByRole("button", { name, exact: true });
/** 이 쪽의 저장 — 머리 카드의 할 일이다(codex-ds 스펙 §7 · `settings-save.spec.ts`). 한 화면에 쪽이 하나라 그 저장이 곧 대화 설정의 것이다. */
const 저장 = (page: Page) => 머리카드(page).getByRole("button", { name: "저장", exact: true });

/** 나간 `write_settings`들의 설정. */
async function writtenSettings(page: Page): Promise<Settings[]> {
  return (await ipcCallArgs(page, "write_settings", "settings")).map(({ args }) => args.settings as Settings);
}

/** 그 고르기를 열어 그 이름의 줄을 고른다. */
async function pick(page: Page, combobox: string, option: string) {
  await 고르기(page, combobox).click();
  await 목록(page).getByRole("option", { name: option, exact: true }).click();
  await expect(목록(page)).toHaveCount(0);
}

test("대화 쪽에 행 셋이 서고, 고르면 저장 명령에 그 값이 실리며, 엔진 기본값을 고르면 키째 빠진다", async ({ page }) => {
  await installFixtureBackend(page, {
    chat_engine_lists: answerByArg("agent", { claude: CLAUDE_LISTS, codex: NEVER_OPENED }),
  });
  await page.goto("/settings/chat");

  await expect(page.getByRole("heading", { name: "대화", exact: true })).toBeVisible();
  // 행 셋 — 기본 에이전트 · 기본 모델 · 시작 모드. 모델 · 모드 행에는 엔진마다 고르기가 하나씩 선다.
  await expect(대화설정(page).locator('[data-slot="settings-row"]')).toHaveCount(3);
  await expect(대화설정(page).locator('[data-slot="settings-row"]')).toContainText(["기본 에이전트", "기본 모델", "시작 모드"]);
  for (const name of ["Claude Code 기본 모델", "Codex 기본 모델", "Claude Code 시작 모드", "Codex 시작 모드"]) {
    await expect(값(page, name), `${name}는 처음에 엔진 기본값이다`).toHaveText("엔진 기본값");
  }
  // 처음 기본 에이전트는 Claude Code다(three-axes 결정 16). 손대지 않으면 저장할 것이 없다.
  await expect(에이전트칩(page, "Claude Code")).toHaveAttribute("aria-pressed", "true");
  await expect(에이전트칩(page, "Codex")).toHaveAttribute("aria-pressed", "false");
  await expect(저장(page)).toBeDisabled();

  // 목록은 엔진 목록 파일에서 온다 — 첫 줄은 엔진 기본값이고, 그 뒤가 엔진이 낸 차례 그대로다.
  await 고르기(page, "Claude Code 기본 모델").click();
  await expect(목록(page).getByRole("option")).toHaveText(["엔진 기본값", "Default (recommended)", "Opus 5.5", "Sonnet 5.5"]);
  await 목록(page).getByRole("option", { name: "Sonnet 5.5", exact: true }).click();
  await expect(값(page, "Claude Code 기본 모델")).toHaveText("Sonnet 5.5");
  await pick(page, "Claude Code 시작 모드", "acceptEdits");

  // 세션을 한 번도 연 적 없는 엔진은 엔진 기본값만 고를 수 있다.
  await 고르기(page, "Codex 기본 모델").click();
  await expect(목록(page).getByRole("option")).toHaveText(["엔진 기본값"]);
  await page.keyboard.press("Escape");
  await expect(목록(page)).toHaveCount(0);
  await 고르기(page, "Codex 시작 모드").click();
  await expect(목록(page).getByRole("option")).toHaveText(["엔진 기본값"]);
  await page.keyboard.press("Escape");
  await expect(목록(page)).toHaveCount(0);

  await 에이전트칩(page, "Codex").click();
  await expect(에이전트칩(page, "Codex")).toHaveAttribute("aria-pressed", "true");
  await 저장(page).click();
  await expect(저장(page)).toBeDisabled();

  // 저장은 파일 전체를 쓴다 — 대화 구획은 고른 칸만 담고, 다른 구획은 읽은 그대로다.
  let written = await writtenSettings(page);
  expect(written).toHaveLength(1);
  expect(written[0].chat).toEqual({ claude: { model: "sonnet", mode: "acceptEdits" }, defaultAgent: "codex" });
  expect(written[0].terminal).toEqual(terminalSettings());

  // 「엔진 기본값」은 값을 비워 둔 것이다 — `null` 줄이 아니라 키째 빠진다.
  await pick(page, "Claude Code 기본 모델", "엔진 기본값");
  await expect(값(page, "Claude Code 기본 모델")).toHaveText("엔진 기본값");
  await 저장(page).click();
  await expect(저장(page)).toBeDisabled();
  written = await writtenSettings(page);
  expect(written).toHaveLength(2);
  expect(written[1].chat).toEqual({ claude: { mode: "acceptEdits" }, defaultAgent: "codex" });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("파일에 있던 값이 고르기에 서고, 저장해도 설정 파일의 모르는 키가 남는다", async ({ page }) => {
  const file = {
    terminal: terminalSettings({ fontSize: 15 }),
    editor: { tabWidth: 2 },
    chat: {
      defaultAgent: "codex",
      // 목록에 없는 값(엔진 목록 파일이 지워진 뒤)도 지금 값으로 선다.
      codex: { model: "gpt-6-astra", effort: "high" },
      rolePresets: ["리뷰어"],
    },
  };
  await installFixtureBackend(page, {
    read_settings: file,
    chat_engine_lists: answerByArg("agent", { claude: CLAUDE_LISTS, codex: NEVER_OPENED }),
  });
  await page.goto("/settings/chat");

  await expect(에이전트칩(page, "Codex")).toHaveAttribute("aria-pressed", "true");
  await expect(값(page, "Codex 기본 모델")).toHaveText("gpt-6-astra");
  await expect(값(page, "Claude Code 기본 모델")).toHaveText("엔진 기본값");

  await pick(page, "Claude Code 시작 모드", "plan");
  await 저장(page).click();
  await expect(저장(page)).toBeDisabled();

  const [written] = await writtenSettings(page);
  expect(written).toEqual({
    terminal: terminalSettings({ fontSize: 15 }),
    editor: { tabWidth: 2 },
    chat: {
      defaultAgent: "codex",
      codex: { model: "gpt-6-astra", effort: "high" },
      rolePresets: ["리뷰어"],
      claude: { mode: "plan" },
    },
  });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const [, plainWork] = WORKS;

test("설정의 기본 에이전트가 Codex면 첫 대화와 + 가 Codex로 연다", async ({ page }) => {
  await installFixtureBackend(page, {
    read_settings: { terminal: terminalSettings(), chat: { defaultAgent: "codex" } },
    chat_new: conversationRow({ id: "c-codex", agent: "codex", name: "Codex" }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await page.getByRole("group", { name: "레일", exact: true }).getByRole("button", { name: "chat", exact: true }).click();

  await expect(대화탭줄(page).getByRole("button", { name: "Codex", exact: true })).toHaveAttribute("aria-pressed", "true");
  await 대화탭줄(page).getByRole("button", { name: "새 대화", exact: true }).click();
  await expect.poll(async () => (await ipcCallArgs(page, "chat_new", "work")).length).toBe(2);
  expect((await ipcCallArgs(page, "chat_new", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, agent: "codex" },
    { work: plainWork.slug, agent: "codex" },
  ]);
  // 엔진 확인도 그 에이전트로 간다 — 안내 카드가 그 엔진의 것이다.
  expect((await ipcCallArgs(page, "chat_check_engine", "agent")).map(({ args }) => args.agent)).not.toContain("claude");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
