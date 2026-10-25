import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { showProblem } from "@/components/ui/confirm-store";
import { useRelocateProject } from "./hooks";
import { relocateProblem } from "./project-view";
import type { ProjectView } from "./types";

/**
 * 「재설정」(03 구현 스펙 §16 · 스토리 126 · 127) — 폴더를 찾을 수 없는 Project가 새 자리를 고른다. 폴더 고르기 → core 재설정이고, 경로는 이
 * 길로만 바뀐다. git 저장소의 뿌리가 아니거나 이미 다른 Project인 폴더는 core가 거절하고, 그 까닭을 사람의 말로 알린다. 목록 줄 끝과 상세의
 * 두 「재설정」이 이 하나를 부른다.
 */
export function useRelocate(): (project: ProjectView) => Promise<void> {
  const relocate = useRelocateProject();
  return async (project) => {
    const picked = await openFolderPicker({ directory: true, title: `${project.name}의 새 위치` });
    if (typeof picked !== "string") return;
    try {
      await relocate.mutateAsync({ slug: project.slug, folder: picked });
    } catch (e) {
      await showProblem(`재설정하지 못했어요 — ${relocateProblem(String(e))}`);
    }
  };
}
