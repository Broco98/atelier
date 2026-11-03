import { expect, test, type Page } from "./evidence";
import { PROCESS_SUMMARY, summaryWith as 요약 } from "./fixtures";
import {
  callCount,
  installFixtureBackend,
  processesTitle,
  replaceAnswer,
  unknownIpcCalls,
  가는곳줄,
  주소로간다,
  시계를세운다,
} from "./harness";
import { formatNavMeta } from "@/features/processes/metrics";

// 위 칸 `Processes` 줄 끝 — **아틀리에 CPU · 메모리 합계만 선다**(restart 03-11 · 03-15d · 시안 Main `.ra-sr-row .end` 「13% · 3.3GB」). 값은
// 요약 폴러(10초)가 그 줄의 몸에서 묻는다(`ProcessesItem`). 한때(프로세스 티켓 29 – restart 03-14) 손볼 것(주인 잃은 셸 · 출처 불명 · 앱이
// 사람 손 없이 끝낸 정리 기록)이 본 뒤 새로 생기면 그 앞에 `●`가 섰다 — 시안에 없어 걷었다. 「손볼 것」은 `Processes`의 카드 · 구획의 뜻
// 하나다. 줄의 상자 · 글자 · 색은 틀과 사이드바 spec(`frame-sidebar.spec.ts`)과 시안 비교가 잰다. 끝의 글자(표기 함수)는 L2
// (`ProcessesNavMeta.test.tsx` · `metrics.test.ts`)가 잰다.
//
// **시계는 `page.clock`이다.** 주의 둘(`shell-ownerless.spec.ts`의 1.6초 검사 머리말): `install()`은 페이지를 열기 **전에**
// 부르고, 깐 뒤로 시간은 저절로 흐르므로 세기 전에 멈춘다(`시계를세운다`). 그 뒤로는 `runFor`만큼만 간다 — 10초 박자가 러너
// 속도에 안 흐려진다. 요약을 바꾸는 것은 01의 답 바꾸기다(`replaceAnswer`) — 바꾼 뒤 다음 박자가 그 답을 가져온다.

/** 요약 박자 하나(10초)를 넘긴다 — 그사이 요약이 **실제로 다시 불렸는지**를 함께 본다(안 불렸으면 아래 단언이 헛돈다). */
async function 박자(page: Page): Promise<void> {
  const before = await callCount(page, "processes_summary");
  await page.clock.runFor(10_000);
  await expect.poll(() => callCount(page, "processes_summary"), { message: "10초에 요약을 다시 안 물었다" }).toBeGreaterThan(before);
}

test("위 칸 Processes 줄 끝에는 CPU · 메모리만 서고, 요약 박자마다 새 값이 된다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page);
  await page.goto("/projects");
  const 줄 = 가는곳줄(page, "Processes");
  // 줄의 글은 이름과 끝의 「CPU · 메모리」뿐이다 — 점(`img`)이 없다. 앵커: 끝의 값이 섰다(같은 단언).
  await expect(줄).toHaveText(`Processes${formatNavMeta(PROCESS_SUMMARY.cpu, PROCESS_SUMMARY.total)}`);
  await expect(줄.getByRole("img")).toHaveCount(0);
  await 시계를세운다(page);

  // 다음 박자에 새 값이다.
  const 다음 = 요약({ cpu: 13.2, total: 3_543_348_019 });
  await replaceAnswer(page, "processes_summary", 다음);
  await 박자(page);
  await expect(줄).toHaveText(`Processes${formatNavMeta(다음.cpu, 다음.total)}`);

  // `Processes` 화면을 열어도 같은 줄이 같은 값을 든다 — 위 칸은 늘 서 있다. 시계를 세운 동안은 앱 안의 이동을 주소로 한다(위 칸 줄이
  // 하는 push와 같다).
  await 주소로간다(page, "/processes");
  await expect(processesTitle(page)).toBeVisible();
  await expect(줄).toHaveText(`Processes${formatNavMeta(다음.cpu, 다음.total)}`);
  await expect(줄.getByRole("img")).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
