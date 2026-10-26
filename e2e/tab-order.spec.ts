import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  callCount,
  exitShell,
  installFixtureBackend,
  openShell,
  unknownIpcCalls,
  writeShell,
  셸입력,
  파일탭주소,
  작업화면으로,
  주소로간다,
} from "./harness";
import { fillToCap, MAX_SHELLS, rowOf, settle as settleLayout, squeezedWidth, widenSidebar } from "./tab-row";

// 셸 탭을 끌어 순서를 바꾼다(UI개선 티켓 07 · UI개선 결정 11~13 · UI개선 스펙 §6·S10). **한 눌림을 두
// 소비자가 나눠 본다** — 탭 줄은 「몇 번째 틈」, 본문 받침은 「어느 절반」 — 그리고 놓은 곳이
// 이긴다. 틈 계산 자체(내용 좌표 · `spec` 뒤부터 · 제자리 틈)는 L2(`tab-gap.test.ts`)와
// 레지스트리의 `moveShell` 표가 들고, 여기서 보는 것은 **이벤트가 있어야 서는 것**이다: 끄는
// 동안 선이 서는가 · 받침으로 가면 꺼지는가 · 놓으면 화면과 키가 새 순서를 따르는가.
//
// 칸을 **이름으로** 가른다. 픽스처 셸은 모두 같은 이름이라, 칸마다 OSC 타이틀을 한 번 쏴
// 「어느 셸이 어디 섰나」를 화면 글자로 읽는다(`writeShell` — 진짜 xterm 파서를 지난다).
//
// 줄의 칸은 **묶음의 칸**이다 — 셸 칸과 파일 탭이 한 차례로 선다(git-integration 결정 31). 칸 · 이름 · 틈을 재는 손잡이가
// 그래서 종류를 안 가린다. 셸만 선 화면에서는 셸 칸을 재는 것과 같다.

const [fileWork, plainWork] = WORKS;

type Box = { x: number; y: number; width: number; height: number };

const ESC = "\x1b";
const BEL = "\x07";

const shellTabs = (page: Page) => page.locator('[data-tab="shell"]');
/** 묶음의 칸들 — 탭 줄 스크롤 상자 안, 왼쪽부터. 셸이든 파일 탭이든 센다. */
const bundleTabs = (page: Page) => page.locator("[data-tab-strip] > [data-tab]");
/** 칸의 이름 버튼 — 끄는 자리이자 켜짐을 말하는 자리다. */
const nameButton = (page: Page, at: number) => bundleTabs(page).nth(at).locator("button[aria-pressed]");
const gapLine = (page: Page) => page.locator("[data-tab-gap]");

/**
 * 줄에 선 순서대로 칸 이름. 넓은 창에서만 글자가 보이므로 접근성 이름(글자 · 라벨)으로 읽는다. 파일 탭은 파일 이름이다
 * (경로는 툴팁 — 설명으로 남는다).
 */
const namesOf = (page: Page) =>
  bundleTabs(page)
    .locator("button[aria-pressed]")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent ?? ""));

/** 켜진 칸의 이름. 없으면 `null`. */
const litName = (page: Page) =>
  bundleTabs(page)
    .locator('button[aria-pressed="true"]')
    .evaluateAll((buttons) => buttons.map((button) => button.textContent ?? "")[0] ?? null);

async function boxOf(page: Page, at: number): Promise<Box> {
  const box = await nameButton(page, at).boundingBox();
  if (!box) throw new Error(`${at}번째 칸의 상자를 못 읽었다`);
  return box;
}

/**
 * 셸을 `names.length`개 띄우고 칸마다 이름을 붙인다. 「n번째 칸 = pty n」은 앱이 칸을 연 순서대로
 * 띄워서다(`terminal-store`의 `loadFont` · `shell-cold-start.spec.ts`가 여덟 칸으로 잰다) — 기다림이
 * 만드는 것이 아니다(`openShell`의 머리말).
 */
async function nameShells(page: Page, names: string[]): Promise<void> {
  // 들어오면 뜨는 첫 칸(`ensureShell`)이 선 뒤에 센다 — 그 전에 세면 0에서 시작해 한 칸을 더 연다.
  await expect(shellTabs(page).first()).toBeVisible();
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
  const count = await bundleTabs(page).count();
  const box = gap < count ? await boxOf(page, gap) : await boxOf(page, count - 1);
  const x = gap < count ? box.x + box.width / 4 : box.x + (box.width * 3) / 4;
  return { x, y: box.y + box.height / 2 };
}

/**
 * 두 프레임을 넘긴다 — 「아무 일도 안 났다」를 재기 전에 부른다. 없음을 재는 단언은 곧바로 초록이라,
 * 떼기가 부른 상태 변경이 React 커밋·라우터 이동으로 화면에 닿기 전에 통과해 버린다.
 */
