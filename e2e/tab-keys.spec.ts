import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, unknownIpcCalls, 툴팁 } from "./harness";

// 판 03 — **키가 실제로 그 일을 하는가**, 그리고 **탭을 누르면 본문이 바뀌는가.**
//
// `스펙-이슈-136.md`의 Testing Decisions가 이 층에 맡긴 것들이고, 티켓 #139의 수용 기준
// 둘(「⌘T가 새 셸을 열고 그것이 칸으로 선다」·「⌘W가 켜진 탭을 닫는다. `spec`에서는 아무
// 일도 안 한다」)이 여기 걸린다.
//
// **정적 마크업 seam으로는 못 본다.** 그쪽이 드는 것은 「`window`에 리스너를 건다」는 배선
// 문자열과 겨눌 칸을 정하는 순수 판정 둘뿐이라(WorksPage.test.tsx·TerminalPage.test.tsx),
// 그 둘이 다 초록이어도 **키가 브라우저를 거쳐 오지 않으면** 아무 일도 안 일어난다.
// 이벤트가 없는 seam에서는 이펙트가 아예 안 돈다.
//
// 픽스처 백엔드가 `pty_spawn`을 답해 xterm이 실제로 뜬다(terminal-tabs.spec.ts가 선례다).

// 문서가 있는 work과 없는 work을 갈라 쓴다 — 본문이 갈리는 것을 재려면 고를 문서가 있어야 한다.
const [specWork, plainWork] = WORKS;

const shells = (page: Page) => page.locator('[data-tab="shell"]');
/** 켜짐을 말하는 쪽은 이름 버튼이다 — 칸 자체가 아니라 그 속성으로 집는다. */
const lit = (page: Page, at: number) =>
  shells(page).nth(at).locator("button[aria-pressed]");

