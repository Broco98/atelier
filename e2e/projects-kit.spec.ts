import { expect, test, type Page } from "./evidence";
import { answerByArg, PROJECTS, SPACES, WORKS } from "./fixtures";
import {
  clipboardWrites,
  fireEvent,
  installFixtureBackend,
  ipcArgs,
  ipcFailure,
  recordClipboard,
  replaceAnswer,
  unknownIpcCalls,
  몸줄,
  본문,
  오류창,
  칠한값,
  표줄,
  폴더를고른다,
  화면토스트,
} from "./harness";
import type { FolderLook, NewProjectPlace, ProjectView } from "@/features/projects/types";

// 03 구현 스펙 Testing 「Projects(`F4-KitProject`)」 — Projects 흐름 하나. 상황 모음판의 칸이 곧 경우다: 목록 줄(hover · 찾을 수 없음 · ⋯ 두
// 갈래) · 추가 창의 소스 폴더 갈래(비어 있음 · git 레포 · git 아님 · 하위 폴더 · 이미 추가됨 · 새로 만들기 · 새로 만들기 — 폴더가 이미 있음) ·
// 제거 창 셋과 지운 뒤 · 상세 조각(제목 고치기 · 찾을 수 없음), 그리고 끌어 놓기(Tauri 끌어 놓기 사건을 이 층이 낸다).
//
// 같은 것을 두 번 재지 않는다 — 다른 spec이 재는 것:
//   목록 표 그리기 · 줄 → 상세 · 상세의 기준 브랜치 목록(키 · 묶음 · IPC · 같은 값)   `projects-list.spec.ts`
//   상세 제목 고치기의 저장 규칙(Enter · 다른 곳 · Esc · 비움 · 그대로) · 편집 메뉴    `inline-rename.spec.ts` · `edit-menu.spec.ts`
//
// 이 층에는 core가 없다 — 살피기(`inspect_project_folder`) · 자리(`new_project_place`)의 답은 시험이 경로마다 둔 것이고, 추가 · 고치기의 답은
// 값을 기억하지 않는다. 재는 것은 「무엇이 나갔나」(IPC와 그 인자)와 「받은 답을 어떻게 그렸나」다. 진짜 git이 폴더 · 브랜치 · 첫 커밋을
// 만드는 것과 git 이름이 없을 때의 실패는 L4(`projects-create.l4.spec.ts`)가 잰다.

const [billing, ledger] = PROJECTS;

/** 폴더를 찾을 수 없는 Project — 옮겼거나 지웠다(스토리 101). */
const playground: ProjectView = {
  slug: "playground",
  name: "playground",
  path: "~/MyProjects/playground",
  baseBranch: "main",
  createdAt: "2026-01-04T03:04:05Z",
  description: "",
  git: null,
  missing: true,
};

/** 추가 창에서 고를 저장소 — 고르면 이 Project가 된다. */
const webApp: ProjectView = {
  slug: "web-app",
  name: "web-app",
  path: "~/MyProjects/web-app",
  baseBranch: "develop",
  createdAt: "2026-10-26T03:04:05Z",
  description: "",
  git: { remoteSlug: "acme/web-app", currentBranch: "develop", localBranches: ["develop", "main"], remoteBranches: [] },
  missing: false,
};

/** 폴더 선택창이 돌려주는 절대 경로들 — 살피기가 받아 화면의 꼴(`~/…`)로 돌려준다. */
const 고른곳 = {
  webApp: "/Users/tester/MyProjects/web-app",
  notes: "/Users/tester/Documents/notes",
  crates: "/Users/tester/Developer/atelier/crates",
  billing: "/Users/tester/dev/billing",
  gone: "/Users/tester/gone",
} as const;

/** 살피기의 답 — 폴더 경로마다(core `inspect_folder`가 짓는 모양). */
const 살핀답: Record<string, FolderLook> = {
  [고른곳.webApp]: { kind: "repo", path: webApp.path, baseBranch: "develop", remotes: ["origin"], git: webApp.git! },
  [webApp.path]: { kind: "repo", path: webApp.path, baseBranch: "develop", remotes: ["origin"], git: webApp.git! },
  [고른곳.notes]: { kind: "notGit", path: "~/Documents/notes" },
  [고른곳.crates]: { kind: "subfolder", path: "~/Developer/atelier/crates", root: "~/Developer/atelier", baseBranch: "main" },
  "~/Developer/atelier": {
    kind: "repo",
    path: "~/Developer/atelier",
    baseBranch: "main",
    remotes: ["origin"],
    git: { remoteSlug: "broco/atelier", currentBranch: "main", localBranches: ["main"], remoteBranches: [] },
  },
  [고른곳.billing]: { kind: "registered", path: billing.path, project: billing },
  [고른곳.gone]: { kind: "missing", path: "~/gone" },
};
const 살피기 = answerByArg("folder", 살핀답);

const 목록 = (page: Page) => page.getByRole("table", { name: "Project 목록", exact: true });
const 줄 = (page: Page, name: string) => 표줄(목록(page), name);
const 메뉴 = (page: Page) => page.getByRole("menu");
const 항목 = (page: Page, name: string) => 메뉴(page).getByRole("menuitem", { name, exact: true });

