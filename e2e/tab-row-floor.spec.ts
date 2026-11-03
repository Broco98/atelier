import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { ARCHIVE, PROJECTS, WORKS } from "./fixtures";
import { installFixtureBackend, openShell, unknownIpcCalls, 카드자리끝 } from "./harness";
import { settle, SQUEEZED_SIDEBAR, squeezedWidth } from "./tab-row";

// 탭 줄의 **바닥** — 어느 창 폭·어느 패널 폭에서도 셸 칸 하나는 온전히 보인다(`panel-layout`의
// `TAB_ROW_CARD` · `TAB_ROW_COLUMN`). 한때 900px 창에 작업 패널이 열린 기본 배치에서 칸 상자가 0px이 되어 칸이
// 화면에 없었다. 탭 줄은 본문 카드의 머리라(codex-ds 스펙 §4) 작업 패널과 같은 카드 줄에 서고, 그 바닥은 **작업 패널이 제
// 최소 폭까지, 그다음 사이드바가 자리를 내줘서** 선다. 패널은 문서 카드에 자리를 내주되 문서 카드에 제 최소 폭만큼은
// 남긴다(`Frame`의 패널 칸). 그래서 이 파일이 보는 것은 줄보다 그 둘이다: 각자의 최소 폭
// 아래로는 안 줄고, 창 밖으로 밀리지 않고, 사람이 끌어 고른 폭(저장값)은 창이 좁아진다고 안 지워지고,
// 좁게 선 채로 끌어도 손잡이가 안 튄다.
//
// **사이드바가 좁게 서는 것은 이제 앱 창의 최소 폭(900, `tauri.conf.json`) 아래에서만이다** — 탭 줄의 바닥과 넓힌
// 사이드바(400)를 더해도 900에 못 미친다(OS마다 잰 바닥은 `tab-row.ts` 머리말). 그 장치(열의 `min-w-min`)는 그대로 있으므로,
// 사이드바를 좁게 세워야 하는 검사는 일부러 그 아래 폭에서 잰다. 그 폭은 수가 아니라 **지금 줄의 바닥을 재서** 낸다
// (`squeezedWidth`, `tab-row.ts`) — 바닥에는 줄의 글자가 들고, 글자가 시스템 글꼴이라 OS마다 폭이 다르다(codex-ds 결정 3).
//
// 칸이 보이는지 · 눌리는지 · `+`가 줄 안인지는 `terminal-tabs.spec.ts`가 세 화면 × 두 폭 × 세
// 배치로 든다. 여기는 **기본 폭이 아닌 배치**와 **움직이는 동안**이다.

const [pinnedWork, plainWork, multiWork] = WORKS;
const HANDLE = '[title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]';

