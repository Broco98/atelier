import { expect, test, type Locator, type Page } from "./evidence";
import {
  HEAD_CARD,
  installFixtureBackend,
  processesTitle,
  unknownIpcCalls,
  그림자,
  머리카드,
  칠한값,
  토큰값,
  토큰색,
} from "./harness";

// codex-ds 티켓 18 — **레일은 칸이 둘 이상일 때만 서고, 서면 DS `PanelRail` 모양이다**(codex-ds 결정 25 · 29 · 스펙 §4). 바탕 오른쪽
// 끝의 세로 묶음이고, 홈은 옆 패널 카드와 같은 흰 면(`surface` · `shadow-hairline` · `radius-lg`, 안쪽 2), 칸은 28 · `radius-md`, 켜진
// 칸은 패널 트리의 고른 행과 같은 `fill-selected`, 꺼진 칸의 hover는 `fill-soft`다. 위끝은 카드 위끝이고 `aside`가 아니다. 칸마다
// 패널 칸을 가리키고(`aria-controls`), 빈 자리는 창을 끄는 자리다. 레일이 서면 패널 토글은 머리 카드 밖, 레일 바로 위로 나가고
// 머리 카드는 레일 앞에서 끝난다(DS `.with-rail` · `.at-railtop`). 켜진 칸을 다시 누르면 패널이 닫히고 레일은 남으며, 칸을 다녀와도
// 안 보이는 몸은 마운트된 채라 접어 둔 것이 그대로다(ui-refresh 결정 9 · 10).
//
// **진열대(`e2e/rail-fixture.tsx`)에서 잰다.** 앱의 작업 화면은 칸이 `spec` 하나라 레일이 서지 않는다 — 그쪽은 `frame.spec.ts`가
// 「레일이 없고 패널 토글이 머리 카드 오른쪽 끝에 있다」로 잰다. 진열대는 같은 공용 틀에 시험용 둘째 칸 `files`를 건네고, 칸을 고른
// 뒤의 열림 · 고른 칸을 작업 화면과 같은 규칙(`pickRail`)으로, 몸을 같은 상자(`PanelBody`)로 그린다.

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

/**
 * 그 점에서 눌리는 요소 **자신**이 창을 끄는 자리인가(`frame.spec`의 `draggable`과 같은 판정). Tauri는 누른 요소 자신의
 * `data-tauri-drag-region`만 본다 — 회색이 드러나는 상자 하나가 그 속성을 빠뜨려도 화면으로는 안 보이고 이 층에서만 잡힌다.
 * 진열대는 앱 화면 위를 덮어(`position: fixed` · `z-index`) 그 점의 맨 위 요소가 진열대의 것이다.
 */
const 끄는자리 = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.hasAttribute("data-tauri-drag-region") ?? null,
    [x, y],
  );

