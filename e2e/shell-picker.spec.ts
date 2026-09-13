import { expect, test, type Page } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, parentPath, spawnedCwds, unknownIpcCalls } from "./harness";

// 티켓 09(#222) — **`+` 메뉴에 「모든 프로젝트」와 키보드**(UI개선 결정 18·20, UI개선 스펙 §7 · S13).
//
// **이 층에서만 보인다.** 메뉴는 `+`를 눌러야 서고(정적 마크업에는 없다), 포커스·키·바깥 클릭은
// 진짜 브라우저의 이벤트가 있어야 돈다. 「맨 윗줄에 포커스」는 특히 그렇다 — 팝오버가 위치를
// 재기 전 한 프레임을 숨겨 그리므로, 그때 포커스를 주면 조용히 안 먹는다(숨은 요소는 포커스를
// 못 받는다). 그 순서가 맞았는지는 실제로 그려 봐야만 드러난다.
//
// 재는 것은 `shell-origin.spec.ts`와 같이 `pty_spawn`에 실린 **cwd**다 — 픽스처의 답은 자리와
// 무관해서 답으로는 어디서 떴는지가 안 갈린다.

const [singleWork, plainWork, multiWork] = WORKS;

/** 「모든 프로젝트」 — 워크트리들의 부모. */
const allProjectsOf = (work: (typeof WORKS)[number]) => parentPath(work.worktrees[0].path);

const shells = (page: Page) => page.locator('[data-tab="shell"]');
const menu = (page: Page) => page.getByRole("menu");
// **계산된 이름으로 집는다 — `exact`다.** 옅은 경로가 이름에 섞이면 이 로케이터가 못 찾는다.
const allItem = (page: Page) => menu(page).getByRole("menuitem", { name: "모든 프로젝트", exact: true });

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

  // 맨 윗줄이다 — 항목의 순서가 [모든 프로젝트 · 프로젝트들]이다(UI개선 결정 18).
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
  // **앞말이 없다**(UI개선 결정 20) — 특정 프로젝트가 아니라는 말이 그것이다.
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

// 닫힌 뒤 포커스가 어디 있어야 하는지를 **표에 함께 적는다** — 한 갈래만 포커스를 재면 나머지
// 갈래가 포커스를 문서 밖으로 떨궈도 초록이다(리뷰가 Tab에서 그것을 찾았다).
for (const [how, close, focusBackToPlus] of [
  // Esc·Tab은 키보드에서 온다 — 포커스를 `+`로 돌려준다. 메뉴가 body 끝에 떠 있어서, 안 돌려주면
  // 포커스가 `<body>`로 떨어져 키보드가 길을 잃는다.
  ["Esc", (page: Page) => page.keyboard.press("Escape"), true],
  ["Tab", (page: Page) => page.keyboard.press("Tab"), true],
  // 메뉴도 `+`도 아닌 자리 — 창의 가운데 아래를 누른다(창 크기에서 잰다). 마우스로 닫았으니
  // 포커스는 누른 자리의 몫이라 재지 않는다.
  [
    "바깥 클릭",
    (page: Page) => {
      const size = page.viewportSize();
      if (!size) throw new Error("창 크기를 모른다");
      return page.mouse.click(size.width / 2, size.height * 0.75);
    },
    false,
  ],
] as const) {
  test(`\`+\` → ${how} → 메뉴가 닫히고 셸이 안 뜬다`, async ({ page }) => {
    await installFixtureBackend(page);
    await openMenu(page);
    await expect(allItem(page)).toBeFocused();

    await close(page);

    await expect(menu(page)).toHaveCount(0);
    if (focusBackToPlus) await expect(page.locator('[data-tab="new"]')).toBeFocused();
    // **0을 재는 검사라 기다림이 없으면 너무 일찍 초록이다.** 고른 셸이 설 틈을 준다.
    await page.waitForTimeout(500);
    await expect(shells(page)).toHaveCount(0);
    expect(await spawnedCwds(page)).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// UI개선 결정 18 「맨 윗줄이 **선택된 상태로** 열린다」. DOM 포커스(`toBeFocused`)만 재면 마우스로 연
// 메뉴에서 아무 표시가 없어도 초록이다 — 스크립트 포커스는 `:focus-visible`에 안 걸려 윤곽이 안
// 그려진다. 그래서 **보이는 모습**을 잰다: 포인터가 안 올라간 두 줄 중 포커스 든 줄만 바탕이 있다.
test("마우스로 연 메뉴에서도 맨 윗줄이 선택돼 보인다", async ({ page }) => {
  await installFixtureBackend(page);
  await openMenu(page);
  await expect(allItem(page)).toBeFocused();
  // 포인터를 메뉴 밖으로 치운다 — 호버 바탕이 섞이면 무엇을 쟀는지 갈리지 않는다.
  await page.mouse.move(0, 0);

  const background = (index: number) =>
    menu(page)
      .getByRole("menuitem")
      .nth(index)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => background(0)).not.toBe(await background(1));
});

// 묻는 조건은 그대로다 — 프로젝트가 둘 이상일 때만(UI개선 결정 18). 0·1개 work은 들어갈 때 셸이
// 하나 서므로(UI개선 결정 30은 멀티 프로젝트만이다) 그것이 앉은 뒤에 누른다.
for (const [label, work, cwd] of [
  ["1개", singleWork, singleWork.worktrees[0].path],
  ["0개", plainWork, parentPath(plainWork.specDir)],
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
