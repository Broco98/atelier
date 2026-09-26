import { expect, test, type Locator, type Page } from "./evidence";
import { FIXTURE_GENERATION, PROCESS_SNAPSHOT } from "./fixtures";
import { awaitSpawned, callCount, installFixtureBackend, ipcCallArgs, typeIntoShell, unknownIpcCalls } from "./harness";
import { formatMemory } from "@/features/processes/metrics";
import type { ProcessIdentity, ProcessRow, ProcessSnapshot } from "@/features/processes/types";
import type { Settings } from "@/features/settings/types";

// 프로세스 티켓 31 — **고아 · 다른 인스턴스 · 예외를 보고, 고아를 치우고 프로세스를 끝낸다**(프로세스 결정 5 · 6 · 10 · 기본값
// [끝내기] · 프로세스 스펙 S4 · S7 · S54 · S58, 스토리 86 · 91 · 92 · 93).
//
// 묶음을 짓는 규칙(트리 · 실행마다 묶기 · 빌드 이름 · 끝낼 신원 · 확인 창의 말 · 예외 목록에 더하기)은 L2가 표로 잰다
// (`process-groups.test.ts` · `process-exceptions.test.ts`). 여기서 보는 것은 그 결과가 **진짜 스냅샷 폴러 · 진짜 확인 창 · 진짜 설정
// 저장**을 지나 화면에 서고 IPC에 실리는가다. 끝내기가 신호 직전에 신원을 다시 보는 것(재사용된 pid)은 L1이 잰다 — 이 층이 보는 것은
// **화면에 보인 신원이 그대로 실리는가**다.
//
// 숫자 칸의 기대 글자는 화면이 쓰는 그 표기 함수로 짓는다(`processes-metrics.spec.ts`와 같은 규칙) — 모양은 L2의 몫이다.

const MiB = 1024 * 1024;

const 키 = (pty: number) => `${FIXTURE_GENERATION}-${pty}`;
const nav = (page: Page, label: string) => page.locator("aside nav").getByRole("button", { name: label, exact: true });
const 묶음 = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const 줄 = (scope: Locator, name: string) => scope.getByRole("treeitem", { name, exact: true });
const 메모리칸 = (row: Locator) => row.locator('[data-cell="memory"]');

const 행 = (pid: number, ppid: number, startedUs: number, name: string, memory: number): ProcessRow => ({
  id: { pid, startedUs },
  ppid,
  name,
  argv0: name,
  command: `${name} --fixture`,
  metrics: { memory, cpu: null, ports: [] },
});

const 신원 = (row: ProcessRow): ProcessIdentity => row.id;
const pid순 = (ids: ProcessIdentity[]) => [...ids].sort((a, b) => a.pid - b.pid);

// 셸 1의 자손 — vite(node) 밑에 esbuild, 그 밑에 watcher. sleep은 셸 바로 밑의 형제다(node의 트리가 아니다).
const vite = 행(200, 1, 2_000, "node", 300 * MiB);
const esbuild = 행(210, 200, 2_100, "esbuild", 20 * MiB);
const watcher = 행(220, 210, 2_200, "watcher", 5 * MiB);
const sleep = 행(230, 1, 2_300, "sleep", MiB);

// 확정 고아 — 셸 키 둘. 출처 불명 — 셸 키 둘, 둘 다 한 줄씩(N = 2).
const 고아node = 행(400, 1, 4_000, "node", 120 * MiB);
const 고아esbuild = 행(410, 400, 4_100, "esbuild", 30 * MiB);
const 고아python = 행(450, 1, 4_500, "python3", 40 * MiB);
const 불명sleep = 행(500, 1, 5_000, "sleep", 2 * MiB);
const 불명ruby = 행(510, 1, 5_100, "ruby", 8 * MiB);

// 다른 인스턴스 — dev 빌드 하나(셸 키 H-2: zsh 밑에 node), 설치본 하나(셸 키 R-1: zsh).
const 남의zsh = 행(600, 1, 6_000, "zsh", 4 * MiB);
const 남의node = 행(610, 600, 6_100, "node", 200 * MiB);
const 설치본zsh = 행(650, 1, 6_500, "zsh", 3 * MiB);

// 예외 — tmux 서버와 그 밑의 zsh.
const tmux = 행(300, 1, 3_000, "tmux", 10 * MiB);
const tmux밑zsh = 행(310, 300, 3_100, "zsh", 6 * MiB);

