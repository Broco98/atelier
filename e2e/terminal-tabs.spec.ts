import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import { fillToCap, MAX_SHELLS, rowOf, settle, squeezedWidth, widenSidebar } from "./tab-row";
import type { Row } from "./tab-row";
import {
  awaitSpawned,
  callCount,
  fireWindowEvent,
  holdTerminalFonts,
  installFixtureBackend,
  markAttention,
  markRunning,
  openShell,
  setWindowFocused,
  stubWindowFocus,
  토큰값,
  토큰색,
  unknownIpcCalls,
  writeShell,
  파일탭주소,
  주소로간다,
} from "./harness";

// 판 03 — `/terminal`의 카드 머리도 work 화면과 **같은 탭 줄**이다(결정 8 · adr-03). **이 층에서만 보이는
// 것 둘이다**: 키 이벤트(정적 마크업 seam에는 이벤트가 없어 이펙트가 아예 안 돈다)와,
// 화면에 실제로 보이는 순서와 ⌘1이 고르는 것이 같은가.
//
// **마크업 seam(TerminalPage.test.tsx)이 보는 것은 여기서 다시 안 본다** — `spec` 칸이
// 없는지, 무엇이 어느 순서로 서는지, 창 드래그 영역이 있는지는 그쪽이 든다. 여기서 그것을
// 한 번 더 확인하는 것은 「줄이 실제로 섰다」를 이 검사가 딛고 서기 위해서다: 안 서 있으면
// 아래 키 단언이 「고를 칸이 없어서」 초록이 될 수 있다.
//
// 픽스처 백엔드가 `pty_spawn`을 답해 xterm이 실제로 뜬다(terminal-fill.spec.ts가 선례다).

const [fileWork, plainWork] = WORKS;

test("⌘1이 탭 줄에 보이는 첫 칸을 고른다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");

  // 들어오면 셸 하나가 뜬다(`ensureShell`) — 그 칸이 곧 탭 줄의 첫 칸이다.
  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  // **이 화면에는 `spec` 칸이 없다**(결정 8). 그래서 ⌘1부터가 셸이고, 화면마다 갈리는 것이
  // `firstKey` 하나라는 성질이 여기서 실물로 선다.
  await expect(page.locator('[data-tab="spec"]')).toHaveCount(0);

  // 탭 줄의 `+`로 한 칸 더 연다. **표식으로 집는다** — 한때 「셸 열기」 버튼이 이 화면에
  // 둘이었고(사이드바 가지에도 하나), 이름으로 집던 검사가 판 04가 그 가지를 걷는 날
  // 엉뚱한 자리에서 깨질 뻔했다. 표식은 그 왕복을 그대로 견뎠다.
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

// ─── codex-ds 티켓 12: 탭 줄이 **본문 카드의 머리**다(codex-ds 스펙 §4 「탭 줄」 · DS `TabRow`) ───
//
// 한때 창 맨 위 줄(`<header>` — 지금의 머리 줄)에 서던 줄이 그 탭이 보여 줄 카드 안 맨 위로 내려왔다. 문서 카드 · 터미널 카드 · 분할의
// 터미널 열 · `/terminal`의 카드가 같은 머리를 쓴다 — 높이는 `size-toolbar`(46)이고 아래에 0.5px `border-heavy` 선이 서며, 켜진
// 탭은 28 높이의 옅은 면(`fill-hover`)이다. 머리 줄에는 탭이 하나도 없다.
//
// 줄은 `data-tab-strip`으로 집는다(codex-ds 스펙 §11) — 그 상자를 든 머리가 탭 줄이다. 카드는 머리의 부모이고 카드 표식
// (`data-slot="card"`)을 든다. 분할이면 그 카드가 터미널 열이고, 아니면 본문 카드(`<main>`) 자신이다.
const CARD_HEADS = [
  { name: "work 화면 터미널", url: `/works/${plainWork.slug}?tab=terminal`, column: false },
  { name: "work 화면 문서", url: `/works/${plainWork.slug}`, column: false },
  { name: "work 화면 분할", url: `/works/${plainWork.slug}?split=lr`, column: true },
  { name: "`/terminal`", url: "/terminal", column: false },
] as const;

