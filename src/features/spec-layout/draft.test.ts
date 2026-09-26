import { describe, expect, it } from "vitest";
import {
  addEntry,
  dropEntry,
  dropPlaceAt,
  editsAt,
  moveEntry,
  removeEntry,
  setDescription,
  setIcon,
  setKind,
  setPattern,
  setTemplate,
  setTemplateBody,
  within,
  type EntryMove,
  type EntryPath,
  type LayoutDraft,
} from "./draft";

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
    setTemplate(draft, [0], true);
    setTemplate(draft, [1], false);
    setTemplateBody(draft, [1], "x");
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

// 파일 항목의 템플릿(티켓 12 · 구현 스펙 5절 「템플릿 파일은 `layout.json`과 같은 폴더에 둔다」). 켜면 항목이
// 템플릿 경로를 가리키고 본문 맵에 그 본문이 선다 — 저장은 늘 본문 맵 전부를 넘기므로, 둘이 함께 움직여야
// 저장이 「본문도 파일도 없는 템플릿」이나 「아무도 가리키지 않는 본문」으로 거절되지 않는다.
describe("템플릿", () => {
  it("켜면 항목에 이름 틀로 지은 template 경로가 서고 본문 맵에 빈 본문이 생기며, 모르는 키는 남는다", () => {
    const next = setTemplate(opened(), [0], true);
    expect(next.layout.root.children?.[0]).toEqual({
      pattern: "overview.md",
      kind: "file",
      icon: "compass",
      description: "개요",
      template: "overview.md",
    });
    expect(next.templates).toEqual({ "decisions.md": "# 결정\n", "overview.md": "" });
    expect(next.layout.owner).toBe("사람");
    expect(next.layout.root.note).toBe("손으로 적은 메모");
  });

  // 이미 쓰인 경로는 다른 항목들이 가리키는 템플릿이다 — 대소문자만 달라도 같은 파일이라 번호를 붙인다.
  it("다른 항목이 가리키는 경로와 겹치면 번호를 붙인다", () => {
    const renamed = setPattern(opened(), [0], "Decisions.md");
    const next = setTemplate(renamed, [0], true);
    expect(next.layout.root.children?.[0].template).toBe("Decisions-2.md");
    expect(next.templates).toEqual({ "decisions.md": "# 결정\n", "Decisions-2.md": "" });
  });

  // 누락 템플릿(레이아웃은 가리키는데 본문 맵에 없다)의 경로도 쓰인 경로다 — 본문 맵만 보면 두 항목이 한
  // 파일을 나눠 쓰다 한쪽에 적은 본문이 다른 쪽의 본문이 된다.
  it("누락 템플릿의 경로와 겹쳐도 번호를 붙인다", () => {
    const missing: LayoutDraft = { ...opened(), templates: {} };
    const next = setTemplate(setPattern(missing, [0], "decisions.md"), [0], true);
    expect(next.layout.root.children?.[0].template).toBe("decisions-2.md");
    expect(next.layout.root.children?.[1].template).toBe("decisions.md");
    expect(next.templates).toEqual({ "decisions-2.md": "" });
  });

  // 「없음」으로 바꾸고 저장하면 그 템플릿 파일은 지워진다 — 저장이 빠진 템플릿을 지운다(티켓 07).
  it("끄면 항목의 template과 본문 맵의 본문이 둘 다 빠지고, 모르는 키는 남는다", () => {
    const next = setTemplate(opened(), [1], false);
    expect(next.layout.root.children?.[1]).toEqual({
      pattern: "decisions.md",
      kind: "file",
      description: "결정",
      since: "0.14",
    });
    expect(next.templates).toEqual({});
    expect(next.layout.owner).toBe("사람");
  });

  // 손으로 적은 레이아웃은 두 항목이 한 템플릿을 가리킬 수 있다 — 한쪽을 꺼도 다른 쪽이 그 본문의 주인이다.
  it("다른 파일 항목이 같은 템플릿을 가리키면 끄더라도 본문은 남는다", () => {
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
    const next = setTemplate(shared, [1], false);
    expect(next.layout.root.children?.[1].template).toBeUndefined();
    expect(next.templates["decisions.md"]).toBe("# 결정\n");
  });

  // 손으로 고친 `layout.json`이 폴더 안의 다른 경로를 가리키면 그 경로를 그대로 존중한다 — 이름을 짓는 것은
  // 경로가 없을 때뿐이다. 본문도 그대로다.
  it("이미 경로가 있는 항목을 켜면 그 경로와 본문을 그대로 쓴다", () => {
    const read = opened();
    const draft: LayoutDraft = {
      layout: {
        ...read.layout,
        root: {
          ...read.layout.root,
          children: read.layout.root.children!.map((entry, i) =>
            i === 1 ? { ...entry, template: "templates/adr.md" } : entry,
          ),
        },
      },
      templates: { "templates/adr.md": "# ADR\n" },
    };
    const next = setTemplate(draft, [1], true);
    expect(next.layout.root.children?.[1].template).toBe("templates/adr.md");
    expect(next.templates).toEqual({ "templates/adr.md": "# ADR\n" });
    expect(setTemplate(opened(), [1], true)).toEqual(opened());
  });

  // 경로는 **켤 때 한 번** 정한다 — 이름 틀을 고칠 때마다 경로가 따라가면 디스크의 템플릿이 저장마다 이름을
  // 바꾼다. 끄고 다시 켜면 그때의 이름 틀로 다시 정한다.
  it("이름 틀을 바꿔도 켜진 경로는 그대로이고, 끄고 다시 켜면 지금 이름 틀로 다시 정한다", () => {
    const on = setTemplate(opened(), [0], true);
    const renamed = setPattern(on, [0], "summary.md");
    expect(renamed.layout.root.children?.[0].template).toBe("overview.md");
    expect(renamed.templates).toEqual({ "decisions.md": "# 결정\n", "overview.md": "" });

    const again = setTemplate(setTemplate(renamed, [0], false), [0], true);
    expect(again.layout.root.children?.[0].template).toBe("summary.md");
    expect(again.templates).toEqual({ "decisions.md": "# 결정\n", "summary.md": "" });
  });

  it("본문을 적으면 그 항목이 가리키는 경로의 본문이 바뀌고, 레이아웃은 그대로다", () => {
    const next = setTemplateBody(opened(), [1], "# 결정\n\n## 1.\n");
    expect(next.templates).toEqual({ "decisions.md": "# 결정\n\n## 1.\n" });
    expect(next.layout).toEqual(opened().layout);
  });

  // 템플릿 파일이 디스크에서 사라진 항목 — 레이아웃은 가리키는데 본문 맵에 그 경로가 없다. 본문 칸에 적으면
  // 맵에 들어가 누락이 풀리고, 저장이 그 파일을 다시 만든다.
  it("본문 맵에 없는 템플릿(누락)에 적으면 그 경로로 맵에 들어간다", () => {
    const missing: LayoutDraft = { ...opened(), templates: {} };
    const next = setTemplateBody(missing, [1], "# 다시 쓴 결정\n");
    expect(next.templates).toEqual({ "decisions.md": "# 다시 쓴 결정\n" });
  });

  it("누락 템플릿을 끄면 항목이 더는 가리키지 않는다", () => {
    const missing: LayoutDraft = { ...opened(), templates: {} };
    const next = setTemplate(missing, [1], false);
    expect(next.layout.root.children?.[1].template).toBeUndefined();
    expect(next.templates).toEqual({});
  });

  it("템플릿이 없는 항목에는 본문을 적지 않는다", () => {
    expect(setTemplateBody(opened(), [0], "x")).toEqual(opened());
  });
});

