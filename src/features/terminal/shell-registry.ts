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
 * `shellRowName`이 혼자 안다.
 *
 * **cwd가 여기 있다 — 한때 없었다.** 「셸이 뜨는 순간에만 쓰이고 그 뒤로는 아무도 안
 * 묻는다」가 빼 두었던 이유인데, 결정 45가 묻는 자리를 만들었다: 셸 행의 둘째 줄이
 * **도는 셸의 cwd**다. 화면이 구독하는 값은 이 상태 하나이므로(xterm 인스턴스는
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
  /**
   * 이 셸에서 **지금 도는 명령**의 프로세스 이름. 프롬프트에 서 있으면 `null`이다.
   *
   * **이 칸이 있는 것은 결정 92를 뒤집은 결과다**(adr-04). 그 결정은 「도는가」를 닫기 직전
   * 한 번만 묻고 상태에 얹지 않았는데, 바뀐 것은 값의 성질이 아니라 목적이다 — 「어느
   * work에서 무엇이 도는가」를 늘 보는 것은 구독 없이 답할 수 없다. 백엔드가 1초마다 재서
   * **바뀐 셸만** 실어 보낸다.
   *
   * **원문 그대로다**(`claude`·`codex`·`node`·`cargo`). 「claude냐 codex냐」의 판정과 로고
   * 매핑은 이 값을 읽는 화면이 든다 — 백엔드가 그걸 알면 에이전트가 늘 때마다 Rust를
   * 고쳐야 하고, 여기서 접으면 그 매핑이 두 벌이 된다.
   *
   * **읽을 때는 `runningOn`을 쓴다** — 끝난 칸에 남은 마지막 값을 가르는 자리가 거기다.
   */
  running: string | null;
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
 * 잠긴 `+ 새 셸` 행이 그 자리에 이 문장을 적고, ⌘T가 거절당했을 때 뜨는 토스트도 같은
 * 문장이다. 두 입구가 같은 사실을 말하는데 문장이 갈리면 한쪽만 늙는다.
 *
 * 라벨은 소문자 영어여도 **문장은 한국어다**(CONTEXT.md). 「셸」이 프로세스를 세는 단위다.
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
 * 그 Work를 아카이빙할 때 안 거둬지고 그 work의 가지에도 안 뜬다.
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
    // 첫 값은 백엔드의 다음 회차가 준다(adr-04) — 최대 1초다. 여기서 미리 채울 것이 없다.
    running: null,
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
/**
 * 소유자별 셸 개수 — 사이드바에서 **어느 work에 가지가 서는가**를 정하는 값이다(결정 73).
 *
 * **타이틀에는 안 흔들린다.** 셸은 프롬프트마다 OSC 타이틀을 쏘는데, 이 값은 셸이 열리고
 * 닫힐 때만 바뀐다 — 그래서 사이드바가 얕은 비교로 구독하면 목록 전체가 다시 그려지는 일이
 * 없다(ShellBranch 머리말).
 *
 * **최상위 터미널의 셸은 여기 없다.** 그쪽은 work이 아니라 nav 항목에 붙는 가지라
 * 세는 자리가 따로다(`shellsOf(state, null)`) — 한 Record에 섞으면 빈 문자열 키가
 * 슬러그인 척하게 된다.
 */
export function shellCountsOf(state: ShellsState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const shell of state.shells) {
    if (shell.owner === null) continue;
    counts[shell.owner] = (counts[shell.owner] ?? 0) + 1;
  }
  return counts;
}

export function activeIdOf(state: ShellsState, owner: string | null): number | null {
  return state.activeByOwner[ownerKey(owner)] ?? null;
}

/** 어느 화면에 셸이 몇 개인가 — 아래 판정이 앞뒤로 비교하는 값. */
export interface ShellTally {
  owner: string | null;
  count: number;
}

