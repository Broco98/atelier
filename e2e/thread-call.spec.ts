import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_HOST, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls } from "./harness";
import { fireSummary, linesAfter, linesThrough, record, sentPayloads, seqOf, streamLines, summaryOf } from "./thread-records";
import type { Participant, RecordLine, ThreadView } from "@/features/thread/types";

// v1 티켓 21(PR ② e2e) 흐름 하나 — **Host가 리뷰어를 불러 일을 맡기면 Host의 흐름에 호출 줄이 서서 하는 중 → 맡김(걸린 시간)으로
// 바뀌고, 펼치면 맡긴 것 · 받은 것 · 리뷰어의 도구 줄이, 「Session 열기」는 리뷰어의 줄만 거른 보기가, 답하지 못한 부르기는 「다시
// 맡기기」가 선다**(v1 티켓 16 · 17 · 20 · 구현 스펙 §8 · S37 · 경계 ② 「호출 줄」).
//
// 줄은 L1이 진짜 claude 2.1.309의 녹음(v1 티켓 20)을 되감아 축복한 「Host가 리뷰어를 불러 결과를 받은」 기록(`thread-call.jsonl`)을
// 그대로 쏜다 — Host는 `ToolSearch`로 `call_agent`를 들이고 부른다. 리뷰어가 들어와 `thread.json`을 읽고 제목을 한 줄로 답하면 Host가 그
// 답을 옮긴다. 맡긴 말 · 받은 말 · seq는 모두 그 기록에서 읽는다(스토리 137).

const calling = record("thread-call");
const [first] = sentPayloads(calling);
const FIRST_SENT = seqOf(calling, "sent", 1);
const CALL_ENDED = seqOf(calling, "call", 2);
const { text: TASK, answer: ANSWER } = calling.find((line) => line.seq === CALL_ENDED)!.payload as { text: string; answer: string };

/** 그 seq의 줄이 연 도구(ACP `tool_call`)의 제목. */
const toolTitle = (line: RecordLine): string | null => {
  const update = (line.payload as { update?: { sessionUpdate?: string; title?: string } }).update;
  return update?.sessionUpdate === "tool_call" ? (update.title ?? null) : null;
};
/** Host가 `call_agent`를 부른 줄 — 그 뒤에 리뷰어가 들어온다. */
const CALL_TOOL = calling.find((line) => toolTitle(line) === "mcp__atelier-thread__call_agent")!.seq;
/** 리뷰어가 맡은 일로 연 첫 도구(`Read …/thread.json`). */
const REVIEWER_READ = calling.find((line) => line.who === "reviewer" && toolTitle(line) !== null)!.seq;

const REVIEWER: Participant = {
  ...FIXTURE_HOST,
  handle: "reviewer",
  joinedAt: calling.find((line) => line.kind === "joined" && line.who === "reviewer")!.at,
  sessionId: "fake-session-2",
};

/** 첫 말로 막 선 Thread — Host의 Session이 이 앱에 떠 있고 기록은 첫 `sent`까지다. */
const started: ThreadView = { ...FIXTURE_THREAD, title: first.text, live: true, lastSeq: FIRST_SENT };
/** 리뷰어가 들어온 Thread. */
const joined: ThreadView = { ...started, participants: [FIXTURE_HOST, REVIEWER] };

const 흐름 = (page: Page) => page.getByRole("main");
const 호출줄 = (page: Page, title: string) => 흐름(page).getByRole("group", { name: title, exact: true });
const 도구줄 = (page: Page, phrase: string) => 흐름(page).getByRole("group", { name: phrase, exact: true });

/** 그 Thread를 연다 — 목록 · 읽기 · 읽은 자리를 그 Thread로 답한다. */
async function openThread(page: Page, view: ThreadView, lines: readonly RecordLine[]): Promise<void> {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: view.lastSeq } }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(first.text, { exact: true })).toBeVisible({ timeout: 20_000 });
}

