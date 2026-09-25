import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  callCount,
  clipboardWrites,
  installFixtureBackend,
  ipcCallArgs,
  recordClipboard,
  unknownIpcCalls,
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
