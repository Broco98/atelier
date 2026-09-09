import { describe, expect, it, vi } from "vitest";
import { terminalApi } from "./api";
import { topTerminal, workShellOrigin } from "./shell-registry";
import type { WorkView } from "@/features/works/types";

// **셸이 뜨는 순간 세계가 백엔드로 나간다**(결정 10). `pty_spawn`의 `mode`가 정하는 것은
// 둘이다 — cwd가 `null`일 때의 홈(`resolve_cwd`)과 셸 env의 `ATELIER_MODE`(`shell_builder`).
//
// **빠뜨려도 오류가 아니다.** 백엔드에서 `mode`는 선택 인자이고 `or_atelier`가 없으면
// Atelier로 답하므로, 안 실으면 Maison 터미널이 **조용히 Atelier 홈에서** 뜬다. L3도
// 잡지 못한다: 하네스의 고정 데이터가 이름으로 답해서 인자를 안 본다. 실물에서만 보이는
// 실패라 이 자리에 그물을 건다(`features/works/api.test.ts`가 같은 이유로 있다).
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(undefined);
  },
  // `Channel`은 실물이 필요 없다 — spawn이 그것을 그대로 넘기기만 한다.
  Channel: class {},
}));

// 워크트리 하나짜리 Work. `workShellOrigin`이 갈래를 안 타는 가장 짧은 모양이다.
const work = (slug: string): WorkView =>
  ({
    slug,
    specDir: `~/.atelier/works/${slug}/spec`,
    worktrees: [{ project: "atelier", path: `~/.atelier/works/${slug}/trees/atelier` }],
  }) as unknown as WorkView;

describe("셸을 띄울 때 세계가 함께 나간다", () => {
  it("`pty_spawn`이 origin의 `mode`를 그대로 싣는다", async () => {
    for (const mode of ["atelier", "maison"] as const) {
      calls.length = 0;
      const origin = topTerminal(mode);
      await terminalApi.spawn(origin.mode, origin.cwd, 80, 24, null as never);

      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe("pty_spawn");
      expect(calls[0].args.mode, mode).toBe(mode);
      // 최상위는 cwd가 없다 — 그 세계의 홈이 어디인지는 백엔드만 안다(결정 25).
      expect(calls[0].args.cwd).toBeNull();
    }
  });

  it("Work의 셸도 그 Work를 읽은 세계로 뜬다", async () => {
    calls.length = 0;
    const origin = workShellOrigin("maison", work("finance"), null)!;
    await terminalApi.spawn(origin.mode, origin.cwd, 80, 24, null as never);
    expect(calls[0].args.mode).toBe("maison");
    expect(calls[0].args.cwd).toBe("~/.atelier/works/finance/trees/atelier");
  });

  // **인자 객체가 평평해야 한다.** `tauri-commands.test.ts`의 인자 대조가 중첩 `{}`를
  // 만나면 그 호출을 통째로 못 보고 넘어간다 — 그러면 이름이 어긋나도 초록이다.
  // 여기서는 그 대조가 보는 것과 같은 것을 값으로 확인한다: 최상위 키 넷이 전부 원시값이다.
  it("인자가 평평하다 — 중첩 객체로 접지 않는다", async () => {
    calls.length = 0;
    const origin = topTerminal("maison");
    await terminalApi.spawn(origin.mode, origin.cwd, 80, 24, null as never);
    expect(Object.keys(calls[0].args).sort()).toEqual(["cols", "cwd", "mode", "onFrame", "rows"]);
  });

  // 나머지 넷은 이미 뜬 셸을 id로 가리킨다 — 그 셸의 세계는 뜰 때 pty에 굳는다(결정 10).
  // 여기에 `mode`가 붙으면 「id와 모드가 어긋나면 어느 쪽이 이기나」라는 답 없는 갈래가
  // 생기고, `commands.rs`가 같은 이유를 같은 말로 적어 두었다.
  it("id로 가리키는 명령 넷에는 세계가 안 붙는다", async () => {
    calls.length = 0;
    await terminalApi.write(1, "x");
    await terminalApi.resize(1, 80, 24);
    await terminalApi.kill(1);
    await terminalApi.commandRunning(1);
    expect(calls).toHaveLength(4);
    expect(calls.filter((call) => "mode" in call.args)).toEqual([]);
  });
});
