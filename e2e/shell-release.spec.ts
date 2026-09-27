import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  fireAttention,
  fireEvent,
  installFixtureBackend,
  markAttention,
  markRunning,
  openShell,
  unknownIpcCalls,
  writeShell,
  띠,
  레인,
  셸입력,
} from "./harness";

// 프로세스 티켓 22 — **끊거나 에이전트가 사라지면 「도는 중」이 풀린다**(프로세스 결정 12). 판단은 L2가 표로 잰다
// (`shell-attention.test.ts`의 「중단 추론」 · 「에이전트 사라짐」 · 권위 줄, `shell-input.test.ts`의 「중단 키」). 여기서 보는 것은
// 그 판단이 **진짜 키 핸들러 · 진짜 타이머 · 진짜 `pty:running` 구독**에 붙어 레인과 띠까지 가는가다 — 스토어는 xterm을 들여
// 노드 seam에 없다.
//
// **시계는 `page.clock`이다.** 주의 둘(`shell-ownerless.spec.ts`의 1.6초 검사 머리말)이 여기도 걸린다:
// - `install()`은 **페이지를 열기 전에** 부른다. 연 뒤에 깔면 이미 걸린 타이머는 진짜 시계로 돈다.
// - `Date.now`도 가짜 시계를 따른다 — 상태의 `since`, 알림 접기(5초), 첫 입력 시각이 모두 그 시계로 잰다.
// 깐 뒤로 시간은 저절로 흐르므로, 키를 누르기 전에 **멈춘다**(`pauseAt`). 그 뒤로는 `runFor`만큼만 간다 — 500ms의 앞뒤가
// 러너 속도에 안 흐려진다.

const [, plainWork] = WORKS;

const ESC = "\x1b";
const BEL = "\x07";

const 칸들 = (page: Page) => page.locator('[data-tab="shell"]');
const 이름표 = (page: Page, at: number) => 칸들(page).nth(at).locator("button[aria-pressed]");
const 링 = (page: Page) => 레인(page, plainWork.slug).locator('[data-signal="working"]');
const 띠줄 = (page: Page, name: string) => 띠(page).getByRole("button", { name, exact: true });

const 새턴 = () => ({ agent: "claude", event: "UserPromptSubmit", at: Date.now(), payload: { prompt: "고쳐 줘" } });

/** 셸 하나가 뜨고 포커스가 그 xterm에 있다 — 누른 키가 셸의 키 핸들러에 닿는다. 그 셸을 도는 중으로 세운다. */
async function 도는셸에포커스(page: Page): Promise<void> {
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expect(셸입력(page), "셸에 포커스가 없다 — 누른 키가 셸에 안 닿는다").toBeFocused();
  await markAttention(page, 새턴());
  await expect(링(page)).toHaveCount(1);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
}

