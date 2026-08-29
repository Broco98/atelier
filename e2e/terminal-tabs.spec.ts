import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 판 03 — `/terminal`의 머리행도 **같은 탭 줄**이다(결정 8 · adr-03). **이 층에서만 보이는
// 것 둘이다**: 키 이벤트(정적 마크업 seam에는 이벤트가 없어 이펙트가 아예 안 돈다)와,
// 화면에 실제로 보이는 순서와 ⌘1이 고르는 것이 같은가.
//
// **마크업 seam(TerminalPage.test.tsx)이 보는 것은 여기서 다시 안 본다** — `spec` 칸이
// 없는지, 무엇이 어느 순서로 서는지, 창 드래그 영역이 있는지는 그쪽이 든다. 여기서 그것을
// 한 번 더 확인하는 것은 「줄이 실제로 섰다」를 이 검사가 딛고 서기 위해서다: 안 서 있으면
// 아래 키 단언이 「고를 칸이 없어서」 초록이 될 수 있다.
//
// 픽스처 백엔드가 `pty_spawn`을 답해 xterm이 실제로 뜬다(terminal-fill.spec.ts가 선례다).

test("⌘1이 탭 줄에 보이는 첫 칸을 고른다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");

  // 들어오면 셸 하나가 뜬다(`ensureShell`) — 그 칸이 곧 탭 줄의 첫 칸이다.
  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  // **이 화면에는 `spec` 칸이 없다**(결정 8). 그래서 ⌘1부터가 셸이고, 화면마다 갈리는 것이
  // `firstKey` 하나라는 성질이 여기서 실물로 선다.
  await expect(page.locator('[data-tab="spec"]')).toHaveCount(0);

  // 탭 줄의 `+`로 한 칸 더 연다. **표식으로 집는다** — 「셸 열기」 버튼은 이 화면에 둘이다
  // (사이드바 가지에도 하나 있다). 이름으로 집으면 판 04가 사이드바를
  // 손대는 날 이 검사가 엉뚱한 자리에서 실패한다.
  await page.locator('[data-tab="new"]').click();
  await expect(tabs).toHaveCount(2);
  // 새로 연 칸이 켜진 칸이다 — 여기가 안 서면 아래 ⌘1은 「원래 첫 칸이 켜져 있어서」 초록이다.
  const lit = (at: number) => tabs.nth(at).locator("button[aria-pressed]");
  await expect(lit(1)).toHaveAttribute("aria-pressed", "true");

  // ⌘1이 **첫 칸**으로 돌아온다. work 화면이라면 그 자리가 `spec`이라 셸이 안 바뀐다.
  await page.keyboard.press("Meta+1");
  await expect(lit(0)).toHaveAttribute("aria-pressed", "true");
  await expect(lit(1)).toHaveAttribute("aria-pressed", "false");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 티켓 #143: 좁은 창에서 탭이 **균등하게** 줄어들고, 바닥에 닿으면 스크롤한다(결정 11·20) ───
//
// **이 층이 아니면 아무것도 안 보인다.** 마크업 seam이 드는 것은 클래스 문자열뿐이고
// (`ShellTabs.test.tsx`), 이 판의 물음은 전부 실측이다: 한 줄로 남았나 · 넘쳤나 · 칸이
// 고르게 줄었나 · 로고가 남았나 · 오른쪽 끝 조작이 안 잘렸나.
//
// **work 화면에서 잰다.** `/terminal`에는 오른쪽 끝 조작이 없어(결정 10) 거기서는 이 줄이
// 가장 붐비는 모습을 못 만든다 — 줄 자체는 두 화면이 같은 것을 쓰므로(결정 8) 붐비는 쪽에서
// 재는 것이 둘 다를 잰다.

const [, plainWork] = WORKS;

/** 셸 상한(결정 30). `shell-registry`의 `MAX_SHELLS`와 같은 수다 — 이 줄이 가장 붐비는 폭이다. */
const MAX_SHELLS = 8;

/** 픽스처의 `pty_spawn`이 주는 셸 이름. 이 work은 워크트리가 없어 앞에 프로젝트가 안 붙는다(결정 18). */
const SHELL_NAME = "zsh";

