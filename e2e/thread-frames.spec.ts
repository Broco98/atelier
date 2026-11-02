import { THREAD_CHUNK_EVENT, THREAD_RECORD_EVENT } from "@/features/thread/events";
import type { FlowChunk, RecordLine, ThreadView } from "@/features/thread/types";
import { frameGapReport } from "@/lib/frame-gaps";
import { expect, test, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { eventHandler, installFixtureBackend, unknownIpcCalls, 토큰색 } from "./harness";
import { record, seqOf, streamLines, summaryOf } from "./thread-records";

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

test("긴 답을 멈춰도 그려 둔 답을 다시 그리지 않고 중단 줄 위에 옅게 남는다", async ({ page }) => {
  test.setTimeout(90_000);
  const answer = await openLongAnswer(page);
  const { view, lines } = answer;
  const main = page.getByRole("main");
  const heading = main.getByRole("heading", { name: FIRST_HEADING, exact: true });
  const drawn = await heading.elementHandle();

  const stoppedAt = record("thread-stopped").find((line) => line.kind === "turn-end")!;
  await streamLines(page, view.id, [answerLine(answer), { ...stoppedAt, seq: lines.length + 2 }]);

  const stopLine = main.getByRole("button", { name: /초 후에 중단했습니다$/ });
  await expect(stopLine).toBeVisible();
  // 긴 답을 다시 그리면 이 길이에서 프레임 하나가 수백 ms를 멎는다 — 그려 둔 요소가 그대로면 다시 그리지 않은 것이다.
  expect(await drawn!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(main.getByText("이 문단은").first()).toHaveCSS("color", await 토큰색(page, "--fg-secondary"));
  const [answerBottom, stopTop] = await Promise.all([
    main.getByRole("heading", { name: lastHeading(answer.text), exact: true }).evaluate((element) => element.getBoundingClientRect().bottom),
    stopLine.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  expect(stopTop).toBeGreaterThan(answerBottom);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