// claude는 생각하는 중에 끊으면 그 순간 오는 훅이 없다(판 03 선행 시험) — 옛 코드에서는 이 링이 다음 턴까지 돌았다.
// 곧바로 풀지 않는 것도 잰다: 키 뒤에 훅이 올 수 있어, 누른 순간에는 끊었는지 모른다.
for (const [이름, 키] of [
  ["Esc", "Escape"],
  ["Ctrl-C", "Control+c"],
] as const) {
  test(`도는 중인 셸에서 ${이름}를 누르고 500ms가 지나면 도는 중이 없다`, async ({ page }) => {
    await 도는셸에포커스(page);

    await page.keyboard.press(키);
    await page.clock.runFor(400);
    await expect(링(page)).toHaveCount(1);
    await page.clock.runFor(200);
    await expect(링(page)).toHaveCount(0);

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **그사이 훅이 오면 추론을 버린다.** 쏘는 사건은 일부러 **시각을 안 바꾸는** 서브에이전트 사건이다(티켓 20) — 상태만
// 보면 「그대로」라서, 스토어가 훅 사건을 세지 않으면 이 셸이 풀린다.
test("Esc 뒤 500ms 안에 훅이 오면 도는 중이 남는다 — 시각을 안 바꾸는 서브에이전트 사건이어도", async ({ page }) => {
  await 도는셸에포커스(page);

  await page.keyboard.press("Escape");
  await page.clock.runFor(200);
  await fireAttention(page, {
    agent: "claude",
    event: "SubagentStart",
    at: Date.now(),
    payload: { agent_id: "ace905bb8e05c8931", agent_type: "general-purpose" },
    subagents: 1,
  });
  // 앵커: 사건이 닿았다.
  await expect(이름표(page, 0)).toHaveAccessibleDescription("도는 중 · 서브에이전트 1");
  await page.clock.runFor(400);
  await expect(링(page)).toHaveCount(1);

  // 앵커: **같은 시계로** 훅 없이 한 번 더 누르면 풀린다 — 위에서 남은 것이 시계가 안 돌아서가 아니다.
  await page.keyboard.press("Escape");
  await page.clock.runFor(600);
  await expect(링(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 칸 둘을 세우고 첫째를 켠다. 말하는 것은 둘째(pty 2)다 — 켠 칸에 온 확인할 것은 그 순간 「봤다」가 된다(결정 7). */
async function 둘째가말할자리(page: Page): Promise<void> {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(칸들(page)).toHaveCount(1);
  await openShell(page);
  await 이름표(page, 0).click();
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "true");
}

// **에이전트 사라짐**(S31). kill · 크래시 · `/exit` 어느 것이든 1초마다 오는 `pty:running`이 그 셸의 도는 명령을 바꿔 말한다.
// 풀린 셸에서는 그 뒤의 OSC가 다시 말한다. 사라짐은 한 박자(300ms — 아래 `claude -p` 검사) 뒤에 앉아서, 링이 걷히기를
// 기다린 뒤에 쏜다.
test("pty:running이 claude에서 zsh로 바뀌면 도는 중이 풀리고, 그 뒤 OSC를 쏘면 상태가 선다", async ({ page }) => {
  await 둘째가말할자리(page);
  await markRunning(page, "claude", 2);
  await markAttention(page, 새턴(), 2);
  await expect(링(page)).toHaveCount(1);

  await fireEvent(page, "pty:running", [{ id: 2, running: "zsh" }]);
  await expect(링(page)).toHaveCount(0);

  await writeShell(page, `${ESC}]9;PR #174 열었다${BEL}`, 2);
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **안 본 확인할 것은 남는다**(결정 13 — `claude -p`의 완료가 뜨자마자 사라지지 않게). 그런데 남은 그것이 훅의 권위를 쥐고
// 있으면 claude를 끝낸 셸에서 띄운 다른 도구(훅 없는 codex 등)의 승인 요청이 영영 안 선다 — 권위도 함께 풀린다.
//
// 풀림은 화면에 안 보이는 한 칸(출처)이라 앵커가 없다. 그래서 시계로 사라짐의 한 박자(아래 `claude -p` 검사)를 확실히
// 넘긴 뒤 쏜다. 시계를 멈춘 동안에는 xterm도 파싱을 미루므로(`write`가 타이머로 다음 차례에 판다) 쏜 뒤에도 조금 흘린다.
test("에이전트가 사라져도 안 본 확인할 것은 남고, 그 뒤 OSC 승인 요청이 「나를 기다림」을 세운다", async ({ page }) => {
  await page.clock.install();
  await 둘째가말할자리(page);
  await markRunning(page, "claude", 2);
  await markAttention(
    page,
    { agent: "claude", event: "Stop", at: Date.now(), payload: { last_assistant_message: "다 했어요" }, stopped: true },
    2,
  );
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));

  await fireEvent(page, "pty:running", [{ id: 2, running: null }]);
  // 앵커: 도는 명령이 바뀐 것이 화면에 닿았다 — 그 칸의 claude 마크가 사라졌다.
  await expect(칸들(page).nth(1).getByRole("img", { name: "claude 실행 중" })).toHaveCount(0);
  await page.clock.runFor(1_000);
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);

  await writeShell(page, `${ESC}]9;Approval requested: Bash(git push)${BEL}`, 2);
  await page.clock.runFor(100);
  await expect(띠줄(page, `${plainWork.title} — 나를 기다림`)).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **`claude -p`의 끝이 사라짐보다 늦게 닿아도 확인할 것이 선다.** `-p`는 `Stop` · `SessionEnd`를 내고 몇 ms 만에 끝나는데,
// 그 훅 파일은 감시의 디바운스(100ms)를 지나야 닿는다(티켓 20 리뷰 반영). 1초 폴링이 그 틈에 떨어지면 사라짐이 먼저
// 닿는다 — 곧바로 지우면 도는 중이 「없음」이 되고, 뒤에 닿은 멈춘 세션 끝은 「아무 주장도 없던 셸」로 읽혀 확인할 것이
// 한 번도 안 선다. 그래서 사라짐은 한 박자 늦게 앉는다. 시계를 멈추고, 훅 파일을 사라짐보다 **디바운스만큼(100ms) 늦게**
// 쏜다 — 폴링이 끝난 직후에 떨어진 가장 나쁜 틈이다. 박자가 디바운스보다 짧으면 여기가 빨갛다.
test("사라짐 바로 뒤에 멈춘 세션 끝이 닿아도 확인할 것이 선다 — `claude -p`의 끝", async ({ page }) => {
  await page.clock.install();
  await 둘째가말할자리(page);
  await markRunning(page, "claude", 2);
  await markAttention(page, 새턴(), 2);
  await expect(링(page)).toHaveCount(1);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));

  await fireEvent(page, "pty:running", [{ id: 2, running: null }]);
  await page.clock.runFor(100);
  await fireAttention(
    page,
    { agent: "claude", event: "SessionEnd", at: Date.now(), payload: { reason: "other" }, stopped: true },
    2,
  );
  await page.clock.runFor(1_000);
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  await expect(링(page)).toHaveCount(0);

  // 남은 확인할 것은 사라짐이 앉힌 뒤라 권위가 풀려 있다 — 그 셸에서 띄운 다음 도구의 승인 요청이 선다. 이 줄이 없으면
  // 사라짐을 아예 안 보는 코드(확인할 것은 멈춘 세션 끝이 세운다)도 이 검사를 지난다.
  await writeShell(page, `${ESC}]9;Approval requested: Bash(git push)${BEL}`, 2);
  await page.clock.runFor(100);
  await expect(띠줄(page, `${plainWork.title} — 나를 기다림`)).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
