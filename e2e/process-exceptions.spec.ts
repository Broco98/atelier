import { expect, test, type Page } from "./evidence";
import { FIXTURE_COMMANDS } from "./fixtures";
import { callCount, installFixtureBackend, ipcCallArgs, ipcFailure, unknownIpcCalls, 시계를세운다 } from "./harness";

// 설정 › 터미널의 「셸을 닫아도 남길 프로세스」(프로세스 결정 5 · 티켓 06). 목록을 고치고 저장하면 그 목록이 설정
// 저장에 실리고, 「기본값으로」를 누르고 저장하면 `null`이 실린다 — `null`이 「기본 목록을 쓴다」이고, 그 목록은
// 판정이 쓰는 Rust 상수라 파일에 안 적는다(프로세스 스펙 S7).
//
// 판정이 끝낼 때마다 그 목록을 읽어 예외를 남기는지는 Rust가 잰다(`pty.rs`의 예외 장면). 이 층이 재는 것은
// **화면이 무엇을 저장에 싣나**다. 목록 글자를 읽는 규칙(빈 줄, 앞뒤 공백, 기본 목록과 같으면 `null`)은 L2가
// 잰다(`process-exceptions.test.ts`).

const 구획 = (page: Page) => page.getByRole("group", { name: "터미널 설정", exact: true });
const 목록 = (page: Page) =>
  구획(page).getByRole("textbox", { name: "셸을 닫아도 남길 프로세스", exact: true });
const 저장 = (page: Page) => 구획(page).getByRole("button", { name: "저장", exact: true });
const 기본값으로 = (page: Page) => 구획(page).getByRole("button", { name: "기본값으로", exact: true });

/** 백엔드가 준 기본 목록 — 고정 답 표에서 읽는다. 여기 다시 적으면 표와 이 검사가 따로 낡는다. */
const DEFAULTS = FIXTURE_COMMANDS.default_process_exceptions as string[];
/** 고정 답의 파일에 적힌 터미널 구획. 예외 목록은 `null`이다. */
const fileTerminal = (FIXTURE_COMMANDS.read_settings as { terminal: Record<string, unknown> }).terminal;

/** 나간 `write_settings`들의 터미널 구획. 기록 형식이 낯설면 던진다(`ipcCallArgs`). */
async function writtenTerminals(page: Page): Promise<Array<Record<string, unknown>>> {
  return (await ipcCallArgs(page, "write_settings", "settings")).map(
    ({ args }) => (args.settings as { terminal: Record<string, unknown> }).terminal,
  );
}

