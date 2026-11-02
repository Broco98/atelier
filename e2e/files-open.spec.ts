import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  unknownIpcCalls,
  Project줄을누른다,
  주소로간다,
  파일탭주소 as codeUrl,
} from "./harness";

// git-integration 판 01 티켓 05(#478) — **트리에서 파일을 연다.** 열린 파일 탭끼리 이름이 겹치면 상위 폴더가 흐리게 붙는다(S11).
//
// 트리는 넓힌 카드의 Project 보기다(restart 02a-12 · 02a-14 — 「요약 카드」 → 그 Project 줄). 바뀌지 않은 파일 행을 누르면 파일 탭이
// 열리고, 파일 탭이 켜지면 넓힌 카드는 닫힌다(SummarySheet 「넓힌 카드」 표). 한때 트리는 레일 `files` 칸의 몸이라 파일 탭과 나란히
// 보였다 — 그래서 「보이는 탭의 파일을 다시 누르면 닫힌다」(결정 30) · 더블클릭 · 「탭을 바꾸면 트리가 그 파일을 강조하고 따라온다」
// (스토리 14 · 15)를 쟀다. 넓힌 카드의 트리는 파일 탭과 함께 서지 않고 지금 탭을 강조하지 않아(`current` 없음) 그 검사들을 걷었다.
//
// 픽스처: `pinned-work`는 프로젝트 하나(`billing`)다. 트리는 `WORKTREE_TREES.billing`이다.

const [work] = WORKS;

/** 넓힌 카드의 Project 보기 — 트리가 여기 선다. */
const 트리 = (page: Page) => page.locator('[data-viewer="project"]');
/** 트리의 행 — 폴더 행은 이름이 곧 이름이고, 파일 행은 확장자 꼬리표가 앞에 붙는다(`TS index.ts`). */
const 패널행 = (page: Page, name: string): Locator => 트리(page).getByRole("button", { name, exact: true });

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

/** 창 머리 「요약 카드」를 열고 Project 줄 `billing`을 눌러 넓힌 카드에 트리를 세운다. */
async function openFiles(page: Page): Promise<void> {
  await page.getByRole("button", { name: "요약 카드", exact: true }).click();
  await Project줄을누른다(page, "billing");
  await expect(트리(page)).toBeVisible();
}

test("트리에서 파일을 누르면 묶음 끝에 파일 탭이 서고 주소가 그 파일을 가리키며 넓힌 카드가 닫히고, 다시 누르면 새 탭 없이 그 탭으로 간다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // 셸 한 칸이 선 묶음에서 시작한다 — 「끝에 붙는다」를 재려면 앞에 칸이 있어야 한다. 요약 카드를 열면 새 채팅 탭이 뒤에 선다
  // (채팅이 없는 작업공간 — restart 02a-10).
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await openFiles(page);
  await 패널행(page, "src").click();

  await 패널행(page, "TS index.ts").click();

  await expect(묶음(page).last()).toHaveAttribute("data-code", "billing/src/index.ts");
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveAttribute("aria-pressed", "true");
  await expect(코드카드(page, "billing/src/index.ts")).toBeVisible();
  await expect(page).toHaveURL(/tab=code&code=billing%2Fsrc%2Findex\.ts/);
  // 파일 탭이 켜지면 넓힌 카드는 닫힌다.
  await expect(트리(page)).toHaveCount(0);
  const count = await 묶음(page).count();

  // 다른 탭(셸)을 보다가 같은 파일을 누르면 새 탭 없이 그 탭으로 간다(스토리 24).
  await 셸칸이름(page).click();
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveAttribute("aria-pressed", "false");
  await openFiles(page);
  await 패널행(page, "TS index.ts").click();
  await expect(파일탭이름(page, "billing/src/index.ts")).toHaveAttribute("aria-pressed", "true");
  await expect(코드카드(page, "billing/src/index.ts")).toBeVisible();
  await expect(파일탭들(page)).toHaveCount(1);
  await expect(묶음(page)).toHaveCount(count);
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