for (const screen of CARD_HEADS) {
  test(`${screen.name}: 탭 줄이 본문 카드 안 맨 위의 46 줄이고 아래에 0.5px 선이 선다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const strip = page.locator("[data-tab-strip]");
    await expect(strip).toHaveCount(1);
    // 셸 칸이 하나는 서야 「켜진 탭」을 잰다 — 문서 본문에서는 `spec` 칸이 켜진 탭이다.
    if (screen.url.includes("tab=terminal") || screen.url === "/terminal") {
      await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
    }
    await expect(page.locator('[data-tab][aria-pressed="true"], [data-tab] [aria-pressed="true"]').first()).toBeVisible();

    const 줄 = await strip.evaluate((el) => {
      const row = el.parentElement!;
      const card = row.parentElement!;
      const box = row.getBoundingClientRect();
      const edge = card.getBoundingClientRect();
      const line = getComputedStyle(row, "::after");
      const on = row.querySelector<HTMLElement>('[data-tab="spec"][aria-pressed="true"], [data-tab="shell"]:has([aria-pressed="true"])')!;
      return {
        카드: card.getAttribute("data-slot"),
        본문: card.tagName === "MAIN",
        열: row.getAttribute("data-column"),
        위: box.top - edge.top,
        왼쪽: box.left - edge.left,
        오른쪽: edge.right - box.right,
        높이: box.height,
        안쪽: getComputedStyle(row).paddingLeft,
        선: { 높이: line.height, 아래: line.bottom, 색: line.backgroundColor },
        켜진탭: { 높이: on.getBoundingClientRect().height, 면: getComputedStyle(on).backgroundColor, 반경: getComputedStyle(on).borderTopLeftRadius },
        머리줄탭: document.querySelectorAll("header [data-tab]").length,
      };
    });
    const at = `${screen.name} ${JSON.stringify(줄)}`;
    // 줄의 부모가 카드다 — 분할이면 터미널 열의 카드이고, 아니면 본문 카드(`<main>`)다.
    expect(줄.카드, at).toBe("card");
    expect(줄.본문, at).toBe(!screen.column);
    expect(줄.열, at).toBe(screen.column ? "terminal" : null);
    // 카드 안 맨 위에서 카드 폭 그대로 선다.
    expect([줄.위, 줄.왼쪽, 줄.오른쪽], at).toEqual([0, 0, 0]);
    // 높이는 토큰에서 읽고(`size-toolbar`), DS가 못박은 수(46)도 따로 센다 — 토큰이 바뀌는 날 견줌이 함께 흘러가지 않게.
    expect(`${줄.높이}px`, at).toBe(await 토큰값(page, "height", "--size-toolbar"));
    expect(줄.높이, at).toBe(46);
    // 안쪽 8 — DS `.at-toolbar`.
    expect(줄.안쪽, at).toBe("8px");
    // 아래 0.5px 선은 `border-heavy` 면이고 줄 바닥에 붙는다(줄 높이 안이다).
    expect(줄.선, at).toEqual({ 높이: "0.5px", 아래: "0px", 색: await 토큰색(page, "--border-heavy") });
    // 켜진 탭 — 28 높이 · `radius-lg` · 옅은 면 `fill-hover`(DS `.at-tab.is-on`).
    expect(줄.켜진탭, at).toEqual({
      높이: 28,
      면: await 토큰색(page, "--fill-hover"),
      반경: await 토큰값(page, "border-top-left-radius", "--radius-lg"),
    });
    // 머리 줄에는 탭이 없다.
    expect(줄.머리줄탭, at).toBe(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

/** 탭 칸 하나의 글자색과 그 칸 글리프의 색. 셸 칸은 이름 글자를 읽는다 — 넓은 칸에는 글리프가 없다(결정 27). */
const 칸색 = (page: Page, kind: "spec" | "shell") =>
  page.locator(`[data-tab="${kind}"]`).first().evaluate((cell, which) => {
    const 글자 = which === "spec" ? cell : cell.querySelector("button[aria-pressed] span:not([role])")!;
    const 글리프 = cell.querySelector("svg");
    return { 글자: getComputedStyle(글자).color, 글리프: 글리프 && getComputedStyle(글리프).color };
  }, kind);

// **글자색도 DS `.at-tab`이다**(codex-ds 결정 27 — Codex가 바탕이고, 사용자가 탭 글자색을 따로 부탁하지 않았다). 꺼진 칸은
// `fg-secondary`, 켜진 칸과 가리킨 칸은 `fg`이고, 칸의 글리프는 한 단 흐리다(꺼짐 `fg-tertiary` · 켜짐 `fg-secondary`). 한때 글자가
// 켜짐과 무관하게 `fg`였다(ui-refresh 결정 18의 값 — codex-ds 결정 3이 대체했다).
test("켜진 탭 글자는 fg, 꺼진 탭은 fg-secondary이고 가리키면 fg다 — 글리프는 한 단 흐리다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
  const [fg, secondary, tertiary] = [
    await 토큰색(page, "--fg"),
    await 토큰색(page, "--fg-secondary"),
    await 토큰색(page, "--fg-tertiary"),
  ];
  // 앵커: 세 단이 서로 다르다 — 같으면 아래 견줌이 무엇을 재는지 흐려진다.
  expect(new Set([fg, secondary, tertiary]).size).toBe(3);

  // 터미널 본문 — 셸 칸이 켜졌고 `spec` 칸이 꺼졌다. 칸에 `transition-colors`가 걸려 있어 폴링으로 견준다.
  await expect.poll(() => 칸색(page, "spec")).toEqual({ 글자: secondary, 글리프: tertiary });
  await expect.poll(async () => (await 칸색(page, "shell")).글자).toBe(fg);

  // 꺼진 칸을 가리키면 글자가 `fg`다(DS `.at-tab:hover`).
  await page.locator('[data-tab="spec"]').hover();
  await expect.poll(async () => (await 칸색(page, "spec")).글자).toBe(fg);

  // 문서 본문 — 켜짐이 `spec` 칸으로 옮겨 간다. 포인터를 줄 밖으로 빼 hover가 견줌에 끼지 않게 한다.
  await page.locator('[data-tab="spec"]').click();
  await page.mouse.move(0, 400);
  await expect.poll(() => 칸색(page, "spec")).toEqual({ 글자: fg, 글리프: secondary });
  await expect.poll(async () => (await 칸색(page, "shell")).글자).toBe(secondary);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **문서 ↔ 터미널을 오가도 본문 카드와 그 머리의 탭 줄이 그대로다**(`Frame`의 `Card` — 흰 카드와 터미널 카드가 한 컴포넌트다).
// 둘이 다른 컴포넌트이거나 카드에 `key`가 붙으면 오갈 때마다 카드와 줄이 새로 서서, 방금 누른 `spec` 칸의 포커스와 줄의 가로
// 스크롤을 잃는다 — 화면으로는 「눌렀더니 포커스가 사라졌다 · 줄이 맨 앞으로 튀었다」로만 보인다. 요소 자신이 같은지를 재고(새로
// 서면 붙여 둔 표지가 사라진다), 사람이 겪는 두 결과(포커스 · 스크롤)를 함께 잰다.
test("문서 ↔ 터미널을 오가도 본문 카드와 탭 줄이 새로 서지 않는다 — 누른 칸의 포커스와 줄의 스크롤이 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await fillToCap(page);
  await settleStrip(page);

  // 표지를 붙인다 — 요소가 새로 서면 표지가 없는 새 요소가 그 자리에 선다.
  const 표지 = () =>
    page.evaluate(() => {
      const row = document.querySelector("[data-tab-row]") as (Element & { 표지?: true }) | null;
      const card = row?.parentElement as (Element & { 표지?: true }) | null | undefined;
      return { 줄: row?.표지 === true, 카드: card?.표지 === true };
    });
  await page.evaluate(() => {
    const row = document.querySelector("[data-tab-row]") as Element & { 표지?: true };
    row.표지 = true;
    (row.parentElement as Element & { 표지?: true }).표지 = true;
  });

  // 줄이 스크롤한다 — 900px 창에서 여덟 칸은 상자에 다 안 든다. 맨 끝으로 굴려 둔다.
  const strip = page.locator("[data-tab-strip]");
  const scrolled = await strip.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  // 앵커: 정말 굴렀다 — 0이면 아래 「스크롤이 남는다」가 「원래 0이라서」 초록이다.
  expect(scrolled).toBeGreaterThan(0);

  // 터미널 → 문서. 키보드로 누른 `spec` 칸이 포커스를 쥔 채이고, 카드와 줄은 그 요소 그대로다. 키보드로 누르는 것은 WebKit이
  // 마우스로 누른 버튼에 포커스를 안 주어서다(macOS 관례) — 포커스를 잃는 사람은 키보드로 다니는 사람이다.
  const specTab = page.locator('[data-tab="spec"]');
  await specTab.focus();
  await page.keyboard.press("Enter");
  await expect(specTab).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('main[data-tone="terminal"]')).toHaveCount(0);
  await expect(specTab).toBeFocused();
  expect(await 표지()).toEqual({ 줄: true, 카드: true });
  expect(await strip.evaluate((el) => el.scrollLeft)).toBe(scrolled);

  // 문서 → 터미널(⌘9 — 여덟째 셸). 돌아와도 같은 카드 · 같은 줄이다.
  await page.keyboard.press("Meta+9");
  await expect(page.locator('[data-tab="shell"]').last().locator("button[aria-pressed]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('main[data-tone="terminal"]')).toHaveCount(1);
  expect(await 표지()).toEqual({ 줄: true, 카드: true });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 티켓 #143: 좁은 창에서 탭이 **균등하게** 줄어들고, 바닥에 닿으면 스크롤한다(결정 11·20) ───
//
// **이 층이 아니면 아무것도 안 보인다.** 마크업 seam이 드는 것은 클래스 문자열뿐이고
// (`ShellTabs.test.tsx`), 이 판의 물음은 전부 실측이다: 한 줄로 남았나 · 넘쳤나 · 칸이
// 고르게 줄었나 · 로고가 남았나 · `+`가 줄 안에 남았나 · 머리 줄의 할 일이 안 밀리고 안 눌렸나.
//
// **work 화면에서 잰다.** `/terminal`에는 `spec` 칸이 없어(결정 8) 거기서는 이 줄이 가장 붐비는
// 모습을 못 만든다 — 줄 자체는 두 화면이 같은 것을 쓰므로 붐비는 쪽에서 재는 것이 둘 다를 잰다.
// 줄 끝 조작(`data-tab-actions`)은 분할의 터미널 열에만 서고(그 열을 닫는 `×`), 그 줄은
// `tab-row-floor.spec.ts`의 분할 검사가 잰다. 상태 · ⋯ · 분할은 머리 줄 오른쪽 끝(`data-head-actions`)에
// 서고, 줄과 같은 순간에 잰다(`rowOf`의 `workActions`) — 줄이 바닥에 닿는 폭이 곧 그 조작이 밀릴 수 있는 폭이다.

/** 이 work은 워크트리가 없어 픽스처의 셸 이름 앞에 프로젝트가 안 붙는다(결정 18). */
const SHELL_NAME = FIXTURE_SHELL_NAME;

/**
 * **칸 상자 폭이 멈출 때까지 기다린다** — 패널·사이드바가 220ms 트랜지션으로 접히는 동안이나
 * 창 폭이 바뀐 직후에 잰 상자 폭은 곧 낡는다. 규칙은 세 스펙이 함께 쓰는 `settle` 하나다.
 */
async function settleStrip(page: Page): Promise<void> {
  await settle(page, async () => (await rowOf(page)).strip.clientWidth);
}

/**
 * `+`의 가로 자리와, 그 양옆(칸 상자의 오른쪽 끝 · 조작 묶음의 왼쪽 끝). 칸 상자의 끝은 **줄에서 차지하는 자리**의 끝이다 —
 * 상자는 포커스 링이 설 자리(`focus-ring-room`)를 두고 같은 만큼 바깥으로 물러나 있어, 테두리가 그 자리보다 양옆 4px씩 크다.
 */
async function plusOf(page: Page) {
  return page.evaluate(() => {
    const plus = document.querySelector('[data-tab="new"]')!.getBoundingClientRect();
    const stripBox = document.querySelector("[data-tab-strip]")!;
    const strip = stripBox.getBoundingClientRect();
    const row = stripBox.parentElement!;
    const actions = row.querySelector(":scope > [data-tab-actions]")?.getBoundingClientRect();
    return {
      left: plus.left,
      right: plus.right,
      stripRight: strip.right + parseFloat(getComputedStyle(stripBox).marginRight),
      // `+`의 왼쪽 끝을 누르면 `+`가 받는가 — 칸 상자의 링 자리(테두리)가 그 위에 걸쳐 있다(`ShellTabs`의 `PlusButton` 주석).
      edgeHit:
        document.elementFromPoint(plus.left + 0.5, plus.top + plus.height / 2)?.closest('[data-tab="new"]') !== null,
      // 조작이 없는 줄(분할의 터미널 열 말고 모두)에서는 줄의 안쪽 오른쪽 끝(안쪽 여백 앞)이 그 자리다.
      actionsLeft:
        actions?.left ?? row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight),
    };
  });
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

  const rows: Record<number, Row> = {};
  const workActionsWidth: Record<number, number> = {};

  // 1280은 실물 기본 창, 900은 **창이 작아질 수 있는 끝**(tauri.conf의 `minWidth`), 1120은 그 사이다.
  //
  // **줄이 받는 폭은 창 폭이 아니다.** 줄을 머리에 인 본문 카드의 폭이라 창에서 사이드바 · 열린 작업 패널을 뺀 나머지다
  // (codex-ds 스펙 §4 — 레일 열(`spec` · `files`)도 선다). 1280에서는 여덟 칸이 이름을 숨긴 폭으로 다 들어가고, 1120 · 900에서는 어떤 최소 폭으로도
  // 안 들어간다 — 결정 20이 「그 아래는 스크롤」로 답한 자리다. 줄이 더 좁아지면 패널이 제 최소 폭까지, 그다음 사이드바가
  // 자리를 내주고 줄은 칸 하나가 보이는 데서 멈춘다(`panel-layout`의 `TAB_ROW_CARD` · `TAB_ROW_COLUMN` · `tab-row-floor`).
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

    // 한 줄이다 — 넘겨 접히면 높이가 늘어난다(카드 머리 `size-toolbar` 46).
    expect(row.height, at).toBe(46);
    // **줄은 넘치지 않는다.** 넘치는 몫은 셸 칸 상자가 받는다(결정 20) — 이 값이
    // 0보다 크면 줄 끝의 `+`가 카드 모서리 밖으로 밀려난 그림이다(고치기 전 900px에서 380이었다).
    expect(row.spill, at).toBeLessThanOrEqual(0);
    expect(row.pageSpill, at).toBeLessThanOrEqual(0);

    // **균등하게** 줄어든다 — 하나만 찌그러지면 안 된다. 로고가 도는 칸이 그만큼 넓어지는
    // 것도 여기서 걸린다(칸 폭을 내용이 정하면 도는 칸만 넓다).
    expect(Math.max(...row.tabs) - Math.min(...row.tabs), at).toBeLessThanOrEqual(1);
    expect(row.tabs, at).toHaveLength(MAX_SHELLS);

    // **로고는 끝까지 남는다** — 이 판이 사려는 것이 「무엇이 도나」다. 세 폭 모두 칸이
    // 이름을 숨기는 폭(88px 이하)이라 이름이 숨었고, 그때 서는 것이 이 글리프다(결정 27) — 넓은 폭에서는
    // 이름이 그 몫을 하므로 안 선다.
    expect(row.mark, at).not.toBeNull();
    // 글리프 하나의 규격이다(`size-3.5`). 한때 여기 스피너가 나란히 서서 30px이었다.
    expect(row.mark!.width, at).toBe(14);
    // 남아 있기만 하면 안 된다 — 제 칸을 넘어 옆 칸 위에 그려지면 그것도 잘린 것이다.
    expect(row.mark!.over, at).toBeLessThanOrEqual(0);

    // 단일 뷰의 줄에는 줄 끝 조작이 없다 — 상태 · ⋯ · 분할은 머리 줄에 선다(`WorksPage`).
    expect(row.actions, at).toBeNull();
    // **그 머리 줄 할 일은 고정된 채다**(결정 10) — 밀려나지도 좁아지지도 않는다. 탭 줄이 바닥에 닿는 폭이 곧 본문 열이 넓어지는
    // 폭이라, 줄을 지키다 조작을 창 밖으로 밀면 여기서 잡힌다(조작이 탭 줄 끝에 서던 때 900px에서 380 밀렸다).
    expect(row.workActions, at).not.toBeNull();
    expect(row.workActions!.over, at).toBeLessThanOrEqual(0);
    expect(row.workActions!.outside, at).toBeLessThanOrEqual(0);
    expect(row.workActions!.width, at).toBeGreaterThanOrEqual(row.workActions!.natural - 0.5);
    workActionsWidth[width] = row.workActions!.width;

    // 스크롤이 선 줄에서도 **칸 하나는 온전히 보이고**, 잠긴 `+`가 상자 뒤·조작 앞에 남는다 —
    // 상한에서 `+`가 사라지면 「왜 안 열리나」를 말하는 자리(`title`)도 함께 사라진다.
    expect(row.strip.clientWidth, at).toBeGreaterThanOrEqual(Math.min(...row.tabs));
    const plus = await plusOf(page);
    expect(plus.left, at).toBeGreaterThanOrEqual(plus.stripRight - 0.5);
    expect(plus.right, at).toBeLessThanOrEqual(plus.actionsLeft + 0.5);
    expect(plus.edgeHit, `${at} — \`+\`의 왼쪽 끝`).toBe(true);
  }

  // 머리 줄 할 일의 폭이 세 폭에서 모두 같다 — 좁아진다고 눌리지 않는다.
  expect(workActionsWidth[900]).toBe(workActionsWidth[1280]);
  expect(workActionsWidth[1120]).toBe(workActionsWidth[1280]);

  // 좁힐수록 상자가 좁아지고, 칸이 바닥에 닿은 폭(900)부터는 스크롤로 넘어가는 몫이 생긴다 — 그 몫은 좁힐수록
  // 줄지 않는다. **줄이 넘친 것이 아니다** — 위에서 세 폭 모두 `spill`이 0이었다.
  expect(rows[900].strip.clientWidth).toBeLessThan(rows[1120].strip.clientWidth);
  expect(rows[1120].strip.clientWidth).toBeLessThan(rows[1280].strip.clientWidth);
  const scrolled = (width: number) => rows[width].strip.scrollWidth - rows[width].strip.clientWidth;
  expect(scrolled(900), "900px").toBeGreaterThan(0);
  expect(scrolled(900)).toBeGreaterThanOrEqual(scrolled(1120));
  expect(scrolled(1120)).toBeGreaterThanOrEqual(scrolled(1280));

  expect(await unknownIpcCalls(page)).toEqual([]);
});