/** 작업 패널 손잡이의 가운데 — 패널 카드 왼쪽 틈의 가운데다(ui-refresh 결정 4). 끄는 손은 여기를 잡는다. */
async function panelHandleAt(page: Page) {
  const box = (await page.locator("aside").nth(1).locator(HANDLE).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 사람이 끌어 고른 폭을 심고 연다 — 저장 키는 `useResizableWidth`를 부르는 두 자리의 것이다. */
async function openWith(page: Page, url: string, width: number, saved: { sidebar: number; panel: number }) {
  await page.addInitScript(({ sidebar, panel }) => {
    localStorage.setItem("sidebar-width", String(sidebar));
    localStorage.setItem("work-panel-width", String(panel));
  }, saved);
  await installFixtureBackend(page);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(url);
}

/** **배치가 멈출 때까지 기다린다** — 규칙은 세 스펙이 함께 쓰는 `settle` 하나다(지연된 `max-width`까지 기다린다). */
const settled = (page: Page) => settle(page, () => layoutOf(page));

/**
 * 사이드바 · 작업 패널 · 칸 상자를 한 번에 잰다. 패널이 없는 화면이면 `panel`이 `null`이다.
 *
 * 작업 패널은 **카드**를 잰다 — 바깥 상자(두 번째 `aside`)는 「왼쪽 틈 + 카드」이고(ui-refresh 결정 4 · 27), 사람이 고른 폭
 * (저장값)은 카드의 폭이다. 손잡이는 그 틈의 가운데라 끄는 자리는 `panelHandleAt`으로 잡는다.
 */
async function layoutOf(page: Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelectorAll("aside")[0].getBoundingClientRect();
    const panel = document.querySelectorAll("aside")[1]?.querySelector('[data-slot="card"]')?.getBoundingClientRect();
    const strip = document.querySelector("[data-tab-strip]");
    const cells = [...document.querySelectorAll('[data-tab="shell"]')].map((cell) => cell.getBoundingClientRect().width);
    // 패널 토글은 머리 줄 오른쪽 끝 묶음의 맨 끝(`aside` 밖)에 선다 — 이름이 상태를 타므로 두 이름으로 집는다(ui-refresh 결정 9).
    const toggle = document
      .querySelector('button[aria-label="작업공간 패널 접기"], button[aria-label="작업공간 패널 펼치기"]')
      ?.getBoundingClientRect();
    const panelAside = document.querySelectorAll("aside")[1] as HTMLElement | undefined;
    return {
      viewport: window.innerWidth,
      pageSpill: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebar: Math.round(sidebar.width),
      panel: panel ? { left: panel.left, width: Math.round(panel.width), right: panel.right } : null,
      // 패널 칸(두 번째 `aside`)의 오른쪽 끝 — 패널이 창 안에 있어도 안쪽 열이 잘리면 카드 오른쪽이 이 끝을 넘는다. 한때는
      // 패널 머리 오른쪽 끝의 `×`로 쟀는데, 그 버튼이 패널 토글로 합쳐져 패널 밖으로 나갔다.
      panelBoxRight: panelAside ? panelAside.getBoundingClientRect().right : null,
      toggleRight: toggle ? toggle.right : null,
      // 패널이 **제 안에서 가로로 밀려 있지 않다** — 넘침을 감춘 상자라도 `scrollLeft`가 서면(Playwright가 잘린
      // 버튼을 누르려 스크롤해 들인다) `×`는 창 안인데 왼쪽이 가려진다. 안쪽 열의 왼쪽도 상자 왼쪽이어야 한다.
      panelScroll: panelAside
        ? {
            scrollLeft: panelAside.scrollLeft,
            innerShift: (panelAside.firstElementChild as HTMLElement).getBoundingClientRect().left - panelAside.getBoundingClientRect().left,
          }
        : null,
      strip: strip ? strip.clientWidth : 0,
      cell: cells.length ? Math.min(...cells) : 0,
    };
  });
}

type Layout = Awaited<ReturnType<typeof layoutOf>>;

function expectFits(layout: Layout, at: string) {
  const says = `${at} ${JSON.stringify(layout)}`;
  expect(layout.pageSpill, says).toBeLessThanOrEqual(0);
  // 칸이 선 줄이면 상자에 칸 하나가 온전히 들어간다. 칸이 없는 줄(문서만 본 work)은 상자도 없다.
  expect(layout.strip, says).toBeGreaterThanOrEqual(layout.cell);
  if (layout.panel) {
    expect(layout.panel.right, says).toBeLessThanOrEqual(layout.viewport + 0.5);
    expect(layout.panel.right, says).toBeLessThanOrEqual(layout.panelBoxRight! + 0.5);
    // 패널을 여닫는 토글도 창 안이다 — 토글은 머리 줄 오른쪽 끝에 늘 그대로이고 자리를 내주는 것은 패널 · 사이드바다(판 04 「지키는 것」).
    expect(layout.toggleRight!, says).toBeLessThanOrEqual(layout.viewport + 0.5);
    expect(layout.panelScroll!.scrollLeft, says).toBe(0);
    expect(Math.abs(layout.panelScroll!.innerShift), says).toBeLessThanOrEqual(0.5);
  }
}