test("⌘T가 새 셸을 열고 그 칸이 켜진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(shells(page)).toHaveCount(1);

  await page.keyboard.press("Meta+t");

  await expect(shells(page)).toHaveCount(2);
  // **새 칸이 켜져야 한다.** 수만 세면 「열리긴 했는데 안 켜진다」가 통과한다.
  await expect(lit(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(lit(page, 0)).toHaveAttribute("aria-pressed", "false");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **셸이 0개인 화면에서도 열려야 한다**(결정 19). 위 검사와 **다른 길이다** — 셸에 포커스가
// 있으면 xterm의 키 핸들러가 먼저 받고(`terminal-store`의 `attachCustomKeyEventHandler`),
// 셸이 없으면 받을 xterm이 없어 window 리스너가 유일한 길이다(`opensShellFromWindow`).
// 위 검사만 두면 그 리스너를 통째로 끊어도 초록이다(뮤테이션으로 확인).
test("셸이 0개인 화면에서도 ⌘T가 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  // **닫기가 확인 창을 거치려면 그 칸이 pty를 가져야 한다**(`awaitSpawned`의 머리말).
  await awaitSpawned(page, 1);

  // 마지막 칸을 닫으면 새 셸이 저절로 안 뜬다(결정 19) — 그 자리를 만든다.
  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').click();
  await page.getByRole("alertdialog").getByRole("button", { name: "닫기" }).click();
  await expect(shells(page)).toHaveCount(0);

  await page.keyboard.press("Meta+t");

  await expect(shells(page)).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("⌘W가 켜진 셸 칸을 닫는다 — 확인을 거쳐서", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await page.locator('[data-tab="new"]').click();
  await expect(shells(page)).toHaveCount(2);
  // **칸이 선 것과 pty가 앉은 것은 다른 순간이다**(`awaitSpawned`의 머리말) — 안 기다리면
  // 아래 확인 창이 「안 뜨는 것이 옳은」 상태에서 눌러 러너가 붐빌 때만 빨개진다.
  await awaitSpawned(page, 2);

  await page.keyboard.press("Meta+w");

  // **확인 창을 우회하지 않는다** — ⌘W는 `×`와 같은 판정을 쓴다(ux-papercuts 결정 92 · work-tab-header 결정 13).
  // 픽스처의 `pty_close_check`가 「명령이 돈다」라
  // 이 길은 늘 물어본다 — 여기가 안 서면 셸을 말없이 죽이는 길이 새로 생긴 것이다.
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "닫기" }).click();

  await expect(shells(page)).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`spec`이 켜져 있으면 ⌘W가 아무 일도 안 한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(shells(page)).toHaveCount(1);

  // 문서 칸으로 옮긴다. **여기가 이 검사의 절반이다** — 옮겨지지 않으면 아래 ⌘W는
  // 「셸이 켜진 채로 눌렀는데 안 닫혔다」가 되어 정반대의 버그를 초록으로 덮는다.
  await page.locator('[data-tab="spec"]').click();
  await expect(page.locator('[data-tab="spec"]')).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Meta+w");

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(shells(page)).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("탭을 누르면 본문이 그 칸의 것으로 바뀐다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}?tab=terminal`);

  // 셸이 켜진 채로 들어온다 — 본문은 진짜 xterm이다.
  const term = page.locator(".xterm");
  await expect(term).toHaveCount(1);

  await page.locator('[data-tab="spec"]').click();
  // **본문이 정말 갈렸는가**를 양쪽으로 잰다 — xterm이 사라지고, 문서 쪽의 것이 선다.
  // 탭의 `aria-pressed`만 보면 「칸은 켜졌는데 본문은 그대로」가 통과한다.
  await expect(term).toHaveCount(0);
  // 문서 쪽의 것 = **본문에 선 문서 자체**다(픽스처의 `read_spec_file`이 「# 개요」를 준다).
  // 트리는 오른쪽 패널이라 본문이 갈렸는지를 못 말한다.
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  await lit(page, 0).click();
  await expect(term).toHaveCount(1);
  // **돌아올 때도 양쪽을 잰다.** 셸만 세면 「둘 다 서 있다」가 통과한다 — 분할이 아닌데
  // 문서가 남아 있는 상태가 그것이고, 그때 화면은 두 본문이 겹친 것이 된다(뮤테이션으로 확인).
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 작업 패널의 레일 (ui-refresh 결정 9 · 10) ──
// 작업 패널을 고르고 여닫는 자리는 패널 **밖**, 바탕 오른쪽 끝의 레일이다. 맨 위에 패널 토글 하나가, 그 아래에 칸(`spec` ·
// `info`) 묶음이 선다. 칸은 `aria-pressed` 버튼이다 — 켜진 칸을 다시 누르면 패널이 닫혀 켜진 칸이 0개일 수 있으므로 탭이
// 아니다(탭 줄이 `role="tab"`을 안 쓰는 것과 같은 가족이다). 칸 사이 ←/→ 이동은 없다 — 칸은 Tab으로 옮겨 가는 버튼이다(판 04
// 티켓 04의 「잃는 것」). 두 몸은 함께 마운트된 채라(안 보이는 쪽은 `hidden` · `inert`) `spec`에서 접어 둔 폴더가 `info`에
// 다녀와도 접혀 있다.
//
// **칸은 레일 묶음(`role="group"`) 안에서 집는다** — 탭 줄의 `spec` 칸과 이름이 같다. 문서는 `specWork`의 트리다(폴더 「증거」).

const 레일 = (page: Page) => page.getByRole("group", { name: "레일", exact: true });
const 레일칸 = (page: Page, name: "spec" | "chat" | "info") => 레일(page).getByRole("button", { name, exact: true });
/** 패널 토글 — 이름이 상태를 탄다(열렸으면 「접기」, 닫혔으면 「펼치기」). */
const 토글 = (page: Page) => page.getByRole("button", { name: /^작업 패널 (접기|펼치기)$/ });
const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });
/** 패널 카드 머리 — 고른 칸의 제목 하나만 든다(`×`도 탭도 없다). */
const 패널머리 = (page: Page) => 작업패널(page).locator('[data-slot="card-head"]');
/** info 몸이 섰다는 표식 — 그 첫 줄의 slug 복사 행. 숨은 몸은 `hidden`이라 접근성 트리에 없다. */
const slug행 = (page: Page) => 작업패널(page).getByRole("button", { name: `slug ${specWork.slug}`, exact: true });
const 폴더 = (page: Page) => 작업패널(page).getByRole("button", { name: "증거", exact: true });
/** 작업 패널 칸(두 번째 `aside`)의 그려진 폭 — 접히면 「틈 + 카드」가 함께 0이 된다. */
const 패널폭 = (page: Page) => page.locator("aside").nth(1).evaluate((el) => Math.round(el.getBoundingClientRect().width));

test("레일 칸을 누르면 그 패널이 서고, 켜진 칸을 다시 누르면 패널이 닫히고 레일은 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const spec = 레일칸(page, "spec");
  const info = 레일칸(page, "info");
  // 처음은 `spec`으로 열려 있다 — 열린 칸 하나만 켜져 있다.
  await expect(토글(page)).toHaveAttribute("aria-expanded", "true");
  await expect(spec).toHaveAttribute("aria-pressed", "true");
  await expect(info).toHaveAttribute("aria-pressed", "false");
  await expect(폴더(page)).toBeVisible();
  await expect(패널머리(page)).toHaveText("spec");

  // 다른 칸을 누르면 그 칸으로 바뀐다. **몸이 정말 갈렸는가**를 양쪽으로 잰다 — 칸의 켜짐만 보면 「칸은 켜졌는데 몸은
  // 그대로」가 통과한다.
  await info.click();
  await expect(info).toHaveAttribute("aria-pressed", "true");
  await expect(spec).toHaveAttribute("aria-pressed", "false");
  await expect(slug행(page)).toBeVisible();
  await expect(폴더(page)).toHaveCount(0);
  await expect(패널머리(page)).toHaveText("info");
  // 복사 행의 이름은 라벨과 값이고, 도움말(툴팁)은 이름보다 더 말하는 것이라 설명으로 남는다(S28).
  await expect(slug행(page)).toHaveAccessibleDescription("slug 복사");
  await expect(작업패널(page).getByRole("button", { name: /^작업 폴더 / })).toHaveAccessibleDescription("경로 복사");

  // 켜진 칸을 다시 누르면 닫힌다(ui-refresh 결정 9). 켜진 칸이 없어지고, 레일은 그 자리에 남는다(ui-refresh 결정 10).
  await info.click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "false");
  await expect(토글(page)).toHaveAccessibleName("작업 패널 펼치기");
  await expect(info).toHaveAttribute("aria-pressed", "false");
  await expect(spec).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => 패널폭(page)).toBe(0);
  await expect(spec).toBeVisible();
  await expect(info).toBeVisible();

  // 닫힌 채 칸을 누르면 그 칸으로 열린다.
  await spec.click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "true");
  await expect(spec).toHaveAttribute("aria-pressed", "true");
  await expect(폴더(page)).toBeVisible();
  await expect(패널머리(page)).toHaveText("spec");
  await expect.poll(() => 패널폭(page)).toBeGreaterThan(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("패널 토글과 ⌘Enter는 열림만 뒤집고 고른 칸은 그대로다 — 토글의 이름 · 도움말이 상태를 탄다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const info = 레일칸(page, "info");
  await info.click();
  await expect(slug행(page)).toBeVisible();

  // 열렸으면 「접기」이고 도움말에 ⌘Enter가 선다. 키는 설명으로도 남는다(S28 — `Hint`의 `shortcut`). 도움말은 포인터를 올려
  // 띄운다 — 칸을 마우스로 누른 뒤라 프로그램으로 준 포커스는 `:focus-visible`이 아니어서 도움말을 안 띄운다.
  const toggle = 토글(page);
  await expect(toggle).toHaveAccessibleName("작업 패널 접기");
  await expect(toggle).toHaveAccessibleDescription("⌘Enter");
  await toggle.hover();
  await expect(툴팁(page)).toHaveText("작업 패널 접기 ⌘Enter");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAccessibleName("작업 패널 펼치기");
  await expect(info).toHaveAttribute("aria-pressed", "false");
  // 도움말도 상태를 탄다 — 비켰다가 다시 올리면 「펼치기」다.
  await page.mouse.move(0, 0);
  await expect(툴팁(page)).toHaveCount(0);
  await toggle.hover();
  await expect(툴팁(page)).toHaveText("작업 패널 펼치기 ⌘Enter");
  await expect.poll(() => 패널폭(page)).toBe(0);
  // 다시 열면 고른 칸(`info`) 그대로다 — 토글이 칸을 `spec`으로 되돌리면 안 된다.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(info).toHaveAttribute("aria-pressed", "true");
  await expect(slug행(page)).toBeVisible();

  // ⌘Enter가 같은 일을 한다. 포커스가 버튼에 있으면 키가 버튼을 함께 누를 수 있어 먼저 놓는다 — 재는 것은 창의 단축키다.
  await toggle.blur();
  await page.keyboard.press("Meta+Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(info).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Meta+Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(info).toHaveAttribute("aria-pressed", "true");
  await expect(slug행(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`spec`에서 접은 폴더는 `info`에 다녀와도 접혀 있다 — 안 보이는 몸도 마운트된 채다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const folder = 폴더(page);
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");

  await 레일칸(page, "info").click();
  // 앵커: info가 섰고 spec은 숨었다. 안 옮겨졌으면 아래 「그대로 접혀 있다」는 다녀온 적이 없어서 초록이다.
  await expect(slug행(page)).toBeVisible();
  await expect(folder).toHaveCount(0);

  await 레일칸(page, "spec").click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
