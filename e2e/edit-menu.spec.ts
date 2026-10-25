import { expect, test, type Locator, type Page } from "./evidence";
import {
  awaitSpawned,
  callCount,
  clipboardWrites,
  installFixtureBackend,
  ipcCallArgs,
  ipcFailure,
  recordClipboard,
  unknownIpcCalls,
  workRow,
  writeShell,
  검색어칸,
  검색팔레트를연다,
  끌어놓는다,
  다떴다,
  화면머리,
  셸입력,
  줄차례,
  클립보드를심는다,
  테두리,
  토큰색,
  행버튼,
} from "./harness";
import { PROJECTS, WORKS } from "./fixtures";

const [pinnedWork, plainWork] = WORKS;
const [billing] = PROJECTS;

// codex-ds 티켓 31 — **입력칸 · 터미널에서 우리 편집 메뉴가 뜬다**(codex-ds 스펙 §9 · S9 · 구현 노트 Q12 · Q17). 우클릭하면 웹뷰의 기본
// 메뉴 대신 앱의 편집 메뉴가 커서 자리에 선다.
// - 입력칸(검색칸 · 설정 글상자 · 모달 창 안의 팔레트 검색어 칸 — 앱의 `input` · `textarea`): 잘라내기 · 복사 · 붙여넣기 · 모두 고르기.
//   고른 글자가 없으면 잘라내기 · 복사가 흐리다.
// - 터미널: 복사 · 붙여넣기 · 모두 고르기 — 화면 지우기 — 셸 닫기. 셸 닫기는 ⌘W · `×`와 같은 닫기 흐름(도는 것 확인)이다.
// 단축키 칸은 단축키 표의 글자다. 붙여넣기는 클립보드 플러그인으로 읽고(이 층에서는 fixture가 답한다 — `클립보드를심는다`), 복사 ·
// 잘라내기는 웹 클립보드에 쓴다(`recordClipboard`가 받아 적는다).
// 입력칸은 work 대상(`work-context-menu.spec.ts`)과 같은 대상이다 — 열린 동안 그 칸이 포커스 링을 입는 자리에 대상 테두리가 서고,
// 포커스된 칸에서 ⇧F10 · 메뉴 키가 같은 메뉴를 그 칸의 왼쪽 아래에 연다. 터미널에서 그 키는 셸로 간다.
//
// **고름은 검사가 만든다** — macOS WebKit은 우클릭한 낱말을 스스로 고르고(입력칸은 WebKit이, 터미널은 xterm의 `rightClickSelectsWord`가)
// 리눅스 WebKit은 안 고른다. 그래서 빈 칸 · 셸의 빈 줄을 우클릭하거나, 고름을 먼저 만들고 **그 고름 안을** 우클릭한다 — 두 기계에서 같은
// 고름이다. 메뉴는 연 순간의 고름으로 선다.

const 메뉴 = (page: Page) => page.getByRole("menu");
const 항목 = (page: Page, name: string) => 메뉴(page).getByRole("menuitem", { name, exact: true });

/** 입력칸 메뉴의 줄 — 이름 뒤가 단축키 칸의 글자다(단축키 표의 `cut` · `copy` · `paste` · `selectAll`). */
const 입력칸차례 = ["잘라내기⌘X", "복사⌘C", "붙여넣기⌘V", "모두 고르기⌘A"];
/** 터미널 메뉴의 줄 — 편집 셋 — 화면 지우기(단축키가 없다 — ⌘K는 검색이다) — 셸 닫기(표의 `closeShell`). */
const 터미널차례 = ["복사⌘C", "붙여넣기⌘V", "모두 고르기⌘A", "—", "화면 지우기", "—", "셸 닫기⌘W"];

/** 줄마다의 `aria-keyshortcuts` — 스크린리더가 듣는 키다. 단축키가 없는 줄은 `null`이다. */
const 단축키값 = (menu: Locator) =>
  menu.getByRole("menuitem").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-keyshortcuts")));

/**
 * 우클릭이 남긴 것을 받아 적기 시작한다 — 웹뷰 메뉴가 막혔나(사건의 `defaultPrevented` — 창이 가장 먼저 받는 자리에서 쥐어 두고 사건이
 * 다 돈 뒤에 읽는다)와 **오른쪽 버튼의 놓음이 document까지 닿았나**(codex-ds 결정 15 메모 — 놓음을 못 받으면 xterm의 끌기 리스너가 남는다).
 * 적는 것은 웹뷰가 낸 사건뿐이다(`isTrusted`) — 편집 메뉴가 제 숨은 Trigger에 대신 내는 우클릭(`EditMenu`)은 웹뷰 메뉴를 띄우지 않는다.
 */
async function 우클릭을적는다(page: Page) {
  await page.evaluate(() => {
    const seen = { blocked: [] as boolean[], ups: 0 };
    (window as unknown as { 우클릭: typeof seen }).우클릭 = seen;
    window.addEventListener(
      "contextmenu",
      (event) => {
        if (event.isTrusted) setTimeout(() => seen.blocked.push(event.defaultPrevented));
      },
      true,
    );
    document.addEventListener("mouseup", (event) => {
      if (event.button === 2) seen.ups += 1;
    });
  });
}
const 우클릭 = (page: Page) =>
  page.evaluate(() => (window as unknown as { 우클릭: { blocked: boolean[]; ups: number } }).우클릭);

