import { expect, test, type Page } from "./evidence";
import {
  BUSY_SHELL,
  MAISON_LANDING_ROOM,
  NO_METRICS,
  PROCESS_SNAPSHOT,
  shellExitEnded,
  shellKeyOf,
  startupCleaned,
  WORKS,
} from "./fixtures";
import {
  archiveByMcp,
  awaitSpawned,
  cleanupText,
  endedText,
  fireEvent,
  holdCommand,
  HOOKS_TEXT,
  installFixtureBackend,
  ownerlessText,
  processesTitle,
  releaseCommand,
  toastOf,
  toastRegion,
  typeIntoShell,
  unknownIpcCalls,
  시계를세운다,
} from "./harness";

// 프로세스 티켓 32 — **토스트의 [보기]가 `Processes`로 간다**(프로세스 스펙 S15 · P2, 스토리 94 · 101). 시작 정리(티켓 10) · 주인
// 잃은 셸(티켓 12) · 셸 스스로 끝남(티켓 13)의 토스트가 [보기]를 들고, 누르면 토스트가 내려가고 **지금 세계의** `Processes`가
// 열린다. [보기]를 든 토스트는 동작 토스트라 누를 때까지 남는다 — 시작 정리 · 셸 스스로 끝남은 1.6초 뒤 사라지던 짧은 토스트였다.
//
// 가는 주소를 짓는 규칙(세계 · 설정)과 문 하나에 길을 거는 규칙은 L2가 잰다(`processes-view.test.ts`). 여기서 보는 것은 그 문이
// **진짜 라우터**에 걸려 화면이 옮겨 가는가다.

const [, plainWork] = WORKS;

