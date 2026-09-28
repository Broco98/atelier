import { SIGNAL_LABEL, formatElapsed, showsElapsed, subagentLabel } from "@/components/shell/shell-signal";
import type { ShellSignal } from "@/components/shell/shell-signal";
import { attentionOn, runningSubagents, signalOf } from "@/features/terminal/shell-attention";
import { modeOfOwner, runningOn, shellRowName, slugOfOwner } from "@/features/terminal/shell-registry";
import type { Shell, ShellOwner } from "@/features/terminal/shell-registry";
import { ALL_MODES, modeNameOf, navItemsOf, type Mode } from "@/mode";
import { sumMetrics } from "./metrics";
import { byStart, identityKey, processLabel, processTree, withMemory, type ProcessNode } from "./process-tree";
import type { PoolShell, ProcessMetrics, ProcessRow, ProcessSnapshot } from "./types";

// **`Processes`의 셸 묶음**(프로세스 결정 9 · 10 · 프로세스 스펙 S53 · 티켓 27). 화면은 앱 전체를 세계 → work → 셸 → 자손으로 세운다.
// 이 모듈은 그 층과 차례를 짓고, 셸 행의 상태 칸과 셸 · work · 세계 줄의 접근성 이름을 짓는다. 프로세스 한 줄(셸의 자손)을 트리로 펴고
// 이름 짓는 규칙은 고아 · 예외 묶음과 같은 것이라 `process-tree.ts`에 있다. 순수 함수다 — 지금 시각도 인자로 받는다.
//
// **두 출처를 셸 키로 잇는 자리가 여기 하나다.** 세계와 work(owner)는 스토어의 것이고 — Rust는 owner를 모른다 — 셸별 자손은
// 스냅샷의 판정 결과다(`verdict.descendants`, 키가 셸 키). 스토어의 셸이 든 셸 키(`Shell.shellKey`, 티켓 23)가 그 둘을 잇는다.
// 스토어의 `id`나 pty id로 잇지 않는다: 앞은 프런트가 따로 발급한 번호이고, 뒤는 다른 실행에서 같은 번호가 된다.

/** 세계의 목록 중 이 묶음이 읽는 것 — 사이드바가 그리는 차례(고정 먼저)와 제목. 목록 쿼리의 `WorkView`가 그대로 들어온다. */
export interface ListedItem {
  slug: string;
  title: string;
}

export interface TreeInput {
  /** 지금 세계 — 맨 위에 선다(프로세스 결정 9). 주소가 정본이다. */
  current: Mode;
  /** 스토어의 셸 — 칸 순서 그대로(`terminalStore.state.shells`). 탭 줄의 차례가 이것이다. */
  shells: ReadonlyArray<Shell>;
  /** 세계마다 사이드바가 그리는 목록. 아직 없으면(못 읽었거나 안 물었다) 빈다 — 그 세계의 work은 slug로 선다. */
  lists: Partial<Record<Mode, ReadonlyArray<ListedItem>>>;
  snapshot: ProcessSnapshot;
}

export interface WorldNode {
  mode: Mode;
  /** 지금 세계인가. 세계 줄이 그렇다고 말한다. */
  current: boolean;
  groups: ReadonlyArray<GroupNode>;
}

/** work 행(최상위 터미널이면 `Terminal`). 이름 · 셸 수 · 트리 합(메모리 · CPU — `groupTotals`)이고 동작은 없다(S53). */
export interface GroupNode {
  owner: ShellOwner;
  /** 목록의 제목. 목록에 없으면 slug, 최상위 터미널이면 nav의 `Terminal`이다. */
  name: string;
  shells: ReadonlyArray<ShellNode>;
}

/**
 * 셸 하나의 프로세스 — 풀의 셸(셸 프로세스 자신), 셸 도우미, 사람이 띄운 자손. 스토어의 셸(`ShellNode`)과 화면 밖 셸(`OffscreenNode`)이
 * 같은 모양으로 들고, 셸 줄의 숫자(`shellTotals`)와 그 밑의 줄들이 이것만 읽는다.
 */
