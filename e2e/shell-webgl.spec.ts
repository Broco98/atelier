import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, openShell, typeIntoShell, unknownIpcCalls } from "./harness";

// 티켓 17 — **셸을 스무 개 오가도 화면이 비지 않는다**(프로세스 결정 18 ③ · 프로세스 스펙 S23 · 스토리 49~51).
//
// WebKit은 WebContent 프로세스 하나에 WebGL 컨텍스트를 열여섯 개까지 주고, 넘으면 가장 오래 안 그린 것을 잃힌다.
// 한때 셸마다 컨텍스트를 쥐고 놓지 않아, 셸이 열여섯을 넘으면 붙일 때마다 숨은 셸 하나가 밀려났다. 밀려난 셸로 곧
// 돌아가면 xterm이 복구를 3초 기다리는 동안 **잃은 캔버스에** 그려 화면이 비었다. 이제 최근에 붙인 셸 N개만 쥐고,
// 그 밖의 셸은 우리가 먼저 놓는다(`shell-webgl`) — 돌아간 셸은 새로 싣는다.
//
// 재는 것은 **지금 보이는 셸의 캔버스**다: 셸 자리(`[data-shell-host]`) 안의 WebGL 캔버스가 있고, 그 컨텍스트가
// 살아 있어야 한다. 떼어 둔 셸의 집은 DOM에서 빠지므로 셸 자리 안의 캔버스는 보이는 그 셸의 것뿐이다.
// 콘솔의 「too many active WebGL contexts」는 재지 않는다 — 놓은 컨텍스트도 GC 전까지 슬롯을 쥐어(구현 기록 17절),
// 빨리 오가면 WebKit이 **놓은 것을** 잃히며 그 줄을 찍는다. 그것은 화면에 아무 일도 안 한다.
//
// **바꾸기 전 코드에서 둘 다 빨간 것을 봤다**(구현 기록 17절): 스무 셸은 두 바퀴 모두 돌아간 셸 다섯의 캔버스가 잃은
// 채였고, 잃은 보이는 셸은 다시 싣지 않고 DOM에 남았다.

const [pinnedWork, plainWork] = WORKS;

/** 셸 자리 안 xterm이 무엇으로 그리나 — WebGL 캔버스가 없으면 DOM 렌더러다. */
type Drawn = "webgl" | "lost" | "dom";

const drawnNow = (page: Page) =>
  page.evaluate((): Drawn => {
    const host = document.querySelector("[data-shell-host]");
    // **이미 컨텍스트를 가진 캔버스에만 묻는다** — xterm은 WebGL 캔버스 하나와 링크를 긋는 2D 캔버스 하나를 둔다.
    // 2D 캔버스에 `webgl2`를 물으면 `null`이 온다. 컨텍스트가 없는 캔버스는 xterm이 안 만든다.
    const gls = [...(host?.querySelectorAll("canvas") ?? [])]
      .map((canvas) => canvas.getContext("webgl2"))
      .filter((gl): gl is WebGL2RenderingContext => gl !== null);
    if (gls.length === 0) return "dom";
    return gls.some((gl) => gl.isContextLost()) ? "lost" : "webgl";
  });

/** 두 프레임을 넘긴다 — 붙기(이펙트)와 그 뒤 그리기가 끝난 자리에서 잰다. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

const tabs = (page: Page) => page.locator('[data-tab="shell"]');

/** 이 화면에 셸을 `count`개까지 연다 — 저절로 뜬 첫 셸은 쳐 둔다(치지 않으면 화면을 떠날 때 닫힌다 · 프로세스 결정 7). */
async function fillShells(page: Page, count: number): Promise<void> {
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  for (let at = 1; at < count; at += 1) await openShell(page);
}

