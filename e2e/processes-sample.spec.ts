import { expect, test, type Page } from "./evidence";
import {
  callCount,
  heldCalls,
  holdCommand,
  installFixtureBackend,
  ipcFailure,
  releaseCommand,
  replaceAnswer,
  unknownIpcCalls,
  시계를세운다,
} from "./harness";
import { macOf, MEASURED_AT, snapshotFixture } from "@/features/processes/process-fixture";
import type { ProcessSnapshot } from "@/features/processes/types";

// **값이 멎으면 말하고 다시 읽는다**(restart 03-9 · 스토리 129 ~ 132 · 구현 스펙 「03 — Processes › 믿을 수 있는 표시」 · 시안 ProcessSheet
// 「표본 상태」). 03-9가 임시 spec으로 찍었던 장면(`시안-비교/03-9/`)을 L3로 남긴다.
//
// - 머리의 화면 이름 옆에 언제 잰 값인지가 선다 — 「14:02:31에 잰 값 · 2초마다」, 첫 표본을 기다리면 「재는 중」.
// - 스냅샷 물음이 실패하거나 답이 안 와 **6초 넘게 새 값이 없으면 멈춤**이다 — 머리가 「N초째 새 값이 없어요」, 숫자가 옅어지고(`data-stale`),
//   안내 띠가 「앱이 프로세스 표를 읽지 못하고 있어요. 아래 숫자는 …에 잰 값이에요.」와 [다시 읽기]를 낸다. 그보다 짧으면 박자를 놓친
//   것이라 마지막 값을 그대로 둔다.
// - [다시 읽기]는 박자를 기다리지 않고 곧바로 묻는다. 실패하면 멈춤이 남고, 값이 오면 풀린다. 답이 안 오는 물음은 버리고 새로 묻는다.
//
// 머리 글과 띠의 글을 가르는 규칙은 L2가 표로 잰다(`sample-beat.test.ts`). 여기서 보는 것은 그것이 진짜 스냅샷 박자(react-query) · 화면의
// 시계 · [다시 읽기]를 지나 화면에 서는가다. 시계를 세워(`page.clock`) 박자를 하나씩 넘긴다.

const 장 = (measuredAt: number): ProcessSnapshot => snapshotFixture({ measuredAt, mac: macOf(31.4) });
const 나중 = MEASURED_AT + 10_000;

const 머리 = (page: Page) => page.locator("[data-beat]");
const 띠 = (page: Page) => page.locator("[data-sample-note]");
const 다시읽기 = (page: Page) => page.getByRole("button", { name: "다시 읽기", exact: true });
/** 숫자가 옅어지는 표식 — 화면의 구르는 몸에 선다. */
const 옅음 = (page: Page) => page.getByRole("main", { name: "Processes", exact: true }).locator("[data-stale]");
const 멈춤글 = "앱이 프로세스 표를 읽지 못하고 있어요.";

/** 그 시각의 「시:분:초」(24시) — 이 페이지의 시간대로 읽는다. */
const 시각 = (page: Page, at: number) =>
  page.evaluate((ms) => {
    const date = new Date(ms);
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
  }, at);

const 잰값 = async (page: Page, at: number) => `${await 시각(page, at)}에 잰 값 · 2초마다`;

/** 머리가 말하는 「N초째」의 N. */
async function 초째(page: Page): Promise<number> {
  const text = (await 머리(page).textContent()) ?? "";
  const found = /^(\d+)초째 새 값이 없어요$/.exec(text);
  if (!found) throw new Error(`머리가 멈춤을 말하지 않는다: ${text}`);
  return Number(found[1]);
}

/** 세운 시계에서 스냅샷 박자 하나를 넘긴다 — 새 물음이 나갈 때까지 250ms씩(`processes-shells.spec.ts`와 같다). */
async function 다음박자(page: Page): Promise<void> {
  const before = await callCount(page, "processes_snapshot");
  for (let step = 0; step < 20 && (await callCount(page, "processes_snapshot")) === before; step += 1) {
    await page.clock.runFor(250);
  }
  expect(await callCount(page, "processes_snapshot"), "5초 넘게 스냅샷 박자가 안 왔다").toBeGreaterThan(before);
}

async function 값이섰다(page: Page, at: number): Promise<void> {
  await expect(머리(page)).toHaveAttribute("data-beat", "live");
  await expect(머리(page)).toHaveText(await 잰값(page, at));
  await expect(띠(page)).toHaveCount(0);
  await expect(옅음(page)).toHaveCount(0);
}

async function 멈췄다(page: Page, at: number): Promise<void> {
  await expect(머리(page)).toHaveAttribute("data-beat", "stalled");
  await expect(머리(page)).toHaveText(/^\d+초째 새 값이 없어요$/);
  await expect(띠(page)).toBeVisible();
  await expect(띠(page)).toHaveAttribute("role", "status");
  await expect(띠(page)).toContainText(`${멈춤글} 아래 숫자는 ${await 시각(page, at)}에 잰 값이에요.`);
  await expect(다시읽기(page)).toBeVisible();
  await expect(옅음(page)).toHaveCount(1);
}

