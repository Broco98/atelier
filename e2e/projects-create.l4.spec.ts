import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { installRealBackend, unknownIpcCalls, 폴더를고른다 } from "./harness";
import { expect, forgetGitPerson, GIT_PERSON, test, type Sandbox } from "./l4";
import type { Page } from "./evidence";

// 판 1이 관통이라고 부르는 것. 화면에서 폴더를 고르면 **진짜 파일이 생기고** 그 파일을
// 다시 읽어 목록이 그린다 — 쓰기와 읽기가 한 번에 걸린다.
//
// 순서에 뜻이 있다: 파일을 먼저 보고 그 다음 화면을 본다. 파일이 없으면 쓰는 다리가
// 끊긴 것이고, 파일은 있는데 화면이 없으면 읽는 다리가 끊긴 것이다 — 고칠 곳이 다르다.
//
// 03 티켓 13 — 추가 창(03 구현 스펙 §15 · 티켓 09)의 세 길을 진짜 core · git으로 탄다. 「git init 하고 추가」와 「새로 만들기」는 진짜 git이
// 폴더 · 브랜치 `main` · 빈 첫 커밋 「init」을 만들고 기준 브랜치가 `main`이다. git의 사람은 sandbox의 설정 파일이다(`l4.ts`의
// `GIT_PERSON` · `bridge.ts`의 환경) — 첫 커밋의 사람이 그 값이면 다리가 검사 기계의 `~/.gitconfig`를 타지 않았다. 사람이 없으면 첫 커밋이
// 실패하고, 창이 그 git의 글을 말하며 만들던 폴더는 남지 않는다.

/** 추가 창 — 빈 목록 가운데의 「Project 추가」가 연다. 창 밖에도 같은 이름의 단추가 있어 창 안으로 좁혀 쓴다. */
const addDialog = (page: Page) => page.getByRole("dialog", { name: "Project 추가", exact: true });

async function openAddDialog(page: Page) {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "아직 Project가 없어요", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Project 추가", exact: true }).click();
  await expect(addDialog(page)).toBeVisible();
  return addDialog(page);
}

/** 진짜 git에게 묻는다 — 그 폴더의 지금 브랜치 · 커밋 수 · 마지막 커밋의 제목과 사람. */
function gitFacts(folder: string) {
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8" }).trim();
  return {
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    commits: git("rev-list", "--count", "HEAD"),
    last: git("log", "-1", "--format=%s · %an <%ae>"),
  };
}

