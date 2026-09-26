import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  fireAttention,
  installFixtureBackend,
  ipcCallArgs,
  markAttention,
  unknownIpcCalls,
  띠,
  레인,
} from "./harness";

// 프로세스 티켓 25 — **승인한 도구가 도는 동안 「도는 중」이다**(프로세스 결정 13 · P7 (가)). claude의 PreToolUse는 권한 창
// **앞**에 오고, 사람이 승인한 뒤 도구가 도는 동안에는 오는 훅이 없다(판 03 선행 시험) — 옛 코드에서는 `sleep 30`을 승인하면
// 도구가 끝나 PostToolUse가 올 때까지 「나를 기다림」이었다. 그래서 훅이 말한 기다림에서 그 셸에 **확정 키**가 들어오면 곧바로
// 도는 중이다.
//
// 어느 키가 확정인지는 L2가 표로 잰다(`shell-attention.test.ts`의 「승인 추론」 · `shell-input.test.ts`의 「권한 창의 키」). 여기서
// 보는 것은 그 판단이 **진짜 키 핸들러**에 붙어 띠와 레인까지 가는가다 — 스토어는 xterm을 들여 노드 seam에 없다. 시계는 안
// 쓴다: 키 하나로 곧바로 간다.
//
// 보는 셸 하나로 잰다. 기다림은 「봤다」로 안 꺼지므로(결정 7) 켜진 셸의 승인 요청도 띠에 선다 — 그리고 키가 닿으려면 그
// 셸에 포커스가 있어야 한다.

const [, plainWork] = WORKS;

const 링 = (page: Page) => 레인(page, plainWork.slug).locator('[data-signal="working"]');
const 기다림줄 = (page: Page) =>
  띠(page).getByRole("button", { name: `${plainWork.title} — 나를 기다림`, exact: true });
/** 그 work 행의 둘째 줄 — 셸이 마지막으로 한 말이 선다. 새 승인 요청이 닿았는지를 이 글로 본다. */
const 둘째줄 = (page: Page) => page.locator(`[data-subrow="${plainWork.slug}"]`);

/** 승인 요청 한 장 — `tool_input`은 훅 문서 · 18 실측의 모양이다. 시각이 다르면 새 요청이다. */
const 승인요청 = (at: number, command = "sleep 30") => ({
  agent: "claude",
  event: "PermissionRequest",
  at,
  payload: { tool_name: "Bash", tool_input: { command } },
});

/** 그 셸로 나간 바이트 전부 — 누른 키가 키 핸들러를 지나 셸에 닿았다는 앵커다(핸들러가 먼저 돌고 xterm이 보낸다). */
const 나간바이트 = async (page: Page): Promise<string> =>
  (await ipcCallArgs(page, "pty_write", "id")).map(({ args }) => String(args.data)).join("");

/** 셸 하나가 뜨고 포커스가 그 xterm에 있다 — 누른 키가 셸의 키 핸들러에 닿는다. 그 셸에 승인 요청을 세운다. */
async function 승인창앞(page: Page): Promise<void> {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.className ?? ""), {
      message: "셸에 포커스가 없다 — 누른 키가 셸에 안 닿는다",
    })
    .toContain("xterm-helper-textarea");
  await markAttention(page, 승인요청(Date.now()));
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);
}

// `1`은 Enter 없이 곧바로 승인하고, 처음 자리(`1. Yes`)의 Enter도 승인이다(18 r4 #2 · r6).
for (const [이름, 키] of [
  ["1", "1"],
  ["처음 자리의 Enter", "Enter"],
] as const) {
  test(`승인 요청에서 ${이름}를 누르면 곧바로 도는 중이고 「나를 기다림」이 없다`, async ({ page }) => {
    await 승인창앞(page);

    await page.keyboard.press(키);
    await expect(링(page)).toHaveCount(1);
    await expect(띠(page)).toHaveCount(0);

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **Esc는 거절이다**(S30). 거절 뒤에는 훅이 하나도 없고 claude는 사람의 다음 말을 기다린다(18) — 기다림이 사실이다. 그 말의
// 첫 글자가 `1`이어도 승인이 아니다.
//
// 앵커 둘: 누른 키가 셸에 닿았다(`pty_write`), 그리고 **같은 셸 · 같은 핸들러**에서 새 승인 요청의 Enter는 도는 중으로 간다 —
// 위에서 남은 것이 키가 안 닿아서가 아니다.
test("승인 요청에서 Esc를 누르면 「나를 기다림」이 남고, 그 뒤에 친 1도 승인이 아니다", async ({ page }) => {
  await 승인창앞(page);

  await page.keyboard.press("Escape");
  await expect.poll(() => 나간바이트(page), { message: "Esc가 셸에 안 닿았다" }).toContain("\x1b");
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  await page.keyboard.press("1");
  await expect.poll(() => 나간바이트(page), { message: "1이 셸에 안 닿았다" }).toContain("\x1b1");
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  // 새 승인 요청 — 둘째 줄이 새 명령으로 바뀐 것이 그 요청이 닿았다는 앵커다.
  await fireAttention(page, 승인요청(Date.now() + 1, "sleep 60"));
  await expect(둘째줄(page)).toContainText("sleep 60");
  await page.keyboard.press("Enter");
  await expect(링(page)).toHaveCount(1);
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **↓로 자리를 옮긴 뒤의 Enter는 모른다** — `3. No`를 확정했을 수 있다(18 r5: ↓ ↓ Enter는 거절이었다). 거절을 도는 중으로 읽으면
// claude는 사람을 기다리는데 셸은 도는 중으로 굳는다. 숫자는 놓인 자리와 상관없는 지름길이라 읽는다.
test("↓ 뒤의 Enter는 「나를 기다림」을 남기고, ↓ 뒤의 1은 도는 중으로 간다", async ({ page }) => {
  await 승인창앞(page);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(() => 나간바이트(page), { message: "Enter가 셸에 안 닿았다" }).toContain("\r");
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  await fireAttention(page, 승인요청(Date.now() + 1, "sleep 60"));
  await expect(둘째줄(page)).toContainText("sleep 60");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("1");
  await expect(링(page)).toHaveCount(1);
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
