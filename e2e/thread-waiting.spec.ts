import { expect, test, type Page } from "./evidence";

import { answerByArg, WORKS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { lineOf, linesThrough, record, streamLines, summaryOf, threadOf, workTitleOf, workView } from "./thread-records";
import type { ThreadView } from "@/features/thread/types";

// v1 티켓 45(PR ⑤ e2e) 흐름 하나 — **사이드바 위 줄의 「내 차례」가 나를 기다리는 Thread만 기다린 순서로 세우고(Work에 이은 Thread도
// 섞인다), ⌘J가 그 차례로 건너뛰며, 답하면 수가 줄고 그 줄이 빠진다**(v1 티켓 42 · 구현 스펙 §13 S28 · §17 · 경계 ② 「사이드바」 · 스토리
// 131 · 132). 차례 · 갈 곳을 고르는 순수 함수는 L2(`waiting.test.ts`)가, 메뉴 바의 View ▸ Next Waiting은 L1(lib.rs 메뉴 시험)이 잰다 —
// 여기는 기록 줄 이벤트가 수 · 목록을 바꾸고 키가 주소를 옮기는 한 바퀴다. 부른 셸이 없는 자리라 마지막 Thread 다음은 처음으로 돈다.
//
// 줄은 L1이 축복한 기록을 그대로 쏜다(스토리 137) — Work에 이은 Thread에서 Host가 Work 밖 Project를 고치려 해 물은 턴(`thread-project`),
// Work 없는 Thread에서 파일 쓰기를 매번 묻기로 물은 턴(`thread-permission`), 다 읽은 「새 Thread 두 턴」(`thread-two-turns`). 기다리기 시작한
// 때(물음 줄의 시각)가 차례다 — Project 물음이 승인 물음보다 1초 먼저다.
//
// 「내 차례」는 한때 맨 위 「전체 | 내 차례」 마디의 칸이었다 — 02 티켓 04가 마디를 걷어 위 줄(새 Thread · 내 차례 · Library)의 한 행이
// 됐다. 켜고 끄는 것은 그 행 하나이고(`aria-pressed`, 이름 「내 차례 N」), 「전체」는 끈 상태다. 새 Thread · Library로 돌아오는 길과 켠
// 동안의 위 줄 면은 틀과 사이드바 spec(`frame-sidebar.spec.ts`)이 잰다. 목록의 줄은 제목 한 줄과 끝의 「내 차례」 알약이다(02 티켓 05 —
// 한때 둘째 줄이 기다리는 것을 말했다).

const project = record("thread-project");
const PROJECT_ASKED = lineOf(project, "question", "asked");
const PROJECT_ANSWERED = lineOf(project, "question", "answered");
const ASK = PROJECT_ASKED.payload as { project: string; work: string; workProjects: string[] };
const permission = record("thread-permission");
const ASKED = lineOf(permission, "permission", "asked");
const ANSWERED = lineOf(permission, "permission", "answered");
const twoTurns = record("thread-two-turns");

/** Work에 이은 Thread — Host가 Work 밖 Project를 묻는 줄 바로 앞이다. */
const inWork = threadOf("20261024-100100", project, { work: ASK.work, live: true, lastSeq: PROJECT_ASKED.seq - 1 });
/** Work 없는 Thread — 승인을 묻는 줄 바로 앞이다. */
const loose = threadOf("20261024-100200", permission, { live: true, lastSeq: ASKED.seq - 1 });
/** 다 읽은 Thread — 기다리지 않는다. 「전체」에만 선다. */
const done = threadOf("20261024-100300", twoTurns, { lastSeq: twoTurns[twoTurns.length - 1].seq, lastRead: twoTurns[twoTurns.length - 1].seq });
const linked = workView({ slug: ASK.work, title: workTitleOf(project, ASK.work), branch: null, projects: ASK.workProjects });

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
/** 사이드바 위 줄의 그 이름의 행 — 「내 차례 N」은 수가 이름에 붙는다. */
const 위줄 = (page: Page, name: string) => 사이드바(page).locator("nav").first().getByRole("button", { name, exact: true });
const 내차례 = (page: Page) => 사이드바(page).getByRole("region", { name: "내 차례", exact: true });
/** 「내 차례」 목록의 줄들 — 기다린 차례대로 제목으로 잰다. */
const 줄제목들 = (page: Page) => 내차례(page).getByRole("button");
const 제목 = (view: ThreadView) => new RegExp(`^${view.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

test("「내 차례」가 나를 기다리는 Thread만 기다린 순서로 세우고, ⌘J가 그 차례로 건너뛰며, 답하면 수가 줄고 목록에서 빠진다", async ({
  page,
}) => {
  const threads = [loose, done, inWork];
  await installFixtureBackend(page, {
    list_works: [...WORKS, linked],
    thread_list: threads.map(summaryOf),
    thread_get: answerByArg("thread", Object.fromEntries(threads.map((view) => [view.id, view]))),
    thread_read_record: answerByArg("thread", {
      [inWork.id]: linesThrough(project, inWork.lastSeq),
      [loose.id]: linesThrough(permission, loose.lastSeq),
      [done.id]: twoTurns,
    }),
    thread_mark_read: answerByArg("thread", Object.fromEntries(threads.map((view) => [view.id, summaryOf(view)]))),
  });
  await page.goto("/");
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });

  // 두 물음이 온다 — 끈 동안(Work 묶음 · Thread 묶음이 선 자리)에도 「내 차례」 행에 기다리는 수가 선다.
  await streamLines(page, inWork.id, [PROJECT_ASKED]);
  await streamLines(page, loose.id, [ASKED]);
  await expect(위줄(page, "내 차례 2")).toHaveAttribute("aria-pressed", "false");
  await expect(사이드바(page).locator("[data-worklist]")).toBeVisible();

  // 「내 차례」 — Work 묶음과 Thread 묶음 대신 기다리는 Thread만 기다린 순서로 선다. Work에 이은 Thread도 한 줄에 섞이고, 줄마다 끝에
  // 「내 차례」 알약이다. 다 읽은 Thread는 없다.
  await 위줄(page, "내 차례 2").click();
  await expect(위줄(page, "내 차례 2")).toHaveAttribute("aria-pressed", "true");
  await expect(내차례(page).getByRole("heading", { name: "기다리는 순서", exact: true })).toBeVisible();
  await expect(줄제목들(page)).toHaveText([제목(inWork), 제목(loose)]);
  await expect(줄제목들(page).locator('[data-mark="mine"]')).toHaveText(["내 차례", "내 차례"]);
  await expect(사이드바(page).locator("[data-worklist]")).toHaveCount(0);
  await expect(사이드바(page).getByRole("region", { name: "Thread", exact: true })).toHaveCount(0);

  // ⌘J — 가장 오래 기다린 Thread, 그다음, 그리고 부른 셸이 없으니 처음으로 돈다.
  for (const view of [inWork, loose, inWork]) {
    await page.keyboard.press("Meta+J");
    await expect(page).toHaveURL(`/threads/${view.id}`);
  }

  // 답하면 그 Thread가 차례에서 빠지고 수가 준다 — 다음 ⌘J는 남은 Thread다.
  await page
    .getByRole("group", { name: "Host가 이 Work에 없는 Project를 고치려고 해요", exact: true })
    .getByRole("button", { name: `${ASK.project}을 이 Work에 붙이고 고치기`, exact: true })
    .click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_project", "thread")).map(({ args }) => args.thread))
    .toEqual([inWork.id]);
  await streamLines(page, inWork.id, [PROJECT_ANSWERED]);
  await expect(위줄(page, "내 차례 1")).toBeVisible();
  await expect(줄제목들(page)).toHaveText([제목(loose)]);
  await page.keyboard.press("Meta+J");
  await expect(page).toHaveURL(`/threads/${loose.id}`);

  // 마지막 물음에 답하면 수가 걷히고 목록은 비었다는 한 줄이다.
  await page.getByRole("group", { name: "Host가 이 파일을 고쳐도 될까요?", exact: true }).getByRole("button", { name: "이번만 허용", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).map(({ args }) => args.thread))
    .toEqual([loose.id]);
  await streamLines(page, loose.id, [ANSWERED]);
  await expect(위줄(page, "내 차례")).toHaveAttribute("aria-pressed", "true");
  await expect(내차례(page)).toHaveText("지금은 나를 기다리는 Thread가 없어요");

  // 「내 차례」를 다시 누르면 끄고, Work 묶음과 Thread 묶음이 다시 선다(「전체」 칸은 없다).
  await 위줄(page, "내 차례").click();
  await expect(위줄(page, "내 차례")).toHaveAttribute("aria-pressed", "false");
  await expect(사이드바(page).locator("[data-worklist]")).toBeVisible();
  await expect(사이드바(page).getByRole("region", { name: "Thread", exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