// 트리를 고치는 함수들(spec 레이아웃 티켓 13 · 구현 스펙 5절). 필드를 바꾸는 함수와 같이 초안을 받아 새 초안을
// 돌려주고, 그 뒤에 고를 자리를 함께 준다 — 자리가 인덱스 경로라, 항목이 옮겨 가면 고른 자리도 따라가야 한다.
describe("더하기", () => {
  it("폴더를 골랐으면 그 안의 마지막 자식으로 더하고 그것을 고르며, 지나는 층의 모르는 키가 남는다", () => {
    const next = addEntry(opened(), [2], "file");
    expect(next.select).toEqual([2, 1]);
    expect(next.draft.layout.root.children?.[2]).toEqual({
      pattern: "{n}-{name}",
      kind: "folder",
      icon: "layers",
      children: [
        { pattern: "tickets", kind: "folder", color: "red" },
        { pattern: "untitled.md", kind: "file" },
      ],
    });
    expect(next.draft.layout.owner).toBe("사람");
    expect(next.draft.layout.root.note).toBe("손으로 적은 메모");
    expect(next.draft.templates).toEqual({ "decisions.md": "# 결정\n" });
  });

  it("파일을 골랐으면 그 뒤의 형제로 더한다", () => {
    const next = addEntry(opened(), [0], "folder");
    expect(next.select).toEqual([1]);
    expect(next.draft.layout.root.children?.map((entry) => entry.pattern)).toEqual([
      "overview.md",
      "untitled",
      "decisions.md",
      "{n}-{name}",
    ]);
    expect(next.draft.layout.root.children?.[1]).toEqual({ pattern: "untitled", kind: "folder" });
  });

  // 머리 `spec/`은 항목이 아니다(결정 26) — 골랐으면 최상위의 맨 뒤에 더한다.
  it("머리 `spec/`을 골랐으면 최상위의 맨 뒤에 더한다", () => {
    const next = addEntry(opened(), [], "file");
    expect(next.select).toEqual([3]);
    expect(next.draft.layout.root.children?.[3]).toEqual({ pattern: "untitled.md", kind: "file" });
    expect(next.draft.layout.root.children?.slice(0, 3)).toEqual(opened().layout.root.children);
  });

  it("자식이 없던 폴더에 더하면 그 폴더에 자식이 선다", () => {
    const next = addEntry(opened(), [2, 0], "folder");
    expect(next.select).toEqual([2, 0, 0]);
    expect(next.draft.layout.root.children?.[2].children?.[0]).toEqual({
      pattern: "tickets",
      kind: "folder",
      color: "red",
      children: [{ pattern: "untitled", kind: "folder" }],
    });
  });

  // 형제 사이에 같은 이름 틀이 둘이면 저장이 거절한다(엔진의 검증) — 더하자마자 저장이 막히지 않게 번호를 붙인다.
  // 겹침은 **형제끼리만** 본다: 다른 폴더 안의 `untitled.md`는 겹치지 않는다.
  it("형제와 이름이 겹치면 `untitled-2`처럼 번호를 붙이고, 다른 폴더의 이름과는 겹치지 않는다", () => {
    const once = addEntry(opened(), [], "file").draft;
    const twice = addEntry(once, [], "file").draft;
    const thrice = addEntry(twice, [3], "file");
    expect(thrice.draft.layout.root.children?.slice(3).map((entry) => entry.pattern)).toEqual([
      "untitled.md",
      "untitled-3.md",
      "untitled-2.md",
    ]);
    expect(thrice.select).toEqual([4]);

    const folders = addEntry(addEntry(opened(), [], "folder").draft, [], "folder").draft;
    expect(folders.layout.root.children?.slice(3).map((entry) => entry.pattern)).toEqual([
      "untitled",
      "untitled-2",
    ]);

    const inside = addEntry(once, [2], "file").draft;
    expect(inside.layout.root.children?.[2].children?.[1].pattern).toBe("untitled.md");
  });

  it("받은 초안을 고치지 않는다", () => {
    const draft = opened();
    addEntry(draft, [2], "file");
    addEntry(draft, [0], "folder");
    addEntry(draft, [], "file");
    expect(draft).toEqual(opened());
  });
});

