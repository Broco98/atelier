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
  // 「지금 이게 중요하다」 — 화면 설정이 아니라 그 작업에 대한 사실이라 work.json에 산다
  // (결정 81). 목록에서 고정된 것이 먼저 오는 것도 코어가 정한다 (결정 100).
  pinned: boolean;
  worktrees: WorktreeView[];
  specDir: string;
  specFiles: string[];
}
