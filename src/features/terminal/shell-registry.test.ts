/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  activateShell,
  activeIdOf,
  atCap,
  markExited,
  markFailed,
  MAX_SHELLS,
  NO_SHELLS,
  openShell,
  removeShell,
  runningShellsOf,
  setShellName,
  setTitle,
  shellEndLabels,
  shellLabel,
  shellsOf,
  shellHotkey,
  TOP_TERMINAL,
  workShellOrigin,
} from "./shell-registry";
import type { Shell, ShellsState } from "./shell-registry";
import type { WorkView, WorktreeView } from "@/features/works/types";

// 셸 목록 seam. 순수 모듈 하나가 대상이라 렌더도 DOM도 없이 기본 환경(node)에서 돈다
// (work-sections.test.ts가 선례다). 관찰하는 것은 "어떤 조작을 하면 목록과 활성이 어떻게
// 되는가"뿐이다.
//
// 여기서 관찰하지 않는 것 — xterm 인스턴스가 언마운트를 넘겨 사는지(결정 20·21). 이 모듈에
// "화면 전환"이라는 조작이 없어 정의상 못 본다. 스펙이 그 항목을 seam에서 빼 실물 왕복
// 관찰로 옮겼다(spec.md의 Seam 1 아래 인용문).

// 셸을 n개 띄운 상태와 그 id들. 목록 조작을 보려면 늘 여럿이 필요하다.
// **소유자를 안 주면 최상위 터미널이다** — 판 02가 관찰하던 것이 전부 그 화면이었다.
function opened(
  count: number,
  seed: { owner: string | null; project: string | null } = TOP_TERMINAL,
): { state: ShellsState; ids: number[] } {
  let state = NO_SHELLS;
  const ids: number[] = [];
  for (let n = 0; n < count; n += 1) {
    // 상한이 생긴 뒤로 이 헬퍼는 거부당할 수 있다. 조용히 적게 만들면 "3개를 띄웠다"고
    // 믿는 테스트가 2개를 보고 통과하므로 여기서 끊는다.
    const next = openShell(state, seed);
    if (!next) throw new Error(`셸 ${count}개를 띄우려 했는데 ${n}개에서 거부됐다`);
    state = next.state;
    ids.push(next.id);
  }
  return { state, ids };
}

const idsOf = (state: ShellsState) => state.shells.map((shell) => shell.id);
// 판 02가 `state.activeId`로 보던 것 — 이제 소유자마다 따로라 누구의 화면인지를 밝힌다.
const activeTop = (state: ShellsState) => activeIdOf(state, null);
const statusOf = (state: ShellsState, id: number) =>
  state.shells.find((shell) => shell.id === id)?.status;

// 백엔드가 주는 종료 프레임 모양 그대로다(types.ts).
const EXIT_42 = { exitCode: 42, signal: null };

describe("셸을 띄운다", () => {
  it("목록이 하나 늘고 그 셸이 활성이 된다", () => {
    const { state, ids } = opened(1);
    expect(idsOf(state)).toEqual(ids);
    expect(activeTop(state)).toBe(ids[0]);
    expect(statusOf(state, ids[0])).toEqual({ kind: "running" });
  });

  it("뒤에 띄운 셸이 활성을 가져간다", () => {
    const { state, ids } = opened(3);
    expect(idsOf(state)).toEqual(ids);
    expect(activeTop(state)).toBe(ids[2]);
  });

  // 이 모듈이 id를 직접 발급하는 이유다. 셸을 다 지우고 다시 띄우면 예전 번호가 돌아오는데,
  // 그 사이에 떠 있던 spawn 응답이나 종료 프레임이 **새 셸의 칸에 꽂힌다.**
  it("지웠다 다시 띄워도 번호를 다시 쓰지 않는다", () => {
    const first = opened(1);
    const emptied = removeShell(first.state, first.ids[0]);
    const again = openShell(emptied, TOP_TERMINAL);
    expect(again?.id).not.toBe(first.ids[0]);
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
    expect(activeTop(markExited(state, ids[1], EXIT_42))).toBe(ids[1]);
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
    expect(activeTop(removeShell(state, ids[0]))).toBe(ids[2]);
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
    const middle = activateShell(state, ids[1]);
    expect(activeTop(removeShell(middle, ids[1]))).toBe(ids[2]);
  });

  it("오른쪽이 없으면 왼쪽 이웃이 활성이 된다", () => {
    const { state, ids } = opened(3);
    expect(activeTop(removeShell(state, ids[2]))).toBe(ids[1]);
  });

  it("마지막 하나를 제거하면 활성이 없다", () => {
    const { state, ids } = opened(1);
    const after = removeShell(state, ids[0]);
    expect(after.shells).toEqual([]);
    expect(activeTop(after)).toBeNull();
  });
});

