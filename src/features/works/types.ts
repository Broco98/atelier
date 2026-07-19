export type WorkStatus = "active" | "review" | "done";

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
  specFiles: string[];
}
