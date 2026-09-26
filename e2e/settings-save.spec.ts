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

  // 소리는 스위치 하나다(결정 12) — 파일에 알림 구획이 없어 켜진 채로 서 있고, 누르면 꺼진다.
  await 알림.getByRole("switch", { name: "알림에 소리", exact: true }).click();
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

// ── 판 4 — 스위치와 칩 (결정 12 · S16)

// 스토리 104·105 — 알림과 소리는 켬/끔 칩 한 쌍이 아니라 **스위치 하나씩**이다. 켜졌는지를 색이 아니라
// 모양으로 읽고, 스크린리더는 이름과 켬/끔(`aria-checked`)을 말한다. 이름은 스위치 옆 글자다 — 그
// 글자를 눌러도 스위치가 **한 번만** 뒤집힌다(라벨이 숨은 체크박스로 한 번 더 보내면 두 번 뒤집혀
// 제자리로 돌아온다). 키보드로는 스위치에 포커스를 두고 Space다.
test("알림과 소리는 스위치 하나씩이고, 누르면 aria-checked가 뒤집힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/notifications");

  const 알림 = 구획(page, "알림 설정");
  const 켬끔 = 알림.getByRole("switch", { name: "셸이 나를 부르면 알림", exact: true });
  const 소리 = 알림.getByRole("switch", { name: "알림에 소리", exact: true });
  // 파일에 알림 구획이 없다(고정 표) — 안 고른 값은 둘 다 켬이다(결정 10).
  await expect(켬끔).toHaveAttribute("aria-checked", "true");
  await expect(소리).toHaveAttribute("aria-checked", "true");
  await expect(알림.getByRole("switch")).toHaveCount(2);
  // 스위치가 선 뒤에 센다 — 옛 켬/끔 칩이 남아 있으면 여기서 걸린다.
  await expect(알림.getByRole("button", { pressed: true })).toHaveCount(0);

  await 소리.click();
  await expect(소리).toHaveAttribute("aria-checked", "false");
  await expect(켬끔, "옆 스위치가 따라 뒤집혔다").toHaveAttribute("aria-checked", "true");

  await 알림.getByText("알림에 소리", { exact: true }).click();
  await expect(소리, "글자를 눌렀는데 한 번에 안 뒤집혔다").toHaveAttribute("aria-checked", "true");

  await 켬끔.focus();
  await page.keyboard.press("Space");
  await expect(켬끔).toHaveAttribute("aria-checked", "false");
  // 켬끔만 바뀐 채다 — 저장이 열린다.
  await expect(알림.getByRole("button", 저장)).toBeEnabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 97 · S16 — 부품은 켜진 칸을 다시 누르면 값을 비우는데(`[]`), 설정 칩은 그것을 **무시한다**.
// 테마에는 「고르지 않음」이 없어 둘 중 하나가 늘 켜져 있어야 한다. 비운 값을 흘리면 두 칩이 다
// 꺼진 판이 서고, 저장이 열린다. 「아무 일도 없다」는 앵커 뒤에 잰다: 이어 누른 「밝게」가 곧바로 먹는다.
test("켜진 테마 칩을 다시 눌러도 켜진 채고, 옆 칩은 누르면 켜진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");

  const 터미널 = 구획(page, "터미널 설정");
  const 테마 = 터미널.getByRole("group", { name: "테마", exact: true });
  const 어둡게 = 테마.getByRole("button", { name: "어둡게", exact: true });
  const 밝게 = 테마.getByRole("button", { name: "밝게", exact: true });
  // 고정 표의 테마는 어둡게다.
  await expect(어둡게).toHaveAttribute("aria-pressed", "true");

  await 어둡게.click();
  await expect(어둡게, "켜진 칩을 다시 눌렀더니 꺼졌다").toHaveAttribute("aria-pressed", "true");
  await expect(밝게).toHaveAttribute("aria-pressed", "false");

  // 앵커 — 다음 누름은 먹는다.
  await 밝게.click();
  await expect(밝게).toHaveAttribute("aria-pressed", "true");
  await expect(어둡게).toHaveAttribute("aria-pressed", "false");
  await expect(터미널.getByRole("button", 저장)).toBeEnabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 97 — 글꼴 값은 아래 칸 하나가 들고 칩은 지름길이다. 칸에 프리셋 밖의 이름을 적으면 **어느 칩도
