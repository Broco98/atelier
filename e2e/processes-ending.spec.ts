import { expect, test, type Locator, type Page } from "./evidence";
import {
  callCount,
  heldCalls,
  holdCommand,
  installFixtureBackend,
  releaseCommand,
  replaceAnswer,
  unknownIpcCalls,
  스냅샷두박자,
  시계를세운다,
} from "./harness";
import { formatCpu, formatMemory } from "@/features/processes/metrics";
import { breakdownOf, envReadRow, metricsOf, otherAppOf, snapshotFixture } from "@/features/processes/process-fixture";
import type { EndResult, ProcessRow, ProcessSnapshot } from "@/features/processes/types";

// **끝내기 결과가 줄에 보이고, 포인터가 표 위에 있는 동안 줄 순서가 멈춘다**(restart 03-10 · 스토리 134 · 135 · 구현 스펙 「03 — Processes ›
// 재는 동작」 · 시안 ProcessSheet 「끝내기」 · 「보기와 움직임」). 03-10이 임시 spec으로 찍었던 장면(`시안-비교/03-10/`)을 L3로 남긴다.
//
// - [끝내기] · [정리]를 누르면 대상 줄마다 「끝내는 중」이 서고, 끝내기 IPC의 답이 준 결과(끝남 · 강제로 끝냄 · 못 끝냄 · 이미 없음)가 그
//   줄에 선다. 끝남 · 강제로 끝냄 · 이미 없음은 줄이 옅어지고 2.4초 뒤 빠진다. 못 끝냄은 그 프로세스가 표본에 있는 동안 남는다. 표본에서
//   빠진 줄도 결과가 남는 동안 제자리에 서고 숫자는 「—」다.
// - 표본 값으로 서는 줄(다른 앱 — CPU 순)은 포인터가 표 위에 있는 동안 자리를 안 바꾼다 — 누르려는 줄이 도망가지 않게. 묶음 보기에서는 멈춤이
//   차례를 실제로 붙잡고 있을 때 「줄 순서를 잠시 멈췄어요」가 서고, CPU 순 · 메모리 순은 포인터가 표 위에 있는 동안 늘 선다.
//
// 결과를 가르는 규칙(어느 결과가 언제 빠지는지 · 빠진 줄을 어디에 다시 세우는지 · 멈춘 차례)은 L2가 표로 잰다(`endings.test.ts` ·
// `row-order.test.ts`). 여기서 보는 것은 그것이 진짜 [정리] · 끝내기 IPC · 스냅샷 박자 · 포인터를 지나 화면에 서는가다. 무엇을 끝내는지
// (실린 신원)는 `processes-strays.spec.ts`가 잰다. 프로세스 이름은 꾸민 것이다.

const MiB = 1024 * 1024;

const 행 = (pid: number, startedUs: number, name: string, memory: number): ProcessRow =>
  envReadRow(pid, 1, startedUs, name, { metrics: metricsOf(memory) });

// 확정 고아(셸 키 OLD-3) 넷 — 셸 밑에 바로 뜬 형제다. 끝내기의 결과가 하나씩 다르다.
const node = 행(400, 4_000, "node", 120 * MiB);
const python = 행(410, 4_100, "python3", 40 * MiB);
const ruby = 행(420, 4_200, "ruby", 8 * MiB);
const sleep = 행(430, 4_300, "sleep", 2 * MiB);
const 넷 = [node, python, ruby, sleep];

const 결과: EndResult[] = [
  { id: node.id, outcome: "ended" },
  { id: python.id, outcome: "forced" },
  { id: ruby.id, outcome: "survived" },
  { id: sleep.id, outcome: "gone" },
];

/** 확정 고아가 그 줄들뿐인 장. 없으면 손볼 것이 비어 구획이 안 선다. */
const 고아장 = (rows: ProcessRow[]): ProcessSnapshot =>
  snapshotFixture({ verdict: { orphans: { confirmed: rows.length > 0 ? { "OLD-3": rows } : {}, unknown: {} } } });

