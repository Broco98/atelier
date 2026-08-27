import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 판 01 — 셸 화면이 위아래로도 꽉 찬다(결정 1). **이 층에서만 보이는 것 셋이다**: 실제 상자
// (정적 마크업 seam에는 높이가 없다), 그 상자를 실제로 칠하는 색, 그리고 xterm이 `rows`를
// 내림으로 재고 남기는 잉여 — 셋 다 진짜 xterm이 떠야 잰다.
//
// 픽스처 백엔드가 `pty_spawn`을 답해 xterm이 실제로 뜬다(works-split.spec.ts의 「경계를 끌면
// 터미널 격자가 따라간다」가 선례다).
//
// 마크업 seam(TerminalPane.test.tsx)이 보는 것은 여기서 다시 보지 않는다 — 안내가 흐름에
// 끼는지, 셸 0개일 때 덮개가 서는지는 그쪽이 든다.

const [, plainWork] = WORKS;

interface Fill {
  /** 셸의 집 위에 남은 띠. 머리행 아래부터 xterm이 그리기 시작하는 데까지. */
  above: number;
  /** 셸의 집 아래에 남은 띠. xterm이 안 그리는 자리다 — 한 셀보다 작아야 잉여다. */
  below: number;
  /** 그 잉여 자리에 실제로 칠해진 색. 셸 배경이 아니면 사람 눈에 띠로 보인다. */
  belowColor: string | null;
  /** 셸이 자기 화면에 칠하는 색. 위 값이 이것과 같아야 한다. */
  shellColor: string | null;
  /** 셸의 집 높이 — 창을 좁혔다 넓힌 것이 실제로 먹었는지 보는 데 쓴다. */
  hostHeight: number;
}

/**
 * 지금 화면의 격자에서 셀 높이를 얻는다. **상수로 적지 않는다** — 글꼴 설정이 바뀌면 값이
 * 바뀌고, 상수를 적으면 그날 이 검사가 「잉여가 커졌다」로 거짓 빨강을 낸다.
 *
 * `rows`는 백엔드로 나간 값에서 읽는다. 화면에서 세려 해도 셀은 캔버스에 그려져 DOM에 없다.
 */
async function cellHeight(page: Page, xtermHeight: number): Promise<number> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  // `at(-1)`을 안 쓴다 — tsconfig의 `lib`가 ES2020이라 그 메서드가 없다(TS2550).
  const grid = calls.filter((call) => /^pty_(spawn|resize) /.test(call)).reverse()[0];
  const rows = grid && /"rows":(\d+)/.exec(grid)?.[1];
  if (!rows) throw new Error(`격자를 못 읽었다 — pty 호출: ${JSON.stringify(calls)}`);
  return xtermHeight / Number(rows);
}

async function fillOf(page: Page): Promise<Fill> {
  await expect(page.locator("[data-shell-host]")).toBeVisible();
  await expect(page.locator(".xterm-screen")).toBeVisible();
  return page.evaluate(() => {
    // 그 점에 **실제로 칠해진** 색. 투명한 조상을 건너뛰며 올라간다 — 셸의 집이 칠하는
    // 색은 그 위에 얹힌 xterm 래퍼(투명)를 통과해서 보인다.
    const painted = (x: number, y: number): string | null => {
      let node: Element | null = document.elementFromPoint(x, y);
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "transparent" && !/^rgba\(0, 0, 0, 0\)$/.test(bg)) return bg;
        node = node.parentElement;
      }
      return null;
    };

    const host = document.querySelector("[data-shell-host]")!.getBoundingClientRect();
    const xterm = document.querySelector(".xterm")!.getBoundingClientRect();
    const header = document.querySelector("header")!.getBoundingClientRect();
    const middle = host.left + host.width / 2;
    return {
      // 머리행 바로 아래부터 재야 「집이 아래로 밀렸다」도 띠로 잡힌다 — 집만 보면
      // 그 위에 형제가 하나 더 서도 above가 0으로 나온다.
      above: xterm.top - header.bottom,
      below: host.bottom - xterm.bottom,
      belowColor: painted(middle, host.bottom - 1),
      shellColor: getComputedStyle(document.querySelector(".xterm")!).backgroundColor,
      hostHeight: host.height,
    };
  });
}

