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
} from "./harness";

// git-integration 판 01 티켓 01 — **files 칸에 워크트리 트리가 선다.**
//
// 레일의 `files` 칸을 누르면 작업 패널에 그 work의 워크트리 트리가 뜬다(스토리 1 · 2). 트리는 코어가 세워 보낸 것을 그리기만
// 한다 — 걸리지 않은 것과 걸린 것을 가르는 규칙, 폴더 먼저 · 이름순은 L1(`worktree.rs`)이 진짜 저장소로 잰다. 이 층이 재는
// 것은 화면이다: 칸 · 구획 · 처음 펼침 · 흐림의 말 · 「워크트리 없음」 · 언제 묻는가 · 접힘 기억.
//
// 티켓 02 — **걸린 폴더를 펼치면 한 겹 읽힌다.** 걸린 폴더는 트리 목록이 「아직 안 읽음」으로 보낸다. 펼칠 때 그 바로 아래만
// 묻고(스토리 20), 묻는 동안 「읽는 중」이 선다(스토리 21). 한 겹만 읽는 규칙은 L1(`worktree.rs`)이 잰다.
//
// 픽스처: `pinned-work`는 프로젝트 하나(`billing`), `multi-work`는 둘(`billing` · `ledger`)이다. 트리는 `WORKTREE_TREES`,
// 걸린 폴더의 한 겹은 `WORKTREE_FOLDERS`다.

const [pinnedWork, , multiWork] = WORKS;
const COMMAND = "list_worktree_tree";
/** 걸린 폴더의 한 겹(티켓 02) — 그 폴더를 펼칠 때 묻는다. */
const FOLDER = "list_worktree_folder";

const 레일 = (page: Page) => page.getByRole("group", { name: "레일", exact: true });
const 레일칸 = (page: Page, name: "spec" | "chat" | "files") => 레일(page).getByRole("button", { name, exact: true });
const 토글 = (page: Page) => page.getByRole("button", { name: /^작업 패널 (접기|펼치기)$/ });
const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });
const 패널머리 = (page: Page) => 작업패널(page).locator('[data-slot="card-head"]');
/** 트리의 행 — 폴더 행은 이름이 곧 이름이고, 파일 행은 확장자 꼬리표가 앞에 붙는다(`MD README.md`). */
const 행 = (scope: Locator, name: string) => scope.getByRole("button", { name, exact: true });
const 패널행 = (page: Page, name: string) => 행(작업패널(page), name);
/** 구획 — 프로젝트가 둘 이상일 때만 머리(프로젝트 표시 이름)가 서고, 그 머리가 구획의 이름이다. */
const 구획 = (page: Page, name: string) => 작업패널(page).getByRole("group", { name, exact: true });
/** 작업 패널 칸(두 번째 `aside`)의 그려진 폭 — 접히면 0이다. */
const 패널폭 = (page: Page) => page.locator("aside").nth(1).evaluate((el) => Math.round(el.getBoundingClientRect().width));
const 사이드바work = (page: Page, title: string) => page.locator("aside").getByRole("button", { name: title, exact: true });

/** files 칸을 열고 트리가 선 것을 본다. */
async function openFiles(page: Page): Promise<void> {
  await 레일칸(page, "files").click();
  await expect(레일칸(page, "files")).toHaveAttribute("aria-pressed", "true");
}

