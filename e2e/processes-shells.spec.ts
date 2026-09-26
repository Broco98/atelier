import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, FIXTURE_GENERATION, NO_METRICS, PROCESS_SNAPSHOT, WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  fireEvent,
  installFixtureBackend,
  ipcCallArgs,
  openShell,
  replaceAnswer,
  typeIntoShell,
  unknownIpcCalls,
} from "./harness";
import { eventLabel } from "@/features/processes/cleanup-log";
import type { CleanupEvent, ProcessRow, ProcessSnapshot } from "@/features/processes/types";
import type { WorkView } from "@/features/works/types";
import type { Mode } from "@/mode";

// 프로세스 티켓 32 — **`Processes`에서 주인 잃은 셸 · 화면 밖 셸 · 정리 기록을 보고 쌓인 셸을 치운다**(프로세스 결정 4 · 6 · 9 ·
// 프로세스 스펙 S12 · S42 · S44 · P1, 스토리 89 · 90 · 94 · 96 · 97).
//
// 무엇이 주인 잃은 셸 · 화면 밖 셸 · 조용한 셸인지, 기록 한 줄을 어떤 말로 적는지는 L2가 표로 잰다(`shell-tree.test.ts` ·
// `shell-registry.test.ts` · `cleanup-log.test.ts`). 여기서 보는 것은 그 판정이 **진짜 스토어(진짜로 띄운 셸) · 진짜 스냅샷 폴러 ·
// 진짜 확인 창**을 지나 화면에 서고 닫기 IPC에 실리는가다 — 스토어는 xterm을 들여 노드 seam에 없다.
//
// 셸 키는 픽스처의 spawn 답이 `l3-<pty 번호>`로 준다. 스냅샷 픽스처의 풀이 그 키를 실으면 화면이 스토어의 셸과 잇는다.

const [, plainWork] = WORKS;

const 키 = (pty: number) => `${FIXTURE_GENERATION}-${pty}`;
const nav = (page: Page, label: string) => page.locator("aside nav").getByRole("button", { name: label, exact: true });
const 모드 = (page: Page, label: string) =>
  page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: label, exact: true });
const 제목 = (page: Page) => page.getByRole("heading", { name: "Processes", exact: true });
const 묶음 = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const 셸트리 = (page: Page) => page.getByRole("tree", { name: "셸", exact: true });
const 셸줄 = (scope: Locator, pty: number) => scope.locator(`[role="treeitem"][data-shell-key="${키(pty)}"]`);
const 버튼 = (scope: Locator, name: string) => scope.getByRole("button", { name, exact: true });

/** 한 묶음의 줄들 — 깊이와 접근성 이름. 화면에 선 차례 그대로다. */
async function 줄들(scope: Locator): Promise<Array<{ level: string | null; name: string | null }>> {
  return scope
    .getByRole("treeitem")
    .evaluateAll((rows) => rows.map((row) => ({ level: row.getAttribute("aria-level"), name: row.getAttribute("aria-label") })));
}

/** 조용하지 않은 답 — 명령이 돈다. claude가 대답하는 셸의 모양이다. */
const BUSY = { command: true, descendants: 0 };
/** 조용한 답 — 명령도 사람이 띄운 자손도 없다(셸 도우미는 이미 뺀 수다). */
const QUIET = { command: false, descendants: 0 };

const vite: ProcessRow = {
  id: { pid: 200, startedUs: 2_000 },
  ppid: 1,
  name: "node",
  argv0: "node",
  command: "node vite --port 5173",
  metrics: NO_METRICS,
};

/** 풀에 `ptys`의 셸이 앉은 스냅샷 — 마지막 출력은 두 시간 전이다(조용한 셸의 경과가 「2h」로 선다). `tree`의 셸 밑에는 vite가 있다. */
function 스냅샷(ptys: number[], tree: number | null = null): ProcessSnapshot {
  const lastOutputMs = Date.now() - 2 * 3_600_000;
  return {
    ...PROCESS_SNAPSHOT,
    verdict: { ...PROCESS_SNAPSHOT.verdict, descendants: tree === null ? {} : { [키(tree)]: [vite] } },
    pool: ptys.map((pty) => ({ ptyId: pty, shellKey: 키(pty), lastOutputMs, metrics: NO_METRICS })),
  };
}

