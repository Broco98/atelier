import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  holdTerminalFonts,
  installFixtureBackend,
  markAttention,
  navButton,
  typeIntoShell,
  unknownIpcCalls,
  띠,
  셸입력,
} from "./harness";

// 티켓 16 — **셸로 가는 모든 길이 키보드 포커스를 데려온다**(프로세스 결정 18 ② · 프로세스 스펙 S21 · 스토리 44~46).
//
// 띠의 줄과 셸 탭은 누르면 그 셸을 켠다. 그런데 **이미 켜진 셸을 다시 고르면 레지스트리가 같은 상태를 돌려줘**
// 붙기가 다시 돌지 않고, 그래서 포커스를 줄 자리가 없었다. 게다가 WebKit은 버튼을 누르는 순간(mousedown) 포커스를
// 옮기지 않는 대신 **비운다** — 셸에 있던 포커스도 그 순간 떠나 `body`로 간다. 두 사실이 겹쳐 「보고 있는 셸을 눌렀는데
// 키가 아무 데도 안 들어간다」가 됐다. 이제 누르는 자리가 스토어에 포커스를 **요청한다**(`selectShellWithFocus`).
//
// 재는 것은 포커스다 — 그 셸의 xterm이 키를 받는 숨은 입력칸(하네스의 `셸입력`)이어야 한다. 떼어 둔 셸의 집은 DOM에서
// 빠지므로(`detachShell`) 화면에 선 입력칸은 지금 보이는 그 셸 하나뿐이다.
//
// **바꾸기 전에 빨간 것을 macOS의 WebKit에서 봤다**(구현 기록 16절). 리눅스 WebKit(CI)의 버튼 포커스 동작은 다를 수
// 있지만, 고친 뒤의 단언은 두 플랫폼에서 같다.

const [, plainWork] = WORKS;

/**
 * 지금 포커스가 셸 자리(`[data-shell-host]`) **밖**인가. 「셸이 포커스를 안 가져갔다」는 팔레트가 떠 있는 동안 재는데, 그때
 * 셸 입력칸은 모달 아래라 `aria-hidden`이어서 역할로 못 집는다(`셸입력` 머리말) — 그래서 이쪽은 자리로 본다. 클래스 문자열은
 * 안 본다(검사 규칙).
 */
const focusOutsideShell = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest("[data-shell-host]") === null);

/** 포커스가 셸에 든다 — **전제로 먼저 본다.** 처음부터 셸에 없으면 「누른 뒤에도 셸이다」가 아무것도 안 잰다. */
async function expectShellFocused(page: Page, message: string): Promise<void> {
  await expect(셸입력(page), message).toBeFocused();
}

/**
 * 이 셸이 부른다 — 사람에게 묻는 claude(`Elicitation`)는 띠에 「나를 기다림」으로 선다. 보고 있어도 안 꺼진다(결정 7).
 * 한때 턴의 끝(`Stop`)이었는데 프로세스 결정 13이 그것을 「확인할 것」으로 옮겨, 보고 있는 셸에서는 곧바로 꺼진다.
 */
async function callFromShell(page: Page, ptyId = 1): Promise<void> {
  await markAttention(
    page,
    { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: "어느 쪽으로 할까요?" } },
    ptyId,
  );
}

const bandRowOf = (page: Page, title: string) =>
  띠(page).getByRole("button", { name: `${title} — 나를 기다림`, exact: true });