test("값이 선 뒤 스냅샷 물음이 실패해도 6초까지는 잰 시각 그대로이고, 넘으면 멈춤이 서며, [다시 읽기]가 곧바로 묻고 실패하면 남고 값이 오면 풀린다", async ({
  page,
}) => {
  await page.clock.install();
  await installFixtureBackend(page, { processes_snapshot: 장(MEASURED_AT) });
  await page.goto("/processes");
  await 값이섰다(page, MEASURED_AT);

  // 마지막으로 값이 온 박자 — 여기서부터 센다. 그 뒤 물음은 모두 실패한다.
  await 시계를세운다(page);
  await 다음박자(page);
  await replaceAnswer(page, "processes_snapshot", ipcFailure("프로세스 표를 읽지 못했습니다"));
  // 실패 둘(2초 · 4초 뒤) — 박자를 놓친 것이라 마지막 값을 그대로 둔다.
  await 다음박자(page);
  await 다음박자(page);
  await 값이섰다(page, MEASURED_AT);

  // 실패가 이어져 6초를 넘긴다 — 멈춤이다. 띠는 아래 숫자가 언제 잰 것인지 말한다.
  await 다음박자(page);
  await 다음박자(page);
  await 멈췄다(page, MEASURED_AT);
  const 처음 = await 초째(page);
  expect(처음).toBeGreaterThanOrEqual(6);
  // 실패가 올 때마다 다시 센다 — 박자만큼(2초) 오른다.
  await 다음박자(page);
  await expect.poll(() => 초째(page)).toBe(처음 + 2);

  // [다시 읽기] — 박자를 기다리지 않고 곧바로 묻는다. 또 실패하면 멈춤이 남는다.
  let 전 = await callCount(page, "processes_snapshot");
  await 다시읽기(page).click();
  await expect.poll(() => callCount(page, "processes_snapshot")).toBe(전 + 1);
  await page.clock.runFor(50);
  await 멈췄다(page, MEASURED_AT);

  // 읽을 수 있게 된 뒤 [다시 읽기] — 곧바로 새 값이 서고 멈춤이 풀린다.
  await replaceAnswer(page, "processes_snapshot", 장(나중));
  전 = await callCount(page, "processes_snapshot");
  await 다시읽기(page).click();
  await expect.poll(() => callCount(page, "processes_snapshot")).toBe(전 + 1);
  await page.clock.runFor(50);
  await 값이섰다(page, 나중);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("스냅샷 물음의 답이 안 오면 6초를 넘긴 뒤 멈춤이 서고, [다시 읽기]가 멎은 물음 대신 새로 물으며, 그 답이 오면 풀린다", async ({
  page,
}) => {
  await page.clock.install();
  await installFixtureBackend(page, { processes_snapshot: 장(MEASURED_AT) });
  await page.goto("/processes");
  await 값이섰다(page, MEASURED_AT);

  // 마지막으로 값이 온 박자. 그 뒤 물음은 붙잡혀 답이 안 온다(멎은 IPC) — 실패도 새 값도 없다.
  await 시계를세운다(page);
  await 다음박자(page);
  await holdCommand(page, "processes_snapshot");
  for (let step = 0; step < 20 && (await heldCalls(page, "processes_snapshot")) === 0; step += 1) {
    await page.clock.runFor(250);
  }
  expect(await heldCalls(page, "processes_snapshot"), "다음 박자의 물음이 안 나갔다").toBe(1);

  // 마지막 값에서 5초 남짓 — 아직 멈춤이 아니다.
  await page.clock.runFor(3_000);
  await 값이섰다(page, MEASURED_AT);
  // 6초를 넘긴다 — 멈춤이다.
  await page.clock.runFor(2_000);
  await 멈췄다(page, MEASURED_AT);
  expect(await 초째(page)).toBeGreaterThanOrEqual(6);

  // [다시 읽기] — 멎은 물음을 기다리지 않고 새로 묻는다. 그 물음도 답이 안 오니 멈춤이 남는다.
  const 전 = await heldCalls(page, "processes_snapshot");
  await 다시읽기(page).click();
  await expect.poll(() => heldCalls(page, "processes_snapshot")).toBe(전 + 1);
  await page.clock.runFor(1_000);
  await 멈췄다(page, MEASURED_AT);

  // 답이 온다 — 새 값이 서고 멈춤이 풀린다.
  await replaceAnswer(page, "processes_snapshot", 장(나중));
  await releaseCommand(page, "processes_snapshot");
  await page.clock.runFor(50);
  await 값이섰다(page, 나중);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("첫 스냅샷이 안 오면 「재는 중」으로 서다가 6초를 넘기면 멈춤이 서고, 띠는 아래 숫자가 없어 앞 문장만 말한다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, { processes_snapshot: 장(MEASURED_AT) });
  await holdCommand(page, "processes_snapshot");
  await page.goto("/processes");
  await expect(머리(page)).toHaveAttribute("data-beat", "waiting");
  await expect(머리(page)).toHaveText("재는 중");
  await expect(띠(page)).toHaveCount(0);

  await 시계를세운다(page);
  await page.clock.runFor(7_000);
  await expect(머리(page)).toHaveAttribute("data-beat", "stalled");
  await expect(머리(page)).toHaveText(/^\d+초째 새 값이 없어요$/);
  await expect(띠(page)).toContainText(멈춤글);
  await expect(띠(page)).not.toContainText("아래 숫자는");
  await expect(다시읽기(page)).toBeVisible();

  // 답이 오면 풀린다.
  await releaseCommand(page, "processes_snapshot");
  await page.clock.runFor(50);
  await 값이섰다(page, MEASURED_AT);
});
