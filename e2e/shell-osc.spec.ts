import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  markAttention,
  markRunning,
  openShell,
  sentNotifications,
  setWindowFocused,
  stubNotifications,
  stubWindowFocus,
  unknownIpcCalls,
  workRow,
  writeShell,
  띠,
  레인,
  행버튼,
} from "./harness";

const [, plainWork] = WORKS;

// **훅을 안 깐 셸의 보너스 길**(#208 · 결정 11의 P). 파싱과 벨 규칙은 순수 함수 seam이 표로
// 전수하고(`shell-osc.test.ts`), **여기서만 보이는 것**은 그 규칙이 실제로 xterm에 붙어 있는가다.
//
// 이 층이 유일한 그물인 것 셋:
//   1. 바이트가 **진짜 xterm 파서**를 지나 핸들러를 때린다 — 프런트에서 이벤트를 흉내 내면
//      「핸들러가 붙었나」를 한 글자도 못 잰다.
//   2. **배경 칸도 받는다** — 아래 검사들은 전부 spec을 보는 중(= 그 셸이 DOM에서 빠진 중)에
//      바이트를 넣는다. 핸들러가 이펙트에 붙어 있으면 그 순간 아무 일도 안 일어난다.
//   3. 그 신호가 스토어를 한 바퀴 돌아 **띠와 탭까지** 간다.
//
// **spec 탭으로 옮겨 두는 것은 초록을 세우기 위해서이기도 하다**(결정 7) — 보고 있는 셸에
// 도착한 완료는 그 순간 「봤다」가 되어 화면에 안 선다.

/** 이스케이프 시작. 소스에 제어문자를 그대로 박지 않는다 — 편집기와 diff에서 안 보인다. */
const ESC = "\x1b";
/** 벨 한 번. OSC를 끝내는 문자이기도 하다(BEL 종결). */
const BEL = "\x07";

/** 셸을 살려 둔 채 **안 보는 자리**로 간다 — 그 칸은 배경 칸이 된다(결정 21). */
const 눈을뗀다 = async (page: Page) => {
  await page.locator('[data-tab="spec"]').click();
  await expect(page).not.toHaveURL(/tab=terminal/);
};

