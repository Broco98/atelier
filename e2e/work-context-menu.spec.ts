import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  heldCalls,
  holdCommand,
  installFixtureBackend,
  ipcCallArgs,
  markAttention,
  navButton,
  releaseCommand,
  typeIntoShell,
  unknownIpcCalls,
  다떴다,
  띠,
  머리카드,
  줄차례,
  칠한값,
  테두리,
  토큰값,
  토큰색,
  행버튼,
} from "./harness";

// codex-ds 티켓 27 — **웹뷰 메뉴가 막히고 work를 우클릭하면 work 메뉴가 뜬다**(codex-ds 스펙 §9 · 결정 6 · 7 · 8 · 11 · 15).
// 앱 어디서도 웹뷰의 기본 메뉴(새로고침 · 검사)가 서지 않고, 메뉴가 있는 대상만 제 메뉴를 연다. work 대상은 셋이다 — 사이드바
// work 행 · 알림 띠 줄 · 머리 카드 이름. 셋 다 ⋯과 같은 work 메뉴를 커서 자리에 열고, 고른 행 · 주소는 그대로이며, 열린 동안만
// 대상에 대상 테두리(포커스 링)가 선다. ⇧F10 · 메뉴 키는 포커스된 대상의 같은 메뉴를 그 대상 곁에 연다.
//
// WebKit의 우클릭은 `click({ button: "right" })`(사건 `contextmenu`)로, 메뉴 키는 `ContextMenu` 키로 흉내 낸다. macOS WebKit은 그
// 키로 `contextmenu`를 스스로 내지 않아 앱이 keydown으로 연다 — 그 길을 재는 것이 키 검사다. 메뉴가 열린 동안 바깥을 누르는
// 검사는 자리를 재고 `page.mouse.click`으로 누른다 — `locator.click()`은 메뉴의 가림막에 막힌다.

const [pinnedWork, plainWork] = WORKS;

/** 열기 — 고치기 — 상태 — 정리 — 되돌릴 수 없는 것(codex-ds 결정 10). 정리 묶음의 첫 줄만 그 work의 고정에 따라 갈린다. */
const 작업메뉴차례 = (pinned: boolean) => [
  "Finder에서 열기",
  "—",
  "이름 바꾸기F2",
  "복사",
  "—",
  "상태",
  "—",
  pinned ? "고정 풀기" : "고정",
  "아카이브",
  "—",
  "삭제",
];

const 메뉴 = (page: Page) => page.getByRole("menu");

/**
 * 버튼을 역할로 집되 **메뉴가 열린 동안에도 찾는다** — 메뉴가 열리면 부품이 바깥을 보조 기술에서 숨겨(`aria-hidden`) 역할로는 대상이
 * 안 잡힌다. 열린 동안 대상의 자리 · 테두리를 재야 해서 숨은 것까지 집는다.
 */
const 버튼 = (scope: Locator, name: string) => scope.getByRole("button", { name, exact: true, includeHidden: true });

/** 사이드바에서 고른 행의 slug — 고름이 그대로인지는 이것으로 잰다. */
const 고른행 = (page: Page) =>
  page
    .locator("[data-work-row]")
    .evaluateAll((rows) => rows.filter((row) => row.classList.contains("selected-row")).map((row) => row.getAttribute("data-work-row")));

/**
 * work 대상 셋. 저마다 화면을 세우고 그 대상과 대상의 work, 그때 고른 work를 돌려준다. **대상의 work는 고른 work가 아닐 수 있다**
 * (결정 7) — 행 · 띠 줄은 일부러 다른 work를 보는 중에 집어, 메뉴가 고른 것이 아니라 그 대상의 것인지를 함께 잰다.
 */
