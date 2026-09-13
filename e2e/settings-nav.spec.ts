import { expect, test, type Page } from "./evidence";
import { PROJECTS, ROOMS, SEARCH_DESTINATION_QUERY, WORKS } from "./fixtures";
import {
  awaitSpawned,
  fireEvent,
  installFixtureBackend,
  markAttention,
  setWindowFocused,
  stubWindowFocus,
  unknownIpcCalls,
  띠,
} from "./harness";

// 설정에 들어가면 사이드바가 **설정 nav**로 바뀐다(#226 · UI개선 결정 21·22·27 · S17~S19).
//
// 주소 전이와 히스토리 칸 수, 돌아가기 목적지 함수는 라우터 seam이 잰다(`router.test.ts`).
// **이 층이 드는 것은 그 규칙이 화면의 문에 실제로 붙어 있는가**다 — 사이드바가 무엇을 그리고,
// 어느 항목이 켜지고, 「앱으로 돌아가기」를 누르면 어디에 서는가. 사이드바는 마크업 seam에 못
// 서므로(`Sidebar.test.tsx` 머리말) 그리는 것을 보는 층은 여기뿐이다.

const [pinned, plain] = WORKS;
const [, room] = ROOMS;
const [project] = PROJECTS;

const aside = (page: Page) => page.locator("aside");
/** 설정 nav의 버튼 하나. 이름이 본문의 버튼들(「알림에 소리 끔」 등)과 겹치지 않게 사이드바로 좁힌다. */
const 설정항목 = (page: Page, name: "앱으로 돌아가기" | "터미널" | "알림" | "에이전트 훅") =>
  aside(page).getByRole("button", { name, exact: true });
/**
 * 켜져 보이는가. 행의 배경은 이름 버튼이 아니라 **바깥 상자**가 갖는다(`SidebarItem`) — 버튼에서
 * 한 칸 올라가 그 상자의 선택 표시를 본다(사이드바 행 강조를 재는 기존 검사와 같은 수법).
 */
const 켜짐 = (page: Page, name: "터미널" | "알림" | "에이전트 훅") =>
  설정항목(page, name).locator("xpath=..");
const 머리 = (page: Page) => page.locator("main header").first();
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

/** 사이드바 바닥의 `Settings`로 들어간다 — 문 셋 중 사람이 가장 자주 누르는 것. */
async function 설정에들어간다(page: Page) {
  await aside(page).getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL("/settings/terminal");
}

