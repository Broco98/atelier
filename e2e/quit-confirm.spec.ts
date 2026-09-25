import { expect, test, type Page } from "./evidence";
import {
  awaitSpawned,
  callCount,
  fireEvent,
  installFixtureBackend,
  ipcFailure,
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
/** 포커스가 xterm의 숨은 입력칸에 있는가 — 셸을 붙이면 그쪽이 스스로 가져간다(`search-palette.spec.ts`). */
const focusedClass = (page: Page) => page.evaluate(() => document.activeElement?.className ?? "");
/**
 * 창 **아래의** 팔레트. 역할로 집지 않는다 — 확인 창은 모달이라 그 밖이 전부 `aria-hidden`이고,
 * `getByRole`은 그 아래를 세지 않는다(창이 떠 있는 동안 팔레트 listbox는 늘 0이다). 그래서 팔레트
 * 목록이 드는 표식으로 잰다. 창이 닫힌 뒤에는 다시 역할로 잡힌다.
 */
const paletteUnder = (page: Page) => page.locator("[data-more-fade]");

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
  // 들어오면 뜨는 첫 칸(`ensureShell`)이 선 뒤에 연다 — `openShell`은 누르기 전의 칸 수를 센다.
  // pty가 앉기를 기다리지 않는다: 칸 순서대로 뜨는 것은 앱이 지킨다(`openShell`의 머리말).
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
  await openShell(page);

  await fireQuitRequest(page);

  await expect(quitDialog(page)).toContainText("셸 2 · 명령이 도는 셸 2");
  // 그 줄이 창의 **설명**이다 — 읽기 도구가 제목 다음에 읽는다.
  await expect(quitDialog(page)).toHaveAccessibleDescription("셸 2 · 명령이 도는 셸 2");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("물음이 「안 돈다」면 도는 셸이 0으로 적힌다", async ({ page }) => {
  await installFixtureBackend(page, { pty_command_running: false });
  await page.goto("/terminal");
  // 들어오면 뜨는 첫 칸(`ensureShell`)이 선 뒤에 연다 — `openShell`은 누르기 전의 칸 수를 센다.
  // pty가 앉기를 기다리지 않는다: 칸 순서대로 뜨는 것은 앱이 지킨다(`openShell`의 머리말).
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
  await openShell(page);

  await fireQuitRequest(page);

  await expect(quitDialog(page)).toContainText("셸 2 · 명령이 도는 셸 0");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("물음이 「모름」이면 안 도는 것으로 센다", async ({ page }) => {
  await installFixtureBackend(page, { pty_command_running: null });
  await page.goto("/terminal");
  // 들어오면 뜨는 첫 칸(`ensureShell`)이 선 뒤에 연다 — `openShell`은 누르기 전의 칸 수를 센다.
  // pty가 앉기를 기다리지 않는다: 칸 순서대로 뜨는 것은 앱이 지킨다(`openShell`의 머리말).
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
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
  // 줄이 없으면 창의 설명도 없다 — 빈 줄을 그려 두고 가리키는 변형은 여기서 걸린다.
  await expect(dialog).toHaveAccessibleDescription("");
  expect(await callCount(page, "pty_command_running")).toBe(0);
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
  expect(await callCount(page, "quit_app")).toBe(0);

  await fireQuitRequest(page);
  await dialog.getByRole("button", { name: "종료", exact: true }).click();
  await expect.poll(() => callCount(page, "quit_app")).toBe(1);
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

// ── 셸에서 띄운 창 ──
// 셸에 포커스가 있는 채로 창이 뜨는 길이다(⌘W). 키가 셸이 아니라 창으로 가야 하고, 창이 닫히면
// 포커스가 셸로 돌아와야 한다 — 안 돌아오면 닫은 뒤에 친 글자가 아무 데도 안 들어간다.
//
// 셋 다 **셸에 포커스가 있다는 것을 먼저 본다.** 없으면 「셸로 안 갔다」도 「셸로 돌아왔다」도 아무것도
// 안 잰다. 셸 쓰기를 세는 뒤의 둘은 한 걸음 더 간다: 글자를 쳐서 셸 쓰기가 실제로 나가는 것을 본 뒤에
// 창을 띄운다 — 안 나가는 셸이면 「0이다」가 아무것도 안 잰다.

/** 셸에 포커스가 있고, 친 글자가 셸 쓰기로 나간다. 그때까지 나간 셸 쓰기 수를 돌려준다. */
async function typeIntoShell(page: Page): Promise<number> {
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");
  await page.keyboard.type("a");
  await expect.poll(() => callCount(page, "pty_write")).toBeGreaterThan(0);
  return callCount(page, "pty_write");
}

test("셸에서 ⌘W로 띄운 창이 닫히면 포커스가 셸로 돌아온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");

  await page.keyboard.press("Meta+w");
  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();

  await page.keyboard.press("Escape");

  await expect(dialog).toHaveCount(0);
  await expect(shells(page)).toHaveCount(1);
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **첫 프레임 가드**(S24). 창은 첫 포커스를 **다음 프레임에** 옮긴다 — 그 사이의 키는 아직 셸에 포커스가
// 있어 셸로 간다. 그래서 창이 선 순간부터 포커스가 처음 창에 들어올 때까지 앱이 키를 삼킨다.
//
// 포커스를 기다리지 않고 누르는 것이 이 검사의 전부다. **그 프레임은 시계를 세워 붙잡는다** — 안
// 붙잡으면 Enter가 그 프레임 앞에 닿을지 뒤에 닿을지가 러너 사정이다(실측: 열에 여섯은 뒤였고, 그러면
// 포커스가 이미 「닫기」에 있어 창이 닫힌다). 세운 시계에서는 프레임이 안 오므로 Enter는 늘 그 틈에 닿는다.
//
// 앵커는 둘이다: 시계를 풀면 포커스가 「닫기」로 들어온다(창이 살아 있다), 그리고 셸이 그대로다(「닫기」가
// 안 눌렸다 — 창도 그 Enter를 못 받았다). 그 둘 위에서 셸 쓰기가 안 늘었다(셸도 못 받았다) — 삼켰다.
test("셸에서 ⌘W로 띄운 바로 뒤의 Enter는 셸로 안 간다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  const written = await typeIntoShell(page);

  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
  await page.keyboard.press("Meta+w");
  await page.keyboard.press("Enter");
  await page.clock.resume();

  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await expect(shells(page)).toHaveCount(1);
  expect(await callCount(page, "pty_write")).toBe(written);
  expect(await callCount(page, "pty_kill")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 가드가 꺼진 뒤다 — 포커스가 창 안에 있으니 Enter는 창의 것이다. 창이 그 Enter로 닫힌 것이 앵커다.
test("창에 포커스가 들어온 뒤의 Enter는 창만 답한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  const written = await typeIntoShell(page);

  await page.keyboard.press("Meta+w");
  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(shells(page)).toHaveCount(0);
  expect(await callCount(page, "pty_write")).toBe(written);
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
    expect(await callCount(page, "quit_app")).toBe(0);

    await fireQuitRequest(page);
    await expect(quitDialog(page)).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// ── 연타 ──

test("세는 동안과 창이 떠 있을 때의 요청은 창을 안 바꾼다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  // 들어오면 뜨는 첫 칸(`ensureShell`)이 선 뒤에 연다 — `openShell`은 누르기 전의 칸 수를 센다.
  // pty가 앉기를 기다리지 않는다: 칸 순서대로 뜨는 것은 앱이 지킨다(`openShell`의 머리말).
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
  await openShell(page);

  // 한 `evaluate` 안에서 두 번 — 둘째는 첫째의 세기가 끝나기 전에 닿는다.
  await fireQuitRequest(page, 2);

  await expect(quitDialog(page)).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  // **셸 수만큼 한 벌이다.** 둘째 요청이 무시되지 않았다면 네 번이 나간다.
  expect(await callCount(page, "pty_command_running")).toBe(2);

  // 창이 떠 있을 때의 요청. 통과됐다면 세기가 한 벌 더 나가고, 창이 「아니오」로 접혔다 다시 선다.
  await fireQuitRequest(page);
  expect(await callCount(page, "pty_command_running")).toBe(2);
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await expect(quitDialog(page).getByRole("button", { name: "취소", exact: true })).toBeFocused();
  expect(await callCount(page, "quit_app")).toBe(0);
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
  // **갈아 끼운 물음도 새로 연 창처럼 첫 포커스를 정한다**(#223). 창은 열린 채 내용만 바뀌므로
  // 여는 순간에 도는 첫 포커스가 다시 안 돈다 — 포커스가 셸 닫기의 진행 버튼 자리, 곧 「종료」에
  // 남으면 반사적 Enter 한 번에 앱이 꺼진다.
  await expect(quitDialog(page).getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await expect(shells(page)).toHaveCount(1);
  expect(await callCount(page, "pty_kill")).toBe(0);
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
  await expect(paletteUnder(page)).toBeVisible();
  // 창이 떠 있는 동안 읽기 도구는 창만 읽는다(스토리 77) — 팔레트는 화면에 서 있지만 접근성 트리에서
  // 빠진다. 위 줄이 앵커다.
  await expect(palette).toHaveCount(0);
  await quitDialog(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(quitDialog(page)).toHaveCount(0);
  await expect(palette).toBeVisible();
  expect(await callCount(page, "quit_app")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 끄기가 실패하면 ──
// 「종료」를 눌렀는데 `quit_app`이 거절되면(IPC 층의 오류 · 명령 실패) 앱은 **안 꺼진 채 창만 닫힌다.**
// 사람은 앱이 꺼지는 중이라 믿고 기다리게 되므로, 못 껐다는 것을 앱의 오류 창(`showProblem`)으로
// 알려야 하고, 그 뒤의 요청에 다시 물어 다시 끌 수 있어야 한다.

test("「종료」가 실패하면 오류 창이 뜨고, 다음 요청에 다시 물어 다시 끈다", async ({ page }) => {
  await installFixtureBackend(page, { quit_app: ipcFailure("종료 명령이 거절되었습니다") });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await fireQuitRequest(page);
  await quitDialog(page).getByRole("button", { name: "종료", exact: true }).click();
  await expect.poll(() => callCount(page, "quit_app")).toBe(1);

  const problem = page.getByRole("alertdialog", { name: "오류" });
  await expect(problem).toBeVisible();
  await expect(problem).toContainText("종료하지 못했습니다: 종료 명령이 거절되었습니다");
  // **알림에는 취소가 없다** — 되돌릴 것이 없는데 두 갈래를 주면 무엇이 다른지를 묻게 된다.
  await expect(problem.getByRole("button", { name: "확인", exact: true })).toBeVisible();
  await expect(problem.getByRole("button", { name: "취소", exact: true })).toHaveCount(0);
  await problem.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await fireQuitRequest(page);
  await quitDialog(page).getByRole("button", { name: "종료", exact: true }).click();
  await expect.poll(() => callCount(page, "quit_app")).toBe(2);
  await expect(page.getByRole("alertdialog", { name: "오류" })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 팔레트는 확인 창이 아니라 종료 확인이 그 위에 뜬다(위 팔레트 테스트). **끄기가 실패해 오류 창이
// 그 자리를 이어받아도** 팔레트는 그대로 남고, 오류 창을 닫은 뒤에도 쓸 수 있어야 한다.
test("팔레트가 떠 있을 때 「종료」가 실패하면 오류 창이 팔레트 위에 뜨고, 닫으면 팔레트가 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page, { quit_app: ipcFailure("종료 명령이 거절되었습니다") });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("listbox", { name: "검색 결과" });
  await expect(palette).toBeVisible();

  await fireQuitRequest(page);
  await quitDialog(page).getByRole("button", { name: "종료", exact: true }).click();

  const problem = page.getByRole("alertdialog", { name: "오류" });
  await expect(problem).toContainText("종료 명령이 거절되었습니다");
  await expect(paletteUnder(page)).toBeVisible();
  await problem.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(palette).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 14 — 오류 창이 떠 있을 때의 요청도 **무시되지 않고** 종료 확인으로 갈아 끼운다.
test("오류 창이 떠 있을 때의 종료 요청은 종료 확인으로 갈아 끼운다", async ({ page }) => {
  await installFixtureBackend(page, { quit_app: ipcFailure("종료 명령이 거절되었습니다") });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await fireQuitRequest(page);
  await quitDialog(page).getByRole("button", { name: "종료", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "오류" })).toBeVisible();

  await fireQuitRequest(page);
  await expect(quitDialog(page)).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  // 오류 창의 포커스는 「확인」(진행 버튼)이었다 — 그 자리에 「종료」가 서므로 위 검사와 같은 사고다.
  await expect(quitDialog(page).getByRole("button", { name: "취소", exact: true })).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