export interface ShellProcesses {
  pool: PoolShell;
  /** 셸 도우미(프로세스 스펙 P1) — 시작 순. 셸 행 아래 옅은 줄 하나로 따로 선다. */
  helpers: ReadonlyArray<ProcessRow>;
  /** 사람이 띄운 자손 — 트리를 깊이 우선으로 편 차례이고, 형제는 시작 순이다. 깊이 1이 셸 바로 밑이다. */
  descendants: ReadonlyArray<ProcessNode>;
}

/** 스토어의 셸 하나와 풀의 그 셸 — 셸 키로 이은 것. */
export interface ShellNode extends ShellProcesses {
  shell: Shell;
}

/**
 * 셸 묶음을 짓는다. **셸이 선 세계만 선다** — 지금 세계가 먼저, 그다음이 저쪽 세계다. 세계 안에서는 사이드바 순서(목록이 준
 * 차례 그대로 — 고정이 먼저인 것은 코어가 정한다, ux-papercuts 결정 100)이고, 목록에 없는 work이 그 뒤, 최상위 터미널(`Terminal`)이 맨 끝이다.
 * work 안의 셸은 탭의 차례다.
 *
 * **양쪽에 다 있는 셸만 선다.** 스토어가 모르는 풀의 셸은 「화면 밖 셸」이라 따로 묶인다(32). 풀에 없는 스토어의 칸은 프로세스가
 * 아니다 — spawn 답 전이라 키가 없거나, 이유가 있는 끝으로 칸만 남았거나, 스냅샷 뒤에 막 떴다(다음 스냅샷에 선다).
 *
 * 목록에 없는 work은 숨기지 않는다 — 목록을 아직 못 읽었을 수 있고, 숨기면 도는 것이 화면에서 사라진다. 다만 **주인 잃은 셸**
 * (스토어의 표시 — 티켓 12)은 여기 안 서고 제 묶음에 선다(`ownerlessGroups` · 티켓 32): 한 셸이 두 묶음에 서면 [닫기] 자리가 둘이고
 * 수가 두 번 읽힌다.
 */
export function shellTree({ current, shells, lists, snapshot }: TreeInput): WorldNode[] {
  const worlds: WorldNode[] = [];
  for (const mode of worldOrder(current)) {
    const byOwner = nodesByOwner(
      shells.filter((shell) => !shell.ownerless && modeOfOwner(shell.owner) === mode),
      snapshot,
    );
    if (byOwner.size === 0) continue;

    const listed = lists[mode] ?? [];
    const rank = (owner: ShellOwner): number => {
      const slug = slugOfOwner(owner);
      if (slug === null) return Number.MAX_SAFE_INTEGER;
      const at = listed.findIndex((item) => item.slug === slug);
      return at < 0 ? listed.length : at;
    };
    const groups = [...byOwner]
      .map(([owner, nodes]) => ({ owner, name: groupName(mode, owner, listed), shells: nodes }))
      // 안정 정렬이라 목록에 없는 work끼리는 셸이 먼저 뜬 차례로 선다.
      .sort((a, b) => rank(a.owner) - rank(b.owner));
    worlds.push({ mode, current: mode === current, groups });
  }
  return worlds;
}

/** 세계의 차례 — 지금 세계가 먼저다(프로세스 결정 9). */
function worldOrder(current: Mode): Mode[] {
  return [current, ...ALL_MODES.filter((one) => one !== current)];
}

/**
 * 받은 셸을 owner마다 노드로 모은다 — 풀에 있는 셸만이다(셸 키로 잇는다). `Map`이 넣은 차례를 지키므로 칸 순서(탭의 차례)가 그대로
 * 남는다.
 */
function nodesByOwner(shells: ReadonlyArray<Shell>, snapshot: ProcessSnapshot): Map<ShellOwner, ShellNode[]> {
  const pooled = new Map(snapshot.pool.map((shell) => [shell.shellKey, shell]));
  const helpers = new Set(snapshot.verdict.helpers.map(identityKey));
  const byOwner = new Map<ShellOwner, ShellNode[]>();
  for (const shell of shells) {
    if (shell.shellKey === null) continue;
    const pool = pooled.get(shell.shellKey);
    if (pool === undefined) continue;
    const node = { shell, pool, ...splitRows(snapshot.verdict.descendants[shell.shellKey] ?? [], helpers) };
    const group = byOwner.get(shell.owner);
    if (group) group.push(node);
    else byOwner.set(shell.owner, [node]);
  }
  return byOwner;
}

