import { expect, test, type Locator, type Page } from "./evidence";
import { installFixtureBackend, SPEC_LAYOUT_EDITOR, unknownIpcCalls, 칠한값, 칠한링, 토큰값, 토큰색 } from "./harness";

// codex-ds 티켓 23 — **설정 틀이 DS `SettingsGroup` 모양이다**(codex-ds 스펙 §7 · 스토리 60 · DS `.at-set*`). 몸은 글 폭(`size-thread`)
// 가운데에 글 거터 20 · 위 24로 서고, 큰 제목은 `heading-lg`다. 묶음은 흰 면 · `radius-xl` · 0.5px `border-heavy` 링이고 행 사이에
// 0.5px 선이 선다. 행은 60부터 · 안쪽 12 16 · 열 사이 16이고, 이름은 `text-sm` 500, 설명은 13 `fg-secondary`(스펙 S17 — 읽는 글),
// 컨트롤은 오른쪽 끝이다. spec 레이아웃 편집기의 폼도 같은 틀이다(`SpecLayoutEditor`의 `FormBody`).
//
// **이 층에서만 보인다.** 마크업 seam에는 CSS가 없어 면 · 반경 · 링 · 거터가 안 나온다. 기대값은 토큰에서 읽어 맞댄다 — 손으로 적은
// 수는 DS 표의 수(60 · 12 · 16 · 20 · 24 · 글자 단계)뿐이다.

/** 상자의 네 변. */
const 상자 = async (target: Locator) => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("상자가 화면에 없다");
  return { x: box.x, y: box.y, width: box.width, right: box.x + box.width, bottom: box.y + box.height };
};

/** 행 위끝의 0.5px 선(`::before`) — 없으면 `null`이다. */
const 윗선 = (row: Locator) =>
  row.evaluate((el) => {
    const line = getComputedStyle(el, "::before");
    if (line.display === "none" || line.content === "none" || line.content === "normal") return null;
    return [line.position, line.top, line.left, line.right, line.height, line.backgroundColor];
  });

/** 설정 묶음의 행 하나 — 이름 글자로 집는다. */
const 설정행 = (page: Page, name: string) =>
  page.locator('main [data-slot="settings-row"]').filter({ has: page.getByText(name, { exact: true }) });

/** 그 이름의 행을 든 설정 묶음 — 묶음의 표식(`data-slot="settings-group"`)으로 집는다. 행과 묶음 사이에 상자가 끼어도 묶음을 잰다. */
const 설정묶음 = (page: Page, name: string) =>
  page.locator('main [data-slot="settings-group"]').filter({ has: page.getByText(name, { exact: true }) });