test("접두사 없는 OSC 9는 초록을 세우고 그 본문을 그대로 보인다", async ({ page }) => {
  await stubNotifications(page);
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 눈을뗀다(page);
  // 창이 뒤에 있어야 알림이 억제를 안 받는다(결정 7 · `shell-notify.spec.ts`와 같은 전제).
  await setWindowFocused(page, false);

  // **먼저 없음을 센다.** 이것이 없으면 아래 단언이 「원래 그렇던 것」으로도 초록이 된다.
  await expect(띠(page)).toHaveCount(0);

  // Codex의 턴 완료 미리보기가 이 모양이다 — 접두사가 없다(구현 스펙 3절).
  await writeShell(page, `${ESC}]9;PR #174 열었다${BEL}`);

  // **띠가 선다.** 접두사가 없어도 무시하지 않는다 — 무시하면 훅을 안 깐 Codex 사용자가
  // 턴 완료를 영영 못 받는다(결정 13의 둘째가 기각한 안).
  await expect(
    띠(page).getByRole("button", { name: `${plainWork.title} — 확인할 것`, exact: true }),
  ).toHaveCount(1);

  // **본문이 그대로 실려 사람이 읽는다**(결정 13의 둘째). 상태는 「확인할 것」이라는 약한
  // 주장만 하고 무슨 일인지는 이 글자가 말한다 — 그 글자가 서는 자리 둘을 다 본다.
  // (띠 줄은 한 줄이라 message를 안 싣는다 — 구현 결정 5.)
  //
  // **사람이 읽는 자리는 호버 카드의 말 칸이다**(`sidebar-active-band` 결정 14). 행이 한 줄이
  // 되면서 말이 행에서 빠져 그리로 갔다 — 여기서는 OSC가 연 길이 그 칸까지 닿는가를 본다.
  // 설명(`aria-description`)으로 재는 것은 아래 검사들이고, 이 하나만 카드로 잰다.
  await workRow(page, plainWork.slug).hover();
  await expect(
    page.locator("[data-popover] [data-last-message]").getByText("PR #174 열었다", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await sentNotifications(page))[0]?.body, { message: "알림이 안 울렸다" })
    .toBe("PR #174 열었다");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **등록 줄 하나를 딛는 검사다**(#208 리뷰). 파싱은 9와 777이 **같은 함수**를 타므로
// (`oscSignal`) 순수 함수 seam의 표는 777을 한 글자도 못 잰다 — 777이 실제로 파서에 붙어
// 있는지를 아는 자리는 이 층뿐이고, 이 검사가 없으면 `registerOscHandler(777, osc)`를 지워도
// 전 층이 초록이다. 티켓의 수용 기준이 「9·777·벨 **셋을** 붙인다」라 그 셋이 다 그물 안에
// 있어야 한다.
//
// **바꾸는 것은 번호 하나뿐이다.** 종결도 위와 같은 BEL이고 본문도 같다 — 여기서 ST 종결까지
// 함께 바꾸면 빨개졌을 때 「777이 안 붙었다」와 「ST를 못 읽는다」가 갈리지 않는다.
test("OSC 777도 같은 문으로 들어온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 눈을뗀다(page);

  await expect(띠(page)).toHaveCount(0);

  await writeShell(page, `${ESC}]777;PR #174 열었다${BEL}`);

  await expect(
    띠(page).getByRole("button", { name: `${plainWork.title} — 확인할 것`, exact: true }),
  ).toHaveCount(1);
  await expect(행버튼(page, `${plainWork.title} — 확인할 것`)).toHaveAccessibleDescription(
    "PR #174 열었다",
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("승인 접두사가 붙은 OSC 9는 앰버를 세우고, 다시 흐르는 출력이 그것을 푼다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 눈을뗀다(page);

  await writeShell(page, `${ESC}]9;Approval requested: Bash(git push)${BEL}`);

  const lane = 레인(page, plainWork.slug);
  await expect(lane.locator('[data-signal="waiting"]')).toHaveCount(1);
  // **접두사 뒤가 말이 된다** — 접두사 자체는 앱이 이미 상태로 옮겼으니 두 번 말하지 않는다.
  // 설명은 **글자 그대로 같은가**로 잰다 — 접두사가 남았으면 여기서 어긋나므로, 한때 따로 적던
  // 「`Approval requested`가 없다」가 이 한 줄에 든다.
  await expect(행버튼(page, `${plainWork.title} — 나를 기다림`)).toHaveAccessibleDescription(
    "Bash(git push)",
  );

  // **Codex는 승인 요청이 떠 있는 동안 턴 완료 OSC를 안 보낸다** — 앰버를 푸는 것은 사람이
  // 승인한 뒤 **다시 흐르기 시작한 출력**이다(스펙 전이 표의 마지막 줄). 이 줄이 없으면
  // 훅 없는 Codex 셸이 승인 뒤에도 영영 앰버로 남는다.
  await writeShell(page, "running git push...\r\n");

  await expect(lane.locator('[data-signal="working"]')).toHaveCount(1);
  // 부르는 셸이 아니게 됐으니 띠가 통째로 사라진다(도는 중은 띠에 못 온다 — 결정 8).
  //
  // _한때 여기서 「말은 남는다」(도는 행의 둘째 줄이 직전 말을 흐리게 든다 — 결정 13의 셋째)를
  // 쟀다._ 행이 한 줄이 되면서 그 말이 설 자리가 없어졌다: 카드의 말 칸과 행 설명은 부르는
  // 셸에만 선다(`sidebar-active-band` 결정 14 · S6). 결정 14가 고른 대가이고, 도는 행에 말 칸이
  // 없다는 것은 사이드바 spec의 「조용한 행과 도는 행의 카드에는 말 칸이 없고 …」가 든다.
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("벨은 아는 에이전트가 도는 칸에서만 삼켜진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  // 들어오면 뜨는 첫 칸(`ensureShell`)이 선 뒤에 연다 — `openShell`은 누르기 전의 칸 수를 센다.
  // pty가 앉기를 기다리지 않는다: 칸 순서대로 뜨는 것은 앱이 지킨다(`openShell`의 머리말).
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
  await openShell(page);

  // 첫 칸에서만 claude가 돈다. 둘째 칸은 아무것도 안 돈다 — 「모르는 명령」 쪽이다.
  await markRunning(page, "claude", 1);
  await 눈을뗀다(page);

  // 두 칸 다 벨을 울린다. **같은 바이트, 다른 답**이라야 이 검사가 규칙을 재는 것이 된다 —
  // 한쪽만 울리면 「벨이 아무 데서도 안 먹는다」로도 초록이다.
  await writeShell(page, BEL, 1);
  await writeShell(page, BEL, 2);

  // 둘째 칸만 부른다. claude가 스스로 울리는 벨은 훅이 이미 말한 것이라 삼킨다.
  await expect(띠(page).locator("button[aria-label]")).toHaveCount(1);

  // 어느 칸인지까지 못박는다 — 수만 보면 첫 칸이 부르고 둘째 칸이 조용해도 초록이다.
  // **탭 줄은 spec을 보는 중에도 그 자리에 있다**(머리행이라 본문과 함께 갈리지 않는다).
  const tabs = page.locator('[data-tab="shell"] button[aria-pressed]');
  await expect(tabs.nth(0)).not.toHaveAttribute("aria-label", /확인할 것/);
  await expect(tabs.nth(1)).toHaveAttribute("aria-label", /확인할 것/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("훅이 한 번이라도 말한 칸에서는 OSC도 출력도 아무것도 못 바꾼다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // **칸이 하나일 때 먼저 말하게 한다** — `markAttention`은 셸이 정확히 n개일 때까지
  // 기다리는 손잡이라(`awaitSpawned`) 둘째 칸을 연 뒤에는 첫 칸을 못 고른다.
  // 앰버는 「봤다」로 안 꺼지므로 보고 있는 중에 받아도 그대로 선다(결정 7).
  await markAttention(
    page,
    { agent: "claude", event: "Stop", payload: { last_assistant_message: "커밋할까요?" } },
    1,
  );
  await openShell(page);
  await 눈을뗀다(page);

  // **같은 바이트를 두 칸에 넣는다.** 이 검사가 fail-closed인 자리가 여기다 — 한 칸만 보면
  // 「훅이 이겼다」와 「바이트가 아무 데도 안 갔다」가 구분되지 않는다. 둘째 칸이 실제로
  // 초록이 되는 것이 곧 「길은 살아 있다」의 증거이고, 그 위에서만 첫 칸의 앰버가 뜻을 갖는다.
  await writeShell(page, `${ESC}]9;PR #174 열었다${BEL}`, 1);
  await writeShell(page, `${ESC}]9;PR #174 열었다${BEL}`, 2);

  const tabs = page.locator('[data-tab="shell"] button[aria-pressed]');
  await expect(tabs.nth(1)).toHaveAttribute("aria-label", /확인할 것/);
  await expect(tabs.nth(0)).toHaveAttribute("aria-label", /나를 기다림/);

  // **출력도 훅이 세운 기다림을 못 푼다**(권위 규칙 안쪽). 이 문이 넓어지면 claude가 답을
  // 기다리며 찍는 커서 갱신 한 번에 앰버가 꺼진다.
  await writeShell(page, "still thinking...\r\n", 1);
  await expect(tabs.nth(0)).toHaveAttribute("aria-label", /나를 기다림/);
  // 말도 훅이 준 것 그대로다 — OSC 본문이 덮지 않았다. 기다림이 완료보다 앞서 골리므로
  // (결정 3) 행이 말하는 것은 첫 칸의 말이다.
  await expect(행버튼(page, `${plainWork.title} — 나를 기다림`)).toHaveAccessibleDescription(
    "커밋할까요?",
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 포커스가 xterm의 숨은 입력칸에 있는가 — 셸을 붙이면 그쪽이 스스로 가져간다. */
const focusedClass = (page: Page) => page.evaluate(() => document.activeElement?.className ?? "");

// **사람이 키를 친 직후의 첫 프레임만 다른 길로 간다**(#208 리뷰). xterm의 `write()`는 평소
// 파싱을 다음 tick으로 미루는데(`WriteBuffer._scheduleInnerWrite`), 바로 앞에 사람 입력이
// 있었으면 그 한 번은 **`write()` 안에서 동기로** 파싱한다(`_didUserInput` 갈래). 그래서
// 출력 알림과 OSC 핸들러의 **순서가 이 갈래에서만 뒤집히고**, 뒤집힌 순서에서는 방금 선
// 앰버를 같은 프레임의 출력 알림이 그 자리에서 지운다.
//
// 그 자리가 정확히 이 판이 존재하는 이유다: 훅 없는 codex에서 사람이 `y`로 승인하면 그다음
// 승인 요청이 첫 프레임에 실려 오고, 그 프레임이 바로 이 동기 갈래를 탄다. 위 검사들은 키를
// 한 번도 안 쳐서 늘 비동기 갈래만 지났다 — 그물이 fail-open이었다.
test("사람이 키를 친 직후 프레임에 실려 온 승인 요청도 앰버로 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // **이 줄이 이 검사의 전제다.** 포커스가 셸에 없으면 xterm이 그 키를 「사람 입력」으로 안
  // 세고(`coreService.onUserInput`), 그러면 다음 프레임이 동기 갈래를 안 타 이 검사가
  // 아무것도 안 잰다 — 늘 초록인 검사가 된다.
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");
  // 사람이 승인한다. 이 한 글자가 PTY로 나가면서 xterm에 「방금 사람이 쳤다」가 선다.
  await page.keyboard.type("y");

  // 승인 뒤 codex가 곧바로 다음 승인을 묻는다 — 그 프레임이 동기로 파싱된다.
  await writeShell(page, `${ESC}]9;Approval requested: Bash(git push)${BEL}`);

  const lane = 레인(page, plainWork.slug);
  await expect(lane.locator('[data-signal="waiting"]')).toHaveCount(1);
  await expect(행버튼(page, `${plainWork.title} — 나를 기다림`)).toHaveAccessibleDescription(
    "Bash(git push)",
  );
  // **앰버가 도는 중으로 뒤집히지 않았다**를 못박는다. 위 한 줄만 보면 「아직 안 앉았다」와
  // 「앉았다 꺼졌다」가 갈리지 않는데, 이 갈래의 실패는 늘 후자다.
  await expect(lane.locator('[data-signal="working"]')).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