/**
 * **주인 잃은 셸 묶음**(프로세스 결정 4 · 티켓 32) — 12가 스토어에 「주인 잃음」으로 표시한 셸을 work마다 모은다. 두 세계가 함께 서고
 * (화면이 앱 전체다 — 프로세스 결정 9) 지금 세계의 것이 먼저, 세계 안은 스토어의 차례다. 이름은 slug다 — 그 work은 목록에 없다.
 *
 * 풀에 없는 칸(끝난 칸 · 아직 안 앉은 칸)은 프로세스가 아니라 안 선다. [모두 닫기]는 그 칸도 함께 거둔다(`closeOwnerless`).
 */
export function ownerlessGroups({ current, shells, snapshot }: Pick<TreeInput, "current" | "shells" | "snapshot">): GroupNode[] {
  return worldOrder(current).flatMap((mode) =>
    [
      ...nodesByOwner(
        shells.filter((shell) => shell.ownerless && modeOfOwner(shell.owner) === mode),
        snapshot,
      ),
    ].map(([owner, nodes]) => ({ owner, name: groupName(mode, owner, []), shells: nodes })),
  );
}

// ── 화면 밖 셸(티켓 32 · 프로세스 스펙 S42) — 풀에는 있는데 화면 스토어가 모르는 셸.

/** 화면 밖 셸 하나 — 스토어의 칸이 없어 셸 하나의 프로세스(풀의 셸과 그 셸 키의 자손)만 든다. */
export type OffscreenNode = ShellProcesses;

/**
 * 스냅샷 한 박자 — 그 스냅샷의 풀과, **그 박자를 처음 그릴 때 스토어가 든 셸**. 화면 밖 셸은 두 박자 모두 스토어가 모른 셸이라
 * (`offscreenShells`) 앞 박자의 풀만으로는 못 가른다 — 그때 스토어가 그 셸을 알았는지가 함께 있어야 한다.
 */
export interface PoolBeat {
  pool: ReadonlyArray<PoolShell>;
  shells: ReadonlyArray<Shell>;
}

export interface OffscreenInput {
  /** 스토어의 셸 — 두 세계 전부. 이 셸들의 셸 키가 「화면이 아는 셸」이다. */
  shells: ReadonlyArray<Shell>;
  snapshot: ProcessSnapshot;
  /** 바로 앞 박자. 아직 없으면(화면을 막 열었다) 화면 밖 셸도 없다. */
  previous: PoolBeat | undefined;
  /**
   * 이 화면의 [닫기]로 닫은 화면 밖 셸(`poolKey`). 풀에 남아 있어도 가린다 — 스토어가 모르는 셸이라 스토어에서 뺄 칸이 없고, 스냅샷은
   * 다음 박자까지 앞 장이다. 화면이 풀에서 빠진 것을 잊는다(`ProcessesPage`).
   */
  closed?: ReadonlySet<string>;
}

/**
 * 화면 밖 셸을 가른다 — 풀의 셸 중 **지금 스토어의 어느 칸도 그 셸 키를 안 들고**, **바로 앞 박자에도 같은 pty id · 셸 키로 풀에
 * 있었는데 그때 스토어도 몰랐던** 셸. 차례는 풀의 차례다.
 *
 * **두 박자 연달아 스토어가 모른 셸만 센다.** 한 박자에만 모르는 창이 양쪽에 있다.
 * - 뜨는 쪽: Rust는 셸을 풀에 앉힌 뒤에 spawn에 답하고(`pty.rs`의 `spawn`), 프런트는 답이 온 뒤에야 칸에 셸 키를 앉힌다 — 그 사이
 *   찍힌 스냅샷에는 방금 뜬 멀쩡한 셸이 한 번 스토어가 모르는 셸로 선다. 다음 박자에는 스토어가 안다.
 * - 닫는 쪽: 닫기는 스토어에서 칸을 곧바로 빼는데(`closeShell`) 화면의 스냅샷은 다음 박자까지 앞 장이다 — 방금 닫은 셸이 두 풀에 다
 *   있고 지금 스토어는 모른다. 지금 스토어만 보면 그 셸이 다음 박자까지 「화면 밖 셸」로 서서 새어 남은 것처럼 읽힌다(리뷰 반영).
 *   앞 박자에 스토어가 알던 셸이라 안 선다. 풀에서 두 박자 넘게 안 빠지면 그때는 선다 — 정말 남은 것이다.
 *
 * 앞 박자의 스토어는 **그 박자를 처음 그린 때의 것**이다(`PoolBeat` — 화면이 적어 둔다). 끝난 칸 · 주인 잃은 셸도 스토어가 아는
 * 셸이다(키가 칸에 있다).
 *
 * **이 화면의 [닫기]로 닫은 셸은 곧바로 안 선다**(`closed`) — 스토어의 셸을 닫을 때 스토어가 칸을 곧바로 빼는 것(위 「닫는 쪽」)과 같은
 * 뜻이다. 화면 밖 셸은 스토어에 칸이 없어 화면이 닫은 것을 따로 든다.
 *
 * **pty id와 셸 키가 함께 같아야 같은 셸이다** — 키만 보면 닫혔다 다시 뜬 셸을 두 박자에 선 것으로 읽는다.
 */
