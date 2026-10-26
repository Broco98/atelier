import { expect, test, type Locator, type Page } from "./evidence";
import { PROCESS_SUMMARY, QUIET_SHELL, summaryWith as 요약 } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  fireWindowEvent,
  installFixtureBackend,
  kills,
  processesTitle,
  replaceAnswer,
  setWindowFocused,
  stubWindowFocus,
  unknownIpcCalls,
  사람메뉴로간다,
  주소로간다,
  사람줄,
  시계를세운다,
  칸들,
} from "./harness";
import { formatMemory } from "@/features/processes/metrics";
import { NEEDS_LOOK_LABEL, SEEN_CAP, SUMMARY_LAG_MS } from "@/features/processes/needs-look";
import { identityOf as 신원, processRow, snapshotFixture } from "@/features/processes/process-fixture";

// 프로세스 티켓 29 — **손볼 것이 생기면 `●`가 선다**(프로세스 결정 9 · 11 · 프로세스 스펙 S40 · S41 · S42, 스토리 81 · 82).
//
// `●` 판정(본 집합 + 지금 집합)은 L2가 표로 잰다(`needs-look.test.ts`), 무엇이 `●`를 켜는 기록인지는 Rust L1이 잰다
// (`cleanup_log::look_head`). 여기서 보는 것은 요약 픽스처가 **진짜 요약 폴러(10초) · 진짜 사이드바 · 진짜 화면 열기와 창 포커스**를
// 지나 `●`가 서고 꺼지는가다. 그 메타(합계 · `●`)는 한때 nav `Processes` 옆에, 그 뒤(v1 티켓 07 · S27) 사람 줄 오른쪽에 늘 섰고, 02
// 티켓 04가 사람 메뉴의 `Processes` 줄 끝으로 옮겼다(02 스펙 S12 · 스토리 32) — 그래서 여기서는 메뉴를 열어 그 줄을 읽는다(`메타를본다`).
// 폴러는 메뉴가 닫혀도 사람 줄의 몸에서 돈다(02 결정 「04 · 메모리 합계 폴러」) — `박자`는 메뉴가 닫힌 채 요약이 다시 불리는 것을 센다.
// 합계가 그 줄에 서는 것(표기 함수의 글자)은 틀과 사이드바 spec(`frame-sidebar.spec.ts`)이 잰다.
//
// **시계는 `page.clock`이다.** 주의 둘(`shell-ownerless.spec.ts`의 1.6초 검사 머리말): `install()`은 페이지를 열기 **전에**
// 부르고, 깐 뒤로 시간은 저절로 흐르므로 세기 전에 멈춘다(`시계를세운다`). 그 뒤로는 `runFor`만큼만 간다 — 10초 박자가 러너
// 속도에 안 흐려진다. 요약을 바꾸는 것은 01의 답 바꾸기다(`replaceAnswer`) — 바꾼 뒤 다음 박자가 그 답을 가져온다.

/**
 * 사람 메뉴를 열어 `Processes` 줄을 `본다`에 넘기고 닫는다 — 메타(합계 · `●`)는 그 줄 끝에 선다(`PersonMenu`). 줄이 서고 합계를 품었다는
 * 것이 앵커다(「●가 없다」가 메뉴가 안 떠서 초록이 아니게). **시계를 세운 동안은 메뉴가 안 뜬다**(`사람메뉴로간다` 머리말) — 그래서 여는
 * 동안만 시계를 흘리고(`흘린다`) 닫은 뒤 다시 세운다. 흘린 동안 요약 박자가 하나 더 와도 `박자`는 앞뒤의 부른 수로 재므로 셈이 안
 * 어긋나고, 같은 답을 한 번 더 가져올 뿐이다.
 */
async function 메타를본다(page: Page, 본다: (줄: Locator) => Promise<void>, { 흘린다 = true } = {}): Promise<void> {
  if (흘린다) await page.clock.resume();
  await 사람줄(page).click();
  const 줄 = page.getByRole("menu").getByRole("menuitem", { name: /^Processes/ });
  await expect(줄).toBeVisible();
  await expect(줄).toContainText(formatMemory(PROCESS_SUMMARY.total));
  await 본다(줄);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  if (흘린다) await 시계를세운다(page);
}

