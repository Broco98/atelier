import { expect, test, type Locator, type Page } from "./evidence";
import type { WorktreeTree } from "@/features/files/types";
import { answerByArg, WORKS, WORKTREE_TREES, worktreeFile, worktreeFolder } from "./fixtures";
import { awaitSpawned, installFixtureBackend, unknownIpcCalls, 주소로간다, 파일탭주소 as codeUrl } from "./harness";

// git-integration 판 01 티켓 05(#478) — **트리에서 파일을 열고, 다시 누르면 닫힌다.**
//
// files 트리의 파일 행을 누르면 파일 탭이 열린다(스토리 23 — replace, 스토리 59). 지금 보이는 탭의 파일을 다시 누르면 그 탭이
// 닫힌다(결정 30 — 사용자가 더한 UX). 탭을 바꾸면 트리가 그 파일을 따라온다(스토리 14 · 15). 열린 파일 탭끼리 이름이 겹치면
// 상위 폴더가 흐리게 붙는다(S11).
//
// 픽스처: `pinned-work`는 프로젝트 하나(`billing`)다 — 구획 머리 없이 바로 트리다. 트리는 `WORKTREE_TREES.billing`이다.

const [work] = WORKS;

const 레일칸 = (page: Page, name: "spec" | "files") =>
  page.getByRole("group", { name: "레일", exact: true }).getByRole("button", { name, exact: true });
const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });
/** 트리의 행 — 폴더 행은 이름이 곧 이름이고, 파일 행은 확장자 꼬리표가 앞에 붙는다(`TS index.ts`). */
const 패널행 = (page: Page, name: string): Locator => 작업패널(page).getByRole("button", { name, exact: true });

/** 묶음의 칸들 — 탭 줄 스크롤 상자 안, 왼쪽부터. 셸이든 파일이든 센다. */
const 묶음 = (page: Page) => page.locator("[data-tab-strip] > [data-tab]");
const 파일탭들 = (page: Page) => page.locator('[data-tab="code"]');
/** 그 파일 탭 — 정체(`<프로젝트>/<경로>`)로 집는다. */
const 파일탭 = (page: Page, ref: string) => page.locator(`[data-tab="code"][data-code="${ref}"]`);
/** 켜짐을 말하는 이름 버튼. */
const 파일탭이름 = (page: Page, ref: string) => 파일탭(page, ref).locator("button[aria-pressed]");
const 셸칸이름 = (page: Page) => page.locator('[data-tab="shell"] button[aria-pressed]');
/** 코드 카드 — 접근 이름이 그 파일의 경로다(스토리 89). */
const 코드카드 = (page: Page, ref: string) => page.getByRole("main", { name: ref, exact: true });
const 히스토리길이 = (page: Page) => page.evaluate(() => window.history.length);
const 토글 = (page: Page) => page.getByRole("button", { name: /^작업 패널 (접기|펼치기)$/ });

/**
 * 패널보다 **긴** 트리 — 앞 폴더(`many`)를 펼치면 행이 마흔 줄 넘게 서서, 뒤에 선 파일은 스크롤해야 보인다. 「행이 보이는
 * 자리로 스크롤한다」(스토리 15)를 재려면 그 행이 처음에는 보이지 않아야 한다.
 */
const LONG_TREE: WorktreeTree = {
  kind: "listed",
  entries: [
    worktreeFolder(
      "many",
      Array.from({ length: 40 }, (_, at) => worktreeFile(`many/f${String(at + 1).padStart(2, "0")}.ts`)),
    ),
    worktreeFolder("src", [worktreeFolder("src/api", [worktreeFile("src/api/client.ts")]), worktreeFile("src/index.ts")]),
    worktreeFile("README.md"),
  ],
};

/** files 칸을 연다. */
async function openFiles(page: Page): Promise<void> {
  await 레일칸(page, "files").click();
  await expect(레일칸(page, "files")).toHaveAttribute("aria-pressed", "true");
}

