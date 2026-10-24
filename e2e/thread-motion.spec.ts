import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls, 토큰시간 } from "./harness";
import { lineOf, linesThrough, record, sentPayloads, streamLines, summaryOf } from "./thread-records";
import type { ThreadView } from "@/features/thread/types";

// v1 티켓 45(PR ⑤ e2e) — **Thread의 움직임이 실제로 걸리고, 동작 줄이기면 하나도 없다**(v1 티켓 43 · 구현 스펙 §14 「모션」 · 캔버스 Motion
// 보드). 모션 토큰의 값 · 유틸리티가 그 토큰을 읽는지 · 동작 줄이기 블록에 드는지는 L2(`tokens.test.ts` · `motion-guard.test.ts`)가 소스에서
// 잰다. 이 층만 답할 수 있는 것은 **그 움직임이 진짜 CSS로 그 부품에 걸리는가**다 — 그래서 흐름 하나(승인 카드가 오르고, 고르면 결정 줄이
// 칩처럼 선다)만 두 번 밟는다: 보통일 때와 동작 줄이기(`prefers-reduced-motion`)일 때.
//
// **움직임의 시계로 잰다.** 카드가 서면 그 상자의 애니메이션을 멈추고 시각(`currentTime`)을 처음 · 끝으로 옮겨 그 장면의 자리를 읽는다 —
// 기다려서 재면 부하에 따라 장면이 갈린다. 길이는 토큰에서 읽는다(리터럴로 적으면 토큰을 고친 날 이 파일만 옛 길이를 잰다).
//
// 줄은 L1이 축복한 「파일 쓰기를 매번 묻기로 물어 허락받은 턴」(`thread-permission`)이다(스토리 137).

const permission = record("thread-permission");
const ASKED = lineOf(permission, "permission", "asked");
const ANSWERED = lineOf(permission, "permission", "answered");
/** 첫 말로 막 선 Thread — Host의 Session이 이 앱에 떠 있고 기록은 물음 바로 앞까지다. */
const view: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(permission)[0].text, live: true, lastSeq: ASKED.seq - 1 };

/** 들어서는 움직임의 이름들(`index.css` 「Thread의 움직임」) — 이미 있던 것이 다시 서면 이 가운데 하나가 걸린다. */
const 들어섬 = ["word-in", "chip-in", "card-rise", "pop-in", "row-in", "button-in", "jump-in"];

const 카드 = (page: Page) => page.getByRole("group", { name: "Host가 이 파일을 고쳐도 될까요?", exact: true });
const 결정줄 = (page: Page) => page.getByRole("main").locator("[data-decision]");

/**
 * 그 부품이 들어서는 움직임 — 부품 자신부터 위로 올라가며 처음 만나는 CSS 움직임의 이름과 길이(ms)다. 들어서는 움직임은 부품에 걸리거나
 * 부품을 그 자리에서 싼 상자에 걸린다(`Arriving` — 입력창 자리의 카드). 끝나도 채움(`both`)으로 남아 끝난 뒤에 읽어도 같다.
 */
const 움직임 = (target: Locator) =>
  target.evaluate((el) => {
    for (let at: Element | null = el; at !== null; at = at.parentElement) {
      const found = at.getAnimations().filter((one): one is CSSAnimation => one instanceof CSSAnimation);
      if (found.length > 0) return found.map((one) => ({ name: one.animationName, ms: Number(one.effect?.getTiming().duration) }));
    }
    return [];
  });

/** 페이지 어디에든 걸린 CSS 움직임의 이름 — 전이(`transition`)는 Thread의 움직임이 아니다(셸 사이드바 접힘 · 색 바뀜). */
const 걸린움직임 = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((one): one is CSSAnimation => one instanceof CSSAnimation)
      .map((one) => one.animationName),
  );

/** 부품의 들어서는 움직임(위 `움직임`과 같은 자리)을 멈추고 그 시각(ms)의 장면에서 부품의 위끝을 읽는다. */
const 그때위 = (target: Locator, at: number) =>
  target.evaluate((el, ms) => {
    for (let box: Element | null = el; box !== null; box = box.parentElement) {
      const [one] = box.getAnimations().filter((found) => found instanceof CSSAnimation);
      if (one === undefined) continue;
      one.pause();
      one.currentTime = ms;
      return el.getBoundingClientRect().top;
    }
    throw new Error("걸린 움직임이 없다");
  }, at);

/** 그 Thread를 물음 바로 앞까지 연다. */
async function openThread(page: Page): Promise<void> {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: linesThrough(permission, view.lastSeq) }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: view.lastSeq } }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(page.getByRole("main").getByText(view.title, { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** 카드의 「예」를 누르고 그 답이 나간 뒤 답 줄을 흘린다 — 카드가 걷히고 결정 줄이 선다. */
async function 고른다(page: Page): Promise<void> {
  await 카드(page).getByRole("button", { name: "예", exact: true }).click();
  await expect.poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).length).toBe(1);
  await streamLines(page, view.id, [ANSWERED]);
  await expect(결정줄(page)).toHaveText(["파일 고치기를 승인함"]);
}

test("승인 카드는 duration-card 동안 아래 12에서 오르고, 고르면 결정 줄이 duration-chip 동안 칩처럼 선다", async ({ page }) => {
  await openThread(page);
  // 이미 있던 줄은 움직이지 않는다 — Thread를 열 때 선 것은 들어선 것이 아니다(`ArrivalScope`).
  expect((await 걸린움직임(page)).filter((name) => 들어섬.includes(name))).toEqual([]);

  await streamLines(page, view.id, [ASKED]);
  await expect(카드(page)).toBeVisible();
  const 오름 = await 움직임(카드(page));
  expect(오름).toEqual([{ name: "card-rise", ms: await 토큰시간(page, "--duration-card") }]);
  // 처음 장면은 끝 장면보다 12 아래다 — 보드 「승인 카드 올라옴」.
  const [처음, 끝] = [await 그때위(카드(page), 0), await 그때위(카드(page), 오름[0].ms)];
  expect(처음 - 끝).toBeCloseTo(12, 0);

  await 고른다(page);
  expect(await 움직임(결정줄(page))).toEqual([{ name: "chip-in", ms: await 토큰시간(page, "--duration-chip") }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("동작 줄이기면 같은 흐름에 Thread의 움직임이 하나도 걸리지 않는다 — 카드 · 결정 줄 · 돌아온 입력창 · 사이드바 줄", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openThread(page);

  await streamLines(page, view.id, [ASKED]);
  await expect(카드(page)).toBeVisible();
  // 사이드바 줄이 내 차례가 됐다 — 보통이면 점이 튀고 상태 칸이 다시 서는 자리다.
  await expect(page.locator("aside[data-sidebar] [data-status]")).toHaveAttribute("data-status", "mine");
  expect(await 움직임(카드(page))).toEqual([]);

  await 고른다(page);
  await expect(page.getByRole("textbox", { name: "보낼 말", exact: true })).toBeVisible();
  expect(await 걸린움직임(page)).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
