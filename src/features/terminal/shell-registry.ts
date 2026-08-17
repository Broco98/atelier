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
 * 칸 하나. `title`과 `shellName`은 **이름의 두 갈래**를 그대로 들고 있는다(결정 31) —
 * 합쳐 놓으면 타이틀이 비었을 때 무엇으로 돌아가야 하는지가 사라진다. 고르는 규칙은
 * `shellLabel`이 혼자 안다.
 *
 * cwd·소속(owner)은 아직 없다 — 판 03이 더한다.
 */
export interface Shell {
  id: number;
  status: ShellStatus;
  /** 셸이 OSC 0·2로 쏜 타이틀. 안 쏘는 셸도 많아서 대개 null이다. */
  title: string | null;
  /** `$SHELL`의 basename. 백엔드가 spawn 응답에 실어 준다(결정 8) — 프런트는 모른다. */
  shellName: string | null;
}

export interface ShellsState {
  shells: ReadonlyArray<Shell>;
  activeId: number | null;
  // 다음에 발급할 번호. 아래 openShell의 주석이 이유다.
  nextId: number;
}

export const NO_SHELLS: ShellsState = { shells: [], activeId: null, nextId: 1 };

/**
 * 앱 전체에서 동시에 살 수 있는 셸 수(결정 30).
 *
 * **화면 단위가 아니라 앱 단위다.** WebGL 컨텍스트는 웹뷰의 자원이고, 결정 21이 비활성
 * 셸의 xterm 인스턴스를 React 트리 밖에 두었으므로 **안 보이는 칸도 컨텍스트를 계속 쥔다.**
 * 세는 자리가 이 상태 하나여야 판 03에서 Work마다 8개가 되는 일이 없다.
 */
export const MAX_SHELLS = 8;

/** 상한에 닿았다. `+`가 잠기는 판정과 `openShell`이 거부하는 판정이 이것 하나다. */
export function atCap(state: ShellsState): boolean {
  return state.shells.length >= MAX_SHELLS;
}

/**
 * 셸 한 칸을 목록 끝에 더하고 그것을 활성으로 만든다.
 *
 * **id는 이 모듈이 발급한다 — PTY id가 아니다.** 띄우기에 실패한 셸도 칸을 갖는데(결정 23)
 * 그때는 PTY id라는 것이 아예 없다. 그리고 번호를 재사용하지 않으려면 발급하는 자리가
 * 하나여야 한다: 목록을 비웠다 다시 띄울 때 `max(id)+1`은 예전 번호를 돌려주고, 그 사이에
 * 떠 있던 spawn 응답이 새 셸의 칸에 꽂힌다.
 *
 * **상한에 닿으면 `null`이다.** 부르는 쪽이 거부를 못 본 척할 수 없는 모양이라야 한다 —
 * 조용히 상태를 그대로 돌려주면 `+`가 눌리는데 아무 일도 안 나는 화면이 된다.
 */
export function openShell(state: ShellsState): { state: ShellsState; id: number } | null {
  if (atCap(state)) return null;

  const id = state.nextId;
  return {
    state: {
      shells: [...state.shells, { id, status: { kind: "running" }, title: null, shellName: null }],
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

/** 이름 셋 다 없을 때의 마지막 자리. 못 띄운 칸에는 타이틀도 셸 이름도 영영 오지 않는다. */
const UNNAMED = "셸";

/**
 * 칸 하나를 갈아 끼운다. **바뀐 것이 없으면 받은 상태를 그대로 돌려준다** — 없는 id이거나
 * 값이 같을 때다.
 *
 * 없는 id가 실제로 온다: 이미 지워진 칸에 대한 프레임이 늦게 도착한다(제거와 IPC가 경주한다).
 * 값이 같은 것도 실제로 온다: 프롬프트마다 같은 타이틀을 쏘는 셸이 흔하다. 둘 다 새 상태를
 * 만들면 화면이 이유 없이 다시 그려진다.
 */
function patch(state: ShellsState, id: number, change: (shell: Shell) => Shell): ShellsState {
  const index = state.shells.findIndex((shell) => shell.id === id);
  if (index === -1) return state;

  const changed = change(state.shells[index]);
  if (changed === state.shells[index]) return state;

  const shells = [...state.shells];
  shells[index] = changed;
  return { ...state, shells };
}

function withStatus(state: ShellsState, id: number, status: ShellStatus): ShellsState {
  return patch(state, id, (shell) => ({ ...shell, status }));
}

/**
 * 셸이 쏜 타이틀(OSC 0·2). 빈 문자열은 **이름을 지운 것**이라 null로 눕힌다 — 그래야
 * `shellLabel`이 셸 이름으로 돌아간다.
 */
export function setTitle(state: ShellsState, id: number, title: string): ShellsState {
  const next = title.trim() || null;
  return patch(state, id, (shell) => (shell.title === next ? shell : { ...shell, title: next }));
}

/** spawn 응답이 실어 준 `$SHELL`의 basename(결정 8). 타이틀이 없을 때의 이름이다. */
export function setShellName(state: ShellsState, id: number, shellName: string): ShellsState {
  return patch(state, id, (shell) =>
    shell.shellName === shellName ? shell : { ...shell, shellName },
  );
}

/**
 * 칸을 고른다. **없는 id는 무시한다** — 그리는 것과 누르는 것 사이에 그 칸이 빠질 수 있고,
 * 없는 칸을 활성으로 만들면 켜진 칸도 본문도 없는 화면이 이유 없이 남는다.
 */
export function activateShell(state: ShellsState, id: number): ShellsState {
  if (state.activeId === id) return state;
  if (!state.shells.some((shell) => shell.id === id)) return state;
  return { ...state, activeId: id };
}

/** 칸에 적는 이름. 타이틀 → 셸 이름 순이고, 둘 다 없어도 **비지 않는다**(결정 31·23). */
export function shellLabel(shell: Shell): string {
  return shell.title ?? shell.shellName ?? UNNAMED;
}

/**
 * 그 칸이 어떻게 끝났는지. 도는 셸에는 없다.
 *
 * 둘을 **한 번에** 내는 이유는 같은 사실의 두 길이여서다 — `notice`는 활성 칸 아래 줄에
 * 적히는 한 문장이고, `mark`는 목록에서 **어느 칸이** 죽었는지를 누르지 않고 알아보게
 * 하는 짧은 꼬리표다. 따로 두면 같은 status 분기가 두 벌이 되어 한쪽만 늙는다.
 */
export function shellEndLabels(shell: Shell): { mark: string; notice: string } | null {
  const status = shell.status;
  if (status.kind === "failed") return { mark: "실패", notice: status.reason };
  if (status.kind === "exited") {
    return status.exit.signal !== null
      ? { mark: "신호", notice: `신호로 종료 — ${status.exit.signal}` }
      : { mark: String(status.exit.exitCode), notice: `종료 코드 ${status.exit.exitCode}` };
  }
  return null;
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
