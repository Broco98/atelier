import { describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME, RUNTIMES, runtimeNameOf } from "./runtime";

// 화면이 Runtime을 부르는 이름 — 흐름과 카드의 말이 이 하나로 선다.
describe("Runtime 이름", () => {
  it("Runtime 값이 `claude-code`면 Claude Code다", () => {
    expect(runtimeNameOf({ runtime: "claude-code" })).toBe("Claude Code");
  });

  it("Runtime 값이 `codex`면 Codex다", () => {
    expect(runtimeNameOf({ runtime: "codex" })).toBe("Codex");
  });

  it("새 채팅의 Runtime 메뉴는 Claude Code와 Codex 둘이고 Claude Code가 기본이다", () => {
    expect(RUNTIMES.map((one) => [one.value, one.name])).toEqual([
      ["claude-code", "Claude Code"],
      ["codex", "Codex"],
    ]);
    expect(DEFAULT_RUNTIME).toBe("claude-code");
  });

  it("표에 없는 값은 글자 그대로 보인다", () => {
    expect(runtimeNameOf({ runtime: "gemini-cli" })).toBe("gemini-cli");
  });
});
