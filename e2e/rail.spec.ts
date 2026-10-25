import { expect, test, type Locator, type Page } from "./evidence";
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

// codex-ds 티켓 18 — **레일은 칸이 둘 이상일 때만 서고, 서면 DS `PanelRail` 모양이다**(codex-ds 결정 25 · 29 · 스펙 §4). 판 안 오른쪽
// 끝의 세로 칸이고(왼쪽은 칸 사이 선 하나 — 02 티켓 03), 홈은 흰 면(`surface` · `shadow-hairline` · `radius-lg`, 안쪽 2), 칸은 28 ·
// `radius-md`, 켜진 칸은 패널 트리의 고른 행과 같은 `fill-selected`, 꺼진 칸의 hover는 `fill-soft`다. 위끝은 칸 줄 위끝 + 8이고 `aside`가
// 아니다. 칸마다 패널 칸을 가리킨다(`aria-controls`). 패널 토글은 레일 위가 아니라 머리 줄 할 일 묶음의 맨 끝이다 — 한때 머리 카드 밖
// 레일 바로 위에 섰다(DS `.at-railtop` — 02 티켓 03이 걷었다). 켜진 칸을 다시 누르면 패널이 닫히고 레일은 남으며, 칸을 다녀와도 안
// 보이는 몸은 마운트된 채라 접어 둔 것이 그대로다(ui-refresh 결정 9 · 10).
//
// **진열대(`e2e/rail-fixture.tsx`)에서 잰다.** 앱의 작업 화면도 이제 칸이 `spec` · `files` 둘이라 레일이 선다 — 그 자리는
// `frame.spec.ts`가 앱 화면에서 잰다. 진열대는 앱의 데이터 없이 레일의 모양 · 규칙만 재는 자리다 — 같은 공용 틀에 시험용 둘째 칸
// `files`를 건네고, 칸을 고른 뒤의 열림 · 고른 칸을 작업 화면과 같은 규칙(`pickRail`)으로, 몸을 같은 상자(`PanelBody`)로 그린다.

/** 진열대를 Processes 화면 위에 세운다. 앱 화면 위라 `index.css`가 이미 서 있다. */
async function 진열대를세운다(page: Page): Promise<Locator> {
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  // 모듈 스크립트로 들인다 — Vite가 이 파일과 그 의존(공용 틀 · `react-dom`)을 앱과 같은 판으로 내준다.
  await page.addScriptTag({
    type: "module",
    content: 'import { 레일진열대를세운다 } from "/e2e/rail-fixture.tsx"; 레일진열대를세운다();',
  });
  const showcase = page.locator("[data-rail-fixture]");
  await expect(showcase.getByRole("group", { name: "레일", exact: true })).toBeVisible();
  return showcase;
}

const 상자 = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error(`상자가 없다 — ${target}`);
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
};

/** 배치 변수 하나의 값(px) — 뿌리에서 읽는다(`frame.spec`의 `token`과 같은 길이고, 이 변수들은 `:root`에 선다). */
const 길이 = (page: Page, name: string) =>
  page.evaluate((one) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(one)), name);

