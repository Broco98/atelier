/// <reference types="node" />
// 소스 스캔(파일 읽기·디렉터리 훑기) 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts
// 머리말과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
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
  countQuitShells,
  markExited,
  markFailed,
  markSeen,
  isInPlaceGap,
  MAX_SHELLS,
  moveShell,
  needsCloseConfirm,
  NO_SHELLS,
  openShell,
  placeHint,
  placeOrigin,
  closesShellFromWindow,
  opensShellFromWindow,
  quitNotice,
  removeShell,
  runningAgentsOf,
  runningOn,
  runningShellsOf,
  searchHotkey,
  setAttention,
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
  modeOfOwner,
  ownerIn,
  ownerOf,
  sameScreen,
  shellForNav,
  shellHotkey,
  slugOfOwner,
  topTerminal,
  workDefaultOrigin,
  workShellOrigin,
  workShellProjects,
} from "./shell-registry";
import type { Shell, ShellOrigin, ShellOwner, ShellsState } from "./shell-registry";
import { attentionOn } from "./shell-attention";
import type { Attention } from "./shell-attention";
import type { WorkView, WorktreeView } from "@/features/works/types";
// 모드 목록을 **표에서** 받는다 — 여기 손으로 둘을 적으면 세계가 셋이 되는 날 이 파일만
// 조용히 둘을 재고, 그때 빠지는 것이 정확히 이 판이 지키려는 불변식이다.
import { ALL_MODES } from "@/mode";

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

// 아래 목록 조작 검사들은 **세계를 안 가른다** — 목록·상한·켜진 칸의 규칙은 소유자가
// 무엇이든 같아서다. 세계가 갈리는 불변식은 위 「셸의 소유자 키」와 아래 `shellCountsOf`의
// 검사가 따로 붙든다. 그래서 여기서는 한 세계를 골라 두고, **키는 늘 `ownerOf`가 짓는다** —
// `"atelier:가"`를 손으로 이으면 형식을 적는 자리가 둘이 되고, 그 형식이 바뀌는 날 이
// 파일만 옛 키를 재면서 조용히 초록으로 남는다.
const TOP = topTerminal("atelier");
const ownerFor = (slug: string) => ownerOf("atelier", slug);
const originFor = (slug: string, cwd: string | null = null): ShellOrigin => ({
  mode: "atelier",
  cwd,
  owner: ownerFor(slug),
  project: null,
});

// 셸을 n개 띄운 상태와 그 id들. 목록 조작을 보려면 늘 여럿이 필요하다.
// **씨앗을 안 주면 그 세계의 최상위 터미널이다** — 판 02가 관찰하던 것이 전부 그 화면이었다.
function opened(
  count: number,
  seed: ShellOrigin = TOP,
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
const activeTop = (state: ShellsState) => activeIdOf(state, TOP.owner);
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
    const again = openShell(emptied, TOP);
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
  // `owner`는 소유자 키이고, **`null`은 「고른 작업이 없다」**다(WorksPage) — 최상위
  // 터미널이 아니다. 그쪽에도 뒤가 빈 자기 키가 따로 있다.
  const at = (owner: ShellOwner | null, count: number) => ({ owner, count });

  it("1에서 0이 되면 그렇다", () => {
    expect(shellsEmptied(at(ownerFor("가"), 1), at(ownerFor("가"), 0))).toBe(true);
  });

  // **서 있는 값으로 재면 안 된다.** 화면에 들어올 때는 0에서 시작해 진입 이펙트가 하나를
  // 띄우므로, 「지금 0개다」로 재면 들어오자마자 되돌아 나가 터미널을 열 수 없는 앱이 된다.
  it("처음부터 0이면 아니다", () => {
    expect(shellsEmptied(at(ownerFor("가"), 0), at(ownerFor("가"), 0))).toBe(false);
  });

  it("아직 남아 있으면 아니다", () => {
    expect(shellsEmptied(at(ownerFor("가"), 2), at(ownerFor("가"), 1))).toBe(false);
  });

  // 셸이 도는 work에서 안 도는 work으로 갈 때마다 본문이 문서로 튕기면 안 된다.
  it("work이 바뀐 것은 세지 않는다", () => {
    expect(shellsEmptied(at(ownerFor("가"), 1), at(ownerFor("나"), 0))).toBe(false);
  });

  it("최상위 터미널도 같은 규칙이다", () => {
    expect(shellsEmptied(at(TOP.owner, 1), at(TOP.owner, 0))).toBe(true);
    expect(shellsEmptied(at(TOP.owner, 1), at(ownerFor("가"), 0))).toBe(false);
  });

  // 세계가 갈린 뒤에도 이 판정은 **소유자가 같은지만** 본다 — 두 세계의 최상위는 서로 다른
  // 소유자라, Atelier에서 Maison으로 건너간 것은 「이 화면의 마지막 칸이 닫혔다」가 아니다.
  it("세계가 바뀐 것도 세지 않는다", () => {
    expect(shellsEmptied(at(TOP.owner, 1), at(topTerminal("maison").owner, 0))).toBe(false);
  });
});

// 「켜진 셸이 무엇인가」를 정하는 자리. 이 함수가 없던 동안 같은 2단 체인이 화면 넷에
// 베껴져 있었고, 그 값이 **어느 셸을 그릴지**(TerminalPane)와 **열 머리의 이름**
// (ShellHeadName)으로 곧장 간다 — 첫 칸을 주는 것으로 퇴화하면 화면이 조용히 갈린다.
describe("켜진 셸을 집는다", () => {
  it("첫 칸이 아니라 켜진 칸을 준다", () => {
    const { state, ids } = opened(3);
    const 켠것 = activateShell(state, ids[2]);
    expect(activeShellOf(켠것, TOP.owner)?.id).toBe(ids[2]);
  });

  it("`activeIdOf`와 같은 칸을 가리킨다", () => {
    const { state, ids } = opened(3);
    const 켠것 = activateShell(state, ids[1]);
    expect(activeShellOf(켠것, TOP.owner)?.id).toBe(activeIdOf(켠것, TOP.owner));
  });

  // 소유자마다 따로다. 남의 화면의 켜진 칸을 여기서 주면 열 머리가 옆 work의 셸 이름을 쓴다.
  it("남의 화면 것을 주지 않는다", () => {
    const { state } = opened(2);
    expect(activeShellOf(state, ownerFor("가"))).toBeNull();
  });

  it("셸이 없으면 없다", () => {
    expect(activeShellOf(NO_SHELLS, TOP.owner)).toBeNull();
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
    expect(openShell(opened(MAX_SHELLS).state, TOP)).toBeNull();
  });

  // 터미널이 둘이어도 그 둘은 **같은 상태를** 번갈아 고칠 뿐이다. 그래서 나눠 만들어도
  // 합이 상한에서 멈춘다 — 이것이 화면마다 세는 것과 갈리는 지점이다.
  it("두 터미널이 나눠 띄워도 합이 상한에서 멈춘다", () => {
    let state = NO_SHELLS;
    const 왼쪽: number[] = [];
    const 오른쪽: number[] = [];
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      const next = openShell(state, TOP);
      expect(next, `${n}번째에서 거부됐다`).not.toBeNull();
      state = next!.state;
      (n % 2 === 0 ? 왼쪽 : 오른쪽).push(next!.id);
    }
    expect(왼쪽.length + 오른쪽.length).toBe(MAX_SHELLS);
    expect(openShell(state, TOP)).toBeNull();
  });

  it("거부당해도 목록과 다음 번호는 그대로다", () => {
    const { state } = opened(MAX_SHELLS);
    expect(openShell(state, TOP)).toBeNull();
    expect(state.shells).toHaveLength(MAX_SHELLS);
    expect(state.nextId).toBe(MAX_SHELLS + 1);
  });

  it("하나를 빼면 다시 띄울 자리가 생긴다", () => {
    const { state, ids } = opened(MAX_SHELLS);
    expect(openShell(removeShell(state, ids[0]), TOP)).not.toBeNull();
  });

  // `+`가 잠기는 판정과 openShell이 거부하는 판정은 **같은 자리**여야 한다. 갈리면
  // 눌리는 `+`가 아무 일도 안 하거나, 잠긴 `+` 뒤에 자리가 남는다.
  it("atCap이 참인 것과 openShell이 거부하는 것이 같다", () => {
    let state = NO_SHELLS;
    for (let n = 0; n <= MAX_SHELLS; n += 1) {
      const refused = openShell(state, TOP);
      expect(atCap(state, TOP.owner), `${n}개일 때 갈렸다`).toBe(refused === null);
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
    let state = opened(1, originFor("가")).state;
    state = openShell(state, originFor("나"))!.state;
    state = openShell(state, originFor("가"))!.state;

    expect(shellsOf(state, ownerFor("가"))).toHaveLength(2);
    expect(shellsOf(state, ownerFor("나"))).toHaveLength(1);
  });

  // 최상위 터미널은 Work가 아니다 — 아카이브가 그 셸까지 거두면 상관없는 작업이 끊긴다.
  it("최상위 터미널의 셸은 어느 Work에도 안 걸린다", () => {
    let state = opened(1).state;
    state = openShell(state, originFor("가"))!.state;

    expect(shellsOf(state, ownerFor("가"))).toHaveLength(1);
    expect(shellsOf(state, TOP.owner)).toHaveLength(1);
    expect(shellsOf(state, ownerFor("없는-작업"))).toEqual([]);
  });

  // 확인 대화가 말하는 N이다(결정 26). 끝난 칸과 못 뜬 칸은 목록에 남지만 죽일 프로세스가
  // 없어서, 함께 세면 「셸 2개가 닫혀요」라고 해놓고 하나만 끝난다.
  it("도는 셸만 센다", () => {
    let state = opened(3, originFor("가")).state;
    state = openShell(state, originFor("나"))!.state;
    const ids = shellsOf(state, ownerFor("가")).map((shell) => shell.id);

    expect(runningShellsOf(state, ownerFor("가"))).toBe(3);
    expect(runningShellsOf(markExited(state, ids[0], EXIT_42), ownerFor("가"))).toBe(2);
    expect(runningShellsOf(markFailed(state, ids[1], "못 떴다"), ownerFor("가"))).toBe(2);
    // 남의 화면 것도 안 센다.
    expect(runningShellsOf(state, ownerFor("나"))).toBe(1);
    expect(runningShellsOf(state, TOP.owner)).toBe(0);
  });

  // **상한도 화면마다다**(결정 23이 결정 30을 뒤집었다). 한 화면을 꽉 채워도 남의 화면과
  // 최상위 터미널은 자기 몫을 그대로 갖는다 — 앱 전체로 세면 남이 연 셸 때문에 이 화면의
  // `+`가 잠기고, 왜 잠겼는지가 이 화면에 안 보인다.
  it("한 화면을 꽉 채워도 다른 화면은 자기 몫을 갖는다", () => {
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      const next = openShell(state, originFor("가"));
      expect(next, `${n}번째에서 거부됐다`).not.toBeNull();
      state = next!.state;
    }
    // 꽉 찬 화면은 거부한다 — 이것이 없으면 아래 둘은 「상한이 아예 없어서」도 초록이다.
    expect(openShell(state, originFor("가"))).toBeNull();
    expect(atCap(state, ownerFor("가"))).toBe(true);

    // 남의 work도, 최상위 터미널도 그대로 연다.
    expect(atCap(state, ownerFor("나"))).toBe(false);
    expect(openShell(state, originFor("나"))).not.toBeNull();
    expect(atCap(state, TOP.owner)).toBe(false);
    expect(openShell(state, TOP)).not.toBeNull();
  });
});