describe("지우기", () => {
  it("자기 아래가 함께 사라지고, 모르는 키는 남는다", () => {
    const next = removeEntry(opened(), [2]);
    expect(next?.draft.layout).toEqual({
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
        ],
      },
    });
    expect(next?.draft.templates).toEqual({ "decisions.md": "# 결정\n" });
  });

  // 디스크 형식은 빈 자식 목록을 적지 않는다 — 마지막 자식을 지운 폴더는 읽은 모양과 같아진다.
  it("폴더의 마지막 자식을 지우면 그 폴더에 자식 목록이 남지 않는다", () => {
    const next = removeEntry(opened(), [2, 0]);
    expect(next?.draft.layout.root.children?.[2]).toEqual({
      pattern: "{n}-{name}",
      kind: "folder",
      icon: "layers",
    });
  });

  // 트리에서 바로 위에 보이던 행을 고른다 — 앞 형제가 폴더면 그 안의 맨 아래 행, 첫 자식이면 부모, 첫 최상위
  // 항목이면 머리 `spec/`이다.
  it("지우면 트리에서 그 바로 위의 행을 고른다", () => {
    expect(removeEntry(opened(), [1])?.select).toEqual([0]);
    const withLast = addEntry(opened(), [], "file").draft;
    expect(removeEntry(withLast, [3])?.select).toEqual([2, 0]);
    expect(removeEntry(opened(), [2, 0])?.select).toEqual([2]);
    expect(removeEntry(opened(), [0])?.select).toEqual([]);
  });

  // 맨 위 항목은 spec 폴더 자신이다 — 트리의 행이 아니고(결정 26) 지울 것이 아니다.
  it("빈 위치(맨 위 항목)는 지울 수 없다", () => {
    expect(removeEntry(opened(), [])).toBeNull();
  });

  // 아무도 가리키지 않는 본문은 저장이 거절한다 — 지운 항목들이 가리키던 템플릿 본문을 함께 뗀다.
  it("지운 항목들이 가리키던 템플릿 본문이 함께 빠진다", () => {
    expect(removeEntry(opened(), [1])?.draft.templates).toEqual({});

    const nested = setTemplate(addEntry(opened(), [2], "file").draft, [2, 1], true);
    expect(nested.templates).toEqual({ "decisions.md": "# 결정\n", "untitled.md": "" });
    expect(removeEntry(nested, [2])?.draft.templates).toEqual({ "decisions.md": "# 결정\n" });
  });

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
    expect(removeEntry(shared, [1])?.draft.templates).toEqual({ "decisions.md": "# 결정\n" });
  });

  it("받은 초안을 고치지 않는다", () => {
    const draft = opened();
    removeEntry(draft, [2]);
    removeEntry(draft, [1]);
    expect(draft).toEqual(opened());
  });
});

