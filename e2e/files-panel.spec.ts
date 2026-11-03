import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, WORKS, worktreeFile, WORKTREE_TREES } from "./fixtures";
import {
  callCount,
  fireEventToAll,
  holdCommand,
  installFixtureBackend,
  ipcCallArgs,
  ipcFailure,
  releaseCommand,
  replaceAnswer,
  steadyCount,
  unknownIpcCalls,
  작업화면으로,
  Project줄을누른다,
} from "./harness";

// git-integration 판 01 티켓 01 — **워크트리 트리가 선다.** 트리는 코어가 세워 보낸 것을 그리기만 한다 — 걸리지 않은 것과 걸린 것을
// 가르는 규칙, 폴더 먼저 · 이름순은 L1(`worktree.rs`)이 진짜 저장소로 잰다. 이 층이 재는 것은 화면이다: 처음 펼침 · 흐림의 말 ·
// 「워크트리 없음」 · 언제 묻는가 · 접힘 기억.
//
// 티켓 02 — **걸린 폴더를 펼치면 한 겹 읽힌다.** 걸린 폴더는 트리 목록이 「아직 안 읽음」으로 보낸다. 펼칠 때 그 바로 아래만
// 묻고(스토리 20), 묻는 동안 「읽는 중」이 선다(스토리 21). 한 겹만 읽는 규칙은 L1(`worktree.rs`)이 잰다.
//
// **트리는 넓힌 카드의 Project 보기다**(restart 02a-12 · 02a-14). 창 머리 「요약 카드」를 열고 그 카드의 Project 줄을 누르면 카드가
// 넓어지며 그 Project 하나의 worktree 트리가 선다(`ExpandedViewer`의 `ProjectTree` — `[data-viewer="project"]`). 한때 이 트리는 레일
// `files` 칸이 여는 작업 패널의 몸이었다 — 02a-14가 그 칸과 머리의 「새로고침」을 걷었다. 그래서 칸 · 새로고침을 재던 검사와 프로젝트
// 여럿의 구획 머리를 재던 검사를 걷거나 옮겼다(프로젝트마다 Project 줄이 따로 서고 트리는 그 하나다).
//
// 픽스처: `pinned-work`는 프로젝트 하나(`billing`), `multi-work`는 둘(`billing` · `ledger`)이다. 트리는 `WORKTREE_TREES`,
// 걸린 폴더의 한 겹은 `WORKTREE_FOLDERS`다.

const [pinnedWork, , multiWork] = WORKS;
const COMMAND = "list_worktree_tree";
/** 걸린 폴더의 한 겹(티켓 02) — 그 폴더를 펼칠 때 묻는다. */
const FOLDER = "list_worktree_folder";

/** 창 머리의 「요약 카드」 — 오른쪽 자리를 요약 카드로 연다(restart 02a-9 · 02a-10). */
const 요약카드단추 = (page: Page) => page.getByRole("button", { name: "요약 카드", exact: true });
/** 넓힌 카드의 Project 보기 — 트리가 여기 선다. */
const 트리 = (page: Page) => page.locator('[data-viewer="project"]');
/** 트리의 행 — 이름이 곧 이름이다. 파일 행의 확장자 꼬리표 글자는 그림이라 이름에 들지 않는다(restart 02b-8 — 한때 `MD README.md`였다). */
const 행 = (scope: Locator, name: string) => scope.getByRole("button", { name, exact: true });
const 트리행 = (page: Page, name: string) => 행(트리(page), name);

/**
 * 요약 카드를 열고 그 Project 줄을 눌러 넓힌 카드에 트리를 세운다. 요약 카드가 이미 서 있으면(켜짐 — 오른쪽 자리는 작업공간마다 앱 메모리에
 * 산다, restart 02a-9) 단추를 안 누른다 — 누르면 걷힌다.
 */
async function openTree(page: Page, project = "billing"): Promise<void> {
  const 단추 = 요약카드단추(page);
  await expect(단추).toBeVisible();
  if ((await 단추.getAttribute("aria-pressed")) !== "true") await 단추.click();
  await Project줄을누른다(page, project);
  await expect(트리(page)).toBeVisible();
}

