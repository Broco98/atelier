import { describe, expect, it } from "vitest";
import { setDescription, type LayoutDraft } from "./draft";
import { canSave, latestPreview, type DraftPreview } from "./preview";
import type { LayoutPreview } from "./types";

// 편집기가 엔진에 묻는 미리보기(spec 레이아웃 티켓 14 · 구현 스펙 5절). 편집기는 초안이 바뀔 때마다 짧은 지연 뒤에
// `render_spec_layout`을 부르고, 그 답의 오류가 항목 아래에 서며 저장을 잠근다. 이 저장소의 L2에는 DOM이 없어
// 상태를 쥔 편집기가 아니라 그것이 기대는 순수 함수를 잰다 — 설정의 `canSave`와 같은 방식이다.

function opened(): LayoutDraft {
  return {
    layout: {
      owner: "사람",
      root: {
        description: "방침 문단.",
        children: [{ pattern: "decisions.md", kind: "file", template: "decisions.md" }],
      },
    },
    templates: { "decisions.md": "# 결정\n" },
  };
}

const CLEAN: LayoutPreview = {
  text: "Spec layout — how to arrange documents inside `specDir`.",
  lines: [],
  errors: [],
  warnings: [],
};

const REFUSED: LayoutPreview = {
  text: null,
  lines: [],
  errors: [{ path: [0], message: 'template "decisions.md" is neither given nor in the layout folder' }],
  warnings: [],
};

describe("저장 가능 판정", () => {
  // 읽은 뒤 설명 한 칸을 고쳤고, 그 초안에 대한 답이 오류 없이 도착했다 — 저장이 열리는 기본형이다.
  const baseline = opened();
  const edited = setDescription(baseline, [0], "정한 것과 그 이유");
  const state = (over: Partial<Parameters<typeof canSave>[0]> = {}) =>
    canSave({
      draft: edited,
      baseline,
      preview: { seq: 1, draft: edited, answer: CLEAN },
      saving: false,
      ...over,
    });

  it("고친 것이 있고, 지금 초안의 답이 오류 없이 도착했고, 저장 중이 아니면 열린다", () => {
    expect(state()).toBe(true);
  });

  it("답에 오류가 있으면 잠긴다", () => {
    expect(state({ preview: { seq: 1, draft: edited, answer: REFUSED } })).toBe(false);
  });

  // 오류 없는 답이 와 있어도 그것이 고치기 전 초안의 것이면, 지금 초안이 괜찮은지는 아직 모른다.
  it("답이 옛 초안의 것이면 잠긴다", () => {
    const older = setDescription(baseline, [0], "정한 것");
    expect(state({ preview: { seq: 1, draft: older, answer: CLEAN } })).toBe(false);
    expect(state({ preview: null })).toBe(false);
  });

  // 답은 초안의 내용에 대한 것이다 — 같은 내용으로 다시 지은 초안이면 그 답이 지금 초안의 답이다.
  it("답의 초안이 지금 초안과 내용이 같으면 지금 초안의 답이다", () => {
    const same = setDescription(baseline, [0], "정한 것과 그 이유");
    expect(same).not.toBe(edited);
    expect(state({ preview: { seq: 1, draft: same, answer: CLEAN } })).toBe(true);
  });

  it("고친 것이 없으면 잠긴다 — 고쳤다가 되돌린 것도", () => {
    expect(state({ draft: baseline, preview: { seq: 1, draft: baseline, answer: CLEAN } })).toBe(false);
    const back = setDescription(edited, [0], "");
    expect(state({ draft: back, preview: { seq: 2, draft: back, answer: CLEAN } })).toBe(false);
  });

  it("저장 중이면 잠긴다", () => {
    expect(state({ saving: true })).toBe(false);
  });
});

// **요청마다 순번을 둔다**(구현 스펙 5절) — 초안을 빠르게 고치면 요청이 여럿 떠 있고, 답은 보낸 차례로 오지
// 않는다. 늦게 온 옛 답이 새 초안의 답을 덮으면 고친 초안의 오류가 사라지고 잠긴 저장이 풀린다.
describe("순번", () => {
  const first: DraftPreview = { seq: 1, draft: opened(), answer: REFUSED };
  const second: DraftPreview = {
    seq: 2,
    draft: setDescription(opened(), [0], "고쳤다"),
    answer: CLEAN,
  };

  it("늦게 온 옛 답은 버려진다", () => {
    expect(latestPreview(second, first)).toBe(second);
  });

  it("새 답은 받는다 — 처음 온 답도", () => {
    expect(latestPreview(first, second)).toBe(second);
    expect(latestPreview(null, first)).toBe(first);
  });
});
