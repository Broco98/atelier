import { THREAD_RECORD_EVENT } from "@/features/thread/events";
import type { RecordLine, ThreadView } from "@/features/thread/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD, WORK_CHATS, workChatAnswers } from "./fixtures";
import { eventHandler, installFixtureBackend, unknownIpcCalls, 토큰색 } from "./harness";
import { linesAfter, linesThrough, record, sentPayloads, seqOf, streamLines, summaryOf } from "./thread-records";

// restart 02b-9a — **스크롤과 대화의 움직임**(구현 스펙 「02b — 대화창」 「바닥 따라가기는 프레임마다 남은 거리의 18%, 최소 1px로 움직이고 24px에서
// 끊기고 붙는다」 · Testing Decisions 「화면 — 스크롤」 · restart 02b-7이 넘긴 「새로 잴 것」 · 02b-2의 바닥 페이드). 걸음 · 끊김 · 붙음의 셈은 순수
// 함수(`reading-place.test.ts`)가 재고, **크기 관찰 이음매(`useBottomFollow`)는 L2에 DOM이 없어 이 층이 유일한 그물이다** — 새 글이 와서 흐름이
// 자라면 그 프레임부터 걸음이 도는지를 프레임(rAF)마다 읽는다. 재는 값은 `시안-비교/02b-7/차이.md` 「바닥 따라가기 — 프레임」이다.
//
// 흐름은 축복한 두 턴(`thread-two-turns`)의 첫 답을 길게 늘여 창을 넘게 하고, 둘째 턴이 막 보내진(도는) 자리에서 연다. 새 글은 손으로 지은 답
// 조각 줄(ACP 몸통)이다. 기록 줄은 페이지 안에서 쏜다 — 줄마다 IPC 왕복이 끼면 그 사이 프레임을 놓친다.

test.use({ viewport: { width: 1440, height: 900 } });

const twoTurns = record("thread-two-turns");
const FIRST_END = seqOf(twoTurns, "turn-end", 1);
const SECOND_SENT = seqOf(twoTurns, "sent", 2);

/** 첫 답이 `paragraphs`문단인 두 턴 — 흐름이 창을 넘는다. */
const longTurns = (paragraphs = 30): RecordLine[] =>
  twoTurns.map((line) => {
    const update = (line.payload as { update?: { sessionUpdate?: string; content?: { text?: string } } }).update;
    if (line.seq > FIRST_END || update?.sessionUpdate !== "agent_message_chunk") return line;
    const text = Array.from({ length: paragraphs }, (_, at) => `첫 답 문단 ${at + 1} — 흐름이 창을 넘게 한다.`).join("\n\n");
    return { ...line, payload: { ...(line.payload as object), update: { ...update, content: { ...update.content, text } } } };
  });

/** 둘째 턴이 도는 채팅 — 기록은 둘째 `sent`까지다. 그 뒤 새 글은 손으로 지은 답 줄로 쏜다. */
const running: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(twoTurns)[0].text, live: true, lastSeq: SECOND_SENT };

let made = 0;
/** 도는 턴에 붙는 새 답 줄 — `paragraphs`문단(문단 하나가 대략 39px). seq는 `after` 다음이다. */
const answerLine = (after: number, paragraphs: number): RecordLine => {
  made += 1;
  const text = Array.from({ length: paragraphs }, (_, at) => `새 글 ${made}-${at + 1} — 바닥을 따라가는지 잰다.`).join("\n\n");
  return {
    seq: after + 1,
    at: twoTurns[SECOND_SENT - 1].at,
    kind: "update",
    payload: {
      sessionId: "fake-session",
      update: { sessionUpdate: "agent_message_chunk", messageId: `msg_scroll_${made}`, content: { type: "text", text } },
    },
  };
};

const 흐름 = (page: Page) => page.getByRole("main");
const 맨아래로 = (page: Page) => 흐름(page).getByRole("button", { name: "맨 아래로", exact: true });

/** 굴림 상자를 찾는 페이지 안 식 — 본문(`main`) 안에서 세로로 넘치는 첫 상자다(`ThreadBody`의 흐름). */
const FIND_SCROLLER = `(() => {
  const main = document.querySelector("main");
  return [...(main?.querySelectorAll("div") ?? [])].find((el) => getComputedStyle(el).overflowY === "auto" && el.scrollHeight > el.clientHeight) ?? null;
})()`;