// ── 추가 창 ──
const 추가창 = (page: Page) => page.getByRole("dialog", { name: "Project 추가", exact: true });
const 이름칸 = (page: Page) => 추가창(page).getByRole("textbox", { name: "Project 이름", exact: true });
/** 오른쪽 아래 단추 — 갈래마다 글이 바뀐다(Project 추가 · git init 하고 추가 · Project 만들기). */
const 아래단추 = (page: Page, name: string) => 추가창(page).getByRole("button", { name, exact: true });
/** 칸 안의 안내 상자(시안 `.ntc`) — 경고 · 알림 모두 `status`다. */
const 안내상자 = (page: Page) => 추가창(page).getByRole("status");

/** Projects 목록에서 「Project 추가」로 추가 창을 연다. */
async function 추가창을연다(page: Page): Promise<void> {
  await 본문(page, "Projects").getByRole("button", { name: "Project 추가", exact: true }).click();
  await expect(추가창(page)).toBeVisible();
  await expect(이름칸(page)).toBeFocused();
}

/** 「이 컴퓨터의 폴더 추가」의 「추가」 — 폴더 선택창이 그 경로를 돌려준다. */
async function 폴더를추가한다(page: Page, folder: string): Promise<void> {
  await 폴더를고른다(page, folder);
  await 추가창(page).getByRole("button", { name: "추가", exact: true }).click();
}

/** 소스 폴더 스위치 — 단추의 이름이 지금 갈래이고, 누르면 두 길(라디오 — 이름 뒤에 설명 한 줄)이 선다. */
async function 소스를바꾼다(page: Page, from: string, to: "이 컴퓨터의 폴더 추가" | "새로 만들기"): Promise<void> {
  await 추가창(page).getByRole("button", { name: from, exact: true }).click();
  const 길 = page.getByRole("menuitemradio");
  await expect(길).toHaveText(["이 컴퓨터의 폴더 추가이미 있는 git 레포를 그대로 써요. 코드는 옮기지 않아요.", "새로 만들기빈 폴더를 만들고 git 레포로 시작해요."]);
  // 접근 이름은 머리 글자만, 설명은 따로다(03 코드 리뷰 P13).
  await expect(page.getByRole("menuitemradio", { name: "새로 만들기", exact: true })).toHaveAccessibleDescription("빈 폴더를 만들고 git 레포로 시작해요.");
  await page.getByRole("menuitemradio", { name: to, exact: true }).click();
}

