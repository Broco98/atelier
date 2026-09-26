import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { ARCHIVE, MAISON_LANDING_ROOM, PROJECTS, WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  callsSinceRelease,
  fireEventToAll,
  heldCalls,
  holdCommand,
  installFixtureBackend,
  ipcCallArgs,
  liveSubscriptions,
  releaseCommand,
  unknownIpcCalls,
  workRow,
} from "./harness";

// 티켓 14 — **spec이 바뀌면 work 목록 조회가 한 번만 돈다**(프로세스 결정 18 ① · 프로세스 스펙 판 02 ① · S20).
//
// 에이전트가 spec을 쓸 때마다 감시자가 `works:changed`를 쏜다. 전에는 목록을 쓰는 자리(사이드바 · 사이드바 work 목록 ·
// works 라우트 · 작업 화면 · 프로젝트 상세 · 아카이브 둘)마다 구독이 붙어, 이벤트 한 번에 목록 조회가 작업 화면에서 네 번
// 돌았다 — 워크트리 21개면 `git status`가 84번이다. 이제 앱 루트가 한 번 듣고, 조회 중에 온 이벤트는 끝난 뒤 한 번으로 합친다.
//
// **쏘는 것은 `fireEventToAll`이다.** 실물의 `emit`은 살아 있는 모든 구독에 간다. 마지막 구독 하나에만 쏘는 `fireEvent`로는
// 구독이 다섯이어도 조회가 한 번이라, 1판의 같은 검사는 바꾸기 전에도 초록이었다(스펙 리뷰 코드 8).
//
// 창 포커스 재조회를 끈 것은 여기서 안 잰다 — 까닭은 `works/hooks.test.ts`의 「창 포커스 재조회」 머리말이다.

const EVENT = "works:changed";
const [, plainWork] = WORKS;
const [project] = PROJECTS;
/** 그 프로젝트에서 시작된 work — 프로젝트 상세의 「Works」 목록에 선다(`projects-list.spec.ts`와 같은 짝). */
const projectWork = WORKS.find((work) => work.projects.includes(project.slug))!;
const [shipped] = ARCHIVE;

/**
 * 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 두 프레임을 넘긴다. **「더 없다」를 재기 전에 부른다**
 * (`shell-orphans.spec.ts`의 같은 이름과 같은 까닭).
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * 그 커맨드의 호출 수가 **멎은 값** — 0.3초 동안 그대로면 멎은 것이다. 이벤트를 쏘기 전에 부른다: 화면이 서며 나간 조회가
 * 쏜 뒤에 기록되면 「이벤트 한 번에 몇 번」에 섞인다.
 */
async function steadyCount(page: Page, command: string): Promise<number> {
  let count = await callCount(page, command);
  for (;;) {
    await page.waitForTimeout(300);
    const next = await callCount(page, command);
    if (next === count) return count;
    count = next;
  }
}

/** 작업 화면에 선다 — 사이드바(목록 둘)와 works 라우트 · 작업 화면이 모두 목록을 쓴다. */
async function openWork(page: Page): Promise<void> {
  await page.goto(`/works/${plainWork.slug}`);
  await expect(page.locator('[data-tab="spec"]')).toBeVisible();
  await expect(workRow(page, plainWork.slug)).toBeVisible();
}

/** 이벤트를 살아 있는 모든 구독에 한 번 쏘고, 그 뒤로 새로 나간 그 커맨드의 수를 멎은 값으로 읽는다. */
async function firedCalls(page: Page, command: string): Promise<number> {
  const before = await steadyCount(page, command);
  await fireEventToAll(page, EVENT, null);
  // 앵커: 적어도 한 번은 나갔다 — 아무것도 안 나간 채 「하나다」를 재지 않는다.
  await expect.poll(() => callCount(page, command)).toBeGreaterThan(before);
  await settle(page);
  return (await steadyCount(page, command)) - before;
}

