import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, WORKS } from "./fixtures";
import { callCount, installFixtureBackend, ipcCallArgs, replaceAnswer, steadyCount, unknownIpcCalls } from "./harness";
import { linesThrough, record, seqOf, sentPayloads, streamLines, summaryOf, workTitleOf, workView } from "./thread-records";
import type { PrLine } from "@/features/thread/pr";
import type { ThreadView } from "@/features/thread/types";
import type { ProjectChanges, ProjectPr } from "@/features/works/types";

// v1 티켓 40(PR ④ e2e) 흐름 하나 — **엔진이 Work의 PR을 읽어 남긴 `pr` 줄이 흐름에 PR 카드로 서고, 요약 카드의 PR 줄(「변경 사항」
// 아래 — 02 §7 · S18)이 CI를 문장으로 보인다**(v1 티켓 36 · 구현 스펙 §12 S24 · §15 · 스토리 124–127). 처음 보인 PR은 「CI 확인 중」, CI가 실패하면 카드가 하나 더 서고 실패
// 문장과 「Host에게 고쳐 달라고 하기」가, 병합되면 「병합됨」이 선다. 카드가 열린 동안 PR은 60초마다 다시 읽는다.
//
// 줄은 L1이 축복한 기록을 그대로 쏜다 — Work에 이은 Thread의 턴이 끝난 뒤 처음 보인 PR · 카드의 읽기가 본 CI 실패 · 병합됨(`thread-pr`,
// `thread_pr.rs`). 카드 · 줄의 글과 요약 카드가 받는 PR(`thread_work_prs`)은 그 줄에서 읽는다(스토리 137).

const lines = record("thread-pr");
const TURN_END = seqOf(lines, "turn-end");
const prs = lines.filter((line) => line.kind === "pr");
const [OPENED, FAILED, MERGED] = prs.map((line) => line.payload as PrLine);

/** 엔진이 그때 읽은 PR — 요약 카드의 PR 쿼리(`thread_work_prs`)가 받는 꼴이다(`pr` 줄은 이것에 Work · 처음인지를 더한 것). */
const found = ({ work: _work, first: _first, ...pr }: PrLine): ProjectPr => ({ kind: "found", ...pr });

const WORK = { slug: OPENED.work, title: workTitleOf(lines, OPENED.work), branch: OPENED.headBranch, projects: [OPENED.project] };
const CHANGED = "refund/service.py";
const CHANGES: ProjectChanges[] = [
  { project: OPENED.project, kind: "listed", base: OPENED.baseBranch, files: [{ path: CHANGED, additions: 6, deletions: 3 }] },
];
/** 턴이 막 끝난 Thread — Host의 Session이 떠 있다. */
const view: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(lines)[0].text, work: WORK.slug, live: true, lastSeq: TURN_END };

const 흐름 = (page: Page) => page.getByRole("main");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 요약 카드(02 §7 — v1 Work 카드를 바꿨다) — 영역 이름에 Work 이름이 없다. */
const 카드 = (page: Page) => page.getByRole("region", { name: "요약", exact: true });
const PR줄 = (page: Page) => 카드(page).getByRole("button", { name: new RegExp(`^PR #${OPENED.number}`) });
const PR카드 = (page: Page) => 흐름(page).getByRole("region", { name: `PR #${OPENED.number} ${OPENED.title}`, exact: true });