/**
 * 한 칸에서 **명령이 돌게 만든다.** 백엔드가 1초마다 쏘는 `pty:running`을 손으로 한 번
 * 쏘는 것이다(adr-04) — 픽스처 백엔드는 커맨드에만 답하지 이벤트를 쏘지 않는다.
 *
 * 구독 id는 하네스가 적어 둔 IPC 기록에서 읽는다. **상수로 적을 수 없다** — `transformCallback`이
 * 난수로 짓는다. 못 찾으면 던진다: 구독이 안 걸린 채로 지나가면 아래 「로고가 남는다」가
 * **로고가 아예 없어서** 초록이 된다.
 *
 * 픽스처의 `pty_spawn`이 늘 같은 pty id(1)를 주므로 값이 앉는 칸은 **맨 앞 칸 하나**다
 * (`shellOfPty`가 먼저 찾은 인스턴스를 준다).
 */
async function markRunning(page: Page, running: string): Promise<void> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  const listen = calls.filter((call) => call.includes('"pty:running"')).reverse()[0];
  const handler = listen && /"handler":(\d+)/.exec(listen)?.[1];
  if (!handler) throw new Error(`pty:running 구독을 못 찾았다 — IPC 기록: ${JSON.stringify(calls)}`);
  await page.evaluate(
    ([id, name]) => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
      }).__TAURI_INTERNALS__;
      internals.runCallback(Number(id), {
        event: "pty:running",
        id: 0,
        payload: [{ id: 1, running: name }],
      });
    },
    [handler, running],
  );
}

interface Row {
  width: number;
  spec: number;
  /** 줄 높이. 한 줄이면 `--titlebar-height`(44px) 그대로다 — 넘겨 접히면 커진다. */
  height: number;
  /** 줄이 제 상자 밖으로 넘친 폭. **0이어야 한다** — 넘치면 오른쪽 끝 조작이 창 밖으로 밀린다. */
  spill: number;
  /** 창 전체의 가로 넘침. 스크롤 막대가 서는 그 값이다. */
  pageSpill: number;
  /**
   * 셸 칸 상자(결정 20). `scrollWidth > clientWidth`면 **그 안에서** 스크롤이 선 것이다 —
   * 줄이 넘친 것이 아니라 넘칠 몫을 이 상자가 받아 준 것이라, 위 `spill`은 그대로 0이다.
   */
  strip: { width: number; scrollWidth: number; clientWidth: number };
  /** 셸 칸들의 폭. 이것들이 서로 같아야 「균등」이다. */
  tabs: number[];
  /** 도는 칸의 로고+스피너 — 폭과, 제 칸 밖으로 삐져나온 양. */
  mark: { width: number; over: number } | null;
  /** 오른쪽 끝 조작 — 폭과, 줄 밖으로 밀려난 양. */
  actions: { width: number; over: number };
}

/**
 * 줄을 통째로 잰다. **한 번의 evaluate로 끝낸다** — 폭을 하나씩 물어 오면 그 사이에
 * 레이아웃이 갈릴 수 있고, 실패했을 때 어느 값이 어느 순간의 것인지가 흐려진다.
 *
 * 조작 묶음은 **헤더의 마지막 자식**이다(`WorksPage.test.tsx`가 같은 자리를 그렇게 짚는다).
 */
async function rowOf(page: Page): Promise<Row> {
  return page.evaluate(() => {
    const header = document.querySelector("header")!;
    const box = header.getBoundingClientRect();
    const strip = document.querySelector("[data-tab-strip]")!;
    const cells = [...document.querySelectorAll('[data-tab="shell"]')];
    const mark = document.querySelector('[data-tab="shell"] [role="img"]');
    const markCell = mark?.closest('[data-tab="shell"]') ?? null;
    const actions = header.lastElementChild!.getBoundingClientRect();
    return {
      height: box.height,
      width: box.width,
      spec: document.querySelector('[data-tab="spec"]')?.getBoundingClientRect().width ?? 0,
      spill: header.scrollWidth - header.clientWidth,
      pageSpill: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      strip: {
        width: strip.getBoundingClientRect().width,
        scrollWidth: strip.scrollWidth,
        clientWidth: strip.clientWidth,
      },
      tabs: cells.map((cell) => cell.getBoundingClientRect().width),
      mark:
        mark && markCell
          ? {
              width: mark.getBoundingClientRect().width,
              over: mark.getBoundingClientRect().right - markCell.getBoundingClientRect().right,
            }
          : null,
      actions: { width: actions.width, over: actions.right - box.right },
    };
  });
}

