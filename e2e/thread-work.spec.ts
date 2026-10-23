import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, WORKS } from "./fixtures";
import { fireEvent, installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls, workRow } from "./harness";
import {
  atHome,
  fireSummary,
  lineOf,
  linesAfter,
  linesThrough,
  record,
  sentPayloads,
  specWrites,
  streamLines,
  summaryOf,
  titleThrough,
  workTitleOf,
  workView,
} from "./thread-records";
import type { AgentRoster, RecordLine, ThreadView } from "@/features/thread/types";
import type { WorkView } from "@/features/works/types";

// v1 티켓 40(PR ④ e2e) 흐름 하나 — **Host가 Work 만들기를 카드로 물어 사람이 만들면 Thread가 그 Work에 이어지고, Work 카드가 선다**
// (v1 티켓 30 · 34 · 37 · 구현 스펙 §11 · §15 · S31 · S32 · 스토리 97 · 104 · 112). 이어진 Thread가 처음 고칠 때 Work 밖 Project를 묻는
// 카드(v1 티켓 32 · S22)도 같은 이어짐의 흐름이라 여기 둔다.
//
// 줄은 L1이 축복한 기록을 그대로 쏜다 — 진짜 claude 2.1.309가 Work 없는 Thread에서 「백엔드 환불 API 버그 고쳐줘」를 받은 첫 턴(`thread-work`,
// v1 티켓 39)과 Work 밖 web-app을 붙이고 고친 턴(`thread-project`). 카드의 글 · 답 · Work 이름은 그 기록에서 읽는다(스토리 137).

/** 카드는 선 직후 잠깐 키를 받지 않는다(`ProjectCard`의 `ARMING_MS`). */
const ARMING_MS = 300;

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 흐름 = (page: Page) => page.getByRole("main");
const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");

/**
 * Library의 Host — 기본 파일(`atelier-core` `agents/host.md`)의 먼저 묻는 일이다. 「결정은 내가 합니다」 카드가 이것으로 줄을 세운다(코드 리뷰
 * 1차 B7). 스키마 명령 패턴 여럿은 한 줄이다.
 */
const LIBRARY: AgentRoster = {
  agents: [
    {
      call: "host",
      from: "library",
      path: "/Users/tester/.atelier/library/agents/host.md",
      definition: {
        handle: "host",
        name: "Host",
        description: "다른 Agent를 부르지 않았을 때 답한다.",
        avatar: null,
        model: { prefer: null, effort: null },
        policy: { askBefore: ["push", "Bash(*prisma migrate *)", "Bash(*alembic upgrade *)"], forbid: [] },
      },
    },
  ],
  broken: [],
};

/** 그 Thread를 그 seq까지 연다 — 목록 · 읽기 · 읽은 자리를 그 Thread로 답한다. Work 목록에는 이은 Work를 더한다. */
async function openThread(page: Page, view: ThreadView, lines: readonly RecordLine[], works: WorkView[] = WORKS) {
  await installFixtureBackend(page, {
    list_works: works,
    list_agents: LIBRARY,
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: linesThrough(lines, view.lastSeq) }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: view.lastSeq } }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(sentPayloads(lines)[0].text, { exact: true })).toBeVisible({ timeout: 20_000 });
}

/**
 * 엔진이 Thread를 Work에 이었다 — 목록 요약 이벤트가 그 Work를 싣고 온다(`change_thread`). 다시 읽는 답(보기 · 목록 · 읽은 자리)도 그
 * Work를 싣는다 — 기본 답이 남으면 다음 읽기가 이음을 덮는다.
 */
async function linkTo(page: Page, view: ThreadView) {
  await replaceAnswer(page, "thread_get", answerByArg("thread", { [view.id]: view }));
  await replaceAnswer(page, "thread_list", [summaryOf(view)]);
  await replaceAnswer(page, "thread_mark_read", answerByArg("thread", { [view.id]: summaryOf(view) }));
  await fireSummary(page, view);
}

/** Work 목록이 바뀌었다 — 감시가 `works:changed`를 내면 화면이 목록을 다시 읽는다. */
async function worksNow(page: Page, works: WorkView[]) {
  await replaceAnswer(page, "list_works", works);
  await fireEvent(page, "works:changed", null);
}

const work = atHome(record("thread-work"));
const ASKED = lineOf(work, "question", "asked");
const ANSWERED = lineOf(work, "question", "answered");
const CREATED = lineOf(work, "work", "created");
type Proposed = {
  requestId: string;
  title: string;
  reason: string;
  branch: string;
  projects: { slug: string; name: string; recommended: boolean }[];
};
const PROPOSED = ASKED.payload as Proposed;
const MADE = CREATED.payload as { slug: string; title: string; branch: string; projects: string[] };
/** 턴이 spec 폴더에 쓴 새 문서(`Write`) — spec 기준 경로. */
const WRITTEN = Object.keys(specWrites(work, MADE.slug));

