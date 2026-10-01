import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { BUSY_SHELL, QUIET_SHELL, WORKS } from "./fixtures";
import type { StartupReport } from "@/components/shell/startup-report";
import {
  archiveByMcp,
  awaitSpawned,
  bodyLines,
  callCount,
  heldCalls,
  holdCommand,
  HOOKS_TEXT,
  installFixtureBackend,
  ipcCallArgs,
  ipcFailure,
  kills,
  markAttention,
  navButton,
  openShell,
  ownerlessText,
  processesTitle,
  releaseCommand,
  toastOf,
  toastsNow,
  typeIntoShell,
  unknownIpcCalls,
  workRow,
  띠,
  셸입력,
} from "./harness";

// 티켓 12 — **MCP로 아카이브 · 삭제된 work의 셸을 앱이 알아서 닫거나 남긴다**(프로세스 결정 4 · 프로세스 스펙 S13 ·
// S14 · S41 · S45).
//
// claude에게 MCP로 work을 아카이브하라고 시키면, 부탁을 보낸 claude는 대개 **그 work의 셸 안에** 있다. 곧바로 닫으면
// 대답하던 claude가 도구 호출 도중 죽는다. 그래서 조용한 셸(명령 없음 + 자손 0)만 닫고, 나머지는 「주인 잃은 셸」로
// 남겨 토스트로 알린다.
//
// **감지는 프런트가 한다** — MCP는 다른 프로세스라 앱은 `works:changed` 뒤의 목록 재조회로만 안다. 그래서 이 층의 흉내는
// 목록 답에서 slug를 빼고(`replaceAnswer`) 그 이벤트를 쏘는 것이다. 조용한지는 닫기 전 배치 물음(`pty_close_checks`,
// 티켓 08)의 답이 정한다 — 그 답은 pty id마다 덮는다.
//
// 목록에서 slug가 빠지면 그 work을 보던 화면은 다른 work으로 옮겨 간다(`-works-view.tsx`의 정규화). 그때 입력 없는
// 자동 셸은 떠남으로 회수된다(프로세스 결정 7) — 그 닫기가 섞이지 않게, 셸은 모두 **사람이 친 셸**(`typeIntoShell`)이거나
// `+`로 연 셸이다. 실물에서 claude가 도는 셸은 사람이 친 셸이다.

const [pinnedWork, plainWork] = WORKS;

/**
 * 그 화면에 **도착했다** — 주소가 아니라 화면으로 잰다. 주소는 이동을 시작하는 순간 바뀌지만 떠나는 work 화면은 도착할
 * 때까지 서 있고, 그 사이 목록이 slug 없이 앉으면 그 화면이 제 주소 정규화로 다른 work으로 옮긴다(`-works-view.tsx`의
 * 「사라졌다」 갈래 — 이 판 전부터 있던 성질이다). 그러면 사람이 가려던 이동을 덮어써, 붐비는 러너에서 이 검사들이
 * 엉뚱한 주소를 보았다(실측). 그래서 MCP 흉내는 도착을 본 **뒤에** 쏜다.
 */
async function arrived(page: Page, spawned: number): Promise<void> {
  // 화면에 들어오면 뜨는 셸이 나갔다 — 새 화면의 터미널 본문이 섰다.
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(spawned);
}

/** [모두 닫기]가 한 번 묻는 창. */
const closeAllDialog = (page: Page) => page.getByRole("alertdialog", { name: "주인 잃은 셸 닫기" });

/**
 * 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 두 프레임을 넘긴다. **「없다」를 재기 전에 부른다**
 * (`startup-report.spec.ts`의 같은 이름과 같은 까닭).
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * work 화면(터미널 탭)에 셸 둘을 세운다: 들어오면 뜨는 셸(pty 1)에 사람이 한 키를 치고, `+`로 하나 더(pty 2) 연다.
 * 둘 다 떠남으로 회수되지 않는 셸이다(머리말).
 */