// 넓힌 사이드바(최대 400)와 넓힌 작업 패널(최대 560)은 기본 폭보다 훨씬 큰 창에서도 본문을 민다 — 한때
// 1280px 창에서 둘을 빼면 줄에 320px이 남았다. 지금은 줄이 본문 카드의 머리라 패널과 같은 카드 줄에 서고, 900px에서는
// 패널이 본문 카드에 자리를 내주며 좁게 선다. 기본 폭만 재는 검사로는 안 보인다.
for (const width of [900, 1280]) {
  for (const screen of [
    { name: "work", url: `/works/${plainWork.slug}?tab=terminal` },
  ]) {
    test(`${screen.name} ${width}px — 넓혀 둔 사이드바·패널이 줄에 자리를 내주고, 저장한 폭은 그대로다`, async ({
      page,
    }) => {
      await openWith(page, screen.url, width, { sidebar: 400, panel: 560 });
      const tabs = page.locator('[data-tab="shell"]');
      await tabs.first().waitFor();
      await openShell(page);
      await expect(tabs).toHaveCount(2);

      const layout = await settled(page);
      expectFits(layout, `${screen.name} ${width}px`);
      // **각자의 최소 폭 아래로는 안 준다**(`useResizableWidth`의 240·260) — 줄을 살리려고 패널을
      // 못 읽을 폭까지 누르지 않는다.
      expect(layout.sidebar).toBeGreaterThanOrEqual(240);
      expect(layout.panel!.width).toBeGreaterThanOrEqual(260);
      // 좁게 선 것은 **그려진 폭**뿐이다 — 사람이 고른 폭은 창을 다시 넓히면 돌아와야 한다.
      const saved = await page.evaluate(() => [localStorage.getItem("sidebar-width"), localStorage.getItem("work-panel-width")]);
      expect(saved).toEqual(["400", "560"]);

      // 칸이 **눌린다** — 켜지지 않은 첫 칸을 눌러 켠다.
      const first = tabs.first().locator("button[aria-pressed]");
      await first.click({ timeout: 5000 });
      await expect(first).toHaveAttribute("aria-pressed", "true");

      // 창을 넓히면 고른 폭으로 돌아온다.
      await page.setViewportSize({ width: 1920, height: 800 });
      const wide = await settled(page);
      expect(wide.sidebar).toBe(400);
      expect(wide.panel!.width).toBe(560);

      expect(await unknownIpcCalls(page)).toEqual([]);
    });
  }
}

test("넓은 창에서 900px로 줄이는 동안에도 칸이 남는다 — 패널을 연 채", async ({ page }) => {
  // 창을 처음 900px로 여는 길과 **줄이는 길**은 다른 경로다 — 줄이는 동안은 폭이 계속 바뀐다.
  await openWith(page, `/works/${plainWork.slug}?tab=terminal`, 1280, { sidebar: 280, panel: 330 });
  const tabs = page.locator('[data-tab="shell"]');
  await tabs.first().waitFor();
  await openShell(page);
  await expect(tabs).toHaveCount(2);
  await settled(page);

  for (const width of [1100, 1000, 950, 900]) {
    await page.setViewportSize({ width, height: 800 });
    expectFits(await settled(page), `${width}px`);
  }
  const first = tabs.first().locator("button[aria-pressed]");
  await first.click({ timeout: 5000 });
  await expect(first).toHaveAttribute("aria-pressed", "true");
});

