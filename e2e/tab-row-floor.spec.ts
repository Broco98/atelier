import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { ROOMS, WORKS } from "./fixtures";
import { installFixtureBackend, openShell, unknownIpcCalls } from "./harness";
import { rowOf, settle } from "./tab-row";

// 탭 줄의 **바닥** — 어느 창 폭·어느 패널 폭에서도 셸 칸 하나는 온전히 보인다(`panel-layout`의
// `TAB_ROW_COLUMN`). 한때 900px 창에 작업 패널이 열린 기본 배치에서 칸 상자가 0px이 되어 칸이
// 화면에 없었다. 그 바닥은 **작업 패널과 사이드바가 자리를 내줘서** 선다 — 그래서 이 파일이 보는
// 것은 줄보다 그 둘이다: 각자의 최소 폭 아래로는 안 줄고, 창 밖으로 밀리지 않고, 사람이 끌어
// 고른 폭(저장값)은 창이 좁아진다고 안 지워지고, 좁게 선 채로 끌어도 손잡이가 안 튄다.
//
// 칸이 보이는지 · 눌리는지 · `+`가 줄 안인지는 `terminal-tabs.spec.ts`가 세 화면 × 두 폭 × 세
// 배치로 든다. 여기는 **기본 폭이 아닌 배치**와 **움직이는 동안**이다.

const [pinnedWork, plainWork, multiWork] = WORKS;
const HANDLE = '[title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]';

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

