import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpecViewer, { HtmlDoc, PrettyView, SourceView, htmlSrcdoc } from "./SpecViewer";
import { useSpecFile } from "./hooks";
import type { WorkView } from "./types";

// 이 화면이 파일을 **읽는지**를 세려면 조회 계층을 걷어내야 한다. 정적 렌더는 이펙트를
// 돌리지 않아 IPC가 나가지는 않지만, 훅이 어떤 인자로 불렸는가는 그 자리에서만 보인다.
//
// 읽어 온 내용도 여기서 정한다 — 「아직 안 왔다」(`undefined`)와 「왔는데 비었다」(`""`)가
// 프레임 경로에서 갈리기 때문이다(결정 9).
const read = vi.hoisted(() => ({ content: undefined as string | undefined }));
vi.mock("./hooks", () => ({
  useSpecFile: vi.fn(() => ({ data: read.content })),
  useHomeDir: () => ({ data: undefined }),
}));

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

// 본문이 무엇으로 서는가는 **표 하나가 정한다**(doc-refs의 `docBody`). 이 화면은 그 값으로
// 갈리기만 한다 — 자기 식을 들면 트리·아카이브와 다른 말을 하게 된다.
//
// **읽을지 말지도 그 값에서 나온다.** 그림을 UTF-8 문자열로 읽으면 쓸 수 없는 값이 오고
// 화면이 줄번호 `1` 하나가 된다(실물에서 그랬다). 읽기만 따로 그림 판정을 부르면, 표가
// 바뀔 때 그 자리만 옛 규칙을 따른다 — 그래서 부르는 자리를 아예 없앴고, 여기서 그것을 센다.
describe("SpecViewer 본문 갈래", () => {
  const work: WorkView = {
    slug: "some-work",
    title: "어떤 작업",
    status: "active",
    branch: "feat/some-work",
    createdAt: "2026-08-16",
    projects: [],
    pinned: false,
    worktrees: [],
    specDir: "~/.atelier/works/some-work/spec",
    specFiles: ["overview.md", "샷.png", "notes.txt"],
  };

  function viewer(file: string, showSource = false): string {
    return renderToStaticMarkup(
      <SpecViewer
        work={work}
        panelOpen={false}
        sidebarOpen={false}
        file={file}
        showSource={showSource}
        onNavigate={() => {}}
        onCopy={() => {}}
      />,
    );
  }

  beforeEach(() => {
    vi.mocked(useSpecFile).mockClear();
    read.content = undefined;
  });

  it("그림은 읽지 않는다", () => {
    viewer("샷.png");
    expect(useSpecFile).toHaveBeenCalledWith("some-work", null);
  });

  it.each(["overview.md", "notes.txt", "목업/조각.html"])("%s는 읽는다", (file) => {
    viewer(file);
    expect(useSpecFile).toHaveBeenCalledWith("some-work", file);
  });

  it("그림은 토글을 켜도 그림이다", () => {
    // 켬/끔이 갈리면 원문을 볼 수 있다는 말이 되는데, 그림에는 읽어 온 소스가 아예 없다
    expect(viewer("샷.png", true)).toBe(viewer("샷.png", false));
  });

  it("md도 html도 아닌 것은 토글과 무관하게 소스다", () => {
    expect(viewer("notes.txt")).toContain("[tab-size:4]");
    expect(viewer("notes.txt", true)).toContain("[tab-size:4]");
  });

  it("마크다운은 토글이 갈린다", () => {
    expect(viewer("overview.md")).not.toContain("[tab-size:4]");
    expect(viewer("overview.md", true)).toContain("[tab-size:4]");
  });

  it("html은 토글이 갈린다 — 렌더와 원문을 오간다", () => {
    read.content = "<p>조각</p>";
    expect(viewer("목업/조각.html")).toContain("<iframe");
    const source = viewer("목업/조각.html", true);
    expect(source).toContain("[tab-size:4]");
    expect(source).not.toContain("<iframe");
  });
});

