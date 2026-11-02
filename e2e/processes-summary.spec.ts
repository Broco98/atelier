import { expect, test, type Page } from "./evidence";
import { summaryWith as 요약 } from "./fixtures";
import {
  callCount,
  가는곳줄,
  installFixtureBackend,
  주소로간다,
  processesTitle,
  replaceAnswer,
  unknownIpcCalls,
  시계를세운다,
  칠한값,
  칠한링,
  토큰값,
  토큰색,
} from "./harness";
import { formatCpu, formatHeadCpu, formatMemory, formatNavMeta } from "@/features/processes/metrics";
import {
  breakdownOf,
  identityOf,
  macOf,
  metricsOf,
  otherAppOf,
  processRow,
  snapshotFixture,
} from "@/features/processes/process-fixture";
import type { ProcessRow, ProcessSnapshot, TrendPoint } from "@/features/processes/types";

// 프로세스 티켓 30 · restart 03-5 · 03-6 · 03-11 — **맨 위 카드가 CPU · 메모리 · 손볼 것을 한 스냅샷에서 보이고, CPU 카드가 지난 1시간 추이를 두
// 선으로 그린다**(프로세스 결정 10 · 구현 스펙 「03 — Processes」의 「한 표본」 · 「추이」, 스토리 83 · 122 · 123 · 137).
//
// 어느 수를 무엇으로 세는지(머리 · 나눔 · 쌓인 막대 · 손볼 것)와 추이 선의 모양은 L2가 잰다(`summary-card.test.ts`), 스냅샷 · 요약 · 추이의
// 모양과 1시간 고리는 Rust L1이 잰다(`processes::summary` · `processes::screen`). 여기서 보는 것은 그 값이 **진짜 스냅샷 폴러 · 진짜 요약
// 폴러의 캐시**를 지나 카드에 서는가, 카드의 수가 10초 요약이 아니라 화면의 2초 스냅샷인가(「한 표본」), 그리고 카드가 새 박자를 안 거는가다.
// 한때(티켓 30) 카드는 타일 넷(메모리 합계 · CPU · 셸 · 고아)이었고 합계 · CPU를 요약에서, 셸 수를 스토어에서 읽었다.

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

const 카드 = (page: Page) => page.getByRole("region", { name: "요약", exact: true });
const 칸 = (page: Page, figure: string) => 카드(page).locator(`[data-figure="${figure}"]`);
const 추이 = (page: Page) => 카드(page).locator('svg[data-figure="trend"]');

const 행 = (pid: number): ProcessRow =>
  processRow(pid, 1, identityOf(pid).startedUs, "node", { argv0: "node", command: "node server.js" });

/**
 * 맥 전체 33.4%를 잰 장(코어 10개) — 아틀리에 12.6% · 다른 앱 9.1% · 시스템 · 못 읽음 11.7%, 아틀리에 메모리 합계 1.1GB, 웹뷰와 WebKit 도우미
 * 둘을 센 앱 본체. 확정 고아 셋(키 둘)과 출처 불명 하나가 섰다. 값은 꾸민 것이다(시안 Processes의 장면을 따랐다).
 */
const 장: ProcessSnapshot = snapshotFixture({
  verdict: {
    orphans: { confirmed: { "F-1": [행(4_001), 행(4_002)], "F-2": [행(4_003)] }, unknown: { "OLD-1": [행(5_001)] } },
  },
  mac: macOf(33.4, 14 * GiB),
  atelier: { total: 1_234_567_890, cpu: 12.6, app: 734_003_200, webviewExcluded: false },
  body: { rust: metricsOf(180 * MiB, 0.7), webview: metricsOf(640 * MiB, 1.3), webkit: ["GPU", "Networking"] },
  breakdown: breakdownOf({
    apps: [otherAppOf("Sketchpad", 4, 900 * MiB, 9.1)],
    system: { cpu: 11.7, memory: 2 * GiB },
    total: { cpu: 33.4, memory: 14 * GiB },
  }),
});

/** 지난 1시간 안에 고르게 선 CPU `count`점(맥 전체 · 아틀리에 — restart 03-5) — 마지막 점이 지금이다. */
function 점들(count: number): TrendPoint[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, at) => ({ at: now - (count - 1 - at) * 60_000, mac: 20 + at, atelier: 2 + at / 10 }));
}

