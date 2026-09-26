import { expect, test, type Page } from "./evidence";
import { callCount, installFixtureBackend, ipcFailure, unknownIpcCalls } from "./harness";
import type { StartupReport } from "@/components/shell/startup-report";

// **앱이 뜰 때 한 번 묻는 시작 보고와, 어느 화면에서든 서는 토스트**(프로세스 관리 티켓 02 · 프로세스
// 결정 6 · 프로세스 스펙 S11 · P2). 보고는 이벤트가 아니라 부팅 때의 IPC 한 번이다 — 이벤트는 웹뷰가
// 듣기 전에 지나갈 수 있다. 그 답을 이 층에서는 고정 표가 준다: 기본은 「아무것도 안 했다」이고,
// 정리 토스트를 재는 검사만 덮어쓴다.
//
// 화면을 둘 고른다: **Terminal과 설정.** 이웃 work의 복사 토스트는 작업 · 아카이브 화면에만 서므로,
// 그 둘이 아닌 곳에서 서야 「어느 화면에서든」이 잰 것이 된다.

const STARTUP = "startup_report";

/** 시작 정리가 `count`개를 끝낸 보고. 무엇을 끝냈는지는 토스트가 안 적는다 — 수만 본다. */
const cleaned = (count: number): StartupReport => ({
  cleaned: Array.from({ length: count }, (_, i) => ({ pid: 40_000 + i, name: "node" })),
  hooksUpdated: [],
});

const cleanupText = (count: number) => `지난 실행에서 남은 프로세스 ${count}개를 정리했어요`;

/** 이미 깔린 훅을 지금 목록으로 맞췄을 때의 말(프로세스 스펙 S36). */
const HOOKS_TEXT = "에이전트 훅을 새 목록으로 맞췄어요";

/** 이 work의 토스트가 서는 자리(앱 셸의 Viewport). 화면이 무엇이든 늘 있다. */
const toastRegion = (page: Page) => page.getByRole("region", { name: "알림", exact: true });

/**
 * 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 두 프레임을 넘긴다. **「없다」를 재기 전에 부른다**
 * (`shell-cold-start.spec.ts`의 같은 이름과 같은 까닭): 없음을 재는 단언은 곧바로 초록이라, 답이 아직
 * 안 그려진 순간에 지나간다.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * **지금** 선 토스트의 수 — 되풀이하지 않고 한 번 센다. `toHaveCount(0)`은 0이 될 때까지 기다리므로, 잘못 선
 * 짧은 토스트가 1.6초 뒤 내려가는 것을 기다려 초록이 된다(0개에도 토스트를 세우는 변형이 그렇게 지나갔다).
 */
const toastsNow = (page: Page) => toastRegion(page).getByRole("dialog").count();

for (const { screen, path } of [
  { screen: "Terminal", path: "/terminal" },
  { screen: "설정", path: "/settings/terminal" },
]) {
  test(`첫 화면이 ${screen}이어도 시작 보고의 정리 토스트가 [보기]를 들고 한 번 선다`, async ({ page }) => {
    await installFixtureBackend(page, { [STARTUP]: cleaned(3) });
    await page.goto(path);

    const toast = toastRegion(page).getByRole("dialog", { name: cleanupText(3), exact: true });
    await expect(toast).toBeVisible();
    // **한 번만.** 보고를 이펙트에서 묻거나 토스트를 이펙트가 두 번 내면 StrictMode(dev)에서 둘이 선다 —
    // 이 층이 도는 dev 서버가 바로 그 모드다. 둘째가 그려질 틈을 준 뒤 한 번 센다.
    await settle(page);
    expect(await toastsNow(page)).toBe(1);
    expect(await callCount(page, STARTUP)).toBe(1);

    // [보기]를 든다(프로세스 스펙 S15 · 티켓 32) — 무엇을 끝냈는지는 `Processes`의 정리 기록이 보인다. 그래서 누를 때까지 남는
    // 동작 토스트다: 1.6초가 지나도 남는지는 `processes-view.spec.ts`가 시계로 잰다.
    await expect(toast.getByRole("button", { name: "보기", exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **이미 깔린 훅을 앱이 뜰 때 지금 목록으로 맞췄으면 한 번 알린다**(프로세스 결정 15 · 프로세스 스펙 S36 · 티켓 21). 맞춘
// 에이전트가 둘이어도 말은 하나이고, 동작 버튼 없는 짧은 토스트다. 첫 화면은 설정 — 사람이 훅을 떠올리는 자리가 아니어도
// 선다는 것을 정리 토스트가 이미 두 화면에서 쟀고, 여기서는 그 자리를 이 말이 함께 쓰는지를 본다.
test("시작 보고에 훅 맞춤이 있으면 그 토스트가 한 번 서고 곧 사라진다", async ({ page }) => {
  await installFixtureBackend(page, { [STARTUP]: { cleaned: [], hooksUpdated: ["claude", "codex"] } });
  await page.goto("/settings/terminal");

  const toast = toastRegion(page).getByRole("dialog", { name: HOOKS_TEXT, exact: true });
  await expect(toast).toBeVisible();
  await settle(page);
  expect(await toastsNow(page)).toBe(1);
  expect(await callCount(page, STARTUP)).toBe(1);

  await expect(toast).toBeHidden({ timeout: 5_000 });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("시작 보고에 끝낸 것도 맞춘 훅도 없으면 토스트가 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");

  // 앵커 둘: 보고를 **물었고**, 토스트가 설 자리가 **있다**. 둘 중 하나라도 없으면 아래 「없다」는
  // 아무것도 안 잰 초록이다. 기본 고정 표는 정리 0에 훅 맞춤도 없다(`fixtures.ts`).
  await expect.poll(() => callCount(page, STARTUP)).toBe(1);
  await expect(toastRegion(page)).toBeAttached();
  await settle(page);

  expect(await toastsNow(page)).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L4에서는 다리가 이 명령을 「앱 안에서만」으로 거절한다 — 부팅 때 부르는 설정 읽기와 같은 처지다.
// 거절이 부팅을 막으면 그 층의 화면이 통째로 선다.
test("시작 보고가 거절되면 토스트 없이 화면이 그대로 선다", async ({ page }) => {
  await installFixtureBackend(page, {
    [STARTUP]: ipcFailure("이 커맨드는 다리로 탈 수 없습니다: 시작 보고가 앱 프로세스의 상태입니다"),
  });
  await page.goto("/settings/terminal");

  await expect.poll(() => callCount(page, STARTUP)).toBe(1);
  await expect(page.getByRole("group", { name: "터미널 설정", exact: true })).toBeVisible();
  await expect(toastRegion(page)).toBeAttached();
  await settle(page);

  expect(await toastsNow(page)).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
