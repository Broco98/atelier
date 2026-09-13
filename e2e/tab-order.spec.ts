import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, exitShell, installFixtureBackend, openShell, unknownIpcCalls, writeShell } from "./harness";
import { fillToCap, MAX_SHELLS, rowOf } from "./tab-row";

// 셸 탭을 끌어 순서를 바꾼다(UI개선 티켓 07 · UI개선 결정 11~13 · UI개선 스펙 §6·S10). **한 눌림을 두
// 소비자가 나눠 본다** — 탭 줄은 「몇 번째 틈」, 본문 받침은 「어느 절반」 — 그리고 놓은 곳이
// 이긴다. 틈 계산 자체(내용 좌표 · `spec` 뒤부터 · 제자리 틈)는 L2(`tab-gap.test.ts`)와
// 레지스트리의 `moveShell` 표가 들고, 여기서 보는 것은 **이벤트가 있어야 서는 것**이다: 끄는
// 동안 선이 서는가 · 받침으로 가면 꺼지는가 · 놓으면 화면과 키가 새 순서를 따르는가.
//
// 칸을 **이름으로** 가른다. 픽스처 셸은 모두 같은 이름이라, 칸마다 OSC 타이틀을 한 번 쏴
// 「어느 셸이 어디 섰나」를 화면 글자로 읽는다(`writeShell` — 진짜 xterm 파서를 지난다).

const [, plainWork] = WORKS;

type Box = { x: number; y: number; width: number; height: number };

const ESC = "\x1b";
const BEL = "\x07";

const shellTabs = (page: Page) => page.locator('[data-tab="shell"]');
/** 칸의 이름 버튼 — 끄는 자리이자 켜짐을 말하는 자리다. */
const nameButton = (page: Page, at: number) => shellTabs(page).nth(at).locator("button[aria-pressed]");
const gapLine = (page: Page) => page.locator("[data-tab-gap]");

/** 줄에 선 순서대로 칸 이름. 넓은 창에서만 글자가 보이므로 접근성 이름(글자 · 라벨)으로 읽는다. */
const namesOf = (page: Page) =>
  shellTabs(page)
    .locator("button[aria-pressed]")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent ?? ""));

/** 켜진 칸의 이름. 없으면 `null`. */
const litName = (page: Page) =>
  shellTabs(page)
    .locator('button[aria-pressed="true"]')
    .evaluateAll((buttons) => buttons.map((button) => button.textContent ?? "")[0] ?? null);

async function boxOf(page: Page, at: number): Promise<Box> {
  const box = await nameButton(page, at).boundingBox();
  if (!box) throw new Error(`${at}번째 칸의 상자를 못 읽었다`);
  return box;
}

/**
 * 셸을 `names.length`개 띄우고 칸마다 이름을 붙인다. 칸은 응답까지 기다려 하나씩 연다 —
 * 「n번째 칸 = pty n」이 그 기다림 위에 선다(`openShell`의 머리말).
 */
async function nameShells(page: Page, names: string[]): Promise<void> {
  await awaitSpawned(page, 1);
  for (let n = await shellTabs(page).count(); n < names.length; n += 1) await openShell(page);
  for (const [at, name] of names.entries()) await writeShell(page, `${ESC}]0;${name}${BEL}`, at + 1);
  await expect.poll(() => namesOf(page)).toEqual(names);
}

/**
 * 칸 `from`을 눌러 문턱을 넘긴다. 옆으로 12px은 **제 칸 안**이라 틈이 아직 없다 — 제자리
 * 틈에는 선이 안 선다. 문턱은 두 화면 공통인 body의 끄는 중 표시로 확인한다(`/terminal`에는
 * 받침이 없다).
 */
async function pressAndCross(page: Page, from: number) {
  const box = await boxOf(page, from);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 3, start.y);
  await page.mouse.move(start.x + 12, start.y);
  await expect(page.locator("body")).toHaveClass(/dragging-row/);
  await expect(gapLine(page)).toHaveCount(0);
  return start;
}

/**
 * 틈 `gap`을 가리키는 자리 — 칸 `gap`의 왼쪽 4분의 1(그 칸 앞), 마지막 틈이면 마지막 칸의
 * 오른쪽 4분의 1. 틈은 「중심이 포인터 왼쪽인 칸의 수」라 두 자리가 그 번호다.
 */
async function gapPoint(page: Page, gap: number) {
  const count = await shellTabs(page).count();
  const box = gap < count ? await boxOf(page, gap) : await boxOf(page, count - 1);
  const x = gap < count ? box.x + box.width / 4 : box.x + (box.width * 3) / 4;
  return { x, y: box.y + box.height / 2 };
}

