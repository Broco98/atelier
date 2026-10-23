import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  callCount,
  installFixtureBackend,
  unknownIpcCalls,
  workRow,
  시계를세운다,
  토큰시간,
  툴팁,
  행버튼,
  호버카드,
  창검색버튼,
  Work줄이가는곳,
} from "./harness";

// codex-ds 티켓 33 — **툴팁과 호버 카드가 멈추면 바로 뜬다**(codex-ds 스펙 §8 「뜨는 시간」 · 결정 20 · 스토리 99–103).
// 툴팁과 사이드바 작업 행의 호버 카드가 한 무리로 움직인다: 첫 번째는 포인터가 멈춘 지 `duration-tip`에 서고, 하나가 떠 있는
// 동안(그리고 닫힌 직후 잠깐) 옆 대상으로 옮기면 곧바로 선다. 카드는 떠난 지 `duration-peek-close`에 닫히고 카드 안으로 들어오면
// 남는다. 메뉴(⋯ · 우클릭 · 상태)가 열린 동안은 둘 다 서지 않는다. 무리는 포인터의 것이다 — 키보드 포커스로 선 툴팁은 무리 밖에
// 서고, 키로 누른 행은 카드를 잠재우지 않는다.
//
// **시간은 페이지의 시계로 잰다** — goto 전에 `page.clock.install()`, 올리기 전에 `시계를세운다`. 세운 시계에서는 `runFor`로만 시간이
// 흐르므로 「안 섰다」는 그 바로 뒤의 「섰다」를 앵커로 잰다(지연이 0이 아님). 「곧바로」는 시계를 한 칸도 안 돌리고 잰다. 길이는
// 토큰에서 읽는다 — 리터럴로 적으면 토큰을 고친 날 이 파일만 옛 길이를 잰다. 닫히는 툴팁은 세운 시계에서 나가는 애니메이션을 끝내지
// 못해 잠깐 남으므로, 툴팁은 글자로 좁혀 센다.

const [pinnedWork, plainWork, multiWork] = WORKS;

/** 뜨는 · 닫는 길이 둘 — 스펙이 박은 값(결정 20)인지 먼저 본다. 토큰을 다른 수로 고치면 이 파일이 아니라 스펙을 고칠 일이다. */
async function 길이들(page: Page): Promise<{ tip: number; peekClose: number }> {
  const tip = await 토큰시간(page, "--duration-tip");
  const peekClose = await 토큰시간(page, "--duration-peek-close");
  expect(tip, "duration-tip").toBe(150);
  expect(peekClose, "duration-peek-close").toBe(200);
  return { tip, peekClose };
}

/** 사이드바 머리(셸 컨트롤 줄)의 검색 버튼과 그 옆 사이드바 토글 — 둘 다 툴팁을 단 이웃이다. */
const 검색 = (page: Page) => 창검색버튼(page);
const 사이드바토글 = (page: Page) => page.getByRole("button", { name: "사이드바 토글", exact: true });

/** 그 글자의 툴팁 — 닫히는 툴팁이 잠깐 남아도 섞이지 않게 글자로 좁힌다. */
const 툴팁글 = (page: Page, text: string) => 툴팁(page).filter({ hasText: text });

/** 툴팁도 카드도 없는 자리로 포인터를 비킨다 — 본문 카드의 오른쪽 아래 끝이다. */
async function 비킨다(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width - 8, viewport.height - 8);
}

