import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_COMMANDS, FIXTURE_THREAD, WORKS, worktreeFile, worktreeFolder } from "./fixtures";
import { callCount, fireEvent, fireEventToAll, installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls } from "./harness";
import { atHome, lineOf, record, sentPayloads, specWrites, summaryOf, titleThrough, workView } from "./thread-records";
import { WORK_WRITING_EVENT } from "@/features/thread/events";
import type { ThreadView, WorkWritingEvent } from "@/features/thread/types";
import type { FileDiff, ProjectChanges } from "@/features/works/types";
import type { Settings } from "@/features/settings/types";

// v1 티켓 40(PR ④ e2e) 흐름 하나 — **Work 카드의 줄이나 대화 속 문서 카드를 누르면 카드가 넓어져 문서 · diff · 트리를 보고, 대화는 왼쪽
// 480에 남는다**(v1 티켓 34 · 35 · 43 · 구현 스펙 §15 배치 1 · S41 · 스토리 102 · 115–118). 문서는 쓰는 중 · 바뀐 줄 칠함 · 인용으로
// 보내기까지, diff는 숨긴 줄 펼치기까지, 트리는 바뀐 파일이 그 diff를 여는 데까지 간다.
//
// Thread는 L1이 축복한 진짜 claude 2.1.309의 Work 만들기 턴(`thread-work`, v1 티켓 39)이 끝난 자리다 — 그 턴이 spec 폴더에 쓴 문서 둘의
// 글이 문서 보기의 글이다. worktree의 변경 · diff · 트리는 코어의 답(`list_work_changes` · `read_work_diff` · `list_worktree_tree`)을 손으로
// 적는다(이 층에는 git이 없다 — 그 규칙은 L1 `worktree.rs` · `work_changes.rs`가 잰다).

const lines = atHome(record("thread-work"));
const CREATED = lineOf(lines, "work", "created");
const MADE = CREATED.payload as { slug: string; title: string; branch: string; projects: string[] };
const [PROJECT] = MADE.projects;
const LAST = lines[lines.length - 1].seq;
const view: ThreadView = { ...FIXTURE_THREAD, title: titleThrough(lines, LAST), work: MADE.slug, lastSeq: LAST };

/** 턴이 spec 폴더에 새로 쓴 문서 — spec 기준 경로 → 글. */
const WRITTEN = specWrites(lines, MADE.slug);
const [OVERVIEW, PLAN] = Object.keys(WRITTEN);

// worktree의 바뀐 파일 하나 — 부분 환불 금액을 보게 고친 서비스. diff는 10행부터의 한 덩이라 위 9행이 숨긴 줄이다.
const SERVICE = "refund/service.py";
const SERVICE_NOW = [
  '"""환불 서비스 — 주문의 남은 금액 안에서 돌려준다."""',
  "",
  "class RefundError(Exception):",
  "    pass",
  "",
  "",
  "def remaining(order):",
  '    return order["paid"] - order["refunded"]',
  "",
  "",
  "def refund(order, amount=None):",
  "    left = remaining(order)",
  "    if amount is None:",
  "        amount = left",
  "    if not 0 < amount <= left:",
  '        raise RefundError("환불할 수 없는 금액이에요")',
  '    order["refunded"] += amount',
  '    return {"order": order["id"], "refunded": amount}',
  "",
].join("\n");
const SERVICE_PATCH = [
  `diff --git a/${SERVICE} b/${SERVICE}`,
  "index 1a2b3c4..5d6e7f8 100644",
  `--- a/${SERVICE}`,
  `+++ b/${SERVICE}`,
  "@@ -10,6 +10,9 @@",
  " ",
  " def refund(order, amount=None):",
  "     left = remaining(order)",
  "-    refunded = left",
  '-    order["refunded"] += refunded',
  '-    return {"order": order["id"], "refunded": refunded}',
  "+    if amount is None:",
  "+        amount = left",
  "+    if not 0 < amount <= left:",
  '+        raise RefundError("환불할 수 없는 금액이에요")',
  '+    order["refunded"] += amount',
  '+    return {"order": order["id"], "refunded": amount}',
  "",
].join("\n");
const TEST = "tests/test_refund.py";
const CHANGES: ProjectChanges[] = [
  {
    project: PROJECT,
    kind: "listed",
    base: "main",
    files: [
      { path: SERVICE, additions: 6, deletions: 3 },
      { path: TEST, additions: 12, deletions: null },
    ],
  },
];

