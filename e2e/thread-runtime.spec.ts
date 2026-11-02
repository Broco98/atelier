import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { callCount, heldCalls, holdCommand, installFixtureBackend, ipcCallArgs, releaseCommand, unknownIpcCalls } from "./harness";
import { linesThrough, record, sentPayloads, seqOf, summaryOf } from "./thread-records";
import type { EngineCheck, ThreadView } from "@/features/thread/types";

// restart 01c-12 — **새 채팅에서 고른 Runtime이 첫 말과 함께 가고, 턴이 시작되면 Runtime 칩이 잠기며, 칩은 Runtime이 선언한 것만 선다. 고른 Runtime을
// 쓸 수 없으면 입력창 자리에 그 Runtime의 카드가 서고, 다른 Runtime으로 바꾸면 카드가 걷히고 입력창의 말이 남는다**(스펙 「01c — Codex」 Runtime 값 ·
// 칩 · 첫 말 전 Codex 칩 · Runtime 없음, 「재는 동작 · 화면」의 Runtime 줄 · 스토리 30 · 31 · 37 · 40).
//
//   여기서 잰다     Runtime 칩의 자리와 메뉴 · Runtime을 바꾸면 고른 모델 · 생각 깊이가 비워짐 · 첫 말 전 Codex 칩(모델 칩 없음, 메뉴 없는 기본 모드) ·
//                   첫 말의 `runtime` · 보내는 중과 Thread 화면에서 잠긴 Runtime 칩 · Codex 채팅의 모드 칩이 채팅 파일의 모드로 섬 · 확인 중 보내기
//                   잠금 · 못 찾음 카드와 바꾸기 단추 · 바꾼 뒤 남는 말
//   다른 층이 잰다  칩 값을 짓는 규칙(L2 `chips.test.ts`) · 카드의 단추와 까닭 글(L2 `GuideCard.test.tsx`) · Runtime마다의 상태와 「앱에서 한 번」(L2
//                   `engine-store.test.ts`) · Host가 Runtime으로 갈려 세션을 여는 것(L1 `thread_codex.rs`)
//
// Codex 채팅의 기록은 L1이 가짜 ACP로 codex-acp 2.2.2 녹음을 재생해 축복한 `thread-codex`다. 그 열림 줄의 `currentModeId`는 `agent`다.

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 입력창 — 보낼 말 칸을 싼 둘레 카드(`form`)다. */
const 입력창 = (page: Page) => 입력칸(page).locator("xpath=ancestor::form[1]");
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
/** 고를 수 있는 Runtime 칩 — 새 채팅의 첫 말 전에만 메뉴 단추다. */
const 고르는칩 = (page: Page, name: string) => page.getByRole("button", { name: `Runtime: ${name}`, exact: true });
/** 잠긴 Runtime 칩 — 이름만 선 칸이다. */
const 잠긴칩 = (page: Page, name: string) => page.getByLabel(`Runtime ${name}`, { exact: true });
const 메뉴 = (page: Page) => page.getByRole("menu");
const 갈래 = (page: Page, name: string) => 메뉴(page).getByRole("menuitemradio", { name, exact: true });
const 모델칩 = (page: Page) => 입력창(page).getByRole("button", { name: /^모델과 생각 깊이 / });
const 보내기 = (page: Page) => 입력창(page).getByRole("button", { name: "보내기", exact: true });

/** 입력창 상자 안 단추의 이름들 — 칩이 무엇이 서는지를 차례와 함께 본다. */
const 단추들 = (page: Page) => 입력창(page).getByRole("button").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));

/** 첫 화면을 연다. **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다. */
async function openHome(page: Page) {
  await page.goto("/");
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });
}

async function pickRuntime(page: Page, from: string, to: string) {
  await 고르는칩(page, from).click();
  await expect(메뉴(page).getByText("이 채팅을 돌릴 Runtime", { exact: true })).toBeVisible();
  await 갈래(page, to).click();
  await expect(고르는칩(page, to)).toBeVisible();
}

const FOUND: EngineCheck = { state: "found", programs: [{ name: "claude", path: "/opt/fixture/bin/claude" }], loggedIn: true };
const CODEX_FOUND: EngineCheck = {
  state: "found",
  programs: [
    { name: "codex-acp", path: "/opt/fixture/bin/codex-acp" },
    { name: "codex", path: "/opt/fixture/bin/codex" },
  ],
  loggedIn: true,
};
const CODEX_ACP_INSTALL = "npm i -g @agentclientprotocol/codex-acp@2.2.2";
const CODEX_MISSING: EngineCheck = { state: "missing", missing: [{ name: "codex-acp", install: CODEX_ACP_INSTALL }] };

