import { expect, test, type Page } from "./evidence";
import { FIXTURE_GENERATION, WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  exitShell,
  fireAttention,
  fireEvent,
  installFixtureBackend,
  markAttention,
  openShell,
  sentNotifications,
  stubNotifications,
  typeIntoShell,
  unknownIpcCalls,
  띠,
  레인,
  셸입력,
} from "./harness";

// 프로세스 티켓 23 — **단축키 하나로 방금 부른 셸로 간다**(프로세스 결정 16 · 프로세스 스펙 S34 · S59 · P3 ⌘J).
//
// 가는 곳은 **가장 최근에 부르는 상태(기다림 · 확인할 것)에 들어선 셸**이다 — OS 알림을 꺼 두었거나 보고 있어서 안 울렸어도
// 같다. 그 셸이 이미 닫혔으면 「그 셸은 닫혔어요」 토스트로 끝나고 화면은 안 옮긴다(fail-closed). 기억 규칙과 셸을 고르는 판단은
// L2가 표로 잰다(`shell-recall.test.ts` · `shell-notify.test.ts`의 「들어선 셸」). 여기서 보는 것은 그 판단이 **진짜 키 리스너 ·
// 진짜 메뉴 사건 · 진짜 화면 이동 · 진짜 포커스**에 붙어 가는가다 — 스토어는 xterm을 들여 노드 seam에 없다.
//
// **L3에는 네이티브 메뉴가 없다.** 메뉴가 하는 일은 `hotkey:menu`에 code를 실어 보내는 것 하나라(`lib.rs`의 `on_menu_event`)
// 그 사건을 손으로 쏘면 메뉴 → 합성 keydown → 리스너의 나머지가 실제로 돈다(`search-palette.spec.ts`의 「메뉴가 쏜 ⌘K」와 같다).
// 셸에 포커스가 있을 때 직접 누른 ⌘J는 xterm의 키 핸들러를 지나 창으로 올라온다 — 그 길은 진짜 키로 잰다.
//
// 셸 키는 픽스처가 `l3-<pty 번호>`로 준다(`FIXTURE_INCREMENTING_KEYS`). 훅 사건의 셸 id도 같은 문자열이다(`fireAttention`).

const [, plainWork] = WORKS;

const 칸들 = (page: Page) => page.locator('[data-tab="shell"]');
/** 칸의 이름 버튼 — 켜짐(`aria-pressed`)이 서는 자리다. */
const 이름표 = (page: Page, at: number) => 칸들(page).nth(at).locator("button[aria-pressed]");
const 띠줄 = (page: Page, name: string) => 띠(page).getByRole("button", { name, exact: true });
const 토스트자리 = (page: Page) => page.getByRole("region", { name: "앱 메시지", exact: true });
const 닫힌셸토스트 = (page: Page) => 토스트자리(page).getByRole("dialog", { name: "그 셸은 닫혔어요", exact: true });

/** 네이티브 메뉴의 `View ▸ Last Calling Shell`(⌘J)이 쏘는 것을 손으로 쏜다. */
const 메뉴로누름 = (page: Page) => fireEvent(page, "hotkey:menu", "KeyJ");

/** 셸이 사람에게 묻는다 — 띠에 「나를 기다림」. 보고 있어도 안 꺼진다(결정 7). `at`이 부른 차례를 가른다. */
const 기다림 = (at: number) => ({
  agent: "claude",
  event: "Elicitation",
  at,
  payload: { message: "어느 쪽으로 할까요?" },
});

/** 턴을 마쳤다 — 띠에 「확인할 것」. 그 셸을 보면 꺼진다(프로세스 결정 13). */
const 턴끝 = (at: number) => ({
  agent: "claude",
  event: "Stop",
  at,
  payload: { last_assistant_message: "다 했어요" },
  stopped: true,
});

/** 포커스가 셸의 입력칸에 있다(하네스의 `셸입력`). 떼어 둔 셸은 DOM에서 빠지므로 화면에 선 입력칸은 보이는 셸 하나뿐이다. */
async function expectShellFocused(page: Page, message: string): Promise<void> {
  await expect(셸입력(page), message).toBeFocused();
}

/**
 * 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 두 프레임을 넘긴다. **「없다」를 재기 전에 부른다**(`startup-report.spec.ts`의
 * 같은 이름과 같은 까닭): 없음을 재는 단언은 곧바로 초록이라, 답이 아직 안 그려진 순간에 지나간다.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** 떠 있는 work 화면을 떠나 최상위 터미널로 간다 — 그 첫 셸(pty `n`)이 spawn 답을 받고 포커스를 쥘 때까지. */