test("칸이 둘이면 레일이 판 오른쪽 끝에 DS 모양으로 선다 — 흰 홈 · 28 칸 · 켜진 칸 fill-selected · hover fill-soft · 위끝 = 칸 줄 위끝 + 8 · 칸이 패널을 가리킨다", async ({
  page,
}) => {
  const showcase = await 진열대를세운다(page);
  const rail = showcase.getByRole("group", { name: "레일", exact: true });
  const cells = rail.getByRole("button");
  const [spec, files] = [cells.nth(0), cells.nth(1)];

  // 칸은 목록 순서대로이고, 열린 칸 하나만 켜져 있다. 레일은 `aside` · `nav` · `header` 밖이다(DS `PanelRail` 「구현 고리」).
  expect(await cells.evaluateAll((all) => all.map((el) => [el.getAttribute("aria-label"), el.getAttribute("aria-pressed")]))).toEqual([
    ["spec", "true"],
    ["files", "false"],
  ]);
  expect(await rail.evaluate((el) => el.closest("aside, nav, header")?.tagName ?? null)).toBeNull();
  // 칸마다 고르는 패널 칸(두 번째 `aside`가 아니라 진열대의 패널 칸 하나)을 가리킨다 — 패널 토글과 같은 이음이다(`Frame`이 짓는다).
  const panelId = await showcase.locator("aside").getAttribute("id");
  expect(panelId, "패널 칸에 id가 없다").toBeTruthy();
  expect(await cells.evaluateAll((all) => all.map((el) => el.getAttribute("aria-controls")))).toEqual([panelId, panelId]);

  // 홈 — 옆 패널 카드와 같은 흰 면 · 0.5px 링 · radius-lg · 안쪽 2. 폭이 줄 폭(`size-prail`)이다.
  const [background, radius, padding, shadow] = await 칠한값(rail, "background-color", "border-top-left-radius", "padding-top", "box-shadow");
  expect([background, radius, padding], "홈의 면 · 반경 · 안쪽").toEqual([
    await 토큰색(page, "--surface"),
    await 토큰값(page, "border-top-left-radius", "--radius-lg"),
    "2px",
  ]);
  expect(그림자(shadow), "홈의 링").toBe(await 토큰값(page, "box-shadow", "--shadow-hairline"));
  const home = await 상자(rail);
  expect(home.width, "홈 폭 = size-prail").toBe(await 길이(page, "--size-prail"));

  // 칸 — 28 · radius-md, 아이콘 16. 켜진 칸은 fill-selected, 꺼진 칸은 면이 없다.
  for (const cell of [spec, files]) {
    const box = await 상자(cell);
    expect([box.width, box.height], "칸 상자").toEqual([28, 28]);
    expect(await 칠한값(cell, "border-top-left-radius")).toEqual([await 토큰값(page, "border-top-left-radius", "--radius-md")]);
    expect(await 칠한값(cell.locator("svg"), "width", "height")).toEqual(["16px", "16px"]);
  }
  expect(await 칠한값(spec, "background-color"), "켜진 칸").toEqual([await 토큰색(page, "--fill-selected")]);
  expect(await 칠한값(files, "background-color"), "꺼진 칸").toEqual(["rgba(0, 0, 0, 0)"]);
  // hover — 꺼진 칸은 fill-soft가 서고, 켜진 칸은 hover해도 그 면 그대로다(DS `.is-on:hover`).
  await files.hover();
  await expect.poll(() => 칠한값(files, "background-color"), "꺼진 칸 hover").toEqual([await 토큰색(page, "--fill-soft")]);
  await spec.hover();
  await expect.poll(() => 칠한값(spec, "background-color"), "켜진 칸 hover").toEqual([await 토큰색(page, "--fill-selected")]);

  // 자리 — 레일 열은 칸 줄(머리 줄 아래)의 오른쪽 끝 칸이고 왼쪽에 칸 사이 선이 선다. 홈은 그 열 안 위 · 옆 8에 선다(`Rail`의 `px-2 pt-2`
  // — 한때 위끝이 카드 위끝과 같았다, 틈의 카드였을 때다). 패널 칸은 레일 열 바로 앞에서 끝난다.
  const gap = await 길이(page, "--space-2");
  const card = await 상자(showcase.getByRole("region", { name: "진열대 본문", exact: true }));
  const panel = await 상자(showcase.getByRole("region", { name: "진열대 패널", exact: true }));
  const viewport = page.viewportSize()!;
  expect(card.y, "칸 줄 위끝 = 머리 줄 아래").toBe(await 길이(page, "--titlebar-height"));
  expect(home.y - card.y, "레일 위끝 = 칸 줄 위끝 + 8").toBe(gap);
  expect(home.x - panel.right, "패널 칸 끝 → 레일 홈 8").toBe(gap);
  expect(viewport.width - home.right, "레일 홈 → 오른쪽 끝 8").toBe(gap);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 레일이 서도 머리 줄은 갈리지 않는다(02 티켓 03 — 옛 DS `.at-winhead.with-rail` · `.at-railtop`을 걷었다). 패널 토글은 머리 줄 할 일
// 묶음(`[data-head-actions]`)의 맨 끝이고 그 묶음은 화면 자리 오른쪽 끝(− 8)에 붙는다 — 레일이 서든 안 서든 같은 자리다. 레일 열은 판
// 안의 칸이라 창을 끄는 자리가 아니다(판 안에는 끄는 자리가 없다 — 머리 줄의 빈 자리만 끈다, `frame.spec`).
test("레일이 서도 패널 토글은 머리 줄 할 일 묶음의 맨 끝이고, 레일 열과 그 둘레는 창을 끄는 자리가 아니다", async ({ page }) => {
  const showcase = await 진열대를세운다(page);
  const rail = showcase.getByRole("group", { name: "레일", exact: true });
  const toggleButton = showcase.getByRole("button", { name: "진열대 패널 접기", exact: true });
  const gap = await 길이(page, "--space-2");
  const viewport = page.viewportSize()!;
  const [home, slot, panel, toggle] = [
    await 상자(rail),
    await 상자(화면머리(showcase)),
    await 상자(showcase.getByRole("region", { name: "진열대 패널", exact: true })),
    await 상자(toggleButton),
  ];

  // 패널 토글 — 머리 줄 화면 자리 안, 할 일 묶음의 마지막 단추이고 화면 자리 오른쪽 끝에서 8에 선다. 레일 열 위의 칸이 아니다.
  expect(
    await toggleButton.evaluate(
      (el, head) => [el.closest(head) !== null, el.closest("[data-head-actions]")?.lastElementChild === el],
      SCREEN_HEAD,
    ),
    "토글 — 머리 줄 화면 자리 · 할 일 묶음의 맨 끝",
  ).toEqual([true, true]);
  expect(slot.right - toggle.right, "토글 → 화면 자리 오른쪽 끝 8").toBe(gap);
  expect(toggle.bottom, "토글은 레일 위 머리 줄").toBeLessThanOrEqual(home.y);

  // 레일 열과 그 둘레는 끌지 않는다 — 칸 묶음 아래, 레일 오른쪽 여백, 패널 칸과 레일 사이. 진열대는 앱 화면 위를 덮어(`position: fixed`
  // · `z-index`) 그 점의 맨 위 요소가 진열대의 것이다(`끄는자리`는 맨 위 요소에서 잰다). 앵커: 칸 줄의 그 점은 진열대 안이다.
  const railMiddle = home.x + home.width / 2;
  const below = home.bottom + 40;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-rail-fixture]") !== null, [railMiddle, below])).toBe(true);
  expect(await 끄는자리(page, railMiddle, below), "칸 묶음 아래").toBe(false);
  expect(await 끄는자리(page, viewport.width - gap / 2, below), "레일 오른쪽 여백").toBe(false);
  expect(await 끄는자리(page, panel.right + gap / 2, below), "패널 칸과 레일 사이").toBe(false);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("레일 칸을 누르면 그 칸으로 열리고, 켜진 칸을 다시 누르면 패널이 닫히고 레일은 남는다 — 토글은 고른 칸을 그대로 둔다", async ({
  page,
}) => {
  const showcase = await 진열대를세운다(page);
  const rail = showcase.getByRole("group", { name: "레일", exact: true });
  const spec = rail.getByRole("button", { name: "spec", exact: true });
  const files = rail.getByRole("button", { name: "files", exact: true });
  const panel = showcase.getByRole("region", { name: "진열대 패널", exact: true });
  const toggle = showcase.getByRole("button", { name: /^진열대 패널 (접기|펼치기)$/ });
  /** 패널 칸(진열대의 `aside`)의 그려진 폭 — 접히면 「틈 + 카드」가 함께 0이 된다. */
  const 패널폭 = () => showcase.locator("aside").evaluate((el) => Math.round(el.getBoundingClientRect().width));

  // 다른 칸을 누르면 그 칸으로 바뀐다 — 몸(패널 머리)이 따라 바뀌었는지도 잰다.
  await files.click();
  await expect(files).toHaveAttribute("aria-pressed", "true");
  await expect(spec).toHaveAttribute("aria-pressed", "false");
  await expect(panel.locator('[data-slot="card-head"]')).toHaveText("files");
  const home = await 상자(rail);

  // 켜진 칸을 다시 누르면 닫힌다. 켜진 칸이 없어지고, 레일은 그 자리에 남는다.
  await files.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(files).toHaveAttribute("aria-pressed", "false");
  await expect(spec).toHaveAttribute("aria-pressed", "false");
  await expect.poll(패널폭).toBe(0);
  expect(await 상자(rail), "닫혀도 레일은 그 자리").toEqual(home);

  // 토글로 다시 열면 고른 칸(`files`) 그대로다 — 토글은 열림만 뒤집는다.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(files).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator('[data-slot="card-head"]')).toHaveText("files");

  // 닫힌 채 다른 칸을 누르면 그 칸으로 열린다.
  await files.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await spec.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(spec).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator('[data-slot="card-head"]')).toHaveText("spec");
  await expect.poll(패널폭).toBeGreaterThan(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 몸은 칸마다 하나이고 고른 칸의 몸만 보인다(`PanelBody`). **안 보이는 몸도 마운트된 채다**(ui-refresh 결정 9) — 칸을 다녀와도 그 몸에서
// 접어 둔 것(작업 화면에서는 spec 트리의 폴더)이 그대로다. 그래서 안 보이는 몸은 지우지 않고 `hidden`과 `inert`로 가린다 — 화면과
// 접근성 트리에서 빠지고 포커스 · 찾기가 안 들어간다.
test("칸을 다녀와도 안 보이는 몸은 마운트된 채 hidden · inert로 가려지고, 접어 둔 것이 그대로다", async ({ page }) => {
  const showcase = await 진열대를세운다(page);
  const rail = showcase.getByRole("group", { name: "레일", exact: true });
  const panel = showcase.getByRole("region", { name: "진열대 패널", exact: true });
  const 몸 = (view: string) => panel.locator(`[data-panel-view="${view}"]`);
  const specFold = 몸("spec").getByRole("button", { name: "spec 폴더", exact: true });

  // 처음에는 고른 칸(`spec`)의 몸만 보인다.
  await expect(specFold).toBeVisible();
  await expect(몸("files").getByRole("button", { name: "files 폴더", exact: true })).toBeHidden();
  await specFold.click();
  await expect(specFold).toHaveAttribute("aria-expanded", "false");

  // `files`로 옮기면 그 몸이 보이고, `spec` 몸은 지워지지 않고 가려진다.
  await rail.getByRole("button", { name: "files", exact: true }).click();
  await expect(몸("files").getByRole("button", { name: "files 폴더", exact: true })).toBeVisible();
  await expect(몸("spec")).toHaveCount(1);
  expect(await 몸("spec").evaluate((el) => [el.hasAttribute("hidden"), el.hasAttribute("inert")])).toEqual([true, true]);
  expect(await 몸("files").evaluate((el) => [el.hasAttribute("hidden"), el.hasAttribute("inert")])).toEqual([false, false]);
  await expect(specFold).toBeHidden();

  // 돌아오면 접어 둔 그대로다 — 몸이 새로 섰다면 펼친 채(처음 값)다.
  await rail.getByRole("button", { name: "spec", exact: true }).click();
  await expect(specFold).toBeVisible();
  await expect(specFold).toHaveAttribute("aria-expanded", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