const 점 = (줄: Locator) => 줄.getByRole("img", { name: NEEDS_LOOK_LABEL, exact: true });
/** 메뉴의 `Processes` 줄에 `●`가 선다. */
const 점이선다 = (page: Page, message?: string) => 메타를본다(page, (줄) => expect(점(줄), message).toBeVisible());
/** 메뉴의 `Processes` 줄에 `●`가 없다 — 줄과 합계가 선 것을 앵커로 본 뒤다. */
const 점이없다 = (page: Page, message?: string) => 메타를본다(page, (줄) => expect(점(줄), message).toHaveCount(0));

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

test("손볼 것이 새로 생기면 ●가 서고, 화면을 열면 꺼지며, 본 것은 남아 있어도 다시 안 선다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto("/projects");
  await 메타를본다(page, (줄) => expect(점(줄)).toHaveCount(0), { 흘린다: false });
  await 시계를세운다(page);

  // 출처 불명 하나가 새로 선다 — 요약의 신원 목록에 하나를 더한다.
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [신원(4_101)] }));
  await 박자(page);
  await 점이선다(page);

  // 화면을 연다(창 포커스 있음) — 그 순간 꺼진다.
  // 시계를 세운 동안은 사람 메뉴가 안 뜬다 — 메뉴가 하는 push를 주소로 한다(`사람메뉴로간다` 머리말).
  await 주소로간다(page, "/processes");
  await expect(processesTitle(page)).toBeVisible();
  await 점이없다(page);

  // 떠나도 다시 안 선다 — 그 출처 불명은 아직 남아 있지만 본 것이다.
  await 주소로간다(page, "/projects");
  await expect(processesTitle(page)).toHaveCount(0);
  await 박자(page);
  await 점이없다(page);

  // 하나가 사라지고 다른 하나가 생긴다 — 수는 그대로 하나인데 새것이다.
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [신원(4_202)] }));
  await 박자(page);
  await 점이선다(page);

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
  await 메타를본다(page, async () => {}, { 흘린다: false });
  await 시계를세운다(page);

  await setWindowFocused(page, false);
  await fireWindowEvent(page, "blur");
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [신원(4_303)] }));
  await 박자(page);
  await 점이선다(page, "창이 뒤에 있는데 화면이 열려 있다고 본 것으로 쳤다");

  await setWindowFocused(page, true);
  await fireWindowEvent(page, "focus");
  await 점이없다(page);

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
  await 메타를본다(page, async () => {}, { 흘린다: false });
  await 시계를세운다(page);

  // 스냅샷에만 선다 — 요약은 아직 옛 장(손볼 것 없음)이다.
  await replaceAnswer(
    page,
    "processes_snapshot",
    snapshotFixture({ verdict: { orphans: { confirmed: {}, unknown: { "OLD-1": [불명] } } }, recordHead: 5 }),
  );
  await 스냅샷박자(page);
  await expect(page.getByRole("region", { name: "출처 불명", exact: true })).toBeVisible();
  await 점이없다(page);

  // 떠난 뒤에야 요약이 그 둘을 싣는다.
  await 주소로간다(page, "/projects");
  await expect(processesTitle(page)).toHaveCount(0);
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [불명.id], recordHead: 5 }));
  await 박자(page);
  await 점이없다(page, "화면에서 본 출처 불명 · 정리 기록을 늦은 요약이 새것으로 켰다");

  // 앵커: 화면이 못 본 것은 켠다 — 「안 선다」가 점을 못 켜는 화면이라서가 아니다.
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [불명.id, 신원(4_405)], recordHead: 5 }));
  await 박자(page);
  await 점이선다(page);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **두 자리가 본 것은 합쳐 앉는다 — 저마다 상한을 넘어도**(S41 · 묶음 리뷰 minor M12). 상한(`SEEN_CAP`)은 「지금 것」 밖의 옛 것에만
