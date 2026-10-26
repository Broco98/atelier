import { expect, test, type Page } from "./evidence";

import { answerByArg } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls, 칠한값, 토큰색 } from "./harness";
import { lineOf, linesAfter, linesThrough, record, seqOf, streamLines, summaryOf, threadOf } from "./thread-records";
import type { RecordLine, ThreadView } from "@/features/thread/types";

// v1 티켓 45(PR ⑤ e2e) 흐름 하나 — **사이드바 Thread 줄이 다섯 상태(내 차례 · 작업 중 · 실패 · 중단 · 새 결과) 가운데 하나를 보이고,
// 새 결과는 열어서 맨 아래를 보면 읽은 자리가 적혀 걷히며, 실패 · 중단은 읽어도 남는다**(v1 티켓 41 · 구현 스펙 §17 · S38 · 경계 ②
// 「사이드바」 · 스토리 128–130 · 133 · 134). 상태를 고르는 우선 표는 L2(`status.test.ts`)가, 읽은 자리를 적는 엔진은 L1이 잰다 — 여기는
// 기록 줄 이벤트가 사이드바 줄을 바꾸고 그 줄을 열면 읽은 자리가 나가는 한 바퀴다.
//
// 줄은 L1이 축복한 기록을 그대로 쏜다(스토리 137) — 「파일 쓰기를 매번 묻기로 물어 허락받은 턴」(`thread-permission`), 진짜 claude 2.1.309가
// 「알아서」로 돌던 명령을 사람이 멈춘 턴(`thread-stopped`, v1 티켓 44), 「새 Thread 두 턴」(`thread-two-turns`)의 둘째 턴이 도는 중에 앱이
// 꺼진 꼴. 제목은 기록에서 읽는다.
//
// **상태는 줄 오른쪽 끝의 표시 하나다**(02 티켓 05 · 구현 스펙 §4 · S11 — `StatusMark`). 내 차례는 「내 차례」 알약, 작업 중은 스피너(그림
// 이름 「작업 중」), 실패는 「실패」 글자(사이드바의 유일한 빨강), 새 결과는 파란 점(그림 이름 「새 결과」)이고 중단은 표시가 없다. 한때
// 줄이 두 줄이었다 — 둘째 줄이 기다리는 것(「승인 · 고칠 파일」) · 실패의 까닭 · 「중단했습니다」를 들었고 새 결과는 제목이 굵었다. 그
// 말들은 Thread 화면이 든다(02 구현 스펙 §4 「둘째 줄을 걷었다」).

