import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineCheck } from "./types";

// restart 01c-9 · 스토리 37 · 38 · 40 — 입력창 자리의 안내 카드. 스펙 「01c — Codex」의 단추 표대로 선다. 엔진은 앱 명령(`invoke`)으로만
// 닿으므로 그 경계만 갈아 끼우고, 스토어는 시험마다 새로 읽는다.

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ showToast }));
// 카드는 라우터 없이 그린다 — 「터미널에서 로그인」이 셸로 가는 길(`useGoToShell`)이 라우터를 쥘 뿐이다.
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ state: { location: { pathname: "/" } } }),
}));

const CODEX_MISSING: EngineCheck = {
  state: "missing",
  missing: [{ name: "codex-acp", install: "npm i -g @agentclientprotocol/codex-acp" }],
};
const CODEX_READY: EngineCheck = { state: "found", programs: [{ name: "codex-acp", path: "/bin/codex-acp" }], loggedIn: true };
const CODEX_LOGGED_OUT: EngineCheck = { state: "found", programs: [{ name: "codex-acp", path: "/bin/codex-acp" }], loggedIn: false };

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("설치 안내", () => {
  // 카드를 들인 뒤에 클립보드를 갈아 끼운다 — 카드의 모듈 사슬(터미널 스토어 → xterm)이 들일 때 `navigator`를 읽는다.
  const clipboard = (writeText: (text: string) => Promise<void>) =>
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(writeText) } });

  it("설치 명령을 복사하고 토스트로 알린다", async () => {
    const { copyWithToast } = await import("./GuideCard");
    clipboard(() => Promise.resolve());
    await copyWithToast("npm i -g @agentclientprotocol/codex-acp", "설치 명령을 복사했어요");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("npm i -g @agentclientprotocol/codex-acp");
    expect(showToast).toHaveBeenCalledWith("설치 명령을 복사했어요");
  });

  it("복사가 거절되면 거절 토스트다", async () => {
    const { copyWithToast } = await import("./GuideCard");
    clipboard(() => Promise.reject(new Error("denied")));
    await copyWithToast("brew install node", "설치 명령을 복사했어요");
    expect(showToast).toHaveBeenCalledWith("복사하지 못했어요", "rejected");
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

describe("로그인 안 됨 카드", () => {
  // restart 01c-10 · 스펙 「01c — Codex」 로그인 — 앱 안 로그인을 터미널 로그인 하나로 바꿨다. 단추는 시안(Thread 보드 로그인 카드)의 차례대로
  // 「다시 확인」 · 「터미널에서 로그인」(주)이다. 단추의 동작은 `terminal-login.test.ts`가 잰다.
  it("「다시 확인」과 「터미널에서 로그인」이 서고 앱 안 로그인 단추는 없다", async () => {
    const { checkEngine, draw } = await setUp();
    invoke.mockResolvedValueOnce(CODEX_LOGGED_OUT);
    await checkEngine("codex", false);

    const html = draw("codex")!;
    expect(html).toContain("Codex에 로그인이 안 돼 있어요");
    expect(html).toContain(">다시 확인<");
    expect(html).toContain(">터미널에서 로그인<");
    expect(html.indexOf(">다시 확인<")).toBeLessThan(html.indexOf(">터미널에서 로그인<"));
    expect(html).not.toMatch(/>로그인</);
    expect(html).not.toContain("명령 복사");
    expect(html).not.toContain("링크 복사");
    expect(html).not.toContain(">취소<");
    expect(html).toContain("터미널에서 로그인을 마치고");
  });

  it("터미널에서 로그인한 뒤 다시 확인하면 카드가 걷히고, 아직이면 카드가 남고 까닭이 바뀐다", async () => {
    const { checkEngine, draw, recheckEngine } = await setUp();
    invoke.mockResolvedValueOnce(CODEX_LOGGED_OUT).mockResolvedValueOnce(CODEX_LOGGED_OUT).mockResolvedValueOnce(CODEX_READY);
    await checkEngine("codex", false);

    await recheckEngine("codex");
    expect(invoke).toHaveBeenLastCalledWith("thread_check_engine", { runtime: "codex", reread: true });
    const still = draw("codex")!;
    expect(still).toContain("다시 확인했지만 아직 로그인되지 않았어요");
    expect(still).toContain(">터미널에서 로그인<");

    await recheckEngine("codex");
    expect(draw("codex")).toBeNull();
  });
});