const 대상들: Array<{
  name: string;
  setUp: (page: Page) => Promise<{ target: Locator; work: (typeof WORKS)[number]; selected: string }>;
}> = [
  {
    name: "사이드바 work 행",
    setUp: async (page) => {
      await page.goto(`/works/${plainWork.slug}`);
      return { target: 버튼(page.locator("[data-worklist]"), pinnedWork.title), work: pinnedWork, selected: plainWork.slug };
    },
  },
  {
    name: "알림 띠 줄",
    setUp: async (page) => {
      // 그냥 일의 셸이 부르게 하고(사람에게 묻는 claude), 친 셸이라 화면을 떠나도 남는다 — 그다음 고정된 일로 옮겨 간다.
      await page.goto(`/works/${plainWork.slug}?tab=terminal`);
      await awaitSpawned(page, 1);
      await typeIntoShell(page);
      await markAttention(page, {
        agent: "claude",
        event: "Elicitation",
        at: Date.now(),
        payload: { message: "어느 쪽으로 할까요?" },
      });
      await 행버튼(page, pinnedWork.title).click();
      await expect(page).toHaveURL(`/works/${pinnedWork.slug}`);
      return {
        target: 버튼(띠(page), `${plainWork.title} — 나를 기다림`),
        work: plainWork,
        selected: pinnedWork.slug,
      };
    },
  },
  {
    name: "머리 카드 이름",
    setUp: async (page) => {
      await page.goto(`/works/${pinnedWork.slug}`);
      return { target: 머리카드(page).getByText(pinnedWork.title, { exact: true }), work: pinnedWork, selected: pinnedWork.slug };
    },
  },
];

for (const { name, setUp } of 대상들) {
  test(`${name}을 우클릭하면 그 work의 메뉴가 커서 자리에 서고, 고름 · 주소는 그대로이며 대상 테두리는 연 동안만 선다`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    const { target, work, selected } = await setUp(page);
    const url = page.url();
    const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
    await expect(target).toBeVisible();
    // 전제: 닫혀 있으면 대상에 테두리가 없다 — 처음부터 있으면 「연 동안 선다」가 아무것도 안 잰다.
    expect(await 테두리(target)).toBeNull();

    await target.click({ button: "right", position: { x: 6, y: 6 } });
    const menu = 메뉴(page);
    await expect(menu).toBeVisible();
    // ⋯ 메뉴와 같은 정의다(결정 6) — 대상의 work에 따라 정리 묶음의 첫 줄이 갈린다.
    await expect.poll(() => 줄차례(menu)).toEqual(작업메뉴차례(work.pinned));
    // 우클릭 카드는 248이고(`size-menu-ctx`) 왼쪽 위가 커서 자리다(DS `ContextMenu` 보드 「열고 닫기」).
    const 폭 = await 토큰값(page, "width", "--size-menu-ctx");
    expect(폭, "우클릭 메뉴 폭 — size-menu-ctx").toBe("248px");
    expect(await 칠한값(menu, "width")).toEqual([폭]);
    await 다떴다(menu);
    const spot = (await target.boundingBox())!;
    const card = (await menu.boundingBox())!;
    expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.round(spot.x + 6), Math.round(spot.y + 6)]);

    // 고름 · 주소는 그대로다(결정 7) — 우클릭은 그 work로 가지 않는다.
    expect(page.url()).toBe(url);
    expect(await 고른행(page)).toEqual([selected]);
    // 열린 동안 대상에 대상 테두리가 선다(결정 11) — 포커스 링과 같은 링이다.
    await expect.poll(() => 테두리(target)).toBe(링);

    // 바깥을 누르면 닫히고 테두리가 걷힌다.
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width - 8, viewport.height - 8);
    await expect(menu).toHaveCount(0);
    await expect.poll(() => 테두리(target)).toBeNull();
    expect(page.url()).toBe(url);

    // Esc로 닫으면 포커스가 그 대상으로 돌아온다.
    await target.click({ button: "right" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(target).toBeFocused();
    expect(page.url()).toBe(url);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  for (const key of ["Shift+F10", "ContextMenu"]) {
    test(`${name}에 포커스를 두고 ${key}를 누르면 같은 메뉴가 그 대상 곁에 서고 ↓가 첫 항목에 간다`, async ({ page }) => {
      await installFixtureBackend(page);
      const { target, work } = await setUp(page);
      const url = page.url();
      const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
      await target.focus();
      await expect(target).toBeFocused();

      await page.keyboard.press(key);
      const menu = 메뉴(page);
      await expect(menu).toBeVisible();
      await expect.poll(() => 줄차례(menu)).toEqual(작업메뉴차례(work.pinned));
      // 커서가 없으니 대상의 왼쪽 아래에 선다.
      await 다떴다(menu);
      const spot = (await target.boundingBox())!;
      const card = (await menu.boundingBox())!;
      expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.round(spot.x), Math.round(spot.y + spot.height)]);
      await expect.poll(() => 테두리(target)).toBe(링);

      // 카드 자신이 포커스를 쥐고, 그 뒤의 ↓가 첫 항목이다 — ⋯를 눌러 연 것과 같다.
      await expect(menu).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: "Finder에서 열기" })).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(target).toBeFocused();
      expect(page.url()).toBe(url);
      expect(await unknownIpcCalls(page)).toEqual([]);
    });
  }
}

