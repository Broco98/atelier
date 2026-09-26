import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  callCount,
  clipboardWrites,
  installFixtureBackend,
  ipcCallArgs,
  recordClipboard,
  unknownIpcCalls,
  workRow,
} from "./harness";

// 판 3 — **작업 화면의 떠 있는 것**(S8, P14). 그 표면을 이미 다루는 spec 파일이 없는 것만 여기 모은다:
// 작업 ⋯ · 상태 메뉴 · 이름 바꾸기 창 · ⓘ 메타 · 작업 화면 토스트 · 전체화면 · Mermaid 「코드」 · 툴팁.
// 셸 열기 `+`는 셸 열기 spec(`shell-picker.spec.ts`)이, 아카이브 거르개는 아카이브 문서 spec이,
// 기준 브랜치는 프로젝트 목록 spec이 든다.
//
// **절마다 머리 주석 한 줄로 가른다**(`// ── 무엇 ──`). 표면이 늘어도 한 파일이라, 절 머리가 곧 목차다.
// 도우미는 이 파일 맨 위에 둔다 — 둘 이상의 절이 쓰는 것만. 한 절만 쓰는 것은 그 절 안에 둔다.
//
// 검사 규칙은 스펙 「좋은 검사」 그대로다. 역할과 이름으로 집고, 모양 수치는 재지 않는다. 계산된 스타일은
// 동작일 때만(애니메이션이 도는가, 동작 줄이기면 멎는가) 잰다. 메뉴(`modal`)가 열린 동안 바깥을 누르는
// 검사는 자리를 먼저 재고 `page.mouse.click`으로 누른다 — `locator.click()`은 메뉴의 가림막에 막힌다.

const [pinnedWork, plainWork, multiWork] = WORKS;

/**
 * 그 요소에 걸린 애니메이션의 이름. **동작을 재는 값이다** — 열림 애니메이션(결정 7)은 `data-open`에서
 * 붙어 열려 있는 동안 그대로 남으므로, 뜬 뒤 언제 재도 같다. 동작 줄이기면 전역 규칙이 `none`으로 덮는다.
 */
const 애니메이션 = (target: Locator) => target.evaluate((el) => getComputedStyle(el).animationName);

/**
 * 머리행의 ⋯ — 작업 메뉴를 여는 버튼. 이름이 세계를 탄다(`itemNameOf`): 여기는 Atelier라 「작업 메뉴」다.
 * 옆의 ⓘ(「작업 메타」)와 가르려고 이름 전체로 집는다.
 */
const 작업메뉴 = (page: Page) => page.getByRole("button", { name: "작업 메뉴", exact: true });

/**
 * 페이지의 시계를 지금에서 조금 뒤로 세운다 — 그다음부터는 `page.clock.runFor`로만 흐른다. **페이지를 열기 전에
 * `page.clock.install()`을 건 검사만 쓴다.** 세운 시계에서도 누르기·포커스·키·올리기는 된다. 열림 애니메이션의
 * 프레임(rAF)도 세운 시계를 타므로, 사라짐을 볼 때는 시계를 돌리거나 다시 흐르게 둔다.
 */
const 시계를세운다 = async (page: Page) =>
  page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);

// ── 떠 있는 것의 애니메이션 (결정 7) ──
// 떠 있는 것은 100ms 페이드와 확대로 뜨고, 「동작 줄이기」면 그것이 꺼진다. 끄는 규칙은 부품마다가 아니라
// 전역 CSS 한 곳이라(`index.css`의 `[data-slot][class*="animate-"]`) 메뉴 하나로 잰다 — 메뉴는 판 3이 처음
// 들인 떠 있는 부품이고, 셸 열기 `+`가 그 첫 쓰는 자리다.

