import { expect, test, type Page } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 티켓 09(#222) — **`+` 메뉴에 「모든 프로젝트」와 키보드**(결정 18·20, 스펙 §7 · S13).
//
// **이 층에서만 보인다.** 메뉴는 `+`를 눌러야 서고(정적 마크업에는 없다), 포커스·키·바깥 클릭은
// 진짜 브라우저의 이벤트가 있어야 돈다. 「맨 윗줄에 포커스」는 특히 그렇다 — 팝오버가 위치를
// 재기 전 한 프레임을 숨겨 그리므로, 그때 포커스를 주면 조용히 안 먹는다(숨은 요소는 포커스를
// 못 받는다). 그 순서가 맞았는지는 실제로 그려 봐야만 드러난다.
//
// 재는 것은 `shell-origin.spec.ts`와 같이 `pty_spawn`에 실린 **cwd**다 — 픽스처의 답은 자리와
// 무관해서 답으로는 어디서 떴는지가 안 갈린다.

const [singleWork, plainWork, multiWork] = WORKS;

/** 「모든 프로젝트」 — 워크트리들의 부모. 기대값은 픽스처의 경로에서 **파생한다**(이름을 안 적는다). */
const allProjectsOf = (work: (typeof WORKS)[number]) =>
  work.worktrees[0].path.slice(0, work.worktrees[0].path.lastIndexOf("/"));

const shells = (page: Page) => page.locator('[data-tab="shell"]');
const menu = (page: Page) => page.getByRole("menu");
// **계산된 이름으로 집는다 — `exact`다.** 옅은 경로가 이름에 섞이면 이 로케이터가 못 찾는다.
const allItem = (page: Page) => menu(page).getByRole("menuitem", { name: "모든 프로젝트", exact: true });

/** 지금까지 나간 `pty_spawn`의 cwd를 부른 순서대로(`shell-origin.spec.ts`와 같은 캐내기). */
async function spawnedCwds(page: Page): Promise<string[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls
    .filter((call) => call.startsWith("pty_spawn "))
    .map((call) => /"cwd":"([^"]*)"/.exec(call)?.[1] ?? `(cwd가 없다: ${call})`);
}

async function openMenu(page: Page): Promise<void> {
  await page.goto(`/works/${multiWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="new"]')).toBeVisible();
  await page.locator('[data-tab="new"]').click();
  await expect(menu(page)).toBeVisible();
}

/** 칸 이름을 **정확히** 잰다 — 닫기 버튼의 이름이 `${칸 이름} 닫기`다. */
async function expectOnlyTabName(page: Page, name: string): Promise<void> {
  await expect(shells(page)).toHaveCount(1);
  await expect(shells(page).locator("button[aria-label$=' 닫기']")).toHaveAttribute("aria-label", `${name} 닫기`);
}

test("`+` → 「모든 프로젝트」에 포커스가 있고 옆에 경로가 옅게 보인다 · Enter → 앞말 없는 셸이 그 자리에서 뜬다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openMenu(page);

  // 맨 윗줄이다 — 항목의 순서가 [모든 프로젝트 · 프로젝트들]이다(결정 18).
  const items = menu(page).getByRole("menuitem");
  await expect(items).toHaveCount(1 + multiWork.worktrees.length);
  await expect(items.first()).toHaveAccessibleName("모든 프로젝트");
  await expect(allItem(page)).toBeFocused();

  // 경로의 마지막 마디 + `/` — 픽스처 경로에서 파생한다.
  const all = allProjectsOf(multiWork);
  const hint = `${all.slice(all.lastIndexOf("/") + 1)}/`;
  await expect(allItem(page).getByText(hint, { exact: true })).toBeVisible();

  await page.keyboard.press("Enter");

  await expect(menu(page)).toHaveCount(0);
  await awaitSpawned(page, 1);
  expect(await spawnedCwds(page)).toEqual([all]);
  // **앞말이 없다**(결정 20) — 특정 프로젝트가 아니라는 말이 그것이다.
  await expectOnlyTabName(page, FIXTURE_SHELL_NAME);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`+` → ↓ → Enter → 첫 프로젝트의 워크트리에서 `프로젝트 · 이름` 칸이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await openMenu(page);
  const [first] = multiWork.worktrees;
  await expect(allItem(page)).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(menu(page).getByRole("menuitem", { name: first.project, exact: true })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(menu(page)).toHaveCount(0);
  await awaitSpawned(page, 1);
  expect(await spawnedCwds(page)).toEqual([first.path]);
  await expectOnlyTabName(page, `${first.project} · ${FIXTURE_SHELL_NAME}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ↑가 맨 윗줄에서 맨 아랫줄로 돈다 — 안 돌면 마지막 프로젝트까지 ↓를 여럿 눌러야 한다.
test("`+` → ↑ → 맨 아랫줄로 돈다 · ↓ → 다시 맨 윗줄", async ({ page }) => {
  await installFixtureBackend(page);
  await openMenu(page);
  const last = multiWork.worktrees[multiWork.worktrees.length - 1];
  await expect(allItem(page)).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(menu(page).getByRole("menuitem", { name: last.project, exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(allItem(page)).toBeFocused();
});

for (const [how, close] of [
  ["Esc", (page: Page) => page.keyboard.press("Escape")],
  // 메뉴 버튼의 관례 — 안 닫으면 포커스가 떠 있는 카드에서 문서 끝으로 새고 메뉴만 남는다.
  ["Tab", (page: Page) => page.keyboard.press("Tab")],
  // 메뉴도 `+`도 아닌 자리 — 본문 한가운데를 누른다.
  ["바깥 클릭", (page: Page) => page.mouse.click(600, 500)],
] as const) {
  test(`\`+\` → ${how} → 메뉴가 닫히고 셸이 안 뜬다`, async ({ page }) => {
    await installFixtureBackend(page);
    await openMenu(page);
    await expect(allItem(page)).toBeFocused();

    await close(page);

    await expect(menu(page)).toHaveCount(0);
    // Esc는 포커스를 `+`로 돌려준다 — 메뉴가 body 끝에 떠 있어서, 안 돌려주면 키보드가 길을 잃는다.
    if (how === "Esc") await expect(page.locator('[data-tab="new"]')).toBeFocused();
    // **0을 재는 검사라 기다림이 없으면 너무 일찍 초록이다.** 고른 셸이 설 틈을 준다.
    await page.waitForTimeout(500);
    await expect(shells(page)).toHaveCount(0);
    expect(await spawnedCwds(page)).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 묻는 조건은 그대로다 — 프로젝트가 둘 이상일 때만(결정 18). 0·1개 work은 들어갈 때 셸이
// 하나 서므로(결정 30은 멀티 프로젝트만이다) 그것이 앉은 뒤에 누른다.
for (const [label, work, cwd] of [
  ["1개", singleWork, singleWork.worktrees[0].path],
  ["0개", plainWork, plainWork.specDir.slice(0, plainWork.specDir.lastIndexOf("/"))],
] as const) {
  test(`프로젝트 ${label} work에서 \`+\`는 메뉴 없이 바로 연다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${work.slug}?tab=terminal`);
    await awaitSpawned(page, 1);

    await page.locator('[data-tab="new"]').click();

    await awaitSpawned(page, 2);
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator("[data-popover]")).toHaveCount(0);
    expect(await spawnedCwds(page)).toEqual([cwd, cwd]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}
