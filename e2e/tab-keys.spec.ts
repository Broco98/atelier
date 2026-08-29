import { expect, test } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

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

const shells = (page: import("./evidence").Page) => page.locator('[data-tab="shell"]');
/** 켜짐을 말하는 쪽은 이름 버튼이다 — 칸 자체가 아니라 그 속성으로 집는다. */
const lit = (page: import("./evidence").Page, at: number) =>
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

  await page.keyboard.press("Meta+w");

  // **확인 창을 우회하지 않는다**(결정 22·92). 픽스처의 `pty_command_running`이 참이라
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
