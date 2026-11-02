import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThreadMarkdown from "./ThreadMarkdown";

// 정적 마크업 seam — **흐르는 답이 Codex처럼 선다**(02 구현 스펙 §12 「답 글자 도착」 · 스토리 99 · Screen-Live 단계 5). 새로 온 조각은
// 옅음에서 또렷해지고(`word-in` — .7s), 조각 사이 늦음은 없다. 흐르는 동안 마지막 글덩이의 끝 240px이 옅다(`stream-tail`). 다 흐른 답은
// 감싸지 않는다. 움직임의 시간 · 곡선은 `tokens.test.ts`가 본다.

const render = (text: string, streaming: boolean) => renderToStaticMarkup(<ThreadMarkdown text={text} streaming={streaming} />);

describe("흐르는 답", () => {
  it("새로 온 낱말은 늦음 없이 함께 옅음에서 선다", () => {
    const markup = render("차감이 두 번 일어나요.", true);
    expect(markup.match(/class="word-in"/g)).toHaveLength(4);
    // 낱말마다의 늦음(v1 「단어 도착」의 70ms 사이)이 없다.
    expect(markup).not.toContain("--word-delay");
    expect(markup).not.toContain("style=");
  });

  it("흐르는 동안 마지막 글덩이만 끝이 옅다", () => {
    const markup = render("첫 문단입니다.\n\n둘째 문단이 흐르는", true);
    const tails = [...markup.matchAll(/<span class="stream-tail">(.*?)<\/span><\/p>/g)];
    expect(tails).toHaveLength(1);
    expect(tails[0][1]).toContain("흐르는");
    expect(tails[0][1]).not.toContain("첫");
  });

  it("목록의 마지막 줄이 흐르면 그 줄의 끝이 옅다", () => {
    const markup = render("- 하나\n- 둘이 흐르는", true);
    expect(markup).toMatch(/<li><span class="stream-tail">[^\n]*흐르는[^\n]*<\/span><\/li>\s*<\/ul><\/div>$/);
    expect(markup.match(/stream-tail/g)).toHaveLength(1);
  });

  it("코드 블록으로 끝나면 끝을 가리지 않는다 — 코드는 글자 그대로 선다", () => {
    const markup = render("설명입니다.\n\n```ts\nconst a = 1;\n```", true);
    expect(markup).not.toContain("stream-tail");
  });

  it("다 흐른 답은 감싸지 않는다", () => {
    const markup = render("차감이 두 번 일어나요.", false);
    expect(markup).not.toContain("word-in");
    expect(markup).not.toContain("stream-tail");
  });
});

// 긴 답은 덩어리로 나눠 그린다(01b-9). 나눠 그려도 통째로 푼 것과 같아야 한다 — 링크 정의가 든 글은 나누지 않으므로(`markdownBlocks`) 쓰지 않는 정의 하나를
// 붙인 글이 통째로 푼 값이다.
describe("덩어리로 나눠 그린 답", () => {
  const whole = (text: string) => render(`${text}\n\n[쓰지-않는-정의]: https://example.com\n`, false);
  const tight = (markup: string) => markup.replace(/>\s+</g, "><").trim();

  it.each([
    ["문단", "첫 문단이다.\n\n둘째 문단이다."],
    ["제목과 목록", "## 제목\n\n문단이다.\n\n- 하나\n- 둘\n\n### 다음\n\n1. 첫째\n2. 둘째\n"],
    ["느슨한 목록", "- 하나\n\n- 둘\n\n  둘째의 둘째 문단\n\n- 셋\n\n밖\n"],
    ["코드", "앞\n\n```rust\nlet a = 1;\n\nlet b = 2;\n```\n\n뒤\n"],
    ["표와 인용", "| 값 | 뜻 |\n|---|---|\n| 1 | 2 |\n\n> 인용\n\n---\n\n끝\n"],
    ["들여 쓴 코드", "앞\n\n    코드\n\n    코드\n\n뒤\n"],
  ])("%s", (_, text) => {
    expect(tight(render(text, false))).toBe(tight(whole(text)));
  });

  it("덩어리가 아주 많은 답도 차례대로 다 선다", () => {
    const text = Array.from({ length: 200 }, (_, at) => `문단 ${at}번이다.`).join("\n\n");
    const markup = render(text, false);
    const order = [...markup.matchAll(/문단 (\d+)번이다\./g)].map((found) => Number(found[1]));

    expect(order).toEqual(Array.from({ length: 200 }, (_, at) => at));
    expect(tight(markup).replace(/<div class="flex min-w-0 flex-col gap-3">|<\/div>/g, "")).toBe(
      tight(whole(text)).replace(/<\/div>/g, ""),
    );
  });

  it("흐르는 동안에도 끝이 옅은 글덩이는 하나다", () => {
    const markup = render("## 제목\n\n첫 문단이다.\n\n둘째 문단이다.\n\n셋째가 흐르는", true);
    expect(markup.match(/stream-tail/g)).toHaveLength(1);
    expect(markup).toMatch(/<span class="stream-tail">.*흐르는.*<\/span><\/p>\s*<\/div>$/);
    expect(markup).toContain('class="word-in">첫');
  });
});
