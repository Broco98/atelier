import type { RecordLine, ThreadView } from "@/features/thread/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD, WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls, 토큰색 } from "./harness";
import { linesThrough, record, sentPayloads, seqOf, streamLines, summaryOf } from "./thread-records";

// restart 02b-9a — **대화의 흐름 · States 보드**(restart 02b-1 · States 02 · 04 · 13 · 14 · 15 · 16 · Cards 「내 말」 · 「답 본문」 ·
// `시안-비교/02b-1/차이.md` 「같은 것」). 흐름 열은 737이고 위 32 · 아래 28이다. 말풍선은 10 / 16 · 둥근 22 · 14 / 22.75이고, 말풍선 → 턴 머리 46 · 선 →
// 답 16 · 답 끝 → 다음 말풍선 48이다. 답 본문은 문단 사이 12 · 목록 안쪽 22 · 사이 4 · 인라인 코드 .92em · 1 6 · 둥근 6 · `fill-soft`다. 「생각 중」 ·
// 「채팅을 시작하는 중」은 말풍선 아래 46이고, 멈춘 턴은 머리 → 로그 첫 줄 12, 끊긴 턴은 머리 없이 말 아래 42에 로그가 서고 안내가 16 아래다.

test.use({ viewport: { width: 1440, height: 900 } });

const twoTurns = record("thread-two-turns");
const FIRST_END = seqOf(twoTurns, "turn-end", 1);
const SECOND_SENT = seqOf(twoTurns, "sent", 2);
const LAST = twoTurns[twoTurns.length - 1].seq;
const [FIRST, SECOND] = sentPayloads(twoTurns);

/** 첫 답을 문단 · 인라인 코드 · 목록이 든 마크다운으로 바꾼 두 턴 — 답 본문의 모양을 잰다. */
const PROSE = "첫 문단이다.\n\n둘째 문단에 `notes.txt` 코드가 있다.\n\n- 하나\n- 둘\n- 셋";
const proseTurns: RecordLine[] = twoTurns.map((line) => {
  const update = (line.payload as { update?: { sessionUpdate?: string; content?: object } }).update;
  if (line.seq > FIRST_END || update?.sessionUpdate !== "agent_message_chunk") return line;
  return { ...line, payload: { ...(line.payload as object), update: { ...update, content: { ...update.content, text: PROSE } } } };
});

const 흐름 = (page: Page) => page.getByRole("main");
const 상자 = async (target: Locator) => {
  const box = (await target.boundingBox())!;
  return { ...box, bottom: box.y + box.height, right: box.x + box.width };
};
const 스타일 = (target: Locator, ...names: string[]) =>
  target.evaluate((el, keys) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key)]));
  }, names);

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

/** 말풍선 — 내 말 묶음의 글 상자. */
const 말풍선 = (page: Page, text: string) => 흐름(page).locator("[data-user-message]").getByText(text, { exact: true });