// 키보드 길(버튼 넷과 ⌥↑ ⌥↓ ⌥← ⌥→). 옮기는 주된 길은 끌어다 놓기이고, 이것은 그 길을 키보드로도 남긴 것이다.
describe("키로 옮기기", () => {
  /** 최상위 이름 틀들, 그리고 폴더 `{n}-{name}`의 자식 이름 틀들. */
  const top = (draft: LayoutDraft) => draft.layout.root.children?.map((entry) => entry.pattern);

  it("위로·아래로는 형제와 자리를 바꾸고, 자기 아래를 데리고 가며, 옮긴 항목을 계속 고른다", () => {
    const up = moveEntry(opened(), [2], "up");
    expect(top(up!.draft)).toEqual(["overview.md", "{n}-{name}", "decisions.md"]);
    expect(up!.draft.layout.root.children?.[1]).toEqual(opened().layout.root.children?.[2]);
    expect(up!.select).toEqual([1]);

    const down = moveEntry(opened(), [0], "down");
    expect(top(down!.draft)).toEqual(["decisions.md", "overview.md", "{n}-{name}"]);
    expect(down!.select).toEqual([1]);
    expect(down!.draft.layout.owner).toBe("사람");
    expect(down!.draft.layout.root.note).toBe("손으로 적은 메모");
  });

  it("맨 앞은 위로, 맨 뒤는 아래로 옮길 수 없다", () => {
    expect(moveEntry(opened(), [0], "up")).toBeNull();
    expect(moveEntry(opened(), [2], "down")).toBeNull();
    expect(moveEntry(opened(), [2, 0], "up")).toBeNull();
    expect(moveEntry(opened(), [2, 0], "down")).toBeNull();
  });

  it("들여쓰기는 바로 앞의 형제가 폴더일 때만 되고, 그 폴더의 마지막 자식이 된다", () => {
    const withLast = addEntry(opened(), [], "file").draft;
    const indented = moveEntry(withLast, [3], "indent");
    expect(top(indented!.draft)).toEqual(["overview.md", "decisions.md", "{n}-{name}"]);
    expect(indented!.draft.layout.root.children?.[2].children).toEqual([
      { pattern: "tickets", kind: "folder", color: "red" },
      { pattern: "untitled.md", kind: "file" },
    ]);
    expect(indented!.select).toEqual([2, 1]);

    // 앞 형제가 파일이거나, 앞 형제가 없다
    expect(moveEntry(opened(), [1], "indent")).toBeNull();
    expect(moveEntry(opened(), [0], "indent")).toBeNull();
    expect(moveEntry(opened(), [2, 0], "indent")).toBeNull();
  });

  it("들여쓰면 자기 아래를 데리고 간다", () => {
    const folder = addEntry(opened(), [], "folder").draft; // [3] untitled/
    const withChild = addEntry(folder, [3], "file").draft; // [3, 0] untitled.md
    const next = moveEntry(withChild, [3], "indent");
    expect(next!.draft.layout.root.children?.[2].children?.[1]).toEqual({
      pattern: "untitled",
      kind: "folder",
      children: [{ pattern: "untitled.md", kind: "file" }],
    });
    expect(next!.select).toEqual([2, 1]);
  });

  it("내어쓰기는 부모의 바로 뒤 형제가 되고, 뒤의 형제들은 부모 안에 남는다", () => {
    const next = moveEntry(opened(), [2, 0], "outdent");
    expect(top(next!.draft)).toEqual(["overview.md", "decisions.md", "{n}-{name}", "tickets"]);
    // 자식이 비면 자식 목록이 남지 않는다
    expect(next!.draft.layout.root.children?.[2]).toEqual({
      pattern: "{n}-{name}",
      kind: "folder",
      icon: "layers",
    });
    expect(next!.draft.layout.root.children?.[3]).toEqual({ pattern: "tickets", kind: "folder", color: "red" });
    expect(next!.select).toEqual([3]);

    const three = addEntry(addEntry(opened(), [2], "file").draft, [2], "file").draft;
    expect(three.layout.root.children?.[2].children?.map((entry) => entry.pattern)).toEqual([
      "tickets",
      "untitled.md",
      "untitled-2.md",
    ]);
    const middle = moveEntry(three, [2, 1], "outdent");
    expect(middle!.draft.layout.root.children?.[2].children?.map((entry) => entry.pattern)).toEqual([
      "tickets",
      "untitled-2.md",
    ]);
    expect(top(middle!.draft)).toEqual(["overview.md", "decisions.md", "{n}-{name}", "untitled.md"]);
    expect(middle!.select).toEqual([3]);
  });

  it("최상위 항목은 내어쓸 수 없다", () => {
    expect(moveEntry(opened(), [0], "outdent")).toBeNull();
    expect(moveEntry(opened(), [2], "outdent")).toBeNull();
  });

  it("받은 초안을 고치지 않는다", () => {
    const draft = opened();
    moveEntry(draft, [2], "up");
    moveEntry(draft, [0], "down");
    moveEntry(draft, [2, 0], "outdent");
    expect(draft).toEqual(opened());
  });
});

