import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { showProblem } from "@/components/ui/confirm-store";
import { useCreateProject } from "./hooks";
import type { ProjectView } from "./types";

/**
 * **「Project 추가」의 길 하나**(03 구현 스펙 §14 · 코드 지도 §5 「03 × 09」) — Projects 화면의 추가와 Space 상세 「넣기 › 새 Project 추가…」가
 * 같은 이것을 부른다. 등록한 Project를 돌려주고, 고르지 않았거나 못 했으면 `null`이다(못 한 까닭은 여기서 문제 창으로 말한다). 부르는
 * 쪽은 받은 Project로 제 일을 잇는다 — Projects 화면은 그것을 고르고, Space 상세는 그 Space에도 넣는다(스토리 154).
 *
 * 지금은 폴더 고르기 창 직행이다 — 기준 브랜치는 백엔드가 감지하고 상세에서 바꾼다. 추가 창(09)이 서면 이 안을 그 창으로 바꾼다.
 */
export function useAddProject() {
  const createProject = useCreateProject();
  const add = async (): Promise<ProjectView | null> => {
    if (createProject.isPending) return null;
    const folder = await openFolderPicker({ directory: true });
    if (typeof folder !== "string") return null;
    try {
      return await createProject.mutateAsync(folder);
    } catch (e) {
      await showProblem(`프로젝트를 추가하지 못했습니다: ${e}`);
      return null;
    }
  };
  return add;
}