test("띠에서 지금 보고 있는 셸을 누르면 포커스가 그 셸로 온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expectShellFocused(page, "처음 붙은 셸에 포커스가 없다");
  await callFromShell(page);

  await bandRowOf(page, plainWork.title).click();

  // 화면은 그대로다 — 같은 work의 터미널을 보던 중이다.
  await expect(page).toHaveURL(`/works/${plainWork.slug}?tab=terminal`);
  await expectShellFocused(page, "띠를 누른 뒤 포커스가 셸로 안 돌아왔다");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("띠에서 다른 work의 셸을 누르면 화면이 옮겨진 뒤 포커스가 그 셸로 온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  // 사람이 친 셸이라 화면을 떠나도 닫히지 않는다(프로세스 결정 7).
  await typeIntoShell(page);
  await callFromShell(page);

  await navButton(page, "Terminal").click();
  await expect(page).toHaveURL("/terminal");
  // 최상위 터미널의 첫 셸(pty 2)이 떴으면 떠나온 work 화면은 내려갔다.
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(2);
  await expectShellFocused(page, "최상위 터미널의 셸에 포커스가 없다");

  await bandRowOf(page, plainWork.title).click();

  await expect(page).toHaveURL(`/works/${plainWork.slug}?tab=terminal`);
  await expectShellFocused(page, "옮겨 간 뒤 포커스가 그 셸로 안 왔다");
  // 옮겨 간 화면의 셸은 새로 뜬 것이 아니라 그 셸이다.
  expect(await callCount(page, "pty_spawn")).toBe(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("이미 켜진 셸 탭을 다시 누르면 포커스가 그 셸로 온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expectShellFocused(page, "처음 붙은 셸에 포커스가 없다");
  const lit = page.locator('[data-tab="shell"] button[aria-pressed="true"]');
  await expect(lit).toHaveCount(1);

  await lit.click();

  await expect(lit).toHaveCount(1);
  await expectShellFocused(page, "켜진 탭을 누른 뒤 포커스가 셸로 안 돌아왔다");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 최상위 터미널의 셸 탭도 같은 길이다(구현 기록 16의 남은 것 — `/terminal`의 셸 탭 배선을 재는 검사가 없었다). 화면이 둘이라
// 탭 줄의 처리기도 두 벌이고, 한쪽만 포커스 요청을 잃으면 그 화면에서만 「눌렀는데 키가 안 들어간다」가 된다.
test("최상위 터미널에서 이미 켜진 셸 탭을 다시 누르면 포커스가 그 셸로 온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await expectShellFocused(page, "처음 붙은 셸에 포커스가 없다");
  const lit = page.locator('[data-tab="shell"] button[aria-pressed="true"]');
  await expect(lit).toHaveCount(1);

  await lit.click();

  await expect(lit).toHaveCount(1);
  await expectShellFocused(page, "켜진 탭을 누른 뒤 포커스가 셸로 안 돌아왔다");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 늦게 열린 셸은 입력칸의 포커스를 빼앗지 않는다(스토리 47) ───
//
// 셸은 글꼴이 온 뒤에야 열린다(`loadFont`). 그 틈에 사람이 다른 입력칸으로 갔으면 늦게 열린 셸이 그 포커스를 가져가면
// 안 된다 — 한때 여는 함수 안의 포커스 한 줄에 조건이 없어 가져갔다. 틈은 글꼴을 붙잡아 세운다(`holdTerminalFonts`).

/** 팔레트의 검색어 칸 — 앱의 다른 입력칸이다. */
const searchBox = (page: Page) => page.getByRole("textbox", { name: "검색어" });

test("글꼴이 늦게 와 셸이 열려도 팔레트 입력칸의 포커스를 빼앗지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  await page.keyboard.press("Meta+k");
  await expect(searchBox(page)).toBeFocused();
  await releaseFonts();

  // **앵커** — 셸이 열리고 떴다. 포커스를 주는 줄은 여는 자리에서 곧바로 돌므로, 이 뒤에 입력칸이 포커스를 쥐고 있으면
  // 늦게 열린 셸이 안 가져간 것이다.
  await expect(page.locator("[data-shell-host] .xterm")).toHaveCount(1);
  await awaitSpawned(page, 1);
  await expect(searchBox(page)).toBeFocused();
  expect(await focusOutsideShell(page)).toBe(true);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 요청한 셸이어도 같다 — 입력칸 조건에는 예외가 없다(티켓 16 · 프로세스 스펙 S21). 사람이 셸을 부른 **뒤에** 입력칸으로
// 갔으면 그 입력칸이 지금의 뜻이다. 띠 · 셸 탭은 버튼이라 부르는 순간 입력칸에 있을 수 없으니(누른 버튼이 포커스를
// 비운다), 입력칸 조건이 사람 요청을 이기는지는 이 순서로만 잰다. 한때 사람 요청이 입력칸 조건보다 앞서 여기가 빨갰다.
test("요청한 셸도 늦게 열리면서 그 뒤에 간 팔레트 입력칸의 포커스를 빼앗지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
  const lit = page.locator('[data-tab="shell"] button[aria-pressed="true"]');
  await expect(lit).toHaveCount(1);
  // 글꼴이 아직이라 안 열렸다 — 누른 탭은 그 자리에서 포커스를 못 주고 기다리는 포커스로 적힌다.
  await expect(page.locator("[data-shell-host] .xterm")).toHaveCount(0);

  await lit.click();
  await page.keyboard.press("Meta+k");
  await expect(searchBox(page)).toBeFocused();
  await releaseFonts();

  // **앵커** — 위 검사와 같다. 셸이 열리고 떴으니 포커스 줄은 이미 지나갔다.
  await expect(page.locator("[data-shell-host] .xterm")).toHaveCount(1);
  await awaitSpawned(page, 1);
  await expect(searchBox(page)).toBeFocused();
  expect(await focusOutsideShell(page)).toBe(true);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 위와 짝이다 — 조건이 붙었다고 콜드 스타트의 첫 셸이 포커스를 잃으면 안 된다. 첫 셸은 늘 글꼴보다 먼저 붙고, 글꼴 길은
// 기다리는 포커스가 이 셸일 때만 준다. 붙는 순간 글꼴이 아직이면 그 붙음이 포커스를 기다려 두는 까닭이다(`deferAttach`).
test("글꼴이 늦게 와도 처음 붙은 셸은 포커스를 받는다", async ({ page }) => {
  await installFixtureBackend(page);
  const releaseFonts = await holdTerminalFonts(page);
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
  // 글꼴이 아직이라 안 열렸다 — 이 검사가 글꼴 길을 재고 있다는 전제다.
  await expect(page.locator("[data-shell-host] .xterm")).toHaveCount(0);

  await releaseFonts();

  await awaitSpawned(page, 1);
  await expectShellFocused(page, "글꼴이 늦게 온 첫 셸에 포커스가 없다");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