test("턴 끝 뒤 처음 보인 PR이 흐름에 「CI 확인 중」 카드로 서고, CI가 실패하면 카드가 하나 더 서며 요약 카드의 PR 줄이 실패 문장이 되고, 병합되면 「병합됨」이며, 카드가 열린 동안 60초마다 다시 읽는다", async ({
  page,
}) => {
  // 60초 박자를 재려고 시계를 쥔다 — 시간은 그대로 흐르고, 앞당길 때만 앞당긴다.
  await page.clock.install();
  await installFixtureBackend(page, {
    list_works: [...WORKS, workView(WORK, { trees: WORK.projects })],
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: linesThrough(lines, TURN_END) }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: TURN_END } }),
    thread_work_prs: [found(OPENED)],
    list_work_changes: CHANGES,
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(view.title, { exact: true })).toBeVisible({ timeout: 20_000 });

  // 카드가 열리며 PR을 한 번 읽는다 — PR 줄은 「CI 확인 중」이고 그 글이 천천히 빛난다.
  await expect(PR줄(page)).toHaveText(/CI 확인 중/);
  await expect(PR줄(page).locator('[data-pr-icon="open"]')).toHaveCount(1);
  await expect(PR줄(page).getByText("CI 확인 중", { exact: true })).toHaveClass(/chat-shimmer/);
  expect(await steadyCount(page, "thread_work_prs")).toBe(1);

  // 엔진이 처음 보인 PR을 남겼다 — 흐름에 PR 카드가 선다. 브랜치 → base · +/− · 파일 수 · 리뷰 · CI 문장이 메타 줄이다.
  await streamLines(page, view.id, [prs[0]]);
  await expect(PR카드(page)).toHaveCount(1);
  const opened = PR카드(page).first();
  await expect(opened).toHaveAttribute("data-pr-state", "open");
  const meta = [
    `${OPENED.headBranch} → ${OPENED.baseBranch}`,
    `+${OPENED.additions}`,
    `−${OPENED.deletions}`,
    `파일 ${OPENED.changedFiles}개`,
    `승인 ${OPENED.approvals}개`,
    "CI 확인 중",
  ];
  for (const said of meta) await expect(opened).toContainText(said);
  await expect(opened.getByRole("button", { name: "Host에게 고쳐 달라고 하기", exact: true })).toHaveCount(0);

  // CI가 실패했다 — 카드가 하나 더 서고, 마지막 카드에 실패한 검사와 고쳐 달라는 버튼이 선다. 요약 카드의 PR 줄은 엔진의 줄로 바뀌고
  // (`gh`를 다시 부르지 않는다) 그 아래 실패 문장이 선다.
  await replaceAnswer(page, "thread_work_prs", [found(FAILED)]);
  await streamLines(page, view.id, [prs[1]]);
  await expect(PR카드(page)).toHaveCount(2);
  const failed = PR카드(page).last();
  const failedNames = FAILED.ci.kind === "failing" ? FAILED.ci.failed : [];
  await expect(failed.locator('[data-ci="failing"]')).toHaveCount(1);
  await expect(failed).toContainText(`CI 실패 · ${failedNames.join(", ")}`);
  await expect(PR줄(page)).toHaveText(/CI 실패/);
  await expect(PR줄(page).locator('[data-pr-icon="failed"]')).toHaveCount(1);
  await expect(카드(page)).toContainText(`${failedNames.join(", ")} 검사가 실패했어요.`);
  expect(await callCount(page, "thread_work_prs")).toBe(1);

  // 「Host에게 고쳐 달라고 하기」는 입력창을 채울 뿐이다 — 보내는 것은 사람이다.
  await failed.getByRole("button", { name: "Host에게 고쳐 달라고 하기", exact: true }).click();
  await expect(입력칸(page)).toHaveValue(`PR #${FAILED.number}의 CI에서 ${failedNames.join(", ")} 검사가 실패했어요. 원인을 찾아 고쳐 줘.`);
  expect(await ipcCallArgs(page, "thread_send", "text")).toEqual([]);

  // 「GitHub에서 열기」는 그 PR 주소를 기본 브라우저로 연다.
  await failed.getByRole("button", { name: "GitHub에서 열기", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "plugin:opener|open_url", "url")).map(({ args }) => args))
    .toEqual([{ url: FAILED.url }]);

  // 「변경 사항 보기」는 요약 카드를 넓혀 그 Project의 첫 바뀐 파일을 연다. 접으면 작은 카드다.
  await failed.getByRole("button", { name: "변경 사항 보기", exact: true }).click();
  await expect(page.locator("section[data-expanded] [data-viewer=\"change\"]")).toBeVisible();
  await expect(카드(page).locator(`[data-change="${CHANGED}"]`)).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "카드로 접기", exact: true }).click();
  await expect(page.locator("section[data-expanded]")).toHaveCount(0);

  // 카드가 열린 동안 60초마다 다시 읽는다.
  await page.clock.runFor(61_000);
  await expect.poll(() => callCount(page, "thread_work_prs")).toBe(2);
  await expect(PR줄(page)).toHaveText(/CI 실패/);

  // 병합됐다 — 마지막 카드가 「병합됨」과 병합한 때를 보이고 버튼이 없다. 앞 카드의 고쳐 달라는 버튼은 걷힌다. PR 줄도 「병합됨 · 때」다.
  await streamLines(page, view.id, [prs[2]]);
  await expect(PR카드(page)).toHaveCount(3);
  const merged = PR카드(page).last();
  await expect(merged).toHaveAttribute("data-pr-state", MERGED.state);
  await expect(merged.getByRole("button")).toHaveCount(0);
  await expect(흐름(page).getByRole("button", { name: "Host에게 고쳐 달라고 하기", exact: true })).toHaveCount(0);
  await expect(PR줄(page)).toHaveText(/병합됨 · /);
  await expect(PR줄(page).locator('[data-pr-icon="merged"]')).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
