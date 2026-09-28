import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  installFixtureBackend,
  ipcCallArgs,
  kills,
  navButton,
  openShell,
  unknownIpcCalls,
  writeShell,
  셸입력,
  칸들,
} from "./harness";

// 티켓 07 — **둘러보다 저절로 뜬 셸이 입력 없이 화면을 떠나면 닫힌다**(프로세스 결정 7 · 프로세스 스펙 S16 · S17).
//
// 판정은 순수 함수라 L2의 표가 센다 — 사람 입력(`shell-input.test.ts`), 떠남(`shell-leave.test.ts`). **이 층이
// 재는 것은 그 판정이 진짜 사건에 붙어 있는가**다: 진짜 키가 xterm의 키 핸들러를 지나고, 진짜 라우팅이 owner를
// 바꾸고, 진짜 xterm이 커서 위치를 묻는 바이트에 답한다. 셋 중 하나만 끊겨도 표는 초록인 채로 셸이 쌓이거나,
// 쓰던 셸이 떠날 때마다 닫힌다.
//
// **「안 불린다」는 앵커를 먼저 본다.** 닫기는 라우터가 바뀐 뒤 이펙트에서 나가서, 화면이 옮겨진 것만 보고
// 세면 아직 안 나간 호출을 「안 불렸다」로 읽는다. 그래서 같은 떠남 사슬에서 **다른 셸의 `pty_kill`이 나간 것**을
// 먼저 기다린다 — 그 뒤에 센 0은 진짜 0이다.

const [pinnedWork, plainWork] = WORKS;

/** 지금까지 닫힌 셸의 pty id, 불린 순서대로. */
async function killed(page: Page): Promise<unknown[]> {
  return (await kills(page)).map(({ id }) => id);
}

