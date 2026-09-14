import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import { MAX_SHELLS } from "./tab-row";
import {
  badgeCalls,
  callCount,
  exitShell,
  heldSpawns,
  holdPtySpawn,
  holdTerminalFonts,
  installFixtureBackend,
  ipcCallArgs,
  markRunning,
  ptyGrids,
  refuseFirstSpawn,
  releaseSpawns,
  sentNotifications,
  setWindowFocused,
  spawnedCwds,
  stubNotifications,
  stubWindowFocus,
  unknownIpcCalls,
  writeShell,
} from "./harness";

// **글꼴이 오는 사이에 사람이 무엇을 해도, 연 셸은 전부 뜬다**(결정 20·21).
//
// 셸은 터미널 글꼴(0.94MB)이 온 뒤에야 열리고 뜬다(`terminal-store`의 `loadFont`). 한때 그
// 순간 칸이 DOM에 붙어 있을 때만 띄워서, 그 틈에 둘째 칸을 켜거나 화면을 옮기면 떼어진 칸의
// 셸이 사람이 그 칸을 다시 볼 때까지 시작도 안 했다 — 탭은 `셸`인 채로 남고 pty 번호도 칸
// 순서와 뒤섞였다. 기본 시나리오 둘(`+` · work 화면과 `/terminal`)은 `terminal-tabs.spec.ts`의
// 마지막 마디에 있고, 여기는 그 고침이 함께 지켜야 하는 나머지 갈래다.
//
// **전부 글꼴을 붙잡고 시작한다**(`holdTerminalFonts`). 안 붙잡으면 틈이 러너 속도에 매여
// 한가한 날에는 무엇을 고쳐도 초록이다. 그리고 **안 본 칸을 누르기 전에 먼저 잰다** — 누르면
// 다시 붙는 길이 그 칸을 열어, 「뒤에서도 돈다」가 아니라 「보면 뜬다」를 재게 된다.
//
// **「셸이 떴다」의 화면 신호는 칸의 닫기 이름이다.** 픽스처의 셸 이름(`FIXTURE_SHELL_NAME`)은
// spawn 응답이 앉는 자리에서 칸에 적힌다(`harness`의 `awaitSpawned` 머리말). 닫기 버튼은 칸이
// 붐비면 `display:none`으로 접히므로 역할이 아니라 속성으로 센다.

const [, plainWork] = WORKS;

const tabs = (page: Page) => page.locator('[data-tab="shell"]');
/** n번째 칸(0부터)이 그 이름의 닫기를 가졌는가 — 칸마다 본다. 전체 수로 세면 어느 칸인지가 안 남는다. */
const closeOf = (page: Page, at: number, name: string) =>
  tabs(page).nth(at).locator(`button[aria-label="${name} 닫기"]`);

async function expectEveryTabStarted(page: Page, count: number): Promise<void> {
  await expect(tabs(page)).toHaveCount(count);
  for (let at = 0; at < count; at += 1) {
    await expect(closeOf(page, at, FIXTURE_SHELL_NAME), `${at + 1}번째 칸의 셸이 안 떴다`).toHaveCount(1, {
      timeout: 20_000,
    });
  }
}

const ESC = "\x1b";
const BEL = "\x07";

const OPEN_FAILURE = "L3가 xterm 열기를 터뜨렸다";

/**
 * xterm이 제 상자를 붙이는 `appendChild` 하나를 가로챌 준비를 한다 — 켜기 전에는 아무것도 안 한다
 * (`failXtermOpen`). 그 밖의 DOM은 그대로 둔다. 페이지가 뜨기 전에 깔아야 한다.
 */
async function armXtermOpenFailure(page: Page): Promise<void> {
  await page.addInitScript((message: string) => {
    const append = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(this: Node, child: T): T {
      const win = window as unknown as { __ATELIER_FAIL_XTERM_OPEN__?: boolean };
      if (win.__ATELIER_FAIL_XTERM_OPEN__ && child instanceof Element && child.classList.contains("xterm")) {
        const counted = window as unknown as { __ATELIER_XTERM_OPEN_FAILURES__?: number };
        counted.__ATELIER_XTERM_OPEN_FAILURES__ = (counted.__ATELIER_XTERM_OPEN_FAILURES__ ?? 0) + 1;
        throw new Error(message);
      }
      return append.call(this, child) as T;
    };
  }, OPEN_FAILURE);
}