// 걸리고, 지금 것은 두 자리(nav 메타 · 화면)가 저마다 마지막으로 앉힌 것의 합이다(`looked.ts`의 `markSeen`). 그 합은 두 자리가 **서로
// 다른 자리 이름**(`LookSite`)을 넘길 때만 선다 — 같은 이름이면 칸이 하나라 마지막에 앉힌 자리의 것만 지금 것이 되고, 그 수가 상한에
// 닿으면 다른 자리가 방금 본 것이 잘린다. 합치는 규칙은 L2(`looked.test`)가 자리 이름을 손으로 넘겨 잰다. 여기서 재는 것은 진짜
// 사이드바와 진짜 화면이 그 이름을 **다르게** 넘기는가다. 위 검사는 상한 아래 장면이라 이것을 못 가른다.
//
// 장면: 요약은 늦어 옛 출처 불명을 싣고, 화면은 새것을 먼저 보인다 — 겹치는 것 말고 저마다만 본 것이 있고, 저마다 상한을 넘는다.
// 화면이 먼저 보고 요약이 나중에 온다 — nav가 마지막에 앉히므로, 이름이 같으면 집합에 요약의 것만 남는 차례다. 떠난 뒤 요약이
// 화면이 본 것을 따라잡아 싣는다. **요약은 화면이 앉힌 뒤 요약이 늦는 때(`SUMMARY_LAG_MS`)가 지나서 온다** — 그 안이면 요약이 늦는
// 동안 본 것(`looked.ts`의 `recentlyMarked`)이 화면의 것을 쥐어 이름이 같아도 안 잘린다. 화면은 그동안 같은 장을 보여 다시 앉히지
// 않는다(앉히기는 손볼 것이 바뀔 때만 인다).
test("출처 불명이 상한을 넘어도 화면에서 본 것은 떠난 뒤 요약이 늦게 실어 와도 ●를 켜지 않는다", async ({ page }) => {
  const 신원들 = (from: number, count: number) => Array.from({ length: count }, (_, at) => 신원(from + at));
  const 수 = SEEN_CAP + 44;
  const 요약이본것 = 신원들(5_001, 수);
  const 화면이본것 = 신원들(5_051, 수);
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(processesTitle(page)).toBeVisible();
  await 메타를본다(page, async () => {}, { 흘린다: false });
  await 시계를세운다(page);

  await replaceAnswer(
    page,
    "processes_snapshot",
    snapshotFixture({
      verdict: {
        orphans: { confirmed: {}, unknown: { "OLD-1": 화면이본것.map((id) => processRow(id.pid, 1, id.startedUs, "sleep")) } },
      },
    }),
  );
  await 스냅샷박자(page);
  await expect(page.getByRole("region", { name: "출처 불명", exact: true })).toBeVisible();
  await page.clock.runFor(SUMMARY_LAG_MS);
  await replaceAnswer(page, "processes_summary", 요약({ unknown: 요약이본것 }));
  await 박자(page);
  await 점이없다(page);

  await 주소로간다(page, "/projects");
  await expect(processesTitle(page)).toHaveCount(0);
  await replaceAnswer(page, "processes_summary", 요약({ unknown: 화면이본것 }));
  await 박자(page);
  await 점이없다(page, "요약이 앉힐 때 화면에서 본 출처 불명이 상한 밖으로 잘렸다");

  // 앵커: 두 자리 모두 못 본 것은 켠다 — 「안 선다」가 점을 못 켜는 장면이라서가 아니다.
  await replaceAnswer(page, "processes_summary", 요약({ unknown: [...화면이본것, 신원(6_001)] }));
  await 박자(page);
  await 점이선다(page);

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
  await 메타를본다(page, (줄) => expect(점(줄)).toHaveCount(0), { 흘린다: false });

  await 사람메뉴로간다(page, "Terminal");
  await expect(page).toHaveURL("/terminal");
  await awaitSpawned(page, 1);
  await 시계를세운다(page);
  // 떠 있는 셸은 손볼 것이 아니다 — 주인 잃음 표시가 선 셸만 센다.
  await 박자(page);
  await 점이없다(page);

  // ×로 닫는다 — 까닭 「셸 닫기」가 나간다. 백엔드는 이 닫기를 정리 기록에 적지만 머리는 그대로 3이다.
  await 칸들(page).locator('button[aria-label$="닫기"]').first().click();
  await expect
    .poll(async () => (await kills(page)).map(({ reason }) => reason))
    .toEqual(["shellClose"]);
  await 박자(page);
  await 점이없다(page);

  // 앵커: 같은 자리에서 자동 기록이 새로 서면(머리가 옮는다) 켜진다 — 「안 선다」가 점을 못 켜는 화면이라서가 아니다.
  await replaceAnswer(page, "processes_summary", 요약({ recordHead: 4 }));
  await 박자(page);
  await 점이선다(page);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