test("고치지 않은 목록은 기본 목록을 보이고, 한 줄 더해 저장하면 기본 목록 + 그 이름이 실린다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");

  // 앵커: 파일의 목록이 `null`이라 칸에 백엔드가 준 기본 목록이 섰다. 이것 없이 아래로 가면 빈 칸에 한 줄을 더한
  // 것과 구별이 안 된다.
  await expect(목록(page)).toHaveValue(DEFAULTS.join("\n"));
  await expect(저장(page), "아무것도 안 고쳤는데 저장이 열렸다").toBeDisabled();

  await 목록(page).fill([...DEFAULTS, "mydaemon"].join("\n"));
  await 저장(page).click();
  // 쓰기가 돌아온 순간을 기다린다 — 저장이 끝나면 고칠 것이 없어져 잠긴다.
  await expect(저장(page), "저장이 안 끝났다").toBeDisabled();

  const written = await writtenTerminals(page);
  expect(written, "쓰기가 한 번 나가야 한다").toHaveLength(1);
  expect(written[0], "기본 목록 + 더한 이름이 아니다 — 다른 칸은 파일 그대로여야 한다").toEqual({
    ...fileTerminal,
    processExceptions: [...DEFAULTS, "mydaemon"],
  });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("적힌 목록을 고치면 고친 목록이 실린다 — 빈 줄과 앞뒤 공백은 걷는다", async ({ page }) => {
  await installFixtureBackend(page, {
    read_settings: { terminal: { ...fileTerminal, processExceptions: ["tmux", "mydaemon"] } },
  });
  await page.goto("/settings/terminal");
  await expect(목록(page)).toHaveValue("tmux\nmydaemon");

  await 목록(page).fill("tmux\n\n  colima  \n");
  await 저장(page).click();
  await expect(저장(page), "저장이 안 끝났다").toBeDisabled();

  const written = await writtenTerminals(page);
  expect(written, "쓰기가 한 번 나가야 한다").toHaveLength(1);
  expect(written[0].processExceptions).toEqual(["tmux", "colima"]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("적힌 목록에서 「기본값으로」를 누르고 저장하면 `null`이 실린다", async ({ page }) => {
  await installFixtureBackend(page, {
    read_settings: { terminal: { ...fileTerminal, processExceptions: ["tmux", "mydaemon"] } },
  });
  await page.goto("/settings/terminal");
  // 앵커: 파일에 적힌 목록이 칸에 섰다 — 처음부터 `null`이면 「기본값으로」가 아무것도 안 바꾼다.
  await expect(목록(page)).toHaveValue("tmux\nmydaemon");

  await 기본값으로(page).click();
  await expect(목록(page), "「기본값으로」를 눌렀는데 칸이 기본 목록으로 안 돌아왔다").toHaveValue(
    DEFAULTS.join("\n"),
  );
  await expect(기본값으로(page), "이미 기본값인데 또 누를 수 있다").toBeDisabled();

  await 저장(page).click();
  await expect(저장(page), "저장이 안 끝났다").toBeDisabled();

  const written = await writtenTerminals(page);
  expect(written, "쓰기가 한 번 나가야 한다").toHaveLength(1);
  // **키가 있고 값이 `null`이다** — 기본 목록을 글자로 적으면 다음 판의 기본 목록이 이 사람에게 안 닿는다.
  expect(written[0]).toHaveProperty("processExceptions", null);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **기본 목록을 못 받으면 곧바로 그렇게 적고 칸을 잠근다 — 다시 묻지 않는다.** 칸은 기본 목록을 모르는 채 열리면 안 되고(한 줄을
// 더해 저장하는 순간 기본 목록이 통째로 사라진다), 잠긴 채 말이 없으면 사람은 왜 못 고치는지 모른다. 다시 묻기를 기다리게 하면
// (웹뷰 react-query의 기본 — 세 번 더, 1 · 2 · 4초 쉼) 그 7초 동안 칸이 말없이 잠기고 말은 그 뒤에야 선다. 다른 칸(글꼴 · 크기 ·
// 테마)은 그대로 쓴다.
//
// **시계를 페이지를 열기 전에 건다**(`page.clock`) — 말이 선 뒤 시간을 손으로 돌려, 다시 묻는 타이머가 걸려 있지 않은지 본다.
// 부른 수를 그대로 견주지 않는 것은 개발 빌드의 StrictMode가 마운트를 두 번 돌리기 때문이다(묻는 자리에 따라 한 번 또는 두 번).
test("기본 목록을 못 받으면 곧바로 그렇게 적고 칸을 잠그며, 다시 묻지 않는다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, {
    default_process_exceptions: ipcFailure("기본 목록을 읽지 못했습니다"),
  });
  await page.goto("/settings/terminal");

  await expect(구획(page).getByText("기본 목록을 읽지 못했어요.", { exact: true })).toBeVisible();
  await expect(목록(page), "기본 목록을 모르는데 칸이 열렸다").toBeDisabled();
  // 앵커: 구획의 다른 칸은 선다 — 예외 칸만 잠긴다.
  await expect(구획(page).getByRole("button", { name: "밝게", exact: true })).toBeEnabled();

  await 시계를세운다(page);
  const asked = await callCount(page, "default_process_exceptions");
  expect(asked, "기본 목록을 안 물었다").toBeGreaterThan(0);
  await page.clock.runFor(10_000);
  expect(await callCount(page, "default_process_exceptions"), "못 받은 기본 목록을 다시 물었다").toBe(asked);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **창으로 돌아와도, 네트워크가 돌아와도 못 받은 기본 목록을 다시 묻지 않는다.** 시간만 돌리는 위 검사는 이 둘을 못 본다 —
// react-query는 값이 없는 조회를 `staleTime`과 상관없이 낡았다고 보고 창이 다시 보이면(`visibilitychange`) 다시 부른다.
// 네트워크가 돌아올 때(`online`)도 같은 길인데, 이 조회는 `networkMode: "always"`라 그 기본이 꺼져 있다. 다시 묻는 동안은
// 실패가 아니라 기다림이라 「읽지 못했어요」가 사라지고 칸은 잠긴 채다 — 위 검사가 막으려는 「칸이 말없이 잠긴다」가 그 동안
// 선다. 옛 훅(이펙트에서 한 번)은 페이지를 다시 열 때까지 다시 묻지 않았다.
//
// 창으로 돌아오기는 웹뷰가 최소화 · 가리기 · 다른 Space에서 돌아올 때 쏘는 `visibilitychange`로 흉내 낸다 — react-query는 창
// `focus`가 아니라 이것만 듣는다(`focusManager`). 네트워크가 돌아오기는 `offline` 뒤 `online`이다(끊기지 않은 채 `online`만
// 쏘면 react-query가 바뀐 것이 없다고 본다).
test("못 받은 기본 목록은 창으로 돌아와도, 네트워크가 돌아와도 다시 묻지 않는다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, {
    default_process_exceptions: ipcFailure("기본 목록을 읽지 못했습니다"),
  });
  await page.goto("/settings/terminal");
  const 못받음 = 구획(page).getByText("기본 목록을 읽지 못했어요.", { exact: true });
  await expect(못받음).toBeVisible();

  await 시계를세운다(page);
  const asked = await callCount(page, "default_process_exceptions");
  expect(asked, "기본 목록을 안 물었다").toBeGreaterThan(0);

  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
  await page.clock.runFor(1_000);
  expect(
    await callCount(page, "default_process_exceptions"),
    "창으로 돌아오자 못 받은 기본 목록을 다시 물었다",
  ).toBe(asked);

  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.runFor(1_000);
  expect(
    await callCount(page, "default_process_exceptions"),
    "네트워크가 돌아오자 못 받은 기본 목록을 다시 물었다",
  ).toBe(asked);

  // 말과 잠김이 그대로다.
  await expect(못받음).toBeVisible();
  await expect(목록(page)).toBeDisabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **네트워크가 끊겨도 기본 목록을 묻는다** — 기본 목록은 로컬 IPC라 네트워크와 상관이 없다. react-query는 창이 `offline`을
// 받으면 그 뒤 새로 서는 조회를 부르지 않고 멈춰 두는데(`networkMode`의 기본 `online`), 이 조회가 그 길을 타면 칸은 기본 목록을
// 모르는 채 잠기고 「읽지 못했어요」도 안 서 사람은 왜 못 고치는지 모른다. 페이지를 떠나면 버리는 조회라(`gcTime: 0`) 설정 ›
// 터미널을 열 때마다 새로 선다.
//
// 앱이 떠 있는 동안 끊기는 것을 흉내 낸다 — 다른 설정 항목에 서 있다가 창에 `offline`을 쏘고(웹뷰가 네트워크가 끊기면 쏘는 것),
// 그 뒤 터미널로 옮긴다. 페이지를 다시 읽으면 react-query가 다시 온라인으로 시작하므로 옮기기는 사이드바로 한다.
test("네트워크가 끊긴 뒤 열어도 기본 목록을 묻고 칸을 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/hooks");
  await expect(page.getByRole("heading", { name: "에이전트 훅", exact: true })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.locator("aside").getByRole("button", { name: "터미널", exact: true }).click();
  await expect(page).toHaveURL("/settings/terminal");

  await expect(목록(page), "끊긴 뒤 연 칸에 기본 목록이 안 섰다").toHaveValue(DEFAULTS.join("\n"));
  await expect(목록(page)).toBeEnabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});
