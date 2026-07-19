import { invoke } from "@tauri-apps/api/core";
import type { ProjectPatch, ProjectView } from "./types";

export const projectsApi = {
  list: () => invoke<ProjectView[]>("list_projects"),
  create: (folder: string) => invoke<ProjectView>("create_project", { folder }),
  update: (slug: string, patch: ProjectPatch) =>
    invoke<ProjectView>("update_project", { slug, ...patch }),
  remove: (slug: string) => invoke<void>("delete_project", { slug }),
  openFolder: (slug: string) => invoke<void>("open_project_folder", { slug }),
};