// 결정 30. 세는 자리가 **화면이 아니라 이 상태 하나**라는 것이 「앱 전체 기준」의 뜻이다 —
// 화면이 세면 판 03에서 Work마다 8개가 되어 조용히 깨진다.
describe("셸 수에는 앱 전체 상한이 있다", () => {
  it(`${MAX_SHELLS}개까지 띄운다`, () => {
    expect(opened(MAX_SHELLS).state.shells).toHaveLength(MAX_SHELLS);
  });

  it("상한을 넘는 요청은 거부된다", () => {
    expect(openShell(opened(MAX_SHELLS).state, TOP_TERMINAL)).toBeNull();
  });

  // 터미널이 둘이어도 그 둘은 **같은 상태를** 번갈아 고칠 뿐이다. 그래서 나눠 만들어도
  // 합이 상한에서 멈춘다 — 이것이 화면마다 세는 것과 갈리는 지점이다.
  it("두 터미널이 나눠 띄워도 합이 상한에서 멈춘다", () => {
    let state = NO_SHELLS;
    const 왼쪽: number[] = [];
    const 오른쪽: number[] = [];
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      const next = openShell(state, TOP_TERMINAL);
      expect(next, `${n}번째에서 거부됐다`).not.toBeNull();
      state = next!.state;
      (n % 2 === 0 ? 왼쪽 : 오른쪽).push(next!.id);
    }
    expect(왼쪽.length + 오른쪽.length).toBe(MAX_SHELLS);
    expect(openShell(state, TOP_TERMINAL)).toBeNull();
  });

  it("거부당해도 목록과 다음 번호는 그대로다", () => {
    const { state } = opened(MAX_SHELLS);
    expect(openShell(state, TOP_TERMINAL)).toBeNull();
    expect(state.shells).toHaveLength(MAX_SHELLS);
    expect(state.nextId).toBe(MAX_SHELLS + 1);
  });

  it("하나를 빼면 다시 띄울 자리가 생긴다", () => {
    const { state, ids } = opened(MAX_SHELLS);
    expect(openShell(removeShell(state, ids[0]), TOP_TERMINAL)).not.toBeNull();
  });

  // `+`가 잠기는 판정과 openShell이 거부하는 판정은 **같은 자리**여야 한다. 갈리면
  // 눌리는 `+`가 아무 일도 안 하거나, 잠긴 `+` 뒤에 자리가 남는다.
  it("atCap이 참인 것과 openShell이 거부하는 것이 같다", () => {
    let state = NO_SHELLS;
    for (let n = 0; n <= MAX_SHELLS; n += 1) {
      const refused = openShell(state, TOP_TERMINAL);
      expect(atCap(state), `${n}개일 때 갈렸다`).toBe(refused === null);
      if (!refused) break;
      state = refused.state;
    }
  });
});

const shellOf = (state: ShellsState, id: number) =>
  state.shells.find((shell) => shell.id === id) as Shell;

