import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorColumns, UnreadableLayout } from "./SpecLayoutEditor";
import type { EntryPath, LayoutDraft } from "./draft";
import type { LayoutError, UnreadableSpecLayout } from "./types";

// 「spec 레이아웃」 편집기의 두 열(spec 레이아웃 티켓 11 · 결정 26). 왼쪽은 항목 트리, 오른쪽은 고른 항목이다.
// 편집기는 초안을 **그리기만** 한다 — 필드를 바꾸는 규칙은 `draft.ts`의 순수 함수가, 이름 틀이 맞는지는
// 저장의 검증(엔진)이 든다. 그래서 여기서는 초안과 고른 자리와 오류를 손으로 넣고 마크업만 잰다. 클릭은
// L3가 잰다(jsdom이 없다).

/** 파일 항목·폴더 항목·깊은 자리·손으로 적은 모르는 아이콘이 섞인 초안. */
function opened(): LayoutDraft {
  return {
    layout: {
      owner: "사람",
      root: {
        description: "방침 문단.",
        children: [
          { pattern: "overview.md", kind: "file", icon: "compass", description: "개요" },
          { pattern: "decisions.md", kind: "file", description: "결정", template: "decisions.md" },
          {
            pattern: "{n}-{name}",
            kind: "folder",
            icon: "layers",
            description: "한 판",
            children: [{ pattern: "tickets", kind: "folder" }],
          },
          { pattern: "notes.md", kind: "file", icon: "sparkles" },
        ],
      },
    },
    templates: { "decisions.md": "# 결정\n" },
  };
}

function render(selected: EntryPath, errors: LayoutError[] = [], draft = opened()): string {
  return renderToStaticMarkup(
    <EditorColumns
      draft={draft}
      folder="~/.atelier/layouts/atelier"
      selected={selected}
      errors={errors}
      onSelect={() => {}}
      onChange={() => {}}
      onEdit={() => {}}
    />,
  );
}

/** 보이는 글자만 — 태그와 속성을 걷는다. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** 트리의 행마다 { 보이는 이름, 깊이, 골랐나 }. */
function treeRows(html: string) {
  return [...html.matchAll(/<button\b([^>]*role="treeitem"[^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    name: textOf(m[2].replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "")).trim(),
    level: Number(/aria-level="(\d+)"/.exec(m[1])?.[1]),
    selected: /aria-selected="true"/.test(m[1]),
    markup: m[0],
  }));
}

/** 고른 항목의 열(오른쪽) — 트리의 이름과 섞이지 않게 잘라 본다. */
function detailOf(html: string): string {
  const start = html.indexOf('aria-label="고른 항목"');
  if (start < 0) throw new Error(`고른 항목의 열이 없다: ${html}`);
  return html.slice(start);
}

