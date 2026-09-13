import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 끌기 제스처의 **끝나는 길**(UI개선 티켓 03 · UI개선 스펙 S5). 제스처는 기능 폴더 밖 공용 모듈이
// 쥐고(`src/lib/pointer-drag.ts`), 이 파일은 그 모듈이 어느 화면에서 부르든 지켜야 하는 것을
// 셸 탭 하나로 잰다 — 놓음 · `pointercancel` · 문턱 전 뗌 · Esc 넷이 **같은 정리**를 한다.
//
// 놓일 자리와 분할 계산은 `works-split.spec.ts`의 몫이라 여기서 다시 안 본다. 이 층이어야
// 하는 이유는 그쪽과 같다: 창 포인터 리스너·body 표시·클릭 삼킴은 이벤트가 있어야 선다.

const [, plainWork] = WORKS;

type Box = { x: number; y: number; width: number; height: number };

const middle = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** 셸 탭의 이름 버튼 — 끄는 자리이자 켜짐을 말하는 자리다. */
const shellName = (page: Page) => page.locator('[data-tab="shell"] button[aria-pressed]');

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector}의 상자를 못 읽었다`);
  return box;
}

async function shellNameCenter(page: Page) {
  const box = await shellName(page).boundingBox();
  if (!box) throw new Error("셸 탭의 상자를 못 읽었다");
  return middle(box);
}

/**
 * body의 끄는 중 표시. **이 표시가 남으면 다시는 글을 선택할 수 없는 앱이 된다** — 끝나는
 * 길마다 걷혀야 하는 것이 그래서다. 클래스 이름이 아니라 **그 결과(글 선택 막힘)**를 읽는다 —
 * CSS 규칙이 깨져도 여기서 드러난다.
 */
const dragging = (page: Page) =>
  page.evaluate(() => {
    // WKWebView(과 L3의 WebKit)는 계산값을 접두사 이름으로만 낸다.
    const style = getComputedStyle(document.body);
    return (style.getPropertyValue("user-select") || style.getPropertyValue("-webkit-user-select")) === "none";
  });

/** 셸이 앉은 work 화면(터미널 본문)에서 출발한다. */
async function openTerminal(page: Page) {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
}

/**
 * 셸을 띄운 뒤 본문을 문서로 돌려 **셸 탭이 꺼진 채** 출발한다 — 켜지는 것이 클릭이 살아
 * 있다는 모습이라, 이미 켜져 있으면 눌려도 모습이 안 바뀐다.
 */
async function openTerminalOnSpec(page: Page) {
  await openTerminal(page);
  await page.locator('[data-tab="spec"]').click();
  await expect(shellName(page)).toHaveAttribute("aria-pressed", "false");
}

/** 셸 탭을 눌러 문턱을 넘긴다. **표시가 섰는지 먼저 본다** — 안 서면 아래 「걷혔다」가 빈 초록이다. */
async function startDrag(page: Page) {
  const from = await shellNameCenter(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y);
  await expect(page.locator("[data-drop-half]")).toHaveCount(2);
  expect(await dragging(page)).toBe(true);
  return from;
}

async function moveOnto(page: Page, half: "left" | "right") {
  const at = middle(await boxOf(page, `[data-drop-half="${half}"]`));
  await page.mouse.move(at.x, at.y);
  await expect(page.locator(`[data-drop-half="${half}"]`)).toHaveAttribute("data-over", "");
}

const ptyWrites = async (page: Page) =>
  ((await readIpcRecord(page))?.calls ?? []).filter((call) => call.startsWith("pty_write")).length;

test.describe("끝나는 길 넷이 body 표시를 걷는다", () => {
  test("놓음", async ({ page }) => {
    await openTerminal(page);
    await startDrag(page);
    await moveOnto(page, "right");
    await page.mouse.up();

    await expect(page.locator("[data-drop-half]")).toHaveCount(0);
    expect(await dragging(page)).toBe(false);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // Playwright 마우스로는 `pointercancel`을 못 만든다 — 창에 직접 쏜다. 리스너가 창에 걸려
  // 있으므로 실물(시스템이 제스처를 가로챔)과 같은 자리에 닿는다.
  test("pointercancel", async ({ page }) => {
    await openTerminal(page);
    await startDrag(page);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel")));

    await expect(page.locator("[data-drop-half]")).toHaveCount(0);
    expect(await dragging(page)).toBe(false);
    await page.mouse.up();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 문턱 전에 떼면 **표시가 애초에 안 선다** — 그리고 그 눌림은 그냥 클릭이다(탭이 켜진다).
  // 떼기 전을 한 번 보는 것은 「뗀 뒤에 걷혔다」와 「선 적이 없다」가 둘 다 false라서다.
  test("문턱 전에 뗌", async ({ page }) => {
    await openTerminalOnSpec(page);

    const from = await shellNameCenter(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 3, from.y);
    expect(await dragging(page)).toBe(false);
    await page.mouse.up();

    expect(await dragging(page)).toBe(false);
    await expect(shellName(page)).toHaveAttribute("aria-pressed", "true");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Esc", async ({ page }) => {
    await openTerminal(page);
    await startDrag(page);
    await page.keyboard.press("Escape");

    await expect(page.locator("[data-drop-half]")).toHaveCount(0);
    expect(await dragging(page)).toBe(false);
    await page.mouse.up();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

// Esc는 **끌기를 취소하고 아무것도 안 부른다.** 본문 절반 위에서 눌러도 분할이 안 서고,
// 셸에도 안 샌다.
//
// **포커스를 xterm에 손으로 돌려놓는다.** 실물(WKWebView)에서는 버튼을 눌러도 포커스가 안
// 옮겨가 탭을 끄는 동안 포커스가 xterm의 숨은 입력칸에 남는데, Chromium은 누른 버튼으로
// 포커스를 옮긴다 — 그대로 두면 Esc가 애초에 셸로 갈 길이 없어 「안 샌다」가 빈 초록이다.
test("셸 탭을 본문 절반 위에서 Esc로 놓으면 분할도 셸 입력도 없다", async ({ page }) => {
  await openTerminal(page);
  await startDrag(page);
  await moveOnto(page, "right");
  await page.locator("textarea.xterm-helper-textarea").focus();
  const before = await ptyWrites(page);

  await page.keyboard.press("Escape");
  // 겹판이 걷힌 뒤라 같은 자리에서 떼도 받을 것이 없다.
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await page.mouse.up();

  await expect(page).not.toHaveURL(/split=/);
  await expect(page.locator("[data-column]")).toHaveCount(0);
  expect(await ptyWrites(page)).toBe(before);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **끌어 놓은 탭은 켜지지 않는다**(S5) — 출발한 탭 위로 되돌아와 떼면 pointerdown/up이 같은
// 버튼이라 브라우저가 `click`을 낸다. 제스처가 그 한 번을 삼킨다.
//
test("끌었다 셸 탭 위에서 떼면 그 탭이 켜지지 않는다", async ({ page }) => {
  await openTerminalOnSpec(page);

  const from = await startDrag(page);
  await moveOnto(page, "right");
  await page.mouse.move(from.x, from.y);
  await page.mouse.up();

  await expect(page).not.toHaveURL(/split=/);
  await expect(page).not.toHaveURL(/tab=terminal/);
  await expect(shellName(page)).toHaveAttribute("aria-pressed", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Esc로 취소한 끌기도 **문턱을 넘은 끌기**다 — 그 뒤 출발한 탭 위에서 떼도 탭이 안 켜진다.
// 취소가 「아무 일도 안 일어난다」인데 뗀 순간 탭이 켜지면 한 일이 생긴다.
test("Esc로 취소한 뒤 셸 탭 위에서 떼도 그 탭이 켜지지 않는다", async ({ page }) => {
  await openTerminalOnSpec(page);

  const from = await startDrag(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.up();

  await expect(page).not.toHaveURL(/tab=terminal/);
  await expect(shellName(page)).toHaveAttribute("aria-pressed", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
