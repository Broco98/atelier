// draft는 "아직 시작 전"을 **선언**한 것이다 — 프로젝트 유무에서 파생되지 않는다.
export type WorkStatus = "draft" | "active" | "review" | "done";

export interface WorktreeView {
  project: string;
  path: string;
  exists: boolean;
  dirty: boolean;
}

/**
 * spec 트리의 번호 묶음 소속 — `{n}` 항목 하나가 폴더 하나 안에서 맞은 것들의 모임이다.
 * `key`의 글자 모양은 약속이 아니다: 같은 묶음이면 같고 다른 묶음이면 다를 뿐이다.
 */
export interface SpecTreeGroup {
  key: string;
  n: number;
  /** 묶음의 맨 앞(최신) 하나에만 붙는다. 그것만 기본으로 펼친다. */
  latest: boolean;
}

/** spec 트리의 파일·폴더 하나. `children`은 그리는 순서 그대로이고, 파일이면 비어 있다. */
export interface SpecTreeItem {
  name: string;
  /** spec 기준 경로 — 문서를 여는 값이다. */
  path: string;
  kind: "file" | "folder";
  /** 레이아웃의 항목이 준 아이콘 이름. 맞지 않았거나 항목에 아이콘이 없으면 `null`이다. */
  icon: string | null;
  group: SpecTreeGroup | null;
  children: SpecTreeItem[];
}

/**
 * spec 트리 — 엔진(`crates/atelier-core/src/layout/classify.rs`)이 레이아웃의 자리로 가른 것.
 * **앱에는 규칙이 없다**(spec 레이아웃 결정 13): 무엇을 먼저 열지도, 어떤 순서로 세울지도 이
 * 값이 이미 정했다. 필드 이름이 코어의 JSON과 한 글자도 다르지 않아야 한다.
 */
export interface SpecTree {
  /** 레이아웃 폴더를 못 써서 내장본으로 물러섰다면 그 까닭. */
  fallback: string | null;
  /** 처음 열 문서(spec 기준 경로). 파일이 하나도 없으면 `null`이다. */
  defaultDoc: string | null;
  items: SpecTreeItem[];
}

/**
 * 앱이 받는 work 하나. **커널의 뷰에 `specTree`가 더해진 모양이다** — 코어의 `WorkWithSpecTree`가
 * 뷰를 펼치고 트리를 곁에 싣는다. MCP가 주는 work JSON에는 트리가 없다(에이전트가 받는 JSON이
 * 불어나지 않게). 트리를 싣는 것은 목록·단건·옮기기의 답뿐이라, 다른 쓰기의 답은
 * `KernelWorkView`로 받는다(`api.ts`).
 */
export interface WorkView extends KernelWorkView {
  specTree: SpecTree;
}

/** 커널의 work 뷰 — 트리가 없는 모양. 화면이 쓰지 않는 쓰기의 답(`set_work_*`)이 이것이다. */
export interface KernelWorkView {
  slug: string;
  title: string;
  status: WorkStatus;
  // 프로젝트가 아직 없으면 브랜치는 미정이다. 키 유무가 아니라 null로 판단한다.
  branch: string | null;
  createdAt: string;
  projects: string[];
  // 「지금 이게 중요하다」 — 화면 설정이 아니라 그 작업에 대한 사실이라 work.json에 산다
  // (결정 81). 목록에서 고정된 것이 먼저 오는 것도 코어가 정한다 (결정 100).
  pinned: boolean;
  worktrees: WorktreeView[];
  specDir: string;
  specFiles: string[];
}

/**
 * Project 하나의 변경(v1 티켓 33 · S23 — 코어 `ProjectChanges`, `list_work_changes`의 한 칸) — worktree의 base 대비 바뀐 파일과 +/−.
 * 커밋한 것과 아직 커밋하지 않은 것을 합친다. 파일은 늦게 고친 것이 앞이다(코어가 정한다). `additions` · `deletions`가 `null`이면
 * 바이너리이거나 너무 큰 새 파일이다 — 0으로 그리지 않는다. worktree가 없는 Project(읽기만)는 `worktreeMissing`이다.
 */
export type ProjectChanges = { project: string } & (
  | { kind: "listed"; base: string; files: ChangedFile[] }
  | { kind: "worktreeMissing" }
  | { kind: "baseUnknown"; base: string | null }
  | { kind: "unreadable"; reason: string }
);

/** 바뀐 파일 하나 — worktree 기준 경로와 +/− 줄 수. */
export interface ChangedFile {
  path: string;
  additions: number | null;
  deletions: number | null;
}

/** PR의 CI 상태(코어 `PrChecks`). */
export type PrChecks =
  | { kind: "noChecks" }
  | { kind: "pending" }
  | { kind: "passing" }
  | { kind: "failing"; failed: string[] };

/**
 * Project 하나의 PR(v1 티켓 33 · S24 — 코어 `ProjectPr`, `read_work_prs`의 한 칸). `absent`는 PR이 없거나 `gh`가 없거나 로그인이 안 된
 * 것이고, `unreadable`은 네트워크 등으로 못 읽은 것이다 — 둘 다 PR 줄을 그리지 않는다.
 */
export type ProjectPr = { project: string } & (
  | {
      kind: "found";
      number: number;
      title: string;
      url: string;
      state: "open" | "closed" | "merged";
      headBranch: string;
      baseBranch: string;
      additions: number;
      deletions: number;
      changedFiles: number;
      ci: PrChecks;
      approvals: number;
      changesRequested: number;
      mergedAt: string | null;
    }
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string }
);