/**
 * **마지막 셸이 방금 사라졌는가.**
 *
 * 「지금 0개다」가 아니라 「0이 됐다」인 것이 요점이다. 화면에 들어올 때는 0에서 시작해
 * 진입 이펙트가 하나를 띄우므로(`ensureShell`), 서 있는 값으로 재면 들어오자마자 되돌아
 * 나간다 — 터미널을 열 수 없는 앱이 된다.
 *
 * **work이 바뀐 것은 세지 않는다.** A(1개)에서 B(0개)로 옮긴 것은 A의 마지막 칸이 닫힌
 * 것이 아니다. 이 줄이 없으면 셸이 도는 work에서 안 도는 work으로 갈 때마다 본문이
 * 문서로 튕긴다.
 *
 * 닫는 길이 둘인데 둘 다 여기로 온다 — `×`·⌘W(`requestCloseShell`)와 **정상 종료**
 * (결정 48이 목록에서 스스로 빼는 그 길)다. 스토어에서 알림을 쏘는 방식으로 만들면
 * 뒤쪽이 빠진다.
 */
export function shellsEmptied(before: ShellTally, now: ShellTally): boolean {
  return before.owner === now.owner && before.count > 0 && now.count === 0;
}

/**
 * 그 화면에서 **켜진 셸** 자체. 없으면 `null`이다.
 *
 * `activeIdOf` → `shellsOf(...).find(...)` 2단 체인이 화면 셋에 그대로 베껴져 있었다
 * (터미널 본문·최상위 머리행·분할 열 머리). 「켜진 것이 무엇인가」를 정하는 지점이 셋이면
 * 한 곳만 고쳐도 화면마다 다른 셸을 켜진 것으로 부른다.
 */
