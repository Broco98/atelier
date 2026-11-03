import { describe, expect, it } from "vitest";
import { missingNotice, relocateProblem, rowMenu, shownProjects } from "./project-view";
import type { GitInfo, ProjectView } from "./types";

// Projects 목록 · 상세의 갈래(03 구현 스펙 §16 · 캔버스 F1-Projects · F1-ProjectDetail · F4-ProjMissing · F4-ProjDetailMissing · F4-KitProject
// 「목록 줄」 · 「상세 조각」). 기대 글은 시안의 글자 그대로다. 상세 머리의 ⋯는 목록 줄의 ⋯ 그대로라(restart 03-15c) 따로 재지 않는다.

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
  // 보드 PlaceSheet 「⋯ 메뉴」 칸 · Places `MENUS.projects` — 세 줄이 같은 줄이다(선 · 빨강 없음). 제거는 창이 한 번 더 묻는다(`useProjectRemoval`).
  it("보통 줄은 Finder에서 열기 · 경로 복사 · 제거…이고, 세 줄이 같은 줄이다", () => {
    expect(rowMenu(project())).toEqual([
      { act: "open-folder", label: "Finder에서 열기" },
      { act: "copy-path", label: "경로 복사" },
      { act: "remove", label: "제거…" },
    ]);
  });

  it("폴더를 찾을 수 없는 줄은 제거…만 남는다 — 없는 폴더를 Finder에서 열려 하지 않는다", () => {
    expect(rowMenu(PLAYGROUND)).toEqual([{ act: "remove", label: "제거…" }]);
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

describe("상세 조각의 글", () => {
  it("폴더를 찾을 수 없음 — 상세 경고의 한 줄이다(보드 PlaceSheet 「폴더를 찾을 수 없는 Project」)", () => {
    expect(missingNotice()).toBe("폴더를 찾을 수 없어요. 옮겼다면 재설정으로 새 경로를 알려 주세요.");
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
