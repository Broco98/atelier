import { expect, test, type Page } from "./evidence";
import { PROJECTS, SEARCH_DESTINATION_QUERY, WORKS } from "./fixtures";
import {
  awaitSpawned,
  fireEvent,
  installFixtureBackend,
  markAttention,
  setWindowFocused,
  stubWindowFocus,
  typeIntoShell,
  unknownIpcCalls,
  사람메뉴로간다,
  사람줄,
  검색어칸,
  검색팔레트를연다,
  띠,
  머리카드,
  칠한값,
  토큰값,
  토큰색,
} from "./harness";

// 설정에 들어가면 사이드바가 **설정 nav**로 바뀐다(#226 · UI개선 결정 21·22·27 · S17~S19).
//
// 주소 전이와 히스토리 칸 수, 돌아가기 목적지 함수는 라우터 seam이 잰다(`router.test.ts`).
// **이 층이 드는 것은 그 규칙이 화면의 문에 실제로 붙어 있는가**다 — 사이드바가 무엇을 그리고,
// 어느 항목이 켜지고, 「앱으로 돌아가기」를 누르면 어디에 서는가. 사이드바는 마크업 seam에 못
// 서므로(`Sidebar.test.tsx` 머리말) 그리는 것을 보는 층은 여기뿐이다.

const [pinned, plain] = WORKS;
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
// 위치는 머리 카드가 말한다(codex-ds 스펙 §7 — 「Settings」 · 항목 이름 | 그 쪽의 저장). 글자로 읽으면 이름 · 위치 · 버튼 글자가
// 바로 잇닿는다(아래 정규식의 `\s*`).
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

/** 사람 메뉴의 `Settings`로 들어간다 — 문 셋 중 사람이 가장 자주 누르는 것. 한때 사이드바 바닥의 줄이었다(v1 티켓 07 · S27). */
async function 설정에들어간다(page: Page) {
  await 사람메뉴로간다(page, "Settings");
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
  const nav = aside(page).getByRole("button", { name: "새 Thread", exact: true });
  const 작업행 = aside(page).getByRole("button", { name: pinned.title, exact: true });
  const 사람 = 사람줄(page);
  for (const one of [nav, 띠(page), 작업행, 사람]) await expect(one).toHaveCount(1);

  await 설정에들어간다(page);

  await expect(설정항목(page, "앱으로 돌아가기")).toBeVisible();
  for (const name of ["터미널", "알림", "에이전트 훅"] as const) {
    await expect(설정항목(page, name)).toBeVisible();
  }
  for (const one of [nav, 띠(page), 작업행, 사람]) await expect(one).toHaveCount(0);

  await expect(켜짐(page, "터미널")).toHaveClass(/selected-row/);
  await expect(켜짐(page, "알림")).not.toHaveClass(/selected-row/);
  await expect(머리카드(page)).toHaveText(/^Settings\s*터미널\s*저장$/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 19 — **설정 nav 행은 main nav와 같은 행이다**(`SidebarItem` · DS `SidebarRow`): 32 · `radius-lg` · `nav-row`(14/20
// 500), 켜진 항목은 바탕에 붙은 사이드바의 고른 면 `fill-hover`, 지나는 항목은 `fill-soft`다. 같은 사이드바 자리에 갈아 서는 nav라
// 규격이 갈리면 들어가는 순간 행이 튄다. 값은 토큰에서 읽어 맞댄다.
test("설정 nav 행은 32 · radius-lg · 500이고, 켜진 항목은 fill-hover · 지나는 항목은 fill-soft다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");

  const [고른면, 지나는면] = [await 토큰색(page, "--fill-hover"), await 토큰색(page, "--fill-soft")];
  const 행높이 = await 토큰값(page, "height", "--size-row-nav");
  const 반경 = await 토큰값(page, "border-top-left-radius", "--radius-lg");
  const 면 = async (name: "터미널" | "알림") => (await 칠한값(켜짐(page, name), "background-color"))[0];

  await expect(켜짐(page, "터미널")).toHaveClass(/selected-row/);
  await expect.poll(() => 면("터미널")).toBe(고른면);
  for (const name of ["터미널", "알림"] as const) {
    expect(await 칠한값(켜짐(page, name), "height", "border-top-left-radius"), `${name} 행`).toEqual([행높이, 반경]);
    expect(await 칠한값(설정항목(page, name), "font-size", "font-weight"), `${name} 글자`).toEqual(["14px", "500"]);
  }

  await 설정항목(page, "알림").hover();
  await expect.poll(() => 면("알림")).toBe(지나는면);
  // 켜진 항목은 옆을 지나도 그 면이다.
  expect(await 면("터미널")).toBe(고른면);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 치환은 **어느 문으로 와도** 같다 — 주소를 곧장 친 경우도(앱이 그 주소로 다시 뜨는 경우).
test("`/settings`로 곧장 오면 `/settings/terminal`로 치환된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings");
  await expect(page).toHaveURL("/settings/terminal");
  await expect(머리카드(page)).toHaveText(/^Settings\s*터미널\s*저장$/);
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
  await expect(머리카드(page)).toHaveText(/^Settings\s*알림\s*저장$/);
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

  await 검색팔레트를연다(page);
  await 검색어칸(page).pressSequentially(SEARCH_DESTINATION_QUERY);
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

// 앱을 켜면 늘 새 Thread다(v1 구현 스펙 S26 — 한때는 작업 화면이었다). 앞 판이 남긴 `last-mode`는 읽지도 다시 적지도 않는다
// (ui-refresh 결정 23) — 키 이름을 글자로 적는 것은 그것이 앱이 더는 모르는 옛 키이기 때문이다.
test("앱을 켜면 새 Thread이고, 앞 판이 남긴 `last-mode`를 다시 적지 않는다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("last-mode", "maison"));
  await installFixtureBackend(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible();
  await expect(page).toHaveURL("/");

  // 다른 화면을 지나도 그대로다 — 마지막 자리는 세션 기억이다.
  await 사람메뉴로간다(page, "Terminal");
  await expect(page).toHaveURL("/terminal");
  expect(await page.evaluate(() => localStorage.getItem("last-mode"))).toBe("maison");
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
    await expect(사람줄(page)).toBeVisible();

    // **push다** — 뒤로가기는 설정의 마지막 항목으로 간다(뒤로가기로 나갔다면 앞 항목에 선다).
    await page.goBack();
    await expect(page).toHaveURL("/settings/hooks");

    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("돌아가면 알림 띠가 그대로 있다", async ({ page }) => {
    await stubWindowFocus(page);
    await installFixtureBackend(page);
    await page.goto(`/works/${plain.slug}?tab=terminal`);
    await awaitSpawned(page, 1);
    // 저절로 뜬 셸은 입력 없이 떠나면 닫혀 띠도 함께 내려간다(프로세스 결정 7). 에이전트가 도는 셸은 사람이 친 셸이다.
    await typeIntoShell(page);
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

  // 앱을 켜자마자 설정 — 기억할 자리가 없다. 앱이 늘 열리는 자리(새 Thread, v1 구현 스펙 S26)로 간다.
  test("기억이 없으면 새 Thread로 간다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto("/settings");
    await expect(page).toHaveURL("/settings/terminal");

    await 설정항목(page, "앱으로 돌아가기").click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});
