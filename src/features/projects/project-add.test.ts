import { describe, expect, it } from "vitest";
import { addView, firstFolder, pickFolder, typeName, unpickFolder, type AddDraft } from "./project-add";
import type { FolderLook, NewProjectPlace, ProjectView } from "./types";

// 추가 창의 갈래 → 글 · 단추(03 구현 스펙 §16 · 캔버스 F4-KitProject 「추가 창 — 소스 폴더」 일곱 칸 · F1-ProjectAdd · F1-ProjectNew ·
// F4-ProjNoGit). 기대 글은 시안의 글자 그대로다.

const folder = (name = "", picked: string | null = null): AddDraft => ({ mode: "folder", name, named: false, folder: picked });
const fresh = (name: string): AddDraft => ({ mode: "new", name, named: true, folder: null });

const git = (remoteSlug: string | null) => ({ remoteSlug, currentBranch: "develop", localBranches: ["develop", "main"] });

const WEB: FolderLook = {
  kind: "repo",
  path: "~/MyProjects/web-app",
  baseBranch: "develop",
  remotes: ["origin"],
  git: git("acme/web-app"),
};

const project: ProjectView = {
  slug: "web-app",
  name: "web-app",
  path: "~/MyProjects/web-app",
  baseBranch: "develop",
  createdAt: "2026-10-25",
  description: "",
  git: git("acme/web-app"),
  missing: false,
};

describe("이 컴퓨터의 폴더 추가", () => {
  it("비어 있으면 「추가」만 서고 단추는 꺼져 있다", () => {
    const view = addView(folder(), null, null, "~/MyProjects");
    expect(view.head).toEqual(["이 컴퓨터", "의 폴더 추가"]);
    expect(view.picked).toBeNull();
    expect(view.notice).toBeNull();
    expect(view.submit).toEqual({ label: "Project 추가", enabled: false, act: "add" });
  });

  it("git 레포는 원격 · 기준 브랜치를 한 줄로 보이고 추가한다", () => {
    const view = addView(folder("web-app", "~/MyProjects/web-app"), WEB, null, "~/MyProjects");
    expect(view.picked).toEqual({ path: "~/MyProjects/web-app", found: "git 레포 · 원격 acme/web-app", branch: "develop" });
    expect(view.notice).toBeNull();
    expect(view.submit).toEqual({ label: "Project 추가", enabled: true, act: "add" });
  });

  it("원격이 없는 레포는 「원격 없음」이다", () => {
    const look: FolderLook = { ...WEB, remotes: [], git: git(null) };
    expect(addView(folder("web-app", WEB.path), look, null, "~/MyProjects").picked?.found).toBe("git 레포 · 원격 없음");
  });

  it("git 저장소가 아니면 알리고 단추가 「git init 하고 추가」로 바뀐다", () => {
    const look: FolderLook = { kind: "notGit", path: "~/Documents/notes" };
    const view = addView(folder("notes", look.path), look, null, "~/MyProjects");
    expect(view.picked).toEqual({ path: "~/Documents/notes", found: "폴더 · git 저장소 아님", branch: null });
    expect(view.notice).toEqual({
      tone: "warn",
      title: "git 저장소가 아니에요",
      body: "「git init 하고 추가」를 누르면 이 폴더에 빈 레포를 만들고(기준 브랜치 main) 추가해요. 파일은 그대로예요.",
      action: null,
    });
    expect(view.submit).toEqual({ label: "git init 하고 추가", enabled: true, act: "init" });
  });

  it("저장소의 하위 폴더는 뿌리 폴더로 바꾸기를 묻고, 「추가」는 그대로 추가다", () => {
    const look: FolderLook = {
      kind: "subfolder",
      path: "~/Developer/atelier/crates",
      root: "~/Developer/atelier",
      baseBranch: "main",
    };
    const view = addView(folder("crates", look.path), look, null, "~/MyProjects");
    expect(view.picked).toEqual({
      path: "~/Developer/atelier/crates",
      found: "git 레포의 하위 폴더 · 뿌리 ~/Developer/atelier",
      branch: "main",
    });
    expect(view.notice).toEqual({
      tone: "info",
      title: "atelier 저장소 안의 폴더예요",
      body: "뿌리 폴더(~/Developer/atelier)로 추가할까요? 그대로 두면 이 하위 폴더를 Project로 써요.",
      action: { label: "뿌리 폴더로 바꾸기", act: "root" },
    });
    expect(view.submit).toEqual({ label: "Project 추가", enabled: true, act: "add" });
  });

  it("이미 추가된 폴더는 추가 대신 「열기」다", () => {
    const look: FolderLook = { kind: "registered", path: project.path, project };
    const view = addView(folder("web-app", look.path), look, null, "~/MyProjects");
    expect(view.picked).toEqual({ path: "~/MyProjects/web-app", found: "git 레포 · 원격 acme/web-app", branch: "develop" });
    expect(view.notice).toEqual({
      tone: "info",
      title: "이미 추가된 Project예요 — web-app",
      body: "같은 폴더는 한 번만 추가돼요.",
      action: { label: "열기", act: "open" },
    });
    expect(view.submit).toEqual({ label: "Project 추가", enabled: false, act: "add" });
  });

  it("폴더가 없으면 알리고 추가하지 않는다", () => {
    const look: FolderLook = { kind: "missing", path: "~/Downloads/readme.md" };
    const view = addView(folder("readme.md", look.path), look, null, "~/MyProjects");
    expect(view.picked).toEqual({ path: "~/Downloads/readme.md", found: "폴더를 찾을 수 없어요", branch: null });
    expect(view.notice?.tone).toBe("warn");
    expect(view.submit.enabled).toBe(false);
  });

  it("살피는 동안과 이름이 빈 동안은 단추가 꺼져 있다", () => {
    expect(addView(folder("web-app", WEB.path), null, null, "~/MyProjects").submit.enabled).toBe(false);
    expect(addView(folder("  ", WEB.path), WEB, null, "~/MyProjects").submit.enabled).toBe(false);
  });
});