async function moveToGap(page: Page, gap: number) {
  const at = await gapPoint(page, gap);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await expect(gapLine(page)).toHaveCount(1);
  await expect(gapLine(page)).toHaveAttribute("data-tab-gap", String(gap));
}

/**
 * 셸들을 이름 붙여 띄운 채 출발한다 — 마지막으로 연 칸이 켜져 있다. `onSpec`이면 본문을 문서로
 * 돌려 **셸 탭이 꺼진 채** 출발한다 — 끌어 놓은 칸이 켜지는지를 모습으로 보려면.
 */
async function openWork(page: Page, names: string[], { onSpec = false } = {}) {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await nameShells(page, names);
  if (onSpec) {
    await page.locator('[data-tab="spec"]').click();
    await expect(nameButton(page, 0)).toHaveAttribute("aria-pressed", "false");
  }
}

test.describe("work 화면", () => {
  test("탭을 옆 틈에 놓으면 순서가 바뀌고 ⌘2와 ⌃Tab이 새 순서를 따른다", async ({ page }) => {
    await openWork(page, ["하나", "둘", "셋"]);
    // 마지막으로 연 칸이 켜져 있다 — 옮긴 뒤에도 그대로여야 한다.
    expect(await litName(page)).toBe("셋");

    await pressAndCross(page, 0);
    await moveToGap(page, 2);
    await page.mouse.up();

    await expect.poll(() => namesOf(page)).toEqual(["둘", "하나", "셋"]);
    await expect(gapLine(page)).toHaveCount(0);
    // 끌어 놓은 칸은 안 켜진다 — 켜진 칸이 그대로다.
    expect(await litName(page)).toBe("셋");
    await expect(page).not.toHaveURL(/split=/);

    // ⌘2가 **보이는** 첫 셸이다(⌘1은 spec). 옛 순서면 「하나」다.
    await page.keyboard.press("Meta+2");
    await expect.poll(() => litName(page)).toBe("둘");
    // ⌃Tab이 보이는 순서의 다음 칸이다 — 새 순서(둘·하나·셋)면 「둘」 다음은 「하나」다. 옛
    // 순서(하나·둘·셋)였다면 「셋」이 켜진다.
    await page.keyboard.press("Control+Tab");
    await expect.poll(() => litName(page)).toBe("하나");

    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("끄는 동안 틈 선이 하나 서고, 받침 위로 가면 사라지며 거기 놓으면 분할만 켜진다", async ({ page }) => {
    await openWork(page, ["하나", "둘", "셋"]);

    await pressAndCross(page, 0);
    await expect(page.locator("[data-drop-half]")).toHaveCount(2);
    await moveToGap(page, 3);

    // 받침 위로 간다 — 틈이 꺼지고 절반이 켜진다. **둘이 동시에 안 켜진다.**
    const half = await page.locator('[data-drop-half="right"]').boundingBox();
    if (!half) throw new Error("오른쪽 절반의 상자를 못 읽었다");
    await page.mouse.move(half.x + half.width / 2, half.y + half.height / 2, { steps: 4 });
    await expect(page.locator('[data-drop-half="right"]')).toHaveAttribute("data-over", "");
    await expect(gapLine(page)).toHaveCount(0);

    await page.mouse.up();

    // 놓은 곳이 이긴다 — 분할이 켜지고 순서는 그대로다.
    await expect(page).toHaveURL(/split=lr/);
    await expect.poll(() => namesOf(page)).toEqual(["하나", "둘", "셋"]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("`spec` 앞에는 틈이 없고, `spec`을 끌어도 틈이 안 선다", async ({ page }) => {
    await openWork(page, ["하나", "둘", "셋"], { onSpec: true });

    const spec = await page.locator('[data-tab="spec"]').boundingBox();
    if (!spec) throw new Error("spec 칸의 상자를 못 읽었다");
    const onSpec = { x: spec.x + spec.width / 2, y: spec.y + spec.height / 2 };

    // 셋째 칸을 `spec` 위로 끈다 — 선이 없다.
    await pressAndCross(page, 2);
    await page.mouse.move(onSpec.x, onSpec.y, { steps: 4 });
    await expect(gapLine(page)).toHaveCount(0);
    // 첫 셸 칸 앞(틈 0)에는 선다 — 위 0이 「이 화면에선 늘 안 선다」로 통과하지 않는지.
    await moveToGap(page, 0);
    await page.mouse.move(onSpec.x, onSpec.y, { steps: 4 });
    await expect(gapLine(page)).toHaveCount(0);
    await page.mouse.up();

    await expect.poll(() => namesOf(page)).toEqual(["하나", "둘", "셋"]);
    // 끌어 놓은 칸이 안 켜진다 — 본문이 문서 그대로다.
    await expect(nameButton(page, 2)).toHaveAttribute("aria-pressed", "false");
    await expect(page).not.toHaveURL(/tab=terminal/);

    // `spec` 칸은 순서에 안 낀다 — 끌어 셸 칸 사이를 지나도 선이 안 서고, 거기 놓아도 그대로다.
    await page.mouse.move(onSpec.x, onSpec.y);
    await page.mouse.down();
    await page.mouse.move(onSpec.x + 12, onSpec.y);
    await expect(page.locator("[data-drop-half]")).toHaveCount(2);
    const between = await gapPoint(page, 2);
    await page.mouse.move(between.x, between.y, { steps: 4 });
    await expect(gapLine(page)).toHaveCount(0);
    await page.mouse.up();

    await expect.poll(() => namesOf(page)).toEqual(["하나", "둘", "셋"]);
    await expect(page).not.toHaveURL(/split=/);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // UI개선 스펙 §6 — 틈 선은 **절대 위치**라 폭을 안 먹는다. 900px 창에서는 칸 상자가 칸 하나 폭까지
  // 줄어 있어 폭을 먹는 표시는 줄을 넘친다. 폭마다 **끌기를 새로 시작해** 선이 선 뒤에 잰다 — 누른 채 창 크기를
  // 바꾸면 누른 순간 잰 기하가 낡아 재는 것이 달라진다.
  //
  // 셸이 여덟이라 줄이 가로로 스크롤된다(결정 20) — 그래도 틈이 맞는지를 **놓아서** 본다.
  // 스크롤은 **누른 뒤에** 한 칸만큼 더 민다: 누른 순간과 움직이는 순간의 `scrollLeft`가 달라야
  // 내용 좌표(`tab-gap.ts`)가 실제로 쓰인다 — 같으면 뷰포트 좌표로 재고 셈해도 초록이다.
  test("끄는 동안 줄이 안 넘치고, 스크롤된 줄에서도 틈이 맞는다", async ({ page }) => {
    const names = Array.from({ length: MAX_SHELLS }, (_, at) => `셸${at + 1}`);
    await openWork(page, names);
    await fillToCap(page);

    let order = [...names];
    for (const width of [1280, 1120, 900]) {
      const at = `${width}px`;
      await page.setViewportSize({ width, height: 800 });
      // **작업 패널은 열린 채다** — 창을 처음 연 기본 배치가 가장 좁은 줄이다. 900px에서도 끌
      // 칸과 틈이 화면에 있어야 한다(`terminal-tabs`의 「셸 칸이 보이고 눌린다」가 같은 배치를 든다).
      //
      // **폭이 멈출 때까지 기다린다.** 창 폭이 바뀐 뒤 줄 폭이 자리를 잡기 전에 누르면 누른 순간
      // 잰 기하가 다음 프레임에 낡는다 — 실물에서는 없는 경쟁이다. 두 번 잰 칸 상자 폭이 같아야
      // 넘어간다.
      let last = -1;
      await expect
        .poll(async () => {
          const now = (await rowOf(page)).strip.clientWidth;
          const settled = now === last;
          last = now;
          return settled;
        }, { intervals: [100] })
        .toBe(true);
      await expect.poll(async () => (await rowOf(page)).pageSpill, { timeout: 5000 }).toBeLessThanOrEqual(0);
      const before = await rowOf(page);

      // 끄는 칸(끝에서 둘째)이 보이게, 끝에서 **반 칸 모자라게** 줄을 민다 — 켜진 칸이 옮겨 가
      // 있어 줄이 스스로 거기 와 있지 않다. 이 폭들에서는 줄이 이미 넘쳐 스크롤이 0이 아니어야
      // 이 검사가 「스크롤된 줄에서도」를 잰다. 반 칸인 것은 넘침이 한 칸보다 작은 폭(1280)이
      // 있어서고, 4분의 1 칸을 넘으면 아래 포인터가 뷰포트 좌표로는 다른 틈으로 읽힌다.
      //
      // **다만 끄는 칸이 상자 안에 온전히 들어오는 데까지만 민다.** 900px에서는 상자가 칸
      // 하나 폭이라(`ShellTabs`의 상자 바닥) 반 칸만 덜 밀면 끄는 칸의 가운데가 상자 왼쪽 밖에
      // 있다 — 거기를 누르면 칸이 아니라 옆의 세로선을 누른다. 그 폭에서는 끄는 칸의 오른쪽
      // 끝을 상자의 오른쪽 끝에 맞추고, 누른 뒤 끝까지 미는 거리가 한 칸이 된다(4분의 1보다 크다).
      const strip = page.locator("[data-tab-strip]");
      const step = await shellTabs(page)
        .nth(MAX_SHELLS - 1)
        .evaluate((cell) => cell.getBoundingClientRect().width);
      const dragged = shellTabs(page).nth(MAX_SHELLS - 2);
      const draggedRight = await dragged.evaluate((cell: HTMLElement) => cell.offsetLeft + cell.offsetWidth);
      const pressedAt = await strip.evaluate(
        (el, [half, right]) => {
          const max = el.scrollWidth - el.clientWidth;
          el.scrollLeft = Math.max(1, Math.min(max - Math.min(half, max - 1), right - el.clientWidth));
          return el.scrollLeft;
        },
        [Math.ceil(step / 2), draggedRight] as const,
      );
      expect(pressedAt, at).toBeGreaterThan(0);
      // 끄는 칸이 상자 안에 **온전히** 보인다 — 사람이 누를 수 있는 칸이다.
      const seen = await dragged.evaluate((cell) => {
        const box = cell.closest("[data-tab-strip]")!.getBoundingClientRect();
        const own = cell.getBoundingClientRect();
        return own.left >= box.left - 0.5 && own.right <= box.right + 0.5;
      });
      expect(seen, at).toBe(true);

      await pressAndCross(page, MAX_SHELLS - 2);
      // 누른 채 끝까지 민다 — 누를 때 잰 기하가 뷰포트 좌표였다면 마지막 칸 위의 포인터가 한 칸
      // 앞(끄는 칸의 제자리 틈)으로 읽혀 선이 안 선다.
      const movedTo = await strip.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
        return el.scrollLeft;
      });
      expect(movedTo, at).toBeGreaterThan(pressedAt);
      await moveToGap(page, MAX_SHELLS);

      const row = await rowOf(page);
      expect(row.spill, at).toBeLessThanOrEqual(0);
      expect(row.height, at).toBe(44);
      // 선이 칸 상자를 넓히지도, 세로로 넘치게 하지도 않는다.
      expect(row.strip.scrollWidth, at).toBe(before.strip.scrollWidth);
      const vertical = await page
        .locator("[data-tab-strip]")
        .evaluate((strip) => strip.scrollHeight - strip.clientHeight);
      expect(vertical, at).toBeLessThanOrEqual(0);

      await page.mouse.up();
      order = [...order.slice(0, MAX_SHELLS - 2), order[MAX_SHELLS - 1], order[MAX_SHELLS - 2]];
      await expect.poll(() => namesOf(page), { message: at }).toEqual(order);
    }

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test("`/terminal`에서도 끌어 순서를 바꾸고 ⌘1이 새 순서를 따른다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/terminal");
  await nameShells(page, ["하나", "둘", "셋"]);
  expect(await litName(page)).toBe("셋");

  // 이 화면에는 받침이 없다 — 문턱은 body 표시로 확인한다(`pressAndCross`).
  await pressAndCross(page, 2);
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await moveToGap(page, 0);
  await page.mouse.up();

  await expect.poll(() => namesOf(page)).toEqual(["셋", "하나", "둘"]);
  expect(await litName(page)).toBe("셋");

  // ⌘1이 **보이는** 첫 칸이다 — 옛 순서면 「하나」다. 켜진 칸이 이미 「셋」이라 먼저 옮긴다.
  await page.keyboard.press("Meta+2");
  await expect.poll(() => litName(page)).toBe("하나");
  await page.keyboard.press("Meta+1");
  await expect.poll(() => litName(page)).toBe("셋");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **끄는 도중 줄의 셸 목록이 바뀐다**(UI개선 결정 11 · 결정 48). 누를 때 잰 기하는 그 순간의 칸
// 목록에 매여 있어서, 칸 하나가 스스로 빠지면 틈 번호가 옛 줄로 셈된다 — 선이 서는 자리와 놓았을 때
// 옮기는 자리가 어긋난다. 네 칸에서 셋째를 들고 첫 칸이 끝나면 새 줄은 셋이고 끄는 칸은 둘째다:
// 마지막 칸 오른쪽은 새 줄의 틈 3(끝)인데, 옛 기하로는 끄는 칸(옛 셋째)의 제자리 틈이라 선이 안 선다.
test("끄는 도중 셸 하나가 끝나 줄이 바뀌어도 틈이 새 줄로 서고 거기 놓인다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/terminal");
  await nameShells(page, ["하나", "둘", "셋", "넷"]);

  await pressAndCross(page, 2);
  await exitShell(page, 1);
  await expect.poll(() => namesOf(page)).toEqual(["둘", "셋", "넷"]);

  await moveToGap(page, 3);
  await page.mouse.up();

  await expect.poll(() => namesOf(page)).toEqual(["둘", "넷", "셋"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