/** 사이드바에서 그 work을 누른다 — SPA 이동이라 스토어가 산다(주소를 치면 페이지가 새로 뜬다). */
async function toWork(page: Page, work: (typeof WORKS)[number]): Promise<void> {
  await page.getByRole("button", { name: work.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${work.slug}(\\?|$)`));
}

/** nav의 `Terminal` — 그 세계의 최상위 터미널도 owner다(life-mode 결정 10). 들어가면 셸이 저절로 하나 뜬다. */
async function toTerminal(page: Page): Promise<void> {
  await navButton(page, "Terminal").click();
  await expect(page).toHaveURL("/terminal");
}

/**
 * 그 셸에 사람이 키 하나를 친다. 포커스가 셸에 없으면 키가 xterm에 안 닿으므로 먼저 본다 — 셸을 붙이면 입력칸이 스스로
 * 포커스를 가져간다(하네스의 `셸입력`).
 */
async function typeKey(page: Page): Promise<void> {
  await expect(셸입력(page)).toBeFocused();
  await page.keyboard.type("l");
}

test("자동으로 뜬 셸이 입력 없이 다른 work으로 가면 닫힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  await toWork(page, plainWork);

  await expect.poll(() => killed(page), { message: "떠났는데 자동 셸이 안 닫혔다" }).toEqual([1]);
  // 사람 입력이 없었다 — 백엔드에 알린 것도 없다.
  expect(await callCount(page, "pty_first_input")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("키를 친 셸은 떠나도 남고, 첫 입력을 백엔드에 한 번 알린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  await typeKey(page);
  await page.keyboard.type("s");
  // 첫 입력은 한 번만 나간다 — 그 셸의 pty로, 사람 입력을 본 순간의 에포크 ms를 싣고.
  await expect.poll(async () => (await ipcCallArgs(page, "pty_first_input", "id")).length).toBe(1);
  const [{ args }] = await ipcCallArgs(page, "pty_first_input", "id");
  expect(args.id).toBe(1);
  expect(typeof args.at === "number" && args.at > 1_700_000_000_000, `시각이 아니다: ${args.at}`).toBe(true);

  // 최상위 터미널로 떠난다 — 거기서 셸이 저절로 하나 뜬다(pty 2). 입력 없이 그 화면도 떠나 돌아온다.
  await toTerminal(page);
  await expect(칸들(page)).toHaveCount(1);
  await expect.poll(() => callCount(page, "pty_spawn")).toBe(2);
  await toWork(page, pinnedWork);

  // **앵커** — 같은 사슬의 떠남이 입력 없는 셸은 닫았다. 그 뒤라야 아래 「안 닫혔다」가 뜻을 갖는다.
  await expect.poll(() => killed(page), { message: "앵커: 최상위 터미널의 자동 셸이 안 닫혔다" }).toEqual([2]);
  // 키를 친 셸은 그대로다 — 돌아온 화면에 그 한 칸이 서 있고 새로 뜬 셸이 없다.
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(칸들(page)).toHaveCount(1);
  expect(await callCount(page, "pty_spawn")).toBe(2);
  expect(await callCount(page, "pty_first_input")).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("같은 work의 spec 탭으로만 바꾸면 떠남이 아니다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // 터미널 패인이 내려간다 — 그래도 owner는 그대로다.
  await page.locator('[data-tab="spec"]').click();
  await expect(page).not.toHaveURL(/tab=terminal/);
  await expect(page.locator('[data-tab="spec"]')).toHaveAttribute("aria-pressed", "true");
  // 셸 칸으로 돌아온다. 닫혔다면 돌아오는 화면이 셸 0개라 새 셸이 저절로 떴을 것이다.
  await 칸들(page).click();
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(page.locator(".xterm-screen")).toBeVisible();
  expect(await callCount(page, "pty_spawn")).toBe(1);

  // **앵커** — 진짜 떠남에서는 같은 셸이 닫힌다. 여기가 빨가면 위의 0은 회수가 아예 안 도는 0이었다.
  await toTerminal(page);
  await expect.poll(() => killed(page), { message: "앵커: 떠났는데 안 닫혔다" }).toEqual([1]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("회수된 화면에 다시 오면 새 셸이 저절로 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  await toTerminal(page);
  await expect.poll(() => killed(page)).toEqual([1]);
  await expect.poll(() => callCount(page, "pty_spawn")).toBe(2);

  // 사이드바는 그 work에서 보던 화면(터미널)을 되살린다(ux-papercuts 결정 77).
  await toWork(page, pinnedWork);
  await expect(page).toHaveURL(/tab=terminal/);
  await expect.poll(() => callCount(page, "pty_spawn"), { message: "돌아왔는데 셸이 안 떴다" }).toBe(3);
  await expect(칸들(page)).toHaveCount(1);
  // 떠나온 최상위 터미널의 자동 셸도 같은 규칙으로 닫혔다.
  await expect.poll(() => killed(page)).toEqual([1, 2]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// p10k는 프롬프트를 그릴 때마다 커서 위치를 묻는다. xterm이 그 물음에 답하는 바이트(CPR · DA)는 사람이 친 키와
// 같은 출구(`onData` → `pty_write`)로 나간다 — 그것을 입력으로 세면 모든 셸이 「입력을 받은」 셸이 된다(스토리 29).
// **물음은 진짜 xterm 파서가 받는다**(`writeShell`) — 흉내 낸 이벤트로는 xterm이 답하는 길을 한 글자도 못 잰다.
test("xterm이 커서 위치 · 장치 속성에 답해도 입력 없는 셸이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // DSR 6(커서 위치)과 DA1(장치 속성).
  await writeShell(page, "\x1b[6n\x1b[c");
  // **앵커** — xterm이 실제로 답했다. 답이 셸로 안 나갔으면 아래 닫힘은 아무것도 안 잰다.
  await expect
    .poll(async () => (await ipcCallArgs(page, "pty_write", "id")).map(({ args }) => String(args.data)).join(""))
    .toMatch(/\x1b\[\d+;\d+R.*\x1b\[\?[\d;]+c/s);

  await toWork(page, plainWork);
  await expect.poll(() => killed(page), { message: "xterm의 응답이 사람 입력으로 세였다" }).toEqual([1]);
  expect(await callCount(page, "pty_first_input")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`+`로 연 셸은 입력이 없어도 떠날 때 안 닫힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openShell(page);

  await toTerminal(page);
  // **앵커** — 같은 떠남이 자동 셸은 닫았다.
  await expect.poll(() => killed(page), { message: "앵커: 자동 셸이 안 닫혔다" }).toEqual([1]);
  // 사람이 연 셸(pty 2)은 남는다. 돌아오면 그 칸이 서 있어 새 셸이 저절로 뜨지도 않는다.
  await toWork(page, pinnedWork);
  await expect.poll(() => killed(page)).toEqual([1, 3]);
  await expect(칸들(page)).toHaveCount(1);
  expect(await callCount(page, "pty_spawn")).toBe(3);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 한글은 WKWebView가 조합 사건 없이 `input` 사건으로 준다 — IME 다리가 붙들었다가 확정되는 순간 보낸다
// (`terminal-ime.ts`). 여기서는 **키다운 없이** 입력 사건만 쏜다: 다리가 보낸 것만으로 입력이 서는지 가른다.
// 대본은 두벌식 「안」 다음 「ㄴ」(실측 대본 — `terminal-ime.test.ts`).
test("한글만 친 셸은 떠나도 남는다 — IME 다리가 보낸 조합이 입력이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expect(셸입력(page)).toBeFocused();

  // 사건은 셸의 입력칸에 쏜다 — 집는 길은 하네스의 `셸입력` 하나다(클래스 문자열로 집지 않는다).
  await 셸입력(page).evaluate((textarea) => {
    for (const [inputType, data] of [
      ["insertText", "ㅇ"],
      ["insertReplacementText", "아"],
      ["insertReplacementText", "안"],
      ["insertText", "ㄴ"],
    ]) {
      textarea.dispatchEvent(new InputEvent("input", { inputType, data, bubbles: true }));
    }
  });
  // 다리가 「안」을 확정해 셸로 보냈다.
  await expect
    .poll(async () => (await ipcCallArgs(page, "pty_write", "id")).map(({ args }) => args.data))
    .toContain("안");
  await expect.poll(() => callCount(page, "pty_first_input")).toBe(1);

  await toTerminal(page);
  await toWork(page, pinnedWork);
  // **앵커** — 최상위 터미널의 입력 없는 자동 셸은 닫혔다.
  await expect.poll(() => killed(page), { message: "앵커: 자동 셸이 안 닫혔다" }).toEqual([2]);
  await expect(칸들(page)).toHaveCount(1);
  expect(await callCount(page, "pty_spawn")).toBe(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 붙여넣기는 키다운 없이 셸에 글자를 보낸다(메뉴의 Paste · 우클릭). 사건은 xterm의 숨은 입력칸에 선다.
test("붙여넣기만 한 셸도 떠나도 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expect(셸입력(page)).toBeFocused();

  await 셸입력(page).evaluate((textarea) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "pnpm dev");
    textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  // xterm이 붙여넣은 글자를 셸로 보냈다.
  await expect
    .poll(async () => (await ipcCallArgs(page, "pty_write", "id")).map(({ args }) => String(args.data)).join(""))
    .toContain("pnpm dev");
  await expect.poll(() => callCount(page, "pty_first_input")).toBe(1);

  await toTerminal(page);
  await toWork(page, pinnedWork);
  await expect.poll(() => killed(page), { message: "앵커: 자동 셸이 안 닫혔다" }).toEqual([2]);
  await expect(칸들(page)).toHaveCount(1);
  expect(await callCount(page, "pty_spawn")).toBe(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
