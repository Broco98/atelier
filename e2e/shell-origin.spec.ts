import { expect, test, type Page } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 티켓 08(#221) — **⌘T가 언제나 「모든 프로젝트」에 연다**(결정 17~19·30, 스펙 §7).
//
// **이 층에서만 보인다.** 자리 함수는 L2가 값으로 재지만(`shell-registry.test.ts`), ⌘T가 그
// 함수에 닿는 길은 둘이고 둘 다 이벤트가 있어야 돈다: 셸 밖에서는 창 keydown 리스너가, 셸
// 안에서는 xterm의 키 핸들러가 받는다. 셸 안 ⌘T는 요청만 보내고 **화면이** 자리를 정하는데,
// 그 사슬이 이어졌는지는 진짜 xterm에 포커스를 두고 키를 눌러야만 드러난다.
//
// 재는 것은 `pty_spawn`에 실린 **cwd**다 — 픽스처의 답은 자리와 무관해서(그것이 실물 그대로다)
// 답으로는 어디서 떴는지가 안 갈린다. `terminal-worlds.spec.ts`가 `mode`를 같은 방식으로 캐낸다.

const [singleWork, , multiWork] = WORKS;

/** 「모든 프로젝트」 — 워크트리들의 부모. 기대값은 픽스처의 경로에서 **파생한다**(이름을 안 적는다). */
const allProjectsOf = (work: (typeof WORKS)[number]) =>
  work.worktrees[0].path.slice(0, work.worktrees[0].path.lastIndexOf("/"));

const shells = (page: Page) => page.locator('[data-tab="shell"]');

/**
 * 지금까지 나간 `pty_spawn`의 **cwd를 부른 순서대로**. 인자에 cwd가 없으면 그 호출을 통째로
 * 남긴다 — `undefined`로 접으면 「안 실렸다」와 「못 읽었다」가 같은 얼굴이 된다.
 */
async function spawnedCwds(page: Page): Promise<string[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls
    .filter((call) => call.startsWith("pty_spawn "))
    .map((call) => /"cwd":"([^"]*)"/.exec(call)?.[1] ?? `(cwd가 없다: ${call})`);
}

/**
 * 셸에 **정말 포커스가 들었는지**까지 확인하고 돌아온다. 안 들었으면 아래 ⌘T가 창 리스너로
 * 가서, 「셸 안 ⌘T」를 재는 검사가 셸 밖 길로 초록이 된다.
 */
async function focusShell(page: Page): Promise<void> {
  await page.locator(".xterm-screen").click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea")))
    .toBe(true);
}