// 버튼의 잠금은 판정 함수 하나가 준다 — 그 답이 조작이 실제로 되는지와 같아야, 누를 수 있는 버튼이 아무것도
// 안 하거나 잠긴 버튼 뒤의 단축키가 트리를 바꾸는 일이 없다.
describe("잠금 판정", () => {
  const MOVES: EntryMove[] = ["up", "down", "outdent", "indent"];

  // 머리 `spec/`은 항목이 아니다 — 지울 것도 옮길 것도 없다(결정 26).
  it("머리 `spec/`을 골랐으면 지우기와 옮기기 넷이 모두 잠긴다", () => {
    expect(editsAt(opened(), [])).toEqual({
      up: false,
      down: false,
      outdent: false,
      indent: false,
      remove: false,
    });
  });

  it("고른 항목마다 할 수 있는 것을 준다", () => {
    const withLast = addEntry(opened(), [], "file").draft;
    expect(editsAt(withLast, [3])).toEqual({ up: true, down: false, outdent: false, indent: true, remove: true });
    expect(editsAt(withLast, [2, 0])).toEqual({ up: false, down: false, outdent: true, indent: false, remove: true });
    expect(editsAt(withLast, [0])).toEqual({ up: false, down: true, outdent: false, indent: false, remove: true });
  });

  it("판정이 조작의 답과 같다 — 모든 자리, 모든 조작에서", () => {
    const withLast = addEntry(opened(), [2, 0], "file").draft;
    const paths: EntryPath[] = [[], [0], [1], [2], [2, 0], [2, 0, 0]];
    for (const path of paths) {
      const edits = editsAt(withLast, path);
      for (const move of MOVES) {
        expect([path, move, edits[move]]).toEqual([path, move, moveEntry(withLast, path, move) !== null]);
      }
      expect([path, edits.remove]).toEqual([path, removeEntry(withLast, path) !== null]);
    }
  });
});