// Maison에서 연다 — 화면은 앱 전체라(프로세스 결정 9) 보러 가려고 세계를 건너지 않는다. 가는 곳이 그 세계의 주소다.
test("시작 정리 토스트의 [보기]를 누르면 토스트가 내려가고 지금 세계의 Processes로 간다", async ({ page }) => {
  await installFixtureBackend(page, { startup_report: startupCleaned(2) });
  await page.goto(`/maison/rooms/${MAISON_LANDING_ROOM.slug}`);
  const toast = toastOf(page, cleanupText(2));
  await expect(toast).toBeVisible();

  await toast.getByRole("button", { name: "보기", exact: true }).click();
  await expect(page).toHaveURL("/maison/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 스스로 끝남 토스트의 [보기]를 누르면 Processes로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(toastRegion(page)).toBeAttached();
  await fireEvent(page, "processes:ended", shellExitEnded(1, 2));
  const toast = toastOf(page, endedText(2));
  await expect(toast).toBeVisible();

  await toast.getByRole("button", { name: "보기", exact: true }).click();
  await expect(page).toHaveURL("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 주인 잃은 셸 토스트는 버튼이 둘이다 — [모두 닫기]가 앞이다(주된 동작). [보기]는 그 셸들이 선 묶음으로 간다.
test("주인 잃은 셸 토스트의 [보기]를 누르면 Processes의 주인 잃은 셸 묶음으로 간다", async ({ page }) => {
  await installFixtureBackend(page, {
    pty_close_checks: { 1: BUSY_SHELL },
    processes_snapshot: {
      ...PROCESS_SNAPSHOT,
      pool: [{ ptyId: 1, shellKey: shellKeyOf(1), lastOutputMs: Date.now(), metrics: NO_METRICS }],
    },
  });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);
  const toast = toastOf(page, ownerlessText(1));
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: /^(모두 닫기|보기)$/ })).toHaveText(["모두 닫기", "보기"]);

  await toast.getByRole("button", { name: "보기", exact: true }).click();
  await expect(page).toHaveURL("/processes");
  await expect(
    page
      .getByRole("region", { name: "주인 잃은 셸", exact: true })
      .locator(`[role="treeitem"][data-shell-key="${shellKeyOf(1)}"]`),
  ).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// [보기]를 든 토스트는 누를 때까지 남는다(P2). 1.6초가 정말 흘렀는지는 같은 흐름에 선 짧은 토스트(훅 맞춤)가 내려가는 것으로 본다 —
// 시계가 토스트의 타이머를 안 움직였으면 그 앵커가 빨갛다. 보고는 붙잡아 두었다가 시계를 멈춘 뒤 놓는다: 저절로 흐르는 시간이 짧은
// 토스트의 1.6초를 미리 깎지 않게(`shell-ownerless.spec.ts`의 같은 수법).
test("[보기]가 붙은 시작 정리 토스트와 셸 스스로 끝남 토스트는 1.6초가 지나도 남는다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, { startup_report: { ...startupCleaned(1), hooksUpdated: ["claude"] } });
  await holdCommand(page, "startup_report");
  await page.goto("/terminal");
  await expect(toastRegion(page)).toBeAttached();
  await 시계를세운다(page);

  await releaseCommand(page, "startup_report");
  const cleanup = toastOf(page, cleanupText(1));
  const hooks = toastOf(page, HOOKS_TEXT);
  await expect(cleanup).toBeVisible();
  await expect(hooks).toBeVisible();
  await fireEvent(page, "processes:ended", shellExitEnded(3, 4));
  const ended = toastOf(page, endedText(4));
  await expect(ended).toBeVisible();

  await page.clock.runFor(2_000);
  await expect(hooks).toBeHidden();
  await expect(cleanup).toBeVisible();
  await expect(ended).toBeVisible();
});

// **[보기]도 막힐 수 있다 — 막히면 토스트가 남는다**(develop 머지 — spec 레이아웃 결정 27과 프로세스 스펙 S15 · P2의 짝). develop의
// spec 레이아웃 편집기는 저장하지 않은 초안을 두고 떠나는 이동을 라우터의 막기로 붙잡고, 앱 토스트는 앱 셸에 서서 설정 화면에도
// 선다. [보기]가 토스트를 **먼저** 내리고 이동을 걸면 [계속 편집]에 막혀도 토스트가 사라진다 — 누를 때까지 남는 동작
// 토스트(P2)라 되살릴 길이 없고, 주인 잃은 셸 토스트는 그 [모두 닫기]까지 함께 잃는다. 그래서 토스트는 **이동이 닿은 순간**
// 내린다(`whenArrived` — ⌘J의 셸 켜기와 같은 문, 칸은 따로다). 편집기 초안과 떠날 때 확인은 `shell-recall.spec.ts`의 같은 손이다.

const EDITOR = "/settings/spec-layout/atelier";
const 떠날때 = (page: Page) => page.getByRole("alertdialog", { name: "저장하지 않은 변경이 있어요", exact: true });
const 창버튼 = (page: Page, name: "계속 편집" | "버리고 나가기") => 떠날때(page).getByRole("button", { name, exact: true });
const 설정항목 = (page: Page, name: "앱으로 돌아가기" | "spec 레이아웃") =>
  page.locator("aside").getByRole("button", { name, exact: true });

/**
 * 앱 안의 길로 spec 레이아웃 편집기에 들어가 저장하지 않은 초안을 하나 만든다. 주소를 직접 치면 페이지가 새로 떠 셸 스토어가
 * 빈다 — 사이드바 바닥의 `Settings`로 들어간다.
 */
async function 편집기에초안(page: Page): Promise<void> {
  await page.locator("aside").getByRole("button", { name: "Settings", exact: true }).click();
  await 설정항목(page, "spec 레이아웃").click();
  await page.getByRole("button", { name: "Atelier 레이아웃 편집", exact: true }).click();
  await expect(page).toHaveURL(EDITOR);
  await page.getByRole("treeitem", { name: "decisions.md", exact: true }).click();
  await page.getByLabel("설명", { exact: true }).fill("정한 것, 그 이유, 버린 안");
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
}

/** 토스트의 [보기]를 누르고 떠날 때 확인에 [계속 편집]으로 답한다 — 편집기에 머문다. */
async function 막힌보기(page: Page, toast: ReturnType<typeof toastOf>): Promise<void> {
  await toast.getByRole("button", { name: "보기", exact: true }).click();
  await expect(떠날때(page)).toBeVisible();
  await 창버튼(page, "계속 편집").click();
  await expect(떠날때(page)).toHaveCount(0);
  await expect(page).toHaveURL(EDITOR);
}

test("편집기에서 주인 잃은 셸 토스트의 [보기]가 떠날 때 확인에 막히면 토스트와 [모두 닫기]가 남는다 — [버리고 나가기]면 가서 내린다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    pty_close_checks: { 1: BUSY_SHELL },
    processes_snapshot: {
      ...PROCESS_SNAPSHOT,
      pool: [{ ptyId: 1, shellKey: shellKeyOf(1), lastOutputMs: Date.now(), metrics: NO_METRICS }],
    },
  });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await 편집기에초안(page);
  // 셸의 claude가 MCP로 그 work을 아카이브한다 — 명령이 도는 셸이 남아 주인 잃은 셸 토스트가 설정 화면에 선다.
  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);
  const toast = toastOf(page, ownerlessText(1));
  await expect(toast).toBeVisible();

  await 막힌보기(page, toast);
  await expect(toast, "막힌 [보기]가 토스트를 내렸다").toBeVisible();
  await expect(toast.getByRole("button", { name: /^(모두 닫기|보기)$/ })).toHaveText(["모두 닫기", "보기"]);

  // 막히지 않으면 — [버리고 나가기] — 이동이 닿은 순간 내린다.
  await toast.getByRole("button", { name: "보기", exact: true }).click();
  await 창버튼(page, "버리고 나가기").click();
  await expect(page).toHaveURL("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 막혀 머문 [보기]는 거둔다 — 뒤에 사람이 다른 길로 `Processes`에 닿아도 그 토스트를 내리지 않는다. 물리친 요청이 되살아나면 사람이
// 누르지 않은 토스트가 사라진다(⌘J가 막힌 요청을 거두는 까닭과 같다 — `announceStay`). 「앱으로 돌아가기」는 설정에 들어오기 전의
// 화면으로 가므로 `Processes`에서 들어오면 막힌 [보기]의 목적지가 곧 다음 닿음이다 — 거두지 않으면 여기서 되살아난다.
test("편집기에서 셸 스스로 끝남 토스트의 [보기]가 막히면 토스트가 남고, 뒤에 「앱으로 돌아가기」로 Processes에 닿아도 그대로다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(toastRegion(page)).toBeAttached();
  await 편집기에초안(page);
  await fireEvent(page, "processes:ended", shellExitEnded(1, 2));
  const toast = toastOf(page, endedText(2));
  await expect(toast).toBeVisible();

  await 막힌보기(page, toast);
  await expect(toast, "막힌 [보기]가 토스트를 내렸다").toBeVisible();

  await 설정항목(page, "앱으로 돌아가기").click();
  await 창버튼(page, "버리고 나가기").click();
  await expect(떠날때(page)).toHaveCount(0);
  await expect(page).toHaveURL("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(toast, "물리친 [보기]가 되살아나 토스트를 내렸다").toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