/** 이 열에 선 입력 칸들 — 태그 이름과 접근성 이름. */
function fieldsOf(html: string): string[] {
  return [...html.matchAll(/<(input|textarea)\b([^>]*)>/g)].map((m) => {
    const id = /\bid="([^"]*)"/.exec(m[2])?.[1];
    const label =
      /aria-label="([^"]*)"/.exec(m[2])?.[1] ??
      (id ? new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)</label>`).exec(html)?.[1] : undefined);
    return `${m[1]}:${label ?? "?"}`;
  });
}

describe("항목 트리", () => {
  // 트리에는 실제 항목만 선다 — `spec` 패널 탭처럼 최상위 항목부터다(결정 26). 맨 위 항목(spec 폴더
  // 자신)은 행이 아니라 트리 열의 머리 `spec/`이다.
  it("맨 위 항목의 행이 없고, 최상위 항목부터 깊이대로 선다", () => {
    const rows = treeRows(render([0]));
    expect(rows.map(({ name, level }) => [name, level])).toEqual([
      ["overview.md", 1],
      ["decisions.md", 1],
      ["{n}-{name}/", 1],
      ["tickets/", 2],
      ["notes.md", 1],
    ]);
  });

  it("머리 `spec/`은 항목 행이 아닌 버튼이고, 고른 행에만 선택 표시가 선다", () => {
    const html = render([2, 0]);
    expect(html).toMatch(/<button\b(?![^>]*role="treeitem")[^>]*aria-pressed="false"[^>]*>[\s\S]*?spec\/<\/span><\/button>/);
    expect(treeRows(html).filter((row) => row.selected).map((row) => row.name)).toEqual(["tickets/"]);
  });

  it("머리 `spec/`을 고르면 머리가 눌리고 어느 행도 고르지 않았다", () => {
    const html = render([]);
    expect(html).toMatch(/<button\b[^>]*aria-pressed="true"[^>]*>[\s\S]*?spec\/<\/span><\/button>/);
    expect(treeRows(html).some((row) => row.selected)).toBe(false);
  });
});

// 트리 위 한 줄(티켓 13 · 구현 스펙 5절 「배치」) — 파일 추가, 폴더 추가, 옮기기 넷, 지우기(휴지통). 무엇이 잠기는지는
// 순수 함수의 판정(`editsAt`)이 정하고, 여기서는 그 답이 버튼에 닿는지를 본다. 누르는 것은 L3가 잰다.
describe("트리 위 한 줄", () => {
  /** 그 줄의 버튼마다 { 접근성 이름, 잠겼나, class }, 줄에 선 순서대로. */
  function toolsOf(html: string) {
    const bar = /<div\b[^>]*role="toolbar"[^>]*aria-label="항목 편집"[^>]*>([\s\S]*?)<\/div><div\b/.exec(html);
    if (bar === null) throw new Error(`트리 위 한 줄이 없다: ${html}`);
    return [...bar[1].matchAll(/<button\b([^>]*)>/g)].map((m) => ({
      name: /aria-label="([^"]*)"/.exec(m[1])?.[1],
      disabled: /\bdisabled=""/.test(m[1]),
      className: /class="([^"]*)"/.exec(m[1])?.[1] ?? "",
    }));
  }
  const locks = (html: string) => toolsOf(html).map(({ name, disabled }) => [name, disabled]);

  it("트리 열의 머리 `spec/` 위에 더하기 둘, 옮기기 넷, 지우기가 한 줄로 선다", () => {
    const html = render([1]);
    expect(toolsOf(html).map((tool) => tool.name)).toEqual([
      "파일 항목 추가",
      "폴더 항목 추가",
      "위로",
      "아래로",
      "내어쓰기",
      "들여쓰기",
      "고른 항목 지우기",
    ]);
    expect(html.indexOf('role="toolbar"')).toBeLessThan(html.indexOf("spec/</span>"));
  });

  // 머리 `spec/`은 항목이 아니다(결정 26) — 지울 것도 옮길 것도 없다. 더하기는 최상위 맨 뒤에 더하므로 된다.
  it("머리 `spec/`을 골랐으면 옮기기 넷과 휴지통이 잠기고, 더하기 둘은 된다", () => {
    expect(locks(render([]))).toEqual([
      ["파일 항목 추가", false],
      ["폴더 항목 추가", false],
      ["위로", true],
      ["아래로", true],
      ["내어쓰기", true],
      ["들여쓰기", true],
      ["고른 항목 지우기", true],
    ]);
  });

  it("고른 항목에서 할 수 없는 옮기기만 잠긴다", () => {
    // tickets/ — 형제가 없고, 부모 안에 있다
    expect(locks(render([2, 0]))).toEqual([
      ["파일 항목 추가", false],
      ["폴더 항목 추가", false],
      ["위로", true],
      ["아래로", true],
      ["내어쓰기", false],
      ["들여쓰기", true],
      ["고른 항목 지우기", false],
    ]);
    // notes.md — 앞 형제가 폴더다
    expect(locks(render([3]))).toEqual([
      ["파일 항목 추가", false],
      ["폴더 항목 추가", false],
      ["위로", false],
      ["아래로", true],
      ["내어쓰기", true],
      ["들여쓰기", false],
      ["고른 항목 지우기", false],
    ]);
  });

  // 휴지통은 붉고, 가리키면 더 짙은 붉은색이다. 잠기면 흐린 붉은색이다(구현 스펙 5절 · 프로토타입 뒤 사용자 선택).
  it("휴지통은 붉고 가리키면 더 짙은 붉은색이며, 잠기면 흐린 붉은색이다", () => {
    const trash = (html: string) => toolsOf(html).find((tool) => tool.name === "고른 항목 지우기")!.className;
    const live = trash(render([1]));
    expect(live).toMatch(/(^| )text-red-600( |$)/);
    expect(live).toMatch(/(^| )hover:text-red-700( |$)/);
    const locked = trash(render([]));
    expect(locked).toMatch(/(^| )text-red-600\/35( |$)/);
    expect(locked).not.toContain("hover:");
  });
});

describe("고른 항목", () => {
  // 머리를 고르면 오른쪽에는 맨 위 항목의 설명 — 방침 문단 — 칸 하나만 선다(결정 26). 이름 틀도 종류도
  // 아이콘도 없다: 맨 위 항목에는 그런 필드가 없다.
  it("머리 `spec/`을 고르면 spec 폴더 안내 칸 하나만 선다", () => {
    const detail = detailOf(render([]));
    expect(fieldsOf(detail)).toEqual(["textarea:spec 폴더 안내"]);
    expect(detail).toContain(">방침 문단.</textarea>");
    expect(detail).not.toContain('aria-label="종류"');
    expect(detail).not.toContain('aria-label="아이콘 바꾸기"');
  });

  // 제목이 곧 이름 틀 칸이다. 그 옆에 아이콘 칸과 종류(파일|폴더), 아래에 설명 칸이다.
  it("파일 항목은 제목이 이름 틀 칸이고, 종류는 파일이며, 설명 칸이 선다", () => {
    const detail = detailOf(render([1]));
    // 템플릿이 있는 항목이라 본문 칸이 설명 칸 아래에 더해진다(티켓 12)
    expect(fieldsOf(detail)).toEqual(["input:이름 틀", "textarea:설명", "textarea:템플릿 본문"]);
    expect(detail).toMatch(/<input\b[^>]*aria-label="이름 틀"[^>]*value="decisions.md"/);
    expect(detail).toContain(">결정</textarea>");
    expect(detail).toMatch(/role="radio" aria-checked="true"[^>]*>파일</);
    expect(detail).toMatch(/role="radio" aria-checked="false"[^>]*>폴더</);
    expect(detail).toContain('aria-label="아이콘 바꾸기"');
  });

  it("폴더 항목은 종류가 폴더다", () => {
    const detail = detailOf(render([2]));
    expect(detail).toMatch(/<input\b[^>]*aria-label="이름 틀"[^>]*value="\{n\}-\{name\}"/);
    expect(detail).toMatch(/role="radio" aria-checked="false"[^>]*>파일</);
    expect(detail).toMatch(/role="radio" aria-checked="true"[^>]*>폴더</);
    expect(detail).toContain(">한 판</textarea>");
  });

  // 아이콘은 앱의 표(`SPEC_ICONS`)에서 고른다. 손으로 적은 모르는 이름은 앱이 그리지 않는다 — 조용히
  // 빈칸이 되면 사람은 「아이콘이 안 먹었다」로만 읽으니, 그 항목 옆에 경고로 선다.
  it("모르는 아이콘 이름에는 그 항목 옆에 경고가 선다", () => {
    const html = render([3]);
    expect(textOf(detailOf(html))).toContain("모르는 아이콘 sparkles");
    const notes = treeRows(html).find((row) => row.name === "notes.md");
    expect(notes?.markup).toContain("모르는 아이콘");

    const known = render([0]);
    expect(textOf(detailOf(known))).not.toContain("모르는 아이콘");
    expect(treeRows(known).find((row) => row.name === "overview.md")?.markup).not.toContain("모르는 아이콘");
  });
});

// 파일 항목의 템플릿(티켓 12). 설명 칸 아래에 「템플릿」 없음|있음이 서고, 있음이면 12줄 높이의 본문 칸과 그
// 오른쪽 위의 작은 경로 표시가 선다. 경로는 사람이 적지 않는다 — 편집기가 켤 때 짓는다(`draft.ts`).
describe("템플릿", () => {
  /** 「템플릿」 고르기의 칸들 — { 글자, 골랐나 }. 칸이 없으면 `null`이다. */
  function templateChoice(detail: string) {
    const group = /<div\b[^>]*role="radiogroup"[^>]*aria-label="템플릿"[^>]*>([\s\S]*?)<\/div>/.exec(detail);
    if (group === null) return null;
    return [...group[1].matchAll(/<button\b[^>]*aria-checked="(true|false)"[^>]*>([^<]*)<\/button>/g)].map(
      (m) => [m[2], m[1] === "true"],
    );
  }

  it("파일 항목에만 템플릿 칸이 선다 — 폴더 항목과 머리 `spec/`에는 없다", () => {
    expect(templateChoice(detailOf(render([0])))).toEqual([
      ["없음", true],
      ["있음", false],
    ]);
    expect(templateChoice(detailOf(render([2])))).toBeNull();
    expect(templateChoice(detailOf(render([2, 0])))).toBeNull();
    expect(templateChoice(detailOf(render([])))).toBeNull();
  });

  it("있음이면 12줄 높이의 본문 칸과 레이아웃 폴더 아래의 경로 표시가 서고, 없음이면 둘 다 없다", () => {
    const on = detailOf(render([1]));
    expect(templateChoice(on)).toEqual([
      ["없음", false],
      ["있음", true],
    ]);
    expect(fieldsOf(on)).toEqual(["input:이름 틀", "textarea:설명", "textarea:템플릿 본문"]);
    const body = /<textarea\b([^>]*aria-label="템플릿 본문"[^>]*)>([^<]*)<\/textarea>/.exec(on);
    expect(body?.[2]).toBe("# 결정\n");
    expect(body?.[1]).toContain('rows="12"');
    expect(body?.[1]).toMatch(/\bresize-y\b/);
    expect(textOf(on)).toContain("~/.atelier/layouts/atelier/decisions.md");
    // 경로는 본문 칸 위에 선다 — 칸의 오른쪽 위다
    expect(on.indexOf("~/.atelier/layouts/atelier/decisions.md")).toBeLessThan(on.indexOf('aria-label="템플릿 본문"'));

    const off = detailOf(render([0]));
    expect(fieldsOf(off)).toEqual(["input:이름 틀", "textarea:설명"]);
    expect(textOf(off)).not.toContain("~/.atelier/layouts/atelier/");
  });

  // 템플릿 파일이 디스크에서 사라진 항목 — 레이아웃은 가리키는데 읽기가 본문을 주지 못했다(누락 경고).
  // 「없음」으로 서면 사람은 템플릿이 없다고 읽고, 저장하면 가리키던 것이 조용히 사라진다. 그래서 「있음」
  // 그대로 빈 본문 칸이 서고, 그 항목 옆에 경고가 선다. 칸에 적거나 「없음」으로 바꾸면 풀린다.
  it("누락 템플릿 항목은 「있음」으로 빈 본문 칸과 함께 서고, 그 항목 옆에 경고가 선다", () => {
    const missing: LayoutDraft = { ...opened(), templates: {} };
    const html = render([1], [], missing);
    const detail = detailOf(html);
    expect(templateChoice(detail)).toEqual([
      ["없음", false],
      ["있음", true],
    ]);
    expect(detail).toMatch(/<textarea\b[^>]*aria-label="템플릿 본문"[^>]*><\/textarea>/);
    expect(textOf(detail)).toContain("레이아웃 폴더에 이 템플릿 파일이 없어요");
    const row = treeRows(html).find((r) => r.name === "decisions.md");
    expect(row?.markup).toContain("템플릿 누락");

    // 본문이 있으면 경고가 없다
    const present = render([1]);
    expect(textOf(detailOf(present))).not.toContain("템플릿 파일이 없어요");
    expect(treeRows(present).some((r) => r.markup.includes("템플릿 누락"))).toBe(false);
  });
});

// 저장의 검증 오류는 데이터로 온다(`{ path, message }`, 구현 스펙 3절). 오류는 **그 위치의 항목 제목 아래에**
// 붉은 줄로 선다 — 다른 자리의 오류는 그 항목을 골랐을 때 선다. 트리의 행에도 표시가 붙어 어디를 골라야
// 하는지 보인다.
describe("검증 오류", () => {
  const errors: LayoutError[] = [
    { path: [2, 0], message: "pattern must not be empty" },
    { path: [1], message: "two siblings have the pattern `decisions.md`" },
    { path: [], message: "`root` has a `kind`" },
  ];

  it("오류 위치의 항목 제목 아래에 붉은 줄이 서고, 다른 자리의 오류는 서지 않는다", () => {
    const detail = detailOf(render([2, 0], errors));
    const line = /<p\b[^>]*class="[^"]*text-red-600[^"]*"[^>]*>pattern must not be empty<\/p>/.exec(detail);
    expect(line).not.toBeNull();
    // 제목(이름 틀 칸) 아래, 설명 칸 위다
    expect(detail.indexOf('aria-label="이름 틀"')).toBeLessThan(line!.index);
    expect(line!.index).toBeLessThan(detail.indexOf("<textarea"));
    expect(detail).not.toContain("two siblings");
    expect(detail).not.toContain("`root` has");
  });

  it("오류가 있는 항목의 트리 행에 표시가 붙는다", () => {
    const rows = treeRows(render([0], errors));
    const marked = rows.filter((row) => row.markup.includes("검증 오류")).map((row) => row.name);
    expect(marked).toEqual(["decisions.md", "tickets/"]);
  });

  it("맨 위 항목의 오류는 spec 폴더 안내 칸 위에 선다", () => {
    const detail = detailOf(render([], errors));
    const line = /<p\b[^>]*text-red-600[^>]*>`root` has a `kind`<\/p>/.exec(detail);
    expect(line).not.toBeNull();
    expect(line!.index).toBeLessThan(detail.indexOf("<textarea"));
  });

  // 자리가 없는 오류(문서 전체의 것)는 어느 항목을 골라도 선다 — 고를 자리가 없어서다.
  it("문서 전체의 오류는 어느 항목을 골라도 선다", () => {
    const whole: LayoutError = { path: null, message: "no file entry points to template \"x.md\"" };
    for (const selected of [[], [0], [2, 0]] as EntryPath[]) {
      expect(textOf(detailOf(render(selected, [whole])))).toContain(
        "no file entry points to template &quot;x.md&quot;",
      );
    }
  });
});

// 읽지 못하는 레이아웃은 편집 UI를 세우지 않는다 — 까닭과 설정으로 돌아가는 길만 보인다(티켓 11). 편집기
// 주소로 바로 와도 같다. 고치는 길은 설정 행의 에이전트에게 부탁, 손으로 고치기, 되돌리기다.
describe("읽지 못하는 레이아웃", () => {
  const broken: UnreadableSpecLayout = {
    id: "maison",
    folder: "~/.atelier/layouts/maison",
    edited: true,
    errors: [
      { path: [2], message: '`kind` is missing ("file" or "folder")' },
      { path: null, message: "layout.json is not valid JSON" },
    ],
    raw: "{",
  };

  it("까닭과 설정으로 돌아가는 길만 보이고, 편집 UI가 없다", () => {
    const html = renderToStaticMarkup(<UnreadableLayout read={broken} onBack={() => {}} />);
    const text = textOf(html);
    expect(text).toContain("~/.atelier/layouts/maison/");
    expect(text).toContain('root.children[2]: `kind` is missing (&quot;file&quot; or &quot;folder&quot;)');
    expect(text).toContain("layout.json is not valid JSON");
    expect([...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1]).trim())).toEqual([
      "설정으로 돌아가기",
    ]);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('role="tree"');
  });
});