const codex = record("thread-codex");
const [first] = sentPayloads(codex);
const FIRST_END = seqOf(codex, "turn-end");

test("Runtime 칩이 모델 칩 앞에 서고, Codex를 고르면 고른 모델 · 생각 깊이가 비워지고 모델 칩 없이 메뉴 없는 기본 모드가 서며, 첫 말이 Codex로 가고 보내는 중부터 칩이 잠긴다", async ({
  page,
}) => {
  // 첫 말로 선 Codex 채팅 — 채팅 파일의 모드는 「Read-only」이고, 기록의 열림 줄은 `currentModeId: agent`다.
  const started: ThreadView = {
    ...FIXTURE_THREAD,
    title: first.text,
    runtime: "codex",
    codexMode: "read-only",
    askLevel: "always",
    lastSeq: FIRST_END,
  };
  await installFixtureBackend(page, {
    thread_check_engine: answerByArg("runtime", { "claude-code": FOUND, codex: CODEX_FOUND }),
    thread_list: [summaryOf(started)],
    thread_get: answerByArg("thread", { [started.id]: started }),
    thread_read_record: answerByArg("thread", { [started.id]: linesThrough(codex, FIRST_END) }),
    thread_mark_read: answerByArg("thread", { [started.id]: { ...summaryOf(started), lastRead: FIRST_END } }),
  });
  await holdCommand(page, "thread_start");
  await openHome(page);

  // 기본은 Claude Code — Runtime 칩은 물어보는 정도 칩 뒤, 모델 칩 앞에 선다.
  expect(await 단추들(page)).toEqual(["파일 첨부", "물어보는 정도 편집 자동", "Runtime: Claude Code", "모델과 생각 깊이 Default", "보내기"]);

  // 모델과 생각 깊이를 고른다.
  await 모델칩(page).click();
  await 메뉴(page).getByRole("menuitemradio", { name: "Opus", exact: true }).click();
  await expect(모델칩(page)).toHaveAccessibleName("모델과 생각 깊이 Opus");
  await 모델칩(page).click();
  await 메뉴(page).getByRole("menuitemradio", { name: "높음", exact: true }).click();
  await expect(모델칩(page)).toHaveAccessibleName("모델과 생각 깊이 Opus · 높음");

  // Codex를 고르면 — 첫 말 전 Codex는 세션이 열리지 않아 모델 목록이 없으니 모델 칩이 서지 않고, 모드 칩은 앱이 정한 기본 「Workspace access」로
  // 메뉴 없이 선다(단추가 아니다). 물어보는 정도 칩도 서지 않는다.
  await pickRuntime(page, "Claude Code", "Codex");
  expect(await 단추들(page)).toEqual(["파일 첨부", "Runtime: Codex", "보내기"]);
  await expect(입력창(page).getByLabel("Codex 모드 Workspace access", { exact: true })).toBeVisible();
  await expect(입력창(page).getByRole("button", { name: /^Codex 모드/ })).toHaveCount(0);

  // 다시 Claude Code로 — 고른 모델과 생각 깊이가 비워져 기본값이다. Claude 값이 Codex로 가지 않게 Runtime을 바꿀 때 비운다.
  await pickRuntime(page, "Codex", "Claude Code");
  await expect(모델칩(page)).toHaveAccessibleName("모델과 생각 깊이 Default");

  // Codex로 첫 말 — `runtime: codex`로 가고, 모델 · 생각 깊이 · 정도는 보내지 않는다(Codex 채팅은 물어보는 정도를 쓰지 않는다).
  await pickRuntime(page, "Claude Code", "Codex");
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  await expect.poll(() => heldCalls(page, "thread_start")).toBe(1);

  // 보내는 중 — Runtime은 첫 말과 함께 떠났다. 칩이 이름만 남아 메뉴가 열리지 않는다.
  await expect(입력창(page).getByRole("button", { name: "보내는 중", exact: true })).toBeVisible();
  await expect(잠긴칩(page, "Codex")).toBeVisible();
  await expect(고르는칩(page, "Codex")).toHaveCount(0);

  await releaseCommand(page, "thread_start");
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => args)).toEqual([
    {
      text: first.text,
      attachments: [],
      link: { kind: "no-work" },
      runtime: "codex",
      mode: null,
      model: null,
      effort: null,
      service: null,
      project: null,
    },
  ]);

  // 턴이 시작된 Codex 채팅 — Runtime 칩은 잠긴 채이고, 칩은 Codex가 선언한 둘(모드 · 모델)뿐이다. `collaboration_mode` · `fast-mode`는 그리지 않는다.
  // 모드 칩은 `currentModeId`(agent — 「Auto review」)가 아니라 채팅 파일의 모드다.
  await expect(page).toHaveURL(`/threads/${started.id}`);
  await expect(page.getByRole("main", { name: started.title, exact: true })).toBeVisible();
  await expect(잠긴칩(page, "Codex")).toBeVisible();
  await expect(고르는칩(page, "Codex")).toHaveCount(0);
  await expect(입력창(page).getByRole("button", { name: "Codex 모드 Read-only", exact: true })).toBeVisible();
  expect(await 단추들(page)).toEqual(["파일 첨부", "Codex 모드 Read-only", expect.stringMatching(/^모델과 생각 깊이 /), "보내기"]);
  await expect(입력창(page).getByText("Auto review", { exact: true })).toHaveCount(0);

  // 모드 메뉴는 Codex가 보낸 목록이다 — 고른 것은 채팅 파일의 모드다.
  await 입력창(page).getByRole("button", { name: "Codex 모드 Read-only", exact: true }).click();
  await expect(메뉴(page).getByText("Codex가 정하는 모드예요", { exact: true })).toBeVisible();
  await expect(메뉴(page).getByRole("menuitemradio")).toHaveText([/^Read-only/, /^Workspace access/, /^Auto review/, /^Full access/]);
  await expect(갈래(page, "Read-only")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("고른 Runtime을 확인하는 동안 보내기가 잠기고, 쓸 수 없으면 입력창 자리에 그 Runtime의 카드가 서며, 다른 Runtime으로 바꾸면 카드가 걷히고 쓴 말이 남는다", async ({
  page,
}) => {
  const typed = "로그 파일 정리해 줘";
  await installFixtureBackend(page, {
    thread_check_engine: answerByArg("runtime", { "claude-code": FOUND, codex: CODEX_MISSING }),
  });
  await openHome(page);
  // 첫 화면은 Claude Code를 한 번 확인한다 — 그 답이 온 뒤에 Codex의 확인을 붙잡는다.
  await expect.poll(() => callCount(page, "thread_check_engine")).toBe(1);
  expect((await ipcCallArgs(page, "thread_check_engine", "runtime")).map(({ args }) => args)).toEqual([
    { runtime: "claude-code", reread: false },
  ]);
  await holdCommand(page, "thread_check_engine");

  await 입력칸(page).fill(typed);
  await expect(보내기(page)).toBeEnabled();

  // Codex를 고른 순간 확인한다 — 답이 오기 전에는 보내기가 잠겨 Enter도 보내지 않는다. 쓰기는 그대로다.
  await pickRuntime(page, "Claude Code", "Codex");
  await expect.poll(() => heldCalls(page, "thread_check_engine")).toBe(1);
  await expect(보내기(page)).toBeDisabled();
  await 입력칸(page).press("Enter");
  await expect(입력칸(page)).toHaveValue(typed);
  expect(await callCount(page, "thread_start")).toBe(0);

  // 답이 「못 찾음」 — 입력창 자리에 Codex의 카드가 선다. 입력창은 카드에 자리를 내준다.
  await releaseCommand(page, "thread_check_engine");
  const card = page.getByRole("region", { name: "codex-acp를 찾지 못했어요", exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByText(CODEX_ACP_INSTALL, { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "다시 찾기", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "설치 안내", exact: true })).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);

  // 「Claude Code로 바꾸기」 — 카드가 걷히고 입력창이 쓴 말 그대로 돌아온다. 이미 확인한 Claude Code는 다시 묻지 않는다.
  await card.getByRole("button", { name: "Claude Code로 바꾸기", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toHaveValue(typed);
  await expect(고르는칩(page, "Claude Code")).toBeVisible();
  await expect(보내기(page)).toBeEnabled();
  expect((await ipcCallArgs(page, "thread_check_engine", "runtime")).map(({ args }) => args)).toEqual([
    { runtime: "claude-code", reread: false },
    { runtime: "codex", reread: false },
  ]);
  expect(await callCount(page, "thread_start")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
