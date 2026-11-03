import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, BUSY_SHELL, QUIET_SHELL, shellKeyOf, WORKS } from "./fixtures";
import {
  archiveByMcp,
  awaitSpawned,
  bodyLines,
  callCount,
  installFixtureBackend,
  ipcCallArgs,
  kills,
  가는곳으로간다,
  openShell,
  ownerlessText,
  processesTitle,
  replaceAnswer,
  toastOf,
  toastRegion,
  toastsNow,
  typeIntoShell,
  unknownIpcCalls,
  셸셋을띄운다,
  시계를세운다,
} from "./harness";
import { loggedAt } from "@/features/processes/cleanup-log";
import { poolShell, processRow, snapshotFixture } from "@/features/processes/process-fixture";
import type { CleanupEvent, ProcessSnapshot } from "@/features/processes/types";

// 프로세스 티켓 32 — **`Processes`에서 주인 잃은 셸 · 화면 밖 셸 · 정리 기록을 보고 쌓인 셸을 치운다**(프로세스 결정 4 · 6 · 9 ·
// 프로세스 스펙 S12 · S42 · S44 · P1, 스토리 89 · 90 · 94 · 96 · 97).
//
// 무엇이 주인 잃은 셸 · 화면 밖 셸 · 조용한 셸인지, 기록 한 줄을 어떤 말로 적는지는 L2가 표로 잰다(`shell-tree.test.ts` ·
// `shell-registry.test.ts` · `cleanup-log.test.ts`). 여기서 보는 것은 그 판정이 **진짜 스토어(진짜로 띄운 셸) · 진짜 스냅샷 폴러 ·
// 진짜 확인 창**을 지나 화면에 서고 닫기 IPC에 실리는가다 — 스토어는 xterm을 들여 노드 seam에 없다.
//
// 셸 키는 픽스처의 spawn 답이 `l3-<pty 번호>`로 준다. 스냅샷 픽스처의 풀이 그 키를 실으면 화면이 스토어의 셸과 잇는다.

const [, plainWork] = WORKS;

const 묶음 = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const 셸트리 = (page: Page) => page.getByRole("tree", { name: "셸", exact: true });
const 셸줄 = (scope: Locator, pty: number) => scope.locator(`[role="treeitem"][data-shell-key="${shellKeyOf(pty)}"]`);
const 버튼 = (scope: Locator, name: string) => scope.getByRole("button", { name, exact: true });
/**
 * 몸의 머리 — 화면 이름(h1) · 잰 시각 · [조용한 셸 모두 닫기](restart 03-11 · 시안 Processes `.pr-head`). 한때 [조용한 셸 모두 닫기]는 틀의 머리
 * 줄(`화면머리`)의 할 일이었다 — 지금 틀의 머리 줄에는 이름만 선다. 그 줄은 h1의 부모다 — `<header>`가 아니다(창의 머리는 머리 줄 하나 —
 * ui-refresh 결정 5, restart 02a-15b. 한때 몸 머리가 `<header>`라 그것으로 집었다).
 */
const 몸머리 = (page: Page) =>
  page.getByRole("main", { name: "Processes", exact: true }).getByRole("heading", { name: "Processes", level: 1 }).locator("..");

/** 한 묶음의 줄들 — 깊이와 접근성 이름. 화면에 선 차례 그대로다. */
async function 줄들(scope: Locator): Promise<Array<{ level: string | null; name: string | null }>> {
  return scope
    .getByRole("treeitem")
    .evaluateAll((rows) => rows.map((row) => ({ level: row.getAttribute("aria-level"), name: row.getAttribute("aria-label") })));
}

const vite = processRow(200, 1, 2_000, "node", { argv0: "node", command: "node vite --port 5173" });

/** 풀에 `ptys`의 셸이 앉은 스냅샷 — 마지막 출력은 두 시간 전이다(조용한 셸의 경과가 「2h」로 선다). `tree`의 셸 밑에는 vite가 있다. */
function 스냅샷(ptys: number[], tree: number | null = null): ProcessSnapshot {
  const lastOutputMs = Date.now() - 2 * 3_600_000;
  return snapshotFixture({
    verdict: { descendants: tree === null ? {} : { [shellKeyOf(tree)]: [vite] } },
    pool: ptys.map((pty) => poolShell(pty, shellKeyOf(pty), lastOutputMs)),
  });
}