test("요약 카드의 Project 줄이 넓힌 카드에 그 Project의 worktree 트리를 세운다 — spec 문서는 트리에 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openTree(page);

  // 트리 머리는 그 Project와 worktree 브랜치다. 트리는 worktree의 것이라 spec 문서(`overview.md`)는 없다.
  await expect(트리(page)).toContainText("billing");
  await expect(트리행(page, "src")).toBeVisible();
  await expect(트리행(page, "overview.md")).toHaveCount(0);
  // 그 Project 하나라 구획 머리가 없다(S13).
  await expect(트리(page).getByRole("heading")).toHaveCount(0);
  expect((await ipcCallArgs(page, COMMAND, "project")).map(({ args }) => `${args.slug}/${args.project}`)).toContain(
    `${pinnedWork.slug}/billing`,
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("트리는 프로젝트 루트만 펼쳐 서고, 걸린 것은 흐린 글자로 「gitignore에 걸림」을 말한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openTree(page);

  // 루트 바로 아래가 받은 순서 그대로 서고, 폴더는 모두 접혀 있다(스토리 8). 안쪽 파일은 아직 안 보인다.
  for (const folder of [".github", "dist", "src"]) {
    await expect(트리행(page, folder), folder).toHaveAttribute("aria-expanded", "false");
  }
  for (const file of [".env", ".gitignore", "README.md"]) {
    await expect(트리행(page, file), file).toBeVisible();
  }
  await expect(트리행(page, "index.ts")).toHaveCount(0);
  await expect(트리행(page, "ci.yml")).toHaveCount(0);

  // 폴더를 누르면 펼친다 — 한 겹만이다(안쪽 폴더는 접힌 채)
  await 트리행(page, "src").click();
  await expect(트리행(page, "src")).toHaveAttribute("aria-expanded", "true");
  await expect(트리행(page, "index.ts")).toBeVisible();
  await expect(트리행(page, "api")).toHaveAttribute("aria-expanded", "false");

  // 걸린 것은 접근성 설명으로 그 까닭을 말하고(스토리 88), 글자가 흐리다(스토리 19). 걸리지 않은 행은 설명이 없다.
  await expect(트리행(page, "dist")).toHaveAccessibleDescription("gitignore에 걸림");
  await expect(트리행(page, ".env")).toHaveAccessibleDescription("gitignore에 걸림");
  await expect(트리행(page, "src")).toHaveAccessibleDescription("");
  await expect(트리행(page, "README.md")).toHaveAccessibleDescription("");
  const colorOf = (name: string) => 트리행(page, name).evaluate((el) => getComputedStyle(el).color);
  expect(await colorOf(".env")).not.toBe(await colorOf("README.md"));
  expect(await colorOf("dist")).not.toBe(await colorOf("src"));
  // 걸린 폴더는 접힌 채 서고, 펼치기 전에는 그 안을 묻지 않는다(스토리 20)
  expect(await callCount(page, FOLDER)).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("하위 모듈과 심링크는 펼치지 않는 파일 행이고, 하위 모듈만 제 글리프와 「하위 모듈」을 말한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openTree(page);

  // 하위 모듈은 다른 저장소라 펼치지 않는다(S3) — 폴더 쪽에 서도 펼침을 말하지 않는 파일 행이다. 확장자 꼬리표 대신
  // `FolderGit2` 글리프가 서고, 화면 읽기로 「하위 모듈」을 듣는다(스토리 88).
  const submodule = 트리행(page, "vendor-ui");
  await expect(submodule).toBeVisible();
  await expect(submodule).not.toHaveAttribute("aria-expanded");
  await expect(submodule).toHaveAccessibleDescription("하위 모듈");
  await expect(submodule.locator("svg.lucide-folder-git-2")).toHaveCount(1);

  // 심링크는 따라가지 않는다 — 폴더를 가리켜도 그 자리의 파일 행이고 따로 표시하지 않는다(01).
  const link = 트리행(page, "docs");
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute("aria-expanded");
  await expect(link).toHaveAccessibleDescription("");
  await expect(link.locator("svg")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("걸린 폴더를 펼치면 「읽는 중」 뒤에 한 겹이 서고, 그 안의 폴더를 펼치면 다음 겹을 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openTree(page);
  const dist = 트리행(page, "dist");
  await expect(dist).toHaveAttribute("aria-expanded", "false");

  // 읽기를 붙잡아 「읽는 중」을 러너 속도와 상관없이 본다(스토리 21)
  await holdCommand(page, FOLDER);
  await dist.click();
  // 걸린 폴더 행도 펼쳐짐을 말한다(스토리 88)
  await expect(dist).toHaveAttribute("aria-expanded", "true");
  await expect(트리(page).getByText("읽는 중…", { exact: true })).toBeVisible();
  await expect(트리행(page, "app.js")).toHaveCount(0);
  await releaseCommand(page, FOLDER);
  await expect(트리행(page, "app.js")).toBeVisible();
  await expect(트리(page).getByText("읽는 중…", { exact: true })).toHaveCount(0);
  // 한 겹 명령이 그 폴더의 (slug, 프로젝트, 경로)로 한 번 불렸다
  expect((await ipcCallArgs(page, FOLDER, "path")).map(({ args }) => args)).toEqual([
    { slug: pinnedWork.slug, project: "billing", path: "dist" },
  ]);

  // 잘리지 않은 답에는 싣지 않은 수가 없다
  await expect(트리(page).getByText(/^그 밖에/)).toHaveCount(0);

  // 안의 것은 모두 걸린 것이다 — 흐린 글자와 그 까닭. 자식 폴더는 아직 안 읽어 접힌 채다
  await expect(트리행(page, "app.js")).toHaveAccessibleDescription("gitignore에 걸림");
  const assets = 트리행(page, "assets");
  await expect(assets).toHaveAccessibleDescription("gitignore에 걸림");
  await expect(assets).toHaveAttribute("aria-expanded", "false");
  await expect(트리행(page, "logo.svg")).toHaveCount(0);

  // 그 안의 폴더를 펼치면 다음 겹이다
  await assets.click();
  await expect(assets).toHaveAttribute("aria-expanded", "true");
  await expect(트리행(page, "logo.svg")).toBeVisible();
  expect((await ipcCallArgs(page, FOLDER, "path")).map(({ args }) => args.path)).toEqual(["dist", "dist/assets"]);

  // 접었다 다시 펼치면 또 읽는다 — 펼칠 때 읽는다(결정 37)
  await dist.click();
  await expect(dist).toHaveAttribute("aria-expanded", "false");
  await expect(트리행(page, "app.js")).toHaveCount(0);
  const before = await steadyCount(page, FOLDER);
  await dist.click();
  await expect(트리행(page, "app.js")).toBeVisible();
  await expect.poll(() => callCount(page, FOLDER)).toBeGreaterThan(before);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 한 겹이어도 빌드 산출물은 수만 개다(`target/debug/deps`) — 다 그리면 웹뷰가 몇 초씩 멈춘다. 코어가 상한까지만 싣고 나머지를
// 수로 말하면(`omitted`) 화면은 받은 행 아래에 그 수를 한 줄로 말한다: 행이 끝난 자리가 폴더의 끝이 아니다.
test("걸린 폴더의 한 겹이 상한에 걸려 잘려 오면 받은 행 아래에 싣지 않은 수가 선다", async ({ page }) => {
  await installFixtureBackend(page, {
    list_worktree_folder: answerByArg("path", {
      dist: { kind: "listed", entries: [worktreeFile("dist/a.o", true), worktreeFile("dist/b.o", true)], omitted: 76_440 },
    }),
  });
  await page.goto(`/works/${pinnedWork.slug}`);
  await openTree(page);
  await 트리행(page, "dist").click();

  await expect(트리행(page, "b.o")).toBeVisible();
  const note = 트리(page).getByText("그 밖에 76,440개는 그리지 않아요", { exact: true });
  await expect(note).toBeVisible();
  // 받은 행 다음 자리다
  const [last, below] = await Promise.all([트리행(page, "b.o").boundingBox(), note.boundingBox()]);
  expect(below!.y).toBeGreaterThan(last!.y);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 한때 머리의 「새로고침」이 실패한 겹을 다시 물었다 — 02a-14가 그 단추를 걷어, 다시 묻는 길은 접었다 펴기다(펼칠 때 읽는다 — 결정 37).
test("한 겹 명령이 실패하면 그 폴더 아래에 까닭 행이 서고, 나머지 트리는 그대로다 — 접었다 펴면 다시 묻는다", async ({ page }) => {
  await installFixtureBackend(page, { list_worktree_folder: ipcFailure("Permission denied (os error 13)") });
  await page.goto(`/works/${pinnedWork.slug}`);
  await openTree(page);
  const dist = 트리행(page, "dist");
  await dist.click();

  await expect(트리(page).getByText("읽지 못했어요 — Permission denied (os error 13)", { exact: true })).toBeVisible();
  await expect(dist).toHaveAttribute("aria-expanded", "true");
  await expect(트리행(page, "src")).toBeVisible();
  await expect(트리행(page, "README.md")).toBeVisible();

  // 코어가 답으로 「읽지 못함」을 말해도 같은 자리에 그 까닭이 선다
  await replaceAnswer(
    page,
    FOLDER,
    answerByArg("path", { dist: { kind: "unreadable", reason: "No such file or directory (os error 2)" } }),
  );
  await dist.click();
  await expect(dist).toHaveAttribute("aria-expanded", "false");
  await dist.click();
  await expect(
    트리(page).getByText("읽지 못했어요 — No such file or directory (os error 2)", { exact: true }),
  ).toBeVisible();
  await expect(트리(page).getByText(/Permission denied/)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("프로젝트가 둘이면 Project 줄이 둘 서고, 줄마다 그 프로젝트의 트리를 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}`);
  await openTree(page, "billing");
  await expect(트리행(page, "src")).toBeVisible();
  await expect(트리행(page, "lib")).toHaveCount(0);
  await expect(트리(page).getByRole("heading")).toHaveCount(0);

  // 넓힌 카드 목록의 다른 Project 줄을 누르면 그 트리다.
  await Project줄을누른다(page, "ledger");
  await expect(트리행(page, "lib")).toBeVisible();
  await expect(트리행(page, "Cargo.toml")).toBeVisible();
  await expect(트리행(page, "src")).toHaveCount(0);
  // 프로젝트마다 한 번 묻는다
  const asked = (await ipcCallArgs(page, COMMAND, "project")).map(({ args }) => `${args.slug}/${args.project}`);
  expect([...new Set(asked)].sort()).toEqual([`${multiWork.slug}/billing`, `${multiWork.slug}/ledger`]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("물었더니 워크트리가 없으면 트리 자리에 「워크트리 없음」이 선다", async ({ page }) => {
  await installFixtureBackend(page, {
    list_worktree_tree: answerByArg("project", { ...WORKTREE_TREES, billing: { kind: "worktreeMissing" } }),
  });
  await page.goto(`/works/${pinnedWork.slug}`);
  await openTree(page);

  await expect(트리(page).getByText("워크트리 없음", { exact: true })).toBeVisible();
  await expect(트리행(page, "src")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("트리는 Project 보기가 설 때만 묻는다 — work 목록의 신호에는 다시 묻지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(요약카드단추(page)).toBeVisible();
  // 트리가 서지 않은 동안에는 묻지 않는다(S9).
  expect(await steadyCount(page, COMMAND)).toBe(0);

  await openTree(page);
  await expect(트리행(page, "src")).toBeVisible();
  const shown = await steadyCount(page, COMMAND);
  expect(shown).toBeGreaterThan(0);

  // 워크트리 키는 `works` 접두사 밖이다(S8) — work 목록이 바뀌었다는 신호가 트리까지 다시 읽지 않는다
  const lists = await steadyCount(page, "list_works");
  await fireEventToAll(page, "works:changed", null);
  await expect.poll(() => callCount(page, "list_works")).toBeGreaterThan(lists);
  await steadyCount(page, "list_works");
  expect(await steadyCount(page, COMMAND)).toBe(shown);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("펼친 폴더는 넓힌 카드를 닫았다 열어도, 다른 work에 갔다 와도 펼쳐져 있다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openTree(page);
  const src = 트리행(page, "src");
  await src.click();
  await expect(src).toHaveAttribute("aria-expanded", "true");

  // 넓힌 카드를 닫았다(「카드로 접기」 — 작은 요약 카드로 돌아온다) 그 Project 줄로 다시 연다.
  await page.getByRole("button", { name: "카드로 접기", exact: true }).click();
  await expect(트리(page)).toHaveCount(0);
  await expect(요약카드단추(page)).toHaveAttribute("aria-pressed", "true");
  await openTree(page, "billing");
  await expect(src).toHaveAttribute("aria-expanded", "true");

  // 다른 work에 갔다 온다(⌘K의 Work 줄 — v1 티켓 37) — 기억은 work마다 따로다: 같은 프로젝트(billing)라도 그 work에서는 접힌 채 선다
  await 작업화면으로(page, multiWork);
  await openTree(page, "billing");
  await expect(src).toHaveAttribute("aria-expanded", "false");
  await 작업화면으로(page, pinnedWork);
  await openTree(page, "billing");
  await expect(src).toHaveAttribute("aria-expanded", "true");
  await expect(트리행(page, "index.ts")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
