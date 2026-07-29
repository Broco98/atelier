// draft는 "아직 시작 전"을 **선언**한 것이다 — 프로젝트 유무에서 파생되지 않는다.
export type WorkStatus = "draft" | "active" | "review" | "done";

export interface TreeView {
  project: string;
  path: string;
  exists: boolean;
  dirty: boolean;
}

export interface WorkView {
  slug: string;
  title: string;
  status: WorkStatus;
  branch: string;
  createdAt: string;
  projects: string[];
  trees: TreeView[];
  specDir: string;
  specFiles: string[];
}
