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
  셸입력,
  행버튼,
} from "./harness";

// 프로세스 티켓 25 — **승인한 도구가 도는 동안 「도는 중」이다**(프로세스 결정 13 · P7 (가)). claude의 PreToolUse는 권한 창
// **앞**에 오고, 사람이 승인한 뒤 도구가 도는 동안에는 오는 훅이 없다(판 03 선행 시험) — 옛 코드에서는 `sleep 30`을 승인하면
// 도구가 끝나 PostToolUse가 올 때까지 「나를 기다림」이었다. 그래서 훅이 말한 **권한 창의** 기다림에서 그 셸에 **확정 키**가
// 들어오면 곧바로 도는 중이다. 물음 창(`AskUserQuestion` · Elicitation)은 안 읽는다(리뷰 반영 — 마지막 검사).
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
/**
 * 셸이 마지막으로 한 말 — 부르는 행 버튼의 설명(`aria-description`)이 든다(`sidebar-active-band` 결정 14 — 행이 한 줄이 되며
 * 둘째 줄이 걷혔다). 새 승인 요청이 닿았는지를 이 글로 본다.
 */
const 행의말 = (page: Page) => 행버튼(page, `${plainWork.title} — 나를 기다림`);

/** 승인 요청 한 장 — `tool_input`은 훅 문서 · 18 실측의 모양이다. 시각이 다르면 새 요청이다. */
const 승인요청 = (at: number, command = "sleep 30") => ({
  agent: "claude",
  event: "PermissionRequest",
  at,
  payload: { tool_name: "Bash", tool_input: { command } },
});

/**
 * `AskUserQuestion` 물음 한 장 — PreToolUse에 도구 이름으로 온다. 입력 모양은 claude 2.1.283 바이너리의 도구 스키마다. 물음이
 * 둘이라 첫 답 뒤에도 창이 남는다.
 */
const 물음 = (at: number) => ({
  agent: "claude",
  event: "PreToolUse",
  at,
  payload: {
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [
        { question: "어느 쪽으로 할까요?", header: "방향", options: [{ label: "왼쪽" }, { label: "오른쪽" }], multiSelect: false },
        { question: "테스트도 고칠까요?", header: "테스트", options: [{ label: "네" }, { label: "아니요" }], multiSelect: false },
      ],
    },
  },
});

/** 그 셸로 나간 바이트 전부 — 누른 키가 키 핸들러를 지나 셸에 닿았다는 앵커다(핸들러가 먼저 돌고 xterm이 보낸다). */
const 나간바이트 = async (page: Page): Promise<string> =>
  (await ipcCallArgs(page, "pty_write", "id")).map(({ args }) => String(args.data)).join("");

