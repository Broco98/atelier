import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  SCREEN_HEAD,
  installFixtureBackend,
  processesTitle,
  unknownIpcCalls,
  그림자,
  끄는자리,
  화면머리,
  칠한값,
  토큰값,
  토큰색,
} from "./harness";
import { settle } from "./tab-row";

// restart 02a-14 — **레일은 작업공간의 도구이고 칸은 `spec` 하나다**(스토리 80 · 81 · 82 · 시안 Shell 「레일」 · Main `.ra-rail`). 카드 자리
// 오른쪽 끝의 세로 카드(폭 32 · 둥글기 6 · `surface` + 0.5 링 · 안쪽 2)이고, spec 패널 상자 뒤 8 틈 · 창 끝 8에 선다. `aside` · `nav` ·
// `header`가 아니다. 칸은 28 · 둥글기 4(`radius-ctl`) · 아이콘 16이고 패널(`aria-controls`)을 가리킨다. 켜짐은 「spec 패널이 열렸다」이고 칸
// 뒤에 깔린 면(`[data-rail-on]` · `tool-rail-on`)이 옅음으로 들고 난다 — 켜진 칸은 제 면이 없다. 꺼진 칸은 hover에 `fill-soft`다. 칸을 누르면
// 패널이 열리고 다시 누르면 닫힌다 — 레일은 남는다(⌘Enter · 패널 토글과 같은 일). 패널을 닫아도 몸은 내려가지 않아 접어 둔 폴더가 그대로다.
// 작업공간 밖 화면에서는 폭 0으로 접혀 보이지도 포커스되지도 않는다.
//
// 한때(codex-ds 티켓 18 – 02a-13) 레일은 칸이 둘 이상일 때만 섰고(`spec` · `files`), 칸을 고르는 자리였다(`pickRail` — 다른 칸이면 그 칸으로
// 열었다). 앱 화면 밖 진열대(`e2e/rail-fixture.tsx`)에서 시험용 둘째 칸을 건네 쟀다 — 02a-14가 files 칸과 진열대를 걷어, 이제 작업공간 화면에서
// 잰다. 칸 사이를 오가며 안 보이는 몸이 마운트된 채인지 재던 검사는 칸이 하나라 걷었고, 그 뜻(닫아도 몸이 그대로)은 아래 여닫기 검사로 옮겼다.
// 들고 나는 움직임 · 접힌 레일의 포커스는 02a-16이 잰다.

const [pinnedWork] = WORKS;

const 레일 = (page: Page) => page.getByRole("group", { name: "레일", exact: true });
const 칸 = (page: Page) => 레일(page).getByRole("button", { name: "spec", exact: true });
const 토글 = (page: Page) => page.getByRole("button", { name: /^작업공간 패널 (접기|펼치기)$/ });
const 패널 = (page: Page) => page.getByRole("region", { name: "작업공간 패널", exact: true });
/** spec 패널 상자(`aside#work-panel` — 틈 8 + 카드)의 그려진 폭 — 닫히면 0이다. */
const 패널폭 = (page: Page) => page.locator("aside#work-panel").evaluate((el) => Math.round(el.getBoundingClientRect().width));

async function 작업공간을연다(page: Page): Promise<void> {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(칸(page)).toBeVisible({ timeout: 20_000 });
  await expect(패널(page)).toBeVisible();
  // 기둥(패널 상자 · 레일)이 다 자랄 때까지 기다린다 — 자라는 동안의 상자를 재지 않는다. 움직임은 02a-16이 잰다.
  await settle(page, async () => [await 패널폭(page), (await 레일(page).boundingBox())?.width]);
}

const 상자 = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error(`상자가 없다 — ${target}`);
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
};

/** 배치 변수 하나의 값(px) — 뿌리에서 읽는다(이 변수들은 `:root`에 선다). */
const 길이 = (page: Page, name: string) =>
  page.evaluate((one) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(one)), name);

