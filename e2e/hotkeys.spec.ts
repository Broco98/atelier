import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { fireEvent, installFixtureBackend, processesTitle, unknownIpcCalls, 칠한값, 토큰색, 툴팁 } from "./harness";

// codex-ds 티켓 26 — **단축키가 한 표에서 나온다**(결정 19 · 스펙 §8 · S16). 단축키는 `src/lib/hotkeys.json` 한 장에만 적고, macOS
// 메뉴 바 · 메뉴 오른쪽 단축키 칸 · 툴팁 · 키 판정이 그 표를 읽는다. 여기서 재는 것은 사람이 보고 누르는 쪽이다.
// - 툴팁: 사이드바 토글에 ⌘B가 서고(스토리 98), 단축키가 있는 버튼은 그 키를 설명과 `aria-keyshortcuts`로 함께 말한다.
// - 메뉴 줄: 단축키 칸이 표의 글자를 DS `.at-mi .k` 값(12/18 · `fg-tertiary`)으로 줄 끝에 세우고, 줄은 그 키를 `aria-keyshortcuts`로
//   말한다. 단축키 칸을 다는 앱의 메뉴는 아직 없어(F2 · ⌘W가 서는 것은 티켓 28 · 29) 메뉴 부품의 진열대(`e2e/menu-fixture.tsx`)에서 잰다.
// - 메뉴 바: L3에는 네이티브 메뉴가 없다 — 메뉴가 하는 일은 `hotkey:menu`에 code를 실어 보내는 것 하나라(`lib.rs`의 `on_menu_event`)
//   그것을 손으로 쏜다. 표의 메뉴 바 항목마다 되돌린 keydown이 그 항목의 화음이고, 그 키가 직접 누른 것과 같은 일을 한다.
//
// 보이는 글자(⌘B · F2 …)는 표에서 읽지 않고 그대로 적는다 — 재는 것은 사람이 보는 글자다. 표 자체가 맞는지(보이는 글자 = 키 코드에서
// 나온 글자)는 L2 `src/lib/hotkeys.test.ts`가 잰다.

const [specWork] = WORKS;

/** 표 — 메뉴 바 흉내가 표의 메뉴 바 항목을 다 돌도록 그대로 읽는다(무엇을 쏠지만 표에서 온다). */
type Row = { code: string; mods: string[]; menu: string | null };
const 표 = JSON.parse(readFileSync(new URL("../src/lib/hotkeys.json", import.meta.url), "utf8")) as Record<string, Row>;

const 사이드바토글 = (page: Page) => page.getByRole("button", { name: "사이드바 토글", exact: true });
const 사이드바폭 = (page: Page) => page.locator("aside").first().evaluate((el) => Math.round(el.getBoundingClientRect().width));