for (const at of ["900px", "칸 하나 폭 상자"] as const) {
  test(`스크롤이 선 줄에서도 ⌘로 고른 칸이 보이는 자리로 온다 — ${at}`, async ({ page }) => {
    // 결정 20이 만든 빚이다 — 안 보이는 칸이 생기면 ⌘1~9가 그 칸을 고를 수 있고, 그러면
    // 「눌렀는데 아무 일도 없다」로 읽힌다. 키는 폭을 모르므로 줄이 끌어와야 한다.
    //
    // **900px은 앱 창의 최소 폭이다** — 여러 칸이 스크롤로 넘어간다. 칸 하나 폭 상자는 넓힌 사이드바가 탭 줄의 바닥에 눌려
    // 선 창에서 상자가 가장 좁은 자리다(`squeezedWidth`, `tab-row.ts` 머리말 — 한때 900px 창에 작업 패널이 열린 기본 배치가
    // 그 자리였다). 그 창 폭은 줄이 다 선 뒤에 그 줄의 바닥을 재서 낸다.
    const narrowest = at !== "900px";
    if (narrowest) await widenSidebar(page);
    await installFixtureBackend(page);
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(`/works/${plainWork.slug}?tab=terminal`);
    await fillToCap(page);
    if (narrowest) await page.setViewportSize({ width: await squeezedWidth(page), height: 800 });
    await settleStrip(page);

    const strip = page.locator("[data-tab-strip]");
    const tabs = page.locator('[data-tab="shell"]');
    const last = tabs.nth(MAX_SHELLS - 1);

    // **상자가 칸 하나를 담을 폭이어야 아래 「안」이 뜻을 갖는다.** 0px 상자에서는 어떤 칸도
    // 안에 온전히 못 들어가 ⌘9 뒤의 단언이 뜻 없이 깨지거나, 느슨한 판정이면 뜻 없이 선다.
    const cellWidth = (await last.boundingBox())!.width;
    expect((await strip.boundingBox())!.width).toBeGreaterThanOrEqual(cellWidth - 0.5);

    const inside = async () => {
      const cell = (await last.boundingBox())!;
      const box = (await strip.boundingBox())!;
      return cell.x >= box.x - 1 && cell.x + cell.width <= box.x + box.width + 1;
    };

    // ⌘2가 첫 셸이다(⌘1은 spec — 결정 78·79). 줄이 맨 앞으로 돌아가면 마지막 칸은 밖이다.
    // **이 단언이 없으면 아래가 「원래 보이고 있어서」 초록이 된다.**
    await page.keyboard.press("Meta+2");
    await expect.poll(inside).toBe(false);

    // ⌘9가 여덟째 셸이다. 고른 칸이 상자 안으로 들어오고, 그 칸이 켜진 칸이다.
    await page.keyboard.press("Meta+9");
    await expect.poll(inside).toBe(true);
    await expect(last.locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// git-integration 판 01 티켓 06 — **파일 탭도 같은 줄의 칸이다**(결정 31). 셸과 파일 탭이 섞여 넘친 줄에서 ⌘숫자 · ⌃Tab이 고른
// 칸이 파일 탭이어도 보이는 자리로 온다(스토리 45). 켜진 칸을 집는 말(`aria-pressed`)이 종류를 안 가려서 같은 줄이 돈다 —
// 이 검사는 그 말이 파일 탭에도 서는지, 파일 탭으로 가는 길(주소)을 지나서도 줄이 따라오는지를 본다.
test("셸과 파일 탭이 섞여 넘친 줄에서도 ⌘숫자 · ⌃Tab으로 고른 끝쪽 파일 탭이 보이는 자리로 온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`/works/${fileWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
  await openShell(page);
  // 파일 탭 여섯 — 묶음이 여덟 칸이 되어 900px 창에서 줄이 넘친다(위 셸 여덟과 같은 붐빔). 픽스처에 없는 경로라 본문은
  // 「지워진 파일」이지만 칸은 선다.
  const bundle = page.locator("[data-tab-strip] > [data-tab]");
  const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"];
  for (const [at, name] of files.entries()) {
    await 주소로간다(page, 파일탭주소(`billing/${name}`));
    await expect(bundle).toHaveCount(2 + at + 1);
  }
  await settleStrip(page);

  const strip = page.locator("[data-tab-strip]");
  const first = bundle.first();
  const last = bundle.last();
  await expect(last).toHaveAttribute("data-code", "billing/f.ts");
  // **줄이 정말 넘쳤다** — 안 넘치면 아래 「안」이 늘 참이라 뜻이 없다.
  const row = await rowOf(page);
  expect(row.strip.scrollWidth, JSON.stringify(row.strip)).toBeGreaterThan(row.strip.clientWidth);

  const inside = (cell: typeof first) => async () => {
    const own = (await cell.boundingBox())!;
    const box = (await strip.boundingBox())!;
    return own.x >= box.x - 1 && own.x + own.width <= box.x + box.width + 1;
  };

  // ⌘2가 첫 셸이다 — 줄이 맨 앞으로 가고 마지막 파일 탭은 밖이다. 이것이 없으면 아래가 「원래 보이고 있어서」 초록이다.
  await page.keyboard.press("Meta+2");
  await expect.poll(inside(first)).toBe(true);
  await expect.poll(inside(last)).toBe(false);

  // ⌘9가 여덟째 칸 — 끝쪽 파일 탭이다. 그 칸이 상자 안으로 오고 켜지며, 본문이 그 파일이다.
  await page.keyboard.press("Meta+9");
  await expect.poll(inside(last)).toBe(true);
  await expect(last.locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("main", { name: "billing/f.ts", exact: true })).toBeVisible();
  await expect.poll(inside(first)).toBe(false);

  // 끝쪽 칸에서 ⌃Tab은 돌아 첫 셸이다 — 줄이 다시 맨 앞으로 온다.
  await page.keyboard.press("Control+Tab");
  await expect.poll(inside(first)).toBe(true);
  await expect(first.locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(inside(last)).toBe(false);
  // 거꾸로 돌면 다시 끝쪽 파일 탭으로 — 줄이 따라간다.
  await page.keyboard.press("Control+Shift+Tab");
  await expect.poll(inside(last)).toBe(true);
  await expect(last.locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 위 두 검사는 「줄이 안 넘친다」와 「고른 칸이 상자 안으로 온다」를 들지만 **상자에 칸 하나가
// 들어갈 폭이 남는가**는 안 든다 — 상자가 0px이면 넘침도 없다. 900px 창에서 작업 패널이 열린
// 기본 배치가 그랬다(줄 290px · 상자 0px): 칸이 화면에 없어 누를 수도, 끌어 옮길 수도 없었다.
// 그래서 여기서는 **사람이 보는 것**을 잰다 — 상자에 칸 하나가 온전히 보이고, 그 칸을 눌러 켤
// 수 있고, `+`가 줄 안에 있다.
//
// 창이 작아질 수 있는 끝(`tauri.conf`의 `minWidth` 900)과 그 위 한 폭에서, 탭 줄을 이는 두
// 화면 모두를 본다. 가장 좁은 줄은 work 화면의 것이다 — 줄을 머리에 인 본문 카드 옆에 작업 패널 카드가 서서 그만큼 줄이 받는
// 폭이 준다(codex-ds 스펙 §4 — 칸이 `spec` · `files` 둘이라 레일 열도 서서 그 폭까지 준다, codex-ds 결정 25). 배치는 셋이다 — 패널을 연
// 채(줄이 가장 좁다), 접은 채, 그리고 ⌘B로 사이드바를 접은 채(머리 줄의 왼쪽 여백이 신호등 자리만큼 넓어지는 `inset` 갈래다 —
// 줄은 카드 안이라 그 여백을 안 받고 카드와 함께 창 왼쪽 틈까지 넓어진다). `/terminal`에는 작업 패널이 없어 패널 갈래가 하나다.
const SCREENS = [
  { name: "work 화면", url: `/works/${plainWork.slug}?tab=terminal`, panel: true },
  { name: "`/terminal`", url: "/terminal", panel: false },
] as const;

type Layout = "패널 열림" | "패널 접힘" | "사이드바 접힘" | "패널 없음";

for (const screen of SCREENS) {
  for (const width of [900, 1120]) {
    const layouts: Layout[] = screen.panel
      ? ["패널 열림", "패널 접힘", "사이드바 접힘"]
      : ["패널 없음", "사이드바 접힘"];
    for (const layout of layouts) {
      test(`${screen.name} ${width}px(${layout})에서도 셸 칸이 보이고 눌린다`, async ({ page }) => {
        await installFixtureBackend(page);
        await page.setViewportSize({ width, height: 800 });
        await page.goto(screen.url);

        const tabs = page.locator('[data-tab="shell"]');
        await tabs.first().waitFor();
        // 둘이어야 「다른 칸을 눌러 켠다」가 선다 — 새로 연 칸이 켜져 있으므로 첫 칸을 누른다.
        await openShell(page);
        await expect(tabs).toHaveCount(2);

        if (layout === "패널 접힘") await page.getByRole("button", { name: /패널 접기$/ }).click();
        if (layout === "사이드바 접힘") {
          await page.keyboard.press("Meta+b");
          await expect(page.getByRole("button", { name: "사이드바 토글", exact: true })).toHaveAttribute("aria-expanded", "false");
          await expect.poll(() => page.locator("aside[data-sidebar]").evaluate((el) => el.getBoundingClientRect().width)).toBe(0);
        }
        await settleStrip(page);

        const row = await rowOf(page);
        const at = `${screen.name} ${width}px ${layout} ${JSON.stringify(row)}`;
        // 줄은 여전히 안 넘친다(결정 20) — 칸을 보이게 하려고 `+`를 카드 모서리 밖으로 밀면 안 된다.
        expect(row.spill, at).toBeLessThanOrEqual(0);
        // **상자에 칸 하나가 온전히 들어간다.** 칸은 최소 폭 아래로 안 줄므로 이 폭이 칸 하나를
        // 못 담으면 어느 칸도 온전히 안 보인다(0px이면 하나도 안 보인다).
        expect(row.strip.clientWidth, at).toBeGreaterThanOrEqual(Math.min(...row.tabs));

        // `+`도 줄 안이다 — 칸 상자 뒤에 서서, 줄의 안쪽 끝을 넘지 않고 창 안에 있다.
        const plus = await plusOf(page);
        expect(plus.left, at).toBeGreaterThanOrEqual(plus.stripRight - 0.5);
        expect(plus.right, at).toBeLessThanOrEqual(plus.actionsLeft + 0.5);
        expect(plus.edgeHit, `${at} — \`+\`의 왼쪽 끝`).toBe(true);
        expect(row.pageSpill, at).toBeLessThanOrEqual(0);

        // 머리 줄의 할 일(상태 · ⋯ · 분할 · 패널 토글)도 화면 자리 안 · 창 안이고 제 폭 그대로다(결정 10) — 칸을 보이게 하려고 조작을
        // 밀거나 누르면 안 된다. 머리 줄은 판 위 창 전폭의 줄이라 탭 줄과 자리를 다투지 않는다(02 티켓 02). `/terminal`의 머리 줄은
        // 이름만 들고 할 일 묶음이 없다.
        if (screen.panel) {
          expect(row.workActions, at).not.toBeNull();
          expect(row.workActions!.over, at).toBeLessThanOrEqual(0);
          expect(row.workActions!.outside, at).toBeLessThanOrEqual(0);
          expect(row.workActions!.width, at).toBeGreaterThanOrEqual(row.workActions!.natural - 0.5);
        } else {
          expect(row.workActions, at).toBeNull();
        }

        // 그리고 **눌린다** — 켜지지 않은 첫 칸을 눌러 켠다.
        const first = tabs.first().locator("button[aria-pressed]");
        await expect(first).toHaveAttribute("aria-pressed", "false");
        await first.click({ timeout: 5000 });
        await expect(first).toHaveAttribute("aria-pressed", "true");

        expect(await unknownIpcCalls(page)).toEqual([]);
      });
    }
  }
}

test("칸이 늘수록 이름이 먼저 줄고 아이콘만 남는다", async ({ page }) => {
  // 결정 11의 **순서**다 — 이름이 말줄임으로 줄다가, 몇 글자도 못 세우는 폭에서 자리를
  // 비운다. 창 폭이 아니라 **칸 수**로 폭을 미는 것은 그 사이에 사이드바·패널 폭이
  // 끼지 않아서다 — 재는 것은 같은 한 가지(칸 하나의 폭)다.
  //
  // **이름은 폭이 아니라 칸과의 관계로 잰다** — 글자가 시스템 글꼴이라 같은 이름도 OS마다 폭이 다르다(codex-ds 결정 3).
  // 칸 안에 서고, 넘치면 말줄임이 받는다. 넘치는 쪽을 함께 보려고 둘째 칸에 칸보다 긴 이름(셸 타이틀)을 준다.
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  const plus = page.locator('[data-tab="new"]');
  const name = tabs.first().getByText(SHELL_NAME, { exact: true });
  const LONG = "칸 하나로는 다 못 담는 아주 긴 셸 이름 — 끝이 말줄임으로 접힌다";
  const long = tabs.nth(1).getByText(LONG, { exact: true });

  await expect(tabs).toHaveCount(1);
  // **`+`를 연달아 누른다** — 사람이 그렇게 연다. 첫 칸이 떼어진 채 글꼴이 와도 그 셸은 뜨고
  // 이름이 앉는다(`terminal-store`의 `loadFont`).
  await plus.click();
  await plus.click();
  await expect(tabs).toHaveCount(3);
  await awaitSpawned(page, 3);
  await writeShell(page, `\x1b]0;${LONG}\x07`, 2);
  await expect(long).toHaveCount(1);

  /** 이름 글자가 제 칸 안에 서는가 · 글자가 잘렸나(넘침) · 잘리면 말줄임이 받는가. */
  const 이름 = (target: typeof name) =>
    target.evaluate((el) => {
      const own = el.getBoundingClientRect();
      const cell = el.closest('[data-tab="shell"]')!.getBoundingClientRect();
      return {
        보인다: own.width > 1,
        칸안: own.left >= cell.left - 0.5 && own.right <= cell.right + 0.5,
        잘림: el.scrollWidth > el.clientWidth,
        말줄임: getComputedStyle(el).textOverflow === "ellipsis",
      };
    });
  // 셋일 때는 이름이 보인다 — 짧은 이름은 다 서고, 긴 이름은 칸을 넘지 않고 말줄임으로 접힌다.
  expect(await 이름(name)).toEqual({ 보인다: true, 칸안: true, 잘림: false, 말줄임: true });
  expect(await 이름(long)).toEqual({ 보인다: true, 칸안: true, 잘림: true, 말줄임: true });
  // 둘째 칸의 이름을 되돌린다 — 아래 `fillToCap`이 칸이 섰는지를 픽스처 셸 이름(`… 닫기`)으로 센다(`awaitSpawned`).
  await writeShell(page, `\x1b]0;${SHELL_NAME}\x07`, 2);
  await expect(long).toHaveCount(0);
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

// ─── 티켓 #198: 백엔드가 **셸마다** 쏘는 값이 그 셸에 앉는다 ───
//
// 이 판(터미널 신호)의 검사는 거의 전부가 「서로 다른 상태의 셸 둘」을 필요로 한다 — 행의 점,
// 띠의 줄, 물든 탭이 전부 「어느 셸인가」를 말하는 것들이라, 값이 늘 맨 앞 셸에만 앉으면 그
// 검사들은 **자리가 옳은지를 아예 못 잰다.** 그 자리를 이 검사가 연다.
//
// 막고 있던 것은 고정 백엔드였다: `pty_spawn`이 늘 id 1을 답해 셸이 몇이든 백엔드 쪽 번호가
// 하나뿐이었고, `shellOfPty`가 먼저 찾은 칸을 주므로 값이 전부 맨 앞 칸에 앉았다.
//
// **재는 자리가 탭 줄인 것은 「어느 셸인가」가 화면에 드러나는 자리가 여기뿐이라서다.**
// 사이드바에는 에이전트 마크가 없고(ui-refresh 결정 13), pty id는 화면 어디에도 안 적힌다.
//
// **셸 둘이면 족하고 창 폭은 아무래도 좋다.** 도는 명령의 글리프는 폭과 무관하게 **DOM에 늘
// 있고**(`ShellTabs`의 `@max-[88px]:flex` — 좁은 폭에서 바뀌는 것은 `display`뿐이다), 여기서
// 세는 것은 그 DOM이다. 「이름이 숨는 폭에서만 눈에 선다」를 재는 것은 마크업 seam
// (`ShellTabs.test.tsx`)의 몫이고, 이 검사의 물음은 **값이 어느 칸에 앉나** 하나다 — 상한까지
// 채우면 그 물음이 상한·접힘 규칙에 공연히 매인다.
test("도는 명령은 그 셸의 칸에만 앉는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // 들어오면 이 work의 셸 하나가 뜬다(`ensureShell`). 「둘째 칸 = pty 2」는 앱이 칸을 연 순서대로
  // 띄워서다(`terminal-store`의 `loadFont`) — `openShell`의 기다림은 pty가 앉은 것만 본다(그 머리말).
  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  await openShell(page);
  await expect(tabs).toHaveCount(2);

  const marks = page.locator('[data-tab="shell"] [role="img"]');
  // **먼저 아무 칸도 안 물든 것을 센다.** 이것이 없으면 아래가 「원래 있던 것」으로도 초록이 된다.
  await expect(marks).toHaveCount(0);

  await markRunning(page, "claude", 2);

  // 그 칸 하나에만 앉는다. 세 단언이 각각 다른 것을 말한다: 둘째가 물들었다 · 첫째는 안
  // 물들었다 · 그리고 **줄 전체에 하나뿐이다**(마지막이 없으면 두 칸이 함께 물든 그림이
  // 통과한다 — 값이 셸 단위가 아니라 줄 단위로 앉는 회귀가 정확히 그 모양이다).
  await expect(tabs.nth(1).locator('[role="img"]')).toHaveCount(1);
  await expect(tabs.nth(0).locator('[role="img"]')).toHaveCount(0);
  await expect(marks).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **손잡이가 「앉았다」를 잘못 말하면 위 검사가 무엇을 재는지 아무도 모른다.** `markRunning`은
// 값이 앉을 때까지 다시 쏘는데, 앉았는지를 마크의 수로 판정한다 — 그 판정이 화면 전체에서
// 「하나라도 있는가」였을 때는 같은 에이전트의 마크가 이미 서 있으면(다른 칸이 같은 마크를
// 세운다) 값이 대상 pty에 **안 앉아도** 곧바로 성공을 냈다. 이 판의 뒤쪽 티켓들이
// 같은 에이전트를 셸 둘에 앉히므로(#203~#205) 그 fail-open이 정확히 그 그림에서 난다.
test("도는 명령 손잡이는 이미 선 마크에 안 속는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  await openShell(page);
  await markRunning(page, "claude", 2);
  await expect(page.locator('[data-tab="shell"] [role="img"]')).toHaveCount(1);

  // 모르는 pty를 주면 `shellOfPty`가 null을 주어 값이 **아무 칸에도 안 앉는다.** 그러면
  // 손잡이는 5초를 다 쓰고 던져야 한다 — 위 claude 하나를 보고 돌아가면 안 된다.
  const 던진말 = await markRunning(page, "claude", 99).then(
    () => "던지지 않았다",
    (error: Error) => error.message,
  );
  expect(던진말).toContain("pty 99");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 티켓 #205: 칸이 **물든다**(결정 6 — 안 J3) ───
//
// **이 층이 아니면 아무것도 안 보인다.** 마크업 seam(`ShellTabs.test.tsx`)이 드는 것은 클래스
// 문자열이고, 여기서 재는 것은 셋이다 — 그 클래스가 실제로 **토큰 값으로** 칠해지는가 ·
// 스토어를 한 바퀴 돈 값이 그 칸에 앉는가 · 그리고 **칸을 켜면 안 본 완료가 꺼지는가**. 마지막
// 것은 정적 마크업에 아예 없다: 「봤다」는 창 포커스와 켜진 칸이 만나는 순간이라 이벤트가
// 도는 층에서만 난다.

/**
 * 안 물든 칸의 배경. 브라우저가 `transparent`를 이 글자로 돌려준다 — 토큰이 아니라 **없음**
 * 이라 `토큰색`(하네스)으로 못 뽑고, 그래서 여기 한 번 적는다. 브라우저가 다른 글자를 돌려주는 날은
 * 이 줄이 그 자리에서 터진다(조용히 통과하지 않는다).
 */
const 안물듦 = "rgba(0, 0, 0, 0)";

/** 그 칸의 실제 배경색. 채움이 칸 상자에 붙으므로(스토리 53) 재는 것도 그 상자다. */
const 칸배경 = (page: Page, at: number) =>
  page.locator('[data-tab="shell"]').nth(at).evaluate((el) => getComputedStyle(el).backgroundColor);

/** 그 칸의 이름 글자에 칠해진 색. 잉크는 칸 상자가 아니라 이름 글자에 붙는다(`signalTint`). */
const 이름색 = (page: Page, at: number) =>
  page
    .locator('[data-tab="shell"]')
    .nth(at)
    .getByText(FIXTURE_SHELL_NAME, { exact: true })
    .evaluate((el) => getComputedStyle(el).color);

test("부르는 칸만 물들고, 색이 부름의 무리 토큰(wait-soft · new-soft) 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  await openShell(page);
  await expect(tabs).toHaveCount(2);
  // 부르는 것은 **둘째 칸**이고 보고 있는 것은 첫째다 — 켜진 칸을 부르게 하면 「봤다」가
  // 곧바로 안 본 완료를 지워, 이 검사가 무엇을 재는지 모르게 된다.
  await tabs.nth(0).locator("button[aria-pressed]").click();

  // **먼저 아무 칸도 안 물든 것을 센다.** 이것이 없으면 아래가 「원래 그렇던 것」으로도 초록이다.
  //
  // 값을 한 번 재서 들고 있지 않고 **폴링으로 견준다** — 칸에 `transition-colors`가 걸려 있어
  // 켜짐이 옮겨 가는 150ms 동안 `getComputedStyle`이 중간 색을 돌려준다(실측: 켜짐이 빠지는
  // 도중에 켜짐 면의 반투명 회색). 그 순간값을 기준으로 잡으면 마지막 「도는 중은 안
  // 물든다」가 존재하지 않는 색과 견주게 된다.
  await expect
    .poll(() => 칸배경(page, 1), { message: "안 부르는 칸이 물들어 있다" })
    .toBe(안물듦);
  // 안 부르는 꺼진 칸의 이름은 `fg-secondary`다(DS `.at-tab`) — 아래 안 본 완료가 견줄 색이다.
  const 꺼진칸 = await 토큰색(page, "--fg-secondary");
  await expect.poll(() => 이름색(page, 1), { message: "꺼진 칸의 이름이 fg-secondary가 아니다" }).toBe(꺼진칸);

  await markAttention(
    page,
    { agent: "claude", event: "Elicitation", payload: { message: "커밋할까요?" } },
    2,
  );
  const 기다림 = await 토큰색(page, "--wait-soft");
  await expect
    .poll(() => 칸배경(page, 1), { message: "둘째 칸이 기다림으로 안 물들었다" })
    .toBe(기다림);
  // 옆 칸은 그대로다 — 값이 줄 단위로 앉는 회귀가 여기서 터진다.
  expect(await 칸배경(page, 0)).not.toBe(기다림);
  // 기다리는 칸의 이름은 `warning`이다(DS `.at-tab.wait`). 안 부르는 옆 칸은 켜진 칸이라 이름이 `fg`다(DS `.at-tab.is-on`).
  expect(await 이름색(page, 0), "안 부르는 켜진 칸의 이름").toBe(await 토큰색(page, "--fg"));
  await expect.poll(() => 이름색(page, 1), { message: "기다리는 칸의 이름이 warning이 아니다" }).toBe(await 토큰색(page, "--warning"));

  // 턴이 끝나면 안 본 완료다 — 프로세스 결정 13이 이렇게 고쳤다(옛 표는 세션 끝이 안 본 완료이고 턴 끝이 기다림이었다).
  await markAttention(page, { agent: "claude", event: "Stop", stopped: true }, 2);
  const 안본완료 = await 토큰색(page, "--new-soft");
  expect(기다림, "기다림과 안 본 완료가 같은 색이다").not.toBe(안본완료);
  await expect
    .poll(() => 칸배경(page, 1), { message: "둘째 칸이 안 본 완료로 안 물들었다" })
    .toBe(안본완료);
  // **안 본 완료의 이름은 무채색이다**(DS `.at-tab` — 색 글자는 기다림뿐) — 안 부르는 꺼진 칸과 같은 `fg-secondary`다. 파란
  // 잉크(`accent-solid`)는 물든 칸 위 2.7:1(다크 2.5:1)이라 글자로 못 읽혔다 — 안 본 완료는 칸의 채움이 말한다.
  await expect.poll(() => 이름색(page, 1), { message: "안 본 완료 칸의 이름이 꺼진 칸의 색이 아니다" }).toBe(꺼진칸);

  // **도는 중은 안 물든다**(스토리 52). 탭 칸에는 스피너를 안 세우므로 여기서 물들이면 claude가
  // 도는 내내 줄이 색을 띤 채라 「부른다」가 뜻을 잃는다.
  await markAttention(page, { agent: "claude", event: "UserPromptSubmit" }, 2);
  await expect
    .poll(() => 칸배경(page, 1), { message: "도는 중인 칸이 안 돌아왔다" })
    .toBe(안물듦);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **켜면 안 본 완료가 꺼지고 기다림은 남는다**(결정 6·7 · 스토리 49·50). 판정은 `isShellSeen` 하나이고
// 알림 억제(#206)가 같은 함수를 쓴다 — 여기서 꺼지는 것이 곧 그쪽에서 안 울리는 것이다.
test("안 본 완료 칸을 켜면 물들임이 꺼지고, 기다리는 칸을 켜도 기다림은 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  await openShell(page);
  await tabs.nth(0).locator("button[aria-pressed]").click();

  const 안본완료 = await 토큰색(page, "--new-soft");
  const 기다림 = await 토큰색(page, "--wait-soft");
  const 켜기 = (at: number) => tabs.nth(at).locator("button[aria-pressed]").click();

  await markAttention(page, { agent: "claude", event: "Stop", stopped: true }, 2);
  await expect.poll(() => 칸배경(page, 1)).toBe(안본완료);
  // 이름에도 붙어 있다 — 꺼지는 것이 색만이 아니라는 것을 아래에서 같은 자리로 잰다.
  await expect(tabs.nth(1).locator("button[aria-pressed]")).toHaveAttribute(
    "aria-label",
    /확인할 것$/,
  );

  await 켜기(1);
  // **켜는 순간 봤다다.** 색도 이름도 함께 걷힌다.
  await expect
    .poll(() => 칸배경(page, 1), { message: "켠 칸의 안 본 완료가 안 꺼졌다" })
    .not.toBe(안본완료);
  await expect(tabs.nth(1).locator("button[aria-pressed]")).not.toHaveAttribute(
    "aria-label",
    /확인할 것$/,
  );

  // **기다림은 켜도 안 꺼진다** — 본 것과 답한 것은 다르다(결정 7). 켜진 칸이라 켜짐의 면
  // (`tab-on` — `fill-hover`)이 서야 할 자리인데 기다림의 채움이 이긴다(결정 6).
  await markAttention(
    page,
    { agent: "claude", event: "Elicitation", payload: { message: "커밋할까요?" } },
    2,
  );
  await expect.poll(() => 칸배경(page, 1), { message: "켠 칸의 기다림이 꺼졌다" }).toBe(기다림);
  // 「고른 칸이다」는 1px 안쪽 테두리가 대신 말한다 — 그림자라 폭을 안 먹는다(스토리 54).
  const 그림자 = await tabs.nth(1).evaluate((el) => getComputedStyle(el).boxShadow);
  expect(그림자, `켜진 기다림 칸에 안쪽 테두리가 없다 — ${그림자}`).toContain("inset");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **「봤다」는 그 셸을 **보고 있을 때**만이다**(결정 7). 칸이 켜져 있어도 본문이 문서면 사람은
// 그 셸을 안 보고 있다 — 켜진 칸(`activeByOwner`)은 그 화면의 **기억**이라 spec을 읽는 동안에도
// 남아 있어서, 그것만 보고 「봤다」를 세우면 문서를 읽는 내내 완료가 조용히 지워진다.
//
// 분할이 그 반대쪽이다: 열 둘 중 하나가 터미널이면 그 셸은 **보고 있는 것**이다.
test("문서를 읽는 동안엔 안 꺼지고, 분할로 함께 보면 꺼진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  const tabs = page.locator('[data-tab="shell"]');
  const 안본완료 = await 토큰색(page, "--new-soft");
  const 끝난다 = () =>
    markAttention(page, { agent: "claude", event: "Stop", stopped: true }, 1);

  // 문서로 옮긴다 — 칸은 그대로 켜져 있고 본문만 바뀐다(주소에서 `tab`이 빠진다, 결정 14).
  await page.locator('[data-tab="spec"]').click();
  await expect(page).not.toHaveURL(/tab=terminal/);
  await 끝난다();
  // **안 꺼진다.** 켜진 칸이라는 이유로 지워지면 여기가 안 본 완료의 채움이 아니다.
  await expect
    .poll(() => 칸배경(page, 0), { message: "문서를 읽는 중인데 안 본 완료가 안 섰다" })
    .toBe(안본완료);

  // 분할을 켠다 — 열 하나가 터미널이라 그 셸은 보고 있는 것이다(결정 7).
  await page.getByRole("button", { name: "분할", exact: true }).click();
  await expect(page).toHaveURL(/split=/);
  await expect
    .poll(() => 칸배경(page, 0), { message: "분할로 보고 있는데 안 본 완료가 안 꺼졌다" })
    .not.toBe(안본완료);

  // 그리고 분할 중에 온 완료도 곧바로 봤다다 — 스토리 58이 알림 쪽에서 같은 말을 한다.
  await 끝난다();
  await expect(tabs.nth(0).locator("button[aria-pressed]")).not.toHaveAttribute(
    "aria-label",
    /확인할 것$/,
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **포커스가 판정에 실제로 든다**(결정 7 · 스토리 10). 「봤다」는 켜진 칸과 창 포커스가
// **만나는** 순간인데, 한쪽(창 포커스)에는 지금까지 아무 그물도 없었다 — `windowFocused()`를
// `return true`로 바꿔도 L1~L4가 전부 초록이었다. 그 fail-open은 「안 본 완료가 안 뜬다」로만
// 나타나므로 화면에서 안 보인다.
//
// 헤드리스 WebKit은 배경 페이지에서도 `document.hasFocus()`가 참이라 진짜로 포커스를 뺏을
// 길이 없다(`stubWindowFocus` 머리말의 실측). 그래서 브라우저가 답하는 그 한 줄을 손으로
// 잡고 **앱이 그것을 딛는지**를 잰다.
test("창이 뒤에 있으면 안 본 완료가 안 꺼지고, 창이 앞으로 오면 그 순간 꺼진다", async ({ page }) => {
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  const 안본완료 = await 토큰색(page, "--new-soft");
  await setWindowFocused(page, false);
  await markAttention(page, { agent: "claude", event: "Stop", stopped: true }, 1);

  // 그 셸을 **보고 있는데도** 안 꺼진다 — 창이 뒤에 있으면 사람이 본 것이 아니다.
  await expect
    .poll(() => 칸배경(page, 0), { message: "창이 뒤에 있는데 안 본 완료가 안 섰다" })
    .toBe(안본완료);

  // 값만 바꾸고 이벤트를 안 쏘면 화면은 그대로다 — 다시 재는 것은 리스너의 일이다.
  await setWindowFocused(page, true);
  expect(await 칸배경(page, 0), "이벤트 없이 안 본 완료가 꺼졌다").toBe(안본완료);

  // **알림을 눌러 돌아온 순간이 이것이다**(스토리 10) — 「알림이 왔는데 아무것도 없다」가
  // 아니라 「와서 봤다」로 읽히려면 그 순간 꺼져야 한다.
  await fireWindowEvent(page, "focus");
  await expect
    .poll(() => 칸배경(page, 0), { message: "창이 앞으로 왔는데 안 본 완료가 안 꺼졌다" })
    .not.toBe(안본완료);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **`blur`가 「봤다」를 세우는 길이 하나 있다** — 그 하나 때문에 그 리스너가 산다.
// 다른 앱을 보다가 분할된 화면의 spec 프레임을 **바로 눌러** 돌아오면, 포커스가 자식 문서로
// 들어가므로 부모 `window`에는 `focus` 없이 `blur`만 온다. 그때 창은 앞에 있다
// (`document.hasFocus()`가 참이고, SpecViewer의 `useFrameFocused`가 그 실측을 들고 있다).
// 이 줄이 없으면 눈앞의 셸이 다음 이벤트가 올 때까지 안 본 완료인 채로 남는다.
test("blur이 와도 창이 앞에 있으면 「봤다」다 — spec 프레임을 바로 누른 길", async ({ page }) => {
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  const 안본완료 = await 토큰색(page, "--new-soft");
  await setWindowFocused(page, false);
  await markAttention(page, { agent: "claude", event: "Stop", stopped: true }, 1);
  await expect
    .poll(() => 칸배경(page, 0), { message: "창이 뒤에 있는데 안 본 완료가 안 섰다" })
    .toBe(안본완료);

  // 앱이 앞으로 오면서 포커스가 프레임으로 들어간다 — 부모가 받는 것은 `blur` 하나다.
  await setWindowFocused(page, true);
  await fireWindowEvent(page, "blur");
  await expect
    .poll(() => 칸배경(page, 0), { message: "창이 앞에 있는데 blur에 안 본 완료가 안 꺼졌다" })
    .not.toBe(안본완료);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 글꼴이 오는 사이에 둘째 칸을 열어도 **두 셸이 다 뜬다** ───
//
// 사람은 첫 셸이 spawn했는지 기다렸다가 `+`를 누르지 않는다. 터미널 글꼴은 저장소에 든
// 0.94MB 파일이라(`src/assets/fonts/README.md`) 실물에서도 첫 화면에 늦게 온다 — 그 틈에
// ⌘T나 `+`를 누르면 첫 칸이 떼어진 채 글꼴이 도착한다.
//
// **글꼴 응답을 붙잡아 그 틈을 결정적으로 만든다.** 안 붙잡으면 한가한 러너에서는 글꼴이
// 먼저 와서 초록이고 붐비는 러너에서만 빨개진다 — 918fbc5가 검사들에 기다림을 넣어 덮은 것이
// 바로 그 모양이다. 여기서는 기다리지 않는다: 두 칸을 곧바로 세우고 나서야 글꼴을 놓는다.
//
// **켜지 않은 첫 칸을 누르지 않는다.** 누르면 다시 붙는 길이 그 칸을 열어 초록이 되는데,
// 사람이 기대하는 것은 「연 셸은 뒤에서도 돈다」다(in-app-terminal 결정 20·21. 프로세스 결정 7이 입력 없는 자동 셸만
// 예외로 두었는데, 여기서는 화면을 안 떠난다) — 안 본 칸도 떠 있어야 한다.
for (const [where, url] of [
  ["work 화면", `/works/${plainWork.slug}?tab=terminal`],
  ["/terminal", "/terminal"],
] as const) {
  test(`글꼴이 오기 전에 둘째 칸을 열어도 두 셸이 다 뜬다 — ${where}`, async ({ page }) => {
    await installFixtureBackend(page);
    const releaseFonts = await holdTerminalFonts(page);
    // `load`를 기다리지 않는다 — 그 이벤트가 붙잡아 둔 글꼴을 기다려 여기서 멈춘다.
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const tabs = page.locator('[data-tab="shell"]');
    await expect(tabs).toHaveCount(1);
    await page.locator('[data-tab="new"]').click();
    await expect(tabs).toHaveCount(2);

    await releaseFonts();

    // 칸마다 본다 — 전체 수로 세면 어느 칸이 안 떴는지가 안 남는다. 이름이 픽스처의 셸 이름으로
    // 바뀐 것이 그 칸이 spawn 응답을 받았다는 화면 신호다(`FIXTURE_SHELL_NAME`의 머리말).
    for (const at of [0, 1]) {
      await expect(
        tabs.nth(at).locator(`button[aria-label="${SHELL_NAME} 닫기"]`),
        `${at + 1}번째 칸의 셸이 안 떴다`,
      ).toHaveCount(1, { timeout: 20_000 });
    }
    // **셸마다 한 번이다.** 칸의 이름만 보면 한 칸이 둘 뜬 것이 안 보인다. 나머지 갈래(⌘T·화면을
    // 떠남·닫기·격자)는 `shell-cold-start.spec.ts`가 든다.
    expect(await callCount(page, "pty_spawn")).toBe(2);

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}
