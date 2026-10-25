import { invoke } from "@tauri-apps/api/core";
import type { FolderLook, NewProjectPlace, ProjectPatch, ProjectView } from "./types";

export const projectsApi = {
  list: () => invoke<ProjectView[]>("list_projects"),
  // 추가 창(03 구현 스펙 §15 · §16) — 살피기 · 추가 · 새로 만들 자리 · 새로 만들기. 경로는 살피기 · 자리가 돌려준 꼴(`~/…`)을 그대로
  // 되돌려 넘겨도 된다(core가 `~`를 푼다).
  inspect: (folder: string) => invoke<FolderLook>("inspect_project_folder", { folder }),
  /** 추가 — 이름 칸이 비면 폴더 이름이다. git이 아닌 폴더는 `initGit`일 때만 받는다(「git init 하고 추가」). */
  create: (folder: string, name: string | null, initGit: boolean) =>
    invoke<ProjectView>("create_project", { folder, name, initGit }),
  place: (parent: string, name: string) => invoke<NewProjectPlace>("new_project_place", { parent, name }),
  /** 새로 만들기 — 폴더 · `git init -b main` · 빈 첫 커밋 · 등록. 그 자리에 무엇이 있거나 git이 실패하면 거절한다. */
  make: (parent: string, name: string) => invoke<ProjectView>("new_project", { parent, name }),
  update: (slug: string, patch: ProjectPatch) =>
    invoke<ProjectView>("update_project", { slug, ...patch }),
  remove: (slug: string) => invoke<void>("delete_project", { slug }),
  openFolder: (slug: string) => invoke<void>("open_project_folder", { slug }),
};