function 스냅샷(): ProcessSnapshot {
  return {
    ...PROCESS_SNAPSHOT,
    verdict: {
      ...PROCESS_SNAPSHOT.verdict,
      descendants: { [키(1)]: [vite, esbuild, watcher, sleep] },
      exceptions: [tmux, tmux밑zsh],
      orphans: {
        confirmed: { "OLD-3": [고아node, 고아esbuild], "OLD-5": [고아python] },
        unknown: { "X-1": [불명sleep], "X-2": [불명ruby] },
      },
      otherInstances: { "H-2": [남의zsh, 남의node], "R-1": [설치본zsh] },
    },
    pool: [{ ptyId: 1, shellKey: 키(1), lastOutputMs: Date.now(), metrics: { memory: 4 * MiB, cpu: null, ports: [] } }],
    instances: [
      { generation: "H", build: "dev", version: "0.15.0", shellKeys: ["H-2"] },
      { generation: "R", build: "release", version: "0.14.1", shellKeys: ["R-1"] },
    ],
  };
}

/** 셸 하나를 띄우고 `Processes`를 연다 — 자손 행은 스토어의 셸과 이어져야 선다. */
async function 셸을띄우고연다(page: Page): Promise<void> {
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await nav(page, "Processes").click();
  await expect(page).toHaveURL("/processes");
  await expect(줄(page.getByRole("tree", { name: "셸", exact: true }), `node, ${formatMemory(vite.metrics.memory)}`)).toBeVisible();
}

const 셸트리 = (page: Page) => page.getByRole("tree", { name: "셸", exact: true });
const 이름 = (row: ProcessRow) => `${row.name}, ${formatMemory(row.metrics.memory)}`;

