import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_COMMANDS, FIXTURE_THREAD, PROJECTS, SPACES, WORKS } from "./fixtures";
import { fireEvent, installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls } from "./harness";
import {
  atHome,
  lineOf,
  linesThrough,
  record,
  sentPayloads,
  seqOf,
  specWrites,
  streamLines,
  summaryOf,
  titleThrough,
  workTitleOf,
  workView,
} from "./thread-records";
import { THREAD_QUEUE_EVENT } from "@/features/thread/events";
import type { PrLine } from "@/features/thread/pr";
import type { Settings } from "@/features/settings/types";
import type { ReadingScope } from "@/features/spaces/scope";
import type { Space } from "@/features/spaces/types";
import type { RecordLine, ThreadQueueEvent, ThreadView } from "@/features/thread/types";
import type { ProjectChanges, ProjectPr } from "@/features/works/types";

// 02 티켓 13 흐름 「Thread 화면」 — **Codex 결로 바뀐 Thread 화면이 겉으로 그렇게 선다**(02 구현 스펙 Testing Decisions 「Thread 화면」 ·
// §6 머리 줄 · §7 요약 카드 · §9 입력창 · §10 입력창 자리 카드). 흐름 하나에 스펙 하나이고, 같은 것을 두 번 재지 않는다 — 이 판의 목록
// 가운데 이미 다른 spec이 재는 것은 그 자리에 둔다.
//
//   여기서 잰다     머리 줄(이름 · Work 이름 · 제자리 바꾸기 · 「…」 · 요약 고정 토글 · 읽기만이면 꺼짐)
//                   요약 카드(칸 차례 · 「＋」 없음 · 소스 「모두 보기」 · 「변경 사항」 → 넓힌 카드 · 열 비켜나기 · Work 없는 Thread의 칸 ·
//                   Thread마다 기억 · 첫 화면에 없음)
//                   승인 카드의 늘 허용 갈래(이은 Work면 「이 Work에서」) · 입력창 자리 카드의 겉 · 대기 「지금 보내기」 · 작업 중 점 ·
//                   Thread 화면이 서기 전에 「새 Thread」로 돌아온 첫 화면
//   다른 spec이 잰다 Host 답 머리 없음 · 다른 Agent 이름 줄(`thread-mention`) · 도구 없는 턴의 구분선 사라짐(`thread`) · 승인 단추 글자 ·
//                   ↵ · esc · 숫자 키 없음 · 답한 질문 한 줄(`thread-approval`) · Thread 안에 고르는 Work 칩 없음(`thread-work`) · 넓힌
//                   카드의 줄 · 480 · 작은 카드 앞 16(`thread-work-card`) · 첫 화면 Work 칩의 스위치 · 기억(`thread-work-chip`) · 트레이의
//                   두 자리 · 잠긴 칩 · Space 칩 · 범위 줄(03 흐름 「트레이」 — `thread-tray`) · Work 없는 Thread 머리 줄의 Space(03 흐름
//                   「대화 속 Space와 설정」 — `thread-space-setting`)
//
// 줄은 L1이 축복한 기록을 그대로 쏜다(스토리 137) — Work 만들기 턴(`thread-work`), PR을 남긴 Work의 턴(`thread-pr`), 답만 한 턴과 도구를
// 쓴 턴(`thread-two-turns`). 기하는 시안 창(1440 × 900)에서 잰다 — 시안 비교 06 · 07 · 10 · 11의 「잰 값」이 그 창의 값이다.

/** 카드는 선 직후 잠깐 키를 받지 않는다(`ApprovalCard`의 `ARMING_MS`). */
const ARMING_MS = 300;

test.use({ viewport: { width: 1440, height: 900 } });

