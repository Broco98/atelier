import { coreError } from "./core-errors";
import type { ProjectUsage, UsingWork } from "./types";

// Project 제거 창이 무엇을 말할지(03 구현 스펙 §16 「제거 창」 · 스토리 128 · 129 · 131 · 134 · 캔버스 F4-ProjRemoveBlocked · F4-KitProject 「제거 창」).
// 갈래는 core의 제거 확인 읽기(`project_usage`) 하나로 정한다 — 진행 중인 Work가 있으면 막힘, 없으면 묻기(Space가 있으면 그 말을 더한다).
// 그리는 것은 `ProjectRemoveDialog.tsx`다.

/** 창이 그릴 것 — 제목 · 설명 줄 · Work 줄(막힘에만) · 닫는 단추의 글 · 제거 단추가 켜지는가. */
export interface RemoveDialog {
  kind: "ask" | "blocked";
  title: string;
  lines: string[];
  works: UsingWork[];
  cancel: string;
  canRemove: boolean;
}

/** 「… Space에서도 빠져요」가 이름으로 부르는 Space 수 — 넘으면 「외 N개」로 접는다. */
const NAMED_SPACES = 3;

export function removeDialog(usage: ProjectUsage): RemoveDialog {
  if (usage.works.length > 0) {
    return {
      kind: "blocked",
      title: "아직 제거할 수 없어요",
      lines: [`진행 중인 Work ${usage.works.length}개가 이 Project를 고치고 있어요. Work를 끝내 보관하면 제거할 수 있어요.`],
      works: usage.works,
      cancel: "닫기",
      canRemove: false,
    };
  }
  const lines = ["폴더와 파일, git 기록은 그대로예요. 언제든 다시 추가할 수 있어요."];
  if (usage.spaces.length > 0) {
    const named = usage.spaces.slice(0, NAMED_SPACES).map((space) => space.name).join(" · ");
    const more = usage.spaces.length - NAMED_SPACES;
    lines.push(`${named}${more > 0 ? ` 외 ${more}개` : ""} Space에서도 빠져요.`);
  }
  return { kind: "ask", title: "목록에서 제거할까요?", lines, works: [], cancel: "취소", canRemove: true };
}

/** 지운 뒤 토스트의 말(스토리 134) — 끝에 「되돌리기」가 선다(`showUndoToast`). */
export function removedToast(name: string): string {
  return `목록에서 뺐어요 — ${name}`;
}

/**
 * 되돌리기가 거절된 까닭(core 오류 글)을 사람의 말로 — 그사이 같은 slug나 같은 폴더가 다시 등록됐다(03 구현 스펙 §15 「되돌리기」). 갈래는 core
 * 글을 읽는 한 곳(`coreError`)이 가른다.
 */
export function restoreProblem(error: string): string {
  const hit = coreError(error);
  const why =
    hit?.kind === "slugReused"
      ? `그사이 같은 이름의 Project(${hit.fields[0]})가 다시 추가됐어요.`
      : hit?.kind === "alreadyRegistered"
        ? `그 폴더가 다른 Project(${hit.fields[0]})로 다시 추가됐어요.`
        : hit?.kind === "projectNotFound"
          ? "되돌릴 Project가 없어요."
          : error;
  return `되돌리지 못했어요 — ${why}`;
}