export function activeShellOf(state: ShellsState, owner: string | null): Shell | null {
  const id = activeIdOf(state, owner);
  return shellsOf(state, owner).find((shell) => shell.id === id) ?? null;
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
 * `×`는 `closeShell`이 둘을 한자리에서 하고, 이 길의 짝은 터미널 스토어의 채널 콜백이 든다 —
 * 이 함수가 그 칸을 뺐으면 그 자리에서 `disposeInstance`를 태운다. 거두는 일은 DOM을 아는
 * 쪽만 할 수 있어 이 순수 모듈에 들일 수 없다.
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
 * `shellRowName`이 셸 이름으로 돌아간다.
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
 * 백엔드가 잰 「지금 도는 것」(adr-04). `null`이면 프롬프트에 서 있다.
 *
 * **안 바뀌면 같은 객체를 돌려주는 것이 계약이다** — `patch`의 관용구를 그대로 딛는다.
 * 이 값은 **초마다** 도착하므로, 여기서 새 객체를 만들면 사이드바와 탭 줄이 초마다 통째로
 * 다시 그려진다(`sameBranch`가 칸을 정체로 보는 이유가 그것이다). 백엔드도 안 바뀐 값을
 * 안 쏘지만 그 한 겹에만 기대지 않는다 — 근거가 다른 두 겹이다.
 *
 * **이름을 접지 않는다.** 원문 그대로 앉히고, 로고로 바꾸는 판단은 읽는 화면이 든다.
 */
export function setRunning(state: ShellsState, id: number, running: string | null): ShellsState {
  return patch(state, id, (shell) => (shell.running === running ? shell : { ...shell, running }));
}

/**
 * 그 칸에서 **지금 도는 것**. 탭 한 칸이 읽는 자리다(결정 4의 「탭 줄은 칸마다」).
 *
 * **끝난 칸은 아무것도 안 돌린다.** 죽은 칸에 마지막 값이 굳어 있으면 claude 로고가 영영
 * 남는다 — 백엔드도 풀에서 빠진 셸을 한 번 지우지만, 그 이벤트와 종료 프레임의 순서는
 * 보장되지 않는다(다른 통로다). 상태로 가르면 순서가 무의미해진다.
 *
 * **`shell.running`을 직접 읽지 않는 이유가 그 한 줄이다.** 두 화면이 각자 읽으면 한쪽만
 * 그 가름을 빠뜨린다.
 */
export function runningOn(shell: Shell): string | null {
  return shell.status.kind === "running" ? shell.running : null;
}

/**
 * 그 화면에서 도는 것의 **종류**(결정 4). 중복이 없다 — claude가 둘 돌아도 로고는 하나다.
 * 목록은 「뭐가 도나」를 말하지 「몇 개 도나」를 말하지 않고, 개수는 `shellCountsOf`가
 * 이미 말한다.
 *
 * 순서는 칸 순서 그대로다(`Set`이 넣은 순서를 지킨다) — 로고 자리가 초마다 재배열되면
 * 그 자체가 깜빡임이다.
 *
 * **`shellCountsOf`처럼 Record로 한 번에 주지 않는다.** 그쪽은 셸이 열리고 닫힐 때만 바뀌어
 * 사이드바가 얕은 비교로 통째로 구독해도 되지만, 이 값은 초마다 바뀐다 — Record로 주면
 * 안쪽 배열이 회차마다 새 객체라 얕은 비교가 늘 어긋나고, work 하나에서 명령이 시작될
 * 때마다 목록 전체가 다시 그려진다. 행마다 자기 것을 고르게 두면 그 행만 바뀐다.
 */
export function runningKindsOf(state: ShellsState, owner: string | null): ReadonlyArray<string> {
  const kinds = new Set<string>();
  for (const shell of shellsOf(state, owner)) {
    // 「죽은 칸은 안 센다」를 여기서 다시 가르지 않는다 — 그 판정은 `runningOn` 하나다.
    const running = runningOn(shell);
    if (running !== null) kinds.add(running);
  }
  return [...kinds];
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

/**
 * 터미널이 셸에 넘기지 않고 **앱이 가져가는** 조작.
 *
 * `"app"`은 「앱 몫이되 **이 셸이 하지 않는다**」다 — 본문을 옮기는 키(⌘1~9·⌃Tab)가 그것이라,
 * 셸은 그 키를 타이핑하지 않고 그대로 위로 흘려보내고 window에서 듣는 자리가 처리한다.
 */
export type ShellHotkey = "new" | "close" | "app";

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
  // **본문을 옮기는 키는 셸이 타이핑하지 않는다**(결정 99). 셸을 붙일 때마다 xterm이 스스로
  // 포커스를 가져가므로, 여기서 안 가르면 터미널 화면에서 ⌘2~9와 ⌃Tab이 영영 안 먹는다.
  // 처리는 여기서 하지 않는다 — 어느 본문으로 갈지는 화면이 알고, 셸은 그것을 모른다.
  if (shellNavKey(event) !== null) return "app";
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.code === "KeyT") return "new";
  if (event.code === "KeyW") return "close";
  return null;
}

/** 본문을 옮기는 키가 가리키는 것. `index`는 1부터 세고, `cycle`은 앞뒤 한 칸이다. */
export type ShellNav = { kind: "index"; n: number } | { kind: "cycle"; delta: 1 | -1 };

/**
 * ⌘1~9와 ⌃Tab 짝(결정 78·79·80).
 *
 * ⌘1~9는 **한 화면 안에서 본문을 옮긴다** — 앞 판의 「사이드바 N번째 작업 열기」가 걷혔다.
 * 무엇을 세는지는 부르는 화면이 정한다: work 화면은 ⌘1이 spec이고 ⌘2~9가 그 화면의 셸,
 * 최상위 터미널은 spec이 없어 ⌘1부터가 셸이다.
 *
 * **⌃Tab 짝만이 결정 29의 넷째 예외다**(결정 79). ⌃는 셸 몫이라는 것이 그 결정인데,
 * ⌃Tab은 셸도 TUI도 안 쓰고 탭 순회는 이 저장소의 다른 키들과 같은 관용구다. ⌃⇧Tab은
 * 수식키가 둘이라 `shellHotkey`의 「수식키가 더 붙으면 셸 몫」과 부딪치므로 **이 짝에
 * 한해** 예외로 못박는다 — 그 규칙 자체를 넓히지 않는다.
 *
 * **`key`가 아니라 `code`로 본다.** `key`는 배열과 IME를 탄다 — 한글 입력기가 켜져 있으면
 * 같은 키가 자모로 온다(`shellHotkey`와 같은 이유).
 */
