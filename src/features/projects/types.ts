export interface GitInfo {
  remoteSlug: string | null;
  currentBranch: string | null;
  localBranches: string[];
}

export interface ProjectView {
  slug: string;
  name: string;
  path: string;
  baseBranch: string;
  createdAt: string;
  description: string;
  git: GitInfo | null;
  missing: boolean;
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  baseBranch?: string;
}

/**
 * 고른 폴더가 무엇인가 — 추가 창이 폴더를 고르는 순간 묻는다(03 구현 스펙 §15 「폴더 살피기」). **정본은 core `store.rs`의 `FolderLook`**이고
 * 여기는 그 응답의 타입이다. `path`는 모두 화면에 서는 꼴(`~`로 줄인 것)이고, 그대로 추가에 되돌려 넘긴다.
 */
export type FolderLook =
  /** git 저장소의 뿌리 — 기준 브랜치는 `baseBranch`(origin/HEAD → 지금 브랜치 → main), 원격은 이름들과 origin의 owner/repo다. */
  | { kind: "repo"; path: string; baseBranch: string; remotes: string[]; git: GitInfo }
  /** 저장소 안의 하위 폴더 — 뿌리(`root`)로 바꿀지 사람이 고른다. 그대로 추가해도 된다. */
  | { kind: "subfolder"; path: string; root: string; baseBranch: string }
  /** git 저장소가 아니다 — 「git init 하고 추가」로만 추가된다. */
  | { kind: "notGit"; path: string }
  /** 이미 등록된 폴더 — 그 Project다. */
  | { kind: "registered"; path: string; project: ProjectView }
  /** 폴더가 없다(지웠거나 옮겼거나, 폴더가 아닌 파일). */
  | { kind: "missing"; path: string };

/** 새로 만들 자리 — 「새로 만들기」가 이름을 칠 때마다 묻는다. 정본은 core `store.rs`의 `NewProjectPlace`다. */
export interface NewProjectPlace {
  /** 부모 폴더 — 화면의 꼴로 다시 적은 것. */
  parent: string;
  /** 만들 폴더(`<부모>/<폴더 이름>`). 이름이 비었으면 없다. */
  path: string | null;
  /** 그 자리에 무엇이 이미 있다 — 그러면 만들지 않는다. */
  taken: boolean;
}