const 흐름 = (page: Page) => page.getByRole("main");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 입력창 — 보낼 말 칸을 싼 둘레 카드(`form`)다. 열의 자리는 이것으로 잰다. */
const 입력창 = (page: Page) => 입력칸(page).locator("xpath=ancestor::form[1]");
/** 요약 카드 — 작은 카드든 넓힌 카드든 영역 이름이 같다. */
const 카드 = (page: Page) => page.getByRole("region", { name: "요약", exact: true });
const 머리줄 = (page: Page) => page.locator('[data-slot="screen-head"]');
const 요약토글 = (page: Page) => page.getByRole("button", { name: "요약 고정", exact: true });
const Thread메뉴 = (page: Page) => page.getByRole("button", { name: "Thread 메뉴", exact: true });
const 사이드바Thread = (page: Page, title: string) =>
  page.getByRole("region", { name: "Thread", exact: true }).getByRole("button").filter({ hasText: title });

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };
const 상자 = (target: Locator): Promise<Box> =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
const 모양 = (target: Locator, props: readonly string[]) =>
  target.evaluate((el, names) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
  }, props);

/** Work 만들기 턴(`thread-work`)이 끝난 자리 — Thread가 그 턴이 만든 Work에 이어져 있다. */
const made = atHome(record("thread-work"));
const MADE = lineOf(made, "work", "created").payload as { slug: string; title: string; branch: string; projects: string[] };
const MADE_LAST = made[made.length - 1].seq;
const MADE_DOCS = Object.keys(specWrites(made, MADE.slug));
const linkedView: ThreadView = { ...FIXTURE_THREAD, title: titleThrough(made, MADE_LAST), work: MADE.slug, lastSeq: MADE_LAST };
/** 「결정은 내가 합니다」는 이은 뒤 처음 한 번이다(흐름 「Work 만들기」 — `thread-work`가 잰다) — 이미 봤다. */
const SEEN: Settings = { ...(FIXTURE_COMMANDS.read_settings as Settings), seen: { decisions: true } };

/** 그 Thread를 연다 — 목록 · 읽기 · 읽은 자리를 그 Thread로 답한다. 덮어쓸 답이 더 있으면 함께 준다. */
async function openThread(page: Page, view: ThreadView, lines: readonly RecordLine[], more: Record<string, unknown> = {}) {
  await installFixtureBackend(page, {
    read_settings: SEEN,
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: view.lastSeq } }),
    ...more,
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(sentPayloads(lines)[0].text, { exact: true })).toBeVisible({ timeout: 20_000 });
}