test("좁게 선 패널·사이드바를 끌면 손잡이가 포인터를 따라온다 — 저장값에서 튀지 않는다", async ({ page }) => {
  // 넓혀 둔 둘 — 패널은 **1100px 창에서** 560을 골랐지만 문서 카드에 자리를 내주느라 그보다 좁게 서고(약 424),
  // 사이드바는 아래에서 창을 줄여 400보다 좁게 세운다. 끄는 계산이 저장값에서 출발하면 첫 움직임에 그 차이만큼
  // 가장자리가 포인터에서 떨어진다. 패널 쪽 차이가 작은 것은 아래 `before.panel.width < 560`이 전제로 든다 — 최소 폭(260)까지
  // 눌린 배치면 안쪽으로 끌어도 움직일 자리가 없어 이 검사가 아무것도 못 잰다.
  await openWith(page, `/works/${plainWork.slug}?tab=terminal`, 1100, { sidebar: 400, panel: 560 });
  await page.locator('[data-tab="shell"]').first().waitFor();
  const before = await settled(page);
  expect(before.panel!.width, JSON.stringify(before)).toBeLessThan(560);
  expect(before.panel!.width, JSON.stringify(before)).toBeGreaterThan(260 + 40);

  // 작업 패널 — 오른쪽 패널이라 손잡이가 왼쪽 틈이다. 오른쪽으로 40px 끌면 그만큼 좁아진다.
  const { x, y } = await panelHandleAt(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 3 });
  await page.mouse.move(x + 40, y, { steps: 3 });
  // **다음 그림까지 기다린다** — 포인터 이동은 연속 이벤트라 React가 다음 프레임에 그린다. 곧장
  // 재면 한 걸음 전의 폭이다.
  await expect
    .poll(async () => Math.round((await layoutOf(page)).panel!.left - before.panel!.left))
    .toBeGreaterThanOrEqual(39);
  const during = await layoutOf(page);
  await page.mouse.up();
  expect(during.panel!.left - before.panel!.left, JSON.stringify({ before, during })).toBeLessThanOrEqual(41);

  // 사이드바 — 탭 줄이 바닥에 닿는 창(머리말)에서 400을 고른 사이드바가 좁게 선다. 왼쪽으로 20px 끌면 그만큼 좁아진다.
  await page.setViewportSize({ width: await squeezedWidth(page), height: 800 });
  const narrow = await settled(page);
  // 창 폭을 지금 줄의 바닥에서 냈으므로 사이드바는 정해 둔 폭에 선다 — 저장값(400)보다 좁고, 20px을 끌 자리가 최소 폭(240) 위에 있다.
  expect(narrow.sidebar, JSON.stringify(narrow)).toBeGreaterThanOrEqual(SQUEEZED_SIDEBAR);
  expect(narrow.sidebar, JSON.stringify(narrow)).toBeLessThanOrEqual(SQUEEZED_SIDEBAR + 1);
  // 손잡이는 사이드바 오른쪽 가장자리의 띠다 — 그 가운데를 누른다. 띠의 자리는 상자에서 읽는다(한때 사이드바가 흰 판 안이라 판의
  // 띄움 뒤에서 시작했다 — restart 02a-1이 판을 걷어 사이드바는 다시 창 왼쪽 끝 0에서 선다).
  const sideHandle = (await page.locator("aside").first().locator(HANDLE).boundingBox())!;
  const [sx, sy] = [sideHandle.x + sideHandle.width / 2, sideHandle.y + sideHandle.height / 2];
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx - 10, sy, { steps: 3 });
  await page.mouse.move(sx - 20, sy, { steps: 3 });
  await expect.poll(async () => (await layoutOf(page)).sidebar).toBeLessThanOrEqual(narrow.sidebar - 19);
  const dragged = await layoutOf(page);
  await page.mouse.up();
  expect(dragged.sidebar, JSON.stringify({ narrow, dragged })).toBeGreaterThanOrEqual(narrow.sidebar - 21);
});

test("좁게 선 패널의 손잡이를 스치듯 눌렀다 떼도 고른 폭이 안 지워진다", async ({ page }) => {
  // 끌기는 그려진 폭에서 출발한다(위 검사). 그런데 1~2px 스친 눌림도 끌기로 치면 떼는 순간 **좁게 선
  // 폭이 저장값을 덮어**, 창을 다시 넓혀도 고른 560이 안 돌아온다 — 사람은 아무것도 안 끌었다.
  await openWith(page, `/works/${plainWork.slug}?tab=terminal`, 900, { sidebar: 280, panel: 560 });
  await page.locator('[data-tab="shell"]').first().waitFor();
  const before = await settled(page);
  expect(before.panel!.width, JSON.stringify(before)).toBeLessThan(400);

  const { x, y } = await panelHandleAt(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y);
  await page.mouse.move(x + 2, y);
  await page.mouse.up();

  expect(await page.evaluate(() => localStorage.getItem("work-panel-width"))).toBe("560");
  await page.setViewportSize({ width: 1920, height: 800 });
  expect((await settled(page)).panel!.width).toBe(560);
});

