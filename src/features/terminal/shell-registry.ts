import type { PtyExit } from "./types";

// 셸 목록과 그 목록에 관한 규칙만 아는 순수 모듈. import는 타입뿐이라 DOM 없는 기본 환경에서
// 그대로 돈다(work-sections.ts·shell-store.ts의 pickSlug가 선례). 그 성질은 주석이 아니라
// shell-registry.test.ts의 소스 스캔이 지킨다.
//
// 이 모듈이 React 밖에 있는 것은 취향이 아니다 — 결정 21이 "비활성 셸의 xterm 인스턴스는
// React 트리 밖에 산다"를 요구하고, 그 인스턴스를 가리키는 목록이 컴포넌트 state에 있으면
// 라우트 하나 옮기는 것으로 같이 지워진다.

/**
 * 셸 한 칸의 상태. `exited`·`failed`도 **목록에 남는 상태**다 — 사라지는 상태가 아니다.
 * `claude`가 조용히 죽었을 때 이유를 읽는 것이 이 터미널의 핵심 용도라(결정 22),
 * 끝났다는 이유로 칸을 치우면 읽을 자리가 없어진다.
 */
export type ShellStatus =
  | { kind: "running" }
  | { kind: "exited"; exit: PtyExit }
  | { kind: "failed"; reason: string };

/**
 * 지금 갖는 것은 `id`와 `status`뿐이다. 탭 이름·cwd·소속(owner)은 그것을 실제로 그리는
 * 판에서 더한다 — 미리 늘리면 아무도 안 읽는 필드를 채우는 코드가 먼저 생긴다.
 */
export interface Shell {
  id: number;
  status: ShellStatus;
}

export interface ShellsState {
  shells: ReadonlyArray<Shell>;
  activeId: number | null;
  // 다음에 발급할 번호. 아래 openShell의 주석이 이유다.
  nextId: number;
}

export const NO_SHELLS: ShellsState = { shells: [], activeId: null, nextId: 1 };

/**
 * 셸 한 칸을 목록 끝에 더하고 그것을 활성으로 만든다.
 *
 * **id는 이 모듈이 발급한다 — PTY id가 아니다.** 띄우기에 실패한 셸도 칸을 갖는데(결정 23)
 * 그때는 PTY id라는 것이 아예 없다. 그리고 번호를 재사용하지 않으려면 발급하는 자리가
 * 하나여야 한다: 목록을 비웠다 다시 띄울 때 `max(id)+1`은 예전 번호를 돌려주고, 그 사이에
 * 떠 있던 spawn 응답이 새 셸의 칸에 꽂힌다.
 */
export function openShell(state: ShellsState): { state: ShellsState; id: number } {
  const id = state.nextId;
  return {
    state: {
      shells: [...state.shells, { id, status: { kind: "running" } }],
      activeId: id,
      nextId: id + 1,
    },
    id,
  };
}

/** 종료 프레임이 왔다. 칸은 그대로 두고 상태만 바꾼다 — 활성이었으면 활성인 채로 남는다. */
export function markExited(state: ShellsState, id: number, exit: PtyExit): ShellsState {
  return withStatus(state, id, { kind: "exited", exit });
}

/** 셸을 못 띄웠다. 이유가 그 칸에 적힌다(결정 23). */
export function markFailed(state: ShellsState, id: number, reason: string): ShellsState {
  return withStatus(state, id, { kind: "failed", reason });
}

// 이미 지워진 칸에 대한 프레임이 늦게 도착할 수 있다(제거와 IPC가 경주한다). map이 그대로
// 흘려보낸다 — 없는 id는 아무것도 안 바꾼다.
function withStatus(state: ShellsState, id: number, status: ShellStatus): ShellsState {
  return {
    ...state,
    shells: state.shells.map((shell) => (shell.id === id ? { ...shell, status } : shell)),
  };
}

/**
 * **목록에서 빼는 유일한 조작이다.** 종료도 실패도 빼지 않는다.
 *
 * 활성 칸을 빼면 다음 활성은 **오른쪽 이웃 → 없으면 왼쪽 이웃 → 목록이 비면 없음**이다.
 * 판 02의 `×`가 이 규칙에 붙는다.
 */
export function removeShell(state: ShellsState, id: number): ShellsState {
  const index = state.shells.findIndex((shell) => shell.id === id);
  if (index === -1) return state;

  const shells = state.shells.filter((shell) => shell.id !== id);
  if (state.activeId !== id) return { ...state, shells };

  // 빠진 자리의 index가 곧 오른쪽 이웃이다. 없으면 그 앞이 왼쪽 이웃이고, 둘 다 없으면 빈 목록이다.
  const next = shells[index] ?? shells[index - 1] ?? null;
  return { ...state, shells, activeId: next?.id ?? null };
}
