import { expect, test, type Locator, type Page } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import {
  awaitSpawned,
  clipboardWrites,
  installFixtureBackend,
  ipcCallArgs,
  kills,
  middle,
  openShell,
  recordClipboard,
  unknownIpcCalls,
  writeShell,
  다떴다,
  띠,
  줄차례,
  칸들,
  이름표,
  테두리,
  토큰색,
} from "./harness";
import { rowOf, settle, squeezedWidth, widenSidebar } from "./tab-row";

// codex-ds 티켓 29 — **셸 탭 · spec 탭을 우클릭하고 셸 탭 이름을 바꾼다**(codex-ds 스펙 §9 · S7 · S8 · 구현 노트 Q8 ~ Q11).
// 셸 탭과 spec 탭이 제 메뉴를 가진 대상이 된다. work 대상(`work-context-menu.spec.ts`)과 같은 잣대다 — 메뉴가 커서 자리에 서고,
// 켜진 탭 · 주소는 그대로이며, 열린 동안만 대상에 대상 테두리(포커스 링)가 선다. ⇧F10 · 메뉴 키는 포커스된 탭의 같은 메뉴를
// 그 탭 곁에 연다. 셸 탭의 이름은 그 자리에서 고친다(F2 · 메뉴 · 두 번 누르기) — 사람이 붙인 이름은 메모리에만 있고(IPC가 없다)
// OSC 타이틀보다 앞서며, 비우면 원래 이름으로 돌아간다.
//
// 메뉴가 열린 동안 바깥을 누르는 검사는 자리를 재고 `page.mouse.click`으로 누른다 — `locator.click()`은 메뉴의 가림막에 막힌다.

const [, plainWork, multiWork] = WORKS;

/** 셸 탭 메뉴의 줄 — 고치기 · 복사 — 닫기 묶음(codex-ds 스펙 §9). 단축키 칸은 단축키 표의 글자다(`rename` · `closeShell`). */
const 셸메뉴차례 = ["이름 바꾸기F2", "작업 폴더 경로 복사", "—", "닫기⌘W", "다른 셸 모두 닫기"];
/** Terminal의 셸 탭 메뉴 — 셸이 데이터 루트에서 떠 「작업 폴더」가 없다(구현 노트 Q10). 해당 없는 줄은 숨긴다. */
const 터미널셸메뉴차례 = ["이름 바꾸기F2", "—", "닫기⌘W", "다른 셸 모두 닫기"];

const 메뉴 = (page: Page) => page.getByRole("menu");
const 항목 = (page: Page, name: string) => 메뉴(page).getByRole("menuitem", { name, exact: true });

/** 맨 앞 문서 칸. */
const 스펙탭 = (page: Page) => page.locator('[data-tab="spec"]');

/** 그 칸의 닫기 버튼 이름 — `<칸 이름> 닫기`다. 칸 이름이 그대로 실려, 칸이 지금 무엇으로 불리는지를 여기서 읽는다. */
const 닫기이름 = (page: Page, at: number) =>
  칸들(page).nth(at).locator('button[aria-label$=" 닫기"]').getAttribute("aria-label");

/** 그 칸의 이름을 고치는 입력칸. 메뉴가 열린 동안에도 찾는다(`includeHidden`). */
const 이름칸 = (page: Page, at: number) =>
  칸들(page).nth(at).getByRole("textbox", { name: "셸 이름", exact: true, includeHidden: true });

const 고른자리 = (input: Locator) =>
  input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);

/** `그냥 일`의 터미널 탭에 셸 둘(pty 1 · 2)을 세운다 — 둘째가 켜지고 첫째는 꺼진 채다. */
async function 셸둘(page: Page) {
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openShell(page);
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "false");
  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "true");
}