test("좁게 선 패널·사이드바를 바깥으로 끌어도 고른 폭이 안 지워진다", async ({ page }) => {
  // 좁게 선 패널은 문서 카드의 바닥(패널 최소 폭)에 막혀 **더 넓게 못 선다** — 바깥으로 끌면 화면은 그대로다.
  // 사이드바는 탭 줄의 바닥에 막혀 같다. 그런데 그 끌기를 폭으로 치면 떼는 순간 「그려진 폭 + 끈 거리」가 사람이
  // 고른 폭(저장값)을 덮어, 창을 넓혀도 고른 폭이 안 돌아온다. 사람은 넓히려 했는데 결과는 좁힌 셈이다.
  await openWith(page, `/works/${plainWork.slug}?tab=terminal`, 900, { sidebar: 400, panel: 560 });
  await page.locator('[data-tab="shell"]').first().waitFor();
  const before = await settled(page);
  expect(before.panel!.width, JSON.stringify(before)).toBeLessThan(560 - 40);

  // 작업 패널 — 손잡이가 왼쪽 틈이라 바깥은 왼쪽이다.
  const { x, y } = await panelHandleAt(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem("work-panel-width"))).toBe("560");

  // 사이드바 — 탭 줄이 바닥에 닿는 창에서 좁게 선다(머리말). 손잡이가 오른쪽 가장자리라 바깥은 오른쪽이다.
  await page.setViewportSize({ width: await squeezedWidth(page), height: 800 });
  const narrow = await settled(page);
  expect(narrow.sidebar, JSON.stringify(narrow)).toBeLessThan(400 - 40);
  // 손잡이 띠의 가운데를 누른다(위 검사와 같은 까닭 — 띠의 자리는 상자에서 읽는다). 그 끌기가 실제로 손잡이를 잡았다는 앵커로 끄는
  // 동안의 표식(문서의 `resizing` — `setResizing`)을 본다 — 못 잡았으면 아래 「저장값 그대로」가 헛돈다(한때 「폭 − 2」를 눌러 판 안
  // 사이드바에서 손잡이를 비껴가 그렇게 초록이었다).
  const sideHandle = (await page.locator("aside").first().locator(HANDLE).boundingBox())!;
  const [sx, sy] = [sideHandle.x + sideHandle.width / 2, sideHandle.y + sideHandle.height / 2];
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy, { steps: 8 });
  expect(await page.evaluate(() => document.body.classList.contains("resizing")), "손잡이를 잡았다").toBe(true);
  await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem("sidebar-width"))).toBe("400");

  await page.setViewportSize({ width: 1920, height: 800 });
  const wide = await settled(page);
  expect({ sidebar: wide.sidebar, panel: wide.panel!.width }).toEqual({ sidebar: 400, panel: 560 });
});