const 흐름 = (page: Page) => page.getByRole("main");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 카드 = (page: Page) => page.getByRole("region", { name: `Work 카드: ${MADE.title}`, exact: true });
const 넓힌카드 = (page: Page) => page.locator("section[data-expanded]");
const 보기 = (page: Page, kind: "doc" | "change" | "project") => page.locator(`[data-viewer="${kind}"]`);

/** 대화 칸의 오른쪽 끝 — 본문의 왼쪽 끝에서 잰다. 폭은 패널 박자로 옮겨 가므로(v1 티켓 43) 되풀이해 읽는다. */
const 대화끝 = (page: Page) =>
  흐름(page).evaluate((main) => {
    const column = main.firstElementChild?.firstElementChild;
    if (!(column instanceof HTMLElement)) throw new Error("대화 칸이 없다");
    return Math.round(column.getBoundingClientRect().right - main.getBoundingClientRect().left);
  });
const 너비 = (target: Locator) => target.evaluate((el) => Math.round(el.getBoundingClientRect().width));

test("Work 카드의 줄 · 대화 속 문서 카드를 누르면 카드가 넓어져 문서 · diff · 트리를 보고, 대화는 왼쪽 480에 남으며, 「카드로 접기」가 작은 카드로 돌린다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    // 「결정은 내가 합니다」는 이은 뒤 처음 한 번이다(흐름 「Work 만들기」가 잰다) — 이미 봤다.
    read_settings: { ...(FIXTURE_COMMANDS.read_settings as Settings), seen: { decisions: true } } satisfies Settings,
    list_works: [...WORKS, workView(MADE, { docs: Object.keys(WRITTEN), trees: [PROJECT] })],
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: LAST } }),
    read_spec_file: answerByArg("path", WRITTEN),
    list_work_changes: CHANGES,
    read_work_diff: answerByArg("path", { [SERVICE]: { kind: "patch", patch: SERVICE_PATCH } satisfies FileDiff }),
    read_worktree_file: answerByArg("path", { [SERVICE]: { kind: "text", content: SERVICE_NOW, lines: 19 } }),
    list_worktree_tree: answerByArg("project", {
      [PROJECT]: {
        kind: "listed",
        entries: [
          worktreeFolder("refund", [worktreeFile(SERVICE)]),
          worktreeFolder("tests", [worktreeFile(TEST)]),
          worktreeFile("README.md"),
        ],
      },
    }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(sentPayloads(lines)[0].text, { exact: true })).toBeVisible({ timeout: 20_000 });
  const 사이드바 = page.locator("aside[data-sidebar]");
  await expect(사이드바).toBeVisible();
  await expect(입력칸(page)).toBeVisible();

  // 작은 카드 — 문서 · 변경 · Project 칸. 대화는 카드 폭만큼 비켜 준다.
  await expect(카드(page).locator("[data-doc]")).toHaveText([OVERVIEW, PLAN]);
  await expect(카드(page).locator("[data-change]")).toHaveText([/^service\.py\s*\+6\s*−3$/, /^test_refund\.py\s*\+12$/]);
  await expect(카드(page).locator(`[data-project="${PROJECT}"]`)).toHaveText(new RegExp(`^${PROJECT}\\s*고치는 중`));
  const 본문폭 = await 너비(흐름(page));
  const 카드폭 = await 너비(카드(page));
  await expect.poll(() => 대화끝(page)).toBeLessThanOrEqual(본문폭 - 카드폭);

  // 대화 속 문서 카드 — 카드가 넓어져 그 문서를 연다. 대화는 왼쪽 480에 남고, 열려 있던 사이드바가 접힌다.
  await 흐름(page).locator(`[data-doc-card="${OVERVIEW}"]`).click();
  await expect(넓힌카드(page)).toBeVisible();
  await expect(카드(page).locator(`[data-doc="${OVERVIEW}"]`)).toHaveAttribute("aria-current", "true");
  await expect(보기(page, "doc").getByRole("heading", { level: 1 })).toHaveText(WRITTEN[OVERVIEW].split("\n")[0].replace(/^# /, ""));
  await expect(보기(page, "doc").getByRole("navigation", { name: "위치", exact: true })).toContainText(OVERVIEW);
  await expect.poll(() => 대화끝(page)).toBe(480);
  await expect(사이드바).toBeHidden();

  // Host가 그 문서를 쓰는 중이다 — 보기의 머리와 카드의 줄에 「Host가 쓰는 중」이 선다. 다시 읽은 글은 바뀐 블록만 칠한다.
  const writing: WorkWritingEvent = {
    work: MADE.slug,
    writing: [{ path: OVERVIEW, who: "host", name: "Host", thread: view.id }],
  };
  await fireEvent(page, WORK_WRITING_EVENT, writing);
  await expect(보기(page, "doc").locator('[data-writer="host"]')).toHaveText("Host가 쓰는 중");
  await expect(카드(page).locator(`[data-doc="${OVERVIEW}"]`)).toContainText("Host가 쓰는 중");
  const rewritten = `${WRITTEN[OVERVIEW]}\n## 정한 것\n\n거절한다.\n`;
  await replaceAnswer(page, "read_spec_file", answerByArg("path", { ...WRITTEN, [OVERVIEW]: rewritten }));
  await fireEventToAll(page, "works:changed", null);
  await expect(보기(page, "doc").getByRole("heading", { name: "정한 것", exact: true })).toBeVisible();
  await expect(보기(page, "doc").locator("[data-doc-flash]").first()).toBeVisible();
  await fireEvent(page, WORK_WRITING_EVENT, { ...writing, writing: [] });
  await expect(보기(page, "doc").locator("[data-writer]")).toHaveCount(0);

  // 글을 골라 그 자리를 두고 말한다 — 입력창에 인용이 붙고, 보내면 인용이 말과 함께 간다(S41).
  const 문단 = 보기(page, "doc").locator("[data-src-start]").filter({ has: page.locator("p") }).first();
  const 고른글 = 문단.locator("p");
  await 고른글.selectText();
  await 보기(page, "doc").getByRole("button", { name: /이 자리를 두고 말하기$/ }).click();
  await expect(page.locator("[data-quote]")).toBeVisible();
  await 입력칸(page).fill("이 자리부터 고쳐 줘");
  await 입력칸(page).press("Enter");
  const [start, end] = [Number(await 문단.getAttribute("data-src-start")), Number(await 문단.getAttribute("data-src-end"))];
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_send", "text")).map(({ args }) => args))
    .toEqual([
      {
        thread: view.id,
        text: "이 자리부터 고쳐 줘",
        attachments: [],
        quote: { file: OVERVIEW, start, end, text: await 고른글.innerText() },
      },
    ]);

  // 변경 줄 — 그 파일의 diff다. 숨긴 위 줄은 펴면 worktree의 지금 파일을 읽어 잇는다.
  await 카드(page).locator(`[data-change="${SERVICE}"]`).click();
  await expect(카드(page).locator(`[data-change="${SERVICE}"]`)).toHaveAttribute("aria-current", "true");
  const diff = 보기(page, "change").locator("[data-code-view]");
  await expect(diff.getByText('raise RefundError("환불할 수 없는 금액이에요")')).toBeVisible();
  await expect(보기(page, "change")).toContainText("+6");
  expect(await callCount(page, "read_worktree_file")).toBe(0);
  await diff.getByText(/9 unmodified lines/).first().click();
  await expect(diff.getByText("환불 서비스 — 주문의 남은 금액 안에서 돌려준다.", { exact: false })).toBeVisible();
  expect((await ipcCallArgs(page, "read_worktree_file", "path")).map(({ args }) => args.path)).toEqual([SERVICE]);

  // Project 줄 — 그 worktree의 트리다. 바뀐 파일을 누르면 그 diff가 열린다.
  await 카드(page).locator(`[data-project="${PROJECT}"]`).click();
  await expect(보기(page, "project")).toContainText(`${PROJECT} · worktree ${MADE.branch}`);
  await 보기(page, "project").getByRole("button", { name: "refund", exact: true }).click();
  await 보기(page, "project").getByRole("button", { name: /service\.py$/ }).click();
  await expect(보기(page, "change")).toBeVisible();
  await expect(카드(page).locator(`[data-change="${SERVICE}"]`)).toHaveAttribute("aria-current", "true");

  // 「카드로 접기」 — 작은 카드로 돌아오고, 대화 폭과 사이드바가 되돌아온다.
  await 보기(page, "change").getByRole("button", { name: "카드로 접기", exact: true }).click();
  await expect(넓힌카드(page)).toHaveCount(0);
  await expect(카드(page)).toBeVisible();
  await expect(사이드바).toBeVisible();
  await expect.poll(() => 대화끝(page)).toBeLessThanOrEqual(본문폭 - 카드폭);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