test("확정 고아와 출처 불명이 갈린 묶음으로 서고, 다른 인스턴스는 실행마다 빌드 종류 · 버전이, 예외는 그 트리가 서며, 그 둘에는 동작이 없다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");

  // 확정 고아 — 셸 키 둘의 행이 한 묶음에, 트리로(esbuild는 node 밑). [정리]가 선다.
  const 확정 = 묶음(page, "확정 고아");
  await expect(확정.getByRole("treeitem")).toHaveCount(3);
  await expect(줄(확정, 이름(고아node))).toHaveAttribute("aria-level", "1");
  await expect(줄(확정, 이름(고아esbuild))).toHaveAttribute("aria-level", "2");
  await expect(줄(확정, 이름(고아python))).toHaveAttribute("aria-level", "1");
  await expect(확정.getByRole("button", { name: "정리", exact: true })).toBeVisible();

  // 출처 불명 — 따로 선 묶음이다. 확정 고아의 행이 섞이지 않는다.
  const 불명 = 묶음(page, "출처 불명");
  await expect(불명.getByRole("treeitem")).toHaveCount(2);
  await expect(줄(불명, 이름(불명sleep))).toBeVisible();
  await expect(줄(불명, 이름(불명ruby))).toBeVisible();
  await expect(불명.getByRole("button", { name: "정리", exact: true })).toBeVisible();

  // 다른 인스턴스 — 실행마다 머리(빌드 종류 · 버전)가 서고 그 밑에 그 실행의 셸 키가 낸 트리가 선다. 보기 전용이다.
  const 남 = 묶음(page, "다른 인스턴스");
  await expect(남).toContainText("보기 전용");
  const dev머리 = 남.getByRole("treeitem", { name: /^dev 빌드 · v0\.15\.0/ });
  const 설치본머리 = 남.getByRole("treeitem", { name: /^설치본 · v0\.14\.1/ });
  await expect(dev머리).toHaveAttribute("aria-level", "1");
  await expect(설치본머리).toHaveAttribute("aria-level", "1");
  await expect(줄(남, 이름(남의zsh))).toHaveAttribute("aria-level", "2");
  await expect(줄(남, 이름(남의node))).toHaveAttribute("aria-level", "3");
  await expect(줄(남, 이름(설치본zsh))).toHaveAttribute("aria-level", "2");

  // 예외 — 걸린 이름과 그 밑. 보기 전용이다.
  const 예외 = 묶음(page, "예외");
  await expect(예외).toContainText("보기 전용");
  await expect(줄(예외, 이름(tmux))).toHaveAttribute("aria-level", "1");
  await expect(줄(예외, 이름(tmux밑zsh))).toHaveAttribute("aria-level", "2");

  // 다른 인스턴스와 예외 행에는 끝내는 동작이 없다 — 버튼(끝내기 · 정리 · 행 메뉴)이 하나도 안 선다. 앵커: 고아 묶음에는 섰다(위).
  await expect(남.getByRole("button")).toHaveCount(0);
  await expect(예외.getByRole("button")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("고아 · 다른 인스턴스 · 예외 행에도 28의 표기 함수로 메모리 칸이 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");

  for (const [group, rows] of [
    ["확정 고아", [고아node, 고아esbuild, 고아python]],
    ["출처 불명", [불명sleep, 불명ruby]],
    ["다른 인스턴스", [남의zsh, 남의node, 설치본zsh]],
    ["예외", [tmux, tmux밑zsh]],
  ] as const) {
    for (const row of rows) {
      await expect(메모리칸(줄(묶음(page, group), 이름(row)))).toHaveText(formatMemory(row.metrics.memory));
    }
  }
  // 실행 머리는 그 실행의 행을 더한 것이다.
  await expect(메모리칸(묶음(page, "다른 인스턴스").getByRole("treeitem", { name: /^dev 빌드/ }))).toHaveText(
    formatMemory(남의zsh.metrics.memory! + 남의node.metrics.memory!),
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("확정 고아의 [정리]는 묻지 않고 그 묶음의 신원 전부를 끝내기 IPC에 싣는다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");

  await 묶음(page, "확정 고아").getByRole("button", { name: "정리", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "processes_end", "targets")).map(({ args }) => pid순(args.targets as ProcessIdentity[])))
    .toEqual([pid순([고아node, 고아esbuild, 고아python].map(신원))]);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("출처 불명의 [정리]는 「출처를 모르는 프로세스 N개를 끝내요」를 한 번 더 묻고, 취소하면 끝내기 IPC가 안 나간다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");
  const 정리 = 묶음(page, "출처 불명").getByRole("button", { name: "정리", exact: true });

  await 정리.click();
  // 앵커: 확인 창이 섰다 — 안 서고 안 부른 것과 가른다.
  const dialog = page.getByRole("alertdialog", { name: "출처 불명 정리" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("출처를 모르는 프로세스 2개를 끝내요");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await callCount(page, "processes_end")).toBe(0);

  // 진행하면 그 묶음의 신원 전부가 실린다.
  await 정리.click();
  await dialog.getByRole("button", { name: "끝내기", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "processes_end", "targets")).map(({ args }) => pid순(args.targets as ProcessIdentity[])))
    .toEqual([pid순([불명sleep, 불명ruby].map(신원))]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("자손 행의 [끝내기]는 확인 창을 거친 뒤 화면에 보인 신원(그 프로세스와 그 PID 트리)을 싣고, 취소하면 안 부른다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸을띄우고연다(page);
  const 끝내기 = 줄(셸트리(page), 이름(vite)).getByRole("button", { name: "끝내기", exact: true });

  await 끝내기.click();
  const dialog = page.getByRole("alertdialog", { name: "'node' 끝내기" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("이 프로세스와 그 밑에서 뜬 프로세스 2개를 끝내요.");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await callCount(page, "processes_end")).toBe(0);

  await 끝내기.click();
  await dialog.getByRole("button", { name: "끝내기", exact: true }).click();
  // 그 프로세스와 그 밑(esbuild → watcher)이다. 셸 바로 밑의 형제(sleep)는 안 든다. 신원은 스냅샷에 실린 (pid, 시작 시각) 그대로다.
  await expect
    .poll(async () => (await ipcCallArgs(page, "processes_end", "targets")).map(({ args }) => pid순(args.targets as ProcessIdentity[])))
    .toEqual([pid순([vite, esbuild, watcher].map(신원))]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 설정 저장에 실린 예외 목록들 — 저장마다 하나. */
const 저장된예외 = async (page: Page) =>
  (await ipcCallArgs(page, "write_settings", "settings")).map(({ args }) => (args.settings as Settings).terminal.processExceptions);

test("행 메뉴의 「예외로 두기」는 그 이름을 설정 저장에 싣고, 설정이 null이면 기본 목록 + 그 이름이다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸을띄우고연다(page);

  await 줄(셸트리(page), 이름(esbuild)).getByRole("button", { name: "프로세스 메뉴", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "예외로 두기", exact: true }).click();
  // 픽스처의 설정은 `processExceptions: null`, 기본 목록은 `["tmux", "docker*"]`다.
  await expect.poll(() => 저장된예외(page)).toEqual([["tmux", "docker*", "esbuild"]]);
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await callCount(page, "processes_end")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("고아 행의 「예외로 두기」는 고친 목록이 있으면 그 목록 끝에 이름을 더한다", async ({ page }) => {
  await installFixtureBackend(page, {
    processes_snapshot: 스냅샷(),
    read_settings: { terminal: { fontFamily: null, fontSize: null, theme: "dark", processExceptions: ["tmux"] } } satisfies Settings,
  });
  await page.goto("/processes");

  await 줄(묶음(page, "확정 고아"), 이름(고아python)).getByRole("button", { name: "프로세스 메뉴", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "예외로 두기", exact: true }).click();
  await expect.poll(() => 저장된예외(page)).toEqual([["tmux", "python3"]]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
