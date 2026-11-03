import { THREAD_CHUNK_EVENT, THREAD_RECORD_EVENT } from "@/features/thread/events";
import type { FlowChunk, RecordLine, ThreadView } from "@/features/thread/types";
import { frameGapReport } from "@/lib/frame-gaps";
import { expect, test, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { eventHandler, installFixtureBackend, unknownIpcCalls, 토큰색 } from "./harness";
import { record, seqOf, summaryOf } from "./thread-records";

// restart 티켓 01b-10 · 스펙 「Testing Decisions · 화면」의 프레임 회귀 — 조각을 흘리는 동안 프레임 간격이 넉넉한 회귀 문턱 안에 있다. 50ms 기준은 진짜 앱에서
// 2분을 흘리는 live 점검이 잰다(`scripts/stream-load.mjs`, `spec/live-점검.md`). 이 층은 그 앞의 그물이고, 문턱은 시험이 함께 도는 기계에서도 흔들리지 않게 둔다.
//
// 앱의 박자(33ms)대로 조각을 쏘되 글 길이는 live의 2분 끝자리에서 시작한다 — 기록 1,000줄, 흐르는 글 4만 자. 끝 덩어리만 다시 푸는 일이 깨지면 보통 간격이
// 17ms에서 115ms로 오른다(재서 확인했다). 가장 긴 간격은 짧은 멎음을 잡지 못해 보통 간격을 함께 본다. 조각은 페이지 안에서 쏜다 — 조각마다 IPC 기록을 읽어 오면
// 재는 값이 그 비용까지 들고 박자도 흔들린다.

/** 넉넉한 회귀 문턱(ms) — 보통 간격과 가장 긴 간격. */
const MEDIAN_GAP_LIMIT_MS = 50;
const MAX_GAP_LIMIT_MS = 1000;
/** 흐르는 글이 이미 쌓인 길이 — 끝 덩어리만 다시 푸는 일이 깨지면 이 길이에서 프레임이 무너진다. */
const SEED_CHARS = 40_000;
/** 앱이 조각을 내보내는 박자 · 그 사이 오는 글자 수 · 조각 수(5초). */
const BEAT_MS = 33;
const BEAT_CHARS = 26;
const BEATS = 150;
const STREAM = 9000;
const FIRST_HEADING = "1. 스트리밍 점검 절";

const two = record("thread-two-turns");
const SENT = seqOf(two, "sent", 2);
const TURN = two.filter((line) => line.seq >= SENT);

/** 부하 글의 `n`째 절 — 실제 답처럼 제목 · 문단 · 목록 · 코드 · 표 · 인용이 섞이고 번호로 같은 글덩이가 되풀이되지 않는다(`claude_replay.rs`의 `load_section`과 같은 꼴). */
const section = (n: number) =>
  `## ${n}. 스트리밍 점검 절\n\n이 문단은 \`${n}\`번째 절의 설명이다. 답은 **조각으로** 도착하고, 화면은 받은 글을 이어 붙여 다시 그린다. 한 문단은 여러 문장이고 줄이 바뀌지 않은 채 길게 이어진다.\n\n- 첫째 항목은 \`Host\`가 조각을 쌓는 일이다(${n})\n- 둘째 항목은 33ms마다 화면으로 내보내는 일이다\n\n\`\`\`rust\nfn section_${n}(text: &str) -> usize {\n    text.lines().count() + ${n}\n}\n\`\`\`\n\n| 값 | 뜻 |\n|---|---|\n| ${n} | 절 번호 |\n\n> 인용 문단도 하나 둔다. 번호는 ${n}이다.\n\n`;

function answerOf(chars: number): string {
  let text = "";
  for (let n = 1; text.length < chars; n += 1) text += section(n);
  return text.slice(0, chars);
}

/** 글의 마지막 절 제목. */
const lastHeading = (text: string) => text.slice(text.lastIndexOf("## ") + 3).split("\n")[0];

/** 끝난 턴들만 든 기록 `wanted`줄 — 축복한 턴을 되풀이하고 도구 · 메시지 id를 턴마다 가른다. */
function pastTurns(wanted: number): RecordLine[] {
  const lines = two.filter((line) => line.seq < seqOf(two, "sent", 1));
  for (let turn = 1; lines.length < wanted; turn += 1) {
    const text = JSON.stringify(TURN).replace(/(toolu|msg)_[0-9A-Za-z]+/g, (id) => `${id}_${turn}`);
    lines.push(...(JSON.parse(text) as RecordLine[]));
  }
  return lines.map((line, at) => ({ ...line, seq: at + 1 }));
}

interface LongAnswer {
  view: ThreadView;
  lines: RecordLine[];
  text: string;
}

/** 긴 기록 뒤의 도는 턴을 연다 — 긴 답이 이미 `SEED_CHARS`만큼 흐르고 있다. 시작 기록의 말 줄이 턴을 연다. */
async function openLongAnswer(page: Page): Promise<LongAnswer> {
  const past = pastTurns(1000);
  const lines = [...past, { ...TURN[0], seq: past.length + 1 }];
  const text = answerOf(SEED_CHARS + BEATS * BEAT_CHARS);
  const view: ThreadView = {
    ...FIXTURE_THREAD,
    title: "스트리밍 부하",
    live: true,
    lastRead: lines.length,
    lastSeq: lines.length,
    flowing: { stream: STREAM, kind: "message", offset: 0, text: text.slice(0, SEED_CHARS) },
  };
  await installFixtureBackend(page, {
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: summaryOf(view) }),
  });
  await page.goto(`/threads/${view.id}`);
  await expect(page.getByRole("main").getByRole("heading", { name: FIRST_HEADING, exact: true })).toBeVisible({ timeout: 30_000 });
  return { view, lines, text };
}