// 결정 31의 세 갈래 — 타이틀 시퀀스(OSC 0/2) → 프로젝트 → 셸 이름.
describe("칸 이름은 타이틀 → 셸 이름 순이다", () => {
  it("셸 이름이 오면 그것이 이름이다", () => {
    const { state, ids } = opened(1);
    expect(shellLabel(shellOf(setShellName(state, ids[0], "zsh"), ids[0]))).toBe("zsh");
  });

  it("타이틀이 오면 셸 이름을 이긴다", () => {
    const { state, ids } = opened(1);
    const named = setTitle(setShellName(state, ids[0], "zsh"), ids[0], "내이름");
    expect(shellLabel(shellOf(named, ids[0]))).toBe("내이름");
  });

  // 타이틀을 쏘던 셸이 빈 문자열을 쏘면 그 칸은 이름을 잃는다 — 그때 셸 이름으로 돌아가지
  // 않으면 빈 칸이 남는다.
  it("타이틀이 비면 셸 이름으로 돌아간다", () => {
    const { state, ids } = opened(1);
    const named = setTitle(setShellName(state, ids[0], "zsh"), ids[0], "내이름");
    expect(shellLabel(shellOf(setTitle(named, ids[0], "  "), ids[0]))).toBe("zsh");
  });

  // 결정 23. 못 띄운 셸에는 타이틀도 셸 이름도 영영 오지 않는다. 그 칸이 이름 없는
  // 빈 상자면 무엇이 실패했는지 목록에서 가리킬 수가 없다.
  it("못 띄운 칸도 이름이 비어 있지 않다", () => {
    const { state, ids } = opened(1);
    const failed = markFailed(state, ids[0], "$SHELL을 실행할 수 없습니다: /nonexistent");
    expect(shellLabel(shellOf(failed, ids[0])).trim()).not.toBe("");
  });

  it("아직 아무것도 안 온 칸도 이름이 비어 있지 않다", () => {
    const { state, ids } = opened(1);
    expect(shellLabel(shellOf(state, ids[0])).trim()).not.toBe("");
  });

  // 프롬프트마다 같은 타이틀을 쏘는 셸이 흔하다(zsh의 precmd). 매번 새 상태를 만들면
  // 명령 하나마다 터미널 화면 전체가 다시 그려진다.
  it("같은 타이틀이 다시 오면 상태가 그대로다", () => {
    const { state, ids } = opened(1);
    const once = setTitle(state, ids[0], "같은이름");
    expect(setTitle(once, ids[0], "같은이름")).toBe(once);
  });

  it("모르는 id로는 이름이 붙지 않는다", () => {
    const { state } = opened(1);
    expect(setTitle(state, 9999, "무엇")).toBe(state);
    expect(setShellName(state, 9999, "zsh")).toBe(state);
  });
});

describe("칸을 고른다", () => {
  it("고른 칸이 활성이 된다", () => {
    const { state, ids } = opened(3);
    expect(activeTop(activateShell(state, ids[0]))).toBe(ids[0]);
  });

  // 그리는 것과 누르는 것 사이에 그 칸이 빠질 수 있다. 없는 칸을 활성으로 만들면
  // 탭 줄에는 켜진 칸이 없고 본문도 비는데 이유가 아무 데도 안 남는다.
  it("모르는 id로는 활성이 바뀌지 않는다", () => {
    const { state } = opened(2);
    expect(activateShell(state, 9999)).toBe(state);
  });
});

