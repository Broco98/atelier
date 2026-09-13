import { expect, test, type Page } from "./evidence";
import {
  awaitSpawned,
  fireEvent,
  installFixtureBackend,
  openShell,
  readIpcRecord,
  unknownIpcCalls,
} from "./harness";

// 티켓 #223 — **빨간 버튼이 앱을 바로 끄지 않고 앱의 확인 창을 띄운다**(UI개선 결정 14·15).
//
// 이 층의 브라우저에는 창도 빨간 버튼도 없다. 빨간 버튼이 하는 일은 Rust가 창 닫기를 막고
// 종료 요청 이벤트를 쏘는 것 하나라(`src-tauri/src/quit.rs`), 그 이벤트를 **손으로 쏘면** 세기 →
// 확인 창 → `quit_app`의 나머지 전부가 실제로 돈다. 막는 쪽이 제자리에 걸려 있는지는 L1이
// 자리로 잰다(`lib.rs`의 `빨간_버튼이_창을_막고_종료_요청을_쏜다`).
//
// 「묻는 중」 표시가 내려가는 길을 여기서 하나하나 재는 이유: 안전판이 없어서(UI개선 결정 31) 그 표시가
// 한 번이라도 선 채 남으면 그 뒤로 앱을 끌 길이 강제 종료뿐이다.

const QUIT_EVENT = "app:quit-requested";

const quitDialog = (page: Page) => page.getByRole("alertdialog", { name: "Atelier 종료" });
const shells = (page: Page) => page.locator('[data-tab="shell"]');

/** 지금까지 나간 호출 중 이름이 `name`으로 시작하는 것의 수. */
async function callsOf(page: Page, name: string): Promise<number> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls.filter((call) => call === name || call.startsWith(`${name} `)).length;
}

/**
 * 백엔드가 쏘는 종료 요청을 **손으로 쏜다** — `times`번을 **한 `evaluate` 안에서 연달아**(`fireEvent`).
 * 둘째가 첫째의 세기(비동기)보다 먼저 닿아야 「세는 동안의 요청」을 잰다.
 *
 * 쏜 뒤 한 틱을 넘기고 돌아온다 — 무시되어야 할 요청이 **무시되지 않았다면** 그 세기의 물음이
 * 기록에 남을 틈을 준다.
 */
async function fireQuitRequest(page: Page, times = 1): Promise<void> {
  await fireEvent(page, QUIT_EVENT, null, times);
  await page.waitForTimeout(50);
}

