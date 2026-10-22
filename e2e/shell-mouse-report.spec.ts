import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, ipcCallArgs, unknownIpcCalls, writeShell } from "./harness";

// **떼어진 셸은 좌표가 `NaN`인 마우스 보고를 셸로 보내지 않는다**(terminal-nan-grid-guard 결정 10 · 15).
//
// 셸을 누르면 xterm은 끌기 · 놓음 리스너를 **document에** 달고 놓음이 와야 거둔다. 그 사이 ⌘1로 `spec`에 가면 셸의 집이
// DOM에서 빠지는데(`detachShell`) 리스너는 남아, 그 뒤의 끌기를 떼어진 요소로 잰다 — 계산 스타일이 빈 문자열이라 좌표가
// `NaN`이 되고, 그 보고가 `onData` → `pty_write`로 나간다(이 work의 `spec/research/마우스-NaN-기전.md`). 무엇이 망가진
// 보고인지는 L2(`mouse-report.test.ts`)가 갈래로 잰다. **이 층이 재는 것은 그 거르기가 진짜 출구에 붙어 있는가**다 — 진짜
// xterm이 진짜 브라우저 사건으로 보고를 짓고, 앱의 경계(`pty_write`의 `data`)에서 본다.
//
// 실물의 입구(셸 칸 오른쪽 클릭 — WebKit 기본 메뉴가 놓음을 가져간다)는 headless에서 메뉴가 안 떠 여기서 못 만든다. 같은
// 출구로 나가는 「누른 채 떼어짐」으로 잰다. 오른쪽 클릭 길은 실물 재검증이 맡는다(terminal-nan-grid-guard 결정 16).

const [specWork] = WORKS;

/** `claude`의 「full」 마우스 모드 — 누름 · 놓음(1000) · 끌기(1002) · 모든 움직임(1003) · SGR 인코딩(1006). */
const FULL_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";

/** 지금까지 셸로 나간 쓰기 하나하나의 `data`, 나간 순서대로. */
async function writesToShell(page: Page): Promise<string[]> {
  return (await ipcCallArgs(page, "pty_write", "id")).map(({ args }) => String(args.data));
}

/** 지금까지 셸로 간 바이트를 나간 순서대로 이어 붙인 것. */
async function sentToShell(page: Page): Promise<string> {
  return (await writesToShell(page)).join("");
}

/** 누른 버튼 없는 움직임 보고(`35` — 1003이 켜야 나간다)의 수. */
const motions = (sent: string) => sent.split("\x1b[<35;").length - 1;

/**
 * 셸 화면 위에서 마우스를 좌우로 흔들어 **움직임 보고가 하나 더 나갈 때까지** 기다린다. xterm은 같은 칸의 같은 사건을
 * 거르므로 흔든다. 출력 프레임(`writeShell`)은 xterm이 다음 틈에 읽어, 모드가 언제 켜졌는지는 이렇게 셸 쪽에서만 안다.
 */
async function wiggleUntilMotion(page: Page): Promise<void> {
  const box = await page.locator(".xterm-screen").boundingBox();
  if (!box) throw new Error("셸 화면이 안 보인다");
  const before = motions(await sentToShell(page));
  let swing = 1;
  await expect(async () => {
    swing = -swing;
    await page.mouse.move(box.x + box.width / 2 + swing * 24, box.y + box.height / 2);
    expect(motions(await sentToShell(page)), "셸 화면 위의 움직임이 보고로 안 나갔다").toBeGreaterThan(before);
    // 한계를 적어 둔다 — `toPass`는 expect의 한계를 안 따르고 기본이 「끝없이」라, 모드가 안 켜지면 러너의 제한 시간에서야
    // 위 말 없이 빨개진다.
  }).toPass({ timeout: 10_000 });
}

test("셸을 누른 채 ⌘1로 떼어져도 그 뒤의 끌기 · 놓음이 셸에 NaN 보고를 보내지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await writeShell(page, FULL_MOUSE);

  // **모드가 켜진 뒤에 누른다.** 켜지기 전에 누르면 xterm이 document에 리스너를 안 달아, 아래가 「새지 않아서」 초록이 된다.
  await wiggleUntilMotion(page);

  // 셸 화면 안에서 누른 채 끈다 — **떼기 전에는 정상 보고가 나간다**(마우스 모드가 헛돌지 않는다).
  const box = await page.locator(".xterm-screen").boundingBox();
  if (!box) throw new Error("셸 화면이 안 보인다");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  for (const x of [80, 120, 160]) await page.mouse.move(box.x + x, y);
  await expect
    .poll(() => sentToShell(page), { message: "떼기 전 끌기가 보고로 안 나갔다" })
    .toMatch(/\x1b\[<32;\d+;\d+M/);

  // ⌘1 — work 화면의 첫 칸은 `spec`이다. 셸의 집이 화면에서 떼어진다.
  await page.keyboard.press("Meta+1");
  await expect(page.locator(".xterm")).toHaveCount(0);
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  // 떼어진 채 앱의 다른 곳을 끌고 놓는다.
  for (const [x, y] of [[300, 200], [500, 320], [700, 440], [900, 560]] as const) {
    await page.mouse.move(x, y, { steps: 4 });
  }
  await page.mouse.up();

  // **앵커** — 셸로 돌아와 그 위의 움직임이 보고로 나갔다. 사건은 온 순서대로 처리되니, 이것이 기록에 있으면 앞의 끌기 ·
  // 놓음도 모두 출구를 지났다 — 그 뒤에 센 0은 진짜 0이다. 다시 붙은 셸의 마우스가 그대로 쓰이는 것도 여기서 선다.
  await page.keyboard.press("Meta+2");
  await expect(page.locator(".xterm")).toHaveCount(1);
  await wiggleUntilMotion(page);

  const writes = await writesToShell(page);
  expect(writes.join(""), "떼어진 셸로 좌표 NaN인 마우스 보고가 갔다").not.toContain("NaN");
  // 다 잘려 남은 것이 없는 덩어리는 쓰지 않는다 — 빈 `pty_write`가 하나도 없다(위 `NaN` 단언은 이것을 못 본다).
  expect(writes.filter((data) => data === ""), "다 잘린 덩어리가 빈 쓰기로 셸에 갔다").toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