/** `두 저장소 일`에서 `+` → ↓ → Enter로 첫 프로젝트의 셸 하나를 세운다(`shell-picker.spec.ts`) — 칸 이름 앞에 프로젝트가 붙는다. */
async function 프로젝트셸(page: Page) {
  await page.goto(`/works/${multiWork.slug}?tab=terminal`);
  const [first] = multiWork.worktrees;
  await page.locator('[data-tab="new"]').click();
  // 메뉴는 「모든 프로젝트」에 포커스를 두고 선다 — 그 뒤의 ↓가 첫 프로젝트다(`shell-picker.spec.ts`).
  await expect(항목(page, "모든 프로젝트")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(항목(page, first.project)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(메뉴(page)).toHaveCount(0);
  await expect(칸들(page)).toHaveCount(1);
  await awaitSpawned(page, 1);
  expect(await 닫기이름(page, 0)).toBe(`${first.project} · ${FIXTURE_SHELL_NAME} 닫기`);
  return first;
}

/** 본문(셸 화면) 안의 한 점을 누른다 — 탭 줄 밖의 「다른 곳」이다. */
async function 셸화면을누른다(page: Page) {
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// ── 셸 탭 메뉴 ──

test("셸 탭을 우클릭하면 셸 탭 메뉴가 커서 자리에 서고, 켜짐 · 주소는 그대로이며 대상 테두리는 연 동안만 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await 셸둘(page);
  const url = page.url();
  const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
  const target = 이름표(page, 0);
  const cell = 칸들(page).nth(0);
  // 전제: 닫혀 있으면 칸에 테두리가 없다 — 처음부터 있으면 「연 동안 선다」가 아무것도 안 잰다.
  expect(await 테두리(cell)).toBeNull();

  await target.click({ button: "right", position: { x: 6, y: 6 } });
  const menu = 메뉴(page);
  await expect(menu).toBeVisible();
  await expect.poll(() => 줄차례(menu)).toEqual(셸메뉴차례);
  // 셸이 둘이라 「다른 셸 모두 닫기」가 켜져 있다.
  for (const name of ["이름 바꾸기", "작업 폴더 경로 복사", "닫기", "다른 셸 모두 닫기"]) await expect(항목(page, name)).toBeEnabled();
  await 다떴다(menu);
  const spot = (await target.boundingBox())!;
  const card = (await menu.boundingBox())!;
  // 커서 자리는 정수 픽셀이다(`MouseEvent`의 `clientX` · `clientY`) — 셸 칸은 앞 칸(`spec` · `chat`)의 글자 폭을 따라 반 픽셀에 설 수
  // 있어 카드는 그 아래 정수에 선다(`spec-layout-page.spec.ts`와 같은 잣대).
  expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.floor(spot.x + 6), Math.floor(spot.y + 6)]);

  // 켜진 탭 · 주소는 그대로다 — 우클릭은 그 셸을 켜지 않는다.
  expect(page.url()).toBe(url);
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "false");
  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "true");
  // 열린 동안 그 칸에 대상 테두리가 선다 — 다른 칸에는 없다.
  await expect.poll(() => 테두리(cell)).toBe(링);
  expect(await 테두리(칸들(page).nth(1))).toBeNull();

  // 바깥을 누르면 닫히고 테두리가 걷힌다.
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width - 8, viewport.height - 8);
  await expect(menu).toHaveCount(0);
  await expect.poll(() => 테두리(cell)).toBeNull();
  expect(page.url()).toBe(url);

  // Esc로 닫으면 포커스가 그 탭의 이름으로 돌아온다.
  await target.click({ button: "right" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(target).toBeFocused();
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "false");
  expect(page.url()).toBe(url);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

for (const key of ["Shift+F10", "ContextMenu"]) {
  test(`셸 탭 이름에 포커스를 두고 ${key}를 누르면 같은 메뉴가 그 탭 곁에 서고 ↓가 첫 항목에 간다`, async ({ page }) => {
    await installFixtureBackend(page);
    await 셸둘(page);
    const url = page.url();
    const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
    const target = 이름표(page, 0);
    await target.focus();
    await expect(target).toBeFocused();

    await page.keyboard.press(key);
    const menu = 메뉴(page);
    await expect(menu).toBeVisible();
    await expect.poll(() => 줄차례(menu)).toEqual(셸메뉴차례);
    // 커서가 없으니 그 탭 이름의 왼쪽 아래에 선다. 키로 연 자리도 우클릭 사건으로 내므로 정수 픽셀이다(위 우클릭 검사).
    await 다떴다(menu);
    const spot = (await target.boundingBox())!;
    const card = (await menu.boundingBox())!;
    expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.floor(spot.x), Math.floor(spot.y + spot.height)]);
    await expect.poll(() => 테두리(칸들(page).nth(0))).toBe(링);

    // 카드 자신이 포커스를 쥐고, 그 뒤의 ↓가 첫 항목이다.
    await expect(menu).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(항목(page, "이름 바꾸기")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(target).toBeFocused();
    expect(page.url()).toBe(url);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("Terminal의 셸 탭 메뉴에는 「작업 폴더 경로 복사」가 없고, 셸이 하나면 「다른 셸 모두 닫기」가 흐리다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await 이름표(page, 0).click({ button: "right" });
  const menu = 메뉴(page);
  await expect(menu).toBeVisible();
  await expect.poll(() => 줄차례(menu)).toEqual(터미널셸메뉴차례);
  // 지금 못 하는 줄은 숨기지 않고 흐리다 — 눌리지 않는다(`aria-disabled`).
  await expect(항목(page, "다른 셸 모두 닫기")).toBeDisabled();
  await expect(항목(page, "다른 셸 모두 닫기")).toHaveAttribute("aria-disabled", "true");
  await 항목(page, "다른 셸 모두 닫기").click({ force: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(칸들(page)).toHaveCount(1);
  expect(await kills(page)).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 탭 메뉴의 「닫기」는 ×· ⌘W와 같은 닫기다 — 도는 것이 있으면 셸 닫기 창을 거친다", async ({ page }) => {
  await installFixtureBackend(page);
  await 셸둘(page);

  await 이름표(page, 0).click({ button: "right" });
  await 항목(page, "닫기").click();
  await expect(메뉴(page)).toHaveCount(0);
  // 픽스처의 셸 하나 물음은 「명령이 돈다」라 창이 선다(`pty_close_check` 기본값).
  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect.poll(() => kills(page)).toEqual([{ id: 1, reason: "shellClose", owner: plainWork.slug }]);
  await expect(칸들(page)).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 탭 메뉴의 「작업 폴더 경로 복사」는 그 셸이 뜬 폴더를 참조 표기(끝에 `/`)로 클립보드에 쓴다", async ({ page }) => {
  await recordClipboard(page);
  await installFixtureBackend(page);
  const first = await 프로젝트셸(page);

  await 이름표(page, 0).click({ button: "right" });
  await 항목(page, "작업 폴더 경로 복사").click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect.poll(() => clipboardWrites(page)).toEqual([`${first.path}/`]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 「다른 셸 모두 닫기」가 실제로 닫는 칸과 그 확인 창(S8)은 `close-confirm-count.spec.ts`가 잰다 — 닫기 확인 창들이 그 파일에 모인다.
// 여기서는 그 줄이 메뉴에 서고(위 줄 차례) 셸이 하나면 흐린 것(Terminal 검사)까지다.
// ── spec 탭 메뉴 ──

test("spec 탭을 우클릭하면 spec 탭 메뉴가 커서 자리에 서고, 켜짐 · 주소는 그대로이며 대상 테두리는 연 동안만 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  const url = page.url();
  const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
  const target = 스펙탭(page);
  await expect(target).toHaveAttribute("aria-pressed", "false");
  expect(await 테두리(target)).toBeNull();

  await target.click({ button: "right", position: { x: 6, y: 6 } });
  const menu = 메뉴(page);
  await expect(menu).toBeVisible();
  await expect.poll(() => 줄차례(menu)).toEqual(["Finder에서 열기", "spec 경로 복사"]);
  await 다떴다(menu);
  const spot = (await target.boundingBox())!;
  const card = (await menu.boundingBox())!;
  expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.round(spot.x + 6), Math.round(spot.y + 6)]);
  expect(page.url()).toBe(url);
  await expect(target).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => 테두리(target)).toBe(링);

  // 바깥을 누르면 닫히고 테두리가 걷힌다.
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width - 8, viewport.height - 8);
  await expect(menu).toHaveCount(0);
  await expect.poll(() => 테두리(target)).toBeNull();

  // Esc로 닫으면 포커스가 그 칸으로 돌아온다.
  await target.click({ button: "right" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(target).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

for (const key of ["Shift+F10", "ContextMenu"]) {
  test(`spec 탭에 포커스를 두고 ${key}를 누르면 같은 메뉴가 그 칸 곁에 서고 ↓가 첫 항목에 간다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${plainWork.slug}?tab=terminal`);
    await awaitSpawned(page, 1);
    const url = page.url();
    const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
    const target = 스펙탭(page);
    await target.focus();
    await expect(target).toBeFocused();

    await page.keyboard.press(key);
    const menu = 메뉴(page);
    await expect(menu).toBeVisible();
    await expect.poll(() => 줄차례(menu)).toEqual(["Finder에서 열기", "spec 경로 복사"]);
    // 커서가 없으니 그 칸의 왼쪽 아래에 선다.
    await 다떴다(menu);
    const spot = (await target.boundingBox())!;
    const card = (await menu.boundingBox())!;
    expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.round(spot.x), Math.round(spot.y + spot.height)]);
    await expect.poll(() => 테두리(target)).toBe(링);
    // 메뉴를 열었을 뿐 문서로 가지 않았다.
    await expect(target).toHaveAttribute("aria-pressed", "false");

    // 카드 자신이 포커스를 쥐고, 그 뒤의 ↓가 첫 항목이다.
    await expect(menu).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(항목(page, "Finder에서 열기")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(target).toBeFocused();
    expect(page.url()).toBe(url);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("spec 탭 메뉴의 「Finder에서 열기」는 그 work의 spec 폴더를 열고, 「spec 경로 복사」는 spec 경로를 쓴다", async ({ page }) => {
  await recordClipboard(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  await 스펙탭(page).click({ button: "right" });
  await 항목(page, "Finder에서 열기").click();
  await expect(메뉴(page)).toHaveCount(0);
  // 날 경로를 넘기지 않는다 — 경로는 백엔드가 slug와 프로젝트로 푼다(codex-ds 스펙 S6). `null`이 spec 폴더다.
  await expect
    .poll(async () => (await ipcCallArgs(page, "open_work_folder", "slug")).map(({ args }) => args))
    .toEqual([{ slug: plainWork.slug, project: null }]);

  await 스펙탭(page).click({ button: "right" });
  await 항목(page, "spec 경로 복사").click();
  await expect(메뉴(page)).toHaveCount(0);
  // 앱의 참조 표기다(`specDirRef` — 끝에 `/`). work 메뉴의 복사 ▸ 「spec 경로」와 같은 값이다.
  await expect.poll(() => clipboardWrites(page)).toEqual([`${plainWork.specDir}/`]);
  // 문서로 가지 않았다.
  await expect(page).toHaveURL(/tab=terminal/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 셸 탭 이름 바꾸기 (S7) ──
// 이름 글자가 그대로 입력칸이 된다 — 창이 뜨지 않는다. 사람이 붙인 이름은 메모리에만 있어 나가는 IPC가 없다.

test("셸 탭 이름을 두 번 누르면 그 자리가 지금 이름을 전부 고른 입력칸이 되고, Enter면 그 이름으로 탭 글자가 바뀐다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await 셸둘(page);

  await 이름표(page, 0).dblclick();

  const input = 이름칸(page, 0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(FIXTURE_SHELL_NAME);
  await expect.poll(() => 고른자리(input)).toEqual([0, FIXTURE_SHELL_NAME.length]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // 첫 누름이 그 셸을 켜고 셸이 포커스를 가져가려 해도(`focusOnAttach`) 입력칸이 쥔 포커스는 안 뺏는다 — 프레임 둘을 넘겨 본다.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(input).toBeFocused();

  await input.fill("  내 셸  ");
  await input.press("Enter");

  await expect(input).toHaveCount(0);
  expect(await 닫기이름(page, 0)).toBe("내 셸 닫기");
  await expect(이름표(page, 0)).toHaveText("내 셸");
  // 다른 칸은 그대로다.
  expect(await 닫기이름(page, 1)).toBe(`${FIXTURE_SHELL_NAME} 닫기`);
  await expect(이름표(page, 0)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 탭 이름에서 F2를 누르면 입력칸이 되고, Esc는 고친 이름이 있어도 원래 이름으로 돌아간다", async ({ page }) => {
  await installFixtureBackend(page);
  await 셸둘(page);
  const name = 이름표(page, 1);
  await name.focus();
  await page.keyboard.press("F2");

  const input = 이름칸(page, 1);
  await expect(input).toBeFocused();
  await input.fill("고치다 만 이름");
  await input.press("Escape");

  await expect(input).toHaveCount(0);
  expect(await 닫기이름(page, 1)).toBe(`${FIXTURE_SHELL_NAME} 닫기`);
  await expect(name).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 탭 메뉴의 「이름 바꾸기」는 그 칸을 입력칸으로 바꾸고, 다른 곳을 누르면 저장한다", async ({ page }) => {
  await installFixtureBackend(page);
  await 셸둘(page);

  await 이름표(page, 0).click({ button: "right" });
  await 항목(page, "이름 바꾸기").click();
  await expect(메뉴(page)).toHaveCount(0);
  // 메뉴는 포커스를 탭에 돌려주지 않는다 — 막 선 입력칸이 쥔다(돌려주면 곧바로 blur되어 저장으로 닫힌다).
  const input = 이름칸(page, 0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(FIXTURE_SHELL_NAME);
  await input.fill("메뉴로 붙인 이름");

  await 셸화면을누른다(page);
  await expect(input).toHaveCount(0);
  expect(await 닫기이름(page, 0)).toBe("메뉴로 붙인 이름 닫기");
  // 메뉴로 고친 칸은 켜지지 않는다 — 켜진 것은 그대로 둘째다.
  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("붙인 이름을 비우면 원래 이름(셸 이름)으로 돌아간다", async ({ page }) => {
  await installFixtureBackend(page);
  await 셸둘(page);
  const name = 이름표(page, 0);

  await name.focus();
  await page.keyboard.press("F2");
  await 이름칸(page, 0).fill("내 셸");
  await page.keyboard.press("Enter");
  expect(await 닫기이름(page, 0)).toBe("내 셸 닫기");
  // 키로 끝냈으니 포커스가 다시 선 이름으로 돌아온다(다음 프레임) — 거기서 F2를 다시 누른다.
  await expect(name).toBeFocused();

  await page.keyboard.press("F2");
  const input = 이름칸(page, 0);
  await expect(input).toHaveValue("내 셸");
  await input.fill("   ");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  expect(await 닫기이름(page, 0)).toBe(`${FIXTURE_SHELL_NAME} 닫기`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 셸은 프롬프트마다 OSC 타이틀을 쏜다 — 사람이 붙인 이름이 그것에 덮이면 이름을 붙인 뜻이 없다. 비우면 그 타이틀로 돌아간다.
// **타이틀이 실제로 닿았는가**는 같은 바이트 뒤에 OSC 9를 붙여 띠로 잰다 — 한 덩어리를 파서가 차례로 읽으므로 띠가 서면 앞의
// 타이틀도 지났다. 그래서 문서를 보는 중에(그 셸을 안 보는 중에 — 「확인할 것」이 서도록) 넣는다.
test("붙인 이름은 OSC 타이틀보다 앞서고, 비우면 그 타이틀로 돌아간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 스펙탭(page).click();
  await expect(page).not.toHaveURL(/tab=terminal/);

  await 이름표(page, 0).focus();
  await page.keyboard.press("F2");
  await 이름칸(page, 0).fill("내 셸");
  await page.keyboard.press("Enter");
  expect(await 닫기이름(page, 0)).toBe("내 셸 닫기");

  await expect(띠(page)).toHaveCount(0);
  await writeShell(page, "\x1b]0;다른 이름\x07\x1b]9;끝났다\x07");
  await expect(띠(page).getByRole("button", { name: `${plainWork.title} — 확인할 것`, exact: true })).toHaveCount(1);
  expect(await 닫기이름(page, 0)).toBe("내 셸 닫기");

  await 이름표(page, 0).focus();
  await page.keyboard.press("F2");
  await 이름칸(page, 0).fill("");
  await page.keyboard.press("Enter");
  await expect(이름칸(page, 0)).toHaveCount(0);
  expect(await 닫기이름(page, 0)).toBe("다른 이름 닫기");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 붙인 이름이 없는 칸에 보이는 것은 타이틀 · 셸 이름이다. 그 글자를 손수 다시 쳐서 저장한 것도 사람이 고른 이름이라 붙는다 — 「그대로」는
// 보이는 이름이 아니라 붙인 이름과 견준다. 안 붙으면 다음 프롬프트의 타이틀이 고른 이름을 덮는다. 손대지 않고 끝낸 고치기는 고른 것이
// 없어 아무것도 안 붙고, 이름은 계속 타이틀을 따른다(`InlineRename`). 타이틀이 닿은 것은 앞의 검사처럼 띠로 잰다.
test("지금 보이는 이름을 손수 다시 쳐서 저장하면 그 이름이 붙어 OSC 타이틀에 안 덮인다 — 손대지 않고 끝내면 안 붙는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 스펙탭(page).click();
  await expect(page).not.toHaveURL(/tab=terminal/);
  const name = 이름표(page, 0);

  // 손대지 않고 Enter — 붙지 않으니 타이틀이 오면 그 이름이 된다.
  await name.focus();
  await page.keyboard.press("F2");
  await expect(이름칸(page, 0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(이름칸(page, 0)).toHaveCount(0);
  await writeShell(page, "\x1b]0;다른 이름\x07");
  await expect.poll(() => 닫기이름(page, 0)).toBe("다른 이름 닫기");

  // 보이는 이름(타이틀)을 고른 채 같은 글자를 다시 친다.
  await expect(name).toBeFocused();
  await page.keyboard.press("F2");
  const input = 이름칸(page, 0);
  await expect(input).toHaveValue("다른 이름");
  await input.pressSequentially("다른 이름");
  await expect(input).toHaveValue("다른 이름");
  await input.press("Enter");
  await expect(input).toHaveCount(0);

  await expect(띠(page)).toHaveCount(0);
  await writeShell(page, "\x1b]0;셋째 이름\x07\x1b]9;끝났다\x07");
  await expect(띠(page).getByRole("button", { name: `${plainWork.title} — 확인할 것`, exact: true })).toHaveCount(1);
  expect(await 닫기이름(page, 0)).toBe("다른 이름 닫기");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("프로젝트가 붙은 칸은 입력칸이 이름의 꼬리만 들고, 앞의 프로젝트는 그대로 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  const first = await 프로젝트셸(page);

  await 이름표(page, 0).focus();
  await page.keyboard.press("F2");
  const input = 이름칸(page, 0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(FIXTURE_SHELL_NAME);
  // 앞말은 입력칸 밖에 선다 — 지울 수 없고, 고치는 동안에도 어느 워크트리의 셸인지 보인다.
  await expect(칸들(page).nth(0)).toContainText(`${first.project} · `);
  await input.fill("내 셸");
  await input.press("Enter");

  await expect(input).toHaveCount(0);
  expect(await 닫기이름(page, 0)).toBe(`${first.project} · 내 셸 닫기`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 고치는 칸의 자리 — 칸 · 앞말 · 입력칸의 상자와, 앞말이 말줄임으로 줄었는지 · 칸 안이 넘쳤는지. 한 번의 evaluate로 잰다. */
const 고치는자리 = (input: Locator) =>
  input.evaluate((el) => {
    const cell = el.closest<HTMLElement>('[data-tab="shell"]')!;
    const prefix = el.previousElementSibling as HTMLElement;
    const box = (one: Element) => {
      const { left, right, width } = one.getBoundingClientRect();
      return { left, right, width };
    };
    return {
      cell: box(cell),
      prefix: box(prefix),
      input: box(el),
      prefixCut: prefix.scrollWidth > prefix.clientWidth,
      cellSpill: cell.scrollWidth - cell.clientWidth,
    };
  });

// 칸은 줄이 좁으면 바닥(44px)까지 준다(결정 20). 고치는 동안 앞말이 제 글자 폭을 다 쥐면 좁은 칸에서 입력칸이 0으로 눌리고 앞말이 칸
// 밖으로 넘친다. 그래서 앞말은 그 상자의 절반까지만 서고 넘으면 말줄임으로 준다 — 고치는 글자가 적어도 그만큼을 쥔다. 넓은 칸에서는 앞말이
// 다 선다. 좁은 칸은 넓혀 둔 사이드바가 탭 줄의 바닥에 눌리는 창 폭에서 선다(`squeezedWidth`, `tab-row.ts`).
test("좁은 칸에서 이름을 고쳐도 앞말이 입력칸을 밀어내지 않고 칸 밖으로 안 넘친다", async ({ page }) => {
  await widenSidebar(page);
  await installFixtureBackend(page);
  const first = await 프로젝트셸(page);
  const name = 이름표(page, 0);
  const input = 이름칸(page, 0);

  // 넓은 칸 — 앞말이 줄지 않고 다 선다.
  await name.focus();
  await page.keyboard.press("F2");
  await expect(input).toBeFocused();
  const wide = await 고치는자리(input);
  expect(wide.prefixCut, JSON.stringify(wide)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);

  await page.setViewportSize({ width: await squeezedWidth(page), height: 800 });
  await settle(page, () => rowOf(page));
  // 전제: 칸이 이름을 접는 폭(88px) 아래다 — 넓으면 아무것도 안 잰다.
  expect((await rowOf(page)).tabs[0]).toBeLessThan(88);

  await name.focus();
  await page.keyboard.press("F2");
  await expect(input).toBeFocused();
  const narrow = await 고치는자리(input);
  const at = JSON.stringify(narrow);
  // 입력칸이 폭을 쥐고 앞말보다 좁지 않다 — 앞말이 말줄임으로 줄어 그 몫을 내준다.
  expect(narrow.prefixCut, at).toBe(true);
  expect(narrow.input.width, at).toBeGreaterThanOrEqual(narrow.prefix.width);
  // 칸 밖으로 아무것도 안 넘친다.
  expect(narrow.input.right, at).toBeLessThanOrEqual(narrow.cell.right + 0.5);
  expect(narrow.cellSpill, at).toBeLessThanOrEqual(0);

  // 좁은 칸에서도 고친 이름이 그대로 저장된다.
  await input.fill("내 셸");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  expect(await 닫기이름(page, 0)).toBe(`${first.project} · 내 셸 닫기`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 누름 갈래 ──
// 탭 이름을 누르면 켜지고, 눌러 끌면 끌기다. 우클릭(macOS의 ⌃클릭도)은 메뉴의 몸짓이라 그 둘 어느 것도 아니다(구현 노트 Q9).

/** body의 끄는 중 표시 — 글 선택이 막혔다(`drag-gesture.spec.ts`의 `dragging`). */
const 끄는중 = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return (style.getPropertyValue("user-select") || style.getPropertyValue("-webkit-user-select")) === "none";
  });

test("셸 탭을 오른쪽 버튼으로 누른 채 움직여도 끌기가 안 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  const from = middle((await 이름표(page, 0).boundingBox())!);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(from.x + 12, from.y);
  await page.mouse.move(from.x + 40, from.y + 120);
  expect(await 끄는중(page)).toBe(false);
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await page.mouse.up({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/split=/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 탭을 ⌃를 누른 채 눌러 움직여도 끌기가 안 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // ⌃가 실린 누름을 탭 이름에 바로 낸다 — 러너가 ⌃클릭을 우클릭으로 바꾸는지는 기계마다라, 거름 자체를 잰다.
  const from = middle((await 이름표(page, 0).boundingBox())!);
  await 이름표(page, 0).dispatchEvent("pointerdown", {
    button: 0,
    buttons: 1,
    ctrlKey: true,
    clientX: from.x,
    clientY: from.y,
    pointerType: "mouse",
    isPrimary: true,
  });
  await page.mouse.move(from.x + 12, from.y);
  await page.mouse.move(from.x + 40, from.y + 120);
  expect(await 끄는중(page)).toBe(false);
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup")));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 탭 · spec 탭을 ⌃클릭하면 켜지지 않는다 — ⌃ 없는 클릭은 켠다", async ({ page }) => {
  await installFixtureBackend(page);
  await 셸둘(page);

  await 이름표(page, 0).dispatchEvent("click", { ctrlKey: true });
  // ⌃ 없는 클릭이 둘째를 켜는 것을 앵커로 삼는다 — 같은 길(클릭 사건)이 거름 하나로 갈린다.
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "false");
  await 스펙탭(page).dispatchEvent("click", { ctrlKey: true });
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(스펙탭(page)).toHaveAttribute("aria-pressed", "false");

  await 이름표(page, 0).dispatchEvent("click");
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "true");
  await 스펙탭(page).dispatchEvent("click");
  await expect(page).not.toHaveURL(/tab=terminal/);
  await expect(스펙탭(page)).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