/**
 * 멈춘 시계를 nav 메타의 요약 박자가 한 번 지날 때까지 조금씩 흘린다 — 돌아오면 박자 바로 뒤(250ms 안)다. 흘리는 동안 react-query가
 * 0ms 타이머로 미룬 알림도 풀린다.
 */
async function 박자직후(page: Page): Promise<void> {
  const before = await callCount(page, "processes_summary");
  for (let step = 0; step < 50 && (await callCount(page, "processes_summary")) === before; step += 1) {
    await page.clock.runFor(250);
  }
  expect(await callCount(page, "processes_summary"), "12초 넘게 요약 박자가 안 왔다").toBeGreaterThan(before);
}

/**
 * 그린 추이 선의 점 수 — 선(`polyline`)마다 좌표 쌍을 센다. 맥 전체 · 아틀리에 두 선이고(restart 03-11), 선이 없으면 0이다. 두 선은 같은 점에서
 * 그리므로 수가 같다 — 갈리면 그대로 드러나게 둘을 함께 돌려준다.
 */
async function 그린점(page: Page): Promise<{ mac: number; atelier: number }> {
  const count = async (name: string) => {
    const line = 추이(page).locator(`polyline[data-line="${name}"]`);
    if ((await line.count()) === 0) return 0;
    return ((await line.getAttribute("points")) ?? "").trim().split(/\s+/).filter(Boolean).length;
  };
  return { mac: await count("mac"), atelier: await count("atelier") };
}