// 켜진 칸이 하나뿐이면 Work A에서 B로 갔다 오는 것만으로 A의 줄에 켜진 칸이 없어진다 —
// 그 상태에서 「없으면 하나 띄운다」가 돌면 이미 있는 셸 옆에 셸이 또 뜬다.
describe("켜진 칸은 화면마다 따로다", () => {
  it("다른 Work에서 셸을 띄워도 이 Work의 켜진 칸은 그대로다", () => {
    const 가 = opened(2, originFor("가"));
    const 나 = openShell(가.state, originFor("나"))!;

    expect(activeIdOf(나.state, ownerFor("가"))).toBe(가.ids[1]);
    expect(activeIdOf(나.state, ownerFor("나"))).toBe(나.id);
  });

  it("갔다 와도 보던 칸이 그대로다", () => {
    const 가 = opened(3, originFor("가"));
    const 고른것 = activateShell(가.state, 가.ids[0]);
    const 나 = openShell(고른것, originFor("나"))!;
    const 돌아옴 = activateShell(나.state, 가.ids[0]);

    expect(activeIdOf(돌아옴, ownerFor("가"))).toBe(가.ids[0]);
    expect(activeIdOf(돌아옴, ownerFor("나"))).toBe(나.id);
  });

  // 이웃을 전체 목록에서 고르면 **남의 Work 셸**이 켜진다. 그 줄에는 켜진 칸이 없어진다.
  // 그래서 남의 셸을 두 칸 **사이에** 끼워 둔다 — 나란한 배치로는 두 규칙이 같은 답을 낸다.
  it("활성 칸을 빼면 같은 화면 안에서 이웃이 켜진다", () => {
    const 첫째 = opened(1, originFor("가"));
    const 남 = openShell(첫째.state, originFor("나"))!;
    const 둘째 = openShell(남.state, originFor("가"))!;
    const 켠것 = activateShell(둘째.state, 첫째.ids[0]);

    const 뺀것 = removeShell(켠것, 첫째.ids[0]);
    expect(activeIdOf(뺀것, ownerFor("가"))).toBe(둘째.id);
    expect(activeIdOf(뺀것, ownerFor("나"))).toBe(남.id);
  });

  it("그 화면의 마지막 칸을 빼면 그 화면만 켜진 칸이 없어진다", () => {
    const 가 = opened(1, originFor("가"));
    const 나 = openShell(가.state, originFor("나"))!;

    const 뺀것 = removeShell(나.state, 가.ids[0]);
    expect(activeIdOf(뺀것, ownerFor("가"))).toBeNull();
    expect(activeIdOf(뺀것, ownerFor("나"))).toBe(나.id);
  });
});

// 결정 10. **owner는 세계를 실은 키다.** 여기서 지키는 것은 「어느 두 셸도 다른 세계에서
// 같은 키를 갖지 않는다」 하나이고, 깨지면 두 루트에 같은 slug가 있을 때 셸 목록·상한·켜진
// 칸이 통째로 섞인다 — 결정 10이 그 불변식을 테스트가 붙들라고 명시했다.
describe("셸의 소유자 키", () => {
  // **두 세계를 함께 돈다.** 한 모드만 재면 `ownerOf`가 모드를 통째로 버려도(늘 `atelier:`를
  // 짓게 해도) 전부 초록이다 — 그 변형이 정확히 이 판이 막으려는 사고다.
  //
  // `"가:나"`가 목록에 있는 것은 **코어가 slug에서 `:`를 안 막기 때문이다**
  // (`crates/atelier-core/src/slug.rs`의 `is_safe_slug`가 보는 것은 빈 값·앞머리 `.`·`/`·`\`
  // 넷뿐이고, `:`를 `-`로 바꾸는 `slugify`는 제목에서 파생할 때만 지난다). 가르는 자리가
  // 마지막 `:`로 밀리는 순간 이 slug의 왕복이 `나`로 돌아와 여기가 빨개진다.
  const SLUGS = [null, "가", "spec-search", "가:나"];

  it("형식이 `<mode>:<slug>`다 — 최상위는 뒤가 빈다", () => {
    expect(ownerOf("atelier", "spec-search")).toBe("atelier:spec-search");
    expect(ownerOf("maison", "finance")).toBe("maison:finance");
    expect(ownerOf("maison")).toBe("maison:");
  });

  it("(모드, slug)가 다르면 키도 다르다 — 두 최상위도 서로 다르다", () => {
    const keys = ALL_MODES.flatMap((mode) => SLUGS.map((slug) => ownerOf(mode, slug)));
    expect(new Set(keys).size, keys.join(" · ")).toBe(keys.length);
    // 같은 slug가 두 루트에 서는 것이 결정 10이 든 실제 충돌이다.
    expect(ownerOf("atelier", "finance")).not.toBe(ownerOf("maison", "finance"));
  });

  it("지은 키를 도로 읽으면 제자리로 온다", () => {
    for (const mode of ALL_MODES) {
      for (const slug of SLUGS) {
        const owner = ownerOf(mode, slug);
        expect(modeOfOwner(owner), owner).toBe(mode);
        expect(slugOfOwner(owner), owner).toBe(slug);
      }
    }
  });

  // 공용 끌기 모듈은 이 타입을 못 불러 소유자를 `string`으로 싣는다(ui-improvement 03). 받는
  // 쪽이 `as`로 좁히면 형식 보증이 주석 하나로 내려앉는다 — 손으로 이은 문자열(`work.slug`)이
  // 그대로 앉아 slug가 조용히 틀린다. 좁히기는 **값을 보고** 여기서 한다.
  it("`ownerIn`은 그 세계가 지은 키만 소유자로 받는다", () => {
    for (const mode of ALL_MODES) {
      expect(ownerIn(mode, ownerOf(mode))).toBe(ownerOf(mode));
      for (const slug of SLUGS) {
        expect(ownerIn(mode, ownerOf(mode, slug)), String(slug)).toBe(ownerOf(mode, slug));
      }
    }
    // slug만 실은 것 · 남의 세계 키 · 구분자 없는 모드 이름은 소유자가 아니다.
    expect(ownerIn("atelier", "finance")).toBeNull();
    expect(ownerIn("atelier", ownerOf("maison", "finance"))).toBeNull();
    expect(ownerIn("atelier", "atelier")).toBeNull();
  });

  // 최상위 키와 work 키가 안 겹치는 근거가 「slug는 비어 있을 수 없다」 한 줄이라, 빈 뒤꼬리는
  // 최상위 말고 다른 뜻을 가질 수 없다 — 코어가 빈 slug를 거절해서다(`is_safe_slug`).
  it("뒤가 비면 그 세계의 최상위다 — slug가 있는 키와 안 겹친다", () => {
    for (const mode of ALL_MODES) {
      expect(slugOfOwner(ownerOf(mode))).toBeNull();
      expect(ownerOf(mode)).not.toBe(ownerOf(mode, "가"));
    }
  });

  // 결정 10·25. 최상위가 세계마다 하나씩이라 **상수일 수 없다** — 한 값으로 두면 두 화면이
  // 같은 셸 목록과 같은 상한을 나눠 쓴다.
  it("`topTerminal`은 그 세계의 최상위 자리다", () => {
    for (const mode of ALL_MODES) {
      const origin = topTerminal(mode);
      expect(origin.owner).toBe(ownerOf(mode));
      // 어디서 뜨는지는 백엔드만 안다(결정 25). Work가 아니라 프로젝트도 없다.
      expect(origin.cwd).toBeNull();
      expect(origin.project).toBeNull();
    }
    expect(topTerminal("atelier").owner).not.toBe(topTerminal("maison").owner);
  });
});

