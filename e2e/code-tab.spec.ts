import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  clipboardWrites,
  installFixtureBackend,
  ipcFailure,
  recordClipboard,
  steadyCount,
  typeIntoShell,
  unknownIpcCalls,
  writeShell,
  파일탭주소 as codeUrl,
  주소로간다,
} from "./harness";

// git-integration 판 01 티켓 04(#477) — **파일 탭이 주소로 열리고, `×`와 ⌘W로 닫힌다.**
//
// 파일 탭은 셸 탭과 한 묶음이다(결정 31). 주소 `?tab=code&code=<프로젝트>/<경로>`가 「묶음의 지금 탭이 그 파일이다」를 말하고
// (S12), 묶음에 없으면 끝에 연다(스토리 60). 닫기는 확인이 없다(스토리 37 · 50) — 셸의 ⌘W는 지금처럼 묻는다(스토리 51).
//
// 본문은 지금 있는 원문 보기(줄 번호, 강조 없음)다 — 강조는 08이 갈아 끼운다.

// 워크트리가 하나(`billing`)인 work — 셸이 저절로 뜨는 화면이다. 옆 work은 옮겨 갔다 오는 자리다. 프로젝트가 둘인 work은
// 셸이 저절로 안 뜨는 화면이다.
const [work, plainWork, multiWork] = WORKS;

/** 묶음의 칸들 — 탭 줄 스크롤 상자 안, 왼쪽부터. 셸이든 파일이든 센다. */
const 묶음 = (page: Page) => page.locator("[data-tab-strip] > [data-tab]");
const 파일탭들 = (page: Page) => page.locator('[data-tab="code"]');
/** 그 파일 탭 — 정체(`<프로젝트>/<경로>`)로 집는다. */
const 파일탭 = (page: Page, ref: string) => page.locator(`[data-tab="code"][data-code="${ref}"]`);
/** 켜짐을 말하는 이름 버튼. */
const 파일탭이름 = (page: Page, ref: string) => 파일탭(page, ref).locator("button[aria-pressed]");
/** 코드 카드 — 접근 이름이 그 파일의 경로다(스토리 89). */
const 코드카드 = (page: Page, ref: string) => page.getByRole("main", { name: ref, exact: true });
/** 묶음에 선 파일 탭의 정체들, 왼쪽부터. */
const 파일탭차례 = (page: Page) => 파일탭들(page).evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-code")));
/** 그 파일 탭의 `×` — 접근 이름이 `<파일 이름> 닫기`다. 좁은 폭에서 꺼진 칸의 `×`는 접히므로 칸을 먼저 켠다. */
const 닫기 = (page: Page, ref: string) => 파일탭(page, ref).locator('button[aria-label$=" 닫기"]');
const 셸칸 = (page: Page) => page.locator('[data-tab="shell"]');
const 문서카드 = (page: Page) => page.getByRole("main", { name: "문서", exact: true });