export function offscreenShells({ shells, snapshot, previous, closed }: OffscreenInput): OffscreenNode[] {
  if (previous === undefined) return [];
  const before = new Set(unknownPool(previous).map(poolKey));
  const helpers = new Set(snapshot.verdict.helpers.map(identityKey));
  return unknownPool({ pool: snapshot.pool, shells })
    .filter((pool) => before.has(poolKey(pool)) && !closed?.has(poolKey(pool)))
    .map((pool) => ({ pool, ...splitRows(snapshot.verdict.descendants[pool.shellKey] ?? [], helpers) }));
}

/** 한 박자의 풀에서 그 박자의 스토어가 모르는 셸 — 어느 칸도 그 셸 키를 안 든 것. 풀의 차례다. */
function unknownPool({ pool, shells }: PoolBeat): PoolShell[] {
  const known = new Set(shells.flatMap((shell) => (shell.shellKey === null ? [] : [shell.shellKey])));
  return pool.filter((one) => !known.has(one.shellKey));
}

/** 풀의 셸 하나를 한 글자로 — 두 박자를 견주는 열쇠이자 화면 밖 셸 줄의 열쇠. pty id와 셸 키가 함께 같아야 같은 셸이다. */
export function poolKey(pool: PoolShell): string {
  return `${pool.ptyId}/${pool.shellKey}`;
}

/**
 * 화면 밖 셸의 상태 칸 — 사람이 띄운 자손이 있으면 그 수, 없으면 「조용함」과 마지막 출력부터의 경과다. 셸 상태와 도는 명령은
 * 스토어의 칸이 드는 값이라 여기 없다(`shellStateOf`의 앞 두 갈래).
 */
export function offscreenStateOf({ pool, descendants }: OffscreenNode): ShellState {
  if (descendants.length > 0) return { kind: "spawned", count: descendants.length };
  return { kind: "quiet", since: pool.lastOutputMs };
}

/**
 * 화면 밖 셸의 이름 — 「셸」이다. 셸 이름(타이틀 · 셸 이름)은 스토어의 칸이 드는 것이라 모른다. 탭 줄이 이름 셋 다 없을 때 쓰는
 * 마지막 자리와 같은 글자다.
 */
export const OFFSCREEN_NAME = "셸";

/** 화면 밖 셸 행 — 「셸, 상태, 메모리」. 메모리는 그 셸의 트리 합이다(`shellTotals`). */
export function offscreenRowLabel(node: OffscreenNode, now: number): string {
  return withMemory([OFFSCREEN_NAME, stateText(offscreenStateOf(node), now)], shellTotals(node).memory);
}

function groupName(mode: Mode, owner: ShellOwner, listed: ReadonlyArray<ListedItem>): string {
  const slug = slugOfOwner(owner);
  if (slug === null) return terminalLabel(mode);
  return listed.find((item) => item.slug === slug)?.title ?? slug;
}

/**
 * 최상위 터미널의 이름 — **그 세계 nav의 `Terminal` 라벨이다.** 그 셸이 사는 곳이 그 nav가 가는 화면이라 같은 글자여야 한다.
 * 두 세계 nav 모두에 그 항목이 있다(`mode.test.ts`) — 없어도 행이 비지 않게 같은 글자로 떨어진다.
 */
