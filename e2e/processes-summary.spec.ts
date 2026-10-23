import { expect, test, type Page } from "./evidence";
import { BUSY_SHELL, shellKeyOf, summaryWith as 요약, WORKS } from "./fixtures";
import {
  archiveByMcp,
  awaitSpawned,
  callCount,
  fireAttention,
  installFixtureBackend,
  사람메뉴로간다,
  주소로간다,
  openShell,
  processesTitle,
  replaceAnswer,
  typeIntoShell,
  unknownIpcCalls,
  시계를세운다,
  칠한값,
  칠한링,
  토큰값,
  토큰색,
} from "./harness";
import { formatCpu, formatMemory } from "@/features/processes/metrics";
import { identityOf, poolShell, processRow, snapshotFixture } from "@/features/processes/process-fixture";
import type { ProcessRow, TrendPoint } from "@/features/processes/types";

// 프로세스 티켓 30 — **요약 카드가 합계와 한 시간 추이와 앱 본체를 보인다**(프로세스 결정 10 · 프로세스 스펙 S37 · S39, 스토리 83).
//
// 어느 수를 무엇으로 세는지(셸 상태 · 주인 잃은 셸 · 두 고아 묶음)와 스파크라인의 모양은 L2가 잰다(`summary-card.test.ts`), 요약과 추이의
// 모양 · 1시간 고리는 Rust L1이 잰다(`processes::summary`). 여기서 보는 것은 그 값이 **진짜 요약 폴러의 캐시 · 진짜 스냅샷 폴러 · 진짜
// 스토어(진짜로 띄운 셸 · 진짜 셸 상태 · 진짜 MCP 아카이브 감지)**를 지나 화면 맨 위 카드에 서는가, 그리고 카드가 새 박자를 안 거는가다.

const [, plainWork] = WORKS;

const 카드 = (page: Page) => page.getByRole("region", { name: "요약", exact: true });
const 칸 = (page: Page, figure: string) => 카드(page).locator(`[data-figure="${figure}"]`);
const 추이 = (page: Page) => 카드(page).locator('svg[data-figure="trend"]');

const 행 = (pid: number): ProcessRow =>
  processRow(pid, 1, identityOf(pid).startedUs, "node", { argv0: "node", command: "node server.js" });

/** 풀에 셸 셋(둘은 스토어의 셸, 하나는 스토어가 모르는 셸)이 앉고, 확정 고아 셋(키 둘)과 출처 불명 하나가 선 스냅샷. */
const 스냅샷 = snapshotFixture({
  verdict: {
    orphans: { confirmed: { "F-1": [행(4_001), 행(4_002)], "F-2": [행(4_003)] }, unknown: { "OLD-1": [행(5_001)] } },
  },
  pool: [1, 2, 99].map((pty) => poolShell(pty, shellKeyOf(pty), Date.now())),
});

/** 지난 1시간 안에 고르게 선 합계 `count`점 — 마지막 점이 지금이다. */
function 점들(count: number): TrendPoint[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, at) => ({ at: now - (count - 1 - at) * 60_000, total: (2_000 + at * 100) * 1024 * 1024 }));
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

/** 그린 스파크라인의 점 수 — 선(`polyline`)의 좌표 쌍을 센다. 선이 없으면 0이다. */
async function 그린점(page: Page): Promise<number> {
  const line = 추이(page).locator("polyline");
  if ((await line.count()) === 0) return 0;
  return ((await line.getAttribute("points")) ?? "").trim().split(/\s+/).filter(Boolean).length;
}

