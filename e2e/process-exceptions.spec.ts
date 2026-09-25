import { expect, test, type Page } from "./evidence";
import { FIXTURE_COMMANDS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

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