test("폴더를 고르면 진짜 파일이 생기고 그 Project의 상세가 선다", async ({ page, sandbox }) => {
  const { home, pickedFolder } = sandbox;
  await installRealBackend(page, sandbox);
  const dialog = await openAddDialog(page);

  // 「추가」가 폴더 선택창을 연다 — sandbox의 `pickedFolder`(git 저장소 · 원격 없음)가 답이다. core가 그 폴더를 살핀 답이 줄에 선다.
  await dialog.getByRole("button", { name: "추가", exact: true }).click();
  await expect(dialog.getByText("git 레포 · 원격 없음", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Project 추가", exact: true }).click();

  // 다리를 타고 파일시스템까지 다녀오므로 즉시가 아니다.
  await expect.poll(() => projectFiles(home)).toHaveLength(1);
  const slug = projectFiles(home)[0].replace(/\.md$/, "");
  const written = readFileSync(join(home, "projects", `${slug}.md`), "utf8");
  // 코어가 경로를 canonicalize한다 — macOS에서 /var는 /private/var로 풀린다.
  expect(written).toContain(realpathSync(pickedFolder));
  expect(written).toMatch(/^baseBranch: main$/m);

  // 추가한 Project의 상세로 간다 — 이름은 고른 폴더 이름이다(이름 칸을 비워 두면 따라간다).
  await expect(page).toHaveURL(`/projects/${slug}`);
  const name = basename(pickedFolder);
  await expect(page.getByRole("button", { name: `${name} — 이름 바꾸기`, exact: true })).toBeVisible();

  // 화이트리스트 밖 호출이 하나라도 있으면 하네스가 낡은 것이다.
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("git 저장소가 아닌 폴더는 「git init 하고 추가」로 진짜 git이 브랜치 main · 첫 커밋을 만들고 기준 브랜치가 main이다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  const plain = join(home, "..", "notes");
  mkdirSync(plain);
  writeFileSync(join(plain, "README.md"), "# 메모\n");
  await installRealBackend(page, sandbox);
  const dialog = await openAddDialog(page);

  await 폴더를고른다(page, plain);
  await dialog.getByRole("button", { name: "추가", exact: true }).click();
  await expect(dialog.getByText("폴더 · git 저장소 아님", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "git init 하고 추가", exact: true }).click();

  await expect.poll(() => projectFiles(home)).toHaveLength(1);
  // 파일은 그대로이고 그 폴더가 저장소가 됐다 — 브랜치 main, 빈 첫 커밋 「init」 하나, 사람은 sandbox의 git 설정이다.
  expect(readFileSync(join(plain, "README.md"), "utf8")).toBe("# 메모\n");
  expect(gitFacts(plain)).toEqual({ branch: "main", commits: "1", last: `init · ${GIT_PERSON.name} <${GIT_PERSON.email}>` });
  const slug = projectFiles(home)[0].replace(/\.md$/, "");
  expect(readFileSync(join(home, "projects", `${slug}.md`), "utf8")).toMatch(/^baseBranch: main$/m);

  await expect(page).toHaveURL(`/projects/${slug}`);
  await expect(page.getByRole("combobox", { name: "기준 브랜치", exact: true })).toContainText("main");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/**
 * 「새로 만들기」로 갈아 타고 부모를 sandbox로 옮긴 뒤 이름을 친다. **자리 줄이 sandbox를 말하기 전에는 누르지 않는다** — 기본 부모
 * (`~/MyProjects`)는 진짜 집이라, 「위치 바꾸기」가 안 먹은 채 누르면 검사 기계의 집에 폴더가 선다.
 */
async function makeNew(page: Page, sandbox: Sandbox, name: string, folder: string) {
  const dialog = await openAddDialog(page);
  await dialog.getByRole("button", { name: "이 컴퓨터의 폴더 추가", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^새로 만들기/ }).click();
  await 폴더를고른다(page, sandbox.newParent);
  await dialog.getByRole("button", { name: "위치 바꾸기", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Project 이름", exact: true }).fill(name);
  await expect(dialog.getByText(`${sandbox.newParent}/${folder}`, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Project 만들기", exact: true }).click();
  return dialog;
}

test("「새로 만들기」는 고른 부모 아래에 이름의 폴더를 만들고 진짜 git이 브랜치 main · 첫 커밋을 만들며 기준 브랜치가 main이다", async ({
  page,
  sandbox,
}) => {
  const { home, newParent } = sandbox;
  await installRealBackend(page, sandbox);
  await makeNew(page, sandbox, "Landing Page", "landing-page");

  await expect.poll(() => projectFiles(home)).toEqual(["landing-page.md"]);
  const made = join(newParent, "landing-page");
  // 빈 폴더에 저장소 하나 — 폴더 안에는 `.git`뿐이다.
  expect(readdirSync(made)).toEqual([".git"]);
  expect(gitFacts(made)).toEqual({ branch: "main", commits: "1", last: `init · ${GIT_PERSON.name} <${GIT_PERSON.email}>` });
  const written = readFileSync(join(home, "projects", "landing-page.md"), "utf8");
  expect(written).toContain(realpathSync(made));
  expect(written).toMatch(/^name: Landing Page$/m);
  expect(written).toMatch(/^baseBranch: main$/m);

  await expect(page).toHaveURL("/projects/landing-page");
  await expect(page.getByRole("button", { name: "Landing Page — 이름 바꾸기", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "기준 브랜치", exact: true })).toContainText("main");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("git에 사람(이름 · 이메일)이 없으면 「새로 만들기」가 git의 글로 실패하고 만들던 폴더가 남지 않는다", async ({ page, sandbox }) => {
  const { home, newParent } = sandbox;
  forgetGitPerson(sandbox);
  await installRealBackend(page, sandbox);
  const dialog = await makeNew(page, sandbox, "Landing Page", "landing-page");

  // 창은 그대로 서고 오른쪽 아래 단추 위에 실패 글이 선다 — 앞은 앱의 말, 뒤는 git이 적은 글(사람을 모른다)이다.
  const failed = dialog.getByRole("alert");
  await expect(failed).toHaveText(/^만들지 못했어요 — .*Author identity unknown/s);
  await expect(dialog).toBeVisible();
  expect(existsSync(join(newParent, "landing-page")), "만들던 폴더가 남았다").toBe(false);
  expect(projectFiles(home)).toEqual([]);
  await expect(page).toHaveURL("/projects");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

function projectFiles(home: string): string[] {
  try {
    return readdirSync(join(home, "projects")).filter((name) => name.endsWith(".md"));
  } catch {
    // 아직 코어가 폴더를 안 만들었을 뿐이다 — poll이 다시 부른다.
    return [];
  }
}