// 끌어다 놓기 — 옮기는 주된 길이다(구현 스펙 5절). 행의 어디에 놓았는지(앞·뒤·안)를 가르는 것과, 끌어온 항목과
// 대상과 그 자리로 새 초안을 짓는 것 둘 다 순수 함수다. 포인터와 사각형은 편집기가 재어 비율 하나로 넘긴다.
describe("놓기 계산", () => {
  const top = (draft: LayoutDraft) => draft.layout.root.children?.map((entry) => entry.pattern);
  const [overview, decisions, iteration] = opened().layout.root.children!;
  const tickets = iteration.children![0];

  // 행의 위쪽은 앞, 아래쪽은 뒤, 폴더 가운데는 안이다. **자식이 있는 폴더의 아래쪽은 안이다** — 그 행 바로
  // 아래에는 첫 자식이 서 있어, 거기를 「폴더 뒤」로 치면 선과 실제 자리가 갈린다.
  it.each([
    { name: "파일의 위쪽은 앞", entry: overview, ratio: 0.25, want: "before" },
    { name: "파일의 아래쪽은 뒤", entry: overview, ratio: 0.75, want: "after" },
    { name: "폴더의 위쪽은 앞", entry: tickets, ratio: 0.25, want: "before" },
    { name: "폴더의 가운데는 안", entry: tickets, ratio: 0.5, want: "inside" },
    { name: "자식 없는 폴더의 아래쪽은 뒤", entry: tickets, ratio: 0.75, want: "after" },
    { name: "자식 있는 폴더의 가운데는 안", entry: iteration, ratio: 0.5, want: "inside" },
    { name: "자식 있는 폴더의 아래쪽도 안", entry: iteration, ratio: 0.75, want: "inside" },
    { name: "자식 있는 폴더의 위쪽은 앞", entry: iteration, ratio: 0.25, want: "before" },
  ] as const)("$name", ({ entry, ratio, want }) => {
    expect(dropPlaceAt(entry, ratio)).toBe(want);
  });

  it("행의 위쪽에 놓으면 그 앞에 서고, 옮긴 항목을 고르며, 모르는 키가 남는다", () => {
    const next = dropEntry(opened(), [2], { path: [0], place: "before" });
    expect(next?.draft.layout).toEqual({
      owner: "사람",
      root: {
        description: "방침 문단.",
        note: "손으로 적은 메모",
        children: [iteration, overview, decisions],
      },
    });
    expect(next?.draft.templates).toEqual({ "decisions.md": "# 결정\n" });
    expect(next?.select).toEqual([0]);
  });

  it("행의 아래쪽에 놓으면 그 뒤에 선다 — 다른 폴더 안의 행이어도", () => {
    const after = dropEntry(opened(), [0], { path: [1], place: "after" });
    expect(top(after!.draft)).toEqual(["decisions.md", "overview.md", "{n}-{name}"]);
    expect(after!.select).toEqual([1]);

    const deep = dropEntry(opened(), [0], { path: [2, 0], place: "after" });
    expect(top(deep!.draft)).toEqual(["decisions.md", "{n}-{name}"]);
    expect(deep!.draft.layout.root.children?.[1].children).toEqual([tickets, overview]);
    expect(deep!.select).toEqual([1, 1]);
  });

  it("폴더 가운데에 놓으면 그 안의 마지막 자식이 된다 — 자식이 없던 폴더에도", () => {
    const inside = dropEntry(opened(), [0], { path: [2], place: "inside" });
    expect(top(inside!.draft)).toEqual(["decisions.md", "{n}-{name}"]);
    expect(inside!.draft.layout.root.children?.[1]).toEqual({ ...iteration, children: [tickets, overview] });
    expect(inside!.select).toEqual([1, 1]);

    const empty = dropEntry(opened(), [1], { path: [2, 0], place: "inside" });
    expect(empty!.draft.layout.root.children?.[1].children?.[0]).toEqual({ ...tickets, children: [decisions] });
    expect(empty!.draft.templates).toEqual({ "decisions.md": "# 결정\n" });
    expect(empty!.select).toEqual([1, 0, 0]);
  });

  // 자식 있는 폴더의 아래쪽(안)에 놓은 것이 그 폴더의 마지막 자식이 된다 — 두 함수를 잇는다.
  it("자식 있는 폴더의 아래쪽에 놓으면 그 안의 마지막 자식이 된다", () => {
    const next = dropEntry(opened(), [1], { path: [2], place: dropPlaceAt(iteration, 0.75) });
    expect(next!.draft.layout.root.children?.[1]).toEqual({ ...iteration, children: [tickets, decisions] });
    expect(next!.select).toEqual([1, 1]);
  });

  it("트리 아래 빈 자리에 놓으면 최상위의 맨 뒤에 선다", () => {
    const next = dropEntry(opened(), [2, 0], { place: "end" });
    expect(top(next!.draft)).toEqual(["overview.md", "decisions.md", "{n}-{name}", "tickets"]);
    expect(next!.draft.layout.root.children?.[2]).toEqual({ pattern: "{n}-{name}", kind: "folder", icon: "layers" });
    expect(next!.select).toEqual([3]);

    const first = dropEntry(opened(), [0], { place: "end" });
    expect(top(first!.draft)).toEqual(["decisions.md", "{n}-{name}", "overview.md"]);
    expect(first!.select).toEqual([2]);
  });

  // 제 안으로 들어가면 항목이 트리에서 떨어져 나간다 — 받지 않는다.
  it.each([
    { name: "자기 앞", target: { path: [2], place: "before" } },
    { name: "자기 뒤", target: { path: [2], place: "after" } },
    { name: "자기 안", target: { path: [2], place: "inside" } },
    { name: "자기 아래의 안", target: { path: [2, 0], place: "inside" } },
    { name: "자기 아래의 앞", target: { path: [2, 0], place: "before" } },
    { name: "자기 아래의 뒤", target: { path: [2, 0], place: "after" } },
  ] as const)("자기 자신과 자기 아래로는 놓을 수 없다 — $name", ({ target }) => {
    expect(dropEntry(opened(), [2], target)).toBeNull();
  });

  // 머리 `spec/`은 항목이 아니다 — 끌 것도, 놓을 대상도 아니다(결정 26). 파일 안에는 놓지 않는다.
  it("머리 `spec/`은 끌 것도 대상도 아니고, 파일 안에는 놓을 수 없다", () => {
    expect(dropEntry(opened(), [], { place: "end" })).toBeNull();
    expect(dropEntry(opened(), [0], { path: [], place: "inside" })).toBeNull();
    expect(dropEntry(opened(), [0], { path: [1], place: "inside" })).toBeNull();
  });

  // 끌린 항목의 「자기 자신과 자기 아래」 — 놓기가 거절하는 자리이고, 트리가 끄는 동안 흐리는 행이다.
  it("자기 자신과 자기 아래만 끌린 항목 안이다", () => {
    expect(within([2], [2])).toBe(true);
    expect(within([2, 0], [2])).toBe(true);
    expect(within([2, 0, 1], [2])).toBe(true);
    expect(within([1], [2])).toBe(false);
    expect(within([3, 0], [2])).toBe(false);
    expect(within([2], [2, 0])).toBe(false);
  });

  it("받은 초안을 고치지 않는다", () => {
    const draft = opened();
    dropEntry(draft, [0], { path: [2], place: "inside" });
    dropEntry(draft, [2, 0], { place: "end" });
    expect(draft).toEqual(opened());
  });
});

