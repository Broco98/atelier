import { coreError } from "@/features/projects/core-errors";
import { spaceName } from "./space-view";
import type { Space, SpaceUsage } from "./types";

// Space 지우기가 무엇을 말할지(03 구현 스펙 §14 「지우기」 · 스토리 181 · 182 · 캔버스 F4-SpaceDelete · F4-KitSpace 「확인 창」 · 「지운 뒤」). 수는
// core의 쓰임 읽기(`space_usage`) 하나다 — Thread는 Work 없는 Thread와 이은 Work의 Thread(지우면 그 Thread마다 「지워짐」 줄이 선다). 그리는
// 것은 `SpaceDeleteDialog.tsx`다.

/** 창이 그릴 것 — 제목 · Space 카드 줄(이름 · Project) · 무엇이 바뀌고 무엇이 그대로인지 한 문단. */
export interface DeleteDialog {
  title: string;
  name: string;
  projects: string;
  body: string;
}

export function deleteDialog(space: Space, usage: SpaceUsage): DeleteDialog {
  const name = spaceName(space);
  const counts = [usage.threads > 0 && `Thread ${usage.threads}개`, usage.works > 0 && `Work ${usage.works}개`].filter(Boolean).join(" · ");
  return {
    title: `${name} Space를 삭제할까요?`,
    name,
    projects: space.projects.length > 0 ? space.projects.join(" · ") : "Project 없음",
    body:
      counts === ""
        ? "Project와 파일은 그대로예요."
        : `${counts}가 이 Space에서 빠져 「Space 없음」이 돼요. Project와 파일, 대화 · 문서 · worktree는 그대로예요.`,
  };
}

/** 지운 뒤 토스트의 말(스토리 182) — 끝에 「되돌리기」가 선다(`showUndoToast`). */
export function deletedToast(name: string): string {
  return `${name} Space를 지웠어요`;
}

/**
 * 되돌리기가 거절된 까닭(엔진 · core 오류 글)을 사람의 말로 — 그사이 같은 slug의 Space가 새로 생겼다(03 구현 스펙 §9 「되돌리기」). 갈래는 core
 * 글을 읽는 한 곳(`coreError`)이 가른다 — Project 되돌리기와 같은 `slugReused`다.
 */
export function restoreSpaceProblem(error: string): string {
  const hit = coreError(error);
  const why =
    hit?.kind === "slugReused"
      ? `그사이 같은 파일 이름(${hit.fields[0]})의 Space가 새로 생겼어요.`
      : hit?.kind === "spaceNotFound"
        ? "되돌릴 Space가 없어요."
        : error;
  return `되돌리지 못했어요 — ${why}`;
}
