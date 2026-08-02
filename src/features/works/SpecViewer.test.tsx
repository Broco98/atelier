import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrettyView, SourceView } from "./SpecViewer";

// 참조 복사 버튼은 최상위 블록 하나당 정확히 하나이고, 그 블록 바깥에 선다. 이 불변조건이
// 뚫리면 버튼이 겹쳐 보인다 — 인용은 자기 자신과 안쪽 첫 문단의 시작 라인이 같아서,
// 라인만으로 최상위를 가리면 둘 다 통과한다. 판정이 라인으로 되돌아가면 여기서 걸린다.
function render(markdown: string): string {
  return renderToStaticMarkup(
    <PrettyView file="overview.md" content={markdown} onCopyBlock={() => {}} />,
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
    const html = renderToStaticMarkup(
      <PrettyView file="overview.md" content="문단" onCopyBlock={() => {}} />,
    );
    expect(html).toContain("max-w-[900px]");
    expect(html).toContain("px-12");
  });

  it("둘 다 접었을 때만 1200px로 넓어진다", () => {
    const html = renderToStaticMarkup(
      <PrettyView file="overview.md" content="문단" onCopyBlock={() => {}} wide />,
    );
    expect(html).toContain("max-w-[1200px]");
    expect(html).toContain("px-12");
  });

  // 두 보기가 **함께** 넓어져야 한다 — 한쪽만 따라가면 소스 토글에서 본문이 좌우로 튄다
  it("소스 보기도 같은 폭을 쓴다", () => {
    expect(renderToStaticMarkup(<SourceView content="줄" />)).toContain("max-w-[900px]");
    expect(renderToStaticMarkup(<SourceView content="줄" wide />)).toContain("max-w-[1200px]");
  });
});
