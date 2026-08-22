import type { WorkView } from "@/features/works/types";
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
 *
 * **정상 종료만은 `exited`가 되지 않는다**(결정 48). 결정 22의 근거는 위 한 줄뿐이었고
 * `exit`에는 읽을 이유가 없어서, 근거를 해치지 않고 범위만 좁혔다 — 남기는 것은 이유가
 * 있을 때만이다. 가르는 자리는 `markExited` 하나이므로, 여기 `exited`로 앉아 있는 칸은
 * 전부 「이유가 있는 끝」이다.
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
 * **cwd가 여기 있다 — 한때 없었다.** 「셸이 뜨는 순간에만 쓰이고 그 뒤로는 아무도 안
 * 묻는다」가 빼 두었던 이유인데, 결정 45가 묻는 자리를 만들었다: 패널 `shell` 탭의 행
 * 둘째 줄이 **도는 셸의 cwd**다. 화면이 구독하는 값은 이 상태 하나이므로(xterm 인스턴스는
 * 리렌더가 그것을 다시 만드는 경로가 없어야 해서 스토어 옆 모듈 스코프에 따로 산다),
 * 목록이 들지 않으면 그 값이 화면까지 오는 길이 아예 없다.
 */
export interface Shell {
  id: number;
  status: ShellStatus;
  /** 셸이 OSC 0·2로 쏜 타이틀. 안 쏘는 셸도 많아서 대개 null이다. */
  title: string | null;
  /** `$SHELL`의 basename. 백엔드가 spawn 응답에 실어 준다(결정 8) — 프런트는 모른다. */
  shellName: string | null;
  /** 어느 Work의 셸인가(결정 26). 최상위 터미널은 `null`이다 — Work가 아니다. */
  owner: string | null;
  /** 이름의 가운데 갈래(결정 31). 프로젝트가 여럿인 Work에서만 찬다. */
  project: string | null;
  /**
   * 이 셸이 뜬 자리. `~` 축약 표기 그대로이고(펴는 것은 백엔드다 — 결정 25) `null`이면
   * 데이터 루트다. 여는 순간 `ShellOrigin`에서 받아 그대로 눌러앉는다 — 셸이 `cd`로
   * 옮겨 다녀도 이 값은 안 바뀐다. 그래서 이것이 말하는 것은 「지금 어디냐」가 아니라
   * **「어디서 떴냐」**다.
   */
  cwd: string | null;
}

export interface ShellsState {
  shells: ReadonlyArray<Shell>;
  /**
   * **켜진 칸은 화면마다 따로다.** 키는 소유자이고 최상위 터미널은 빈 문자열이다
   * (Work slug는 비어 있을 수 없다).
   *
   * 하나로 두면 Work 가에서 나로 갔다 오는 것만으로 가의 줄에 켜진 칸이 없어지고,
   * 그 자리에서 「없으면 하나 띄운다」가 돌면 이미 있는 셸 옆에 셸이 또 뜬다. `×`의
   * 이웃 규칙도 남의 Work 셸을 켜게 된다.
   */
  activeByOwner: Readonly<Record<string, number>>;
  // 다음에 발급할 번호. 아래 openShell의 주석이 이유다.
  nextId: number;
}

export const NO_SHELLS: ShellsState = { shells: [], activeByOwner: {}, nextId: 1 };

/** 소유자를 레코드 키로. Work slug가 비어 있을 수 없어서 최상위와 안 겹친다. */
const ownerKey = (owner: string | null) => owner ?? "";

/**
 * 새 셸 하나를 여는 데 필요한 것 전부. **`cwd`가 `null`이면 데이터 루트**이고, 그 자리가
 * 어디인지는 `ATELIER_HOME`을 보는 백엔드만 안다(결정 25).
 */
export interface ShellOrigin {
  /** `~` 축약 표기의 cwd 후보. 펴는 것은 백엔드 한 곳이다 — 여기서 홈을 붙이지 않는다. */
  cwd: string | null;
  owner: string | null;
  project: string | null;
}

/** 최상위 터미널(`/terminal`)이 셸을 여는 자리. Work가 아니라 소유자가 없다. */
export const TOP_TERMINAL: ShellOrigin = { cwd: null, owner: null, project: null };