const 손볼것 = (page: Page) => page.getByRole("tree", { name: "손볼 것", exact: true });
const 줄 = (scope: Locator, name: string) => scope.getByRole("treeitem", { name, exact: true });
/** 갈래 줄 밑의 프로세스 줄들의 접근성 이름 — 화면에 선 차례 그대로다(갈래 줄은 뺀다). */
const 프로세스줄들 = (page: Page) =>
  손볼것(page)
    .locator('[role="treeitem"][aria-level="2"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
const 이름 = (row: ProcessRow) => `${row.name}, ${formatMemory(row.metrics.memory)}`;
const 끝내기들 = (page: Page) => 손볼것(page).getByRole("button", { name: "끝내기", exact: true });
const 정리 = (page: Page) =>
  손볼것(page)
    .getByRole("treeitem", { name: /^확정 고아, 프로세스 \d+개/ })
    .getByRole("button", { name: "정리", exact: true });

/** 세운 시계에서 스냅샷 박자 하나를 넘긴다 — 새 물음이 나갈 때까지 250ms씩(`processes-shells.spec.ts`와 같다). */
async function 다음박자(page: Page): Promise<void> {
  const before = await callCount(page, "processes_snapshot");
  for (let step = 0; step < 20 && (await callCount(page, "processes_snapshot")) === before; step += 1) {
    await page.clock.runFor(250);
  }
  expect(await callCount(page, "processes_snapshot"), "5초 넘게 스냅샷 박자가 안 왔다").toBeGreaterThan(before);
}

test("[정리]를 누르면 줄마다 「끝내는 중」이 서고, 답의 결과 넷이 제 줄에 서며, 끝남 · 강제로 끝냄 · 이미 없음은 옅어졌다가 2.4초 뒤 빠지고 못 끝냄은 표본에서 빠질 때까지 남는다", async ({
  page,
}) => {
  await page.clock.install();
  await installFixtureBackend(page, { processes_snapshot: 고아장(넷) });
  await page.goto("/processes");
  for (const row of 넷) await expect(줄(손볼것(page), 이름(row))).toBeVisible();
  const 처음차례 = await 프로세스줄들(page);
  expect(처음차례).toEqual(넷.map(이름));
  // 앵커: 줄마다 [끝내기]가 섰다 — 아래에서 「안 선다」가 헛돌지 않는다.
  await expect(끝내기들(page)).toHaveCount(4);

  // ── 끝내는 중 ── 답을 붙잡아 둔다. 줄마다 「끝내는 중」이 동작 칸에 서고 [끝내기]가 빠진다. 줄은 아직 옅지 않다.
  await holdCommand(page, "processes_end");
  await 정리(page).click();
  for (const row of 넷) {
    const at = 줄(손볼것(page), `${이름(row)}, 끝내는 중`);
    await expect(at).toBeVisible();
    await expect(at.locator("[data-end-mark]")).toHaveText("끝내는 중");
    await expect(at).not.toHaveAttribute("data-ended");
  }
  await expect(끝내기들(page)).toHaveCount(0);
  expect(await heldCalls(page, "processes_end")).toBe(1);

  // 답이 오기 전에 표본이 바뀐다 — 셋은 끝나 표본에서 빠지고 ruby만 남는다. 끝내는 중인 줄은 빠져도 제자리에 서고 숫자가 「—」다.
  await 시계를세운다(page);
  await replaceAnswer(page, "processes_snapshot", 고아장([ruby]));
  await 다음박자(page);
  await expect(줄(손볼것(page), "node, 끝내는 중")).toBeVisible();
  await expect(줄(손볼것(page), "node, 끝내는 중").locator('[data-cell="memory"]')).toHaveText("—");
  await expect(줄(손볼것(page), `${이름(ruby)}, 끝내는 중`)).toBeVisible();

  // ── 결과 ── 답을 놓는다. 그 순간부터 2.4초를 센다.
  await replaceAnswer(page, "processes_end", 결과);
  await releaseCommand(page, "processes_end");
  const 끝난줄 = [
    { row: node, text: "끝남" },
    { row: python, text: "강제로 끝냄" },
    { row: sleep, text: "이미 없음" },
  ];
  for (const { row, text } of 끝난줄) {
    const at = 줄(손볼것(page), `${row.name}, ${text}`);
    await expect(at).toBeVisible();
    await expect(at.locator("[data-end-mark]")).toHaveText(text);
    // 그 프로세스가 없다는 말이라 줄이 옅다(시안 45%) — 숫자는 「—」다.
    await expect(at).toHaveAttribute("data-ended", "true");
    await expect(at).toHaveCSS("opacity", "0.45");
    await expect(at.locator('[data-cell="memory"]')).toHaveText("—");
  }
  // 못 끝냄은 산 프로세스다 — 줄이 옅지 않고 표본의 숫자 그대로이며, 글은 기다림의 잉크다.
  const 남은줄 = 줄(손볼것(page), `${이름(ruby)}, 못 끝냄`);
  await expect(남은줄).toBeVisible();
  await expect(남은줄.locator("[data-end-mark]")).toHaveText("못 끝냄");
  await expect(남은줄).not.toHaveAttribute("data-ended");
  await expect(남은줄).toHaveCSS("opacity", "1");
  await expect(남은줄.locator('[data-cell="memory"]')).toHaveText(formatMemory(ruby.metrics.memory));
  // 결과가 선 동안도 [끝내기]가 없다. 줄은 누른 때의 차례 그대로 제자리다.
  await expect(끝내기들(page)).toHaveCount(0);
  expect(await 프로세스줄들(page)).toEqual([
    "node, 끝남",
    "python3, 강제로 끝냄",
    `${이름(ruby)}, 못 끝냄`,
    "sleep, 이미 없음",
  ]);

  // ── 2.4초 ── 그 앞에는 박자가 와도 그대로다.
  await page.clock.runFor(2_300);
  expect(await 프로세스줄들(page)).toEqual([
    "node, 끝남",
    "python3, 강제로 끝냄",
    `${이름(ruby)}, 못 끝냄`,
    "sleep, 이미 없음",
  ]);
  await page.clock.runFor(100);
  await expect.poll(() => 프로세스줄들(page)).toEqual([`${이름(ruby)}, 못 끝냄`]);

  // ── 못 끝냄 ── 2.4초가 지나도, 박자가 와도 표본에 있는 동안 남는다. 표본에서 빠지면(뒤늦게 끝났다) 빠진다.
  await 다음박자(page);
  await 다음박자(page);
  expect(await 프로세스줄들(page)).toEqual([`${이름(ruby)}, 못 끝냄`]);
  await replaceAnswer(page, "processes_snapshot", 고아장([]));
  await 다음박자(page);
  await expect(page.getByRole("region", { name: "손볼 것", exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 다른 앱 셋 — CPU 순으로 선다. 둘째 장은 차례가 거꾸로다(시안-비교 03-10의 장면).
const 앱장 = (sketchpad: number, notebook: number, chatter: number): ProcessSnapshot =>
  snapshotFixture({
    breakdown: breakdownOf({
      apps: [
        otherAppOf("Sketchpad", 3, 300 * MiB, sketchpad),
        otherAppOf("Notebook", 2, 200 * MiB, notebook),
        otherAppOf("Chatter", 4, 100 * MiB, chatter),
      ],
    }),
  });

const 다른앱 = (page: Page) => page.getByRole("tree", { name: "다른 앱", exact: true });
/** 다른 앱 줄의 앱 이름 — 화면에 선 차례 그대로다. */
const 앱차례 = (page: Page) =>
  다른앱(page)
    .getByRole("treeitem")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")?.split(", ")[0]));
const 앱줄 = (page: Page, name: string) => 다른앱(page).getByRole("treeitem", { name: new RegExp(`^${name}, `) });
const 멈춤말 = (page: Page) => page.getByText("줄 순서를 잠시 멈췄어요", { exact: true });
const 표밖 = (page: Page) => page.getByRole("heading", { name: "Processes", level: 1, exact: true });

test("포인터가 표 위에 있는 동안 다른 앱의 줄 순서가 멈추고(숫자는 새 값이다) 「줄 순서를 잠시 멈췄어요」가 서며, 포인터가 떠나면 새 차례로 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 앱장(9.1, 4.0, 1.7) });
  await page.goto("/processes");
  // 다른 앱은 처음에 접혀 있다 — 머리를 눌러 편다.
  await page.getByRole("region", { name: "다른 앱", exact: true }).getByRole("button", { name: "다른 앱", exact: true }).click();
  await expect.poll(() => 앱차례(page)).toEqual(["Sketchpad", "Notebook", "Chatter"]);

  // 둘째 줄에 포인터를 올린다. 차례가 그대로인 동안은 멈춤이 붙잡은 것이 없어 말이 안 선다(묶음 보기).
  await 앱줄(page, "Notebook").hover();
  await 스냅샷두박자(page);
  await expect(멈춤말(page)).toHaveCount(0);

  // CPU가 거꾸로 된 장을 두 박자 받는다 — 숫자는 새 값이고 차례는 그대로다.
  await replaceAnswer(page, "processes_snapshot", 앱장(1.0, 4.0, 12.5));
  await 스냅샷두박자(page);
  await expect(앱줄(page, "Chatter").locator('[data-cell="cpu"]')).toHaveText(formatCpu(12.5));
  await expect(앱줄(page, "Sketchpad").locator('[data-cell="cpu"]')).toHaveText(formatCpu(1.0));
  expect(await 앱차례(page)).toEqual(["Sketchpad", "Notebook", "Chatter"]);
  await expect(멈춤말(page)).toBeVisible();

  // 포인터가 표를 떠나면 그 장의 차례로 선다 — 말도 진다.
  await 표밖(page).hover();
  await expect.poll(() => 앱차례(page)).toEqual(["Chatter", "Notebook", "Sketchpad"]);
  await expect(멈춤말(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("CPU 순 보기에서는 포인터가 표 위에 있는 동안 「줄 순서를 잠시 멈췄어요」가 늘 서고, 떠나면 진다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 앱장(9.1, 4.0, 1.7) });
  await page.goto("/processes");
  const CPU순 = page.getByRole("group", { name: "보는 방법", exact: true }).getByRole("button", { name: "CPU 순", exact: true });
  await CPU순.click();
  await expect(CPU순).toHaveAttribute("aria-pressed", "true");
  // 앵커: 보기 도구 위(표 밖)에서는 말이 없다.
  await expect(멈춤말(page)).toHaveCount(0);

  await page.locator("[data-process-table]").getByRole("treeitem", { name: /^Notebook, / }).hover();
  await expect(멈춤말(page)).toBeVisible();
  await 표밖(page).hover();
  await expect(멈춤말(page)).toHaveCount(0);
});
