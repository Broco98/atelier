import { SEARCH_GAP_MS } from "@/features/terminal/shell-registry";
import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { SEARCH_DESTINATION_QUERY, SEARCH_HITS, WORKS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 판 01 — ⇧⇧로 열고, 치면 좁혀지고, 방향키로 고르고, Enter로 간다.
//
// **마크업 seam이 보는 것은 여기서 다시 보지 않는다.** 줄에 무엇이 적히는지·골라진 줄이
// 하나인지·없다고 말하는 줄은 SearchPalette.test.tsx가 들고, 맞추는 규칙과 상한은 코어
// 단위가 들고, 늦은 답을 버리는 것은 옵션 seam이 든다(hooks.test.ts). 이 층이 드는 것은
// 이벤트가 있어야만 보이는 것들이다 — 셸을 지나오는 키, 마우스, 실제 이동, 「떠 있는 창이
// 막는다」, 그리고 **친 것이 명령까지 가는 배선**.
//
// **가장 큰 것은 첫 검사다.** 「⇧ 단독 keydown이 xterm을 지나 window까지 오는가」는 실물
// xterm이 붙어야만 답이 나오고, 다른 층은 전부 xterm 없이 돈다.

const [specWork] = WORKS;

const palette = (page: Page) => page.getByRole("listbox", { name: "검색 결과" });
const rows = (page: Page) => page.getByRole("option");
const box = (page: Page) => page.getByRole("textbox", { name: "검색어" });

/**
 * 검색 명령이 **어떤 질의로** 나갔는가. 같은 질의가 두 번 나가는 것은 세지 않는다 —
 * StrictMode가 붙였다 떼는 자리라 그 수는 이 검사가 말하려는 것이 아니다.
 */
async function askedFor(page: Page): Promise<string[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  const asked = calls
    .filter((call) => call.startsWith("search "))
    .map((call) => JSON.parse(call.slice("search ".length)).query as string);
  return [...new Set(asked)];
}

/** ⇧를 두 번 누른다. **사이에 아무 키도 안 낀다** — 끼면 무장이 풀린다. */
async function doubleShift(page: Page) {
  await page.keyboard.press("Shift");
  await page.keyboard.press("Shift");
}

/** 포커스가 xterm의 숨은 입력칸에 있는가 — 셸을 붙이면 그쪽이 스스로 가져간다. */
const focusedClass = (page: Page) =>
  page.evaluate(() => document.activeElement?.className ?? "");

test("⇧⇧가 셸에 포커스가 있는 동안에도 팔레트를 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);
  // **이 줄이 이 검사의 전제다.** 포커스가 셸에 없으면 「셸을 지나온다」를 아무것도 안 잰다.
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");

  await doubleShift(page);

  await expect(palette(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 29. **치는 동안 즉시 따라온다** — 디바운스가 없으니 글자 하나가 곧 물음 하나다.
// 이 층이 드는 것은 **배선**이다: 포커스가 칸으로 오는가, 친 것이 그대로 명령에 실려 나가는가.
// 좁혀지는 규칙은 코어 단위가 든다 — 이 층의 픽스처는 질의를 못 보고 늘 같은 답을 준다.
test("치면 그 글자가 그대로 명령으로 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  await doubleShift(page);
  // **팔레트가 포커스를 가져와야 한다.** 안 가져오면 친 글자가 칸이 아니라 뒤 화면으로 간다.
  await expect(box(page)).toBeFocused();

  await box(page).pressSequentially("고정");

  await expect(box(page)).toHaveValue("고정");
  // 열 때 한 번(빈 질의), 글자마다 한 번씩. 마지막 물음이 **지금 칸에 있는 것**이다.
  await expect.poll(() => askedFor(page)).toEqual(["", "고", "고정"]);
  // 치는 사이에 목록이 비지 않는다 — 픽스처가 질의를 안 보므로 줄 수는 내내 같다.
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 21·51. **설정은 사이드바 nav 줄에 없지만 팔레트는 갈 수 있다** — 「nav 줄에 서는가」와
// 「팔레트가 갈 수 있는가」가 다른 물음이라, 설정만 `navItems` 밖에 산다(`destinations.ts`).
//
// 이 층이 드는 것은 그 갈림이 **화면에서 끝까지 도는가**다: 코어는 `key` 하나만 돌려주므로
// (결정 21) 프런트가 그것으로 라벨을 되찾아 그리고, 주소를 되찾아 실제로 그 화면을 세운다.
// **둘을 한 검사에서 본다** — 뜨기만 하고 안 가면 안 고친 것과 같고, `navItems`만 훑던
// 시절의 실패가 정확히 그 모양이었다(목록에는 뜨는데 Enter가 아무 일도 안 한다).
//
// 좁혀지는 것은 여기서 안 잰다 — 이 질의 하나에만 답이 심겨 있다(fixtures의 머리말).
test("설정 줄을 고르면 설정 화면이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await doubleShift(page);
  await expect(box(page)).toBeFocused();
  await box(page).pressSequentially(SEARCH_DESTINATION_QUERY);

  // **`exact`가 있어야 한다.** 이름 맞추기는 대소문자를 접으므로, 라벨 되찾기가 통째로 죽어
  // key(`settings`)가 그대로 서도 `exact` 없이는 초록이 된다.
  const row = page.getByRole("option", { name: "Settings", exact: true });
  await expect(rows(page)).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");

  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL("/settings");
  // **주소만 보면 화면이 안 서도 초록이다.** 설정 화면의 구획 머리가 그 자리에 선다.
  await expect(page.getByRole("heading", { name: "터미널" })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 30. 키만 보면 **⇧+클릭 두 번이 팔레트를 연다** — 그 사이에 keydown이 하나도 안 끼기
// 때문이다. 본문에서 선택을 늘리는 흔한 동작이 그 모양이고, 무장을 비우는 것이 순수 함수
// 밖에 사는 유일한 규칙이라 **잴 수 있는 자리가 여기뿐이다.**
test("⇧+클릭 두 번으로는 안 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const body = page.locator("main").getByRole("heading", { name: "개요" });
  await expect(body).toBeVisible();

  const startedAt = Date.now();
  await body.click({ modifiers: ["Shift"] });
  await body.click({ modifiers: ["Shift"] });
  const elapsed = Date.now() - startedAt;

  await expect(palette(page)).toHaveCount(0);
  // **이 검사가 마우스 때문에 초록인지 시간 때문에 초록인지를 가른다.** 두 ⇧ 사이가 간격을
  // 넘겼으면 mousedown 규칙을 통째로 지워도 초록이라, 아무것도 안 재고 지나간다.
  expect(elapsed, "두 ⇧ 사이가 간격을 넘겼다 — 이 검사가 마우스를 재지 못한다").toBeLessThan(
    SEARCH_GAP_MS,
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 16·77·97. 방향키로 고른 것이 열리고, **분할이 그대로 남는다.**
test("방향키로 고른 문서로 가고 분할이 안 무너진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}?tab=terminal&split=lr`);
  await expect(page.locator(".xterm")).toHaveCount(1);

  await doubleShift(page);
  await expect(rows(page).nth(0)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(rows(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");

  await page.keyboard.press("Enter");

  await expect(palette(page)).toHaveCount(0);
  // 주소가 **고른 줄의 문서**를 가리킨다. 첫 줄로 갔으면 여기가 빨개진다 — 방향키가
  // 표시만 옮기고 Enter가 늘 첫 줄을 여는 퇴화가 그 모양이다.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("file"))
    .toBe(specWork.specFiles[1]);
  // **분할이 그대로다**(결정 16) — 문서를 갈아 끼우려고 화면을 다시 만들지 않는다.
  await expect(page).toHaveURL(/split=lr/);
  // 문서를 골랐으므로 본문은 spec으로 돌아온다(결정 50).
  await expect(page).not.toHaveURL(/tab=terminal/);
  // 화면에 선 것도 **그 문서**다 — 둘째 줄이 그림이라 본문이 그림으로 선다. 첫 줄을 열었으면
  // 마크다운이 서므로 주소와 화면이 함께 갈린다.
  await expect(page.locator("main img")).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 「키보드가 주인 도구」여도 손이 마우스에 있을 때가 있다. 클릭은 정적 마크업 seam에
// 이벤트가 없어 안 보인다 — 줄이 `<button>`이라는 것까지가 그쪽이 드는 전부다.
test("마우스로도 고를 수 있다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  await doubleShift(page);
  await rows(page).nth(1).click();

  await expect(palette(page)).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("file"))
    .toBe(specWork.specFiles[1]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Esc로 닫히고 주소도 포커스도 제자리다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}?tab=terminal`);
  // 화면이 서기를 기다린다 — 앱이 뜨기 전에 누르면 키를 듣는 자리가 아직 없다.
  await expect(page.locator(".xterm")).toHaveCount(1);
  // **이 줄이 아래 포커스 검사의 전제다.** 포커스가 애초에 셸에 없으면 돌려주는 것을
  // 아무것도 안 잰다.
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");
  const before = page.url();

  await doubleShift(page);
  await expect(palette(page)).toBeVisible();
  // 입력칸이 생기면서 포커스가 셸을 떠난다 — 빌린 것이 있어야 돌려줄 것도 있다.
  await expect(box(page)).toBeFocused();

  await page.keyboard.press("Escape");

  await expect(palette(page)).toHaveCount(0);
  expect(page.url()).toBe(before);
  // **빌린 포커스를 돌려준다.** 안 돌려주면 Esc 뒤에 친 글자가 아무 데도 안 들어간다.
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 4. 「어디서 눌렸나」와 「화면에 무엇이 떠 있나」는 다른 물음이고, 뒤엣것은 부르는
// 쪽(앱 셸)이 든다 — 물음에 답하는 중에 화면이 가려지면 안 된다.
test("확인 창이 떠 있는 동안에는 안 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();

  await doubleShift(page);

  await expect(palette(page)).toHaveCount(0);
  // 창은 그대로 서 있다 — 팔레트가 그 위를 덮지도, 창을 대신 닫지도 않는다.
  await expect(ask).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