test("작업 패널·사이드바를 접고 펴도 안쪽 열이 되흐르지 않고, 900px에서는 편 뒤 창 안에 선다", async ({ page }) => {
  // 패널이 자리를 내주게 되면서 안쪽 열이 고정 폭만 들 수 없게 됐다 — 좁게 서면 오른쪽이 잘린다.
  // 그래도 **접히는 동안에는** 고정 폭을 든다(`foldingInnerClass` 주석) — 그 동안 안쪽 폭이
  // 바깥 폭을 따라가면 글과 `×`가 폭과 함께 되흐른다.
  //
  // 사이드바를 320으로 둔다 — 900px 창에서 패널(330)이 문서 카드에 자리를 내주며 좁게 서는 배치가 그 폭부터다
  // (900 − 320 − 틈 둘 − 문서 카드의 바닥 260 = 304). 280이면 패널이 제 폭으로 다 들어가 맨 끝 단언이 아무것도 못 잰다.
  await openWith(page, `/works/${plainWork.slug}?tab=terminal`, 1280, { sidebar: 320, panel: 330 });
  await page.locator('[data-tab="shell"]').first().waitFor();
  await settled(page);

  // 작업 패널은 안쪽 열 속의 **카드**를 잰다 — 안쪽 열은 「틈 + 카드」라 저장한 폭보다 틈만큼 넓다.
  const innerWidths = (which = 1) =>
    page.evaluate(async (at) => {
      const box = document.querySelectorAll("aside")[at];
      const inner = (at === 1 ? box.querySelector('[data-slot="card"]') : box.firstElementChild) as HTMLElement;
      const seen = new Set<number>();
      const start = performance.now();
      while (performance.now() - start < 400) {
        seen.add(Math.round(inner.getBoundingClientRect().width));
        await new Promise((done) => requestAnimationFrame(done));
      }
      return [...seen];
    }, which);

  await page.getByRole("button", { name: /패널 접기$/ }).click();
  expect(await innerWidths()).toEqual([330]);
  await page.getByRole("button", { name: /패널 펼치기$/ }).click();
  expect(await innerWidths()).toEqual([330]);
  // 사이드바 안쪽 열도 같다(⌘B) — 저장한 폭 그대로다.
  await settled(page);
  // 재고 나서 **정말 접히고 펴졌는지**를 본다 — ⌘B가 안 먹어도 사이드바가 제자리라 안쪽 폭은 320이다.
  // 재기 전에 보면 400ms 표본이 접히는 동안을 놓친다.
  await page.keyboard.press("Meta+b");
  expect(await innerWidths(0)).toEqual([320]);
  // 접힌 사이드바는 폭 8의 틈으로 남는다(restart 02a-1 — 한때 0).
  await expect.poll(async () => (await layoutOf(page)).sidebar).toBe(8);
  await page.keyboard.press("Meta+b");
  expect(await innerWidths(0)).toEqual([320]);
  await expect.poll(async () => (await layoutOf(page)).sidebar).toBe(320);

  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByRole("button", { name: /패널 접기$/ }).click();
  await settled(page);
  await page.getByRole("button", { name: /패널 펼치기$/ }).click();
  const opened = await settled(page);
  expectFits(opened, "900px 편 뒤");
  expect(opened.panel!.width).toBeLessThan(330);
});

// 한때 여기 「분할을 켠 채 900px에서 패널을 펴도 칸이 남고 두 열이 창 안이다」가 있었다 — restart 02a-13이 분할을 걷었다.

// 문서는 넓힌 카드로 연다(restart 02a-13 — 한때 본문의 문서 탭이었다). 넓힌 카드 보기에는 끊을 자리 없는 코드 줄 · 넓은 표도 산다. 그 폭이
// 카드 줄의 바닥에 섞이면 소스 보기를 켤 때마다 카드가 창 밖으로 밀린다(`TAB_ROW_CARD` 머리말). 넓힌 카드는 사이드바와 작업 패널을 접고
// 서므로 견줄 것은 카드 자리의 끝이다.
test("넓힌 카드의 문서가 창보다 넓어도 카드가 창을 밀지 않는다 — 원문 보기도", async ({ page }) => {
  await openWith(page, `/works/${pinnedWork.slug}?file=${encodeURIComponent("overview.md")}`, 900, {
    sidebar: 280,
    panel: 330,
  });
  const card = page.locator("section[data-expanded]");
  await expect(card.getByRole("heading", { name: "개요" })).toBeVisible();

  const fits = async (at: string) => {
    const now = await settle(page, async () => ({
      spill: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      card: await card.evaluate((el) => el.getBoundingClientRect().right),
      seat: (await 카드자리끝(page)).right,
    }));
    const says = `${at} ${JSON.stringify(now)}`;
    expect(now.spill, says).toBeLessThanOrEqual(0);
    expect(now.card, says).toBeLessThanOrEqual(now.seat + 0.5);
  };
  await fits("좁은 문서");

  await page.goto(`/works/${multiWork.slug}?file=${encodeURIComponent("넓은.md")}`);
  await expect(card.getByRole("heading", { name: "넓은 문서" })).toBeVisible();
  await fits("넓은 문서");

  // 원문 보기 — 줄바꿈 없는 코드뷰다.
  await card.getByRole("button", { name: "원문", exact: true }).click();
  await fits("넓은 문서 원문");
});