/** 지금까지 나간 닫기의 인자, 나간 순서대로. */
async function kills(page: Page): Promise<Record<string, unknown>[]> {
  return (await ipcCallArgs(page, "pty_kill", "id")).map(({ args }) => args);
}

/** 창 본문의 줄들 — 창의 설명(`aria-describedby`)이 가리키는 줄이다(`close-confirm-count.spec.ts`와 같다). */
async function bodyLines(dialog: Locator): Promise<string[]> {
  const id = await dialog.getAttribute("aria-describedby");
  if (!id) return [];
  return (await dialog.page().locator(`[id="${id}"]`).innerText()).split("\n");
}

/** 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 두 프레임을 넘긴다. **「없다」를 재기 전에 부른다.** */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** **MCP가 그것을 아카이브했다** — 그 세계의 목록 답에서 slug를 빼고 `works:changed`를 쏜다(`shell-orphans.spec.ts`와 같다). */
async function archiveByMcp(page: Page, mode: Mode, list: WorkView[], ...slugs: string[]): Promise<void> {
  await replaceAnswer(page, "list_works", list.filter((one) => !slugs.includes(one.slug)), mode);
  await fireEvent(page, "works:changed", null);
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
  await archiveByMcp(page, "atelier", WORKS, plainWork.slug);
  await expect.poll(() => callCount(page, "pty_close_checks")).toBe(1);

  // 주인이 있는 셸 하나(Atelier `Terminal`, pty 3) — 세계 트리의 앵커다.
  await nav(page, "Terminal").click();
  await expect(page).toHaveURL("/terminal");
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(3);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);

  await nav(page, "Processes").click();
  await expect(page).toHaveURL("/processes");
  const orphans = 묶음(page, "주인 잃은 셸");
  await expect(orphans).toBeVisible();
  // work마다 선다 — 목록에 없는 work이라 이름은 slug이고, 두 세계가 한 묶음이라 세계를 말한다.
  expect(await 줄들(orphans)).toEqual([
    { level: "1", name: `${plainWork.slug}, Atelier, 셸 2개` },
    { level: "2", name: "zsh, 띄운 프로세스 1개" },
    { level: "3", name: "node" },
    { level: "2", name: "zsh, 조용함 2h" },
  ]);
  // 세계 트리에는 안 선다 — 한 셸이 두 묶음에 서면 [닫기] 자리가 둘이다. 앵커: 주인이 있는 셸은 거기 섰다.
  await expect(셸줄(셸트리(page), 3)).toBeVisible();
  await expect(셸줄(셸트리(page), 1)).toHaveCount(0);
  await expect(셸줄(셸트리(page), 2)).toHaveCount(0);
  // [이동]이 없다 — 그 work은 목록에 없어 갈 화면이 없다. 앵커: 세계 트리의 셸 줄에는 있다.
  await expect(버튼(셸줄(셸트리(page), 3), "이동")).toBeVisible();
  await expect(버튼(orphans, "이동")).toHaveCount(0);
  const asked = await callCount(page, "pty_close_checks");

  // ── 취소 ──
  await 버튼(orphans, "모두 닫기").click();
  const dialog = page.getByRole("alertdialog", { name: "주인 잃은 셸 닫기" });
  await expect(dialog).toBeVisible();
  // 토스트의 [모두 닫기](티켓 12)와 같은 말이다 — 창을 띄우기 전에 배치 물음 한 번으로 지금의 수를 센다.
  expect(await bodyLines(dialog)).toEqual(["주인 잃은 셸 2개를 닫아요(띄운 프로세스 3개 포함)."]);
  expect((await ipcCallArgs(page, "pty_close_checks", "ids")).slice(asked).map(({ args }) => args.ids)).toEqual([[1, 2]]);
  await 버튼(dialog, "취소").click();
  await expect(dialog).toHaveCount(0);
  await settle(page);
  expect(await callCount(page, "pty_kill")).toBe(0);
  await expect(orphans).toBeVisible();

  // ── 확인 ──
  await 버튼(orphans, "모두 닫기").click();
  await expect(dialog).toBeVisible();
  await 버튼(dialog, "모두 닫기").click();
  // 사람이 누른 닫기라 까닭은 「셸 닫기」다 — 「MCP 아카이브」면 `●`가 선다(S41).
  const owner = `atelier:${plainWork.slug}`;
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 1, reason: "shellClose", owner },
      { id: 2, reason: "shellClose", owner },
    ]);
  await expect(orphans).toHaveCount(0);
  // 같은 셸의 토스트도 내려간다 — 같은 함수다. 셸마다 닫기 확인 창(08)을 안 띄웠다.
  await expect(page.getByRole("region", { name: "알림", exact: true }).getByRole("dialog")).toHaveCount(0);
  expect(await callCount(page, "pty_command_running")).toBe(0);
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
    pty_command_running: answerByArg("id", { 7: { command: false, descendants: 1 }, 9: QUIET }),
  });
  await page.goto("/processes");
  await expect(제목(page)).toBeVisible();
  await expect.poll(() => callCount(page, "processes_snapshot")).toBeGreaterThan(0);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));

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
  await expect(dialog).toHaveCount(0);
  // 시계가 멈춰 있어 프레임을 기다리는 `settle`은 못 쓴다 — 시계를 조금 흘려 미룬 일을 풀고 센다.
  await page.clock.runFor(100);
  expect(await callCount(page, "pty_kill")).toBe(0);
  await 버튼(셸줄(offscreen, 7), "닫기").click();
  await 버튼(dialog, "닫기").click();
  // 스냅샷의 pty id로 닫는다. 까닭은 「셸 닫기」, 주인은 없다 — 스토어의 칸이 없어 모른다.
  await expect.poll(() => kills(page)).toEqual([{ id: 7, reason: "shellClose", owner: null }]);

  // ── [닫기]: 조용한 셸 ── 묻지 않고 닫는다.
  await 버튼(셸줄(offscreen, 9), "닫기").click();
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 7, reason: "shellClose", owner: null },
      { id: 9, reason: "shellClose", owner: null },
    ]);
  await expect(dialog).toHaveCount(0);
  expect((await ipcCallArgs(page, "pty_command_running", "id")).map(({ args }) => args.id)).toEqual([7, 7, 9]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 기록 셋 — Rust가 새것부터 준다(`processes_cleanup_log`). 때는 끝내기가 끝난 시각이다.
const 기록: CleanupEvent[] = [
  {
    id: 3,
    at: new Date(2026, 8, 27, 14, 3).getTime(),
    reason: "shellExit",
    shellKey: 키(5),
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
    shellKey: 키(2),
    owner: `atelier:${plainWork.slug}`,
    targets: [{ pid: 500, name: "esbuild", command: "esbuild --service", outcome: "gone" }],
  },
];

test("정리 기록이 최근 것부터 까닭 · 대상 수 · 때로 서고, 펼치면 대상의 이름 · 결과 · 명령줄이 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_cleanup_log: 기록 });
  await page.goto("/processes");
  const log = 묶음(page, "정리 기록");
  await expect(log).toBeVisible();
  await expect(log.getByText("기록 3건", { exact: true })).toBeVisible();

  const 사건들 = log.getByRole("list", { name: "정리 기록", exact: true }).getByRole("button");
  // 차례가 기록의 차례다 — 새것부터. 줄의 이름이 까닭 · 대상 수 · 때의 한 문장이다.
  await expect(사건들).toHaveText([/^셸 스스로 끝남/, /^시작 정리/, /^셸 닫기/]);
  expect(await 사건들.evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")))).toEqual(
    기록.map(eventLabel),
  );
  expect(기록.map(eventLabel)[1]).toMatch(/^시작 정리, 프로세스 2개, /);

  // 펼친다 — 누른 사건의 대상만 선다.
  const 시작정리 = 사건들.nth(1);
  await expect(시작정리).toHaveAttribute("aria-expanded", "false");
  await expect(log.getByText("ruby server.rb --port 4000", { exact: true })).toHaveCount(0);
  await 시작정리.click();
  await expect(시작정리).toHaveAttribute("aria-expanded", "true");
  const 대상 = log.getByRole("list", { name: "시작 정리의 대상", exact: true }).getByRole("listitem");
  expect(await 대상.evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")))).toEqual([
    "python3, 강제로 끝남",
    "ruby, 못 끝냄",
  ]);
  await expect(대상.nth(1).getByText("ruby server.rb --port 4000", { exact: true })).toBeVisible();
  // 다른 사건은 접힌 채다 — 앵커: 누른 사건의 명령줄은 섰다.
  await expect(log.getByText("node vite --port 5173", { exact: true })).toHaveCount(0);

  // 다시 누르면 접힌다.
  await 시작정리.click();
  await expect(시작정리).toHaveAttribute("aria-expanded", "false");
  await expect(log.getByText("ruby server.rb --port 4000", { exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/**
 * 두 세계에 셸을 띄운다 — `그냥 일`에 둘(pty 1 · 2), Atelier `Terminal`에 하나(pty 3), Maison `Terminal`에 하나(pty 4). 저절로 뜬
 * 셸은 입력 없이 화면을 떠나면 닫히므로 한 글자씩 친다(`processes-tree.spec.ts`와 같다).
 */
async function 두세계에셸을띄운다(page: Page): Promise<void> {
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);

  await nav(page, "Terminal").click();
  await expect(page).toHaveURL("/terminal");
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(3);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);

  await 모드(page, "Maison").click();
  await nav(page, "Terminal").click();
  await expect(page).toHaveURL("/maison/terminal");
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(4);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
}

test("[조용한 셸 모두 닫기]는 두 세계의 조용한 셸만 세어 한 번 묻고 닫는다 — 자손이 있는 셸 · 답이 없는 셸은 세지도 닫지도 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    // 1(Atelier work) · 4(Maison Terminal)는 조용하다. 2는 사람이 띄운 것이 있고, 3은 답이 없다(`null`).
    pty_close_checks: { 1: QUIET, 2: { command: false, descendants: 2 }, 3: null, 4: QUIET },
  });
  await 두세계에셸을띄운다(page);
  await nav(page, "Processes").click();
  await expect(page).toHaveURL("/maison/processes");
  const quietAll = 버튼(page.locator("header"), "조용한 셸 모두 닫기");

  // ── 취소 ──
  await quietAll.click();
  const dialog = page.getByRole("alertdialog", { name: "조용한 셸 닫기" });
  await expect(dialog).toBeVisible();
  expect(await bodyLines(dialog)).toEqual(["조용한 셸 2개를 닫아요."]);
  // 스토어의 살아 있는 셸 전부를 **한 번에** 물었다 — 두 세계가 함께다(결정 9).
  expect((await ipcCallArgs(page, "pty_close_checks", "ids")).map(({ args }) => args.ids)).toEqual([[1, 2, 3, 4]]);
  await 버튼(dialog, "취소").click();
  await expect(dialog).toHaveCount(0);
  await settle(page);
  expect(await callCount(page, "pty_kill")).toBe(0);

  // ── 확인 ──
  await quietAll.click();
  await expect(dialog).toBeVisible();
  await 버튼(dialog, "모두 닫기").click();
  // 사람이 누른 닫기라 까닭은 「셸 닫기」다. 주인은 그 셸의 것이다(Maison 최상위 터미널은 slug가 없다).
  await expect
    .poll(() => kills(page))
    .toEqual([
      { id: 1, reason: "shellClose", owner: `atelier:${plainWork.slug}` },
      { id: 4, reason: "shellClose", owner: "maison:" },
    ]);
  await settle(page);
  expect(await callCount(page, "pty_kill")).toBe(2);
  // 셸마다 닫기 확인 창을 안 띄웠다.
  expect(await callCount(page, "pty_command_running")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// N = 0 — 물을 것이 없는 창을 안 띄운다. 짧은 토스트로 눌렸다는 것을 말한다(티켓 32가 구현에 맡긴 모양).
test("닫을 조용한 셸이 없으면 창 없이 그렇다고 알린다", async ({ page }) => {
  await installFixtureBackend(page, { pty_close_checks: { 1: BUSY } });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await nav(page, "Processes").click();
  await expect(page).toHaveURL("/processes");

  await 버튼(page.locator("header"), "조용한 셸 모두 닫기").click();
  const toast = page.getByRole("region", { name: "알림", exact: true }).getByRole("dialog", {
    name: "닫을 조용한 셸이 없어요",
    exact: true,
  });
  await expect(toast).toBeVisible();
  // 앵커: 물었다 — 안 물어서 없다고 한 것이 아니다.
  expect(await callCount(page, "pty_close_checks")).toBe(1);
  await settle(page);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await callCount(page, "pty_kill")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