/**
 * 이 Work에서 셸 하나를 여는 자리(결정 24). **`null`이면 열지 않는다.**
 *
 * | Work의 모양 | cwd |
 * |---|---|
 * | 프로젝트 1개 | 그 워크트리 |
 * | 프로젝트 여럿 | 고른 프로젝트의 워크트리 — **안 고르면 `null`** |
 * | 프로젝트 0개 | Work 폴더 |
 *
 * `worktrees[].exists`는 보지 않는다. 폴더가 없으면 spawn이 실패하고 결정 23의 「그 칸에
 * 이유를 적는다」를 그대로 탄다 — 여기서 한 번 더 판정하면 같은 사실을 두 곳이 말한다.
 */
export function workShellOrigin(work: WorkView, project: string | null): ShellOrigin | null {
  const trees = work.worktrees;
  if (trees.length === 0) return { cwd: workDir(work), owner: work.slug, project: null };
  // 하나뿐이면 고를 것이 없다. 이름에 프로젝트를 적을 이유도 없다(결정 31).
  if (trees.length === 1) return { cwd: trees[0].path, owner: work.slug, project: null };

  const picked = project === null ? undefined : trees.find((tree) => tree.project === project);
  return picked ? { cwd: picked.path, owner: work.slug, project: picked.project } : null;
}

/**
 * Work 폴더는 **`specDir`의 부모로 유도한다**(결정 25). `refs.ts`의 `workDirRef`는
 * `~/.atelier/works/…`를 손으로 적는데 그쪽은 클립보드로 나가는 참조 형식이라 그래도 된다.
 * 여기 값은 셸의 cwd가 되므로 `ATELIER_HOME`을 바꾼 사람에게 어긋나면 안 된다 —
 * 그 자리가 어디인지 아는 것은 코어뿐이고, `specDir`가 코어에서 온 값이다.
 */
