import { expect, test, type Page } from "./evidence";
import { FIXTURE_COMMANDS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

// 설정의 **구획별 저장**(#225 · 결정 21). 터미널 설정과 알림 설정이 각자 저장 버튼을 갖고,
// 에이전트 훅은 누르면 바로 적용된다. 항목마다 페이지가 따로다(#226 · UI개선 결정 22).
//
// 「최신 설정에 자기 칸만 덮는다」는 L2가 잰다(`save-section.test.ts`) — 여기 고정 백엔드는
// 쓰기를 기억하지 않아 「그사이 저장된 값」을 못 세운다. **이 층이 재는 것은 초안이 항목 페이지
// 안에 사는가**다: 초안을 레이아웃이나 스토어로 올리면 L2의 저장 함수는 멀쩡한데 알림을 저장할 때
// 고치다 만 터미널 값이 함께 실려 나가고, 돌아온 터미널 설정 페이지에 버렸어야 할 값이 남는다.

/** 한 구획 조각. 저장 버튼을 **그 조각 안에서** 집어야 둘 중 어느 것인지가 갈린다. */
const 구획 = (page: Page, name: "터미널 설정" | "알림 설정") =>
  page.getByRole("group", { name, exact: true });

/** 설정 nav의 항목. 본문의 버튼과 이름이 안 겹치게 사이드바로 좁힌다. */
const 항목 = (page: Page, name: "터미널" | "알림" | "에이전트 훅") =>
  page.locator("aside").getByRole("button", { name, exact: true });

const 저장 = { name: "저장", exact: true } as const;

/** 나간 `write_settings`들의 인자. 기록 형식이 낯설면 던진다 — 조용한 빈 목록은 fail-open이다. */
async function writtenSettings(page: Page): Promise<unknown[]> {
  return (await ipcCallArgs(page, "write_settings", "settings")).map(({ args }) => args.settings);
}

test("터미널 설정과 알림 설정에 저장 버튼이 각자 있고, 에이전트 훅에는 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");

  await expect(구획(page, "터미널 설정").getByRole("button", 저장)).toHaveCount(1);
  // 화면 전체에 하나뿐이다 — 구획 밖의 공용 저장이 남아 있으면 여기서 걸린다.
  await expect(page.getByRole("button", 저장)).toHaveCount(1);

  await 항목(page, "알림").click();
  await expect(구획(page, "알림 설정").getByRole("button", 저장)).toHaveCount(1);
  await expect(page.getByRole("button", 저장)).toHaveCount(1);

  await 항목(page, "에이전트 훅").click();
  // 훅 구획은 **서 있는 것을 먼저 세운다** — 구획이 통째로 안 그려져도 「저장 버튼이 없다」는
  // 참이 되기 때문이다.
  await expect(page.getByRole("heading", { name: "에이전트 훅", exact: true })).toBeVisible();
  const 훅 = page.locator("main");
  await expect(훅.getByRole("button", { name: "설치", exact: true })).toBeVisible();
  await expect(page.getByRole("button", 저장)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 81 · 결정 26 — 저장 안 한 편집을 두고 다른 항목으로 가면 버린다.
test("터미널 설정을 고친 채 알림으로 옮겨 저장하면 터미널 초안은 안 실리고, 돌아오면 버려져 있다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");

  const 크기 = 구획(page, "터미널 설정").getByRole("textbox", { name: "터미널 글꼴 크기", exact: true });
  // 파일에 있던 값. 고친 값이 이것과 같으면 「버려졌다」가 아무것도 안 잰다.
  const fileTerminal = (FIXTURE_COMMANDS.read_settings as { terminal: { fontSize: number | null } })
    .terminal;
  const 원래 = fileTerminal.fontSize === null ? "" : String(fileTerminal.fontSize);
  await expect(크기).toHaveValue(원래);

  // 터미널 설정을 고치고 **저장하지 않는다**.
  await 크기.fill("16");
  await expect(
    구획(page, "터미널 설정").getByRole("button", 저장),
    "터미널 설정이 고친 것으로 안 읽혔다",
  ).toBeEnabled();

  await 항목(page, "알림").click();
  await expect(page).toHaveURL("/settings/notifications");
  const 알림 = 구획(page, "알림 설정");
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
  expect(one.terminal, "알림 저장에 터미널 초안이 실렸다").toEqual(fileTerminal);
  expect(one.notifications).toEqual({ sound: false });

  // **돌아오면 고친 값이 없다** — 초안은 그 항목 페이지와 함께 내려갔다.
  await 항목(page, "터미널").click();
  await expect(page).toHaveURL("/settings/terminal");
  await expect(크기, "다른 항목으로 갔는데 터미널 초안이 남았다").toHaveValue(원래);
  await expect(구획(page, "터미널 설정").getByRole("button", 저장)).toBeDisabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});
