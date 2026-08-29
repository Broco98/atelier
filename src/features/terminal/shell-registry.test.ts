/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  activateShell,
  activeShellOf,
  shellsEmptied,
  activeIdOf,
  atCap,
  CLOSE_NOTICE,
  confirmClose,
  markExited,
  markFailed,
  MAX_SHELLS,
  needsCloseConfirm,
  NO_SHELLS,
  openShell,
  closesShellFromWindow,
  opensShellFromWindow,
  removeShell,
  runningAgentsOf,
  runningOn,
  runningShellsOf,
  SEARCH_GAP_MS,
  searchHotkey,
  setRunning,
  setShellName,
  setTitle,
  shellCapNotice,
  shellCountsOf,
  shellEndLabels,
  shellOpenNotice,
  shellRewrite,
  shellNavFromWindow,
  shellNavKey,
  shellRowName,
  shellsOf,
  cycleShell,
  sameScreen,
  shellForNav,
  shellHotkey,
  TOP_TERMINAL,
  workShellOrigin,
} from "./shell-registry";
import type { Shell, ShellOrigin, ShellsState } from "./shell-registry";
import type { WorkView, WorktreeView } from "@/features/works/types";

// 소스를 **문자열로만** 본다. 자르거나 파싱하는 정규식은 파서가 새는 순간 조용히 통과하고,
// 이 저장소는 그것을 fail-open이라 부른다 — 실제로 그 사고가 있었다(아래 「본문도 DOM 전역을
// 안 읽는다」와 「확인을 건너뛰는 길이 셋뿐이다」가 그 자리다). 여기서 쓰는 것은 리터럴
// `includes`와 **정확한 등장 횟수** 둘뿐이라, 문자열이 사라지거나 개수가 달라지면 반드시
// 빨개진다.
const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const countOf = (source: string, literal: string) => source.split(literal).length - 1;

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
  seed: ShellOrigin = TOP_TERMINAL,
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
// `exit` 한 줄로 끝난 셸. 결정 48이 이것만 목록에서 뺀다.
const EXIT_0 = { exitCode: 0, signal: null };

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
// 끝난 셸이 목록에서 사라지면 읽을 자리가 없다. **결정 48이 그 범위를 「이유가 있을 때」로
// 좁혔다** — 정상 종료만 빠지고 나머지는 그대로 남는다.
describe("이유가 남은 셸은 목록에 남는다", () => {
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
describe("제거하면 목록에서 빠진다", () => {
  it("제거하면 그 칸이 목록에서 빠진다", () => {
    const { state, ids } = opened(3);
    expect(idsOf(removeShell(state, ids[1]))).toEqual([ids[0], ids[2]]);
  });

  it("이유가 남은 칸도 제거로 뺄 수 있다", () => {
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

// 결정 48. 결정 22의 근거는 「claude가 조용히 죽었을 때 이유를 읽는다」 **하나**였고
// 정상 종료에는 읽을 이유가 없다. 그래서 근거를 해치지 않고 범위만 좁힌다 — 남기는 것은
// 이유가 있을 때만이다. Terminal.app도 `exit`에 창을 닫는다.
describe("정상 종료한 셸은 목록에서 스스로 빠진다", () => {
  it("`exit`(코드 0, 신호 없음)이면 그 칸이 빠진다", () => {
    const { state, ids } = opened(2);
    expect(idsOf(markExited(state, ids[0], EXIT_0))).toEqual([ids[1]]);
  });

  // 앞 판의 판별 증거를 그대로 쓴다 — 42 ≠ 0이라 성립한다. 이 줄이 빨개지면 범위를 좁힌
  // 것이 아니라 결정 22를 통째로 뒤집은 것이다.
  it("`exit 42`는 남는다 — 읽을 이유가 있다", () => {
    const { state, ids } = opened(2);
    const after = markExited(state, ids[0], EXIT_42);
    expect(idsOf(after)).toEqual(ids);
    expect(statusOf(after, ids[0])).toEqual({ kind: "exited", exit: EXIT_42 });
  });

  it("신호로 죽은 셸은 남는다", () => {
    const { state, ids } = opened(2);
    const killed = { exitCode: 1, signal: "Terminated: 15" };
    expect(idsOf(markExited(state, ids[0], killed))).toEqual(ids);
  });

  // 신호로 죽은 셸이 안 섞이는 것은 백엔드가 「시그널이면 128+N이 아니라 1」로 정해 둔
  // 덕이지만(types.ts), 그 약속 하나에 얹으면 백엔드가 흔들릴 때 조용히 깨진다.
  // `signal`을 함께 보는 것이 그 대비다.
  it("신호와 함께 코드 0이 실려 와도 남는다", () => {
    const { state, ids } = opened(1);
    expect(idsOf(markExited(state, ids[0], { exitCode: 0, signal: "Hangup: 1" }))).toEqual(ids);
  });

  // 「실패해서 못 뜬 셸」은 정상 종료가 아니다. 그쪽은 `markFailed`로 와서 종료 코드라는
  // 것이 아예 없어 이 조건에 걸릴 길이 없는데, **한 목록에서 대비해야** 그 사실이 보인다.
  it("같은 목록에서 정상 종료만 빠지고 못 뜬 칸은 남는다", () => {
    const { state, ids } = opened(2);
    const 못뜬것 = markFailed(state, ids[0], "$SHELL을 실행할 수 없습니다: /nonexistent");
    const after = markExited(못뜬것, ids[1], EXIT_0);
    expect(idsOf(after)).toEqual([ids[0]]);
    expect(statusOf(after, ids[0])).toEqual({
      kind: "failed",
      reason: "$SHELL을 실행할 수 없습니다: /nonexistent",
    });
  });

  // **`×`와 같은 길이다.** 다음에 켜질 칸을 여기서 새로 정하면 「닫아서 사라진 자리」와
  // 「끝나서 사라진 자리」가 다른 칸을 켜는 날이 온다. 상태를 통째로 대 보는 것이라
  // 규칙이 한 줄이라도 갈리면 빨개진다.
  it.each([0, 1, 2])("사라진 칸이 활성이면 다음 활성이 `×`와 같다 — %i번째 칸", (n) => {
    const { state, ids } = opened(3);
    const 켠것 = activateShell(state, ids[n]);
    expect(markExited(켠것, ids[n], EXIT_0)).toEqual(removeShell(켠것, ids[n]));
  });

  // 마지막 칸이 `exit`으로 사라지면 셸 0개인 화면이다. 「새 셸이 저절로 뜨지 않는다」는
  // 이 seam에서 **번호가 안 나간 것**으로 관찰된다 — 화면 진입 이펙트에 붙은 `ensureShell`은
  // 이 모듈에 없다(머리말의 「여기서 관찰하지 않는 것」과 같은 이유다).
  it("마지막 칸이 정상 종료하면 셸 0개가 되고 새 칸도 생기지 않는다", () => {
    const { state, ids } = opened(1);
    const after = markExited(state, ids[0], EXIT_0);
    expect(after.shells).toEqual([]);
    expect(activeTop(after)).toBeNull();
    expect(after.nextId).toBe(state.nextId);
  });

  // 제거와 IPC가 경주한다 — 이미 빠진 칸의 종료 프레임이 늦게 온다(patch의 주석). 그때
  // 새 상태를 만들면 화면이 이유 없이 다시 그려진다.
  it("이미 빠진 칸의 정상 종료가 늦게 와도 상태가 그대로다", () => {
    const { state } = opened(2);
    expect(markExited(state, 9999, EXIT_0)).toBe(state);
  });
});

// **마지막 셸이 방금 사라졌는가.** 화면이 이 판정을 딛고 본문을 문서로 되돌린다 —
// 셸 0개인 터미널 본문은 볼 것이 없는 화면이라 사람을 거기 남겨 두면 다음에 무엇을 할지가
// 본문 밖에 있다.
describe("마지막 셸이 사라진 순간", () => {
  const at = (owner: string | null, count: number) => ({ owner, count });

  it("1에서 0이 되면 그렇다", () => {
    expect(shellsEmptied(at("가", 1), at("가", 0))).toBe(true);
  });

  // **서 있는 값으로 재면 안 된다.** 화면에 들어올 때는 0에서 시작해 진입 이펙트가 하나를
  // 띄우므로, 「지금 0개다」로 재면 들어오자마자 되돌아 나가 터미널을 열 수 없는 앱이 된다.
  it("처음부터 0이면 아니다", () => {
    expect(shellsEmptied(at("가", 0), at("가", 0))).toBe(false);
  });

  it("아직 남아 있으면 아니다", () => {
    expect(shellsEmptied(at("가", 2), at("가", 1))).toBe(false);
  });

  // 셸이 도는 work에서 안 도는 work으로 갈 때마다 본문이 문서로 튕기면 안 된다.
  it("work이 바뀐 것은 세지 않는다", () => {
    expect(shellsEmptied(at("가", 1), at("나", 0))).toBe(false);
  });

  it("최상위 터미널도 같은 규칙이다", () => {
    expect(shellsEmptied(at(null, 1), at(null, 0))).toBe(true);
    expect(shellsEmptied(at(null, 1), at("가", 0))).toBe(false);
  });
});

// 「켜진 셸이 무엇인가」를 정하는 자리. 이 함수가 없던 동안 같은 2단 체인이 화면 넷에
// 베껴져 있었고, 그 값이 **어느 셸을 그릴지**(TerminalPane)와 **열 머리의 이름**
// (ShellHeadName)으로 곧장 간다 — 첫 칸을 주는 것으로 퇴화하면 화면이 조용히 갈린다.
describe("켜진 셸을 집는다", () => {
  it("첫 칸이 아니라 켜진 칸을 준다", () => {
    const { state, ids } = opened(3);
    const 켠것 = activateShell(state, ids[2]);
    expect(activeShellOf(켠것, null)?.id).toBe(ids[2]);
  });

  it("`activeIdOf`와 같은 칸을 가리킨다", () => {
    const { state, ids } = opened(3);
    const 켠것 = activateShell(state, ids[1]);
    expect(activeShellOf(켠것, null)?.id).toBe(activeIdOf(켠것, null));
  });

  // 소유자마다 따로다. 남의 화면의 켜진 칸을 여기서 주면 열 머리가 옆 work의 셸 이름을 쓴다.
  it("남의 화면 것을 주지 않는다", () => {
    const { state } = opened(2);
    expect(activeShellOf(state, "가")).toBeNull();
  });

  it("셸이 없으면 없다", () => {
    expect(activeShellOf(NO_SHELLS, null)).toBeNull();
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
      expect(atCap(state, TOP_TERMINAL.owner), `${n}개일 때 갈렸다`).toBe(refused === null);
      if (!refused) break;
      state = refused.state;
    }
  });
});

const shellOf = (state: ShellsState, id: number) =>
  state.shells.find((shell) => shell.id === id) as Shell;

// 결정 31의 갈래들 — 타이틀 시퀀스(OSC 0/2) → 셸 이름 → 기본 이름. 프로젝트는 셋 중
// 하나로 **고르지 않고** 앞에 함께 적히므로(결정 46) 아래 「셸 행의 두 줄」이 따로 본다.
describe("셸 이름은 타이틀 → 셸 이름 순이다", () => {
  it("셸 이름이 오면 그것이 이름이다", () => {
    const { state, ids } = opened(1);
    expect(shellRowName(shellOf(setShellName(state, ids[0], "zsh"), ids[0]))).toBe("zsh");
  });

  it("타이틀이 오면 셸 이름을 이긴다", () => {
    const { state, ids } = opened(1);
    const named = setTitle(setShellName(state, ids[0], "zsh"), ids[0], "내이름");
    expect(shellRowName(shellOf(named, ids[0]))).toBe("내이름");
  });

  // 타이틀을 쏘던 셸이 빈 문자열을 쏘면 그 칸은 이름을 잃는다 — 그때 셸 이름으로 돌아가지
  // 않으면 빈 칸이 남는다.
  it("타이틀이 비면 셸 이름으로 돌아간다", () => {
    const { state, ids } = opened(1);
    const named = setTitle(setShellName(state, ids[0], "zsh"), ids[0], "내이름");
    expect(shellRowName(shellOf(setTitle(named, ids[0], "  "), ids[0]))).toBe("zsh");
  });

  // 결정 23. 못 띄운 셸에는 타이틀도 셸 이름도 영영 오지 않는다. 그 칸이 이름 없는
  // 빈 상자면 무엇이 실패했는지 목록에서 가리킬 수가 없다.
  it("못 띄운 칸도 이름이 비어 있지 않다", () => {
    const { state, ids } = opened(1);
    const failed = markFailed(state, ids[0], "$SHELL을 실행할 수 없습니다: /nonexistent");
    expect(shellRowName(shellOf(failed, ids[0])).trim()).not.toBe("");
  });

  it("아직 아무것도 안 온 칸도 이름이 비어 있지 않다", () => {
    const { state, ids } = opened(1);
    expect(shellRowName(shellOf(state, ids[0])).trim()).not.toBe("");
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

// **위 검사는 import만 본다 — 그것이 fail-open이었다.** 머리말은 「DOM 없는 기본 환경에서
// 그대로 돈다」를 「shell-registry.test.ts의 소스 스캔이 지킨다」고 못박아 놨는데, 정작
// `opensShellFromWindow`의 **본문**이 `HTMLTextAreaElement`를 `instanceof`로 읽는 동안에도
// 그 스캔은 조용히 초록이었다: 전역을 읽는 데는 import가 필요 없기 때문이다. 노드에서
// 스텁 없이 부르면 그 줄이 ReferenceError로 터지므로 머리말은 그때 이미 거짓이었다.
//
// 그래서 본문까지 본다. 파싱은 안 한다 — 리터럴이 있는지·몇 개인지만 본다.
it("본문도 DOM 전역을 안 읽는다 — 머리말이 약속한 것이 이것이다", () => {
  const source = read("./shell-registry.ts");
  for (const forbidden of [
    "HTMLInputElement",
    "instanceof HTML",
    "document.",
    "window.",
    "globalThis.",
  ]) {
    expect(source, `${forbidden} — DOM 없는 환경에는 이 이름이 없다`).not.toContain(forbidden);
  }
  // `HTMLTextAreaElement`만은 `typesInto`의 주석이 「한때 이랬다」로 **한 번** 든다. 그
  // 역사를 지우면서까지 검사를 편하게 만들 이유가 없으니 **센다** — 코드가 그 전역을 다시
  // 읽는 순간 둘이 되어 여기가 빨개진다.
  expect(
    countOf(source, "HTMLTextAreaElement"),
    "본문이 DOM 전역을 다시 읽는다 — 주석 한 번 말고는 나올 자리가 없다",
  ).toBe(1);
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
  pinned: false,
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
    let state = opened(1, { owner: "가", project: null, cwd: null }).state;
    state = openShell(state, { owner: "나", project: null, cwd: null })!.state;
    state = openShell(state, { owner: "가", project: null, cwd: null })!.state;

    expect(shellsOf(state, "가")).toHaveLength(2);
    expect(shellsOf(state, "나")).toHaveLength(1);
  });

  // 최상위 터미널은 Work가 아니다 — 아카이브가 그 셸까지 거두면 상관없는 작업이 끊긴다.
  it("최상위 터미널의 셸은 어느 Work에도 안 걸린다", () => {
    let state = opened(1).state;
    state = openShell(state, { owner: "가", project: null, cwd: null })!.state;

    expect(shellsOf(state, "가")).toHaveLength(1);
    expect(shellsOf(state, null)).toHaveLength(1);
    expect(shellsOf(state, "없는-작업")).toEqual([]);
  });

  // 확인 대화가 말하는 N이다(결정 26). 끝난 칸과 못 뜬 칸은 목록에 남지만 죽일 프로세스가
  // 없어서, 함께 세면 「셸 2개가 닫혀요」라고 해놓고 하나만 끝난다.
  it("도는 셸만 센다", () => {
    let state = opened(3, { owner: "가", project: null, cwd: null }).state;
    state = openShell(state, { owner: "나", project: null, cwd: null })!.state;
    const ids = shellsOf(state, "가").map((shell) => shell.id);

    expect(runningShellsOf(state, "가")).toBe(3);
    expect(runningShellsOf(markExited(state, ids[0], EXIT_42), "가")).toBe(2);
    expect(runningShellsOf(markFailed(state, ids[1], "못 떴다"), "가")).toBe(2);
    // 남의 화면 것도 안 센다.
    expect(runningShellsOf(state, "나")).toBe(1);
    expect(runningShellsOf(state, null)).toBe(0);
  });

  // **상한도 화면마다다**(결정 23이 결정 30을 뒤집었다). 한 화면을 꽉 채워도 남의 화면과
  // 최상위 터미널은 자기 몫을 그대로 갖는다 — 앱 전체로 세면 남이 연 셸 때문에 이 화면의
  // `+`가 잠기고, 왜 잠겼는지가 이 화면에 안 보인다.
  it("한 화면을 꽉 채워도 다른 화면은 자기 몫을 갖는다", () => {
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      const next = openShell(state, { owner: "가", project: null, cwd: null });
      expect(next, `${n}번째에서 거부됐다`).not.toBeNull();
      state = next!.state;
    }
    // 꽉 찬 화면은 거부한다 — 이것이 없으면 아래 둘은 「상한이 아예 없어서」도 초록이다.
    expect(openShell(state, { owner: "가", project: null, cwd: null })).toBeNull();
    expect(atCap(state, "가")).toBe(true);

    // 남의 work도, 최상위 터미널도 그대로 연다.
    expect(atCap(state, "나")).toBe(false);
    expect(openShell(state, { owner: "나", project: null, cwd: null })).not.toBeNull();
    expect(atCap(state, null)).toBe(false);
    expect(openShell(state, TOP_TERMINAL)).not.toBeNull();
  });
});

// 켜진 칸이 하나뿐이면 Work A에서 B로 갔다 오는 것만으로 A의 줄에 켜진 칸이 없어진다 —
// 그 상태에서 「없으면 하나 띄운다」가 돌면 이미 있는 셸 옆에 셸이 또 뜬다.
describe("켜진 칸은 화면마다 따로다", () => {
  it("다른 Work에서 셸을 띄워도 이 Work의 켜진 칸은 그대로다", () => {
    const 가 = opened(2, { owner: "가", project: null, cwd: null });
    const 나 = openShell(가.state, { owner: "나", project: null, cwd: null })!;

    expect(activeIdOf(나.state, "가")).toBe(가.ids[1]);
    expect(activeIdOf(나.state, "나")).toBe(나.id);
  });

  it("갔다 와도 보던 칸이 그대로다", () => {
    const 가 = opened(3, { owner: "가", project: null, cwd: null });
    const 고른것 = activateShell(가.state, 가.ids[0]);
    const 나 = openShell(고른것, { owner: "나", project: null, cwd: null })!;
    const 돌아옴 = activateShell(나.state, 가.ids[0]);

    expect(activeIdOf(돌아옴, "가")).toBe(가.ids[0]);
    expect(activeIdOf(돌아옴, "나")).toBe(나.id);
  });

  // 이웃을 전체 목록에서 고르면 **남의 Work 셸**이 켜진다. 그 줄에는 켜진 칸이 없어진다.
  // 그래서 남의 셸을 두 칸 **사이에** 끼워 둔다 — 나란한 배치로는 두 규칙이 같은 답을 낸다.
  it("활성 칸을 빼면 같은 화면 안에서 이웃이 켜진다", () => {
    const 첫째 = opened(1, { owner: "가", project: null, cwd: null });
    const 남 = openShell(첫째.state, { owner: "나", project: null, cwd: null })!;
    const 둘째 = openShell(남.state, { owner: "가", project: null, cwd: null })!;
    const 켠것 = activateShell(둘째.state, 첫째.ids[0]);

    const 뺀것 = removeShell(켠것, 첫째.ids[0]);
    expect(activeIdOf(뺀것, "가")).toBe(둘째.id);
    expect(activeIdOf(뺀것, "나")).toBe(남.id);
  });

  it("그 화면의 마지막 칸을 빼면 그 화면만 켜진 칸이 없어진다", () => {
    const 가 = opened(1, { owner: "가", project: null, cwd: null });
    const 나 = openShell(가.state, { owner: "나", project: null, cwd: null })!;

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

// 결정 45·46. 셸 행은 두 줄이고, 그 두 줄을 정하는 것이 이 함수 둘이다. **프로젝트를
// 버리지 않는 것**이 여기서 지켜야 할 전부다 — 앞 판의 가로 탭 줄은 타이틀이 오는 순간
// 프로젝트를 버렸고, 그래서 어느 워크트리의 셸인지가 실물에서 사라졌다(결정 104가 그
// 함수를 지웠다).
describe("셸 행의 두 줄", () => {
  const 칸 = (project: string | null, cwd: string | null) => {
    const { state, ids } = opened(1, { owner: "w", project, cwd });
    return { state, id: ids[0] };
  };

  it("프로젝트가 있으면 타이틀을 이기지 못한다 — 둘을 함께 적는다", () => {
    // 앞 판이 실물에서 잃은 것이 이것이다: 로그인 zsh가 뜨자마자 OSC 타이틀을 쏘면
    // `shellLabel`은 프로젝트를 버린다. 같은 칸에서 두 함수가 갈리는 것을 못박는다.
    const { state, id } = 칸("cli", "~/w/trees/cli");
    const 이름붙은 = setTitle(state, id, "gimhyoyeon@gimhyoyeon");
    expect(shellRowName(shellOf(이름붙은, id))).toBe("cli · gimhyoyeon@gimhyoyeon");
  });

  it("타이틀이 없으면 셸 이름이 뒤에 온다", () => {
    const { state, id } = 칸("cli", "~/w/trees/cli");
    expect(shellRowName(shellOf(setShellName(state, id, "zsh"), id))).toBe("cli · zsh");
  });

  it("프로젝트가 없으면 이름 하나다 — 구분점이 앞에 남지 않는다", () => {
    const { state, id } = 칸(null, "~/w");
    expect(shellRowName(shellOf(setShellName(state, id, "zsh"), id))).toBe("zsh");
  });

  it("이름이 하나도 없어도 비지 않는다", () => {
    const { state, id } = 칸(null, "~/w");
    expect(shellRowName(shellOf(state, id)).trim()).not.toBe("");
  });

  it("프로젝트만 있고 이름이 없으면 그 이름을 두 번 적지 않는다", () => {
    // `cli · cli`가 되는 자리다. 뒤 갈래에서 프로젝트를 빼지 않으면 그렇게 된다.
    const { state, id } = 칸("cli", "~/w/trees/cli");
    expect(shellRowName(shellOf(state, id))).not.toBe("cli · cli");
  });
});

// 결정 47. 잠긴 `+` 행이 적는 문장과 ⌘T가 거절당했을 때 뜨는 토스트가 **같은 문장**이다.
describe("상한에 닿았을 때 하는 말", () => {
  it("상한과 지금 수를 함께 말한다", () => {
    const state = opened(MAX_SHELLS).state;
    expect(shellCapNotice(state, TOP_TERMINAL.owner)).toBe(
      `셸은 화면마다 ${MAX_SHELLS}개까지예요 — 여기 ${MAX_SHELLS}개`,
    );
  });

  it("수는 **이 화면**의 것이다 — 앱 전체가 아니다", () => {
    // 결정 23. 앱 전체를 세면 「여기 3개인데 8개까지라면서 왜 못 열지」가 된다 — 사람이
    // 세는 단위가 이 화면이라서다. 남의 work의 셸은 이 문장에 안 섞인다.
    let state = opened(3, { owner: "가", project: null, cwd: null }).state;
    state = openShell(state, { owner: "나", project: null, cwd: null })!.state;
    expect(shellCapNotice(state, "가")).toContain("여기 3개");
    expect(shellCapNotice(state, "나")).toContain("여기 1개");
  });

  // 아래 둘은 **`openShell`을 실제로 통과시켜** 본다. 거절 여부와 할 말이 한 자리에서
  // 갈리는지가 관찰 대상이라, `null`을 손으로 넣으면 그 짝이 검사에서 빠진다.
  it("열렸으면 아무 말도 하지 않는다", () => {
    // 이 판정이 터미널 스토어(`openNewShell`)에 있었을 때 **성공 경로가 어떤 검사에도 안
    // 걸렸다** — 그 함수는 열리는 순간 xterm을 세워 DOM 없는 seam에서 못 돈다. 거절을
    // 알리는 줄이 성공 경로로 새면 ⌘T·`+`가 열 때마다 「셸은 8개까지예요」를 뱉는다.
    const state = opened(MAX_SHELLS - 1).state;
    expect(shellOpenNotice(state, openShell(state, TOP_TERMINAL), TOP_TERMINAL.owner)).toBeNull();
  });

  it("거부당하면 잠긴 `+`와 같은 문장이 온다", () => {
    const state = opened(MAX_SHELLS).state;
    expect(shellOpenNotice(state, openShell(state, TOP_TERMINAL), TOP_TERMINAL.owner)).toBe(
      shellCapNotice(state, TOP_TERMINAL.owner),
    );
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


// ─────────────────────────────────────────────────────────────────────────────
// 판 02(ux-papercuts) — 터미널 손맛. 키와 닫기의 판정 셋이 여기 산다. 셋 다 실물로는
// 전수할 수 없는 것들이다: 「셸에 이 키가 안 간다」도 「닫기 전에 물었나」도 정적 렌더에
// 안 보이고, 조합마다 손으로 쳐 봐야 한다.

// ⇧Enter. xterm은 Shift를 무시하고 `\r`을 보내 셸에게는 Enter와 구별되지 않고, `claude`는
// 그것을 「보내기」로 읽어 쓰다 만 프롬프트가 그대로 나간다(결정 91).
describe("⇧Enter가 개행한다", () => {
  const key = (over: Partial<Parameters<typeof shellRewrite>[0]> = {}) => ({
    type: "keydown",
    code: "Enter",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: true,
    ...over,
  });

  it("ESC + CR로 바꿔 보낸다", () => {
    expect(shellRewrite(key())).toBe("\x1b\r");
  });

  // **이 줄이 뒤집히면 아무 프롬프트도 못 보낸다.** 그냥 Enter는 셸 몫이다.
  it("Shift 없는 Enter는 그대로 셸에 간다", () => {
    expect(shellRewrite(key({ shiftKey: false }))).toBeNull();
  });

  // ⌥Enter·⌃Enter는 셸 몫으로 둔다(결정 91) — 결정 29의 범위를 근거 없이 넓히지 않는다.
  it.each(["ctrlKey", "altKey", "metaKey"] as const)("%s가 더 붙으면 셸 몫이다", (extra) => {
    expect(shellRewrite(key({ [extra]: true }))).toBeNull();
  });

  // keydown만이다. 같은 키에 keypress·keyup이 뒤따르므로, 안 거르면 한 번에 셋이 나간다.
  it.each(["keypress", "keyup"])("%s는 아니다", (type) => {
    expect(shellRewrite(key({ type }))).toBeNull();
  });

  it("다른 키는 아니다", () => {
    expect(shellRewrite(key({ code: "KeyT" }))).toBeNull();
  });
});

// ⌘W와 `×`가 도는 명령을 조용히 죽이지 않는다(결정 92). 판정은 백엔드가 읽는 PTY의
// 포그라운드 그룹인데, **그 값을 못 얻는 경우가 실제로 있다** — 이미 끝난 pty, IPC 실패.
// 그때 묻지 않고 닫는 것이 이 함수가 지키는 절반이다.
describe("닫기 전에 묻는가", () => {
  const one = opened(1);
  const running = one.state.shells[0];
  const exited = markExited(one.state, running.id, EXIT_42).shells[0];
  const failed = markFailed(one.state, running.id, "폴더가 없습니다").shells[0];

  it("명령이 돌면 묻는다", () => {
    expect(needsCloseConfirm(running, true)).toBe(true);
  });

  it("빈 프롬프트면 안 묻는다 — 닫을 때마다 팝업이 뜨면 안 된다", () => {
    expect(needsCloseConfirm(running, false)).toBe(false);
  });

  it("판정을 못 얻으면 안 묻는다 — 모르는 것으로 닫는 길을 막지 않는다", () => {
    expect(needsCloseConfirm(running, null)).toBe(false);
  });

  // 물어볼 프로세스가 없는 칸들이다(결정 22가 목록에 남겨 두는 그 칸들). 백엔드가 무엇을
  // 답하든 안 묻는다 — 그 pty id는 이미 회수돼 남이 앉아 있을 수 있다.
  it.each([
    ["끝난 칸", exited],
    ["못 뜬 칸", failed],
  ])("%s은 안 묻는다", (_name, shell) => {
    expect(needsCloseConfirm(shell, true)).toBe(false);
  });

  // 그리는 것과 누르는 것 사이에 그 칸이 빠질 수 있다 — `removeShell`이 같은 자리를 연다.
  it("없는 칸은 안 묻는다", () => {
    expect(needsCloseConfirm(undefined, true)).toBe(false);
  });

  // **묻고 나서 그 답을 존중하는가**가 여기까지 와야 절반이 채워진다. 한때 그 한 줄이
  // 스토어 안에 `confirm`과 붙어 있어 잴 수가 없었고, 답을 버리고 그냥 닫게 만들어도
  // 검사가 전부 초록이었다(실측). 확인 창을 인자로 받게 하면서 값으로 드러났다.
  describe("물은 답을 존중한다", () => {
    const ask = (answer: boolean) => {
      let asked = 0;
      return {
        count: () => asked,
        fn: async () => {
          asked += 1;
          return answer;
        },
      };
    };

    it("아니라고 하면 안 닫는다 — sleep 30이 도는 셸이 이 자리다", async () => {
      expect(await confirmClose(running, true, ask(false).fn)).toBe(false);
    });

    // **정확히 한 번만 묻는다**(결정 92의 「닫기 직전에 한 번만」). 두 번 물으면 ⌘W 한 번에
    // 팝업이 둘 뜬다.
    it("예라고 하면 닫는다 — 묻는 것은 한 번뿐이다", async () => {
      const asking = ask(true);
      expect(await confirmClose(running, true, asking.fn)).toBe(true);
      expect(asking.count()).toBe(1);
    });

    // 물을 일이 없는데 물으면 빈 프롬프트를 닫을 때마다 팝업이 뜬다(결정 92가 피한 것).
    it("물을 일이 없으면 아예 안 묻고 닫는다", async () => {
      const asking = ask(false);
      expect(await confirmClose(running, false, asking.fn)).toBe(true);
      expect(asking.count()).toBe(0);
    });
  });

  // 결정 105. 「명령」은 CONTEXT.md에 등록된 말이다 — 셸 안에서 도는 프로세스이지 셸 자신이
  // 아니다. `claude` 같은 프로그램 이름은 안 싣는다.
  it("확인 창은 도는 것을 「명령」이라 부르고 이름은 안 싣는다", () => {
    expect(CLOSE_NOTICE).toContain("명령");
    expect(CLOSE_NOTICE).toBe("실행 중인 명령이 있어요 — 닫을까요?");
    // **이름을 실을 재료가 없다는 것까지 여기서 드러난다.** 결정 92가 여는 커맨드가 주는
    // 것은 「도는가」 bool 하나뿐이라, 이 문구는 인자를 안 받는 **상수**다 — 이름을 끼워
    // 넣을 자리 자체가 없다. 이름을 받는 함수로 바뀌는 순간 이 줄이 빨개진다.
    expect(read("./shell-registry.ts")).toContain('export const CLOSE_NOTICE = "');
  });
});

// ⌘T가 xterm의 키 핸들러에만 붙어 있어 **셸이 0개면 들을 사람이 없었다**(결정 93).
// window에서도 듣되 범위는 work 화면 전체다(결정 98) — ⌘1이 spec, ⌘2~9가 셸로 본문을
// 옮기는 한 벌에 ⌘T도 든다.
describe("window에서 듣는 ⌘T", () => {
  // **DOM 생성자를 세우지 않는다.** 한때 여기 `vi.stubGlobal` 두 줄이 있었고, 그것이 곧 이
  // 모듈의 「DOM 없는 기본 환경에서 그대로 돈다」가 이 함수에 대해 깨졌다는 흔적이었다
  // (노드에서 스텁 없이 부르면 `instanceof`가 터진다). 판정이 값 둘만 보게 되면서 스텁이
  // 필요 없어졌고, **그래서 이 describe 자체가 그 계약의 그물이다** — 전역을 다시 읽는
  // 순간 여기가 ReferenceError로 빨개진다.
  const el = (tagName: string) => Object.assign(new EventTarget(), { tagName });

  type WindowT = Parameters<typeof opensShellFromWindow>[0];
  const key = (over: Partial<WindowT> = {}): WindowT => ({
    type: "keydown",
    code: "KeyT",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    target: el("DIV"),
    ...over,
  });

  // 위 문장의 전제다. jsdom이 들어오면 「스텁 없이 돈다」가 이 seam에서 더는 관찰되지 않는다.
  it("이 seam에는 DOM 전역이 없다 — 위 검사들이 그것을 딛는다", () => {
    expect(globalThis).not.toHaveProperty("HTMLTextAreaElement");
    expect(globalThis).not.toHaveProperty("HTMLInputElement");
  });

  it("본문에 포커스가 있으면 연다 — 셸이 0개인 화면이 이 자리다", () => {
    expect(opensShellFromWindow(key())).toBe(true);
  });

  // **xterm의 입력 자리가 숨은 <textarea>다.** 셸 안에서는 xterm 핸들러가 이미 가져가므로
  // 여기서 또 들으면 한 번 눌러 둘이 열린다.
  it("셸 안에서는 안 듣는다 — xterm 핸들러가 이미 가져갔다", () => {
    expect(opensShellFromWindow(key({ target: el("TEXTAREA") }))).toBe(false);
  });

  it("제목 편집 중(<input>)·편집 가능 요소에서도 안 듣는다", () => {
    expect(opensShellFromWindow(key({ target: el("INPUT") }))).toBe(false);
    const editable = Object.assign(new EventTarget(), { isContentEditable: true });
    expect(opensShellFromWindow(key({ target: editable }))).toBe(false);
  });

  // 한때 `event.target as HTMLElement`로 좁혀 놓고 `isContentEditable`을 읽어, 이 값이 오면
  // TypeError였다(`null instanceof X`는 false라 앞 가드를 그냥 통과한다).
  it("포커스가 아무 데도 없어도 안 터진다", () => {
    expect(opensShellFromWindow(key({ target: null }))).toBe(true);
  });

  // 판정 둘이 **갈려 있다.** ⌘W도 이제 window에서 듣지만(결정 13) 그것은 아래 describe의
  // 함수다 — 한 함수가 둘을 겸하면 부르는 쪽이 「무엇이 눌렸나」를 다시 갈라야 하고,
  // ⌘T만 듣는 화면(셸 0개)에서 ⌘W가 함께 새어 들어온다.
  it("⌘W는 이 판정으로는 안 온다", () => {
    expect(opensShellFromWindow(key({ code: "KeyW" }))).toBe(false);
  });

  it.each(["ctrlKey", "altKey", "shiftKey"] as const)("%s가 더 붙으면 아니다", (extra) => {
    expect(opensShellFromWindow(key({ [extra]: true }))).toBe(false);
  });

  it("⌘ 없이 T만은 아니다 — 그냥 글자다", () => {
    expect(opensShellFromWindow(key({ metaKey: false }))).toBe(false);
  });
});

// ⌘W도 window에서 듣는다(결정 13). `opensShellFromWindow`의 머리말은 한때 그 반대를
// 적고 있었다 — 「겨눌 칸은 셸에 포커스가 있을 때만 뚜렷하다」. **탭 줄이 그 전제를
// 없앤다**(adr-03): 켜진 칸이 화면에 서 있으므로 포커스가 탭 버튼에 있든 `+`에 있든
// 겨눌 것이 하나로 정해진다. 무엇을 닫을지는 화면이 알고, 여기서는 「그 키가 맞나」만 본다.
describe("window에서 듣는 ⌘W", () => {
  const el = (tagName: string) => Object.assign(new EventTarget(), { tagName });

  type WindowT = Parameters<typeof closesShellFromWindow>[0];
  const key = (over: Partial<WindowT> = {}): WindowT => ({
    type: "keydown",
    code: "KeyW",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    target: el("DIV"),
    ...over,
  });

  // 탭을 눌러 고른 직후가 이 자리다 — 그때 포커스는 그 버튼에 있고 xterm에 없다.
  it("본문·탭 줄에 포커스가 있으면 닫는다", () => {
    expect(closesShellFromWindow(key())).toBe(true);
  });

  // **xterm의 입력 자리가 숨은 <textarea>다.** 셸 안에서는 그쪽 핸들러가 이미 같은 길
  // (`requestCloseShell`)로 보내므로 여기서 또 들으면 확인 창이 두 번 뜬다.
  it("셸 안에서는 안 듣는다 — xterm 핸들러가 이미 가져갔다", () => {
    expect(closesShellFromWindow(key({ target: el("TEXTAREA") }))).toBe(false);
  });

  it("글을 치는 자리에서는 안 듣는다", () => {
    expect(closesShellFromWindow(key({ target: el("INPUT") }))).toBe(false);
    const editable = Object.assign(new EventTarget(), { isContentEditable: true });
    expect(closesShellFromWindow(key({ target: editable }))).toBe(false);
  });

  it("포커스가 아무 데도 없어도 안 터진다", () => {
    expect(closesShellFromWindow(key({ target: null }))).toBe(true);
  });

  it("⌘T는 이 판정으로는 안 온다", () => {
    expect(closesShellFromWindow(key({ code: "KeyT" }))).toBe(false);
  });

  it.each(["ctrlKey", "altKey", "shiftKey"] as const)("%s가 더 붙으면 아니다", (extra) => {
    expect(closesShellFromWindow(key({ [extra]: true }))).toBe(false);
  });

  it("⌘ 없이 W만은 아니다 — 그냥 글자다", () => {
    expect(closesShellFromWindow(key({ metaKey: false }))).toBe(false);
  });
});

// 결정 78·79·80·99·109. ⌘1~9와 ⌃Tab 짝 — **한 화면 안에서 본문을 옮기는 한 벌**이다.
// 앞 판의 「사이드바 N번째 작업 열기」가 걷혔다. 여기서도 실물로 못 잡는 자리가 있어
// (「셸에 이 키가 안 간다」는 핸들러의 반환값이 정하고 정적 렌더에는 안 보인다) 판정만 뗀다.
describe("본문을 옮기는 키", () => {
  type NavT = Parameters<typeof shellNavFromWindow>[0];
  const el = (tagName: string, className?: string) =>
    Object.assign(new EventTarget(), className === undefined ? { tagName } : { tagName, className });
  const key = (over: Partial<NavT> = {}): NavT => ({
    type: "keydown",
    code: "Digit2",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    target: el("DIV"),
    ...over,
  });

  it("⌘1~9가 그 자리를 가리킨다", () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(shellNavKey(key({ code: `Digit${n}` }))).toEqual({ kind: "index", n });
    }
  });

  // 자리는 1부터 센다. ⌘0을 받으면 `n`이 0이 되어 부르는 화면마다 다른 뜻이 된다.
  it("⌘0은 아니다", () => {
    expect(shellNavKey(key({ code: "Digit0" }))).toBeNull();
  });

  it("⌃Tab은 앞으로, ⌃⇧Tab은 뒤로", () => {
    const tab = { code: "Tab", ctrlKey: true, metaKey: false } as const;
    expect(shellNavKey(key(tab))).toEqual({ kind: "cycle", delta: 1 });
    expect(shellNavKey(key({ ...tab, shiftKey: true }))).toEqual({ kind: "cycle", delta: -1 });
  });

  // 결정 79. ⌃는 셸 몫이라는 결정 29에 **이 짝만** 예외를 냈다 — 규칙 자체를 넓히지 않는다.
  it("⌘⌃Tab·⌥⌃Tab은 아니다 — 예외는 그 짝뿐이다", () => {
    expect(shellNavKey(key({ code: "Tab", ctrlKey: true, metaKey: true }))).toBeNull();
    expect(shellNavKey(key({ code: "Tab", ctrlKey: true, metaKey: false, altKey: true }))).toBeNull();
  });

  it.each(["ctrlKey", "altKey", "shiftKey"] as const)("숫자에 %s가 더 붙으면 아니다", (extra) => {
    expect(shellNavKey(key({ [extra]: true }))).toBeNull();
  });

  it("⌘ 없이 숫자만은 아니다 — 그냥 글자다", () => {
    expect(shellNavKey(key({ metaKey: false }))).toBeNull();
  });

  it.each(["keypress", "keyup"])("%s는 아니다", (type) => {
    expect(shellNavKey(key({ type }))).toBeNull();
  });

  // 결정 99. 셸을 붙일 때마다 xterm이 스스로 포커스를 가져가므로, 여기서 안 가르면
  // 터미널 화면에서 ⌘2~9와 ⌃Tab이 **영영 안 먹는다**. 앱 몫이되 셸이 처리하지는 않는다.
  it("셸도 이 키를 타이핑하지 않는다", () => {
    expect(shellHotkey(key())).toBe("app");
    expect(shellHotkey(key({ code: "Tab", ctrlKey: true, metaKey: false }))).toBe("app");
    // ⌘T·⌘W는 그대로다 — 새 갈래가 그것들을 삼키면 새 칸도 닫기도 죽는다.
    expect(shellHotkey(key({ code: "KeyT" }))).toBe("new");
    expect(shellHotkey(key({ code: "KeyW" }))).toBe("close");
  });

  // **셸 안에서 듣는다는 것이 ⌘T와 갈리는 자리다.** 저쪽은 xterm 핸들러가 이미 열어 주므로
  // 비켜야 하고, 이쪽은 xterm이 처리하지 않고 흘려보내므로 여기가 유일한 처리자다.
  it("셸 안에서도 듣는다 — 그 화면이 곧 정상 상태다", () => {
    const shellInput = el("TEXTAREA", "xterm-helper-textarea");
    expect(shellNavFromWindow(key({ target: shellInput }))).toEqual({ kind: "index", n: 2 });
  });

  it("제목 편집 중(<input>)·편집 가능 요소에서는 안 듣는다", () => {
    expect(shellNavFromWindow(key({ target: el("INPUT") }))).toBeNull();
    const editable = Object.assign(new EventTarget(), { isContentEditable: true });
    expect(shellNavFromWindow(key({ target: editable }))).toBeNull();
  });

  // xterm의 것만 예외다. 남의 `<textarea>`까지 통과시키면 「입력 중에는 안 먹는다」가
  // 이름만 남는다.
  it("xterm의 것이 아닌 <textarea>에서는 안 듣는다", () => {
    expect(shellNavFromWindow(key({ target: el("TEXTAREA") }))).toBeNull();
    expect(shellNavFromWindow(key({ target: el("TEXTAREA", "prose") }))).toBeNull();
  });

  it("포커스가 아무 데도 없어도 안 터진다", () => {
    expect(shellNavFromWindow(key({ target: null }))).toEqual({ kind: "index", n: 2 });
  });
});

// 결정 3·4·30. ⇧를 두 번 누르면 검색이 열린다. **타이머 없는 순수 리듀서라** 가짜 시계가
// 필요 없다 — 시각을 인자로 넣는다. 이 판정이 이 모듈에 있는 것은 「비키는 자리」 규칙이
// 여기 한 벌 있어서다(`typesInto`·`isShellInput`): 새 모듈에 다시 적으면 판정이 둘로
// 갈리고 한쪽만 고쳐진 채 오래 간다.
describe("⇧⇧가 검색을 연다", () => {
  const el = (tagName: string, className?: string) =>
    Object.assign(new EventTarget(), className === undefined ? { tagName } : { tagName, className });

  type ShiftT = Parameters<typeof searchHotkey>[0];
  const key = (over: Partial<ShiftT> = {}): ShiftT => ({
    type: "keydown",
    code: "ShiftLeft",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    // **⇧ 자신의 keydown에는 이 값이 이미 참이다.** 판정이 `shiftKey`로 갈리면 한 번도
    // 무장하지 않는다 — 여기 기본값이 그 함정을 그대로 재현해 둔 것이다.
    shiftKey: true,
    target: el("DIV"),
    at: 1000,
    ...over,
  });

  /** ⇧를 두 번 눌러 본다 — 둘째의 시각만 갈린다. */
  const twice = (gap: number, first: Partial<ShiftT> = {}, second: Partial<ShiftT> = {}) => {
    const armed = searchHotkey(key({ at: 1000, ...first }), null);
    return searchHotkey(key({ at: 1000 + gap, ...second }), armed.armedAt);
  };

  it("간격 안에 두 번 누르면 열린다", () => {
    expect(searchHotkey(key(), null)).toEqual({ open: false, armedAt: 1000 });
    expect(twice(120).open).toBe(true);
  });

  // 오른쪽 ⇧로 두 번, 좌우를 섞어도 같다 — 사람이 그렇게 누른다.
  it("좌우 어느 ⇧든, 섞여도 열린다", () => {
    expect(twice(120, { code: "ShiftRight" }, { code: "ShiftRight" }).open).toBe(true);
    expect(twice(120, { code: "ShiftLeft" }, { code: "ShiftRight" }).open).toBe(true);
  });

  // 상수가 **이름으로** 존재하고 그 값이 경계다. 여기서 값을 다시 적지 않는다 —
  // 상수를 바꾸면 이 검사가 함께 따라가야 「그 값이 경계다」가 유지된다.
  it("간격을 넘기면 안 열리고, 그 ⇧가 다시 무장한다", () => {
    expect(twice(SEARCH_GAP_MS).open).toBe(true);
    const late = twice(SEARCH_GAP_MS + 1);
    expect(late.open).toBe(false);
    expect(late.armedAt).toBe(1000 + SEARCH_GAP_MS + 1);
  });

  // 세 번째 ⇧가 붙으면 열려야 한다 — 위 「다시 무장한다」가 그것을 위한 것이다.
  it("느리게 눌러 놓친 뒤 한 번 더 누르면 열린다", () => {
    const late = twice(SEARCH_GAP_MS + 1);
    expect(searchHotkey(key({ at: 2000 }), late.armedAt).open).toBe(false);
    const third = searchHotkey(key({ at: 1000 + SEARCH_GAP_MS + 1 + 100 }), late.armedAt);
    expect(third.open).toBe(true);
  });

  // **사이에 다른 키가 끼면 취소다.** 대문자 `A`를 치는 동안이 그 모양이고(`Shift↓ A↓ Shift↓`),
  // 한글 입력기가 켜져 있으면 `ㄲ`이 같은 자리다 — 그래서 `key`가 아니라 `code`로 본다.
  it("⇧ 사이에 다른 키가 끼면 안 열린다", () => {
    const armed = searchHotkey(key({ at: 1000 }), null);
    const typed = searchHotkey(key({ at: 1050, code: "KeyA" }), armed.armedAt);
    expect(typed).toEqual({ open: false, armedAt: null });
    expect(searchHotkey(key({ at: 1100 }), typed.armedAt).open).toBe(false);
  });

  it("⇧에 다른 수식키가 붙으면 무장하지 않는다", () => {
    for (const extra of ["metaKey", "ctrlKey", "altKey"] as const) {
      expect(searchHotkey(key({ [extra]: true }), null)).toEqual({ open: false, armedAt: null });
    }
  });

  it("keyup은 아무것도 안 한다 — 무장을 세우지도 풀지도 않는다", () => {
    // ⇧를 눌렀다 떼는 것 자체가 keydown·keyup 한 쌍이다. 뗀 것을 취소로 읽으면 한 번도
    // 안 열리고, 무장으로 읽으면 한 번 눌러 열린다.
    expect(searchHotkey(key({ type: "keyup" }), null)).toEqual({ open: false, armedAt: null });
    expect(searchHotkey(key({ type: "keyup", at: 1050 }), 1000)).toEqual({
      open: false,
      armedAt: 1000,
    });
  });

  // 결정 4. 이 앱에서 포커스가 가 있는 시간이 제일 긴 곳이 셸이다 — 거기서 안 먹으면
  // 검색이 「먼저 다른 데를 클릭하고 나서 여는 것」이 된다. ⇧ 단독은 셸이 아무 바이트도
  // 안 보내므로 가로채도 잃는 것이 없다.
  it("셸 안에서는 열린다 — xterm의 숨은 입력칸만 예외다", () => {
    const shellInput = el("TEXTAREA", "xterm-helper-textarea");
    expect(twice(120, { target: shellInput }, { target: shellInput }).open).toBe(true);
  });

  // work 이름을 고치는 입력칸에서는 비킨다 — 이름에 대문자를 쓸 수 있어야 한다.
  it("글을 치는 자리에서는 안 열린다", () => {
    for (const target of [el("INPUT"), el("TEXTAREA")]) {
      expect(twice(120, { target }, { target }).open).toBe(false);
    }
    const editable = Object.assign(new EventTarget(), { isContentEditable: true });
    expect(twice(120, { target: editable }, { target: editable }).open).toBe(false);
  });

  // 밖에서 무장한 뒤 입력칸으로 들어가도 안 열린다 — 그 자리의 키는 무장을 지키지도 않는다.
  it("입력칸으로 들어가면 무장이 풀린다", () => {
    expect(twice(120, {}, { target: el("INPUT") })).toEqual({ open: false, armedAt: null });
  });

  it("포커스가 아무 데도 없어도 안 터진다", () => {
    expect(twice(120, { target: null }, { target: null }).open).toBe(true);
  });

  // **mousedown은 이 함수 밖이다**(결정 30). 키만 보면 ⇧+클릭 두 번이 팔레트를 여는데,
  // 그 사이에 keydown이 하나도 안 끼기 때문이다 — 여기서는 그 사실을 못박아만 둔다.
  // 실제로 무장을 비우는 것은 앱 셸이고, 그것을 재는 자리는 L3다.
  it("클릭은 이 판정에 안 온다 — 무장이 그대로 남는다", () => {
    expect(searchHotkey(key({ type: "mousedown" }), 1000)).toEqual({ open: false, armedAt: 1000 });
  });
});

// 결정 80. 끝에서 **돌아온다** — 여덟 번째에서 다음을 누르면 첫 칸이다. 안 돌아오면
// 순회가 아니라 「끝까지 밀기」가 되어 마지막 칸에서 키가 죽은 것처럼 보인다.
describe("셸 순회", () => {
  it("다음 칸으로 가고 끝에서 돌아온다", () => {
    const { state, ids } = opened(3);
    const shells = shellsOf(state, null);
    expect(cycleShell(shells, ids[0], 1)).toBe(ids[1]);
    expect(cycleShell(shells, ids[2], 1)).toBe(ids[0]);
    expect(cycleShell(shells, ids[0], -1)).toBe(ids[2]);
  });

  // 켜진 칸이 없는 화면이 실재한다 — 마지막 칸을 `×`로 닫으면 그 자리다.
  it("켜진 칸이 없으면 방향에 따라 양 끝이다", () => {
    const { state, ids } = opened(3);
    const shells = shellsOf(state, null);
    expect(cycleShell(shells, null, 1)).toBe(ids[0]);
    expect(cycleShell(shells, null, -1)).toBe(ids[2]);
  });

  it("셸이 없으면 갈 곳이 없다", () => {
    expect(cycleShell([], null, 1)).toBeNull();
  });
});

// 판 04 spec의 「스토어 구독의 자리 — 이 판에서 가장 조심할 곳」. 가지가 **하나가 아니다** —
// 셸이 도는 work마다 선다(결정 73). 통째로 비교하면 work A의 셸이 프롬프트마다 쏘는 OSC
// 타이틀 하나에 work B·C의 셸 행이 함께 다시 그려진다.
describe("가지가 다시 그려져야 하는가", () => {
  const two = () => {
    let state = NO_SHELLS;
    const mine = openShell(state, { owner: "가", project: null, cwd: "~/가" })!;
    state = mine.state;
    const theirs = openShell(state, { owner: "나", project: null, cwd: "~/나" })!;
    return { state: theirs.state, mine: mine.id, theirs: theirs.id };
  };

  it("남의 셸이 타이틀을 쏘면 안 다시 그린다", () => {
    const { state, theirs } = two();
    expect(sameScreen(state, setTitle(state, theirs, "claude"), "가")).toBe(true);
  });

  it("내 셸이 타이틀을 쏘면 다시 그린다", () => {
    const { state, mine } = two();
    expect(sameScreen(state, setTitle(state, mine, "claude"), "가")).toBe(false);
  });

  // 상한 문구가 **앱 전체**를 센다(결정 30) — 남의 화면에 셸이 하나 늘면 「지금 N개」가 바뀐다.
  it("남의 셸이 열리면 다시 그린다 — 상한 문구가 앱 전체를 센다", () => {
    const { state } = two();
    const more = openShell(state, { owner: "나", project: null, cwd: "~/나" })!.state;
    expect(sameScreen(state, more, "가")).toBe(false);
  });

  it("내 켜진 칸이 바뀌면 다시 그린다", () => {
    const { state, mine } = two();
    const another = openShell(state, { owner: "가", project: null, cwd: "~/가" })!;
    expect(sameScreen(another.state, activateShell(another.state, mine), "가")).toBe(false);
  });

  // 최상위 터미널의 가지도 같은 규칙을 딛는다 — owner가 `null`일 뿐이다.
  it("최상위 가지도 남의 타이틀에 안 흔들린다", () => {
    const { state, mine } = two();
    expect(sameScreen(state, setTitle(state, mine, "claude"), null)).toBe(true);
  });
});

// 결정 78·109. 두 화면이 **같은 자리를 딛는다** — 갈리는 것은 「⌘몇이 첫 셸인가」 하나다.
// 따로 두면 순회가 한쪽에서만 끝에서 돌아오거나, 한쪽만 자리를 밀어 마지막 셸을 영영
// 못 고르게 된다(실제로 그 둘이 두 벌로 적혀 있었다).
describe("키가 가리키는 셸", () => {
  const shells = () => shellsOf(opened(3).state, null);

  it("최상위 터미널은 ⌘1이 첫 셸이다", () => {
    const list = shells();
    expect(shellForNav(list, null, { kind: "index", n: 1 }, 1)).toBe(list[0].id);
    expect(shellForNav(list, null, { kind: "index", n: 3 }, 1)).toBe(list[2].id);
  });

  // work 화면은 ⌘1이 spec이라 자리가 한 칸 밀린다 — 그 밀림이 이 숫자다.
  it("work 화면은 ⌘2가 첫 셸이다", () => {
    const list = shells();
    expect(shellForNav(list, null, { kind: "index", n: 2 }, 2)).toBe(list[0].id);
    expect(shellForNav(list, null, { kind: "index", n: 4 }, 2)).toBe(list[2].id);
    // ⌘1은 셸이 아니다 — 화면이 spec으로 가른 뒤라 여기 오면 갈 곳이 없다.
    expect(shellForNav(list, null, { kind: "index", n: 1 }, 2)).toBeNull();
  });

  it("없는 자리는 아무 일도 없다", () => {
    expect(shellForNav(shells(), null, { kind: "index", n: 9 }, 1)).toBeNull();
  });

  it("순회는 같은 규칙을 딛는다 — 밀림과 무관하다", () => {
    const list = shells();
    for (const firstKey of [1, 2]) {
      expect(shellForNav(list, list[0].id, { kind: "cycle", delta: 1 }, firstKey)).toBe(list[1].id);
      expect(shellForNav(list, list[2].id, { kind: "cycle", delta: 1 }, firstKey)).toBe(list[0].id);
    }
  });
});

// 위 판정 셋은 순수 함수라 전수됐지만, **그것을 실제로 쓰는 자리**는 xterm의 키 핸들러와
// 스토어라 어느 seam에도 안 보인다 — 정적 렌더는 이펙트도 키 이벤트도 안 돌리고, 노드
// seam은 `@xterm/xterm`을 끌고 오는 모듈을 못 들인다.
//
// 그래서 소스로 못박되 **표현식을 통째로** 못박는다. 이름이 어딘가 있는지만 보면 가드가
// 뒤집혀도 초록인 change-detector가 된다 — 실측으로 그랬다: `if (!opensShellFromWindow(e))`의
// `!` 하나를 지워 ⌘T가 영영 안 먹게 만들어도 485건이 전부 초록이었다.
describe("판정 셋이 실제로 배선돼 있다", () => {
  const store = read("./terminal-store.ts");

  it("⌘T·⌘W가 셸 안에서 갈리는 자리", () => {
    expect(store).toContain('if (hotkey === "new") openNewShell(instance.origin);');
    expect(store).toContain("else void requestCloseShell(instance.id);");
  });

  // **⌘W와 `×`가 같은 판정을 쓴다**(결정 92). 「`closeShell`을 밖으로 안 내보냈다」는 근거는
  // ⌘W에 대해 거짓이다 — 그 핸들러가 `closeShell`과 **같은 모듈**에 살아 비공개가 아무것도
  // 막지 못한다(실측: `requestCloseShell`을 `closeShell`로 되돌려도 tsc가 exit 0이었다).
  // 타입으로 못 막으니 **자리를 센다**: 확인을 건너뛰는 이름을 부르는 곳은 셋뿐이다.
  it("확인을 건너뛰는 길이 셋뿐이다 — 정의·확인을 마친 뒤·아카이빙 회수", () => {
    // 정의. 밖으로 안 나가는 것은 `×`(모듈 밖)에 대해서는 여전히 유효한 절반이다.
    expect(store).toContain("function closeShell(id: number): void {");
    // 확인을 마친 뒤. `!`가 빠지거나 `confirmClose`가 통째로 사라지면 여기가 빨개진다.
    expect(store).toContain(
      "if (!(await confirmClose(shell, await commandRunning(id), ask))) return;",
    );
    // 아카이빙 회수. 그 길에는 사람이 이미 한 번 확인했다(결정 26의 순서).
    expect(store).toContain(
      "for (const shell of shellsOf(terminalStore.state, owner)) closeShell(shell.id);",
    );
    // 넷째가 생기면 확인을 건너뛰는 길이 하나 더 난 것이다. `requestCloseShell(`은 대문자
    // `C` 때문에 이 부분문자열에 안 걸린다 — 그래서 세는 것으로 충분하다.
    expect(
      countOf(store, "closeShell("),
      "`closeShell`을 직접 부르는 자리가 늘었다 — ⌘W·`×`는 `requestCloseShell`만 부른다",
    ).toBe(3);
  });

  // ⇧Enter(결정 91). `shellRewrite` 자체는 위에서 전수됐지만 **그것을 쓰는지**가 무테였다 —
  // 판정을 `null` 고정으로 바꿔 기능을 통째로 죽여도 485건이 초록이었다.
  it("⇧Enter가 `shellRewrite`를 딛는다", () => {
    expect(store).toContain("const rewrite = shellRewrite(event);");
    expect(store).toContain("if (rewrite !== null) {");
  });

  // 이 모듈이 80줄 위에서 스스로 적어 둔 계약이다 — `onData`가 **유일한 출구**로 남아야
  // `pty_write`가 한 곳에서 나가고, xterm이 스스로 보내는 것과 순서도 안 뒤집힌다(IME 다리가
  // capture로 먼저 돈다). ⇧Enter가 한글 조합 중에 걸리는 자리라 예외를 둘 곳이 아니다.
  it("바뀐 바이트도 `onData` 하나로 나간다", () => {
    // **`return false`까지 한 리터럴로 잡는다.** 그 한 줄이 「바꿔 보낸다」와 「덧붙여
    // 보낸다」를 가른다 — `true`를 주면 xterm이 그 키를 계속 처리해 우리가 넣은 `\x1b\r`과
    // xterm이 만든 `\r`이 **둘 다** 나가고, `claude` 프롬프트에서 줄이 바뀌면서 동시에
    // 제출된다(결정 91이 없애려던 증상 그 자체다). 따로 못박으면 안 된다 — 이 파일에
    // `return false;`가 둘이라 위 hotkey 분기가 대신 통과시킨다.
    expect(store).toContain("      term.input(rewrite, true);\n      return false;");
    // **파일 전체에서 하나다.** 핸들러 안만 보면 두 번째 출구가 다른 함수로 옮겨 가는 것을
    // 못 본다 — 계약이 말하는 것은 「`onData`가 유일한 출구」이지 「이 핸들러가 안 쓴다」가
    // 아니다.
    expect(
      countOf(store, "terminalApi.write("),
      "쓰기 출구가 둘이 됐다 — `pty_write`는 `onData` 한 곳에서만 나가야 한다",
    ).toBe(1);
  });

  // 결정 98이 `/terminal`에도 같은 판정을 세웠다. WorksPage 쪽 배선은 그 화면의 검사가
  // 이펙트째로 못박는다.
  it("`/terminal`이 같은 판정을 같은 방향으로 딛고, 그 핸들러가 window에 걸린다", () => {
    const page = read("./TerminalPage.tsx");
    expect(page).toContain("if (!opensShellFromWindow(e)) return;");
    expect(page).toContain("openNewShell(TOP_TERMINAL);");
    // **가드만 보면 핸들러가 window에 안 걸려도 초록이다.** 등록 한 줄을 지워도 가드는
    // `onKeyDown` 안에 그대로 남고, 정리 함수가 그것을 계속 참조하므로 tsc도 안 막는다.
    // 그러면 `/terminal`에서 마지막 칸을 닫은 뒤 ⌘T가 다시 안 먹는다 — 결정 93의 원래
    // 증상이고 결정 98의 「`/terminal`에서도 같다」가 깨진다. 이 화면을 보는 검사는
    // 저장소에서 여기뿐이라 다른 층이 받아 주지 않는다.
    // **가드만 보면 핸들러가 window에 안 걸려도 초록이다.** 등록 한 줄을 지워도 가드는
    // `onKeyDown` 안에 그대로 남고, 정리 함수가 그것을 계속 참조하므로 tsc도 안 막는다.
    // 이 화면이 window에서 듣는 자리는 **셋이다** — ⌘T(결정 93·98), 본문을 옮기는
    // ⌘1~9·⌃Tab(결정 78·79), 그리고 **⌘W**(결정 13 — 탭 줄이 서면서 겨눌 칸이 화면에
    // 생겼다). 하나로 줄면 그중 한 벌이 통째로 죽은 것이다.
    expect(
      countOf(page, 'window.addEventListener("keydown", onKeyDown);'),
      "window에서 키를 듣는 자리가 셋이 아니다 — ⌘T · ⌘1~9·⌃Tab · ⌘W",
    ).toBe(3);
  });

  // 결정 78·79·109. work 화면과 갈리는 자리는 ⌘1 하나뿐이고(거기서는 spec), 여기서는
  // 문서가 없어 ⌘1부터가 셸이다. 그 어긋남을 화면이 흡수한다 — 판정은 한 벌이다.
  it("`/terminal`의 ⌘1~9는 **이 화면의 셸**을 센다", () => {
    const page = read("./TerminalPage.tsx");
    expect(page).toContain("const nav = shellNavFromWindow(e);");
    // `owner`가 `null`이 아니면 남의 화면 셸을 센다(결정 109가 막는 것).
    expect(page).toContain("const shells = shellsOf(state, null);");
    // 자리를 밀지 않는다 — `2`가 되면 ⌘1이 아무 일도 안 하고 ⌘2가 첫 셸이 된다.
    expect(page).toContain("shellForNav(shells, activeIdOf(state, null), nav, 1)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// adr-04. 백엔드가 1초마다 재서 **바뀐 셸만** 실어 보내는 「지금 도는 것」이 목록에 앉는다.
// 뒤에 오는 두 화면(탭 칸의 로고 · 사이드바 행의 로고)이 **같은 함수**를 봐야 해서 여기 있다 —
// 두 곳이 각자 세면 「사이드바는 종류만, 탭은 칸마다」(결정 4)가 화면마다 갈린다.

describe("셸에 「지금 도는 것」이 앉는다", () => {
  it("이름이 그 칸에 그대로 앉는다 — 접지 않는다", () => {
    const { state, ids } = opened(1);
    // 원문 그대로여야 한다(adr-04). 백엔드가 「claude냐」를 알면 에이전트가 늘 때마다
    // Rust를 고쳐야 하고, 프런트가 여기서 접으면 로고 매핑이 두 벌이 된다.
    expect(setRunning(state, ids[0], "claude").shells[0].running).toBe("claude");
  });

  it("아직 아무것도 안 온 칸은 비어 있다", () => {
    expect(opened(1).state.shells[0].running).toBeNull();
  });

  it("명령이 끝나면 지워진다", () => {
    const { state, ids } = opened(1);
    const 도는중 = setRunning(state, ids[0], "cargo");
    expect(setRunning(도는중, ids[0], null).shells[0].running).toBeNull();
  });

  // **초마다 모든 화면이 다시 그려지는 것을 막는 자리다.** 백엔드가 안 바뀐 값을 안 쏘지만
  // (`changes`) 그 한 겹에만 기대지 않는다 — 같은 값이 두 번 오면 여기서 끊긴다.
  it("같은 값이 다시 와도 상태가 그대로다", () => {
    const { state, ids } = opened(1);
    const 앉은뒤 = setRunning(state, ids[0], "claude");
    expect(setRunning(앉은뒤, ids[0], "claude")).toBe(앉은뒤);
    expect(setRunning(state, ids[0], null)).toBe(state);
  });

  // 이벤트와 제거가 경주한다 — 이미 닫힌 칸에 대한 값이 늦게 도착한다.
  it("모르는 id로는 아무것도 앉지 않는다", () => {
    const { state } = opened(1);
    expect(setRunning(state, 9999, "claude")).toBe(state);
  });
});

describe("끝난 칸은 아무것도 안 돌린다", () => {
  it("도는 칸은 앉은 값을 그대로 준다", () => {
    const { state, ids } = opened(1);
    expect(runningOn(setRunning(state, ids[0], "claude").shells[0])).toBe("claude");
  });

  // **마지막 값이 굳는 것을 막는다.** 백엔드도 풀에서 빠진 셸을 한 번 지우지만(`changes`),
  // 그 이벤트와 종료 프레임의 순서는 보장되지 않는다 — 지움이 먼저 오면 죽은 칸에 claude
  // 로고가 그대로 남는다. 상태로 가르면 순서가 무의미해진다.
  it("신호로 죽은 칸은 돌던 것이 있어도 없다", () => {
    const { state, ids } = opened(1);
    const 돌던칸 = setRunning(state, ids[0], "claude");
    const 죽은뒤 = markExited(돌던칸, ids[0], { exitCode: 1, signal: "Terminated: 15" });
    expect(runningOn(죽은뒤.shells[0])).toBeNull();
  });

  it("못 뜬 칸도 없다", () => {
    const { state, ids } = opened(1);
    const 돌던칸 = setRunning(state, ids[0], "claude");
    expect(runningOn(markFailed(돌던칸, ids[0], "폴더가 없습니다").shells[0])).toBeNull();
  });
});

describe("work가 도는 것의 **종류**를 말한다", () => {
  const 가 = { owner: "가", project: null, cwd: null };

  // 결정 4. claude가 둘 돌아도 사이드바의 로고는 하나다 — 목록은 「뭐가 도나」를 말하지
  // 「몇 개 도나」를 말하지 않는다(개수는 `⌨3`이 이미 말한다).
  it("같은 것이 둘 돌면 **두 번** 들어 있다 — 세는 일은 그리는 쪽이다", () => {
    // 결정 28. 여기서 접으면 `Map`이나 `Record`가 되고, 그러면 회차마다 새 객체라 사이드바
    // 행의 얕은 비교가 늘 어긋나 목록 전체가 초마다 다시 그려진다(`shellCountsOf`의 함정).
    const { state, ids } = opened(2, 가);
    let 지금 = setRunning(state, ids[0], "claude");
    지금 = setRunning(지금, ids[1], "claude");
    expect(runningAgentsOf(지금, "가")).toEqual(["claude", "claude"]);
  });

  it("다른 것이 돌면 둘 다 말하고, 순서는 칸 순서다", () => {
    const { state, ids } = opened(2, 가);
    let 지금 = setRunning(state, ids[0], "codex");
    지금 = setRunning(지금, ids[1], "claude");
    expect(runningAgentsOf(지금, "가")).toEqual(["codex", "claude"]);
  });

  it("아무것도 안 도는 work는 빈 목록이다", () => {
    expect(runningAgentsOf(opened(2, 가).state, "가")).toEqual([]);
  });

  it("남의 work에서 도는 것은 안 센다", () => {
    const { state, ids } = opened(1, 가);
    const 나 = openShell(state, { owner: "나", project: null, cwd: null })!;
    let 지금 = setRunning(나.state, ids[0], "claude");
    지금 = setRunning(지금, 나.id, "cargo");
    expect(runningAgentsOf(지금, "가")).toEqual(["claude"]);
    expect(runningAgentsOf(지금, "나")).toEqual(["cargo"]);
  });

  // `runningOn`을 딛는다 — 여기서 상태를 한 번 더 가르면 같은 판정이 두 벌이 된다.
  it("죽은 칸이 돌던 것은 안 센다", () => {
    const { state, ids } = opened(1, 가);
    const 돌던칸 = setRunning(state, ids[0], "claude");
    const 죽은뒤 = markFailed(돌던칸, ids[0], "폴더가 없습니다");
    expect(runningAgentsOf(죽은뒤, "가")).toEqual([]);
  });
});

// 결정 2·3. **행 오른쪽 끝의 메타가 서는 조건**이자 그 자리의 **무리마다의 수를 다 더한
// 값**이다(`⌨수`는 여기서 마크가 붙은 셸 수를 뺀 나머지다 — `ShellMeta`). 세는 자리를
// 새로 만들지 않고 이미 있는 이것으로 되는지 여기서 못박는다.
describe("work마다 셸이 몇 개인가", () => {
  const 가 = { owner: "가", project: null, cwd: null };

  it("소유자별로 센다", () => {
    const { state } = opened(2, 가);
    const 나 = openShell(state, { owner: "나", project: null, cwd: null })!;
    expect(shellCountsOf(나.state)).toEqual({ 가: 2, 나: 1 });
  });

  it("최상위 터미널의 셸은 어느 work에도 안 걸린다", () => {
    expect(shellCountsOf(opened(2).state)).toEqual({});
  });

  // **끝난 칸도 센다 — 그것이 결정 3이 원하는 것이다.** 메타가 서는 조건은 **안 변하는 값**
  // (셸을 포함하는가)이어야 하고, 명령이 끝날 때마다 값이 흔들리면 그 칸이 생겼다 사라져
  // 제목이 끊기는 자리가 좌우로 뛴다.
  it("끝난 칸도 센다 — 메타가 명령마다 생겼다 사라지면 안 된다", () => {
    const { state, ids } = opened(1, 가);
    const 죽은뒤 = markFailed(state, ids[0], "폴더가 없습니다");
    expect(shellCountsOf(죽은뒤)).toEqual({ 가: 1 });
  });
});

// 위 함수들은 순수해서 전수됐지만 **그것을 실제로 쓰는 자리**는 스토어라 어느 seam에도
// 안 보인다(위 「판정 셋이 실제로 배선돼 있다」와 같은 자리·같은 이유). 소스로 못박는다.
describe("도는 명령이 프런트 상태까지 오는 배선", () => {
  it("이벤트 이름이 백엔드와 **같은 문자열**이다", () => {
    // 이 둘은 문자열로만 이어져 있다 — 한쪽을 고치면 아무 일도 안 일어나고 컴파일도
    // 타입 검사도 통과한다(`tauri-commands.test.ts`가 invoke 이름에 대해 막는 것과 같다).
    expect(read("../../../src-tauri/src/pty.rs")).toContain(
      'const RUNNING_EVENT: &str = "pty:running";',
    );
    expect(read("./api.ts")).toContain('const PTY_RUNNING = "pty:running";');
  });

  it("pty id를 레지스트리 id로 바꿔 앉힌다", () => {
    const store = read("./terminal-store.ts");
    // **이 한 줄이 없으면 값이 엉뚱한 칸에 앉는다.** 이벤트가 싣는 것은 pty id이고
    // 레지스트리의 id는 이 모듈이 따로 발급한 번호라 둘은 다른 값이다(`ShellInstance.ptyId`).
    expect(store).toContain("const id = shellOfPty(one.id);");
    // 모르는 pty id는 건너뛴다 — 이 왕복 사이에 `×`로 닫힌 칸이 실제로 온다. 그리고 값은
    // **그대로** 앉는다: 여기서 접으면 로고 매핑이 두 벌이 된다(adr-04).
    expect(store).toContain("if (id !== null) next = setRunning(next, id, one.running);");
  });
});