test("작업 화면 · 프로젝트 상세 · 아카이브에 차례로 서도 works:changed의 살아 있는 구독은 매번 하나다", async ({ page }) => {
  await installFixtureBackend(page);
  await openWork(page);
  // StrictMode가 붙였다 뗀 구독의 해제는 늦게 온다 — 수가 멎을 때까지 기다려 잰다(`liveSubscriptions`).
  expect(await liveSubscriptions(page, EVENT), "작업 화면").toBe(1);

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project.slug}`);
  // 앵커: 프로젝트 상세가 목록을 읽어 그렸다. 사이드바 행도 같은 제목이라 `main`으로 좁힌다.
  await expect(page.locator("main").getByRole("button", { name: projectWork.title })).toBeVisible();
  expect(await liveSubscriptions(page, EVENT), "프로젝트 상세").toBe(1);

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL(`/archive/${shipped.slug}`);
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();
  expect(await liveSubscriptions(page, EVENT), "아카이브").toBe(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 계측(판 02): 이벤트 한 번에 도는 `list_works` — 바꾸기 전 4, 뒤 1. 저쪽 세계에 셸이 있으면 2다(S13 — 그 세계의 목록도
// 같은 무효화에서 함께 읽는다).
test("이벤트를 모든 구독에 한 번 쏘면 list_works가 한 번 나간다 — 저쪽 세계를 owner로 가진 셸이 있으면 두 번", async ({
  page,
}) => {
  await installFixtureBackend(page);
  const listsOf = async (mode: string) =>
    (await ipcCallArgs(page, "list_works", "mode")).filter(({ args }) => args.mode === mode).length;

  await openWork(page);
  expect(await firedCalls(page, "list_works")).toBe(1);

  // ── Maison에 셸 하나를 두고 돌아온다(`shell-orphans.spec.ts`의 저쪽 세계 검사와 같은 길) ──
  const modeButton = (label: string) =>
    page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: label, exact: true });
  await modeButton("Maison").click();
  await expect(page).toHaveURL(`/maison/rooms/${MAISON_LANDING_ROOM.slug}`);
  await page.locator('[data-tab="new"]').click();
  await awaitSpawned(page, 1);
  await modeButton("Atelier").click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  await expect(page.locator('[data-tab="spec"]')).toBeVisible();

  const atelierBefore = await listsOf("atelier");
  const maisonBefore = await listsOf("maison");
  expect(await firedCalls(page, "list_works")).toBe(2);
  expect(await listsOf("atelier")).toBe(atelierBefore + 1);
  expect(await listsOf("maison")).toBe(maisonBefore + 1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 아카이브 목록도 같은 문을 탄다 — 아카이브 화면(라우트와 본문이 저마다 목록을 쓴다)에서도 이벤트 한 번에 한 번이다.
test("아카이브 화면에서 이벤트를 모든 구독에 한 번 쏘면 list_archive도 한 번 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  const worksBefore = await steadyCount(page, "list_works");
  expect(await firedCalls(page, "list_archive")).toBe(1);
  // 사이드바의 work 목록도 이 이벤트에 한 번 다시 읽는다.
  expect((await steadyCount(page, "list_works")) - worksBefore).toBe(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **조회 중에 온 이벤트는 표시만 하고 끝난 뒤 한 번 더**(S20). 붙잡아 두어야 「도는 동안」이 러너 속도에 안 매인다.
// 붙잡힌 부름은 놓기 전까지 IPC 기록에 없으므로 놓은 뒤의 수는 `callsSinceRelease`로 센다(하네스 `holdCommand` 머리말).
test("list_works를 붙잡아 둔 채 이벤트를 세 번 쏘고 풀면, 놓은 뒤에 새로 나간 list_works는 한 번이다", async ({ page }) => {
  await installFixtureBackend(page);
  await openWork(page);
  await steadyCount(page, "list_works");

  await holdCommand(page, "list_works");
  for (let n = 0; n < 3; n += 1) await fireEventToAll(page, EVENT, null);
  await expect.poll(() => heldCalls(page, "list_works")).toBeGreaterThan(0);
  await settle(page);
  // 도는 조회를 버리고 새로 부르지 않는다 — 붙잡힌 부름은 첫 이벤트의 하나다.
  expect(await heldCalls(page, "list_works")).toBe(1);

  await releaseCommand(page, "list_works");
  await expect.poll(() => callsSinceRelease(page, "list_works")).toBe(1);
  await settle(page);
  await steadyCount(page, "list_works");
  expect(await callsSinceRelease(page, "list_works")).toBe(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
