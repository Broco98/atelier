import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineCheck } from "./types";

// restart 01c-9 · 스토리 37 · 38 · 40 — Runtime 상태는 Runtime마다 따로 산다. 그래야 Codex의 로그인 끊김이 Claude 채팅에 카드를 세우지 않는다.
// 엔진은 앱 명령(`invoke`)으로만 닿으므로 그 경계만 갈아 끼우고, 스토어는 시험마다 새로 읽는다(모듈 상태다).

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const store = () => import("./engine-store");

const CODEX_MISSING: EngineCheck = {
  state: "missing",
  missing: [{ name: "codex-acp", install: "npm i -g @agentclientprotocol/codex-acp" }],
};
const CLAUDE_READY: EngineCheck = { state: "found", programs: [{ name: "claude", path: "/bin/claude" }], loggedIn: true };

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
});

describe("Runtime마다의 상태", () => {
  it("Codex의 로그인 끊김은 Codex 카드만 세운다 — Claude는 그대로다", async () => {
    const { applyEngineEvent, engineOf, guideKind, threadEngineStore } = await store();
    applyEngineEvent({ agent: "codex", found: true, loggedIn: false, login: null, missing: [] });
    const state = threadEngineStore.state;
    expect(guideKind(engineOf(state, "codex"), false)).toBe("logged-out");
    expect(guideKind(engineOf(state, "claude-code"), false)).toBeNull();
  });

  it("확인은 그 Runtime만 묻고 답을 그 Runtime에만 앉힌다 — 도는 동안은 확인 중이다", async () => {
    const { checkEngine, engineOf, guideKind, threadEngineStore } = await store();
    let answer: (check: EngineCheck) => void = () => {};
    invoke.mockReturnValueOnce(new Promise<EngineCheck>((resolve) => (answer = resolve)));

    const checking = checkEngine("codex", false);
    expect(invoke).toHaveBeenCalledWith("thread_check_engine", { runtime: "codex", reread: false });
    expect(engineOf(threadEngineStore.state, "codex").checking).toBe(true);
    expect(engineOf(threadEngineStore.state, "claude-code").checking).toBe(false);

    answer(CODEX_MISSING);
    await checking;
    const codex = engineOf(threadEngineStore.state, "codex");
    expect(codex.checking).toBe(false);
    expect(guideKind(codex, false)).toBe("missing");
    expect(codex.missing.map((one) => one.name)).toEqual(["codex-acp"]);
    expect(guideKind(engineOf(threadEngineStore.state, "claude-code"), false)).toBeNull();
  });

  it("「앱에서 한 번」은 Runtime마다다 — Codex를 처음 고르면 Claude를 확인한 뒤에도 묻는다", async () => {
    const { checkEngineOnce } = await store();
    invoke.mockResolvedValue(CLAUDE_READY);
    checkEngineOnce("claude-code");
    checkEngineOnce("claude-code");
    checkEngineOnce("codex");
    checkEngineOnce("codex");
    expect(invoke.mock.calls).toEqual([
      ["thread_check_engine", { runtime: "claude-code", reread: false }],
      ["thread_check_engine", { runtime: "codex", reread: false }],
    ]);
  });
});