// **모르는 키가 저장까지 산다**(이 파일의 첫 관심사) — 트리를 고치는 조작 모두에서. 항목을 옮기는 함수가 항목을
// 새로 지으면 그 항목의 손으로 적은 키가, 층을 새로 지으면 그 층의 키가 조용히 빠진다.
describe("트리를 고쳐도 모르는 키가 산다", () => {
  /** 이름 틀로 찾은 항목 — 어디로 옮겨 갔든. */
  function find(entries: LayoutDraft["layout"]["root"]["children"], pattern: string): Record<string, unknown> | null {
    for (const entry of entries ?? []) {
      if (entry.pattern === pattern) return entry;
      const deeper = find(entry.children, pattern);
      if (deeper !== null) return deeper;
    }
    return null;
  }

  const withLast = () => addEntry(opened(), [], "file").draft;
  it.each([
    { name: "더하기", edit: () => addEntry(opened(), [2, 0], "file") },
    { name: "지우기", edit: () => removeEntry(opened(), [0]) },
    { name: "위로", edit: () => moveEntry(opened(), [2], "up") },
    { name: "아래로", edit: () => moveEntry(opened(), [1], "down") },
    { name: "들여쓰기", edit: () => moveEntry(withLast(), [3], "indent") },
    { name: "내어쓰기", edit: () => moveEntry(opened(), [2, 0], "outdent") },
    { name: "앞에 놓기", edit: () => dropEntry(opened(), [2, 0], { path: [1], place: "before" }) },
    { name: "뒤에 놓기", edit: () => dropEntry(opened(), [1], { path: [2, 0], place: "after" }) },
    { name: "안에 놓기", edit: () => dropEntry(opened(), [1], { path: [2, 0], place: "inside" }) },
    { name: "빈 자리에 놓기", edit: () => dropEntry(opened(), [2, 0], { place: "end" }) },
  ])("$name", ({ edit }) => {
    const { layout } = edit()!.draft;
    expect({
      owner: layout.owner,
      note: layout.root.note,
      since: find(layout.root.children, "decisions.md")?.since,
      color: find(layout.root.children, "tickets")?.color,
    }).toEqual({ owner: "사람", note: "손으로 적은 메모", since: "0.14", color: "red" });
  });
});
