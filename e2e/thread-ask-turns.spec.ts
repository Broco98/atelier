import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_HOST, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls } from "./harness";
import { fireSummary, linesAfter, linesThrough, record, sentPayloads, streamLines, summaryOf } from "./thread-records";
import type { Participant, RecordLine, ThreadView } from "@/features/thread/types";

// v1 티켓 28(PR ③ e2e) 흐름 하나 — **두 Agent가 함께 물으면 먼저 온 물음 하나만 카드로 서서 「1 / 2」와 다음 차례를 말하고, 카드 안에
// 남긴 말은 그 물음을 거부하며 그 Agent에게만 가고, 다음 카드가 「2 / 2」로 선다**(v1 티켓 25 · 구현 스펙 §9 카드 · 스토리 80 · 83 ·
// 경계 ② 「입력창 자리」 — 다음 차례 줄 · 다르게 해 주세요 입력칸).
//
// 줄은 L1이 축복한 「두 Agent의 물음에 차례로 답한 Thread」(`thread-ask-turns.jsonl`)를 그대로 쏜다 — Host가 둘째 턴에서 파일 쓰기를
// 묻는 사이 테스터가 들어와 명령을 묻는다. 사람은 Host의 카드에 말을 남겨 거부하고(Host는 그 말을 도구 결과로 받고 턴을 마친다), 그
// 뒤에 테스터의 명령을 허락한다. 보낸 말 · 남긴 말 · seq는 그 기록에서 읽는다(스토리 137).

/** 카드는 선 직후 잠깐 키를 받지 않는다(`ApprovalCard`의 `ARMING_MS`). 키를 누르기 전에 그만큼 기다린다. */
const ARMING_MS = 300;

const turns = record("thread-ask-turns");
const [first] = sentPayloads(turns);
type PermissionPayload = { state: string; requestId: string; words?: string };
const permissionLines = (who: string, state: string) =>
  turns.filter((line) => line.kind === "permission" && line.who === who && (line.payload as PermissionPayload).state === state);
/** Host의 둘째 물음(둘째 턴의 파일 쓰기) · 테스터의 물음 · 그 답들. */
const HOST_ASKED = permissionLines("host", "asked")[1];
const TESTER_ASKED = permissionLines("tester", "asked")[0];
const HOST_REFUSED = permissionLines("host", "answered")[1];
const TESTER_ALLOWED = permissionLines("tester", "answered")[0];
const { words: WORDS = "" } = HOST_REFUSED.payload as PermissionPayload;
const requestOf = (line: RecordLine) => (line.payload as PermissionPayload).requestId;
const turnEnd = (who: string, nth: number) => turns.filter((line) => line.kind === "turn-end" && line.who === who)[nth - 1];
/** Host가 남긴 말을 받고 마친 둘째 턴의 끝. */
const HOST_ENDED = turnEnd("host", 2);