// 안 켜진다** — 그룹 값이 빈 것(`[]`)이 그때의 정상 상태다. 그 상태에서도 칩을 누르면 그 칩이 켜지고
// 칸이 그 이름을 받는다.
test("글꼴 칸에 프리셋 밖의 이름을 적으면 어느 칩도 안 켜지고, 칩을 누르면 그 칩이 켜진다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");

  const 터미널 = 구획(page, "터미널 설정");
  const 프리셋 = 터미널.getByRole("group", { name: "글꼴 프리셋", exact: true });
  const 기본 = 프리셋.getByRole("button", { name: "기본", exact: true });
  const 글꼴 = 터미널.getByRole("textbox", { name: "터미널 글꼴", exact: true });
  // 고정 표의 글꼴은 고르지 않음이다.
  await expect(기본).toHaveAttribute("aria-pressed", "true");

  await 글꼴.fill("Fira Code");
  await expect(기본, "프리셋 밖의 이름인데 「기본」이 켜진 채다").toHaveAttribute("aria-pressed", "false");
  await expect(프리셋.getByRole("button", { pressed: true })).toHaveCount(0);

  const menlo = 프리셋.getByRole("button", { name: "Menlo", exact: true });
  await menlo.click();
  await expect(menlo).toHaveAttribute("aria-pressed", "true");
  await expect(글꼴).toHaveValue("Menlo");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 판 4 — 글자칸 (Input · Field)

// 스토리 107·108 — 글꼴 크기 칸은 숫자 스피너가 없는 글자칸이다(`textbox`로 집힌다 — `type="number"`면
// `spinbutton`이다). 틀린 값이면 빨간 테두리와 함께 스크린리더에 「잘못된 값」(`aria-invalid`)으로 읽히고,
// 옆 안내 「px · 8–32」는 그 칸의 설명으로 읽힌다(Field 설명). 「틀렸다」는 맞는 값이 「틀리지 않았다」로 선
// 뒤에 잰다 — 속성을 아예 안 다는 칸도 `true`는 아니므로, 앵커 없이는 무엇도 안 잰다.
test("글꼴 크기 칸에 틀린 값을 넣으면 aria-invalid=true이고, 안내 「px · 8–32」가 그 칸의 설명이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");

  const 크기 = 구획(page, "터미널 설정").getByRole("textbox", { name: "터미널 글꼴 크기", exact: true });
  await expect(크기, "안내가 칸의 설명으로 안 읽힌다").toHaveAccessibleDescription("px · 8–32");

  await 크기.fill("16");
  await expect(크기).not.toHaveAttribute("aria-invalid", "true");

  // 범위 밖 — 저장은 이 값에서 잠긴다(`canSave`). 잠긴 것만으로는 까닭을 못 읽으니 칸이 말한다.
  await 크기.fill("40");
  await expect(크기, "범위 밖 값이 잘못된 값으로 안 읽힌다").toHaveAttribute("aria-invalid", "true");
  // 정수가 아닌 값도 같다.
  await 크기.fill("15.5");
  await expect(크기).toHaveAttribute("aria-invalid", "true");

  // 고치면 풀린다. 비운 칸은 「고르지 않음」이라 틀린 값이 아니다.
  await 크기.fill("");
  await expect(크기, "비운 칸이 잘못된 값으로 읽힌다").not.toHaveAttribute("aria-invalid", "true");

  expect(await unknownIpcCalls(page)).toEqual([]);
});
