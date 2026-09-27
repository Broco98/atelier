import { expect, test, type Page } from "./evidence";
import { MAISON_LANDING_ROOM, PROCESS_SUMMARY, PROJECTS, QUIET_SHELL, summaryWith as 요약 } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  fireWindowEvent,
  installFixtureBackend,
  ipcCallArgs,
  modeButton,
  navButton,
  navButtons,
  processesTitle,
  replaceAnswer,
  setWindowFocused,
  stubWindowFocus,
  unknownIpcCalls,
  시계를세운다,
} from "./harness";
import { formatMemory } from "@/features/processes/metrics";
import { NEEDS_LOOK_LABEL } from "@/features/processes/needs-look";
import { identityOf as 신원, processRow, snapshotFixture } from "@/features/processes/process-fixture";

// 프로세스 티켓 29 — **nav에 메모리 합계가 늘 서고, 손볼 것이 생기면 `●`가 선다**(프로세스 결정 9 · 11 · 프로세스 스펙 S40 · S41 · S42,
// 스토리 81 · 82).
//
// `●` 판정(본 집합 + 지금 집합)은 L2가 표로 잰다(`needs-look.test.ts`), 무엇이 `●`를 켜는 기록인지는 Rust L1이 잰다
// (`cleanup_log::look_head`). 여기서 보는 것은 요약 픽스처가 **진짜 요약 폴러(10초) · 진짜 사이드바 · 진짜 화면 열기와 창 포커스**를
// 지나 nav `Processes` 옆에 서고 꺼지는가다 — 합계 글자는 화면이 쓰는 그 표기 함수로 짓는다(모양은 L2의 몫).
//
// **시계는 `page.clock`이다.** 주의 둘(`shell-ownerless.spec.ts` 머리말): `install()`은 페이지를 열기 **전에** 부르고, 깐 뒤로 시간은
// 저절로 흐르므로 세기 전에 멈춘다(`시계를세운다`). 그 뒤로는 `runFor`만큼만 간다 — 10초 박자가 러너 속도에 안 흐려진다. 요약을 바꾸는
// 것은 01의 답 바꾸기다(`replaceAnswer`) — 바꾼 뒤 다음 박자가 그 답을 가져온다.

const [project] = PROJECTS;

/** nav 항목 한 줄 — 버튼과 그 오른쪽 메타가 함께 선 상자(`SidebarItem`). 메타는 버튼 **밖**이다. */
const navRow = (page: Page, label: string) =>
  page.locator("aside nav > div").filter({ has: page.getByRole("button", { name: label, exact: true }) });
const 점 = (page: Page) => navRow(page, "Processes").getByRole("img", { name: NEEDS_LOOK_LABEL, exact: true });

/** 스냅샷 박자 하나를 넘긴다 — 멈춘 시계를 조금씩 흘려 화면이 스냅샷을 **실제로 다시 물을 때까지**(`processes-shells.spec.ts`의 `다음박자`). */
async function 스냅샷박자(page: Page): Promise<void> {
  const before = await callCount(page, "processes_snapshot");
  for (let step = 0; step < 20 && (await callCount(page, "processes_snapshot")) === before; step += 1) {
    await page.clock.runFor(250);
  }
  expect(await callCount(page, "processes_snapshot"), "5초 넘게 스냅샷 박자가 안 왔다").toBeGreaterThan(before);
}

/** 요약 박자 하나(10초)를 넘긴다 — 그사이 요약이 **실제로 다시 불렸는지**를 함께 본다(안 불렸으면 아래 단언이 헛돈다). */
async function 박자(page: Page): Promise<void> {
  const before = await callCount(page, "processes_summary");
  await page.clock.runFor(10_000);
  await expect.poll(() => callCount(page, "processes_summary"), { message: "10초에 요약을 다시 안 물었다" }).toBeGreaterThan(before);
}

