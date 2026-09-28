import { describe, expect, it } from "vitest";
import { reclaimOnLeave, screenOwner } from "./shell-leave";
import { markFailed, markFirstInput, NO_SHELLS, openShell, ownerOf, topTerminal } from "./shell-registry";
import type { ShellOrigin, ShellsState } from "./shell-registry";

// 떠남(프로세스 스펙 S17)과 그때 회수할 셸(프로세스 결정 7). 순수 모듈이라 기본 환경(node)에서 돈다.
//
// **떠남은 owner가 바뀌는 것이다 — 패인이 내려가는 것이 아니다.** 같은 work 안에서 spec 탭으로
// 바꿀 때도 터미널 패인은 내려가지만, 주소가 가리키는 owner는 그대로다. 그래서 아래는 주소 → owner와
// (앞 owner, 뒤 owner) → 회수할 셸, 두 층으로 잰다.

const 가 = ownerOf("atelier", "ga");
const 나 = ownerOf("atelier", "na");
const 가에서 = (): ShellOrigin => ({ mode: "atelier", cwd: "~/w/ga", owner: 가, project: null });
const 나에서 = (): ShellOrigin => ({ mode: "atelier", cwd: "~/w/na", owner: 나, project: null });

/** 칸을 연다. `auto`가 참이면 셸이 0개인 화면이 스스로 띄운 셸이다(`ensureShell`). */
function open(state: ShellsState, origin: ShellOrigin, auto: boolean): { state: ShellsState; id: number } {
  const opened = openShell(state, origin, auto);
  if (!opened) throw new Error("상한에 닿았다");
  return opened;
}

describe("주소가 선 화면의 owner", () => {
  it.each([
    ["/works/ga", ownerOf("atelier", "ga")],
    ["/maison/rooms/ga", ownerOf("maison", "ga")],
    ["/terminal", ownerOf("atelier")],
    ["/maison/terminal", ownerOf("maison")],
    // 주소의 slug는 인코딩된 채 온다 — 사이드바 강조와 같은 규칙(`slugOf`)으로 푼다.
    ["/works/%ED%95%9C%EA%B8%80", ownerOf("atelier", "한글")],
  ])("%s → %s", (pathname, owner) => {
    expect(screenOwner(pathname)).toBe(owner);
  });

  // owner 없는 화면. 셸을 띄우지 않는 화면이라 그리로 옮기는 것도 떠남이다.
  it.each(["/", "/works", "/maison/rooms", "/archive/ga", "/maison/archive/ga", "/projects/p", "/settings/terminal"])(
    "%s에는 owner가 없다",
    (pathname) => {
      expect(screenOwner(pathname)).toBeNull();
    },
  );
});

describe("떠날 때 회수할 셸", () => {
  // 가에서 저절로 뜬 셸 하나, 저절로 떴지만 사람이 친 셸 하나, `+`로 연 셸 하나, 나의 자동 셸 하나.
  function 네칸(): { state: ShellsState; 안씀: number; 친것: number; 연것: number; 남의것: number } {
    const a = open(NO_SHELLS, 가에서(), true);
    const b = open(a.state, 가에서(), true);
    const c = open(b.state, 가에서(), false);
    const d = open(c.state, 나에서(), true);
    return { state: markFirstInput(d.state, b.id, 1_000), 안씀: a.id, 친것: b.id, 연것: c.id, 남의것: d.id };
  }

  it("다른 work으로 가면 그 owner의 자동으로 떴고 입력 없는 셸만 나온다", () => {
    const { state, 안씀 } = 네칸();
    expect(reclaimOnLeave(state, 가, 나)).toEqual([안씀]);
  });

  it("owner 없는 화면으로 가도 떠남이다", () => {
    const { state, 안씀 } = 네칸();
    expect(reclaimOnLeave(state, 가, null)).toEqual([안씀]);
  });

  it("같은 owner에 머물면 — 같은 work의 spec 탭 전환 — 떠남이 아니다", () => {
    const { state } = 네칸();
    // spec 탭과 터미널 탭은 같은 주소다(탭은 search에 있다) — owner가 그대로다.
    expect(screenOwner("/works/ga")).toBe(가);
    expect(reclaimOnLeave(state, 가, 가)).toEqual([]);
  });

  // owner가 없던 화면에서 오는 것은 떠난 셸이 없다 — 앱이 처음 뜰 때도 그렇다.
  it("owner 없는 화면에서 오면 나오는 셸이 없다", () => {
    const { state } = 네칸();
    expect(reclaimOnLeave(state, null, 가)).toEqual([]);
  });

  it("입력이 있는 셸과 `+` · ⌘T로 띄운 셸은 나오지 않는다", () => {
    const { state, 친것, 연것, 남의것 } = 네칸();
    const out = reclaimOnLeave(state, 가, 나);
    // 앵커 — 같은 떠남에서 회수할 셸이 실제로 하나 나온다. 비어 있으면 아래 「없다」가 헛돈다.
    expect(out).toHaveLength(1);
    expect(out).not.toContain(친것);
    expect(out).not.toContain(연것);
    // 남의 owner 셸은 이 떠남과 무관하다.
    expect(out).not.toContain(남의것);
  });

  // 최상위 터미널도 owner다(life-mode 결정 10). 세계마다 따로다.
  it("최상위 터미널을 떠나면 그 세계의 자동 셸이 나온다", () => {
    const top = open(NO_SHELLS, topTerminal("atelier"), true);
    const there = open(top.state, topTerminal("maison"), true);
    expect(reclaimOnLeave(there.state, ownerOf("atelier"), ownerOf("maison"))).toEqual([top.id]);
  });

  // 못 뜬 칸은 이유를 적고 남는다(in-app-terminal 결정 23) — 닫을 프로세스도 없다. 회수하면 읽어야 할 이유가 함께 사라진다.
  it("못 뜬 자동 셸은 나오지 않는다", () => {
    const a = open(NO_SHELLS, 가에서(), true);
    const failed = markFailed(a.state, a.id, "셸을 띄우지 못했습니다");
    const b = open(failed, 가에서(), true);
    expect(reclaimOnLeave(b.state, 가, 나)).toEqual([b.id]);
  });
});