test("Host의 Work 만들기 제안이 입력창 자리에 카드로 서고, 만들면 Thread가 그 Work에 이어져 결정 줄 · 알약 · Work 카드 · 사이드바 Work 줄이 서고, 턴이 쓴 문서가 문서 카드로 선다", async ({
  page,
}) => {
  // Work 없는 Thread가 제안 바로 앞까지 와 있다 — Host가 저장소를 읽으며 물은 승인은 모두 답했고, 이름은 Host가 바꿨다.
  const view: ThreadView = { ...FIXTURE_THREAD, title: titleThrough(work, ASKED.seq), live: true, lastSeq: ASKED.seq - 1 };
  await openThread(page, view, work);
  await expect(page.getByLabel("어디서 일할지 Work 없음", { exact: true })).toBeVisible();
  const threadGroup = 사이드바(page).getByRole("region", { name: "Thread", exact: true });
  await expect(threadGroup.getByText(view.title, { exact: true })).toBeVisible();

  // 제안 줄 — 입력창 자리에 카드가 선다. 이름 · 까닭, Host가 추천한 Project가 골라져 있고 브랜치는 Host가 고른 이름이다.
  await streamLines(page, view.id, [ASKED]);
  const card = page.getByRole("group", { name: "이 일을 Work로 묶을까요?", exact: true });
  await expect(card).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await expect(card).toContainText(`${PROPOSED.title} · ${PROPOSED.reason}`);
  for (const one of PROPOSED.projects) {
    const box = card.getByRole("checkbox", { name: new RegExp(`^${one.name}`) });
    await expect(box).toHaveAttribute("aria-checked", String(one.recommended));
  }
  await expect(card.getByRole("checkbox", { name: /^api-server/ })).toContainText("Host 추천");
  await expect(card.getByRole("textbox", { name: "브랜치", exact: true })).toHaveValue(PROPOSED.branch);

  // 「Work 만들기」 — 고른 Project와 브랜치가 그 제안의 요청 id로 간다. 기록의 답과 같다.
  await card.getByRole("button", { name: "Work 만들기", exact: true }).click();
  const { projects, branch } = ANSWERED.payload as { projects: string[]; branch: string };
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_work", "thread")).map(({ args }) => args))
    .toEqual([{ thread: view.id, request: PROPOSED.requestId, create: true, projects, branch }]);

  // 엔진이 Work를 만들고 이 Thread를 잇는다 — 답 줄 · `work` 줄, Work 목록과 목록 요약이 바뀐다.
  const linked: ThreadView = { ...view, work: MADE.slug, lastSeq: CREATED.seq };
  const made = workView(MADE);
  await worksNow(page, [...WORKS, made]);
  await streamLines(page, view.id, [ANSWERED, CREATED]);
  await linkTo(page, linked);

  // 카드가 걷히고 그 자리에 결정 줄이, 턴 뒤에 이음 줄이 선다. 머리 줄 이름 뒤에 Work 알약이, 오른쪽 위에 Work 카드가 선다 — 아직
  // worktree가 없어 Project는 읽기만이다.
  await expect(card).toHaveCount(0);
  await expect(흐름(page).locator('[data-decision="work-created"]')).toHaveText(
    ["Work 만들기", ...MADE.projects, MADE.branch].join(" · "),
  );
  await expect(흐름(page).locator('[data-system="work"]')).toHaveText(`Work ${MADE.title}을 만들고 이 Thread에 연결함`);
  await expect(page.getByRole("button", { name: `Work 열기: ${MADE.title}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Work 카드 닫기", exact: true })).toHaveAttribute("aria-pressed", "true");
  const workCard = page.getByRole("region", { name: `Work 카드: ${MADE.title}`, exact: true });
  await expect(workCard.locator('[data-project="api-server"]')).toHaveText(/^api-server\s*읽기만/);

  // 처음 이은 Thread에는 「결정은 내가 합니다」가 한 번 선다(S31) — 「알겠어요」가 본 것을 앱 설정에 적고 입력창이 돌아온다. 입력창의
  // Work 칩은 이제 보이기만 하는 이은 Work의 이름이다.
  const decisions = page.getByRole("region", { name: "결정은 내가 합니다", exact: true });
  await expect(decisions).toBeVisible();
  // 줄은 Library Host 정의의 먼저 묻는 일과 Work 밖 Project다(코드 리뷰 1차 B7) — 기본 파일이면 보드의 셋이다.
  await expect(decisions.getByRole("listitem")).toHaveText([
    "데이터베이스 스키마 바꾸기",
    "원격 저장소에 push",
    "이 Work 밖의 Project 건드리기",
  ]);
  await decisions.getByRole("button", { name: "알겠어요", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "write_settings", "settings")).map(({ args }) => args.settings))
    .toEqual([expect.objectContaining({ seen: { decisions: true } })]);
  await expect(decisions).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(page.getByLabel(`어디서 일할지 ${MADE.title}`, { exact: true })).toBeVisible();

  // 사이드바 — 그 Thread는 Thread 묶음에서 빠지고, 새 Work 줄이 접힌 채 켜져 선다(지금 보는 Thread가 그 안이다). 펴면 그 Thread가 있다.
  await expect(threadGroup.getByText(linked.title, { exact: true })).toHaveCount(0);
  await expect(workRow(page, MADE.slug)).toHaveClass(/selected-row/);
  await 사이드바(page).getByRole("button", { name: `${MADE.title}의 Thread 펼치기`, exact: true }).click();
  await expect(사이드바(page).locator(`[data-work-threads="${MADE.slug}"]`)).toContainText(linked.title);

  // 턴이 이어 spec 폴더에 설계 문서 둘을 쓰고 끝난다 — 답 아래에 문서 카드가, Work 카드의 문서 칸에 그 문서가 선다.
  await streamLines(page, view.id, linesAfter(work, CREATED.seq));
  await worksNow(page, [...WORKS, workView(MADE, { docs: WRITTEN })]);
  for (const path of WRITTEN) {
    await expect(흐름(page).locator(`[data-doc-card="${path}"]`)).toBeVisible();
    await expect(workCard.locator(`[data-doc="${path}"]`)).toBeVisible();
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const project = record("thread-project");
const PROJECT_ASKED = lineOf(project, "question", "asked");
const PROJECT_ANSWERED = lineOf(project, "question", "answered");
const PLANTED = lineOf(project, "work", "worktree");
type ProjectAsk = { requestId: string; project: string; reason: string; work: string; workProjects: string[] };
const ASK = PROJECT_ASKED.payload as ProjectAsk;
const TREE = PLANTED.payload as { project: string; branch: string };

test("이은 Thread에서 Host가 Work 밖 Project를 고치려 하면 카드가 묻고, 「붙이고 고치기」면 그 Project가 붙어 worktree 줄이 서고 Work 카드에서 고치는 중이 된다", async ({
  page,
}) => {
  // Work에 이은 Thread가 첫 말을 받아 Host가 `start_editing`을 부른 자리까지 왔다 — Work에는 api-server만 붙어 있고 worktree는 아직 없다.
  const view: ThreadView = {
    ...FIXTURE_THREAD,
    title: sentPayloads(project)[0].text,
    work: ASK.work,
    live: true,
    lastSeq: PROJECT_ASKED.seq - 1,
  };
  const linked = { slug: ASK.work, title: workTitleOf(project, ASK.work), branch: TREE.branch, projects: ASK.workProjects };
  await openThread(page, view, project, [...WORKS, workView(linked)]);
  const workCard = page.getByRole("region", { name: `Work 카드: ${linked.title}`, exact: true });
  await expect(workCard.locator("[data-project]")).toHaveText([/^api-server\s*읽기만/]);

  // 물음 줄 — 입력창 자리에 카드가 선다. 물음 · 까닭과 선택지 셋(붙이고 고치기 · 읽기만 · 아니요)이다.
  await streamLines(page, view.id, [PROJECT_ASKED]);
  const card = page.getByRole("group", { name: "Host가 이 Work에 없는 Project를 고치려고 해요", exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText(ASK.reason);
  const 선택지 = card.getByRole("button");
  const names = [`${ASK.project}을 이 Work에 붙이고 고치기`, "읽기만 하기", `아니요, ${ASK.workProjects.join(" · ")}에서만 고쳐 주세요`];
  await expect(선택지).toHaveCount(names.length);
  for (const [at, name] of names.entries()) await expect(선택지.nth(at)).toHaveAccessibleName(name);
  await expect(흐름(page).getByText("Work 밖 Project 답을 기다려요", { exact: true })).toBeVisible();
  await expect(card).toBeFocused();
  await page.waitForTimeout(ARMING_MS);

  // Enter가 켜진 첫 줄 「붙이고 고치기」를 고른다 — 답은 그 물음의 요청 id로 간다. 기록의 답과 같다.
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_project", "thread")).map(({ args }) => args))
    .toEqual([{ thread: view.id, request: ASK.requestId, choice: (PROJECT_ANSWERED.payload as { choice: string }).choice }]);

  // 엔진이 Project를 붙이고 그 worktree를 짓는다 — 카드가 걷히고 결정 줄과 그 턴 머리의 worktree 줄이 선다. Work 목록이 바뀌면
  // Work 카드의 그 Project가 「고치는 중」이다.
  await streamLines(page, view.id, linesAfter(project, PROJECT_ASKED.seq));
  await worksNow(page, [...WORKS, workView({ ...linked, projects: [...ASK.workProjects, ASK.project] }, { trees: [ASK.project] })]);
  await expect(card).toHaveCount(0);
  await expect(흐름(page).locator('[data-decision="project-attach"]')).toHaveText(`${ASK.project}을 이 Work에 붙임`);
  await expect(흐름(page).locator('[data-system="worktree"]')).toHaveText(`${TREE.project}에 worktree를 만듦 · ${TREE.branch}`);
  await expect(workCard.locator("[data-project]")).toHaveText([/^api-server\s*읽기만/, new RegExp(`^${ASK.project}\\s*고치는 중`)]);
  await expect(입력칸(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
