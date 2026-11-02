import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineCheck } from "./types";

// restart 01c-9 · 스토리 37 · 38 · 40 — 입력창 자리의 안내 카드. 스펙 「01c — Codex」의 단추 표대로 선다. 엔진은 앱 명령(`invoke`)으로만
// 닿으므로 그 경계만 갈아 끼우고, 스토어는 시험마다 새로 읽는다.

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ showToast }));

const CODEX_MISSING: EngineCheck = {
  state: "missing",
  missing: [{ name: "codex-acp", install: "npm i -g @agentclientprotocol/codex-acp" }],
};
const CODEX_READY: EngineCheck = { state: "found", programs: [{ name: "codex-acp", path: "/bin/codex-acp" }], loggedIn: true };

async function setUp() {
  const engines = await import("./engine-store");
  const { default: GuideCard } = await import("./GuideCard");
  const draw = (runtime: "claude-code" | "codex", options: { switchable?: boolean; awaiting?: boolean } = {}) => {
    const view = engines.engineOf(engines.threadEngineStore.state, runtime);
    const kind = engines.guideKind(view, options.awaiting ?? false);
    if (kind === null) return null;
    return renderToStaticMarkup(
      <GuideCard runtime={runtime} kind={kind} view={view} onSwitch={options.switchable ? () => {} : undefined} />,
    );
  };
  return { ...engines, draw };
}

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  showToast.mockReset();
});

describe("설치 안내", () => {
  const clipboard = (writeText: (text: string) => Promise<void>) =>
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(writeText) } });

  it("설치 명령을 복사하고 토스트로 알린다", async () => {
    clipboard(() => Promise.resolve());
    const { copyWithToast } = await import("./GuideCard");
    await copyWithToast("npm i -g @agentclientprotocol/codex-acp", "설치 명령을 복사했어요");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("npm i -g @agentclientprotocol/codex-acp");
    expect(showToast).toHaveBeenCalledWith("설치 명령을 복사했어요");
    vi.unstubAllGlobals();
  });

  it("복사가 거절되면 거절 토스트다", async () => {
    clipboard(() => Promise.reject(new Error("denied")));
    const { copyWithToast } = await import("./GuideCard");
    await copyWithToast("brew install node", "설치 명령을 복사했어요");
    expect(showToast).toHaveBeenCalledWith("복사하지 못했어요", "rejected");
    vi.unstubAllGlobals();
  });
});

describe("Runtime 없음 카드", () => {
  it("빠진 것과 설치 명령을 보이고 「다시 찾기」 · 「설치 안내」가 선다 — 바꾸기는 첫 말 전에만이다", async () => {
    const { checkEngine, draw } = await setUp();
    invoke.mockResolvedValueOnce(CODEX_MISSING);
    await checkEngine("codex", false);

    const before = draw("codex", { switchable: true });
    expect(before).toContain("codex-acp를 찾지 못했어요");
    expect(before).toContain("npm i -g @agentclientprotocol/codex-acp");
    expect(before).toContain(">다시 찾기<");
    expect(before).toContain(">설치 안내<");
    expect(before).toContain(">Claude Code로 바꾸기<");
    expect(draw("codex")).not.toContain("바꾸기");
  });

  it("다시 찾아 찾으면 카드가 걷힌다 — 로그인 env를 새로 읽는다", async () => {
    const { checkEngine, draw, recheckEngine } = await setUp();
    invoke.mockResolvedValueOnce(CODEX_MISSING).mockResolvedValueOnce(CODEX_READY);
    await checkEngine("codex", false);
    await recheckEngine("codex");
    expect(invoke).toHaveBeenLastCalledWith("thread_check_engine", { runtime: "codex", reread: true });
    expect(draw("codex")).toBeNull();
  });

  it("다시 찾아도 없으면 카드가 남고 까닭이 바뀐다", async () => {
    const { checkEngine, draw, recheckEngine } = await setUp();
    invoke.mockResolvedValueOnce(CODEX_MISSING).mockResolvedValueOnce(CODEX_MISSING);
    await checkEngine("codex", false);
    const before = draw("codex");
    await recheckEngine("codex");
    const after = draw("codex");
    expect(after).toContain("codex-acp를 찾지 못했어요");
    expect(after).not.toBe(before);
    expect(after).toContain("다시 찾아봤지만");
  });

  it("다시 찾기가 거절되면 그 글이 까닭이 된다", async () => {
    const { checkEngine, draw, recheckEngine } = await setUp();
    invoke.mockResolvedValueOnce(CODEX_MISSING).mockRejectedValueOnce("로그인 셸이 10초 안에 끝나지 않았습니다");
    await checkEngine("codex", false);
    await recheckEngine("codex");
    expect(draw("codex")).toContain("로그인 셸이 10초 안에 끝나지 않았습니다");
  });
});