// ── 메뉴는 대상의 work에 건다 ──
// 고른 것이 그냥 일이어도 고정된 일의 행에서 연 메뉴는 고정된 일에 건다.

test("다른 work를 보는 중에 행의 메뉴에서 「고정 풀기」를 고르면 그 행의 work에 명령이 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  await 행버튼(page, pinnedWork.title).click({ button: "right" });
  await 메뉴(page).getByRole("menuitem", { name: "고정 풀기", exact: true }).click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect
    .poll(async () => (await ipcCallArgs(page, "set_work_pinned", "pinned")).map(({ args }) => args))
    .toEqual([{ slug: pinnedWork.slug, pinned: false }]);
  await expect(page).toHaveURL(`/works/${plainWork.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 아카이브 · 삭제는 대상의 work에 건다 (결정 7 · 스펙 §6) ──
// 확인 창이 그 대상의 work을 말하고, 「취소」면 아무것도 안 나가며, 확인하면 **그 work의 slug로** 코어 명령이 나간다. 흐름은 한
// 자리(`work-menu-actions.ts`)지만 대상을 집는 길이 셋이라 셋을 다 잰다 — 행 · 띠 줄은 고른 것이 아닌 work이고, 그 work 대신 고른
// work이 나가면 엉뚱한 것이 지워진다.

for (const { name, setUp } of 대상들) {
  for (const [row, verb, command] of [
    ["아카이브", "아카이빙", "archive_work"],
    ["삭제", "삭제", "remove_work"],
  ] as const) {
    test(`${name}의 메뉴에서 「${row}」는 그 work로 확인 창을 거친다 — 「취소」면 아무것도 안 나가고 「${verb}」면 그 work로 나간다`, async ({
      page,
    }) => {
      await installFixtureBackend(page);
      const { target, work, selected } = await setUp(page);
      const url = page.url();
      const dialog = page.getByRole("alertdialog", { name: `'${work.title}' ${verb}` });
      const 고른다 = async () => {
        await target.click({ button: "right", position: { x: 6, y: 6 } });
        await 메뉴(page).getByRole("menuitem", { name: row, exact: true }).click();
        await expect(dialog).toBeVisible();
      };

      await 고른다();
      await dialog.getByRole("button", { name: "취소", exact: true }).click();
      // 앵커: 창이 닫혔다. 그다음에 「안 나갔다」와 고름 · 주소를 잰다.
      await expect(dialog).toHaveCount(0);
      expect(await callCount(page, command)).toBe(0);
      expect(page.url()).toBe(url);
      expect(await 고른행(page)).toEqual([selected]);

      await 고른다();
      await dialog.getByRole("button", { name: verb, exact: true }).click();
      await expect
        .poll(async () => (await ipcCallArgs(page, command, "slug")).map(({ args }) => args))
        .toEqual([{ slug: work.slug }]);
      await expect(dialog).toHaveCount(0);
      expect(await unknownIpcCalls(page)).toEqual([]);
    });
  }
}

// ── ⌃클릭은 우클릭이다 (결정 7) ──
// macOS에서 ⌃클릭은 우클릭이라 같은 메뉴를 연다 — 그 손이 그 work로 가 버리면 「메뉴는 고름을 안 바꾼다」가 깨진다. 누르면 그 work로
// 가는 대상(행 · 띠 줄)은 그 클릭에서 ⌃를 거른다. ⌃클릭이 WebKit에서 어떤 사건 줄을 내는지는 러너가 흉내 내지 않으므로, 거름 자체를
// ⌃가 실린 `click` 사건으로 잰다.
//
// 「안 갔다」는 기다려서 보지 않는다(언제까지 기다리나가 없다). 주소를 바꾸는 부름(`pushState` · `replaceState`)을 차례로 적고, ⌃클릭
// 뒤에 표를 꽂은 다음 ⌃ 없는 클릭으로 가게 한다 — 적힌 줄의 첫 칸이 그 표면 ⌃클릭은 아무 데도 안 갔다.

const 주소적기 = (page: Page) =>
  page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { 주소들: string[] }).주소들 = log;
    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method].bind(history);
      history[method] = (...args: Parameters<History["pushState"]>) => {
        log.push(String(args[2]));
        original(...args);
      };
    }
  });
const 표를꽂는다 = (page: Page) => page.evaluate(() => (window as unknown as { 주소들: string[] }).주소들.push("표"));
const 적힌주소 = (page: Page) => page.evaluate(() => (window as unknown as { 주소들: string[] }).주소들);

for (const { name, setUp } of 대상들.filter((one) => one.name !== "머리 카드 이름")) {
  test(`${name}을 ⌃클릭하면 그 work로 가지 않는다 — ⌃ 없는 클릭은 간다`, async ({ page }) => {
    await installFixtureBackend(page);
    const { target, work, selected } = await setUp(page);
    // 앵커: 화면이 섰다 — 적기 전에 주소가 멎었다(뒤늦은 정규화가 표 앞에 적히지 않게).
    await expect(target).toBeVisible();
    await 주소적기(page);

    await target.dispatchEvent("click", { ctrlKey: true });
    await 표를꽂는다(page);
    await target.dispatchEvent("click");
    // 앵커: ⌃ 없는 클릭은 그 work로 갔고, 적기가 그 부름을 봤다.
    await expect(page).toHaveURL(new RegExp(`/works/${work.slug}(\\?|$)`));
    const 주소들 = await 적힌주소(page);
    expect(주소들.length).toBeGreaterThan(1);
    expect(주소들[0], `⌃클릭이 ${selected}에서 옮겼다`).toBe("표");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// ── 바쁨은 앱 하나다 · 「바쁘다」는 그 work의 것이다 ──
// 아카이브 · 삭제가 하나라도 돌면 모든 work 메뉴가 닫혀 있다(`useWorkMenuFlows`의 `busy`) — ⋯도 꺼진다. 그런데 ⋯가 「바쁘다」
// (`aria-busy`)고 말하고 본문을 덮는(`LifecycleOverlay`) 것은 그 조작이 **이 화면의 work의 것일 때**뿐이다. 다른 work의 조작에 바쁘다고
// 하면 이 work이 치워지는 중이라고 읽힌다. 「돈다」는 코어 호출을 붙잡아 세운다.

test("다른 work를 아카이브하는 동안 ⋯는 꺼지지만 바쁘다고 하지 않고 본문을 안 덮는다 — 이 work면 바쁘다고 하고 덮는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const more = page.getByRole("button", { name: "작업 메뉴", exact: true });
  const 막 = page.getByRole("status").filter({ hasText: "아카이빙 중…" });
  await expect(more).toBeEnabled();

  // 고르지 않은 work(고정된 일) — 사이드바 행의 메뉴에서.
  await holdCommand(page, "archive_work");
  await 행버튼(page, pinnedWork.title).click({ button: "right" });
  await 메뉴(page).getByRole("menuitem", { name: "아카이브", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "아카이빙", exact: true }).click();
  await expect.poll(() => heldCalls(page, "archive_work")).toBe(1);
  await expect(more).toBeDisabled();
  await expect(more).toHaveAttribute("aria-busy", "false");
  await expect(막).toHaveCount(0);
  await releaseCommand(page, "archive_work");
  // 앵커: 돌던 조작이 끝나 ⋯가 다시 켜졌다 — 다음 조작을 걸 수 있다.
  await expect(more).toBeEnabled();

  // 고른 work(그냥 일) — ⋯에서.
  await holdCommand(page, "archive_work");
  await more.click();
  await 메뉴(page).getByRole("menuitem", { name: "아카이브", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "아카이빙", exact: true }).click();
  await expect.poll(() => heldCalls(page, "archive_work")).toBe(1);
  await expect(more).toBeDisabled();
  await expect(more).toHaveAttribute("aria-busy", "true");
  await expect(막).toBeVisible();
  await releaseCommand(page, "archive_work");
  await expect(막).toHaveCount(0);
  await expect
    .poll(async () => (await ipcCallArgs(page, "archive_work", "slug")).map(({ args }) => args))
    .toEqual([{ slug: pinnedWork.slug }, { slug: plainWork.slug }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 막기 (결정 8) ──
// 앱 뿌리가 `contextmenu`를 늘 막는다 — 메뉴가 없는 자리(빈 자리 · 카드 빈 곳 · 창 테두리)는 아무것도 띄우지 않는다. 막혔는지는 사건의
// `defaultPrevented`로 잰다: 창이 사건을 가장 먼저 받는 자리(포착)에서 사건을 쥐어 두고, 사건이 다 돈 뒤에 읽는다 — 대상이 사건을
// 멈춰도(`stopPropagation`) 읽힌다.

test("빈 자리 · 카드 빈 곳 · 머리 줄 회색 · 목록 빈 자리를 우클릭하면 웹뷰 메뉴가 막히고 아무 메뉴도 서지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const head = 머리카드(page);
  await expect(head).toBeVisible();
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { 막힘: boolean[] }).막힘 = seen;
    window.addEventListener("contextmenu", (event) => setTimeout(() => seen.push(event.defaultPrevented)), true);
  });
  const 막힘 = () => page.evaluate(() => (window as unknown as { 막힘: boolean[] }).막힘);

  const card = (await head.boundingBox())!;
  const name = (await head.getByText(pinnedWork.title, { exact: true }).boundingBox())!;
  const badge = (await head.getByRole("button", { name: pinnedWork.status, exact: true }).boundingBox())!;
  const list = (await page.locator("[data-worklist]").boundingBox())!;
  const lastRow = (await page.locator("[data-work-row]").last().boundingBox())!;
  const nav = (await navButton(page, "Projects").boundingBox())!;
  const bar = (await page.locator("[data-slot=path-bar]").first().boundingBox())!;
  const viewport = page.viewportSize()!;
  const spots: Array<[string, number, number]> = [
    ["머리 줄 오른쪽 회색", viewport.width - 4, card.y + card.height / 2],
    ["머리 카드 안 빈 자리", (name.x + name.width + badge.x) / 2, card.y + card.height / 2],
    // 문서 카드의 빈 곳은 경로 줄의 가운데다 — 카드의 몸은 문서가 서면 문서 글이라 제 메뉴가 선다(`target-menus.spec.ts`).
    ["문서 카드 경로 줄 빈 자리", bar.x + bar.width / 2, bar.y + bar.height / 2],
    ["사이드바 nav 항목", nav.x + nav.width / 2, nav.y + nav.height / 2],
    // 목록 안이지만 행이 아닌 자리 — 목록이 대상을 찾지 못해 메뉴를 안 연다.
    ["목록 빈 자리", list.x + list.width / 2, list.y + list.height - 6],
  ];
  // 앵커: 목록 빈 자리는 마지막 행 아래이고 목록 안이다 — 행에 떨어지거나 밖으로 새면 「목록이 대상을 못 찾는다」가 아무것도 안 잰다.
  expect(list.y + list.height - 6).toBeGreaterThan(lastRow.y + lastRow.height);
  // 앵커: 경로 줄의 가운데는 경로 칩 · 버튼 · 문서 글 어느 것도 아니다 — 거기 떨어지면 「빈 곳」을 안 잰다.
  expect(
    await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("button, a, [data-doc-text]") === null,
      [bar.x + bar.width / 2, bar.y + bar.height / 2],
    ),
  ).toBe(true);

  for (const [, x, y] of spots) {
    await page.mouse.click(x, y, { button: "right" });
  }
  await expect.poll(async () => (await 막힘()).length).toBe(spots.length);
  expect(await 막힘()).toEqual(spots.map(() => true));
  await expect(메뉴(page)).toHaveCount(0);
  await expect(page).toHaveURL(`/works/${pinnedWork.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