async function twoShells(page: Page, path: string): Promise<void> {
  await page.goto(`${path}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);
}

test("MCP로 아카이브된 work의 조용한 셸은 「MCP 아카이브」로 닫히고, 조용하지 않은 셸은 남아 토스트가 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, { pty_close_checks: { 1: QUIET_SHELL, 2: BUSY_SHELL } });
  await twoShells(page, `/works/${plainWork.slug}`);

  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);

  // 조용한 셸 하나만 닫는다 — 까닭은 「MCP 아카이브」이고 주인은 그 work이다(정리 기록 · 판 04의 `●`가 이것을 읽는다).
  await expect.poll(() => kills(page)).toEqual([{ id: 1, reason: "mcpArchive", owner: `atelier:${plainWork.slug}` }]);
  const toast = toastOf(page, ownerlessText(1));
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "모두 닫기", exact: true })).toBeVisible();
  // 두 셸을 **한 번에** 물었다(스냅샷 한 장) — 셸마다 따로 묻지 않는다.
  expect((await ipcCallArgs(page, "pty_close_checks", "ids")).map(({ args }) => args.ids)).toEqual([[1, 2]]);
  expect(await callCount(page, "pty_close_check")).toBe(0);
  // 조용하지 않은 셸은 **남는다** — 기다렸다 자동으로 닫지도 않는다(프로세스 결정 4의 기각).
  await settle(page);
  expect(await kills(page)).toHaveLength(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 사람이 누른 닫기(08)는 못 얻은 답을 「안 묻고 닫는다」로 읽는다. 여기는 거꾸로다 — 사람이 누르지 않은 닫기라 모르는
// 것은 닫지 않는다(fail-closed).
test("닫기 전 물음이 거절되면 어느 셸도 닫지 않고 모두 주인 잃은 셸로 알린다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: ipcFailure("PTY 풀을 읽지 못했습니다") });
  await twoShells(page, `/works/${plainWork.slug}`);

  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);

  await expect(toastOf(page, ownerlessText(2))).toBeVisible();
  // 앵커: 물었다 — 안 물어서 안 닫은 것이 아니다.
  expect(await callCount(page, "pty_close_checks")).toBe(1);
  await settle(page);
  expect(await callCount(page, "pty_kill")).toBe(0);
});

test("[모두 닫기]는 한 번만 묻고, 확인하면 주인 잃은 셸마다 「셸 닫기」로 닫고, 취소하면 안 닫는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    pty_close_checks: { 1: { command: true, descendants: 2 }, 2: { command: false, descendants: 1 } },
  });
  await twoShells(page, `/works/${plainWork.slug}`);
  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);
  const toast = toastOf(page, ownerlessText(2));
  await expect(toast).toBeVisible();
  const asked = await callCount(page, "pty_close_checks");

  // ── 취소 ──
  await toast.getByRole("button", { name: "모두 닫기", exact: true }).click();
  const dialog = closeAllDialog(page);
  await expect(dialog).toBeVisible();
  // N은 주인 잃은 셸 수, M은 배치 물음이 준 자손 수의 합이다 — 창을 띄우기 전에 한 번 더 묻는다(지금의 수).
  expect(await bodyLines(dialog)).toEqual(["주인 잃은 셸 2개를 닫아요(띄운 프로세스 3개 포함)."]);
  expect(await callCount(page, "pty_close_checks")).toBe(asked + 1);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await settle(page);
  expect(await callCount(page, "pty_kill")).toBe(0);
  // 취소하면 토스트가 그대로 남는다 — 누를 자리가 사라지면 그 셸들을 닫을 길이 없다.
  await expect(toast).toBeVisible();

  // ── 확인 ──
  await toast.getByRole("button", { name: "모두 닫기", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "모두 닫기", exact: true }).click();
  // 사람이 누른 닫기라 까닭은 「셸 닫기」다 — 「MCP 아카이브」면 판 04의 `●`가 선다(S41).
  const owner = `atelier:${plainWork.slug}`;
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 1, reason: "shellClose", owner },
      { id: 2, reason: "shellClose", owner },
    ]);
  await expect(toast).toBeHidden();
  // 셸마다 닫기 확인 창(08)을 띄우지 않는다 — 셸 하나의 물음이 한 번도 안 나갔다.
  expect(await callCount(page, "pty_close_check")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// UI 길은 성공 뒤에 제 손으로 닫는다(`closeShellsOf`, in-app-terminal 결정 26). 그 사이 목록이 slug 없이 앉아도 감지는 그 slug를 안 본다
// (제외 창, S13). 창이 없으면 아카이브 코어 호출이 돌아오기 전에 앉은 목록이 그 셸을 주인 잃은 셸로 알린다.
test("UI 아카이브 중에는 토스트가 없다 — 그 뒤 MCP 아카이브는 여전히 알린다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: { 1: BUSY_SHELL, 2: BUSY_SHELL } });
  // 고정된 일에 셸 하나(pty 1), 그냥 일에 `+`로 하나(pty 2).
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await page.locator("[data-worklist]").getByRole("button", { name: plainWork.title, exact: true }).click();
  await page.locator('[data-tab="new"]').click();
  await awaitSpawned(page, 1);

  // 아카이브 코어 호출을 붙잡아 「호출이 아직 안 돌아왔다」를 세운다.
  await holdCommand(page, "archive_work");
  await page.getByRole("button", { name: "작업 메뉴", exact: true }).click();
  await page.getByRole("menuitem", { name: "아카이빙", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "아카이빙", exact: true }).click();
  await expect.poll(() => heldCalls(page, "archive_work")).toBe(1);

  // 코어가 옮긴 뒤의 목록이 먼저 앉는다 — 감시자의 이벤트는 호출이 돌아오기 앞뒤 어디에나 올 수 있다.
  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);
  await expect(workRow(page, plainWork.slug)).toHaveCount(0);
  await settle(page);

  await releaseCommand(page, "archive_work");
  // 앵커: 아카이브 코어 호출이 돌아왔고, UI 길이 그 owner의 셸을 제 까닭으로 닫았다.
  await expect.poll(() => kills(page)).toEqual([{ id: 2, reason: "archive", owner: `atelier:${plainWork.slug}` }]);
  await settle(page);
  expect(await toastsNow(page)).toBe(0);

  // 창이 닫힌 뒤의 MCP 아카이브는 알린다 — 감지가 살아 있는데 위에서 안 섰다는 것이 이 줄로 선다.
  await archiveByMcp(page, "atelier", WORKS, plainWork.slug, pinnedWork.slug);
  await expect(toastOf(page, ownerlessText(1))).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 동작 토스트는 누르거나 닫을 때까지 남는다 — 1.6초에 사라지면 [모두 닫기]를 누를 틈이 없다(프로세스 스펙 P2).
//
// **시계는 `page.clock`이다.** 주의 둘:
// - `install()`은 **페이지를 열기 전에** 부른다. 연 뒤에 깔면 이미 걸린 타이머는 진짜 시계로 돈다.
// - `Date.now`도 가짜 시계를 따른다. 셸의 첫 입력 시각 · 경과 표시 · 알림 접기(5초)가 모두 그 시계로 잰다 —
//   깐 뒤로 시간은 저절로 흐르다가 `runFor`만큼 한꺼번에 뛴다.
//
// 1.6초가 정말 흘렀는지는 짧은 토스트 하나로 본다: 시작 보고를 붙잡아 두었다가 놓아 훅 맞춤 토스트(1.6초)를 세우고,
// 같은 `runFor`에 그것이 내려가는 것을 앵커로 삼는다. 시계가 토스트의 타이머를 안 움직였으면 앵커가 빨갛다. (정리 토스트는 판
// 04부터 [보기]를 들어 누를 때까지 남는다 — 티켓 32.)
test("주인 잃은 셸 토스트는 1.6초가 지나도 남는다", async ({ page }) => {
  await page.clock.install();
  const report: StartupReport = { cleaned: [], hooksUpdated: ["claude"] };
  await installFixtureBackend(page, { startup_report: report, pty_close_checks: { 1: BUSY_SHELL } });
  await holdCommand(page, "startup_report");
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);

  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);
  const ownerless = toastOf(page, ownerlessText(1));
  await expect(ownerless).toBeVisible();
  await releaseCommand(page, "startup_report");
  const short = toastOf(page, HOOKS_TEXT);
  await expect(short).toBeVisible();

  await page.clock.runFor(2_000);
  await expect(short).toBeHidden();
  await expect(ownerless).toBeVisible();
});

// 띠의 줄은 누르면 그 work의 터미널로 간다. 주인 잃은 셸의 work은 없다 — **그 work 화면으로 가기 전에** 갈려 `Processes`로
// 간다(프로세스 스펙 S14 · 티켓 32): 그 화면의 주인 잃은 셸 묶음이 그 셸을 든다. 판 01~03에서는 같은 토스트를 다시 띄우고
// 화면은 그대로였다.
//
// **그 셸을 기다리는 포커스도 안 남는다**(구현 기록 16의 남은 것). 셸로 가는 길이 포커스 요청을 주인 잃은 셸 갈림 **앞에** 두면
// 붙을 화면이 없는 셸에 기다림이 남아, 뒤에 간 터미널의 셸이 붙어도 포커스를 못 받는다(`focusOnAttach`의 첫 줄).
test("띠에서 주인 잃은 셸을 누르면 Processes로 간다 — 토스트는 다시 서지 않고, 그 셸을 기다리는 포커스도 안 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page, { pty_close_checks: { 1: BUSY_SHELL } });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  // 부르는 셸 — 보고 있는 채 받아도 띠에 남는 기다림이다(terminal-activity-signal 결정 7). 턴의 끝(`Stop`)은 프로세스 결정 13이 「확인할
  // 것」으로 옮겨, 보고 있는 셸에서는 곧바로 「봤다」가 된다.
  await markAttention(page, {
    agent: "claude",
    event: "Elicitation",
    at: Date.now(),
    payload: { message: "아카이브할까요?" },
  });
  await navButton(page, "Terminal").click();
  await expect(page).toHaveURL("/terminal");
  // 최상위 터미널의 첫 셸(pty 2)이 떴으면 떠나온 work 화면은 내려갔다.
  await arrived(page, 2);

  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);
  const toast = toastOf(page, ownerlessText(1));
  await expect(toast).toBeVisible();
  // `×`는 알림 자리가 펼쳐졌을 때(마우스가 올라가거나 포커스가 들었을 때)만 보조 기술에 드러난다 — Base UI의
  // `Toast.Close`가 그 밖에서는 `aria-hidden`이다. 사람처럼 먼저 올리고 누른다.
  await toast.hover();
  await toast.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(toast).toHaveCount(0);

  // 목록에서 빠진 work의 줄은 제목 대신 slug를 적는다(`titleResolver`).
  await 띠(page).getByRole("button", { name: `${plainWork.slug} — 나를 기다림`, exact: true }).click();
  await expect(page).toHaveURL("/processes");
  await expect(processesTitle(page)).toBeVisible();
  // 토스트를 다시 세우지 않는다 — 갈 화면이 생겼다. 앵커: 화면이 옮겨 갔다(위 두 줄).
  await settle(page);
  expect(await toastsNow(page)).toBe(0);

  // 터미널로 돌아가면 그 화면의 셸(pty 2)이 다시 붙으며 포커스를 받는다 — 주인 잃은 셸을 기다리는 것이 없다.
  await navButton(page, "Terminal").click();
  await expect(page).toHaveURL("/terminal");
  await expect(셸입력(page), "주인 잃은 셸을 기다리는 포커스가 남아 터미널의 셸이 포커스를 못 받았다").toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