/**
 * 띠가 없다 — 위는 아예 0이고, 아래는 xterm의 잉여이며 그 자리가 셸 배경으로 칠해져 있다.
 * 돌려주는 것은 셀 높이다: 창 크기를 바꾸는 검사가 「셸이 따라왔는가」를 그것으로 기다린다.
 */
async function expectFilled(page: Page, where: string): Promise<number> {
  const fill = await fillOf(page);
  expect(fill.above, `${where}: 셸 화면 위에 ${fill.above}px 띠가 남았다`).toBe(0);
  expect(fill.belowColor, `${where}: 셸 화면 아래 ${fill.below}px가 셸 배경이 아니다`).toBe(
    fill.shellColor,
  );
  // 칠만 보면 「누가 아래에 여백을 8px 넣었다」도 초록이 된다 — 그 여백도 집 안이라 같은
  // 색으로 칠해지기 때문이다. 남은 것이 **한 셀보다 작다**는 것이 잉여의 정의다.
  //
  // 음수도 막는다. 셸이 집보다 크면 아래가 잘려 나가는데, 그때도 `belowColor`는 xterm
  // 자신을 집어 초록이 된다 — 창을 줄인 직후가 정확히 그 모양이다.
  const cell = await cellHeight(page, fill.hostHeight - fill.below);
  expect(fill.below, `${where}: 아래가 ${fill.below}px다 — 잉여가 아니다 (셀 ${cell}px)`)
    .toBeGreaterThanOrEqual(0);
  expect(fill.below, `${where}: 아래 ${fill.below}px는 잉여가 아니다 (셀 ${cell}px)`).toBeLessThan(
    cell,
  );
  return cell;
}

/**
 * 창을 바꾼 뒤 **셸이 따라오기를 기다린다.** 창 크기는 그 자리에서 먹지만 xterm의 격자는
 * 관찰자(ResizeObserver) → `fit()` → 렌더러를 한 바퀴 돌아 늦게 온다 — 안 기다리면 이
 * 검사가 「따라오는 중」을 「띠가 돌아왔다」로 읽는다(실측: 다시 넓힌 직후 아래가 176px).
 *
 * 기다리는 조건이 **0 이상 한 셀 미만**인 것은 양방향이라서다. 좁힐 때는 셸이 잠깐 집보다
 * 커서 아래가 음수가 되고, 넓힐 때는 잠깐 작아서 한 셀보다 크다.
 */
async function settle(page: Page, cell: number) {
  await expect
    .poll(async () => {
      const { below } = await fillOf(page);
      return below >= 0 && below < cell;
    }, { message: "셸이 새 창 크기를 안 따라왔다" })
    .toBe(true);
}

test("최상위 터미널이 위아래로 꽉 찬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expectFilled(page, "/terminal");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("work의 터미널이 위아래로 꽉 찬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expectFilled(page, "work 터미널");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 수용 기준 「창을 좁혔다 넓혀도 띠가 안 돌아온다」. 잉여는 창 높이를 셀 높이로 나눈
// 나머지라 **높이마다 값이 다르다** — 한 높이에서만 재면 우연히 0인 자리를 초록으로 읽는다.
test("창을 좁혔다 넓혀도 띠가 안 돌아온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  const cell = await expectFilled(page, "처음");
  const { hostHeight: first } = await fillOf(page);

  await page.setViewportSize({ width: 900, height: 553 });
  // 줄인 것이 실제로 먹었는가 — 이것이 안 서면 아래 판정은 「창을 못 줄였다」를 초록으로 읽는다.
  await expect.poll(async () => (await fillOf(page)).hostHeight).toBeLessThan(first);
  await settle(page, cell);
  await expectFilled(page, "좁힌 뒤");

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(async () => (await fillOf(page)).hostHeight).toBe(first);
  await settle(page, cell);
  await expectFilled(page, "다시 넓힌 뒤");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
