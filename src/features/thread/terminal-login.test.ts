import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownerOf, topTerminal } from "@/features/terminal/shell-registry";

// restart 01c-10 · 스펙 「01c — Codex」 로그인 — 「터미널에서 로그인」은 Host가 준 그 Runtime의 로그인 명령을 시작 명령으로 실어 Terminal에 새
// 셸을 열고 그 셸로 간다. 셸 상한이면 지금의 셸 상한 안내가 선다. 경계는 둘이다 — 엔진(앱 명령 `invoke`)과 터미널 스토어(셸을 여는 길 —
// 그 길 자체는 `terminal-store.test.ts`가 잰다).

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ showToast }));
const openShellRunning = vi.hoisted(() => vi.fn());
vi.mock("@/features/terminal/terminal-store", () => ({ openShellRunning }));

import { loginInTerminal } from "./terminal-login";

beforeEach(() => {
  invoke.mockReset();
  showToast.mockReset();
  openShellRunning.mockReset();
});

describe("터미널에서 로그인", () => {
  it("Host가 준 그 Runtime의 로그인 명령이 도는 셸을 Terminal에 열고 그 셸로 간다", async () => {
    invoke.mockResolvedValueOnce("/opt/bin/codex login");
    openShellRunning.mockReturnValueOnce({ id: 7 });
    const go = vi.fn();

    await loginInTerminal("codex", go);

    expect(invoke).toHaveBeenCalledWith("thread_login_command", { runtime: "codex" });
    expect(openShellRunning).toHaveBeenCalledWith(topTerminal(), "/opt/bin/codex login");
    expect(go).toHaveBeenCalledWith({ id: 7, owner: ownerOf() });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("셸 상한이면 셸로 가지 않고 지금의 셸 상한 안내를 토스트로 보인다", async () => {
    invoke.mockResolvedValueOnce("claude auth login");
    openShellRunning.mockReturnValueOnce({ notice: "셸은 화면마다 8개까지예요 — 여기 8개" });
    const go = vi.fn();

    await loginInTerminal("claude-code", go);

    expect(invoke).toHaveBeenCalledWith("thread_login_command", { runtime: "claude-code" });
    expect(showToast).toHaveBeenCalledWith("셸은 화면마다 8개까지예요 — 여기 8개", "rejected");
    expect(go).not.toHaveBeenCalled();
  });

  it("Host가 명령을 주지 못하면 셸을 열지 않고 그 글로 거절된다 — 카드가 까닭으로 보인다", async () => {
    invoke.mockRejectedValueOnce("Codex를 띄우는 데 드는 것을 찾지 못했습니다: codex");
    const go = vi.fn();

    await expect(loginInTerminal("codex", go)).rejects.toBe("Codex를 띄우는 데 드는 것을 찾지 못했습니다: codex");
    expect(openShellRunning).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });
});
