import { describe, expect, it, vi } from "vitest";
import { terminalApi } from "./api";
import { topTerminal } from "./shell-registry";

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(undefined);
  },
  // `Channel`은 실물이 필요 없다 — spawn이 그것을 그대로 넘기기만 한다.
  Channel: class {},
}));

describe("셸을 띄우는 IPC", () => {
  it("`pty_spawn`이 origin의 cwd를 싣는다", async () => {
    calls.length = 0;
    const origin = topTerminal();
    await terminalApi.spawn(origin.cwd, 80, 24, null as never);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("pty_spawn");
    // 최상위는 cwd가 없다 — 홈이 어디인지는 백엔드만 안다(결정 25).
    expect(calls[0].args.cwd).toBeNull();
  });

  // **인자 객체가 평평해야 한다.** `tauri-commands.test.ts`의 인자 대조가 중첩 `{}`를
  // 만나면 그 호출을 통째로 못 보고 넘어간다 — 그러면 이름이 어긋나도 초록이다.
  // 여기서는 그 대조가 보는 것과 같은 것을 값으로 확인한다: 최상위 키 넷이 그대로 선다.
  it("인자가 평평하다 — 중첩 객체로 접지 않는다", async () => {
    calls.length = 0;
    const origin = topTerminal();
    await terminalApi.spawn(origin.cwd, 80, 24, null as never);
    expect(Object.keys(calls[0].args).sort()).toEqual(["cols", "cwd", "onFrame", "rows"]);
  });

  // 닫기는 까닭과 셸의 주인을 싣는다(티켓 11) — 백엔드가 그 닫기가 끝낸 것을 정리 기록에 적는다. 주인은 work의 slug이고
  // 최상위 터미널이면 빈 글자다(ui-refresh 결정 23) — 빈 글자도 그대로 나간다(「주인 없음」은 `null`이다). 이름은
  // `commands.rs`의 인자와 `tauri-commands.test.ts`가 대조하고, 여기서는 값이 그대로 나가는지를 본다.
  it("닫기가 까닭과 주인을 평평하게 싣는다", async () => {
    calls.length = 0;
    await terminalApi.kill(3, "archive", "spec-search");
    await terminalApi.kill(4, "shellClose", "");
    expect(calls).toEqual([
      { name: "pty_kill", args: { id: 3, reason: "archive", owner: "spec-search" } },
      { name: "pty_kill", args: { id: 4, reason: "shellClose", owner: "" } },
    ]);
  });

  // 화면 밖 셸(티켓 32 · 프로세스 스펙 S42)은 스토어에 칸이 없어 주인을 모른다 — 지어내지 않고 `null`로 싣는다. 백엔드는 그
  // 사건을 주인 없이 적는다(티켓 11의 「owner는 없다」).
  it("주인을 모르는 닫기는 주인 칸을 `null`로 싣는다", async () => {
    calls.length = 0;
    await terminalApi.kill(7, "shellClose", null);
    expect(calls).toEqual([{ name: "pty_kill", args: { id: 7, reason: "shellClose", owner: null } }]);
  });

});
