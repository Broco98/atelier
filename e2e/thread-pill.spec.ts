import type { RecordLine, ThreadView } from "@/features/thread/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { WORK_CHATS, workChatAnswers } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls, 토큰색 } from "./harness";
import { linesAfter, linesThrough, record, seqOf, streamLines } from "./thread-records";

// restart 02b-9a — **바뀐 파일 알약의 때 · 셈 · 모양**(restart 02b-9b · Cards 보드 「바뀐 파일 알약」 · States 08 · 13 · 14 · 15 · `시안-비교/02b-9b/차이.md`
// 「고친 것」). 알약은 작업공간에 이은 채팅의 **끝난 마지막 턴**의 편집을 센다 — 도는 동안에는 없고 턴이 끝나면 `chip-in`으로 서며, 다음 말이
// 기록에 서면(새 턴이 열리면) 걷힌다. 사람이 멈춘 턴 · Session이 죽어 끊긴 턴 뒤에는 없다 — 펼친 로그가 바뀐 파일을 말한다. 꼴은 34 알약 ·
// 왼 14 · `surface-elevated` · 「검토」 24 `fill-soft` 12 / 18이다.
//
// 기록은 축복한 두 턴(`thread-two-turns`)이고 둘째 턴이 `notes.txt`를 쓴다(작업공간 spec 폴더 밖의 파일이라 센다).

test.use({ viewport: { width: 1440, height: 900 } });

const twoTurns = record("thread-two-turns");
const SECOND_SENT = seqOf(twoTurns, "sent", 2);
const WRITE_DONE = twoTurns.find(
  (line) => line.seq > SECOND_SENT && (line.payload as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === "tool_call_update",
)!.seq;
const [chat] = WORK_CHATS;
const working: ThreadView = { ...chat, live: true, lastSeq: SECOND_SENT };

const 흐름 = (page: Page) => page.getByRole("main");
const 알약 = (page: Page) => page.getByRole("group", { name: /개 파일 변경됨$/ });

async function openWorking(page: Page): Promise<void> {
  await installFixtureBackend(page, workChatAnswers([working], { [working.id]: linesThrough(twoTurns, SECOND_SENT) }));
  await page.goto(`/works/${chat.work}?tab=chat&thread=${working.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText("생각 중", { exact: true })).toBeVisible({ timeout: 20_000 });
}

const 스타일 = (target: Locator, ...names: string[]) =>
  target.evaluate((el, keys) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key)]));
  }, names);

test("알약은 도는 동안 없고 턴이 끝나면 chip-in으로 서며(34 · 왼 14 · surface-elevated · 「검토」 24 fill-soft), 다음 말이 기록에 서면 걷힌다", async ({ page }) => {
  await openWorking(page);
  // 파일을 다 쓴 뒤에도 턴이 도는 동안은 없다 — 그 편집은 작업 로그가 말한다.
  await streamLines(page, working.id, linesThrough(linesAfter(twoTurns, SECOND_SENT), WRITE_DONE));
  await expect(흐름(page).getByRole("group", { name: "생성됨 notes.txt", exact: true })).toBeVisible();
  await expect(알약(page)).toHaveCount(0);

  // 턴이 끝난다 — 알약이 칩처럼 들어선다.
  await streamLines(page, working.id, linesAfter(twoTurns, WRITE_DONE));
  const pill = 알약(page);
  await expect(pill).toHaveAccessibleName("1개 파일 변경됨");
  expect(await pill.evaluate((el) => el.getAnimations().map((one) => [(one as CSSAnimation).animationName, one.effect?.getTiming().duration]))).toEqual([
    ["chip-in", 280],
  ]);
  await expect.poll(() => pill.evaluate((el) => el.getAnimations().map((one) => one.playState))).toEqual(["finished"]);
  expect(await 스타일(pill, "height", "padding-left", "padding-right", "column-gap", "background-color", "font-size", "line-height")).toEqual({
    height: "34px",
    "padding-left": "14px",
    "padding-right": "6px",
    "column-gap": "8px",
    "background-color": await 토큰색(page, "--surface-elevated"),
    "font-size": "13px",
    "line-height": "18px",
  });
  await expect(pill.locator("svg.lucide-file-diff")).toHaveCount(1);
  const review = pill.getByRole("button", { name: "검토", exact: true });
  expect(await 스타일(review, "height", "padding-left", "background-color", "font-size", "line-height", "color")).toEqual({
    height: "24px",
    "padding-left": "8px",
    "background-color": await 토큰색(page, "--fill-soft"),
    "font-size": "12px",
    "line-height": "18px",
    color: await 토큰색(page, "--fg-secondary"),
  });
  // 셈과 「검토」 사이 세로선이 없다.
  await expect(pill.locator('span[aria-hidden="true"]')).toHaveCount(0);

  // 다음 말 — 그 말이 기록에 서서 새 턴이 열리면 걷힌다.
  const last = twoTurns[twoTurns.length - 1];
  const next: RecordLine = { seq: last.seq + 1, at: last.at, kind: "sent", payload: { ...(twoTurns[SECOND_SENT - 1].payload as object), text: "이어서 테스트도 돌려 줘" } };
  await streamLines(page, working.id, [next]);
  await expect(흐름(page).getByText("이어서 테스트도 돌려 줘", { exact: true })).toBeVisible();
  await expect(알약(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("파일을 고친 턴을 사람이 멈추거나 Session이 죽어 끊기면 알약이 서지 않는다", async ({ page }) => {
  await openWorking(page);
  const wrote = linesThrough(linesAfter(twoTurns, SECOND_SENT), WRITE_DONE);
  const stoppedEnd = record("thread-stopped").find((line) => line.kind === "turn-end")!;
  await streamLines(page, working.id, [...wrote, { ...stoppedEnd, seq: WRITE_DONE + 1 }]);
  await expect(흐름(page).getByRole("button", { name: /초 후에 중단했습니다$/ })).toBeVisible();
  await expect(흐름(page).getByRole("group", { name: "생성됨 notes.txt", exact: true })).toBeVisible();
  await expect(알약(page)).toHaveCount(0);

  // 같은 턴이 Session이 죽어 끊긴 경우.
  await openWorking(page);
  await streamLines(page, working.id, [...wrote, { seq: WRITE_DONE + 1, at: twoTurns[WRITE_DONE - 1].at, kind: "session", payload: { state: "died", reason: null } }]);
  await expect(흐름(page).locator('[data-end-notice="cut"]')).toBeVisible();
  await expect(흐름(page).getByRole("group", { name: "생성됨 notes.txt", exact: true })).toBeVisible();
  await expect(알약(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
