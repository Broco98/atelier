import { describe, expect, it } from "vitest";
import { setDescription, setIcon, setKind, setPattern, type LayoutDraft } from "./draft";

// 편집기의 초안 조작(spec 레이아웃 티켓 11 · 구현 스펙 5절 「초안 조작은 순수 함수다」). 필드를 바꾸는
// 함수는 초안을 받아 새 초안을 돌려준다 — 이 저장소의 L2에는 DOM이 없어, 상태를 쥔 편집기가 아니라
// 이 함수들을 잰다(설정의 `patchTerminal`과 같은 방식).
//
// **모르는 키가 저장까지 사는 것**이 이 파일의 첫 관심사다. 사람이 `layout.json`에 손으로 적은 키는
// 편집기가 모르는 키이고, 편집기에서 한 칸을 고친 뒤 저장해도 그 키가 남아 있어야 한다. 화면에는 그
// 키가 없으니, 사라져도 다음에 파일을 열어 보기 전까지 아무도 모른다.

/**
 * 손으로 적은 키가 섞인 초안 — 레이아웃 층(`owner`), 맨 위 항목(`note`), 항목 층(`since`), 그리고
 * 폴더 항목의 자식(`color`). 둘째 항목은 템플릿을 가리키고 그 본문이 함께 있다.
 */
function opened(): LayoutDraft {
  return {
    layout: {
      owner: "사람",
      root: {
        description: "방침 문단.",
        note: "손으로 적은 메모",
        children: [
          { pattern: "overview.md", kind: "file", icon: "compass", description: "개요" },
          {
            pattern: "decisions.md",
            kind: "file",
            description: "결정",
            template: "decisions.md",
            since: "0.14",
          },
          {
            pattern: "{n}-{name}",
            kind: "folder",
            icon: "layers",
            children: [{ pattern: "tickets", kind: "folder", color: "red" }],
          },
        ],
      },
    },
    templates: { "decisions.md": "# 결정\n" },
  };
}

describe("필드를 바꾸는 함수", () => {
  it("이름 틀을 바꿔도 레이아웃 층과 항목 층의 모르는 키가 남는다", () => {
    const next = setPattern(opened(), [1], "adr-{n}-{name}.md");
    expect(next.layout).toEqual({
      owner: "사람",
      root: {
        description: "방침 문단.",
        note: "손으로 적은 메모",
        children: [
          { pattern: "overview.md", kind: "file", icon: "compass", description: "개요" },
          {
            pattern: "adr-{n}-{name}.md",
            kind: "file",
            description: "결정",
            template: "decisions.md",
            since: "0.14",
          },
          {
            pattern: "{n}-{name}",
            kind: "folder",
            icon: "layers",
            children: [{ pattern: "tickets", kind: "folder", color: "red" }],
          },
        ],
      },
    });
    expect(next.templates).toEqual({ "decisions.md": "# 결정\n" });
  });

  // 깊은 자리를 고칠 때 **지나는 층**(폴더 항목)의 키도 산다 — 경로를 따라 펼치다 한 층을 새로 지으면
  // 그 층의 모르는 키만 조용히 빠진다.
  it("깊은 자리의 설명을 바꿔도 지나는 폴더 항목과 그 자신의 모르는 키가 남는다", () => {
    const next = setDescription(opened(), [2, 0], "그 판의 티켓들");
    expect(next.layout.root.children?.[2]).toEqual({
      pattern: "{n}-{name}",
      kind: "folder",
      icon: "layers",
      children: [
        { pattern: "tickets", kind: "folder", color: "red", description: "그 판의 티켓들" },
      ],
    });
    expect(next.layout.owner).toBe("사람");
    expect(next.layout.root.note).toBe("손으로 적은 메모");
  });

  // 맨 위 항목의 설명이 안내문 맨 위의 방침 문단이다 — 편집기에서는 트리 열의 머리 `spec/`이 연다.
  it("맨 위 항목의 설명(방침 문단)은 빈 경로로 고친다", () => {
    const next = setDescription(opened(), [], "새 방침.");
    expect(next.layout.root.description).toBe("새 방침.");
    expect(next.layout.root.note).toBe("손으로 적은 메모");
    expect(next.layout.root.children).toEqual(opened().layout.root.children);
  });

  // 디스크 형식은 빈 설명을 적지 않는다(엔진의 `serialize_layout`) — 비운 칸은 「설명 없음」이다.
  it("설명을 비우면 그 키가 빠진다", () => {
    const next = setDescription(opened(), [0], "");
    expect(next.layout.root.children?.[0]).toEqual({
      pattern: "overview.md",
      kind: "file",
      icon: "compass",
    });
  });

  it("아이콘을 고르면 그 이름이 서고, 「아이콘 없음」이면 키가 빠진다", () => {
    const picked = setIcon(opened(), [1], "scale");
    expect(picked.layout.root.children?.[1]).toEqual({
      pattern: "decisions.md",
      kind: "file",
      description: "결정",
      template: "decisions.md",
      since: "0.14",
      icon: "scale",
    });
    const none = setIcon(opened(), [0], null);
    expect(none.layout.root.children?.[0]).toEqual({
      pattern: "overview.md",
      kind: "file",
      description: "개요",
    });
    expect(none.layout.owner).toBe("사람");
  });

  it("받은 초안을 고치지 않는다", () => {
    const draft = opened();
    setPattern(draft, [1], "x.md");
    setDescription(draft, [2, 0], "x");
    setIcon(draft, [0], null);
    setKind(draft, [1], "folder");
    expect(draft).toEqual(opened());
  });
});