/** 사이드바에서 그 work을 누른다 — SPA 이동이라 스토어가 산다(주소를 치면 페이지가 새로 뜬다). */
async function toWork(page: Page, work: (typeof WORKS)[number]): Promise<void> {
  await page.getByRole("button", { name: work.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${work.slug}(\\?|$)`));
}

/** nav의 `Terminal` — 그 세계의 최상위 터미널도 셸 화면이다. 들어가면 셸이 저절로 하나 뜬다. */
async function toTerminal(page: Page): Promise<void> {
  await page.locator("nav").getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page).toHaveURL("/terminal");
}

/** 이 화면의 셸을 차례로 켜며 켤 때마다 그 셸이 WebGL로 살아 있는지 본다. */
async function visitEach(page: Page, where: string, seen: string[]): Promise<void> {
  const count = await tabs(page).count();
  for (let at = 0; at < count; at += 1) {
    const button = tabs(page).nth(at).locator("button[aria-pressed]");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await settle(page);
    seen.push(`${where} ${at + 1}: ${await drawnNow(page)}`);
  }
}

test("셸 스무 개를 두 바퀴 오가도 켤 때마다 그 셸이 WebGL로 살아 있다", async ({ page }) => {
  // 셸 스물하나를 열고 두 바퀴 돈다 — 한 화면의 셸 상한(8)이 있어 세 화면에 나눠 연다.
  test.setTimeout(120_000);

  // **앵커** — 이 WebKit이 WebGL2를 준다. 안 주면 셸이 늘 DOM 렌더러라 아래가 아무것도 안 잰다. 맥의 WebKit은 준다(여기서
  // 안 주면 빨갛다). 리눅스 CI의 WebKit이 주는지는 안 봤다 — 안 주면 이 검사는 건너뛴다. 앱을 띄우기 전 빈 문서에서
  // 묻는다: 그 컨텍스트는 문서가 바뀌며 거둬져 앱의 슬롯을 안 먹는다.
  const webgl2 = await page.evaluate(() => document.createElement("canvas").getContext("webgl2") !== null);
  if (process.platform === "darwin") expect(webgl2, "맥의 WebKit이 WebGL2를 안 준다").toBe(true);
  test.skip(!webgl2, "이 WebKit은 WebGL2를 안 준다 — 셸이 늘 DOM 렌더러라 잴 것이 없다");

  await installFixtureBackend(page);

  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await fillShells(page, 7);
  await toTerminal(page);
  await fillShells(page, 7);
  await toWork(page, plainWork);
  await page.locator('[data-tab="new"]').click();
  await expect(page).toHaveURL(/tab=terminal/);
  await fillShells(page, 7);

  const seen: string[] = [];
  for (let round = 1; round <= 2; round += 1) {
    await toWork(page, pinnedWork);
    await visitEach(page, `${round}바퀴 ${pinnedWork.slug}`, seen);
    await toTerminal(page);
    await visitEach(page, `${round}바퀴 /terminal`, seen);
    await toWork(page, plainWork);
    await visitEach(page, `${round}바퀴 ${plainWork.slug}`, seen);
  }

  // **앵커** — 스물한 셸을 두 바퀴 다 켰다. 셸이 모자라거나 켜기가 헛돌면 아래 단언이 아무것도 안 잰다.
  expect(seen).toHaveLength(42);
  expect(seen.filter((line) => !line.endsWith(": webgl"))).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 보이는 셸의 WebGL 컨텍스트를 잃힌다 — GPU가 리셋된 것처럼. xterm은 복구를 3초 기다리다 포기하고 알린다. */
const loseShownContext = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector("[data-shell-host]");
    const gl = [...(host?.querySelectorAll("canvas") ?? [])]
      .map((canvas) => canvas.getContext("webgl2"))
      .find((one): one is WebGL2RenderingContext => one !== null);
    const lose = gl?.getExtension("WEBGL_lose_context");
    if (!lose) throw new Error("보이는 셸에 잃힐 WebGL 컨텍스트가 없다");
    lose.loseContext();
  });

// 재시도 예산(프로세스 스펙 S24) — 보이는 셸이 컨텍스트를 잃으면 addon을 놓고 다음 프레임에 다시 싣는다. 셸마다 세 번까지다.
// 넷째에는 앱을 다시 켤 때까지 DOM 렌더러에 머문다. 한때 잃으면 놓기만 해서, 첫 손실에 DOM으로 떨어진 셸이 다시 붙을
// 때까지 그대로였다.
test("보이는 셸이 컨텍스트를 잃으면 세 번까지 다시 싣고, 넷째에는 DOM 렌더러에 머문다", async ({ page }) => {
  test.setTimeout(60_000);
  const webgl2 = await page.evaluate(() => document.createElement("canvas").getContext("webgl2") !== null);
  if (process.platform === "darwin") expect(webgl2, "맥의 WebKit이 WebGL2를 안 준다").toBe(true);
  test.skip(!webgl2, "이 WebKit은 WebGL2를 안 준다 — 셸이 늘 DOM 렌더러라 잴 것이 없다");

  const gaveUp: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("WebGL 컨텍스트를 거듭 잃어")) gaveUp.push(message.text());
  });
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expect.poll(() => drawnNow(page), { message: "처음 붙은 셸이 WebGL로 안 그린다" }).toBe("webgl");

  for (let loss = 1; loss <= 3; loss += 1) {
    await loseShownContext(page);
    // **앵커** — 정말 잃었다. xterm은 3초 동안 잃은 캔버스를 그대로 둔다.
    expect(await drawnNow(page)).toBe("lost");
    await expect
      .poll(() => drawnNow(page), { timeout: 10_000, message: `${loss}번째 손실 뒤 다시 안 실었다` })
      .toBe("webgl");
  }

  await loseShownContext(page);
  await expect.poll(() => drawnNow(page), { timeout: 10_000, message: "넷째 손실 뒤 DOM으로 안 떨어졌다" }).toBe("dom");
  await expect.poll(() => gaveUp.length).toBe(1);
  // 다시 붙어도 싣지 않는다 — 새 셸을 열어 이 셸을 떼었다가 돌아온다.
  await openShell(page);
  await tabs(page).nth(0).locator("button[aria-pressed]").click();
  await expect(tabs(page).nth(0).locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
  await settle(page);
  expect(await drawnNow(page)).toBe("dom");
  // 다른 셸의 예산은 따로다 — 새 셸은 WebGL로 그린다.
  await tabs(page).nth(1).locator("button[aria-pressed]").click();
  await expect(tabs(page).nth(1).locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => drawnNow(page)).toBe("webgl");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