/** 사이드바 · 작업 패널 · 칸 상자를 한 번에 잰다. 패널이 없는 화면이면 `panel`이 `null`이다. */
async function layoutOf(page: Page) {
  return page.evaluate(() => {
    const [sidebar, panel] = [...document.querySelectorAll("aside")].map((aside) => aside.getBoundingClientRect());
    const strip = document.querySelector("[data-tab-strip]");
    const cells = [...document.querySelectorAll('[data-tab="shell"]')].map((cell) => cell.getBoundingClientRect().width);
    const close = document.querySelector('aside button[aria-label$="패널 접기"]')?.getBoundingClientRect();
    const panelAside = document.querySelectorAll("aside")[1] as HTMLElement | undefined;
    return {
      viewport: window.innerWidth,
      pageSpill: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebar: Math.round(sidebar.width),
      panel: panel ? { left: panel.left, width: Math.round(panel.width), right: panel.right } : null,
      // 패널 머리행 오른쪽 끝의 `×` — 패널이 창 안에 있어도 안쪽 열이 잘리면 이것이 먼저 사라진다.
      closeRight: close ? close.right : null,
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
    expect(layout.closeRight!, says).toBeLessThanOrEqual(layout.panel.right + 0.5);
    expect(layout.panelScroll!.scrollLeft, says).toBe(0);
    expect(Math.abs(layout.panelScroll!.innerShift), says).toBeLessThanOrEqual(0.5);
  }
}

// 넓힌 사이드바(최대 400)와 넓힌 작업 패널(최대 560)은 기본 폭보다 훨씬 큰 창에서도 줄을 0으로
// 민다 — 1280px 창에서 둘을 빼면 줄에 320px이 남는다. 기본 폭만 재는 검사로는 안 보인다.
for (const width of [900, 1280]) {
  for (const screen of [
    { name: "work", url: `/works/${plainWork.slug}?tab=terminal` },
    // 상태 배지가 `draft`인 Room — 조작 묶음의 폭이 Atelier의 `active`와 다르다.
    { name: "Maison draft Room", url: `/maison/rooms/${ROOMS[0].slug}?tab=terminal` },
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
  // 넓혀 둔 둘 — 패널은 **1280px 창에서** 560을 골랐지만 그보다 좁게 서고(약 535), 사이드바는 아래에서 창을
  // 900px로 줄여 400보다 좁게 세운다. 끄는 계산이 저장값에서 출발하면 첫 움직임에 그 차이만큼 가장자리가
  // 포인터에서 떨어진다. 패널 쪽 차이가 작은 것은 아래 `before.panel.width < 560`이 전제로 든다.
  await openWith(page, `/works/${plainWork.slug}?tab=terminal`, 1280, { sidebar: 400, panel: 560 });
  await page.locator('[data-tab="shell"]').first().waitFor();
  const before = await settled(page);
  expect(before.panel!.width, JSON.stringify(before)).toBeLessThan(560);

  // 작업 패널 — 오른쪽 패널이라 핸들이 왼쪽 가장자리다. 오른쪽으로 40px 끌면 그만큼 좁아진다.
  const panelHandle = (await page.locator("aside").nth(1).locator(HANDLE).boundingBox())!;
  const y = panelHandle.y + panelHandle.height / 2;
  await page.mouse.move(before.panel!.left + 2, y);
  await page.mouse.down();
  await page.mouse.move(before.panel!.left + 22, y, { steps: 3 });
  await page.mouse.move(before.panel!.left + 42, y, { steps: 3 });
  // **다음 그림까지 기다린다** — 포인터 이동은 연속 이벤트라 React가 다음 프레임에 그린다. 곧장
  // 재면 한 걸음 전의 폭이다.
  await expect
    .poll(async () => Math.round((await layoutOf(page)).panel!.left - before.panel!.left))
    .toBeGreaterThanOrEqual(39);
  const during = await layoutOf(page);
  await page.mouse.up();
  expect(during.panel!.left - before.panel!.left, JSON.stringify({ before, during })).toBeLessThanOrEqual(41);

  // 사이드바 — 900px에서 400을 고른 사이드바가 좁게 선다. 왼쪽으로 20px 끌면 그만큼 좁아진다.
  await page.setViewportSize({ width: 900, height: 800 });
  const narrow = await settled(page);
  expect(narrow.sidebar, JSON.stringify(narrow)).toBeLessThan(400);
  const sideHandle = (await page.locator("aside").first().locator(HANDLE).boundingBox())!;
  const sy = sideHandle.y + sideHandle.height / 2;
  await page.mouse.move(narrow.sidebar - 2, sy);
  await page.mouse.down();
  await page.mouse.move(narrow.sidebar - 12, sy, { steps: 3 });
  await page.mouse.move(narrow.sidebar - 22, sy, { steps: 3 });
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

  const handle = (await page.locator("aside").nth(1).locator(HANDLE).boundingBox())!;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(before.panel!.left + 2, y);
  await page.mouse.down();
  await page.mouse.move(before.panel!.left + 3, y);
  await page.mouse.move(before.panel!.left + 4, y);
  await page.mouse.up();

  expect(await page.evaluate(() => localStorage.getItem("work-panel-width"))).toBe("560");
  await page.setViewportSize({ width: 1920, height: 800 });
  expect((await settled(page)).panel!.width).toBe(560);
});

test("좁게 선 패널·사이드바를 바깥으로 끌어도 고른 폭이 안 지워진다", async ({ page }) => {
  // 좁게 선 패널은 탭 줄의 바닥에 막혀 **더 넓게 못 선다** — 바깥으로 끌면 화면은 그대로다. 그런데 그
  // 끌기를 폭으로 치면 떼는 순간 「그려진 폭 + 끈 거리」가 사람이 고른 폭(저장값)을 덮어, 창을 넓혀도
  // 고른 폭이 안 돌아온다. 사람은 넓히려 했는데 결과는 좁힌 셈이다.
  await openWith(page, `/works/${plainWork.slug}?tab=terminal`, 900, { sidebar: 400, panel: 560 });
  await page.locator('[data-tab="shell"]').first().waitFor();
  const before = await settled(page);
  expect(before.panel!.width, JSON.stringify(before)).toBeLessThan(560 - 40);
  expect(before.sidebar, JSON.stringify(before)).toBeLessThan(400 - 40);

  // 작업 패널 — 핸들이 왼쪽 가장자리라 바깥은 왼쪽이다.
  const panelHandle = (await page.locator("aside").nth(1).locator(HANDLE).boundingBox())!;
  const y = panelHandle.y + panelHandle.height / 2;
  await page.mouse.move(before.panel!.left + 2, y);
  await page.mouse.down();
  await page.mouse.move(before.panel!.left - 38, y, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem("work-panel-width"))).toBe("560");

  // 사이드바 — 핸들이 오른쪽 가장자리라 바깥은 오른쪽이다.
  const sideHandle = (await page.locator("aside").first().locator(HANDLE).boundingBox())!;
  const sy = sideHandle.y + sideHandle.height / 2;
  await page.mouse.move(before.sidebar - 2, sy);
  await page.mouse.down();
  await page.mouse.move(before.sidebar + 38, sy, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem("sidebar-width"))).toBe("400");

  await page.setViewportSize({ width: 1920, height: 800 });
  const wide = await settled(page);
  expect({ sidebar: wide.sidebar, panel: wide.panel!.width }).toEqual({ sidebar: 400, panel: 560 });
});

test("작업 패널·사이드바를 접고 펴도 안쪽 열이 되흐르지 않고, 900px에서는 편 뒤 창 안에 선다", async ({ page }) => {
  // 패널이 자리를 내주게 되면서 안쪽 열이 고정 폭만 들 수 없게 됐다 — 좁게 서면 오른쪽이 잘린다.
  // 그래도 **접히는 동안에는** 고정 폭을 든다(WorkPanel 안쪽 열 주석) — 그 동안 안쪽 폭이
  // 바깥 폭을 따라가면 글과 `×`가 폭과 함께 되흐른다.
  await openWith(page, `/works/${plainWork.slug}?tab=terminal`, 1280, { sidebar: 280, panel: 330 });
  await page.locator('[data-tab="shell"]').first().waitFor();
  await settled(page);

  const innerWidths = (which = 1) =>
    page.evaluate(async (at) => {
      const inner = document.querySelectorAll("aside")[at].firstElementChild as HTMLElement;
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
  // 사이드바 안쪽 열도 같다(⌘B) — 경계선 밑 1px까지 저장한 폭 그대로다.
  await settled(page);
  await page.keyboard.press("Meta+b");
  expect(await innerWidths(0)).toEqual([280]);
  await page.keyboard.press("Meta+b");
  expect(await innerWidths(0)).toEqual([280]);

  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByRole("button", { name: /패널 접기$/ }).click();
  await settled(page);
  await page.getByRole("button", { name: /패널 펼치기$/ }).click();
  const opened = await settled(page);
  expectFits(opened, "900px 편 뒤");
  expect(opened.panel!.width).toBeLessThan(330);
});

test("분할을 켠 채 900px에서 패널을 펴도 칸이 남고 두 열이 창 안이다", async ({ page }) => {
  // 분할은 머리행이 두 열 **위**에 한 번 서는 다른 갈래다(`WorksPage`의 `body`) — 바닥이 그 상자에도
  // 걸려야 한다. 분할을 켜면 패널이 접히므로(결정 106) 다시 펴서 가장 붐비는 배치를 만든다.
  await openWith(page, `/works/${pinnedWork.slug}?tab=terminal`, 900, { sidebar: 280, panel: 330 });
  const tabs = page.locator('[data-tab="shell"]');
  await tabs.first().waitFor();
  await openShell(page);
  await page.getByRole("button", { name: "분할", exact: true }).click();
  await expect(page.locator("[data-column]")).toHaveCount(2);
  await page.getByRole("button", { name: /패널 펼치기$/ }).click();

  const layout = await settled(page);
  expectFits(layout, "분할 900px");
  const row = await rowOf(page);
  expect(row.spill).toBeLessThanOrEqual(0);
  expect(row.actions.over).toBeLessThanOrEqual(0);
  const columnsRight = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll("[data-column]")].map((column) => column.getBoundingClientRect().right)),
  );
  expect(columnsRight).toBeLessThanOrEqual(layout.panel!.left + 0.5);
});

