import { expect, test } from "./evidence";
import type { Locator, Page } from "./evidence";
import { BUSY_SHELL, QUIET_SHELL, ROOMS, WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  fireEvent,
  installFixtureBackend,
  ipcCallArgs,
  ipcFailure,
  openShell,
  unknownIpcCalls,
} from "./harness";

// 티켓 08 — **닫기 · 아카이브 · 종료 확인 창이 함께 끝날 프로세스 수를 말한다**(프로세스 결정 3 · 프로세스 스펙 S18 ·
// S55 · P6).
//
// 셸을 닫으면 그 셸에서 띄운 것이 모두 끝난다(티켓 04). 그런데 확인 창은 「명령이 도는가」만 말해서, 명령 없이 dev
// 서버만 남은 셸은 묻지도 않고 닫혔다. 백엔드의 닫기 전 물음이 {명령, 자손 수}로 넓어졌고, 이 층은 그 답을 창이
// 어떻게 읽는지를 잰다. 수를 세는 규칙(셸 도우미 · 예외 · foreground 그룹을 뺀다)은 Rust 판정 표가 든다 — 여기서는
// 답 하나를 통째로 덮어 창의 갈래를 편다.
//
// 셸 하나의 닫기는 `pty_close_check`(셸 하나의 답), 아카이브와 종료는 `pty_close_checks`(pty id → 답, 스냅샷
// 한 장)를 부른다.

const [, plainWork] = WORKS;
const [, readingRoom] = ROOMS;

const CLOSE_NOTICE = "실행 중인 명령이 있어요 — 닫을까요?";

const closeDialog = (page: Page) => page.getByRole("alertdialog", { name: "셸 닫기" });
const quitDialog = (page: Page) => page.getByRole("alertdialog", { name: "Atelier 종료" });
const shells = (page: Page) => page.locator('[data-tab="shell"]');

/**
 * 창 본문의 **줄들**. 본문은 창의 설명(`aria-describedby`)이 가리키는 줄이다. `innerText`는 CSS가 그린 대로 읽어,
 * 본문의 줄바꿈이 화면에서 한 줄로 접히면 여기서도 한 줄이다 — 「명령 문구 **아래**」를 재는 자리가 그것이다.
 */
async function bodyLines(dialog: Locator): Promise<string[]> {
  const id = await dialog.getAttribute("aria-describedby");
  if (!id) return [];
  return (await dialog.page().locator(`[id="${id}"]`).innerText()).split("\n");
}

/** 본문의 마지막 줄 — 아카이브 확인 창의 셸 줄이 선다. */
const lastLine = (lines: string[]): string | undefined => lines[lines.length - 1];

/** 켜진 셸 탭의 `×`. 셸 탭의 ×, ⌘W, 셸 메뉴의 닫기는 같은 길(`requestCloseShell`)을 탄다. */
const closeActiveShell = (page: Page) =>
  page.locator('[data-tab="shell"] button[aria-label$="닫기"]').first().click();

// ── 셸 닫기 확인 창(P6) ──