/** 흐름이 합쳐진 기록 줄 — 앱이 턴 끝에 쓰는 답 줄이다. */
const answerLine = ({ view, lines, text }: LongAnswer): RecordLine => ({
  seq: lines.length + 1,
  at: lines[lines.length - 1].at,
  kind: "update",
  payload: {
    sessionId: view.sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "msg_load",
      content: { type: "text", text },
      _meta: { atelier: { stream: STREAM } },
    },
  },
});

test("긴 기록에서 긴 답이 조각으로 흘러 기록 줄이 되는 동안 프레임 간격이 회귀 문턱 안이다", async ({ page }) => {
  test.setTimeout(90_000);
  const answer = await openLongAnswer(page);
  const { view, lines, text } = answer;

  const chunks: FlowChunk[] = Array.from({ length: BEATS }, (_, beat) => {
    const offset = SEED_CHARS + beat * BEAT_CHARS;
    return { stream: STREAM, kind: "message", offset, text: text.slice(offset, offset + BEAT_CHARS) };
  });
  const end: RecordLine[] = [answerLine(answer), { ...TURN[TURN.length - 1], seq: lines.length + 2 }];
  const stamps = await page.evaluate(
    async ({ thread, chunks, end, gap, onChunk, onLine, chunkEvent, lineEvent }) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }).__TAURI_INTERNALS__;
      const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
      const seen: number[] = [];
      let measuring = true;
      const frame: FrameRequestCallback = (time) => {
        seen.push(time);
        if (measuring) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      for (const chunk of chunks) {
        internals.runCallback(onChunk, { event: chunkEvent, id: 0, payload: { thread, chunk } });
        await pause(gap);
      }
      for (const line of end) {
        internals.runCallback(onLine, { event: lineEvent, id: 0, payload: { thread, seq: line.seq, line } });
        await pause(gap);
      }
      await pause(500);
      measuring = false;
      return seen;
    },
    {
      thread: view.id,
      chunks,
      end,
      gap: BEAT_MS,
      onChunk: await eventHandler(page, THREAD_CHUNK_EVENT),
      onLine: await eventHandler(page, THREAD_RECORD_EVENT),
      chunkEvent: THREAD_CHUNK_EVENT,
      lineEvent: THREAD_RECORD_EVENT,
    },
  );

  // 조각이 정말 화면을 지났다 — 흘린 끝의 글이 기록 줄의 글로 서고 흐름의 꼬리가 걷혔다.
  await expect(page.locator(".stream-tail")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("heading", { name: lastHeading(text), exact: true })).toBeVisible();
  const report = frameGapReport(stamps, MEDIAN_GAP_LIMIT_MS);
  const measured = `최대 ${report.maxGap}ms, 보통 ${report.medianGap}ms, 프레임 ${report.frames}개`;
  expect(report.medianGap, measured).toBeLessThan(MEDIAN_GAP_LIMIT_MS);
  expect(report.maxGap, measured).toBeLessThan(MAX_GAP_LIMIT_MS);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 기록 줄을 페이지 안에서 쏘는 동안의 프레임 시각 — 쏜 뒤 `settle`ms 더 잰다. 줄마다 IPC 왕복이 끼지 않는다. */