interface Frame {
  top: number;
  rest: number;
  height: number;
  client: number;
}

/** 지금의 굴림 상자. */
const 굴림 = (page: Page): Promise<Frame> =>
  page.evaluate((find) => {
    const box = (0, eval)(find) as HTMLElement | null;
    if (!box) throw new Error("굴림 상자가 없다");
    return { top: box.scrollTop, rest: box.scrollHeight - box.scrollTop - box.clientHeight, height: box.scrollHeight, client: box.clientHeight };
  }, FIND_SCROLLER);

/** 굴림 상자를 사람이 굴린 것처럼 옮긴다 — `scrollTop`을 바꾸면 `scroll` 이벤트가 온다. */
const 굴린다 = (page: Page, to: (box: { top: number; bottom: number }) => number) =>
  page.evaluate(
    ([find, body]) => {
      const box = (0, eval)(find) as HTMLElement;
      const at = (0, eval)(body) as (box: { top: number; bottom: number }) => number;
      box.scrollTop = at({ top: box.scrollTop, bottom: box.scrollHeight - box.clientHeight });
    },
    [FIND_SCROLLER, to.toString()] as const,
  );

/**
 * 페이지 안에서 `act`(기록 줄 쏘기 · 단추 누르기)를 하고 그 뒤 `ms` 동안 프레임마다 굴림 상자를 읽는다. 첫 장은 손대기 바로 앞이다.
 */
async function 프레임(page: Page, act: { fire?: { thread: string; lines: readonly RecordLine[] }; click?: string }, ms = 1200): Promise<Frame[]> {
  const onLine = act.fire ? await eventHandler(page, THREAD_RECORD_EVENT) : 0;
  return page.evaluate(
    async ({ find, fire, click, onLine, lineEvent, ms }) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }).__TAURI_INTERNALS__;
      const box = (0, eval)(find) as HTMLElement;
      const read = () => ({ top: box.scrollTop, rest: box.scrollHeight - box.scrollTop - box.clientHeight, height: box.scrollHeight, client: box.clientHeight });
      const seen = [read()];
      let measuring = true;
      const frame = () => {
        seen.push(read());
        if (measuring) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      if (fire) for (const line of fire.lines) internals.runCallback(onLine, { event: lineEvent, id: 0, payload: { thread: fire.thread, seq: line.seq, line } });
      if (click) (document.querySelector(click) as HTMLElement).click();
      await new Promise((done) => setTimeout(done, ms));
      measuring = false;
      return seen;
    },
    { find: FIND_SCROLLER, fire: act.fire, click: act.click, onLine, lineEvent: THREAD_RECORD_EVENT, ms },
  );
}

/** 프레임 사이에 내려간 걸음들 — 남은 거리(그 프레임 앞)와 함께. 흐름이 자란 프레임부터 바닥에 닿을 때까지다. */
function 걸음(frames: readonly Frame[]): { step: number; before: number }[] {
  const steps: { step: number; before: number }[] = [];
  for (let at = 1; at < frames.length; at += 1) {
    const [prev, now] = [frames[at - 1], frames[at]];
    const step = now.top - prev.top;
    if (step > 0) steps.push({ step, before: prev.rest + (now.height - prev.height) });
  }
  return steps;
}