/** 터뜨린 열기의 수(`armXtermOpenFailure`). */
const xtermOpenFailures = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __ATELIER_XTERM_OPEN_FAILURES__?: number }).__ATELIER_XTERM_OPEN_FAILURES__ ?? 0,
  );

/**
 * 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 두 프레임을 넘긴다. **「없다」를 재기 전에 부른다**:
 * `not.toContainText`는 되풀이하다 참인 순간 멈추므로, 덮어쓰기가 아직 안 그려진 순간에 초록이 된다.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** 이 뒤로 처음 여는 xterm이 터진다(`armXtermOpenFailure`). */
async function failXtermOpen(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __ATELIER_FAIL_XTERM_OPEN__?: boolean }).__ATELIER_FAIL_XTERM_OPEN__ = true;
  });
}

// ─── ⌘T를 여러 번 — 상한까지 ───
//
// 사람이 가장 빨리 칸을 여는 길이 ⌘T 연타다. 글꼴이 오기 전이라 셸에 포커스가 없고, 그래서
// 창 리스너가 받는다(`tab-keys.spec.ts`의 둘째 검사가 그 길을 따로 든다).
//
// **상한까지 채운다**(결정 30·47). 상한은 목록을 세는 것이라(`atCap`) 아직 안 뜬 칸도 한 칸이다 —
// 아홉째 ⌘T는 칸을 안 세우고, 그 여덟이 전부 뜬다.
//
// **spawn은 칸마다 정확히 한 번, 연 순서대로 나간다.** 수가 넘치면 어느 칸이 둘 떴고, 순서가
// 어긋나면 픽스처의 pty 번호가 칸과 갈린다. 순서는 **안 연 칸에 타이틀을 쏴서** 잰다 — pty n에
// 쏜 타이틀이 n번째 칸 이름이 되어야 한다. 그 칸들은 한 번도 안 열린 xterm이라 이것이 곧
// 「안 연 xterm도 받아 파싱한다」의 증거다.
test("글꼴이 오기 전에 ⌘T로 상한까지 열어도 여덟 셸이 연 순서대로 한 번씩 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });

  await expect(tabs(page)).toHaveCount(1);
  for (let n = 1; n < MAX_SHELLS; n += 1) {
    await page.keyboard.press("Meta+t");
    await expect(tabs(page)).toHaveCount(n + 1);
  }
  await expect(page.locator('[data-tab="new"]')).toHaveAttribute("aria-disabled", "true");
  // 상한에서의 ⌘T는 칸을 안 세운다 — 안 뜬 칸도 상한에 세어진다.
  await page.keyboard.press("Meta+t");
  await expect(tabs(page)).toHaveCount(MAX_SHELLS);

  await releaseFonts();

  await expectEveryTabStarted(page, MAX_SHELLS);
  expect(await callCount(page, "pty_spawn"), "셸마다 한 번씩만 떠야 한다").toBe(MAX_SHELLS);

  for (let pty = 1; pty <= MAX_SHELLS; pty += 1) {
    await writeShell(page, `${ESC}]0;셸-${pty}${BEL}`, pty);
  }
  for (let at = 0; at < MAX_SHELLS; at += 1) {
    await expect(closeOf(page, at, `셸-${at + 1}`), `${at + 1}번째 칸이 ${at + 1}번 pty가 아니다`).toHaveCount(1);
  }

  // **다시 붙어도 또 안 뜬다.** 한때 spawn이 「처음 열 때」에 매여 있었다 — 안 연 칸을 처음 여는
  // 이 순간이 그 자리였다.
  await tabs(page).nth(0).locator("button[aria-pressed]").click();
  await expect(tabs(page).nth(0).locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
  // 붙은 것은 늘 켜진 칸 하나다(떼면 DOM에서 빠진다) — 그 하나가 열렸다는 것을 보고 센다.
  await expect(page.locator(".xterm-screen")).toBeVisible();
  expect(await callCount(page, "pty_spawn")).toBe(MAX_SHELLS);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 떼어진 채 뜬 셸이 처음 붙을 때 격자 ───
//
// 떼어진 칸은 잴 상자가 없어 xterm의 기본 격자로 뜬다(`loadFont` 머리말). 처음 붙는 순간
// `fit()`이 격자를 바꾸고 그 값이 PTY로 가야 한다 — 안 가면 셸이 80칸에 갇혀 줄이 엉뚱한
// 자리에서 꺾인다. 기준은 **글꼴이 올 때 붙어 있던 칸**이다: 같은 자리에서 제 격자로 떴다.
test("떼어진 채 뜬 셸이 처음 보일 때 PTY 격자가 화면 격자로 맞춰진다", async ({ page }) => {
  await installFixtureBackend(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`, { waitUntil: "domcontentloaded" });

  await expect(tabs(page)).toHaveCount(1);
  await page.locator('[data-tab="new"]').click();
  await expect(tabs(page)).toHaveCount(2);
  await releaseFonts();
  await expectEveryTabStarted(page, 2);

  // 둘째 칸은 붙은 채 열리고 떴다 — 그 격자가 이 자리의 화면 격자다.
  const shown = (await ptyGrids(page)).get(2);
  expect(shown, "둘째 칸의 격자를 못 읽었다").toBeDefined();
  expect(shown!.cols).toBeGreaterThan(2);
  expect(shown!.rows).toBeGreaterThan(1);
  // **그 격자는 spawn에 실려 나간 것이다 — 뒤따른 resize로 맞춘 것이 아니다.** 붙어 있는 칸은 열고
  // 맞춘 **뒤에** 띄운다(`loadFont`). 거꾸로 띄우면 보이는 셸까지 기본 격자로 떴다가 곧바로
  // SIGWINCH를 받는데, 격자만 보면 그 둘이 끝에서 같은 값이 된다.
  expect(await ipcCallArgs(page, "pty_resize", "id")).toEqual([]);
  // **첫 칸은 다른 격자로 떴다** — 아래 「화면 격자로 맞춰졌다」가 resize 없이 우연히 같은 값으로
  // 초록이 되는 자리를 먼저 닫는다.
  expect((await ptyGrids(page)).get(1), "첫 칸이 이미 화면 격자로 떴다 — 맞춤을 잴 수 없다").not.toEqual(shown);

  await tabs(page).nth(0).locator("button[aria-pressed]").click();
  await expect(tabs(page).nth(0).locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");

  await expect.poll(async () => (await ptyGrids(page)).get(1), { message: "첫 칸의 PTY 격자가 화면에 안 맞았다" })
    .toEqual(shown);
  expect((await ipcCallArgs(page, "pty_resize", "id")).map(({ args }) => args.id)).toEqual([1]);
  // 둘째 칸은 떼어졌을 뿐 격자가 안 바뀌었다 — 떼는 것이 2×1 같은 헛격자를 보내면 여기서 갈린다.
  expect((await ptyGrids(page)).get(2)).toEqual(shown);
  expect(await callCount(page, "pty_spawn")).toBe(2);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 글꼴이 오기 전에 화면을 떠난다 ───
//
// 첫 화면에 들어오자마자 다른 work·`/terminal`로 옮기면 **켜져 있던 칸까지** 떼어진다 — 화면이
// 통째로 내려가서다. 두고 온 셸도 뒤에서 떠야 한다. 사람에게 그것이 보이는 자리는 사이드바다:
// 그 work 행이 그 셸에서 도는 것을 말한다(결정 2).
test("글꼴이 오기 전에 work 화면을 떠나도 두고 온 셸이 뜨고 사이드바가 그 셸을 말한다", async ({ page }) => {
  await installFixtureBackend(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`, { waitUntil: "domcontentloaded" });
  await expect(tabs(page)).toHaveCount(1);

  await page.locator("nav").getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page).toHaveURL("/terminal");
  await expect(tabs(page)).toHaveCount(1);

  await releaseFonts();
  await expectEveryTabStarted(page, 1);
  // **둘 다 떴고, 연 순서대로다** — 두고 온 work 셸이 먼저다.
  await expect.poll(() => callCount(page, "pty_spawn")).toBe(2);
  const [workCwd, topCwd] = await spawnedCwds(page);
  expect(workCwd, "첫 spawn이 work 셸이 아니다").not.toEqual(topCwd);

  // pty 1 = 두고 온 work 셸. 그 work 행에 로고가 서야 한다 — 최상위 셸에 앉으면 nav 행에 선다.
  await markRunning(page, "claude", 1);
  await expect(page.locator(`[data-shells="${plainWork.slug}"]`).getByRole("img", { name: "claude" })).toHaveCount(1);
  await expect(page.locator("nav").getByRole("img", { name: "claude" })).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 세계를 갈면 그 세계의 화면으로 가서 터미널이 통째로 내려간다. 두고 온 셸은 **제 세계로** 떠야
// 한다 — spawn이 싣는 모드가 셸의 홈과 `ATELIER_MODE`를 정한다(결정 10 · #187).
for (const [from, to, url] of [
  ["atelier", "Maison", "/terminal"],
  ["maison", "Atelier", "/maison/terminal"],
] as const) {
  test(`글꼴이 오기 전에 ${to}로 갈아도 두고 온 ${from} 셸이 제 세계로 뜬다`, async ({ page }) => {
    await installFixtureBackend(page);
    const releaseFonts = await holdTerminalFonts(page);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(tabs(page)).toHaveCount(1);

    await page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: to, exact: true }).click();
    await expect(page).not.toHaveURL(url);
    await expect(tabs(page)).toHaveCount(0);

    await releaseFonts();
    await expect
      .poll(async () => (await ipcCallArgs(page, "pty_spawn", "mode")).map(({ args }) => args.mode), {
        message: "두고 온 셸이 안 떴거나 다른 세계로 떴다",
        timeout: 20_000,
      })
      .toEqual([from]);

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// ─── 뜨기 전에 닫는다 ───
//
// **글꼴이 오기 전의 `×`**: 물을 프로세스가 없어 확인 없이 닫히고(결정 92), 그 칸은 영영 안
// 뜬다. 「안 떴다」는 그 자체로는 아무것도 안 재므로 남은 칸이 떴다는 것과 함께 센다.
test("글꼴이 오기 전에 닫은 칸은 안 뜨고, 남은 칸만 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
  await expect(tabs(page)).toHaveCount(1);
  await page.locator('[data-tab="new"]').click();
  await expect(tabs(page)).toHaveCount(2);

  // 안 켜진 첫 칸을 닫는다.
  await closeOf(page, 0, "셸").click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(1);

  await releaseFonts();
  await expectEveryTabStarted(page, 1);
  expect(await callCount(page, "pty_spawn")).toBe(1);
  expect(await callCount(page, "pty_kill")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **spawn 응답이 오기 전의 `×`**: 떼어진 채 띄우러 나간 칸을 닫으면, 늦게 온 그 셸을 응답 자리에서
// 죽여야 한다 — 안 죽이면 목록에도 상한에도 없는 셸이 ⌘Q까지 돈다.
test("떼어진 채 띄우러 나간 셸을 응답 전에 닫으면 늦게 온 그 셸을 거둔다", async ({ page }) => {
  await installFixtureBackend(page);
  await holdPtySpawn(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
  await expect(tabs(page)).toHaveCount(1);
  await page.locator('[data-tab="new"]').click();
  await expect(tabs(page)).toHaveCount(2);

  await releaseFonts();
  // **두 칸 다 띄우러 나갔다** — 첫 칸은 떼어진 채다.
  await expect.poll(() => heldSpawns(page), { timeout: 20_000 }).toBe(2);

  await closeOf(page, 0, "셸").click();
  await expect(tabs(page)).toHaveCount(1);
  await releaseSpawns(page);

  await expectEveryTabStarted(page, 1);
  await expect
    .poll(async () => (await ipcCallArgs(page, "pty_kill", "id")).map(({ args }) => args.id))
    .toEqual([1]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **아카이빙이 거둔다**(결정 26 · `closeShellsOf`). 셸이 아직 응답을 기다리는 중이어도 같다 — 그 work
// 칸이 전부, 늦게 온 셸까지 죽는다.
test("응답을 기다리는 셸이 있는 work을 아카이빙하면 늦게 온 셸들을 전부 거둔다", async ({ page }) => {
  await installFixtureBackend(page);
  await holdPtySpawn(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`, { waitUntil: "domcontentloaded" });
  await expect(tabs(page)).toHaveCount(1);
  await page.locator('[data-tab="new"]').click();
  await expect(tabs(page)).toHaveCount(2);

  await releaseFonts();
  await expect.poll(() => heldSpawns(page), { timeout: 20_000 }).toBe(2);

  await page.getByRole("button", { name: "작업 메뉴", exact: true }).click();
  await page.getByRole("button", { name: "아카이빙", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "아카이빙", exact: true }).click();
  await expect(tabs(page)).toHaveCount(0);

  await releaseSpawns(page);
  await expect
    .poll(async () => (await ipcCallArgs(page, "pty_kill", "id")).map(({ args }) => args.id).sort())
    .toEqual([1, 2]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 안 본 칸의 실패와 신호 ───
//
// **spawn이 거절당한 칸이 안 본 칸이어도 그 이유가 남는다**(결정 23). 붙는 순간 그 칸에 적힌
// 이유가 보여야 한다 — 이유 없는 빈 화면이 가장 나쁘다.
test("안 본 칸의 셸이 못 뜨면 그 칸을 볼 때 이유가 보이고, 옆 칸은 멀쩡히 뜬다", async ({ page }) => {
  const reason = "L3가 첫 spawn을 거절했다";
  await installFixtureBackend(page);
  await refuseFirstSpawn(page, reason);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
  await expect(tabs(page)).toHaveCount(1);
  await page.locator('[data-tab="new"]').click();
  await expect(tabs(page)).toHaveCount(2);

  await releaseFonts();
  // 거절당한 것은 **먼저 연** 첫 칸이다 — 둘째 칸이 뜬다.
  await expect(closeOf(page, 1, FIXTURE_SHELL_NAME)).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator("[data-shell-notice]")).toHaveCount(0);

  await tabs(page).nth(0).locator("button[aria-pressed]").click();
  await expect(page.locator("[data-shell-notice]")).toContainText(reason);
  await expect(page.locator("[data-shell-notice]")).not.toContainText("Error:");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **떠 있는 셸의 칸이 처음 열리다 터지면**, 「못 띄웠다」만 적고 셸을 살려 두면 볼 길도 칠 길도 없는
// 프로세스가 남는다. 이유를 적고 그 셸을 거둔다(`failOpen`). 열기를 터뜨리는 길은 xterm이 제 상자를
// 붙이는 `appendChild` 하나를 가로채는 것이다 — 그 밖의 DOM은 그대로 둔다.
//
// **응답이 오기 전과 뒤가 다른 자리다.** 뒤면 `failOpen`이 그 pty를 알아 곧바로 죽이고, 전이면
// 아직 번호가 없어 늦게 온 응답 자리(`spawn`)가 죽여야 한다 — 그때 그 칸에 셸 이름이 앉으면 안 된다.
for (const replied of [true, false]) {
  test(`떼어진 채 뜬 셸의 칸이 처음 열리다 터지면 이유가 보이고 그 셸이 거둬진다 — spawn 응답 ${replied ? "뒤" : "전"}`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    if (!replied) await holdPtySpawn(page);
    await armXtermOpenFailure(page);
    const releaseFonts = await holdTerminalFonts(page);
    await page.goto("/terminal", { waitUntil: "domcontentloaded" });
    await expect(tabs(page)).toHaveCount(1);
    await page.locator('[data-tab="new"]').click();
    await expect(tabs(page)).toHaveCount(2);
    await releaseFonts();
    if (replied) await expectEveryTabStarted(page, 2);
    else await expect.poll(() => heldSpawns(page), { timeout: 20_000 }).toBe(2);

    await failXtermOpen(page);
    await tabs(page).nth(0).locator("button[aria-pressed]").click();
    await expect(page.locator("[data-shell-notice]")).toContainText(OPEN_FAILURE);
    if (!replied) await releaseSpawns(page);

    await expect
      .poll(async () => (await ipcCallArgs(page, "pty_kill", "id")).map(({ args }) => args.id))
      .toEqual([1]);
    // 옆 칸은 그대로 돈다. 거둔 칸에는 셸 이름이 안 앉는다 — 이유가 그대로 남는다.
    await expect(closeOf(page, 1, FIXTURE_SHELL_NAME)).toHaveCount(1, { timeout: 20_000 });
    await expect(closeOf(page, 0, FIXTURE_SHELL_NAME)).toHaveCount(replied ? 1 : 0);
    await expect(page.locator("[data-shell-notice]")).toContainText(OPEN_FAILURE);

    // **죽인 셸의 종료 프레임이 뒤따라 와도 이유가 그대로다.** 실물은 SIGHUP을 받은 셸이 종료 프레임을
    // 한 번 더 보내는데 픽스처의 `pty_kill`은 안 보내서, 여기서 손으로 쏜다. 채널이 그 프레임을
    // 거둔 칸(`broken`)에서 거르지 않으면 이유가 「종료 코드 129」로 덮인다.
    await exitShell(page, 1, 129);
    // 그 프레임이 도착한 것을 본다 — 같은 채널 길로 뒤에 쏜 옆 칸 출력이 그려지면 앞의 것도 왔다.
    await writeShell(page, `${ESC}]0;뒤따른 출력${BEL}`, 2);
    await expect(closeOf(page, 1, "뒤따른 출력")).toHaveCount(1);
    await settle(page);
    await expect(page.locator("[data-shell-notice]")).toContainText(OPEN_FAILURE);
    await expect(page.locator("[data-shell-notice]")).not.toContainText("종료 코드");
    await expect(tabs(page)).toHaveCount(2);

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **이미 적힌 이유를 열기 실패가 덮지 않는다**(결정 22·23). 떼어진 채 뜬 셸은 사람이 그 칸을 한 번도
// 안 본 사이에 끝나거나(종료 코드) 못 뜰 수 있다(거절 이유). 그 칸을 처음 여는 `open()`이 그 뒤에
// 터지면, 사람이 읽어야 하는 것은 먼저 적힌 셸의 이유다 — 화면 문제로 덮으면 「claude가 조용히 죽은
// 이유」가 사라진다.
for (const [before, arrange, shown] of [
  [
    "끝난",
    async (page: Page) => {
      await expectEveryTabStarted(page, 2);
      await exitShell(page, 1, 129);
      // 그 프레임이 앉은 것을 본다 — 같은 길로 뒤에 쏜 옆 칸 타이틀이 그려지면 앞의 것도 왔다.
      await writeShell(page, `${ESC}]0;옆 칸${BEL}`, 2);
      await expect(closeOf(page, 1, "옆 칸")).toHaveCount(1);
    },
    "종료 코드 129",
  ],
  [
    "못 뜬",
    async (page: Page) => {
      await expect(closeOf(page, 1, FIXTURE_SHELL_NAME)).toHaveCount(1, { timeout: 20_000 });
    },
    "L3가 첫 spawn을 거절했다",
  ],
] as const) {
  test(`안 본 사이 ${before} 셸의 칸이 처음 열리다 터져도 먼저 적힌 이유가 남는다`, async ({ page }) => {
    await installFixtureBackend(page);
    if (before === "못 뜬") await refuseFirstSpawn(page, shown);
    await armXtermOpenFailure(page);
    const releaseFonts = await holdTerminalFonts(page);
    await page.goto("/terminal", { waitUntil: "domcontentloaded" });
    await expect(tabs(page)).toHaveCount(1);
    await page.locator('[data-tab="new"]').click();
    await expect(tabs(page)).toHaveCount(2);
    await releaseFonts();
    await arrange(page);

    await failXtermOpen(page);
    await tabs(page).nth(0).locator("button[aria-pressed]").click();
    await expect(tabs(page).nth(0).locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
    // 열기가 실제로 터졌다는 것을 먼저 본다 — 안 터지면 아래는 아무것도 안 잰다.
    await expect.poll(() => xtermOpenFailures(page)).toBe(1);
    await settle(page);
    await expect(page.locator("[data-shell-notice]")).toContainText(shown);
    await expect(page.locator("[data-shell-notice]")).not.toContainText(OPEN_FAILURE);
    // 끝났거나 못 뜬 셸이라 거둘 PTY가 없다.
    expect(await callCount(page, "pty_kill")).toBe(0);

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **안 본 칸에서 흘러나온 것도 사람에게 닿는다** — 띠·알림·독 배지(#206 · #208). 그 칸의 xterm은
// 한 번도 안 열렸고, OSC를 읽는 것은 그 xterm의 파서다.
test("한 번도 안 연 칸의 셸이 OSC 9로 부르면 띠·알림·배지가 선다", async ({ page }) => {
  await stubNotifications(page);
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`, { waitUntil: "domcontentloaded" });
  await expect(tabs(page)).toHaveCount(1);
  await page.locator('[data-tab="new"]').click();
  await expect(tabs(page)).toHaveCount(2);
  await releaseFonts();
  await expectEveryTabStarted(page, 2);
  await setWindowFocused(page, false);

  // pty 1은 안 본 첫 칸이다 — 이름으로 먼저 못박는다.
  await writeShell(page, `${ESC}]0;안 본 칸${BEL}`, 1);
  await expect(closeOf(page, 0, "안 본 칸")).toHaveCount(1);

  await writeShell(page, `${ESC}]9;PR #174 열었다${BEL}`, 1);
  await expect(
    page.locator("[data-band]").getByRole("button", { name: `${plainWork.title} — 확인할 것`, exact: true }),
  ).toHaveCount(1);
  await expect
    .poll(async () => (await sentNotifications(page))[0]?.body, { message: "알림이 안 울렸다" })
    .toBe("PR #174 열었다");
  await expect.poll(async () => (await badgeCalls(page)).slice(-1)[0]).toBe(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **글꼴 크기를 바꿔도** 떼어진 채 뜬 셸들이 따라온다(결정 52). 두 칸이 다 떼어진 채 설정에서
// 크기를 고치고 돌아오면, 두 셸의 PTY 격자는 **새 크기의 격자**여야 한다 — 옛 크기로 열리면 갈린다.
//
// **기준은 그 뒤에 새로 연 셋째 칸이다.** 글꼴이 이미 와 있어 붙은 채 새 크기로 열리고 그 격자를
// spawn에 싣는다. 두 칸끼리만 견주면 둘 다 옛 크기로 열려도, 둘 다 xterm 기본 격자(80×24)에 머물러도
// 서로 같아 초록이다.
test("글꼴을 기다리는 사이 설정에서 크기를 바꿔도 두 셸이 새 격자로 맞춰진다", async ({ page }) => {
  await installFixtureBackend(page, { write_settings: null });
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
  await expect(tabs(page)).toHaveCount(1);
  await page.locator('[data-tab="new"]').click();
  await expect(tabs(page)).toHaveCount(2);

  await page.locator("aside").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL("/settings/terminal");
  const terminal = page.getByRole("group", { name: "터미널 설정", exact: true });
  await terminal.getByRole("textbox", { name: "터미널 글꼴 크기", exact: true }).fill("22");
  await terminal.getByRole("button", { name: "저장", exact: true }).click();
  await expect(terminal.getByRole("button", { name: "저장", exact: true })).toBeDisabled();

  await releaseFonts();
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(2);

  await page.locator("aside").getByRole("button", { name: "앱으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL("/terminal");
  await expectEveryTabStarted(page, 2);

  // 셋째 칸 — 붙은 채 새 크기로 열려 제 격자로 뜬다.
  await page.locator('[data-tab="new"]').click();
  await expectEveryTabStarted(page, 3);
  const fresh = (await ptyGrids(page)).get(3);
  expect(fresh, "셋째 칸의 격자를 못 읽었다").toBeDefined();
  // 기본 격자가 아니다 — 아니면 「안 맞춘 칸」과 구별이 안 된다.
  expect(fresh).not.toEqual({ cols: 80, rows: 24 });

  for (const at of [0, 1]) {
    await tabs(page).nth(at).locator("button[aria-pressed]").click();
    await expect(tabs(page).nth(at).locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
  }

  await expect
    .poll(async () => {
      const grids = await ptyGrids(page);
      return [grids.get(1), grids.get(2)];
    }, { message: "떼어진 채 뜬 셸이 새 크기의 격자로 안 맞춰졌다" })
    .toEqual([fresh, fresh]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