test("설정에 들어가면 첫 항목이 열리고 사이드바가 설정 nav로 바뀐다", async ({ page }) => {
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${plain.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // **없어질 것들이 먼저 서 있는지 센다** — 안 그러면 아래 「없다」가 원래 없던 것으로도 초록이다.
  // 띠는 부르는 셸이 있어야 선다: spec으로 눈을 떼고 창을 뒤로 보낸 채 셸이 부르게 한다.
  await page.locator('[data-tab="spec"]').click();
  await expect(page).not.toHaveURL(/tab=terminal/);
  await setWindowFocused(page, false);
  await markAttention(page, { agent: "claude", event: "Stop" });
  const 모드전환 = page.getByRole("group", { name: "모드 선택" });
  const nav = aside(page).getByRole("button", { name: "Terminal", exact: true });
  const 작업행 = aside(page).getByRole("button", { name: pinned.title, exact: true });
  const 바닥설정 = aside(page).getByRole("button", { name: "Settings", exact: true });
  for (const one of [모드전환, nav, 띠(page), 작업행, 바닥설정]) await expect(one).toHaveCount(1);

  await 설정에들어간다(page);

  await expect(설정항목(page, "앱으로 돌아가기")).toBeVisible();
  for (const name of ["터미널", "알림", "에이전트 훅"] as const) {
    await expect(설정항목(page, name)).toBeVisible();
  }
  for (const one of [모드전환, nav, 띠(page), 작업행, 바닥설정]) await expect(one).toHaveCount(0);

  await expect(켜짐(page, "터미널")).toHaveClass(/selected-row/);
  await expect(켜짐(page, "알림")).not.toHaveClass(/selected-row/);
  await expect(머리(page)).toHaveText(/^Settings\s*\/\s*터미널$/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 치환은 **어느 문으로 와도** 같다 — 주소를 곧장 친 경우도(앱이 그 주소로 다시 뜨는 경우).
test("`/settings`로 곧장 오면 `/settings/terminal`로 치환된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings");
  await expect(page).toHaveURL("/settings/terminal");
  await expect(머리(page)).toHaveText(/^Settings\s*\/\s*터미널$/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("항목을 누르면 주소와 본문이 그 항목으로 바뀌고, 뒤로가기가 앞 항목으로 간다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");
  await expect(page.getByRole("group", { name: "터미널 설정", exact: true })).toBeVisible();

  await 설정항목(page, "알림").click();
  await expect(page).toHaveURL("/settings/notifications");
  await expect(머리(page)).toHaveText(/^Settings\s*\/\s*알림$/);
  // 본문은 **그 항목 하나**다 — 앞 항목의 구획이 함께 서 있으면 한 화면 그대로다.
  await expect(page.getByRole("group", { name: "알림 설정", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "터미널 설정", exact: true })).toHaveCount(0);
  await expect(켜짐(page, "알림")).toHaveClass(/selected-row/);
  await expect(켜짐(page, "터미널")).not.toHaveClass(/selected-row/);

  await 설정항목(page, "에이전트 훅").click();
  await expect(page).toHaveURL("/settings/hooks");
  await expect(page.getByRole("heading", { name: "에이전트 훅", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "알림 설정", exact: true })).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL("/settings/notifications");
  await expect(켜짐(page, "알림")).toHaveClass(/selected-row/);
  await expect(page.getByRole("group", { name: "알림 설정", exact: true })).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// S18 — 설정 안에서 설정으로 가는 문은 무동작이다. 치환이 있으니 문이 그냥 가면 알림을 보던
// 사람이 터미널 설정으로 떠나고 칸이 는다. **두 문을 다 본다**: 가드는 이동 함수 한 자리에
// 있지만, 한 문이 그 함수를 안 지나면 그 문만 샌다.
test("설정 안에서 ⌘,와 팔레트의 Settings는 주소도 히스토리도 안 바꾼다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");
  await 설정항목(page, "알림").click();
  await expect(page).toHaveURL("/settings/notifications");
  const before = await historyLength(page);

  // ⌘,는 네이티브 메뉴가 먹어 `settings:open`으로 온다 — 키를 눌러서는 이 층에서 못 탄다.
  await fireEvent(page, "settings:open", null);
  // **무동작을 재려면 이동이 끝날 틈을 줘야 한다** — 곧장 보면 가려던 이동보다 먼저 봐서 초록이다.
  // 그래서 같은 문이 **밖에서는 실제로 간다**는 것을 이 파일 끝 검사가 함께 세운다.
  await page.waitForTimeout(300);
  await expect(page).toHaveURL("/settings/notifications");
  expect(await historyLength(page)).toBe(before);

  await page.keyboard.press("Meta+k");
  const box = page.getByRole("textbox", { name: "검색어" });
  await expect(box).toBeFocused();
  await box.pressSequentially(SEARCH_DESTINATION_QUERY);
  const row = page.getByRole("option", { name: "Settings", exact: true });
  await expect(row).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "검색 결과" })).toHaveCount(0);

  await page.waitForTimeout(300);
  await expect(page).toHaveURL("/settings/notifications");
  expect(await historyLength(page)).toBe(before);
  await expect(켜짐(page, "알림")).toHaveClass(/selected-row/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 위 무동작의 짝 — 같은 ⌘, 이벤트가 **설정 밖에서는 실제로 연다.** 이것이 없으면 위 검사가
// 「구독이 안 걸려서 아무 일도 없었다」로도 초록이다.
test("설정 밖에서 ⌘,는 설정을 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await fireEvent(page, "settings:open", null);
  await expect(page).toHaveURL("/settings/terminal");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 27 — 항목을 몇 번 옮겼든 **한 번에**, 들어오기 직전에 보던 곳으로.
test.describe("앱으로 돌아가기", () => {
  test("work 탭을 보다 들어가 항목을 두 번 옮겨도 그 work·탭으로 돌아간다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${plain.slug}?tab=terminal`);
    await awaitSpawned(page, 1);

    await 설정에들어간다(page);
    await 설정항목(page, "알림").click();
    await expect(page).toHaveURL("/settings/notifications");
    await 설정항목(page, "에이전트 훅").click();
    await expect(page).toHaveURL("/settings/hooks");

    await 설정항목(page, "앱으로 돌아가기").click();
    await expect(page).toHaveURL(`/works/${plain.slug}?tab=terminal`);
    // 주소만 보면 화면이 안 서도 초록이다 — 탭 줄과 사이드바가 앱의 것으로 되돌아왔다.
    await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
    await expect(page.getByRole("group", { name: "모드 선택" })).toBeVisible();

    // **push다** — 뒤로가기는 설정의 마지막 항목으로 간다(뒤로가기로 나갔다면 앞 항목에 선다).
    await page.goBack();
    await expect(page).toHaveURL("/settings/hooks");

    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("돌아가면 확인할 것 띠가 그대로 있다", async ({ page }) => {
    await stubWindowFocus(page);
    await installFixtureBackend(page);
    await page.goto(`/works/${plain.slug}?tab=terminal`);
    await awaitSpawned(page, 1);
    await page.locator('[data-tab="spec"]').click();
    await expect(page).not.toHaveURL(/tab=terminal/);
    await setWindowFocused(page, false);
    await markAttention(page, { agent: "claude", event: "Stop" });
    await expect(띠(page)).toHaveCount(1);

    await 설정에들어간다(page);
    await expect(띠(page)).toHaveCount(0);
    await 설정항목(page, "알림").click();
    await 설정항목(page, "앱으로 돌아가기").click();

    await expect(page).toHaveURL(`/works/${plain.slug}`);
    await expect(띠(page)).toHaveCount(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("`/terminal`에서 들어갔으면 `/terminal`로 돌아간다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto("/terminal");
    await expect(page.locator(".xterm")).toHaveCount(1);

    await 설정에들어간다(page);
    await 설정항목(page, "알림").click();
    await 설정항목(page, "앱으로 돌아가기").click();
    await expect(page).toHaveURL("/terminal");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("`/projects`에서 들어갔으면 그 주소로 돌아간다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/projects/${project.slug}`);
    await expect(page).toHaveURL(`/projects/${project.slug}`);

    await 설정에들어간다(page);
    await 설정항목(page, "에이전트 훅").click();
    await 설정항목(page, "앱으로 돌아가기").click();
    await expect(page).toHaveURL(`/projects/${project.slug}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Maison에서 들어갔으면 Maison으로 돌아간다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/maison/rooms/${room.slug}`);
    await expect(page).toHaveURL(`/maison/rooms/${room.slug}`);

    await 설정에들어간다(page);
    // 설정에는 세그먼트가 없다 — 떠나온 모드는 돌아가기가 지닌다(CONTEXT.md 「모드」).
    await expect(page.getByRole("group", { name: "모드 선택" })).toHaveCount(0);
    await 설정항목(page, "알림").click();
    await 설정항목(page, "앱으로 돌아가기").click();

    await expect(page).toHaveURL(`/maison/rooms/${room.slug}`);
    await expect(
      page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: "Maison", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 앱을 켜자마자 설정 — 기억할 자리가 없다. 목록 주소로 가고, 거기서 정규화가 고르는 항목은
  // 이 검사가 재지 않는다(그 규칙의 몫은 라우터 seam이다).
  test("기억이 없으면 그 모드의 목록 주소로 간다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto("/settings");
    await expect(page).toHaveURL("/settings/terminal");

    await 설정항목(page, "앱으로 돌아가기").click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/works(\/|$)/);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});