/** 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 두 프레임을 넘긴다. **「없다」를 재기 전에 부른다.** */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * 멈춘 시계를 스냅샷 박자가 한 번 지날 때까지 조금씩 흘린다 — 돌아오면 박자 바로 뒤다. 흘리는 동안 react-query가 0ms 타이머로 미룬
 * 알림도 풀린다(`processes-summary.spec.ts`의 `박자직후`와 같은 수법).
 */
async function 다음박자(page: Page): Promise<void> {
  const before = await callCount(page, "processes_snapshot");
  for (let step = 0; step < 20 && (await callCount(page, "processes_snapshot")) === before; step += 1) {
    await page.clock.runFor(250);
  }
  expect(await callCount(page, "processes_snapshot"), "5초 넘게 스냅샷 박자가 안 왔다").toBeGreaterThan(before);
}

test("주인 잃은 셸이 제 묶음에 서고, [모두 닫기]가 한 번 묻고 셸마다 「셸 닫기」로 닫는다 — 취소하면 안 닫는다", async ({ page }) => {
  await installFixtureBackend(page, {
    // 둘 다 조용하지 않다 — MCP 아카이브가 닫지 않고 주인 잃은 셸로 남긴다. 자손 수(2 + 1)가 창의 M이다.
    pty_close_checks: { 1: { command: true, descendants: 2 }, 2: { command: false, descendants: 1 } },
    processes_snapshot: 스냅샷([1, 2, 3], 1),
  });
  // `그냥 일`에 셸 둘(pty 1 · 2) — 사람이 친 셸과 `+`로 연 셸이다(떠남으로 회수되지 않는다).
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);
  await archiveByMcp(page, WORKS, plainWork.slug);
  await expect.poll(() => callCount(page, "pty_close_checks")).toBe(1);

  // 주인이 있는 셸 하나(`Terminal`, pty 3) — 셸 트리의 앵커다.
  await 가는곳으로간다(page, "Terminal");
  await expect(page).toHaveURL("/terminal");
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(3);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);

  await 가는곳으로간다(page, "Processes");
  await expect(page).toHaveURL("/processes");
  const ownerless = 묶음(page, "주인 잃은 셸");
  await expect(ownerless).toBeVisible();
  // work마다 선다 — 목록에 없는 work이라 이름은 slug다. 셸 트리의 work 줄과 같은 말이다(이름과 셸 수).
  expect(await 줄들(ownerless)).toEqual([
    { level: "1", name: `${plainWork.slug}, 셸 2개` },
    { level: "2", name: "zsh, 띄운 프로세스 1개" },
    { level: "3", name: "node" },
    { level: "2", name: "zsh, 조용함 2h" },
  ]);
  // 셸 트리에는 안 선다 — 한 셸이 두 묶음에 서면 [닫기] 자리가 둘이다. 앵커: 주인이 있는 셸은 거기 섰다.
  await expect(셸줄(셸트리(page), 3)).toBeVisible();
  await expect(셸줄(셸트리(page), 1)).toHaveCount(0);
  await expect(셸줄(셸트리(page), 2)).toHaveCount(0);
  // [이동]이 없다 — 그 work은 목록에 없어 갈 화면이 없다. 앵커: 셸 트리의 셸 줄에는 있다.
  await expect(버튼(셸줄(셸트리(page), 3), "이동")).toBeVisible();
  await expect(버튼(ownerless, "이동")).toHaveCount(0);
  const asked = await callCount(page, "pty_close_checks");

  // ── 취소 ──
  await 버튼(ownerless, "모두 닫기").click();
  const dialog = page.getByRole("alertdialog", { name: "주인 잃은 셸 닫기" });
  await expect(dialog).toBeVisible();
  // 토스트의 [모두 닫기](티켓 12)와 같은 말이다 — 창을 띄우기 전에 배치 물음 한 번으로 지금의 수를 센다.
  expect(await bodyLines(dialog)).toEqual(["주인 잃은 셸 2개를 닫아요(띄운 프로세스 3개 포함)."]);
  expect((await ipcCallArgs(page, "pty_close_checks", "ids")).slice(asked).map(({ args }) => args.ids)).toEqual([[1, 2]]);
  await 버튼(dialog, "취소").click();
  await expect(dialog).toHaveCount(0);
  await settle(page);
  expect(await callCount(page, "pty_kill")).toBe(0);
  await expect(ownerless).toBeVisible();
  // 같은 셸의 토스트(티켓 12)도 그대로 섰다 — 아래 「내려간다」의 앵커다. 안 섰으면 그 단언은 처음부터 참이다.
  await expect(toastOf(page, ownerlessText(2))).toBeVisible();

  // ── 확인 ──
  await 버튼(ownerless, "모두 닫기").click();
  await expect(dialog).toBeVisible();
  await 버튼(dialog, "모두 닫기").click();
  // 사람이 누른 닫기라 까닭은 「셸 닫기」다 — 「MCP 아카이브」면 정리 기록이 까닭을 거짓으로 적는다.
  const owner = plainWork.slug;
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 1, reason: "shellClose", owner },
      { id: 2, reason: "shellClose", owner },
    ]);
  await expect(ownerless).toHaveCount(0);
  // 같은 셸의 토스트도 내려간다 — 같은 함수다. 셸마다 닫기 확인 창(08)을 안 띄웠다.
  await expect(toastRegion(page).getByRole("dialog")).toHaveCount(0);
  expect(await callCount(page, "pty_close_check")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **주인 잃은 셸 토스트의 N은 셸이 닫히면 따라온다**(구현 기록 12 · 32의 남은 것). 그 토스트는 동작 토스트라 사람이 닫을 때까지
// 남는데, 한때 N은 세울 때만 지어져 `Processes`에서 하나씩 닫아도 「셸 3개에 아직 도는 것이 있어요」로 남았다. 고치는 길은
// **고치기만** 한다 — 사람이 [×]로 닫은 토스트는 셸이 더 닫혀도 다시 안 선다.
test("Processes에서 주인 잃은 셸을 하나 닫으면 토스트의 수가 줄고, 토스트를 닫은 뒤에는 한 줄을 더 닫아도 토스트가 돌아오지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    // 셋 다 조용하지 않다 — MCP 아카이브가 모두 주인 잃은 셸로 남긴다. 한 줄 닫기의 물음은 조용하다 — 창 없이 닫는다.
    pty_close_checks: { 1: BUSY_SHELL, 2: BUSY_SHELL, 3: BUSY_SHELL },
    pty_close_check: QUIET_SHELL,
    processes_snapshot: 스냅샷([1, 2, 3]),
  });
  // `그냥 일`에 셸 셋(pty 1 · 2 · 3) — 사람이 친 셸과 `+`로 연 셸 둘이다(떠남으로 회수되지 않는다).
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);
  await openShell(page);
  await archiveByMcp(page, WORKS, plainWork.slug);
  const 토스트 = (n: number) => toastOf(page, ownerlessText(n));
  await expect(토스트(3)).toBeVisible();

  await 가는곳으로간다(page, "Processes");
  await expect(page).toHaveURL("/processes");
  const ownerless = 묶음(page, "주인 잃은 셸");
  await expect(셸줄(ownerless, 1)).toBeVisible();

  // ── 한 줄 닫기 — 토스트의 수가 준다 ──
  await 버튼(셸줄(ownerless, 1), "닫기").click();
  const owner = plainWork.slug;
  await expect.poll(() => kills(page)).toEqual([{ id: 1, reason: "shellClose", owner }]);
  await expect(토스트(2)).toBeVisible();
  await expect(토스트(3)).toHaveCount(0);

  // ── 사람이 토스트를 닫은 뒤 — 한 줄을 더 닫아도 안 돌아온다 ──
  // `×`는 알림 자리가 펼쳐졌을 때만 보조 기술에 드러난다(`shell-ownerless.spec.ts`의 같은 손) — 먼저 올리고 누른다.
  await 토스트(2).hover();
  await 토스트(2).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(toastRegion(page).getByRole("dialog")).toHaveCount(0);

  await 버튼(셸줄(ownerless, 2), "닫기").click();
  // 앵커 — 닫았다.
  await expect.poll(() => kills(page)).toHaveLength(2);
  await expect(셸줄(ownerless, 2)).toHaveCount(0);
  await settle(page);
  expect(await toastsNow(page), "사람이 닫은 주인 잃은 셸 토스트가 다시 섰다").toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 화면 밖 셸(S42)은 **두 스냅샷에 연달아** 선 셸만이다 — 방금 뜬 셸이 spawn 답 전에 찍힌 한 장에 스토어가 모르는 셸로 선다. 박자는