// 한때 목록 칸이 있는 화면(codex-ds 결정 28 — 내용 | 목록 한 카드)이 있었다 — 마지막이 Archive였고, 목록 칸(240–560)을 끝까지 넓혀 둔
// 좁은 창에서 목록 칸이 그려진 폭을 내주는 것(`Frame`의 `ListCard`)과 곁의 spec 목록 패널이 내주는 것(`PanelBox`)을 여기서 쟀다.
// restart 03-4가 Archive를 공용 목록 · 상세 판으로 옮겨 그 칸이 없다 — Archive도 아래 Projects 표처럼 바닥 없는 판 하나다.
//
// Projects 표(03)는 목록 칸이 없는 판 하나라 바닥도 없다 — 앱 창의 최소 폭(900)에 사이드바를 400으로 넓혀 둬도 사이드바가 저장한 폭으로
// 서고, 표는 판 안에서 줄어 창을 밀지 않는다(이름 칸은 `minmax(0, …)`이라 줄고 시각 · 동작 칸만 고정이다). 창 900은 좁은 판이라(restart 03-12b —
// `@media (max-width: 900px)`) 줄 끝 단추 가운데 마지막(「새 채팅」)만 서고 ⋯ · 「작업공간 만들기」는 숨는다.
test("Projects 표(/projects)는 900 창에 사이드바를 400으로 넓혀 둬도 사이드바가 저장한 폭으로 서고, 표가 판 안에 든다", async ({ page }) => {
  await openWith(page, "/projects", 900, { sidebar: 400, panel: 330 });
  const table = page.getByRole("table", { name: "Project 목록", exact: true });
  await expect(table).toBeVisible();
  const layout = await settled(page);
  expect(layout.sidebar).toBe(400);
  expect(layout.pageSpill).toBeLessThanOrEqual(0);
  const [tableBox, mainBox] = [await table.boundingBox(), await page.locator("main").boundingBox()];
  expect(tableBox!.x + tableBox!.width, "표 오른쪽 끝 ≤ 판 오른쪽 끝").toBeLessThanOrEqual(mainBox!.x + mainBox!.width);
  // 줄 끝 단추도 판 안이다 — 표가 넘쳐 잘리면 줄 끝이 먼저 사라진다.
  await expect(table.getByRole("button", { name: `${PROJECTS[0].name} 메뉴`, exact: true }), "좁은 판 — ⋯는 숨는다").toBeHidden();
  const last = await table.getByRole("button", { name: `${PROJECTS[0].name} 범위로 새 채팅`, exact: true }).boundingBox();
  expect(last!.x + last!.width, "줄 끝 단추 오른쪽 끝 ≤ 표 오른쪽 끝").toBeLessThanOrEqual(tableBox!.x + tableBox!.width);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Archive 목록 · 상세(restart 03-4)도 바닥 없는 판 하나다 — 900 창에 사이드바를 400으로 넓혀 둬도 사이드바가 저장한 폭으로 서고, 판이 창을
// 밀지 않는다. 한때 걸려 있던 목록 칸 폭(`archive-panel-width` 560)은 앱이 뜰 때 지운다(`frame.spec.ts`의 「Projects: ⌘Enter …」).
for (const screen of [
  { url: "/archive", ready: "table", name: "Archive 목록" },
  { url: `/archive/${ARCHIVE[0].slug}`, ready: "navigation", name: "문서" },
] as const) {
  test(`Archive 판(${screen.url})은 900 창에 사이드바를 400으로 넓혀 둬도 사이드바가 저장한 폭으로 서고, 판이 창을 밀지 않는다`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("archive-panel-width", "560"));
    await openWith(page, screen.url, 900, { sidebar: 400, panel: 330 });
    await expect(page.locator("main").getByRole(screen.ready, { name: screen.name, exact: true })).toBeVisible();
    const layout = await settled(page);
    expect(layout.sidebar).toBe(400);
    expect(layout.pageSpill).toBeLessThanOrEqual(0);
    const main = (await page.locator("main").boundingBox())!;
    expect(main.x + main.width, "판 오른쪽 끝 ≤ 카드 자리 오른쪽 끝").toBeLessThanOrEqual((await 카드자리끝(page)).right);
    expect(await page.evaluate(() => localStorage.getItem("archive-panel-width")), "걷은 칸의 폭은 지운다").toBeNull();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}
