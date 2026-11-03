import { THREAD_RECORD_EVENT } from "@/features/thread/events";
import type { EngineCheck, RecordLine, ThreadView } from "@/features/thread/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { callCount, eventHandler, installFixtureBackend, unknownIpcCalls, 토큰색 } from "./harness";
import { linesThrough, record, sentPayloads, seqOf, streamLines, summaryOf } from "./thread-records";

// restart 02b-9a — **승인 · 질문 · 안내 카드**(restart 02b-5 · Cards 보드 · `시안-비교/02b-5/차이.md`). 카드는 사람의 답을 기다리는 한 겉(`.ra-ask`)이고
// 입력창 자리에 아래 12에서 올라와(`card-rise` 320) 답하면 그 첫 프레임에 걷히며 입력창이 `row-in` 200으로 돌아온다. 결정 줄은 `chip-in` 280이다.
// 안내 줄(「앱이 막음」 · Runtime 경고)은 열 폭 `fill-soft` 상자다. 값은 차이.md 「같은 것」 · 「움직임」 표다.
//
// 기록은 축복한 `thread-permission`(Claude 파일 편집 승인)과 `thread-codex-refused`(Codex가 작업공간 밖을 고치려다 앱이 막은 턴)이다. MCP 도구 ·
// 계획 넘어가기 · Codex가 묻는 승인은 녹음이 없어 축복한 물음 줄의 꼴을 그대로 두고 도구만 바꿔 지었다.

const 흐름 = (page: Page) => page.getByRole("main");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 카드는 선 직후 잠깐 키를 받지 않는다(`ApprovalCard`의 `ARMING_MS`). */
const ARMING_MS = 300;

const permission = record("thread-permission");
const ASKED = permission.find((line) => line.kind === "permission" && (line.payload as { state?: string }).state === "asked")!;
const ANSWERED = permission.find((line) => line.kind === "permission" && (line.payload as { state?: string }).state === "answered")!;

type Payload = { request: { toolCall: Record<string, unknown>; options: unknown[]; _meta?: unknown }; toolCall: Record<string, unknown> } & Record<string, unknown>;

/**
 * 축복한 물음 줄의 도구 · 선택지를 바꾼 물음 — 앱의 판정 칸(`card` · `policy` · `grant`)과 Claude가 실은 원래 요청(`request._meta` — 도구 이름 ·
 * 입력이 `Write` 그대로다)은 뺀다. 도구 id도 새것이다 — 같은 id면 기록에 앞서 선 `Write` 도구 줄과 합쳐 읽힌다.
 */
function askedWith(toolCall: Record<string, unknown>, options?: unknown[]): RecordLine {
  const payload = structuredClone(ASKED.payload) as Payload;
  delete payload.card;
  delete payload.policy;
  delete payload.grant;
  const call = { ...payload.toolCall, toolCallId: "toolu_card_asked", ...toolCall };
  payload.toolCall = call;
  const { _meta: _, ...request } = payload.request;
  payload.request = { ...request, toolCall: call, ...(options && { options }) };
  return { ...ASKED, payload };
}

/** 물음 바로 앞까지의 도는 채팅을 연다. */
async function openBefore(page: Page, lines: readonly RecordLine[], asked: RecordLine, more: Partial<ThreadView> = {}, answers: Record<string, unknown> = {}) {
  const view: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(lines)[0].text, live: true, lastSeq: asked.seq - 1, ...more };
  await installFixtureBackend(page, {
    ...answers,
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: linesThrough(lines, view.lastSeq) }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: view.lastSeq } }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(view.title, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(입력칸(page)).toBeVisible();
  return view;
}

const 스타일 = (target: Locator, ...names: string[]) =>
  target.evaluate((el, keys) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key)]));
  }, names);

const 높이 = async (target: Locator) => Math.round((await target.boundingBox())!.height);