// `page.clock`으로 넘긴다(`processes.spec.ts` 머리말의 두 주의): 깐 뒤 멈추고, 한 박자씩 흘린다.
test("스토어가 모르는 풀의 셸이 두 스냅샷 연달아 서면 화면 밖 셸로 서고, [닫기]가 그 pty id로 셸 탭의 × 규칙대로 닫는다", async ({
  page,
}) => {
  await page.clock.install();
  await installFixtureBackend(page, {
    processes_snapshot: 스냅샷([7], 7),
    // 셸 하나씩 묻는다(셸 탭의 ×와 같다) — 7은 띄운 프로세스가 있어 묻고, 9는 조용해 안 묻는다.
    pty_close_check: answerByArg("id", { 7: { command: false, descendants: 1 }, 9: QUIET_SHELL }),
  });
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect.poll(() => callCount(page, "processes_snapshot")).toBeGreaterThan(0);
  await 시계를세운다(page);

  const offscreen = 묶음(page, "화면 밖 셸");
  await 다음박자(page);
  await expect(셸줄(offscreen, 7)).toBeVisible();
  // 이름은 모른다 — 「셸」과 상태(사람이 띄운 것의 수)다. 그 셸의 자손도 선다.
  expect(await 줄들(offscreen)).toEqual([
    { level: "1", name: "셸, 띄운 프로세스 1개" },
    { level: "2", name: "node" },
  ]);
  // 주인 잃은 셸이 아니다 — owner가 살아 있을 수 있다. 앵커: 화면 밖 셸로는 섰다.
  await expect(묶음(page, "주인 잃은 셸")).toHaveCount(0);

  // ── 한 스냅샷에만 선 셸은 아니다 ── 9가 새로 풀에 앉는다. 첫 박자에는 안 서고, 다음 박자에 선다.
  await replaceAnswer(page, "processes_snapshot", 스냅샷([7, 9], 7));
  await 다음박자(page);
  await expect(셸줄(page.locator("body"), 9)).toHaveCount(0);
  // 앵커: 이 박자에도 7은 서 있다 — 묶음이 통째로 안 그려진 것이 아니다.
  await expect(셸줄(offscreen, 7)).toBeVisible();
  await 다음박자(page);
  await expect(셸줄(offscreen, 9)).toBeVisible();

  // ── [닫기]: 묻는 셸 ── 창은 셸 탭의 ×와 같다. 취소하면 안 닫는다.
  await 버튼(셸줄(offscreen, 7), "닫기").click();
  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog).toBeVisible();
  expect(await bodyLines(dialog)).toEqual(["이 셸에서 띄운 프로세스 1개가 아직 돌아요. 닫을까요?"]);
  await 버튼(dialog, "취소").click();
  // 시계가 멈춰 있어 프레임을 기다리는 `settle`은 못 쓴다 — 시계를 조금 흘려 미룬 일을 풀고 센다. 창이 걷히는 것도 이 뒤다:
  // 확인 창(Base UI AlertDialog)의 나가는 애니메이션은 프레임을 타고(`시계를세운다` 머리말), 다 걷히기 전의 막은 누르기를 가로챈다.
  await page.clock.runFor(100);
  await expect(dialog).toHaveCount(0);
  expect(await callCount(page, "pty_kill")).toBe(0);
  // 취소한 셸은 그대로 선다.
  await expect(셸줄(offscreen, 7)).toBeVisible();
  await 버튼(셸줄(offscreen, 7), "닫기").click();
  await 버튼(dialog, "닫기").click();
  // 스냅샷의 pty id로 닫는다. 까닭은 「셸 닫기」, 주인은 없다 — 스토어의 칸이 없어 모른다.
  await expect.poll(() => kills(page)).toEqual([{ id: 7, reason: "shellClose", owner: null }]);
  await page.clock.runFor(100);
  await expect(dialog).toHaveCount(0);
  // **닫은 줄은 곧바로 빠진다** — 스냅샷은 다음 박자까지 앞 장이라 풀에 7이 남아 있다(시계가 멈춰 박자가 안 왔다). 앵커: 9는 선다.
  await expect(셸줄(offscreen, 7)).toHaveCount(0);
  await expect(셸줄(offscreen, 9)).toBeVisible();

  // ── [닫기]: 조용한 셸 ── 묻지 않고 닫는다.
  await 버튼(셸줄(offscreen, 9), "닫기").click();
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 7, reason: "shellClose", owner: null },
      { id: 9, reason: "shellClose", owner: null },
    ]);
  await expect(dialog).toHaveCount(0);
  expect((await ipcCallArgs(page, "pty_close_check", "id")).map(({ args }) => args.id)).toEqual([7, 7, 9]);
  await expect(offscreen).toHaveCount(0);

  // 풀에서 빠진 뒤의 박자에도 안 선다 — 닫은 것을 잊어도(풀에 없으니) 다시 설 셸이 없다.
  await replaceAnswer(page, "processes_snapshot", 스냅샷([]));
  await 다음박자(page);
  await 다음박자(page);
  await expect(offscreen).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **이 화면에서 닫은 셸은 화면 밖 셸이 아니다**(리뷰 반영). 닫기는 스토어에서 칸을 곧바로 빼는데 스냅샷은 다음 박자까지 앞 장이라
