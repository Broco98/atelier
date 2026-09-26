import { sameDraft, samePath, unsaved, type LayoutDraft } from "./draft";
import type { LayoutError, ReadableSpecLayout, SpecLayoutRead } from "./types";

// 밖에서 바뀐 레이아웃(spec 레이아웃 티켓 15 · 결정 22 · 구현 스펙 5절). 편집기는 열 때 읽은 레이아웃과 템플릿 본문을
// **기준본**으로 쥔다. 에이전트가 레이아웃을 저장하거나 사람이 손으로 고치면 감시가 울리고, 앱 전역의 구독 하나가
// 레이아웃 읽기를 다시 부른다(`useFollowLayoutChanges`) — 편집기는 따로 듣지 않고, 다시 읽힌 답을 기준본과
// **내용으로** 견준다. 경로를 가려 듣지 않으므로 다른 모드의 폴더가 바뀌어도 읽기가 다시 오지만, 내용이 같아 무시된다.
//
// 편집기의 초안과 밖의 변경을 **합치지 않는다**(결정 22). 초안이 없으면 조용히 새것을 받고, 있으면 배너로 한쪽을
// 고르게 한다.

/**
 * 다시 읽은 레이아웃을 어떻게 받을까 — 판정 표의 여섯 줄(구현 스펙 5절)이다.
 *
 * - `ignore` — 기준본과 같다. 아무것도 하지 않는다.
 * - `unreadable` — 초안이 없고 깨졌다. 편집기가 「읽지 못함」 화면으로 바뀐다. 배너는 없다.
 * - `replace` — 초안이 없다. 조용히 새것으로 바꾼다(지워졌으면 읽기가 내장본을 준다).
 * - `broken` · `removed` · `changed` — 초안이 있다. 배너가 선다: 깨졌다, 지워졌다, 바뀌었다.
 */
export type OutsideVerdict = "ignore" | "unreadable" | "replace" | "broken" | "removed" | "changed";

/** 배너가 서는 판정 — 초안이 있을 때의 셋이다. */
export type BannerVerdict = Extract<OutsideVerdict, "broken" | "removed" | "changed">;

/**
 * 밖 변경 판정. **위에서 먼저 맞는 줄이 이긴다.**
 *
 * | # | 조건 | 판정 |
 * |---|---|---|
 * | 1 | 새로 읽은 것이 기준본과 같다 | `ignore` |
 * | 2 | 초안 = 기준본이고, 새로 읽은 것이 깨졌다 | `unreadable` |
 * | 3 | 초안 = 기준본 (바뀌었거나 지워졌다) | `replace` |
 * | 4 | 초안이 있고, 새로 읽은 것이 깨졌다 | `broken` |
 * | 5 | 초안이 있고, 지워졌다 | `removed` |
 * | 6 | 초안이 있고, 바뀌었다 | `changed` |
 *
 * 「지워졌다」는 기준본이 폴더의 것이었는데 새로 읽은 것이 내장본인 경우다 — 손으로 지웠거나 설정에서 되돌렸다.
 *
 * `draft`가 `null`이면 편집기가 「읽지 못함」 화면이라 초안이 없다 — 늘 새것을 받는다(2·3번).
 */
export function judgeOutside(
  baseline: SpecLayoutRead,
  draft: LayoutDraft | null,
  fresh: SpecLayoutRead,
): OutsideVerdict {
  if (sameRead(fresh, baseline)) return "ignore";
  const broken = "errors" in fresh;
  if (draft === null || !unsaved(draft, contentOf(baseline))) return broken ? "unreadable" : "replace";
  if (broken) return "broken";
  if (baseline.edited && !fresh.edited) return "removed";
  return "changed";
}

/**
 * 읽은 레이아웃의 내용 — 편집기가 초안으로 펼치는 레이아웃과 템플릿 본문이다. 깨졌으면 펼칠 것이 없어 `null`이다.
 */
export function contentOf(read: SpecLayoutRead): LayoutDraft | null {
  return "errors" in read ? null : { layout: read.layout, templates: read.templates };
}

/**
 * 제 저장 뒤의 기준본 — 저장한 초안이다. 저장은 늘 레이아웃 폴더에 쓰므로(처음 저장이면 폴더를 만들어 내장본을
 * 가린다) 폴더의 것이다. 그래서 제 저장이 부른 무효화로 다시 읽은 답은 판정 1번(무시)에 걸린다.
 */
export function savedBaseline(before: SpecLayoutRead, saved: LayoutDraft): ReadableSpecLayout {
  return {
    id: before.id,
    folder: before.folder,
    edited: true,
    layout: saved.layout,
    templates: saved.templates,
    warnings: [],
  };
}

/**
 * 두 읽기가 같은가 — 읽을 수 있으면 레이아웃과 템플릿 본문을(키의 순서 없이), 깨졌으면 원문과 오류를 견준다.
 * 폴더의 것인지 내장본인지(`edited`)는 보지 않는다: 같은 내용이면 저장되는 것도, 에이전트가 받는 것도 같다.
 */
function sameRead(a: SpecLayoutRead, b: SpecLayoutRead): boolean {
  const [left, right] = [contentOf(a), contentOf(b)];
  if (left !== null && right !== null) return sameDraft(left, right);
  if ("errors" in a && "errors" in b) return a.raw === b.raw && sameErrors(a.errors, b.errors);
  return false;
}

function sameErrors(a: LayoutError[], b: LayoutError[]): boolean {
  return (
    a.length === b.length &&
    a.every(({ path, message }, i) => {
      const other = b[i];
      return message === other.message && (path === null ? other.path === null : samePath(other.path, path));
    })
  );
}
