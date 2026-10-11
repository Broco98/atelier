import { expect, test, type Locator, type Page } from "./evidence";
import { installFixtureBackend, processesTitle, unknownIpcCalls, 그림자, 칠한값, 토큰값, 토큰색 } from "./harness";

// codex-ds 티켓 11 — **하위 메뉴**(codex-ds 결정 10 · 스펙 §3 「메뉴」 · DS `Menu` · `ContextMenu` 보드). 트리거 줄 끝에 14px `fg-tertiary`
// 셰브런이 서고, 연 동안 그 줄은 켜진 줄의 면(`fill-hover`)이다. 카드는 ⋯ 메뉴와 같은 카드(`radius-2xl` · `shadow-prominent`)이고 폭은
// 내용을 따르되 168–220이다. 첫 줄이 연 줄과 같은 높이에 서고, 부모 카드에서 4 떨어진다. → · 포인터로 열고 ←로 닫는다.
//
// **아직 하위 메뉴를 다는 화면이 없다** — 그래서 메뉴 부품의 진열대(`e2e/menu-fixture.tsx`)를 앱 화면 위에 세워 잰다. 진열대는 앱과
// 같은 부품 · 같은 CSS로 그려진다(그 파일 머리말). 처음 하위 메뉴를 다는 화면(티켓 16의 work 메뉴)이 오면 그 화면의 L3도 같은 값을 잰다.
//
// 카드는 열릴 때 0.98에서 1로 커지므로(DS 「움직임」) 자리 · 폭은 애니메이션이 끝난 뒤에 잰다.

/** 진열대를 Processes 화면 위에 세우고 그 메뉴를 연다. 앱 화면 위라 `index.css`가 이미 서 있다. */
async function 진열대를연다(page: Page): Promise<void> {
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  // 모듈 스크립트로 들인다 — Vite가 이 파일과 그 의존(`@/components/ui/dropdown-menu` · `react-dom`)을 앱과 같은 판으로 내준다.
  await page.addScriptTag({
    type: "module",
    content: 'import { 메뉴진열대를세운다 } from "/e2e/menu-fixture.tsx"; 메뉴진열대를세운다();',
  });
  await page.getByRole("button", { name: "진열대 메뉴", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "이름 바꾸기", exact: true })).toBeVisible();
}

/** 그 카드의 열림 애니메이션이 끝날 때까지 기다린다. */
const 멎는다 = (card: Locator) =>
  card.evaluate((el) => Promise.all(el.getAnimations().map((one) => one.finished.catch(() => undefined))));

const 상자 = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error(`상자가 없다 — ${target}`);
  return box;
};

const 부모카드 = (page: Page) => page.locator("[data-slot=dropdown-menu-content]");
const 하위카드 = (page: Page) => page.locator("[data-slot=dropdown-menu-sub-content]");

