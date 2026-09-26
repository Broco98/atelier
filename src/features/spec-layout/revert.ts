import { askDanger } from "@/components/ui/confirm-store";
import { layoutDirRef } from "@/features/works/refs";
import { modeNameOf } from "@/mode";
import type { SpecLayoutState } from "./types";

/**
 * 「기본값으로 되돌리기」를 묻는다(spec 레이아웃 티켓 10 · 결정 7). 되돌리기는 모드의 레이아웃 폴더를
 * **폴더째** 지운다 — 템플릿도, 레이아웃이 모르는 파일도 함께 사라진다. 그래서 창은 지울 폴더와
 * 사라지는 것의 수를 적고, 되돌린 뒤의 뜻(다음 호출부터 에이전트가 받는 것)을 적는다.
 *
 * **수는 엔진의 상태가 준 그대로다**(`spec_layout_states`) — 여기서 폴더를 다시 세지 않는다. 읽지 못한
 * 폴더에서는 무엇이 템플릿인지 몰라 템플릿의 수가 없다(`templateCount`가 `null`). 그때는 폴더 안의
 * 파일을 센 것만 적는다.
 *
 * 본문은 두 줄이다 — 지우는 것(폴더와 함께 사라지는 것)과, 되돌린 뒤의 뜻. 창의 설명은 줄바꿈을 줄바꿈으로
 * 보이므로(P4) 작업 ⋯의 확인 창(`work-menu-copy.ts`)처럼 대가와 그 뒤를 다른 줄에 세운다.
 *
 * 창은 붉은 확인 창의 선례(`askDanger`)다 — [취소]와, 경고색의 [되돌리기]. 답이 `true`면 되돌린다.
 */
export function askRevert(state: SpecLayoutState): Promise<boolean> {
  return askDanger(
    `${modeNameOf(state.id)} 레이아웃을 기본값으로 되돌릴까요?`,
    `${layoutDirRef(state.folder)} 폴더를 지워요. ${goneOf(state)}가 함께 사라져요.\n` +
      "다음 호출부터 에이전트는 내장 안내문을 받아요.",
    "되돌리기",
  );
}

/** 폴더와 함께 사라지는 것 — 「템플릿 N개」, 레이아웃이 모르는 파일이 있으면 「그 밖의 파일 M개」까지. */
function goneOf({ templateCount, otherFileCount }: SpecLayoutState): string {
  if (templateCount === null) return `파일 ${otherFileCount}개`;
  const templates = `템플릿 ${templateCount}개`;
  return otherFileCount > 0 ? `${templates}와 그 밖의 파일 ${otherFileCount}개` : templates;
}