/** 입력칸의 글자가 시작하는 자리(칸의 왼쪽 안쪽 여백 · 테두리를 지난 곳) — 앞머리를 고른 뒤 그 고름 안을 우클릭하는 데 쓴다. */
async function 글자첫자리(field: Locator) {
  const box = (await field.boundingBox())!;
  const inset = await field.evaluate((el) => {
    const style = getComputedStyle(el);
    return parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
  });
  return { x: box.x + inset + 3, y: box.y + Math.min(box.height / 2, 12) };
}

/** 그 칸의 고름을 `[start, end)`로 만든다 — 포커스를 주고 고른다. */
const 고른다 = (field: Locator, start: number, end: number) =>
  field.evaluate(
    (el, [from, to]) => {
      const input = el as HTMLInputElement;
      input.focus();
      input.setSelectionRange(from, to);
    },
    [start, end] as const,
  );
const 고름 = (field: Locator) =>
  field.evaluate((el) => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd]);

// ── 입력칸 ──

/**
 * 메뉴를 받는 칸들. `ring`은 대상 테두리가 서는 자리 — 그 칸이 포커스 링을 입는 자리다. 검색칸은 감싼 상자가 입고(`InputGroup`),
 * 링을 두지 않는 칸(팔레트의 입력 줄)은 `null`이다. 칸은 **메뉴가 열린 동안에도 찾는다**(`includeHidden`) — 메뉴가 열리면 부품이
 * 바깥을 보조 기술에서 숨겨(`aria-hidden`) 역할로는 칸이 안 잡힌다. 열린 동안 칸의 자리 · 테두리 · 포커스를 재야 한다.
 */
const 입력칸들: Array<{ name: string; setUp: (page: Page) => Promise<Locator>; ring: (field: Locator) => Locator | null }> = [
  {
    name: "Archive의 검색칸",
    ring: (field) => field.locator(".."),
    setUp: async (page) => {
      await page.goto("/archive/shipped-work");
      const field = page.getByRole("textbox", { name: "아카이브 검색", exact: true, includeHidden: true });
      await expect(field).toBeVisible();
      return field;
    },
  },
  {
    name: "설정의 글상자",
    ring: (field) => field,
    setUp: async (page) => {
      // 글상자는 설정 화면의 맨 아래라 기본 창에서는 창 아래 끝에 붙는다 — 그 자리를 우클릭하면 카드가 창 안에 들려고 위로 비켜
      // 서서 「커서 자리」를 잴 수 없다. 창을 키워 카드가 설 자리를 준다.
      await page.setViewportSize({ width: 1280, height: 960 });
      await page.goto("/settings/terminal");
      const field = page.getByRole("textbox", { name: "셸을 닫아도 남길 프로세스", exact: true, includeHidden: true });
      // 목록이 오기 전에는 칸이 꺼져 있다(`disabled`) — 꺼진 칸은 우클릭을 받지 않는다.
      await expect(field).toBeEnabled();
      return field;
    },
  },
  {
    // 모달 창 안의 칸 — 메뉴 카드는 창 밖(body 끝의 포털)에 서는데, 창의 포커스 가둠이 그 카드를 밀어내지 않아야 한다.
    name: "검색 팔레트의 검색어 칸",
    // 검색 팔레트의 입력 줄은 링을 두지 않는다 — 카드가 떠 있는 동안 포커스가 늘 그 칸에 있다(Input의 `bare`).
    ring: () => null,
    setUp: async (page) => {
      await page.goto("/archive/shipped-work");
      await expect(page.getByRole("textbox", { name: "아카이브 검색", exact: true })).toBeVisible();
      await 검색팔레트를연다(page);
      const palette = page.getByRole("dialog", { name: "검색", includeHidden: true });
      const field = palette.getByRole("textbox", { name: "검색어", exact: true, includeHidden: true });
      // 창이 다 뜬 뒤에 잰다 — 뜨는 동안은 창이 커지며 칸이 움직여, 그 사이에 연 메뉴의 자리와 다 뜬 칸의 자리가 어긋난다.
      await palette.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((one) => one.finished.catch(() => undefined))),
      );
      return field;
    },
  },
];

