import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { linesAfter, linesThrough, record, sentPayloads, streamLines, summaryOf } from "./thread-records";
import type { RecordLine, ThreadView } from "@/features/thread/types";

// v1 티켓 28(PR ③ e2e) 흐름 하나 — **Agent가 물으면 입력창 자리에 카드가 서서 무엇을 왜 묻는지 보이고, 키보드로 고르면 그 답이 가고,
// 답 줄이 오면 카드가 걷히며 그 자리에 결정 줄이 선다**(v1 티켓 24 · 26 · 구현 스펙 §9 카드 · S18 · 경계 ② 「입력창 자리」). three-axes
// `chat-approval`(작업 패널의 승인 카드)을 Thread로 옮긴 것이다 — 승인 카드와 Agent의 질문 카드가 같은 자리에 선다.
//
// 줄은 L1이 축복한 기록을 그대로 쏜다 — 「Thread 폴더 안 파일 쓰기를 매번 묻기로 물어 허락받은 턴」(`thread-permission.jsonl`)과 진짜
// claude 2.1.309의 녹음을 되감은 「물음 둘을 한 번에 묻고 답받은 턴」(`thread-question.jsonl`, v1 티켓 27). 보낸 말 · 물음 · 답은 그
// 기록에서 읽는다(스토리 137).

/** 카드는 선 직후 잠깐 키를 받지 않는다(`ApprovalCard`의 `ARMING_MS` — 질문 카드도 같다). 키를 누르기 전에 그만큼 기다린다. */
const ARMING_MS = 300;

/** 그 종류 · 상태의 첫 물음 줄. */
const lineOf = (lines: readonly RecordLine[], kind: "permission" | "question", state: string): RecordLine => {
  const found = lines.find((line) => line.kind === kind && (line.payload as { state?: string }).state === state);
  if (!found) throw new Error(`기록에 ${kind} ${state} 줄이 없다`);
  return found;
};

/** 첫 말로 막 선 Thread — Host의 Session이 이 앱에 떠 있고 기록은 물음 바로 앞까지다. */
const openedBefore = (lines: readonly RecordLine[], asked: RecordLine): ThreadView => ({
  ...FIXTURE_THREAD,
  title: sentPayloads(lines)[0].text,
  live: true,
  lastSeq: asked.seq - 1,
});

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 흐름 = (page: Page) => page.getByRole("main");