async function settle(page: Page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
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

  // UI개선 스펙 §6 — 틈 선은 **절대 위치**라 폭을 안 먹는다. 가장 좁은 폭에서는 칸 상자가 칸 하나 폭까지
  // 줄어 있어 폭을 먹는 표시는 줄을 넘친다. 폭마다 **끌기를 새로 시작해** 선이 선 뒤에 잰다 — 누른 채 창 크기를
  // 바꾸면 누른 순간 잰 기하가 낡아 재는 것이 달라진다.
  //
  // **사이드바를 넓혀 둔다**(400). 줄을 좁히는 것은 창 · 사이드바 · 줄 옆의 작업 패널이다(탭 줄은 본문 카드의 머리 —
  // codex-ds 스펙 §4). 세 폭은 셋의 넘침을 고른 것이다 — 1060은 넘침이 한 칸보다 작고, 900(앱 창의 최소 폭)은 여러 칸이 넘치고,
  // 마지막은 상자가 칸 하나 폭이다(`squeezedWidth` — 탭 줄의 바닥을 재서 낸 창 폭, `tab-row.ts` 머리말. 앱 창은 거기까지 안
  // 좁아지지만 그 상자의 장치는 그대로다).
  //
  // 셸이 여덟이라 줄이 가로로 스크롤된다(결정 20) — 그래도 틈이 맞는지를 **놓아서** 본다.
  // 스크롤은 **누른 뒤에** 한 칸만큼 더 민다: 누른 순간과 움직이는 순간의 `scrollLeft`가 달라야
  // 내용 좌표(`tab-gap.ts`)가 실제로 쓰인다 — 같으면 뷰포트 좌표로 재고 셈해도 초록이다.
  test("끄는 동안 줄이 안 넘치고, 스크롤된 줄에서도 틈이 맞는다", async ({ page }) => {
    const names = Array.from({ length: MAX_SHELLS }, (_, at) => `셸${at + 1}`);
    await widenSidebar(page);
    await openWork(page, names);
    await fillToCap(page);

    let order = [...names];
    for (const width of [1060, 900, await squeezedWidth(page)]) {
      const at = `${width}px`;
      await page.setViewportSize({ width, height: 800 });
      // 가장 좁은 폭에서도 끌 칸과 틈이 화면에 있어야 한다(`terminal-tabs`의 「셸 칸이 보이고 눌린다」가 같은 바닥을 든다).
      //
      // **배치가 멈출 때까지 기다린다**(`settleLayout`). 창 폭이 바뀐 뒤 줄 폭이 자리를 잡기 전에 누르면
      // 누른 순간 잰 기하가 다음 프레임에 낡는다 — 실물에서는 없는 경쟁이다.
      await settleLayout(page, () => rowOf(page));
      await expect.poll(async () => (await rowOf(page)).pageSpill, { timeout: 5000 }).toBeLessThanOrEqual(0);
      const before = await rowOf(page);

      // 끄는 칸(끝에서 둘째)이 보이게, 끝에서 **반 칸 모자라게** 줄을 민다 — 켜진 칸이 옮겨 가
      // 있어 줄이 스스로 거기 와 있지 않다. 이 폭들에서는 줄이 이미 넘쳐 스크롤이 0이 아니어야
      // 이 검사가 「스크롤된 줄에서도」를 잰다. 반 칸인 것은 넘침이 한 칸보다 작은 폭(1060)이
      // 있어서고, 4분의 1 칸을 넘으면 아래 포인터가 뷰포트 좌표로는 다른 틈으로 읽힌다.
      //
      // **다만 끄는 칸이 상자 안에 온전히 들어오는 데까지만 민다.** 가장 좁은 폭에서는 상자가 칸
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

      const start = await pressAndCross(page, MAX_SHELLS - 2);
      // 누른 채 **줄 오른쪽 끝에 붙여** 끝까지 굴린다 — 스크립트로 `scrollLeft`를 안 민다. 사람은 끄는
      // 동안 휠을 굴릴 손이 없다(가장자리 자동 스크롤, `tab-gap`의 `stripEdgeStep`). 누를 때 잰 기하가
      // 뷰포트 좌표였다면 마지막 칸 위의 포인터가 한 칸 앞(끄는 칸의 제자리 틈)으로 읽혀 선이 안 선다.
      const view = (await strip.boundingBox())!;
      await page.mouse.move(view.x + view.width - 2, start.y, { steps: 4 });
      await expect
        .poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft), { message: at })
        .toBeLessThanOrEqual(1);
      const movedTo = await strip.evaluate((el) => el.scrollLeft);
      expect(movedTo, at).toBeGreaterThan(pressedAt);
      await moveToGap(page, MAX_SHELLS);

      const row = await rowOf(page);
      expect(row.spill, at).toBeLessThanOrEqual(0);
      expect(row.height, at).toBe(46);
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

// **칸 하나 폭 상자**(`ShellTabs`의 상자 바닥)에서는 보이는 칸이 끄는 그 칸뿐이고 그 양옆 틈은 제자리라, 줄이
// 따라 구르지 않으면 두 칸짜리 줄조차 못 바꾼다 — 한때 L3는 누른 채 `scrollLeft`를 스크립트로 밀어 이것을 가렸다.
// 여기서는 **포인터만** 쓴다. 그 상자는 한때 900px 창에 작업 패널이 열린 기본 배치였고, 지금은 넓힌 사이드바가 탭
// 줄의 바닥(줄 + 열린 패널의 최소 폭)에 눌리는, 앱 창의 최소 폭 아래에서 선다(`squeezedWidth`, `tab-row.ts` 머리말).
test("칸 하나 폭 상자에서 두 칸을 끌어 바꾼다 — 줄 가장자리에 붙이면 줄이 따라 구른다", async ({ page }) => {
  await widenSidebar(page);
  await openWork(page, ["하나", "둘"]);
  await page.setViewportSize({ width: await squeezedWidth(page), height: 800 });
  await settleLayout(page, () => rowOf(page));

  const strip = page.locator("[data-tab-strip]");
  const view = (await strip.boundingBox())!;
  const cell = await shellTabs(page).first().evaluate((one) => one.getBoundingClientRect().width);
  // 이 검사의 전제 — 상자에 칸이 하나만 들어간다. 넓게 서면 스크롤 없이도 옆 칸 위에 놓인다.
  expect(view.width, JSON.stringify({ view, cell })).toBeLessThan(cell * 2);

  // 상자 가운데는 보이는 칸의 이름 버튼이다 — 어느 칸이 보이는지는 창을 줄이기 전의 스크롤에 달려서, 보이는
  // 칸에 따라 반대쪽 끝으로 끈다. 어느 쪽이든 두 칸이 자리를 바꾼다.
  const press = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const under = await page.evaluate(
    ({ x, y }) => {
      const button = document.elementFromPoint(x, y)?.closest("button[aria-pressed]");
      return button ? (button.getAttribute("aria-label") ?? button.textContent ?? "") : null;
    },
    press,
  );
  expect(["하나", "둘"]).toContain(under);
  const toRight = under === "하나";
  const way = toRight ? 1 : -1;

  // **문턱 전의 눌림은 안 구른다** — 가장자리 띠 안에서 2px만 스친 채 머물다 떼면 줄이 제자리다. 누른
  // 순간부터 구르면 칸 하나 폭 상자의 칸을 누르기만 해도 줄이 옆 칸으로 넘어간다. (가만한 누름을 재는
  // 검사라 시간을 두고 본다 — 구른다면 프레임당 수 px이라 0.3초면 칸 하나를 넘는다.)
  const edge = { x: toRight ? view.x + view.width - 6 : view.x + 6, y: press.y };
  const scrollBefore = await strip.evaluate((el) => el.scrollLeft);
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x + 2 * way, edge.y);
  await page.waitForTimeout(300);
  expect(await strip.evaluate((el) => el.scrollLeft)).toBe(scrollBefore);
  await page.mouse.up();
  await expect(page.locator("body")).not.toHaveClass(/dragging-row/);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(press.x + 3 * way, press.y);
  await page.mouse.move(press.x + 8 * way, press.y);
  await expect(page.locator("body")).toHaveClass(/dragging-row/);
  // 끝에 붙이고 **가만히 있는다** — 더 움직이지 않아도 줄이 굴러 옆 칸 너머의 틈이 선다.
  await page.mouse.move(toRight ? view.x + view.width - 2 : view.x + 2, press.y, { steps: 2 });
  await expect(gapLine(page)).toHaveAttribute("data-tab-gap", toRight ? "2" : "0");
  await page.mouse.up();

  await expect.poll(() => namesOf(page)).toEqual(["둘", "하나"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 같은 배치에서 **본문 절반으로 가려고 곧장 아래로 끄는 손**은 줄을 안 굴린다. 칸 하나 폭 상자는 한가운데
// 한 픽셀 말고는 전부 가장자리 띠라, 문턱을 넘은 뒤 탭 줄을 벗어나기 전 몇 프레임 동안 줄이 구르면 누른
// 칸이 옆으로 밀리고, 이미 켜진 칸을 놓으면 되돌리는 스크롤도 안 선다.
test("칸 하나 폭 상자에서 칸을 곧장 아래로 끌면 줄이 안 구른다", async ({ page }) => {
  await widenSidebar(page);
  await openWork(page, ["하나", "둘", "셋"]);
  await page.setViewportSize({ width: await squeezedWidth(page), height: 800 });
  await settleLayout(page, () => rowOf(page));

  const strip = page.locator("[data-tab-strip]");
  const view = (await strip.boundingBox())!;
  const scrollBefore = await strip.evaluate((el) => el.scrollLeft);
  const max = await strip.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(max, JSON.stringify(view)).toBeGreaterThan(0);
  // 굴러갈 쪽이 남은 가장자리를 누른다 — 맨 왼쪽까지 굴러 있으면 오른쪽 띠, 아니면 왼쪽 띠. 가운데에서
  // 8px 비켜서 누르므로 가장자리 규칙만으로는 프레임마다 수 px씩 구른다.
  const way = scrollBefore < max ? 1 : -1;
  const press = { x: view.x + view.width / 2 + 8 * way, y: view.y + view.height / 2 };
  const onName = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button[aria-pressed]") !== null,
    press,
  );
  expect(onName, JSON.stringify(press)).toBe(true);

  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(press.x, press.y + 6);
  await page.mouse.move(press.x, press.y + 12);
  await expect(page.locator("body")).toHaveClass(/dragging-row/);
  // 아직 46px 탭 줄 안이다(칸 가운데에서 23px까지). 구른다면 프레임당 수 px이라 0.3초면 칸 하나를 넘는다.
  await page.waitForTimeout(300);
  expect(await strip.evaluate((el) => el.scrollLeft)).toBe(scrollBefore);
  await page.mouse.up();
  expect(await unknownIpcCalls(page)).toEqual([]);
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

// **끄는 셸 자신이 끝난다**(결정 48 · UI개선 스펙 S8). 위 검사는 「남의 칸이 빠졌다」라 끌기가 살 이유가 있지만,
// 끄는 것이 사라지면 놓을 것이 없다 — 사이드바 행 끌기가 목록이 바뀌면 끌기를 거두듯(UI개선 스펙 S8)
// 거둬야 한다. 안 거두면 원천에 닫힌 셸의 id가 실린 채 받침이 서 있어, 본문 절반에 놓는 순간 **없는
// 셸로** 분할이 켜진다. 그래서 둘을 본다: 끝난 순간 끄는 중 모습(받침 · 끄는 커서)이 걷히는가, 그리고
// 그 뒤 손을 떼도 화면(분할 · 순서 · 켜진 칸)과 셸이 그대로인가.
test.describe("끄는 셸이 끝나면 끌기가 거둬진다", () => {
  test("work 화면 — 본문 절반에 놓아도 분할이 안 켜진다", async ({ page }) => {
    await openWork(page, ["하나", "둘"]);
    expect(await litName(page)).toBe("둘");
    const spawned = await callCount(page, "pty_spawn");
    const written = await callCount(page, "pty_write");

    await pressAndCross(page, 0);
    await expect(page.locator("[data-drop-half]")).toHaveCount(2);
    const half = await page.locator('[data-drop-half="right"]').boundingBox();
    if (!half) throw new Error("오른쪽 절반의 상자를 못 읽었다");

    await exitShell(page, 1);
    await expect.poll(() => namesOf(page)).toEqual(["둘"]);

    // 끝난 순간 끄는 중 모습이 걷힌다 — 받침도, 끄는 커서도.
    await expect(page.locator("[data-drop-half]")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveClass(/dragging-row/);

    // 받침이 서 있던 오른쪽 절반으로 가서 뗀다 — 아무 일도 안 난다.
    await page.mouse.move(half.x + half.width / 2, half.y + half.height / 2, { steps: 4 });
    await page.mouse.up();
    await settle(page);

    await expect(page.locator("[data-column]")).toHaveCount(0);
    await expect(page).not.toHaveURL(/split=/);
    await expect.poll(() => namesOf(page)).toEqual(["둘"]);
    expect(await litName(page)).toBe("둘");
    expect(await callCount(page, "pty_spawn")).toBe(spawned);
    expect(await callCount(page, "pty_write")).toBe(written);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("`/terminal` — 끄는 모습이 걷히고 줄에 놓아도 순서가 그대로다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/terminal");
    await nameShells(page, ["하나", "둘", "셋"]);
    const written = await callCount(page, "pty_write");

    await pressAndCross(page, 0);
    await exitShell(page, 1);
    await expect.poll(() => namesOf(page)).toEqual(["둘", "셋"]);

    // 끝난 순간 끄는 커서가 걷힌다 — 이 화면에는 받침이 없어 끄는 중 모습이 이것뿐이다.
    await expect(page.locator("body")).not.toHaveClass(/dragging-row/);

    // 새 줄의 끝 틈으로 가서 — 선도 안 선다 — **안 켜진 칸 위에서** 뗀다. 여기서 재는 것은 떼도 순서와
    // 켜진 칸이 그대로라는 것뿐이다. 거둔 끌기의 떼기가 클릭으로 새는 사고(클릭 삼키기)는 이 자리에서
    // 안 보인다 — 누른 이름 버튼은 셸이 끝나며 내려가, 뗀 곳이 다른 칸이어도 클릭이 서지 않는다.
    const at = await gapPoint(page, 2);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await settle(page);
    await expect(gapLine(page)).toHaveCount(0);
    const other = await boxOf(page, 0);
    await page.mouse.move(other.x + other.width / 2, other.y + other.height / 2, { steps: 4 });
    await page.mouse.up();
    await settle(page);

    await expect.poll(() => namesOf(page)).toEqual(["둘", "셋"]);
    expect(await litName(page)).toBe("셋");
    expect(await callCount(page, "pty_write")).toBe(written);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // **문턱 전에 끝난다.** 누른 채 아직 5px을 안 움직였을 때 셸이 끝나면, 남은 눌림이 다음 이동에서
  // 죽은 id로 끌기를 시작한다 — 위 둘은 문턱을 넘긴 뒤에 끝내서 이 길을 못 본다.
  test("work 화면 — 문턱 전에 끝나고 그 뒤 끌어 절반에 놓아도 아무 일도 안 난다", async ({ page }) => {
    await openWork(page, ["하나", "둘"]);
    const spawned = await callCount(page, "pty_spawn");

    const box = await boxOf(page, 0);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await exitShell(page, 1);
    await expect.poll(() => namesOf(page)).toEqual(["둘"]);

    // 본문 오른쪽 절반으로 끈다 — 받침이 섰다면 거기 서 있을 자리다.
    await page.mouse.move(1000, 500, { steps: 8 });
    await settle(page);
    await expect(page.locator("body")).not.toHaveClass(/dragging-row/);
    await expect(page.locator("[data-drop-half]")).toHaveCount(0);
    await page.mouse.up();
    await settle(page);

    await expect(page.locator("[data-column]")).toHaveCount(0);
    await expect(page).not.toHaveURL(/split=/);
    expect(await litName(page)).toBe("둘");
    expect(await callCount(page, "pty_spawn")).toBe(spawned);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("`/terminal` — 문턱 전에 끝나고 그 뒤 틈에 놓아도 순서가 그대로다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/terminal");
    await nameShells(page, ["하나", "둘", "셋"]);

    const box = await boxOf(page, 0);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await exitShell(page, 1);
    await expect.poll(() => namesOf(page)).toEqual(["둘", "셋"]);

    const at = await gapPoint(page, 2);
    await page.mouse.move(at.x, at.y, { steps: 8 });
    await settle(page);
    await expect(page.locator("body")).not.toHaveClass(/dragging-row/);
    await expect(gapLine(page)).toHaveCount(0);
    await page.mouse.up();
    await settle(page);

    await expect.poll(() => namesOf(page)).toEqual(["둘", "셋"]);
    expect(await litName(page)).toBe("셋");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // **그 work의 마지막 셸이다.** 셸이 다 빠지면 화면이 분할째로 문서로 걷는데(`shellsEmptied`), 받침이
  // 남아 있으면 떼는 순간 분할과 터미널 열이 다시 서고 빈 열이 셸을 새로 띄운다.
  test("work 화면 — 마지막 셸이어도 분할도 새 셸도 안 선다", async ({ page }) => {
    await openWork(page, ["하나"]);
    const spawned = await callCount(page, "pty_spawn");

    await pressAndCross(page, 0);
    await expect(page.locator("[data-drop-half]")).toHaveCount(2);
    const half = await page.locator('[data-drop-half="right"]').boundingBox();
    if (!half) throw new Error("오른쪽 절반의 상자를 못 읽었다");

    await exitShell(page, 1);
    await expect(shellTabs(page)).toHaveCount(0);
    await expect(page.locator("[data-drop-half]")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveClass(/dragging-row/);

    await page.mouse.move(half.x + half.width / 2, half.y + half.height / 2, { steps: 4 });
    await page.mouse.up();
    await settle(page);

    await expect(page.locator("[data-column]")).toHaveCount(0);
    await expect(page).not.toHaveURL(/split=/);
    await expect(page).not.toHaveURL(/tab=terminal/);
    await expect(shellTabs(page)).toHaveCount(0);
    expect(await callCount(page, "pty_spawn")).toBe(spawned);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // **켜진 셸이다.** 빠지면 옆 칸이 켜지는데(`removeShell`), 떼는 순간 분할이 켜지면 끈 적 없는 그 칸이
  // 터미널 열에 선다.
  test("work 화면 — 켜진 셸이 끝나도 옆 칸으로 분할이 안 켜진다", async ({ page }) => {
    await openWork(page, ["하나", "둘"]);
    expect(await litName(page)).toBe("둘");

    await pressAndCross(page, 1);
    const half = await page.locator('[data-drop-half="right"]').boundingBox();
    if (!half) throw new Error("오른쪽 절반의 상자를 못 읽었다");

    await exitShell(page, 2);
    await expect.poll(() => namesOf(page)).toEqual(["하나"]);
    await expect(page.locator("[data-drop-half]")).toHaveCount(0);

    await page.mouse.move(half.x + half.width / 2, half.y + half.height / 2, { steps: 4 });
    await page.mouse.up();
    await settle(page);

    await expect(page.locator("[data-column]")).toHaveCount(0);
    await expect(page).not.toHaveURL(/split=/);
    await expect.poll(() => litName(page)).toBe("하나");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // **끝나는 길이 종료 프레임만이 아니다** — ⌘W(확인을 거친 닫기)도 같은 목록에서 뺀다. 거두는 자리가
  // 종료 프레임 쪽에만 걸려 있으면 이 길이 샌다.
  test("work 화면 — 끄는 도중 ⌘W로 닫아도 거둬진다", async ({ page }) => {
    await openWork(page, ["하나", "둘"]);

    await pressAndCross(page, 1);
    const half = await page.locator('[data-drop-half="right"]').boundingBox();
    if (!half) throw new Error("오른쪽 절반의 상자를 못 읽었다");

    await page.keyboard.press("Meta+w");
    const ask = page.getByRole("alertdialog");
    await expect(ask).toBeVisible();
    // 손은 눌린 채라 마우스로 못 누른다 — 키로 확인한다.
    await ask.getByRole("button", { name: "닫기" }).press("Enter");
    await expect.poll(() => namesOf(page)).toEqual(["하나"]);
    await expect(page.locator("[data-drop-half]")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveClass(/dragging-row/);

    await page.mouse.move(half.x + half.width / 2, half.y + half.height / 2, { steps: 4 });
    await page.mouse.up();
    await settle(page);

    await expect(page).not.toHaveURL(/split=/);
    await expect(page.locator("[data-column]")).toHaveCount(0);
    expect(await litName(page)).toBe("하나");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

// **거두는 것은 끄는 셸이 목록에서 사라졌을 때뿐이다.** 판정을 「종료 프레임이 왔다」로 잡거나 셸 끌기
// 아닌 것까지 보면 멀쩡한 끌기가 끊긴다 — 아래 둘은 그 넘치는 쪽을 막는다.
test.describe("끌기가 사는 경우", () => {
  // 0 아닌 코드로 끝난 칸은 줄에 남는다(결정 48 · `markExited`) — 그 셸은 아직 있다.
  test("끄는 셸이 0 아닌 코드로 끝나 줄에 남으면 끌기가 살고 분할이 켜진다", async ({ page }) => {
    await openWork(page, ["하나", "둘"]);

    await pressAndCross(page, 0);
    await exitShell(page, 1, 1);
    // 종료가 실제로 닿았음을 먼저 본다 — 아래 단언들은 종료 전에도 참이라, 이것 없이는 종료 프레임이
    // 안 와도 초록이다. 끝난 칸은 줄에 남아 코드 꼬리표(`shellEndLabels`의 `mark`)를 단다.
    await expect(nameButton(page, 0).locator("span.text-fg-tertiary")).toHaveText("1");
    await settle(page);
    await expect.poll(() => namesOf(page)).toHaveLength(2);
    await expect(page.locator("body")).toHaveClass(/dragging-row/);
    await expect(page.locator("[data-drop-half]")).toHaveCount(2);

    const half = await page.locator('[data-drop-half="right"]').boundingBox();
    if (!half) throw new Error("오른쪽 절반의 상자를 못 읽었다");
    await page.mouse.move(half.x + half.width / 2, half.y + half.height / 2, { steps: 4 });
    await page.mouse.up();

    await expect(page).toHaveURL(/split=lr/);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 문서 칸의 원천에는 셸이 없다 — 셸이 하나 끝났다고 문서 끌기가 끊기면 안 된다.
  test("문서 칸을 끄는 도중 셸이 끝나도 끌기가 살고 분할이 켜진다", async ({ page }) => {
    await openWork(page, ["하나", "둘"], { onSpec: true });

    const spec = await page.locator('[data-tab="spec"]').boundingBox();
    if (!spec) throw new Error("spec 칸의 상자를 못 읽었다");
    await page.mouse.move(spec.x + spec.width / 2, spec.y + spec.height / 2);
    await page.mouse.down();
    await page.mouse.move(spec.x + spec.width / 2 + 12, spec.y + spec.height / 2);
    await expect(page.locator("[data-drop-half]")).toHaveCount(2);

    await exitShell(page, 1);
    await expect.poll(() => namesOf(page)).toEqual(["둘"]);
    await settle(page);
    await expect(page.locator("[data-drop-half]")).toHaveCount(2);

    const half = await page.locator('[data-drop-half="right"]').boundingBox();
    if (!half) throw new Error("오른쪽 절반의 상자를 못 읽었다");
    await page.mouse.move(half.x + half.width / 2, half.y + half.height / 2, { steps: 4 });
    await page.mouse.up();

    // 문서를 오른쪽에 떨구면 문서가 오른쪽 열이다(`dropSplit`).
    await expect(page).toHaveURL(/split=rl/);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

// ── git-integration 판 01 티켓 06(#479): 셸과 파일 탭을 섞어 끈다 ──
//
// 「크롬도 모든 탭은 공평하잖아」(결정 31) — 셸 칸과 파일 탭은 한 묶음이라 **종류를 안 가리고** 끌린다(스토리 42 · 43). 틈 · 선 ·
// 놓기는 위의 셸 끌기와 같은 길이고, 여기서 보는 것은 종류가 섞여도 그 길이 그대로라는 것이다 — 파일 탭이 두 셸 사이로, 셸이
// 두 파일 탭 사이로 놓이고, 놓은 차례를 ⌘숫자가 따르며, 그 차례가 메모리에 살아 work을 옮겼다 와도 남는다(결정 33).
//
// 파일 탭은 주소로 연다(`주소로간다`) — 그 파일이 묶음에 없으면 끝에 선다(S12).
test.describe("셸과 파일 탭이 섞인 묶음", () => {
  /** `billing` 워크트리의 파일 — 탭 이름은 파일 이름이다. 픽스처에 없는 경로(`gone.ts`)도 탭은 선다(「지워진 파일」). */
  const MAIN = "billing/src/main.ts";
  const README = "billing/README.md";
  const GONE = "billing/gone.ts";

  /** 셸 칸 둘(pty 1 · 2)에 이름을 붙인다 — 이름이 서야 차례를 글자로 읽는다. */
  async function nameTwoShells(page: Page) {
    await writeShell(page, `${ESC}]0;하나${BEL}`, 1);
    await writeShell(page, `${ESC}]0;둘${BEL}`, 2);
  }

  test("파일 탭을 두 셸 사이로, 셸을 두 파일 탭 사이로 옮기면 차례가 바뀌고 work을 옮겼다 와도 남는다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    // 파일 탭으로 들어온다 — 터미널 본문이 안 서서 셸이 저절로 안 뜬다. 셸은 `+`로 연다: 사람이 연 셸이라 work을 떠나도
    // 안 닫힌다(프로세스 결정 7 — 저절로 뜬 셸은 입력 없이 떠나면 닫힌다).
    await page.goto(파일탭주소(MAIN));
    await expect(bundleTabs(page)).toHaveCount(1);
    await openShell(page);
    await openShell(page);
    await nameTwoShells(page);
    for (const ref of [README, GONE]) {
      await 주소로간다(page, 파일탭주소(ref));
      await expect(page.locator(`[data-tab="code"][data-code="${ref}"]`)).toHaveCount(1);
    }
    await expect.poll(() => namesOf(page)).toEqual(["main.ts", "하나", "둘", "README.md", "gone.ts"]);
    expect(await litName(page)).toBe("gone.ts");

    // 파일 탭(첫 칸)을 두 셸 사이 틈(2)으로.
    await pressAndCross(page, 0);
    await moveToGap(page, 2);
    await page.mouse.up();
    await expect.poll(() => namesOf(page)).toEqual(["하나", "main.ts", "둘", "README.md", "gone.ts"]);
    await expect(gapLine(page)).toHaveCount(0);

    // 셸(첫 칸)을 두 파일 탭 사이 틈(4)으로.
    await pressAndCross(page, 0);
    await moveToGap(page, 4);
    await page.mouse.up();
    await expect.poll(() => namesOf(page)).toEqual(["main.ts", "둘", "README.md", "하나", "gone.ts"]);

    // 끌어 놓은 칸은 안 켜진다 — 본문도 주소도 보던 파일 그대로다.
    expect(await litName(page)).toBe("gone.ts");
    await expect(page).toHaveURL(/tab=code&code=billing%2Fgone\.ts/);

    // ⌘K의 Work 줄로 옆 work에 갔다 온다(사이드바 Work 줄은 그 Work의 Thread로 간다 — v1 티켓 37) — 앱 안의 이동이라 묶음(메모리)이
    // 산다.
    await 작업화면으로(page, plainWork);
    await expect(bundleTabs(page)).toHaveCount(0);
    await 작업화면으로(page, fileWork);
    await expect(page).toHaveURL(/tab=code&code=billing%2Fgone\.ts/);
    await expect.poll(() => namesOf(page)).toEqual(["main.ts", "둘", "README.md", "하나", "gone.ts"]);
    expect(await litName(page)).toBe("gone.ts");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 번호는 **보이는 차례**다(스토리 48) — 셸이든 파일 탭이든 묶음의 n번째가 ⌘(n+1)이다. 끌어서 차례를 바꾸면 번호도 그 차례를
  // 따른다. 셸에 포커스가 있어도 같다 — 본문을 옮기는 키는 셸이 타이핑하지 않고 창으로 흘린다(`shellHotkey`의 `app`).
  test("셸 · 파일 · 셸에서 ⌘3이 파일 탭을, ⌘4가 둘째 셸을 고르고, 끌어 차례를 바꾸면 번호가 따라간다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/works/${fileWork.slug}?tab=terminal`);
    await expect(shellTabs(page)).toHaveCount(1);
    await 주소로간다(page, 파일탭주소(MAIN));
    await expect(bundleTabs(page)).toHaveCount(2);
    await openShell(page);
    await nameTwoShells(page);
    await expect.poll(() => namesOf(page)).toEqual(["하나", "main.ts", "둘"]);

    await page.keyboard.press("Meta+3");
    await expect.poll(() => litName(page)).toBe("main.ts");
    await expect(page.getByRole("main", { name: MAIN, exact: true })).toBeVisible();
    await expect(page).toHaveURL(/tab=code&code=billing%2Fsrc%2Fmain\.ts/);

    await page.keyboard.press("Meta+4");
    await expect.poll(() => litName(page)).toBe("둘");
    await expect(page).toHaveURL(/tab=terminal/);
    await expect(page).not.toHaveURL(/code=/);

    // 셸에 포커스가 든 채로도 같은 칸이다.
    await page.locator(".xterm-screen").click();
    await expect(셸입력(page)).toBeFocused();
    await page.keyboard.press("Meta+3");
    await expect.poll(() => litName(page)).toBe("main.ts");
    await page.keyboard.press("Meta+2");
    await expect.poll(() => litName(page)).toBe("하나");

    // 둘째 셸(셋째 칸)을 맨 앞 틈(0)으로 — 차례가 둘 · 하나 · main.ts가 된다.
    await pressAndCross(page, 2);
    await moveToGap(page, 0);
    await page.mouse.up();
    await expect.poll(() => namesOf(page)).toEqual(["둘", "하나", "main.ts"]);

    // ⌘3이 이제 「하나」, ⌘4가 파일 탭, ⌘2가 「둘」이다. 옛 차례면 각각 파일 탭 · 「둘」 · 「하나」다.
    await page.keyboard.press("Meta+3");
    await expect.poll(() => litName(page)).toBe("하나");
    await page.keyboard.press("Meta+4");
    await expect.poll(() => litName(page)).toBe("main.ts");
    await expect(page.getByRole("main", { name: MAIN, exact: true })).toBeVisible();
    await page.keyboard.press("Meta+2");
    await expect.poll(() => litName(page)).toBe("둘");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
  // **끄는 칸이 사라지면 끌기를 거둔다** — 파일 탭에도 같다(위 「끄는 셸이 끝나면」). 판정은 「그 칸이 아직 묶음에 있나」라,
  // 남의 칸이 빠지는 것(셸 하나가 끝났다)으로는 파일 탭 끌기가 안 끊기고, 끄던 파일 탭이 ⌘W로 닫히면 끊긴다.
  test("파일 탭을 끄는 도중 셸이 끝나도 끌기가 살고, 끄던 파일 탭이 닫히면 거둬진다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(파일탭주소(MAIN));
    await expect(bundleTabs(page)).toHaveCount(1);
    await openShell(page);
    await openShell(page);
    await nameTwoShells(page);
    await expect.poll(() => namesOf(page)).toEqual(["main.ts", "하나", "둘"]);

    // 파일 탭을 든 채 둘째 셸이 끝난다 — 줄이 바뀌어도 끌기가 살고, 새 줄의 끝 틈에 놓인다.
    await pressAndCross(page, 0);
    await exitShell(page, 2);
    await expect.poll(() => namesOf(page)).toEqual(["main.ts", "하나"]);
    await settle(page);
    await expect(page.locator("body")).toHaveClass(/dragging-row/);
    await moveToGap(page, 2);
    await page.mouse.up();
    await expect.poll(() => namesOf(page)).toEqual(["하나", "main.ts"]);

    // 파일 탭을 켜고 든 채 ⌘W — 확인 없이 닫히고(스토리 50) 끌기가 거둬진다. 그 뒤 줄 위에서 떼도 아무 일도 없다.
    await nameButton(page, 1).click();
    await expect(page.getByRole("main", { name: MAIN, exact: true })).toBeVisible();
    await pressAndCross(page, 1);
    await page.keyboard.press("Meta+w");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect.poll(() => namesOf(page)).toEqual(["하나"]);
    await expect(page.locator("body")).not.toHaveClass(/dragging-row/);
    const at = await gapPoint(page, 0);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await settle(page);
    await expect(gapLine(page)).toHaveCount(0);
    await page.mouse.up();
    await settle(page);
    await expect.poll(() => namesOf(page)).toEqual(["하나"]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});
