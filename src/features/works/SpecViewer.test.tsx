import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrettyView, SourceView } from "./SpecViewer";

// 참조 복사 버튼은 최상위 블록 하나당 정확히 하나이고, 그 블록 바깥에 선다. 이 불변조건이
// 뚫리면 버튼이 겹쳐 보인다 — 인용은 자기 자신과 안쪽 첫 문단의 시작 라인이 같아서,
// 라인만으로 최상위를 가리면 둘 다 통과한다. 판정이 라인으로 되돌아가면 여기서 걸린다.
function render(markdown: string, files: string[] = [], wide = false): string {
  return renderToStaticMarkup(
    <PrettyView
      file="overview.md"
      content={markdown}
      onCopyBlock={() => {}}
      wide={wide}
      files={files}
      onNavigate={() => {}}
      // 로컬 이미지의 asset 변환은 웹뷰 안에서만 되는 일이라 여기서는 켜지 않는다 —
      // 경로 해석 자체는 doc-refs.test.ts의 resolveImageSrc가 덮는다
      specRoot={null}
    />,
  );
}

// 버튼 하나가 같은 문구를 aria-label과 title 양쪽에 쓴다 — 한쪽만 센다
const BUTTON = /aria-label="[^"]*줄 참조 복사"/g;

function copyButtons(markdown: string): number {
  return render(markdown).match(BUTTON)?.length ?? 0;
}

describe("PrettyView 참조 복사 버튼", () => {
  it.each([
    ["문단", "그냥 문단"],
    ["헤딩", "## 제목"],
    ["setext 헤딩", "제목이다\n====="],
    ["인용", "> **경계 하나** — 무주공산이다."],
    ["여러 줄 인용", "> 첫 줄\n> 이어지는 줄"],
    ["촘촘한 목록", "- 첫 항목\n- 둘째 항목"],
    ["느슨한 목록", "- 첫 항목\n\n- 둘째 항목"],
    ["목록 안 목록", "- 바깥\n  - 안쪽"],
    ["인용 안 목록", "> - 항목 하나\n> - 항목 둘"],
    ["인용 안 표", "> | a | b |\n> | --- | --- |\n> | 1 | 2 |"],
    ["표", "| a | b |\n| --- | --- |\n| 1 | 2 |"],
    ["코드블록", "```js\nconst a = 1;\n```"],
  ])("%s 블록에 버튼이 하나만 붙는다", (_name, markdown) => {
    expect(copyButtons(markdown)).toBe(1);
  });

  it("블록이 여럿이면 각각 하나씩 붙는다", () => {
    expect(copyButtons("> 인용\n\n일반 문단\n\n- 항목")).toBe(3);
  });

  // 개수만 세면 버튼이 안쪽 문단으로 밀려나도 통과한다 — 어느 블록 바깥에 섰는지까지 본다
  it.each([
    ["인용", "> 인용문", "blockquote"],
    ["느슨한 목록", "- 첫 항목\n\n- 둘째 항목", "ul"],
    ["표", "| a | b |\n| --- | --- |\n| 1 | 2 |", "div"], // 표는 스크롤 상자가 한 겹 감싼다
  ])("%s 버튼은 안쪽이 아니라 블록 바깥에 선다", (_name, markdown, tag) => {
    expect(render(markdown)).toContain(`</button><${tag}`);
  });

  // 각주 정의는 문서 끝 Footnotes 절로 자리를 옮겨 렌더된다 — 본문 흐름의 블록이 아니므로
  // 거터도 없다. 라인만 보던 시절엔 옮겨 간 자리에 버튼이 딸려 갔다.
  it("각주 절에는 버튼이 붙지 않는다", () => {
    const html = render("본문에 각주가 있다[^1]\n\n[^1]: 각주 정의 본문");
    expect(html.match(BUTTON)).toHaveLength(1);
    expect(html.slice(html.indexOf("data-footnotes")).match(BUTTON)).toBeNull();
  });
});

// 본문 열 규격은 값을 정하는 지점이 하나다. 넓어지는 쪽만 보면 좁은 쪽이 조용히 따라
// 넓어져도 통과하므로 둘을 함께 본다. px-12(48px)는 어느 쪽에서도 바뀌지 않는다 —
// 좌측 48px은 여백이 아니라 거터의 자리이고, 소스 보기의 줄번호 열이 그 자리를 채운다.
describe("PrettyView 본문 열", () => {
  it("평소에는 900px이다", () => {
    const html = render("문단");
    expect(html).toContain("max-w-[900px]");
    expect(html).toContain("px-12");
  });

  it("둘 다 접었을 때만 1200px로 넓어진다", () => {
    const html = render("문단", [], true);
    expect(html).toContain("max-w-[1200px]");
    expect(html).toContain("px-12");
  });

  // 두 보기가 **함께** 넓어져야 한다 — 한쪽만 따라가면 소스 토글에서 본문이 좌우로 튄다
  it("소스 보기도 같은 폭을 쓴다", () => {
    expect(renderToStaticMarkup(<SourceView content="줄" />)).toContain("max-w-[900px]");
    expect(renderToStaticMarkup(<SourceView content="줄" wide />)).toContain("max-w-[1200px]");
  });
});

