import { expect, test, type Locator, type Page } from "./evidence";
import { codeCard, readCodeView } from "./code-view";
import { answerByArg, WORKS, worktreeFile, WORKTREE_FILES, WORKTREE_TREES } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  callsSinceRelease,
  exitShell,
  fireAttention,
  fireEventToAll,
  fireWindowEvent,
  heldCalls,
  holdCommand,
  installFixtureBackend,
  ipcCallArgs,
  markAttention,
  openShell,
  releaseCommand,
  replaceAnswer,
  steadyCount,
  unknownIpcCalls,
  파일탭주소 as codeUrl,
  주소로간다,
} from "./harness";
import type { WorktreeFile } from "@/features/code/types";
import type { WorktreeTree } from "@/features/files/types";

// git-integration 판 01 티켓 10(#483) — **에이전트가 고치면 트리와 탭이 따라온다.**
//
// 감시자가 워크트리 안의 걸리지 않은 변경마다 `worktree:changed { slug, project }`를 쏜다(그 판정은 L1 `worktree_watch.rs`가
// 진짜 저장소로 잰다). 앱 루트가 그것을 한 곳에서 듣고 그 워크트리의 데이터를 낡았다고 표시한다 — 다시 읽는 것은 **보이는
// 것뿐이다**(S9): 트리는 files 칸이 보일 때, 내용은 그 파일 탭이 본문이나 묶음 열에 서 있을 때. 숨은 것은 보이는 순간 읽힌다.
//
// 이 층에는 감시자가 없다 — 목업의 답을 갈고(`replaceAnswer`) 그 이벤트를 살아 있는 모든 구독에 쏘는 것(`fireEventToAll`)이
// 「에이전트가 고쳤다」의 흉내다.

const [pinnedWork, plainWork, multiWork] = WORKS;
const EVENT = "worktree:changed";
const TREE = "list_worktree_tree";
/** 걸린 폴더의 한 겹(티켓 02). */
const FOLDER = "list_worktree_folder";
const READ = "read_worktree_file";

const 레일칸 = (page: Page, name: "spec" | "files" | "info") =>
  page.getByRole("group", { name: "레일", exact: true }).getByRole("button", { name, exact: true });
const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });
/** 트리의 행 — 파일 행은 확장자 꼬리표가 앞에 붙는다(`MD README.md`). */
const 패널행 = (page: Page, name: string) => 작업패널(page).getByRole("button", { name, exact: true });

/** `billing` 트리 끝에 파일 하나가 더 선 답 — 에이전트가 만든 파일이다. */
function billingWith(path: string) {
  const billing = WORKTREE_TREES.billing as Extract<WorktreeTree, { kind: "listed" }>;
  return answerByArg("project", {
    ...WORKTREE_TREES,
    billing: { ...billing, entries: [...billing.entries, worktreeFile(path)] },
  });
}

/** 화면이 지금까지 받은 것을 다 그린 뒤에 돌아온다 — 「더 없다」를 재기 전에 부른다(`works-changed.spec.ts`와 같다). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * 창으로 돌아온다. 최소화 · 다른 Space에서 돌아오면 웹뷰는 `visibilitychange`와 window `focus`를 둘 다 쏜다 — react-query는
 * `visibilitychange`만 듣고(`focusManager`) 앱 루트는 `focus`만 듣는다. 워크트리 쿼리가 react-query의 길을 끄지 않으면(S33) 한 번
 * 돌아올 때 두 번 읽는데, `focus`만 쏘면 그것이 안 보인다.
 */
async function returnToWindow(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
  await fireWindowEvent(page, "focus");
}

/** 에이전트가 턴을 시작하는 훅 상태 — 그 셸이 「도는 중」이 된다. */
const turnStart = () => ({ agent: "claude", event: "UserPromptSubmit", at: Date.now() });

/** 에이전트가 턴을 마치는 훅 상태 — 「도는 중」이 끝난다. */
const turnStop = () => ({
  agent: "claude",
  event: "Stop",
  at: Date.now(),
  payload: { last_assistant_message: "다 했어요" },
  stopped: true,
});

async function openFiles(page: Page): Promise<void> {
  await 레일칸(page, "files").click();
  await expect(레일칸(page, "files")).toHaveAttribute("aria-pressed", "true");
  await expect(패널행(page, "src")).toBeVisible();
}