test("요약 카드에 합계 · 추이 · CPU · 셸 수 · 도는 중 · 주인 잃은 셸 · 확정 고아 · 출처 불명 · 앱 본체가 선다", async ({ page }) => {
  const summary = 요약({ total: 1_234_567_890, cpu: 37.4, app: 734_003_200, webviewExcluded: false });
  await installFixtureBackend(page, {
    processes_summary: summary,
    processes_snapshot: 스냅샷,
    processes_trend: 점들(5),
    // 두 셸 모두 조용하지 않다 — MCP 아카이브가 닫지 않고 주인 잃은 셸로 남긴다.
    pty_close_checks: { 1: BUSY_SHELL, 2: BUSY_SHELL },
  });
  // 그냥 일에 셸 둘을 띄우고(사람이 친 셸 · `+`로 연 셸) 둘 다 claude가 돌게 한다 — 셸 상태 「도는 중」.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);
  await fireAttention(page, { agent: "claude", event: "UserPromptSubmit", at: Date.now() }, 1);
  await fireAttention(page, { agent: "claude", event: "UserPromptSubmit", at: Date.now() }, 2);
  // MCP가 그 work을 아카이브했다 — 목록에서 빠지고 감시자의 이벤트가 온다. 두 셸은 주인 잃은 셸로 남는다.
  await archiveByMcp(page, WORKS, plainWork.slug);
  await expect.poll(() => callCount(page, "pty_close_checks")).toBe(1);

  await 사람메뉴로간다(page, "Processes");
  await expect(processesTitle(page)).toBeVisible();
  // 합계 · CPU · 앱 본체는 요약(nav 메타와 같은 장)이다 — 표기 함수의 결과가 선다. 합계는 nav 옆 숫자와 같다. 타일의 큰 수는 단위를
  // 작게 그려도 글자가 이어 붙어 표기 함수의 결과 그대로다(ui-refresh 판 06 — 타일 넷).
  await expect(칸(page, "total")).toHaveText(formatMemory(summary.total));
  await expect(칸(page, "cpu")).toHaveText(formatCpu(summary.cpu));
  await expect(칸(page, "app")).toHaveText(`앱 본체 ${formatMemory(summary.app)}`);
  // 셸 수는 풀의 셸이다(스토어가 모르는 셸도 든다) — 「셸」 타일의 큰 수다(타일 이름 「셸」은 따로 선다). 확정 고아 · 출처 불명은
  // 스냅샷의 두 묶음을 갈라 센다.
  await expect(칸(page, "shells")).toHaveText("3개");
  await expect(칸(page, "confirmed")).toHaveText("확정 고아 3");
  await expect(칸(page, "unknown")).toHaveText("출처 불명 1");
  // 도는 중 · 주인 잃은 셸은 스토어다 — 셸 상태로 세고, 두 셸 모두 주인을 잃었다.
  await expect(칸(page, "working")).toHaveText("도는 중 2");
  await expect(칸(page, "ownerless-shells")).toHaveText("주인 잃은 셸 2");
  // 지난 1시간 — 스파크라인이 선다.
  await expect(카드(page)).toContainText("지난 1시간");
  await expect.poll(() => 그린점(page)).toBe(5);
  // 웹뷰를 셌다 — 「웹뷰 제외」가 없다(아래 검사의 앵커). 툴팁은 GPU · Networking을 안 센다고 말한다.
  await expect(칸(page, "app")).not.toContainText("웹뷰 제외");
  await expect(칸(page, "app")).toHaveAttribute("title", /GPU · Networking/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 웹뷰(WebContent)의 pid를 못 물었거나 못 읽었으면 앱 본체는 Rust 본체뿐이다(S39) — 카드가 그렇다고 말한다.
test("웹뷰를 못 센 요약이면 앱 본체에 「웹뷰 제외」가 붙고, 툴팁이 그 까닭을 말한다", async ({ page }) => {
  const summary = 요약({ app: 400 * 1024 * 1024, webviewExcluded: true });
  await installFixtureBackend(page, { processes_summary: summary });
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(칸(page, "app")).toHaveText(`앱 본체 ${formatMemory(summary.app)}(웹뷰 제외)`);
  await expect(칸(page, "app")).toHaveAttribute("title", /못 셌어요/);
  await expect(칸(page, "app")).toHaveAttribute("title", /GPU · Networking/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("추이의 점 수만큼 스파크라인이 선다", async ({ page }) => {
  await page.clock.install();
  const seven = 점들(7);
  await installFixtureBackend(page, { processes_trend: seven });
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect.poll(() => 그린점(page)).toBe(7);
  // 접근성 이름은 처음과 끝의 합계다 — 선의 모양은 눈의 것이다.
  await expect(추이(page)).toHaveAttribute(
    "aria-label",
    `지난 1시간 합계 추이, ${formatMemory(seven[0].total)}에서 ${formatMemory(seven[6].total)}`,
  );
  await 시계를세운다(page);

  // 앵커: 추이가 바뀌면 다음 요약 박자에 선도 바뀐다 — 픽스처의 기본(빈 고리)이나 첫 답에 굳은 그림이 아니다.
  await replaceAnswer(page, "processes_trend", 점들(3));
  await page.clock.runFor(10_000);
  await expect.poll(() => 그린점(page)).toBe(3);

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

  // 시계를 세운 동안은 사람 메뉴가 안 뜬다 — 메뉴가 하는 push를 주소로 한다(`사람메뉴로간다` 머리말).
  await 주소로간다(page, "/processes");
  await expect(processesTitle(page)).toBeVisible();
  // 셈은 nav 메타의 박자 **바로 뒤**에서 시작한다 — 그래야 아래 10초에 박자가 정확히 하나, 5초에는 없다.
  await 박자직후(page);
  await expect.poll(() => 그린점(page)).toBe(4);
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

// codex-ds 티켓 22 — **요약 타일이 DS `ProcessTree`의 타일이다**(스토리 59 · DS `.at-tiles` · `.at-tile`). 넷이 한 줄에 10씩 떨어져
// 서고, 메모리 합계는 두 칸 몫(두 칸 + 그 사이 틈)이다. 타일은 `surface-under` · `radius-xl`(12) · 0.5px `border` 안쪽 링 · 안쪽 14 · 16 ·
// 줄 사이 4이고, 이름은 12/18 `fg-tertiary`(앞 아이콘 14), 큰 수는 `heading-lg`(24/28 · 600), 단위는 14/20 · 500 `fg-secondary`, 아래
// 줄은 12/18 `fg-tertiary`다. 추이는 선이 `accent-solid`이고 그 밑이 `accent-soft`다. 칠해진 값을 토큰을 칠한 값과 맞대고, DS가 못박은
// 수는 따로 센다 — 토큰 값이 바뀌는 날 견줌이 함께 흘러가 초록으로 남지 않게(`prose.spec.ts`와 같은 길).
test("요약 타일이 DS 타일이다 — 넷이 10씩 한 줄, 면 · 반경 · 링 · 안쪽, 이름 12 · 큰 수 heading-lg · 단위 14 · 아래 줄 12, 추이의 선과 면", async ({
  page,
}) => {
  const summary = 요약({ total: 3.4 * 1024 ** 3, cpu: 27, app: 610 * 1024 ** 2, webviewExcluded: false });
  await installFixtureBackend(page, { processes_summary: summary, processes_trend: 점들(5) });
  await page.goto("/processes");
  await expect(칸(page, "total")).toHaveText(formatMemory(summary.total));
  await expect.poll(() => 그린점(page)).toBe(5);

  // 줄 — 넷이 한 줄이고 사이는 10이다. 좁은 셋은 같은 폭이고, 메모리 합계는 그 두 칸에 사이 틈까지다.
  const 타일들 = 카드(page).locator(":scope > div");
  await expect(타일들).toHaveCount(4);
  expect(await 칠한값(카드(page), "column-gap"), "타일 사이").toEqual(["10px"]);
  const 상자들 = await 타일들.evaluateAll((tiles) =>
    tiles.map((tile) => {
      const box = tile.getBoundingClientRect();
      return { top: Math.round(box.top), width: box.width };
    }),
  );
  expect(new Set(상자들.map((box) => box.top)).size, "네 타일이 한 줄이 아니다").toBe(1);
  const [넓은, ...좁은] = 상자들.map((box) => box.width);
  for (const width of 좁은) expect(Math.round(width), "좁은 타일의 폭").toBe(Math.round(좁은[0]));
  expect(Math.round(넓은), "메모리 합계 = 두 칸 + 틈").toBe(Math.round(좁은[0] * 2 + 10));

  // 타일 하나하나 — 면 · 반경 · 안쪽 · 줄 사이 · 링.
  const 반경 = await 토큰값(page, "border-top-left-radius", "--radius-xl");
  expect(반경, "radius-xl").toBe("12px");
  const 면 = await 토큰색(page, "--surface-under");
  const 선 = `${await 토큰색(page, "--border")} 0px 0px 0px 0.5px inset`;
  for (const 타일 of await 타일들.all()) {
    const 모양 = ["background-color", "border-top-left-radius", "padding-top", "padding-bottom", "padding-left", "padding-right"];
    expect(await 칠한값(타일, ...모양, "row-gap"), "타일").toEqual([면, 반경, "14px", "14px", "16px", "16px", "4px"]);
    expect(await 칠한링(타일), "타일의 링").toEqual([선]);
  }

  // 이름 — 12/18 · +0.025em · `fg-tertiary`, 앞 아이콘 14.
  const 옅은글자 = await 토큰색(page, "--fg-tertiary");
  const 이름 = 카드(page).getByText("CPU", { exact: true });
  expect(await 칠한값(이름, "font-size", "line-height", "letter-spacing", "color"), "이름").toEqual(["12px", "18px", "0.3px", 옅은글자]);
  const 아이콘 = (await 이름.locator("svg").boundingBox())!;
  expect([아이콘.width, 아이콘.height], "이름 앞 아이콘").toEqual([14, 14]);

  // 큰 수 — `heading-lg`. 단위는 14/20 · 500 `fg-secondary`다.
  const 제목단계 = [
    await 토큰값(page, "font-size", "--text-heading-lg"),
    await 토큰값(page, "line-height", "--text-heading-lg--line-height"),
    await 토큰값(page, "font-weight", "--text-heading-lg--font-weight"),
  ];
  expect(제목단계, "heading-lg").toEqual(["24px", "28px", "600"]);
  for (const figure of ["total", "cpu", "shells"]) {
    expect(await 칠한값(칸(page, figure), "font-size", "line-height", "font-weight"), `큰 수 ${figure}`).toEqual(제목단계);
  }
  expect(await 칠한값(칸(page, "cpu").locator("span"), "font-size", "line-height", "font-weight", "color"), "단위").toEqual([
    "14px",
    "20px",
    "500",
    await 토큰색(page, "--fg-secondary"),
  ]);

  // 아래 줄 — 12/18 `fg-tertiary`.
  expect(await 칠한값(칸(page, "app"), "font-size", "line-height", "color"), "아래 줄").toEqual(["12px", "18px", 옅은글자]);

  // 추이 — 선은 `accent-solid`, 그 밑은 `accent-soft`다.
  expect(await 칠한값(추이(page).locator("polyline"), "stroke"), "추이 선").toEqual([await 토큰색(page, "--accent-solid")]);
  expect(await 칠한값(추이(page).locator("polygon"), "fill"), "추이 면").toEqual([await 토큰색(page, "--accent-soft")]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
