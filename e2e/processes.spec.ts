import { expect, test, type Page } from "./evidence";
import {
  callCount,
  가는곳으로간다,
  installFixtureBackend,
  processesTitle,
  unknownIpcCalls,
  주소로간다,
  시계를세운다,
} from "./harness";
import { formatHeadCpu } from "@/features/processes/metrics";
import { breakdownOf, macOf, processRow, snapshotFixture } from "@/features/processes/process-fixture";
import type { ProcessSnapshot } from "@/features/processes/types";

// 프로세스 티켓 26 — **`Processes`가 사이드바에 서고, 열려 있을 때만 스냅샷을 묻는다**(프로세스 결정 8 · 9 · 10, 스토리 79 ·
// 80 · 95). nav 배열과 라우트 표의 자리는 L2가 값으로 잰다(`nav-items.test.ts` · `router.test.ts`). 여기서 보는 것은 그 표가 **진짜 사이드바와
// 진짜 라우터**를 지나 화면이 서는가, 스냅샷이 화면까지 오는가, 그리고 떠나면 묻기가 멈추는가다 — 마지막은 진짜 타이머와
// 진짜 언마운트가 있어야 드러난다. 한때(v1 S27 – 02a-2) `Processes`는 사람 메뉴의 항목이었다 — 02a-3이 위 칸으로 올렸다.
//
// **시계는 `page.clock`이다.** 주의 둘(`shell-ownerless.spec.ts`의 1.6초 검사 머리말): `install()`은 페이지를 열기 **전에**
// 부르고, 깐 뒤로 시간은 저절로 흐르므로 세기 전에 멈춘다(`시계를세운다`). 그 뒤로는 `runFor`만큼만 간다 — 2초 박자가 러너
// 속도에 안 흐려진다.

/** 카드의 큰 수(restart 03-11) — CPU는 합계 CPU의 정수(restart 03-6), 손볼 것은 확정 고아 + 출처 불명의 수다. **카드 안에서 찾는다.** */
const 카드수 = (page: Page, figure: "cpu" | "strays") =>
  page.getByRole("region", { name: "요약", exact: true }).locator(`[data-figure="${figure}"]`);

/**
 * 이 장면의 스냅샷 — 맥 전체 CPU `cpu`%를 잰 장이고(머리 숫자는 그 합계다), 출처 불명이 `strays`개 섰다. 기본 픽스처는 맥 전체를 못 잰
 * 장(「—」)이고 손볼 것이 없다(「0개」) — 이 둘이 서면 화면이 **이 장면의 스냅샷**을 보인 것이다.
 */
const 장면 = (cpu: number, strays: number): ProcessSnapshot =>
  snapshotFixture({
    verdict: {
      orphans: {
        confirmed: {},
        unknown: { "X-1": Array.from({ length: strays }, (_, at) => processRow(500 + at, 1, 5_000 + at, "sleep")) },
      },
    },
    mac: macOf(cpu),
    breakdown: breakdownOf({ total: { cpu, memory: null } }),
  });

/** 카드가 이 장면의 수를 보인다 — 화면이 섰고 스냅샷이 화면까지 왔다는 앵커다. */
async function 장면이선다(page: Page, cpu: number, strays: number): Promise<void> {
  await expect(카드수(page, "cpu")).toHaveText(formatHeadCpu(cpu));
  await expect(카드수(page, "strays")).toHaveText(`${strays}개`);
}

test("Processes가 위 칸에서 Terminal 다음, Archive 앞에 서고, 누르면 그 화면이 열린다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 장면(31.4, 3) });
  // `/projects`는 목록 그 자리다 — 한때 첫 프로젝트 상세로 넘겼다(03 결정 「10」의 표 목록 앞).
  await page.goto("/projects");
  await expect(page.getByRole("table", { name: "Project 목록", exact: true })).toBeVisible();

  // **순서까지 본다**(프로세스 스펙 S43) — 「있다」만 재면 끝에 붙여도 초록이다. 위 칸은 「새 채팅」 · 「내 차례」 뒤로 가는 곳 다섯이다(restart
  // 02a-3 · 시안 Main). 줄 이름은 라벨로 시작한다 — `Processes` 끝에는 nav 메타가 붙는다(그 글은 `processes-nav-meta.spec`이 잰다).
  const 위칸 = page.getByRole("navigation", { name: "가는 곳", exact: true }).getByRole("button");
  await expect(위칸).toHaveText([/^새 채팅/, /^내 차례/, /^Services/, /^Projects/, /^Terminal/, /^Processes/, /^Archive$/]);
  await 가는곳으로간다(page, "Processes");
  await expect(page).toHaveURL("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await 장면이선다(page, 31.4, 3);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스냅샷이 화면까지 오는 길의 앵커 — 기본 픽스처(아무것도 못 잰 장)가 아니라 **이 시나리오의 장**이 선다. 주소로 곧바로 들어와도 선다.
test("주소로 곧바로 들어와도 이 장면의 스냅샷이 카드에 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 장면(57.6, 5) });
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await 장면이선다(page, 57.6, 5);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 95 — **화면이 닫혀 있을 때는 무거운 수집을 안 한다.** 스냅샷 한 장은 이 맥의 프로세스 표 전체와 판정이다.
test("화면에 있는 동안은 2초마다 스냅샷을 묻고, 화면을 떠나면 멈춘다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, { processes_snapshot: 장면(12, 2) });
  await page.goto("/processes");
  await 장면이선다(page, 12, 2);
  await 시계를세운다(page);

  // 앵커: 화면에 있는 동안은 는다 — **2초에 한 번**. 멈춘 것이 시계가 안 돌아서가 아니다.
  const opened = await callCount(page, "processes_snapshot");
  await page.clock.runFor(6_000);
  expect(await callCount(page, "processes_snapshot")).toBe(opened + 3);

  // 시계를 세운 동안은 앱 안의 이동을 주소로 한다(위 칸 줄이 하는 push와 같다) — 누르기의 대기가 세운 시계의 프레임에 걸리지 않게.
  await 주소로간다(page, "/terminal");
  await expect(page).toHaveURL("/terminal");
  await expect(processesTitle(page)).toHaveCount(0);
  const left = await callCount(page, "processes_snapshot");
  await page.clock.runFor(10_000);
  expect(await callCount(page, "processes_snapshot")).toBe(left);

  // 앵커: 돌아오면 다시 묻는다 — 멈춘 것은 화면이 떠나서다. 돌아온 순간 곧바로 한 번 묻고, **박자를 다시 건다**
  // (`snapshotQuery` 머리말). 곧바로의 한 번만 세면 박자가 다시 안 서도 초록이라, 그 한 번을 먼저 기다린 뒤 2초를 넘겨
  // 한 번 더 오는 것을 센다.
  await 주소로간다(page, "/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect.poll(() => callCount(page, "processes_snapshot")).toBeGreaterThan(left);
  const returned = await callCount(page, "processes_snapshot");
  await page.clock.runFor(2_000);
  expect(await callCount(page, "processes_snapshot")).toBe(returned + 1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