// 결정 24·25. **출력이 `~` 축약 표기인 것이 계약이다** — 펴는 것은 백엔드 한 곳이고,
// 프런트가 홈을 붙이면 `ATELIER_HOME`을 바꾼 사람에게 조용히 어긋난다.
describe("cwd는 Work의 모양이 정한다", () => {
  it("프로젝트가 하나면 그 워크트리다", () => {
    const origin = workShellOrigin("atelier", w(["atelier"]), null);
    expect(origin?.cwd).toBe("~/.atelier/works/w/trees/atelier");
    expect(origin?.owner).toBe(ownerOf("atelier", "w"));
    // 프로젝트가 하나면 이름에 프로젝트를 적을 이유가 없다 — 고를 것이 없다.
    expect(origin?.project).toBeNull();
  });

  it("프로젝트가 없으면 Work 폴더다 — spec 폴더의 부모", () => {
    const origin = workShellOrigin("atelier", w([]), null);
    expect(origin?.cwd).toBe("~/.atelier/works/w");
  });

  it("spec 폴더 표기에 슬래시가 붙어 있어도 같은 자리다", () => {
    const work = { ...w([]), specDir: "~/.atelier/works/w/spec/" };
    expect(workShellOrigin("atelier", work, null)?.cwd).toBe("~/.atelier/works/w");
  });

  it("어느 갈래든 `~` 축약 표기다", () => {
    for (const origin of [
      workShellOrigin("atelier", w([]), null),
      workShellOrigin("atelier", w(["atelier"]), null),
      workShellOrigin("atelier", w(["atelier", "cli"]), "cli"),
    ]) {
      expect(origin?.cwd).toMatch(/^~\//);
    }
  });

  // 결정 24. 여럿일 때 아무 데나 고르면 **틀린 워크트리에서 claude가 돈다.** 물어보는 것이
  // 이 판의 규칙이라, 지정이 없으면 셸 자체가 생기지 않아야 한다.
  it("프로젝트가 여럿인데 안 고르면 셸이 생기지 않는다", () => {
    expect(workShellOrigin("atelier", w(["atelier", "cli"]), null)).toBeNull();
  });

  it("여럿 중 고른 것의 워크트리로 간다", () => {
    const origin = workShellOrigin("atelier", w(["atelier", "cli"]), "cli");
    expect(origin?.cwd).toBe("~/.atelier/works/w/trees/cli");
    expect(origin?.project).toBe("cli");
  });

  it("그 Work에 없는 프로젝트를 고르면 셸이 생기지 않는다", () => {
    expect(workShellOrigin("atelier", w(["atelier", "cli"]), "없는것")).toBeNull();
  });

  // 폴더가 없으면 spawn이 실패하고 결정 23의 「그 칸에 이유를 적는다」를 그대로 탄다.
  // 여기서 한 번 더 판정하면 같은 사실을 두 곳이 말한다.
  it("워크트리 폴더가 없어도 여기서는 막지 않는다", () => {
    const work = w(["atelier"]);
    const 없는것 = { ...work, worktrees: [{ ...work.worktrees[0], exists: false }] };
    expect(workShellOrigin("atelier", 없는것, null)?.cwd).toBe("~/.atelier/works/w/trees/atelier");
  });

  // 결정 10. **`work`에서 세계를 유도할 수 없다** — `WorkView`에 어느 루트에서 읽어 온
  // 것인지가 안 실려 있고, 두 루트에 같은 slug가 설 수 있다. 갈래 셋이 전부 받은 세계를
  // 실어야 한다: 한 갈래만 빠뜨리면 그 모양의 work에서만 셸이 남의 세계 것이 된다.
  it("갈래 셋이 전부 받은 세계를 origin에 싣는다", () => {
    for (const mode of ALL_MODES) {
      const 갈래 = [
        workShellOrigin(mode, w([]), null),
        workShellOrigin(mode, w(["atelier"]), null),
        workShellOrigin(mode, w(["atelier", "cli"]), "cli"),
      ];
      for (const origin of 갈래) {
        expect(origin?.mode, `${mode}`).toBe(mode);
        // **`mode`와 `owner`가 갈리면 안 된다** — spawn은 앞을 백엔드에 싣고 화면은 뒤로
        // 조회한다. 어긋나면 셸은 저쪽 세계에서 뜨는데 이쪽 줄에 그려진다.
        expect(origin?.owner, `${mode}`).toBe(ownerOf(mode, "w"));
      }
    }
  });
});

// 결정 17~19·30. **자리를 묻는 물음이 셋으로 갈린다** — 기본 자리(⌘T), 고른 프로젝트(메뉴),
// 들어갈 때 셸을 세우는 자리. 뒤의 둘은 위 `workShellOrigin`이 그대로 맡고(멀티 프로젝트에 안
// 고르면 `null` — 위 「프로젝트가 여럿인데 안 고르면 셸이 생기지 않는다」가 결정 30 그대로다),
// 앞의 하나가 **`null`이 없는** 이 함수다. 둘을 한 함수의 인자로 섞으면 「들어갈 때」가 기본
// 자리를 타는 날 멀티 프로젝트 work에 저장소가 아닌 폴더의 셸이 저절로 쌓인다.
describe("기본 자리는 언제나 답한다 — 멀티 프로젝트면 「모든 프로젝트」", () => {
  it("프로젝트가 여럿이면 첫 워크트리 경로의 부모에서 연다 — 프로젝트 앞말이 없다", () => {
    expect(workDefaultOrigin("atelier", w(["atelier", "cli"]))).toEqual({
      mode: "atelier",
      cwd: "~/.atelier/works/w/trees",
      owner: ownerOf("atelier", "w"),
      project: null,
    });
  });

  // **폴더 이름을 앱이 짓지 않는다** — 워크트리 경로는 코어가 만든 값이고, 그 부모를 읽을
  // 뿐이다. 이름으로 지으면 코어가 자리를 옮기는 날 셸이 없는 폴더에서 뜬다.
  it("이름이 아니라 부모를 읽는다 — 끝의 슬래시도 같은 자리다", () => {
    const work = w(["atelier", "cli"]);
    const moved = {
      ...work,
      worktrees: [
        { ...work.worktrees[0], path: "~/딴데/w/나무/atelier/" },
        { ...work.worktrees[1], path: "~/딴데/w/나무/cli" },
      ],
    };
    expect(workDefaultOrigin("atelier", moved).cwd).toBe("~/딴데/w/나무");
  });

  // 0·1개 work과 Room은 **지금과 같다**(스펙 §11). 두 세계를 함께 돈다 — Maison은 워크트리가
  // 실려 와도 Room 폴더다(`shellTrees`).
  it("0·1개 work과 Maison은 지금 자리와 같다", () => {
    for (const mode of ALL_MODES) {
      for (const work of [w([]), w(["atelier"])]) {
        expect(workDefaultOrigin(mode, work), `${mode} ${work.worktrees.length}개`).toEqual(
          workShellOrigin(mode, work, null),
        );
      }
    }
    expect(workDefaultOrigin("maison", w(["atelier", "cli"]))).toEqual(
      workShellOrigin("maison", w(["atelier", "cli"]), null),
    );
  });

  // 결정 18·19. `+` 메뉴의 「모든 프로젝트」와 묻지 않는 `+`는 ⌘T와 **같은 자리**다 — 그 규칙이
  // 서는 곳이 `placeOrigin` 하나라 여기서 값으로 잰다. 세계·모양을 전부 돈다: 한 갈래만 기본
  // 자리를 안 타면 그 모양의 work에서만 `+`와 ⌘T가 다른 자리에 연다.
  it("「모든 프로젝트」는 ⌘T와 같은 자리, 프로젝트 줄은 그 워크트리다", () => {
    for (const mode of ALL_MODES) {
      for (const work of [w([]), w(["atelier"]), w(["atelier", "cli"])]) {
        expect(placeOrigin(mode, work, { kind: "default" }), `${mode} ${work.worktrees.length}개`).toEqual(
          workDefaultOrigin(mode, work),
        );
      }
    }
    expect(placeOrigin("atelier", w(["atelier", "cli"]), { kind: "project", project: "cli" })).toEqual(
      workShellOrigin("atelier", w(["atelier", "cli"]), "cli"),
    );
    expect(placeOrigin("atelier", w(["atelier", "cli"]), { kind: "project", project: "cli" })?.cwd).toBe(
      "~/.atelier/works/w/trees/cli",
    );
    // 열린 사이 work이 바뀌어 고른 이름이 없으면 자리가 안 정해진다(결정 24).
    expect(placeOrigin("atelier", w(["atelier", "cli"]), { kind: "project", project: "없음" })).toBeNull();
  });

  // `+` 메뉴의 「모든 프로젝트」 옆 옅은 글자(결정 20). 이름을 적지 않고 **그 자리의 마지막
  // 마디**를 읽는다 — 제품 코드가 그렇다는 것은 아래 소스 스캔이 문다(테스트 파일은 안 본다).
  it("옅은 경로는 기본 자리 경로의 마지막 마디 + `/`다", () => {
    expect(placeHint(workDefaultOrigin("atelier", w(["atelier", "cli"])).cwd)).toBe("trees/");
    expect(placeHint("~/딴데/w/나무/")).toBe("나무/");
    // 최상위 터미널은 데이터 루트라 cwd가 없다 — 보일 경로가 없다.
    expect(placeHint(topTerminal("atelier").cwd)).toBeNull();
  });

  // **프런트는 「모든 프로젝트」 폴더의 이름을 모른다**(스펙 §7) — 위 함수가 부모를 읽는 것이
  // 그 약속의 절반이고, 이 스캔이 나머지 절반이다: 누가 경로 조각을 손으로 이으면 코어가
  // 자리를 옮기는 날 그 한 곳만 없는 폴더를 가리킨다. 한 줄 리터럴만 본다(파싱하지 않는다).
  //
  // **fail-closed**: 파일을 하나도 못 읽으면 「조각이 0개」가 저절로 참이 된다. 그래서 같은
  // 스캔이 `worktrees`를 찾아야 한다 — 그 낱말이 소스에 있다는 것이 실제로 읽었다는 증거다.
  it("테스트가 아닌 프런트 소스에 그 폴더 이름의 경로 조각이 없다", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const sources = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
      });
    })(root);
    const text = sources.map((path) => readFileSync(path, "utf8")).join("\n");

    expect(countOf(text, "worktrees"), "소스를 못 읽었다 — `worktrees`가 하나도 없다").toBeGreaterThan(0);
    for (const piece of ['"trees', "'trees", "`trees", "trees/", "/trees"]) {
      expect(countOf(text, piece), piece).toBe(0);
    }
  });
});