test("nav Processes 옆에 앱 전체 메모리 합계가 두 세계 모두에서 선다", async ({ page }) => {
  const summary = 요약({ total: 1_234_567_890 });
  await installFixtureBackend(page, { processes_summary: summary });
  await page.goto("/projects");
  await expect(page).toHaveURL(`/projects/${project.slug}`);

  // 표기 함수의 결과가 선다 — 결정 10 그림의 「아틀리에 합계」다. 픽스처의 기본 합계(3.4GB)가 아니라 이 시나리오의 값이다.
  const total = formatMemory(summary.total);
  await expect(navRow(page, "Processes")).toContainText(total);
  // 메타는 버튼 밖이다 — nav를 이름으로 집는 길이 그대로다. 다른 nav 행에는 안 선다. 손볼 것이 없으니 점도 없다.
  await expect(navButtons(page)).toHaveText(["Projects", "Terminal", "Processes", "Archive"]);
  await expect(navRow(page, "Archive")).not.toContainText(total);
  await expect(점(page)).toHaveCount(0);

  // 저쪽 세계에서도 같은 값이다 — 이 메타는 「이 세계의 것만 센다」의 예외다(프로세스 결정 9).
  await modeButton(page, "Maison").click();
  await expect(page).toHaveURL(`/maison/rooms/${MAISON_LANDING_ROOM.slug}`);
  await expect(navButtons(page)).toHaveText(["Terminal", "Processes", "Archive"]);
  await expect(navRow(page, "Processes")).toContainText(total);
  await expect(점(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("손볼 것이 새로 생기면 ●가 서고, 화면을 열면 꺼지며, 본 것은 남아 있어도 다시 안 선다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto("/projects");
  await expect(navRow(page, "Processes")).toContainText(formatMemory(PROCESS_SUMMARY.total));
  await expect(점(page)).toHaveCount(0);
  await 시계를세운다(page);

  // 출처 불명 하나가 새로 선다 — 요약의 신원 목록에 하나를 더한다.
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [신원(4_101)] }));
  await 박자(page);
  await expect(점(page)).toBeVisible();

  // 화면을 연다(창 포커스 있음) — 그 순간 꺼진다.
  await navButton(page, "Processes").click();
  await expect(processesTitle(page)).toBeVisible();
  await expect(점(page)).toHaveCount(0);

  // 떠나도 다시 안 선다 — 그 출처 불명은 아직 남아 있지만 본 것이다.
  await navButton(page, "Projects").click();
  await expect(processesTitle(page)).toHaveCount(0);
  await 박자(page);
  await expect(점(page)).toHaveCount(0);

  // 하나가 사라지고 다른 하나가 생긴다 — 수는 그대로 하나인데 새것이다.
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [신원(4_202)] }));
  await 박자(page);
  await expect(점(page)).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 「봤다」는 띠와 같다 — 화면이 열려 있고 **창에 포커스가 있을 때**다(S41). 헤드리스 WebKit은 `document.hasFocus()`가 늘 참이라 그 한