async function openRunning(page: Page): Promise<void> {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(running)],
    thread_get: answerByArg("thread", { [running.id]: running }),
    thread_read_record: answerByArg("thread", { [running.id]: linesThrough(longTurns(), SECOND_SENT) }),
    thread_mark_read: answerByArg("thread", { [running.id]: summaryOf(running) }),
  });
  await page.goto(`/threads/${running.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText("생각 중", { exact: true })).toBeVisible({ timeout: 20_000 });
}

test("바닥에 붙은 흐름은 새 글이 오면 프레임마다 남은 거리의 18%씩(최소 1px) 끝을 따라가 여러 프레임에 걸쳐 바닥에 닿는다 — 처음 연 채팅은 미끄러지지 않는다", async ({
  page,
}) => {
  // 처음 그린 흐름은 곧바로 바닥에 선다(Motion 머리말 「처음 그릴 때 이미 있던 것은 움직이지 않는다」 · 02a-6) — 페이지가 뜰 때부터 프레임마다 굴림
  // 상자를 적는다. 상자가 넘친 첫 프레임부터 남은 거리가 0이어야 한다(위에서 미끄러져 내려오면 그 사이 프레임에 남은 거리가 선다).
  await page.addInitScript((find) => {
    const log: number[] = [];
    (window as unknown as { 첫굴림: number[] }).첫굴림 = log;
    const frame = () => {
      const box = (0, eval)(find) as HTMLElement | null;
      if (box && log.length < 60) log.push(Math.round(box.scrollHeight - box.scrollTop - box.clientHeight));
      if (log.length < 60) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, FIND_SCROLLER);
  await openRunning(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { 첫굴림: number[] }).첫굴림.length)).toBeGreaterThan(10);
  const 첫굴림 = await page.evaluate(() => (window as unknown as { 첫굴림: number[] }).첫굴림);
  expect(첫굴림.filter((rest) => rest > 1), `처음 연 채팅의 남은 거리 ${첫굴림.join(" ")}`).toEqual([]);

  // 새 글(대략 1000px) — 그 프레임부터 걸음이 돈다. 큰 걸음은 남은 거리의 18%(정수로 반올림), 7px 아래는 1px씩이고 걸음은 줄기만 한다.
  const frames = await 프레임(page, { fire: { thread: running.id, lines: [answerLine(SECOND_SENT, 26)] } });
  const steps = 걸음(frames);
  const said = steps.map(({ step, before }) => `${step}/${before}`).join(" ");
  expect(frames[frames.length - 1].rest, `바닥 ${said}`).toBeLessThan(1);
  expect(steps.length, `여러 프레임 ${said}`).toBeGreaterThanOrEqual(15);
  expect(steps[0].before, `새 글 ${said}`).toBeGreaterThan(600);
  for (const { step, before } of steps) {
    if (before >= 50) expect(Math.abs(step - Math.round(before * 0.18)), `18% ${said}`).toBeLessThanOrEqual(1);
    if (before < 6) expect(step, `최소 1px ${said}`).toBe(Math.min(1, before) === before ? before : 1);
  }
  for (let at = 1; at < steps.length; at += 1) expect(steps[at].step, `줄기만 한다 ${said}`).toBeLessThanOrEqual(steps[at - 1].step);
  await expect(맨아래로(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("위로 24 넘게 굴리면 끊겨 새 글에도 그 자리에 머물고, 바닥 24 안으로 굴려 내리면 다시 붙어 바닥까지 따라가며, 「맨 아래로」가 같은 걸음으로 바닥까지 내려간다", async ({
  page,
}) => {
  await openRunning(page);
  let last = SECOND_SENT;
  const 새글 = (paragraphs = 10) => {
    last += 1;
    return answerLine(last - 1, paragraphs);
  };
  await expect.poll(async () => (await 굴림(page)).rest).toBeLessThan(1);

  // 끊김 — 위로 500 굴리면 「맨 아래로」가 서고, 새 글이 와도 굴린 자리 그대로다(굴림 상자의 높이도 그대로 — 원은 입력창 자리 위에 떠 있다).
  const client = (await 굴림(page)).client;
  await 굴린다(page, ({ top }) => top - 500);
  await expect(맨아래로(page)).toBeVisible();
  const held = (await 굴림(page)).top;
  expect((await 굴림(page)).client, "원이 서도 대화 칸 그대로").toBe(client);
  const away = await 프레임(page, { fire: { thread: running.id, lines: [새글()] } }, 400);
  expect(away.map((one) => one.top).filter((top) => Math.abs(top - held) > 0.5), "끊긴 동안 굴림 그대로").toEqual([]);
  expect(away[away.length - 1].height).toBeGreaterThan(away[0].height);

  // 다시 붙음 — 바닥 20 앞까지 굴려 내리면 붙어 바닥까지 내려가고 「맨 아래로」가 걷힌다. 그 뒤 새 글을 따라간다.
  await 굴린다(page, ({ bottom }) => bottom - 20);
  await expect.poll(async () => (await 굴림(page)).rest).toBeLessThan(1);
  await expect(맨아래로(page)).toHaveCount(0);
  const followed = await 프레임(page, { fire: { thread: running.id, lines: [새글()] } }, 900);
  expect(followed[followed.length - 1].rest, "붙은 뒤 새 글 끝까지").toBeLessThan(1);
  expect(걸음(followed).length).toBeGreaterThan(3);

  // 24 넘게 올리면 다시 끊긴다.
  await 굴린다(page, ({ top }) => top - 100);
  await expect(맨아래로(page)).toBeVisible();
  const again = (await 굴림(page)).top;
  const still = await 프레임(page, { fire: { thread: running.id, lines: [새글()] } }, 400);
  expect(still.map((one) => one.top).filter((top) => Math.abs(top - again) > 0.5)).toEqual([]);

  // 「맨 아래로」 — 브라우저의 부드러운 굴림이 아니라 따라가기와 같은 걸음(18%)으로 바닥까지 가고 원이 걷힌다.
  const jumped = await 프레임(page, { click: 'main button[aria-label="맨 아래로"]' }, 1200);
  const steps = 걸음(jumped);
  const said = steps.map(({ step, before }) => `${step}/${before}`).join(" ");
  expect(jumped[jumped.length - 1].rest, `바닥 ${said}`).toBeLessThan(1);
  expect(steps.length, `여러 프레임 ${said}`).toBeGreaterThanOrEqual(10);
  expect(Math.abs(steps[0].step - Math.round(steps[0].before * 0.18)), `첫 걸음 18% ${said}`).toBeLessThanOrEqual(1);
  await expect(맨아래로(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("동작 줄이기면 바닥 따라가기와 「맨 아래로」가 한 프레임에 바닥이다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRunning(page);
  await expect.poll(async () => (await 굴림(page)).rest).toBeLessThan(1);
  const frames = await 프레임(page, { fire: { thread: running.id, lines: [answerLine(SECOND_SENT, 26)] } }, 500);
  const steps = 걸음(frames);
  expect(steps.length, steps.map(({ step, before }) => `${step}/${before}`).join(" ")).toBe(1);
  expect(steps[0].before).toBeGreaterThan(600);
  expect(frames[frames.length - 1].rest).toBeLessThan(1);

  await 굴린다(page, ({ top }) => top - 600);
  await expect(맨아래로(page)).toBeVisible();
  const jumped = await 프레임(page, { click: 'main button[aria-label="맨 아래로"]' }, 400);
  expect(걸음(jumped).length).toBe(1);
  expect(jumped[jumped.length - 1].rest).toBeLessThan(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("「맨 아래로」는 바깥 1px border-heavy 고리의 32 원이고 아래 6에서 떠오르며, 일하는 동안 점 셋이 서고 가리키면 점이 옅어지며 같은 자리에 ↓가 선다(150ms · 원 글자색 그대로)", async ({
  page,
}) => {
  await openRunning(page);
  await 굴린다(page, ({ top }) => top - 500);
  const jump = 맨아래로(page);
  await expect(jump).toBeVisible();
  const 움직임 = await jump.evaluate((el) =>
    el.getAnimations().map((one) => ({ name: (one as CSSAnimation).animationName, ms: Number(one.effect?.getTiming().duration) })),
  );
  expect(움직임).toEqual([{ name: "jump-in", ms: 180 }]);
  const ring = await 토큰색(page, "--border-heavy");
  // 고리는 Tailwind `ring-1`이라 빈 그림자 사이의 한 겹이다 — 그 겹이 `border-heavy` 1px이고 테두리는 없다.
  const [shadow, border, color] = await jump.evaluate((el) => [getComputedStyle(el).boxShadow, getComputedStyle(el).borderTopWidth, getComputedStyle(el).color]);
  expect(shadow.split(/,\s*(?![^()]*\))/).filter((one) => !one.startsWith("rgba(0, 0, 0, 0)"))).toEqual([`${ring} 0px 0px 0px 1px`]);
  expect([border, color]).toEqual(["0px", await 토큰색(page, "--fg-secondary")]);

  const dots = jump.locator(".typing-dots");
  const arrow = jump.locator("svg");
  const 옅음 = (target: Locator) => target.evaluate((el) => getComputedStyle(el).opacity);
  await expect(dots).toBeVisible();
  expect([await 옅음(dots), await 옅음(arrow)]).toEqual(["1", "0"]);
  expect(await dots.evaluate((el) => getComputedStyle(el).transition)).toBe("opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1)");
  await jump.hover();
  await expect.poll(async () => [await 옅음(dots), await 옅음(arrow)]).toEqual(["0", "1"]);
  const [dotBox, arrowBox, jumpBox] = await Promise.all([dots, arrow, jump].map((one) => one.boundingBox()));
  const 가운데 = (box: { x: number; y: number; width: number; height: number } | null) => [box!.x + box!.width / 2, box!.y + box!.height / 2].map(Math.round);
  expect(가운데(dotBox)).toEqual(가운데(jumpBox));
  expect(가운데(arrowBox)).toEqual(가운데(jumpBox));
  expect(await jump.evaluate((el) => getComputedStyle(el).color)).toBe(await 토큰색(page, "--fg-secondary"));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 바닥 페이드(restart 02b-2 · Thread 보드 `.ra-dock::before`) — 채팅 화면 입력창 자리의 위 28에 투명 → `surface` 띠가 선다(누름은 받지 않는다). 첫
// 화면(홈)에는 없다.
test("채팅 화면 입력창 자리 위 28에 바닥 페이드가 서고(라이트 흰 · 다크 판 면), 누름을 받지 않으며, 첫 화면에는 없다", async ({ page }) => {
  await openRunning(page);
  const dock = page.locator("[data-dock]");
  const fade = () =>
    dock.evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      return { content: style.content, height: style.height, top: style.top, events: style.pointerEvents, image: style.backgroundImage };
    });
  const light = await fade();
  expect([light.height, light.top, light.events]).toEqual(["28px", "-28px", "none"]);
  expect(light.image).toMatch(/^linear-gradient\(.*rgba\(0, 0, 0, 0\) 0%, rgb\(255, 255, 255\) 100%\)$/);
  const composer = await page.getByRole("textbox", { name: "보낼 말", exact: true }).locator("xpath=ancestor::form[1]").boundingBox();
  const fadeWidth = await dock.evaluate((el) => parseFloat(getComputedStyle(el, "::before").width));
  expect(Math.round(fadeWidth), "폭 = 입력창 + 좌우 16").toBe(Math.round(composer!.width) + 32);

  // 다크 — 판 면(`surface`)으로 진다.
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect.poll(async () => (await fade()).image).toContain("rgb(24, 24, 24)");

  // 첫 화면(홈)에는 입력창이 바닥에 붙지 않아 페이드가 없다.
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.getByRole("button", { name: "새 채팅", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible();
  await expect(page.locator("[data-dock]")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const 걸린움직임 = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((one): one is CSSAnimation => one instanceof CSSAnimation)
      .map((one) => ({ name: one.animationName, ms: Number(one.effect?.getTiming().duration), easing: one.effect?.getTiming().easing })),
  );

// 보낸 말이 선다(Motion 「보낸 말이 선다」 · restart 02b-7) — 대기 말풍선은 아래 12 · .985에서 320ms `ease-enter-snappy`로 오르고, 그 말이 기록의
// 턴으로 옮겨 서면 다시 오르지 않는다(같은 이름의 자리다). 처음 연 채팅의 말은 오르지 않는다.
test("보낸 말은 msg-rise로 오르고, 그 말이 기록의 턴으로 옮겨 서도 다시 오르지 않으며, 처음 연 채팅의 말은 오르지 않는다", async ({ page }) => {
  const ended: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(twoTurns)[0].text, live: false, lastSeq: FIRST_END };
  await installFixtureBackend(page, {
    thread_list: [summaryOf(ended)],
    thread_get: answerByArg("thread", { [ended.id]: ended }),
    thread_read_record: answerByArg("thread", { [ended.id]: linesThrough(twoTurns, FIRST_END) }),
    thread_mark_read: answerByArg("thread", { [ended.id]: summaryOf(ended) }),
  });
  await page.goto(`/threads/${ended.id}`);
  await expect(흐름(page).getByText("hello from turn", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect((await 걸린움직임(page)).filter(({ name }) => name === "msg-rise"), "처음 연 채팅").toEqual([]);

  // 세션이 내려간 채팅에 보낸다 — 기록에 서기 전의 대기 말풍선이 오른다. 입력칸은 같은 순간 빈다.
  const [, second] = sentPayloads(twoTurns);
  const field = page.getByRole("textbox", { name: "보낼 말", exact: true });
  await field.fill(second.text);
  await field.press("Enter");
  await expect(field).toHaveValue("");
  const pending = 흐름(page).locator("[data-pending]");
  await expect(pending).toBeVisible();
  // 곡선은 키프레임 사이의 것이라 움직임의 `easing`(linear)이 아니라 그 요소의 `animation-timing-function`이다.
  expect(
    await pending.evaluate((el) =>
      el.getAnimations({ subtree: true }).map((one) => {
        const target = (one.effect as KeyframeEffect).target as Element;
        return [(one as CSSAnimation).animationName, one.effect?.getTiming().duration, getComputedStyle(target).animationTimingFunction];
      }),
    ),
  ).toEqual([["msg-rise", 320, "cubic-bezier(0.23, 1, 0.32, 1)"]]);
  await expect.poll(async () => (await 걸린움직임(page)).filter(({ name }) => name === "msg-rise")).toEqual([]);

  // 그 말이 기록에 선다 — 대기 말풍선이 걷히고 같은 말이 턴의 말로 선다. 다시 오르지 않는다.
  await streamLines(page, ended.id, linesThrough(linesAfter(twoTurns, FIRST_END), SECOND_SENT));
  await expect(pending).toHaveCount(0);
  await expect(흐름(page).getByText(second.text, { exact: true })).toBeVisible();
  expect((await 걸린움직임(page)).filter(({ name }) => name === "msg-rise"), "옮겨 선 말").toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 바뀐 파일 알약(restart 02b-7 · Motion 「칩이 들어선다」) — 작업공간에 이은 채팅의 마지막 턴이 파일을 고치면 입력창 자리 위 뜬 줄의 왼쪽에 알약이
// 서고, 화면이 선 뒤 새로 서면 `chip-in` 280이다. 뜬 줄은 대화 칸을 줄이지 않는다. 알약은 턴이 끝난 뒤에 선다 — 그 때 · 셈 · 꼴은
// `thread-pill.spec.ts`가 잰다(restart 02b-9b).
test("작업공간 채팅의 턴이 파일을 고치면 바뀐 파일 알약이 chip-in으로 뜬 줄 왼쪽에 서고, 대화 칸은 줄지 않는다", async ({ page }) => {
  const [chat] = WORK_CHATS;
  const working: ThreadView = { ...chat, live: true, lastSeq: SECOND_SENT };
  await installFixtureBackend(page, workChatAnswers([working], { [working.id]: linesThrough(longTurns(), SECOND_SENT) }));
  await page.goto(`/works/${chat.work}?tab=chat&thread=${working.id}`);
  await expect(흐름(page).getByText("생각 중", { exact: true })).toBeVisible({ timeout: 20_000 });
  const client = (await 굴림(page)).client;

  await streamLines(page, working.id, linesAfter(twoTurns, SECOND_SENT));
  const pill = page.getByRole("group", { name: "1개 파일 변경됨", exact: true });
  await expect(pill).toBeVisible();
  expect(await pill.evaluate((el) => el.getAnimations().map((one) => [(one as CSSAnimation).animationName, one.effect?.getTiming().duration]))).toEqual([
    ["chip-in", 280],
  ]);
  // 들어서는 동안은 크기가 작다 — 다 선 뒤에 잰다.
  await expect.poll(() => pill.evaluate((el) => el.getAnimations().map((one) => one.playState))).toEqual(["finished"]);
  const [pillBox, dockBox, floatBox] = [await pill.boundingBox(), await page.locator("[data-dock]").boundingBox(), await page.locator("[data-floating]").boundingBox()];
  expect(Math.round(pillBox!.x), "뜬 줄 왼쪽 칸").toBe(Math.round(floatBox!.x));
  expect(Math.round(dockBox!.y - floatBox!.y - floatBox!.height), "자리 위 6").toBe(6);
  expect((await 굴림(page)).client, "알약이 서도 대화 칸 그대로").toBe(client);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