const permission = record("thread-permission");
const ASKED = lineOf(permission, "permission", "asked");
const ANSWERED = lineOf(permission, "permission", "answered");
const stopped = record("thread-stopped");
const twoTurns = record("thread-two-turns");
/** 둘째 턴이 도구를 다 돌리고 답 글을 내기 바로 앞 줄 — 그 뒤로 기록이 끊겼다(앱이 꺼졌다). 답 없이 끝난 턴이라 실패다. */
const CUT =
  twoTurns.find(
    (line) =>
      line.seq > seqOf(twoTurns, "sent", 2) &&
      (line.payload as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === "agent_message_chunk",
  )!.seq - 1;

/** 승인을 묻기 바로 앞의 Thread — Host의 Session이 이 앱에 떠 있고 첫 턴이 돈다. */
const asking = threadOf("20261024-090100", permission, { live: true, lastSeq: ASKED.seq - 1 });
/** 사람이 멈춘 Thread — 앱을 다시 켠 꼴이라 떠 있는 Session이 없다. */
const halted = threadOf("20261024-090200", stopped, { live: false, lastSeq: stopped[stopped.length - 1].seq });
/** 둘째 턴이 도는 동안 앱이 꺼진 Thread — 다시 켠 앱이 그 열린 턴을 「앱이 꺼지며 끊겼어요」로 접는다. */
const cut = threadOf("20261024-090300", twoTurns, { live: false, lastSeq: CUT });

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
const 줄 = (page: Page, view: ThreadView) =>
  사이드바(page).getByRole("region", { name: "Thread", exact: true }).getByRole("button").filter({ hasText: view.title });
/** 그 줄 끝의 상태 표시(`data-mark`) — 줄마다 많아야 하나다. */
const 표시 = (page: Page, view: ThreadView) => 줄(page, view).locator("[data-mark]");

test("사이드바 Thread 줄이 내 차례 · 작업 중 · 새 결과 · 실패 · 중단을 하나씩 보이고, 새 결과는 열어 맨 아래를 보면 읽은 자리가 적혀 걷히며 실패 · 중단은 남는다", async ({
  page,
}) => {
  const threads = [asking, halted, cut];
  // 읽은 자리를 적으면 엔진이 그 자리를 실은 요약으로 답한다 — 끝 줄까지 읽었다.
  const read = (view: ThreadView, lines: readonly RecordLine[]) => ({ ...summaryOf(view), lastRead: lines[lines.length - 1].seq });
  await installFixtureBackend(page, {
    thread_list: threads.map(summaryOf),
    thread_get: answerByArg("thread", Object.fromEntries(threads.map((view) => [view.id, view]))),
    thread_read_record: answerByArg("thread", {
      [asking.id]: linesThrough(permission, asking.lastSeq),
      [halted.id]: stopped,
      [cut.id]: linesThrough(twoTurns, cut.lastSeq),
    }),
    thread_mark_read: answerByArg("thread", {
      [asking.id]: read(asking, permission),
      [halted.id]: read(halted, stopped),
    }),
  });
  await page.goto("/");
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });

  // 앱을 켠 자리 — 도는 턴은 작업 중(끝의 스피너), 사람이 멈춘 턴은 중단(표시 없음), 앱이 꺼지며 끊긴 턴은 실패다. 빨강은 「실패」
  // 글자에만 선다(구현 스펙 §17 — `color-guard`가 소스를 잰다). 줄은 제목 한 줄이다 — 표시 말고는 제목뿐이다.
  await expect(줄(page, asking)).toHaveAttribute("data-status", "working");
  await expect(표시(page, asking)).toHaveAttribute("data-mark", "working");
  await expect(줄(page, asking).getByRole("img", { name: "작업 중", exact: true })).toBeVisible();
  await expect(줄(page, halted)).toHaveAttribute("data-status", "stopped");
  await expect(표시(page, halted)).toHaveCount(0);
  await expect(줄(page, halted)).toHaveText(halted.title);
  await expect(줄(page, cut)).toHaveAttribute("data-status", "failed");
  await expect(표시(page, cut)).toHaveAttribute("data-mark", "failed");
  await expect(줄(page, cut)).toHaveText(`${cut.title}실패`);
  expect((await 칠한값(줄(page, cut).getByText("실패", { exact: true }), "color"))[0]).toBe(await 토큰색(page, "--danger"));

  // 물음 줄 — 내 차례다. 끝의 표시가 「내 차례」 알약으로 바뀐다(줄은 자리를 지키고 표시만 바뀐다).
  await streamLines(page, asking.id, [ASKED]);
  await expect(줄(page, asking)).toHaveAttribute("data-status", "mine");
  await expect(표시(page, asking)).toHaveAttribute("data-mark", "mine");
  await expect(표시(page, asking)).toHaveText("내 차례");

  // 줄을 열어 답한다 — 답 줄이 오면 다시 작업 중이다. 턴이 끝나지 않았으니 읽은 자리는 아직 적지 않는다.
  await 줄(page, asking).click();
  await expect(page).toHaveURL(`/threads/${asking.id}`);
  await page.getByRole("group", { name: "Host가 이 파일을 고쳐도 될까요?", exact: true }).getByRole("button", { name: "이번만 허용", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).map(({ args }) => args.thread))
    .toEqual([asking.id]);
  await streamLines(page, asking.id, [ANSWERED]);
  await expect(줄(page, asking)).toHaveAttribute("data-status", "working");

  // 다른 곳에 있는 동안 턴이 끝난다 — 새 결과다. 끝에 파란 점(그림 이름 「새 결과」)이 서고, 제목은 굵어지지 않는다(굵은 제목이 표시
  // 하나로 모였다).
  await 사이드바(page).getByRole("button", { name: "새 Thread", exact: true }).click();
  await expect(page).toHaveURL("/");
  await streamLines(page, asking.id, linesAfter(permission, ANSWERED.seq));
  await expect(줄(page, asking)).toHaveAttribute("data-status", "new");
  await expect(표시(page, asking)).toHaveAttribute("data-mark", "new");
  await expect(줄(page, asking).getByRole("img", { name: "새 결과", exact: true })).toBeVisible();
  expect((await 칠한값(줄(page, asking).getByText(asking.title), "font-weight"))[0]).toBe("400");
  expect(await ipcCallArgs(page, "thread_mark_read", "thread")).toEqual([]);

  // 열어서 맨 아래를 보면 읽은 자리가 끝 줄로 한 번 적히고, 그 답이 줄의 상태를 걷는다.
  await 줄(page, asking).click();
  await expect(page.getByRole("main").getByText("done", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_mark_read", "thread")).map(({ args }) => args))
    .toEqual([{ thread: asking.id, seq: permission[permission.length - 1].seq }]);
  await expect(줄(page, asking)).not.toHaveAttribute("data-status");
  await expect(표시(page, asking)).toHaveCount(0);

  // 중단은 읽어도 남는다 — 열면 읽은 자리가 적히지만 상태는 그대로다(다음 턴이 끝나야 걷힌다).
  await 줄(page, halted).click();
  await expect(page).toHaveURL(`/threads/${halted.id}`);
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_mark_read", "thread")).map(({ args }) => args.thread))
    .toEqual([asking.id, halted.id]);
  await expect(줄(page, halted)).toHaveAttribute("data-status", "stopped");
  await expect(줄(page, cut)).toHaveAttribute("data-status", "failed");
  await expect(표시(page, cut)).toHaveAttribute("data-mark", "failed");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