// 그 셸이 풀에 남는다 — 「지금 스토어가 모름 + 두 스냅샷에 섬」만 보면 방금 닫은 셸이 0~2초 「화면 밖 셸」로 선다. 앞 박자에 스토어가
// 알던 셸은 두 박자 연달아 스토어가 모른 셸이 아니다. 닫는 길 셋(셸 행의 [닫기] · [조용한 셸 모두 닫기] · 주인 잃은 셸 [모두
// 닫기])을 박자를 멈춘 채 차례로 잰다 — 스냅샷이 안 바뀌어야 그 창이 드러난다.
test("Processes에서 닫은 셸은 다음 스냅샷이 오기 전에도 화면 밖 셸로 서지 않는다 — [닫기] · [조용한 셸 모두 닫기] · [모두 닫기]", async ({
  page,
}) => {
  await page.clock.install();
  await installFixtureBackend(page, {
    // 99는 스토어가 모르는 셸이다 — 화면 밖 셸 묶음이 서 있다는 앵커. 1 · 2 · 3은 스토어가 아는 셸이다.
    processes_snapshot: 스냅샷([1, 2, 3, 99]),
    // 1은 조용하지 않아 MCP 아카이브가 주인 잃은 셸로 남긴다. 3은 조용하다 — [조용한 셸 모두 닫기]가 닫는다.
    pty_close_checks: { 1: BUSY_SHELL, 3: QUIET_SHELL },
    // 2는 조용하다 — 셸 행의 [닫기]가 묻지 않고 닫는다.
    pty_close_check: answerByArg("id", { 2: QUIET_SHELL }),
  });
  // `그냥 일`에 셸 하나(pty 1)를 두고 MCP가 그 work을 아카이브한다 — 주인 잃은 셸이다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await archiveByMcp(page, WORKS, plainWork.slug);
  await expect.poll(() => callCount(page, "pty_close_checks")).toBe(1);
  // `Terminal`에 셸 둘(pty 2 · 3) — 사람이 친 셸과 `+`로 연 셸이다.
  await 가는곳으로간다(page, "Terminal");
  await expect(page).toHaveURL("/terminal");
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(2);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);

  await 가는곳으로간다(page, "Processes");
  await expect(page).toHaveURL("/processes");
  await expect(셸줄(셸트리(page), 3)).toBeVisible();
  await expect.poll(() => callCount(page, "processes_snapshot")).toBeGreaterThan(0);
  await 시계를세운다(page);
  // 두 박자 — 스토어가 모르는 99가 화면 밖 셸로 선다.
  const offscreen = 묶음(page, "화면 밖 셸");
  await 다음박자(page);
  await expect(셸줄(offscreen, 99)).toBeVisible();
  const ownerless = 묶음(page, "주인 잃은 셸");
  await expect(셸줄(ownerless, 1)).toBeVisible();

  // ── 셸 행의 [닫기] ── 2는 조용해 묻지 않고 닫힌다. 스냅샷은 그대로라 풀에 2가 남아 있다.
  await 버튼(셸줄(셸트리(page), 2), "닫기").click();
  await expect.poll(() => kills(page)).toEqual([{ id: 2, reason: "shellClose", owner: "" }]);
  // 앵커: 스토어에서 빠진 뒤의 화면이다 — 같은 렌더가 화면 밖 셸도 가른다.
  await expect(셸줄(셸트리(page), 2)).toHaveCount(0);
  await expect(셸줄(offscreen, 2)).toHaveCount(0);
  await expect(셸줄(offscreen, 99)).toBeVisible();

  // ── [조용한 셸 모두 닫기] ── 살아 있는 셸 1 · 3 중 조용한 3만 닫는다.
  await 버튼(몸머리(page), "조용한 셸 모두 닫기").click();
  const quiet = page.getByRole("alertdialog", { name: "조용한 셸 닫기" });
  await expect(quiet).toBeVisible();
  await 버튼(quiet, "모두 닫기").click();
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 2, reason: "shellClose", owner: "" },
      { id: 3, reason: "shellClose", owner: "" },
    ]);
  // 확인 창의 나가는 애니메이션은 프레임을 탄다 — 멈춘 시계를 조금 흘려 창을 걷는다(다 걷히기 전의 막은 다음 누르기를 가로챈다).
  // 100ms는 박자(2초)에 한참 못 미친다 — 스냅샷은 그대로다.
  await page.clock.runFor(100);
  await expect(quiet).toHaveCount(0);
  await expect(셸줄(셸트리(page), 3)).toHaveCount(0);
  await expect(셸줄(offscreen, 3)).toHaveCount(0);
  await expect(셸줄(offscreen, 99)).toBeVisible();

  // ── 주인 잃은 셸 [모두 닫기] ──
  await 버튼(ownerless, "모두 닫기").click();
  const ownerlessDialog = page.getByRole("alertdialog", { name: "주인 잃은 셸 닫기" });
  await expect(ownerlessDialog).toBeVisible();
  await 버튼(ownerlessDialog, "모두 닫기").click();
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 2, reason: "shellClose", owner: "" },
      { id: 3, reason: "shellClose", owner: "" },
      { id: 1, reason: "shellClose", owner: plainWork.slug },
    ]);
  await page.clock.runFor(100);
  await expect(ownerlessDialog).toHaveCount(0);
  await expect(ownerless).toHaveCount(0);
  await expect(셸줄(offscreen, 1)).toHaveCount(0);
  await expect(셸줄(offscreen, 99)).toBeVisible();

  // ── 다음 박자 ── 닫힌 셸은 풀에서 빠졌다(Rust의 `kill`이 풀에서 먼저 뺀다). 화면 밖 셸은 99 하나다.
  await replaceAnswer(page, "processes_snapshot", 스냅샷([99]));
  await 다음박자(page);
  await expect
    .poll(() =>
      offscreen
        .locator('[role="treeitem"][data-shell-key]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-shell-key"))),
    )
    .toEqual([shellKeyOf(99)]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 기록 셋 — Rust가 새것부터 준다(`processes_cleanup_log`). 때는 끝내기가 끝난 시각이다.
const 기록: CleanupEvent[] = [
  {
    id: 3,
    at: new Date(2026, 8, 27, 14, 3).getTime(),
    reason: "shellExit",
    shellKey: shellKeyOf(5),
    owner: null,
    targets: [{ pid: 700, name: "node", command: "node vite --port 5173", outcome: "ended" }],
  },
  {
    id: 2,
    at: new Date(2026, 8, 27, 9, 30).getTime(),
    reason: "startupCleanup",
    shellKey: null,
    owner: null,
    targets: [
      { pid: 600, name: "python3", command: null, outcome: "forced" },
      { pid: 601, name: "ruby", command: "ruby server.rb --port 4000", outcome: "survived" },
    ],
  },
  {
    id: 1,
    at: new Date(2026, 8, 26, 22, 0).getTime(),
    reason: "shellClose",
    shellKey: shellKeyOf(2),
    owner: plainWork.slug,
    targets: [{ pid: 500, name: "esbuild", command: "esbuild --service", outcome: "gone" }],
  },
];

// 정리 기록의 줄은 **대상마다 한 줄**이다(restart 03-15d · 시안 Processes `.pr-logrow`) — 때 · 까닭 · 대상 · 결과(못 끝냄은 경고 잉크)의 칸이고,
// 기록은 사건 단위로 와서 화면이 편다. 줄은 누르지 않는다 — 셰브론도 펼침도 없다(한때 사건마다 한 줄이고 펼치면 대상과 명령줄이 섰다).
// 구획 머리의 수는 줄의 수 「N건」이다(시안이 줄을 센다).
test("정리 기록이 최근 것부터 대상마다 한 줄로 때 · 까닭 · 대상 · 결과를 세우고, 줄은 누르지 않는다", async ({ page }) => {
  await installFixtureBackend(page, { processes_cleanup_log: 기록 });
  await page.goto("/processes");
  const log = 묶음(page, "정리 기록");
  await expect(log).toBeVisible();
  // 사건 셋 · 대상 넷 — 줄의 수다.
  await expect(log.getByText("4건", { exact: true })).toBeVisible();
  // 구획은 접혀 연다 — 참고용이다(ui-refresh 결정 28). 머리와 수는 서고 줄은 안 그려진다. 머리를 눌러 편다.
  const 머리 = 버튼(log, "정리 기록");
  await expect(머리).toHaveAttribute("aria-expanded", "false");
  const 목록 = log.getByRole("list", { name: "정리 기록", exact: true });
  await expect(목록).toHaveCount(0);
  await 머리.click();
  await expect(머리).toHaveAttribute("aria-expanded", "true");

  // 차례가 기록의 차례다 — 사건은 새것부터, 사건 안은 대상의 차례. 두 대상의 시작 정리는 같은 때 · 까닭의 두 줄이다.
  const 줄들 = 목록.getByRole("listitem");
  await expect(줄들).toHaveText([
    `${loggedAt(기록[0].at)}셸 스스로 끝남node끝남`,
    `${loggedAt(기록[1].at)}시작 정리python3강제로 끝남`,
    `${loggedAt(기록[1].at)}시작 정리ruby못 끝냄`,
    `${loggedAt(기록[2].at)}셸 닫기esbuild이미 없음`,
  ]);
  // 못 끝냄은 그 대상의 줄만 경고 잉크다. 앵커: 같은 사건의 다른 대상(python3)은 그 잉크가 아니다.
  await expect(줄들.nth(2).locator('[data-outcome="bad"]')).toHaveText("못 끝냄");
  await expect(log.locator('[data-outcome="bad"]')).toHaveCount(1);
  // 줄은 누르지 않는다 — 목록 안에 버튼 · 셰브론이 없고, 명령줄은 화면에 서지 않는다(기록에는 남는다). 앵커: 줄은 섰다(위).
  await expect(목록.getByRole("button")).toHaveCount(0);
  await expect(목록.locator("[data-fold-chevron]")).toHaveCount(0);
  await expect(log.getByText("ruby server.rb --port 4000", { exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 기록은 스냅샷이 올 때마다 다시 읽는다(`useCleanupLog`) — 새 사건의 줄이 맨 위에 서고 옛 줄은 제 차례를 지킨다.
test("정리 기록을 다시 읽으면 새 사건의 줄이 맨 위에 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_cleanup_log: 기록 });
  await page.goto("/processes");
  const log = 묶음(page, "정리 기록");
  // 구획은 접혀 연다(ui-refresh 결정 28) — 먼저 편다.
  await 버튼(log, "정리 기록").click();
  const 줄들 = log.getByRole("list", { name: "정리 기록", exact: true }).getByRole("listitem");
  await expect(줄들).toHaveCount(4);

  const 새것: CleanupEvent = {
    id: 4,
    at: new Date(2026, 8, 27, 15, 0).getTime(),
    reason: "manual",
    shellKey: null,
    owner: null,
    targets: [{ pid: 800, name: "node", command: "node server.js", outcome: "ended" }],
  };
  await replaceAnswer(page, "processes_cleanup_log", [새것, ...기록]);
  await expect(줄들).toHaveCount(5);
  await expect(줄들.first()).toHaveText(`${loggedAt(새것.at)}손으로 끝냄node끝남`);
  await expect(log.getByText("5건", { exact: true })).toBeVisible();
  await expect(줄들.nth(3)).toHaveText(`${loggedAt(기록[1].at)}시작 정리ruby못 끝냄`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("[조용한 셸 모두 닫기]는 조용한 셸만 세어 한 번 묻고 닫는다 — 자손이 있는 셸 · 답이 없는 셸은 세지도 닫지도 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    // 1(work) · 4(`Terminal`의 `+`)는 조용하다. 2는 사람이 띄운 것이 있고, 3은 답이 없다(`null`).
    pty_close_checks: { 1: QUIET_SHELL, 2: { command: false, descendants: 2 }, 3: null, 4: QUIET_SHELL },
  });
  await 셸셋을띄운다(page);
  await openShell(page);
  await 가는곳으로간다(page, "Processes");
  await expect(page).toHaveURL("/processes");
  const quietAll = 버튼(몸머리(page), "조용한 셸 모두 닫기");

  // ── 취소 ──
  await quietAll.click();
  const dialog = page.getByRole("alertdialog", { name: "조용한 셸 닫기" });
  await expect(dialog).toBeVisible();
  expect(await bodyLines(dialog)).toEqual(["조용한 셸 2개를 닫아요."]);
  // 스토어의 살아 있는 셸 전부를 **한 번에** 물었다(프로세스 결정 9).
  expect((await ipcCallArgs(page, "pty_close_checks", "ids")).map(({ args }) => args.ids)).toEqual([[1, 2, 3, 4]]);
  await 버튼(dialog, "취소").click();
  await expect(dialog).toHaveCount(0);
  await settle(page);
  expect(await callCount(page, "pty_kill")).toBe(0);

  // ── 확인 ──
  await quietAll.click();
  await expect(dialog).toBeVisible();
  await 버튼(dialog, "모두 닫기").click();
  // 사람이 누른 닫기라 까닭은 「셸 닫기」다. 주인은 그 셸의 것이다 — work 셸은 slug, 최상위 터미널은 빈 글자다.
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 1, reason: "shellClose", owner: plainWork.slug },
      { id: 4, reason: "shellClose", owner: "" },
    ]);
  await settle(page);
  expect(await callCount(page, "pty_kill")).toBe(2);
  // 셸마다 닫기 확인 창을 안 띄웠다.
  expect(await callCount(page, "pty_close_check")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// N = 0 — 물을 것이 없는 창을 안 띄운다. 짧은 토스트로 눌렸다는 것을 말한다(티켓 32가 구현에 맡긴 모양).
test("닫을 조용한 셸이 없으면 창 없이 그렇다고 알린다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: { 1: BUSY_SHELL } });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await 가는곳으로간다(page, "Processes");
  await expect(page).toHaveURL("/processes");

  await 버튼(몸머리(page), "조용한 셸 모두 닫기").click();
  const toast = toastOf(page, "닫을 조용한 셸이 없어요");
  await expect(toast).toBeVisible();
  // 앵커: 물었다 — 안 물어서 없다고 한 것이 아니다.
  expect(await callCount(page, "pty_close_checks")).toBe(1);
  await settle(page);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await callCount(page, "pty_kill")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
