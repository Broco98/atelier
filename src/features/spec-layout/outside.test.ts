import { describe, expect, it } from "vitest";
import { contentOf, setDescription, setTemplateBody, type LayoutDraft } from "./draft";
import { judgeOutside, savedBaseline } from "./outside";
import type { ReadableSpecLayout, SpecLayoutRead, UnreadableSpecLayout } from "./types";

// 밖에서 바뀐 레이아웃(spec 레이아웃 티켓 15 · 결정 22 · 구현 스펙 5절). 편집기는 열 때 읽은 레이아웃과 템플릿
// 본문을 **기준본**으로 쥐고, 전역 구독이 읽기를 다시 부르면 새로 읽은 것을 기준본과 **내용으로** 견준다. 판정은
// 기준본·초안·새로 읽은 것을 받는 순수 함수이고, 표의 위에서 먼저 맞는 줄이 이긴다. 이 저장소의 L2에는 DOM이
// 없어 상태를 쥔 편집기가 아니라 이 함수를 잰다.

/** 편집기가 연 레이아웃 — 레이아웃 폴더의 것이다(`edited`). 손으로 적은 모르는 키와 템플릿 하나가 있다. */
function opened(): ReadableSpecLayout {
  return {
    id: "atelier",
    folder: "~/.atelier/layouts/atelier",
    edited: true,
    layout: {
      owner: "사람",
      root: {
        description: "방침 문단.",
        children: [
          { pattern: "overview.md", kind: "file", icon: "compass", description: "work의 요약" },
          { pattern: "decisions.md", kind: "file", description: "정한 것", template: "decisions.md" },
        ],
      },
    },
    templates: { "decisions.md": "# 결정\n" },
    warnings: [],
  };
}

/** 사람이 편집기에서 한 칸을 고친 초안. */
function drafted(): LayoutDraft {
  return setDescription(contentOf(opened())!, [0], "work의 요약, 편집기에서 고쳤다");
}

/** 밖에서(에이전트나 손이) 다른 칸을 고친 뒤 다시 읽은 것. */
function changed(): ReadableSpecLayout {
  const outside = setDescription(contentOf(opened())!, [1], "정한 것과 그 이유");
  return { ...opened(), layout: outside.layout, templates: outside.templates };
}

/** 밖에서 `layout.json`을 깨뜨린 뒤 다시 읽은 것 — 엔진이 그 파일에 내는 오류와 원문이다. */
function broken(): UnreadableSpecLayout {
  return {
    id: "atelier",
    folder: "~/.atelier/layouts/atelier",
    edited: true,
    errors: [{ path: [1], message: '`kind` is missing ("file" or "folder")' }],
    raw: '{ "root": { "children": [ { "pattern": "overview.md", "kind": "file" }, { "pattern": "decisions.md" } ] } }\n',
  };
}

/** 폴더가 지워져(손으로, 또는 설정의 되돌리기로) 다시 읽은 것 — 그 모드의 내장본이다. */
function builtin(): ReadableSpecLayout {
  return {
    id: "atelier",
    folder: "~/.atelier/layouts/atelier",
    edited: false,
    layout: {
      root: {
        description: "내장본의 방침 문단.",
        children: [{ pattern: "overview.md", kind: "file", icon: "compass", description: "요약" }],
      },
    },
    templates: {},
    warnings: [],
  };
}

describe("밖 변경 판정 — 표의 여섯 줄", () => {
  it("1. 새로 읽은 것이 기준본과 같으면 무시한다 — 초안이 있어도", () => {
    expect(judgeOutside(opened(), contentOf(opened()), opened())).toBe("ignore");
    expect(judgeOutside(opened(), drafted(), opened())).toBe("ignore");
  });

  it("2. 초안이 기준본과 같고 새로 읽은 것이 깨졌으면 「읽지 못함」 화면으로 바뀐다", () => {
    expect(judgeOutside(opened(), contentOf(opened()), broken())).toBe("unreadable");
  });

  it("3. 초안이 기준본과 같으면 바뀌었든 지워졌든 조용히 새것으로 바꾼다", () => {
    expect(judgeOutside(opened(), contentOf(opened()), changed())).toBe("replace");
    expect(judgeOutside(opened(), contentOf(opened()), builtin())).toBe("replace");
  });

  it("4. 초안이 있고 새로 읽은 것이 깨졌으면 깨짐 배너다", () => {
    expect(judgeOutside(opened(), drafted(), broken())).toBe("broken");
  });

  // 「지워졌다」는 기준본이 폴더의 것이었는데 새로 읽은 것이 내장본인 경우다 — 손으로 지웠거나 되돌렸다.
  it("5. 초안이 있고 폴더의 것이던 기준본이 내장본으로 돌아왔으면 지워짐 배너다", () => {
    expect(judgeOutside(opened(), drafted(), builtin())).toBe("removed");
  });

  it("6. 초안이 있고 바뀌었으면 바뀜 배너다", () => {
    expect(judgeOutside(opened(), drafted(), changed())).toBe("changed");
  });
});