async function 터미널로(page: Page, n: number): Promise<void> {
  await page.locator("nav").getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page).toHaveURL("/terminal");
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(n);
  await awaitSpawned(page, 1);
  await expectShellFocused(page, "최상위 터미널의 셸에 포커스가 없다");
}

test("셸 띄우기 답의 셸 키를 셸이 든다 — 두 셸의 키가 서로 다르다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await openShell(page);

  await expect(칸들(page).nth(0)).toHaveAttribute("data-shell-key", `${FIXTURE_GENERATION}-1`);
  await expect(칸들(page).nth(1)).toHaveAttribute("data-shell-key", `${FIXTURE_GENERATION}-2`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **나중에 부른 셸로 간다** — 띠의 차례(오래 기다린 것이 위)가 아니다. 뒤에 부른 셸은 보고 있는 중이라 OS 알림이 안 울렸는데도
// 기억한다(S59). 누르는 자리는 **다른 셸의 xterm**이다 — 키가 셸의 키 핸들러를 지나 창까지 올라와야 한다.
test("두 셸이 차례로 부르면 ⌘J가 나중에 부른 셸로 가고 포커스가 그 셸에 온다 — 보고 있어 안 울린 부름이어도", async ({
  page,
}) => {
  await stubNotifications(page);
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await openShell(page);
  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "true");

  // 둘째 칸을 보는 동안 첫 칸이 먼저 부른다 — 안 보이니 운다.
  await fireAttention(page, 기다림(1000), 1);
  await expect.poll(async () => (await sentNotifications(page)).length, { message: "첫 부름이 안 울렸다" }).toBe(1);
  // 뒤이어 보고 있는 둘째 칸이 부른다 — 보고 있으니 안 운다.
  await fireAttention(page, 기다림(2000), 2);
  await expect(이름표(page, 1)).toHaveAttribute("aria-label", /나를 기다림/);
  expect((await sentNotifications(page)).length, "보고 있는 셸의 부름이 울렸다 — 이 검사의 전제가 아니다").toBe(1);

  // 첫 칸으로 옮긴다 — 포커스가 그 셸의 xterm에 든다(티켓 16).
  await 이름표(page, 0).click();
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expectShellFocused(page, "첫 칸을 누른 뒤 포커스가 셸에 없다 — 아래 ⌘J가 셸 안에서 눌리지 않는다");

  await page.keyboard.press("Meta+j");

  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "false");
  await expectShellFocused(page, "⌘J로 간 셸에 포커스가 없다");
  await expect(page).toHaveURL("/terminal");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **다른 work의 셸이면 화면을 옮긴 뒤 같다.** 누르는 길은 메뉴다 — 셸에 포커스가 있어 xterm이 키를 먹는 상태에서 메뉴가 쏜
// 사건이 창의 리스너에 닿는다.
test("다른 work의 셸이 나중에 불렀으면 메뉴의 ⌘J가 그 화면으로 옮긴 뒤 포커스를 그 셸에 준다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  // 사람이 친 셸이라 화면을 떠나도 닫히지 않는다(프로세스 결정 7).
  await typeIntoShell(page);
  await 터미널로(page, 2);

  // 먼저 여기 셸(pty 2)이, 뒤이어 떠나온 work의 셸(pty 1)이 부른다.
  await fireAttention(page, 기다림(1000), 2);
  await expect(띠줄(page, "Terminal — 나를 기다림")).toHaveCount(1);
  await fireAttention(page, 기다림(2000), 1);
  await expect(띠줄(page, `${plainWork.title} — 나를 기다림`)).toHaveCount(1);
  await expectShellFocused(page, "누르기 전에 포커스가 여기 셸에 없다 — 「셸이 키를 먹는 상태」가 아니다");

  await 메뉴로누름(page);

  await expect(page).toHaveURL(`/works/${plainWork.slug}?tab=terminal`);
  await expectShellFocused(page, "옮겨 간 뒤 포커스가 그 셸로 안 왔다");
  // 옮겨 간 화면의 셸은 새로 뜬 것이 아니라 그 셸이다.
  expect(await callCount(page, "pty_spawn")).toBe(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **저쪽 세계의 셸이어도 간다** — 띠는 이 세계의 셸만 세우지만(`bandRows`) 알림은 두 세계를 함께 판정하고, ⌘J가 기억하는 것도
// 그 판정이 가른 들어섬이다. 가는 화면은 셸 주인의 세계로 짓는다 — 지금 선 세계로 지으면 이쪽 터미널에 머문다.
test("저쪽 세계의 셸이 나중에 불렀으면 ⌘J가 그 세계의 화면으로 간다", async ({ page }) => {
  await stubNotifications(page);
  await installFixtureBackend(page);
  await page.goto("/maison/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);

  // 세그먼트로 건너간다 — 주소를 직접 치면 페이지가 새로 떠 스토어가 빈다(`terminal-worlds.spec.ts`).
  await page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: "Atelier", exact: true }).click();
  await page.locator("nav").getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page).toHaveURL("/terminal");
  await awaitSpawned(page, 1);
  await expectShellFocused(page, "이쪽 터미널의 셸에 포커스가 없다");

  // 저쪽 셸(pty 1)이 부른다 — 이 세계의 띠에는 안 서고, 안 보이니 운다(앵커).
  await fireAttention(page, 기다림(1000), 1);
  await expect.poll(async () => (await sentNotifications(page)).length, { message: "저쪽 셸의 부름이 안 닿았다" }).toBe(1);
  await expect(띠(page)).toHaveCount(0);

  await page.keyboard.press("Meta+j");

  await expect(page).toHaveURL("/maison/terminal");
  await expectShellFocused(page, "건너간 뒤 포커스가 그 셸로 안 왔다");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **fail-closed**(프로세스 결정 16). 기억한 셸이 없으면 먼저 부른 다른 셸로 대신 가지 않고, 옛 자리로 옮기지도 않는다.
test("방금 부른 셸이 닫혔으면 「그 셸은 닫혔어요」가 서고 화면은 안 옮긴다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await markAttention(page, 기다림(1000), 1);
  await 터미널로(page, 2);
  await expect(띠줄(page, `${plainWork.title} — 나를 기다림`)).toHaveCount(1);

  // 그 셸이 스스로 끝났다 — 코드 0이면 칸이 목록에서 빠진다(결정 48).
  await exitShell(page, 1, 0);
  // 앵커: 셸이 빠져 띠의 줄도 없다.
  await expect(띠(page)).toHaveCount(0);

  await page.keyboard.press("Meta+j");

  await expect(닫힌셸토스트(page)).toBeVisible();
  await settle(page);
  await expect(page).toHaveURL("/terminal");
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 옮겨 가면 「봤다」 규칙(셸 탭이 켜지고 창에 포커스)이 그 셸의 확인할 것을 끈다 — ⌘J가 그 규칙을 거친다.
test("⌘J로 옮겨 간 뒤 그 셸의 확인할 것이 꺼진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openShell(page);
  await 이름표(page, 0).click();
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "true");

  await fireAttention(page, 턴끝(1000), 2);
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);

  await page.keyboard.press("Meta+j");

  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(띠(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **부른 셸이 없으면 아무것도 안 한다.** 「없다」만 재면 사건이 아예 안 닿아도 초록이라, 셸이 떠 있고 단축키 사건이 창의 키
// 리스너까지 닿았다는 것을 먼저 센다. 도는 중으로 들어선 셸은 부른 셸이 아니다(S59).
test("부른 셸이 없으면 ⌘J가 아무것도 안 한다 — 도는 중인 셸이 있어도", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openShell(page);
  await markAttention(page, { agent: "claude", event: "UserPromptSubmit", at: 1000, payload: { prompt: "고쳐 줘" } }, 2);
  await expect(레인(page, plainWork.slug).locator('[data-signal="working"]')).toHaveCount(1);
  await 이름표(page, 0).click();
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "true");

  // 창의 키 리스너에 닿은 ⌘J를 센다 — 앱의 리스너와 같은 자리(`window`의 keydown)다.
  await page.evaluate(() => {
    const seen = { count: 0 };
    (window as unknown as { __recallKeys: typeof seen }).__recallKeys = seen;
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyJ" && event.metaKey) seen.count += 1;
    });
  });

  await 메뉴로누름(page);

  // 앵커: 사건이 창의 리스너까지 닿았다.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __recallKeys: { count: number } }).__recallKeys.count))
    .toBe(1);
  await settle(page);
  expect(await 토스트자리(page).getByRole("dialog").count()).toBe(0);
  await expect(page).toHaveURL(`/works/${plainWork.slug}?tab=terminal`);
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