/** 그 상자의 가운데 — 메뉴가 열려 바깥이 보조 기술에서 숨은 동안에도 쓰려고 열기 전에 잰다. */
async function 가운데(target: Locator): Promise<{ x: number; y: number }> {
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 열린 메뉴를 Esc로 닫는다 — 닫히는 메뉴는 세운 시계에서 나가는 움직임을 끝내지 못해 남으므로 시계를 돌려 걷는다. */
async function 메뉴를닫는다(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.clock.runFor(1000);
  await expect(page.getByRole("menu")).toHaveCount(0);
}

async function 연다(page: Page, path = `/works/${pinnedWork.slug}`): Promise<{ tip: number; peekClose: number }> {
  await installFixtureBackend(page);
  await page.clock.install();
  await page.goto(path);
  await expect(workRow(page, plainWork.slug)).toBeVisible();
  const times = await 길이들(page);
  await 시계를세운다(page);
  return times;
}

// ── 첫 번째는 멈춘 지 duration-tip (스토리 99 · 101) ──
// 멈춤을 기다린다 — 들어선 때가 아니다. 움직이는 동안은 서지 않아, 사이드바를 지나 본문으로 가는 포인터가 스치는 행마다 카드를
// 세우지 않는다. 움직임 사이에 시계를 돌려 「행 위에 머문 시간」이 지연을 넘게 두고, 그래도 안 서는 것을 잰다.

test("툴팁은 멈춘 지 duration-tip에 서고, 움직이는 동안은 서지 않는다", async ({ page }) => {
  const { tip } = await 연다(page);
  const search = await 가운데(검색(page));

  await page.mouse.move(search.x - 6, search.y);
  for (const dx of [-2, 2, 6]) {
    await page.clock.runFor(tip - 50);
    await page.mouse.move(search.x + dx, search.y);
  }
  // 버튼 위에 머문 지 지연의 세 배가 넘었다 — 그래도 움직이는 동안은 없다.
  await expect(툴팁(page)).toHaveCount(0);

  await page.clock.runFor(tip - 1);
  await expect(툴팁(page)).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(툴팁글(page, "검색")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("호버 카드는 멈춘 지 duration-tip에 서고, 스치는 행에는 서지 않는다", async ({ page }) => {
  const { tip } = await 연다(page);
  const card = 호버카드(page);
  const rows = [pinnedWork, plainWork, multiWork].map((work) => workRow(page, work.slug));
  const spots = await Promise.all(rows.map(가운데));

  // 행을 차례로 스친다 — 행마다 지연보다 짧게 머문다.
  for (const spot of spots) {
    await page.mouse.move(spot.x, spot.y);
    await page.clock.runFor(tip - 50);
    await expect(card).toHaveCount(0);
  }
  // 한 행 위에서 움직이기만 하면 머문 시간이 지연을 넘어도 서지 않는다.
  const last = spots[spots.length - 1];
  for (const dx of [4, 8, 12]) {
    await page.mouse.move(last.x + dx, last.y);
    await page.clock.runFor(tip - 50);
  }
  await expect(card).toHaveCount(0);

  await page.clock.runFor(49);
  await expect(card).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(card).toContainText(multiWork.title);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 하나가 떠 있는 동안 옆으로 옮기면 0 (스토리 100) ──
// 툴팁끼리 · 카드끼리 · 툴팁과 카드 사이가 모두 한 무리다. 「곧바로」는 시계를 한 칸도 돌리지 않고 잰다 — 세운 시계에서는 지연이
// 1ms라도 있으면 서지 않는다.

test("툴팁이 떠 있는 동안 옆 버튼으로 옮기면 곧바로 바뀌고, 닫힌 직후 잠깐도 그렇다", async ({ page }) => {
  const { tip } = await 연다(page);

  await 검색(page).hover();
  await page.clock.runFor(tip);
  await expect(툴팁글(page, "검색")).toBeVisible();

  // 떠 있는 동안 옆으로.
  await 사이드바토글(page).hover();
  await expect(툴팁글(page, "사이드바 접기")).toBeVisible();

  // 닫힌 직후 잠깐 — 비켜서 닫고, 지연보다 짧게 쉰 뒤 옆으로.
  await 비킨다(page);
  await page.clock.runFor(tip - 50);
  await 검색(page).hover();
  await expect(툴팁글(page, "검색")).toBeVisible();

  // 그 잠깐이 지나면 다시 멈춤을 기다린다.
  await 비킨다(page);
  await page.clock.runFor(1000);
  await expect(툴팁(page)).toHaveCount(0);
  await 사이드바토글(page).hover();
  await page.clock.runFor(tip - 1);
  await expect(툴팁(page)).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(툴팁글(page, "사이드바 접기")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("호버 카드가 떠 있는 동안 옆 행으로 옮기면 곧바로 그 행의 카드로 바뀌고, 카드는 그 행 옆에 선다", async ({ page }) => {
  const { tip } = await 연다(page);
  const card = 호버카드(page);
  const next = workRow(page, multiWork.slug);

  await workRow(page, plainWork.slug).hover();
  await page.clock.runFor(tip);
  await expect(card).toContainText(plainWork.title);

  await next.hover();
  await expect(card).toContainText(multiWork.title);
  await expect(card).toHaveCount(1);
  // 카드가 옛 행 옆에 남지 않는다 — 오른쪽 옆에 서서 윗변을 행과 맞춘다(`PopoverPortal`의 `side="right"`).
  const row = (await next.boundingBox())!;
  await expect.poll(async () => Math.round((await card.boundingBox())!.y)).toBe(Math.round(row.y));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("호버 카드가 떠 있으면 툴팁이 곧바로 서고, 툴팁이 떠 있으면 카드가 곧바로 선다", async ({ page }) => {
  const { tip } = await 연다(page);
  const card = 호버카드(page);

  await workRow(page, plainWork.slug).hover();
  await page.clock.runFor(tip);
  await expect(card).toContainText(plainWork.title);
  await 검색(page).hover();
  await expect(툴팁글(page, "검색")).toBeVisible();

  // 둘 다 닫고 잠깐이 지난 뒤, 이번에는 툴팁에서 카드로.
  await 비킨다(page);
  await page.clock.runFor(1000);
  await expect(card).toHaveCount(0);
  await expect(툴팁(page)).toHaveCount(0);
  await 검색(page).hover();
  await page.clock.runFor(tip);
  await expect(툴팁글(page, "검색")).toBeVisible();
  await workRow(page, multiWork.slug).hover();
  await expect(card).toContainText(multiWork.title);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 닫힌 직후 잠깐은 앱 무리가 든다 — 공급자의 무리는 툴팁끼리만 잰다(위 툴팁 검사). 카드가 닫힌 직후의 행 · 툴팁, 툴팁이 닫힌 직후의
// 행이 이 무리의 몫이다. 비킨 뒤 지연보다 짧게 쉬고 옮긴다 — 그래도 곧바로 서는 것은 그 잠깐 덕이다.
test("호버 카드가 닫힌 직후 잠깐은 옆 행의 카드도 툴팁도 곧바로 서고, 툴팁이 닫힌 직후 잠깐은 카드가 곧바로 선다", async ({ page }) => {
  const { tip, peekClose } = await 연다(page);
  const card = 호버카드(page);

  // 카드가 닫힌 직후 → 옆 행의 카드.
  await workRow(page, plainWork.slug).hover();
  await page.clock.runFor(tip);
  await expect(card).toContainText(plainWork.title);
  await 비킨다(page);
  await page.clock.runFor(peekClose);
  await expect(card).toHaveCount(0);
  await page.clock.runFor(tip - 50);
  await workRow(page, multiWork.slug).hover();
  await expect(card).toContainText(multiWork.title);

  // 카드가 닫힌 직후 → 툴팁.
  await 비킨다(page);
  await page.clock.runFor(peekClose);
  await expect(card).toHaveCount(0);
  await page.clock.runFor(tip - 50);
  await 검색(page).hover();
  await expect(툴팁글(page, "검색")).toBeVisible();

  // 툴팁이 닫힌 직후 → 카드.
  await 비킨다(page);
  await page.clock.runFor(tip - 50);
  await workRow(page, plainWork.slug).hover();
  await expect(card).toContainText(plainWork.title);

  // 그 잠깐이 지나면 카드도 다시 멈춤을 기다린다. 잠깐은 카드가 화면에서 빠진 뒤에 재기 시작한다 — 닫는 타이머가 돈 그 `runFor`
  // 안에서는 React가 아직 그리지 않았으므로, 빠진 것을 본 뒤에 시계를 한 번 더 돌린다.
  await 비킨다(page);
  await page.clock.runFor(peekClose);
  await expect(card).toHaveCount(0);
  await page.clock.runFor(1000);
  await workRow(page, multiWork.slug).hover();
  await page.clock.runFor(tip - 1);
  await expect(card).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(card).toContainText(multiWork.title);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 무리를 여는 것은 **포인터가 세운 것**이다 — 키보드 포커스로 선 툴팁은 포인터가 어디 있든 서 있어(포커스가 떠나야 닫힌다), 그것이
// 무리를 열어 두면 포인터가 스치는 행마다 카드가 곧바로 선다. 그 툴팁은 무리 밖에 서고, 포인터가 무리를 세우면 비켜 닫힌다 — 공급자의
// 무리에서 새로 선 툴팁이 옛것을 닫는 것과 같은 꼴이다. 포커스는 포인터를 한 번도 누르지 않고 준다 — 누른 뒤의 `focus()`에는
// 툴팁이 안 선다(Base UI가 포인터로 온 포커스로 읽는다).
test("키보드 포커스로 선 툴팁은 무리를 열어 두지 않는다 — 스치는 행에 카드가 안 서고, 멈춰 선 카드 옆에 남지 않는다", async ({
  page,
}) => {
  const { tip } = await 연다(page);
  const card = 호버카드(page);
  const spots = await Promise.all([pinnedWork, plainWork, multiWork].map((work) => 가운데(workRow(page, work.slug))));

  await 사이드바토글(page).focus();
  await expect(툴팁글(page, "사이드바 접기")).toBeVisible();

  // 행을 차례로 스친다 — 행마다 지연보다 짧게 머문다.
  for (const spot of spots) {
    await page.mouse.move(spot.x, spot.y);
    await page.clock.runFor(tip - 50);
    await expect(card).toHaveCount(0);
  }
  // 마지막 행에 멈춘 지 지연이 차면 카드가 서고, 포커스의 툴팁은 비킨다.
  await page.clock.runFor(50);
  await expect(card).toContainText(multiWork.title);
  await page.clock.runFor(1000);
  await expect(card).toContainText(multiWork.title);
  await expect(툴팁(page)).toHaveCount(0);
  await expect(사이드바토글(page)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 카드는 떠난 지 duration-peek-close에 닫히고 카드 안에서는 남는다 (스토리 102) ──
// 행과 카드 사이에는 틈(4px)이 있다 — 그 틈을 건너는 동안 닫히지 않는 것도 이 길이 덕이다.

test("호버 카드는 행을 떠난 지 duration-peek-close에 닫히고, 카드 안으로 들어오면 남는다", async ({ page }) => {
  const { tip, peekClose } = await 연다(page);
  const card = 호버카드(page);
  const row = workRow(page, plainWork.slug);

  await row.hover();
  await page.clock.runFor(tip);
  await expect(card).toBeVisible();
  await 비킨다(page);
  await page.clock.runFor(peekClose - 1);
  await expect(card).toBeVisible();
  await page.clock.runFor(1);
  await expect(card).toHaveCount(0);

  // 잠깐이 지난 뒤 다시 세우고, 이번에는 카드 안으로.
  await page.clock.runFor(1000);
  await row.hover();
  await page.clock.runFor(tip);
  await expect(card).toBeVisible();
  await card.hover();
  await page.clock.runFor(1000);
  await expect(card).toContainText(plainWork.title);
  // 카드에서 행으로 돌아와도 남는다.
  await row.hover();
  await page.clock.runFor(1000);
  await expect(card).toContainText(plainWork.title);
  // 카드를 떠나도 같은 길이 뒤에 닫힌다.
  await card.hover();
  await 비킨다(page);
  await page.clock.runFor(peekClose - 1);
  await expect(card).toBeVisible();
  await page.clock.runFor(1);
  await expect(card).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 포인터로 누른 행(옮겨 가기 · 고정)은 포인터가 떠날 때까지 카드가 다시 서지 않는다 — 누른 손이 조금만 움직여도 카드가 되살아나지
// 않게. **키로 누른 것은 그렇지 않다** — 포인터가 그 행에 없으니 떠날 일도 없어, 잠재우면 나중에 처음 올린 포인터에 카드가 안 선다.
test("포인터로 누른 행은 떠날 때까지 카드가 안 서고, 키로 누른 행 · 핀은 카드를 잠재우지 않는다", async ({ page }) => {
  const { tip } = await 연다(page);
  const card = 호버카드(page);
  const row = workRow(page, plainWork.slug);

  // 포인터로 누른 행 — 그 위에서 움직여도 카드가 다시 서지 않는다.
  await row.hover();
  await page.clock.runFor(tip);
  await expect(card).toBeVisible();
  await 행버튼(page, plainWork.title).click();
  await expect(page).toHaveURL(Work줄이가는곳(plainWork.slug));
  await expect(card).toHaveCount(0);
  const spot = await 가운데(row);
  for (const dx of [4, 8]) {
    await page.mouse.move(spot.x + dx, spot.y);
    await page.clock.runFor(1000);
  }
  await expect(card).toHaveCount(0);

  // 키로 연 행 — 포인터는 비켜 있다. 그 행에 처음 올려 멈추면 카드가 선다.
  await 비킨다(page);
  await page.clock.runFor(1000);
  await 행버튼(page, multiWork.title).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(Work줄이가는곳(multiWork.slug));
  await workRow(page, multiWork.slug).hover();
  await page.clock.runFor(tip);
  await expect(card).toContainText(multiWork.title);

  // 키로 누른 핀 — 같다.
  await 비킨다(page);
  await page.clock.runFor(1000);
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: `${plainWork.title} 고정`, exact: true }).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => callCount(page, "set_work_pinned")).toBe(1);
  await row.hover();
  await page.clock.runFor(tip);
  await expect(card).toContainText(plainWork.title);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 메뉴가 열린 동안은 둘 다 없다 (스토리 103) ──
// 열린 메뉴는 바깥을 가림막으로 덮지만 **⋯ · 상태 배지처럼 누른 버튼이 연 메뉴는 그 버튼 자리를 비워 둔다**(Base UI의 가림막 구멍)
// — 그래서 그 버튼에 다시 올리면 툴팁이 메뉴 위에 설 수 있었다. 행은 가림막 밑이라 메뉴가 열린 뒤에 올린 포인터는 행에 닿지 않는다
// — 메뉴가 막을 카드는 **열기 전에 걸어 둔 것**이다: 포인터가 행에 멈춘 채 키로 메뉴를 열면 걸어 둔 지연이 메뉴 위에서 터질 수 있다.
// 우클릭 메뉴는 구멍 없이 다 덮지만 같은 까닭으로 키(⇧F10)로 연 것을 잰다. 앵커는 같은 시계에서 메뉴를 열기 전에 선 툴팁 · 카드다.

for (const { name, trigger, text } of [
  { name: "상태 메뉴", trigger: (page: Page) => page.getByRole("button", { name: pinnedWork.status, exact: true }), text: "상태 변경" },
  { name: "⋯ 메뉴", trigger: (page: Page) => page.getByRole("button", { name: "작업 메뉴", exact: true }), text: "작업 메뉴" },
]) {
  test(`${name}가 열린 동안은 그 버튼에 다시 올려도 툴팁이 없고, 행에 걸어 둔 카드도 서지 않는다`, async ({ page }) => {
    const { tip } = await 연다(page);
    const button = trigger(page);
    const spot = await 가운데(button);
    const row = await 가운데(workRow(page, plainWork.slug));

    // 앵커: 같은 시계에서 그 버튼은 툴팁을 세운다.
    await button.hover();
    await page.clock.runFor(tip);
    await expect(툴팁글(page, text)).toBeVisible();

    await button.click();
    // 누른 메뉴는 세운 시계에서 틱 하나를 건너 선다(Base UI가 열기를 미룬다) — 그만큼만 돌린다.
    await page.clock.runFor(50);
    await expect(page.getByRole("menu")).toBeVisible();
    await 비킨다(page);
    await page.clock.runFor(1000);
    await page.mouse.move(spot.x, spot.y);
    await page.clock.runFor(1000);
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(툴팁(page)).toHaveCount(0);
    await 메뉴를닫는다(page);

    // 걸어 둔 카드 — 행에 멈춘 지 지연이 차기 전에 키(Enter)로 메뉴를 연다. 앵커: 메뉴가 없으면 같은 자리에서 카드가 선다.
    await 비킨다(page);
    await page.clock.runFor(1000);
    await page.mouse.move(row.x, row.y);
    await page.clock.runFor(tip);
    await expect(호버카드(page)).toContainText(plainWork.title);
    await 비킨다(page);
    await page.clock.runFor(1000);
    await expect(호버카드(page)).toHaveCount(0);
    await page.clock.runFor(1000);

    await page.mouse.move(row.x, row.y);
    await button.focus();
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await expect(page.getByRole("menu")).toBeVisible();
    await page.clock.runFor(1000);
    await expect(호버카드(page)).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("우클릭 메뉴가 열리면 떠 있던 카드가 닫히고, 열린 동안은 카드가 다시 서지 않는다", async ({ page }) => {
  const { tip } = await 연다(page);
  const card = 호버카드(page);
  const row = workRow(page, plainWork.slug);

  await row.hover();
  await page.clock.runFor(tip);
  await expect(card).toBeVisible();

  await row.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("포인터가 버튼 · 행에 멈춘 채 키로 우클릭 메뉴를 열면, 떠 있던 툴팁이 닫히고 걸려 있던 카드 · 툴팁도 서지 않는다", async ({
  page,
}) => {
  const { tip } = await 연다(page);
  const target = 행버튼(page, plainWork.title);

  // 떠 있던 툴팁.
  await 검색(page).hover();
  await page.clock.runFor(tip);
  await expect(툴팁글(page, "검색")).toBeVisible();
  await target.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.clock.runFor(1000);
  await expect(툴팁(page)).toHaveCount(0);
  await 메뉴를닫는다(page);

  // 걸려 있던 툴팁 — 버튼에 멈춘 지 지연이 차기 전에 메뉴가 열린다.
  await 비킨다(page);
  await page.clock.runFor(1000);
  await 검색(page).hover();
  await target.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.clock.runFor(1000);
  await expect(툴팁(page)).toHaveCount(0);
  await 메뉴를닫는다(page);

  // 걸려 있던 카드 — 행에 멈춘 지 지연이 차기 전에 메뉴가 열린다.
  await 비킨다(page);
  await page.clock.runFor(1000);
  await workRow(page, plainWork.slug).hover();
  await target.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.clock.runFor(1000);
  await expect(호버카드(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