// 결정 30. 기본 자리와 진입 자리는 **다른 물음이다** — 진입이 기본 자리를 타면 git이 안 되는
// 폴더에 원치 않는 셸이 쌓인다. 지금도 참이다: 진입이 새 기본 자리 함수를 타는 변형을 무는 그물.
test("멀티 프로젝트 work의 터미널에 들어가면 셸이 저절로 안 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}?tab=terminal`);
  // 탭 줄이 선 것을 먼저 본다 — 화면이 안 떴는데 「셸 0개」가 초록이 되지 않게.
  await expect(page.locator('[data-tab="new"]')).toBeVisible();
  // 진입 이펙트가 돌 틈을 준다. **0을 재는 검사라 기다림이 없으면 너무 일찍 초록이다.**
  await page.waitForTimeout(500);

  await expect(shells(page)).toHaveCount(0);
  expect(await spawnedCwds(page)).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 포커스 없이 ⌘T → 「모든 프로젝트」에서 뜨고, 탭에 프로젝트 앞말이 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="new"]')).toBeVisible();
  await expect(shells(page)).toHaveCount(0);

  await page.keyboard.press("Meta+t");

  await expect(shells(page)).toHaveCount(1);
  await awaitSpawned(page, 1);
  expect(await spawnedCwds(page)).toEqual([allProjectsOf(multiWork)]);
  // **이름이 정확히 셸 이름이다** — `billing · zsh`면 프로젝트 앞말이 붙은 것이다(결정 31).
  await expect(shells(page).locator("button[aria-label$=' 닫기']")).toHaveAttribute(
    "aria-label",
    `${FIXTURE_SHELL_NAME} 닫기`,
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 19. 옛 규칙은 셸 안 ⌘T가 **그 셸이 뜬 자리**로 열었다 — 진입 셸이 없으니 이 검사의 첫
// 셸은 메뉴로 고른 프로젝트 셸이고, 옛 규칙이면 둘째 cwd가 그 워크트리가 되어 여기가 문다.
test("`+` 메뉴로 연 프로젝트 셸 안에서 ⌘T → 「모든 프로젝트」에서 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}?tab=terminal`);
  const [first] = multiWork.worktrees;

  await page.locator('[data-tab="new"]').click();
  await page.locator("[data-popover]").getByRole("button", { name: first.project, exact: true }).click();
  await expect(shells(page)).toHaveCount(1);
  await expect(shells(page).locator("button[aria-label$=' 닫기']")).toHaveAttribute(
    "aria-label",
    `${first.project} · ${FIXTURE_SHELL_NAME} 닫기`,
  );
  expect(await spawnedCwds(page)).toEqual([first.path]);

  await focusShell(page);
  await page.keyboard.press("Meta+t");

  await expect(shells(page)).toHaveCount(2);
  await awaitSpawned(page, 2);
  // **정확히 둘이다** — 셸 안 요청과 창 리스너가 함께 열면 셋이 된다(결정 93의 `stopPropagation`).
  expect(await spawnedCwds(page)).toEqual([first.path, allProjectsOf(multiWork)]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 0·1개 work은 **지금과 같다**(스펙 §11). ⌘T가 닿는 길이 둘이라 둘 다 잰다 — 진입 셸에
// 포커스를 둔 채 한 번(요청 길), 포커스를 걷고 한 번(창 리스너 — 옛 `workShellOrigin(…, null)`
// 자리에 기본 자리 함수가 들어간 곳이다).
test("프로젝트가 하나인 work에서 ⌘T는 그 워크트리에서 뜬다 — 셸 안에서도, 밖에서도", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${singleWork.slug}?tab=terminal`);
  const [only] = singleWork.worktrees;
  await awaitSpawned(page, 1);
  expect(await spawnedCwds(page)).toEqual([only.path]);

  await focusShell(page);
  await page.keyboard.press("Meta+t");

  await awaitSpawned(page, 2);
  expect(await spawnedCwds(page)).toEqual([only.path, only.path]);

  // 포커스를 걷는다 — **정말 걷혔는지** 확인해야 아래 ⌘T가 창 리스너 길을 잰다.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea")))
    .toBe(false);
  await page.keyboard.press("Meta+t");

  await awaitSpawned(page, 3);
  expect(await spawnedCwds(page)).toEqual([only.path, only.path, only.path]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// `/terminal`도 셸 안 ⌘T의 요청을 **들어야 한다** — 안 들으면 이 화면의 ⌘T가 통째로 죽는다
// (셸이 늘 포커스를 쥐고 있어서다). `tab-keys`의 첫 검사가 같은 자리를 재지만 포커스를
// 확인하지 않아, 여기서 셸 안 길임을 못박는다.
test("`/terminal`에서 셸에 포커스를 둔 ⌘T가 새 셸을 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await focusShell(page);
  await page.keyboard.press("Meta+t");

  await awaitSpawned(page, 2);
  // 최상위 터미널은 데이터 루트다 — 두 번 다 cwd가 `null`로 실린다. `spawnedCwds`를 안 쓰는
  // 것은 그 함수가 문자열 cwd만 캐내서다: 여기서는 **`null`이 있다**를 긍정으로 재야, 셸 안
  // ⌘T가 엉뚱한 자리로 열린 회귀가 개수만 맞춰 초록이 되지 않는다.
  const calls = (await readIpcRecord(page))?.calls ?? [];
  const spawns = calls.filter((call) => call.startsWith("pty_spawn "));
  expect(spawns).toHaveLength(2);
  for (const call of spawns) expect(call).toContain('"cwd":null');
  expect(await unknownIpcCalls(page)).toEqual([]);
});
