// draft는 "아직 시작 전"을 **선언**한 것이다 — 프로젝트 유무에서 파생되지 않는다.
export type WorkStatus = "draft" | "active" | "review" | "done";

export interface WorktreeView {
  project: string;
  path: string;
  exists: boolean;
  dirty: boolean;
}

export interface WorkView {
  slug: string;
  title: string;
  status: WorkStatus;
  // 프로젝트가 아직 없으면 브랜치는 미정이다. 키 유무가 아니라 null로 판단한다.
  branch: string | null;
  createdAt: string;
  projects: string[];
  worktrees: WorktreeView[];
  specDir: string;
  specFiles: string[];
}