test("본문 문서가 창보다 넓어도 탭 줄의 바닥이 부풀지 않는다 — 패널이 제자리다", async ({ page }) => {
  // 본문 열에는 끊을 자리 없는 코드 줄·넓은 표도 산다. 그 폭이 열의 바닥에 섞이면 소스 보기를
  // 켤 때마다 패널이 창 밖으로 밀리고 폭이 저 혼자 바뀐 것처럼 보인다(WorksPage 행 주석의 실측).
  await openWith(page, `/works/${pinnedWork.slug}?file=${encodeURIComponent("overview.md")}`, 900, {
    sidebar: 280,
    panel: 330,
  });
  await expect(page.getByRole("heading", { name: "개요" })).toBeVisible();
  const plain = await settled(page);
  expectFits(plain, "좁은 문서");

  await page.goto(`/works/${multiWork.slug}?file=${encodeURIComponent("넓은.md")}`);
  await expect(page.getByRole("heading", { name: "넓은 문서" })).toBeVisible();
  const wide = await settled(page);
  expectFits(wide, "넓은 문서");
  expect(wide.panel).toEqual(plain.panel);

  // 원문 보기 — 줄바꿈 없는 코드뷰다.
  await page.getByRole("button", { name: "원문 보기" }).first().click();
  const source = await settled(page);
  expectFits(source, "넓은 문서 원문");
  expect(source.panel).toEqual(plain.panel);
});

test("목록 패널이 있는 화면은 그대로다 — 사이드바가 저장한 폭으로 선다", async ({ page }) => {
  // 사이드바가 줄어들 수 있게 됐지만, 자리를 요구하는 것은 탭 줄을 이는 열뿐이다. 다른 화면의
  // 본문은 바닥이 없어(`min-w-0`) 사이드바가 900px 창에서도 고른 폭을 든다.
  //
  // (창 전체의 가로 넘침은 여기서 안 든다 — 이 배치에서는 이 수정 전부터 41px이 넘친다. 목록
  // 화면의 몫이라 이 검사가 그 사실을 초록이나 빨강으로 삼키지 않게 둔다.)
  await openWith(page, "/projects", 900, { sidebar: 400, panel: 330 });
  await expect(page.getByRole("button", { name: "프로젝트 등록" })).toBeVisible();
  const layout = await settled(page);
  expect(layout.sidebar).toBe(400);
});