test("하위 메뉴 트리거는 끝에 14 · fg-tertiary 셰브런을 들고, 연 동안 켜진 줄의 면이다", async ({ page }) => {
  await 진열대를연다(page);
  const 트리거 = page.getByRole("menuitem", { name: "복사", exact: true });
  // 줄의 마지막 칸이 셰브런이다 — 앞의 것은 줄의 글리프(15)다.
  const 셰브런 = 트리거.locator("svg").last();
  expect(await 칠한값(셰브런, "width", "height", "color")).toEqual(["14px", "14px", await 토큰색(page, "--fg-tertiary")]);
  expect(await 칠한값(트리거.locator("svg").first(), "width"), "줄 글리프").toEqual(["15px"]);

  await 트리거.hover();
  await expect(하위카드(page)).toBeVisible();
  // 포인터가 하위 메뉴로 넘어가 트리거의 켜짐이 빠져도 연 줄의 면은 남는다(DS `.at-mi.is-open`).
  await page.getByRole("menuitem", { name: "경로", exact: true }).hover();
  await expect(트리거).toHaveAttribute("data-popup-open", "");
  await expect.poll(() => 칠한값(트리거, "background-color")).toEqual([await 토큰색(page, "--fill-hover")]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("하위 메뉴 카드는 ⋯ 메뉴와 같은 카드이고, 첫 줄이 연 줄과 같은 높이 · 부모 카드에서 4 떨어져 선다", async ({ page }) => {
  await 진열대를연다(page);
  const 트리거 = page.getByRole("menuitem", { name: "복사", exact: true });
  await 트리거.hover();
  const 카드 = 하위카드(page);
  await expect(카드).toBeVisible();
  await Promise.all([멎는다(부모카드(page)), 멎는다(카드)]);

  // 카드 — 반경 · 그림자가 ⋯ 메뉴의 카드와 같은 토큰이다(같은 `MenuCard`).
  const [반경, 칠한그림자] = await 칠한값(카드, "border-top-left-radius", "box-shadow");
  expect(반경).toBe(await 토큰값(page, "border-top-left-radius", "--radius-2xl"));
  expect(반경, "radius-2xl").toBe("16px");
  expect(그림자(칠한그림자)).toBe(await 토큰값(page, "box-shadow", "--shadow-prominent"));

  // 자리 — 첫 줄의 위끝이 연 줄의 위끝이고(카드를 안쪽 6만큼 올린다), 카드의 왼끝이 부모 카드의 오른끝에서 4다.
  const [줄, 첫줄, 부모, 하위] = await Promise.all([
    상자(트리거),
    상자(page.getByRole("menuitem", { name: "경로", exact: true })),
    상자(부모카드(page)),
    상자(카드),
  ]);
  expect(Math.abs(첫줄.y - 줄.y), `첫 줄 ${첫줄.y} · 연 줄 ${줄.y}`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(하위.x - (부모.x + 부모.width) - 4), `카드 사이 ${하위.x - (부모.x + 부모.width)}`).toBeLessThanOrEqual(0.5);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("하위 메뉴 카드의 폭은 내용을 따르되 168–220이다 — 짧으면 168, 길면 220에서 줄임표로 접힌다", async ({ page }) => {
  await 진열대를연다(page);
  // 카드는 연 줄의 이름으로 집는다 — 옮겨 가는 동안 앞 카드가 닫히는 애니메이션으로 잠깐 함께 선다.
  const 짧은카드 = page.getByRole("menu", { name: "복사", exact: true });
  const 긴카드 = page.getByRole("menu", { name: "Finder에서 열기", exact: true });
  await page.getByRole("menuitem", { name: "복사", exact: true }).hover();
  await expect(짧은카드).toBeVisible();
  await 멎는다(짧은카드);
  expect(await 칠한값(짧은카드, "width"), "짧은 줄만 든 카드").toEqual(["168px"]);

  // 다른 하위 메뉴로 옮겨 간다. 하위 메뉴가 포인터로 열린 동안 Base UI는 부모 카드의 포인터를 막아 두어(하위 메뉴로 가는 길에
  // 지나는 줄이 켜지지 않게 — 안전 삼각형) `hover()`는 그 줄이 가려졌다고 본다. 그래서 손이 지나가듯 마우스를 옮긴다 — 삼각형
  // 밖으로 나가는 순간 앞 하위 메뉴가 닫히고 막음이 풀려, 뒤의 움직임이 그 줄에 닿는다.
  const 핀더 = await 상자(page.getByRole("menuitem", { name: "Finder에서 열기", exact: true }));
  await page.mouse.move(핀더.x + 핀더.width / 2, 핀더.y + 핀더.height / 2, { steps: 8 });
  const 긴줄 = page.getByRole("menuitem", { name: /^아주 긴 프로젝트 이름/ });
  await expect(긴줄).toBeVisible();
  await 멎는다(긴카드);
  expect(await 칠한값(긴카드, "width"), "긴 줄을 든 카드").toEqual(["220px"]);
  // 넘친 이름은 줄 안에서 접힌다 — 카드 밖으로 새지 않는다.
  expect(await 긴줄.locator("span").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("하위 메뉴는 →로 열려 첫 줄로 가고, ←로 닫혀 연 줄로 돌아온다", async ({ page }) => {
  await 진열대를연다(page);
  const 트리거 = page.getByRole("menuitem", { name: "복사", exact: true });
  // 첫 줄에서 ↓ 한 번이 「복사」다 — 키보드로 그 줄까지 간다.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "이름 바꾸기", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(트리거).toBeFocused();
  await expect(하위카드(page)).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(하위카드(page)).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "경로", exact: true })).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(하위카드(page)).toHaveCount(0);
  await expect(트리거).toBeFocused();
  // 부모 메뉴는 그대로 열려 있다 — ←는 한 단계만 닫는다.
  await expect(page.getByRole("menuitem", { name: "이름 바꾸기", exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