test.describe("목록 줄", () => {
  test("찾을 수 없는 Project 줄은 「Project를 찾을 수 없어요 · 재설정」이고, hover면 이름 옆에 ›가 서며, 찾기는 이름 · 경로에 걸린다", async ({
    page,
  }) => {
    await installFixtureBackend(page, { list_projects: [...PROJECTS, playground] });
    await page.goto("/projects");

    // 찾을 수 없는 줄 — 경로 칸에 「⚠ Project를 찾을 수 없어요 · 경로」, 기준 브랜치 칸에 「재설정」(스토리 101).
    await expect(줄(page, playground.name).getByRole("cell")).toHaveText([
      playground.name,
      `Project를 찾을 수 없어요${playground.path}`,
      "재설정",
      "",
    ]);
    await expect(본문(page, "Projects").getByText("폴더를 이 창에 끌어다 놓아도 추가돼요", { exact: true })).toBeVisible();

    // hover면 이름 끝 꺾쇠가 선다(스토리 95) — 지나기 전에는 숨어 있다.
    const 꺾쇠 = 줄(page, ledger.name).getByRole("link").locator("svg").last();
    await expect.poll(async () => (await 칠한값(꺾쇠, "opacity"))[0]).toBe("0");
    await 줄(page, ledger.name).getByRole("cell").nth(1).hover();
    await expect.poll(async () => (await 칠한값(꺾쇠, "opacity"))[0]).toBe("1");

    // 찾기 — 이름 · 경로에 걸린다. 맞는 것이 없으면 「찾는 Project가 없어요」(스토리 98).
    const 찾기 = page.getByRole("searchbox", { name: "Project 찾기", exact: true });
    await 찾기.fill(ledger.name);
    await expect(몸줄(목록(page)).getByRole("link")).toHaveText([ledger.name]);
    await 찾기.fill("MyProjects");
    await expect(몸줄(목록(page)).getByRole("link")).toHaveText([playground.name]);
    await 찾기.fill("없는 이름");
    await expect(몸줄(목록(page))).toHaveCount(0);
    await expect(목록(page).getByText("찾는 Project가 없어요", { exact: true })).toBeVisible();
    await 찾기.fill("");
    await expect(몸줄(목록(page))).toHaveCount(3);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("줄 ⋯는 「Finder에서 열기 · 경로 복사 · 제거…」이고, 찾을 수 없는 Project의 ⋯에는 「제거…」만 남는다", async ({ page }) => {
    await recordClipboard(page);
    await installFixtureBackend(page, { list_projects: [...PROJECTS, playground] });
    await page.goto("/projects");

    const 단추 = (name: string) => 목록(page).getByRole("button", { name: `${name} 메뉴`, exact: true });
    await 단추(billing.name).click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["Finder에서 열기", "경로 복사", "제거…"]);
    await 항목(page, "Finder에서 열기").click();
    await expect.poll(() => ipcArgs(page, "open_project_folder", "slug")).toEqual([{ slug: billing.slug }]);

    await 단추(billing.name).click();
    await 항목(page, "경로 복사").click();
    await expect.poll(() => clipboardWrites(page)).toEqual([`${billing.path}/`]);
    await expect(화면토스트(page, `${billing.path}/ 복사됨`)).toBeVisible();

    await 단추(playground.name).click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["제거…"]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("찾을 수 없는 줄의 「재설정」은 폴더를 다시 고르게 하고 그때만 경로를 바꾸며, git 저장소가 아니면 그 까닭을 말한다", async ({ page }) => {
    await installFixtureBackend(page, {
      list_projects: [...PROJECTS, playground],
      relocate_project: answerByArg("folder", { [고른곳.notes]: ipcFailure(`not a git repository: ${고른곳.notes}`) }, { otherwise: playground }),
    });
    await page.goto("/projects");
    const 재설정 = 줄(page, playground.name).getByRole("button", { name: "재설정", exact: true });

    // 고르다 그만두면 아무것도 바뀌지 않는다.
    await 폴더를고른다(page, null);
    await 재설정.click();
    await expect.poll(() => ipcArgs(page, "plugin:dialog|open", "options")).toHaveLength(1);
    expect(await ipcArgs(page, "relocate_project", "slug")).toEqual([]);

    await 폴더를고른다(page, "/Users/tester/MyProjects/playground-moved");
    await 재설정.click();
    await expect
      .poll(() => ipcArgs(page, "relocate_project", "slug"))
      .toEqual([{ slug: playground.slug, folder: "/Users/tester/MyProjects/playground-moved" }]);

    // 재설정은 git 저장소의 뿌리만 받는다 — core의 거절을 사람의 말로(스토리 127).
    await 폴더를고른다(page, 고른곳.notes);
    await 재설정.click();
    await expect(오류창(page)).toHaveAccessibleDescription(
      `재설정하지 못했어요 — git 저장소가 아니에요 — ${고른곳.notes}. git 저장소의 뿌리 폴더를 골라 주세요.`,
    );
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Project가 없으면 「아직 Project가 없어요」와 설명 · 「Project 추가」 · 끌어 놓기 한 줄이 가운데 서고 찾기 칸 · 표는 없다", async ({ page }) => {
    await installFixtureBackend(page, { list_projects: [] });
    await page.goto("/projects");
    const 본문칸 = 본문(page, "Projects");

    await expect(본문칸.getByRole("heading", { name: "아직 Project가 없어요", exact: true })).toBeVisible();
    await expect(
      본문칸.getByText("이 컴퓨터의 git 레포 폴더를 추가하거나, 빈 레포를 새로 만들어요. 코드는 옮기지 않아요.", { exact: true }),
    ).toBeVisible();
    await expect(본문칸.getByText("폴더를 이 창에 끌어다 놓아도 돼요", { exact: true })).toBeVisible();
    await expect(본문칸.getByRole("button", { name: "Project 추가", exact: true })).toHaveCount(1);
    await expect(목록(page)).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "Project 찾기", exact: true })).toHaveCount(0);

    await 본문칸.getByRole("button", { name: "Project 추가", exact: true }).click();
    await expect(추가창(page)).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test.describe("추가 창 — 소스 폴더", () => {
  test("비어 있으면 「추가」 하나이고, git 레포를 고르면 원격 · 기준 브랜치 줄과 폴더 이름이 서며 「Project 추가」가 그 폴더를 추가해 상세로 간다", async ({
    page,
  }) => {
    await installFixtureBackend(page, { inspect_project_folder: 살피기, create_project: webApp });
    await page.goto("/projects");
    await 추가창을연다(page);

    // 비어 있음 — 이름 칸(자리표시 「예: web-app」), 「이 컴퓨터의 폴더 추가」와 「추가」, 아래 안내, 꺼진 「Project 추가」.
    await expect(이름칸(page)).toHaveValue("");
    await expect(이름칸(page)).toHaveAttribute("placeholder", "예: web-app");
    await expect(추가창(page).getByRole("button", { name: "이 컴퓨터의 폴더 추가", exact: true })).toBeVisible();
    await expect(
      추가창(page).getByText("Project는 git 레포 하나예요. Space로 묶으면 Agent가 함께 읽고, Work는 고칠 Project에만 worktree를 만들어요.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(아래단추(page, "Project 추가")).toBeDisabled();

    // git 레포 — 고르는 순간 살핀다(스토리 105). 원격 · 기준 브랜치 줄이 서고 빈 이름 칸이 폴더 이름으로 찬다(스토리 106).
    await 폴더를추가한다(page, 고른곳.webApp);
    await expect(추가창(page).getByText(webApp.path, { exact: true })).toBeVisible();
    await expect(추가창(page).getByText("git 레포 · 원격 acme/web-app", { exact: true })).toBeVisible();
    await expect(추가창(page).getByLabel("기준 브랜치 develop", { exact: true })).toBeVisible();
    await expect(이름칸(page)).toHaveValue("web-app");
    await expect(안내상자(page)).toHaveCount(0);
    expect(await ipcArgs(page, "inspect_project_folder", "folder")).toEqual([{ folder: 고른곳.webApp }]);

    // 폴더를 빼면 따라온 이름도 빠진다. 사람이 친 이름은 다시 골라도 그대로다.
    await 추가창(page).getByRole("button", { name: "폴더 빼기", exact: true }).click();
    await expect(이름칸(page)).toHaveValue("");
    await expect(아래단추(page, "Project 추가")).toBeDisabled();
    await 이름칸(page).fill("웹 앱");
    await 폴더를추가한다(page, 고른곳.webApp);
    await expect(추가창(page).getByText("git 레포 · 원격 acme/web-app", { exact: true })).toBeVisible();
    await expect(이름칸(page)).toHaveValue("웹 앱");

    // 추가 — 살핀 경로 · 이름 그대로, git init 없이. 창이 닫히고 그 Project 상세로 간다(등록부가 그것을 품었다).
    await replaceAnswer(page, "list_projects", [...PROJECTS, webApp]);
    await 아래단추(page, "Project 추가").click();
    await expect(추가창(page)).toHaveCount(0);
    expect(await ipcArgs(page, "create_project", "folder")).toEqual([{ folder: webApp.path, name: "웹 앱", initGit: false }]);
    await expect(page).toHaveURL(`/projects/${webApp.slug}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("git 저장소가 아니면 「git 저장소가 아니에요」가 서고 단추가 「git init 하고 추가」로 바뀌며, 실패하면 그 글이 창 안에 선다", async ({ page }) => {
    await installFixtureBackend(page, {
      inspect_project_folder: 살피기,
      create_project: ipcFailure("git commit failed: Author identity unknown"),
    });
    await page.goto("/projects");
    await 추가창을연다(page);
    await 폴더를추가한다(page, 고른곳.notes);

    await expect(추가창(page).getByText("폴더 · git 저장소 아님", { exact: true })).toBeVisible();
    await expect(안내상자(page)).toHaveText(
      "git 저장소가 아니에요「git init 하고 추가」를 누르면 이 폴더에 빈 레포를 만들고(기준 브랜치 main) 추가해요. 파일은 그대로예요.",
    );
    await expect(이름칸(page)).toHaveValue("notes");
    await expect(아래단추(page, "Project 추가")).toHaveCount(0);

    await 아래단추(page, "git init 하고 추가").click();
    await expect.poll(() => ipcArgs(page, "create_project", "folder")).toEqual([{ folder: "~/Documents/notes", name: "notes", initGit: true }]);
    // git의 글 그대로 창 안에 — 창은 닫히지 않고 고쳐 다시 누른다.
    await expect(추가창(page).getByRole("alert")).toHaveText("추가하지 못했어요 — git commit failed: Author identity unknown");
    await expect(추가창(page)).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("저장소의 하위 폴더면 「… 저장소 안의 폴더예요」와 「뿌리 폴더로 바꾸기」가 서고, 그대로 추가해도 되고 바꾸면 뿌리를 추가한다", async ({ page }) => {
    await installFixtureBackend(page, { inspect_project_folder: 살피기, create_project: webApp });
    await page.goto("/projects");
    await 추가창을연다(page);
    await 폴더를추가한다(page, 고른곳.crates);

    await expect(추가창(page).getByText("git 레포의 하위 폴더 · 뿌리 ~/Developer/atelier", { exact: true })).toBeVisible();
    await expect(안내상자(page)).toContainText("atelier 저장소 안의 폴더예요");
    await expect(안내상자(page)).toContainText("뿌리 폴더(~/Developer/atelier)로 추가할까요? 그대로 두면 이 하위 폴더를 Project로 써요.");
    await expect(이름칸(page)).toHaveValue("crates");
    // 그대로 추가해도 된다 — 사람이 고르면 그대로 간다(스토리 110).
    await expect(아래단추(page, "Project 추가")).toBeEnabled();

    await 안내상자(page).getByRole("button", { name: "뿌리 폴더로 바꾸기", exact: true }).click();
    await expect(추가창(page).getByText("git 레포 · 원격 broco/atelier", { exact: true })).toBeVisible();
    await expect(이름칸(page)).toHaveValue("atelier");
    await expect(안내상자(page)).toHaveCount(0);
    await 아래단추(page, "Project 추가").click();
    await expect
      .poll(() => ipcArgs(page, "create_project", "folder"))
      .toEqual([{ folder: "~/Developer/atelier", name: "atelier", initGit: false }]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("이미 추가된 폴더면 「이미 추가된 Project예요」의 「열기」가 추가를 대신해 그 상세로 가고, 없는 폴더면 「폴더를 찾을 수 없어요」다", async ({
    page,
  }) => {
    await installFixtureBackend(page, { inspect_project_folder: 살피기 });
    await page.goto("/projects");
    await 추가창을연다(page);

    await 폴더를추가한다(page, 고른곳.gone);
    await expect(안내상자(page)).toHaveText("폴더를 찾을 수 없어요지웠거나 옮긴 폴더예요. 다른 폴더를 골라 주세요.");
    await expect(아래단추(page, "Project 추가")).toBeDisabled();

    await 추가창(page).getByRole("button", { name: "폴더 빼기", exact: true }).click();
    await 폴더를추가한다(page, 고른곳.billing);
    await expect(안내상자(page)).toContainText(`이미 추가된 Project예요 — ${billing.name}`);
    await expect(안내상자(page)).toContainText("같은 폴더는 한 번만 추가돼요.");
    await expect(아래단추(page, "Project 추가")).toBeDisabled();
    await 안내상자(page).getByRole("button", { name: "열기", exact: true }).click();

    await expect(추가창(page)).toHaveCount(0);
    await expect(page).toHaveURL(`/projects/${billing.slug}`);
    expect(await ipcArgs(page, "create_project", "folder")).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("「새로 만들기」는 `~/MyProjects/<이름>` 자리 · 「빈 git 레포를 만들어요 · 기준 브랜치 main」 · 「위치 바꾸기」이고 「Project 만들기」가 그 자리에 만든다", async ({
    page,
  }) => {
    const landing: ProjectView = { ...webApp, slug: "landing-page", name: "Landing Page", path: "~/Code/landing-page", baseBranch: "main" };
    const 자리 = (parent: string, path: string | null, taken = false): NewProjectPlace => ({ parent, path, taken });
    await installFixtureBackend(page, {
      new_project_place: answerByArg(
        "name",
        { "Landing Page": 자리("~/MyProjects", "~/MyProjects/landing-page") },
        { otherwise: 자리("~/MyProjects", null) },
      ),
      new_project: landing,
    });
    await page.goto("/projects");
    await 추가창을연다(page);
    await 소스를바꾼다(page, "이 컴퓨터의 폴더 추가", "새로 만들기");

    // 이름이 없으면 자리 줄의 폴더가 흐린 「이름」이고 「Project 만들기」가 꺼져 있다.
    await expect(추가창(page).getByRole("button", { name: "새 폴더 만들기", exact: true })).toBeVisible();
    await expect(추가창(page).getByText("~/MyProjects/이름", { exact: true })).toBeVisible();
    await expect(추가창(page).getByText("빈 git 레포를 만들어요 · 기준 브랜치 main", { exact: true })).toBeVisible();
    await expect(아래단추(page, "Project 만들기")).toBeDisabled();

    // 이름을 적으면 자리가 따라온다(core가 slug로 접는다).
    await 이름칸(page).fill("Landing Page");
    await expect(추가창(page).getByText("~/MyProjects/landing-page", { exact: true })).toBeVisible();
    await expect(아래단추(page, "Project 만들기")).toBeEnabled();

    // 「위치 바꾸기」 — 고른 부모를 앱 설정에 적고 다음에도 쓴다(S18). 자리는 그 부모 아래로 다시 묻는다.
    await 폴더를고른다(page, "/Users/tester/Code");
    await replaceAnswer(
      page,
      "new_project_place",
      answerByArg("name", { "Landing Page": 자리("~/Code", "~/Code/landing-page") }, { otherwise: 자리("~/Code", null) }),
    );
    await 추가창(page).getByRole("button", { name: "위치 바꾸기", exact: true }).click();
    await expect(추가창(page).getByText("~/Code/landing-page", { exact: true })).toBeVisible();
    const 설정 = async () => (await ipcArgs(page, "write_settings", "settings")).map((args) => (args.settings as { projects?: unknown }).projects);
    await expect.poll(설정).toEqual([{ newParent: "/Users/tester/Code" }]);
    const 물은자리 = await ipcArgs(page, "new_project_place", "name");
    expect(물은자리[물은자리.length - 1]).toEqual({ parent: "/Users/tester/Code", name: "Landing Page" });

    await replaceAnswer(page, "list_projects", [...PROJECTS, landing]);
    await 아래단추(page, "Project 만들기").click();
    await expect(추가창(page)).toHaveCount(0);
    expect(await ipcArgs(page, "new_project", "name")).toEqual([{ parent: "/Users/tester/Code", name: "Landing Page" }]);
    await expect(page).toHaveURL(`/projects/${landing.slug}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("새로 만들 자리에 폴더가 이미 있으면 「… 폴더가 이미 있어요」와 「그 폴더 추가」가 서고, 누르면 그 폴더를 추가하는 길로 간다", async ({ page }) => {
    await installFixtureBackend(page, {
      inspect_project_folder: 살피기,
      new_project_place: answerByArg(
        "name",
        { "web-app": { parent: "~/MyProjects", path: webApp.path, taken: true } },
        { otherwise: { parent: "~/MyProjects", path: null, taken: false } },
      ),
    });
    await page.goto("/projects");
    await 추가창을연다(page);
    await 소스를바꾼다(page, "이 컴퓨터의 폴더 추가", "새로 만들기");
    await 이름칸(page).fill("web-app");

    await expect(추가창(page).getByText("이 위치에 폴더가 이미 있어요", { exact: true })).toBeVisible();
    await expect(안내상자(page)).toContainText(`${webApp.path} 폴더가 이미 있어요`);
    await expect(안내상자(page)).toContainText("새로 만들지 않고 그 폴더를 추가할 수 있어요.");
    await expect(아래단추(page, "Project 만들기")).toBeDisabled();

    await 안내상자(page).getByRole("button", { name: "그 폴더 추가", exact: true }).click();
    await expect(추가창(page).getByRole("button", { name: "이 컴퓨터의 폴더 추가", exact: true })).toBeVisible();
    await expect(추가창(page).getByText("git 레포 · 원격 acme/web-app", { exact: true })).toBeVisible();
    await expect(아래단추(page, "Project 추가")).toBeEnabled();
    expect(await ipcArgs(page, "inspect_project_folder", "folder")).toEqual([{ folder: webApp.path }]);
    expect(await ipcArgs(page, "new_project", "name")).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("폴더를 Projects 창에 끌어다 놓으면 놓은 것 가운데 첫 폴더로 추가 창이 열리고(파일만이면 아무 일도 없다), 떠 있는 창에 다시 놓으면 그 폴더로 바뀐다", async ({ page }) => {
    const 파일 = "/Users/tester/Desktop/메모.txt";
    await installFixtureBackend(page, {
      inspect_project_folder: answerByArg("folder", { ...살핀답, [파일]: { kind: "missing", path: "~/Desktop/메모.txt" } }),
    });
    await page.goto("/projects");
    await expect(목록(page)).toBeVisible();

    // 파일만 놓으면 아무 일도 없다(03 결정 09 · 코드 리뷰 P7) — 폴더인지 묻고, 창은 열지 않는다.
    await fireEvent(page, "tauri://drag-drop", { paths: [파일], position: { x: 700, y: 400 } });
    await expect.poll(() => ipcArgs(page, "inspect_project_folder", "folder")).toEqual([{ folder: 파일 }]);
    await expect(추가창(page)).toHaveCount(0);

    // 파일은 건너뛴다 — 폴더인지는 core가 안다(첫 폴더 — S20).
    await fireEvent(page, "tauri://drag-drop", { paths: [파일, 고른곳.webApp, 고른곳.notes], position: { x: 700, y: 400 } });
    await expect(추가창(page)).toBeVisible();
    await expect(추가창(page).getByText("git 레포 · 원격 acme/web-app", { exact: true })).toBeVisible();
    await expect(이름칸(page)).toHaveValue("web-app");
    expect(await ipcArgs(page, "inspect_project_folder", "folder")).toEqual([
      { folder: 파일 },
      { folder: 파일 },
      { folder: 고른곳.webApp },
      { folder: 고른곳.webApp },
    ]);

    // 떠 있는 창에 놓으면 창을 하나 더 띄우지 않고 그 폴더로 바뀐다.
    await fireEvent(page, "tauri://drag-drop", { paths: [고른곳.notes], position: { x: 700, y: 400 } });
    await expect(추가창(page).getByText("폴더 · git 저장소 아님", { exact: true })).toBeVisible();
    await expect(추가창(page)).toHaveCount(1);
    await expect(이름칸(page)).toHaveValue("notes");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test.describe("제거 창", () => {
  const 제거창 = (page: Page, name: string) => page.getByRole("alertdialog", { name, exact: true });
  /** 줄 ⋯의 「제거…」 — 창을 열기 전에 쓰임을 읽는다. */
  async function 제거를묻는다(page: Page, project: ProjectView): Promise<void> {
    await 목록(page).getByRole("button", { name: `${project.name} 메뉴`, exact: true }).click();
    await 항목(page, "제거…").click();
  }

  test("보통은 「목록에서 제거할까요?」와 Project 카드 · 그대로인 것이고, 「제거」가 빼면 「목록에서 뺐어요 — 이름 · 되돌리기」가 되돌린다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto("/projects");
    await 제거를묻는다(page, billing);

    const 창 = 제거창(page, "목록에서 제거할까요?");
    await expect(창).toBeVisible();
    expect(await ipcArgs(page, "project_usage", "slug")).toEqual([{ slug: billing.slug }]);
    await expect(창.getByText(billing.name, { exact: true })).toBeVisible();
    await expect(창.getByText(billing.path, { exact: true })).toBeVisible();
    await expect(창).toHaveAccessibleDescription("폴더와 파일, git 기록은 그대로예요. 언제든 다시 추가할 수 있어요.");
    // 첫 포커스는 「제거」 — 토스트에서 되돌릴 수 있는 일이다.
    await expect(창.getByRole("button", { name: "제거", exact: true })).toBeFocused();
    await 창.getByRole("button", { name: "제거", exact: true }).click();

    await expect(창).toHaveCount(0);
    expect(await ipcArgs(page, "remove_project", "slug")).toEqual([{ slug: billing.slug }]);
    const 지운뒤 = 화면토스트(page, `목록에서 뺐어요 — ${billing.name}`);
    await 지운뒤.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect.poll(() => ipcArgs(page, "restore_project", "slug")).toEqual([{ slug: billing.slug }]);
    await expect(지운뒤).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 진짜 앱의 긴 경로(임시 폴더)에서 카드가 창의 격자 칸을 창 밖까지 밀어 「취소 · 제거」가 창 밖으로 나갔다(03 티켓 13d). 카드는 칸의
  // 폭 안에 서고 경로 줄은 말줄임으로 잘린다.
  test("경로가 길어도 창은 제 폭(420)이고 경로 줄이 말줄임으로 잘리며, 「취소 · 제거」가 창 안에 선다", async ({ page }) => {
    const 깊은: ProjectView = { ...billing, path: `/private/tmp/${"아주-깊은-폴더/".repeat(12)}billing` };
    await installFixtureBackend(page, { list_projects: [깊은, ledger] });
    await page.goto("/projects");
    await 제거를묻는다(page, 깊은);

    const 창 = 제거창(page, "목록에서 제거할까요?");
    await expect(창).toBeVisible();
    const 창상자 = (await 창.boundingBox())!;
    expect(창상자.width).toBe(420);
    const 경로 = 창.getByText(깊은.path, { exact: true });
    await expect(경로).toBeVisible();
    expect(await 경로.evaluate((el) => el.scrollWidth > el.clientWidth), "경로 줄이 말줄임으로 잘린다").toBe(true);
    for (const name of ["취소", "제거"]) {
      const 단추 = (await 창.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(단추.x + 단추.width, `「${name}」의 오른끝이 창 안`).toBeLessThanOrEqual(창상자.x + 창상자.width);
    }
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Space에 들어 있으면 「… Space에서도 빠져요」가 더해지고, 「취소」면 빼지 않으며, 그사이 같은 slug가 다시 쓰였으면 되돌리기가 그 까닭을 말한다", async ({
    page,
  }) => {
    const [결제, 원장도구] = SPACES;
    await installFixtureBackend(page, {
      project_usage: { spaces: [결제, 원장도구].map(({ slug, name }) => ({ slug, name })), works: [] },
      restore_project: ipcFailure(`slug is in use again: ${ledger.slug}`),
    });
    await page.goto("/projects");
    await 제거를묻는다(page, ledger);

    const 창 = 제거창(page, "목록에서 제거할까요?");
    await expect(창).toHaveAccessibleDescription(
      `폴더와 파일, git 기록은 그대로예요. 언제든 다시 추가할 수 있어요. ${결제.name} · ${원장도구.name} Space에서도 빠져요.`,
    );
    await 창.getByRole("button", { name: "취소", exact: true }).click();
    await expect(창).toHaveCount(0);
    expect(await ipcArgs(page, "remove_project", "slug")).toEqual([]);

    await 제거를묻는다(page, ledger);
    await 창.getByRole("button", { name: "제거", exact: true }).click();
    await 화면토스트(page, `목록에서 뺐어요 — ${ledger.name}`).getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(오류창(page)).toHaveAccessibleDescription(`되돌리지 못했어요 — 그사이 같은 이름의 Project(${ledger.slug})가 다시 추가됐어요.`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("진행 중인 Work가 고치고 있으면 「아직 제거할 수 없어요」와 그 Work 줄이 서고 「제거」가 꺼지며, Work 줄을 누르면 창을 닫고 그 Work로 간다", async ({
    page,
  }) => {
    const 고치는 = WORKS.slice(0, 2).map((work, at) => ({ slug: work.slug, title: work.title, branch: at === 0 ? "fix/refund-api" : null }));
    await installFixtureBackend(page, { project_usage: { spaces: [], works: 고치는 } });
    await page.goto("/projects");
    await 제거를묻는다(page, billing);

    const 창 = 제거창(page, "아직 제거할 수 없어요");
    await expect(창).toHaveAccessibleDescription("진행 중인 Work 2개가 이 Project를 고치고 있어요. Work를 끝내 보관하면 제거할 수 있어요.");
    const 줄들 = 창.getByRole("list", { name: "이 Project를 고치는 Work", exact: true }).getByRole("link");
    await expect(줄들).toHaveText([`${고치는[0].title}fix/refund-api`, 고치는[1].title]);
    // 첫 포커스는 「닫기」 — 할 수 있는 일이 그것뿐이다.
    await expect(창.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
    await expect(창.getByRole("button", { name: "제거", exact: true })).toBeDisabled();

    await 줄들.first().click();
    await expect(창).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/works/${고치는[0].slug}`));
    expect(await ipcArgs(page, "remove_project", "slug")).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("창을 연 사이 Work가 그 Project를 붙였으면 「제거」가 막히고 창이 그 자리에서 막힌 갈래로 바뀐다", async ({ page }) => {
    const 붙인 = { slug: WORKS[2].slug, title: WORKS[2].title, branch: null };
    await installFixtureBackend(page, { remove_project: { kind: "blocked", works: [붙인] } });
    await page.goto("/projects");
    await 제거를묻는다(page, ledger);
    await 제거창(page, "목록에서 제거할까요?").getByRole("button", { name: "제거", exact: true }).click();

    const 막힘 = 제거창(page, "아직 제거할 수 없어요");
    await expect(막힘).toHaveAccessibleDescription("진행 중인 Work 1개가 이 Project를 고치고 있어요. Work를 끝내 보관하면 제거할 수 있어요.");
    await expect(막힘.getByRole("link")).toHaveText([붙인.title]);
    await expect(화면토스트(page, `목록에서 뺐어요 — ${ledger.name}`)).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test.describe("상세 조각", () => {
  test("제목을 누르면 제목 줄 그 자리가 「Project 이름」 칸(높이 40)이 되고, 그 아래 「↵ 저장 · esc 취소 — 파일 이름(<slug>.md)과 경로는 그대로예요」가 선다", async ({
    page,
  }) => {
    // 저장 규칙(Enter · 다른 곳 · Esc · 비움 · 그대로)과 편집 메뉴는 `inline-rename` · `edit-menu`가 잰다 — 여기는 고치는 동안의 모양과 아래 한 줄이다.
    await installFixtureBackend(page);
    await page.goto(`/projects/${billing.slug}`);
    const 본문칸 = 본문(page, "Projects 상세");
    const 제목줄 = 본문칸.getByRole("heading", { level: 1 });
    const 칸 = 제목줄.getByRole("textbox", { name: "Project 이름", exact: true });
    const 도움말 = 본문칸.getByText(`↵ 저장 · esc 취소 — 파일 이름(${billing.slug}.md)과 경로는 그대로예요`, { exact: true });
    await expect(제목줄.getByRole("button")).toHaveText([billing.name, ""]);
    await expect(도움말).toHaveCount(0);

    await 본문칸.getByRole("button", { name: `${billing.name} — 이름 바꾸기`, exact: true }).click();
    await expect(칸).toBeFocused();
    await expect(칸).toHaveValue(billing.name);
    // 이름 · 연필이 칸에 자리를 내준다 — 칸의 테(시안 F4-ProjRename)는 높이 40 · 너비 352 이상이고, 아래 한 줄이 그 밑에 선다.
    await expect(제목줄.getByRole("button")).toHaveCount(0);
    await expect(도움말).toBeVisible();
    const 테 = (await 칸.locator("xpath=..").boundingBox())!;
    expect(테.height).toBe(40);
    expect(테.width).toBeGreaterThanOrEqual(352);
    expect((await 도움말.boundingBox())!.y).toBeGreaterThanOrEqual(테.y + 테.height);

    // 칸이 닫히면 그 줄도 걷히고 제목이 돌아온다.
    await 칸.press("Escape");
    await expect(도움말).toHaveCount(0);
    await expect(제목줄.getByRole("button")).toHaveText([billing.name, ""]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("폴더를 찾을 수 없는 Project의 상세는 위에 안내 상자와 「재설정」이 서고, 기준 브랜치가 꺼지며 경로에 취소선이 그어진다", async ({ page }) => {
    await installFixtureBackend(page, { list_projects: [...PROJECTS, playground] });
    await page.goto(`/projects/${playground.slug}`);
    const 본문칸 = 본문(page, "Projects 상세");

    const 안내 = 본문칸.getByRole("status");
    await expect(안내).toHaveText(
      `Project를 찾을 수 없어요${playground.path}에 폴더가 없어요. 옮겼다면 재설정으로 새 위치를 골라 주세요. 이 Project를 쓰는 Work는 고칠 수 없어요.재설정`,
    );
    const 정보 = 본문칸.getByRole("complementary", { name: "Project 정보", exact: true });
    await expect(정보.getByRole("combobox", { name: "기준 브랜치", exact: true })).toBeDisabled();
    await expect(정보.getByText("폴더를 찾아야 브랜치를 읽을 수 있어요", { exact: true })).toBeVisible();
    const 경로칸 = 정보.getByRole("region", { name: "경로", exact: true });
    expect(await 칠한값(경로칸.getByText(playground.path, { exact: true }), "text-decoration-line")).toEqual(["line-through"]);
    await expect(경로칸.getByText("Project를 찾을 수 없어요", { exact: true })).toBeVisible();

    // 안내 상자의 「재설정」 — 고른 폴더로 경로만 바꾼다.
    await 폴더를고른다(page, "/Users/tester/MyProjects/playground-moved");
    await 안내.getByRole("button", { name: "재설정", exact: true }).click();
    await expect
      .poll(() => ipcArgs(page, "relocate_project", "slug"))
      .toEqual([{ slug: playground.slug, folder: "/Users/tester/MyProjects/playground-moved" }]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

