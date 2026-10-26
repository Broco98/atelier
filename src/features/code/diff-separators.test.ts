import { describe, expect, it } from "vitest";
import { separatorText } from "./diff-separators";

// 넓힌 카드 diff의 접힌 줄 글(v1 티켓 46 · 캔버스 Layout-Expand 보드 「변경 없는 34줄」) — 라이브러리의 영어 글자를 무엇으로 옮기나.

describe("접힌 줄 글", () => {
  it("줄 수는 「변경 없는 N줄」이다 — 하나여도 같다", () => {
    expect(separatorText("32 unmodified lines")).toBe("변경 없는 32줄");
    expect(separatorText("1 unmodified line")).toBe("변경 없는 1줄");
  });

  it("수를 모르는 끝 자리와 「모두 펼치기」도 옮긴다", () => {
    expect(separatorText("More unchanged context may be available")).toBe("변경 없는 줄 더 보기");
    expect(separatorText("Expand all")).toBe("모두 펼치기");
  });

  it("옮긴 글 · 모르는 글은 손대지 않는다", () => {
    expect(separatorText("변경 없는 32줄")).toBeNull();
    expect(separatorText("@@ -1,3 +1,3 @@")).toBeNull();
  });
});
