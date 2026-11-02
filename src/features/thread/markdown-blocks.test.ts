import { describe, expect, it } from "vitest";
import { continueBlocks, markdownBlocks } from "./markdown-blocks";

// 긴 답을 다시 풀지 않으려고 덩어리로 나눈다(01b-9). 나눈 자리가 뜻을 바꾸면 안 되므로, 앞뒤를 따로 풀어도 같은 자리만 가른다.
describe("마크다운 덩어리", () => {
  it("빈 줄로 갈린 글덩이마다 나누고 이으면 원문이다", () => {
    const text = "## 제목\n\n첫 문단이다.\n\n둘째 문단이다.\n";
    const blocks = markdownBlocks(text);

    expect(blocks).toEqual(["## 제목\n\n", "첫 문단이다.\n\n", "둘째 문단이다.\n"]);
    expect(blocks.join("")).toBe(text);
  });

  it("코드 블록 안의 빈 줄에서는 가르지 않는다", () => {
    const text = "앞\n\n```rust\nlet a = 1;\n\nlet b = 2;\n```\n\n뒤";

    expect(markdownBlocks(text)).toEqual(["앞\n\n", "```rust\nlet a = 1;\n\nlet b = 2;\n```\n\n", "뒤"]);
  });

  it("닫는 울타리는 여는 것과 같은 글자로 그만큼 길어야 한다", () => {
    const text = "````\n```\n\n뒤도 코드다\n````\n\n밖";

    expect(markdownBlocks(text)).toEqual(["````\n```\n\n뒤도 코드다\n````\n\n", "밖"]);
  });

  it("닫히지 않은 코드 블록은 끝까지 한 덩어리다", () => {
    expect(markdownBlocks("앞\n\n```\n코드\n\n코드")).toEqual(["앞\n\n", "```\n코드\n\n코드"]);
  });

  it("목록 항목 사이의 빈 줄에서는 가르지 않는다 — 나누면 느슨한 목록이 두 목록이 된다", () => {
    const text = "- 첫째\n\n- 둘째\n\n1. 셋째\n\n2. 넷째\n\n밖";

    expect(markdownBlocks(text)).toEqual(["- 첫째\n\n- 둘째\n\n1. 셋째\n\n2. 넷째\n\n", "밖"]);
  });

  it("들여 쓴 줄은 앞 덩어리에 딸린다 — 목록 항목의 둘째 문단이나 들여 쓴 코드다", () => {
    expect(markdownBlocks("- 항목\n\n  둘째 문단\n\n밖")).toEqual(["- 항목\n\n  둘째 문단\n\n", "밖"]);
    expect(markdownBlocks("    코드\n\n    코드\n\n밖")).toEqual(["    코드\n\n    코드\n\n", "밖"]);
  });

  it("링크 정의나 각주가 있으면 통째로 둔다 — 문서 전체에서 찾아진다", () => {
    const text = "[글][뜻]을 본다.\n\n[뜻]: https://example.com\n";

    expect(markdownBlocks(text)).toEqual([text]);
    expect(markdownBlocks("앞[^1]\n\n[^1]: 각주\n")).toEqual(["앞[^1]\n\n[^1]: 각주\n"]);
  });

  it("코드 블록 안의 링크 정의 모양은 글이다", () => {
    expect(markdownBlocks("```\n[뜻]: 값\n```\n\n뒤")).toEqual(["```\n[뜻]: 값\n```\n\n", "뒤"]);
  });

  it("HTML로 시작하는 줄이 있으면 통째로 둔다 — 안의 빈 줄이 마크다운의 빈 줄이 아니다", () => {
    const text = "<pre>\n앞\n\n뒤\n</pre>\n\n밖";

    expect(markdownBlocks(text)).toEqual([text]);
  });

  it("글이 자라도 앞서 닫힌 덩어리는 그대로다", () => {
    const text = "## 제목\n\n문단이다.\n\n- 항목\n- 항목\n\n```\n코드\n\n코드\n```\n\n| 값 | 뜻 |\n|---|---|\n| 1 | 2 |\n\n> 인용\n\n끝 문단";
    let closed: string[] = [];
    for (let end = 1; end <= text.length; end += 1) {
      const blocks = markdownBlocks(text.slice(0, end));
      const nowClosed = blocks.slice(0, -1);
      expect(nowClosed.slice(0, closed.length)).toEqual(closed);
      closed = nowClosed;
    }
  });

  it("빈 글은 덩어리가 없다", () => {
    expect(markdownBlocks("")).toEqual([]);
  });
});

// 흐르는 글은 조각마다 나눈다 — 닫힌 덩어리는 다시 훑지 않고 끝부터 잇는다.
describe("이어 나누기", () => {
  const text = "## 제목\n\n문단이다.\n\n- 항목\n- 항목\n\n```\n코드\n\n코드\n```\n\n| 값 | 뜻 |\n|---|---|\n| 1 | 2 |\n\n> 인용\n\n끝 문단";

  it("글이 자라는 내내 처음부터 나눈 값과 같다", () => {
    let scan = continueBlocks(null, "");
    for (let end = 0; end <= text.length; end += 1) {
      const grown = text.slice(0, end);
      scan = continueBlocks(scan, grown);
      expect(scan.blocks).toEqual(markdownBlocks(grown));
    }
  });

  it("닫힌 덩어리는 앞의 값을 그대로 쓴다", () => {
    const first = continueBlocks(null, "첫 문단\n\n둘째 문단\n\n셋째");
    const next = continueBlocks(first, "첫 문단\n\n둘째 문단\n\n셋째 문단");

    expect(next.closed).toBe(first.closed);
  });

  it("앞 글을 잇지 않은 글은 처음부터 나눈다", () => {
    const first = continueBlocks(null, "첫 문단\n\n둘째");

    expect(continueBlocks(first, "다른 글\n\n뒤").blocks).toEqual(["다른 글\n\n", "뒤"]);
    expect(continueBlocks(first, "첫 문").blocks).toEqual(["첫 문"]);
  });

  it("뒤에 링크 정의가 오면 글 전체가 한 덩어리가 된다", () => {
    const first = continueBlocks(null, "[글][뜻]\n\n둘째");
    const whole = "[글][뜻]\n\n둘째\n\n[뜻]: https://example.com";

    expect(continueBlocks(first, whole).blocks).toEqual([whole]);
    expect(continueBlocks(continueBlocks(first, whole), `${whole}\n\n뒤`).blocks).toEqual([`${whole}\n\n뒤`]);
  });
});
