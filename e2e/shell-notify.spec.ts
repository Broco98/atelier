import { expect, test } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import {
  badgeCalls,
  installFixtureBackend,
  markAttention,
  sentNotifications,
  setWindowFocused,
  stubNotifications,
  stubWindowFocus,
  unknownIpcCalls,
} from "./harness";

// 판 06 — **셸이 부르는 것을 앱 밖으로 내보내는 길**(#206 · 결정 10).
//
// 판정 자체는 순수 함수라 L2의 표가 센다(`src/features/terminal/shell-notify.test.ts`) —
// 엣지 · 재무장 · 5초 창 · 보임 억제가 거기 있다. **이 층이 재는 것은 그 판정이 실제로
// 채널까지 닿는가**다: 배선이 끊기면 표는 초록인 채로 앱만 조용해지고, 그 조용함은 「부를
// 일이 없었다」와 화면에서 구분되지 않는다.
//
// 두 손잡이를 손으로 잡는다 — 알림 생성자(`stubNotifications`의 머리말이 이유를 든다)와
// 창 포커스(`stubWindowFocus`, 헤드리스 WebKit은 늘 앞에 있다고 답한다).

const work = WORKS.find((one) => one.worktrees.length === 1) ?? WORKS[0];

/** 셸이 답을 마치고 사람을 기다리는 그 이벤트. 전이 표의 `Stop → waiting`이다. */
const 기다림 = {
  agent: "claude",
  event: "Stop",
  payload: { last_assistant_message: "테스트 셋 통과\n커밋할까요?" },
};

test("다른 앱을 보고 있으면 셸이 부를 때 한 번 울린다", async ({ page }) => {
  await stubNotifications(page);
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  // 창이 뒤에 있으면 켜진 탭도 「보는 중」이 아니다(결정 7) — 그래야 이 셸이 억제를 안 받는다.
  await setWindowFocused(page, false);
  await markAttention(page, 기다림);

  await expect
    .poll(async () => (await sentNotifications(page)).length, { message: "알림이 안 울렸다" })
    .toBe(1);

  const [one] = await sentNotifications(page);
  // 제목 줄에 work과 셸이 함께 선다(채널에 부제 칸이 없다 — `notificationPayload`).
  expect(one.title).toContain(work.title);
  expect(one.title, "어느 셸인지가 안 실렸다").toContain(FIXTURE_SHELL_NAME);
  // 본문은 셸이 한 말의 **첫 줄**이다 — 어댑터가 접어 준 그대로.
  expect(one.body).toBe("테스트 셋 통과");
  // 소리는 기본으로 켜져 있다(결정 10) — 안 고른 값은 프런트가 켬으로 든다.
  expect(one.sound, "소리가 안 실렸다").toBeTruthy();

  // **같은 값으로 남아 있는 동안은 안 울린다**(스토리 60). 같은 이벤트가 한 번 더 와서
  // 상태는 갱신되지만 화면값은 그대로다.
  await markAttention(page, { ...기다림, at: 2000 });
  await expect
    .poll(async () => (await sentNotifications(page)).length, { message: "두 번 울렸다" })
    .toBe(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 58 — 이미 보고 있는 것을 또 알리지 않는다. **이 검사가 fail-open이 되기 쉽다**:
// 억제가 아니라 배선이 끊겨서 조용해도 똑같이 초록이 된다. 그래서 위 검사가 같은 길로
// **울리는 것**을 먼저 세워 두고, 여기서는 갈리는 조건 하나만 바꾼다.
test("그 셸을 보고 있으면 안 울린다", async ({ page }) => {
  await stubNotifications(page);
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  // 창이 앞에 있고 그 칸이 켜져 있다 — 결정 7의 「봤다」가 서는 유일한 조합이다.
  await setWindowFocused(page, true);
  await markAttention(page, 기다림);

  // 화면은 이미 그 사실을 그렸는데(둘째 줄에 그 말이 선다) 알림만 안 울렸다 —
  // **그 두 줄이 함께 있어야** 「배선이 끊겨서 조용한 것」과 갈린다.
  await expect(page.getByText("테스트 셋 통과")).toBeVisible();
  expect(await sentNotifications(page)).toEqual([]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 65 — 앱을 안 열고도 몇 개가 부르는지 안다. 0이면 배지가 사라져야 한다:
// 안 지우면 아무도 안 부르는데 독에 수가 남아 「부르는 것이 있다」가 영영 거짓말이 된다.
test("독 배지에 확인할 것의 수가 뜨고, 0이면 사라진다", async ({ page }) => {
  await stubNotifications(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  // 아무도 안 부르는 동안에는 **아무것도 안 나간다** — 0에서 0으로 가는 호출이 없다.
  expect(await badgeCalls(page)).toEqual([]);

  await markAttention(page, 기다림);
  await expect.poll(() => badgeCalls(page), { message: "배지에 수가 안 붙었다" }).toEqual([1]);

  // 사람이 답하면(프롬프트를 보내면) 그 셸은 도는 중이 되고 부르기를 그친다.
  await markAttention(page, { agent: "claude", event: "UserPromptSubmit", at: 2000 });
  // `null`이 「배지를 없앤다」다 — 0을 넘기면 동그라미 안에 0이 앉는다.
  await expect
    .poll(() => badgeCalls(page), { message: "배지가 안 사라졌다" })
    .toEqual([1, null]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
