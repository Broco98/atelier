import { describe, expect, it } from "vitest";
import { baseNote, branchGroups, missingNotice, relocateProblem, renameHint, rowMenu, shownProjects } from "./project-view";
import type { GitInfo, ProjectView } from "./types";

// Projects 목록 · 상세의 갈래(03 구현 스펙 §16 · 캔버스 F1-Projects · F1-ProjectDetail · F4-ProjMissing · F4-ProjDetailMissing · F4-ProjBranch ·
// F4-ProjRename · F4-KitProject 「목록 줄」 · 「상세 조각」). 기대 글은 시안의 글자 그대로다.

const git = (over: Partial<GitInfo> = {}): GitInfo => ({
  remoteSlug: "acme/web-app",
  currentBranch: "develop",
  localBranches: ["develop", "main", "release/2.4"],
  remoteBranches: [{ remote: "origin", branches: ["origin/develop", "origin/main", "origin/release/2.5"] }],
  ...over,
});

const project = (over: Partial<ProjectView> = {}): ProjectView => ({
  slug: "web-app",
  name: "web-app",
  path: "~/MyProjects/web-app",
  baseBranch: "develop",
  createdAt: "2026-10-25",
  description: "",
  git: git(),
  missing: false,
  ...over,
});

const PLAYGROUND = project({ slug: "playground", name: "playground", path: "~/MyProjects/playground", git: null, missing: true });

describe("목록 줄의 ⋯", () => {
  it("보통 줄은 Finder에서 열기 · 경로 복사 · 제거…이고, 제거는 선 아래 빨강이다", () => {
    expect(rowMenu(project())).toEqual([
      { act: "open-folder", label: "Finder에서 열기", danger: false, apart: false },
      { act: "copy-path", label: "경로 복사", danger: false, apart: false },
      { act: "remove", label: "제거…", danger: true, apart: true },
    ]);
  });

  it("폴더를 찾을 수 없는 줄은 제거…만 남는다 — 없는 폴더를 Finder에서 열려 하지 않는다", () => {
    expect(rowMenu(PLAYGROUND)).toEqual([{ act: "remove", label: "제거…", danger: true, apart: false }]);
  });
});

describe("찾기", () => {
  const all = [project(), project({ slug: "api-server", name: "API 서버", path: "~/MyProjects/api-server" }), PLAYGROUND];

  it("이름 · slug · 경로에서 대소문자 없이 찾는다", () => {
    expect(shownProjects(all, "api").map((one) => one.slug)).toEqual(["api-server"]);
    expect(shownProjects(all, "  WEB ").map((one) => one.slug)).toEqual(["web-app"]);
    expect(shownProjects(all, "myprojects/play").map((one) => one.slug)).toEqual(["playground"]);
  });

  it("빈 찾기는 모두 · 맞는 것이 없으면 빈 목록(화면은 「찾는 Project가 없어요」)이다", () => {
    expect(shownProjects(all, " ")).toHaveLength(3);
    expect(shownProjects(all, "billing")).toEqual([]);
  });
});

describe("기준 브랜치 목록", () => {
  it("「로컬」 · 「원격 — <원격 이름>」 묶음이고, 원격 브랜치는 원격 이름을 단 그대로다", () => {
    const upstream = { remote: "upstream", branches: ["upstream/main"] };
    expect(branchGroups(git({ remoteBranches: [...git().remoteBranches, upstream] }))).toEqual([
      { label: "로컬", branches: ["develop", "main", "release/2.4"] },
      { label: "원격 — origin", branches: ["origin/develop", "origin/main", "origin/release/2.5"] },
      { label: "원격 — upstream", branches: ["upstream/main"] },
    ]);
  });

  it("브랜치가 없는 묶음은 서지 않는다 — fetch하지 않은 원격 · git으로 읽지 못한 폴더", () => {
    expect(branchGroups(git({ remoteBranches: [{ remote: "origin", branches: [] }] }))).toEqual([
      { label: "로컬", branches: ["develop", "main", "release/2.4"] },
    ]);
    expect(branchGroups(null)).toEqual([]);
  });
});

describe("상세 조각의 글", () => {
  it("기준 브랜치 아래 한 줄 — 갈라지는 자리, 바꾼 뒤, 폴더를 찾을 수 없을 때", () => {
    expect(baseNote(project(), false)).toBe("새 Work의 브랜치가 여기서 갈라져요");
    expect(baseNote(project({ baseBranch: "origin/release/2.5" }), true)).toBe("바꿨어요 — 새 Work부터 origin/release/2.5에서 갈라져요");
    expect(baseNote(PLAYGROUND, false)).toBe("폴더를 찾아야 브랜치를 읽을 수 있어요");
  });

  it("제목을 고치는 동안 — 파일 이름은 slug다(이름을 바꿔도 그대로)", () => {
    expect(renameHint(project({ name: "웹 앱 (고객용)" }))).toBe("↵ 저장 · esc 취소 — 파일 이름(web-app.md)과 경로는 그대로예요");
  });

  it("폴더를 찾을 수 없음 — 그 경로와 재설정 · 이 Project를 쓰는 Work", () => {
    expect(missingNotice(PLAYGROUND)).toEqual({
      title: "Project를 찾을 수 없어요",
      body: "~/MyProjects/playground에 폴더가 없어요. 옮겼다면 재설정으로 새 위치를 골라 주세요. 이 Project를 쓰는 Work는 고칠 수 없어요.",
    });
  });
});

describe("재설정이 거절된 까닭", () => {
  it("core의 거절을 사람의 말로 — git 아님 · 저장소 안의 폴더 · 이미 추가된 폴더 · 없는 폴더", () => {
    expect(relocateProblem("not a git repository: ~/Documents/notes")).toBe(
      "git 저장소가 아니에요 — ~/Documents/notes. git 저장소의 뿌리 폴더를 골라 주세요.",
    );
    expect(relocateProblem("not the root of a git repository: ~/Developer/web-app/src (its root is ~/Developer/web-app)")).toBe(
      "~/Developer/web-app 저장소 안의 폴더예요 — 뿌리 폴더를 골라 주세요.",
    );
    expect(relocateProblem("already registered as project 'api-server': ~/MyProjects/api-server")).toBe(
      "이미 다른 Project(api-server)로 추가된 폴더예요 — ~/MyProjects/api-server",
    );
    expect(relocateProblem("folder does not exist: ~/없음")).toBe("폴더를 찾을 수 없어요 — ~/없음");
  });

  it("모르는 글은 그대로 보인다", () => {
    expect(relocateProblem("permission denied")).toBe("permission denied");
  });
});
