import { expect, test, type Locator, type Page } from "./evidence";
import { shellKeyOf, WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  navButton,
  openShell,
  replaceAnswer,
  typeIntoShell,
  unknownIpcCalls,
} from "./harness";
import { formatCpu, formatMemory, formatPorts } from "@/features/processes/metrics";
import { metricsOf as 지표, NO_METRICS, poolShell, processRow, snapshotFixture } from "@/features/processes/process-fixture";
import type { ProcessMetrics, ProcessRow, ProcessSnapshot } from "@/features/processes/types";

// 프로세스 티켓 28 — **프로세스마다 메모리 · CPU · 포트가 선다**(프로세스 결정 10 · 프로세스 스펙 S37 · S38 · S40 · S53 · S58, 스토리
// 84 · 85 · 87 · 100).
//
// 표기(1GB 경계 · 정수 % · 포트 잇기)와 트리 합의 규칙은 L2가 표로 잰다(`metrics.test.ts` · `shell-tree.test.ts`). 여기서 보는 것은
// 스냅샷 픽스처의 숫자가 **진짜 스냅샷 폴러 · 진짜 스토어(진짜로 띄운 셸)**를 지나 work 행 · 셸 행 · 자손 행의 칸에 서는가, 그리고 둘째
// 표본이 오면 CPU 칸이 「—」에서 숫자로 바뀌는가다. **칸의 숫자 모양을 여기서 못박지 않는다** — 기대 글자는 화면이 쓰는 그 표기
// 함수로 짓는다. 모양은 L2의 몫이다.

const [, plainWork] = WORKS;

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

const 트리 = (page: Page) => page.getByRole("tree", { name: "셸", exact: true });
const 셸행 = (page: Page, pty: number) => 트리(page).locator(`[role="treeitem"][data-shell-key="${shellKeyOf(pty)}"]`);
const work행 = (page: Page) => 트리(page).locator('[role="treeitem"][aria-level="2"]');
const 칸 = (row: Locator, cell: "memory" | "cpu" | "ports") => row.locator(`[data-cell="${cell}"]`);

/** env를 읽은 행 — 부른 이름은 커널 이름 그대로다. 이 파일이 재는 것은 숫자라 지표를 늘 준다. */
const 행 = (pid: number, ppid: number, startedUs: number, name: string, metrics: ProcessMetrics): ProcessRow =>
  processRow(pid, ppid, startedUs, name, { argv0: name, command: `${name} --fixture`, metrics });

/**
 * `그냥 일`의 셸 둘(pty 1 · 2). 첫 셸에는 셸 도우미(gitstatusd)와 사람이 띄운 트리(vite → esbuild)가 있다 — vite는 1GB를 넘고 LISTEN
 * 포트 하나, esbuild도 포트 하나. 둘째 셸은 아무것도 안 띄웠다. `cpu`가 없으면 첫 표본이다(모든 CPU가 빈다).
 */
function 스냅샷(cpu?: { shell1: number; gitstatusd: number; vite: number; esbuild: number; shell2: number }): ProcessSnapshot {
  const lastOutputMs = Date.now() - 2 * 3_600_000;
  return snapshotFixture({
    verdict: {
      descendants: {
        [shellKeyOf(1)]: [
          행(150, 1, 1_000, "gitstatusd", 지표(2 * MiB, cpu?.gitstatusd ?? null)),
          행(200, 1, 2_000, "node", 지표(1.2 * GiB, cpu?.vite ?? null, [5173])),
          행(210, 200, 2_100, "esbuild", 지표(20 * MiB, cpu?.esbuild ?? null, [24678])),
        ],
      },
      helpers: [{ pid: 150, startedUs: 1_000 }],
    },
    pool: [
      poolShell(1, shellKeyOf(1), lastOutputMs, 지표(8 * MiB, cpu?.shell1 ?? null)),
      poolShell(2, shellKeyOf(2), lastOutputMs, 지표(6 * MiB, cpu?.shell2 ?? null)),
      // 스토어가 모르는 풀의 셸(32의 화면 밖 셸) — 숫자가 어느 합에도 안 든다.
      poolShell(99, shellKeyOf(99), lastOutputMs, 지표(64 * GiB, 99)),
    ],
  });
}

/** 셸 1의 트리(셸 프로세스 · 도우미 · vite · esbuild)와 work(셸 1 + 셸 2)의 메모리 합. */
const 셸1메모리 = 8 * MiB + 2 * MiB + 1.2 * GiB + 20 * MiB;
const work메모리 = 셸1메모리 + 6 * MiB;

async function 셸둘을띄우고연다(page: Page): Promise<void> {
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);
  await navButton(page, "Processes").click();
  await expect(page).toHaveURL("/processes");
  await expect(셸행(page, 1)).toBeVisible();
}