// 결정 22·23이 「화면 하나에 적으면 됐던 것」이라 부른 둘이 여기서 **칸 단위**가 된다.
// 한 문장은 활성 칸의 줄과 그 칸의 title이 함께 쓰고, 꼬리표는 목록에서 **어느 칸이**
// 죽었는지를 누르지 않고 알아보게 한다.
describe("죽은 칸이 무엇을 말하는가", () => {
  it("도는 셸은 아무것도 말하지 않는다", () => {
    const { state, ids } = opened(1);
    expect(shellEndLabels(shellOf(state, ids[0]))).toBeNull();
  });

  it("종료 코드가 문장과 꼬리표에 함께 나온다", () => {
    const { state, ids } = opened(1);
    const dead = shellEndLabels(shellOf(markExited(state, ids[0], EXIT_42), ids[0]));
    expect(dead?.notice).toBe("종료 코드 42");
    expect(dead?.mark).toBe("42");
  });

  // `signal`은 시그널 이름이 아니라 strsignal()이 준 사람이 읽는 문자열이다(types.ts).
  // 그때 `exitCode`는 셸 관례인 128+N이 아니라 1이라, 꼬리표에 1을 적으면 거짓말이 된다.
  it("신호로 죽으면 그 문자열을 그대로 옮기고 꼬리표에 1을 적지 않는다", () => {
    const { state, ids } = opened(1);
    const killed = { exitCode: 1, signal: "Terminated: 15" };
    const dead = shellEndLabels(shellOf(markExited(state, ids[0], killed), ids[0]));
    expect(dead?.notice).toBe("신호로 종료 — Terminated: 15");
    expect(dead?.mark).not.toBe("1");
  });

  it("못 띄운 이유가 그대로 문장이 된다", () => {
    const { state, ids } = opened(1);
    const reason = "$SHELL을 실행할 수 없습니다: /nonexistent";
    const dead = shellEndLabels(shellOf(markFailed(state, ids[0], reason), ids[0]));
    expect(dead?.notice).toBe(reason);
    expect(dead?.mark).not.toBe("");
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

  // 판 03이 works의 `WorkView`를 끌어오면서 목록이 더 늘었다. 이름을 하나씩 막는 대신
  // **값 import가 하나도 없는 것**을 본다 — 위 셋은 그 성질이 깨지는 흔한 길일 뿐이다.
  const valueImports = [...source.matchAll(/^\s*import\s+(?!type\b).*$/gm)].map((found) =>
    found[0].trim(),
  );
  expect(valueImports).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 판 03. 셸이 「어느 Work 것인가」를 갖게 되면서 목록 하나가 화면 여럿을 먹인다.

const w = (projects: string[]): WorkView => ({
  slug: "w",
  title: "어떤 작업",
  status: "active",
  branch: "feat/w",
  createdAt: "2026-08-17",
  projects,
  worktrees: projects.map(
    (project): WorktreeView => ({
      project,
      path: `~/.atelier/works/w/trees/${project}`,
      exists: true,
      dirty: false,
    }),
  ),
  specDir: "~/.atelier/works/w/spec",
  specFiles: [],
});

// 결정 26. 아카이브·삭제가 「그 Work의 셸만」 거두려면 고르는 규칙이 한 자리에 있어야 한다.
describe("셸은 자기 화면 것만 보인다", () => {
  it("Work의 화면에는 그 Work의 셸만 있다", () => {
    let state = opened(1, { owner: "가", project: null }).state;
    state = openShell(state, { owner: "나", project: null })!.state;
    state = openShell(state, { owner: "가", project: null })!.state;

    expect(shellsOf(state, "가")).toHaveLength(2);
    expect(shellsOf(state, "나")).toHaveLength(1);
  });

  // 최상위 터미널은 Work가 아니다 — 아카이브가 그 셸까지 거두면 상관없는 작업이 끊긴다.
  it("최상위 터미널의 셸은 어느 Work에도 안 걸린다", () => {
    let state = opened(1).state;
    state = openShell(state, { owner: "가", project: null })!.state;

    expect(shellsOf(state, "가")).toHaveLength(1);
    expect(shellsOf(state, null)).toHaveLength(1);
    expect(shellsOf(state, "없는-작업")).toEqual([]);
  });

  // 확인 대화가 말하는 N이다(결정 26). 끝난 칸과 못 뜬 칸은 목록에 남지만 죽일 프로세스가
  // 없어서, 함께 세면 「셸 2개가 닫혀요」라고 해놓고 하나만 끝난다.
  it("도는 셸만 센다", () => {
    let state = opened(3, { owner: "가", project: null }).state;
    state = openShell(state, { owner: "나", project: null })!.state;
    const ids = shellsOf(state, "가").map((shell) => shell.id);

    expect(runningShellsOf(state, "가")).toBe(3);
    expect(runningShellsOf(markExited(state, ids[0], EXIT_42), "가")).toBe(2);
    expect(runningShellsOf(markFailed(state, ids[1], "못 떴다"), "가")).toBe(2);
    // 남의 화면 것도 안 센다.
    expect(runningShellsOf(state, "나")).toBe(1);
    expect(runningShellsOf(state, null)).toBe(0);
  });

  // 상한만은 화면이 아니라 앱 전체가 센다(결정 30). 나눠 담아도 합이 8에서 멈춘다.
  it("소유자가 갈려도 상한은 합으로 센다", () => {
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      const next = openShell(state, { owner: n % 2 === 0 ? "가" : "나", project: null });
      expect(next, `${n}번째에서 거부됐다`).not.toBeNull();
      state = next!.state;
    }
    expect(openShell(state, { owner: "다", project: null })).toBeNull();
    expect(atCap(state)).toBe(true);
  });
});

// 켜진 칸이 하나뿐이면 Work A에서 B로 갔다 오는 것만으로 A의 줄에 켜진 칸이 없어진다 —
// 그 상태에서 「없으면 하나 띄운다」가 돌면 이미 있는 셸 옆에 셸이 또 뜬다.
describe("켜진 칸은 화면마다 따로다", () => {
  it("다른 Work에서 셸을 띄워도 이 Work의 켜진 칸은 그대로다", () => {
    const 가 = opened(2, { owner: "가", project: null });
    const 나 = openShell(가.state, { owner: "나", project: null })!;

    expect(activeIdOf(나.state, "가")).toBe(가.ids[1]);
    expect(activeIdOf(나.state, "나")).toBe(나.id);
  });

  it("갔다 와도 보던 칸이 그대로다", () => {
    const 가 = opened(3, { owner: "가", project: null });
    const 고른것 = activateShell(가.state, 가.ids[0]);
    const 나 = openShell(고른것, { owner: "나", project: null })!;
    const 돌아옴 = activateShell(나.state, 가.ids[0]);

    expect(activeIdOf(돌아옴, "가")).toBe(가.ids[0]);
    expect(activeIdOf(돌아옴, "나")).toBe(나.id);
  });

  // 이웃을 전체 목록에서 고르면 **남의 Work 셸**이 켜진다. 그 줄에는 켜진 칸이 없어진다.
  // 그래서 남의 셸을 두 칸 **사이에** 끼워 둔다 — 나란한 배치로는 두 규칙이 같은 답을 낸다.
  it("활성 칸을 빼면 같은 화면 안에서 이웃이 켜진다", () => {
    const 첫째 = opened(1, { owner: "가", project: null });
    const 남 = openShell(첫째.state, { owner: "나", project: null })!;
    const 둘째 = openShell(남.state, { owner: "가", project: null })!;
    const 켠것 = activateShell(둘째.state, 첫째.ids[0]);

    const 뺀것 = removeShell(켠것, 첫째.ids[0]);
    expect(activeIdOf(뺀것, "가")).toBe(둘째.id);
    expect(activeIdOf(뺀것, "나")).toBe(남.id);
  });

  it("그 화면의 마지막 칸을 빼면 그 화면만 켜진 칸이 없어진다", () => {
    const 가 = opened(1, { owner: "가", project: null });
    const 나 = openShell(가.state, { owner: "나", project: null })!;

    const 뺀것 = removeShell(나.state, 가.ids[0]);
    expect(activeIdOf(뺀것, "가")).toBeNull();
    expect(activeIdOf(뺀것, "나")).toBe(나.id);
  });
});

// 결정 24·25. **출력이 `~` 축약 표기인 것이 계약이다** — 펴는 것은 백엔드 한 곳이고,
// 프런트가 홈을 붙이면 `ATELIER_HOME`을 바꾼 사람에게 조용히 어긋난다.
describe("cwd는 Work의 모양이 정한다", () => {
  it("프로젝트가 하나면 그 워크트리다", () => {
    const origin = workShellOrigin(w(["atelier"]), null);
    expect(origin?.cwd).toBe("~/.atelier/works/w/trees/atelier");
    expect(origin?.owner).toBe("w");
    // 프로젝트가 하나면 이름에 프로젝트를 적을 이유가 없다 — 고를 것이 없다.
    expect(origin?.project).toBeNull();
  });

  it("프로젝트가 없으면 Work 폴더다 — spec 폴더의 부모", () => {
    const origin = workShellOrigin(w([]), null);
    expect(origin?.cwd).toBe("~/.atelier/works/w");
  });

  it("spec 폴더 표기에 슬래시가 붙어 있어도 같은 자리다", () => {
    const work = { ...w([]), specDir: "~/.atelier/works/w/spec/" };
    expect(workShellOrigin(work, null)?.cwd).toBe("~/.atelier/works/w");
  });

  it("어느 갈래든 `~` 축약 표기다", () => {
    for (const origin of [
      workShellOrigin(w([]), null),
      workShellOrigin(w(["atelier"]), null),
      workShellOrigin(w(["atelier", "cli"]), "cli"),
    ]) {
      expect(origin?.cwd).toMatch(/^~\//);
    }
  });

  // 결정 24. 여럿일 때 아무 데나 고르면 **틀린 워크트리에서 claude가 돈다.** 물어보는 것이
  // 이 판의 규칙이라, 지정이 없으면 셸 자체가 생기지 않아야 한다.
  it("프로젝트가 여럿인데 안 고르면 셸이 생기지 않는다", () => {
    expect(workShellOrigin(w(["atelier", "cli"]), null)).toBeNull();
  });

  it("여럿 중 고른 것의 워크트리로 간다", () => {
    const origin = workShellOrigin(w(["atelier", "cli"]), "cli");
    expect(origin?.cwd).toBe("~/.atelier/works/w/trees/cli");
    expect(origin?.project).toBe("cli");
  });

  it("그 Work에 없는 프로젝트를 고르면 셸이 생기지 않는다", () => {
    expect(workShellOrigin(w(["atelier", "cli"]), "없는것")).toBeNull();
  });

  // 폴더가 없으면 spawn이 실패하고 결정 23의 「그 칸에 이유를 적는다」를 그대로 탄다.
  // 여기서 한 번 더 판정하면 같은 사실을 두 곳이 말한다.
  it("워크트리 폴더가 없어도 여기서는 막지 않는다", () => {
    const work = w(["atelier"]);
    const 없는것 = { ...work, worktrees: [{ ...work.worktrees[0], exists: false }] };
    expect(workShellOrigin(없는것, null)?.cwd).toBe("~/.atelier/works/w/trees/atelier");
  });

  it("최상위 터미널은 cwd가 없다 — 어디인지는 백엔드만 안다", () => {
    expect(TOP_TERMINAL.cwd).toBeNull();
    expect(TOP_TERMINAL.owner).toBeNull();
  });
});

// 결정 31의 가운데 갈래. OSC 타이틀은 셸이 쏘는 것이라 프로젝트를 드러낼 수 없다 —
// 그래서 이 갈래만은 순수 모듈이 **반드시** 해야 한다.
describe("칸 이름의 가운데 갈래는 프로젝트다", () => {
  const 프로젝트칸 = (project: string | null) => {
    const { state, ids } = opened(1, { owner: "w", project });
    return { state, id: ids[0] };
  };

  it("프로젝트가 실린 칸은 셸 이름을 이긴다", () => {
    const { state, id } = 프로젝트칸("cli");
    expect(shellLabel(shellOf(setShellName(state, id, "zsh"), id))).toBe("cli");
  });

  it("타이틀이 오면 프로젝트를 이긴다", () => {
    const { state, id } = 프로젝트칸("cli");
    expect(shellLabel(shellOf(setTitle(state, id, "claude"), id))).toBe("claude");
  });

  it("프로젝트가 하나뿐인 Work의 칸은 셸 이름이 이름이다", () => {
    const origin = workShellOrigin(w(["atelier"]), null)!;
    const { state, id } = 프로젝트칸(origin.project);
    expect(shellLabel(shellOf(setShellName(state, id, "zsh"), id))).toBe("zsh");
  });
});

// ⌘T·⌘W. 실물로는 못 잡는 자리가 있다 — 「셸에 이 키가 안 간다」는 핸들러의 반환값이
// 정하는데 정적 렌더에는 안 보이고, 「수식키를 더 안 받는다」는 조합마다 쳐 봐야 한다.
// 그 판정만 순수 함수로 떼어 여기서 전수한다.
//
// **⌃T는 셸 몫이다** — 아래 「ctrlKey가 더 눌리면 아니다」가 그것을 못박는다. ⌘로 고른
// 이유가 그것이다(결정 34): ⌃T는 zsh emacs 모드의 `transpose-chars`와 fzf가 쓴다.
describe("앱이 가져가는 키", () => {
  const key = (over: Partial<Parameters<typeof shellHotkey>[0]> = {}) => ({
    type: "keydown",
    code: "KeyT",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    ...over,
  });

  it("⌘T는 새 칸", () => {
    expect(shellHotkey(key())).toBe("new");
  });

  it("⌘W는 이 칸 닫기", () => {
    expect(shellHotkey(key({ code: "KeyW" }))).toBe("close");
  });

  // keydown만이다. 같은 키에 keypress·keyup이 뒤따르므로, 안 거르면 한 번 눌러 셋이 열린다.
  it.each(["keypress", "keyup"])("%s는 아니다", (type) => {
    expect(shellHotkey(key({ type }))).toBeNull();
  });

  // 수식키가 하나라도 더 붙으면 셸 몫이다(결정 29). **⌃T는 특히 그렇다** — zsh의
  // transpose-chars와 fzf 파일 위젯이 그 키다. 여기서 먹으면 그것들을 뺏는다.
  it.each(["ctrlKey", "altKey", "shiftKey"] as const)("%s가 더 눌리면 아니다", (extra) => {
    expect(shellHotkey(key({ [extra]: true }))).toBeNull();
    expect(shellHotkey(key({ code: "KeyW", [extra]: true }))).toBeNull();
  });

  it("⌘ 없이 T·W만은 아니다 — 그냥 글자다", () => {
    expect(shellHotkey(key({ metaKey: false }))).toBeNull();
    expect(shellHotkey(key({ code: "KeyW", metaKey: false }))).toBeNull();
  });

  it("다른 키는 아니다", () => {
    expect(shellHotkey(key({ code: "KeyN" }))).toBeNull();
  });

  // **`code`로 보는 이유**가 이 줄이다. 한글 입력기가 켜져 있으면 `key`는 `ㅅ`으로 오는데
  // 물리 키는 그대로 `KeyT`다. `key`를 봤다면 이 검사가 빨갛다.
  it("입력기가 켜져 있어도 물리 키로 본다", () => {
    expect(shellHotkey({ ...key(), code: "KeyT" })).toBe("new");
  });
});

// ⌘W는 **두 자리가 함께여야** 성립한다. 프런트가 잡아도 macOS 메뉴에 `Close Window`가
// 있으면 OS가 먼저 먹어 창이 닫히고 셸이 전부 죽는다 — 실물에서 그렇게 잃었다. 프런트만
// 보는 검사는 그 회귀에 초록이므로, 메뉴 쪽 자리를 여기서 함께 못박는다.
it("macOS 메뉴에 Close Window가 없다 — 있으면 ⌘W가 웹뷰까지 못 온다", () => {
  const menu = readFileSync(
    fileURLToPath(new URL("../../../src-tauri/src/lib.rs", import.meta.url)),
    "utf8",
  );
  expect(menu, "메뉴를 손으로 세우지 않으면 Tauri 기본 메뉴가 붙고, 거기엔 ⌘W가 있다").toContain(
    "fn build_menu",
  );
  expect(menu).not.toMatch(/\.close_window\(\)/);
  // 메뉴를 통째로 지우면 ⌘C·⌘V·⌘A가 함께 죽는다. Edit이 살아 있는지 본다.
  expect(menu).toContain(".select_all()");
});