/** 셸 하나가 뜨고 포커스가 그 xterm에 있다 — 누른 키가 셸의 키 핸들러에 닿는다. 그 셸에 승인 요청(주면 그 한 장)을 세운다. */
async function 승인창앞(page: Page, 한장: Parameters<typeof markAttention>[1] = 승인요청(Date.now())): Promise<void> {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expect(셸입력(page), "셸에 포커스가 없다 — 누른 키가 셸에 안 닿는다").toBeFocused();
  await markAttention(page, 한장);
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

  // 새 승인 요청 — 행의 말이 새 명령으로 바뀐 것이 그 요청이 닿았다는 앵커다.
  await fireAttention(page, 승인요청(Date.now() + 1, "sleep 60"));
  await expect(행의말(page)).toHaveAccessibleDescription(/sleep 60/);
  await page.keyboard.press("Enter");
  await expect(링(page)).toHaveCount(1);
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **↓로 자리를 옮긴 뒤에는 Enter도 숫자도 모른다.** Enter는 `3. No`를 확정했을 수 있다(18 r5: ↓ ↓ Enter는 거절이었다). 숫자는
// 놓인 자리가 고칠 수 있는 줄(`2. Yes, and don't ask again for: …`)이면 그 칸에 글자로 들어가고 창은 그대로다(리뷰 반영 — 2.1.283
// 소스). 어느 쪽이든 승인으로 읽으면 claude는 사람을 기다리는데 셸은 도는 중으로 굳는다.
//
// 앵커: 누른 키가 셸에 닿았다(`pty_write`), 그리고 같은 셸에서 새 승인 요청의 `1`은 도는 중으로 간다.
test("↓ 뒤의 Enter도, ↓ 뒤의 1도 「나를 기다림」을 남긴다", async ({ page }) => {
  await 승인창앞(page);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(() => 나간바이트(page), { message: "Enter가 셸에 안 닿았다" }).toContain("\r");
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  await fireAttention(page, 승인요청(Date.now() + 1, "sleep 60"));
  await expect(행의말(page)).toHaveAccessibleDescription(/sleep 60/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("1");
  await expect.poll(() => 나간바이트(page), { message: "1이 셸에 안 닿았다" }).toMatch(/\r.*1$/s);
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  await fireAttention(page, 승인요청(Date.now() + 2, "sleep 90"));
  await expect(행의말(page)).toHaveAccessibleDescription(/sleep 90/);
  await page.keyboard.press("1");
  await expect(링(page)).toHaveCount(1);
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **`2`는 창에 달렸다**(리뷰 반영). 18이 잰 셋짜리 Bash 창에서는 승인이지만, 허용 규칙 제안이 없는 Bash 창과 WebFetch 창은
// 「1. Yes · 2. No」 둘이라 `2`가 거절이다 — 거절 뒤에는 훅이 없어(18) 도는 중으로 읽으면 굳는다. 키로는 어느 창인지 모르므로
// 기다림을 남긴다(옛 동작대로 승인이었으면 PostToolUse가 푼다).
//
// 앵커: `2`가 셸에 닿았다, 그리고 같은 셸에서 새 승인 요청의 Enter는 도는 중으로 간다.
test("승인 요청에서 2를 누르면 「나를 기다림」이 남는다", async ({ page }) => {
  await 승인창앞(page);

  await page.keyboard.press("2");
  await expect.poll(() => 나간바이트(page), { message: "2가 셸에 안 닿았다" }).toContain("2");
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  await fireAttention(page, 승인요청(Date.now() + 1, "sleep 60"));
  await expect(행의말(page)).toHaveAccessibleDescription(/sleep 60/);
  await page.keyboard.press("Enter");
  await expect(링(page)).toHaveCount(1);
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **물음 창은 안 읽는다**(리뷰 반영). 18의 키 표는 권한 창을 잰 것이다 — 권한 창의 첫째는 늘 `Yes`다. `AskUserQuestion`의 첫째는
// 첫 물음의 첫 선택지이고, 답을 고르면 다음 물음으로 넘어간다(2.1.283 소스) — 물음이 여럿이면 `1`이나 첫 Enter는 첫 물음에만
// 답한 것이고 claude는 그대로 사람을 기다린다. 도는 중으로 읽으면 부르는 신호 없이 굳는다.
//
// 앵커: 누른 키가 셸에 닿았다(`pty_write`), 그리고 같은 셸에서 새 승인 요청의 `1`은 도는 중으로 간다.
test("물음(AskUserQuestion)에서 1 · Enter를 눌러도 「나를 기다림」이 남는다", async ({ page }) => {
  await 승인창앞(page, 물음(Date.now()));
  await expect(행의말(page)).toHaveAccessibleDescription(/어느 쪽으로 할까요\?/);

  await page.keyboard.press("1");
  await expect.poll(() => 나간바이트(page), { message: "1이 셸에 안 닿았다" }).toContain("1");
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect.poll(() => 나간바이트(page), { message: "Enter가 셸에 안 닿았다" }).toContain("1\r");
  await expect(기다림줄(page)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  await fireAttention(page, 승인요청(Date.now() + 1, "sleep 60"));
  await expect(행의말(page)).toHaveAccessibleDescription(/sleep 60/);
  await page.keyboard.press("1");
  await expect(링(page)).toHaveCount(1);
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
