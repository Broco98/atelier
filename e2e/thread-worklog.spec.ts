import { THREAD_RECORD_EVENT } from "@/features/thread/events";
import type { RecordLine, ThreadView } from "@/features/thread/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { eventHandler, installFixtureBackend, unknownIpcCalls, 토큰색 } from "./harness";
import { linesThrough, record, sentPayloads, seqOf, streamLines, summaryOf } from "./thread-records";

// restart 02b-9a — **작업 로그**(restart 02b-4 · Tools 보드 · States 05 · 07 · 08 · 14 · `시안-비교/02b-4/차이.md` 「같은 것」). 명령 출력은 `surface-tool`
// 상자(9 12 9 9 · 둥근 12 · 13 / 20)이고 출력은 144까지 끝 줄이 보이며 위 24가 옅다. 성공한 명령은 끝나고 700ms에 스스로 접힌다. 변경 카드 머리는 30 ·
// 줄 21.6 · 몸 240까지다. 로그 줄 사이는 4, 체크리스트는 10 12 · 항목 24, 서브에이전트의 안 줄은 글리프 가운데 7의 세로선 안 13이다. 승인을 기다리는
// 동안 머리 시계가 멈추고 끝난 머리는 기다린 시간을 뺀다. 멈춘 줄 · 거부한 줄은 ■(16 칸의 9)다.

const twoTurns = record("thread-two-turns");
const SECOND_SENT = seqOf(twoTurns, "sent", 2);
const 흐름 = (page: Page) => page.getByRole("main");

async function open(page: Page, view: ThreadView, lines: readonly RecordLine[]): Promise<void> {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: summaryOf(view) }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(view.title, { exact: true })).toBeVisible({ timeout: 20_000 });
}

const 스타일 = (target: Locator, ...names: string[]) =>
  target.evaluate((el, keys) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key)]));
  }, names);

/** 둘째 턴이 막 보내진 도는 채팅 — 그 뒤 줄은 손으로 지어 쏜다. */
const running: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(twoTurns)[0].text, live: true, lastSeq: SECOND_SENT };
const update = (seq: number, body: Record<string, unknown>): RecordLine => ({
  seq,
  at: twoTurns[SECOND_SENT - 1].at,
  kind: "update",
  payload: { sessionId: "fake-session", update: body },
});