async function framesWhileFiring(page: Page, thread: string, fired: readonly RecordLine[], settle = 500): Promise<number[]> {
  return page.evaluate(
    async ({ thread, fired, onLine, lineEvent, settle }) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }).__TAURI_INTERNALS__;
      const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
      const seen: number[] = [];
      let measuring = true;
      const frame: FrameRequestCallback = (time) => {
        seen.push(time);
        if (measuring) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      await pause(100);
      for (const line of fired) internals.runCallback(onLine, { event: lineEvent, id: 0, payload: { thread, seq: line.seq, line } });
      await pause(settle);
      measuring = false;
      return seen;
    },
    { thread, fired, onLine: await eventHandler(page, THREAD_RECORD_EVENT), lineEvent: THREAD_RECORD_EVENT, settle },
  );
}

/** 멈추는 프레임의 넉넉한 회귀 문턱(ms) — 그려 둔 긴 글을 다시 그리면 300ms대가 멎는다(restart 02b-7이 잰 값). 보통은 20ms대다. */
const STOP_GAP_LIMIT_MS = 200;

// restart 02b-1 · 02b-7 — 멈춘 턴은 머리 「N초 후에 중단했습니다」가 답 **위**에 서고(아래 ■ 줄이 없다), 답은 옅지 않다(`fg`). 말만 한 턴은 펼칠
// 것이 없어 머리가 단추가 아니다. 멈추는 순간 그려 둔 답을 다시 그리지 않는다 — 같은 칸에 남고 그 프레임이 멎지 않는다.
test("긴 답을 멈춰도 그려 둔 답을 다시 그리지 않고, 머리 「N초 후에 중단했습니다」가 답 위에 서며 답은 옅지 않다", async ({ page }) => {
  test.setTimeout(90_000);
  const answer = await openLongAnswer(page);
  const { view, lines } = answer;
  const main = page.getByRole("main");
  const heading = main.getByRole("heading", { name: FIRST_HEADING, exact: true });
  const drawn = await heading.elementHandle();

  const stoppedAt = record("thread-stopped").find((line) => line.kind === "turn-end")!;
  const stamps = await framesWhileFiring(page, view.id, [answerLine(answer), { ...stoppedAt, seq: lines.length + 2 }]);

  const stopHead = main.locator("[data-work-divider]").filter({ hasText: /초 후에 중단했습니다$/ });
  await expect(stopHead).toHaveCount(1);
  await expect(stopHead).toBeVisible();
  await expect(main.getByRole("button", { name: /초 후에 중단했습니다$/ })).toHaveCount(0);
  // 긴 답을 다시 그리면 이 길이에서 프레임 하나가 수백 ms를 멎는다 — 그려 둔 요소가 그대로면 다시 그리지 않은 것이다.
  expect(await drawn!.evaluate((element) => element.isConnected)).toBe(true);
  const report = frameGapReport(stamps, MEDIAN_GAP_LIMIT_MS);
  expect(report.maxGap, `최대 ${report.maxGap}ms, 보통 ${report.medianGap}ms, 프레임 ${report.frames}개`).toBeLessThan(STOP_GAP_LIMIT_MS);
  await expect(main.getByText("이 문단은").first()).toHaveCSS("color", await 토큰색(page, "--fg"));
  const [headBottom, answerTop] = await Promise.all([
    stopHead.evaluate((element) => element.getBoundingClientRect().bottom),
    heading.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  expect(headBottom).toBeLessThan(answerTop);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 도는 턴 안 앞선 글의 길이와 도구 쌍의 수 — restart 02b-7이 300ms 멎음을 잰 자리(`시안-비교/02b-7/차이.md` 「멈춘 긴 턴의 프레임」). */
const BEFORE_TOOLS_CHARS = 40_000;
const TOOL_PAIRS = 60;
const AFTER_TOOLS_CHARS = 2_000;

/** 앞선 글 4만 자 · 도구 60쌍 뒤에 `flowing`이 흐르는 도는 턴을 연다 — 도구 줄 60개가 그려질 때까지 기다린다(접힌 상자 안이어도 그려 둔다). */
async function openLongWork(page: Page, title: string, flowing: string): Promise<LongAnswer> {
  const past = pastTurns(1000);
  // 명령 줄이다 — 이어진 읽기는 묶음 줄 하나로 서서 줄이 60개가 되지 않는다.
  const [, , , , runCall, runDone] = TURN.filter((line) => /tool_call/.test(JSON.stringify(line.payload).slice(0, 80)));
  const turn: RecordLine[] = [{ ...TURN[0], seq: past.length + 1 }];
  const at = TURN[0].at;
  const push = (payload: unknown) => turn.push({ seq: past.length + turn.length + 1, at, kind: "update", payload });
  push({ sessionId: FIXTURE_THREAD.sessionId, update: { sessionUpdate: "agent_message_chunk", messageId: "msg_before", content: { type: "text", text: answerOf(BEFORE_TOOLS_CHARS) } } });
  for (let pair = 1; pair <= TOOL_PAIRS; pair += 1) {
    for (const line of [runCall, runDone]) push(JSON.parse(JSON.stringify(line.payload).replace(/toolu_[0-9A-Za-z]+/, `toolu_pair_${pair}`)));
  }
  const lines = [...past, ...turn];
  const view: ThreadView = {
    ...FIXTURE_THREAD,
    title,
    live: true,
    lastRead: lines.length,
    lastSeq: lines.length,
    flowing: { stream: STREAM, kind: "message", offset: 0, text: flowing },
  };
  await installFixtureBackend(page, {
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: summaryOf(view) }),
  });
  await page.goto(`/threads/${view.id}`);
  await expect(page.getByRole("main").locator(TOOL_ROWS)).toHaveCount(TOOL_PAIRS, { timeout: 30_000 });
  return { view, lines, text: flowing };
}

/** 도구 줄 60개 — 접힌 상자 안에서도 그려 둔 줄을 센다(역할로 찾으면 닫힌 상자(`inert`) 안의 줄이 빠진다). */
const TOOL_ROWS = '[role="group"][aria-label="실행 완료 wc -c notes.txt"]';
/** 작업 로그 상자 — 턴 머리 바로 뒤의 `unfold`다(도구 줄 안의 펼침 상자와 그것으로 갈린다). */
const LOG_BOX = "[data-turn-head] + .unfold";

/** 높이 · 옅음의 전이 — 그 상자에 걸린 전이의 속성과 길이. */
const transitionsOf = (page: Page) =>
  page.getByRole("main").locator(LOG_BOX).evaluate((element) =>
    element.getAnimations().map((one) => [(one as CSSTransition).transitionProperty, Number(one.effect?.getTiming().duration)]),
  );

// restart 02b-7 · 03-15a — 앞선 글 4만 자 · 도구 60쌍 뒤의 답이 흐르다 멈춘다. 마지막 답(둘째 줄로 넘어간 글)이 흐르는 턴이라 로그가 「N초 동안
// 작업함 ›」 아래로 접혀 있다(States 12). 멈추면 그 로그가 펼쳐진다(States 14 · 보드 `halt`) — 도는 동안 접힌 상자가 줄을 그려 둔 채라 멈추는 순간
// 다시 그리지 않고 그 프레임이 멎지 않는다. 한때 줄을 새 상자로 옮겨 그려 300ms 멎었다. 다시 접으면 높이 · 옅음 300으로 접힌다(Motion 「작업 로그가 접힌다」).
test("앞선 긴 글과 도구 60쌍 뒤의 접힌 답을 멈춰도 그 프레임이 멎지 않고, 멈춘 턴은 같은 상자를 펼치며 접을 때 높이 · 옅음 300으로 접힌다", async ({ page }) => {
  test.setTimeout(90_000);
  const answer = await openLongWork(page, "멈춘 긴 턴", answerOf(AFTER_TOOLS_CHARS));
  const { view, lines } = answer;
  const main = page.getByRole("main");
  const folded = main.getByRole("button", { name: / 동안 작업함$/ }).last();
  await expect(folded).toHaveAttribute("aria-expanded", "false");
  const drawn = await main.locator(TOOL_ROWS).first().elementHandle();

  const stoppedAt = record("thread-stopped").find((line) => line.kind === "turn-end")!;
  const stamps = await framesWhileFiring(page, view.id, [answerLine(answer), { ...stoppedAt, seq: lines.length + 2 }]);
  const head = main.getByRole("button", { name: /초 후에 중단했습니다$/ });
  await expect(head).toHaveAttribute("aria-expanded", "true");
  const report = frameGapReport(stamps, MEDIAN_GAP_LIMIT_MS);
  expect(report.maxGap, `최대 ${report.maxGap}ms, 보통 ${report.medianGap}ms, 프레임 ${report.frames}개`).toBeLessThan(STOP_GAP_LIMIT_MS);
  // 같은 상자다 — 그려 둔 도구 줄이 같은 요소이고 로그 상자는 하나다.
  expect(await drawn!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(main.locator(LOG_BOX)).toHaveCount(1);
  await expect(main.locator(LOG_BOX)).toHaveAttribute("data-open", "true");

  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  expect(await transitionsOf(page)).toEqual(expect.arrayContaining([["grid-template-rows", 300], ["opacity", 300]]));
  await expect(main.locator(TOOL_ROWS)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// restart 03-15a · States 12 「답 흐르는 중」 · Motion 「작업 로그가 접힌다」 — 일 뒤의 글이 한 줄인 동안은 로그가 펼친 채 「N초 동안 작업 중입니다」 아래에
// 서고, 글이 둘째 줄로 넘어가는 조각이 오면 머리가 「N초 동안 작업함 ›」이 되며 로그가 높이 · 옅음 300(`ease-enter`)으로 접힌다. 그려 둔 줄은 그대로라
// 앞선 글 4만 자 · 도구 60쌍에서도 그 프레임이 멎지 않는다. 뒤에 도구가 다시 와도 스스로 펴지지 않는다.
test("도구 60쌍 뒤의 글이 둘째 줄로 넘어가면 로그가 「N초 동안 작업함 ›」 아래로 높이 · 옅음 300에 접히고, 그 프레임이 멎지 않으며 다시 펴지지 않는다", async ({ page }) => {
  test.setTimeout(90_000);
  const first = "도구를 모두 돌렸어요.";
  const answer = await openLongWork(page, "접히는 긴 턴", first);
  const { view, lines } = answer;
  const main = page.getByRole("main");
  await expect(main.locator("[data-work-divider]").last()).toHaveText(/동안 작업 중입니다$/);
  await expect(main.locator(LOG_BOX)).toHaveAttribute("data-open", "true");
  const drawn = await main.locator(TOOL_ROWS).first().elementHandle();

  // 둘째 줄의 조각 — 쏜 뒤 다음 장면에 걸린 전이를 함께 읽는다(300이 지나면 전이가 걷힌다).
  const chunk: FlowChunk = { stream: STREAM, kind: "message", offset: first.length, text: "\n\n- 60개 모두 성공했어요." };
  const { stamps, moving } = await page.evaluate(
    async ({ thread, chunk, onChunk, chunkEvent, box }) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }).__TAURI_INTERNALS__;
      const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
      const seen: number[] = [];
      let measuring = true;
      const frame: FrameRequestCallback = (time) => {
        seen.push(time);
        if (measuring) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      await pause(100);
      internals.runCallback(onChunk, { event: chunkEvent, id: 0, payload: { thread, chunk } });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const element = document.querySelector(box);
      const moving = (element?.getAnimations() ?? []).map((one) => [(one as CSSTransition).transitionProperty, Number(one.effect?.getTiming().duration)]);
      await pause(500);
      measuring = false;
      return { stamps: seen, moving };
    },
    { thread: view.id, chunk, onChunk: await eventHandler(page, THREAD_CHUNK_EVENT), chunkEvent: THREAD_CHUNK_EVENT, box: LOG_BOX },
  );

  const head = main.getByRole("button", { name: / 동안 작업함$/ }).last();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(main.getByText(/동안 작업 중입니다$/)).toHaveCount(0);
  expect(moving).toEqual(expect.arrayContaining([["grid-template-rows", 300], ["opacity", 300]]));
  await expect(main.locator(LOG_BOX)).toHaveCSS("transition-timing-function", "cubic-bezier(0.19, 1, 0.22, 1)");
  expect(await drawn!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(main.locator(LOG_BOX)).not.toHaveAttribute("data-open");
  const report = frameGapReport(stamps, MEDIAN_GAP_LIMIT_MS);
  expect(report.maxGap, `최대 ${report.maxGap}ms, 보통 ${report.medianGap}ms, 프레임 ${report.frames}개`).toBeLessThan(STOP_GAP_LIMIT_MS);
  // 답은 접힌 머리 아래 16이다(보드 — 머리 칸 → 답 칸 사이 16).
  const rule = head.locator("xpath=../div[@aria-hidden]");
  const answerTop = await main.locator("p").filter({ hasText: "도구를 모두 돌렸어요." }).last().evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.round(answerTop - (await rule.evaluate((element) => element.getBoundingClientRect().bottom)))).toBe(16);

  // 뒤에 도구가 다시 와도 펴지지 않는다 — 그 줄은 답 아래에 선다.
  const [, , , , runCall] = TURN.filter((line) => /tool_call/.test(JSON.stringify(line.payload).slice(0, 80)));
  const late = JSON.parse(JSON.stringify(runCall.payload).replace(/toolu_[0-9A-Za-z]+/, "toolu_late")) as unknown;
  await framesWhileFiring(page, view.id, [{ ...answerLine({ ...answer, text: first + chunk.text }), seq: lines.length + 1 }, { seq: lines.length + 2, at: lines[lines.length - 1].at, kind: "update", payload: late }]);
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(main.locator(LOG_BOX)).not.toHaveAttribute("data-open");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
