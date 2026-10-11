import { invoke } from "@tauri-apps/api/core";
import type { WorktreeTree } from "./types";

// 인자 객체가 평평한 것은 `tauri-commands.test.ts`의 인자 대조 때문이다(`works/api.ts` 머리말과 같다).
export const filesApi = {
  /** 워크트리 하나의 트리 — 워크트리는 work slug와 프로젝트 slug로 코어가 찾는다(경로를 여기서 짓지 않는다). */
  tree: (slug: string, project: string) => invoke<WorktreeTree>("list_worktree_tree", { slug, project }),
};