test("Host가 리뷰어를 부르면 호출 줄이 하는 중에서 「리뷰어에게 맡김」으로 바뀌고, 펼치면 받은 말과 리뷰어의 도구가, 「Session 열기」는 리뷰어의 줄만 보인다", async ({
  page,
}) => {
  await openThread(page, started, linesThrough(calling, FIRST_SENT));

  // 맡기기 전 — Host의 도구 줄이 「@reviewer에게 맡기는 중」이다. 도구를 들이는 `ToolSearch`는 도구 줄로 서지 않는다(v1 티켓 20).
  await streamLines(page, started.id, linesThrough(linesAfter(calling, FIRST_SENT), CALL_TOOL));
  await expect(도구줄(page, "@reviewer에게 맡기는 중")).toBeVisible();
  await expect(흐름(page).getByText(/ToolSearch/)).toHaveCount(0);

  // 리뷰어가 들어와 맡은 일을 한다 — 그 도구 줄 자리에 호출 줄이 서고, 둘째 줄이 리뷰어의 지금 도구다. 리뷰어의 턴은 답을 받기 전에는
  // 흐름에 서지 않는다.
  await replaceAnswer(page, "thread_get", answerByArg("thread", { [joined.id]: joined }));
  await replaceAnswer(page, "thread_mark_read", answerByArg("thread", { [joined.id]: summaryOf(joined) }));
  await streamLines(page, started.id, linesThrough(linesAfter(calling, CALL_TOOL), REVIEWER_READ));
  await fireSummary(page, joined);
  const 하는중 = 호출줄(page, "리뷰어가 맡은 일을 하는 중");
  await expect(하는중).toHaveAttribute("data-call", "running");
  await expect(하는중).toContainText("thread.json 읽는 중");
  await expect(도구줄(page, "@reviewer에게 맡기는 중")).toHaveCount(0);
  await expect(흐름(page).locator('[data-system="joined"]')).toHaveText("리뷰어가 참여함");

  // 끝 — 「리뷰어에게 맡김」 아래에 맡긴 말 · 걸린 시간이고, Host가 받은 답을 옮겨 턴이 끝나도(끝난 답 아래 「답 복사」) 호출 줄은
  // 남는다. 그 턴의 다른 도구(`ToolSearch`)는 줄로 서지 않아 펼칠 것이 없다 — 구분선 없이 호출 줄이 그 자리에 선다(02 §8).
  await streamLines(page, started.id, linesAfter(calling, REVIEWER_READ));
  const 맡김 = 호출줄(page, "리뷰어에게 맡김");
  await expect(맡김).toHaveAttribute("data-call", "answered");
  await expect(맡김).toContainText(`“${TASK}” · 7초 걸림`);
  await expect(흐름(page).getByRole("button", { name: "답 복사", exact: true })).toBeVisible();
  await expect(맡김).toBeVisible();
  await expect(흐름(page).getByText("@reviewer가 보낸 답을 그대로 옮깁니다.", { exact: true })).toBeVisible();

  // 펼침 — 맡긴 것 · 받은 것과 리뷰어의 도구 줄(과거형)이다.
  await 맡김.locator("button[aria-expanded]").click();
  await expect(맡김.getByText(TASK, { exact: true })).toBeVisible();
  await expect(맡김.getByText(ANSWER, { exact: true })).toBeVisible();
  await expect(맡김.getByRole("group", { name: "thread.json 읽음", exact: true })).toBeVisible();

  // Session 열기 — 같은 화면에서 리뷰어의 줄만 거른다: 맡은 일과 리뷰어의 답은 서고, 사람의 말 · Host의 답은 없다. 돌아가면 온 흐름이다.
  await 맡김.getByRole("button", { name: "리뷰어의 Session 열기", exact: true }).click();
  const 머리줄 = 흐름(page).locator('[data-session="reviewer"]');
  await expect(머리줄).toContainText("리뷰어의 Session");
  await expect(흐름(page).getByText(TASK, { exact: true })).toBeVisible();
  await expect(흐름(page).getByText(ANSWER, { exact: true })).toBeVisible();
  await expect(흐름(page).getByText(first.text, { exact: true })).toHaveCount(0);
  await expect(흐름(page).getByText("@reviewer가 보낸 답을 그대로 옮깁니다.", { exact: true })).toHaveCount(0);
  await 머리줄.getByRole("button", { name: "Thread로 돌아가기", exact: true }).click();
  await expect(머리줄).toHaveCount(0);
  await expect(흐름(page).getByText(first.text, { exact: true })).toBeVisible();
  await expect(흐름(page).getByText("@reviewer가 보낸 답을 그대로 옮깁니다.", { exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("앱이 꺼지며 끊긴 부르기는 「리뷰어가 답하지 못함」으로 서고, 「리뷰어에게 다시 맡기기」가 같은 글로 다시 부른다", async ({ page }) => {
  // 다시 켠 뒤 — 리뷰어가 `thread.json`을 읽던 중에 앱이 꺼져 부르기의 끝 줄이 없다.
  const cut: ThreadView = { ...joined, live: false, lastSeq: REVIEWER_READ };
  await openThread(page, cut, linesThrough(calling, REVIEWER_READ));

  const 못함 = 호출줄(page, "리뷰어가 답하지 못함");
  await expect(못함).toHaveAttribute("data-call", "failed");
  await expect(못함).toContainText("앱이 꺼지며 끊겼어요");
  await expect(못함.getByRole("button", { name: "리뷰어의 Session 열기", exact: true })).toHaveCount(0);

  await 못함.getByRole("button", { name: "리뷰어에게 다시 맡기기", exact: true }).click();
  expect((await ipcCallArgs(page, "thread_call_again", "thread")).map(({ args }) => args)).toEqual([
    { thread: cut.id, from: "host", to: "reviewer", text: TASK },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
