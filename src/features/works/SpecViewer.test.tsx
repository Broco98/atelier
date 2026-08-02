import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrettyView } from "./SpecViewer";

// 참조 복사 버튼은 최상위 블록 하나당 정확히 하나이고, 그 블록 바깥에 선다. 이 불변조건이
// 뚫리면 버튼이 겹쳐 보인다 — 인용은 자기 자신과 안쪽 첫 문단의 시작 라인이 같아서,
// 라인만으로 최상위를 가리면 둘 다 통과한다. 판정이 라인으로 되돌아가면 여기서 걸린다.
function render(markdown: string, files: string[] = []): string {
  return renderToStaticMarkup(
    <PrettyView
      file="overview.md"
      content={markdown}
      onCopyBlock={() => {}}
      files={files}
      onNavigate={() => {}}
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
