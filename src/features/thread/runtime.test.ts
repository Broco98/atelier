import { describe, expect, it } from "vitest";
import { runtimeNameOf } from "./runtime";

// 화면이 Runtime을 부르는 이름 — 흐름과 카드의 말이 이 하나로 선다.
describe("Runtime 이름", () => {
  const seated = (runtime: string) => ({ handle: "host", from: null, joinedAt: "", runtime, sessionId: null, cwd: null, additionalDirectories: [], model: null, effort: null });

  it("Runtime 값이 `claude-code`면 Claude Code다", () => {
    expect(runtimeNameOf({ participants: [seated("claude-code")] })).toBe("Claude Code");
  });

  it("세션이 서기 전 채팅도 기본 Runtime 이름으로 말한다", () => {
    expect(runtimeNameOf({ participants: [] })).toBe("Claude Code");
  });

  it("표에 없는 값은 글자 그대로 보인다", () => {
    expect(runtimeNameOf({ participants: [seated("gemini-cli")] })).toBe("gemini-cli");
  });
});