/** 상한까지 셸을 채운다. `+`가 잠기는 것이 「정말 8칸이다」의 관찰 가능한 형태다(결정 30). */
async function fillToCap(page: Page): Promise<void> {
  const tabs = page.locator('[data-tab="shell"]');
  // 이미 몇 칸이 서 있어도 상관없이 상한까지 채운다 — 부르는 자리마다 시작 칸 수가 다르다.
  await tabs.first().waitFor();
  const plus = page.locator('[data-tab="new"]');
  for (let n = await tabs.count(); n < MAX_SHELLS; n += 1) {
    await plus.click();
    await expect(tabs).toHaveCount(n + 1);
  }
  await expect(plus).toHaveAttribute("aria-disabled", "true");
}

test("창을 좁혀도 줄이 안 넘치고 칸이 고르게 줄어든다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // 이 줄이 가장 붐비는 모습이 곧 이 티켓의 물음이다.
  await fillToCap(page);

  await markRunning(page, "claude");
  const running = page.locator('[data-tab="shell"] [role="img"]');
  await expect(running).toHaveCount(1);

  const actionsWidth: Record<number, number> = {};
  const rows: Record<number, Row> = {};

  // 1280은 실물 기본 창, 900은 **창이 작아질 수 있는 끝**(tauri.conf의 `minWidth`),
  // 1120은 그 사이 — 칸이 최소 폭에 닿아 스크롤은 섰지만 상자에 한 칸은 온전히 들어가는 폭이다.
  //
  // **줄이 받는 폭은 창 폭이 아니다.** 창에서 사이드바(280)와 작업 패널(330)을 뺀 나머지라
  // 900px 창에서 290px뿐이고, 그래서 여덟 칸이 어떤 최소 폭으로도 안 들어간다 — 결정 20이
  // 「그 아래는 스크롤」로 답한 자리다.
  for (const width of [1280, 1120, 900]) {
    await page.setViewportSize({ width, height: 800 });
    // **xterm이 새 폭에 다시 맞을 때까지 기다린다.** 줄과 무관한 값이다 — FitAddon이
    // ResizeObserver로 도는 사이에는 캔버스가 옛 폭 그대로라 창 밖으로 나가 있고, 창 전체의
    // 가로 넘침이 그동안만 참이다. 여기서 안 기다리면 아래 `pageSpill`이 그것을 잡는다.
    await expect
      .poll(async () => (await rowOf(page)).pageSpill, { timeout: 5000 })
      .toBeLessThanOrEqual(0);
    const row = await rowOf(page);
    const at = `${width}px`;
    rows[width] = row;
    console.log(at, JSON.stringify(row));

    // 한 줄이다 — 넘겨 접히면 높이가 늘어난다.
    expect(row.height, at).toBe(44);
    // **머리행은 넘치지 않는다.** 넘치는 몫은 셸 칸 상자가 받는다(결정 20) — 이 값이
    // 0보다 크면 오른쪽 끝 조작이 창 밖으로 밀려난 그림이다(고치기 전 900px에서 380이었다).
    expect(row.spill, at).toBeLessThanOrEqual(0);
    expect(row.pageSpill, at).toBeLessThanOrEqual(0);

    // **균등하게** 줄어든다 — 하나만 찌그러지면 안 된다. 로고가 도는 칸이 그만큼 넓어지는
    // 것도 여기서 걸린다(칸 폭을 내용이 정하면 도는 칸만 넓다).
    expect(Math.max(...row.tabs) - Math.min(...row.tabs), at).toBeLessThanOrEqual(1);
    expect(row.tabs, at).toHaveLength(MAX_SHELLS);

    // **로고와 스피너는 끝까지 남는다** — 이 판이 사려는 것이 「무엇이 도나」다.
    expect(row.mark, at).not.toBeNull();
    expect(row.mark!.width, at).toBeGreaterThan(20);
    // 남아 있기만 하면 안 된다 — 제 칸을 넘어 옆 칸 위에 그려지면 그것도 잘린 것이다.
    expect(row.mark!.over, at).toBeLessThanOrEqual(0);

    // 오른쪽 끝 조작은 고정된 채다(결정 10) — 밀려나지도 좁아지지도 않는다.
    expect(row.actions.over, at).toBeLessThanOrEqual(0);
    actionsWidth[width] = row.actions.width;
  }

  // 조작 묶음의 폭이 세 폭에서 모두 같다 — 좁아진다고 눌리지 않는다.
  expect(actionsWidth[900]).toBe(actionsWidth[1280]);
  expect(actionsWidth[1120]).toBe(actionsWidth[1280]);

  // 좁힐수록 상자가 좁아지는데 칸은 이미 바닥이라, 스크롤로 넘어가는 몫이 커진다.
  // **줄이 넘친 것이 아니다** — 위에서 세 폭 모두 `spill`이 0이었다.
  expect(rows[900].strip.clientWidth).toBeLessThan(rows[1120].strip.clientWidth);
  expect(rows[1120].strip.clientWidth).toBeLessThan(rows[1280].strip.clientWidth);
  for (const width of [1280, 1120, 900]) {
    expect(rows[width].strip.scrollWidth, `${width}px`).toBeGreaterThan(rows[width].strip.clientWidth);
  }

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("스크롤이 선 줄에서도 ⌘로 고른 칸이 보이는 자리로 온다", async ({ page }) => {
  // 결정 20이 만든 빚이다 — 안 보이는 칸이 생기면 ⌘1~9가 그 칸을 고를 수 있고, 그러면
  // 「눌렀는데 아무 일도 없다」로 읽힌다. 키는 폭을 모르므로 줄이 끌어와야 한다.
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1120, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await fillToCap(page);

  const strip = page.locator("[data-tab-strip]");
  const tabs = page.locator('[data-tab="shell"]');
  const last = tabs.nth(MAX_SHELLS - 1);

  const inside = async () => {
    const cell = (await last.boundingBox())!;
    const box = (await strip.boundingBox())!;
    return cell.x >= box.x - 1 && cell.x + cell.width <= box.x + box.width + 1;
  };

  // ⌘2가 첫 셸이다(⌘1은 spec — 결정 78·79). 줄이 맨 앞으로 돌아가면 마지막 칸은 밖이다.
  // **이 단언이 없으면 아래가 「원래 보이고 있어서」 초록이 된다.**
  await page.keyboard.press("Meta+2");
  await expect.poll(inside).toBe(false);

  // ⌘9가 여덟째 셸이다. 고른 칸이 상자 안으로 들어온다.
  await page.keyboard.press("Meta+9");
  await expect.poll(inside).toBe(true);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("칸이 늘수록 이름이 먼저 줄고 아이콘만 남는다", async ({ page }) => {
  // 결정 11의 **순서**다 — 이름이 말줄임으로 줄다가, 몇 글자도 못 세우는 폭에서 자리를
  // 비운다. 창 폭이 아니라 **칸 수**로 폭을 미는 것은 그 사이에 사이드바·패널 폭이
  // 끼지 않아서다 — 재는 것은 같은 한 가지(칸 하나의 폭)다.
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  const plus = page.locator('[data-tab="new"]');
  const name = tabs.first().getByText(SHELL_NAME, { exact: true });

  await expect(tabs).toHaveCount(1);
  await plus.click();
  await plus.click();
  await expect(tabs).toHaveCount(3);
  // 셋일 때는 이름이 보인다.
  expect((await name.boundingBox())!.width).toBeGreaterThan(10);
  // **그리고 그때는 스크롤이 없다** — 스크롤은 칸이 바닥에 닿은 뒤의 마지막 수단이지
  // 늘 서 있는 것이 아니라는 것이 이 한 줄이다(결정 20).
  const room = await rowOf(page);
  expect(room.strip.scrollWidth).toBeLessThanOrEqual(room.strip.clientWidth + 1);
  expect(Math.min(...room.tabs)).toBeGreaterThan(44);

  await fillToCap(page);
  // 여덟이면 칸이 최소 폭이라 이름이 자리를 비운다. **요소는 남는다** — `sr-only`라서
  // 스크린리더에는 그대로 불린다(이름 버튼의 접근성 이름이 이 글자 하나다).
  expect((await name.boundingBox())!.width).toBeLessThanOrEqual(1);
  await expect(name).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