test("턴 끝(States 13) — 흐름 열 737 · 위 32, 말풍선 10 16 · 둥근 22 · 14 / 22.75, 말풍선 → 머리 46 · 선 → 답 16 · 답 끝 → 다음 말풍선 48이고, 답 본문은 문단 12 · 목록 22 / 4 · 인라인 코드 .92em 1 6 · 둥근 6이다", async ({
  page,
}) => {
  const ended: ThreadView = { ...FIXTURE_THREAD, title: FIRST.text, live: false, lastSeq: LAST };
  await open(page, ended, proseTurns);
  const bubble = 말풍선(page, FIRST.text);
  expect(await 스타일(bubble, "padding", "border-top-left-radius", "font-size", "line-height", "color", "background-color")).toEqual({
    padding: "10px 16px",
    "border-top-left-radius": "22px",
    "font-size": "14px",
    "line-height": "22.75px",
    color: await 토큰색(page, "--bubble-user-fg"),
    "background-color": await 토큰색(page, "--bubble-user"),
  });

  // 흐름 열 · 위 여백 — 굴림 상자의 위에서 첫 말풍선까지 32다.
  const scroller = await 흐름(page).evaluate((main) => {
    const box = [...main.querySelectorAll<HTMLElement>("div")].find((el) => getComputedStyle(el).overflowY === "auto");
    return { top: box!.getBoundingClientRect().top, paddingBottom: getComputedStyle(box!).paddingBottom };
  });
  const answer = 흐름(page).getByText("첫 문단이다.", { exact: true });
  const turnBox = answer.locator("xpath=ancestor::*[@data-turn][1]");
  expect(Math.round((await 상자(turnBox)).width), "흐름 열").toBe(737);
  expect(Math.round((await 상자(bubble)).y - scroller.top), "흐름 위").toBe(32);
  expect(scroller.paddingBottom, "흐름 아래").toBe("28px");

  // 말풍선 → 머리 46 · 선 → 답 16 · 답 끝 → 다음 말풍선 48.
  const head = 흐름(page).locator("[data-work-divider]").first();
  const rule = head.locator("xpath=../div[@aria-hidden]");
  // 첫 턴은 말만 한 턴이라 머리가 없다 — 머리 · 선은 둘째 턴에서 잰다.
  const second = 말풍선(page, SECOND.text);
  expect(Math.round((await 상자(head)).y - (await 상자(second)).bottom), "말풍선 → 머리").toBe(46);
  const lastAnswer = 흐름(page).locator("[data-turn-box]").last().locator("p").last();
  expect(Math.round((await 상자(lastAnswer)).y - (await 상자(rule)).bottom), "선 → 답").toBe(16);
  const firstAnswerEnd = 흐름(page).locator("[data-turn-box]").first().locator("ul").last();
  expect(Math.round((await 상자(second)).y - (await 상자(firstAnswerEnd)).bottom), "답 끝 → 다음 말풍선(답 아래 줄은 마지막 턴만)").toBe(48);

  // 답 본문.
  const paragraphs = 흐름(page).locator("[data-turn-box]").first().locator("p");
  const [p1, p2] = [await 상자(paragraphs.nth(1)), await 상자(paragraphs.nth(2))];
  expect(Math.round(p2.y - p1.bottom), "문단 사이").toBe(12);
  const list = 흐름(page).locator("[data-turn-box]").first().locator("ul");
  expect(await 스타일(list, "padding-left", "row-gap")).toEqual({ "padding-left": "22px", "row-gap": "4px" });
  const code = 흐름(page).locator("[data-turn-box]").first().locator("code", { hasText: "notes.txt" });
  expect(await 스타일(code, "font-size", "padding", "border-top-left-radius", "background-color")).toEqual({
    "font-size": "12.88px",
    padding: "1px 6px",
    "border-top-left-radius": "6px",
    "background-color": await 토큰색(page, "--fill-soft"),
  });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("생각 중(States 04)은 말풍선 아래 46에 머리 없이 think-sweep 14 / 22로 서고, Session이 내려간 채팅에 보내면(States 02) 같은 자리에 「채팅을 시작하는 중」이 chat-shimmer로 선다", async ({
  page,
}) => {
  const running: ThreadView = { ...FIXTURE_THREAD, title: FIRST.text, live: true, lastSeq: SECOND_SENT };
  await open(page, running, linesThrough(twoTurns, SECOND_SENT));
  const thinking = 흐름(page).getByText("생각 중", { exact: true });
  await expect(thinking).toBeVisible();
  await expect(흐름(page).locator("[data-work-divider]")).toHaveCount(0);
  expect(Math.round((await 상자(thinking)).y - (await 상자(말풍선(page, SECOND.text))).bottom), "말풍선 → 생각 중").toBe(46);
  expect(await 스타일(thinking, "animation-name", "font-size", "line-height")).toEqual({ "animation-name": "think-sweep", "font-size": "14px", "line-height": "22px" });

  const ended: ThreadView = { ...FIXTURE_THREAD, title: FIRST.text, live: false, lastSeq: FIRST_END };
  await open(page, ended, linesThrough(twoTurns, FIRST_END));
  const field = page.getByRole("textbox", { name: "보낼 말", exact: true });
  await field.fill(SECOND.text);
  await field.press("Enter");
  // 엔진이 Session을 다시 띄우기 시작한다 — 기록의 `spawning` 줄이다. 보낸 말은 아직 기록에 없다.
  const before = twoTurns[FIRST_END - 1];
  await streamLines(page, ended.id, [{ seq: FIRST_END + 1, at: before.at, kind: "session", payload: { state: "spawning" } }]);
  const starting = 흐름(page).locator("[data-pending]").getByText("채팅을 시작하는 중", { exact: true });
  await expect(starting).toBeVisible();
  // 말풍선은 오르는 중이다(`msg-rise`) — 다 선 뒤에 잰다.
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((one) => one.playState === "running" && (one as CSSAnimation).animationName === "msg-rise").length)).toBe(0);
  expect(Math.round((await 상자(starting)).y - (await 상자(흐름(page).locator("[data-pending]").getByText(SECOND.text, { exact: true }))).bottom)).toBe(46);
  expect(await 스타일(starting, "animation-name", "font-size", "line-height")).toEqual({ "animation-name": "chat-shimmer", "font-size": "14px", "line-height": "22px" });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("사람이 멈춘 턴(States 14)은 머리 「N초 후에 중단했습니다」가 펼친 채 위에 서고 선 → 로그 첫 줄 12이며 ■ 끝 줄이 없다", async ({ page }) => {
  const stopped = record("thread-stopped");
  const ended: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(stopped)[0].text, live: false, lastSeq: stopped[stopped.length - 1].seq };
  await open(page, ended, stopped);
  const head = 흐름(page).getByRole("button", { name: /초 후에 중단했습니다$/ });
  await expect(head).toHaveAttribute("aria-expanded", "true");
  const rule = head.locator("xpath=../div[@aria-hidden]");
  // 로그의 첫 줄은 머리 다음 칸이다(묻지 않고 허용한 판정의 방패 줄 — 그 아래 「중지됨 …」).
  const firstEntry = head.locator("xpath=ancestor::*[@data-turn-head][1]/following-sibling::*[1]");
  expect(Math.round((await 상자(firstEntry)).y - (await 상자(rule)).bottom), "선 → 첫 줄").toBe(12);
  const stoppedRow = 흐름(page).getByRole("group", { name: /^중지됨 / });
  expect((await 상자(head)).y).toBeLessThan((await 상자(stoppedRow)).y);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Session이 죽어 끊긴 턴(States 15)은 머리 없이 한 일이 말 아래 42에 서고, 16 아래 안내 상자(40 · 8 8 8 12 · 둥근 12 · fill-soft · 13 / 18)가 연결이 끊겼다고 말한다", async ({
  page,
}) => {
  const running: ThreadView = { ...FIXTURE_THREAD, title: FIRST.text, live: true, lastSeq: SECOND_SENT };
  await open(page, running, linesThrough(twoTurns, SECOND_SENT));
  const runDone = seqOf(twoTurns, "update", 8);
  const lines = linesThrough(twoTurns.filter((line) => line.seq > SECOND_SENT), runDone);
  const last = lines[lines.length - 1];
  await streamLines(page, running.id, [...lines, { seq: last.seq + 1, at: last.at, kind: "session", payload: { state: "died", reason: null } }]);
  const notice = 흐름(page).locator('[data-end-notice="cut"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Claude Code와 연결이 끊겼어요.");
  await expect(흐름(page).locator("[data-work-divider]")).toHaveCount(0);
  const rows = 흐름(page).getByRole("group", { name: /^(생성됨|읽음|실행 완료|중지됨) / });
  const firstRow = await 상자(rows.first());
  expect(Math.round(firstRow.y - (await 상자(말풍선(page, SECOND.text))).bottom), "말 → 첫 줄").toBe(42);
  expect(Math.round((await 상자(notice)).y - (await 상자(rows.last())).bottom), "마지막 줄 → 안내").toBe(16);
  expect(await 스타일(notice, "min-height", "padding", "border-top-left-radius", "background-color", "font-size", "line-height")).toEqual({
    "min-height": "40px",
    padding: "8px 8px 8px 12px",
    "border-top-left-radius": "12px",
    "background-color": await 토큰색(page, "--fill-soft"),
    "font-size": "13px",
    "line-height": "18px",
  });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("길이 제한으로 끝난 턴(States 16)은 답 끝 16 아래 안내에 「이어서 쓰기」(24 · 12 / 18)가 서고, 누르면 입력창에 「이어서 써 줘」를 채울 뿐 보내지 않는다", async ({ page }) => {
  const limits = record("thread-limits");
  const end = seqOf(limits, "turn-end", 2);
  const ended: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(limits)[0].text, live: false, lastSeq: end };
  await open(page, ended, linesThrough(limits, end));
  const notice = 흐름(page).locator('[data-end-notice="max_tokens"]');
  await expect(notice).toContainText("답이 길이 제한에서 끊겼어요.");
  const turn = notice.locator("xpath=ancestor::*[@data-turn][1]");
  const answerEnd = await turn.evaluate((el) => {
    const blocks = [...el.querySelectorAll("p, ul, ol, pre")].filter((one) => !one.closest("[data-end-notice]"));
    return blocks[blocks.length - 1].getBoundingClientRect().bottom;
  });
  expect(Math.round((await 상자(notice)).y - answerEnd), "답 끝 → 안내").toBe(16);
  const more = notice.getByRole("button", { name: "이어서 쓰기", exact: true });
  expect(await 스타일(more, "height", "font-size", "line-height")).toEqual({ height: "24px", "font-size": "12px", "line-height": "18px" });
  await more.click();
  await expect(page.getByRole("textbox", { name: "보낼 말", exact: true })).toHaveValue("이어서 써 줘");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 빈 채팅(States 01 · Home) — 홈은 물음 24 / 28 · 600 아래 24에 입력창이다. 작업공간의 새 채팅 탭은 물음이 대화 자리 가운데에 서고 아래 6에 slug ·
// 브랜치(13 / 18 `fg-tertiary`)이며 입력창은 바닥이다.
test("빈 채팅 — 홈은 물음 24 / 28 · 600 아래 24에 입력창이고, 작업공간 새 채팅 탭은 물음 아래 6에 slug · 브랜치가 서고 입력창이 바닥이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  expect(await 스타일(heading, "font-size", "line-height", "font-weight")).toEqual({ "font-size": "24px", "line-height": "28px", "font-weight": "600" });
  const composer = page.getByRole("textbox", { name: "보낼 말", exact: true }).locator("xpath=ancestor::form[1]");
  expect(Math.round((await 상자(composer)).y - (await 상자(heading)).bottom), "물음 → 입력창").toBe(24);
  await expect(page.locator("[data-dock]")).toHaveCount(0);

  const [pinnedWork] = WORKS;
  await page.goto(`/works/${pinnedWork.slug}?tab=chat`);
  const empty = page.locator("[data-empty-chat]");
  await expect(empty).toBeVisible({ timeout: 20_000 });
  const [question, place] = [empty.getByRole("heading", { name: "무엇을 만들까요?", exact: true }), empty.locator("p")];
  await expect(place).toHaveText(`${pinnedWork.slug} · ${pinnedWork.branch}`);
  expect(await 스타일(place, "font-size", "line-height", "color")).toEqual({ "font-size": "13px", "line-height": "18px", color: await 토큰색(page, "--fg-tertiary") });
  expect(Math.round((await 상자(place)).y - (await 상자(question)).bottom), "물음 → slug").toBe(6);
  // 입력창은 바닥(입력창 자리)이고 물음은 그 위 대화 자리 가운데다.
  const dock = await 상자(page.locator("[data-dock]"));
  expect((await 상자(empty)).bottom).toBeLessThan(dock.y);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
