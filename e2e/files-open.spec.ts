import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, unknownIpcCalls } from "./harness";

// git-integration 판 01 티켓 05(#478) — **트리에서 파일을 열고, 다시 누르면 닫힌다.**
//
// files 트리의 파일 행을 누르면 파일 탭이 열린다(스토리 23 — replace, 스토리 59). 지금 보이는 탭의 파일을 다시 누르면 그 탭이
// 닫힌다(결정 30 — 사용자가 더한 UX). 탭을 바꾸면 트리가 그 파일을 따라온다(스토리 14 · 15). 열린 파일 탭끼리 이름이 겹치면
// 상위 폴더가 흐리게 붙는다(S11).
//
// 픽스처: `pinned-work`는 프로젝트 하나(`billing`)다 — 구획 머리 없이 바로 트리다. 트리는 `WORKTREE_TREES.billing`이다.

const [work] = WORKS;

const 레일칸 = (page: Page, name: "spec" | "files" | "info") =>
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