test("사이드바 토글의 도움말에 ⌘B가 서고 상태를 탄다 — 이름은 그대로이고 키는 설명 · aria-keyshortcuts로 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  const toggle = 사이드바토글(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // 이름은 「사이드바 토글」 그대로다 — 도움말은 눈에만 뜨고, 키는 설명(S28 — `Hint`의 `shortcut`)과 `aria-keyshortcuts`로 남는다.
  await expect(toggle).toHaveAccessibleDescription("⌘B");
  await expect(toggle).toHaveAttribute("aria-keyshortcuts", "Meta+B");

  await toggle.hover();
  await expect(툴팁(page)).toHaveText("사이드바 접기 ⌘B");
  await expect(툴팁(page).locator("[data-slot=kbd]")).toHaveText("⌘B");

  // 접으면 도움말이 「펼치기」다 — 비켰다가 다시 올린다. 버튼은 접힌 뒤에도 머리 줄 그 자리에 남는다.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => 사이드바폭(page)).toBe(0);
  await page.mouse.move(600, 400);
  await expect(툴팁(page)).toHaveCount(0);
  await toggle.hover();
  await expect(툴팁(page)).toHaveText("사이드바 펼치기 ⌘B");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("단축키가 있는 머리 줄 버튼은 표의 글자를 설명으로, 같은 항목의 값을 aria-keyshortcuts로 든다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const 버튼들 = [
    { 버튼: 사이드바토글(page), 글자: "⌘B", 값: "Meta+B" },
    { 버튼: page.getByRole("button", { name: "검색", exact: true }), 글자: "⌘K", 값: "Meta+K" },
    { 버튼: page.getByRole("button", { name: "작업 패널 접기", exact: true }), 글자: "⌘Enter", 값: "Meta+Enter" },
  ];
  for (const { 버튼, 글자, 값 } of 버튼들) {
    await expect(버튼).toHaveAccessibleDescription(글자);
    await expect(버튼).toHaveAttribute("aria-keyshortcuts", 값);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 메뉴 부품의 진열대를 Processes 화면 위에 세우고 연다(`submenu.spec.ts`와 같은 길). */
async function 진열대를연다(page: Page): Promise<void> {
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await page.addScriptTag({
    type: "module",
    content: 'import { 메뉴진열대를세운다 } from "/e2e/menu-fixture.tsx"; 메뉴진열대를세운다();',
  });
  await page.getByRole("button", { name: "진열대 메뉴", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "이름 바꾸기", exact: true })).toBeVisible();
}

test("메뉴 줄의 단축키 칸은 표의 글자를 12/18 · fg-tertiary로 줄 끝에 세우고, 줄은 그 키를 aria-keyshortcuts로 말한다", async ({
  page,
}) => {
  await 진열대를연다(page);
  // 이름은 「이름 바꾸기」 그대로다 — 보이는 글자(F2)는 이름에 섞이지 않는다(`aria-hidden`).
  const 줄 = page.getByRole("menuitem", { name: "이름 바꾸기", exact: true });
  await expect(줄).toHaveAttribute("aria-keyshortcuts", "F2");
  const 칸 = 줄.locator("[data-slot=dropdown-menu-shortcut]");
  await expect(칸).toHaveText("F2");
  await expect(칸).toHaveAttribute("aria-hidden", "true");

  const 흐린글자 = await 토큰색(page, "--fg-tertiary");
  expect(await 칠한값(칸, "font-size", "line-height", "color")).toEqual(["12px", "18px", 흐린글자]);
  // 줄의 마지막 칸이다 — 오른쪽 끝이 줄의 안쪽 끝(좌우 8)에 붙는다.
  const [칸상자, 줄상자] = [await 칸.boundingBox(), await 줄.boundingBox()];
  if (!칸상자 || !줄상자) throw new Error("상자가 없다");
  expect(Math.abs(줄상자.x + 줄상자.width - 8 - (칸상자.x + 칸상자.width))).toBeLessThanOrEqual(0.5);

  // 켜진 줄에서도 같은 색이다(DS `.at-mi .k`). 앵커: 줄이 정말 켜졌다 — 면이 `fill-hover`다.
  await 줄.hover();
  await expect.poll(() => 칠한값(줄, "background-color")).toEqual([await 토큰색(page, "--fill-hover")]);
  expect(await 칠한값(칸, "color")).toEqual([흐린글자]);

  // 단축키가 없는 줄에는 칸도 값도 없다.
  const 없는줄 = page.getByRole("menuitem", { name: "복사", exact: true });
  await expect(없는줄.locator("[data-slot=dropdown-menu-shortcut]")).toHaveCount(0);
  await expect(없는줄).not.toHaveAttribute("aria-keyshortcuts", /.*/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("메뉴 바 흉내 — 표의 메뉴 바 항목마다 되돌린 keydown이 그 항목의 화음이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  // 창에 오는 keydown을 맨 앞(capture)에서 적는다. 그 키가 그 화면에서 무엇을 하든 상관없이, 되돌린 모양만 본다.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __키: string[] }).__키 = seen;
    window.addEventListener(
      "keydown",
      (e) => seen.push(`${e.code} ${[e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "meta"].filter(Boolean).join("+")}`),
      { capture: true },
    );
  });
  const 메뉴바 = Object.values(표).filter((row) => row.menu !== null);
  // 앵커: 메뉴 바 항목이 열넷이다(⌘K · ⌘B · ⌘Enter · ⌘T · ⌘J · ⌘1–9) — 표를 못 읽어 빈 목록이면 아래 견줌이 초록이다.
  expect(메뉴바).toHaveLength(14);
  for (const row of 메뉴바) await fireEvent(page, "hotkey:menu", row.code);

  const 받은것 = await page.evaluate(() => (window as unknown as { __키: string[] }).__키);
  expect(받은것).toEqual(메뉴바.map((row) => `${row.code} ${row.mods.join("+")}`));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("메뉴 바 흉내로 보낸 ⌘B · ⌘Enter · ⌘T · ⌘1이 키를 누른 것과 같은 일을 한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const 메뉴로 = (code: string) => fireEvent(page, "hotkey:menu", code);

  // ⌘B — 사이드바를 접고 편다.
  expect(await 사이드바폭(page)).toBeGreaterThan(0);
  await 메뉴로("KeyB");
  await expect.poll(() => 사이드바폭(page)).toBe(0);
  await 메뉴로("KeyB");
  await expect.poll(() => 사이드바폭(page)).toBeGreaterThan(0);

  // ⌘Enter — 작업 패널을 여닫는다.
  const 패널토글 = page.getByRole("button", { name: /^작업 패널 (접기|펼치기)$/ });
  await expect(패널토글).toHaveAttribute("aria-expanded", "true");
  await 메뉴로("Enter");
  await expect(패널토글).toHaveAttribute("aria-expanded", "false");
  await 메뉴로("Enter");
  await expect(패널토글).toHaveAttribute("aria-expanded", "true");

  // ⌘T — 셸을 열고 본문이 터미널로 간다. ⌘1 — 다시 spec으로 온다.
  const 셸칸 = page.locator('[data-tab="shell"]');
  const 스펙칸 = page.locator('[data-tab="spec"]');
  await expect(스펙칸).toHaveAttribute("aria-pressed", "true");
  const 처음 = await 셸칸.count();
  await 메뉴로("KeyT");
  await expect(셸칸).toHaveCount(처음 + 1);
  await expect(스펙칸).toHaveAttribute("aria-pressed", "false");
  await 메뉴로("Digit1");
  await expect(스펙칸).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