test("work 행 · 셸 행 · 자손 행에 메모리 · CPU · 포트 칸이 서고, 첫 표본의 CPU는 「—」이고 다음 표본에서 숫자가 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸둘을띄우고연다(page);

  // 셸 행 — 그 셸의 트리 합(셸 프로세스 · 셸 도우미 · 자손)과 트리의 LISTEN 포트 전부.
  const 셸 = 셸행(page, 1);
  await expect(칸(셸, "memory")).toHaveText(formatMemory(셸1메모리));
  await expect(칸(셸, "cpu")).toHaveText(formatCpu(null));
  await expect(칸(셸, "ports")).toHaveText(formatPorts([5173, 24678]));
  // 아무것도 안 띄운 셸 — 셸 프로세스 자신의 숫자이고 포트가 없다.
  await expect(칸(셸행(page, 2), "memory")).toHaveText(formatMemory(6 * MiB));
  await expect(칸(셸행(page, 2), "ports")).toHaveText("");

  // work 행 — 그 work 셸들의 트리 합. 포트 칸은 없다(S53). 스토어가 모르는 풀의 셸은 합에 안 든다.
  await expect(work행(page)).toHaveCount(1);
  await expect(칸(work행(page), "memory")).toHaveText(formatMemory(work메모리));
  await expect(칸(work행(page), "cpu")).toHaveText(formatCpu(null));
  await expect(칸(work행(page), "ports")).toHaveCount(0);

  // 자손 행 — 그 프로세스 하나의 숫자.
  const vite = 트리(page).locator('[role="treeitem"][aria-level="4"]', { hasText: "node" });
  const esbuild = 트리(page).locator('[role="treeitem"][aria-level="5"]', { hasText: "esbuild" });
  await expect(칸(vite, "memory")).toHaveText(formatMemory(1.2 * GiB));
  await expect(칸(vite, "cpu")).toHaveText(formatCpu(null));
  await expect(칸(vite, "ports")).toHaveText(formatPorts([5173]));
  await expect(칸(esbuild, "memory")).toHaveText(formatMemory(20 * MiB));
  await expect(칸(esbuild, "ports")).toHaveText(formatPorts([24678]));

  // 둘째 표본 — 백엔드가 앞 표본과의 차이로 CPU%를 싣는다. 다음 박자(2초)에 칸이 「—」에서 숫자로 바뀐다.
  await replaceAnswer(page, "processes_snapshot", 스냅샷({ shell1: 0.5, gitstatusd: 0.1, vite: 12.4, esbuild: 3, shell2: 4 }));
  await expect(칸(셸, "cpu")).toHaveText(formatCpu(0.5 + 0.1 + 12.4 + 3), { timeout: 10_000 });
  await expect(칸(work행(page), "cpu")).toHaveText(formatCpu(0.5 + 0.1 + 12.4 + 3 + 4));
  await expect(칸(vite, "cpu")).toHaveText(formatCpu(12.4));
  await expect(칸(esbuild, "cpu")).toHaveText(formatCpu(3));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// S58 — 「셸 이름, 상태, 메모리」를 한 문장으로. 메모리는 그 셸의 트리 합이고, 표기는 칸과 같은 함수다. work 행과 자손 행도 같은
// 모양으로 끝에 메모리가 붙는다 — 눈에 보이는 숫자를 스크린리더도 읽는다.
test("셸 행의 접근성 이름이 「셸 이름, 상태, 메모리」 한 문장이고, work 행과 자손 행도 끝에 메모리를 단다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸둘을띄우고연다(page);

  await expect(셸행(page, 1)).toHaveAttribute("aria-label", `zsh, 띄운 프로세스 2개, ${formatMemory(셸1메모리)}`);
  await expect(셸행(page, 2)).toHaveAttribute("aria-label", `zsh, 조용함 2h, ${formatMemory(6 * MiB)}`);
  await expect(work행(page)).toHaveAttribute("aria-label", `${plainWork.title}, 셸 2개, ${formatMemory(work메모리)}`);
  await expect(트리(page).getByRole("treeitem", { name: `node, ${formatMemory(1.2 * GiB)}`, exact: true })).toHaveAttribute(
    "aria-level",
    "4",
  );
  // 셸 도우미 줄은 숫자를 안 단다 — 그 몫은 셸 행의 합에 들었다.
  await expect(트리(page).locator("[data-helper]")).toHaveAttribute("aria-label", "셸 도우미, gitstatusd");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 앵커 — 지표를 못 읽은 앱(macOS 밖)은 칸에 「—」가 서고 이름에 메모리 조각이 안 붙는다. 「0MB」는 모르는 것을 없다고 한다.
test("지표를 못 읽은 셸은 칸에 「—」가 서고 접근성 이름에 메모리가 안 붙는다", async ({ page }) => {
  const 못읽음 = 스냅샷();
  await installFixtureBackend(page, {
    processes_snapshot: {
      ...못읽음,
      verdict: { ...못읽음.verdict, descendants: {}, helpers: [] },
      pool: 못읽음.pool.map((shell) => ({ ...shell, metrics: NO_METRICS })),
    },
  });
  await 셸둘을띄우고연다(page);

  await expect(칸(셸행(page, 1), "memory")).toHaveText(formatMemory(null));
  await expect(칸(셸행(page, 1), "cpu")).toHaveText(formatCpu(null));
  await expect(칸(work행(page), "memory")).toHaveText(formatMemory(null));
  await expect(셸행(page, 1)).toHaveAttribute("aria-label", "zsh, 조용함 2h");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
