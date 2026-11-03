import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { linesAfter, linesThrough, record, sentPayloads, streamLines, summaryOf } from "./thread-records";
import type { RecordLine, ThreadView } from "@/features/thread/types";

// v1 티켓 28(PR ③ e2e) 흐름 하나 — **한 세션이 잇달아 물으면 물음마다 카드가 입력창 자리에 서고, 카드 안에 남긴 말은 그 물음을 거부하며
// 세션에게 간다**(v1 티켓 25 · 구현 스펙 §9 카드 · 스토리 80 · 83 · 경계 ② 「입력창 자리」 — 「거부」 입력칸, restart 02b-5).
//
// 줄은 L1이 축복한 기록(`thread-ask-turns.jsonl`)을 그대로 쏜다 — 첫 턴의 쓰기를 허락하고, 둘째 턴의 쓰기에 말을 남겨 거부한다. 보낸 말 ·
// 남긴 말 · seq는 그 기록에서 읽는다(스토리 137). 물음이 함께 걸릴 때의 「1 / 2」와 다음 차례는 L2 `asks.test.ts`가 잰다.

/** 카드는 선 직후 잠깐 키를 받지 않는다(`ApprovalCard`의 `ARMING_MS`). 키를 누르기 전에 그만큼 기다린다. */
const ARMING_MS = 300;

const turns = record("thread-ask-turns");
const [first] = sentPayloads(turns);
type PermissionPayload = { state: string; requestId: string; words?: string };
const permissionLines = (state: string) =>
  turns.filter((line) => line.kind === "permission" && (line.payload as PermissionPayload).state === state);
const [FIRST_ASKED, SECOND_ASKED] = permissionLines("asked");
const [FIRST_ALLOWED, SECOND_REFUSED] = permissionLines("answered");
const { words: WORDS = "" } = SECOND_REFUSED.payload as PermissionPayload;
const requestOf = (line: RecordLine) => (line.payload as PermissionPayload).requestId;
const [FIRST_ENDED, SECOND_ENDED] = turns.filter((line) => line.kind === "turn-end");

/** 첫 물음을 기다리는 Thread — 세션이 이 앱에 떠 있다. */
const view: ThreadView = { ...FIXTURE_THREAD, title: first.text, live: true, lastSeq: FIRST_ASKED.seq };

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 흐름 = (page: Page) => page.getByRole("main");
const 카드 = (page: Page) => page.getByRole("group", { name: "Claude Code가 이 파일을 편집하도록 허용할까요?", exact: true });

test("한 세션이 잇달아 물으면 물음마다 카드가 서고, 카드 안에 남긴 말은 그 물음을 거부하며 세션에게 간다", async ({ page }) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: linesThrough(turns, FIRST_ASKED.seq) }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: view.lastSeq } }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  const card = 카드(page);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(입력칸(page)).toHaveCount(0);
  // 물음이 하나뿐이면 차례를 세지 않는다.
  await expect(card).not.toContainText("1 / 2");
  await expect(card).not.toContainText("다음 ·");

  // 첫 카드 — ↵는 「한 번만 허용」이다.
  await expect(card).toBeFocused();
  await page.waitForTimeout(ARMING_MS);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).map(({ args }) => args))
    .toEqual([{ thread: view.id, request: requestOf(FIRST_ASKED), option: "allow_once", remember: false, words: null }]);

  // 답 줄 — 카드가 걷히고 입력창이 돌아오고, 턴에 결정 줄이 선다.
  await streamLines(page, view.id, linesThrough(linesAfter(turns, FIRST_ASKED.seq), FIRST_ALLOWED.seq));
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await streamLines(page, view.id, linesThrough(linesAfter(turns, FIRST_ALLOWED.seq), FIRST_ENDED.seq));

  // 둘째 턴의 물음 — 다음 카드가 서고, 이것도 차례를 세지 않는다.
  await streamLines(page, view.id, linesThrough(linesAfter(turns, FIRST_ENDED.seq), SECOND_ASKED.seq));
  await expect(card).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await expect(card).not.toContainText("1 / 2");
  await expect(card).toBeFocused();
  await page.waitForTimeout(ARMING_MS);

  // 카드 안 칸에 말을 쓰면 — 보내면 이 편집을 건너뛰고 말을 전한다는 한 줄이 선다. Enter가 거부와 그 말을 보낸다.
  await page.keyboard.press("Escape");
  const 할말 = card.getByRole("textbox", { name: "Claude Code에게 다르게 할 방법 알려 주기", exact: true });
  await expect(할말).toBeFocused();
  await 할말.fill(WORDS);
  await expect(할말).toHaveAccessibleDescription("보내면 이 편집은 건너뛰고 Claude Code에게 말을 전해요");
  await 할말.press("Enter");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).map(({ args }) => args).slice(1))
    .toEqual([{ thread: view.id, request: requestOf(SECOND_ASKED), option: "reject", remember: false, words: WORDS }]);

  // 답 줄 — 카드가 걷히고, 턴에는 거부와 남긴 말이 결정 줄로 선다. 세션은 그 말을 받고 턴을 마친다.
  await streamLines(page, view.id, linesThrough(linesAfter(turns, SECOND_ASKED.seq), SECOND_REFUSED.seq));
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(흐름(page).locator('[data-decision="refused"]')).toHaveText(`거부함「${WORDS}」`);
  await streamLines(page, view.id, linesThrough(linesAfter(turns, SECOND_REFUSED.seq), SECOND_ENDED.seq));
  expect(await unknownIpcCalls(page)).toEqual([]);
});
