import { expect, test, type Page } from "./evidence";
import { FIXTURE_GENERATION, MAISON_LANDING_ROOM, NO_METRICS, PROCESS_SNAPSHOT, WORKS } from "./fixtures";
import {
  awaitSpawned,
  fireEvent,
  holdCommand,
  installFixtureBackend,
  releaseCommand,
  replaceAnswer,
  typeIntoShell,
  unknownIpcCalls,
} from "./harness";
import type { StartupReport } from "@/components/shell/startup-report";
import type { ProcessesEnded } from "@/components/shell/processes-ended";

// 프로세스 티켓 32 — **토스트의 [보기]가 `Processes`로 간다**(프로세스 스펙 S15 · P2, 스토리 94 · 101). 시작 정리(티켓 10) · 주인
// 잃은 셸(티켓 12) · 셸 스스로 끝남(티켓 13)의 토스트가 [보기]를 들고, 누르면 토스트가 내려가고 **지금 세계의** `Processes`가
// 열린다. [보기]를 든 토스트는 동작 토스트라 누를 때까지 남는다 — 시작 정리 · 셸 스스로 끝남은 1.6초 뒤 사라지던 짧은 토스트였다.
//
// 가는 주소를 짓는 규칙(세계 · 설정)과 문 하나에 길을 거는 규칙은 L2가 잰다(`processes-view.test.ts`). 여기서 보는 것은 그 문이
// **진짜 라우터**에 걸려 화면이 옮겨 가는가다.

const [, plainWork] = WORKS;

const 키 = (pty: number) => `${FIXTURE_GENERATION}-${pty}`;
const 제목 = (page: Page) => page.getByRole("heading", { name: "Processes", exact: true });
const toastRegion = (page: Page) => page.getByRole("region", { name: "알림", exact: true });
const toastOf = (page: Page, text: string) => toastRegion(page).getByRole("dialog", { name: text, exact: true });

const cleanupText = (count: number) => `지난 실행에서 남은 프로세스 ${count}개를 정리했어요`;
const HOOKS_TEXT = "에이전트 훅을 새 목록으로 맞췄어요";
const endedText = (count: number) => `셸이 끝나면서 그 셸에서 띄운 프로세스 ${count}개를 끝냈어요`;
const orphanText = (count: number) => `아카이브된 작업의 셸 ${count}개에 아직 도는 것이 있어요`;

const cleaned = (count: number): StartupReport => ({
  cleaned: Array.from({ length: count }, (_, i) => ({ pid: 40_000 + i, name: "node" })),
  hooksUpdated: [],
});
const shellExit = (shellId: number, count: number): ProcessesEnded => ({ reason: "shellExit", shellId, count });

// Maison에서 연다 — 화면은 앱 전체라(프로세스 결정 9) 보러 가려고 세계를 건너지 않는다. 가는 곳이 그 세계의 주소다.
test("시작 정리 토스트의 [보기]를 누르면 토스트가 내려가고 지금 세계의 Processes로 간다", async ({ page }) => {
  await installFixtureBackend(page, { startup_report: cleaned(2) });
  await page.goto(`/maison/rooms/${MAISON_LANDING_ROOM.slug}`);
  const toast = toastOf(page, cleanupText(2));
  await expect(toast).toBeVisible();

  await toast.getByRole("button", { name: "보기", exact: true }).click();
  await expect(page).toHaveURL("/maison/processes");
  await expect(제목(page)).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 스스로 끝남 토스트의 [보기]를 누르면 Processes로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(toastRegion(page)).toBeAttached();
  await fireEvent(page, "processes:ended", shellExit(1, 2));
  const toast = toastOf(page, endedText(2));
  await expect(toast).toBeVisible();

  await toast.getByRole("button", { name: "보기", exact: true }).click();
  await expect(page).toHaveURL("/processes");
  await expect(제목(page)).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 주인 잃은 셸 토스트는 버튼이 둘이다 — [모두 닫기]가 앞이다(주된 동작). [보기]는 그 셸들이 선 묶음으로 간다.
test("주인 잃은 셸 토스트의 [보기]를 누르면 Processes의 주인 잃은 셸 묶음으로 간다", async ({ page }) => {
  await installFixtureBackend(page, {
    pty_close_checks: { 1: { command: true, descendants: 0 } },
    processes_snapshot: {
      ...PROCESS_SNAPSHOT,
      pool: [{ ptyId: 1, shellKey: 키(1), lastOutputMs: Date.now(), metrics: NO_METRICS }],
    },
  });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await replaceAnswer(page, "list_works", WORKS.filter((one) => one.slug !== plainWork.slug), "atelier");
  await fireEvent(page, "works:changed", null);
  const toast = toastOf(page, orphanText(1));
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: /^(모두 닫기|보기)$/ })).toHaveText(["모두 닫기", "보기"]);

  await toast.getByRole("button", { name: "보기", exact: true }).click();
  await expect(page).toHaveURL("/processes");
  await expect(
    page
      .getByRole("region", { name: "주인 잃은 셸", exact: true })
      .locator(`[role="treeitem"][data-shell-key="${키(1)}"]`),
  ).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// [보기]를 든 토스트는 누를 때까지 남는다(P2). 1.6초가 정말 흘렀는지는 같은 흐름에 선 짧은 토스트(훅 맞춤)가 내려가는 것으로 본다 —
// 시계가 토스트의 타이머를 안 움직였으면 그 앵커가 빨갛다. 보고는 붙잡아 두었다가 시계를 멈춘 뒤 놓는다: 저절로 흐르는 시간이 짧은
// 토스트의 1.6초를 미리 깎지 않게(`shell-orphans.spec.ts`의 같은 수법).
test("[보기]가 붙은 시작 정리 토스트와 셸 스스로 끝남 토스트는 1.6초가 지나도 남는다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, { startup_report: { ...cleaned(1), hooksUpdated: ["claude"] } });
  await holdCommand(page, "startup_report");
  await page.goto("/terminal");
  await expect(toastRegion(page)).toBeAttached();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));

  await releaseCommand(page, "startup_report");
  const cleanup = toastOf(page, cleanupText(1));
  const hooks = toastOf(page, HOOKS_TEXT);
  await expect(cleanup).toBeVisible();
  await expect(hooks).toBeVisible();
  await fireEvent(page, "processes:ended", shellExit(3, 4));
  const ended = toastOf(page, endedText(4));
  await expect(ended).toBeVisible();

  await page.clock.runFor(2_000);
  await expect(hooks).toBeHidden();
  await expect(cleanup).toBeVisible();
  await expect(ended).toBeVisible();
});
