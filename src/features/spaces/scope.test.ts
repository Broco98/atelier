import { describe, expect, it } from "vitest";
import { readingList, readingText, registeredText } from "./scope";

// 범위 글(03 구현 스펙 §5 · §9 · 03 코드 리뷰 D4) — 범위 줄 · Space 줄 · Space 질문 카드가 읽는 Project를 말하는 글은 이 셋 하나에서 나온다. seam은
// 순수 함수 셋이다. 그 글을 쓰는 자리마다의 갈래(빈 Space · 되돌림 · 경고 색)는 `space-chip.test.ts` · `fold.test.ts`가 잰다.
describe("범위 글", () => {
  it("읽는 Project는 이름을 「 · 」로 잇고 끝소리로 조사를 고른다 — 셋을 넘으면 둘과 「외 N개」다", () => {
    expect(readingText(["web-app", "api-server"])).toBe("web-app · api-server를 읽어요");
    expect(readingText(["api-server", "web-app"])).toBe("api-server · web-app을 읽어요");
    expect(readingText(["a", "b", "c", "d"])).toBe("a · b 외 2개를 읽어요");
    expect(readingList(["a", "b", "c"])).toBe("a · b · c");
  });

  it("되돌린 Space는 「다시 …를 읽어요」, 읽을 것이 없으면 「읽는 Project가 없어요」다 — 되돌려도 없으면 「다시」가 없다", () => {
    expect(readingText(["web-app"], { again: true })).toBe("다시 web-app을 읽어요");
    expect(readingText([])).toBe("읽는 Project가 없어요");
    expect(readingText([], { again: true })).toBe("읽는 Project가 없어요");
  });

  it("Space 없이는 등록된 Project 수를 말하고 — 카드의 「Space 없이」 줄은 「모두」를 단다 — 하나도 없으면 그렇다고 말한다", () => {
    expect(registeredText(3)).toBe("등록된 Project 3개를 읽어요");
    expect(registeredText(3, { all: true })).toBe("등록된 Project 3개를 모두 읽어요");
    expect(registeredText(0)).toBe("등록된 Project가 없어요");
    expect(registeredText(0, { all: true })).toBe("등록된 Project가 없어요");
  });
});
