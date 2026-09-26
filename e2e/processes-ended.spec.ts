import { expect, test, type Page } from "./evidence";
import { fireEvent, fireEventToAll, installFixtureBackend, unknownIpcCalls } from "./harness";
import type { ProcessesEnded } from "@/components/shell/processes-ended";

// **셸이 스스로 끝나며 그 셸에서 띄운 것을 끝냈다는 알림**(프로세스 관리 티켓 13 · 프로세스 스펙 S49 · P4 · P2).
//
// 셸 안에서 `exit`나 `^D`를 치면 Rust가 그 셸 키를 문 생존자를 끝내고, 도우미가 아닌 것을 하나라도 끝냈으면 이벤트 하나를
// 쏜다(까닭, 셸 id, 끝낸 수). 사람이 끝내기를 고르지 않은 길이라 무엇이 사라졌는지 알린다. 이 층에서는 그 이벤트를 손으로
// 쏜다 — 픽스처 백엔드는 셸을 안 띄운다. 끝낸 것이 없으면 Rust가 안 쏘므로(도우미만 · 이미 없음만), 「0이면 없다」는 이
// 층이 아니라 Rust의 L1(`cleanup_log::ended_count`)이 잰다.
//
// 이벤트 이름은 **와이어의 글자 그대로** 적는다 — 프런트 상수를 가져오면 이 검사는 「앱이 그 상수를 듣는다」만 잰다. Rust
// 상수와 프런트 상수가 같은지는 L2(`processes-ended.test.ts`)가 잰다.
//
// 화면을 둘 고른다: **Terminal과 설정.** 이웃 work의 복사 토스트는 작업 · 아카이브 화면에만 서므로, 그 둘이 아닌 곳에서
// 서야 「어느 화면에서든」이 잰 것이 된다(`startup-report.spec.ts`와 같다).

const EVENT = "processes:ended";

const shellExit = (shellId: number, count: number): ProcessesEnded => ({ reason: "shellExit", shellId, count });

const endedText = (count: number) => `셸이 끝나면서 그 셸에서 띄운 프로세스 ${count}개를 끝냈어요`;

/** 이 work의 토스트가 서는 자리(앱 셸의 Viewport). 화면이 무엇이든 늘 있다. */
const toastRegion = (page: Page) => page.getByRole("region", { name: "알림", exact: true });

const toastOf = (page: Page, count: number) =>
  toastRegion(page).getByRole("dialog", { name: endedText(count), exact: true });

/** 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 두 프레임을 넘긴다(`startup-report.spec.ts`와 같다). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

for (const { screen, path } of [
  { screen: "Terminal", path: "/terminal" },
  { screen: "설정", path: "/settings/terminal" },
]) {
  test(`${screen} 화면에서도 셸 스스로 끝남 알림이 한 번 선다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(path);

    // **살아 있는 구독마다 쏜다** — 백엔드의 `emit`은 모든 구독에 간다. 듣는 자리가 이펙트라 StrictMode(dev)에서 붙었다
    // 떼었다 다시 붙는데, 떼기를 빼먹고 토스트의 id까지 없으면 이벤트 하나에 토스트가 둘 선다. 마지막 구독에만 쏘면(`fireEvent`)
    // 그 둘째를 못 본다.
    expect(await fireEventToAll(page, EVENT, shellExit(1, 2))).toBeGreaterThan(0);
    await expect(toastOf(page, 2)).toBeVisible();
    // **한 번만.** 둘째가 그려질 틈을 준 뒤 한 번 센다.
    await settle(page);
    expect(await toastRegion(page).getByRole("dialog").count()).toBe(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 판 01~03에서는 버튼 없는 짧은 토스트다 — [보기]는 판 04(티켓 32)가 붙이고, 그때부터 누를 때까지 남는다.
//
// `page.clock`은 티켓 12(`shell-orphans.spec.ts`)가 e2e에서 처음 썼다. 그 두 주의가 여기도 걸린다:
// - `install()`은 **페이지를 열기 전에** 부른다. 연 뒤에 깔면 이미 걸린 타이머는 진짜 시계로 돈다.
// - `Date.now`도 가짜 시계를 따른다. 깐 뒤로 시간은 저절로 흐르다가 `runFor`만큼 한꺼번에 뛴다.
// 저절로 흐르는 시간이 1.6초의 앞뒤를 흐리지 않게, 이벤트를 쏘기 전에 시계를 **멈춘다**(`pauseAt`) — 그 뒤로는 `runFor`만큼만
// 간다. 앞의 단언(1.5초에는 서 있다)이 앵커다: 토스트가 아예 안 서거나 곧바로 사라지는 변형에서도 「내려갔다」는 참이다.
test("셸 스스로 끝남 알림은 버튼 없이 1.6초 뒤 내려간다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(toastRegion(page)).toBeAttached();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));

  await fireEvent(page, EVENT, shellExit(1, 3));
  const toast = toastOf(page, 3);
  await expect(toast).toBeVisible();
  expect(await toast.locator("button").count()).toBe(0);

  await page.clock.runFor(1_500);
  await expect(toast).toBeVisible();
  await page.clock.runFor(200);
  await expect(toast).toBeHidden();
});