export function shellNavKey(event: {
  type: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): ShellNav | null {
  if (event.type !== "keydown") return null;
  if (event.code === "Tab" && event.ctrlKey && !event.metaKey && !event.altKey) {
    return { kind: "cycle", delta: event.shiftKey ? -1 : 1 };
  }
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const digit = /^Digit([1-9])$/.exec(event.code);
  return digit ? { kind: "index", n: Number(digit[1]) } : null;
}

/**
 * **window에서** 그 키를 듣는 자리의 판정.
 *
 * 입력 중에는 안 듣는다 — **그런데 셸 안에서는 들어야 한다**(결정 99). xterm의 입력 자리가
 * 숨은 `<textarea>`라 「글을 치는 자리면 비킨다」를 그대로 쓰면 터미널 화면에서 영영 안
 * 먹는데, 셸을 붙일 때마다 포커스가 그리로 가므로 그 화면이 곧 정상 상태다.
 * 그래서 그 하나만 예외로 가른다 — work 제목을 고치는 `<input>`은 그대로 비킨다.
 */
export function shellNavFromWindow(event: {
  type: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}): ShellNav | null {
  const nav = shellNavKey(event);
  if (nav === null) return null;
  return typesInto(event.target) && !isShellInput(event.target) ? null : nav;
}

/**
 * 그 자리가 **xterm의 숨은 입력 자리**인가.
 *
 * `@xterm/xterm`이 `createElement("textarea")`로 만들고 `.xterm-helper-textarea` 클래스를
 * 붙인다(소스에서 확인함). 요소가 스스로 들고 있는 값 하나만 보므로 DOM 생성자가
 * 없는 환경에서도 그대로 돈다 — `typesInto`와 같은 계약이다.
 */
function isShellInput(target: EventTarget | null): boolean {
  if (!target || !("className" in target)) return false;
  const name = target.className;
  return typeof name === "string" && name.includes("xterm-helper-textarea");
}

/**
 * 두 상태가 **이 가지에게 같은가.**
 *
 * 가지가 그리는 것은 셋뿐이다 — 자기 셸들, 그중 켜진 칸, 그리고 앱 전체 개수(상한 문구는
 * 앱 전체를 센다 — 결정 30). 남의 work의 셸이 프롬프트마다 쏘는 OSC 타이틀에는 그 셋 중
 * 아무것도 안 바뀐다.
 *
 * **가지가 하나가 아니라서 필요하다.** 셸이 도는 work마다 가지가 서므로(결정 73) 스토어를
 * 통째로 구독하면 work A의 타이틀 하나에 work B·C의 셸 행이 함께 다시 그려진다. 판 04
 * spec의 「스토어 구독의 자리」가 막으려던 것이 그것이고, 목록이 아니라 가지 사이에서도
 * 같은 이유가 선다.
 *
 * 칸을 **개수가 아니라 정체로** 본다 — `patch`가 안 바뀐 칸에는 같은 객체를 돌려주므로
 * 타이틀이 갈린 칸만 새 객체다. 개수만 세면 이름이 바뀌어도 안 다시 그린다.
 */
export function sameBranch(a: ShellsState, b: ShellsState, owner: string | null): boolean {
  if (a === b) return true;
  if (a.shells.length !== b.shells.length) return false;
  if (activeIdOf(a, owner) !== activeIdOf(b, owner)) return false;
  const mine = shellsOf(a, owner);
  const theirs = shellsOf(b, owner);
  return mine.length === theirs.length && mine.every((shell, at) => shell === theirs[at]);
}

/**
 * 그 키가 가리키는 셸. 갈 곳이 없으면 `null`이다.
 *
 * **화면마다 갈리는 것은 `firstKey` 하나다** — ⌘몇이 첫 셸인가. work 화면은 ⌘1이 spec이라
 * 2이고, 최상위 터미널은 문서가 없어 1이다(결정 78). 나머지 판단을 두 화면이 같은 자리에서
 * 딛는 것이 이 함수의 전부다: 따로 두면 순회가 한쪽에서만 끝에서 돌아오거나, 한쪽만 자리를
 * 밀어 마지막 셸을 영영 못 고르게 된다.
 *
 * **세는 것은 받은 목록이다**(결정 109) — 부르는 쪽이 그 화면의 셸만 담아 준다.
 */
export function shellForNav(
  shells: ReadonlyArray<Shell>,
  activeId: number | null,
  nav: ShellNav,
  firstKey: number,
): number | null {
  if (nav.kind === "cycle") return cycleShell(shells, activeId, nav.delta);
  return shells[nav.n - firstKey]?.id ?? null;
}

/**
 * 순회했을 때 켜질 칸(결정 80). 끝에서 **돌아온다** — 여덟 번째에서 다음을 누르면 첫 칸이다.
 * 켜진 칸이 없으면 방향에 따라 첫 칸 또는 마지막 칸이다.
 */
export function cycleShell(
  shells: ReadonlyArray<Shell>,
  activeId: number | null,
  delta: 1 | -1,
): number | null {
  if (shells.length === 0) return null;
  const at = shells.findIndex((shell) => shell.id === activeId);
  if (at === -1) return (delta === 1 ? shells[0] : shells[shells.length - 1]).id;
  return shells[(at + delta + shells.length) % shells.length].id;
}

/**
 * 셸에 그대로 넘기지 않고 **다른 바이트로 바꿔** 보내는 키. 지금은 ⇧Enter 하나다(결정 91).
 *
 * xterm은 Shift+Enter를 그냥 `\r`로 보내 셸에게는 Enter와 구별되지 않는다. `claude`가
 * 「개행」으로 읽는 바이트열은 `\x1b\r`(ESC + CR)이고, VS Code·iTerm2에서 `/terminal-setup`이
 * 심는 키바인딩이 정확히 그것이다 — **우리는 앱이 그 자리라 설정 없이 기본으로 넣는다.**
 *
 * `shellHotkey`와 **다른 종류다.** 저쪽은 앱이 가져가는 조작이라 셸에 아무것도 안 가고,
 * 이쪽은 여전히 셸에 간다 — 가는 바이트만 갈린다. 그래서 판정도 따로 산다.
 *
 * **⇧Enter만이다.** 수식키가 더 붙으면 셸 몫이다(⌥Enter·⌃Enter) — 결정 29의 범위를 근거
 * 없이 넓히지 않는다. `key`가 아니라 `code`로 보는 이유도 `shellHotkey`와 같다(IME·배열).
 *
 * **한글 조합을 안 깨뜨린다.** `terminal-ime.ts`의 다리가 capture 단계에서 먼저 돌아
 * Enter를 조합의 끝으로 읽고 붙들고 있던 음절을 흘려보내므로(`imeKeyDown`), 여기서 무엇을
 * 돌려주든 그 순서는 안 바뀐다.
 */
export function shellRewrite(event: {
  type: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (event.type !== "keydown") return null;
  if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return null;
  return event.code === "Enter" ? "\x1b\r" : null;
}

/**
 * ⌘T를 **window에서** 듣는 자리의 판정(결정 93·98).
 *
 * 그 키는 지금까지 xterm의 키 핸들러에만 붙어 있어 **셸이 0개면 들을 사람이 없었다** —
 * 마지막 칸을 `×`로 닫은 화면이 정확히 그 자리다. 범위는 터미널 본문이 아니라 **work 화면
 * 전체**이고(결정 98), 열리면 본문이 터미널로 넘어간다 — ⌘1이 spec, ⌘2~9가 셸로 본문을
 * 옮기는 한 벌에 이 키도 든다.
 *
 * **⌘W는 이 함수가 아니다** — 아래 `closesShellFromWindow`가 따로 든다(결정 13). 한때
 * 여기 「⌘W는 넓히지 않는다(결정 98) — 겨눌 칸은 셸에 포커스가 있을 때만 뚜렷하다」고
 * 적혀 있었는데, **탭 줄이 그 전제를 없앴다**(adr-03): 켜진 칸이 화면에 서 있다. 판정을
 * 둘로 갈라 두는 것은 ⌘T만 듣는 화면(셸 0개)에 ⌘W가 새어 들지 않게 하기 위해서다 —
 * 그래서 여기서 보는 것은 여전히 `"new"` 하나다.
 *
 * **입력 중에는 안 듣는다 — 그런데 xterm의 입력 자리도 숨은 `<textarea>`다**
 * (`togglesWorkPanel`이 적어 둔 함정과 같은 자리). 셸 안에서는 xterm 핸들러가 이미
 * 열어 주므로 여기서 또 들으면 한 번 눌러 둘이 열린다. 그쪽이 `stopPropagation`으로도
 * 막지만 그 한 겹에만 기대지 않는다 — 두 겹이 같은 사실을 말하는 것이 아니라, 하나는
 * 「셸이 처리했다」이고 하나는 「입력 중에는 안 먹는다」로 근거가 다르다.
 *
 * **DOM 전역을 읽지 않는다.** 머리말의 「DOM 없는 기본 환경에서 그대로 돈다」는 이 함수에도
 * 그대로 걸린다 — 한때 여기서 `HTMLTextAreaElement`를 `instanceof`로 봤는데 그 한 줄이
 * 그 문장을 이 함수에 대해 거짓으로 만들었다(노드에서 스텁 없이 부르면 터진다). 가르는 일은
 * `typesInto`가 값으로 한다.
 */
export function opensShellFromWindow(event: {
  type: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}): boolean {
  if (shellHotkey(event) !== "new") return false;
  return !typesInto(event.target);
}

/**
 * **window에서** ⌘W를 듣는 자리의 판정(결정 13). 위 함수와 **같은 모양이고 같은 예외를
 * 탄다** — 다른 것은 어느 키를 보는가 하나뿐이다.
 *
 * 무엇을 닫을지는 여기서 안 정한다. 「켜진 탭」이 무엇인지는 화면이 알고(work 화면은
 * `spec`이 켜져 있으면 닫을 것이 없다), 셸을 닫는 길은 여전히 `requestCloseShell` 하나다 —
 * 확인 창을 우회하는 길을 새로 만들지 않는다(결정 92).
 *
 * **셸 안에서는 안 듣는다.** xterm 핸들러가 이미 같은 함수로 보내므로 여기서 또 들으면
 * 확인 창이 두 번 뜬다. 그쪽이 `stopPropagation`으로도 막지만 그 한 겹에만 기대지 않는
 * 이유는 `opensShellFromWindow`의 머리말과 같다.
 */
export function closesShellFromWindow(event: {
  type: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}): boolean {
  if (shellHotkey(event) !== "close") return false;
  return !typesInto(event.target);
}

/**
 * 그 자리가 **글을 치는 자리인가**. 요소가 스스로 들고 있는 값 둘(`tagName`·
 * `isContentEditable`)만 보므로 DOM 생성자가 없는 환경에서도 그대로 돈다.
 *
 * **`togglesWorkPanel`(WorksPage.tsx)은 같은 판정을 `instanceof`로 한다.** 흉내 내지 않는
 * 이유는 그 파일에는 이 모듈의 계약이 없어서다 — 저쪽은 화면이라 DOM이 늘 있다.
 *
 * **`as`로 좁히지 않는다.** `event.target as HTMLElement`는 `null`도 요소라고 말해 놓고
 * `isContentEditable`을 읽어 터진다(`null instanceof X`는 false라 앞 가드를 그냥 통과한다).
 * 여기서는 `in`으로 좁히므로 그 거짓말이 설 자리가 없다.
 */
function typesInto(target: EventTarget | null): boolean {
  if (!target) return false;
  if ("isContentEditable" in target && target.isContentEditable === true) return true;
  return "tagName" in target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
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
 * 셸 행의 **첫 줄 — 이름**이다. `프로젝트 · 타이틀`로 **함께 적는다**(결정 46).
 * 이제 셸 이름을 정하는 자리가 앱에서 여기 하나다.
 *
 * 한때 가로 탭 줄이 쓰던 `shellLabel`이 곁에 있었다 — 그쪽은 셋 중 하나를 **골라서**
 * 타이틀이 오는 순간 프로젝트가 사라졌다(실물에서 로그인 zsh가 뜨자마자 OSC 타이틀을 쏴
 * 이름이 `gimhyoyeon@gimhy…`가 되고 어느 워크트리의 셸인지가 없어졌다). 결정 46이 갈래 셋
 * 중 ③을 고른 이유가 그것이고, 판 04가 가로 탭 줄을 걷으면서 그 함수는 생산 사용처가 0이
 * 되어 함께 지웠다(결정 104).
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
 * 이 칸을 닫기 전에 사람에게 물어야 하는가(결정 92). **⌘W와 `×` 두 길이 이 하나를 부른다** —
 * 셸 하나를 없애는 길이 둘인데 한쪽만 막으면 같은 사고가 마우스로만 남는다.
 *
 * `commandRunning`은 **닫기 직전에** 백엔드에 물어 온 답이다. 셸 상태에 얹어 두지 않는 것은
 * 그 값이 매 순간 바뀌기 때문이다 — 얹으면 폴링이 생기고, 필요한 순간은 닫을 때 한 번뿐이다.
 *
 * **`null`은 「못 얻었다」이고 그때는 안 묻는다.** 모르는 것을 이유로 닫는 길을 막지 않는다.
 * 그 경우가 실제로 온다: 이미 끝난 pty, tcgetpgrp 실패, IPC 실패.
 *
 * **끝난 칸·못 뜬 칸도 안 묻는다.** 물어볼 프로세스가 없고, 그 pty id는 이미 회수돼 남이
 * 앉아 있을 수 있다 — 백엔드가 무엇을 답하든 여기서 끊는다. 그 칸들이 목록에 남아 있는
 * 것은 죽은 이유를 읽기 위해서다(결정 22).
 */
export function needsCloseConfirm(
  shell: Shell | undefined,
  commandRunning: boolean | null,
): boolean {
  if (!shell || shell.status.kind !== "running") return false;
  return commandRunning === true;
}

/**
 * 도는 명령을 죽이기 전에 하는 말(결정 105). **프로그램 이름은 안 싣는다** — 결정 92가
 * 여는 커맨드가 주는 것은 「도는가」 하나이고, 이름을 실으려면 pgid→커맨드 조회가 한 겹
 * 더 든다. 「명령」은 CONTEXT.md에 등록된 말이다 — 셸 안에서 도는 프로세스이지 셸 자신이
 * 아니다.
 *
 * **문구가 여기 있는 것은 재기 위해서다.** 스토어에 두면 xterm을 함께 끌고 와 이 seam에서
 * 못 읽고, 그러면 결정 105를 지키는 것이 주석 한 줄뿐이 된다.
 */
export const CLOSE_NOTICE = "실행 중인 명령이 있어요 — 닫을까요?";

/**
 * 닫아도 되는가 — **묻는 것까지가 이 함수다**(결정 92). 물을 필요가 없으면 안 묻고 `true`,
 * 물어야 하면 `ask`가 답한 그대로 돌려준다.
 *
 * **확인 창을 인자로 받는다.** 스토어에서 `confirm`을 직접 부르면 「물었고, 아니라고 하면
 * 안 닫는다」를 재는 길이 없어진다 — 그 한 줄을 지우고 답을 버려도 아무 검사가 안 빨개진다
 * (실측으로 그랬다). 여기로 빼면 그 절반이 값으로 드러난다.
 */
export async function confirmClose(
  shell: Shell | undefined,
  commandRunning: boolean | null,
  ask: () => Promise<boolean>,
): Promise<boolean> {
  if (!needsCloseConfirm(shell, commandRunning)) return true;
  return ask();
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
