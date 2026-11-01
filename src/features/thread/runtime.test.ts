import { describe, expect, it } from "vitest";
import { runtimeNameOf } from "./runtime";

// 화면이 Runtime을 부르는 이름 — 흐름과 카드의 말이 이 하나로 선다.
describe("Runtime 이름", () => {
  it("Runtime 값이 `claude-code`면 Claude Code다", () => {
    expect(runtimeNameOf({ runtime: "claude-code" })).toBe("Claude Code");
  });

  it("표에 없는 값은 글자 그대로 보인다", () => {
    expect(runtimeNameOf({ runtime: "gemini-cli" })).toBe("gemini-cli");
  });
});