/** 테스터 — 들어옴 줄의 때와 테스터의 Session(`fake-session-2`). */
const TESTER: Participant = {
  ...FIXTURE_HOST,
  handle: "tester",
  joinedAt: turns.find((line) => line.kind === "joined" && line.who === "tester")!.at,
  sessionId: "fake-session-2",
};
/** Host가 둘째 턴에서 묻고 있는 Thread — Host의 Session이 이 앱에 떠 있다. */
const view: ThreadView = { ...FIXTURE_THREAD, title: first.text, live: true, lastSeq: HOST_ASKED.seq };
/** 테스터가 들어온 Thread. */
const joined: ThreadView = { ...view, participants: [FIXTURE_HOST, TESTER] };

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 흐름 = (page: Page) => page.getByRole("main");
const 카드 = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("두 Agent가 함께 물으면 먼저 온 Host의 카드가 「1 / 2」와 다음 차례를 말하고, 카드 안에 남긴 말은 Host에게만 가며, 테스터의 카드가 「2 / 2」로 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: linesThrough(turns, HOST_ASKED.seq) }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: view.lastSeq } }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  const host = 카드(page, "Host가 이 파일을 고쳐도 될까요?");
  await expect(host).toBeVisible({ timeout: 20_000 });
  await expect(입력칸(page)).toHaveCount(0);
  // 물음이 하나뿐이면 차례를 세지 않는다.
  await expect(host).not.toContainText("1 / 2");

  // 테스터가 들어와 명령을 묻는다 — 참여자가 늘면 엔진이 목록 요약을 내고 화면이 Thread를 다시 읽는다. 먼저 온 Host의 카드가 그대로
  // 서고, 머리 오른쪽에 「1 / 2」, 맨 아래에 다음 차례가 선다.
  await replaceAnswer(page, "thread_get", answerByArg("thread", { [joined.id]: joined }));
  await replaceAnswer(page, "thread_mark_read", answerByArg("thread", { [joined.id]: summaryOf(joined) }));
  await streamLines(page, view.id, linesThrough(linesAfter(turns, HOST_ASKED.seq), TESTER_ASKED.seq));
  await fireSummary(page, joined);
  await expect(page.getByRole("img", { name: "참여자 Host, 테스터", exact: true })).toBeVisible();
  await expect(흐름(page).locator('[data-system="joined"]')).toHaveText("테스터가 참여함");
  await expect(host).toContainText("1 / 2");
  await expect(host).toContainText(/다음 · 테스터가 .+ 실행을 기다려요$/);
  await expect(카드(page, "테스터가 이 명령을 실행해도 될까요?")).toHaveCount(0);
  await expect(host).toBeFocused();
  await page.waitForTimeout(ARMING_MS);

  // 카드 안 칸에 말을 쓰면 — 보내면 이 편집을 건너뛰고 Host에게 말을 전한다는 한 줄이 선다. Enter가 거부와 그 말을 보낸다.
  await page.keyboard.press("Escape");
  const 할말 = host.getByRole("textbox", { name: "Host에게 다르게 할 방법 알려 주기", exact: true });
  await expect(할말).toBeFocused();
  await 할말.fill(WORDS);
  await expect(할말).toHaveAccessibleDescription("보내면 이 편집은 건너뛰고 Host에게 말을 전해요");
  await 할말.press("Enter");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).map(({ args }) => args))
    .toEqual([{ thread: view.id, who: "host", request: requestOf(HOST_ASKED), option: "reject", remember: false, words: WORDS }]);

  // Host의 답 줄 — Host의 카드가 걷히고 테스터의 카드가 「2 / 2」로 선다(뒤가 없어 다음 줄은 없다). Host의 턴에는 거부와 남긴 말이
  // 결정 줄로 선다.
  await streamLines(page, view.id, [HOST_REFUSED]);
  const tester = 카드(page, "테스터가 이 명령을 실행해도 될까요?");
  await expect(tester).toBeVisible();
  await expect(host).toHaveCount(0);
  await expect(tester).toContainText("2 / 2");
  await expect(tester).toContainText("Thread 폴더에서 실행");
  await expect(tester).not.toContainText("다음 ·");
  await expect(흐름(page).locator('[data-decision="refused"]')).toHaveText(`파일 고치기를 거부함「${WORDS}」`);

  // Host는 그 말을 받고 턴을 마친다 — 테스터의 카드는 제 차례에 그대로 서 있다.
  await streamLines(page, view.id, linesThrough(linesAfter(turns, HOST_REFUSED.seq), HOST_ENDED.seq));
  await expect(tester).toContainText("2 / 2");
  await expect(입력칸(page)).toHaveCount(0);

  // 다음 카드도 선 직후 잠깐은 키를 받지 않는다. 1은 「예」 — 답은 테스터의 요청으로 간다(요청 id는 Session마다 따로 세어 Host의
  // 첫 물음과 같다).
  await expect(tester).toBeFocused();
  await page.waitForTimeout(ARMING_MS);
  await page.keyboard.press("1");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).map(({ args }) => args).slice(1))
    .toEqual([{ thread: view.id, who: "tester", request: requestOf(TESTER_ASKED), option: "allow_once", remember: false, words: null }]);

  // 테스터의 답 줄 — 카드가 걷히고 입력창이 돌아온다. 묶음이 끝났다.
  await streamLines(page, view.id, linesThrough(linesAfter(turns, HOST_ENDED.seq), TESTER_ALLOWED.seq));
  await expect(tester).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(흐름(page).locator('[data-decision="allowed"]')).toHaveText("명령 실행을 승인함");
  await streamLines(page, view.id, linesThrough(linesAfter(turns, TESTER_ALLOWED.seq), turnEnd("tester", 1).seq));
  await expect(흐름(page).getByText("STARTED", { exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