describe("새로 만들기", () => {
  const free: NewProjectPlace = { parent: "~/MyProjects", path: "~/MyProjects/landing-page", taken: false };

  it("부모 아래 이름 폴더와 「빈 git 레포를 만들어요 · 기준 브랜치 main」이다", () => {
    const view = addView(fresh("landing-page"), null, free, "~/MyProjects");
    expect(view.head).toEqual(["새 폴더", " 만들기"]);
    expect(view.place).toEqual({ prefix: "~/MyProjects/", folder: "landing-page", note: "빈 git 레포를 만들어요 · 기준 브랜치 main" });
    expect(view.notice).toBeNull();
    expect(view.submit).toEqual({ label: "Project 만들기", enabled: true, act: "new" });
  });

  it("이름이 없으면 폴더 자리가 비고 단추가 꺼져 있다", () => {
    const view = addView(fresh(""), null, { parent: "~/MyProjects", path: null, taken: false }, "~/MyProjects");
    expect(view.place).toEqual({ prefix: "~/MyProjects/", folder: null, note: "빈 git 레포를 만들어요 · 기준 브랜치 main" });
    expect(view.submit.enabled).toBe(false);
  });

  it("자리를 묻기 전에는 기억한 부모로 선다", () => {
    expect(addView(fresh(""), null, null, "~/Code").place?.prefix).toBe("~/Code/");
  });

  it("그 자리에 폴더가 있으면 만들지 않고 그 폴더를 추가하는 길로 간다", () => {
    const taken: NewProjectPlace = { parent: "~/MyProjects", path: "~/MyProjects/web-app", taken: true };
    const view = addView(fresh("web-app"), null, taken, "~/MyProjects");
    expect(view.place).toEqual({ prefix: "~/MyProjects/", folder: "web-app", note: "이 위치에 폴더가 이미 있어요" });
    expect(view.notice).toEqual({
      tone: "warn",
      title: "~/MyProjects/web-app 폴더가 이미 있어요",
      body: "새로 만들지 않고 그 폴더를 추가할 수 있어요.",
      action: { label: "그 폴더 추가", act: "add-folder" },
    });
    expect(view.submit).toEqual({ label: "Project 만들기", enabled: false, act: "new" });
  });
});

describe("이름 칸", () => {
  it("비어 있으면 고른 폴더 이름으로 채우고, 사람이 친 이름은 그대로 둔다", () => {
    expect(pickFolder(folder(), "~/Documents/notes").name).toBe("notes");
    const typed = typeName(folder(), "메모");
    expect(pickFolder(typed, "~/Documents/notes").name).toBe("메모");
  });

  it("채워 둔 이름은 폴더를 바꾸면 따라가고, 폴더를 빼면 비운다", () => {
    const picked = pickFolder(folder(), "~/Developer/atelier/crates");
    expect(pickFolder(picked, "~/Developer/atelier").name).toBe("atelier");
    expect(unpickFolder(picked)).toEqual(folder());
  });

  it("이름을 다 지우면 다음 폴더 이름을 다시 받는다", () => {
    const cleared = typeName(typeName(folder(), "메모"), "");
    expect(pickFolder(cleared, "~/Documents/notes").name).toBe("notes");
  });
});

describe("끌어 놓은 폴더", () => {
  const looks: Record<string, FolderLook> = {
    "/a/readme.md": { kind: "missing", path: "/a/readme.md" },
    "/a/notes": { kind: "notGit", path: "/a/notes" },
    "/a/web": { ...WEB, path: "/a/web" },
  };
  const inspect = async (path: string) => looks[path];

  it("여럿이면 첫 폴더다 — 폴더가 아닌 것은 건너뛴다", async () => {
    expect(await firstFolder(["/a/readme.md", "/a/notes", "/a/web"], inspect)).toBe("/a/notes");
  });

  it("폴더가 하나도 없으면 첫 경로다 — 추가 창이 「찾을 수 없어요」를 말한다", async () => {
    expect(await firstFolder(["/a/readme.md"], inspect)).toBe("/a/readme.md");
    expect(await firstFolder([], inspect)).toBeNull();
  });
});