describe("PrettyView 링크", () => {
  // 이 앱에서 target="_blank"는 아무 데도 가지 않는다(Tauri 웹뷰). 그래서 링크가 죽어 있었다.
  // 되돌아오면 증상도 그대로 돌아오므로 그물을 여기 건다.
  it("target=_blank로 렌더하지 않는다", () => {
    expect(render("[깃허브](https://github.com)")).not.toContain("_blank");
  });

  // "<a"로 세지 않는다 — 본문을 감싸는 <article>이 걸린다
  const anchors = (html: string) => html.match(/<a[\s>]/g)?.length ?? 0;

  it("목록에 없는 문서 링크는 a가 아니라 span이다 — 눌러도 아무 일이 없어야 한다", () => {
    const html = render("[없는 것](./없는문서.md)", ["overview.md"]);
    expect(anchors(html)).toBe(0);
    expect(html).toContain("문서를 찾을 수 없어요");
  });

  it("목록에 있는 문서 링크는 살아 있는 a다", () => {
    const html = render("[다른 문서](./research/prompt.md)", ["research/prompt.md"]);
    expect(anchors(html)).toBe(1);
    expect(html).not.toContain("문서를 찾을 수 없어요");
  });
});

describe("PrettyView 이미지", () => {
  // 자리표시가 보여주는 것은 **경로**다. 대체글이 있을 때 그것만 보여주면 정작 고쳐야 할
  // 문자열이 화면에 없어, 이 자리표시가 존재하는 이유("경로를 고칠 수 있게")가 사라진다.
  it("그릴 수 없는 이미지는 깨진 아이콘 대신 경로를 보여준다", () => {
    const html = render("![패널 스크린샷](images/shot.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("images/shot.png");
  });

  it("http 이미지는 변환 없이 그대로 그린다", () => {
    const html = render("![외부](https://example.com/a.png)");
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it("이미지가 본문 폭을 넘지 않는다", () => {
    expect(render("![외부](https://example.com/a.png)")).toContain("max-w-full");
  });
});

describe("PrettyView 콜아웃", () => {
  // 이 검사가 이 티켓의 중심이다. 기존 스펙들이 `> **커버:** …` 같은 평범한 인용을
  // 많이 쓰고 있어서, 그것들이 색을 갖는 순간 그 자체가 회귀다.
  it.each([
    ["평범한 인용", "> **커버:** 이 문서가 답하는 것"],
    ["알 수 없는 마커", "> [!TODO] 나중에"],
    ["마커가 첫 줄 맨 앞이 아닌 인용", "> 앞말 [!NOTE] 뒷말"],
  ])("%s은 blockquote 그대로다", (_name, markdown) => {
    expect(render(markdown)).toContain("<blockquote");
  });

  it.each([
    ["NOTE", "Note"],
    ["TIP", "Tip"],
    ["IMPORTANT", "Important"],
    ["WARNING", "Warning"],
    ["CAUTION", "Caution"],
  ])("%s은 종류 이름을 제목으로 그린다", (kind, label) => {
    const html = render(`> [!${kind}]\n> 본문이다`);
    expect(html).not.toContain("<blockquote");
    expect(html).toContain(label);
    expect(html).toContain("본문이다");
  });

  it("마커 뒤 텍스트가 제목이 되고 마커는 본문에 남지 않는다", () => {
    const html = render("> [!WARNING] 되돌릴 수 없어요\n> 브랜치는 남아요");
    expect(html).toContain("되돌릴 수 없어요");
    expect(html).toContain("브랜치는 남아요");
    expect(html).not.toContain("[!WARNING]");
    // 제목을 따로 말했으므로 종류 이름은 쓰지 않는다
    expect(html).not.toContain("Warning");
  });

  it("콜아웃 안의 목록·코드·링크가 정상 렌더된다", () => {
    const html = render("> [!TIP]\n> - 항목 하나\n> - `코드`\n> - [바깥](https://a.b)");
    expect(html).toContain("<li");
    expect(html).toContain("<code");
    expect(html).toContain("<a ");
  });

  // 콜아웃도 최상위 블록이다 — 거터를 잃으면 참조를 복사할 수 없다
  it("콜아웃에도 참조 복사 버튼이 하나 붙는다", () => {
    expect(copyButtons("> [!NOTE] 제목\n> 본문")).toBe(1);
  });

  // 제목이 여러 노드로 쪼개지는 모양. 앞부분만 잘라내면 강조가 본문에 남아 제목과 겹친다 —
  // 그럴 때는 첫 줄을 손대지 않고 제목도 종류 이름으로 되돌린다.
  it("제목에 마크업이 섞이면 같은 말이 두 번 나오지 않는다", () => {
    const html = render("> [!NOTE] 제목 **강조**\n> 본문이다");
    expect(html.match(/강조/g)).toHaveLength(1);
    expect(html).toContain("Note");
    expect(html).toContain("본문이다");
  });
});