function terminalLabel(mode: Mode): string {
  return navItemsOf(mode).find((item) => item.key === "terminal")?.label ?? "Terminal";
}

/**
 * 셸 하나의 자손을 가른다. 판정은 셸 도우미를 자손에도 그대로 싣는다(함께 끝낼 대상이다) — 곁 집합(`helperIds`)의 신원으로 갈라
 * 따로 둔다. 사람이 띄운 자손은 트리로 편다(`processTree`). 셸 자신의 행은 스냅샷에 없으므로(판정이 셸 자신을 안 싣는다) 셸의 직속
 * 자식과 트리가 끊겨 표식으로만 잡힌 것(claude Bash 도구가 띄운 dev 서버 — 부모 1)이 함께 깊이 1에 선다. 스토어의 셸과 화면 밖
 * 셸이 같은 규칙으로 선다.
 */
function splitRows(
  rows: ReadonlyArray<ProcessRow>,
  helperIds: ReadonlySet<string>,
): Pick<ShellProcesses, "helpers" | "descendants"> {
  const helpers = [...rows].sort(byStart).filter((row) => helperIds.has(identityKey(row.id)));
  const descendants = processTree(rows.filter((row) => !helperIds.has(identityKey(row.id))));
  return { helpers, descendants };
}

/**
 * 셸 행의 상태 칸(S53) — 위에서부터 첫 갈래다.
 * - 셸 상태(나를 기다림 · 확인할 것 · 도는 중 · 서브에이전트 N)가 있으면 그것이다. 레지스트리가 내놓는 문(`signalOf` ·
 *   `runningSubagents`)을 딛는다 — 셸 탭 · 사이드바 · 띠와 같은 말이어야 한다(terminal-activity-signal 스토리 79). 죽은 칸 가리개도 그 문에 있다.
 * - 없고 조용하면 「조용함」과 경과다. 조용함 = 명령도 없고 사람이 띄운 자손도 없음(CONTEXT 「조용한 셸」 — 셸 도우미는 안 센다).
 * - 명령이 돌면 그 명령이다(마크는 화면이 `agentMarkOf`로 고른다 — 표를 아는 자리가 하나다).
 * - 명령 없이 사람이 띄운 것만 남았으면(`pnpm dev &`, claude가 띄우고 나간 dev 서버) 그 수다. 스펙은 이 갈래를 안 적었다 —
 *   조용하지 않은데 도는 명령도 없는 셸이다.
 */
export type ShellState =
  | { kind: "signal"; signal: ShellSignal; subagents: number; since: number | null }
  | { kind: "quiet"; since: number }
  | { kind: "command"; command: string }
  | { kind: "spawned"; count: number };

export function shellStateOf({ shell, pool, descendants }: ShellNode): ShellState {
  const signal = signalOf(shell);
  if (signal !== null) {
    return { kind: "signal", signal, subagents: runningSubagents(shell), since: attentionOn(shell)?.since ?? null };
  }
  const command = runningOn(shell);
  if (command !== null) return { kind: "command", command };
  if (descendants.length > 0) return { kind: "spawned", count: descendants.length };
  // 경과는 셸이 마지막으로 무언가를 찍은 때부터다 — 사람이 친 글자의 메아리도, 끝난 명령 뒤의 프롬프트도 출력이라 그 뒤로 아무
  // 일이 없었던 시간이다(백엔드가 읽기 스레드에서 적는다).
  return { kind: "quiet", since: pool.lastOutputMs };
}

/**
 * 상태 칸의 글자. 눈에 보이는 것과 접근성 이름이 같은 이것을 읽는다. 경과는 사이드바 행의 오른쪽 메타와 같은 규칙으로 붙는다 — 도는 중은
 * 안 단다(`showsElapsed`), 표기는 `formatElapsed`다.
 */
export function stateText(state: ShellState, now: number): string {
  switch (state.kind) {
    case "signal": {
      const words = subagentLabel(state.subagents) ?? SIGNAL_LABEL[state.signal];
      return state.since !== null && showsElapsed(state.signal) ? `${words} ${formatElapsed(now - state.since)}` : words;
    }
    case "quiet":
      return `조용함 ${formatElapsed(now - state.since)}`;
    case "command":
      return state.command;
    case "spawned":
      // 닫기 확인 창과 같은 화면의 말이다 — 「자손」은 코드와 문서의 말이라 화면에 안 뜬다.
      return `띄운 프로세스 ${state.count}개`;
  }
}

