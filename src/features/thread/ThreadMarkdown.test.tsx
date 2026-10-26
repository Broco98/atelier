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
