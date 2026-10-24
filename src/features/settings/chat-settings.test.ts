import { describe, expect, it } from "vitest";
import { chooseDefaultAgent, chooseEngineDefault, defaultAgentOf, engineChoice } from "./chat-settings";
import type { ChatSettings } from "./types";

// 설정 「대화」 구획의 규칙(three-axes 티켓 25 · 결정 16). 화면(`SettingsPage.tsx`)과 `+`(`ChatPane.tsx`)가 같은 규칙을 딛는다.
// 「엔진 기본값」은 **키가 없는 것**이고, 손으로 적은 모르는 키는 저장 한 번에 사라지지 않는다.

/** 손으로 적은 구획 — 타입 밖의 값도 올 수 있다. */
const hand = (chat: unknown) => chat as ChatSettings;

describe("기본 에이전트", () => {
  it("고르지 않았으면 처음 값 Claude Code다", () => {
    expect(defaultAgentOf(undefined)).toBe("claude");
    expect(defaultAgentOf({})).toBe("claude");
  });

  it("고른 에이전트를 읽는다", () => {
    expect(defaultAgentOf(hand({ defaultAgent: "codex" }))).toBe("codex");
    expect(defaultAgentOf(hand({ defaultAgent: "claude" }))).toBe("claude");
  });

  // 손으로 고친 파일이다 — 모르는 이름 하나가 `+`를 막지 않는다.
  it("모르는 값이면 처음 값이다", () => {
    expect(defaultAgentOf(hand({ defaultAgent: "gemini" }))).toBe("claude");
    expect(defaultAgentOf(hand({ defaultAgent: 3 }))).toBe("claude");
  });

  it("고르면 구획의 다른 칸과 모르는 키는 그대로다", () => {
    const chat = { codex: { model: "gpt-6-astra", effort: "high" }, rolePresets: [] } as ChatSettings;
    expect(chooseDefaultAgent(chat, "codex")).toEqual({
      codex: { model: "gpt-6-astra", effort: "high" },
      rolePresets: [],
      defaultAgent: "codex",
    });
    expect(chooseDefaultAgent(undefined, "claude")).toEqual({ defaultAgent: "claude" });
  });
});

describe("엔진별 기본 모델 · 시작 모드", () => {
  it("고르지 않았으면 엔진 기본값(null)이다", () => {
    expect(engineChoice(undefined, "claude", "model")).toBeNull();
    expect(engineChoice({ codex: { mode: "read-only" } }, "codex", "model")).toBeNull();
    expect(engineChoice({ codex: { mode: "read-only" } }, "codex", "mode")).toBe("read-only");
  });

  it("고르면 그 엔진의 칸에 적히고 다른 엔진 · 모르는 키는 그대로다", () => {
    const chat = { defaultAgent: "codex", claude: { mode: "plan", effort: "high" }, rolePresets: [] } as ChatSettings;
    expect(chooseEngineDefault(chat, "claude", "model", "sonnet")).toEqual({
      defaultAgent: "codex",
      claude: { mode: "plan", effort: "high", model: "sonnet" },
      rolePresets: [],
    });
    expect(chooseEngineDefault(chat, "codex", "mode", "workspace-write")).toEqual({
      defaultAgent: "codex",
      claude: { mode: "plan", effort: "high" },
      rolePresets: [],
      codex: { mode: "workspace-write" },
    });
  });

  // 「엔진 기본값」은 값을 비워 둔 것이다 — `null` 줄이 아니라 키째 없다. 그래야 호스트가 플래그도 `set_*`도 주지 않는다.
  it("엔진 기본값을 고르면 키째 빠지고, 빈 엔진 칸과 빈 구획도 빠진다", () => {
    const chat: ChatSettings = { codex: { model: "gpt-6-astra", mode: "read-only" } };
    const once = chooseEngineDefault(chat, "codex", "model", null);
    expect(once).toEqual({ codex: { mode: "read-only" } });
    expect(chooseEngineDefault(once, "codex", "mode", null)).toBeUndefined();
    expect(chooseEngineDefault({ defaultAgent: "codex", codex: { model: "x" } }, "codex", "model", null)).toEqual({
      defaultAgent: "codex",
    });
  });

  it("모르는 키가 남은 엔진 칸은 빠지지 않는다", () => {
    const chat = { claude: { model: "sonnet", effort: "high" } } as ChatSettings;
    expect(chooseEngineDefault(chat, "claude", "model", null)).toEqual({ claude: { effort: "high" } });
  });

  it("고친 것은 새 객체다 — 읽은 사본을 제자리에서 바꾸지 않는다", () => {
    const chat: ChatSettings = { claude: { model: "sonnet" } };
    chooseEngineDefault(chat, "claude", "model", "opus");
    chooseDefaultAgent(chat, "codex");
    expect(chat).toEqual({ claude: { model: "sonnet" } });
  });
});