// ── 트리 합(티켓 28 · S53) — 셸 행과 work 행의 숫자. 합하는 규칙(읽은 것끼리, 포트는 합침)은 `sumMetrics`가 든다.

/**
 * 셸 행의 숫자 — **그 셸의 트리 전부**다: 셸 프로세스 자신(판정은 셸을 행으로 안 싣는다 — 풀의 셸이 싣는다), 셸 도우미, 사람이 띄운
 * 자손. 도우미도 셸을 닫으면 함께 끝나는 그 셸의 몫이라 숫자에 든다 — 빠지는 것은 「조용함」과 확인 창의 수뿐이다(P1).
 */
export function shellTotals(node: ShellProcesses): ProcessMetrics {
  return sumMetrics([
    node.pool.metrics,
    ...node.helpers.map((row) => row.metrics),
    ...node.descendants.map(({ row }) => row.metrics),
  ]);
}

/** work 행의 숫자 — 그 work 셸들의 트리 합을 더한다. 프로세스 결정 10 그림의 「process-manager · 셸 2 … 1.2GB 12%」다. */
export function groupTotals(group: GroupNode): ProcessMetrics {
  return sumMetrics(group.shells.map(shellTotals));
}

// ── 행의 접근성 이름(S58) — 행마다 한 문장이고, 메모리가 그 끝 조각이다(`withMemory`). 프로세스 줄(셸의 자손)의 이름은
// `process-tree.ts`의 `processRowLabel`이다.

/** 셸 행 — 「셸 이름, 상태, 메모리」. 메모리는 셸의 트리 합이다. 셸 이름은 탭 줄과 같은 것이다(`shellRowName`). */
export function shellRowLabel(node: ShellNode, now: number): string {
  return withMemory([shellRowName(node.shell), stateText(shellStateOf(node), now)], shellTotals(node).memory);
}

/** work 행 — 이름, 셸 수, 메모리(트리 합). 세는 말은 「셸 N개」다(CONTEXT 「셸」). */
export function groupRowLabel(group: GroupNode): string {
  return withMemory([group.name, shellCount(group.shells.length)], groupTotals(group).memory);
}

/**
 * 주인 잃은 셸 묶음의 work 줄 — 이름, **세계**, 셸 수, 메모리(티켓 32). 두 세계의 것이 한 묶음에 서고 두 세계에 같은 slug가 설 수
 * 있어(life-mode 결정 10) 세계를 말한다. 세계 트리의 work 줄은 세계 줄 밑에 서서 말하지 않는다(`groupRowLabel`).
 */
export function ownerlessGroupRowLabel(group: GroupNode): string {
  return withMemory(
    [group.name, modeNameOf(modeOfOwner(group.owner)), shellCount(group.shells.length)],
    groupTotals(group).memory,
  );
}

/** 셸을 세는 말 — 「셸 N개」(CONTEXT 「셸」). 프로세스를 세는 자리는 `processCount`(`process-tree.ts`)다. */
export function shellCount(count: number): string {
  return `셸 ${count}개`;
}

/** 세계 줄 — 세계의 이름이고, 지금 세계면 그렇다고 말한다. 화면이 앱 전체라 어느 쪽이 지금 세계인지가 이 줄에서 읽힌다. */
export function worldRowLabel(world: WorldNode): string {
  return world.current ? `${modeNameOf(world.mode)}, ${CURRENT_WORLD}` : modeNameOf(world.mode);
}

export const CURRENT_WORLD = "지금 세계";

/** 셸 도우미 줄 — 「셸 도우미」와 그 이름들(프로세스 줄과 같은 부른 이름). 사람이 띄운 것과 섞이지 않게 한 줄로 따로 선다(P1). */
export function helperLabel(helpers: ReadonlyArray<ProcessRow>): string {
  return `${HELPER_LABEL}, ${helpers.map(processLabel).join(" · ")}`;
}

/** CONTEXT의 말 그대로다(「셸 도우미」). */
export const HELPER_LABEL = "셸 도우미";