test("레일이 카드 자리 오른쪽 끝에 칸 `spec` 하나로 선다 — 32 카드 · 둥글기 6 · 28 칸 · 켜짐 면 · hover fill-soft · 패널 뒤 8 · 창 끝 8", async ({
  page,
}) => {
  await 작업공간을연다(page);
  const rail = 레일(page);
  const cell = 칸(page);

  // 칸은 하나이고 열린 패널이라 켜져 있다. 레일은 `aside` · `nav` · `header` 밖이다(시안 Shell 「규칙」).
  expect(await rail.getByRole("button").evaluateAll((all) => all.map((el) => [el.getAttribute("aria-label"), el.getAttribute("aria-pressed")]))).toEqual([
    ["spec", "true"],
  ]);
  expect(await rail.evaluate((el) => el.closest("aside, nav, header")?.tagName ?? null)).toBeNull();
  // 칸이 spec 패널 상자를 가리킨다 — 패널 토글과 같은 이음이다.
  await expect(cell).toHaveAttribute("aria-controls", "work-panel");
  await expect(토글(page)).toHaveAttribute("aria-controls", "work-panel");

  // 카드 — 다른 카드와 같은 면 · 0.5px 링, 둥글기 `radius-rail`(6) · 안쪽 2. 폭이 줄 폭(`size-prail` 32)이다.
  const [background, radius, padding, shadow] = await 칠한값(rail, "background-color", "border-top-left-radius", "padding-top", "box-shadow");
  expect([background, radius, padding], "카드의 면 · 반경 · 안쪽").toEqual([
    await 토큰색(page, "--surface"),
    await 토큰값(page, "border-top-left-radius", "--radius-rail"),
    "2px",
  ]);
  expect(radius, "시안 수 — 6").toBe("6px");
  expect(그림자(shadow), "카드의 링").toBe(await 토큰값(page, "box-shadow", "--shadow-hairline"));
  const home = await 상자(rail);
  expect(home.width, "카드 폭 = size-prail").toBe(await 길이(page, "--size-prail"));
  expect(home.width, "시안 수 — 32").toBe(32);

  // 칸 — 28 · `radius-ctl`(4), 아이콘 16. 켜진 칸은 제 면 없이 칸 뒤의 켜짐 면(`tool-rail-on`)이 선다.
  const box = await 상자(cell);
  expect([box.width, box.height], "칸 상자").toEqual([28, 28]);
  expect(await 칠한값(cell, "border-top-left-radius")).toEqual([await 토큰값(page, "border-top-left-radius", "--radius-ctl")]);
  expect(await 칠한값(cell.locator("svg"), "width", "height")).toEqual(["16px", "16px"]);
  const on = rail.locator("[data-rail-on]");
  await expect(on).toHaveAttribute("data-rail-on", "true");
  expect(await 칠한값(on, "background-color", "opacity"), "켜짐 면").toEqual([await 토큰색(page, "--tool-rail-on"), "1"]);
  expect(await 칠한값(cell, "background-color"), "켜진 칸의 제 면").toEqual(["rgba(0, 0, 0, 0)"]);

  // 꺼지면 켜짐 면이 옅어지고, 꺼진 칸은 hover에 `fill-soft`다.
  await cell.click();
  await expect(cell).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => 칠한값(on, "opacity"), "꺼진 켜짐 면").toEqual(["0"]);
  await cell.hover();
  await expect.poll(() => 칠한값(cell, "background-color"), "꺼진 칸 hover").toEqual([await 토큰색(page, "--fill-soft")]);
  await cell.click();
  await expect(cell).toHaveAttribute("aria-pressed", "true");

  // 자리 — 카드 자리 위끝(머리 줄 아래)에서 서고, 패널 상자(틈 8 + 카드) 뒤 8 · 창 오른쪽 끝 8이다.
  const viewport = page.viewportSize()!;
  const gap = await 길이(page, "--space-2");
  await settle(page, async () => [await 패널폭(page), await 상자(rail)]);
  expect(await 패널폭(page), "다시 연 패널 상자 — 틈 8 + 카드").toBeGreaterThan(0);
  const panelCard = await 상자(패널(page));
  expect(home.y, "레일 위끝 = 머리 줄 아래").toBe(await 길이(page, "--size-titlebar"));
  expect(home.x - panelCard.right, "패널 카드 끝 → 레일 8").toBe(gap);
  expect(viewport.width - home.right, "레일 → 창 오른쪽 끝 8").toBe(gap);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 레일이 서도 머리 줄은 갈리지 않는다(02 티켓 03 — 옛 DS `.at-winhead.with-rail` · `.at-railtop`을 걷었다). 패널 토글은 머리 줄 할 일
// 묶음(`[data-head-actions]`)의 맨 끝이고 그 묶음은 화면 자리 오른쪽 끝(− 8)에 붙는다. 레일은 카드라 창을 끄는 자리가 아니다(카드와 그
// 사이 틈은 끄는 자리가 아니다 — 머리 줄의 빈 자리만 끈다, 결정 「02a」 · `frame.spec`).
test("레일이 서도 패널 토글은 머리 줄 할 일 묶음의 맨 끝이고, 레일 카드는 창을 끄는 자리가 아니다", async ({ page }) => {
  await 작업공간을연다(page);
  const rail = 레일(page);
  const gap = await 길이(page, "--space-2");
  const [home, slot, toggle] = [await 상자(rail), await 상자(화면머리(page)), await 상자(토글(page))];

  // 패널 토글 — 머리 줄 화면 자리 안, 할 일 묶음의 마지막 단추이고 화면 자리 오른쪽 끝에서 8에 선다. 레일 위의 칸이 아니다.
  expect(
    await 토글(page).evaluate(
      (el, head) => [el.closest(head) !== null, el.closest("[data-head-actions]")?.lastElementChild === el],
      SCREEN_HEAD,
    ),
    "토글 — 머리 줄 화면 자리 · 할 일 묶음의 맨 끝",
  ).toEqual([true, true]);
  expect(slot.right - toggle.right, "토글 → 화면 자리 오른쪽 끝 8").toBe(gap);
  expect(toggle.bottom, "토글은 레일 위 머리 줄").toBeLessThanOrEqual(home.y);

  // 레일 카드 안 — 칸 아래 빈 자리는 끌지 않는다.
  expect(await 끄는자리(page, home.x + home.width / 2, home.y + 80), "칸 아래").toBe(false);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 칸을 누르면 오른쪽 자리를 `toggle spec`한다 — 패널 토글 · ⌘Enter와 같은 일이다. 패널을 닫아도 몸은 내려가지 않아(02a-14 — 한때 열 때마다
// 트리를 새로 꽂았다) 접어 둔 폴더가 그대로다.
test("레일 칸을 누르면 패널이 닫히고 레일은 남으며, 다시 누르면 열린다 — 닫았다 열어도 접어 둔 폴더가 그대로다", async ({ page }) => {
  await 작업공간을연다(page);
  const rail = 레일(page);
  const cell = 칸(page);
  const folder = 패널(page).getByRole("button", { name: "목업", exact: true });
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  const home = await 상자(rail);

  // 켜진 칸을 누르면 닫힌다. 칸이 꺼지고, 레일은 그 자리에 남는다.
  await cell.click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "false");
  await expect(cell).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => 패널폭(page)).toBe(0);
  expect(await 상자(rail), "닫혀도 레일은 그 자리").toEqual(home);

  // 다시 누르면 열린다 — 접어 둔 폴더가 그대로다.
  await cell.click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "true");
  await expect(cell).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => 패널폭(page)).toBeGreaterThan(0);
  await expect(folder).toHaveAttribute("aria-expanded", "false");

  // ⌘Enter로 닫아도 칸의 켜짐이 따라온다 — 한 값(오른쪽 자리)을 읽는다.
  await page.locator("main").first().click();
  await page.keyboard.press("Meta+Enter");
  await expect(cell).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Meta+Enter");
  await expect(cell).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **레일은 작업공간에서만 선다**(시안 Shell 「어디에 서나」) — 다른 화면에서는 기둥에 남되 폭 0으로 접혀 보이지 않고(`getByRole`이 세지
// 않는다) 본문 카드가 창 끝 8까지 찬다. 한때(codex-ds 결정 25) 「칸이 둘 이상일 때만 선다」였다.
test("작업공간 밖 화면에서는 레일이 폭 0으로 접혀 보이지 않고 본문 카드가 창 끝 8까지 찬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible({ timeout: 20_000 });
  await expect(레일(page)).toHaveCount(0);
  const hidden = page.locator('[aria-label="레일"]');
  await expect(hidden).toHaveAttribute("data-show", "false");
  expect(await hidden.evaluate((el) => [Math.round(el.getBoundingClientRect().width), el.hasAttribute("inert")])).toEqual([0, true]);
  const viewport = page.viewportSize()!;
  const main = await 상자(page.locator("main"));
  expect(viewport.width - main.right, "본문 카드 → 창 끝 8").toBe(8);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
