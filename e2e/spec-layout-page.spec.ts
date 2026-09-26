import { expect, test, type Page } from "./evidence";
import { BROKEN_MAISON_LAYOUT, SPEC_LAYOUT_STATES } from "./fixtures";
import { callCount, installFixtureBackend, ipcFailure, unknownIpcCalls } from "./harness";

// 설정의 「spec 레이아웃」 페이지(spec 레이아웃 티켓 08 · 결정 20·23·25).
//
// 행의 모양(내장본 · 고침 · 읽지 못함)은 마크업 seam이 잰다(`SpecLayoutPage.test.tsx`). **이 층이 드는
// 것은 그 페이지가 화면의 문에 붙어 있는가**다 — 설정 nav의 넷째 줄로 들어가면 상태 명령이 실제로
// 나가고, [부탁]이 알림을 세우고, [다시 읽기]가 상태를 다시 부른다. 이 명령을 태우는 시나리오가 여기
// 있어야 fixture 이름 표에서 빠졌을 때 빨개진다(구현 스펙 3절).

const aside = (page: Page) => page.locator("aside");
const 머리 = (page: Page) => page.locator("main header").first();
const 행 = (page: Page, name: "Atelier" | "Maison") =>
  page.locator("main li").filter({ has: page.getByText(name, { exact: true }) });
const 부탁 = (page: Page, name: "Atelier" | "Maison") =>
  page.getByRole("button", { name: `${name} 레이아웃을 에이전트에게 부탁`, exact: true });
const 알림 = (page: Page) => page.getByRole("status").filter({ hasText: "참조를 복사했어요" });

test("설정 nav에서 「spec 레이아웃」을 열면 상태 명령이 나가고 모드 두 행이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");
  await expect(page.getByRole("group", { name: "터미널 설정", exact: true })).toBeVisible();
  expect(await callCount(page, "spec_layout_states")).toBe(0);

  // 넷째 줄은 **맨 뒤**다 — `/settings`는 여전히 첫 항목(터미널)으로 넘긴다.
  const 항목 = aside(page).getByRole("button", { name: "spec 레이아웃", exact: true });
  await 항목.click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await expect(머리(page)).toHaveText(/^Settings\s*\/\s*spec 레이아웃$/);
  await expect(항목.locator("xpath=..")).toHaveClass(/selected-row/);
  await expect.poll(() => callCount(page, "spec_layout_states")).toBeGreaterThan(0);

  await expect(page.locator("main li")).toHaveCount(2);
  const [atelier] = SPEC_LAYOUT_STATES;
  await expect(행(page, "Atelier")).toContainText(`${atelier.folder}/`);
  await expect(행(page, "Atelier")).toContainText(`템플릿 ${atelier.templateCount}개`);
  await expect(행(page, "Maison")).toContainText("내장본 그대로예요");
  // 설정 초안의 저장 버튼을 지나지 않는다. (게이트 밖인지는 아래 시나리오가 잰다 — 이 fixture의
  // `read_settings`는 성공하므로 여기서는 게이트 안이어도 두 행이 선다.)
  await expect(page.getByRole("button", { name: "저장", exact: true })).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **설정 파일 읽기 게이트 밖이다**(티켓 08) — 레이아웃은 `settings.json`에 살지 않으니, 우리 파일이 깨져
// 있다고 레이아웃을 못 볼 이유가 없다. 첫 시나리오에 이 거절을 싣지 않는 것은 그쪽이 먼저 여는 터미널
// 설정이 `read_settings`의 성공을 딛기 때문이다.
test("설정 파일을 읽지 못해도 「spec 레이아웃」의 두 행이 선다 — 설정 파일 읽기 게이트 밖이다", async ({ page }) => {
  await installFixtureBackend(page, { read_settings: ipcFailure("설정 파일을 읽지 못했어요") });
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(2);
  // 게이트였다면 행 대신 그 까닭과 「다시 읽기」가 섰다
  await expect(page.getByText("설정 파일을 읽지 못했어요")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다시 읽기", exact: true })).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L3는 클립보드를 읽지 못한다 — 알림에 적힌 참조로 잰다. 참조는 상태가 준 폴더 경로로 짓는다.
test("[부탁]을 누르면 화면 아래 알림에 그 모드의 레이아웃 참조가 적힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(2);
  await expect(알림(page)).toHaveCount(0);

  // 폴더가 아직 없는 모드에도 같은 모양이다 — 붙여 받은 에이전트의 도구가 내장본을 돌려준다.
  await 부탁(page, "Maison").click();
  await expect(알림(page)).toBeVisible();
  await expect(알림(page)).toContainText("~/.atelier/layouts/maison/");
  await expect(알림(page)).toContainText("앱 터미널의 에이전트에게 붙이고 부탁을 이어 적으세요.");

  await 부탁(page, "Atelier").click();
  await expect(알림(page)).toHaveCount(1);
  await expect(알림(page)).toContainText("~/.atelier/layouts/atelier/");

  await page.getByRole("button", { name: "알림 닫기", exact: true }).click();
  await expect(알림(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("읽지 못한 행은 이유를 보이고, [다시 읽기]가 상태 명령을 다시 부른다", async ({ page }) => {
  await installFixtureBackend(page, {
    spec_layout_states: [SPEC_LAYOUT_STATES[0], BROKEN_MAISON_LAYOUT],
  });
  await page.goto("/settings/spec-layout");

  const maison = 행(page, "Maison");
  await expect(maison).toContainText("읽지 못해 내장본으로 보여 주고 있어요");
  await expect(maison).toContainText(BROKEN_MAISON_LAYOUT.fallback!);
  // 읽지 못하는 행에도 [부탁]이 있다 — 에이전트가 원문과 오류를 읽고 고친다.
  await expect(부탁(page, "Maison")).toBeVisible();

  await expect.poll(() => callCount(page, "spec_layout_states")).toBeGreaterThan(0);
  const before = await callCount(page, "spec_layout_states");
  await page.getByRole("button", { name: "Maison 레이아웃 다시 읽기", exact: true }).click();
  await expect.poll(() => callCount(page, "spec_layout_states")).toBeGreaterThan(before);
  // 읽을 수 있는 행에는 [다시 읽기]가 없다
  await expect(page.getByRole("button", { name: "Atelier 레이아웃 다시 읽기" })).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