/** 그 Thread를 물음 바로 앞까지 연다 — 목록 · 읽기 · 읽은 자리를 그 Thread로 답한다. */
async function openThread(page: Page, lines: readonly RecordLine[], asked: RecordLine): Promise<ThreadView> {
  const view = openedBefore(lines, asked);
  await installFixtureBackend(page, {
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

const permission = record("thread-permission");
const ASKED = lineOf(permission, "permission", "asked");
const ANSWERED = lineOf(permission, "permission", "answered");

test("승인 카드가 입력창 자리에 서서 누가 · 무엇을 · 왜 묻는지 보이고, esc가 「아니요, 다르게」 칸을 열고 닫으며, 숫자 · ↓는 고르지 않고 ↵가 「이번만 허용」을 보내며, 답 줄이 오면 결정 줄이 선다", async ({
  page,
}) => {
  const view = await openThread(page, permission, ASKED);

  // 물음 줄 — 입력창이 사라지고 그 자리에 카드가 선다(02 §10 · 티켓 11). 카드의 이름은 누가 묻는 물음이고, 머리 한 줄이 누가 · 무슨
  // 일 · 어떤 규칙 때문에(Policy 이름) 묻는지, 그 아래 바꿀 파일의 바뀐 줄이 선다. 단추 한 줄은 왼쪽에서 「아니요, 다르게」 · 늘
  // 허용 · 맨 오른쪽 「이번만 허용」이다 — 이 물음은 「다시 묻지 않기」로 적을 허락(`grant` — 편집)을 실어 늘 허용이 「이 Thread에서
  // 편집은 늘 허용」이다(Work 없는 Thread).
  await streamLines(page, view.id, [ASKED]);
  const card = page.getByRole("group", { name: "Host가 이 파일을 고쳐도 될까요?", exact: true });
  await expect(card).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await expect(card).toContainText("Host · 파일 고치기 · 「매번 묻기」");
  await expect(card.getByRole("figure", { name: /allowed\.txt 변경$/ })).toContainText("+x");
  const 선택지 = card.getByRole("button");
  const names = ["아니요, 다르게", "이 Thread에서 편집은 늘 허용", "이번만 허용"];
  await expect(선택지).toHaveCount(names.length);
  for (const [at, name] of names.entries()) await expect(선택지.nth(at)).toHaveAccessibleName(name);
  // 글쇠는 단추 끝에 옅게 선다 — 「아니요, 다르게」에 esc, 「이번만 허용」에 ↵. 켜진 줄이 옮겨 다니지 않으니 글쇠도 그 자리다.
  await expect(선택지.first()).toHaveText(/Esc$/);
  await expect(선택지.last()).toHaveText(/↵$/);
  await expect(선택지.nth(1)).toHaveText(names[1]);
  await expect(흐름(page).getByText("승인을 기다립니다", { exact: true })).toBeVisible();
  // 풀린 포커스는 카드가 받는다 — Enter · Esc가 카드의 키다.
  await expect(card).toBeFocused();
  await page.waitForTimeout(ARMING_MS);

  // Esc는 「아니요, 다르게」 — 카드 안에 할 말 칸이 열린다. 칸의 Esc는 칸만 닫고 카드로 돌아간다.
  const 할말 = card.getByRole("textbox", { name: "Host에게 다르게 할 방법 알려 주기", exact: true });
  await page.keyboard.press("Escape");
  await expect(할말).toBeFocused();
  await expect(card.getByRole("button", { name: names[0], exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(할말).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(await ipcCallArgs(page, "thread_answer_permission", "thread")).toEqual([]);

  // 숫자 키와 ↑↓는 아무것도 고르지 않는다(S25 — 번호 줄이 단추 줄이 됐다). Enter는 「이번만 허용」이다 — 답은 물은 참여자 · 요청 id와
  // 함께 가고, 다시 묻지 않기로 적지 않는다.
  for (const key of ["1", "2", "3", "ArrowDown", "ArrowUp"]) await page.keyboard.press(key);
  await expect(할말).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(await ipcCallArgs(page, "thread_answer_permission", "thread")).toEqual([]);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).map(({ args }) => args))
    .toEqual([{ thread: view.id, who: "host", request: "0", option: "allow_once", remember: false, words: null }]);

  // 답 줄이 오면 카드가 걷히고 입력창이 돌아온다. 물은 턴에 결정 줄이 선다.
  await streamLines(page, view.id, [ANSWERED]);
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(흐름(page).locator("[data-decision]")).toHaveText(["파일 고치기를 승인함"]);
  await expect(흐름(page).locator('[data-decision="allowed"]')).toBeVisible();

  // 턴이 이어져 끝난다 — 다시 묻지 않는다.
  await streamLines(page, view.id, linesAfter(permission, ANSWERED.seq));
  await expect(흐름(page).getByText("done", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: /될까요\?$/ })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const question = record("thread-question");
const QUESTION_ASKED = lineOf(question, "question", "asked");
const QUESTION_ANSWERED = lineOf(question, "question", "answered");
type AskedQuestion = { question: string; multiSelect: boolean; options: { label: string; description: string }[] };
const [FEE, SCREEN] = (QUESTION_ASKED.payload as { questions: AskedQuestion[] }).questions;
const { answers: ANSWERS } = QUESTION_ANSWERED.payload as { answers: { question: string; answer: string }[] };

test("Agent의 질문은 같은 자리에 질문 카드로 서서 물음마다 선택지와 설명을 보이고, 숫자로 고른 답이 Enter로 가며, 답 줄이 오면 물음마다 한 줄로 물음과 고른 답이 선다", async ({
  page,
}) => {
  const view = await openThread(page, question, QUESTION_ASKED);

  // 질문 줄 — 입력창 자리에 질문 카드가 선다. 하나 고르는 물음은 라디오, 여럿 고르는 물음은 체크이고, 선택지 이름은 이름과 설명이다.
  await streamLines(page, view.id, [QUESTION_ASKED]);
  const card = page.getByRole("group", { name: "Host의 질문", exact: true });
  await expect(card).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  const 수수료 = card.getByRole("radiogroup", { name: FEE.question, exact: true });
  const 화면 = card.getByRole("group", { name: SCREEN.question, exact: true });
  for (const [at, option] of FEE.options.entries()) {
    await expect(수수료.getByRole("radio").nth(at)).toHaveAccessibleName(`${option.label} ${option.description}`);
  }
  for (const [at, option] of SCREEN.options.entries()) {
    await expect(화면.getByRole("checkbox").nth(at)).toHaveAccessibleName(`${option.label} ${option.description}`);
  }
  const 답하기 = card.getByRole("button", { name: "답하기", exact: true });
  await expect(답하기).toBeDisabled();
  await expect(card).toBeFocused();
  await page.waitForTimeout(ARMING_MS);

  // 숫자는 지금 물음의 선택지다 — 하나 고르는 물음을 고르면 다음 물음으로 넘어가고, 여럿 고르는 물음은 그 자리에서 더 고른다.
  await page.keyboard.press("1");
  await expect(수수료.getByRole("radio", { checked: true })).toHaveAccessibleName(new RegExp(`^${FEE.options[0].label}`));
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await expect(화면.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(답하기).toBeEnabled();

  // Enter는 「답하기」 — 물음마다의 답이 간다. 기록의 답 줄과 같은 답이다.
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_question", "thread")).map(({ args }) => args))
    .toEqual([{ thread: view.id, who: "host", request: "0", answers: ANSWERS, later: false }]);

  // 답 줄이 오면 카드가 걷히고 그 자리에 답한 질문이 선다 — 물음마다 한 줄(옅은 테두리 카드)에 물은 제목과 고른 답이다(02 티켓 11 ·
  // Screen-Live). 턴은 이어 끝난다.
  await streamLines(page, view.id, [QUESTION_ANSWERED]);
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  const 그대로 = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(흐름(page).locator('[data-answered="answer"] p')).toHaveText(
    ANSWERS.map((one) => new RegExp(`^${그대로(one.question)}\\s*${그대로(one.answer)}$`)),
  );
  await streamLines(page, view.id, linesAfter(question, QUESTION_ANSWERED.seq));
  await expect(흐름(page).getByText("done", { exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