// US 26. `+`가 「어디에 열까」를 묻기 전에 「고를 것이 있나」를 이 함수가 답한다 —
// `workShellOrigin`과 **같은 값(`shellTrees`)** 을 봐야 메뉴는 열리는데 고른 값으로 셸이
// 안 생기는 일이 없다. 그래서 이 describe는 두 함수를 **나란히** 잰다: 한쪽만 재면 둘이
// 갈린 판이 여기서 초록으로 지나간다.
describe("고를 수 있는 프로젝트와 열리는 자리", () => {
  it("Atelier에서는 워크트리의 프로젝트들이다", () => {
    expect(workShellProjects("atelier", w(["atelier", "cli"]))).toEqual(["atelier", "cli"]);
    // 하나면 `+`가 안 묻는다(ShellTabs의 `asks`) — 그 판단의 입력이 여기다
    expect(workShellProjects("atelier", w(["atelier"]))).toEqual(["atelier"]);
    expect(workShellProjects("atelier", w([]))).toEqual([]);
  });

  // **값이 비어 있으니 어차피 빈 배열이다는 근거로 삼지 않는다.** 저 세계에 워크트리가
  // 없는 것은 코어가 프로젝트 붙이기를 거절해서인데, 목록을 **읽는** 자리에는 그 검증이
  // 없다 — 손으로 고친 work.json 하나면 Room이 프로젝트를 실어 온다. 그래서 실려 온 값을
  // 넣고 잰다.
  it("Maison에서는 값이 실려 와도 고를 것이 없다", () => {
    expect(workShellProjects("maison", w(["atelier", "cli"]))).toEqual([]);
  });

  // **위 검사와 짝이다.** 「고를 것이 없다」만 재고 「그래서 어디에 여는가」를 안 재면 이 판이
  // 만든 것은 방어가 아니라 **눌러도 아무 일이 없는 `+`**다: 메뉴는 안 열리고(`asks`가 거짓),
  // 묻지 않는 `+`는 `onOpen({ kind: "default" })`로 기본 자리(`workDefaultOrigin` — `placeOrigin`
  // 이 탄다)에 연다. 그 함수와 메뉴의 판단이 한 함수(`shellTrees`)를 보는 것이 「워크트리를 그대로
  // 읽어 엉뚱한 곳에 연다」를 막고, 그 사실을 여기서 값으로 잰다. 진입 셸이 타는
  // `workShellOrigin(…, null)`도 같은 자리여야 한다(스펙 §11) — 함께 잰다.
  it("Maison에서는 워크트리가 실려 와도 Room 폴더에서 연다", () => {
    for (const room of [w([]), w(["atelier"]), w(["atelier", "cli"])]) {
      for (const origin of [workDefaultOrigin("maison", room), workShellOrigin("maison", room, null)]) {
        // `null`이 아니다 — `+`가 열 자리를 언제나 답한다
        expect(origin?.cwd, `${room.worktrees.length}개`).toBe("~/.atelier/works/w");
        expect(origin?.project, `${room.worktrees.length}개`).toBeNull();
      }
    }
  });

  // 같은 값이 Atelier에서는 갈래를 그대로 탄다 — 한쪽만 재면 조건이 어느 쪽으로 누워도 초록이다.
  it("Atelier에서는 같은 값이 워크트리로 간다", () => {
    expect(workShellOrigin("atelier", w(["atelier"]), null)?.cwd).toBe(
      "~/.atelier/works/w/trees/atelier",
    );
    expect(workShellOrigin("atelier", w(["atelier", "cli"]), null)).toBeNull();
  });
});