// **한 표본**(구현 스펙 「03 — Processes」) — 화면을 보는 동안 머리와 줄과 메모리 카드가 같은 2초 스냅샷에서 나온다. 요약(10초 — nav 메타)은
// 일부러 다른 값을 실어, 카드가 그 값이 아님을 함께 본다(앵커: nav 메타는 요약의 값이다).
test("카드의 CPU · 메모리 · 손볼 것이 화면의 스냅샷 한 장에서 서고, nav 메타의 10초 요약과 섞이지 않는다", async ({ page }) => {
  const summary = 요약({ total: 3 * GiB, cpu: 5 });
  await installFixtureBackend(page, { processes_summary: summary, processes_snapshot: 장, processes_trend: 점들(5) });
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();

  // CPU — 머리는 합계 CPU의 정수, 아래 줄은 그 눈금(코어 몇 개만큼), 범례가 그것을 아틀리에 · 다른 앱 · 시스템 · 못 읽음 · 여유로 나눈다.
  await expect(칸(page, "cpu")).toHaveText(formatHeadCpu(33.4));
  await expect(칸(page, "cpu-note")).toHaveText("맥 전체 · 코어 10개 중 3.3개만큼");
  for (const part of ["아틀리에 13%", "다른 앱 9%", "시스템 · 못 읽음 11%", "여유 67%"]) {
    await expect(칸(page, "legend")).toContainText(part);
  }
  await expect(칸(page, "stack")).toHaveAttribute("aria-label", /^맥 전체 33% 사용 — 아틀리에 13%, 다른 앱 9%/);
  // 머리 숫자는 표 끝 합계 줄의 CPU를 정수로 반올림한 값이다(restart 03-6 「합이 맞는다」).
  await expect(page.locator('[data-ledger="total"] [data-cell="cpu"]')).toHaveText(formatCpu(33.4));

  // 메모리 — 아틀리에 전체. 웹뷰와 WebKit 도우미를 셌다 — 「웹뷰 제외」가 없고, 툴팁이 함께 센 갈래를 말한다(restart 03-8).
  await expect(칸(page, "total")).toHaveText(formatMemory(장.atelier.total));
  await expect(칸(page, "app")).toHaveText("아틀리에 전체 · 활성 상태 보기와 같은 값");
  await expect(칸(page, "app")).toHaveAttribute("title", "Rust 본체와 웹뷰(WebContent · GPU · Networking)를 세요.");

  // 손볼 것 — 확정 고아 + 출처 불명. 아래 「손볼 것」 구획에서 끝낸다.
  await expect(칸(page, "strays")).toHaveText("4개");
  await expect(칸(page, "strays-note")).toHaveText("주인 없이 남은 프로세스 · 아래에서 끝낼 수 있어요");

  // 지난 1시간 — 두 선이 같은 점 수로 선다.
  await expect.poll(() => 그린점(page)).toEqual({ mac: 5, atelier: 5 });

  // 앵커: nav 메타는 10초 요약의 값이다 — 카드가 요약을 안 읽은 것이 「요약이 없어서」가 아니다.
  await expect(가는곳줄(page, "Processes")).toContainText(formatNavMeta(summary.cpu, summary.total)!);
  await expect(칸(page, "total")).not.toHaveText(formatMemory(summary.total));

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 웹뷰(WebContent)의 pid를 못 물었거나 못 읽었으면 앱 본체는 Rust 본체뿐이다(S39) — 카드가 그렇다고 말한다. WebKit 도우미도 못 찾았으면
// 툴팁이 GPU · Networking을 안 셌다고 말한다(restart 03-8).
test("웹뷰를 못 센 스냅샷이면 메모리 카드 아래 줄에 「웹뷰 제외」가 붙고, 툴팁이 그 까닭을 말한다", async ({ page }) => {
  await installFixtureBackend(page, {
    processes_snapshot: snapshotFixture({ atelier: { total: 400 * MiB, cpu: null, app: 400 * MiB, webviewExcluded: true } }),
  });
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(칸(page, "total")).toHaveText(formatMemory(400 * MiB));
  await expect(칸(page, "app")).toHaveText("아틀리에 전체 · 활성 상태 보기와 같은 값 · 웹뷰 제외");
  await expect(칸(page, "app")).toHaveAttribute("title", /못 셌어요/);
  await expect(칸(page, "app")).toHaveAttribute("title", /GPU · Networking/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("추이의 점 수만큼 두 선이 서고, 이름이 두 선의 처음과 끝을 말한다", async ({ page }) => {
  await page.clock.install();
  const seven = 점들(7);
  await installFixtureBackend(page, { processes_trend: seven });
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect.poll(() => 그린점(page)).toEqual({ mac: 7, atelier: 7 });
  // 접근성 이름은 처음과 끝의 맥 전체 · 아틀리에 CPU다 — 선의 모양은 눈의 것이다.
  await expect(추이(page)).toHaveAttribute(
    "aria-label",
    `지난 1시간 CPU 추이, 맥 전체 ${formatCpu(seven[0].mac)}에서 ${formatCpu(seven[6].mac)}, 아틀리에 ${formatCpu(seven[0].atelier)}에서 ${formatCpu(seven[6].atelier)}`,
  );
  await 시계를세운다(page);

  // 앵커: 추이가 바뀌면 다음 요약 박자에 선도 바뀐다 — 픽스처의 기본(빈 고리)이나 첫 답에 굳은 그림이 아니다.
  await replaceAnswer(page, "processes_trend", 점들(3));
  await page.clock.runFor(10_000);
  await expect.poll(() => 그린점(page)).toEqual({ mac: 3, atelier: 3 });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **카드는 새 박자를 걸지 않는다**(티켓 30). 요약은 nav 메타의 10초 박자 하나로만 오고(카드가 또 묻지 않는다), 추이는 그 요약이 올
// 때마다 한 번 묻는다. 화면을 떠나면 추이는 멎는다 — 요약은 nav 메타의 것이라 계속 온다(앵커).
//
// 화면은 nav 메타보다 **늦게, 박자 사이에** 연다 — 둘이 같은 순간에 서면 react-query가 겹친 물음을 하나로 접어, 카드가 제 박자를 걸어도
// 수가 안 는다(실측: 주소로 곧바로 연 검사는 그 변형에서 초록이었다).
test("추이는 요약이 올 때마다 한 번 묻고, 카드가 요약을 더 묻지 않으며, 화면을 떠나면 추이를 묻지 않는다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, { processes_trend: 점들(4) });
  await page.goto("/projects");
  await expect.poll(() => callCount(page, "processes_summary")).toBeGreaterThan(0);
  await 시계를세운다(page);
  await page.clock.runFor(4_000);

  // 시계를 세운 동안은 앱 안의 이동을 주소로 한다(위 칸 줄이 하는 push와 같다) — 누르기의 대기가 세운 시계의 프레임에 걸리지 않게.
  await 주소로간다(page, "/processes");
  await expect(processesTitle(page)).toBeVisible();
  // 셈은 nav 메타의 박자 **바로 뒤**에서 시작한다 — 그래야 아래 10초에 박자가 정확히 하나, 5초에는 없다.
  await 박자직후(page);
  await expect.poll(() => 그린점(page)).toEqual({ mac: 4, atelier: 4 });
  const summaries = await callCount(page, "processes_summary");
  const trends = await callCount(page, "processes_trend");
  await page.clock.runFor(10_000);
  await expect.poll(() => callCount(page, "processes_trend"), { message: "요약이 왔는데 추이를 안 물었다" }).toBe(trends + 1);
  expect(await callCount(page, "processes_summary"), "카드가 요약에 박자를 하나 더 걸었다").toBe(summaries + 1);
  // 요약 박자 사이에는 묻지 않는다 — 추이만의 박자가 없다.
  await page.clock.runFor(5_000);
  expect(await callCount(page, "processes_trend")).toBe(trends + 1);

  await 주소로간다(page, "/terminal");
  await expect(processesTitle(page)).toHaveCount(0);
  const left = await callCount(page, "processes_trend");
  const summariesLeft = await callCount(page, "processes_summary");
  await page.clock.runFor(20_000);
  // 앵커: 요약은 그동안에도 왔다 — 추이가 멎은 것이 박자가 없어서가 아니다.
  await expect.poll(() => callCount(page, "processes_summary")).toBeGreaterThan(summariesLeft);
  expect(await callCount(page, "processes_trend")).toBe(left);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// restart 03-11 — **카드가 시안 Processes의 `.pr-cards`다**(스토리 137). CPU 카드 하나와 그 옆에 위아래로 메모리 · 손볼 것 카드가 1.7 : 1로 서고
// 사이는 8이다. 카드마다 옅은 면(`surface-under`) · `radius-card` · 0.5px `border` 안쪽 링 · 안쪽 14 · 16이다. 이름 줄은 12/18 `fg-tertiary`(앞
// 아이콘 14), CPU의 큰 수는 `heading-xl`, 옆 카드의 큰 수는 `heading-md`(시안 22 — 앱 글자 단계에 없어 20), 아래 줄은 12/18 `fg-tertiary`다.
// 추이의 두 선은 맥 전체 `fg-tertiary` · 아틀리에 `accent-solid`다. 칠해진 값을 토큰을 칠한 값과 맞대고, 시안이 못박은 수는 따로 센다 — 토큰
// 값이 바뀌는 날 견줌이 함께 흘러가 초록으로 남지 않게(`prose.spec.ts`와 같은 길). 한때(codex-ds 티켓 22) DS `.at-tiles`의 타일 넷이었다.
test("카드가 시안 카드다 — CPU 1.7 : 옆 1 · 사이 8, 옆 카드 둘이 위아래로, 면 · 반경 · 링 · 안쪽, 이름 12 · 큰 수 heading-xl · 옆 heading-md · 아래 줄 12, 두 선의 색", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 장, processes_trend: 점들(5) });
  await page.goto("/processes");
  await expect(칸(page, "total")).toHaveText(formatMemory(장.atelier.total));
  await expect.poll(() => 그린점(page)).toEqual({ mac: 5, atelier: 5 });

  // 배치 — CPU 카드와 옆 열이 한 줄에 1.7 : 1로, 사이 8. 옆 열은 메모리 · 손볼 것 카드가 같은 폭으로 위아래 8을 두고 선다.
  const [CPU카드, 옆열] = [카드(page).locator(":scope > div").nth(0), 카드(page).locator(":scope > div").nth(1)];
  await expect(카드(page).locator(":scope > div")).toHaveCount(2);
  expect(await 칠한값(카드(page), "column-gap"), "카드 사이").toEqual(["8px"]);
  const [cpu, side] = [(await CPU카드.boundingBox())!, (await 옆열.boundingBox())!];
  expect(Math.round(cpu.y), "한 줄").toBe(Math.round(side.y));
  expect(Math.round(side.x - (cpu.x + cpu.width)), "CPU → 옆 열").toBe(8);
  expect(cpu.width / side.width, "CPU : 옆 = 1.7 : 1").toBeCloseTo(1.7, 2);
  const 옆카드 = 옆열.locator(":scope > div");
  await expect(옆카드).toHaveCount(2);
  const [위, 아래] = [(await 옆카드.nth(0).boundingBox())!, (await 옆카드.nth(1).boundingBox())!];
  expect([위.x, 위.width], "옆 카드 둘 — 같은 폭").toEqual([아래.x, 아래.width]);
  expect(Math.round(아래.y - (위.y + 위.height)), "옆 카드 사이").toBe(8);

  // 카드 하나하나 — 면 · 반경 · 안쪽 · 링.
  const 반경 = await 토큰값(page, "border-top-left-radius", "--radius-card");
  expect(반경, "radius-card").toBe("8px");
  const 면 = await 토큰색(page, "--surface-under");
  const 선 = `${await 토큰색(page, "--border")} 0px 0px 0px 0.5px inset`;
  for (const one of [CPU카드, 옆카드.nth(0), 옆카드.nth(1)]) {
    const 모양 = ["background-color", "border-top-left-radius", "padding-top", "padding-bottom", "padding-left", "padding-right"];
    expect(await 칠한값(one, ...모양), "카드").toEqual([면, 반경, "14px", "14px", "16px", "16px"]);
    expect(await 칠한링(one), "카드의 링").toEqual([선]);
  }

  // 이름 — 12/18 · `fg-tertiary`, 앞 아이콘 14.
  const 옅은글자 = await 토큰색(page, "--fg-tertiary");
  for (const name of ["CPU", "메모리", "손볼 것"]) {
    const 이름 = 카드(page).getByText(name, { exact: true });
    expect(await 칠한값(이름, "font-size", "line-height", "color"), `이름 ${name}`).toEqual(["12px", "18px", 옅은글자]);
    const 아이콘 = (await 이름.locator("svg").boundingBox())!;
    expect([아이콘.width, 아이콘.height], `${name} 앞 아이콘`).toEqual([14, 14]);
  }

  // 큰 수 — CPU는 `heading-xl`, 옆 카드는 `heading-md`.
  const 단계 = async (name: string) => [
    await 토큰값(page, "font-size", `--text-${name}`),
    await 토큰값(page, "line-height", `--text-${name}--line-height`),
    await 토큰값(page, "font-weight", `--text-${name}--font-weight`),
  ];
  const [큰단계, 옆단계] = [await 단계("heading-xl"), await 단계("heading-md")];
  expect(큰단계, "heading-xl").toEqual(["32px", "38px", "600"]);
  expect(옆단계, "heading-md").toEqual(["20px", "26px", "600"]);
  expect(await 칠한값(칸(page, "cpu"), "font-size", "line-height", "font-weight"), "CPU 큰 수").toEqual(큰단계);
  for (const figure of ["total", "strays"]) {
    expect(await 칠한값(칸(page, figure), "font-size", "line-height", "font-weight"), `옆 큰 수 ${figure}`).toEqual(옆단계);
  }

  // 아래 줄 — 12/18 `fg-tertiary`.
  for (const figure of ["cpu-note", "app", "strays-note"]) {
    expect(await 칠한값(칸(page, figure), "font-size", "line-height", "color"), `아래 줄 ${figure}`).toEqual(["12px", "18px", 옅은글자]);
  }

  // 추이 — 맥 전체는 `fg-tertiary`, 아틀리에는 `accent-solid`. 면은 없다(두 선을 견주는 그림이다).
  expect(await 칠한값(추이(page).locator('polyline[data-line="mac"]'), "stroke"), "맥 전체 선").toEqual([옅은글자]);
  expect(await 칠한값(추이(page).locator('polyline[data-line="atelier"]'), "stroke"), "아틀리에 선").toEqual([
    await 토큰색(page, "--accent-solid"),
  ]);
  await expect(추이(page).locator("polygon")).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