test("종료 요청이 OS 시트가 아니라 앱의 확인 창을 띄운다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await fireQuitRequest(page);

  const dialog = quitDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "종료", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeVisible();
  const calls = (await readIpcRecord(page))?.calls ?? [];
  expect(calls.filter((call) => call.startsWith("plugin:dialog"))).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 세기 ──
// 픽스처의 `pty_command_running`은 이름 표라 셸마다 다른 값을 못 준다 — 그래서 값 하나를 통째로
// 덮어 세 갈래를 잰다. `markRunning`(1초 폴링 값)은 **안 쓴다**: 이 창은 폴링 값이 아니라 지금 물은
// 답으로 세야 하고, 폴링 값을 읽는 변형은 아래 `false` 갈래가 문다.

test("셸 둘이 다 명령을 돌리면 둘 다 적힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await openShell(page);

  await fireQuitRequest(page);

  await expect(quitDialog(page)).toContainText("셸 2 · 명령이 도는 셸 2");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("물음이 「안 돈다」면 도는 셸이 0으로 적힌다", async ({ page }) => {
  await installFixtureBackend(page, { pty_command_running: false });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await openShell(page);

  await fireQuitRequest(page);

  await expect(quitDialog(page)).toContainText("셸 2 · 명령이 도는 셸 0");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("물음이 「모름」이면 안 도는 것으로 센다", async ({ page }) => {
  await installFixtureBackend(page, { pty_command_running: null });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await openShell(page);

  await fireQuitRequest(page);

  await expect(quitDialog(page)).toContainText("셸 2 · 명령이 도는 셸 0");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **두 세계를 합친다.** 지금 서 있는 세계만 세면 Maison 화면에서 끌 때 Atelier 셸이 수에서 빠지는데,
// 종료는 두 세계의 셸을 함께 죽인다.
test("Atelier와 Maison의 셸이 합쳐 세진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  // 주소를 직접 치면 페이지가 새로 떠 스토어가 비므로 앱 안의 클릭으로 건넌다(`terminal-worlds.spec.ts`).
  await page
    .getByRole("group", { name: "모드 선택" })
    .getByRole("button", { name: "Maison", exact: true })
    .click();
  await page.locator("nav").getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page).toHaveURL("/maison/terminal");
  // **주소가 먼저 바뀌고 화면이 뒤따른다** — 그 틈에 `awaitSpawned`를 부르면 아직 서 있는 Atelier 칸을
  // 세고 곧바로 돌아와, Maison 셸이 pty를 갖기 전에 쏜다(실측: 여덟 번에 한 번 「셸 1」). 그래서 이
  // 세계의 spawn이 나간 것을 먼저 본다.
  await expect
    .poll(async () =>
      ((await readIpcRecord(page))?.calls ?? []).some((call) =>
        call.startsWith('pty_spawn {"mode":"maison"'),
      ),
    )
    .toBe(true);
  await awaitSpawned(page, 1);

  await fireQuitRequest(page);

  await expect(quitDialog(page)).toContainText("셸 2 · 명령이 도는 셸 2");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 셸이 없어도 **묻는다**(UI개선 결정 14) — 그 줄만 없다(UI개선 결정 15).
test("셸이 0개면 창은 뜨고 셸 줄이 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");
  await expect(page.locator("main")).toBeVisible();

  await fireQuitRequest(page);

  const dialog = quitDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText("셸");
  expect(await callsOf(page, "pty_command_running")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 포커스 ──

test("기본 포커스가 「취소」라 반사적 Enter로는 안 꺼지고, 「종료」로 꺼진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await fireQuitRequest(page);
  const dialog = quitDialog(page);
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(await callsOf(page, "quit_app")).toBe(0);

  await fireQuitRequest(page);
  await dialog.getByRole("button", { name: "종료", exact: true }).click();
  await expect.poll(() => callsOf(page, "quit_app")).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 기본 포커스 칸을 더한 것이 **기존 물음을 안 바꾼다** — 셸 닫기는 지금처럼 진행 버튼이다.
test("셸 닫기 확인의 기본 포커스는 그대로 「닫기」다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').click();

  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 표시가 내려가는 길 ──
// 셋이 **같은 길**(확인 창의 약속이 「아니오」로 풀리는 자리)로 내려가야 한다. 버튼 핸들러에서만
// 내리면 Esc·바깥 클릭 뒤의 다음 요청이 영영 무시된다 — 그 뒤로 앱을 끌 길이 강제 종료뿐이다.

const dismissals: Array<[string, (page: Page) => Promise<void>]> = [
  ["「취소」", (page) => quitDialog(page).getByRole("button", { name: "취소", exact: true }).click()],
  ["Esc", (page) => page.keyboard.press("Escape")],
  // 창 바깥의 막(`modal-scrim`)을 누른다 — 창은 가운데 330px라 왼쪽 위 모서리는 늘 바깥이다.
  ["바깥 클릭", (page) => page.mouse.click(8, 8)],
];

for (const [label, dismiss] of dismissals) {
  test(`${label} 뒤에는 안 꺼지고, 다음 요청에 창이 다시 뜬다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto("/terminal");
    await awaitSpawned(page, 1);

    await fireQuitRequest(page);
    await expect(quitDialog(page)).toBeVisible();

    await dismiss(page);
    await expect(quitDialog(page)).toHaveCount(0);
    expect(await callsOf(page, "quit_app")).toBe(0);

    await fireQuitRequest(page);
    await expect(quitDialog(page)).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// ── 연타 ──

test("세는 동안과 창이 떠 있을 때의 요청은 창을 안 바꾼다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await openShell(page);

  // 한 `evaluate` 안에서 두 번 — 둘째는 첫째의 세기가 끝나기 전에 닿는다.
  await fireQuitRequest(page, 2);

  await expect(quitDialog(page)).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  // **셸 수만큼 한 벌이다.** 둘째 요청이 무시되지 않았다면 네 번이 나간다.
  expect(await callsOf(page, "pty_command_running")).toBe(2);

  // 창이 떠 있을 때의 요청. 통과됐다면 세기가 한 벌 더 나가고, 창이 「아니오」로 접혔다 다시 선다.
  await fireQuitRequest(page);
  expect(await callsOf(page, "pty_command_running")).toBe(2);
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await expect(quitDialog(page).getByRole("button", { name: "취소", exact: true })).toBeFocused();
  expect(await callsOf(page, "quit_app")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// UI개선 결정 14 「언제나 묻는다」 — 다른 확인 창이 떠 있어도 종료 확인이 **갈아 끼운다.** 셸 닫기는 「아니오」로
// 닫혀 셸이 그대로 남는다.
test("셸 닫기 확인이 떠 있을 때의 요청은 종료 확인으로 갈아 끼운다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').click();
  await expect(page.getByRole("alertdialog", { name: "셸 닫기" })).toBeVisible();

  await fireQuitRequest(page);

  await expect(quitDialog(page)).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await expect(page.getByRole("alertdialog", { name: "셸 닫기" })).toHaveCount(0);
  await expect(shells(page)).toHaveCount(1);
  expect(await callsOf(page, "pty_kill")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 확인 창이 아닌 것은 **닫지 않고 그 위에 띄운다**(#223). 팔레트를 닫거나 창보다 위에 두는 변형은
// 둘째 단언이나 「취소」 클릭(가려지면 Playwright가 누르지 못한다)에서 빨개진다.
test("팔레트가 떠 있을 때의 요청은 팔레트를 닫지 않고 그 위에 창을 띄운다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("listbox", { name: "검색 결과" });
  await expect(palette).toBeVisible();

  await fireQuitRequest(page);

  await expect(quitDialog(page)).toBeVisible();
  await expect(palette).toBeVisible();
  await quitDialog(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(quitDialog(page)).toHaveCount(0);
  await expect(palette).toBeVisible();
  expect(await callsOf(page, "quit_app")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