// 줄을 손으로 잡는다(`stubWindowFocus`).
test("창에 포커스가 없으면 화면이 열려 있어도 본 것이 아니고, 창이 앞으로 오면 그 순간 꺼진다", async ({ page }) => {
  await stubWindowFocus(page);
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(navRow(page, "Processes")).toContainText(formatMemory(PROCESS_SUMMARY.total));
  await 시계를세운다(page);

  await setWindowFocused(page, false);
  await fireWindowEvent(page, "blur");
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [신원(4_303)] }));
  await 박자(page);
  await expect(점(page), "창이 뒤에 있는데 화면이 열려 있다고 본 것으로 쳤다").toBeVisible();

  await setWindowFocused(page, true);
  await fireWindowEvent(page, "focus");
  await expect(점(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **화면에서 본 것은 본 것이다 — 요약이 늦어도**(티켓 29 · S41). 요약은 배경 표본(10초)을 nav가 10초마다 가져오니 최대 20초 늦다.
// 화면은 2초 스냅샷으로 새 출처 불명과 새 정리 기록을 먼저 보인다 — 「봤다」가 요약으로만 앉으면 화면에서 본 그것이 떠난 뒤 늦은
// 요약에 실려 점을 켠다. 그래서 보는 동안 화면이 스냅샷의 손볼 것도 본 것으로 앉힌다. 박자는 `page.clock`으로 넘긴다.
test("화면을 보는 동안 스냅샷에 새로 선 출처 불명 · 정리 기록은 요약이 늦게 실어 와도 떠난 뒤 ●를 켜지 않는다", async ({ page }) => {
  const 불명 = processRow(4_404, 1, 신원(4_404).startedUs, "sleep");
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(navRow(page, "Processes")).toContainText(formatMemory(PROCESS_SUMMARY.total));
  await 시계를세운다(page);

  // 스냅샷에만 선다 — 요약은 아직 옛 장(손볼 것 없음)이다.
  await replaceAnswer(
    page,
    "processes_snapshot",
    snapshotFixture({ verdict: { orphans: { confirmed: {}, unknown: { "OLD-1": [불명] } } }, recordHead: 5 }),
  );
  await 스냅샷박자(page);
  await expect(page.getByRole("region", { name: "출처 불명", exact: true })).toBeVisible();
  await expect(점(page)).toHaveCount(0);

  // 떠난 뒤에야 요약이 그 둘을 싣는다.
  await navButton(page, "Projects").click();
  await expect(processesTitle(page)).toHaveCount(0);
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [불명.id], recordHead: 5 }));
  await 박자(page);
  await expect(점(page), "화면에서 본 출처 불명 · 정리 기록을 늦은 요약이 새것으로 켰다").toHaveCount(0);

  // 앵커: 화면이 못 본 것은 켠다 — 「안 선다」가 점을 못 켜는 화면이라서가 아니다.
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [불명.id, 신원(4_405)], recordHead: 5 }));
  await 박자(page);
  await expect(점(page)).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 사람이 ×로 닫은 셸의 기록은 `●`를 켜는 기록이 아니다 — Rust가 요약의 머리를 안 옮긴다(`cleanup_log::look_head`의 L1). 여기서 재는
// 것은 프런트가 **닫기 자체로** 점을 켜지 않는다는 것이다: 셸이 닫히고 요약이 다시 와도(앵커) 머리가 그대로면 안 선다.
test("사람이 닫은 셸의 정리 기록으로는 ●가 서지 않는다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, {
    pty_close_check: QUIET_SHELL,
    processes_summary: 요약({ recordHead: 3 }),
  });
  // 먼저 화면을 본다 — 그때 있던 자동 기록(머리 3)은 본 것이 된다.
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(navRow(page, "Processes")).toContainText(formatMemory(PROCESS_SUMMARY.total));
  await expect(점(page)).toHaveCount(0);

  await navButton(page, "Terminal").click();
  await expect(page).toHaveURL("/terminal");
  await awaitSpawned(page, 1);
  await 시계를세운다(page);
  // 떠 있는 셸은 손볼 것이 아니다 — 주인 잃음 표시가 선 셸만 센다.
  await 박자(page);
  await expect(점(page)).toHaveCount(0);

  // ×로 닫는다 — 까닭 「셸 닫기」가 나간다. 백엔드는 이 닫기를 정리 기록에 적지만 머리는 그대로 3이다.
  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').first().click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "pty_kill", "id")).map(({ args }) => args.reason))
    .toEqual(["shellClose"]);
  await 박자(page);
  await expect(점(page)).toHaveCount(0);

  // 앵커: 같은 자리에서 자동 기록이 새로 서면(머리가 옮는다) 켜진다 — 「안 선다」가 점을 못 켜는 화면이라서가 아니다.
  await replaceAnswer(page, "processes_summary", 요약({ recordHead: 4 }));
  await 박자(page);
  await expect(점(page)).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});