function workDir(work: WorkView): string {
  return work.specDir.replace(/\/+[^/]+\/*$/, "");
}

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
 * 상한에 닿았을 때 사람에게 하는 말. **입구 둘이 같은 문장을 쓴다**(결정 47) —
 * 패널 목록의 잠긴 `+` 행이 그 자리에 이 문장을 적고, ⌘T가 거절당했을 때 뜨는 토스트도
 * 같은 문장이다. 두 입구가 같은 사실을 말하는데 문장이 갈리면 한쪽만 늙는다.
 *
 * 라벨은 소문자 영어여도 **문장은 한국어다**(CONTEXT.md). 「셸」이 프로세스를 세는 단위다.
 *
 * 최상위 터미널의 가로 탭 줄은 이 문장을 쓰지 않는다 — 거기 `+`는 폭이 없어 이유를
 * `title`(hover)에 적고, 그 자리는 「다른 터미널의 셸도 함께 셉니다」까지 말할 여유가 있다.
 */
export function shellCapNotice(state: ShellsState): string {
  return `셸은 ${MAX_SHELLS}개까지예요 — 지금 ${state.shells.length}개`;
}

/**
 * 셸을 열려 한 뒤 사람에게 할 말. **열렸으면 `null`이다 — 성공 경로는 조용하다.**
 *
 * 이 판정은 한때 터미널 스토어의 `openNewShell` 안에 있었는데, 그 함수는 열리는 순간
 * xterm 인스턴스를 세우므로 **성공 경로를 테스트에서 돌 수 없다**(DOM 없는 seam이다).
 * 그래서 계약의 절반 — 「열렸으면 아무 말도 안 한다」 — 이 어떤 검사에도 안 걸린 채였다.
 * 거절을 알리는 줄이 성공 경로로 새면 ⌘T와 `+`가 **열 때마다** 「셸은 8개까지예요」를
 * 뱉는데, 그것을 잡는 그물이 없었다. 판정을 이 순수 모듈로 내려 두 절반을 함께 못박는다.
 *
 * **`opened`를 통째로 받는다 — 불리언으로 접어 받지 않는다.** 접는 것이 부르는 쪽의
 * 일이 되면 거절 판정이 다시 저쪽으로 새어, 이 함수가 지키는 것이 문장 하나로 줄어든다.
 *
 * 문장은 `shellCapNotice`가 짓는다 — 잠긴 `+` 행이 읽는 것과 같은 문장이어야 해서다(결정 47).
 */
export function shellOpenNotice(state: ShellsState, opened: OpenedShell | null): string | null {
  return opened ? null : shellCapNotice(state);
}

/** `openShell`이 열었을 때 돌려주는 것. 새 목록과 그 자리에서 발급한 id다. */
export interface OpenedShell {
  state: ShellsState;
  id: number;
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
 *
 * 소유자를 **반드시 받는다.** 기본값을 두면 Work 화면에서 빠뜨린 셸이 최상위 것이 되어,
 * 그 Work를 아카이빙할 때 안 거둬지고 탭 줄에도 안 뜬다.
 *
 * **`origin`을 통째로 받는다 — 갈래 둘만 뽑아 받지 않는다.** 한때 `owner`·`project`만
 * 받았는데, cwd가 칸에 눌러앉게 되면서(위 `Shell.cwd`) 뽑을 이유가 없어졌다. 통째로
 * 받으면 여는 자리가 셸에 적히는 자리와 **같은 값 하나**를 본다.
 */
export function openShell(state: ShellsState, origin: ShellOrigin): OpenedShell | null {
  if (atCap(state)) return null;

  const id = state.nextId;
  const shell: Shell = {
    id,
    status: { kind: "running" },
    title: null,
    shellName: null,
    owner: origin.owner,
    project: origin.project,
    cwd: origin.cwd,
  };
  return {
    state: {
      shells: [...state.shells, shell],
      activeByOwner: { ...state.activeByOwner, [ownerKey(origin.owner)]: id },
      nextId: id + 1,
    },
    id,
  };
}

/**
 * 이 화면이 보여줄 칸들. **상한은 이것으로 세지 않는다** — 그것은 앱 전체 기준이라
 * `atCap`이 목록 전체를 본다(결정 30).
 */
export function shellsOf(state: ShellsState, owner: string | null): ReadonlyArray<Shell> {
  return state.shells.filter((shell) => shell.owner === owner);
}

/**
 * 이 화면에서 **도는** 셸의 수. 끝난 칸과 못 뜬 칸은 목록에 남아 있지만 죽일 프로세스가
 * 없어서 세지 않는다 — 아카이브 확인 대화가 「셸 N개가 닫혀요」라고 말할 때의 N이 이것이다
 * (결정 26). 함께 세면 2개라고 해놓고 하나만 끝난다.
 */
export function runningShellsOf(state: ShellsState, owner: string | null): number {
  return shellsOf(state, owner).filter((shell) => shell.status.kind === "running").length;
}

/** 이 화면에서 켜진 칸. */
export function activeIdOf(state: ShellsState, owner: string | null): number | null {
  return state.activeByOwner[ownerKey(owner)] ?? null;
}

/**
 * 종료 프레임이 왔다. 칸은 그대로 두고 상태만 바꾼다 — 활성이었으면 활성인 채로 남는다.
 *
 * **정상 종료(`exitCode === 0` && `signal === null`)만은 그 칸을 목록에서 뺀다**(결정 48).
 * 시그널로 죽은 셸이 이 조건에 섞이지 않는 것은 백엔드가 「시그널이면 `exitCode`는 셸 관례인
 * `128+N`이 아니라 `1`」로 정해 둔 덕인데(`types.ts`), 그 약속 하나에 기대지 않고 `signal`도
 * 함께 본다 — 약속이 흔들려 0이 실려 와도 신호로 죽은 칸은 남아야 한다.
 *
 * **판정은 여기 한 번뿐이다.** 종료 정보가 상태에 닿는 길이 이 함수뿐이라(터미널 스토어의
 * 채널 콜백) 부르는 쪽에서 한 번 더 가르면 같은 판정이 두 벌이 되고 한쪽만 늙는다. 못 뜬
 * 셸은 `markFailed`로 와서 종료 코드라는 것이 아예 없으므로 이 조건에 걸릴 길이 없다.
 *
 * **빼는 길은 `×`와 같다** — `removeShell`을 그대로 부른다. 다음에 켜질 칸을 여기서 새로
 * 정하지 않는다. 마지막 칸이 이렇게 사라지면 셸 0개인 화면이 되고, 그 자리에서 새 셸이
 * 저절로 뜨지 않는 것까지 `×`의 성질을 그대로 물려받는다.
 *
 * **빠진 칸의 인스턴스를 거두는 일은 여기 없다 — 그 자리는 터미널 스토어다.** 상한 8이
 * 세는 것은 셸의 수가 아니라 살아 있는 WebGL 컨텍스트의 수라(결정 30), 목록에서만 빼면
 * 「열고 → `exit`」을 되풀이하는 동안 목록은 0개라 말하는데 컨텍스트는 계속 쌓인다.
 * `×`는 `closeShell`이 둘을 한자리에서 해서 안 새는데 이 길에는 그 짝이 아직 없다.
 * 거두는 일은 DOM을 아는 쪽만 할 수 있어 이 순수 모듈에 들일 수 없다.
 */
export function markExited(state: ShellsState, id: number, exit: PtyExit): ShellsState {
  if (exit.exitCode === 0 && exit.signal === null) return removeShell(state, id);
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
  const shell = state.shells.find((one) => one.id === id);
  if (!shell) return state;

  const key = ownerKey(shell.owner);
  if (state.activeByOwner[key] === id) return state;
  return { ...state, activeByOwner: { ...state.activeByOwner, [key]: id } };
}

/** 터미널이 셸에 넘기지 않고 **앱이 가져가는** 조작. */
export type ShellHotkey = "new" | "close";

/**
 * ⌘T는 새 칸, ⌘W는 이 칸 닫기. Terminal.app·iTerm·VS Code가 같은 키다.
 *
 * **결정 29의 예외는 여기 둘뿐이다.** 그 결정은 「포커스가 터미널에 있으면 ⌘까지 셸이
 * 먹는다」인데, ⌘만은 앱이 가져가도 잃는 것이 없다 — 셸도 TUI도 ⌘를 안 쓴다(macOS
 * 터미널들이 ⌘를 자기 몫으로 두는 이유다). ⌃T였다면 zsh emacs 모드의 `transpose-chars`와
 * fzf의 파일 위젯을 뺏었을 것이다.
 *
 * **⌘W는 특히 앱이 가져가야 한다.** 안 가져가면 macOS 메뉴의 `Close Window`가 먹어
 * **창이 닫히고 셸이 전부 죽는다**(실물에서 그렇게 잃었다). 그 메뉴 항목은 이제 없다 —
 * `src-tauri/src/lib.rs`의 메뉴가 그 자리를 비워 이 키가 웹뷰까지 오게 한다. 두 자리가
 * 함께여야 성립하므로 한쪽만 고치면 조용히 옛 동작으로 돌아간다.
 *
 * **`key`가 아니라 `code`로 본다.** `key`는 배열과 IME를 탄다 — 한글 입력기가 켜져 있으면
 * 같은 키가 자모로 온다(실측). `code`는 물리 키라 둘 다 안 탄다.
 *
 * 수식키가 하나라도 더 붙으면 **셸 몫이다.** ⌘⇧T·⌥⌘W까지 먹으면 근거 없이 넓히는 것이고,
 * 그 미끄러짐이 결정 29가 막으려는 것이다.
 */
export function shellHotkey(event: {
  type: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): ShellHotkey | null {
  if (event.type !== "keydown") return null;
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.code === "KeyT") return "new";
  if (event.code === "KeyW") return "close";
  return null;
}

/** 칸에 적는 이름. 타이틀 → 프로젝트 → 셸 이름 순이고, 셋 다 없어도 **비지 않는다**(결정 31·23). */
export function shellLabel(shell: Shell): string {
  return shell.title ?? shell.project ?? shell.shellName ?? UNNAMED;
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
 * 세로 목록 한 행의 **첫 줄 — 이름**이다. `프로젝트 · 타이틀`로 **함께 적는다**(결정 46).
 *
 * `shellLabel`과 갈리는 자리는 프로젝트 하나다. 저쪽은 셋 중 하나를 **고르므로** 타이틀이
 * 오는 순간 프로젝트가 사라진다 — 실물에서 로그인 zsh가 뜨자마자 OSC 타이틀을 쏴 이름이
 * `gimhyoyeon@gimhy…`가 되고 어느 워크트리의 셸인지가 없어졌다. 세로 목록은 한 행에 두
 * 줄을 쓸 수 있어 그 부담이 없고, 그것이 결정 46이 갈래 셋 중 ③을 고른 이유다.
 *
 * **가로 탭 줄은 그대로 `shellLabel`이다**(결정 44·46) — 거기는 칸 하나에 이름 하나뿐이라
 * 폭이 없다. 같은 일이 두 화면에서 다른 모양인 것이 그 결정이 감수한 대가다.
 */
export function shellRowName(shell: Shell): string {
  // 프로젝트를 앞에 적었으니 뒤 갈래에서는 뺀다 — 안 빼면 타이틀 없는 칸이 `cli · cli`가 된다.
  const tail = shell.title ?? shell.shellName ?? UNNAMED;
  return shell.project ? `${shell.project} · ${tail}` : tail;
}

/**
 * 행의 **둘째 줄 — 지금 상태**다(결정 45). 도는 셸은 어디서 떴는지, 끝난 셸은 어떻게
 * 끝났는지. 한 자리가 둘을 겸하는 것은 궁금한 것이 그때마다 하나뿐이어서다.
 *
 * **`pid`는 여기 없다**(결정 45). 백엔드가 주는 것은 `PtySpawned { id, shellName }`뿐이라
 * 화면까지 오는 길이 아예 없고, 결정 22가 요구하는 「조용히 죽은 이유 읽기」에 필요한
 * 것은 종료 코드와 이유이며 그것은 이미 와 있다.
 */
export function shellRowStatus(shell: Shell): string {
  // 끝난 칸이 먼저다 — `shellEndLabels`가 null을 주는 것이 곧 「아직 돈다」이므로 상태를
  // 여기서 한 번 더 가르지 않는다.
  const end = shellEndLabels(shell);
  if (end) return end.notice;
  // cwd가 없는 것은 최상위 터미널의 셸뿐이고(결정 25) 그 화면에는 이 목록이 없다. 그래도
  // 빈 문자열을 돌려주지 않는 것은 행이 두 줄로 서기 때문이다 — 비면 이유 없는 빈 줄이 남는다.
  return shell.cwd ?? "데이터 루트";
}

/**
 * **목록에서 빼는 유일한 조작이다.** 못 뜬 칸은 빠지지 않고, 끝난 칸은 `markExited`가
 * 정상 종료를 가려 이리로 보낼 때만 빠진다(결정 48) — 그 길도 결국 이 함수라, 다음에
 * 켜질 칸을 정하는 규칙은 여전히 한 벌이다.
 *
 * 활성 칸을 빼면 다음 활성은 **오른쪽 이웃 → 없으면 왼쪽 이웃 → 그 화면이 비면 없음**이다.
 * 판 02의 `×`가 이 규칙에 붙는다.
 *
 * **이웃은 같은 소유자 안에서 고른다.** 전체 목록에서 고르면 남의 Work 셸이 켜져, 그 줄에
 * 켜진 칸이 없어진다.
 */
export function removeShell(state: ShellsState, id: number): ShellsState {
  const gone = state.shells.find((shell) => shell.id === id);
  if (!gone) return state;

  const shells = state.shells.filter((shell) => shell.id !== id);
  const key = ownerKey(gone.owner);
  if (state.activeByOwner[key] !== id) return { ...state, shells };

  const siblings = state.shells.filter((shell) => shell.owner === gone.owner);
  // 빠진 자리의 index가 곧 오른쪽 이웃이다. 없으면 그 앞이 왼쪽 이웃이고, 둘 다 없으면 빈 화면이다.
  const at = siblings.findIndex((shell) => shell.id === id);
  const rest = siblings.filter((shell) => shell.id !== id);
  const next = rest[at] ?? rest[at - 1] ?? null;

  const activeByOwner = { ...state.activeByOwner };
  if (next) activeByOwner[key] = next.id;
  else delete activeByOwner[key];
  return { ...state, shells, activeByOwner };
}