for (const { name, setUp, ring } of 입력칸들) {
  test(`${name}을 우클릭하면 편집 메뉴가 커서 자리에 서고, 고른 글자가 없으면 잘라내기 · 복사가 흐리다 — 열린 동안 대상 테두리가 선다`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    const field = await setUp(page);
    const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
    await field.fill("");
    await 우클릭을적는다(page);
    const box = (await field.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 12) };

    await page.mouse.click(at.x, at.y, { button: "right" });

    const menu = 메뉴(page);
    await expect(menu).toBeVisible();
    expect(await 줄차례(menu)).toEqual(입력칸차례);
    expect(await 단축키값(menu)).toEqual(["Meta+X", "Meta+C", "Meta+V", "Meta+A"]);
    await expect(항목(page, "잘라내기")).toBeDisabled();
    await expect(항목(page, "복사")).toBeDisabled();
    await expect(항목(page, "붙여넣기")).toBeEnabled();
    await expect(항목(page, "모두 고르기")).toBeEnabled();
    // 카드의 왼쪽 위가 커서 자리다 — 대상 메뉴와 같은 바탕(`ContextMenuContent`)이다.
    await 다떴다(menu);
    const card = (await menu.boundingBox())!;
    expect(Math.abs(card.x - at.x), "카드가 커서 자리에 안 섰다").toBeLessThan(2);
    expect(Math.abs(card.y - at.y), "카드가 커서 자리에 안 섰다").toBeLessThan(2);
    // 웹뷰 메뉴는 막혔고, 오른쪽 버튼의 놓음은 document까지 닿았다.
    await expect.poll(async () => (await 우클릭(page)).blocked).toEqual([true]);
    expect((await 우클릭(page)).ups).toBe(1);
    // 열린 동안 포커스는 카드에 있고, 그 칸이 링을 입는 자리에 대상 테두리가 선다(결정 11). 링을 두지 않는 칸에는 없다.
    await expect(field).not.toBeFocused();
    const 자리 = ring(field);
    if (자리) await expect.poll(() => 테두리(자리)).toBe(링);
    else expect(await 테두리(field)).toBeNull();

    // Esc는 메뉴만 닫고 포커스를 그 칸으로 돌려준다 — 팔레트(모달 창)도 그대로 떠 있다. 대상 표식은 걷힌다.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(field).toBeFocused();
    await expect(field).not.toHaveAttribute("data-menu-target");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  for (const key of ["Shift+F10", "ContextMenu"]) {
    test(`${name}에 포커스를 두고 ${key}를 누르면 편집 메뉴가 그 칸의 왼쪽 아래에 서고 ↓가 첫 줄에 간다`, async ({ page }) => {
      await installFixtureBackend(page);
      const field = await setUp(page);
      const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
      await field.fill("abc");
      await 고른다(field, 0, 3);

      await page.keyboard.press(key);
      const menu = 메뉴(page);
      await expect(menu).toBeVisible();
      expect(await 줄차례(menu)).toEqual(입력칸차례);
      for (const one of ["잘라내기", "복사", "붙여넣기", "모두 고르기"]) await expect(항목(page, one)).toBeEnabled();
      // 커서가 없으니 칸의 왼쪽 아래에 선다 — 대상 메뉴와 같은 자리다(`openMenuByKey`).
      await 다떴다(menu);
      const spot = (await field.boundingBox())!;
      const card = (await menu.boundingBox())!;
      // 키로 연 메뉴도 대상의 왼쪽 아래를 정수 픽셀로 받는다(`openMenuByKey`가 쏘는 `MouseEvent`의 자리) — 흰 판의 테두리(0.5) 뒤로
      // 대상이 반 픽셀에 서서 카드는 그 아래 정수에 선다(`shell-tab-menu.spec.ts`와 같은 잣대).
      expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.floor(spot.x), Math.floor(spot.y + spot.height)]);
      const 자리 = ring(field);
      if (자리) await expect.poll(() => 테두리(자리)).toBe(링);

      // 카드 자신이 포커스를 쥐고, 그 뒤의 ↓가 첫 줄이다 — ⋯를 눌러 연 것과 같다.
      await expect(menu).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(항목(page, "잘라내기")).toBeFocused();

      // Esc는 메뉴만 닫고 포커스를 그 칸으로 돌려준다 — 고름도 그대로다.
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(field).toBeFocused();
      expect(await 고름(field)).toEqual([0, 3]);
      await expect(field).not.toHaveAttribute("data-menu-target");
      expect(await unknownIpcCalls(page)).toEqual([]);
    });
  }
}