// 결정 45·46. 셸 행은 두 줄이고, 그 두 줄을 정하는 것이 이 함수 둘이다. **프로젝트를
// 버리지 않는 것**이 여기서 지켜야 할 전부다 — 앞 판의 가로 탭 줄은 타이틀이 오는 순간
// 프로젝트를 버렸고, 그래서 어느 워크트리의 셸인지가 실물에서 사라졌다(결정 104가 그
// 함수를 지웠다).
describe("셸 행의 두 줄", () => {
  const 칸 = (project: string | null, cwd: string | null) => {
    const { state, ids } = opened(1, { mode: "atelier", cwd, owner: ownerFor("w"), project });
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
    expect(shellCapNotice(state, TOP.owner)).toBe(
      `셸은 화면마다 ${MAX_SHELLS}개까지예요 — 여기 ${MAX_SHELLS}개`,
    );
  });

  it("수는 **이 화면**의 것이다 — 앱 전체가 아니다", () => {
    // 결정 23. 앱 전체를 세면 「여기 3개인데 8개까지라면서 왜 못 열지」가 된다 — 사람이
    // 세는 단위가 이 화면이라서다. 남의 work의 셸은 이 문장에 안 섞인다.
    let state = opened(3, originFor("가")).state;
    state = openShell(state, originFor("나"))!.state;
    expect(shellCapNotice(state, ownerFor("가"))).toContain("여기 3개");
    expect(shellCapNotice(state, ownerFor("나"))).toContain("여기 1개");
  });

  // 아래 둘은 **`openShell`을 실제로 통과시켜** 본다. 거절 여부와 할 말이 한 자리에서
  // 갈리는지가 관찰 대상이라, `null`을 손으로 넣으면 그 짝이 검사에서 빠진다.
  it("열렸으면 아무 말도 하지 않는다", () => {
    // 이 판정이 터미널 스토어(`openNewShell`)에 있었을 때 **성공 경로가 어떤 검사에도 안
    // 걸렸다** — 그 함수는 열리는 순간 xterm을 세워 DOM 없는 seam에서 못 돈다. 거절을
    // 알리는 줄이 성공 경로로 새면 ⌘T·`+`가 열 때마다 「셸은 8개까지예요」를 뱉는다.
    const state = opened(MAX_SHELLS - 1).state;
    expect(shellOpenNotice(state, openShell(state, TOP), TOP.owner)).toBeNull();
  });

  it("거부당하면 잠긴 `+`와 같은 문장이 온다", () => {
    const state = opened(MAX_SHELLS).state;
    expect(shellOpenNotice(state, openShell(state, TOP), TOP.owner)).toBe(
      shellCapNotice(state, TOP.owner),
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

  // **⌘K는 셸이 타이핑하지 않는다**(결정 2). `"app"`이면 xterm이 그 키를 처리하지 않고
  // 그대로 위로 흘려보내, 셸에 포커스가 있어도 window의 리스너가 팔레트를 연다.
  // 이 한 줄이 없으면 macOS 관례(스크롤백 지우기)로 되돌리는 길이 열려 있고, 그때
  // 「어디서든 열린다」가 **포커스가 셸에 있는 시간 전부**에서 깨진다.
  it("⌘K는 앱 몫이되 이 셸이 하지 않는다 — 위로 흘려보낸다", () => {
    expect(shellHotkey(key({ code: "KeyK" }))).toBe("app");
  });

  it("⌘⇧K·⌘⌥K는 셸 몫이다 — 팔레트도 안 연다", () => {
    expect(shellHotkey(key({ code: "KeyK", shiftKey: true }))).toBeNull();
    expect(shellHotkey(key({ code: "KeyK", altKey: true }))).toBeNull();
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

// 결정 1·2·22. ⌘K가 검색을 연다. **순수 술어 하나다** — 무장 상태도 「어디서 눌렸나」도
// 안 받으므로 가짜 시계도 가짜 target도 필요 없다. ⇧⇧가 딛던 리듀서·간격 상수·무장 해제
// 규칙이 그 몸짓과 함께 걷혔다.
//
// 이 판정이 이 모듈에 있는 것은 **셸이 이 키를 타이핑하지 않는다**를 정하는 자리가 여기라서다
// (`shellHotkey`가 `"app"`으로 흘려보낸다) — 아래 「앱이 가져가는 키」 블록이 그 절반을 든다.
describe("⌘K가 검색을 연다", () => {
  type SearchT = Parameters<typeof searchHotkey>[0];
  const key = (over: Partial<SearchT> = {}): SearchT => ({
    type: "keydown",
    code: "KeyK",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    ...over,
  });

  it("⌘K면 연다", () => {
    expect(searchHotkey(key())).toBe(true);
  });

  // **결정 1이 명시로 배제한 화음이다** — VS Code가 ⌘K를 접두사로 쓰는 그 계열(⌘K ⌘S 등).
  // 이 한 줄이 없으면 ⌘⇧K(「줄 삭제」)까지 팔레트를 연다.
  it.each(["ctrlKey", "altKey", "shiftKey"] as const)("%s가 더 붙으면 아니다", (extra) => {
    expect(searchHotkey(key({ [extra]: true }))).toBe(false);
  });

  it("⌘ 없이 K만은 아니다 — 그냥 글자다", () => {
    expect(searchHotkey(key({ metaKey: false }))).toBe(false);
  });

  it("다른 키는 아니다", () => {
    for (const code of ["KeyJ", "KeyL", "KeyT", "Digit1", "ShiftLeft"]) {
      expect(searchHotkey(key({ code }))).toBe(false);
    }
  });

  // 누른 것만 센다. keyup까지 세면 한 번 누른 것이 두 번으로 읽힌다.
  it.each(["keypress", "keyup"])("%s는 아니다", (type) => {
    expect(searchHotkey(key({ type }))).toBe(false);
  });

  // **`key`가 아니라 `code`로 본다.** 한글 입력기가 켜져 있으면 `key`가 자모(`ㅏ`)로 온다.
  // 네이티브 메뉴가 쏘는 합성 keydown은 `code`와 `key`를 둘 다 실으므로, `key`로 봤다면
  // 메뉴로는 열리고 직접 누르면 한글에서만 죽는 반쪽 고장이 났을 것이다.
  it("입력기가 켜져 있어도 물리 키로 본다", () => {
    expect(searchHotkey({ ...key(), ...{ key: "ㅏ" } } as SearchT)).toBe(true);
  });

  // **「어디서 눌렸나」를 안 본다**(결정 22). work 제목을 고치는 `<input>` 안에서도 열린다 —
  // ⇧⇧는 그 자리에서 비켰지만 그것은 대문자를 못 치게 되기 때문이었고, ⌘ 화음에는 그 대가가
  // 없다. 술어가 `target`을 아예 안 받는다는 것이 이 성질이다.
  it("target을 안 받는다 — 어디서 눌렸든 같은 답이다", () => {
    expect(searchHotkey.length).toBe(1);
    const withTarget = { ...key(), target: { tagName: "INPUT" } } as SearchT;
    expect(searchHotkey(withTarget)).toBe(true);
  });
});

// 결정 80. 끝에서 **돌아온다** — 여덟 번째에서 다음을 누르면 첫 칸이다. 안 돌아오면
// 순회가 아니라 「끝까지 밀기」가 되어 마지막 칸에서 키가 죽은 것처럼 보인다.
describe("셸 순회", () => {
  it("다음 칸으로 가고 끝에서 돌아온다", () => {
    const { state, ids } = opened(3);
    const shells = shellsOf(state, TOP.owner);
    expect(cycleShell(shells, ids[0], 1)).toBe(ids[1]);
    expect(cycleShell(shells, ids[2], 1)).toBe(ids[0]);
    expect(cycleShell(shells, ids[0], -1)).toBe(ids[2]);
  });

  // 켜진 칸이 없는 화면이 실재한다 — 마지막 칸을 `×`로 닫으면 그 자리다.
  it("켜진 칸이 없으면 방향에 따라 양 끝이다", () => {
    const { state, ids } = opened(3);
    const shells = shellsOf(state, TOP.owner);
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
    const mine = openShell(state, originFor("가", "~/가"))!;
    state = mine.state;
    const theirs = openShell(state, originFor("나", "~/나"))!;
    return { state: theirs.state, mine: mine.id, theirs: theirs.id };
  };

  it("남의 셸이 타이틀을 쏘면 안 다시 그린다", () => {
    const { state, theirs } = two();
    expect(sameScreen(state, setTitle(state, theirs, "claude"), ownerFor("가"))).toBe(true);
  });

  it("내 셸이 타이틀을 쏘면 다시 그린다", () => {
    const { state, mine } = two();
    expect(sameScreen(state, setTitle(state, mine, "claude"), ownerFor("가"))).toBe(false);
  });

  // 상한 문구가 **앱 전체**를 센다(결정 30) — 남의 화면에 셸이 하나 늘면 「지금 N개」가 바뀐다.
  it("남의 셸이 열리면 다시 그린다 — 상한 문구가 앱 전체를 센다", () => {
    const { state } = two();
    const more = openShell(state, originFor("나", "~/나"))!.state;
    expect(sameScreen(state, more, ownerFor("가"))).toBe(false);
  });

  it("내 켜진 칸이 바뀌면 다시 그린다", () => {
    const { state, mine } = two();
    const another = openShell(state, originFor("가", "~/가"))!;
    const 켠뒤 = activateShell(another.state, mine);
    expect(sameScreen(another.state, 켠뒤, ownerFor("가"))).toBe(false);
  });

  // 최상위 터미널의 화면도 같은 규칙을 딛는다 — 소유자의 뒤가 빌 뿐이다.
  it("최상위 화면도 남의 타이틀에 안 흔들린다", () => {
    const { state, mine } = two();
    expect(sameScreen(state, setTitle(state, mine, "claude"), TOP.owner)).toBe(true);
  });

  // **`null`은 「고른 작업이 없다」다** — 그 화면에는 탭 줄도 셸도 안 서므로 어떤 셸
  // 변화도 다시 그릴 이유가 되지 않는다. 앞 판에서는 이 자리가 최상위 터미널을 뜻해,
  // 작업을 안 고른 work 화면이 `/terminal`의 타이틀마다 통째로 다시 그려졌다.
  it("고른 작업이 없으면 무엇이 바뀌어도 같은 화면이다", () => {
    const { state, mine } = two();
    expect(sameScreen(state, setTitle(state, mine, "claude"), null)).toBe(true);
    expect(sameScreen(state, openShell(state, originFor("다"))!.state, null)).toBe(true);
  });
});

// 결정 78·109. 두 화면이 **같은 자리를 딛는다** — 갈리는 것은 「⌘몇이 첫 셸인가」 하나다.
// 따로 두면 순회가 한쪽에서만 끝에서 돌아오거나, 한쪽만 자리를 밀어 마지막 셸을 영영
// 못 고르게 된다(실제로 그 둘이 두 벌로 적혀 있었다).
describe("키가 가리키는 셸", () => {
  const shells = () => shellsOf(opened(3).state, TOP.owner);

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
    // **셸 안 ⌘T는 자리를 정하지 않는다**(결정 19). 그 셸의 화면에 「새 셸」을 요청하고, 화면이
    // 창 단축키와 같은 기본 자리 함수로 연다. `instance.origin`으로 스스로 열면 프로젝트 셸
    // 안의 ⌘T만 그 프로젝트에서 떠 셸 안과 밖이 다른 자리가 된다.
    expect(store).toContain('if (hotkey === "new") requestNewShell(instance.origin.owner);');
    expect(countOf(store, "openNewShell(instance.origin)"), "셸이 제 자리로 스스로 연다").toBe(0);
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

  // 결정 10. **셸이 뜨는 순간 세계가 백엔드로 나간다** — `pty_spawn`의 `mode`가 cwd의
  // 홈(`resolve_cwd`)과 셸 env의 `ATELIER_MODE`(`shell_builder`)를 함께 정한다. 래퍼가
  // 그 인자를 받는 것은 `api.test.ts`가 값으로 재지만, **스토어가 그것을 실제로 넘기는지**는
  // 어느 seam에도 안 보인다(이 모듈은 `@xterm/*`를 끌고 온다). 빠뜨리면 백엔드가 거절하지만
  // (#187) 그 신호는 셸을 띄우려는 순간에야 오고, 저쪽 세계의 값을 실은 갈래는 아예 안
  // 잡힌다 — Maison 셸이 Atelier 홈에서 조용히 뜬다.
  it("spawn이 origin의 세계를 그대로 넘긴다 — owner를 파싱하지 않는다", () => {
    expect(store).toContain("      instance.origin.mode,\n      instance.origin.cwd,");
    // `modeOfOwner`로 뽑으면 `as`로 좁힌 값이 백엔드에 나간다(`ShellOrigin.mode` 머리말).
    expect(
      countOf(store, "modeOfOwner("),
      "소유자 문자열을 파싱해 모드를 뽑고 있다 — origin이 `Mode`로 직접 든다",
    ).toBe(0);
  });

  // 결정 10. **여는 origin과 조회하는 소유자가 같은 인자에서 나와야 한다.** 갈리면
  // `ensureShell`의 「비었나」가 영영 참이라, 이 본문에 들어올 때마다 새 셸이 하나씩 뜬다 —
  // 화면에는 「셸이 자꾸 늘어난다」로만 보이고 어느 검사도 안 빨개진다(정적 렌더는 이펙트를
  // 안 돌린다). 한쪽에 세계를 박아 넣는 변형도 같은 자리에서 잡힌다.
  it("터미널 본문의 소유자와 origin이 같은 `mode`·`work`에서 나온다", () => {
    const pane = read("./TerminalPane.tsx");
    expect(pane).toContain("const owner = ownerOf(mode, work?.slug);");
    expect(pane).toContain("const origin = originOf(mode, work);");
    expect(pane).toContain("return work ? workShellOrigin(mode, work, null) : topTerminal(mode);");
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
    // **여는 자리도 세계를 딛는다**(결정 10). 상수로 되돌리면 두 최상위 화면이 같은 셸
    // 목록을 나눠 쓰고, 모드를 갈아도 저쪽 셸이 그대로 이 줄에 선다.
    expect(page).toContain("openNewShell(topTerminal(mode));");
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
    // 조회하는 소유자가 이 화면의 것이 아니면 남의 화면 셸을 센다(결정 109가 막는 것).
    // **그 값이 세계에서 나와야 한다**(결정 10) — `ownerOf("atelier")`처럼 한쪽으로 박으면
    // Maison 최상위가 Atelier의 셸 목록을 그린다.
    expect(page).toContain("const owner = ownerOf(mode);");
    expect(page).toContain("const shells = shellsOf(state, owner);");
    // 자리를 밀지 않는다 — `2`가 되면 ⌘1이 아무 일도 안 하고 ⌘2가 첫 셸이 된다.
    expect(page).toContain("shellForNav(shells, activeIdOf(state, owner), nav, 1)");
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
  const 가 = originFor("가");

  // 결정 4. claude가 둘 돌아도 사이드바의 로고는 하나다 — 목록은 「뭐가 도나」를 말하지
  // 「몇 개 도나」를 말하지 않는다(개수는 `⌨3`이 이미 말한다).
  it("같은 것이 둘 돌면 **두 번** 들어 있다 — 세는 일은 그리는 쪽이다", () => {
    // 결정 28. 여기서 접으면 `Map`이나 `Record`가 되고, 그러면 회차마다 새 객체라 사이드바
    // 행의 얕은 비교가 늘 어긋나 목록 전체가 초마다 다시 그려진다(`shellCountsOf`의 함정).
    const { state, ids } = opened(2, 가);
    let 지금 = setRunning(state, ids[0], "claude");
    지금 = setRunning(지금, ids[1], "claude");
    expect(runningAgentsOf(지금, ownerFor("가"))).toEqual(["claude", "claude"]);
  });

  it("다른 것이 돌면 둘 다 말하고, 순서는 칸 순서다", () => {
    const { state, ids } = opened(2, 가);
    let 지금 = setRunning(state, ids[0], "codex");
    지금 = setRunning(지금, ids[1], "claude");
    expect(runningAgentsOf(지금, ownerFor("가"))).toEqual(["codex", "claude"]);
  });

  it("아무것도 안 도는 work는 빈 목록이다", () => {
    expect(runningAgentsOf(opened(2, 가).state, ownerFor("가"))).toEqual([]);
  });

  it("남의 work에서 도는 것은 안 센다", () => {
    const { state, ids } = opened(1, 가);
    const 나 = openShell(state, originFor("나"))!;
    let 지금 = setRunning(나.state, ids[0], "claude");
    지금 = setRunning(지금, 나.id, "cargo");
    expect(runningAgentsOf(지금, ownerFor("가"))).toEqual(["claude"]);
    expect(runningAgentsOf(지금, ownerFor("나"))).toEqual(["cargo"]);
  });

  // `runningOn`을 딛는다 — 여기서 상태를 한 번 더 가르면 같은 판정이 두 벌이 된다.
  it("죽은 칸이 돌던 것은 안 센다", () => {
    const { state, ids } = opened(1, 가);
    const 돌던칸 = setRunning(state, ids[0], "claude");
    const 죽은뒤 = markFailed(돌던칸, ids[0], "폴더가 없습니다");
    expect(runningAgentsOf(죽은뒤, ownerFor("가"))).toEqual([]);
  });
});

// 결정 2·3. **work 행 둘째 줄이 종류·수를 싣는 조건**이자 그 자리의 **무리마다의 수를 다
// 더한 값**이다(`⌨수`는 여기서 마크가 붙은 셸 수를 뺀 나머지다 — `ShellMeta`). 세는 자리를
// 새로 만들지 않고 이미 있는 이것으로 되는지 여기서 못박는다.
describe("work마다 셸이 몇 개인가", () => {
  const 가 = originFor("가");

  it("소유자별로 센다 — 키는 slug다", () => {
    const { state } = opened(2, 가);
    const 나 = openShell(state, originFor("나"))!;
    // **키가 slug인 것이 계약이다**(그 함수 머리말). 사이드바 목록은 터미널을 모르므로
    // 소유자 키로 주면 목록이 `work.slug`로 꺼내다 늘 빈손이 되고, 그때 그 행은 숫자가
    // 0으로 보이는 것이 아니라 **메타 상자가 아예 안 선다**(`shellCount > 0`).
    expect(shellCountsOf(나.state, "atelier")).toEqual({ 가: 2, 나: 1 });
  });

  // 세는 판정이 **slug가 비었는가**로 갈려야 한다. 소유자가 늘 문자열이 된 뒤로
  // 「owner가 `null`인가」는 아무도 안 빼고 조용히 통과하고, 그러면 `"atelier:"`가 키로
  // 앉는다 — 그 키는 아무도 안 읽어서 화면에는 아무 일도 안 일어난 채 「무리 수의 합 =
  // shellCount」만 어긋난다.
  it("최상위 터미널의 셸은 어느 work에도 안 걸린다", () => {
    expect(shellCountsOf(opened(2).state, "atelier")).toEqual({});
  });

  // 결정 10. 두 루트에 **같은 slug**가 설 수 있다(코어의 유일성은 한 루트 쌍 안에서만
  // 본다) — 세계를 안 거르면 Maison의 `가`에서 연 셸이 Atelier 사이드바의 `가` 행에
  // 얹힌다. 키가 slug라 섞이면 알아볼 방법도 없다.
  it("저쪽 세계의 셸은 안 센다 — 같은 slug여도", () => {
    const 이쪽 = opened(2, 가).state;
    const 저쪽 = openShell(이쪽, {
      mode: "maison",
      cwd: null,
      owner: ownerOf("maison", "가"),
      project: null,
    })!.state;
    expect(shellCountsOf(저쪽, "atelier")).toEqual({ 가: 2 });
    expect(shellCountsOf(저쪽, "maison")).toEqual({ 가: 1 });
  });

  // **끝난 칸도 센다 — 그것이 결정 3이 원하는 것이다.** 메타가 서는 조건은 **안 변하는 값**
  // (셸을 포함하는가)이어야 하고, 명령이 끝날 때마다 값이 흔들리면 그 칸이 생겼다 사라져
  // 제목이 끊기는 자리가 좌우로 뛴다.
  it("끝난 칸도 센다 — 메타가 명령마다 생겼다 사라지면 안 된다", () => {
    const { state, ids } = opened(1, 가);
    const 죽은뒤 = markFailed(state, ids[0], "폴더가 없습니다");
    expect(shellCountsOf(죽은뒤, "atelier")).toEqual({ 가: 1 });
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

// 셸이 스스로 말한 것이 오는 **두 번째** 통로. 위와 같은 모양이고 같은 이유로 소스로
// 못박는다 — 이름이 갈리면 컴파일도 타입 검사도 통과하고 화면만 영영 조용하다.
describe("셸이 말한 것이 프런트까지 오는 배선", () => {
  it("이벤트 이름이 백엔드와 **같은 문자열**이다", () => {
    expect(read("../../../src-tauri/src/shells.rs")).toContain(
      'const ATTENTION_EVENT: &str = "shell:attention";',
    );
    expect(read("./api.ts")).toContain('const SHELL_ATTENTION = "shell:attention";');
  });

  // **이펙트가 아니라 모듈 최상위다.** 배경 칸(결정 21로 React 트리 밖에 사는 칸)도 받아야
  // 하고, 받는 쪽이 React가 아니라 모듈 싱글턴 스토어라 붙일 화면이 필요 없다 — 바로 위
  // `onPtyRunning`과 같은 자리·같은 이유다. 이펙트로 내려가면 그 칸들이 조용해진다.
  it("도는 명령 구독 곁에서 모듈 최상위로 듣는다", () => {
    // 줄머리에 선다 — 함수 안이면 앞에 공백이 붙어 이 문자열이 안 맞는다.
    expect(read("./terminal-store.ts")).toContain("\nvoid onShellAttention((changed) => {");
  });
});

// 셸이 스스로 말한 것이 그 칸에 앉는다(#202). 리듀서가 아는 것은 「앉힌다」뿐이고 「무엇이
// 되는가」는 `shell-attention.ts`가 안다 — 그 가름이 이 파일의 값 import 금지 때문이라는 것은
// `Shell.attention`의 머리말이 든다.
describe("셸에 「스스로 말한 것」이 앉는다", () => {
  const 기다림: Attention = {
    kind: "waiting",
    message: "커밋할까요?",
    since: 100,
    seen: false,
    source: "hook",
    agent: "claude",
  };

  it("그 칸에 그대로 앉는다", () => {
    const { state, ids } = opened(1);
    expect(setAttention(state, ids[0], 기다림).shells[0].attention).toBe(기다림);
  });

  it("아직 아무것도 안 온 칸은 비어 있다", () => {
    expect(opened(1).state.shells[0].attention).toBeNull();
  });

  // **바뀐 셸만 갈아 끼운다.** 감시가 회차마다 여러 셸을 실어 오는데, 안 바뀐 칸까지 새
  // 객체가 되면 사이드바와 탭 줄이 통째로 다시 그려진다.
  it("옆 칸은 안 건드린다 — 같은 객체 그대로다", () => {
    const { state, ids } = opened(2);
    const 앉힌뒤 = setAttention(state, ids[0], 기다림);
    expect(앉힌뒤.shells[1]).toBe(state.shells[1]);
  });

  // 판정은 `nextAttention`이 「안 바뀌면 받은 것을 그대로 준다」로 이미 하고, 여기서는 그
  // 항등성만 본다 — 다섯 칸을 견주는 자리가 두 벌이 되면 한쪽만 늙는다.
  it("같은 것이 다시 와도 상태가 그대로다", () => {
    const { state, ids } = opened(1);
    const 앉은뒤 = setAttention(state, ids[0], 기다림);
    expect(setAttention(앉은뒤, ids[0], 기다림)).toBe(앉은뒤);
    expect(setAttention(state, ids[0], null)).toBe(state);
  });

  // 이벤트와 제거가 경주한다 — 이미 닫힌 칸의 파일이 늦게 사라지고 그 알림이 늦게 온다.
  it("모르는 id로는 아무것도 앉지 않는다", () => {
    const { state } = opened(1);
    expect(setAttention(state, 9999, 기다림)).toBe(state);
  });
});

// 「봤다」가 그 칸에 앉는다(결정 7). **누가 봤는지 고르는 것은 이 리듀서가 아니다** —
// 판정은 `shell-attention.ts`의 `isShellSeen` 하나이고 여기는 그 답을 받아 적기만 한다.
describe("「봤다」가 그 칸에 앉는다", () => {
  const 완료: Attention = {
    kind: "done",
    message: "PR #174 열었다",
    since: 100,
    seen: false,
    source: "hook",
    agent: "claude",
  };

  it("본 칸의 상태에 「봤다」가 선다", () => {
    const { state, ids } = opened(1);
    const 앉은뒤 = setAttention(state, ids[0], 완료);
    expect(markSeen(앉은뒤, [ids[0]]).shells[0].attention?.seen).toBe(true);
  });

  it("안 본 칸은 안 건드린다 — 같은 객체 그대로다", () => {
    const { state, ids } = opened(2);
    const 앉은뒤 = setAttention(state, ids[0], 완료);
    expect(markSeen(앉은뒤, [ids[1]]).shells[0]).toBe(앉은뒤.shells[0]);
  });

  it("이미 본 칸도, 아무 주장도 없는 칸도 상태를 그대로 둔다", () => {
    const { state, ids } = opened(1);
    const 본뒤 = markSeen(setAttention(state, ids[0], 완료), [ids[0]]);
    expect(markSeen(본뒤, [ids[0]])).toBe(본뒤);
    expect(markSeen(state, [ids[0]])).toBe(state);
  });

  it("모르는 id는 무시한다", () => {
    const { state } = opened(1);
    expect(markSeen(state, [9999])).toBe(state);
  });
});

// 셸이 말한 것이 **레지스트리까지** 온다. 위 「이벤트 이름이 백엔드와 같은 문자열이다」가
// 통로를 못박고, 이 검사는 그 통로 끝이 상태 축에 이어졌는지를 본다 — 구독만 걸려 있고
// 앉히지 않으면 훅을 걸어도 화면이 영영 조용하고, 그때 빨개지는 검사가 하나도 없다.
describe("셸이 말한 것이 상태 축까지 온다", () => {
  /**
   * 구독 콜백 한 덩이만 떼어 온다. **못 떼면 그 자리에서 터진다** — 표식이 사라졌는데 빈
   * 조각을 세면 아래 셈이 전부 0이 되어, 배선이 통째로 없어져도 조용히 지나간다.
   */
  const 콜백 = () => {
    const store = read("./terminal-store.ts");
    const 시작 = store.indexOf("void onShellAttention(");
    expect(시작, "onShellAttention 구독이 terminal-store에 없다").toBeGreaterThan(-1);
    const 끝 = store.indexOf("}).catch(", 시작);
    expect(끝, "onShellAttention 구독의 끝을 못 찾았다").toBeGreaterThan(시작);
    return store.slice(시작, 끝);
  };

  // **구현 문장을 통째로 베끼지 않는다.** 예전에는 이 자리가 `const ptyId = ptyIdOf(...)` 같은
  // 한 줄을 글자 그대로 못박았는데, 그러면 `one`을 `entry`로 바꾸는 것처럼 **동작을 하나도 안
  // 바꾸는 변경에 빨개지고** 정작 진짜 갈림은 문자열 밖이라 안 잡힌다. 여기서 재는 것은
  // 「거쳐야 하는 자리를 다 거쳤는가」다 — 셸 ID를 번호로 되뽑고(`ptyIdOf`), 그 번호로 칸을
  // 찾고(`shellOfPty`), 어댑터로 접어(`nextAttention`) 그 칸에 앉힌다(`setAttention`).
  //
  // **못 재는 것**: 값이 실제로 그 칸에 앉는가. 이 판에는 그 값을 읽는 화면이 아직 없어서
  // (#203~#206) 어느 층에서도 못 본다 — L3 하네스도 「전이를 쐈다」까지만 본다. #203이 화면을
  // 세우는 순간 그 층에서 재고, 그때까지 이 검사가 지키는 것은 통로의 모양뿐이다.
  it.each(["ptyIdOf(", "shellOfPty(", "nextAttention(", "setAttention("])(
    "받은 것이 %s를 거쳐 그 칸에 앉는다",
    (자리) => {
      expect(countOf(콜백(), 자리), `${자리} — 거쳐야 하는 자리다`).toBe(1);
    },
  );

  // `onPtyRunning`과 **같은 한 번의 `setState`**다. 회차마다 여러 셸이 실려 오는데 칸마다
  // 부르면 그 수만큼 구독자가 깨어난다.
  it("회차 하나를 setState 한 번으로 끝낸다", () => {
    expect(countOf(콜백(), "terminalStore.setState(")).toBe(1);
  });
});

// 죽은 셸의 상태(구현 결정 1). 가름이 둘로 갈린다 — 정상 종료는 칸이 통째로 빠져 상태도
// 같이 가고, 비정상 종료는 칸이 남으므로 읽는 자리에서 가린다(`attentionOn`).
describe("죽은 셸의 상태", () => {
  const 기다림: Attention = {
    kind: "waiting",
    message: "커밋할까요?",
    since: 100,
    seen: false,
    source: "hook",
    agent: "claude",
  };

  it("정상 종료는 칸과 함께 사라진다", () => {
    const { state, ids } = opened(1);
    const 부르던칸 = setAttention(state, ids[0], 기다림);
    expect(markExited(부르던칸, ids[0], { exitCode: 0, signal: null }).shells).toEqual([]);
  });

  // **칸은 남는다**(결정 22 — 죽은 이유를 읽는 것이 이 터미널의 핵심 용도다). 상태 값도
  // 그 칸에 그대로 남아 있고, 화면이 그것을 안 읽는 것은 `attentionOn`의 몫이다.
  it("비정상 종료는 칸을 남긴다 — 가리는 자리는 읽는 쪽이다", () => {
    const { state, ids } = opened(1);
    const 부르던칸 = setAttention(state, ids[0], 기다림);
    const 죽은뒤 = markExited(부르던칸, ids[0], { exitCode: 1, signal: "Terminated: 15" });
    expect(죽은뒤.shells).toHaveLength(1);
    expect(attentionOn(죽은뒤.shells[0])).toBeNull();
  });
});

// 종료 확인이 적는 수(결정 15 · #223). 창과 「묻는 중」 표시는 `quit-request.test.ts`가 본다.
describe("종료 확인이 세는 셸", () => {
  // **물음이 실패해도 던지지 않는다.** 던지면 창이 안 뜨는데 부르는 쪽의 표시만 선 채 남을 수 있고,
  // 그러면 다음 종료 요청이 전부 무시된다 — 앱을 끌 길이 강제 종료뿐이 된다.
  it("거부하는 물음은 그 셸을 안 도는 것으로 센다", async () => {
    const { shells } = opened(2).state;
    // 셸마다 **던지는** 물음이다 — 한 셸의 실패가 나머지 셸의 세기를 끌고 가면 안 된다.
    const counts = await countQuitShells(shells, () => Promise.reject(new Error("IPC 실패")));
    expect(counts).toEqual({ live: 2, running: 0 });
  });

  it("모르면(`null`) 안 도는 것으로 센다 — 셸 닫기 확인과 같은 판정이다", async () => {
    const { shells } = opened(3).state;
    const answers = [true, null, false];
    const counts = await countQuitShells(shells, async (id) => answers[shells.findIndex((s) => s.id === id)]);
    expect(counts).toEqual({ live: 3, running: 1 });
  });

  // 끝난 칸은 목록에 남아 있지만 닫힐 프로세스가 없다 — 물어볼 것도 없다(`needsCloseConfirm`과 같은 규칙).
  it("끝난 칸은 세지도 묻지도 않는다", async () => {
    const two = opened(2).state;
    const state = markExited(two, two.shells[0].id, { exitCode: 1, signal: null });
    const asked: number[] = [];
    const counts = await countQuitShells(state.shells, async (id) => {
      asked.push(id);
      return true;
    });
    expect(counts).toEqual({ live: 1, running: 1 });
    expect(asked).toEqual([state.shells[1].id]);
  });
});

describe("종료 확인의 본문", () => {
  it("셸이 있으면 셸 수와 명령이 도는 셸 수를 적는다", () => {
    expect(quitNotice({ live: 2, running: 1 })).toBe("셸 2 · 명령이 도는 셸 1");
  });

  it("셸이 0개면 그 줄이 없다", () => {
    expect(quitNotice({ live: 0, running: 0 })).toBeUndefined();
  });
});

// 결정 11 · 스펙 §6 — 탭을 끌어 놓으면 **그 화면 셸들의 상대 순서만** 바뀐다. `gap`은 그 화면
// 셸들 사이의 틈 번호(0..n)다 — 0이 첫 칸 앞, n이 마지막 칸 뒤다. ⌘1~9·⌃Tab·`×` 이웃
// 규칙은 같은 배열을 세므로 여기서 순서가 맞으면 따라온다(새 규칙이 없다).
describe("셸 탭을 틈으로 옮긴다", () => {
  // 네 칸짜리 최상위 화면. id가 곧 자리 순서라 기대값을 id로 적는다.
  const four = () => opened(4);

  it.each([
    ["오른쪽 끝으로", 0, 4, [1, 2, 3, 0]],
    ["오른쪽 한 칸 건너", 0, 2, [1, 0, 2, 3]],
    ["왼쪽 끝으로", 3, 0, [3, 0, 1, 2]],
    ["왼쪽 한 칸 건너", 2, 1, [0, 2, 1, 3]],
  ] as const)("%s — %i번째 칸을 틈 %i에 놓는다", (_, from, gap, order) => {
    const { state, ids } = four();
    const moved = moveShell(state, ids[from], gap);
    expect(idsOf(moved)).toEqual(order.map((at) => ids[at]));
  });

  // 제자리 — 원래 자리 `i`의 양옆 틈(`i`·`i+1`)이다. **같은 객체**를 돌려줘야 구독이
  // 안 흔들린다(`sameScreen`의 `a === b`).
  it.each([0, 1, 2, 3])("%i번째 칸을 제 양옆 틈에 놓으면 같은 상태다", (from) => {
    const { state, ids } = four();
    expect(moveShell(state, ids[from], from)).toBe(state);
    expect(moveShell(state, ids[from], from + 1)).toBe(state);
  });

  // 제자리 판정은 **한 곳**이다 — 탭 줄의 틈 선(`tabGap`)도 이것을 불러 선을 안 세운다. 둘이
  // 각자 적으면 선이 선 틈에 놓아도 안 옮겨지거나, 옮겨지는 틈에 선이 안 선다.
  it.each([
    [2, 1, false],
    [2, 2, true],
    [2, 3, true],
    [2, 4, false],
    [0, 0, true],
    [0, 1, true],
  ] as const)("%i번째 칸의 틈 %i은 제자리인가 — %s", (from, gap, inPlace) => {
    expect(isInPlaceGap(from, gap)).toBe(inPlace);
  });

  it("모르는 id는 같은 상태다", () => {
    const { state } = four();
    expect(moveShell(state, 999, 0)).toBe(state);
  });

  // 전역 배열에는 여러 화면의 셸이 섞여 산다. 틈 번호는 **이 화면 셸들 사이**의 것이라,
  // 전역 자리로 세면 남의 셸을 건너뛰는 몫만큼 어긋나고 남의 셸이 밀린다.
  it("남의 화면 셸은 전역 배열에서 제자리다", () => {
    let state = NO_SHELLS;
    const ids: Record<string, number> = {};
    for (const [name, seed] of [
      ["가1", originFor("가")],
      ["나1", originFor("나")],
      ["가2", originFor("가")],
      ["top", TOP],
      ["가3", originFor("가")],
    ] as const) {
      const next = openShell(state, seed)!;
      state = next.state;
      ids[name] = next.id;
    }
    const moved = moveShell(state, ids["가3"], 0);
    expect(idsOf(moved)).toEqual([ids["가3"], ids["나1"], ids["가1"], ids["top"], ids["가2"]]);
    expect(shellsOf(moved, ownerFor("가")).map((shell) => shell.id)).toEqual([
      ids["가3"],
      ids["가1"],
      ids["가2"],
    ]);
  });

  it("켜진 칸은 안 바뀐다", () => {
    const { state, ids } = four();
    const lit = activateShell(state, ids[1]);
    const moved = moveShell(lit, ids[1], 4);
    expect(activeTop(moved)).toBe(ids[1]);
    expect(moved.activeByOwner).toEqual(lit.activeByOwner);
  });

  // 순서만 바뀐 상태를 화면이 **다시 그려야** 한다 — 개수도 켜진 칸도 같아 자리마다의
  // 정체를 보지 않으면 옮긴 탭이 화면에 안 선다.
  it("순서만 바뀌어도 화면이 다시 그려진다", () => {
    const { state, ids } = four();
    expect(sameScreen(state, moveShell(state, ids[0], 4), TOP.owner)).toBe(false);
  });
});