test("도는 명령의 출력은 9 12 9 9 · 둥근 12 · surface-tool · 13 / 20 상자에 144까지 끝 줄이 보이고 위 24가 옅으며, 성공하면 끝나고 700ms에 스스로 접힌다", async ({
  page,
}) => {
  await open(page, running, linesThrough(twoTurns, SECOND_SENT));
  const id = "toolu_worklog_run";
  const output = Array.from({ length: 20 }, (_, at) => `출력 ${at + 1}째 줄`).join("\n");
  await streamLines(page, running.id, [
    update(SECOND_SENT + 1, {
      sessionUpdate: "tool_call",
      toolCallId: id,
      title: "pnpm test",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: "pnpm test" },
      _meta: { claudeCode: { toolName: "Bash" } },
    }),
    update(SECOND_SENT + 2, { sessionUpdate: "tool_call_update", toolCallId: id, _meta: { terminal_output_delta: { data: `${output}\n` } } }),
  ]);
  const box = 흐름(page).getByRole("figure", { name: "명령 출력", exact: true });
  await expect(box).toBeVisible();
  expect(await 스타일(box, "padding", "border-top-left-radius", "background-color", "font-size", "line-height", "row-gap")).toEqual({
    padding: "9px 12px 9px 9px",
    "border-top-left-radius": "12px",
    "background-color": await 토큰색(page, "--surface-tool"),
    "font-size": "13px",
    "line-height": "20px",
    "row-gap": "8px",
  });
  const out = box.locator("[data-tool-output]");
  await expect(out).toContainText("출력 20째 줄");
  expect(await 스타일(out, "max-height", "justify-content")).toEqual({ "max-height": "144px", "justify-content": "flex-end" });
  expect(Math.round((await out.boundingBox())!.height)).toBe(144);
  expect((await 스타일(out, "-webkit-mask-image"))["-webkit-mask-image"]).toMatch(/linear-gradient\(.*24px.*\)/);
  // 끝 줄(출력의 마지막)이 상자 아래 끝에 보이고 첫 줄은 위로 넘쳐 가려진다. 글자 상자는 줄 높이(20)와 달라 가운데로 잰다.
  const [ends, outBox] = [
    await out.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1];
      return { firstTop: rects[0].top, lastMiddle: (last.top + last.bottom) / 2 };
    }),
    await out.boundingBox(),
  ];
  // 끝 줄의 가운데가 상자 맨 아래 줄 칸(20) 안이다.
  const bottom = outBox!.y + outBox!.height;
  expect(ends.lastMiddle, "끝 줄이 바닥").toBeGreaterThan(bottom - 20);
  expect(ends.lastMiddle, "끝 줄이 바닥").toBeLessThan(bottom);
  expect(ends.firstTop, "첫 줄은 위로 넘친다").toBeLessThan(outBox!.y - 100);

  // 성공 — 끝 줄을 쏜 순간부터 그 줄의 펼침 단추가 접힐 때까지를 잰다.
  const onLine = await eventHandler(page, THREAD_RECORD_EVENT);
  const done = update(SECOND_SENT + 3, { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" });
  const folded = await page.evaluate(
    ({ onLine, lineEvent, thread, line }) =>
      new Promise<number>((resolve) => {
        const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }).__TAURI_INTERNALS__;
        const start = performance.now();
        internals.runCallback(onLine, { event: lineEvent, id: 0, payload: { thread, seq: line.seq, line } });
        const frame = () => {
          const head = document.querySelector('[role="group"][aria-label="실행 완료 pnpm test"] button[aria-expanded]');
          if (head?.getAttribute("aria-expanded") === "false") return resolve(performance.now() - start);
          if (performance.now() - start > 3000) return resolve(-1);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { onLine, lineEvent: THREAD_RECORD_EVENT, thread: running.id, line: done },
  );
  expect(folded, `접힌 때 ${Math.round(folded)}ms`).toBeGreaterThanOrEqual(680);
  expect(folded).toBeLessThan(1200);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("펼친 작업 로그의 줄 사이는 4이고, 파일 줄을 펴면 변경 카드가 머리 30 · 줄 21.6 · 몸 240까지로 선다", async ({ page }) => {
  const ended: ThreadView = { ...running, live: false, lastSeq: twoTurns[twoTurns.length - 1].seq };
  await open(page, ended, twoTurns);
  await 흐름(page).getByRole("button", { name: "10초 동안 작업함", exact: true }).click();
  const rows = 흐름(page).getByRole("group", { name: /^(생성됨|읽음|실행 완료) / });
  await expect(rows).toHaveCount(3);
  await expect.poll(() => 흐름(page).locator(".unfold").evaluate((el) => el.getAnimations().length)).toBe(0);
  const gaps = await rows.evaluateAll((all) => all.slice(1).map((row, at) => Math.round(row.getBoundingClientRect().top - all[at].getBoundingClientRect().bottom)));
  expect(gaps, "로그 줄 사이").toEqual([4, 4]);

  await 흐름(page).getByRole("group", { name: "생성됨 notes.txt", exact: true }).getByRole("button").first().click();
  const card = 흐름(page).getByRole("figure", { name: /notes\.txt 변경$/ });
  await expect(card).toBeVisible();
  const head = card.locator("figcaption");
  expect(await 스타일(head, "height", "font-size", "line-height", "color")).toEqual({
    height: "30px",
    "font-size": "13px",
    "line-height": "18px",
    color: await 토큰색(page, "--fg-tool"),
  });
  const body = card.locator(":scope > div").last();
  expect(await 스타일(body, "max-height", "line-height", "font-size")).toEqual({ "max-height": "240px", "line-height": "21.6px", "font-size": "12px" });
  expect((await 스타일(card, "border-top-left-radius"))["border-top-left-radius"]).toBe("12px");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("계획 체크리스트는 10 12 · 둥근 12 · fill-soft 상자에 「계획 n / m」 머리와 24 항목이 서고, 끝난 항목은 옅고 하는 중인 항목은 짙다", async ({ page }) => {
  await open(page, running, linesThrough(twoTurns, SECOND_SENT));
  await streamLines(page, running.id, [
    update(SECOND_SENT + 1, {
      sessionUpdate: "plan",
      entries: [
        { content: "실패 신호를 읽는다", status: "completed", priority: "medium" },
        { content: "배너를 띄운다", status: "in_progress", priority: "medium" },
        { content: "테스트를 돌린다", status: "pending", priority: "medium" },
      ],
    }),
  ]);
  const list = 흐름(page).getByRole("group", { name: "계획 체크리스트", exact: true });
  await expect(list).toBeVisible();
  await expect(list).toContainText("계획1 / 3");
  expect(await 스타일(list, "padding", "border-top-left-radius", "background-color", "row-gap")).toEqual({
    padding: "10px 12px",
    "border-top-left-radius": "12px",
    "background-color": await 토큰색(page, "--fill-soft"),
    "row-gap": "2px",
  });
  const items = list.getByRole("listitem");
  await expect(items).toHaveCount(3);
  expect(await items.evaluateAll((all) => all.map((el) => Math.round(el.getBoundingClientRect().height)))).toEqual([24, 24, 24]);
  expect(await items.evaluateAll((all) => all.map((el) => getComputedStyle(el).color))).toEqual([
    await 토큰색(page, "--fg-tertiary"),
    await 토큰색(page, "--fg"),
    await 토큰색(page, "--fg-secondary"),
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("서브에이전트의 안 줄은 글리프 가운데 7의 1px border-heavy 세로선 안 13에 줄 사이 4로 선다", async ({ page }) => {
  const subagent = record("thread-subagent");
  const last = subagent[subagent.length - 1].seq;
  const ended: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(subagent)[0].text, live: false, lastSeq: last };
  await open(page, ended, subagent);
  await 흐름(page).getByRole("button", { name: /초 동안 작업함$/ }).last().click();
  const agent = 흐름(page).getByRole("group", { name: /에게 맡김$/ });
  await expect(agent).toBeVisible();
  const head = agent.getByRole("button").first();
  if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
  const inner = agent.locator("[data-inner-tools]");
  await expect(inner).toBeVisible();
  expect(await 스타일(inner, "margin-left", "border-left-width", "border-left-color", "padding-left", "row-gap")).toEqual({
    "margin-left": "7px",
    "border-left-width": "1px",
    "border-left-color": await 토큰색(page, "--border-heavy"),
    "padding-left": "12px",
    "row-gap": "4px",
  });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const permission = record("thread-permission");
const ASKED = permission.find((line) => line.kind === "permission" && (line.payload as { state?: string }).state === "asked")!;

test("승인을 기다리는 동안 머리는 시간 없이 경고색 「승인을 기다립니다」에 머물고, 끝난 머리는 기다린 시간을 뺀 「8초 동안 작업함」이다(기록 9초)", async ({ page }) => {
  const asking: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(permission)[0].text, live: true, lastSeq: ASKED.seq };
  await open(page, asking, linesThrough(permission, ASKED.seq));
  const head = 흐름(page).locator("[data-work-divider]");
  await expect(head).toHaveText("승인을 기다립니다");
  expect((await 스타일(head.getByText("승인을 기다립니다", { exact: true }), "color")).color).toBe(await 토큰색(page, "--warning"));
  // 시계가 멈춘다 — 1.5초 뒤에도 초가 서지 않는다.
  await page.waitForTimeout(1500);
  await expect(head).toHaveText("승인을 기다립니다");

  const last = permission[permission.length - 1].seq;
  const ended: ThreadView = { ...asking, live: false, lastSeq: last };
  await open(page, ended, permission);
  await expect(흐름(page).locator("[data-work-divider]")).toHaveText(["8초 동안 작업함"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("멈춘 줄과 거부한 줄은 16 칸 가운데 9 · 둥근 2의 ■이고 글자색이다 — 「중지됨 …」 · 「만들지 않음 …」", async ({ page }) => {
  const stopped = record("thread-stopped");
  const ended: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(stopped)[0].text, live: false, lastSeq: stopped[stopped.length - 1].seq };
  await open(page, ended, stopped);
  const row = 흐름(page).getByRole("group", { name: /^중지됨 / });
  await expect(row).toBeVisible();
  const mark = row.locator('[data-glyph="stopped"]');
  const square = mark.locator("span");
  expect(await 스타일(mark, "width", "height")).toEqual({ width: "16px", height: "16px" });
  expect(await 스타일(square, "width", "height", "border-top-left-radius")).toEqual({ width: "9px", height: "9px", "border-top-left-radius": "2px" });
  expect((await 스타일(square, "background-color"))["background-color"]).toBe((await 스타일(row.getByRole("button").first(), "color")).color);

  const turns = record("thread-ask-turns");
  const refused: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(turns)[0].text, live: false, lastSeq: turns[turns.length - 1].seq };
  await open(page, refused, turns);
  await 흐름(page).getByRole("button", { name: /초 동안 작업함$/ }).last().click();
  const no = 흐름(page).getByRole("group", { name: /않음 denied\.txt$/ });
  await expect(no).toBeVisible();
  await expect(no.locator('[data-glyph="stopped"]')).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
