import { invoke } from "@tauri-apps/api/core";
import type { FolderLook, NewProjectPlace, ProjectPatch, ProjectRemoval, ProjectUsage, ProjectView } from "./types";

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
  /** 재설정 — 폴더를 찾을 수 없는 Project의 새 자리. git 저장소의 뿌리만 받고 경로만 바꾼다(03 구현 스펙 §15). */
  relocate: (slug: string, folder: string) => invoke<ProjectView>("relocate_project", { slug, folder }),
  // 제거(03 구현 스펙 §15) — 확인 창이 읽는 것 · 제거 · 되돌리기. 진행 중인 Work가 고치면 제거는 그 Work들로 끝난다(막힘).
  usage: (slug: string) => invoke<ProjectUsage>("project_usage", { slug }),
  remove: (slug: string) => invoke<ProjectRemoval>("remove_project", { slug }),
  /** 되돌리기 — 지운 뒤 토스트의 「되돌리기」만 부른다. 그사이 같은 slug · 같은 폴더가 다시 등록됐으면 거절한다. */
  restore: (slug: string) => invoke<ProjectView>("restore_project", { slug }),
  openFolder: (slug: string) => invoke<void>("open_project_folder", { slug }),
};
