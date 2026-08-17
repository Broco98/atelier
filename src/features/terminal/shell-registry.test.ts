/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { markExited, markFailed, NO_SHELLS, openShell, removeShell } from "./shell-registry";
import type { ShellsState } from "./shell-registry";

// 셸 목록 seam. 순수 모듈 하나가 대상이라 렌더도 DOM도 없이 기본 환경(node)에서 돈다
// (work-sections.test.ts가 선례다). 관찰하는 것은 "어떤 조작을 하면 목록과 활성이 어떻게
// 되는가"뿐이다.
//
// 여기서 관찰하지 않는 것 — xterm 인스턴스가 언마운트를 넘겨 사는지(결정 20·21). 이 모듈에
// "화면 전환"이라는 조작이 없어 정의상 못 본다. 스펙이 그 항목을 seam에서 빼 실물 왕복
// 관찰로 옮겼다(spec.md의 Seam 1 아래 인용문).

// 셸을 n개 띄운 상태와 그 id들. 목록 조작을 보려면 늘 여럿이 필요하다.
function opened(count: number): { state: ShellsState; ids: number[] } {
  let state = NO_SHELLS;
  const ids: number[] = [];
  for (let n = 0; n < count; n += 1) {
    const next = openShell(state);
    state = next.state;
    ids.push(next.id);
  }
  return { state, ids };
}

const idsOf = (state: ShellsState) => state.shells.map((shell) => shell.id);
const statusOf = (state: ShellsState, id: number) =>
  state.shells.find((shell) => shell.id === id)?.status;

// 백엔드가 주는 종료 프레임 모양 그대로다(types.ts).
const EXIT_42 = { exitCode: 42, signal: null };

describe("셸을 띄운다", () => {
  it("목록이 하나 늘고 그 셸이 활성이 된다", () => {
    const { state, ids } = opened(1);
    expect(idsOf(state)).toEqual(ids);
    expect(state.activeId).toBe(ids[0]);
    expect(statusOf(state, ids[0])).toEqual({ kind: "running" });
  });

  it("뒤에 띄운 셸이 활성을 가져간다", () => {
    const { state, ids } = opened(3);
    expect(idsOf(state)).toEqual(ids);
    expect(state.activeId).toBe(ids[2]);
  });

  // 이 모듈이 id를 직접 발급하는 이유다. 셸을 다 지우고 다시 띄우면 예전 번호가 돌아오는데,
  // 그 사이에 떠 있던 spawn 응답이나 종료 프레임이 **새 셸의 칸에 꽂힌다.**
  it("지웠다 다시 띄워도 번호를 다시 쓰지 않는다", () => {
    const first = opened(1);
    const emptied = removeShell(first.state, first.ids[0]);
    const again = openShell(emptied);
    expect(again.id).not.toBe(first.ids[0]);
  });
});

// 결정 22·23. 이 터미널의 핵심 용도가 "claude가 조용히 죽었을 때 이유를 읽는 것"이라
// 끝난 셸이 목록에서 사라지면 읽을 자리가 없다.
describe("끝난 셸도 목록에 남는다", () => {
  it("종료 신호가 와도 칸이 남고 종료 코드를 갖는다", () => {
    const { state, ids } = opened(2);
    const after = markExited(state, ids[0], EXIT_42);
    expect(idsOf(after)).toEqual(ids);
    expect(statusOf(after, ids[0])).toEqual({ kind: "exited", exit: EXIT_42 });
  });

  it("띄우기에 실패해도 칸이 남고 이유를 갖는다", () => {
    const { state, ids } = opened(1);
    const after = markFailed(state, ids[0], "$SHELL을 실행할 수 없습니다: /nonexistent");
    expect(idsOf(after)).toEqual(ids);
    expect(statusOf(after, ids[0])).toEqual({
      kind: "failed",
      reason: "$SHELL을 실행할 수 없습니다: /nonexistent",
    });
  });

  it("끝난 셸이 활성이면 활성인 채로 남는다 — 화면이 그 마지막 상태를 계속 보여준다", () => {
    const { state, ids } = opened(2);
    expect(markExited(state, ids[1], EXIT_42).activeId).toBe(ids[1]);
  });
});

// 위의 "남는다"는 **빼는 조작과 대비해야만** 관찰된다. 대조군이 없으면 목록을 건드리는
// 코드가 아예 없어도 그 테스트들이 통과한다.
describe("목록에서 빼는 것은 제거뿐이다", () => {
  it("제거하면 그 칸이 목록에서 빠진다", () => {
    const { state, ids } = opened(3);
    expect(idsOf(removeShell(state, ids[1]))).toEqual([ids[0], ids[2]]);
  });

  it("끝난 셸도 제거로만 빠진다", () => {
    const { state, ids } = opened(2);
    const exited = markExited(state, ids[0], EXIT_42);
    expect(idsOf(removeShell(exited, ids[0]))).toEqual([ids[1]]);
  });

  it("활성이 아닌 칸을 빼도 활성은 그대로다", () => {
    const { state, ids } = opened(3);
    expect(removeShell(state, ids[0]).activeId).toBe(ids[2]);
  });

  it("모르는 id로는 아무것도 빠지지 않는다", () => {
    const { state } = opened(2);
    expect(removeShell(state, 9999)).toBe(state);
  });
});

// 판 02의 `×`가 이 규칙에 붙는다. 방향을 여기서 못박아 두면 그 티켓은 버튼만 잇는다.
describe("활성 칸을 제거하면 다음 활성이 정해진다", () => {
  it("오른쪽 이웃이 활성이 된다", () => {
    const { state, ids } = opened(3);
    const middle = { ...state, activeId: ids[1] };
    expect(removeShell(middle, ids[1]).activeId).toBe(ids[2]);
  });

  it("오른쪽이 없으면 왼쪽 이웃이 활성이 된다", () => {
    const { state, ids } = opened(3);
    expect(removeShell(state, ids[2]).activeId).toBe(ids[1]);
  });

  it("마지막 하나를 제거하면 활성이 없다", () => {
    const { state, ids } = opened(1);
    const after = removeShell(state, ids[0]);
    expect(after.shells).toEqual([]);
    expect(after.activeId).toBeNull();
  });
});

// 이 모듈이 DOM 없는 기본 환경에서 도는 것은 import 목록이 지키는 성질이다. 깨져도
// 조용하다 — react는 node에서 그냥 import되고, 그때부터 이 seam은 "순수 모듈"이 아니다.
// theme-tokens.test.ts와 같은 방식으로 소스를 읽어 못박는다.
it("react·tauri·xterm을 import하지 않는다", () => {
  const source = readFileSync(fileURLToPath(new URL("./shell-registry.ts", import.meta.url)), "utf8");
  // **`from`만 보면 안 된다.** 이 금지를 실제로 깨뜨릴 가장 그럴듯한 한 줄이
  // `import "@xterm/xterm/css/xterm.css";`인데 그 줄에는 `from`이 없다 — `from`만 훑는
  // 검사는 그것이 들어와도 초록이었다(실측으로 확인하고 고쳤다).
  const imported = [...source.matchAll(/from\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm)].map(
    (found) => found[1] ?? found[2],
  );
  expect(imported.filter((one) => /^(react|@tauri-apps\/|@xterm\/)/.test(one))).toEqual([]);
});