test("Settings 몸은 글 거터 20 · 위 24에서 heading-lg 제목으로 시작하고, 넓은 창에서는 글 폭 size-thread 가운데다", async ({ page }) => {
  // 앱의 최소 창(900 — `tauri.conf.json`)에 사이드바를 연 채라 카드가 글 폭 + 거터 둘보다 좁다 — 글이 거터에 붙어 선다.
  await page.setViewportSize({ width: 900, height: 700 });
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");
  const main = page.locator("main");
  const 제목 = main.getByRole("heading", { name: "터미널", exact: true });
  await expect(제목).toBeVisible();
  const 묶음 = 설정묶음(page, "크기");

  expect(await 칠한값(제목, "font-size", "line-height", "font-weight"), "제목 — heading-lg").toEqual(["24px", "28px", "600"]);

  const thread = parseFloat(await 토큰값(page, "max-width", "--size-thread"));
  const [card, title, group] = [await 상자(main), await 상자(제목), await 상자(묶음)];
  // 앵커: 카드가 글 폭 + 거터 둘보다 좁다 — 넓으면 글이 가운데에 서서 아래 셈이 거터를 재지 않는다.
  expect(card.width, "카드가 글 폭 + 거터 둘보다 좁다").toBeLessThan(thread + 40);
  expect(title.x - card.x, "글 거터 왼쪽").toBe(20);
  expect(card.right - group.right, "글 거터 오른쪽").toBe(20);
  expect(title.y - card.y, "글은 카드 위 24에서 시작한다").toBe(24);

  // 넓은 창 — 글 폭이 `size-thread`에서 멈추고 카드 가운데에 선다.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(async () => (await 상자(묶음)).width, "묶음 폭 = size-thread").toBe(thread);
  const [wideCard, wideGroup] = [await 상자(main), await 상자(묶음)];
  expect(wideGroup.x - wideCard.x, "가운데").toBeCloseTo(wideCard.right - wideGroup.right, 0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Settings 묶음은 흰 면 · radius-xl · 0.5px 링이고, 행은 60 · 안쪽 12 16에 이름 text-sm 500 · 설명 13 fg-secondary · 컨트롤 오른쪽, 행 사이 0.5px 선이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");
  const [글꼴, 크기] = [설정행(page, "글꼴"), 설정행(page, "크기")];
  await expect(크기).toHaveCount(1);
  const 묶음 = 설정묶음(page, "크기");
  // 앵커: 두 행이 이 묶음의 첫째 · 둘째다 — 아래 「첫 행에는 선이 없다」가 다른 묶음의 행을 재지 않는다.
  const 행들 = 묶음.locator(":scope > *");
  await expect(행들.nth(0).getByText("글꼴", { exact: true })).toHaveCount(1);
  await expect(행들.nth(1).getByText("크기", { exact: true })).toHaveCount(1);
  expect(await 행들.nth(1).getAttribute("data-slot")).toBe("settings-row");

  // 묶음 — 흰 면 · radius-xl · 0.5px 링. 옛 옅은 면 묶음(행마다 `surface-under` · 행 사이 2px 틈)이 아니다.
  const [면, 반경] = await 칠한값(묶음, "background-color", "border-top-left-radius");
  expect([면, 반경, await 칠한링(묶음)], "묶음").toEqual([
    await 토큰색(page, "--surface"),
    await 토큰값(page, "border-top-left-radius", "--radius-xl"),
    [`${await 토큰색(page, "--border-heavy")} 0px 0px 0px 0.5px`],
  ]);
  expect(await 칠한값(묶음, "row-gap"), "행 사이 틈이 없다").toEqual(["normal"]);

  // 행 — 60부터 · 안쪽 12 16 · 이름과 컨트롤 사이 16 · 면 없음(묶음의 흰 면이 비친다).
  expect(
    await 칠한값(크기, "min-height", "padding-top", "padding-right", "padding-bottom", "padding-left", "column-gap", "background-color"),
    "행",
  ).toEqual(["60px", "12px", "16px", "12px", "16px", "16px", "rgba(0, 0, 0, 0)"]);

  // 이름 — text-sm 500. 설명 — 13/18 fg-secondary.
  expect(await 칠한값(크기.getByText("크기", { exact: true }), "font-size", "line-height", "font-weight"), "이름").toEqual([
    "14px",
    "20px",
    "500",
  ]);
  expect(await 칠한값(크기.getByText(/비워 두면 기본 크기/), "font-size", "line-height", "color"), "설명").toEqual([
    "13px",
    "18px",
    await 토큰색(page, "--fg-secondary"),
  ]);

  // 컨트롤은 오른쪽 끝이다 — 행 안쪽 16에 붙는다.
  const [row, unit] = [await 상자(크기), await 상자(크기.getByText("px", { exact: true }))];
  expect(row.right - unit.right, "컨트롤 오른쪽 끝").toBe(16);

  // 행 사이 0.5px 선 — 둘째 행부터 위끝에 묶음 폭 가득. 첫 행에는 없다(묶음의 링이 그 자리다).
  expect(await 윗선(글꼴), "첫 행").toBeNull();
  expect(await 윗선(크기), "둘째 행").toEqual([
    "absolute",
    "0px",
    "0px",
    "0px",
    "0.5px",
    await 토큰색(page, "--border-heavy"),
  ]);

  // 구획 제목 — 14/20 · 600.
  expect(await 칠한값(page.locator("main").getByText("모양", { exact: true }), "font-size", "line-height", "font-weight"), "구획 제목").toEqual([
    "14px",
    "20px",
    "600",
  ]);

  // 터미널 미리보기 상자 — 고른 테마의 바탕을 칠하는데, 밝은 테마의 바탕은 흰 묶음과 같은 흰색이다. 안쪽 1px `border-light` 링(코드
  // 상자 `.at-code`와 같은 링)이 가장자리를 세운다.
  const 미리보기 = 설정행(page, "미리보기").getByText(/git status/);
  expect(await 칠한링(미리보기), "미리보기 상자의 링").toEqual([`${await 토큰색(page, "--border-light")} 0px 0px 0px 1px inset`]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 편집기의 폼도 같은 틀이다 — 본문 카드 안에 글 거터 20 · 위 24로 서고, 묶음 · 행이 설정과 같은 모양이다. 트리 카드(340)가 옆에 서서
// 기본 창에서도 본문 카드가 글 폭 + 거터 둘보다 좁다.
test("spec 레이아웃 편집기의 폼도 글 거터 20 · 위 24에 서고 묶음이 같은 흰 묶음이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(SPEC_LAYOUT_EDITOR);
  const main = page.locator("main");
  const 아이콘칸 = main.getByRole("button", { name: "아이콘 바꾸기", exact: true });
  await expect(아이콘칸).toBeVisible();
  const 설명 = 설정행(page, "설명");
  const 묶음 = 설정묶음(page, "설명");

  const thread = parseFloat(await 토큰값(page, "max-width", "--size-thread"));
  const [card, icon, group] = [await 상자(main), await 상자(아이콘칸), await 상자(묶음)];
  expect(card.width, "앵커: 카드가 글 폭 + 거터 둘보다 좁다").toBeLessThan(thread + 40);
  expect(icon.x - card.x, "글 거터 왼쪽").toBe(20);
  expect(card.right - group.right, "글 거터 오른쪽").toBe(20);
  expect(icon.y - card.y, "위 24").toBe(24);

  const [면, 반경] = await 칠한값(묶음, "background-color", "border-top-left-radius");
  expect([면, 반경, await 칠한링(묶음)], "묶음").toEqual([
    await 토큰색(page, "--surface"),
    await 토큰값(page, "border-top-left-radius", "--radius-xl"),
    [`${await 토큰색(page, "--border-heavy")} 0px 0px 0px 0.5px`],
  ]);
  expect(await 윗선(설명), "둘째 행(설명) 위 선").not.toBeNull();

  expect(await unknownIpcCalls(page)).toEqual([]);
});
