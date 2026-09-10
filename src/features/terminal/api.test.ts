import { describe, expect, it, vi } from "vitest";
import { terminalApi } from "./api";
import { topTerminal, workShellOrigin } from "./shell-registry";
import type { WorkView } from "@/features/works/types";

// **셸이 뜨는 순간 세계가 백엔드로 나간다**(결정 10). `pty_spawn`의 `mode`가 정하는 것은
// 둘이다 — cwd가 `null`일 때의 홈(`resolve_cwd`)과 셸 env의 `ATELIER_MODE`(`shell_builder`).
//
// **빠뜨리면 이제 오류다**(#187) — 백엔드가 `mode`를 필수로 받는다. 그래도 그물은 여기
// 그대로 둔다: 백엔드의 거절은 셸을 띄우려고 버튼을 누른 뒤에야 보이고, 이 자리는 그 전에
// 「인자에 실렸나」를 값으로 잰다. **틀린 값을 실은 갈래는 백엔드도 못 잡는다** —
// `Mode::Atelier`가 실려도 그것은 멀쩡한 인자라, Maison 터미널이 Atelier 홈에서 뜨는
// 것으로만 나타난다(`features/works/api.test.ts`가 같은 이유로 있다).
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(undefined);
  },
  // `Channel`은 실물이 필요 없다 — spawn이 그것을 그대로 넘기기만 한다.
  Channel: class {},
}));

// 워크트리 하나짜리 Work. **뿌리를 받는다** — Maison에서는 `workShellOrigin`이 워크트리를
// 아예 안 보고 Work 폴더로 떨어지므로(`shellTrees`), 뿌리가 저쪽 세계의 것이면 이 파일이
// 재는 cwd가 「Maison 셸이 Atelier 폴더에서 떴다」를 기대값으로 못박게 된다.
const work = (slug: string, root = "~/.atelier/works"): WorkView =>
  ({
    slug,
    specDir: `${root}/${slug}/spec`,
    worktrees: [{ project: "atelier", path: `${root}/${slug}/trees/atelier` }],
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
    const origin = workShellOrigin("maison", work("finance", "~/.atelier/maison/rooms"), null)!;
    await terminalApi.spawn(origin.mode, origin.cwd, 80, 24, null as never);
    expect(calls[0].args.mode).toBe("maison");
    // Room 폴더다 — 실려 온 워크트리가 아니다(결정 17: 저 세계에는 그것이 없다).
    expect(calls[0].args.cwd).toBe("~/.atelier/maison/rooms/finance");
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

  // 타입이 `mode`를 막는 것도 works 쪽과 같은 계약이고, 두 모양이 각각 어느 변형을 무는지도
  // 거기 적혀 있다(`works/api.test.ts`). **`spawn` 하나만 본다** — 나머지 넷은 모드를 안 받는
  // 것이 계약이라(결정 10) 위 검사가 반대쪽을 든다.
  it("mode 없이는 spawn할 수 없다 — 타입이 막는다", () => {
    const withoutMode = () => [
      // @ts-expect-error `mode` 인자가 통째로 사라지면 이 줄이 합법이 된다
      terminalApi.spawn(null, 80, 24, null as never),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      terminalApi.spawn(undefined, null, 80, 24, null as never),
    ];
    expect(withoutMode).toBeInstanceOf(Function);
  });
});