test("주소가 가리키는 파일이 묶음 끝에 파일 탭으로 서고, 본문에 줄 번호 붙은 원문과 경로 줄이 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  // 셸 한 칸이 선 묶음에서 시작한다 — 「끝에 붙는다」를 재려면 앞에 칸이 있어야 한다.
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  await 주소로간다(page, codeUrl("billing/src/main.ts"));

  await expect(묶음(page)).toHaveCount(2);
  await expect(묶음(page).last()).toHaveAttribute("data-code", "billing/src/main.ts");
  await expect(파일탭이름(page, "billing/src/main.ts")).toHaveAttribute("aria-pressed", "true");
  // 셸 칸은 꺼진다 — 본문이 파일이다.
  await expect(묶음(page).first().locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "false");

  const card = 코드카드(page, "billing/src/main.ts");
  await expect(card).toBeVisible();
  // 경로 줄 — `<프로젝트> › 폴더 › 파일`(S17).
  await expect(card.getByRole("navigation", { name: "위치" })).toHaveText("billingsrcmain.ts");
  // 줄 번호 붙은 원문 — 줄마다 번호가 앞에 선다.
  await expect(card).toContainText(/1\s*const answer = 42;\s*2\s*\/\/ 끝까지 읽는다\s*3\s*export default "answer";/);
  // 셸 화면은 내려갔다 — 본문은 하나다.
  await expect(page.locator(".xterm")).toHaveCount(0);

  // **같은 주소로 다시 가도 탭은 하나다**(스토리 24) — 정체가 같으면 새로 서지 않는다.
  await page.locator('[data-tab="spec"]').click();
  await expect(card).toHaveCount(0);
  await 주소로간다(page, codeUrl("billing/src/main.ts"));
  await expect(card).toBeVisible();
  await expect(파일탭들(page)).toHaveCount(1);
  await expect(묶음(page)).toHaveCount(2);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`×`와 ⌘W가 파일 탭을 확인 없이 닫고, 오른쪽 → 왼쪽 이웃이 켜진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  for (const ref of ["billing/src/main.ts", "billing/README.md", "billing/gone.ts"]) {
    await 주소로간다(page, codeUrl(ref));
    await expect(코드카드(page, ref)).toBeVisible();
  }
  await expect.poll(() => 파일탭차례(page)).toEqual(["billing/src/main.ts", "billing/README.md", "billing/gone.ts"]);

  // 가운데 칸을 켜고 `×` — 오른쪽 이웃이 켜진다(스토리 38).
  await 파일탭이름(page, "billing/README.md").click();
  await expect(코드카드(page, "billing/README.md")).toBeVisible();
  await 닫기(page, "billing/README.md").click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(파일탭(page, "billing/README.md")).toHaveCount(0);
  await expect(파일탭이름(page, "billing/gone.ts")).toHaveAttribute("aria-pressed", "true");
  await expect(코드카드(page, "billing/gone.ts")).toBeVisible();
  await expect(page).toHaveURL(/code=billing%2Fgone\.ts/);

  // 오른쪽 끝 칸을 ⌘W — 오른쪽이 없으니 왼쪽 이웃이다.
  await page.keyboard.press("Meta+w");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(파일탭(page, "billing/gone.ts")).toHaveCount(0);
  await expect(코드카드(page, "billing/src/main.ts")).toBeVisible();

  // 왼쪽 이웃이 셸이면 본문이 셸로 간다 — 주소도 터미널이다.
  await page.keyboard.press("Meta+w");
  await expect(파일탭들(page)).toHaveCount(0);
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(page).not.toHaveURL(/code=/);
  await expect(page.locator(".xterm")).toHaveCount(1);
  await expect(셸칸(page).locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");

  // **셸이 지금 탭이면 ⌘W는 여전히 묻는다**(스토리 40 · 51) — 확인 창을 우회하는 길이 새로 생기지 않았다.
  await page.keyboard.press("Meta+w");
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "닫기" }).click();
  await expect(셸칸(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("묶음의 마지막 칸을 닫으면 spec으로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  // 주소로 곧장 파일 탭에 들어온다 — 터미널 본문이 한 번도 안 서서 셸이 저절로 뜨지 않는다. 묶음은 파일 탭 하나다.
  await page.goto(codeUrl("billing/README.md"));
  await expect(코드카드(page, "billing/README.md")).toBeVisible();
  await expect(묶음(page)).toHaveCount(1);

  await 닫기(page, "billing/README.md").click();

  await expect(묶음(page)).toHaveCount(0);
  await expect(page.locator('[data-tab="spec"]')).toHaveAttribute("aria-pressed", "true");
  await expect(문서카드(page)).toBeVisible();
  await expect(page).not.toHaveURL(/tab=|code=/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("뒤로가기로 묶음에 없는 파일을 가리키면 그 탭이 다시 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/src/main.ts"));
  await expect(코드카드(page, "billing/src/main.ts")).toBeVisible();
  await 주소로간다(page, codeUrl("billing/README.md"));
  await expect(코드카드(page, "billing/README.md")).toBeVisible();

  // 뒤에 있는 첫 탭을 닫는다 — 지금 탭은 그대로다.
  await 닫기(page, "billing/src/main.ts").click();
  await expect.poll(() => 파일탭차례(page)).toEqual(["billing/README.md"]);
  await expect(코드카드(page, "billing/README.md")).toBeVisible();

  // 뒤로가기의 주소는 닫힌 파일을 가리킨다 — spec으로 조용히 떨어지지 않고 그 탭을 묶음 끝에 다시 연다(스토리 60).
  await page.goBack();
  await expect(코드카드(page, "billing/src/main.ts")).toBeVisible();
  await expect.poll(() => 파일탭차례(page)).toEqual(["billing/README.md", "billing/src/main.ts"]);
  await expect(파일탭이름(page, "billing/src/main.ts")).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`tab=code`만 있고 파일이 없으면 spec이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=code`);
  await expect(문서카드(page)).toBeVisible();
  await expect(page.locator('[data-tab="spec"]')).toHaveAttribute("aria-pressed", "true");
  await expect(파일탭들(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("work을 옮겼다 돌아와도 파일 탭과 그 차례가 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/src/main.ts"));
  // 첫 주소의 탭이 선 뒤에 다음 주소로 간다 — 앱이 뜨기 전에 주소가 바뀌면 첫 주소를 못 보고 지나간다.
  await expect(코드카드(page, "billing/src/main.ts")).toBeVisible();
  await 주소로간다(page, codeUrl("billing/README.md"));
  await expect.poll(() => 파일탭차례(page)).toEqual(["billing/src/main.ts", "billing/README.md"]);

  // 사이드바로 옆 work에 갔다 온다 — 앱 안의 이동이라 묶음(메모리)이 산다(결정 33).
  const rows = page.locator("[data-worklist]");
  await rows.getByRole("button", { name: plainWork.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  await expect(파일탭들(page)).toHaveCount(0);

  await rows.getByRole("button", { name: work.title, exact: true }).click();
  // work 기억이 보던 파일 탭으로 되돌린다 — 주소가 그 파일을 가리키고 그 탭이 켜져 있다.
  await expect(page).toHaveURL(/tab=code&code=billing%2FREADME\.md/);
  await expect(코드카드(page, "billing/README.md")).toBeVisible();
  await expect.poll(() => 파일탭차례(page)).toEqual(["billing/src/main.ts", "billing/README.md"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 탭 → 파일 탭 → 셸 탭으로 오가도 셸 화면이 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  // 사람이 친 셸이다 — 안 친 자동 셸은 그 화면을 떠나면 닫힌다(프로세스 결정 7). 파일 탭으로 가는 것은 떠남이 아니지만,
  // 실물의 셸은 대개 이렇다.
  await typeIntoShell(page);
  await writeShell(page, "\x1b]0;표식\x07");
  await expect(셸칸(page).locator("button[aria-pressed]")).toHaveText(/표식/);
  // 셸 화면 자체에 표식을 단다 — 돌아왔을 때 **같은** xterm이 붙어야 그 화면(스크롤백 · 커서)이 그대로다.
  await page.locator(".xterm").evaluate((element) => element.setAttribute("data-seen", "before"));

  await 주소로간다(page, codeUrl("billing/src/main.ts"));
  await expect(코드카드(page, "billing/src/main.ts")).toBeVisible();
  // 터미널 카드는 내려간다 — spec으로 갈 때와 같다.
  await expect(page.locator(".xterm")).toHaveCount(0);

  await 셸칸(page).locator("button[aria-pressed]").click();
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(page.locator('.xterm[data-seen="before"]')).toHaveCount(1);
  await expect(셸칸(page).locator("button[aria-pressed]")).toHaveText(/표식/);
  // 셸을 다시 띄우지도 죽이지도 않았다.
  expect(await callCount(page, "pty_spawn")).toBe(1);
  expect(await callCount(page, "pty_kill")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("없는 파일은 「지워진 파일」, 밖을 가리키는 링크와 work에 없는 프로젝트는 그 까닭이 탭 안에 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/gone.ts"));
  // spec으로 조용히 돌아가지 않는다 — 탭은 서고 본문이 까닭을 말한다(스토리 61 · 82).
  await expect(파일탭(page, "billing/gone.ts")).toHaveCount(1);
  await expect(코드카드(page, "billing/gone.ts")).toContainText("지워진 파일");

  await 주소로간다(page, codeUrl("billing/secret.txt"));
  const outside = 코드카드(page, "billing/secret.txt");
  await expect(outside).toContainText("바깥을 가리키는 링크");
  await expect(outside).toContainText("~/secrets/token.txt");

  // 그 work에 없는 프로젝트를 가리키는 주소 — 탭은 열고 「워크트리 없음」(티켓 04). 경로 복사는 가리킬 자리가 없어 안 선다.
  await 주소로간다(page, codeUrl("ghost/ghost.ts"));
  const ghost = 코드카드(page, "ghost/ghost.ts");
  await expect(ghost).toContainText("워크트리 없음");
  await expect(ghost.getByRole("button", { name: "경로 복사" })).toHaveCount(0);
  await expect(파일탭들(page)).toHaveCount(3);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 구현 스펙 「화면 — 코드 보기 › 카드 머리」(04) — 그 work에 그 프로젝트의 워크트리가 없으면 경로 복사를 세우지 않는다. 프로젝트는
// 있는데 워크트리 폴더가 사라진 것(work 목록의 `exists: false` — files 칸이 「워크트리 없음」을 띄우는 그 상태)도 같다: 가리킬
// 파일이 없다. 세우면 없는 경로가 클립보드로 에이전트에게 넘어간다.
test("워크트리 폴더가 사라진 프로젝트의 파일 탭은 「워크트리 없음」이고 경로 복사가 서지 않는다", async ({ page }) => {
  const works = WORKS.map((one) =>
    one.slug === multiWork.slug
      ? { ...one, worktrees: one.worktrees.map((tree) => (tree.project === "ledger" ? { ...tree, exists: false } : tree)) }
      : one,
  );
  await installFixtureBackend(page, { list_works: works });
  await page.goto(codeUrl("ledger/ghost.ts", multiWork.slug));
  const card = 코드카드(page, "ledger/ghost.ts");
  await expect(card).toContainText("워크트리 없음");
  await expect(card.getByRole("button", { name: "경로 복사" })).toHaveCount(0);

  // 워크트리가 있는 프로젝트의 파일 탭은 그대로 선다 — 위가 「코드 카드에 경로 복사가 아예 없다」로 통과하지 않게.
  await 주소로간다(page, codeUrl("billing/src/main.ts", multiWork.slug));
  await expect(코드카드(page, "billing/src/main.ts").getByRole("button", { name: "경로 복사" })).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 구현 스펙 「화면 — 주소」 — 주소가 셸을 말하는데(`tab=terminal`) 지금 탭이 파일 탭이면 묶음의 첫 셸이 지금 탭이 된다(04). 셸이
// 없고 자동 셸도 안 뜨는 work(프로젝트 둘)이면 켤 셸이 없어 지금 탭이 파일 탭으로 남는다. 그때 본문은 「아직 셸이 없어요」이고
// 켜진 칸은 본문에 선 것이라 그 파일 탭이 켜지지 않는다. ⌘W도 닫을 것이 없다 — 셸 닫기 길에 파일 탭을 넘기지 않는다.
test("셸 없는 묶음에 주소가 셸을 말하면 파일 탭이 켜진 칸으로 서지 않고, ⌘W가 아무것도 닫지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/src/main.ts", multiWork.slug));
  await expect(코드카드(page, "billing/src/main.ts")).toBeVisible();
  await expect(파일탭이름(page, "billing/src/main.ts")).toHaveAttribute("aria-pressed", "true");

  await 주소로간다(page, `/works/${multiWork.slug}?tab=terminal`);
  await expect(page.getByText("아직 셸이 없어요", { exact: true })).toBeVisible();
  await expect(코드카드(page, "billing/src/main.ts")).toHaveCount(0);
  await expect(파일탭이름(page, "billing/src/main.ts")).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Meta+w");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  // 칸을 누르면 그 파일로 간다 — 키는 차례대로 처리되므로 앞의 ⌘W가 끝난 뒤의 묶음이다.
  await 파일탭이름(page, "billing/src/main.ts").click();
  await expect(코드카드(page, "billing/src/main.ts")).toBeVisible();
  await expect(파일탭이름(page, "billing/src/main.ts")).toHaveAttribute("aria-pressed", "true");
  expect(await callCount(page, "pty_spawn")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 구현 스펙 「코어 — 파일 읽기」(04) — 가드가 거절한 경로(`..` · 절대 경로)는 갈래가 아니라 명령 실패로 온다. 화면은 「읽지 못한
// 파일」과 그 글을 보인다. 손으로 고친 주소나 그 주소를 기억한 work이 이 길을 탄다. 같은 주소는 다시 물어도 같은 답이라 다시
// 시도하지 않는다 — 기본값(1 · 2 · 4초 뒤 세 번)이면 그 7초 동안 카드 몸이 빈 채다(한 겹 쿼리의 S23과 같은 까닭).
test("코어가 거절한 경로는 다시 묻지 않고 곧바로 「읽지 못한 파일」과 그 까닭이 탭 안에 뜬다", async ({ page }) => {
  await installFixtureBackend(page, { read_worktree_file: ipcFailure("invalid path: src/../../x") });
  await page.goto(codeUrl("billing/src/../../x"));

  const card = 코드카드(page, "billing/src/../../x");
  await expect(card).toContainText("읽지 못한 파일");
  await expect(card).toContainText("invalid path: src/../../x");
  expect(await steadyCount(page, "read_worktree_file")).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 69 · S17 — 코드 카드 머리의 경로 복사는 그 파일의 **워크트리 경로**를 복사한다: 에이전트에게 그 파일을 그대로 넘긴다.
// 뿌리는 코어가 준 워크트리 자리다. 그림 링크도 사람이 연 이름 그대로다 — 그림을 거는 자리(코어가 푼 실제 경로)와 갈린다.
test("코드 카드 머리의 경로 복사가 그 파일의 워크트리 경로를 복사한다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  const worktree = work.worktrees.find((one) => one.project === "billing")!.path;
  await page.goto(codeUrl("billing/src/main.ts"));

  const copy = (ref: string) => 코드카드(page, ref).getByRole("button", { name: "경로 복사", exact: true });
  await copy("billing/src/main.ts").click();
  await expect.poll(() => clipboardWrites(page)).toEqual([`${worktree}/src/main.ts`]);

  await 주소로간다(page, codeUrl("billing/docs/logo.png"));
  await expect(코드카드(page, "billing/docs/logo.png").getByRole("img")).toBeVisible();
  await copy("billing/docs/logo.png").click();
  await expect.poll(() => clipboardWrites(page)).toEqual([`${worktree}/src/main.ts`, `${worktree}/docs/logo.png`]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
