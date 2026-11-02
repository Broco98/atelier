import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldsLong, UserMessage } from "./UserMessage";

// 내 말(restart 02b-6 · Cards 보드 「내 말」). 줄 수는 그려진 뒤에 재므로(폭에 따라 줄바꿈이 다르다) 접히는 그림은 시안 비교가 잰다 — 여기서는 몇
// 줄부터 접는지와, 처음 그림(재기 전)의 묶음을 잰다.

const LINE = 22.75;

describe("긴 말 접기", () => {
  it("8줄까지는 그대로 서고 9줄부터 접힌다(스토리 73 「8줄 넘으면」)", () => {
    expect(foldsLong(8 * LINE, LINE)).toBe(false);
    expect(foldsLong(9 * LINE, LINE)).toBe(true);
  });

  it("반 줄 아래의 어긋남은 그 줄로 센다 — 글자 바닥 · 반올림 때문에 8줄이 접히지 않는다", () => {
    expect(foldsLong(8 * LINE + 3, LINE)).toBe(false);
    expect(foldsLong(9 * LINE - 3, LINE)).toBe(true);
  });

  it("줄 높이를 읽지 못하면 접지 않는다", () => {
    expect(foldsLong(400, 0)).toBe(false);
    expect(foldsLong(400, Number.NaN)).toBe(false);
  });

  it("재기 전에는 접지 않고 「더 보기」가 없다", () => {
    const markup = renderToStaticMarkup(<UserMessage text={"한 줄\n".repeat(20)} />);
    expect(markup).not.toContain("더 보기");
    expect(markup).not.toContain("data-fold");
  });
});

describe("내 말의 묶음", () => {
  it("인용 · 첨부 칩 · 말풍선 · 끼어든 줄 · 말 머리가 오른쪽에 붙어 4 사이로 선다", () => {
    const markup = renderToStaticMarkup(
      <UserMessage
        text="이 시안대로 배너를 맞춰 줘"
        attachments={[{ path: "/w/overview.md", size: 120, folder: false }]}
        interjected
        at={new Date().toISOString()}
      />,
    );
    expect(markup).toMatch(/^<div data-user-message="true" class="group\/message flex flex-col items-end gap-1">/);
    const order = ['aria-label="첨부"', "이 시안대로 배너를 맞춰 줘", "하던 일을 멈추고 보냄", "data-message-meta"].map((piece) => markup.indexOf(piece));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("첨부는 Cards 「첨부와 함께」의 칩이다 — 28 · 둥근 10 · 옅은 면, 크기는 가리키면 보인다", () => {
    const markup = renderToStaticMarkup(<UserMessage text="봐 줘" attachments={[{ path: "/w/배너 시안.png", size: 2048, folder: false }]} />);
    const chip = /<li title="([^"]*)" class="([^"]*)">([\s\S]*?)<\/li>/.exec(markup);
    expect(chip?.[2].split(" ")).toEqual(expect.arrayContaining(["h-7", "rounded-lg", "bg-fill-soft", "text-xs", "text-fg-secondary"]));
    expect(chip?.[1]).toMatch(/^\/w\/배너 시안\.png · /);
    expect(chip?.[3].replace(/<[^>]*>/g, "")).toBe("배너 시안.png");
  });
});
