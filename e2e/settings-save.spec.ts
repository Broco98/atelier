import { expect, test, type Page } from "./evidence";
import { FIXTURE_COMMANDS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 설정의 **구획별 저장**(#225 · 결정 21). 터미널 설정과 알림 설정이 각자 저장 버튼을 갖고,
// 에이전트 훅은 누르면 바로 적용된다.
//
// 「최신 설정에 자기 칸만 덮는다」는 L2가 잰다(`save-section.test.ts`) — 여기 고정 백엔드는
// 쓰기를 기억하지 않아 「그사이 저장된 값」을 못 세운다. **이 층이 재는 것은 초안이 구획마다
// 따로 사는가**다: 초안을 두 구획 위로 올리면 L2의 저장 함수는 멀쩡한데 알림을 저장할 때
// 고치다 만 터미널 값이 함께 실려 나간다 — 화면은 둘 다 멀쩡해 보인다.

/** 한 구획 조각. 저장 버튼을 **그 조각 안에서** 집어야 둘 중 어느 것인지가 갈린다. */
const 구획 = (page: Page, name: "터미널 설정" | "알림 설정") =>
  page.getByRole("group", { name, exact: true });

const 저장 = { name: "저장", exact: true } as const;

/** 나간 `write_settings`들의 인자. 기록 형식이 낯설면 던진다 — 조용한 빈 목록은 fail-open이다. */
async function writtenSettings(page: Page): Promise<unknown[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls
    .filter((call) => call === "write_settings" || call.startsWith("write_settings "))
    .map((call) => {
      const args: unknown = JSON.parse(call.slice("write_settings".length).trim() || "null");
      if (typeof args !== "object" || args === null || !("settings" in args)) {
        throw new Error(`write_settings 호출의 모양이 낯설다 — ${call}`);
      }
      return (args as { settings: unknown }).settings;
    });
}

test("터미널 설정과 알림 설정에 저장 버튼이 각자 있고, 에이전트 훅에는 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings");

  await expect(구획(page, "터미널 설정").getByRole("button", 저장)).toHaveCount(1);
  await expect(구획(page, "알림 설정").getByRole("button", 저장)).toHaveCount(1);
  // 화면 전체에 둘뿐이다 — 셋째(구획 밖의 공용 저장)가 남아 있으면 여기서 걸린다.
  await expect(page.getByRole("button", 저장)).toHaveCount(2);

  // 훅 구획은 **서 있는 것을 먼저 세운다** — 구획이 통째로 안 그려져도 「저장 버튼이 없다」는
  // 참이 되기 때문이다.
  const 훅 = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "에이전트 훅", exact: true }) });
  await expect(훅.getByRole("button", { name: "설치", exact: true })).toBeVisible();
  await expect(훅.getByRole("button", 저장)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("터미널 설정을 고친 채 알림 설정을 저장하면 터미널 초안은 안 실린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings");

  const 터미널 = 구획(page, "터미널 설정");
  const 알림 = 구획(page, "알림 설정");

  // 터미널 설정을 고치고 **저장하지 않는다**.
  await 터미널.getByRole("textbox", { name: "터미널 글꼴 크기", exact: true }).fill("16");
  await expect(터미널.getByRole("button", 저장), "터미널 설정이 고친 것으로 안 읽혔다").toBeEnabled();
  // 알림 구획은 고친 것이 없다 — 초안을 같이 들면 여기서 이미 열린다.
  await expect(알림.getByRole("button", 저장)).toBeDisabled();

  await 알림.getByRole("button", { name: "알림에 소리 끔" }).click();
  await 알림.getByRole("button", 저장).click();
  // 쓰기가 돌아온 순간을 기다린다 — 저장이 끝나면 고칠 것이 없어져 잠긴다.
  await expect(알림.getByRole("button", 저장), "저장이 안 끝났다").toBeDisabled();

  const written = await writtenSettings(page);
  expect(written, "쓰기가 한 번 나가야 한다").toHaveLength(1);
  const [one] = written as Array<{ terminal: unknown; notifications: unknown }>;
  // 파일에 있던 터미널 값 그대로다 — 고치다 만 16이 안 실렸다.
  const fileTerminal = (FIXTURE_COMMANDS.read_settings as { terminal: unknown }).terminal;
  expect(one.terminal, "알림 저장에 터미널 초안이 실렸다").toEqual(fileTerminal);
  expect(one.notifications).toEqual({ sound: false });

  // 터미널 초안은 버려지지 않고 제 구획에 남아 있다 — 따로 저장할 수 있다.
  await expect(터미널.getByRole("textbox", { name: "터미널 글꼴 크기", exact: true })).toHaveValue(
    "16",
  );
  await expect(터미널.getByRole("button", 저장)).toBeEnabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});
