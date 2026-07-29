import { invoke } from "@tauri-apps/api/core";
import type { WorkStatus, WorkView } from "./types";

export const worksApi = {
  list: () => invoke<WorkView[]>("list_works"),
  get: (slug: string) => invoke<WorkView>("get_work", { slug }),
  setTitle: (slug: string, title: string) =>
    invoke<WorkView>("set_work_title", { slug, title }),
  setStatus: (slug: string, status: WorkStatus) =>
    invoke<WorkView>("set_work_status", { slug, status }),
  readSpec: (slug: string, path: string) =>
    invoke<string>("read_spec_file", { slug, path }),
};