// ─── HTML 프레임 ───
//
// 결정 1·2·4·5·9. 통로는 `srcdoc` 하나이고, 껍데기는 **없을 때만** 씌우며, sandbox 값에
// 조건이 없고, 마크업을 문자열로 조립하지 않는다.
describe("htmlSrcdoc 껍데기", () => {
  // **이 검사가 무엇을 잡는지를 정확히 적는다** — 우리가 이 껍데기를 우발적으로 고치는
  // 것이다(결정 2). **아티팩트 발행 쪽이 바뀌어도 이 검사는 초록이다.** 발행 껍데기와의
  // 드리프트를 알려 주는 장치는 이 저장소에 없다 — 1:1은 손으로 한 번 확인한다.
  //
  // 아래 문자열은 2026-08-29 발행본 원문의 `<head>`를 따옴표까지 그대로 옮긴 것이다
  // (`SpecViewer.tsx`의 상수 주석). 첫 판이 말로 풀어 쓴 설명에서 근사해 적어 네 자리가
  // 어긋나 있었고, 실측이 그것을 잡았다 — 그러니 이 검사를 고칠 때는 **발행본을 다시 떠서**
  // 고친다. 「보기 좋게 다듬는다」로 고치면 잡으려던 그 사고가 그대로 다시 난다.
  it("아티팩트 조각에는 발행 껍데기를 그대로 씌운다", () => {
    expect(htmlSrcdoc("<p>조각</p>")).toBe(
      '<!doctype html>\n<html data-theme="light">\n<head>\n' +
        '<meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">\n' +
        "<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}\n" +
        "img{max-width:100%}[hidden]:not([hidden=until-found]){display:none!important}</style>\n" +
        "</head><body><p>조각</p></body></html>",
    );
  });

  // 온전한 문서에 껍데기를 또 씌우면 `<html>`이 겹친다. 판정은 **BOM과 선행 공백을 버린 뒤
  // 대소문자를 무시한다** — 손으로 넣는 파일이라 셋 다 실재한다.
  it.each([
    ["소문자 doctype", "<!doctype html><p>온전한 문서</p>"],
    ["대문자 DOCTYPE", "<!DOCTYPE html><p>온전한 문서</p>"],
    ["BOM이 앞에 붙은 것", "\uFEFF<!doctype html><p>온전한 문서</p>"],
    ["선행 공백과 줄바꿈", "\n  <!doctype html><p>온전한 문서</p>"],
    ["doctype 없이 <html>부터", "<html><body>온전한 문서</body></html>"],
    ["대문자 <HTML>", "<HTML><BODY>온전한 문서</BODY></HTML>"],
  ])("%s는 그 파일이 정한 그대로 선다", (_name, content) => {
    expect(htmlSrcdoc(content)).toBe(content);
  });

  // 「아직 안 왔다」와 갈린다 — 안 온 것은 아예 안 그리고(아래), 빈 파일은 껍데기를 쓴다.
  it("빈 파일은 껍데기를 씌워 그린다", () => {
    expect(htmlSrcdoc("")).toContain("<!doctype html>");
    expect(htmlSrcdoc("")).toContain("<body></body>");
  });
});

describe("HtmlDoc 프레임", () => {
  const frame = (content: string | undefined, name = "목업/조각.html") =>
    renderToStaticMarkup(<HtmlDoc content={content} name={name} />);

  // 빈 `srcdoc`으로 한 번 항해했다 다시 항해하는 깜빡임을 만들지 않는다(결정 9).
  it("내용이 아직 안 왔으면 프레임을 안 그린다", () => {
    expect(frame(undefined)).toBe("");
  });

  it("빈 파일은 프레임을 그린다 — 안 온 것과 다르다", () => {
    expect(frame("")).toContain("<iframe");
  });

  // 값에 조건을 달지 않는다(결정 5). `allow-same-origin`을 함께 주면 프레임이 앱과 같은
  // 출처가 되어 **부모에 있는 자기 sandbox 속성을 지우고 리로드**할 수 있다.
  it('sandbox 값이 정확히 "allow-scripts"다', () => {
    expect(frame("<p>a</p>")).toContain('sandbox="allow-scripts"');
    expect(frame("<p>a</p>")).not.toContain("allow-same-origin");
  });

  // `<iframe>`은 이름이 없으면 「프레임」으로만 읽힌다. 그림 본문이 `alt`에 파일 경로를
  // 넣는 관습을 그대로 따른다.
  it("파일 경로가 접근성 이름으로 붙는다", () => {
    expect(frame("<p>a</p>")).toContain('title="목업/조각.html"');
  });

  // 결정 4의 세 겹을 통째로 무의미하게 만드는 실수는 하나뿐이다 — 마크업을 문자열로
  // 조립하는 것. 그러면 파일 안의 따옴표가 속성을 깨고 나와 **부모 문서에** 스크립트를
  // 심고, 그 순간 sandbox도 IPC 키도 우회된다. React가 값으로만 넣는지를 여기서 시도해 본다.
  it("따옴표와 </iframe>이 든 내용으로도 부모 마크업이 안 깨진다", () => {
    const hostile = '"><script>parent.document.title="털렸다"</script></iframe><iframe srcdoc="';
    const markup = frame(hostile, "적대적.html");
    // 부모 마크업의 태그는 `<iframe …></iframe>` 딱 하나다 — 내용이 속성을 깨고 나왔다면
    // 여기가 늘어난다. 개수로 세는 것이 「무엇이 새어 나왔나」를 미리 알 필요가 없어서다.
    expect(markup.match(/</g)).toHaveLength(2);
    expect(markup).not.toContain("<script");
    // 그러면서 내용은 잃지 않는다 — 이스케이프된 채 속성 안에 그대로 있다.
    expect(markup).toContain("&lt;script&gt;");
  });
});
