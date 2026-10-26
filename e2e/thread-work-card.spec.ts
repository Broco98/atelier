import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_COMMANDS, FIXTURE_THREAD, WORKS, worktreeFile, worktreeFolder } from "./fixtures";
import { callCount, fireEvent, fireEventToAll, installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls } from "./harness";
import { atHome, lineOf, record, sentPayloads, specWrites, summaryOf, titleThrough, workView } from "./thread-records";
import { WORK_WRITING_EVENT } from "@/features/thread/events";
import type { ThreadView, WorkWritingEvent } from "@/features/thread/types";
import type { FileDiff, ProjectChanges } from "@/features/works/types";
import type { Settings } from "@/features/settings/types";

// v1 티켓 40(PR ④ e2e) 흐름 하나 — **요약 카드의 줄이나 대화 속 문서 카드를 누르면 카드가 넓어져 문서 · diff · 트리를 보고, 대화는 왼쪽
// 480에 남는다**(v1 티켓 34 · 35 · 43 · 구현 스펙 §15 배치 1 · S41 · 스토리 102 · 115–118). 문서는 쓰는 중 · 바뀐 줄 칠함 · 인용으로
// 보내기까지, diff는 숨긴 줄 펼치기까지, 트리는 바뀐 파일이 그 diff를 여는 데까지 간다. 요약 카드(02 구현 스펙 §7 · 티켓 07)는 v1 Work
// 카드를 바꿨다 — 작은 카드의 변경은 「변경 사항」 한 줄이고, 파일마다의 줄은 넓힌 카드의 목록에만 선다. 넓힌 카드는 그대로다.
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

// 작은 카드가 열린 동안 대화 열이 카드를 비켜날 자리가 있는 창(시안 1440) — 좁은 창에서는 열이 판 왼쪽에서 멈추고 카드가 덮는다(그 갈래는
// 흐름 「Thread 화면」이 잰다).
test.use({ viewport: { width: 1440, height: 900 } });

const 흐름 = (page: Page) => page.getByRole("main");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 요약 카드 — 작은 카드든 넓힌 카드든 영역 이름이 같다(Work 이름은 머리 글자가 말한다). */
const 카드 = (page: Page) => page.getByRole("region", { name: "요약", exact: true });
const 넓힌카드 = (page: Page) => page.locator("section[data-expanded]");
const 보기 = (page: Page, kind: "doc" | "change" | "project") => page.locator(`[data-viewer="${kind}"]`);

/**
 * 입력창 둘레 카드의 오른쪽 끝에서 요약 카드 왼쪽 끝까지 — 작은 카드가 열린 동안 대화 열 · 입력창이 카드 왼쪽 16 앞에서 멈추는지(02 §7 ·
 * `Beside`) 잰다. 대화 칸의 폭은 그대로이고 열만 옮겨 가므로 열(입력창)을 잰다. 열은 패널 박자로 옮겨 가므로 되풀이해 읽는다.
 */
const 카드앞틈 = async (page: Page) => {
  const composer = await 입력칸(page).locator("xpath=ancestor::form[1]").evaluate((el) => el.getBoundingClientRect().right);
  const card = await 카드(page).evaluate((el) => el.getBoundingClientRect().left);
  return Math.round(card - composer);
};
/** 대화 칸의 오른쪽 끝 — 본문의 왼쪽 끝에서 잰다(넓힌 카드의 480). 폭은 패널 박자로 옮겨 가므로(v1 티켓 43) 되풀이해 읽는다. */
const 대화끝 = (page: Page) =>
  흐름(page).evaluate((main) => {
    const column = main.firstElementChild?.firstElementChild;
    if (!(column instanceof HTMLElement)) throw new Error("대화 칸이 없다");
    return Math.round(column.getBoundingClientRect().right - main.getBoundingClientRect().left);
  });

test("요약 카드의 줄 · 대화 속 문서 카드를 누르면 카드가 넓어져 문서 · diff · 트리를 보고, 대화는 왼쪽 480에 남으며, 「카드로 접기」가 작은 카드로 돌린다", async ({
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

  // 작은 카드 — 「변경 사항」 한 줄(Work의 바뀐 줄 합), 소스의 문서 · Project. 파일마다의 줄은 아직 없다. 대화 열 · 입력창은 카드 왼쪽
  // 16 앞에서 멈추도록 비켜 준다.
  await expect(카드(page).locator("[data-changes]")).toHaveText(/^변경 사항\s*\+18\s*−3$/);
  await expect(카드(page).locator("[data-change]")).toHaveCount(0);
  await expect(카드(page).locator("[data-doc]")).toHaveText([OVERVIEW, PLAN]);
  await expect(카드(page).locator(`[data-project="${PROJECT}"]`)).toHaveText(new RegExp(`^${PROJECT}\\s*고치는 중`));
  await expect.poll(() => 카드앞틈(page)).toBeGreaterThanOrEqual(16);

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

  // 넓힌 카드의 목록에는 「변경 사항」 아래 바뀐 파일마다 줄이 선다. 파일 줄 — 그 파일의 diff다. 숨긴 위 줄은 펴면 worktree의 지금
  // 파일을 읽어 잇는다.
  await expect(카드(page).locator("[data-change]")).toHaveText([/^service\.py\s*\+6\s*−3$/, /^test_refund\.py\s*\+12$/]);
  await 카드(page).locator(`[data-change="${SERVICE}"]`).click();
  await expect(카드(page).locator(`[data-change="${SERVICE}"]`)).toHaveAttribute("aria-current", "true");
  const diff = 보기(page, "change").locator("[data-code-view]");
  await expect(diff.getByText('raise RefundError("환불할 수 없는 금액이에요")')).toBeVisible();
  await expect(보기(page, "change")).toContainText("+6");
  expect(await callCount(page, "read_worktree_file")).toBe(0);
  // 숨긴 줄의 글은 한국어다(「변경 없는 9줄」 — v1 티켓 46). 라이브러리가 영어로 그린 뒤 갈아 끼우므로 `getByText`의 기다림이 그 틈을 덮는다.
  await diff.getByText(/변경 없는 9줄/).first().click();
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
  await expect.poll(() => 카드앞틈(page)).toBeGreaterThanOrEqual(16);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