test("files 칸이 보일 때 그 워크트리의 `worktree:changed`가 오면 트리를 다시 묻고 에이전트가 만든 파일의 행이 선다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);
  const before = await steadyCount(page, TREE);
  await expect(패널행(page, "MD CHANGELOG.md")).toHaveCount(0);

  await replaceAnswer(page, TREE, billingWith("CHANGELOG.md"));
  await fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });

  await expect(패널행(page, "MD CHANGELOG.md")).toBeVisible();
  // 이벤트 한 번에 한 번이다 — 구독이 여럿이 되어 그 수만큼 다시 읽지 않는다
  expect((await steadyCount(page, TREE)) - before).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **신호가 몰려도 조회는 하나씩이다.** 에이전트가 이어 쓰면 신호가 디바운스(300ms)마다 온다 — 도는 조회를 버리고 새로 띄우면
// IPC는 못 끊어 git이 겹겹이 돌고, 트리를 읽는 데 그보다 오래 걸리는 워크트리에서는 답이 영영 서지 않는다. 도는 동안 온 신호는
// 끝난 뒤 한 번으로 합친다 — 그 조회는 쓰기 전을 읽었을 수 있다(`works-changed.spec.ts`의 같은 검사와 같은 꼴).
test("트리를 붙잡아 둔 채 신호를 세 번 쏘고 풀면, 붙잡힌 부름은 하나이고 놓은 뒤에 한 번 더 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);
  await steadyCount(page, TREE);

  await holdCommand(page, TREE);
  for (let n = 0; n < 3; n += 1) await fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });
  await expect.poll(() => heldCalls(page, TREE)).toBeGreaterThan(0);
  await settle(page);
  expect(await heldCalls(page, TREE)).toBe(1);

  await replaceAnswer(page, TREE, billingWith("CHANGELOG.md"));
  await releaseCommand(page, TREE);
  await expect(패널행(page, "MD CHANGELOG.md")).toBeVisible();
  await steadyCount(page, TREE);
  expect(await callsSinceRelease(page, TREE)).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("칸이 숨어 있는 동안 온 신호에는 묻지 않고, 칸이 보이는 순간 한 번 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);
  // spec 칸으로 옮긴다 — files 몸은 숨어도 마운트된 채다
  await 레일칸(page, "spec").click();
  await expect(레일칸(page, "spec")).toHaveAttribute("aria-pressed", "true");
  const hidden = await steadyCount(page, TREE);

  await replaceAnswer(page, TREE, billingWith("CHANGELOG.md"));
  await fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });
  await settle(page);
  expect(await steadyCount(page, TREE)).toBe(hidden);

  // 보이는 순간 한 번 읽어 새 행이 선다
  await 레일칸(page, "files").click();
  await expect(패널행(page, "MD CHANGELOG.md")).toBeVisible();
  expect((await steadyCount(page, TREE)) - hidden).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("다른 work의 워크트리 신호에는 묻지 않고, 프로젝트가 둘이면 그 프로젝트의 트리만 다시 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}`);
  await 레일칸(page, "files").click();
  await expect(작업패널(page).getByRole("heading")).toHaveText(["빌링", "원장"]);
  // 그 프로젝트의 트리를 몇 번 물었나 — 멎은 뒤에 센다
  const asked = async (project: string) => {
    await steadyCount(page, TREE);
    return (await ipcCallArgs(page, TREE, "project")).filter(({ args }) => args.project === project).length;
  };
  const billing = await asked("billing");
  const ledger = await asked("ledger");

  // 같은 프로젝트 이름이어도 다른 work의 워크트리다
  await fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });
  await fireEventToAll(page, EVENT, { slug: plainWork.slug, project: "ledger" });
  await settle(page);
  expect([await asked("billing"), await asked("ledger")]).toEqual([billing, ledger]);

  // 이 work의 원장만 바뀌었다
  await fireEventToAll(page, EVENT, { slug: multiWork.slug, project: "ledger" });
  await expect.poll(() => asked("ledger")).toBe(ledger + 1);
  expect(await asked("billing")).toBe(billing);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("창으로 돌아오기 · 이 work 셸의 「도는 중」 끝 · 칸을 다시 열기 · 새로고침이 각각 트리를 한 번 다시 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  // 셸이 저절로 뜨는 work이다 — 그 셸이 턴을 마친다
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openFiles(page);
  /** 신호 하나를 주고, 트리를 그 뒤로 몇 번 더 물었는지 멎은 값으로 센다. */
  const askedAfter = async (signal: () => Promise<void>) => {
    const before = await steadyCount(page, TREE);
    await signal();
    await expect.poll(() => callCount(page, TREE)).toBeGreaterThan(before);
    return (await steadyCount(page, TREE)) - before;
  };

  // 창으로 돌아왔다 — 감시가 못 보는 커밋(워크트리 밖 `.git/worktrees/…`)을 메운다. react-query의 `visibilitychange` 길은 꺼져
  // 있어 한 번이다(S33)
  expect(await askedAfter(() => returnToWindow(page)), "창으로 돌아오기").toBe(1);

  // 에이전트가 턴을 시작하는 것은 신호가 아니다 — 멎을 때다
  const started = await steadyCount(page, TREE);
  await markAttention(page, turnStart());
  await settle(page);
  expect(await steadyCount(page, TREE)).toBe(started);
  expect(await askedAfter(() => markAttention(page, turnStop())), "도는 중 끝").toBe(1);

  // 칸을 닫았다 다시 연다(켜진 칸을 다시 누르면 닫힌다)
  await 레일칸(page, "files").click();
  await expect(레일칸(page, "files")).toHaveAttribute("aria-pressed", "false");
  expect(await askedAfter(() => 레일칸(page, "files").click()), "칸 열기").toBe(1);

  const refresh = () => 작업패널(page).getByRole("button", { name: "새로고침", exact: true }).click();
  expect(await askedAfter(refresh), "새로고침").toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 「도는 중」 끝은 도는 중이던 셸이 죽을 때도 친다(구현 스펙 「화면 — 다시 읽기」). 죽는 길은 둘이다 — 깨끗이 끝나면(종료 코드 0,
// 사람이 Ctrl-D) 셸이 목록에서 빠지고, 아니면(claude가 죽었다) 「끝남」으로 남아 상태를 읽는 문(`attentionOn`)이 「없음」을 준다.
// 「사라진 셸은 건너뛴다」거나 상태를 그 문 없이 읽으면 그 턴은 트리를 다시 읽지 않는다.
test("「도는 중」이던 셸이 죽으면 — 깨끗이 끝나 빠지든 「끝남」으로 남든 — 트리를 한 번 다시 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openShell(page);
  await openFiles(page);
  /** 신호 하나를 주고, 트리를 그 뒤로 몇 번 더 물었는지 멎은 값으로 센다. */
  const askedAfter = async (signal: () => Promise<void>) => {
    const before = await steadyCount(page, TREE);
    await signal();
    await expect.poll(() => callCount(page, TREE)).toBeGreaterThan(before);
    return (await steadyCount(page, TREE)) - before;
  };

  // 두 칸 다 앉았다(`openShell`) — 착석을 칸 수로 기다리는 `markAttention`은 첫 칸에 쓰지 못한다
  await fireAttention(page, turnStart(), 1);
  await settle(page);
  expect(await askedAfter(() => exitShell(page, 1, 1)), "죽어 「끝남」으로 남은 셸").toBe(1);
  await fireAttention(page, turnStart(), 2);
  await settle(page);
  expect(await askedAfter(() => exitShell(page, 2, 0)), "깨끗이 끝나 빠진 셸").toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 37 — 걸린 폴더 안은 실시간 신호로 다시 읽지 않는다. 펼칠 때 · 창 포커스 · 새로고침에만 읽는다. 턴 끝은 실시간 신호와
// 같은 쪽이다 — 새로고침 버튼과 같은 문을 쓰면 턴마다 펼쳐 둔 `target/debug/deps`를 통째로 다시 읽는다.
test("펼쳐 둔 걸린 폴더의 한 겹은 `worktree:changed` · 「도는 중」 끝으로는 다시 묻지 않고, 창으로 돌아오기 · 새로고침에는 한 번씩 다시 묻는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // 셸이 저절로 뜨는 work이다 — 그 셸이 턴을 마친다
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openFiles(page);
  await 패널행(page, "dist").click();
  await expect(패널행(page, "JS app.js")).toBeVisible();
  const folders = await steadyCount(page, FOLDER);
  /** 신호 하나를 주고 트리를 다시 묻기를 기다린다 — 한 겹이 그대로인지는 그 뒤에 잰다. */
  const treeAskedAfter = async (signal: () => Promise<unknown>) => {
    const trees = await steadyCount(page, TREE);
    await signal();
    await expect.poll(() => callCount(page, TREE)).toBeGreaterThan(trees);
    await steadyCount(page, TREE);
  };

  // 감시는 걸리지 않은 곳만 본다 — 트리는 다시 읽어도 한 겹은 그대로다
  await treeAskedAfter(() => fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" }));
  expect(await steadyCount(page, FOLDER), "worktree:changed").toBe(folders);
  await markAttention(page, turnStart());
  await treeAskedAfter(() => markAttention(page, turnStop()));
  expect(await steadyCount(page, FOLDER), "도는 중 끝").toBe(folders);

  await returnToWindow(page);
  await expect.poll(() => callCount(page, FOLDER)).toBe(folders + 1);
  expect(await steadyCount(page, FOLDER), "창으로 돌아오기").toBe(folders + 1);
  await 작업패널(page).getByRole("button", { name: "새로고침", exact: true }).click();
  await expect.poll(() => callCount(page, FOLDER)).toBe(folders + 2);
  expect(await steadyCount(page, FOLDER)).toBe(folders + 2);
  // 다시 읽는 동안에도 행은 그대로다
  await expect(패널행(page, "JS app.js")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 코드 탭 ──
//
// 내용이 바뀌면 **같은 보기 인스턴스에 새 내용을 넣는다**(G6) — 다시 세우지 않으므로 읽던 스크롤 자리가 남는다(스토리 81).
// 강조된 코드는 워커가 칠하므로(티켓 08) 붐비는 기계에서 기본 30초를 넘길 수 있다.

const LONG = "src/long.ts";
/** 같은 꼴의 줄 `n`개 — `바꾼`이 있으면 그 줄 번호의 줄만 다르다. */
const 줄들 = (n: number, 바꾼?: { at: number; text: string }): WorktreeFile => ({
  kind: "text",
  content: Array.from({ length: n }, (_, i) =>
    바꾼 && i + 1 === 바꾼.at ? 바꾼.text : `const v${i} = "값"; // 줄 ${i + 1}`,
  ).join("\n"),
  lines: n,
});
const 답 = (file: WorktreeFile) =>
  answerByArg("path", { ...WORKTREE_FILES, [LONG]: file }, { otherwise: { kind: "missing" } satisfies WorktreeFile });

/**
 * 코드 카드 안에서 세로로 굴러가는 상자의 `scrollTop` — `to`를 주면 거기로 굴린 뒤 읽는다. 상자는 넘쳐서 실제로 굴러가는 첫
 * 상자다(강조된 코드의 가상화 틀).
 */
async function scrollTop(card: Locator, to?: number): Promise<number> {
  return card.evaluate((root, at) => {
    const box = [root, ...root.querySelectorAll("*")].find(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        /auto|scroll/.test(getComputedStyle(el).overflowY) &&
        el.scrollHeight > el.clientHeight + 1,
    );
    if (!box) throw new Error("굴러가는 상자가 없다");
    if (at !== undefined) {
      box.scrollTop = at;
      box.dispatchEvent(new Event("scroll"));
    }
    return box.scrollTop;
  }, to);
}

/** 그려진 줄의 글(앞뒤 공백을 뗀) — 가상화라 보이는 창 언저리만 그려진다. */
const 줄글 = async (card: Locator) => (await readCodeView(card)).lines.map((line) => line.text.trim());

test.describe("코드 탭", () => {
  test.describe.configure({ timeout: 90_000 });

  test("보이는 코드 탭은 그 워크트리의 신호에 다시 읽히고, 내려 둔 스크롤 자리가 지켜진다", async ({ page }) => {
    await installFixtureBackend(page, { read_worktree_file: 답(줄들(400)) });
    await page.goto(codeUrl(`billing/${LONG}`));
    const card = codeCard(page, `billing/${LONG}`);
    // 강조가 끝나기를 기다린다 — 줄이 토큰 여럿으로 갈리면 라이브러리의 보기가 칠한 것이다(평문 보기는 줄이 한 토큰이다)
    await expect
      .poll(async () => (await readCodeView(card)).lines[0]?.tokens.length ?? 0, { timeout: 60_000 })
      .toBeGreaterThan(1);

    // 줄 200 언저리까지 내린다
    await scrollTop(card, 4_000);
    await expect.poll(async () => (await 줄글(card)).some((text) => text.endsWith("// 줄 200"))).toBe(true);
    const before = await scrollTop(card);
    expect(before).toBeGreaterThan(3_000);
    const reads = await steadyCount(page, READ);

    // 에이전트가 줄 200을 고쳤다
    await replaceAnswer(page, READ, 답(줄들(400, { at: 200, text: "const 고친줄 = 200; // 에이전트" })));
    await fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });

    await expect.poll(() => 줄글(card), { timeout: 60_000 }).toContain("const 고친줄 = 200; // 에이전트");
    expect((await steadyCount(page, READ)) - reads).toBe(1);
    // 같은 자리다 — 맨 위로 튀지 않는다(G6)
    expect(Math.abs((await scrollTop(card)) - before)).toBeLessThanOrEqual(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("파일이 지워지면 탭은 남고 「지워진 파일」이 서고, 다시 생기면 코드로 돌아온다", async ({ page }) => {
    await installFixtureBackend(page, { read_worktree_file: 답(줄들(3)) });
    await page.goto(codeUrl(`billing/${LONG}`));
    const card = codeCard(page, `billing/${LONG}`);
    await expect.poll(() => 줄글(card)).toContain('const v0 = "값"; // 줄 1');
    const signal = () => fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });

    await replaceAnswer(page, READ, 답({ kind: "missing" }));
    await signal();
    await expect(card.getByText("지워진 파일", { exact: true })).toBeVisible();
    await expect(card.getByText("워크트리에 이 파일이 없어요.", { exact: true })).toBeVisible();
    // 닫는 것은 사람이다 — 탭은 그대로 켜져 있다
    const tab = page.locator(`[data-tab="code"][data-code="billing/${LONG}"]`);
    await expect(tab.locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");

    await replaceAnswer(page, READ, 답(줄들(3, { at: 2, text: "const 다시 = 2;" })));
    await signal();
    await expect.poll(() => 줄글(card)).toContain("const 다시 = 2;");
    await expect(card.getByText("지워진 파일", { exact: true })).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 그림은 내용이 답에 실리지 않는다 — 화면이 그 자리를 asset URL로 건다(티켓 09). 자리가 같으면 URL도 같아 웹뷰가 묵은 그림을
  // 그대로 두므로(`<img>`의 `src`가 안 바뀌면 다시 받지 않는다), 답의 크기와 고친 시각을 URL에 붙여 바뀐 그림이 새 URL로 걸린다.
  test("보이는 그림 탭은 그림이 바뀌면 새 asset URL로 다시 걸리고, 지웠다 다시 생겨도 새 그림이다", async ({ page }) => {
    const SHOT = "shots/home.png";
    const 그림 = (modifiedMs: number): WorktreeFile => ({ kind: "image", size: 48_213, realPath: SHOT, modifiedMs });
    const 그림답 = (file: WorktreeFile) =>
      answerByArg("path", { ...WORKTREE_FILES, [SHOT]: file }, { otherwise: { kind: "missing" } satisfies WorktreeFile });
    await installFixtureBackend(page, { read_worktree_file: 그림답(그림(1_760_000_000_000)) });
    await page.goto(codeUrl(`billing/${SHOT}`));
    const card = codeCard(page, `billing/${SHOT}`);
    const image = card.getByRole("img", { name: SHOT, exact: true });
    await expect(image).toBeVisible();
    const first = (await image.getAttribute("src")) ?? "";
    const signal = () => fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });
    /** 붙은 판을 뗀 거는 자리 — 그림이 바뀌어도 이것은 그대로다. */
    const 자리 = (src: string) => src.split("?")[0];

    // 에이전트가 같은 크기의 새 스크린샷으로 덮어썼다
    const reads = await steadyCount(page, READ);
    await replaceAnswer(page, READ, 그림답(그림(1_760_000_000_500)));
    await signal();
    await expect(image).not.toHaveAttribute("src", first);
    expect((await steadyCount(page, READ)) - reads).toBe(1);
    const second = (await image.getAttribute("src")) ?? "";
    expect(자리(second)).toBe(자리(first));

    // 지웠다가 다시 만들었다 — 다시 선 그림도 앞의 어느 URL과도 다르다(웹뷰의 메모리 캐시가 묵은 그림을 내지 않게)
    await replaceAnswer(page, READ, 그림답({ kind: "missing" }));
    await signal();
    await expect(card.getByText("지워진 파일", { exact: true })).toBeVisible();
    await replaceAnswer(page, READ, 그림답(그림(1_760_000_009_000)));
    await signal();
    await expect(image).toBeVisible();
    const third = (await image.getAttribute("src")) ?? "";
    expect([자리(third), [first, second].includes(third)]).toEqual([자리(first), false]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 분할이면 포커스가 문서 열이어도 묶음 열의 파일은 보이는 것이다(S9 · 07) — spec을 읽으며 옆 열의 코드를 보는 사람에게도
  // 에이전트의 고침이 따라온다. 「본문 탭이 code일 때만 읽는다」로 좁히면 여기서 빨개진다.
  test("분할의 묶음 열에 선 파일 탭은 포커스가 문서 열에 있어도 신호에 다시 읽힌다", async ({ page }) => {
    await installFixtureBackend(page, { read_worktree_file: 답(줄들(3)) });
    // `tab`이 없는 분할 주소 — 포커스는 문서 열이고 `code`는 묶음 열의 것이다(S12)
    await page.goto(`/works/${pinnedWork.slug}?split=lr&code=${encodeURIComponent(`billing/${LONG}`)}`);
    const column = page.getByRole("region", { name: `billing/${LONG}`, exact: true });
    await expect.poll(() => 줄글(column)).toContain('const v0 = "값"; // 줄 1');
    await expect(page).not.toHaveURL(/tab=/);
    const reads = await steadyCount(page, READ);

    await replaceAnswer(page, READ, 답(줄들(3, { at: 2, text: "const 옆열 = 2; // 에이전트" })));
    await fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });

    await expect.poll(() => 줄글(column), { timeout: 60_000 }).toContain("const 옆열 = 2; // 에이전트");
    expect((await steadyCount(page, READ)) - reads).toBe(1);
    // 포커스는 그대로 문서 열이다 — 다시 읽기가 포커스를 옮기지 않았다
    await expect(page).not.toHaveURL(/tab=/);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("창으로 돌아오면 보이는 파일 탭을 한 번만 다시 읽는다", async ({ page }) => {
    await installFixtureBackend(page, { read_worktree_file: 답(줄들(3)) });
    await page.goto(codeUrl(`billing/${LONG}`));
    const card = codeCard(page, `billing/${LONG}`);
    await expect.poll(() => 줄글(card)).toContain('const v0 = "값"; // 줄 1');
    const reads = await steadyCount(page, READ);

    await returnToWindow(page);
    await expect.poll(() => callCount(page, READ)).toBeGreaterThan(reads);
    // react-query의 `visibilitychange` 길은 꺼져 있다 — 앱 루트의 `focus` 한 번이다(S33)
    expect((await steadyCount(page, READ)) - reads).toBe(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("본문에 서 있지 않은 파일 탭은 신호에 읽히지 않고, 다시 서는 순간 한 번 읽힌다", async ({ page }) => {
    await installFixtureBackend(page, { read_worktree_file: 답(줄들(3)) });
    // 셸 한 칸이 선 묶음에 파일 탭을 연다
    await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
    await awaitSpawned(page, 1);
    await 주소로간다(page, codeUrl(`billing/${LONG}`));
    const card = codeCard(page, `billing/${LONG}`);
    await expect.poll(() => 줄글(card)).toContain('const v0 = "값"; // 줄 1');

    // 셸 탭으로 옮긴다 — 파일 탭은 묶음에 남고 본문은 셸이다
    await page.locator('[data-tab="shell"] button[aria-pressed]').first().click();
    await expect(card).toHaveCount(0);
    const hidden = await steadyCount(page, READ);
    await replaceAnswer(page, READ, 답(줄들(3, { at: 1, text: "const 숨은동안 = 1;" })));
    await fireEventToAll(page, EVENT, { slug: pinnedWork.slug, project: "billing" });
    await settle(page);
    expect(await steadyCount(page, READ)).toBe(hidden);

    await page.locator(`[data-tab="code"][data-code="billing/${LONG}"] button[aria-pressed]`).click();
    await expect.poll(() => 줄글(card)).toContain("const 숨은동안 = 1;");
    expect((await steadyCount(page, READ)) - hidden).toBe(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

