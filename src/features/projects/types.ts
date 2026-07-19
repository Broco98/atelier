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
  description?: string;
  baseBranch?: string;
}