test("승인 카드는 위 칸 14 16 10 · 갈래 12 fg-tool · 물음 14 500 · 단추 줄 2 10 10 12의 겉이고, 허락 알약 28 · 거부 32 · 허용 32 검은 알약이며, 짧은 diff는 끝 줄까지 옅어지지 않는다", async ({
  page,
}) => {
  const view = await openBefore(page, permission, ASKED);
  await streamLines(page, view.id, [ASKED]);
  const card = page.getByRole("group", { name: "Claude Code가 이 파일을 편집하도록 허용할까요?", exact: true });
  await expect(card).toBeVisible();

  expect(await 스타일(card, "overflow", "border-top-left-radius")).toEqual({ overflow: "hidden", "border-top-left-radius": "22px" });
  const top = card.locator(":scope > div").first();
  expect(await 스타일(top, "padding", "row-gap")).toEqual({ padding: "14px 16px 10px", "row-gap": "8px" });
  const kind = top.locator(":scope > div").first();
  await expect(kind).toHaveText("파일 편집");
  expect(await 스타일(kind, "font-size", "line-height", "color")).toEqual({
    "font-size": "12px",
    "line-height": "18px",
    color: await 토큰색(page, "--fg-tool"),
  });
  const title = top.getByText("Claude Code가 이 파일을 편집하도록 허용할까요?", { exact: true });
  expect(await 스타일(title, "font-size", "line-height", "font-weight", "color")).toEqual({
    "font-size": "14px",
    "line-height": "20px",
    "font-weight": "500",
    color: await 토큰색(page, "--fg"),
  });
  const acts = card.locator("[data-acts]");
  expect(await 스타일(acts, "padding", "column-gap", "flex-wrap")).toEqual({ padding: "2px 10px 10px 12px", "column-gap": "8px", "flex-wrap": "wrap" });

  const [grant, refuse, allow] = [card.getByRole("button", { name: "이 채팅의 모든 편집 허용" }), card.getByRole("button", { name: /^거부/ }), card.getByRole("button", { name: /^한 번만 허용/ })];
  expect([await 높이(grant), await 높이(refuse), await 높이(allow)]).toEqual([28, 32, 32]);
  expect(await 스타일(allow, "background-color", "color", "font-weight")).toEqual({
    "background-color": await 토큰색(page, "--fg"),
    color: await 토큰색(page, "--fg-inverse"),
    "font-weight": "500",
  });

  // 한 줄 diff는 132를 넘지 않아 끝 줄까지 옅어지지 않는다.
  const peek = card.getByRole("figure");
  expect(await 스타일(peek, "-webkit-mask-image", "max-height", "line-height")).toEqual({ "-webkit-mask-image": "none", "max-height": "132px", "line-height": "21.6px" });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("승인 카드의 diff가 132를 넘치면 132에서 잘리고 아래 70%부터 옅어진다", async ({ page }) => {
  // 쓰는 글이 열두 줄이다 — 기록의 도구 줄과 물음 줄(원래 요청까지) 모두 바꾼다. 카드의 diff는 그 턴의 도구 줄이 실은 글이다.
  const content = Array.from({ length: 12 }, (_, at) => `줄 ${at + 1}`).join("\n");
  const lines = JSON.parse(
    JSON.stringify(permission)
      .replace(/"content":"x"/g, `"content":${JSON.stringify(content)}`)
      .replace(/"newText":"x"/g, `"newText":${JSON.stringify(content)}`),
  ) as RecordLine[];
  const long = lines.find((line) => line.seq === ASKED.seq)!;
  const view = await openBefore(page, lines, long);
  await streamLines(page, view.id, [long]);
  const peek = page.getByRole("group", { name: "Claude Code가 이 파일을 편집하도록 허용할까요?", exact: true }).getByRole("figure");
  await expect(peek).toBeVisible();
  expect(await 높이(peek)).toBe(132);
  expect((await 스타일(peek, "-webkit-mask-image"))["-webkit-mask-image"]).toMatch(/linear-gradient\(.*70%.*\)/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("승인 카드는 card-rise 320으로 올라오고, 답 줄이 온 첫 프레임에 걷히며 입력창이 row-in 200으로 돌아오고, 결정 줄이 왼쪽 가운데 축의 chip-in 280으로 선다", async ({
  page,
}) => {
  const view = await openBefore(page, permission, ASKED);
  await streamLines(page, view.id, [ASKED]);
  const card = page.getByRole("group", { name: "Claude Code가 이 파일을 편집하도록 허용할까요?", exact: true });
  await expect(card).toBeVisible();
  const rise = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((one): one is CSSAnimation => one instanceof CSSAnimation && one.animationName === "card-rise")
      .map((one) => {
        const target = (one.effect as KeyframeEffect).target as Element;
        return [one.effect?.getTiming().duration, getComputedStyle(target).animationTimingFunction, getComputedStyle(target).animationFillMode];
      }),
  );
  expect(rise).toEqual([[320, "cubic-bezier(0.2, 0.8, 0.2, 1)", "both"]]);

  // 답 줄을 페이지 안에서 쏘고 바로 다음 프레임에 본다 — 카드가 이미 없고 입력창이 `row-in`으로 돌아오는 중이다.
  await page.waitForTimeout(ARMING_MS);
  const held = await card.elementHandle();
  const onLine = await eventHandler(page, THREAD_RECORD_EVENT);
  const first = await page.evaluate(
    ({ onLine, lineEvent, thread, line, held }) =>
      new Promise<{ cardGone: boolean; composer: string[] }>((done) => {
        const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }).__TAURI_INTERNALS__;
        internals.runCallback(onLine, { event: lineEvent, id: 0, payload: { thread, seq: line.seq, line } });
        requestAnimationFrame(() => {
          const field = document.querySelector('textarea[aria-label="보낼 말"]');
          const moving = document
            .getAnimations()
            .filter((one): one is CSSAnimation => one instanceof CSSAnimation && field !== null && ((one.effect as KeyframeEffect).target as Element).contains(field))
            .map((one) => `${one.animationName} ${one.effect?.getTiming().duration}`);
          done({ cardGone: !(held as Element).isConnected, composer: moving });
        });
      }),
    { onLine, lineEvent: THREAD_RECORD_EVENT, thread: view.id, line: ANSWERED, held },
  );
  expect(first).toEqual({ cardGone: true, composer: ["row-in 200"] });

  const decision = 흐름(page).locator("[data-decision]");
  await expect(decision).toHaveText("한 번만 허용함");
  expect(
    await decision.evaluate((el) => {
      const [one] = el.getAnimations() as CSSAnimation[];
      return [one?.animationName, one?.effect?.getTiming().duration, getComputedStyle(el).animationTimingFunction, getComputedStyle(el).transformOrigin];
    }),
  ).toEqual(["chip-in", 280, "cubic-bezier(0.23, 1, 0.32, 1)", "0px 12px"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("MCP 승인 카드의 「세부 정보 보기」는 도구에 보낸 값을 카드 안에서 높이 · 옅음 300으로 펼치고 다시 접는다", async ({ page }) => {
  const input = { owner: "atelier", repo: "atelier", title: "실패 신호 다시 보기" };
  const asked = askedWith({ title: "mcp__github__create_issue", kind: "other", rawInput: input, _meta: { claudeCode: { toolName: "mcp__github__create_issue" } } });
  const view = await openBefore(page, permission, asked);
  await streamLines(page, view.id, [asked]);
  const card = page.getByRole("group", { name: "github에 create_issue 도구 실행을 허용할까요?", exact: true });
  await expect(card).toBeVisible();
  await expect(card.locator(":scope > div").first().locator(":scope > div").first()).toHaveText("MCP");

  const details = card.getByRole("button", { name: "세부 정보 보기", exact: true });
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(card.getByText('"repo": "atelier"')).toHaveCount(0);
  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  const box = card.locator(".unfold");
  expect(
    await box.evaluate((el) => el.getAnimations().map((one) => [(one as CSSTransition).transitionProperty, Number(one.effect?.getTiming().duration)])),
  ).toEqual(expect.arrayContaining([["grid-template-rows", 300], ["opacity", 300]]));
  await expect(card.locator("pre")).toHaveText(JSON.stringify(input, null, 2));
  await expect(card.locator("pre")).toBeVisible();
  // 셰브런이 90° 돈다.
  await expect.poll(() => details.locator("svg").evaluate((el) => getComputedStyle(el).rotate)).toBe("90deg");

  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(card.locator("pre")).toHaveCount(0);
  expect(await callCount(page, "thread_answer_permission")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("계획 카드의 「다시 짜기」는 카드 안에 고칠 점 칸을 열고, 칸의 esc는 칸만 닫아 카드로 돌아오며 아무 답도 보내지 않는다", async ({ page }) => {
  const asked = askedWith(
    { title: "Ready to code?", kind: "switch_mode", rawInput: { plan: "1. 실패 신호를 읽는다\n2. 배너를 띄운다" }, _meta: { claudeCode: { toolName: "ExitPlanMode" } } },
    [
      { optionId: "default", name: "Yes, and manually approve edits", kind: "allow_once" },
      { optionId: "plan", name: "No, keep planning", kind: "reject_once" },
    ],
  );
  const view = await openBefore(page, permission, asked);
  await streamLines(page, view.id, [asked]);
  const card = page.getByRole("group", { name: "이 계획대로 진행할까요?", exact: true });
  await expect(card).toBeVisible();
  await expect(card.locator("[data-acts]").getByRole("button")).toHaveText(["다시 짜기", /^구현/]);

  await page.waitForTimeout(ARMING_MS);
  await card.getByRole("button", { name: "다시 짜기", exact: true }).click();
  const field = card.getByRole("textbox");
  await expect(field).toBeFocused();
  await field.fill("배너 대신 알림으로");
  await field.press("Escape");
  await expect(card.getByRole("textbox")).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "다시 짜기", exact: true })).toBeVisible();
  expect(await callCount(page, "thread_answer_permission")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const CODEX_FOUND: EngineCheck = {
  state: "found",
  programs: [
    { name: "codex-acp", path: "/opt/fixture/bin/codex-acp" },
    { name: "codex", path: "/opt/fixture/bin/codex" },
  ],
  loggedIn: true,
};
const codexRefused = record("thread-codex-refused");

test.describe(() => {
  // Main의 대화 열과 같은 좁은 창 — 카드가 열 폭을 따라 줄어든다.
  test.use({ viewport: { width: 778, height: 900 } });

  test("Codex 승인 카드는 보낸 선택지 이름을 그대로 그리고, 좁은 카드에서 긴 이름은 단추 안에서 접히며 거부 · 허용은 한 줄에 남는다", async ({ page }) => {
    const decided = codexRefused.find((line) => line.kind === "permission")!;
    const { request, toolCall } = decided.payload as Payload;
    const asked: RecordLine = { ...decided, payload: { state: "asked", requestId: "0", request, toolCall } };
    const view = await openBefore(page, codexRefused, asked, { runtime: "codex", codexMode: "agent" }, {
      thread_check_engine: answerByArg("runtime", { codex: CODEX_FOUND }),
    });
    await streamLines(page, view.id, [asked]);
    const card = page.getByRole("group", { name: /할까요\?$/ });
    await expect(card).toBeVisible();
    // 올라오는 동안은 자리가 움직인다 — 다 선 뒤에 잰다.
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().filter((one) => one.playState === "running" && (one as CSSAnimation).animationName === "card-rise").length))
      .toBe(0);
    const acts = card.locator("[data-acts]");
    await expect(acts).toHaveAttribute("data-acts", "long");
    await expect(acts.getByRole("button")).toHaveText(["Yes, and don't ask again for these files", /^거부/, /^한 번만 허용/]);
    const [long, refuse, allow] = [acts.getByRole("button").nth(0), acts.getByRole("button").nth(1), acts.getByRole("button").nth(2)];
    const cardWidth = Math.round((await card.boundingBox())!.width);
    expect(cardWidth, "좁은 카드").toBeLessThanOrEqual(460);
    // 긴 이름은 두 줄(46)로 접히고 둥근 8 · 왼쪽 맞춤이다. 거부 · 허용은 같은 줄이다.
    expect(await 높이(long)).toBe(46);
    expect(await 스타일(long, "border-top-left-radius", "text-align", "white-space")).toEqual({
      "border-top-left-radius": "8px",
      "text-align": "left",
      "white-space": "normal",
    });
    const [refuseBox, allowBox, longBox] = [await refuse.boundingBox(), await allow.boundingBox(), await long.boundingBox()];
    expect(Math.round(refuseBox!.y)).toBe(Math.round(allowBox!.y));
    expect(Math.abs(refuseBox!.y + refuseBox!.height / 2 - (longBox!.y + longBox!.height / 2)), "긴 알약과 같은 가운데").toBeLessThanOrEqual(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test("앱이 막아 멈춘 Codex 턴은 엔진의 거절 글 대신 사람의 말로 까닭을 보인다 — 경로 · 도구 이름이 없다", async ({ page }) => {
  const last = codexRefused[codexRefused.length - 1].seq;
  const ended: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(codexRefused)[0].text, runtime: "codex", codexMode: "agent", live: false, lastSeq: last };
  await installFixtureBackend(page, {
    thread_check_engine: answerByArg("runtime", { codex: CODEX_FOUND }),
    thread_list: [summaryOf(ended)],
    thread_get: answerByArg("thread", { [ended.id]: ended }),
    thread_read_record: answerByArg("thread", { [ended.id]: codexRefused }),
    thread_mark_read: answerByArg("thread", { [ended.id]: summaryOf(ended) }),
  });
  await page.goto(`/threads/${ended.id}`);
  const notice = 흐름(page).locator('[data-end-notice="app-refused"]');
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toHaveText(/^앱이 이 편집을 막았어요\.\s*작업공간 밖 파일이라 고칠 수 없어요\. 이 작업공간의 worktree와 spec 폴더 안에서만 고칠 수 있어요\.$/);
  await expect(notice).not.toContainText("/Users/");
  await expect(흐름(page).locator("[data-work-divider]").filter({ hasText: "앱이 막아서 멈췄어요" })).toHaveCount(1);
  expect(await 스타일(notice, "min-height", "padding", "border-top-left-radius", "background-color", "font-size", "line-height", "color")).toEqual({
    "min-height": "40px",
    padding: "8px 8px 8px 12px",
    "border-top-left-radius": "12px",
    "background-color": await 토큰색(page, "--fill-soft"),
    "font-size": "13px",
    "line-height": "18px",
    color: await 토큰색(page, "--fg-secondary"),
  });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Runtime 경고(restart 02b-5 · Cards 보드 「Runtime 경고」) — 도는 턴에 온 stderr 줄은 한 안내로 묶여 첫 줄만 서고, 「자세히」가 묶인 줄을 모두 안내
// 안에서 펼친다. 펼친 동안 단추는 `aria-expanded`다.
test("도는 턴의 Runtime 경고는 첫 줄과 「자세히」(24 · 좌우 8 · 둥근 10)의 안내 상자이고 대화를 막지 않으며, 「자세히」가 묶인 stderr 줄을 모두 펼친다", async ({ page }) => {
  const twoTurns = record("thread-two-turns");
  const sent = seqOf(twoTurns, "sent", 2);
  const running: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(twoTurns)[0].text, live: true, lastSeq: sent };
  await installFixtureBackend(page, {
    thread_list: [summaryOf(running)],
    thread_get: answerByArg("thread", { [running.id]: running }),
    thread_read_record: answerByArg("thread", { [running.id]: linesThrough(twoTurns, sent) }),
    thread_mark_read: answerByArg("thread", { [running.id]: summaryOf(running) }),
  });
  await page.goto(`/threads/${running.id}`);
  await expect(흐름(page).getByText("생각 중", { exact: true })).toBeVisible({ timeout: 20_000 });

  const words = ["warning: MCP 서버 github가 늦게 답해요", "  at connect (mcp.js:42)", "  retrying in 2s"];
  const at = twoTurns[sent - 1].at;
  await streamLines(
    page,
    running.id,
    words.map((line, index) => ({ seq: sent + index + 1, at, kind: "stderr", payload: { line } }) as RecordLine),
  );
  const warning = 흐름(page).locator("[data-warning]");
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText(words[0]);
  await expect(warning).not.toContainText("retrying");
  // 대화는 막히지 않는다 — 턴은 그대로 「생각 중」이고 입력창은 말을 받는다.
  await expect(흐름(page).getByText("생각 중", { exact: true })).toBeVisible();
  await expect(입력칸(page)).toBeEditable();
  expect(await 스타일(warning, "min-height", "padding", "border-top-left-radius", "background-color", "color")).toEqual({
    "min-height": "40px",
    padding: "8px 8px 8px 12px",
    "border-top-left-radius": "12px",
    "background-color": await 토큰색(page, "--fill-soft"),
    color: await 토큰색(page, "--fg-secondary"),
  });
  const more = warning.getByRole("button", { name: "자세히", exact: true });
  expect(await 높이(more)).toBe(24);
  expect(await 스타일(more, "padding-left", "border-top-left-radius", "font-size", "line-height")).toEqual({
    "padding-left": "8px",
    "border-top-left-radius": "10px",
    "font-size": "12px",
    "line-height": "18px",
  });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(warning.locator("pre")).toHaveText(words.join("\n"));
  await more.click();
  await expect(warning.locator("pre")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