test("메뉴는 애니메이션으로 뜨고, 움직임을 끄면 애니메이션 없이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}?tab=terminal`);
  const plus = page.getByRole("button", { name: "셸 열기" });
  const menu = page.getByRole("menu", { name: "셸 열기" });

  await plus.click();
  await expect(menu).toBeVisible();
  await expect.poll(() => 애니메이션(menu)).not.toBe("none");

  // 닫힌 것을 보고 다시 연다 — 닫히는 중인 카드에 잰 값이 섞이지 않게.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await plus.click();
  await expect(menu).toBeVisible();
  await expect.poll(() => 애니메이션(menu)).toBe("none");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 상태 메뉴 (스토리 46~48 · 51 · 52, S33) ──
// 머리행의 상태 배지가 라디오 메뉴를 연다. 배지는 여는 버튼이라 「메뉴를 연다」와 「열렸다/닫혔다」를 말하고,
// 지금 상태는 `menuitemradio`의 `aria-checked`로 읽힌다(체크 아이콘은 보이는 쪽의 말일 뿐이다). 고르면 닫힌다 —
// 라디오 항목의 부품 기본은 안 닫힘이라(S33) 그것을 여기서 잰다. 저장은 **값이 바뀔 때만**이다(지금 규칙).
//
// 배지와 줄의 이름은 상태의 라벨이고, 라벨은 상태 값 그대로다(`STATUS_META`). 픽스처 백엔드는 상태를 기억하지
// 않아 바꾼 뒤에도 목록이 `active`로 답한다 — 그래서 배지의 이름이 검사 도중에 흔들리지 않는다.
// 줄의 이름은 라벨 뒤에 설명(「진행 중」 등)이 붙어 라벨로 **시작하는 것**으로 집는다.
const 상태줄 = (menu: Locator, status: string) =>
  menu.getByRole("menuitemradio", { name: new RegExp(`^${status}\\b`) });

test("상태 배지는 메뉴를 연다고 말하고, 지금 상태가 선택됨이다 — 다른 상태를 고르면 바꾸는 IPC가 나가고 닫힌다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const badge = page.getByRole("button", { name: pinnedWork.status, exact: true });
  const menu = page.getByRole("menu");

  await expect(badge).toHaveAttribute("aria-haspopup", "menu");
  await expect(badge).toHaveAttribute("aria-expanded", "false");
  await badge.click();
  await expect(menu).toBeVisible();
  await expect(badge).toHaveAttribute("aria-expanded", "true");

  // 넷이 다 라디오 줄이고, 지금 것 **하나만** 선택됨이다 — 지금 것만 재면 「전부 선택됨」도 초록이다.
  await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
  await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveCount(1);
  await expect(상태줄(menu, pinnedWork.status)).toHaveAttribute("aria-checked", "true");

  await 상태줄(menu, "review").click();

  await expect(menu).toHaveCount(0);
  await expect(badge).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () => (await ipcCallArgs(page, "set_work_status", "status")).map(({ args }) => args))
    .toEqual([{ mode: "atelier", slug: pinnedWork.slug, status: "review" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("상태 메뉴에서 지금 상태를 다시 고르면 닫히기만 하고 IPC는 안 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const badge = page.getByRole("button", { name: pinnedWork.status, exact: true });
  const menu = page.getByRole("menu");

  // 키보드로 연다 — ↓가 메뉴를 열고 첫 줄(`draft`)을 켠다. ↓ 한 번 더가 지금 상태(`active`)다.
  await badge.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(상태줄(menu, pinnedWork.status)).toBeFocused();
  await page.keyboard.press("Enter");

  // 앵커: 골라서 닫혔다. 그다음에야 「안 나갔다」가 뜻을 갖는다 — 고르는 일이 아예 안 일어나도 0이다.
  await expect(menu).toHaveCount(0);
  await expect(badge).toBeFocused();
  expect(await callCount(page, "set_work_status")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 작업 ⋯ (스토리 46~48 · 56 · 57) ──
// 머리행의 ⋯가 메뉴를 연다: 이름 바꾸기 · 구분선 · 아카이빙 · 구분선 · 삭제. 줄 옮기기와 Esc 닫기, ⋯로 포커스
// 돌려주기는 메뉴 부품이 한다. 아카이빙·삭제는 확인 창을 부르는데, 그 창이 닫히면 포커스는 **⋯로** 간다 — 창을
// 부른 메뉴 항목은 그때 이미 사라졌다. 처리 중인 ⋯는 재지 않는다 — 가림막이 머리행까지 덮어 손이 안 닿는다.

test("작업 ⋯를 열면 메뉴가 서고 ↓가 첫 항목에 간다 — Esc로 닫으면 포커스가 ⋯로 돌아온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const more = 작업메뉴(page);
  const menu = page.getByRole("menu");

  await expect(more).toHaveAttribute("aria-haspopup", "menu");
  await more.click();
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  // 항목은 셋이고 순서가 이렇다 — 되돌릴 수 있는 이름 바꾸기가 맨 위, 되돌릴 수 없는 둘이 구분선 아래다.
  await expect(menu.getByRole("menuitem")).toHaveText(["이름 바꾸기", "아카이빙", "삭제"]);
  await expect(menu.getByRole("separator")).toHaveCount(2);

  // 눌러서 열면 카드 자신이 포커스를 쥔다. 그 뒤의 ↓가 첫 항목이다.
  await expect(menu).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "이름 바꾸기" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("「아카이빙」이 띄운 확인 창을 「취소」로 닫으면 포커스가 ⋯로 돌아온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const more = 작업메뉴(page);

  await more.click();
  await page.getByRole("menuitem", { name: "아카이빙" }).click();
  const dialog = page.getByRole("alertdialog", { name: `'${pinnedWork.title}' 아카이빙` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();

  // 앵커: 창이 닫혔다. 그다음에 포커스의 자리와 「안 나갔다」를 잰다.
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(await callCount(page, "archive_work")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 이름 바꾸기 창 (결정 8, 스토리 58~63, S38 · P7 · P12) ──
// ⋯의 「이름 바꾸기」가 작은 창을 연다. 입력칸이 지금 이름을 **전부 고른 채** 포커스를 받는다. Enter는 앞뒤
// 공백을 떼고 저장하되, 비었거나 그대로면 저장 없이 닫는다. Esc와 바깥 누르기는 취소다 — 바깥 누르기가 저장이던
// 옛 인라인 편집기와 여기서 갈린다(P7). 어느 길로 닫혀도 포커스는 ⋯로 간다.
//
// 「안 나갔다」(IPC 0)는 늘 **창이 닫힌 것을 본 뒤에** 잰다 — 닫는 일이 아예 안 일어나도 0이다.

const 이름바꾸기를연다 = async (page: Page) => {
  await 작업메뉴(page).click();
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const dialog = page.getByRole("dialog", { name: "작업 이름 바꾸기" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("textbox", { name: "작업 이름" });
  await expect(input).toBeFocused();
  return { dialog, input, save: dialog.getByRole("button", { name: "저장", exact: true }) };
};

/** 입력칸에서 골라 둔 자리 `[시작, 끝]`. 전부 골랐으면 `[0, 글자 수]`다. */
const 고른자리 = (input: Locator) =>
  input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);

test("「이름 바꾸기」는 「작업 이름 바꾸기」 창을 열고, 입력칸이 지금 이름을 전부 고른 채 포커스를 받는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const { input } = await 이름바꾸기를연다(page);

  await expect(input).toHaveValue(plainWork.title);
  await expect.poll(() => 고른자리(input)).toEqual([0, plainWork.title.length]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Enter면 앞뒤 공백을 뗀 이름으로 제목 IPC가 나가고, 창이 닫혀 포커스가 ⋯에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const { dialog, input } = await 이름바꾸기를연다(page);

  await input.fill("  새 이름  ");
  await input.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(작업메뉴(page)).toBeFocused();
  await expect
    .poll(async () => (await ipcCallArgs(page, "set_work_title", "title")).map(({ args }) => args))
    .toEqual([{ mode: "atelier", slug: plainWork.slug, title: "새 이름" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

for (const [what, value] of [
  ["그대로인 이름", plainWork.title],
  ["빈 이름", "   "],
] as const) {
  test(`${what}으로 Enter를 누르면 창만 닫히고 제목 IPC는 안 나간다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${plainWork.slug}`);
    const { dialog, input } = await 이름바꾸기를연다(page);

    await input.fill(value);
    await input.press("Enter");

    await expect(dialog).toHaveCount(0);
    await expect(작업메뉴(page)).toBeFocused();
    expect(await callCount(page, "set_work_title")).toBe(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("「저장」은 이름이 비었거나 그대로면 누를 수 없고, 글자를 바꾸면 풀린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const { input, save } = await 이름바꾸기를연다(page);

  // 연 그대로는 지금 이름이다 — 저장해도 바뀌는 것이 없다.
  await expect(save).toBeDisabled();
  await input.fill("");
  await expect(save).toBeDisabled();
  // 공백만 있으면 뗀 뒤 빈 이름이다. 앞뒤 공백만 붙인 지금 이름도 뗀 뒤 그대로다.
  await input.fill("   ");
  await expect(save).toBeDisabled();
  await input.fill(` ${plainWork.title} `);
  await expect(save).toBeDisabled();

  await input.fill(`${plainWork.title}!`);
  await expect(save).toBeEnabled();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

for (const [what, cancel] of [
  ["Esc", (page: Page) => page.keyboard.press("Escape")],
  // 가림막 위 창 밖의 한 점. 창은 가운데에 서므로 왼쪽 위 모서리는 늘 바깥이다.
  ["바깥 누르기", (page: Page) => page.mouse.click(8, 8)],
] as const) {
  test(`${what}는 취소다 — 고친 이름이 있어도 제목 IPC가 안 나가고, 포커스가 ⋯에 선다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${plainWork.slug}`);
    const { dialog, input } = await 이름바꾸기를연다(page);

    await input.fill("고치다 만 이름");
    await cancel(page);

    await expect(dialog).toHaveCount(0);
    await expect(작업메뉴(page)).toBeFocused();
    expect(await callCount(page, "set_work_title")).toBe(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// ── ⓘ 메타 (스토리 64~66, S35 · S39) ──
// 머리행의 ⓘ가 작은 카드(Popover)를 연다. 행은 복사 버튼이다 — 누르면 그 값이 클립보드로 가고 카드가 닫힌다(복사가
// 끝났다는 신호가 카드가 사라지는 것이다). 열리면 첫 행이 포커스를 받고(부품 기본), Esc로 닫으면 ⓘ로 돌아온다.
// 트리거의 도움말 「메타」는 툴팁이다(S39 — 판 4의 규칙을 앞당겼다).
//
// 클립보드는 **쓰기를 적는** 하네스 손잡이로 잰다(S35) — WebKit에서 클립보드를 읽는 길은 확인되지 않았다.
// 첫 행은 브랜치다: 고정된 일에는 브랜치가 있고, 꼬리의 base(`main`)는 행의 이름에 붙어 따라온다.
//
// Tab으로 행 사이를 옮기는 것(스토리 64의 가운데)은 여기서 못 잰다 — WebKit의 Tab은 버튼을 건너뛴다. 판 3 실물
// 확인(「전체 키보드 접근」)이 본다. 복사 아이콘이 포커스에 보이는 것(스토리 66)도 모양이라 실물 확인의 몫이다.

const 메타 = (page: Page) => page.getByRole("button", { name: "작업 메타", exact: true });
// 카드는 트리거와 같은 이름을 단 `dialog`다(모달이 아니라 그 밖이 가려지지 않는다).
const 메타카드 = (page: Page) => page.getByRole("dialog", { name: "작업 메타" });

test("ⓘ를 누르면 첫 복사 행이 포커스를 받고, Enter면 그 값이 클립보드로 가고 카드가 닫힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const card = 메타카드(page);

  await 메타(page).click();
  await expect(card).toBeVisible();
  // 첫 행이 브랜치 행이다 — 「첫 버튼이 포커스」만 보면 행 순서가 뒤집혀도 초록이다.
  const branchRow = card.getByRole("button", { name: new RegExp(`^${pinnedWork.branch}\\b`) });
  await expect(card.getByRole("button").first()).toBeFocused();
  await expect(branchRow).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(card).toHaveCount(0);
  await expect.poll(() => clipboardWrites(page)).toEqual([pinnedWork.branch]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 포인터를 한 번도 안 쓴다 — 포커스로 뜨는 툴팁은 그래야 잰다(「좋은 검사」).
test("ⓘ는 포커스에 「메타」 툴팁을 띄우고, 키로 열어 Esc로 닫으면 복사 없이 포커스가 ⓘ로 돌아온다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const info = 메타(page);
  const card = 메타카드(page);
  const tooltip = page.locator("[data-slot=tooltip-content]");

  await info.focus();
  await expect(tooltip).toHaveText("메타");

  await page.keyboard.press("Enter");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button").first()).toBeFocused();

  await page.keyboard.press("Escape");

  // 앵커: 카드가 닫혔다. 그다음에 포커스의 자리와 「안 복사했다」를 잰다.
  await expect(card).toHaveCount(0);
  await expect(info).toBeFocused();
  expect(await clipboardWrites(page)).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 토스트 (스토리 88~91, 결정 11, S14 · S26 · S37) ──
// 복사했다·셸을 못 열었다 같은 짧은 토스트는 이름 「메시지」를 단 `region`(라이브 영역)에 선다. 자리는 본문과 작업
// 패널을 합친 상자의 아래 가운데다 — 뷰 분기 밖이라 본문이 셸이든 문서든 같은 자리다. 이어서 오면 **같은 id 하나로**
// 나서(S26) 앞의 것을 제자리에서 갈아 끼우고 시간을 다시 센다. `limit`으로 한 장을 세우면 밀려난 것이
// `data-limited`·`inert`로 DOM에 남는다 — 그래서 역할만이 아니라 토스트의 표식(`data-slot=toast`)으로도 센다.
//
// **시계는 페이지를 열기 전에 걸고(`page.clock`), 복사 직전에 세운다.** 토스트는 1.6초면 사라져서, 저절로 흐르는
// 시계로는 느린 기계에서 단언이 그 창을 놓칠 수 있다. 1.6초를 재는 것은 아카이브 문서 spec이다 — 두 화면이 같은
// 부품·같은 호출이다. 세운 시계에서는 사라지는 전이의 프레임(rAF)이 안 와서, 사라짐을 볼 때는 시계를 다시 흐르게 둔다.

const 메시지 = (page: Page) => page.getByRole("region", { name: "메시지", exact: true });

// 터미널 탭에서 잰다 — 토스트가 SpecViewer 안에 살던 앞 판에는 **이 탭에서 트리를 복사하면 아무 말이 없었다**(결정 47).
test("셸을 보던 채 트리에서 경로를 복사하면 「메시지」 영역에 「… 복사됨」이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.clock.install();
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  const messages = 메시지(page);
  const copy = page.getByRole("button", { name: "overview.md 경로 복사", exact: true });
  await expect(copy).toBeAttached();
  // 라이브 영역은 글자가 들기 전부터 서 있어야 읽힌다.
  await expect(messages).toHaveText("");

  await 시계를세운다(page);
  await copy.click();

  await expect.poll(() => clipboardWrites(page)).toHaveLength(1);
  const [copied] = await clipboardWrites(page);
  await expect(messages).toHaveText(`${copied} 복사됨`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 포인터를 안 쓴다 — 포인터가 토스트 위에 있으면 Base UI가 시계를 세운다(S27). 키로 복사해야 포커스가 복사한 자리에
// 남는지도 잴 수 있다(WebKit은 버튼을 눌러도 포커스를 주지 않는다).
test("연달아 두 번 복사하면 토스트는 한 장이다 — 뒤의 글자로 갈아 끼우고, 포커스는 복사한 자리에 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.clock.install();
  await page.goto(`/works/${pinnedWork.slug}`);
  const messages = 메시지(page);
  const first = page.getByRole("button", { name: "overview.md 경로 복사", exact: true });
  const second = page.getByRole("button", { name: "메타.json 경로 복사", exact: true });
  await expect(first).toBeAttached();

  await 시계를세운다(page);
  await first.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => clipboardWrites(page)).toHaveLength(1);
  await second.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => clipboardWrites(page)).toHaveLength(2);

  const [, copied] = await clipboardWrites(page);
  await expect(messages).toHaveText(`${copied} 복사됨`);
  // 한도에 걸려 남은 것(`data-limited`)까지 세어 한 장이다.
  await expect(messages.locator("[data-slot=toast]")).toHaveCount(1);
  await expect(messages.getByRole("dialog")).toHaveCount(1);
  // 토스트는 읽히기만 하고 포커스를 가져가지 않는다(스토리 91).
  await expect(second).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 시간을 다시 세는지는 **앞 것의 마감을 넘긴 뒤에도 남는가**로 잰다. 그 잣대가 서려면 사라짐이 시계를 돌린 그 자리에서
// 끝나야 한다 — 전이가 켜져 있으면 사라지는 토스트가 실제 시간으로 몇 프레임 더 글자를 들고 남아, 마감이 지났는데도
// 「남았다」로 읽힐 수 있다. 그래서 움직임을 끈다. 끄면 전역 규칙(`index.css`)이 토스트의 전이를 끄는 것도 여기서 본다.
const 전이 = (target: Locator) => target.evaluate((el) => getComputedStyle(el).transitionProperty);

test("이어 온 토스트는 시간을 다시 센다 — 움직임을 끄면 토스트는 전이 없이 들고 난다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.clock.install();
  await page.goto(`/works/${pinnedWork.slug}`);
  const messages = 메시지(page);
  const toast = messages.getByRole("dialog");
  const first = page.getByRole("button", { name: "overview.md 경로 복사", exact: true });
  const second = page.getByRole("button", { name: "메타.json 경로 복사", exact: true });
  await expect(first).toBeAttached();

  await 시계를세운다(page);
  await first.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => clipboardWrites(page)).toHaveLength(1);
  await expect(toast).toHaveCount(1);
  expect(await 전이(toast)).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => 전이(toast)).toBe("none");

  await page.clock.runFor(1000);
  await second.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => clipboardWrites(page)).toHaveLength(2);
  const [, copied] = await clipboardWrites(page);
  await expect(messages).toHaveText(`${copied} 복사됨`);

  // 앞 것의 마감(1.6초)을 넘겼다 — 뒤의 것에서는 1초다.
  await page.clock.runFor(1000);
  await expect(messages).toHaveText(`${copied} 복사됨`);
  // 뒤의 것에서 1.6초를 넘겼다.
  await page.clock.runFor(700);
  await expect(messages).toHaveText("");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 전체화면 (스토리 78~82 · 116, S28 · S31 · S36 · S37) ──
// 다이어그램과 표의 「전체화면으로 크게 보기」가 모달 창(`dialog`)을 연다. 창의 이름은 「다이어그램」·「표」다 —
// 다이어그램 창의 보이는 머리는 `mermaid`라 이름이 되지 못해 따로 단다. 창은 스스로 모달임을 말한다(S31).
// Esc로 닫으면 포커스가 여는 버튼으로 돌아온다. WebKit은 버튼을 눌러도 포커스를 주지 않으므로 **눌러서 연** 창에서
// 잰다 — 열기 전 포커스가 버튼에 없던 길이다. 닫기 버튼의 도움말은 툴팁 「닫기」 + Kbd `Esc`이고, 툴팁은 스크린리더에
// 아무것도 주지 않으므로 단축키는 버튼의 설명으로 남는다(S28).
//
// 가림막은 **누르고 뗀 클릭**에 닫힌다. 창 안에서 끌다 가림막 위에서 손을 떼는 것은 클릭이 아니다(스토리 80) —
// 그것을 「안 닫혔다」로 잰 뒤, 대조로 같은 자리를 눌러 닫히는 것을 본다(닫는 길이 아예 죽어서 초록인 것을 가른다).
//
// Tab이 창 밖으로 새지 않는 것(스토리 79의 앞)은 재지 않는다 — WebKit의 Tab은 버튼을 건너뛴다(S36). 판 3 실물
// 확인(「전체 키보드 접근」)이 본다. 문서는 `multiWork`의 둘이다: mermaid 블록 하나(「다이어그램.md」)와 넓은 표 하나
// (「넓은.md」).

const 다이어그램문서 = "다이어그램.md";
const 표문서 = "넓은.md";
const 문서를연다 = (page: Page, file: string) =>
  page.goto(`/works/${multiWork.slug}?file=${encodeURIComponent(file)}`);
// 다이어그램 블록의 여는 버튼. 표의 여는 버튼은 「표를 전체화면으로 보기」라는 제 이름이 있다.
const 크게보기 = (page: Page) => page.getByRole("button", { name: "전체화면으로 크게 보기", exact: true });
const 다이어그램창 = (page: Page) => page.getByRole("dialog", { name: "다이어그램" });

test("다이어그램을 전체화면으로 열면 「다이어그램」 창이 창에 맞춘 배율로 서고, 축소·확대·100%로가 이름으로 선다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await 문서를연다(page, 다이어그램문서);

  await 크게보기(page).click();
  const dialog = 다이어그램창(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  // 맞춤 배율(스토리 81): 작은 다이어그램이라 창에 맞추면 100%가 아니다. 버튼의 글자가 지금 배율이다.
  const reset = dialog.getByRole("button", { name: "100%로", exact: true });
  await expect(reset).toHaveText(/^\d+%$/);
  await expect(reset).not.toHaveText("100%");
  await reset.click();
  await expect(reset).toHaveText("100%");
  await dialog.getByRole("button", { name: "확대", exact: true }).click();
  await expect(reset).toHaveText("120%");
  await dialog.getByRole("button", { name: "축소", exact: true }).click();
  await expect(reset).toHaveText("100%");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 표의 여는 버튼은 포인터가 표 위에 올 때만 드러나고 눌린다 — 먼저 표 위로 포인터를 옮긴다(사람의 손도 그렇다).
for (const { what, file, open, reveal } of [
  { what: "다이어그램", file: 다이어그램문서, open: "전체화면으로 크게 보기", reveal: null },
  { what: "표", file: 표문서, open: "표를 전체화면으로 보기", reveal: "table" },
] as const) {
  test(`${what}의 전체화면을 눌러 열고 Esc로 닫으면 포커스가 여는 버튼으로 돌아온다`, async ({ page }) => {
    await installFixtureBackend(page);
    await 문서를연다(page, file);
    const trigger = page.getByRole("button", { name: open, exact: true });

    if (reveal) await page.getByRole(reveal).hover();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: what, exact: true });
    await expect(dialog).toBeVisible();
    // 포커스가 창 안에 들었다(부품이 옮긴다) — 그 전의 Esc는 창이 아니라 그 자리의 것이 받는다.
    await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");

    // 앵커: 창이 닫혔다. 그다음에 포커스의 자리를 잰다.
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 포인터를 한 번도 안 쓴다 — 포커스로 뜨는 툴팁은 그래야 잰다(「좋은 검사」). 툴팁이 떠 있는 채 누른 Esc도 창을 닫는다 —
// 부품 기본은 Esc를 툴팁에서 멈춰 첫 Esc가 툴팁만 닫는데, 툴팁은 사람이 연 층이 아니다(`tooltip.tsx`).
test("닫기 버튼은 포커스에 툴팁 「닫기」와 Kbd `Esc`를 띄우고 단축키를 설명으로 말한다 — 툴팁이 떠 있어도 Esc 한 번에 닫힌다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await 문서를연다(page, 다이어그램문서);
  const tooltip = page.locator("[data-slot=tooltip-content]");

  await 크게보기(page).focus();
  await page.keyboard.press("Enter");
  const dialog = 다이어그램창(page);
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "닫기", exact: true });
  await expect(close).toHaveAccessibleDescription("Esc");

  await close.focus();
  await expect(tooltip).toContainText("닫기");
  await expect(tooltip.locator("[data-slot=kbd]")).toHaveText("Esc");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(tooltip).toHaveCount(0);
  await expect(크게보기(page)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("다이어그램을 끌다 가림막 위에서 손을 떼도 창은 남는다 — 가림막을 누르고 떼면 닫힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await 문서를연다(page, 다이어그램문서);

  await 크게보기(page).click();
  const dialog = 다이어그램창(page);
  await expect(dialog).toBeVisible();
  // 다 떴다 — 열림 애니메이션(95%→100% 확대)이 끝나야 잰 상자가 실제 자리다.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  const box = await dialog.boundingBox();
  if (!box) throw new Error("창의 상자를 못 읽었다");
  // 끌기는 창의 한가운데(다이어그램 본문)에서 시작하고, 창 위쪽 가림막 띠의 가운데에서 손을 뗀다.
  const inside = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const scrim = { x: inside.x, y: box.y / 2 };

  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(scrim.x, scrim.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(dialog).toBeVisible();

  // 대조: 같은 자리를 누르고 떼면 닫힌다.
  await page.mouse.click(scrim.x, scrim.y);
  await expect(dialog).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── Mermaid 「코드」 (스토리 103) ──
// 다이어그램 머리 줄의 「코드」는 켬/끔 토글이다 — 켜면 그림 자리에 원본 mermaid 코드가 서고, 켜졌는지를 `aria-pressed`로
// 말한다(전에는 말하지 않았다). 도움말 「원본 mermaid 코드 보기」는 툴팁이다 — 포커스로 뜨는 툴팁은 포인터를 한 번도
// 안 쓴 검사에서 잰다(「좋은 검사」). 문서는 전체화면 절의 「다이어그램.md」다.

const 코드 = (page: Page) => page.getByRole("button", { name: "코드", exact: true });
/** 원본 코드의 한 줄 — 그림(svg)에는 이 글자가 없다. 그림의 글자는 노드 이름뿐이다. */
const 원본코드 = (page: Page) => page.getByText("A[시작] --> B[끝]");

test("다이어그램의 「코드」는 켬/끔을 말하고, 누르면 그림과 원본 코드가 뒤집힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await 문서를연다(page, 다이어그램문서);
  const code = 코드(page);

  await expect(code).toHaveAttribute("aria-pressed", "false");
  await expect(원본코드(page)).toHaveCount(0);

  await code.click();
  await expect(code).toHaveAttribute("aria-pressed", "true");
  await expect(원본코드(page)).toBeVisible();

  await code.click();
  await expect(code).toHaveAttribute("aria-pressed", "false");
  await expect(원본코드(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("「코드」는 포커스에 툴팁 「원본 mermaid 코드 보기」를 띄우고, Space로 켜고 끈다", async ({ page }) => {
  await installFixtureBackend(page);
  await 문서를연다(page, 다이어그램문서);
  const code = 코드(page);
  const tooltip = page.locator("[data-slot=tooltip-content]");

  await code.focus();
  await expect(tooltip).toHaveText("원본 mermaid 코드 보기");

  await page.keyboard.press("Space");
  await expect(code).toHaveAttribute("aria-pressed", "true");
  await expect(원본코드(page)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(code).toHaveAttribute("aria-pressed", "false");
  await expect(원본코드(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 툴팁 (스토리 112 · 113, S28 · S29 · P13) ──
// 버튼의 도움말은 OS `title`이 아니라 앱 툴팁이다 — 올리면 600ms 뒤에, 포커스면 곧바로 선다. 단축키가 있으면 옆에 Kbd로
// 붙는다(「검색 ⌘K」). 툴팁은 역할도 설명도 주지 않으므로(S28) 글자는 표식(`data-slot`)으로 집고, 이름보다 더 말하던 것
// (단축키)은 버튼의 접근성 설명으로 따로 잰다. 대표는 사이드바의 검색 버튼 하나다 — 사이드바에서 `title`을 들던 버튼이
// 그것뿐이고(P13), 규칙이 부품 한 곳이라 나머지 자리는 같은 부품을 부른다.
//
// **사이드바 작업 행과 그 위의 핀에는 툴팁이 없다**(스토리 113, S29). 350ms 호버 카드가 600ms 툴팁보다 먼저 서므로, 카드가
// 선 순간에 「툴팁이 없다」를 재면 행에 툴팁을 잘못 달아도 초록이다 — 카드를 앵커로 본 뒤 시계로 툴팁 지연을 넘겨 돌리고
// 잰다. 대조로 같은 시계에서 검색 버튼은 툴팁을 세운다(시계가 툴팁을 막아서 초록인 판을 가른다).

/** 떠 있는 툴팁. 역할이 없어(S28) 표식으로 집는다 — 앱에 툴팁은 한 번에 하나만 선다. */
const 툴팁 = (page: Page) => page.locator("[data-slot=tooltip-content]");
/** 사이드바 머리(셸 컨트롤 줄)의 검색 버튼 — ⌘K와 같은 팔레트를 연다. */
const 검색 = (page: Page) => page.getByRole("button", { name: "검색", exact: true });

test("검색 버튼에 올리면 600ms 뒤 툴팁 「검색」과 Kbd `⌘K`가 서고, 버튼은 단축키를 설명으로 말한다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.clock.install();
  await page.goto(`/works/${pinnedWork.slug}`);
  const search = 검색(page);
  const tooltip = 툴팁(page);
  await expect(search).toBeVisible();
  // 이름은 그대로 「검색」이고, 이름보다 더 말하던 단축키는 설명이다(S28).
  await expect(search).toHaveAccessibleDescription("⌘K");
  await expect(tooltip).toHaveCount(0);

  await 시계를세운다(page);
  await search.hover();
  await page.clock.runFor(500);
  // 아래에서 곧 선다 — 이 「없다」는 그 앵커에 기대어 지연이 0이 아님을 잰다.
  await expect(tooltip).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(tooltip).toContainText("검색");
  await expect(tooltip.locator("[data-slot=kbd]")).toHaveText("⌘K");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 포인터를 한 번도 안 쓴다 — 포커스로 뜨는 툴팁은 그래야 잰다(「좋은 검사」).
test("포인터 없이 검색 버튼에 포커스하면 툴팁 「검색」과 Kbd `⌘K`가 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const tooltip = 툴팁(page);
  await expect(검색(page)).toBeVisible();
  await expect(tooltip).toHaveCount(0);

  await 검색(page).focus();

  await expect(tooltip).toContainText("검색");
  await expect(tooltip.locator("[data-slot=kbd]")).toHaveText("⌘K");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("작업 행과 그 위의 핀에 올려 툴팁 지연을 넘겨도 툴팁은 안 서고 호버 카드만 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.clock.install();
  await page.goto(`/works/${pinnedWork.slug}`);
  const row = workRow(page, plainWork.slug);
  const card = page.locator("[data-popover]");
  const tooltip = 툴팁(page);
  await expect(row).toBeVisible();
  await expect(card).toHaveCount(0);

  await row.hover();
  // 앵커: 호버 카드가 섰다(350ms). 툴팁(600ms)은 그 뒤라, 여기서 재면 헛돈다.
  await expect(card).toBeVisible();
  await page.clock.runFor(1000);
  await expect(tooltip).toHaveCount(0);

  // 핀은 행 안에 있다 — 올려도 카드는 그대로 서 있다.
  await row.getByRole("button", { name: `${plainWork.title} 고정`, exact: true }).hover();
  await page.clock.runFor(1000);
  await expect(card).toBeVisible();
  await expect(tooltip).toHaveCount(0);

  // 대조: 같은 시계에서 검색 버튼은 툴팁을 세운다.
  await 검색(page).hover();
  await page.clock.runFor(1000);
  await expect(tooltip).toContainText("검색");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