test("머리 줄 — Work에 이은 Thread는 「폴더 · Work 이름 ›」 뒤에 이름이 서서 그 자리에서 바뀌고, 오른쪽 끝 「…」 · 요약 고정 토글이 카드를 여닫으며, Work 이름이 카드를 연다", async ({
  page,
}) => {
  await openThread(page, linkedView, made, { list_works: [...WORKS, workView(MADE, { docs: MADE_DOCS })] });

  // 이름 앞의 Work — 폴더 14 · Work 이름 14/400 #898a8b(`fg-titlebar`), 그 뒤 8에 「›」(그림이라 이름에 들지 않는다), 다시 8에 Thread
  // 이름 14/500(02 §6 · 시안 `.tb-c`).
  const work = page.getByRole("button", { name: `Work 열기: ${MADE.title}`, exact: true });
  const workName = work.getByText(MADE.title, { exact: true });
  const crumb = 머리줄(page).getByText("›", { exact: true });
  const name = 머리줄(page).getByText(linkedView.title, { exact: true });
  await expect(work).toBeVisible();
  await expect(crumb).toHaveAttribute("aria-hidden", "true");
  expect(await 모양(workName, ["font-size", "font-weight", "color"])).toEqual({
    "font-size": "14px",
    "font-weight": "400",
    color: "rgb(137, 138, 139)",
  });
  expect(await 모양(name, ["font-size", "font-weight"])).toEqual({ "font-size": "14px", "font-weight": "500" });
  const [workBox, crumbBox, nameBox] = [await 상자(work), await 상자(crumb), await 상자(name)];
  expect(crumbBox.x - workBox.right).toBeCloseTo(8, 0);
  expect(nameBox.x - crumbBox.right).toBeCloseTo(8, 0);

  // 오른쪽 끝 — 「…」와 요약 고정 토글이 28 · 사이 2 · 창 오른쪽 끝 8에 선다. 카드가 열려 있으니 토글은 켜졌다(#ebebec · `aria-pressed`).
  const menuBox = await 상자(Thread메뉴(page));
  const toggleBox = await 상자(요약토글(page));
  expect([menuBox.width, menuBox.height, toggleBox.width, toggleBox.height]).toEqual([28, 28, 28, 28]);
  expect(toggleBox.x - menuBox.right).toBeCloseTo(2, 0);
  expect(1440 - toggleBox.right).toBeCloseTo(8, 0);
  await expect(카드(page)).toBeVisible();
  await expect(요약토글(page)).toHaveAttribute("aria-pressed", "true");
  expect(await 모양(요약토글(page), ["background-color"])).toEqual({ "background-color": "rgb(235, 235, 236)" });

  // 토글이 카드를 닫고(면이 빠진다 — 손을 치운 뒤, 색 전이가 끝나면), 머리 줄의 Work 이름이 다시 연다(S13).
  await 요약토글(page).click();
  await expect(요약토글(page)).toHaveAttribute("aria-pressed", "false");
  await expect(카드(page)).toHaveCount(0);
  await page.mouse.move(720, 450);
  await expect.poll(async () => (await 모양(요약토글(page), ["background-color"]))["background-color"]).toBe("rgba(0, 0, 0, 0)");
  await work.click();
  await expect(카드(page)).toBeVisible();
  await expect(요약토글(page)).toHaveAttribute("aria-pressed", "true");

  // 제자리 바꾸기 — 이름을 두 번 누르면 그 자리가 입력칸이 되고, Enter가 새 이름을 보낸다. 입력칸이 걷히면 포커스는 이름으로 돌아온다.
  const renamed = "환불 버그 고친 이야기";
  await replaceAnswer(page, "thread_rename", { ...summaryOf(linkedView), title: renamed });
  const 이름칸 = 머리줄(page).getByRole("textbox", { name: "Thread 이름", exact: true });
  await name.dblclick();
  await expect(이름칸).toBeFocused();
  await expect(이름칸).toHaveValue(linkedView.title);
  await 이름칸.fill(renamed);
  await 이름칸.press("Enter");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_rename", "thread")).map(({ args }) => args))
    .toEqual([{ thread: linkedView.id, title: renamed }]);
  const shown = 머리줄(page).getByText(renamed, { exact: true });
  await expect(shown).toBeFocused();

  // F2도 그 자리를 연다 — Esc는 바꾸지 않고 닫는다.
  await page.keyboard.press("F2");
  await expect(이름칸).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(이름칸).toHaveCount(0);
  await expect(shown).toBeFocused();

  // 「…」는 이 Thread의 대상 메뉴 — 「이름 바꾸기」(F2) 하나다. 고르면 이름 자리가 입력칸이 되고 포커스가 그 칸에 남는다(S15).
  await Thread메뉴(page).click();
  const menu = page.getByRole("menu", { name: "Thread 메뉴", exact: true });
  await expect(menu.getByRole("menuitem")).toHaveText([/^이름 바꾸기\s*F2$/]);
  await menu.getByRole("menuitem", { name: "이름 바꾸기", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(이름칸).toBeFocused();
  await expect(이름칸).toHaveValue(renamed);
  await page.keyboard.press("Escape");
  await expect(이름칸).toHaveCount(0);
  expect(await ipcCallArgs(page, "thread_rename", "thread")).toHaveLength(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("머리 줄 — 지워진 Work의 읽기만 Thread는 이름을 바꾸지 못하고(「…」의 「이름 바꾸기」가 꺼짐), 카드도 요약 고정 토글도 없다", async ({
  page,
}) => {
  const removed: ThreadView = { ...linkedView, readOnly: "removed" };
  await openThread(page, removed, made);
  const name = 머리줄(page).getByText(removed.title, { exact: true });
  await expect(name).toBeVisible();
  await expect(page.getByRole("button", { name: /^Work 열기: / })).toHaveCount(0);
  await expect(요약토글(page)).toHaveCount(0);
  await expect(카드(page)).toHaveCount(0);

  // 이름은 포커스를 받지 않고 두 번 눌러도 입력칸이 서지 않는다. 메뉴의 「이름 바꾸기」는 숨지 않고 흐리다.
  await expect(name).not.toHaveAttribute("tabindex");
  await name.dblclick();
  await expect(머리줄(page).getByRole("textbox")).toHaveCount(0);
  await Thread메뉴(page).click();
  await expect(page.getByRole("menuitem", { name: "이름 바꾸기", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** PR을 남긴 Work의 턴(`thread-pr`)이 끝난 자리. */
const prLines = record("thread-pr");
const PR_END = seqOf(prLines, "turn-end");
const OPENED = prLines.find((line) => line.kind === "pr")!.payload as PrLine;
const found = ({ work: _work, first: _first, ...pr }: PrLine): ProjectPr => ({ kind: "found", ...pr });
/** 소스가 넷을 넘는 Work — spec 문서 셋과 Project 둘(고치는 중 · 읽기만). */
const PR_WORK = workView(
  { slug: OPENED.work, title: workTitleOf(prLines, OPENED.work), branch: OPENED.headBranch, projects: [OPENED.project, "web-app"] },
  { docs: ["overview.md", "01-fix/plan.md", "notes.md"], trees: [OPENED.project] },
);
const CHANGED = "refund/service.py";
const PR_CHANGES: ProjectChanges[] = [
  { project: OPENED.project, kind: "listed", base: OPENED.baseBranch, files: [{ path: CHANGED, additions: 6, deletions: 3 }] },
];
const prView: ThreadView = { ...FIXTURE_THREAD, title: sentPayloads(prLines)[0].text, work: PR_WORK.slug, lastSeq: PR_END };
/**
 * 그 Thread가 읽는 범위(03 §7 — core `reading_scope`가 짓는 모양) — Work에 Space가 없어 등록된 Project 둘을 모두 읽되, worktree에서 일하는
 * Project는 범위에서 빠진다(규칙 4). 요약 카드의 「읽기만」이 이것이다.
 */
const PR_SCOPE: ReadingScope = {
  space: null,
  projects: [{ slug: "web-app", name: "web-app", why: "all" }],
  worked: [{ slug: "api-server", name: "api-server" }],
  kind: "all",
  registered: 2,
};

test("요약 카드 — 머리 · 변경 사항 · PR · 결과물 · 소스 차례로 「＋」 없이 서고, 소스가 셋을 넘으면 「모두 보기」가 펴며, 「변경 사항」이 넓힌 카드를 열고, 열이 카드를 비켜난다", async ({
  page,
}) => {
  await openThread(page, prView, linesThrough(prLines, PR_END), {
    list_works: [...WORKS, PR_WORK],
    thread_work_prs: [found(OPENED)],
    list_work_changes: PR_CHANGES,
    reading_scope: answerByArg("thread", { [prView.id]: PR_SCOPE }),
  });
  const card = 카드(page);
  await expect(card).toBeVisible();

  // 칸 차례(02 §7) — 머리(Work 이름 · 「…」) → 「변경 사항」(Work 합계) → PR 줄 → 결과물(자리표시) → 소스. 칸 머리에 더하기가 없다(S19).
  await expect(card.locator("[data-changes]")).toHaveText(/^변경 사항\s*\+6\s*−3$/);
  await expect(card.getByRole("button", { name: new RegExp(`^PR #${OPENED.number}`) })).toBeVisible();
  await expect(card.locator(":scope > *").first()).toHaveText(PR_WORK.title);
  await expect(card.locator(":scope > *").first().getByRole("button", { name: "Work 메뉴", exact: true })).toBeVisible();
  expect(
    await card.evaluate((el) =>
      [...el.querySelectorAll("[data-changes], [data-pr-icon], section[aria-label]")].map((one) =>
        one.matches("[data-changes]") ? "변경 사항" : one.matches("[data-pr-icon]") ? "PR" : one.getAttribute("aria-label"),
      ),
    ),
  ).toEqual(["변경 사항", "PR", "결과물", "소스"]);
  await expect(card.getByRole("region", { name: "결과물", exact: true })).toHaveText("결과물파일 또는 문서 만들기");
  await expect(card.getByRole("button", { name: /추가|붙이기/ })).toHaveCount(0);

  // 소스 — spec 문서(트리 차례 — 파일이 폴더 앞)가 먼저, Project가 뒤다. Project는 worktree가 선 것(고치는 중)이 먼저, 그 뒤가 읽는 범위의
  // 것(읽기만)이다(03 §7). 다섯이라 셋만 서고 「모두 보기」가 나머지를 그 자리에 편다(S21).
  const sources = card.getByRole("region", { name: "소스", exact: true });
  await expect(sources.locator("[data-doc]")).toHaveText(["overview.md", "notes.md", "01-fix/plan.md"]);
  await expect(sources.locator("[data-project]").first()).toBeHidden();
  await sources.getByRole("button", { name: "모두 보기", exact: true }).click();
  await expect(sources.getByRole("button", { name: "모두 보기", exact: true })).toHaveCount(0);
  await expect(sources.locator("[data-project]")).toHaveText([
    new RegExp(`^${OPENED.project}\\s*고치는 중$`),
    /^web-app\s*읽기만$/,
  ]);
  for (const row of await sources.locator("[data-project]").all()) await expect(row).toBeVisible();

  // 열 비켜나기(02 §7 · `Beside`) — 카드가 열린 동안 입력창(열 737)은 판 왼쪽 안쪽(16)과 카드 왼쪽 16 앞 사이의 가운데에 서고, 닫으면
  // 판 가운데로 돌아온다. 열은 줄지 않는다. 옮겨 가는 동안(패널 박자)은 되풀이해 읽는다.
  const 가운데 = (box: Box) => box.x + box.width / 2;
  const main = await 상자(흐름(page));
  const cardBox = await 상자(card);
  // 카드는 판(본문) 오른쪽 위에 위 · 오른쪽 8 띄워 300 폭으로 선다(Screen-Live `top: 8px; right: 8px`).
  expect([cardBox.y - main.y, main.right - cardBox.right, cardBox.width]).toEqual([8, 8, 300]);
  await expect.poll(async () => Math.round(가운데(await 상자(입력창(page))))).toBe(Math.round((main.x + 16 + cardBox.x - 16) / 2));
  expect((await 상자(입력창(page))).width).toBe(737);
  await 요약토글(page).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => Math.round(가운데(await 상자(입력창(page))))).toBe(Math.round(가운데(main)));
  await 요약토글(page).click();
  await expect.poll(async () => Math.round(가운데(await 상자(입력창(page))))).toBe(Math.round((main.x + 16 + cardBox.x - 16) / 2));

  // 「변경 사항」을 누르면 카드가 넓어져 바뀐 첫 파일의 diff를 연다 — 목록에는 그 파일 줄이 고른 줄로 선다. 「카드로 접기」가 작은 카드로
  // 돌린다(넓힌 카드 자체는 `thread-work-card`가 잰다).
  await card.locator("[data-changes]").click();
  await expect(page.locator("section[data-expanded]")).toBeVisible();
  await expect(page.locator('[data-viewer="change"]')).toBeVisible();
  await expect(card.locator(`[data-change="${CHANGED}"]`)).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "카드로 접기", exact: true }).click();
  await expect(page.locator("section[data-expanded]")).toHaveCount(0);
  await expect(card).toBeVisible();

  // 좁은 창(1000) — 판이 열(737)보다 좁으면 열은 판 안쪽(좌우 16)을 다 쓰고, 카드를 비켜나지 않고 카드가 열의 끝을 덮는다 — 카드 때문에
  // 열이 줄지 않는다. 넓힌 카드가 접어 둔 사이드바가 막 다시 열리는 중이라 판의 자리도 함께 되풀이해 읽는다.
  await page.setViewportSize({ width: 1000, height: 900 });
  const 열의안쪽 = async () => {
    const [column, board] = [await 상자(입력창(page)), await 상자(흐름(page))];
    return [Math.round(column.x - board.x), Math.round(board.right - column.right)];
  };
  await expect.poll(열의안쪽).toEqual([16, 16]);
  expect((await 상자(card)).x).toBeLessThan((await 상자(입력창(page))).right);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 답만 한 턴과 도구를 쓴 턴(`thread-two-turns`) — 다시 켠 뒤라 둘 다 접혀 있다. */
const twoTurns = record("thread-two-turns");
/**
 * Work 없는 Thread 둘 — 첫째는 Space가 없어 등록된 Project 둘을 모두 읽고(fixture 기본 범위 `SCOPE_ALL`), 둘째는 Project가 없는 Space
 * 「정산」에 이어져 읽는 Project가 없다(03 §7 — 빈 Space).
 */
const looseA: ThreadView = { ...FIXTURE_THREAD, id: "20261010-100000", title: "첫째 Thread", lastSeq: twoTurns[twoTurns.length - 1].seq };
const EMPTY_SPACE: Space = { slug: "정산", name: "정산", projects: [], createdAt: "2026-10-25", createdBy: null, description: "", problems: [] };
const looseB: ThreadView = { ...looseA, id: "20261011-090000", title: "둘째 Thread", space: EMPTY_SPACE.slug };
const EMPTY_SCOPE: ReadingScope = {
  space: { slug: EMPTY_SPACE.slug, name: EMPTY_SPACE.name, troubled: false },
  projects: [],
  worked: [],
  kind: "emptySpace",
  registered: PROJECTS.length,
};

test("요약 카드 — 첫 화면에는 없고, Work 없는 Thread에는 결과물 · 소스(읽는 범위의 Project, 「읽기만」)만 서며, 열림은 Thread마다 기억한다(다시 켜도)", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(looseA), summaryOf(looseB)],
    thread_get: answerByArg("thread", { [looseA.id]: looseA, [looseB.id]: looseB }),
    thread_read_record: answerByArg("thread", { [looseA.id]: twoTurns, [looseB.id]: twoTurns }),
    thread_mark_read: answerByArg("thread", {
      [looseA.id]: { ...summaryOf(looseA), lastRead: looseA.lastSeq },
      [looseB.id]: { ...summaryOf(looseB), lastRead: looseB.lastSeq },
    }),
    list_spaces: [...SPACES, EMPTY_SPACE],
    reading_scope: answerByArg("thread", { [looseB.id]: EMPTY_SCOPE }),
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });

  // 첫 말 전의 새 Thread — 카드도 토글도 「…」도 없다(S23).
  await expect(카드(page)).toHaveCount(0);
  await expect(요약토글(page)).toHaveCount(0);
  await expect(Thread메뉴(page)).toHaveCount(0);

  // Work 없는 Thread — 머리 · 변경 사항 없이 결과물 · 소스만이다. 소스는 읽는 범위의 Project(Space가 없으면 등록된 전부 — 03 §7)이고 보이기만
  // 한다(S20).
  await 사이드바Thread(page, looseA.title).click();
  await expect(page).toHaveURL(`/threads/${looseA.id}`);
  const card = 카드(page);
  await expect(card).toBeVisible();
  await expect(요약토글(page)).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator("[data-changes]")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Work 메뉴", exact: true })).toHaveCount(0);
  expect(await card.evaluate((el) => [...el.querySelectorAll("section[aria-label]")].map((one) => one.getAttribute("aria-label")))).toEqual(
    ["결과물", "소스"],
  );
  await expect(card.locator("[data-project]")).toHaveText([/^billing\s*읽기만$/, /^ledger\s*읽기만$/]);
  await expect(card.getByRole("button")).toHaveCount(0);

  // 열림은 Thread마다다(S22) — 첫째에서 닫고 둘째로 가면 둘째는 열려 있고, 첫째로 돌아오면 닫혀 있다.
  await 요약토글(page).click();
  await expect(card).toHaveCount(0);
  await 사이드바Thread(page, looseB.title).click();
  await expect(page).toHaveURL(`/threads/${looseB.id}`);
  await expect(card).toBeVisible();
  // 둘째는 빈 Space로 읽어 읽는 Project가 없다 — 소스 칸 없이 결과물만 선다.
  await expect(card.getByRole("region", { name: "소스", exact: true })).toHaveCount(0);
  await 사이드바Thread(page, looseA.title).click();
  await expect(page).toHaveURL(`/threads/${looseA.id}`);
  await expect(요약토글(page)).toHaveAttribute("aria-pressed", "false");
  await expect(card).toHaveCount(0);

  // 다시 켜도 그대로다 — 이 컴퓨터에 적어 두었다.
  await page.reload();
  await expect(흐름(page).getByText("hello from turn", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(요약토글(page)).toHaveAttribute("aria-pressed", "false");
  await expect(card).toHaveCount(0);
  await 사이드바Thread(page, looseB.title).click();
  await expect(card).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("승인 카드 — Work에 이은 Thread에서는 늘 허용이 「이 Work에서 편집은 늘 허용」이고, 고르면 다시 묻지 않기로 적어 답한다. 카드는 입력창 자리의 한 겉이다", async ({
  page,
}) => {
  // Work를 만든 뒤 Host가 spec 폴더에 첫 문서를 쓰려고 묻기 바로 앞이다.
  const ASKED = made.find((line) => line.kind === "permission" && line.seq > seqOf(made, "work") && (line.payload as { state: string }).state === "asked")!;
  const view: ThreadView = { ...linkedView, live: true, lastSeq: ASKED.seq - 1 };
  await openThread(page, view, linesThrough(made, view.lastSeq), { list_works: [...WORKS, workView(MADE)] });
  const 열폭 = (await 상자(입력창(page))).width;

  await streamLines(page, view.id, [ASKED]);
  const card = page.getByRole("group", { name: "Host가 이 파일을 고쳐도 될까요?", exact: true });
  await expect(card).toBeVisible();
  // 늘 허용을 둘 자리는 이은 Work다(S18) — 단추 글이 그 자리를 말한다. 고르면 그 허락을 Atelier가 적어 두고(`remember`) 이번 요청에는
  // 「이번만」으로 답한다(`cardChoices` — Claude의 Session 허락으로 넘기지 않는다).
  await expect(card.getByRole("button")).toHaveText([/^아니요, 다르게/, "이 Work에서 편집은 늘 허용", /^이번만 허용/]);
  // 입력창 자리 카드의 한 겉(02 §10 · 스토리 68) — 1px 테두리 · 그림자 없음 · 폭이 입력창(열 737)과 같다.
  expect((await 상자(card)).width).toBe(열폭);
  expect(await 모양(card, ["border-top-width", "box-shadow"])).toEqual({ "border-top-width": "1px", "box-shadow": "none" });

  await page.waitForTimeout(ARMING_MS);
  await card.getByRole("button", { name: "이 Work에서 편집은 늘 허용", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_answer_permission", "thread")).map(({ args }) => args))
    .toEqual([
      {
        thread: view.id,
        who: "host",
        request: (ASKED.payload as { requestId: string }).requestId,
        option: "allow_once",
        remember: true,
        words: null,
      },
    ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const TWO_SECOND_SENT = seqOf(twoTurns, "sent", 2);
/** 둘째 턴이 도는 Thread — 이 앱에 Host의 Session이 떠 있고 기록은 둘째 턴의 첫 도구까지다. */
const runningView: ThreadView = {
  ...FIXTURE_THREAD,
  live: true,
  lastSeq: twoTurns.find(
    (line) =>
      line.seq > TWO_SECOND_SENT && (line.payload as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === "tool_call",
  )!.seq,
};

test("작업 중에는 입력창 위 가운데에 작업 중 점이 서고, 그사이 보낸 말은 대기 줄로 쌓여 「지금 보내기」가 그 말을 하던 일에 끼워 넣는다", async ({
  page,
}) => {
  await openThread(page, runningView, linesThrough(twoTurns, runningView.lastSeq));

  // 작업 중 점(02 §10 · 스토리 71) — 「맨 아래로」 자리의 32 원 안에 점 셋이 서고, 그 원은 입력창 위 가운데다.
  const dots = 흐름(page).getByRole("img", { name: "작업 중", exact: true });
  await expect(dots).toBeVisible();
  const [dotsBox, composerBox] = [await 상자(dots), await 상자(입력창(page))];
  expect([dotsBox.width, dotsBox.height]).toEqual([32, 32]);
  expect(dotsBox.x + dotsBox.width / 2).toBeCloseTo(composerBox.x + composerBox.width / 2, 0);
  expect(dotsBox.bottom).toBeLessThan(composerBox.y);

  // 도는 동안 보낸 말 — 엔진이 그 Session의 대기 줄에 쌓고 대기 줄 이벤트를 낸다. 입력창 위에 「대기」 줄이 서고 끝에 「지금 보내기」다.
  const later = "다 되면 표로 정리해 줘";
  await 입력칸(page).fill(later);
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "thread_send", "text")).map(({ args }) => args)).toEqual([
    { thread: runningView.id, text: later, attachments: [], quote: null },
  ]);
  const queued: ThreadQueueEvent = { thread: runningView.id, who: "host", queue: [{ id: "queued-1", text: later, sendNow: false }] };
  await fireEvent(page, THREAD_QUEUE_EVENT, queued);
  const row = page.getByRole("list", { name: "기다리는 말", exact: true }).getByRole("listitem");
  await expect(row).toHaveText([new RegExp(`^대기${later}지금 보내기$`)]);

  // 「지금 보내기」 — 그 대기 id로 간다. 엔진이 하던 턴을 멈추는 동안 그 줄은 「멈추고 보내는 중」이고 「지금 보내기」가 걷힌다.
  await row.getByRole("button", { name: "지금 보내기", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_send_now", "thread")).map(({ args }) => args))
    .toEqual([{ thread: runningView.id, queued: "queued-1" }]);
  await fireEvent(page, THREAD_QUEUE_EVENT, { ...queued, queue: [{ ...queued.queue[0], sendNow: true }] });
  await expect(row).toHaveText([new RegExp(`^대기멈추고 보내는 중 · ${later}$`)]);
  await expect(row.getByRole("button", { name: "지금 보내기", exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("첫 말을 보낸 뒤 Thread 화면이 서기 전에 「새 Thread」로 돌아오면, 첫 화면은 「시작하는 중」에 멈추지 않고 빈 채로 다시 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_get: answerByArg("thread", { [FIXTURE_THREAD.id]: { ...FIXTURE_THREAD, live: true, lastSeq: seqOf(twoTurns, "sent") } }),
    thread_read_record: answerByArg("thread", { [FIXTURE_THREAD.id]: linesThrough(twoTurns, seqOf(twoTurns, "sent")) }),
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });
  // Thread 화면은 라우트 청크로 나눠 받는다(`autoCodeSplitting`) — 첫 화면이 선 뒤에 오는 그 라우트 파일 요청(화면 청크)을 붙잡아 「주소는
  // 새 Thread인데 화면은 아직 첫 화면」인 틈을 연다(진짜 앱에서는 처음 여는 Thread의 청크를 읽는 동안이다). 앱이 그 틈에 같은 첫 화면을
  // 그대로 두면 보낸 말과 「시작하는 중」에 멈췄다(02 티켓 13b가 찾아 고침).
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const caught: string[] = [];
  await page.route(/\/src\/routes\/threads\.\$id\.tsx/, async (route) => {
    caught.push(route.request().url());
    await held;
    await route.continue();
  });

  const [first] = sentPayloads(twoTurns);
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${FIXTURE_THREAD.id}`);
  await expect.poll(() => caught.length).toBeGreaterThan(0);
  await page.locator("aside[data-sidebar]").getByRole("button", { name: "새 Thread", exact: true }).click();

  // 빈 첫 화면 — 물음 · 비운 입력창 · 트레이의 Work 칩(처음 고른 곳 — 기억이 없으면 「새 Work」, 03 §5 S2)이 서고, 보낸 말과 「생각 중」은
  // 없다.
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible();
  await expect(입력칸(page)).toHaveAttribute("placeholder", "만들 기능이나 고칠 문제를 적어 주세요");
  await expect(입력칸(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "어디서 일할지 새 Work", exact: true })).toBeVisible();
  await expect(흐름(page).getByText(first.text, { exact: true })).toHaveCount(0);
  await expect(흐름(page).getByText("생각 중", { exact: true })).toHaveCount(0);
  release();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
