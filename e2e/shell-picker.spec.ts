import { expect, test, type Page } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  parentPath,
  pointIn,
  spawnedCwds,
  unknownIpcCalls,
  행버튼,
} from "./harness";

// 티켓 09(#222) — **`+` 메뉴에 「모든 프로젝트」와 키보드**(UI개선 결정 18·20, UI개선 스펙 §7 · S13).
// 판 3(#262)에서 메뉴가 DropdownMenu(Base UI Menu)가 됐다 — 키보드 동작은 그대로이고, Home/End와
// 글자 치기가 새로 섰다(스토리 46~48·53~55).
//
// **이 층에서만 보인다.** 메뉴는 `+`를 눌러야 서고(정적 마크업에는 없다), 포커스·키·바깥 클릭은
// 진짜 브라우저의 이벤트가 있어야 돈다. 「맨 윗줄에 포커스」는 특히 그렇다 — Base UI는 **키로 열 때만**
// 첫 항목을 켜고 마우스로 열면 카드 자신이 포커스를 받는다. 앱이 열린 다음 프레임에 첫 항목에
// 포커스를 주는데(S10), 그 순서가 맞았는지는 실제로 그려 봐야만 드러난다.
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
const projectItem = (page: Page, project: string) =>
  menu(page).getByRole("menuitem", { name: project, exact: true });

const plus = (page: Page) => page.locator('[data-tab="new"]');

/**
 * `+`를 **눌러** 메뉴를 연다. 여는 버튼이 메뉴를 연다고 말하는지(`aria-expanded` 닫힘 → 열림)를 함께
 * 본다 — 그 값은 메뉴 부품이 마운트 뒤에 달아 정적 마크업(L2)에는 없다.
 */
