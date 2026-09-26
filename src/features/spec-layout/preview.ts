import { sameDraft, type LayoutDraft } from "./draft";
import type { LayoutPreview } from "./types";

// 편집기가 엔진에 묻는 미리보기(spec 레이아웃 티켓 14 · 구현 스펙 5절). 편집기는 초안이 바뀔 때마다 짧은 지연 뒤에
// `render_spec_layout`을 부른다 — **팝업을 닫은 동안에도** 부른다: 그 답의 검증 오류가 항목 아래에 서고 저장을
// 잠근다(스토리 30·31). 오류를 가리는 규칙은 엔진에 한 벌이다(결정 13) — 여기는 답을 어느 초안의 것으로 받을지,
// 저장을 열지만 정한다.

/** 초안이 바뀐 뒤 엔진에 묻기까지 기다리는 시간 — 레이아웃 폴더의 감시가 모으는 시간(300ms)과 같다. */
export const PREVIEW_DELAY_MS = 300;

/** 초안 하나에 대한 엔진의 답 — 몇 번째 요청의 답인지(`seq`), 어느 초안에 대해 물었는지를 함께 쥔다. */
export interface DraftPreview {
  seq: number;
  draft: LayoutDraft;
  answer: LayoutPreview;
}

/**
 * 도착한 답을 받을까 — **늦게 온 옛 요청의 답은 버린다.** 순번은 요청을 보낸 차례다. 초안을 빠르게 고치면
 * 요청이 여럿 떠 있고 답은 보낸 차례로 오지 않는다 — 옛 답이 새 답을 덮으면 고친 초안의 오류가 사라진다.
 */
export function latestPreview(now: DraftPreview | null, arrived: DraftPreview): DraftPreview {
  return now !== null && now.seq > arrived.seq ? now : arrived;
}

/**
 * 편집기의 저장을 열까(구현 스펙 5절 — 저장 가능 판정). 넷이 모두 맞아야 한다.
 *
 * - **고친 것이 있다** — 초안이 기준본(마지막으로 읽거나 저장한 것)과 내용으로 다르다(`sameDraft`).
 * - **지금 초안에 대한 답이 도착했다** — 답은 초안의 내용에 대한 것이라 내용으로 견준다. 옛 초안의 답이
 *   오류가 없었다고 지금 초안도 그렇다는 법은 없다.
 * - **그 답에 오류가 없다** — 잘못된 동안 저장이 잠긴다(스토리 31).
 * - **저장 중이 아니다.**
 */
export function canSave(state: {
  draft: LayoutDraft;
  baseline: LayoutDraft;
  preview: DraftPreview | null;
  saving: boolean;
}): boolean {
  const { draft, baseline, preview, saving } = state;
  if (saving || sameDraft(draft, baseline)) return false;
  return preview !== null && sameDraft(preview.draft, draft) && preview.answer.errors.length === 0;
}