test("트리에서 파일을 누르면 묶음 끝에 파일 탭이 서고 주소가 그 파일을 가리키며, 뒤로가기 기록은 쌓이지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // 셸 한 칸이 선 묶음에서 시작한다 — 「끝에 붙는다」를 재려면 앞에 칸이 있어야 한다.
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openFiles(page);
  await 패널행(page, "src").click();
  const before = await 히스토리길이(page);

  await 패널행(page, "TS index.ts").click();

  await expect(묶음(page)).toHaveCount(2);
  await expect(묶음(page).last()).toHaveAttribute("data-code", "billing/src/index.ts");
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveAttribute("aria-pressed", "true");
  await expect(코드카드(page, "billing/src/index.ts")).toBeVisible();
  await expect(page).toHaveURL(/tab=code&code=billing%2Fsrc%2Findex\.ts/);
  // 트리 훑기는 replace다(스토리 59) — 파일 스무 개를 넘겨 봐도 뒤로가기 한 번에 빠져나간다.
  expect(await 히스토리길이(page)).toBe(before);

  // 다른 탭(셸)을 보다가 같은 파일을 누르면 새 탭 없이 그 탭으로 간다(스토리 24).
  await 셸칸이름(page).click();
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveAttribute("aria-pressed", "false");
  await 패널행(page, "TS index.ts").click();
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveAttribute("aria-pressed", "true");
  await expect(코드카드(page, "billing/src/index.ts")).toBeVisible();
  await expect(파일탭들(page)).toHaveCount(1);
  await expect(묶음(page)).toHaveCount(2);
  expect(await 히스토리길이(page)).toBe(before);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("지금 보이는 탭의 파일을 다시 누르면 닫히고, 뒤에 있는 탭의 파일은 그 탭으로 가며, 더블클릭과 탭 다시 누르기는 닫지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}`);
  await openFiles(page);
  await 패널행(page, "src").click();
  await 패널행(page, "TS index.ts").click();
  await 패널행(page, "MD README.md").click();
  await expect(코드카드(page, "billing/README.md")).toBeVisible();
  await expect(파일탭들(page)).toHaveCount(2);

  // **보이는 탭의 파일 → 닫힌다**(결정 30). 닫기 규칙은 `×`와 같다 — 오른쪽 이웃이 없으니 왼쪽 이웃이 켜진다(스토리 38).
  await 패널행(page, "MD README.md").click();
  await expect(파일탭(page, "billing/README.md")).toHaveCount(0);
  await expect(코드카드(page, "billing/src/index.ts")).toBeVisible();
  await expect(page).toHaveURL(/code=billing%2Fsrc%2Findex\.ts/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // **뒤에 있는 탭의 파일 → 닫지 않고 그 탭이 켜진다**(스토리 34).
  await 패널행(page, "MD README.md").click();
  await expect(코드카드(page, "billing/README.md")).toBeVisible();
  await 패널행(page, "TS index.ts").click();
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveAttribute("aria-pressed", "true");
  await expect(코드카드(page, "billing/src/index.ts")).toBeVisible();
  await expect(파일탭들(page)).toHaveCount(2);

  // **더블클릭 → 열린 채다**(S15) — 둘째 클릭은 닫기로 치지 않는다. 첫 클릭에 열고 둘째에 닫는 깜빡임이 없다.
  await 패널행(page, ".gitignore").dblclick();
  await expect(파일탭이름(page, "billing/.gitignore")).toHaveAttribute("aria-pressed", "true");
  await expect(코드카드(page, "billing/.gitignore")).toBeVisible();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(파일탭(page, "billing/.gitignore")).toHaveCount(1);
  await expect(page).toHaveURL(/code=billing%2F\.gitignore/);

  // **켜진 파일 탭 자체를 다시 눌러도 닫히지 않는다**(스토리 36) — 탭은 `×`와 ⌘W로 닫는다.
  await 파일탭이름(page, "billing/.gitignore").click();
  await expect(파일탭이름(page, "billing/.gitignore")).toHaveAttribute("aria-pressed", "true");
  await expect(파일탭들(page)).toHaveCount(3);
  await expect(코드카드(page, "billing/.gitignore")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("탭을 바꾸면 트리가 그 파일을 강조하고 조상 폴더를 펼쳐 행을 보이는 자리로 스크롤한다 — 칸이 닫혀 있으면 열 때 한다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    list_worktree_tree: answerByArg("project", { ...WORKTREE_TREES, billing: LONG_TREE }),
  });
  // 파일 탭 둘 — 앞 폴더의 첫 파일과 뒤 폴더 깊은 곳의 파일. files 칸은 아직 안 열었다(작업 패널은 spec 칸이다).
  await page.goto(codeUrl("billing/src/api/client.ts"));
  await expect(코드카드(page, "billing/src/api/client.ts")).toBeVisible();
  await 주소로간다(page, codeUrl("billing/many/f01.ts"));
  await expect(코드카드(page, "billing/many/f01.ts")).toBeVisible();

  // 칸을 열면 지금 탭의 파일이 강조돼 있다 — 탭이 바뀐 것은 칸이 안 보일 때였다(기억했다가 열 때 한다).
  await openFiles(page);
  await expect(패널행(page, "many")).toHaveAttribute("aria-expanded", "true");
  await expect(패널행(page, "TS f01.ts")).toHaveAttribute("aria-current", "page");
  await expect(패널행(page, "TS f01.ts")).toBeInViewport();

  // 탭을 바꾸면 강조가 따라오고(스토리 14), 접혀 있던 조상 폴더가 펼쳐지고, 마흔 줄 아래의 행이 보이는 자리로 온다(스토리 15).
  await expect(패널행(page, "src")).toHaveAttribute("aria-expanded", "false");
  await 파일탭이름(page, "billing/src/api/client.ts").click();
  await expect(패널행(page, "src")).toHaveAttribute("aria-expanded", "true");
  await expect(패널행(page, "api")).toHaveAttribute("aria-expanded", "true");
  await expect(패널행(page, "TS client.ts")).toHaveAttribute("aria-current", "page");
  await expect(패널행(page, "TS client.ts")).toBeInViewport();
  await expect(패널행(page, "TS f01.ts")).not.toHaveAttribute("aria-current", "page");
  await expect(패널행(page, "TS f01.ts")).not.toBeInViewport();

  // 패널을 닫은 채 탭을 바꾸고 다시 연다 — 그 파일이 강조돼 있고, 위로 스크롤해 보이는 자리에 있다.
  await 토글(page).click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "false");
  await 파일탭이름(page, "billing/many/f01.ts").click();
  await expect(코드카드(page, "billing/many/f01.ts")).toBeVisible();
  await 토글(page).click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "true");
  await expect(패널행(page, "TS f01.ts")).toHaveAttribute("aria-current", "page");
  await expect(패널행(page, "TS f01.ts")).toBeInViewport();
  await expect(패널행(page, "TS client.ts")).not.toHaveAttribute("aria-current", "page");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("열린 파일 탭끼리 이름이 겹치면 겹침이 풀릴 때까지 상위 폴더가 흐리게 붙고, 겹침이 사라지면 다시 이름만이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/src/index.ts"));
  await expect(코드카드(page, "billing/src/index.ts")).toBeVisible();
  // 겹치기 전에는 이름만이다
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveText("index.ts");

  // 다른 폴더의 `index.ts` — 둘 다 상위 폴더가 하나 붙는다(S11 · `index.ts · works`의 모양).
  await 주소로간다(page, codeUrl("billing/src/api/index.ts"));
  await expect(코드카드(page, "billing/src/api/index.ts")).toBeVisible();
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveText("index.ts · src");
  await expect(파일탭이름(page, "billing/src/api/index.ts")).toHaveText("index.ts · api");
  // 붙은 폴더는 흐리다 — 이름과 다른 색이다.
  const colors = await 파일탭이름(page, "billing/src/api/index.ts").evaluate((button) => {
    const [name, folder] = [button.querySelector("span"), button.querySelector("span span")];
    return [name, folder].map((one) => (one ? getComputedStyle(one).color : null));
  });
  expect(colors[1]).not.toBeNull();
  expect(colors[1]).not.toBe(colors[0]);

  // 상위 폴더 하나로도 겹치면 하나 더 붙는다 — 겹침이 풀릴 때까지. 이미 풀린 칸은 그대로다.
  await 주소로간다(page, codeUrl("billing/lib/api/index.ts"));
  await expect(코드카드(page, "billing/lib/api/index.ts")).toBeVisible();
  await expect(파일탭이름(page, "billing/lib/api/index.ts")).toHaveText("index.ts · lib/api");
  await expect(파일탭이름(page, "billing/src/api/index.ts")).toHaveText("index.ts · src/api");
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveText("index.ts · src");

  // 닫아서 겹침이 줄면 다시 짧아지고, 사라지면 이름만이다.
  await 파일탭(page, "billing/lib/api/index.ts").getByRole("button", { name: "index.ts · lib/api 닫기" }).click();
  await expect(파일탭이름(page, "billing/src/api/index.ts")).toHaveText("index.ts · api");
  await 파일탭이름(page, "billing/src/api/index.ts").click();
  await 파일탭(page, "billing/src/api/index.ts").getByRole("button", { name: "index.ts · api 닫기" }).click();
  await expect(파일탭들(page)).toHaveCount(1);
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveText("index.ts");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
