import { expect, test } from "./evidence";
import { FIXTURE_SHELL_NAME, WORKS } from "./fixtures";
import {
  awaitSpawned,
  badgeCalls,
  fireAttention,
  installFixtureBackend,
  markAttention,
  sentNotifications,
  setWindowFocused,
  stubNotifications,
  stubWindowFocus,
  unknownIpcCalls,
  행버튼,
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

  // 화면은 이미 그 사실을 그렸는데(부르는 행 버튼이 그 말을 설명으로 든다) 알림만 안 울렸다 —
  // **그 두 줄이 함께 있어야** 「배선이 끊겨서 조용한 것」과 갈린다. 한때 이 앵커는 행의
  // 둘째 줄에 선 그 말이었다 — 행이 한 줄로 돌아오면서(`sidebar-active-band` 결정 14) 말은
  // 호버 카드의 말 칸과 행 설명으로 갔고, 올리지 않고 닿는 쪽이 설명이다.
  await expect(행버튼(page, `${work.title} — 나를 기다림`)).toHaveAccessibleDescription(
    "테스트 셋 통과",
  );
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

// **고른 값이 채널까지 가는가**(스토리 66·64). 판정과 접기는 L2의 표가 재지만, 설정을
// 읽어 배선에 먹이는 길(`loadNotifySettings` → `notifyChoice` → `outgoing`)은 이 층에서만
// 이어진다 — 그 길이 끊기면 「껐는데 울린다」와 「켰는데 조용하다」가 둘 다 조용히 산다.
//
// **아래 둘은 파일에서 시작한다.** 설정 화면을 거치지 않고 `read_settings`의 답만 바꾸는
// 것은, 앱이 뜨면서 그 파일을 읽는 것이 이 배선의 정상 경로이기 때문이다(`main.tsx`).
// **화면에서 고른 값이 저장을 지나 같은 자리로 오는 길은 이 파일 맨 아래 검사가 잰다** —
// 마크업 seam(`SettingsPage.test.tsx`)이 재는 것은 그 길의 양 끝(`notificationChoice`·
// `patchNotifications`)뿐이고, 둘을 잇는 `save()`의 접착 한 줄은 그 층에서는 안 걸린다.
const 설정 = (notifications: { enabled?: boolean; sound?: boolean }) => ({
  read_settings: { terminal: { fontFamily: null, fontSize: null, theme: "dark" }, notifications },
});

test("설정에서 껐으면 부를 때 아무것도 안 나간다", async ({ page }) => {
  await stubNotifications(page);
  await stubWindowFocus(page);
  await installFixtureBackend(page, 설정({ enabled: false }));
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  await setWindowFocused(page, false);
  await markAttention(page, 기다림);

  // **이 두 줄이 함께 있어야 한다.** 화면은 그 사실을 그렸는데(부르는 행 버튼이 셸이 한 말을
  // 설명으로 든다) 밖으로는 아무것도 안 나갔다 — 위 첫 검사가 같은 길로 **울리는 것**을 이미
  // 세워 뒀으므로, 여기의 조용함은 「배선이 끊겼다」가 아니라 「껐다」다.
  await expect(행버튼(page, `${work.title} — 나를 기다림`)).toHaveAccessibleDescription(
    "테스트 셋 통과",
  );
  expect(await sentNotifications(page), "껐는데 알림이 울렸다").toEqual([]);
  // 배지도 함께 내린다 — 독에 수가 남으면 「껐는데 아직 부른다」로 읽힌다.
  expect(await badgeCalls(page), "껐는데 배지가 붙었다").toEqual([]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("소리만 껐으면 알림은 오되 소리가 안 실린다", async ({ page }) => {
  await stubNotifications(page);
  await stubWindowFocus(page);
  await installFixtureBackend(page, 설정({ sound: false }));
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  await setWindowFocused(page, false);
  await markAttention(page, 기다림);

  await expect
    .poll(async () => (await sentNotifications(page)).length, { message: "알림이 안 울렸다" })
    .toBe(1);

  const [one] = await sentNotifications(page);
  // 껐다는 것은 **소리 칸이 비는 것**이지 알림이 안 오는 것이 아니다(스토리 64).
  expect(one.sound, "소리를 껐는데 실려 나갔다").toBeUndefined();
  expect(one.body, "본문까지 사라졌다").toBe("테스트 셋 통과");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **설정 화면에서 고른 값이 그 자리에서 먹는가**(스토리 66·64). 위 둘이 재는 것은 「파일에
// 이렇게 적혀 있으면」이라, 앱이 뜰 때 한 번 도는 `loadNotifySettings`만 지나간다 — 사람이
// 화면에서 끄는 길은 그 뒤에 오는 **다른 줄**이다(`SettingsPage.tsx`의 `NotificationSettingsPage`가
// 쓰기에 성공한 뒤 부르는 `applyNotifySettings`). 그 한 줄이 사라져도 저장은 성공하고 화면은 껐다고
// 그린 채로 남아, 사람은 **앱을 껐다 켤 때까지** 계속 울리는 것을 앱 고장으로 읽는다.
//
// 그 줄은 어느 층에서도 안 걸렸다: 마크업 seam은 양 끝의 순수 함수만 돌리고(고른 값을
// 파일 모양으로 접는 `patchNotifications`, 파일을 선택으로 펴는 `notificationChoice`),
// 둘을 잇는 접착은 컴포넌트 안에 있어 그 층이 못 닿는다.
//
// **앱을 다시 안 띄우는 것이 이 검사의 전부다.** 새로 `goto`하면 부팅이 파일을 다시 읽어
// 위 두 검사와 같은 길이 되고, 재려던 그 줄은 통째로 우회된다 — 그래서 사이드바를 눌러
// 같은 페이지 안에서 옮긴다. 고르는 것은 **소리**다: 껐을 때도 알림 자체는 오므로
// (스토리 64) 「소리 칸이 빈 알림 하나」가 서고, 그러면 이 검사의 초록이 「배선이 끊겨서
// 조용한 것」과 갈린다.
//
// 설정에는 main nav가 없어서(UI개선 결정 21) **`/terminal`에서 출발해 돌아간다** — 사이드바 바닥
// `Settings`로 들어가 `알림`으로 옮기고, 「앱으로 돌아가기」가 떠나온 `/terminal`로 데려간다.
test("설정 화면에서 소리를 끄면 앱을 다시 안 띄워도 소리가 빠진다", async ({ page }) => {
  await stubNotifications(page);
  await stubWindowFocus(page);
  await installFixtureBackend(page);

  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: "Settings", exact: true }).click();
  // 파일에는 알림 구획이 아예 없다(고정 표) — 안 고른 값은 둘 다 켬이다(결정 10).
  await aside.getByRole("button", { name: "알림", exact: true }).click();
  await expect(page).toHaveURL("/settings/notifications");
  // 저장 버튼이 구획마다 있다(#225) — **알림 설정 안에서** 집어야 누른 것이 이 구획의 저장이다.
  const 알림 = page.getByRole("group", { name: "알림 설정", exact: true });
  // 소리는 스위치 하나다(결정 12). 안 고른 값이 켬이라 한 번 누르면 꺼진다.
  const 소리 = 알림.getByRole("switch", { name: "알림에 소리", exact: true });
  await expect(소리, "알림 구획이 안 섰다").toHaveAttribute("aria-checked", "true");
  await 소리.click();
  await expect(소리, "스위치가 안 꺼졌다").toHaveAttribute("aria-checked", "false");

  const 저장 = 알림.getByRole("button", { name: "저장", exact: true });
  await expect(저장, "고친 것이 없다고 읽혔다").toBeEnabled();
  await 저장.click();
  // **쓰기가 실제로 돌아온 순간을 기다린다.** 저장이 끝나면 고칠 것이 없어져 버튼이 잠긴다 —
  // 이걸 안 기다리면 아래 알림이 저장 **전에** 울려 놓고 통과할 수 있다.
  await expect(저장, "저장이 안 끝났다").toBeDisabled();

  await aside.getByRole("button", { name: "앱으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL("/terminal");
  await awaitSpawned(page, 1);

  await setWindowFocused(page, false);
  await markAttention(page, 기다림);

  await expect
    .poll(async () => (await sentNotifications(page)).length, { message: "알림이 안 울렸다" })
    .toBe(1);

  const [one] = await sentNotifications(page);
  // 저장한 그 선택이 도착했다. 배선이 저장을 안 지나면 여기 소리가 실려 나간다.
  expect(one.sound, "화면에서 껐는데 소리가 실려 나갔다").toBeUndefined();
  // 알림 자체는 온다 — 이 줄이 없으면 「배선이 통째로 죽어서 조용한 것」이 초록이 된다.
  expect(one.body, "알림이 통째로 안 왔다").toBe("테스트 셋 통과");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 73 — **설정에 있는 동안에도 셸이 부르면 운다**(UI개선 결정 21). 설정에서는 사이드바가
// 설정 nav로 바뀌고 띠도 없어서, 알림이 안 울리면 그 조용함은 「부를 일이 없었다」와 화면에서
// 구분되지 않는다 — 셸이 설정 화면을 「그 셸을 보고 있다」로 읽는 회귀가 그 모양으로 숨는다.
//
// **창을 앞에 둔 채로 잰다.** 억제는 「그 셸이 보이는가」이고 설정에서는 어느 셸도 안 보이므로
// 창이 앞이어도 울어야 한다 — 창을 뒤로 보내고 재면 「보이는 셸인데 창이 뒤라 울었다」와 안 갈린다.
test("설정에 있는 동안 셸이 부르면 울린다", async ({ page }) => {
  await stubNotifications(page);
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=terminal`);
  // **착석은 탭 줄이 있는 여기서 기다린다** — 설정에는 탭 줄이 없어 `markAttention`의 기다림이 던진다.
  await awaitSpawned(page, 1);
  await setWindowFocused(page, true);

  await page.locator("aside").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL("/settings/terminal");
  // **주소가 아니라 화면이 옮겨 온 뒤에 쏜다.** 주소는 본문보다 먼저 바뀌어서, URL만 보고 쏘면
  // 떠나는 터미널 칸이 아직 「보이는 셸」이라 억제가 맞게 문다 — 이 검사가 그 경쟁으로 빨개졌다.
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(0);
  await expect(
    page.locator("aside").getByRole("button", { name: "앱으로 돌아가기", exact: true }),
  ).toBeVisible();
  await fireAttention(page, 기다림);

  await expect
    .poll(async () => (await sentNotifications(page)).length, { message: "설정에서 알림이 안 울렸다" })
    .toBe(1);
  const [one] = await sentNotifications(page);
  // 제목이 work의 이름을 싣는다 — 띠가 없는 화면에서도 이름표가 그대로다.
  expect(one.title, "알림 제목이 work 이름을 잃었다").toContain(work.title);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