test("명령이 돌고 자손도 있으면 명령 문구 아래에 함께 끝날 수를 적는다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_check: { command: true, descendants: 2 } });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await closeActiveShell(page);

  const dialog = closeDialog(page);
  await expect(dialog).toBeVisible();
  expect(await bodyLines(dialog)).toEqual([CLOSE_NOTICE, "이 셸에서 띄운 프로세스 2개도 함께 끝나요."]);
  // 창을 거쳐 닫는다 — 둘째 줄이 섰어도 닫는 길은 그대로다.
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect.poll(async () => (await ipcCallArgs(page, "pty_kill", "id")).map(({ args }) => args.id)).toEqual([1]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 수가 0이면 둘째 줄이 없다 — 「0개도 함께 끝나요」는 거짓말은 아니지만 읽을 까닭이 없는 줄이다.
test("명령만 돌면 지금 문구 그대로다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_check: BUSY_SHELL });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await closeActiveShell(page);

  const dialog = closeDialog(page);
  await expect(dialog).toBeVisible();
  expect(await bodyLines(dialog)).toEqual([CLOSE_NOTICE]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **새로 묻는 갈래다**(프로세스 결정 3). ux-papercuts 결정 92는 「foreground가 셸이 아닐 때만 묻는다」였다 — 빈
// 프롬프트에 dev 서버만 남은 셸은 묻지 않고 닫혀 그 서버가 조용히 끝났다. 빈 프롬프트에는 명령이 없으니(CONTEXT
// 「명령」) 명령 문구는 안 선다.
test("명령 없이 자손만 있으면 그 수로 묻는다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_check: { command: false, descendants: 3 } });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await closeActiveShell(page);

  const dialog = closeDialog(page);
  await expect(dialog).toBeVisible();
  expect(await bodyLines(dialog)).toEqual(["이 셸에서 띄운 프로세스 3개가 아직 돌아요. 닫을까요?"]);
  // 「취소」면 안 닫는다 — 새 갈래도 물은 답을 존중한다.
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(shells(page)).toHaveCount(1);
  expect(await callCount(page, "pty_kill")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 명령도 자손도 없으면(스토리 6) 지금처럼 묻지 않는다 — p10k 셸의 `gitstatusd`는 셸 도우미라 백엔드가 수에서
// 뺐다(Rust `asking_before_a_close_counts_what_a_person_spawned`).
test("명령도 자손도 없으면 묻지 않고 닫는다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_check: QUIET_SHELL });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await closeActiveShell(page);

  // 앵커: 물음이 나갔고 그 답으로 닫았다 — 묻기 전에 닫은 것이 아니다.
  await expect.poll(async () => (await ipcCallArgs(page, "pty_kill", "id")).map(({ args }) => args.id)).toEqual([1]);
  expect(await callCount(page, "pty_close_check")).toBe(1);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 아카이브 확인 창(S18) ──

/** 작업 화면(터미널 탭)에서 셸 하나가 뜬 뒤 ⋯ 메뉴의 「아카이빙」을 누른다. 확인 창을 돌려준다. */
async function askToArchive(page: Page, path: string, menu: string, title: string): Promise<Locator> {
  await page.goto(`${path}?tab=terminal`);
  await awaitSpawned(page, 1);
  await page.getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menuitem", { name: "아카이빙", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: `'${title}' 아카이빙` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("아카이브 확인 창이 셸 수 뒤에 띄운 프로세스 수를 붙인다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: { 1: { command: true, descendants: 2 } } });
  const dialog = await askToArchive(page, `/works/${plainWork.slug}`, "작업 메뉴", plainWork.title);

  expect(lastLine(await bodyLines(dialog))).toBe("셸 1개가 닫혀요(띄운 프로세스 2개 포함).");
  // 셸 하나의 물음을 셸마다 부르지 않는다 — 스냅샷 한 장짜리 배치 한 번이다.
  expect(await ipcCallArgs(page, "pty_close_checks", "ids")).toEqual([
    { call: 'pty_close_checks {"ids":[1]}', args: { ids: [1] } },
  ]);
  expect(await callCount(page, "pty_close_check")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 두 세계가 같다 — Room을 아카이브할 때도 같은 문구다.
test("Room의 아카이브 확인 창도 같은 문구다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: { 1: { command: false, descendants: 1 } } });
  const dialog = await askToArchive(page, `/maison/rooms/${readingRoom.slug}`, "Room 메뉴", readingRoom.title);

  expect(lastLine(await bodyLines(dialog))).toBe("셸 1개가 닫혀요(띄운 프로세스 1개 포함).");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("띄운 프로세스가 없으면 아카이브 확인 창은 셸 수만 말한다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: { 1: BUSY_SHELL } });
  const dialog = await askToArchive(page, `/works/${plainWork.slug}`, "작업 메뉴", plainWork.title);

  // 앵커: 물음이 나갔다 — 안 물어서 안 붙은 것이 아니다.
  expect(await callCount(page, "pty_close_checks")).toBe(1);
  expect(lastLine(await bodyLines(dialog))).toBe("셸 1개가 닫혀요.");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 못 얻으면 붙이지 않는다 — 모르는 수를 말하지 않고, 그렇다고 아카이브를 막지도 않는다.
test("물음이 거절되면 아카이브 확인 창은 셸 수만 말하고 그대로 뜬다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: ipcFailure("PTY 풀을 읽지 못했습니다") });
  const dialog = await askToArchive(page, `/works/${plainWork.slug}`, "작업 메뉴", plainWork.title);

  expect(await callCount(page, "pty_close_checks")).toBe(1);
  expect(lastLine(await bodyLines(dialog))).toBe("셸 1개가 닫혀요.");
});

// ── 종료 확인 창(S18) ──
// K(「명령이 도는 셸」)는 여전히 명령이 도는 셸 수다. 자손만 있는 셸은 셸 닫기라면 물을 셸이지만 K에는 안 들고 M에
// 든다 — 그렇지 않으면 창의 글자 「명령이 도는 셸」이 거짓이 된다.

/** Terminal에 셸 둘(pty 1 · 2)을 세우고 종료 요청을 쏜다. */
async function askToQuit(page: Page): Promise<Locator> {
  await page.goto("/terminal");
  await expect(shells(page)).toHaveCount(1);
  await openShell(page);
  await fireEvent(page, "app:quit-requested", null);
  const dialog = quitDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test("종료 확인 창이 셸 수 뒤에 띄운 프로세스 수를 붙이고, 자손만 있는 셸은 명령이 도는 셸에 안 든다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    pty_close_checks: {
      1: { command: true, descendants: 1 },
      2: { command: false, descendants: 2 },
    },
  });
  const dialog = await askToQuit(page);

  expect(await bodyLines(dialog)).toEqual(["셸 2(띄운 프로세스 3개 포함) · 명령이 도는 셸 1"]);
  // 셸마다 부르지 않는다 — 셸 둘이어도 배치 한 번이다.
  expect(await callCount(page, "pty_close_checks")).toBe(1);
  expect(await callCount(page, "pty_close_check")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("띄운 프로세스가 없으면 종료 확인 창은 지금 줄 그대로다", async ({ page }) => {
  await installFixtureBackend(page, {
    pty_close_checks: {
      1: QUIET_SHELL,
      2: BUSY_SHELL,
    },
  });
  const dialog = await askToQuit(page);

  expect(await bodyLines(dialog)).toEqual(["셸 2 · 명령이 도는 셸 1"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 거절돼도 창은 뜬다 — 창이 못 뜨는 길은 곧 앱을 끌 수 없는 길이다(UI개선 결정 31).
test("물음이 거절되면 종료 확인 창은 셸 수만 말하고 그대로 뜬다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: ipcFailure("PTY 풀을 읽지 못했습니다") });
  const dialog = await askToQuit(page);

  expect(await callCount(page, "pty_close_checks")).toBe(1);
  expect(await bodyLines(dialog)).toEqual(["셸 2 · 명령이 도는 셸 0"]);
});
