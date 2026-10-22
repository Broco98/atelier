import { invoke } from "@tauri-apps/api/core";
import type { WorktreeFile } from "./types";

// 인자 객체가 평평한 것은 `tauri-commands.test.ts`의 인자 대조 때문이다(`features/works/api.ts` 머리말과 같다).
export const codeApi = {
  /** 워크트리 파일 하나. 경로는 워크트리 기준이다 — `..` · 절대 경로는 코어가 거절한다. */
  readFile: (slug: string, project: string, path: string) =>
    invoke<WorktreeFile>("read_worktree_file", { slug, project, path }),
};
