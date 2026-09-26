import { expect, test, type Page } from "./evidence";
import { ARCHIVE, WORKS } from "./fixtures";
import { callCount, fireEvent, installFixtureBackend, unknownIpcCalls } from "./harness";

// **레이아웃 폴더가 바뀌면 열려 있는 화면이 따라온다**(spec 레이아웃 티켓 09 · 결정 22). 에이전트가
// 레이아웃을 저장하거나 사람이 손으로 고치면 감시자가 `layouts:changed`를 쏘고, 앱 전역의 구독 하나가
// 레이아웃 상태·읽기와 work 목록·아카이브 문서를 함께 무효화한다 — [다시 읽기]를 누를 필요가 없다.
//
// 무엇을 지우는지는 L2가 캐시로 잰다(`features/spec-layout/hooks.test.ts`). **이 층이 드는 것은 그 구독이
// 화면마다 실제로 떠 있는가**다 — 설정 페이지에서도, work 화면에서도, 아카이브에서도 같은 종 하나에 그
// 화면의 명령이 다시 나간다. fixture의 답은 설치 때 한 번 정해지므로 바뀐 트리가 아니라 다시 부른 수로
// 잰다(바뀐 답을 도중에 주는 도우미는 티켓 15가 세운다).
//
// 하네스의 이벤트 쏘기는 그 이벤트의 **마지막** 구독 하나만 부른다(`fireEvent`). 구독이 하나라서 이 세
// 시나리오가 한 구독의 세 효과를 잰다.

const LAYOUTS_CHANGED = "layouts:changed";

/** 종을 치고, 그 명령이 **다시** 나가기를 기다린다 — 앞선 수를 먼저 세어 둔다. */
async function ringAndAwait(page: Page, command: string) {
  await expect.poll(() => callCount(page, command)).toBeGreaterThan(0);
  const before = await callCount(page, command);
  await fireEvent(page, LAYOUTS_CHANGED, null);
  await expect.poll(() => callCount(page, command)).toBeGreaterThan(before);
}

test("설정 「spec 레이아웃」 페이지에서 레이아웃 폴더가 바뀌면 [다시 읽기] 없이 상태를 다시 부른다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(2);

  await ringAndAwait(page, "spec_layout_states");
  await expect(page.locator("main li")).toHaveCount(2);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("work 화면이 열려 있을 때 레이아웃 폴더가 바뀌면 spec 트리를 싣고 오는 work 목록을 다시 부른다", async ({
  page,
}) => {
  const [work] = WORKS;
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}`);
  await expect(page.getByRole("button", { name: "overview.md", exact: true })).toBeVisible();

  await ringAndAwait(page, "list_works");
  // 다시 읽은 목록으로도 트리가 그대로 선다
  await expect(page.getByRole("button", { name: "overview.md", exact: true })).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("아카이브 문서가 열려 있을 때 레이아웃 폴더가 바뀌면 spec 트리를 싣고 오는 문서 목록을 다시 부른다", async ({
  page,
}) => {
  const [shipped] = ARCHIVE;
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  await ringAndAwait(page, "list_archived_docs");
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});