test("칸이 둘이면 레일이 바탕 오른쪽 끝에 DS 모양으로 선다 — 흰 홈 · 28 칸 · 켜진 칸 fill-selected · hover fill-soft · 위끝 = 카드 위끝 · 칸이 패널을 가리킨다", async ({
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

  // 자리 — 위끝이 카드 위끝(머리 줄 아래)이고, 패널 카드와 틈 · 창 끝과 틈을 둔다. 패널 토글은 그 위 머리 줄, 줄의 가운데다.
  const gap = await 길이(page, "--space-2");
  const card = await 상자(showcase.getByRole("region", { name: "진열대 본문", exact: true }));
  const panel = await 상자(showcase.getByRole("region", { name: "진열대 패널", exact: true }));
  const toggle = await 상자(showcase.getByRole("button", { name: "진열대 패널 접기", exact: true }));
  const viewport = page.viewportSize()!;
  expect(home.y, "레일 위끝 = 카드 위끝").toBe(card.y);
  expect(card.y, "카드 위끝 = 머리 줄 아래").toBe(await 길이(page, "--titlebar-height"));
  expect(home.x - panel.right, "패널 카드와 레일 사이 틈").toBe(gap);
  expect(viewport.width - home.right, "레일 오른쪽 틈").toBe(gap);
  expect(toggle.x + toggle.width / 2, "패널 토글 가로 가운데 = 레일 가운데").toBe(home.x + home.width / 2);
  expect(toggle.bottom, "패널 토글은 레일 위 머리 줄").toBeLessThanOrEqual(home.y);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 레일이 서면 머리 줄이 갈린다(DS `.at-winhead.with-rail` · `.at-railtop`) — 패널 토글은 머리 카드 밖, 레일 열 바로 위의 자리(틈 +
// `size-prail`)로 나가고, 머리 카드는 그 자리 앞에서 끝나 아래 본문 열(패널 카드 오른쪽까지)과 같은 폭이다. 레일 열과 토글 자리의
// 회색은 창을 끄는 자리이고, 칸 · 토글은 눌리는 버튼이다(`Frame` 머리말 「틈도 창을 끄는 자리다」).
test("레일이 서면 패널 토글은 머리 카드 밖 레일 위에 서고 머리 카드는 레일 앞에서 끝나며 — 레일 열과 토글 둘레의 빈 자리가 창을 끄는 자리다", async ({
  page,
}) => {
  const showcase = await 진열대를세운다(page);
  const rail = showcase.getByRole("group", { name: "레일", exact: true });
  const toggleButton = showcase.getByRole("button", { name: "진열대 패널 접기", exact: true });
  const gap = await 길이(page, "--space-2");
  const prail = await 길이(page, "--size-prail");
  const viewport = page.viewportSize()!;
  const [home, head, panel, toggle] = [
    await 상자(rail),
    await 상자(머리카드(showcase)),
    await 상자(showcase.getByRole("region", { name: "진열대 패널", exact: true })),
    await 상자(toggleButton),
  ];

  // 머리 카드 — 오른쪽 끝이 본문 열의 끝(패널 카드 오른쪽)이고, 그 뒤가 레일 열(틈 + 줄 폭)과 창 오른쪽 틈이다.
  expect(head.right, "머리 카드 오른쪽 = 패널 카드 오른쪽").toBe(panel.right);
  expect(viewport.width - head.right, "머리 카드 뒤 = 틈 · 레일 · 틈").toBe(gap + prail + gap);
  // 패널 토글 — 머리 줄 안, 머리 카드 밖이다.
  expect(
    await toggleButton.evaluate((el, card) => [el.closest("header") !== null, el.closest(card) === null], HEAD_CARD),
  ).toEqual([true, true]);
  expect(toggle.x, "패널 토글은 머리 카드 오른쪽 너머").toBeGreaterThan(head.right);

  // 빈 자리는 창을 끄는 자리다 — 칸 묶음 아래, 레일 오른쪽 틈, 패널 카드와 레일 사이 틈, 머리 카드와 토글 사이, 토글 오른쪽 틈.
  const railMiddle = home.x + home.width / 2;
  const below = home.bottom + 40;
  const middle = toggle.y + toggle.height / 2;
  expect(await 끄는자리(page, railMiddle, below), "칸 묶음 아래").toBe(true);
  expect(await 끄는자리(page, viewport.width - gap / 2, below), "레일 오른쪽 틈").toBe(true);
  expect(await 끄는자리(page, panel.right + gap / 2, below), "패널 카드와 레일 사이 틈").toBe(true);
  expect(await 끄는자리(page, head.right + gap / 2, middle), "머리 카드와 토글 사이").toBe(true);
  expect(await 끄는자리(page, viewport.width - gap / 2, middle), "토글 오른쪽 틈").toBe(true);
  // 대조: 칸과 토글 자체는 눌리는 버튼이다.
  expect(await 끄는자리(page, railMiddle, home.y + home.height / 4), "칸").toBe(false);
  expect(await 끄는자리(page, toggle.x + toggle.width / 2, middle), "토글").toBe(false);
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