describe("밖 변경 판정 — 내용으로 견준다", () => {
  // 편집기가 저장에 늘 전부 돌려주는 본문이다 — 본문만 고친 에이전트의 변경을 못 보면, 사람이 저장할 때 말없이 덮는다.
  it("템플릿 본문만 바뀌어도 다르다", () => {
    const outside = setTemplateBody(contentOf(opened())!, [1], "# 결정\n\n## 버린 안\n");
    const fresh: SpecLayoutRead = { ...opened(), templates: outside.templates };
    expect(judgeOutside(opened(), contentOf(opened()), fresh)).toBe("replace");
    expect(judgeOutside(opened(), drafted(), fresh)).toBe("changed");
  });

  // 엔진이 다시 쓴 파일은 키의 순서가 다를 수 있다 — 저장되는 것은 같다.
  it("키의 순서만 다르면 같다", () => {
    const [overview, decisions] = opened().layout.root.children!;
    const reordered: SpecLayoutRead = {
      ...opened(),
      layout: {
        root: {
          children: [{ description: overview.description, ...overview }, decisions],
          description: "방침 문단.",
        },
        owner: "사람",
      },
    };
    expect(judgeOutside(opened(), drafted(), reordered)).toBe("ignore");
  });

  // 제 저장이 부른 무효화로 다시 읽은 답 — 저장이 되면 기준본이 저장한 것이 되므로 1번에 걸린다.
  it("기준본과 새로 읽은 것이 모두 저장본이면 무시한다(제 저장)", () => {
    const saved = drafted();
    const reread: SpecLayoutRead = { ...opened(), edited: true, layout: saved.layout, templates: saved.templates };
    expect(judgeOutside(savedBaseline(opened(), saved), saved, reread)).toBe("ignore");
  });

  // 처음 저장은 내장본을 가리는 폴더를 만든다 — 그 뒤의 다시 읽기도 제 저장이다.
  it("내장본을 연 편집기의 처음 저장도 제 저장이다", () => {
    const saved = setDescription(contentOf(builtin())!, [0], "요약, 고쳤다");
    const reread: SpecLayoutRead = { ...builtin(), edited: true, layout: saved.layout, templates: saved.templates };
    expect(judgeOutside(savedBaseline(builtin(), saved), saved, reread)).toBe("ignore");
  });
});

describe("밖 변경 판정 — 깨진 기준본", () => {
  // 깨짐 배너에서 [내 초안 유지]를 고르면 기준본이 그 깨진 것이 된다. 그 초안은 늘 「있다」 — 깨진 것과 같은 초안은 없다.
  it("유지한 초안의 기준본이 깨진 것이면, 같은 깨진 것은 무시하고 고쳐진 것은 바뀜이다", () => {
    expect(judgeOutside(broken(), drafted(), broken())).toBe("ignore");
    expect(judgeOutside(broken(), drafted(), opened())).toBe("changed");
  });

  it("깨진 것끼리도 원문이나 오류가 다르면 다르다", () => {
    const other: UnreadableSpecLayout = { ...broken(), raw: "{", errors: [{ path: null, message: "EOF" }] };
    expect(judgeOutside(broken(), drafted(), other)).toBe("broken");
  });

  // 「읽지 못함」 화면에는 초안이 없다(`null`) — 다시 읽은 것을 늘 그대로 받는다.
  it("「읽지 못함」 화면에서는 고쳐지면 새것으로, 또 깨지면 그 화면으로 바꾼다", () => {
    const other: UnreadableSpecLayout = { ...broken(), raw: "{", errors: [{ path: null, message: "EOF" }] };
    expect(judgeOutside(broken(), null, opened())).toBe("replace");
    expect(judgeOutside(broken(), null, other)).toBe("unreadable");
    expect(judgeOutside(broken(), null, broken())).toBe("ignore");
  });
});