test("입력칸 메뉴가 고른 글자를 복사하고 잘라 내고, 클립보드의 글자를 붙여 넣고, 모두 고른다 — 화면의 상태가 칸의 값을 따라온다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await recordClipboard(page);
  await installFixtureBackend(page);
  await page.goto("/archive/shipped-work");
  const field = page.getByRole("textbox", { name: "아카이브 검색", exact: true });
  // 목록의 두 아카이브 — 검색어가 무엇을 남기는지가 「화면의 상태(검색어)가 칸의 값을 따라왔다」를 말한다. 머리 띠에도 보는 아카이브의
  // 이름이 서므로 목록 안에서 찾는다.
  const 목록 = page.getByRole("region", { name: "아카이브 목록", exact: true });
  const 치운일 = 목록.getByText("치운 일", { exact: true });
  const 남은것 = 목록.getByText("문서가 남지 않은 것", { exact: true });
  await field.fill("zzz치운");
  await expect(치운일).toHaveCount(0);
  await expect(남은것).toHaveCount(0);
  const 첫자리 = await 글자첫자리(field);

  // 복사 — 고른 앞머리를 클립보드에 쓰고, 칸은 그대로다.
  await 고른다(field, 0, 3);
  await page.mouse.click(첫자리.x, 첫자리.y, { button: "right" });
  await expect(항목(page, "복사")).toBeEnabled();
  await 항목(page, "복사").click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect.poll(() => clipboardWrites(page)).toEqual(["zzz"]);
  await expect(field).toHaveValue("zzz치운");
  await expect(field).toBeFocused();
  // 고름도 그대로다 — 복사는 칸을 건드리지 않는다.
  expect(await 고름(field)).toEqual([0, 3]);

  // 잘라내기 — 고른 앞머리를 쓰고 칸에서 지운다. 남은 「치운」이 검색어가 되어 목록이 「치운 일」 하나로 좁혀진다.
  await 고른다(field, 0, 3);
  await page.mouse.click(첫자리.x, 첫자리.y, { button: "right" });
  await 항목(page, "잘라내기").click();
  await expect.poll(() => clipboardWrites(page)).toEqual(["zzz", "zzz"]);
  await expect(field).toHaveValue("치운");
  await expect(치운일).toBeVisible();
  await expect(남은것).toHaveCount(0);

  // 붙여넣기 — 클립보드 플러그인으로 읽은 글자가 고름을 갈아 끼운다.
  await 클립보드를심는다(page, "문서가");
  await 고른다(field, 0, 2);
  await page.mouse.click(첫자리.x, 첫자리.y, { button: "right" });
  await 항목(page, "붙여넣기").click();
  await expect(field).toHaveValue("문서가");
  await expect(남은것).toBeVisible();
  await expect(치운일).toHaveCount(0);
  expect(await callCount(page, "plugin:clipboard-manager|read_text")).toBe(1);
  await expect(field).toBeFocused();

  // 모두 고르기.
  await 고른다(field, 3, 3);
  await page.mouse.click(첫자리.x, 첫자리.y, { button: "right" });
  await 항목(page, "모두 고르기").click();
  await expect(field).toBeFocused();
  await expect.poll(() => 고름(field)).toEqual([0, 3]);

  // 클립보드가 비었거나 글자가 아니면 플러그인이 거절한다 — 칸은 그대로이고 아무것도 새지 않는다.
  await 클립보드를심는다(page, ipcFailure("The clipboard contents were not available in the requested format or the clipboard is empty."));
  await page.mouse.click(첫자리.x, 첫자리.y, { button: "right" });
  await 항목(page, "붙여넣기").click();
  await expect.poll(() => callCount(page, "plugin:clipboard-manager|read_text")).toBe(2);
  await expect(field).toHaveValue("문서가");

  // 클립보드 쓰기가 거절되면 잘라내기는 칸의 글자를 지우지 않는다 — 지운 글자가 클립보드에도 칸에도 없게 되지 않는다.
  await page.evaluate(() => {
    const refused: string[] = [];
    (window as unknown as { 거절한쓰기: string[] }).거절한쓰기 = refused;
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: (text: string) => {
        refused.push(text);
        return Promise.reject(new DOMException("쓰기 거절", "NotAllowedError"));
      },
    });
  });
  await 고른다(field, 0, 2);
  await page.mouse.click(첫자리.x, 첫자리.y, { button: "right" });
  await 항목(page, "잘라내기").click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { 거절한쓰기: string[] }).거절한쓰기)).toEqual(["문서"]);
  // 거절이 돌아온 뒤에 바로 읽는다 — 기다리며 재면 지웠다가 되돌린 것도 지나간다.
  expect(await field.inputValue()).toBe("문서가");
  await expect(field).toBeFocused();
  expect(errors).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("검색 팔레트의 검색어 칸에서 메뉴로 복사 · 붙여넣기를 하면 팔레트가 떠 있고, 글자가 그 칸에 들고, 포커스가 그 칸에 남는다", async ({
  page,
}) => {
  // 메뉴 카드는 팔레트(모달 창) 밖 — body 끝의 포털 — 에 선다. 그 카드의 줄을 눌러도 창이 「바깥을 눌렀다」로 닫히지 않아야 한다.
  await recordClipboard(page);
  await installFixtureBackend(page);
  await page.goto("/archive/shipped-work");
  await expect(page.getByRole("textbox", { name: "아카이브 검색", exact: true })).toBeVisible();
  await 검색팔레트를연다(page);
  const palette = page.getByRole("dialog", { name: "검색" });
  const field = 검색어칸(palette);
  await field.fill("abc치운");
  const 첫자리 = await 글자첫자리(field);

  // 복사 — 고른 앞머리를 클립보드에 쓰고, 칸 · 고름은 그대로다.
  await 고른다(field, 0, 3);
  await page.mouse.click(첫자리.x, 첫자리.y, { button: "right" });
  await 항목(page, "복사").click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect.poll(() => clipboardWrites(page)).toEqual(["abc"]);
  await expect(palette).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("abc치운");
  expect(await 고름(field)).toEqual([0, 3]);

  // 붙여넣기 — 클립보드 플러그인으로 읽은 글자가 고름을 갈아 끼운다.
  await 클립보드를심는다(page, "치운 일");
  await 고른다(field, 0, 5);
  await page.mouse.click(첫자리.x, 첫자리.y, { button: "right" });
  await 항목(page, "붙여넣기").click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect(field).toHaveValue("치운 일");
  await expect(palette).toBeVisible();
  await expect(field).toBeFocused();
  expect(await 고름(field)).toEqual([4, 4]);
  expect(await callCount(page, "plugin:clipboard-manager|read_text")).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 이름을 고치는 칸 ──

// 제자리 이름 바꾸기의 입력칸(`InlineRename`, 티켓 28)도 입력칸이다. 그 칸은 대상 메뉴(work · 프로젝트)의 자리에 선다 — 사이드바 행 ·
// 프로젝트 목록 행의 칸은 행의 우클릭을 받는 목록 안이고, 머리 줄의 칸은 메뉴를 단 이름 자리를 갈아 끼운 것이다. 그래도 우클릭 ·
// ⇧F10은 그 대상의 메뉴가 아니라 편집 메뉴를 열고, 메뉴가 포커스를 쥐어도 고치기는 끝나지 않는다(「다른 곳 = 저장」이 아니다) — 닫히면
// 포커스가 고름째 그 칸으로 돌아와 이어 고친다. 픽스처의 이름 저장은 바뀐 이름을 기억하지 않아 저장은 나간 IPC로 잰다
// (`inline-rename.spec.ts`).
//
// work의 두 칸은 대상 메뉴(`WorkContextMenu`)의 자리다 — 그 자리의 가름도 이 칸을 대상으로 치지 않는다. 그 가름이 넓어지는 날 이 칸을
// 지키는 것이 자리의 물러섬(`opensEditMenu`)이고, 이 검사가 그날 빨개진다. Project 상세 제목(03 구현 스펙 §16)은 대상 메뉴가 없는 자리다 —
// 한때 프로젝트 목록 행 · 머리 줄 이름이 대상 메뉴(`TargetMenu`)를 단 이름 칸이었다(03 결정 「10」이 걷었다).

const 이름칸들: Array<{
  name: string;
  /** 그 칸이 서는 화면. */
  url: string;
  /** 칸 밖의 그 자리에서 서는 대상 메뉴 — 이 칸에서는 안 선다. 그 자리에 대상 메뉴가 없으면 `null`이다. */
  menu: "work" | null;
  /** 고치는 이름의 work · 프로젝트. */
  slug: string;
  /** 이름 저장 — 나가는 IPC와 이름이 실리는 인자(`slug` 옆). */
  save: { command: string; key: string };
  setUp: (page: Page) => Promise<Locator>;
  /** 대상 테두리가 서는 자리 — 그 칸이 포커스 링을 입는 자리다. */
  ring: (field: Locator) => Locator;
}> = [
  {
    name: "사이드바 행",
    url: `/works/${plainWork.slug}`,
    menu: "work",
    slug: pinnedWork.slug,
    save: { command: "set_work_title", key: "title" },
    ring: (field) => field,
    setUp: async (page) => {
      await 행버튼(page, pinnedWork.title).focus();
      await page.keyboard.press("F2");
      return workRow(page, pinnedWork.slug).getByRole("textbox", { name: "작업 이름", exact: true, includeHidden: true });
    },
  },
  {
    name: "머리 줄 이름",
    url: `/works/${plainWork.slug}`,
    menu: "work",
    slug: plainWork.slug,
    save: { command: "set_work_title", key: "title" },
    // 글자 폭 칸은 입력칸과 짝을 든 상자가 링을 입는다(`InlineRename`의 `text`).
    ring: (field) => field.locator(".."),
    setUp: async (page) => {
      await 화면머리(page).getByText(plainWork.title, { exact: true }).dblclick();
      return 화면머리(page).getByRole("textbox", { name: "작업 이름", exact: true, includeHidden: true });
    },
  },
  {
    name: "Project 상세 제목",
    url: `/projects/${billing.slug}`,
    menu: null,
    slug: billing.slug,
    save: { command: "update_project", key: "name" },
    // 글자 폭 칸이다(`InlineRename`의 `text`) — 짝을 든 상자가 링을 입는다.
    ring: (field) => field.locator(".."),
    setUp: async (page) => {
      await page.getByRole("button", { name: `${billing.name} — 이름 바꾸기`, exact: true }).click();
      return page.getByRole("main").getByRole("textbox", { name: "Project 이름", exact: true, includeHidden: true });
    },
  },
];

/** 편집 메뉴를 여는 두 길 — 고름 안의 우클릭(두 기계에서 같은 고름이다 — 위 머리말), 포커스된 칸의 ⇧F10. */
const 여는길: Array<{ how: string; open: (page: Page, field: Locator) => Promise<void> }> = [
  {
    how: "우클릭하",
    open: async (page, field) => {
      const at = await 글자첫자리(field);
      await page.mouse.click(at.x, at.y, { button: "right" });
    },
  },
  { how: "⇧F10을 누르", open: (page) => page.keyboard.press("Shift+F10") },
];

for (const { name, url, menu: 대상메뉴, slug, save, setUp, ring } of 이름칸들) {
  for (const { how, open } of 여는길) {
    test(`${name}을 고치는 칸에서 ${how}면 ${대상메뉴 ? `${대상메뉴} 메뉴가 아니라 ` : ""}편집 메뉴가 서고 고치기가 이어진다 — 메뉴로 붙인 이름을 Enter가 저장한다`, async ({
      page,
    }) => {
      await installFixtureBackend(page);
      await page.goto(url);
      const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
      const field = await setUp(page);
      await expect(field).toBeFocused();
      await field.fill("abc def");
      await 고른다(field, 0, 3);

      await open(page, field);
      const menu = 메뉴(page);
      await expect(menu).toBeVisible();
      // 선 메뉴는 편집 메뉴 하나다 — 그 대상의 메뉴(이름 바꾸기 · 고정 · 제거 …)는 안 선다.
      await expect(menu).toHaveCount(1);
      expect(await 줄차례(menu)).toEqual(입력칸차례);
      for (const one of ["잘라내기", "복사", "붙여넣기", "모두 고르기"]) await expect(항목(page, one)).toBeEnabled();
      // 고치기는 끝나지 않았다 — 칸이 친 글자째 남고, 그 칸이 대상 테두리를 입고, 아무것도 저장하지 않았다.
      await expect(field).toHaveValue("abc def");
      await expect.poll(() => 테두리(ring(field))).toBe(링);
      expect(await callCount(page, save.command)).toBe(0);
      // 카드가 포커스를 쥐었다 — 그래야 아래 Esc가 카드의 것이다. 칸에 포커스가 남은 채 누르면 Esc는 이름 고치기를 취소하는 칸의 키라
      // 고치기만 접히고 메뉴가 남는다(리눅스 CI에서 한 번 본 모양 — 그 판의 스냅숏은 칸이 걷히고 행에 포커스가 선 채 메뉴가 떠 있었다).
      await expect(menu).toBeFocused();

      // Esc는 메뉴만 닫는다 — 포커스가 그 칸으로 돌아오고 고름도 그대로다(들어설 때의 「전부 고름」이 다시 덮지 않는다).
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(field).toBeFocused();
      expect(await 고름(field)).toEqual([0, 3]);
      await expect(field).not.toHaveAttribute("data-menu-target");

      // 메뉴의 붙여넣기가 그 칸의 고름을 갈아 끼우고, Enter가 고치던 work에 저장한다.
      await 클립보드를심는다(page, "고친");
      await open(page, field);
      await 항목(page, "붙여넣기").click();
      await expect(menu).toHaveCount(0);
      await expect(field).toHaveValue("고친 def");
      await expect(field).toBeFocused();
      expect(await callCount(page, save.command)).toBe(0);
      await page.keyboard.press("Enter");
      await expect(field).toHaveCount(0);
      await expect
        .poll(async () => (await ipcCallArgs(page, save.command, save.key)).map(({ args }) => args))
        .toEqual([{ slug, [save.key]: "고친 def" }]);
      expect(await unknownIpcCalls(page)).toEqual([]);
    });
  }
}

test("이름을 고치는 칸의 편집 메뉴 밖을 누르면 메뉴만 닫히고 고치기가 이어진다 — 포커스가 메뉴에서 칸이 아닌 곳으로 가면 그때 저장한다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const 이름칸 = 이름칸들.find((one) => one.slug === plainWork.slug)!;
  const field = await 이름칸.setUp(page);
  await field.fill("바깥 이름");
  /** 본문 카드 안의 빈 점 — 누르는 자리가 없는 곳이다(`inline-rename.spec.ts`의 「다른 곳」). 메뉴가 열린 동안은 역할로 안 잡힌다. */
  const 본문빈곳 = async () => {
    const box = (await page.locator("main").last().boundingBox())!;
    await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
  };

  // 메뉴 밖의 누름은 메뉴를 닫을 뿐이다 — 포커스가 칸으로 돌아와 고치기가 이어진다(메뉴의 `finalFocus`).
  await page.keyboard.press("Shift+F10");
  await expect(메뉴(page)).toBeVisible();
  await 본문빈곳();
  await expect(메뉴(page)).toHaveCount(0);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("바깥 이름");
  expect(await callCount(page, "set_work_title")).toBe(0);

  // 메뉴가 열린 채 다른 것이 포커스를 가져가면(⌘K의 검색 팔레트) 그것이 「다른 곳」이다 — 친 이름을 고치던 work에 저장한다.
  await page.keyboard.press("Shift+F10");
  await expect(메뉴(page)).toBeVisible();
  await page.keyboard.press("Meta+k");
  const 팔레트 = page.getByRole("dialog", { name: "검색", includeHidden: true });
  await expect(팔레트.getByRole("textbox", { name: "검색어", exact: true, includeHidden: true })).toBeFocused();
  await expect(field).toHaveCount(0);
  await expect
    .poll(async () => (await ipcCallArgs(page, "set_work_title", "title")).map(({ args }) => args))
    .toEqual([{ slug: plainWork.slug, title: "바깥 이름" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 셸 이름을 고치는 칸 ──

// 셸 탭의 제자리 이름 바꾸기(티켓 29)도 같은 칸이다. 그 칸은 셸 탭 메뉴의 대상(탭 칸) 안에 선다 — 그래도 우클릭 · ⇧F10은 셸 탭 메뉴가
// 아니라 편집 메뉴를 열고 고치기가 이어진다. 붙인 이름은 메모리에만 살아(IPC가 없다) 저장은 탭 글자로 잰다.

for (const { how, open } of 여는길) {
  test(`셸 이름을 고치는 칸에서 ${how}면 셸 탭 메뉴가 아니라 편집 메뉴가 서고 고치기가 이어진다 — 메뉴로 붙인 이름을 Enter가 저장한다`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${plainWork.slug}?tab=terminal`);
    await awaitSpawned(page, 1);
    const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
    const cell = page.locator('[data-tab="shell"]').first();
    const 이름 = cell.locator("button[aria-pressed]");
    await 이름.focus();
    await page.keyboard.press("F2");
    const field = cell.getByRole("textbox", { name: "셸 이름", exact: true, includeHidden: true });
    await expect(field).toBeFocused();
    await field.fill("abc def");
    await 고른다(field, 0, 3);

    await open(page, field);
    const menu = 메뉴(page);
    await expect(menu).toBeVisible();
    // 선 메뉴는 편집 메뉴 하나다 — 셸 탭 메뉴(이름 바꾸기 · 닫기 …)는 안 선다.
    await expect(menu).toHaveCount(1);
    expect(await 줄차례(menu)).toEqual(입력칸차례);
    // 고치기는 끝나지 않았다 — 칸이 친 글자째 남고, 대상 테두리는 그 칸이 입는다(탭 칸이 아니다).
    await expect(field).toHaveValue("abc def");
    await expect.poll(() => 테두리(field)).toBe(링);
    expect(await 테두리(cell)).toBeNull();

    // Esc는 메뉴만 닫는다 — 포커스가 고름째 그 칸으로 돌아온다.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(field).toBeFocused();
    expect(await 고름(field)).toEqual([0, 3]);
    await expect(field).not.toHaveAttribute("data-menu-target");

    // 메뉴의 붙여넣기가 그 칸의 고름을 갈아 끼우고, Enter가 그 셸의 이름으로 세운다.
    await 클립보드를심는다(page, "고친");
    await open(page, field);
    await 항목(page, "붙여넣기").click();
    await expect(menu).toHaveCount(0);
    await expect(field).toHaveValue("고친 def");
    await expect(field).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(field).toHaveCount(0);
    await expect(이름).toHaveText("고친 def");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// ── 터미널 ──

const 셸칸 = (page: Page) => page.locator('[data-tab="shell"]');
const 셸화면 = (page: Page) => page.locator(".xterm-screen");

/** 셸 하나를 띄우고 글자 두 줄을 그린다 — 지난 줄과, 커서가 선 줄(프롬프트)이다. */
async function 셸을띄운다(page: Page) {
  await recordClipboard(page);
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await writeShell(page, "hello shell\r\nprompt$ ");
  await expect(셸화면(page)).toBeVisible();
}

/**
 * 셸 화면 가운데의 빈 줄을 우클릭해 메뉴를 연다 — 낱말이 없는 자리라 macOS의 우클릭 낱말 고름도 아무것도 안 고른다(글자는 위의 두
 * 줄뿐이다). 맨 아래가 아닌 것은 카드가 설 자리를 두려는 것이다 — 창 아래 끝에 붙은 자리면 카드가 창 안에 들려고 위로 비켜 서서
 * 「커서 자리」를 잴 수 없다. 우클릭한 자리를 돌려준다.
 */
async function 셸을우클릭한다(page: Page) {
  const box = (await 셸화면(page).boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(메뉴(page)).toBeVisible();
  return at;
}

/** 셸의 글자 전부 — 메뉴의 모두 고르기 · 복사로 클립보드에 쓴 것이다. 빈 줄 끝은 걷는다. */
async function 셸글자(page: Page) {
  await 셸을우클릭한다(page);
  await 항목(page, "모두 고르기").click();
  await 셸을우클릭한다(page);
  await 항목(page, "복사").click();
  const written = await clipboardWrites(page);
  return written[written.length - 1]?.trimEnd();
}

test("터미널을 우클릭하면 터미널 메뉴가 커서 자리에 서고, 고른 글자가 없으면 복사가 흐리다 — 두 번째 우클릭도 같다", async ({ page }) => {
  await 셸을띄운다(page);
  await 우클릭을적는다(page);

  for (const 번째 of [1, 2]) {
    // 두 번째부터는 우클릭이 xterm의 숨은 입력칸(`textarea`)에 떨어진다 — xterm이 그것을 커서 밑으로 옮겨 둔다. 그래도 입력칸 메뉴가
    // 아니라 터미널 메뉴다.
    const at = await 셸을우클릭한다(page);
    const menu = 메뉴(page);
    expect(await 줄차례(menu), `${번째}번째 우클릭`).toEqual(터미널차례);
    expect(await 단축키값(menu)).toEqual(["Meta+C", "Meta+V", "Meta+A", null, "Meta+W"]);
    await expect(항목(page, "복사")).toBeDisabled();
    for (const name of ["붙여넣기", "모두 고르기", "화면 지우기", "셸 닫기"]) await expect(항목(page, name)).toBeEnabled();
    // 카드의 왼쪽 위가 커서 자리다 — 입력칸 메뉴와 같다.
    await 다떴다(menu);
    const card = (await menu.boundingBox())!;
    expect(Math.abs(card.x - at.x), `${번째}번째 우클릭 — 카드가 커서 자리에 안 섰다`).toBeLessThan(2);
    expect(Math.abs(card.y - at.y), `${번째}번째 우클릭 — 카드가 커서 자리에 안 섰다`).toBeLessThan(2);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    // 닫히면 포커스가 셸로 돌아간다 — 그대로 이어 칠 수 있다.
    await expect(셸입력(page)).toBeFocused();
  }
  await expect.poll(async () => (await 우클릭(page)).blocked).toEqual([true, true]);
  expect((await 우클릭(page)).ups).toBe(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("터미널에 포커스가 있으면 ⇧F10은 셸로 가고 편집 메뉴가 안 선다", async ({ page }) => {
  // 셸 안의 프로그램이 받는 키다(`keyRoute`) — 입력칸의 ⇧F10과 갈린다. xterm이 ⇧F10을 셸에 보내는 바이트가 `CSI 21;2~`다.
  await 셸을띄운다(page);
  await 셸입력(page).focus();
  await page.keyboard.press("Shift+F10");
  await expect
    .poll(async () => (await ipcCallArgs(page, "pty_write", "id")).map(({ args }) => args.data))
    .toContain("\u001b[21;2~");
  await expect(메뉴(page)).toHaveCount(0);
  await expect(셸입력(page)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("터미널 메뉴의 모두 고르기 · 복사가 셸의 글자를 쓰고, 화면 지우기가 프롬프트 줄만 남기고 지운다", async ({ page }) => {
  await 셸을띄운다(page);

  expect(await 셸글자(page)).toBe("hello shell\nprompt$");

  await 셸을우클릭한다(page);
  await 항목(page, "화면 지우기").click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect(셸입력(page)).toBeFocused();

  expect(await 셸글자(page)).toBe("prompt$");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("터미널 메뉴의 붙여넣기가 클립보드의 글자를 셸에 보내고, 그것을 사람 입력으로 적는다", async ({ page }) => {
  await 셸을띄운다(page);
  await 클립보드를심는다(page, "echo 붙임\n");
  expect(await callCount(page, "pty_first_input")).toBe(0);

  await 셸을우클릭한다(page);
  await 항목(page, "붙여넣기").click();

  // 붙여넣기는 xterm의 붙여넣기 길을 탄다 — 줄 바꿈이 Enter(`\r`)가 되어 나간다(사람이 ⌘V로 붙인 것과 같다).
  await expect
    .poll(async () => (await ipcCallArgs(page, "pty_write", "id")).map(({ args }) => args.data))
    .toContain("echo 붙임\r");
  // 셸을 「쓴 셸」로 만든다(프로세스 스펙 S16) — 붙여넣기는 사람 입력이다.
  await expect.poll(() => callCount(page, "pty_first_input")).toBe(1);
  expect(await callCount(page, "plugin:clipboard-manager|read_text")).toBe(1);
  await expect(셸입력(page)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("터미널 메뉴의 셸 닫기가 지금 닫기 흐름을 탄다 — 도는 셸이면 묻고, 닫기를 누르면 닫힌다", async ({ page }) => {
  await 셸을띄운다(page);

  await 셸을우클릭한다(page);
  await 항목(page, "셸 닫기").click();

  // 픽스처의 `pty_close_check`가 「명령이 돈다」라 늘 묻는다 — ⌘W · `×`와 같은 확인이다(`tab-keys.spec.ts`).
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();
  await expect(셸칸(page)).toHaveCount(1);
  await ask.getByRole("button", { name: "닫기" }).click();
  await expect(셸칸(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 앱의 다른 메뉴 ──

// **편집 메뉴는 앱의 다른 메뉴를 감싸지 않는다.** 감싸면(우클릭 메뉴의 뿌리가 그 메뉴들의 조상이면) Base UI가 그 밑의 줄을 모두
// 「우클릭 메뉴의 줄」로 쳐서, 버튼을 누른 채 끌어 줄 위에서 놓는 고름이 오른쪽 버튼의 놓음만 받는다 — 왼쪽 버튼으로 끌어 놓으면
// 메뉴가 열린 채 아무것도 안 돈다. ⋯ 메뉴(작업 메뉴)와 상태 메뉴, 두 버튼 메뉴로 잰다.
test("⋯ 메뉴 · 상태 메뉴를 누른 채 끌어 줄 위에서 놓으면 그 줄이 돈다 — 편집 메뉴가 앱의 다른 메뉴를 감싸지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);

  await 끌어놓는다(page, page.getByRole("button", { name: "작업 메뉴", exact: true }), (menu) =>
    menu.getByRole("menuitem", { name: "고정 풀기", exact: true }),
  );
  await expect.poll(async () => (await ipcCallArgs(page, "set_work_pinned", "pinned")).map(({ args }) => args.pinned)).toEqual([false]);

  await 끌어놓는다(page, page.getByRole("button", { name: pinnedWork.status, exact: true }), (menu) =>
    menu.getByRole("menuitemradio", { checked: false }).first(),
  );
  await expect.poll(() => callCount(page, "set_work_status")).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