async function openMenu(page: Page): Promise<void> {
  await page.goto(`/works/${multiWork.slug}?tab=terminal`);
  await expect(plus(page)).toHaveAttribute("aria-haspopup", "menu");
  await expect(plus(page)).toHaveAttribute("aria-expanded", "false");
  await plus(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(plus(page)).toHaveAttribute("aria-expanded", "true");
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
    await expect(plus(page)).toHaveAttribute("aria-expanded", "false");
    if (focusBackToPlus) await expect(plus(page)).toBeFocused();
    // **0을 재는 검사라 기다림이 없으면 너무 일찍 초록이다.** 고른 셸이 설 틈을 준다.
    await page.waitForTimeout(500);
    await expect(shells(page)).toHaveCount(0);
    expect(await spawnedCwds(page)).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// UI개선 결정 18 「맨 윗줄이 **선택된 상태로** 열린다」(S10). DOM 포커스만 재면 「포커스는 들었는데 켜진
// 줄이 없다」가 초록이다 — 메뉴에서는 켜진 줄(`data-highlighted`)이 바탕을 칠하고 Enter를 받는다. 그래서
// **켜짐을 함께 잰다**: 포인터가 안 올라간 두 줄 중 첫 줄만 켜졌다. 바탕색은 재지 않는다 — 켜진 줄의
// 모양은 메뉴 부품 한 곳이 들고(`dropdown-menu.tsx`), 모양은 사람이 실물로 본다(좋은 검사).
test("마우스로 연 메뉴에서도 맨 윗줄이 켜진 채 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await openMenu(page);
  // 포인터를 메뉴 밖으로 치운다 — 호버가 켠 줄이 섞이면 무엇을 쟀는지 갈리지 않는다.
  await page.mouse.move(0, 0);

  await expect(allItem(page)).toBeFocused();
  const items = menu(page).getByRole("menuitem");
  await expect(items.first()).toHaveAttribute("data-highlighted");
  await expect(items.nth(1)).not.toHaveAttribute("data-highlighted");
});

// 스토리 47. 줄 옮기기는 메뉴 부품이 한다 — Home/End는 끝줄로, 글자는 그 글자로 시작하는 줄로 간다.
// 글자 치기는 **이웃이 아닌 줄로** 잰다: 첫 줄에서 둘째 프로젝트의 첫 글자를 치므로 ↓ 한 번으로는
// 못 가는 자리다. 마지막 Enter가 그 줄이 정말 켜졌는지(포커스만 옮긴 것이 아닌지)를 cwd로 확인한다.
test("`+` → End·Home은 끝줄로 가고, 글자를 치면 그 글자로 시작하는 줄로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await openMenu(page);
  const last = multiWork.worktrees[multiWork.worktrees.length - 1];
  await expect(allItem(page)).toBeFocused();

  await page.keyboard.press("End");
  await expect(projectItem(page, last.project)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(allItem(page)).toBeFocused();

  await page.keyboard.press(last.project[0]);
  await expect(projectItem(page, last.project)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(menu(page)).toHaveCount(0);
  await awaitSpawned(page, 1);
  expect(await spawnedCwds(page)).toEqual([last.path]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 50 — **바깥 누르기는 닫기만 한다**(S9). 위 「바깥 클릭」은 빈자리를 눌러 이것을 못 잰다 — 거기엔
// 눌릴 것이 없다. 여기서는 **누를 수 있는 것**을 누른다. 사이드바의 다른 work 행(누르면 그 work으로
// 간다)과 셸 컨트롤 줄의 검색 버튼(누르면 팔레트가 뜬다)이다. 검색 버튼 줄은 `z-20`이라 쌓임 순서가
// 다르다 — 메뉴의 가림막이 그 위에 서는지를 따로 잰다.
//
// **자리는 메뉴를 열기 전에 잰다.** 열린 동안에는 메뉴의 가림막이 화면을 덮어 `locator.click()`이
// 가림막에 막혀 기다리다 끝난다 — 그래서 `page.mouse.click`으로 누른다(검색 팔레트 spec과 같다).
// 끝의 대조가 **그 자리가 정말 그것이었는지**를 확인한다: 메뉴 없이 같은 자리를 누르면 눌린다.
for (const [what, target, pressed] of [
  [
    "사이드바의 다른 work 행",
    (page: Page) => 행버튼(page, plainWork.title),
    (page: Page) => expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}(\\?|$)`)),
  ],
  [
    "셸 컨트롤 줄의 검색 버튼",
    (page: Page) => page.getByRole("button", { name: "검색", exact: true }),
    (page: Page) => expect(page.getByRole("dialog", { name: "검색" })).toBeVisible(),
  ],
] as const) {
  test(`메뉴가 열린 채 ${what}을 누르면 메뉴만 닫히고 그것은 안 눌린다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${multiWork.slug}?tab=terminal`);
    await expect(target(page)).toBeVisible();
    const at = await pointIn(target(page), "middle");
    await page.locator('[data-tab="new"]').click();
    await expect(allItem(page)).toBeFocused();

    await page.mouse.click(at.x, at.y);

    // 앵커 — 메뉴가 닫혔다. **0을 재는 검사라 기다림이 없으면 너무 일찍 초록이다.** 눌림이 화면을
    // 바꿀 틈을 준다.
    await expect(menu(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(new RegExp(`/works/${multiWork.slug}\\?`));
    await expect(page.locator("body[data-palette-open]")).toHaveCount(0);

    // 대조 — 메뉴 없이 같은 자리를 누르면 눌린다.
    await page.mouse.click(at.x, at.y);
    await pressed(page);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 묻는 조건은 그대로다 — 프로젝트가 둘 이상일 때만(UI개선 결정 18). 0·1개 work은 들어갈 때 셸이
// 하나 서므로(UI개선 결정 30은 멀티 프로젝트만이다) **그 칸이 선 뒤에** 누른다 — 그래야 `+`가 둘째다.
// pty가 앉기까지는 안 기다린다: 셸은 칸이 열린 순서로 시작하는 것이 앱의 몫이다(`openShell` 머리말).
for (const [label, work, cwd] of [
  ["1개", singleWork, singleWork.worktrees[0].path],
  ["0개", plainWork, parentPath(plainWork.specDir)],
] as const) {
  test(`프로젝트 ${label} work에서 \`+\`는 메뉴 없이 바로 연다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${work.slug}?tab=terminal`);
    await expect(shells(page)).toHaveCount(1);

    await page.locator('[data-tab="new"]').click();

    await awaitSpawned(page, 2);
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator("[data-popover]")).toHaveCount(0);
    expect(await spawnedCwds(page)).toEqual([cwd, cwd]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}