test("레일의 `files` 칸이 `spec` · `chat` 뒤에 서고, 켜짐을 `aria-pressed`로 말하며, `spec`과 한 번에 하나만 켜진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  // 앵커: 레일이 섰다 — 서기 전에 칸 목록을 읽으면 빈 목록이다
  await expect(레일칸(page, "spec")).toBeVisible();
  // 결정 29 — `spec · chat · files`(`chat`은 three-axes의 칸이다 — `spec` 바로 뒤. info 칸은 codex-ds 결정 25로 걷혔다). 라벨은 소문자 영어다.
  expect(await 레일(page).getByRole("button").evaluateAll((all) => all.map((el) => el.getAttribute("aria-label")))).toEqual([
    "spec",
    "chat",
    "files",
  ]);
  const spec = 레일칸(page, "spec");
  const files = 레일칸(page, "files");
  await expect(spec).toHaveAttribute("aria-pressed", "true");
  await expect(files).toHaveAttribute("aria-pressed", "false");

  // 칸을 누르면 그 몸이 선다 — 머리 제목과 트리가 함께 갈렸는가를 잰다(칸의 켜짐만 보면 「몸은 그대로」가 통과한다).
  await files.click();
  await expect(files).toHaveAttribute("aria-pressed", "true");
  await expect(spec).toHaveAttribute("aria-pressed", "false");
  await expect(패널머리(page)).toHaveText("files");
  await expect(패널행(page, "src")).toBeVisible();
  await expect(패널행(page, "overview.md")).toHaveCount(0);

  // `spec`과 오가며 한 번에 하나만 켜진다
  await spec.click();
  await expect(spec).toHaveAttribute("aria-pressed", "true");
  await expect(files).toHaveAttribute("aria-pressed", "false");
  await expect(패널행(page, "overview.md")).toBeVisible();
  await expect(패널행(page, "src")).toHaveCount(0);
  await files.click();
  await expect(files).toHaveAttribute("aria-pressed", "true");
  await expect(spec).toHaveAttribute("aria-pressed", "false");

  // 켜진 칸을 다시 누르면 패널이 닫힌다(스토리 3 — 레일의 다른 칸과 같다). 레일은 남는다.
  await files.click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "false");
  await expect(files).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => 패널폭(page)).toBe(0);
  await expect(files).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("트리는 프로젝트 루트만 펼쳐 서고, 걸린 것은 흐린 글자로 「gitignore에 걸림」을 말한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);

  // 루트 바로 아래가 받은 순서 그대로 서고, 폴더는 모두 접혀 있다(스토리 8). 안쪽 파일은 아직 안 보인다.
  for (const folder of [".github", "dist", "src"]) {
    await expect(패널행(page, folder), folder).toHaveAttribute("aria-expanded", "false");
  }
  for (const file of [".env", ".gitignore", "MD README.md"]) {
    await expect(패널행(page, file), file).toBeVisible();
  }
  await expect(패널행(page, "TS index.ts")).toHaveCount(0);
  await expect(패널행(page, "YML ci.yml")).toHaveCount(0);
  // 프로젝트가 하나면 구획 머리가 없다(S13)
  await expect(작업패널(page).getByRole("heading")).toHaveCount(0);

  // 폴더를 누르면 펼친다 — 한 겹만이다(안쪽 폴더는 접힌 채)
  await 패널행(page, "src").click();
  await expect(패널행(page, "src")).toHaveAttribute("aria-expanded", "true");
  await expect(패널행(page, "TS index.ts")).toBeVisible();
  await expect(패널행(page, "api")).toHaveAttribute("aria-expanded", "false");

  // 걸린 것은 접근성 설명으로 그 까닭을 말하고(스토리 88), 글자가 흐리다(스토리 19). 걸리지 않은 행은 설명이 없다.
  await expect(패널행(page, "dist")).toHaveAccessibleDescription("gitignore에 걸림");
  await expect(패널행(page, ".env")).toHaveAccessibleDescription("gitignore에 걸림");
  await expect(패널행(page, "src")).toHaveAccessibleDescription("");
  await expect(패널행(page, "MD README.md")).toHaveAccessibleDescription("");
  const colorOf = (name: string) => 패널행(page, name).evaluate((el) => getComputedStyle(el).color);
  expect(await colorOf(".env")).not.toBe(await colorOf("MD README.md"));
  expect(await colorOf("dist")).not.toBe(await colorOf("src"));
  // 걸린 폴더는 접힌 채 서고, 펼치기 전에는 그 안을 묻지 않는다(스토리 20)
  expect(await callCount(page, FOLDER)).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("하위 모듈과 심링크는 펼치지 않는 파일 행이고, 하위 모듈만 제 글리프와 「하위 모듈」을 말한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);

  // 하위 모듈은 다른 저장소라 펼치지 않는다(S3) — 폴더 쪽에 서도 펼침을 말하지 않는 파일 행이다. 확장자 꼬리표 대신
  // `FolderGit2` 글리프가 서고, 화면 읽기로 「하위 모듈」을 듣는다(스토리 88).
  const submodule = 패널행(page, "vendor-ui");
  await expect(submodule).toBeVisible();
  await expect(submodule).not.toHaveAttribute("aria-expanded");
  await expect(submodule).toHaveAccessibleDescription("하위 모듈");
  await expect(submodule.locator("svg.lucide-folder-git-2")).toHaveCount(1);

  // 심링크는 따라가지 않는다 — 폴더를 가리켜도 그 자리의 파일 행이고 따로 표시하지 않는다(01).
  const link = 패널행(page, "docs");
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute("aria-expanded");
  await expect(link).toHaveAccessibleDescription("");
  await expect(link.locator("svg")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("걸린 폴더를 펼치면 「읽는 중」 뒤에 한 겹이 서고, 그 안의 폴더를 펼치면 다음 겹을 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);
  const dist = 패널행(page, "dist");
  await expect(dist).toHaveAttribute("aria-expanded", "false");

  // 읽기를 붙잡아 「읽는 중」을 러너 속도와 상관없이 본다(스토리 21)
  await holdCommand(page, FOLDER);
  await dist.click();
  // 걸린 폴더 행도 펼쳐짐을 말한다(스토리 88)
  await expect(dist).toHaveAttribute("aria-expanded", "true");
  await expect(작업패널(page).getByText("읽는 중…", { exact: true })).toBeVisible();
  await expect(패널행(page, "JS app.js")).toHaveCount(0);
  await releaseCommand(page, FOLDER);
  await expect(패널행(page, "JS app.js")).toBeVisible();
  await expect(작업패널(page).getByText("읽는 중…", { exact: true })).toHaveCount(0);
  // 한 겹 명령이 그 폴더의 (slug, 프로젝트, 경로)로 한 번 불렸다
  expect((await ipcCallArgs(page, FOLDER, "path")).map(({ args }) => args)).toEqual([
    { slug: pinnedWork.slug, project: "billing", path: "dist" },
  ]);

  // 잘리지 않은 답에는 싣지 않은 수가 없다
  await expect(작업패널(page).getByText(/^그 밖에/)).toHaveCount(0);

  // 안의 것은 모두 걸린 것이다 — 흐린 글자와 그 까닭. 자식 폴더는 아직 안 읽어 접힌 채다
  await expect(패널행(page, "JS app.js")).toHaveAccessibleDescription("gitignore에 걸림");
  const assets = 패널행(page, "assets");
  await expect(assets).toHaveAccessibleDescription("gitignore에 걸림");
  await expect(assets).toHaveAttribute("aria-expanded", "false");
  await expect(패널행(page, "SVG logo.svg")).toHaveCount(0);

  // 그 안의 폴더를 펼치면 다음 겹이다
  await assets.click();
  await expect(assets).toHaveAttribute("aria-expanded", "true");
  await expect(패널행(page, "SVG logo.svg")).toBeVisible();
  expect((await ipcCallArgs(page, FOLDER, "path")).map(({ args }) => args.path)).toEqual(["dist", "dist/assets"]);

  // 접었다 다시 펼치면 또 읽는다 — 펼칠 때 읽는다(결정 37)
  await dist.click();
  await expect(dist).toHaveAttribute("aria-expanded", "false");
  await expect(패널행(page, "JS app.js")).toHaveCount(0);
  const before = await steadyCount(page, FOLDER);
  await dist.click();
  await expect(패널행(page, "JS app.js")).toBeVisible();
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
  await openFiles(page);
  await 패널행(page, "dist").click();

  await expect(패널행(page, "O b.o")).toBeVisible();
  const note = 작업패널(page).getByText("그 밖에 76,440개는 그리지 않아요", { exact: true });
  await expect(note).toBeVisible();
  // 받은 행 다음 자리다
  const [last, below] = await Promise.all([패널행(page, "O b.o").boundingBox(), note.boundingBox()]);
  expect(below!.y).toBeGreaterThan(last!.y);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("새로고침 버튼이 트리 목록과 펼쳐 둔 걸린 폴더의 한 겹을 다시 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);
  await 패널행(page, "dist").click();
  await 패널행(page, "assets").click();
  await expect(패널행(page, "SVG logo.svg")).toBeVisible();
  const trees = await steadyCount(page, COMMAND);
  const folders = await steadyCount(page, FOLDER);

  await 패널머리(page).getByRole("button", { name: "새로고침", exact: true }).click();
  await expect.poll(() => callCount(page, COMMAND)).toBeGreaterThan(trees);
  // 펼쳐 둔 걸린 폴더 둘이 다시 불린다
  await expect
    .poll(async () => (await ipcCallArgs(page, FOLDER, "path")).slice(folders).map(({ args }) => args.path).sort())
    .toEqual(["dist", "dist/assets"]);
  // 다시 읽는 동안에도 행은 그대로 서 있다 — 「읽는 중」으로 돌아가지 않는다
  await expect(패널행(page, "SVG logo.svg")).toBeVisible();
  await expect(패널행(page, "JS app.js")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("한 겹 명령이 실패하면 그 폴더 아래에 까닭 행이 서고, 나머지 트리는 그대로다", async ({ page }) => {
  await installFixtureBackend(page, { list_worktree_folder: ipcFailure("Permission denied (os error 13)") });
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);
  const dist = 패널행(page, "dist");
  await dist.click();

  await expect(작업패널(page).getByText("읽지 못했어요 — Permission denied (os error 13)", { exact: true })).toBeVisible();
  await expect(dist).toHaveAttribute("aria-expanded", "true");
  await expect(패널행(page, "src")).toBeVisible();
  await expect(패널행(page, "MD README.md")).toBeVisible();

  // 코어가 답으로 「읽지 못함」을 말해도 같은 자리에 그 까닭이 선다 — 새로고침이 다시 묻는다
  await replaceAnswer(
    page,
    FOLDER,
    answerByArg("path", { dist: { kind: "unreadable", reason: "No such file or directory (os error 2)" } }),
  );
  await 패널머리(page).getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(
    작업패널(page).getByText("읽지 못했어요 — No such file or directory (os error 2)", { exact: true }),
  ).toBeVisible();
  await expect(작업패널(page).getByText(/Permission denied/)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("프로젝트가 둘이면 구획 머리가 프로젝트 표시 이름으로 둘 서고, 구획마다 그 프로젝트의 트리다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}`);
  await openFiles(page);

  await expect(작업패널(page).getByRole("heading")).toHaveText(["빌링", "원장"]);
  await expect(행(구획(page, "빌링"), "src")).toBeVisible();
  await expect(행(구획(page, "빌링"), "lib")).toHaveCount(0);
  await expect(행(구획(page, "원장"), "lib")).toBeVisible();
  await expect(행(구획(page, "원장"), "TOML Cargo.toml")).toBeVisible();
  // 프로젝트마다 한 번 묻는다
  const asked = (await ipcCallArgs(page, COMMAND, "project")).map(({ args }) => `${args.slug}/${args.project}`);
  expect([...new Set(asked)].sort()).toEqual([`${multiWork.slug}/billing`, `${multiWork.slug}/ledger`]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("워크트리가 없는 프로젝트의 구획에는 「워크트리 없음」이 선다", async ({ page }) => {
  // 둘 다 「없음」이다 — 원장은 work 목록이 이미 없다고 말하고(묻지 않는다), 빌링은 물었더니 코어가 없다고 답한다.
  const works = WORKS.map((work) =>
    work.slug === multiWork.slug
      ? { ...work, worktrees: work.worktrees.map((tree) => (tree.project === "ledger" ? { ...tree, exists: false } : tree)) }
      : work,
  );
  await installFixtureBackend(page, {
    list_works: works,
    list_worktree_tree: answerByArg("project", { ...WORKTREE_TREES, billing: { kind: "worktreeMissing" } }),
  });
  await page.goto(`/works/${multiWork.slug}`);
  await openFiles(page);

  await expect(구획(page, "빌링").getByText("워크트리 없음", { exact: true })).toBeVisible();
  await expect(구획(page, "원장").getByText("워크트리 없음", { exact: true })).toBeVisible();
  await expect(작업패널(page).getByRole("button", { name: "src", exact: true })).toHaveCount(0);
  const asked = (await ipcCallArgs(page, COMMAND, "project")).map(({ args }) => args.project);
  expect(asked).not.toContain("ledger");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("트리는 칸이 보일 때만 묻고, 새로고침 버튼이 다시 묻는다 — work 목록의 신호에는 다시 묻지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(패널행(page, "overview.md")).toBeVisible();
  // 칸이 숨어 있는 동안에는 묻지 않는다(S9) — 패널 몸은 숨어도 마운트된 채다. `spec` 칸이 켜진 동안 files 몸은 숨어 있다.
  expect(await steadyCount(page, COMMAND)).toBe(0);

  await openFiles(page);
  await expect(패널행(page, "src")).toBeVisible();
  const shown = await steadyCount(page, COMMAND);
  expect(shown).toBeGreaterThan(0);

  // 새로고침 버튼(스토리 16) — 머리에 선다
  await 패널머리(page).getByRole("button", { name: "새로고침", exact: true }).click();
  await expect.poll(() => callCount(page, COMMAND)).toBeGreaterThan(shown);
  const refreshed = await steadyCount(page, COMMAND);
  await expect(패널행(page, "src")).toBeVisible();

  // 워크트리 키는 `works` 접두사 밖이다(S8) — work 목록이 바뀌었다는 신호가 트리까지 다시 읽지 않는다
  const lists = await steadyCount(page, "list_works");
  await fireEventToAll(page, "works:changed", null);
  await expect.poll(() => callCount(page, "list_works")).toBeGreaterThan(lists);
  await steadyCount(page, "list_works");
  expect(await steadyCount(page, COMMAND)).toBe(refreshed);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("펼친 폴더는 칸을 껐다 켜도, 패널을 접었다 펴도, 다른 work에 갔다 와도 펼쳐져 있다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await openFiles(page);
  const src = 패널행(page, "src");
  await src.click();
  await expect(src).toHaveAttribute("aria-expanded", "true");

  // 칸을 껐다 켠다(spec에 다녀온다)
  await 레일칸(page, "spec").click();
  await expect(src).toHaveCount(0);
  await openFiles(page);
  await expect(src).toHaveAttribute("aria-expanded", "true");

  // 패널을 접었다 편다 — spec 트리는 접기에 리셋되지만 files 트리는 아니다(S14)
  await 토글(page).click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => 패널폭(page)).toBe(0);
  await 토글(page).click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "true");
  await expect(src).toHaveAttribute("aria-expanded", "true");

  // 다른 work에 갔다 온다 — 기억은 work마다 따로다: 같은 프로젝트(빌링)라도 그 work에서는 접힌 채 선다
  await 사이드바work(page, multiWork.title).click();
  await expect(행(구획(page, "빌링"), "src")).toHaveAttribute("aria-expanded", "false");
  await 사이드바work(page, pinnedWork.title).click();
  await expect(작업패널(page).getByRole("heading")).toHaveCount(0);
  await expect(src).toHaveAttribute("aria-expanded", "true");
  await expect(패널행(page, "TS index.ts")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