// 종류를 바꾸는 규칙(구현 스펙 5절). 폴더에는 템플릿이 없다 — 떼지 않으면 저장이 「폴더 항목의
// `template`」로 거절되고, 아무도 가리키지 않는 본문은 「어느 파일 항목도 가리키지 않는 본문」으로
// 거절된다(엔진 저장소의 검증). 파일로 돌릴 때 자식을 지우지 않는 것은 사람의 손을 대신 치우지 않기
// 위해서다 — 저장이 「파일 항목의 `children`」 오류를 세우고, 옮기기로 푼다.
describe("종류", () => {
  it("폴더로 바꾸면 그 항목의 template과 본문 맵의 본문이 빠지고, 모르는 키는 남는다", () => {
    const next = setKind(opened(), [1], "folder");
    expect(next.layout.root.children?.[1]).toEqual({
      pattern: "decisions.md",
      kind: "folder",
      description: "결정",
      since: "0.14",
    });
    expect(next.templates).toEqual({});
    expect(next.layout.owner).toBe("사람");
  });

  // 두 항목이 같은 템플릿 파일을 가리킬 수 있다(손으로 적은 레이아웃). 한쪽이 폴더가 돼도 다른 쪽은
  // 여전히 그 본문을 가리킨다 — 떼면 저장에 본문이 없어, 디스크에 아직 없는 템플릿이면 거절된다.
  it("다른 파일 항목이 같은 템플릿을 가리키면 본문은 남는다", () => {
    const draft = opened();
    const shared: LayoutDraft = {
      ...draft,
      layout: {
        ...draft.layout,
        root: {
          ...draft.layout.root,
          children: [
            ...draft.layout.root.children!,
            { pattern: "adr.md", kind: "file", template: "decisions.md" },
          ],
        },
      },
    };
    const next = setKind(shared, [1], "folder");
    expect(next.layout.root.children?.[1].template).toBeUndefined();
    expect(next.templates).toEqual({ "decisions.md": "# 결정\n" });
  });

  it("파일로 바꾸면 자식이 그대로 남는다", () => {
    const next = setKind(opened(), [2], "file");
    expect(next.layout.root.children?.[2]).toEqual({
      pattern: "{n}-{name}",
      kind: "file",
      icon: "layers",
      children: [{ pattern: "tickets", kind: "folder", color: "red" }],
    });
    expect(next.templates).toEqual({ "decisions.md": "# 결정\n" });
  });
});
