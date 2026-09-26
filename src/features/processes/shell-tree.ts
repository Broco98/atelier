import { SIGNAL_LABEL, formatElapsed, showsElapsed, subagentLabel } from "@/components/shell/shell-signal";
import { attentionOn, runningSubagents, signalOf } from "@/features/terminal/shell-attention";
import type { ShellSignal } from "@/features/terminal/shell-attention";
import { modeOfOwner, runningOn, shellRowName, slugOfOwner } from "@/features/terminal/shell-registry";
import type { Shell, ShellOwner } from "@/features/terminal/shell-registry";
import { ALL_MODES, navItemsOf, worldNameOf, type Mode } from "@/mode";
import type { PoolShell, ProcessIdentity, ProcessRow, ProcessSnapshot } from "./types";

// **`Processes`의 셸 묶음**(프로세스 결정 9 · 10 · 프로세스 스펙 S53 · 티켓 27). 화면은 앱 전체를 세계 → work → 셸 → 자손으로 세운다.
// 이 모듈은 그 층과 차례를 짓고, 셸 행의 상태 칸과 행마다의 접근성 이름을 짓는다. 순수 함수다 — 지금 시각도 인자로 받는다.
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

/** work 행(최상위 터미널이면 `Terminal`). 이름과 셸 수만 들고 동작은 없다(S53). 메모리 · CPU는 28이 더한다. */
export interface GroupNode {
  owner: ShellOwner;
  /** 목록의 제목. 목록에 없으면 slug, 최상위 터미널이면 nav의 `Terminal`이다. */
  name: string;
  shells: ReadonlyArray<ShellNode>;
}

/** 스토어의 셸 하나와 풀의 그 셸 — 셸 키로 이은 것. */
export interface ShellNode {
  shell: Shell;
  pool: PoolShell;
  /** 셸 도우미(프로세스 스펙 P1) — 시작 순. 셸 행 아래 옅은 줄 하나로 따로 선다. */
  helpers: ReadonlyArray<ProcessRow>;
  /** 사람이 띄운 자손 — 트리를 깊이 우선으로 편 차례이고, 형제는 시작 순이다. 깊이 1이 셸 바로 밑이다. */
  descendants: ReadonlyArray<DescendantNode>;
}

export interface DescendantNode {
  row: ProcessRow;
  depth: number;
}

/**
 * 셸 묶음을 짓는다. **셸이 선 세계만 선다** — 지금 세계가 먼저, 그다음이 저쪽 세계다. 세계 안에서는 사이드바 순서(목록이 준
 * 차례 그대로 — 고정이 먼저인 것은 코어가 정한다, 결정 100)이고, 목록에 없는 work이 그 뒤, 최상위 터미널(`Terminal`)이 맨 끝이다.
 * work 안의 셸은 탭의 차례다.
 *
 * **양쪽에 다 있는 셸만 선다.** 스토어가 모르는 풀의 셸은 「화면 밖 셸」이라 따로 묶인다(32). 풀에 없는 스토어의 칸은 프로세스가
 * 아니다 — spawn 답 전이라 키가 없거나, 이유가 있는 끝으로 칸만 남았거나, 스냅샷 뒤에 막 떴다(다음 스냅샷에 선다).
 *
 * 목록에 없는 work은 숨기지 않는다 — 목록을 아직 못 읽었거나 MCP로 아카이브돼 주인을 잃은 셸이라(주인 잃은 셸 묶음은 32의 몫이다)
 * 숨기면 도는 것이 화면에서 사라진다.
 */
export function shellTree({ current, shells, lists, snapshot }: TreeInput): WorldNode[] {
  const pooled = new Map(snapshot.pool.map((shell) => [shell.shellKey, shell]));
  const helpers = new Set(snapshot.verdict.helpers.map(identityKey));

  const worlds: WorldNode[] = [];
  for (const mode of [current, ...ALL_MODES.filter((one) => one !== current)]) {
    // owner마다 셸을 모은다 — `Map`이 넣은 차례를 지키므로 칸 순서(탭의 차례)가 그대로 남는다.
    const byOwner = new Map<ShellOwner, ShellNode[]>();
    for (const shell of shells) {
      if (modeOfOwner(shell.owner) !== mode || shell.shellKey === null) continue;
      const pool = pooled.get(shell.shellKey);
      if (pool === undefined) continue;
      const node = shellNode(shell, pool, snapshot.verdict.descendants[shell.shellKey] ?? [], helpers);
      const group = byOwner.get(shell.owner);
      if (group) group.push(node);
      else byOwner.set(shell.owner, [node]);
    }
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

/** 신원을 한 글자로 — 집합의 키. pid만으로는 재사용을 못 가른다(프로세스 결정 3). */
function identityKey(id: ProcessIdentity): string {
  return `${id.pid}@${id.startedUs}`;
}

/** 시작 순 — 같으면 pid 순. pid는 돌고 돌아 작아질 수 있어 뜬 차례를 말하지 않는다. */
function byStart(a: ProcessRow, b: ProcessRow): number {
  return a.id.startedUs - b.id.startedUs || a.id.pid - b.id.pid;
}

/**
 * 셸 하나의 노드. 판정은 셸 도우미를 자손에도 그대로 싣는다(함께 끝낼 대상이다) — 곁 집합(`helpers`)의 신원으로 갈라 따로 둔다.
 *
 * **들여쓰기는 부모 pid로 짓는다.** 셸 자신의 행은 스냅샷에 없으므로(판정이 셸 자신을 안 싣는다) 셸의 직속 자식과 트리가 끊겨
 * 표식으로만 잡힌 것(claude Bash 도구가 띄운 dev 서버 — 부모 1)이 함께 깊이 1에 선다. 부모 행이 자식보다 늦게 태어났으면 그 pid는
 * 재사용된 남이다 — 판정과 같은 규칙으로 잇지 않는다(`verdict.rs`). 그래서 고리가 생기지 않는다.
 */
function shellNode(shell: Shell, pool: PoolShell, rows: ReadonlyArray<ProcessRow>, helperIds: ReadonlySet<string>): ShellNode {
  const sorted = [...rows].sort(byStart);
  const helpers = sorted.filter((row) => helperIds.has(identityKey(row.id)));
  const spawned = sorted.filter((row) => !helperIds.has(identityKey(row.id)));

  const byPid = new Map(spawned.map((row) => [row.id.pid, row]));
  const children = new Map<ProcessRow | null, ProcessRow[]>();
  for (const row of spawned) {
    const parent = byPid.get(row.ppid);
    const under = parent !== undefined && parent !== row && parent.id.startedUs <= row.id.startedUs ? parent : null;
    const siblings = children.get(under);
    if (siblings) siblings.push(row);
    else children.set(under, [row]);
  }

  const descendants: DescendantNode[] = [];
  const walk = (parent: ProcessRow | null, depth: number) => {
    for (const row of children.get(parent) ?? []) {
      descendants.push({ row, depth });
      walk(row, depth + 1);
    }
  };
  walk(null, 1);
  return { shell, pool, helpers, descendants };
}

/**
 * 셸 행의 상태 칸(S53) — 위에서부터 첫 갈래다.
 * - 셸 상태(나를 기다림 · 확인할 것 · 도는 중 · 서브에이전트 N)가 있으면 그것이다. 레지스트리가 내놓는 문(`signalOf` ·
 *   `runningSubagents`)을 딛는다 — 셸 탭 · 사이드바 · 띠와 같은 말이어야 한다(스토리 79). 죽은 칸 가리개도 그 문에 있다.
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
 * 상태 칸의 글자. 눈에 보이는 것과 접근성 이름이 같은 이것을 읽는다. 경과는 사이드바의 둘째 줄과 같은 규칙으로 붙는다 — 도는 중은
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

// ── 행의 접근성 이름(S58) — 행마다 한 문장이다. 스크린리더가 트리를 줄로 읽을 때 그 줄이 무엇인지가 이 이름에서 끝난다.

/** 셸 행 — 「셸 이름, 상태, 메모리」. 메모리는 28이 채우기 전까지 빠진다. 셸 이름은 탭 줄과 같은 것이다(`shellRowName`). */
export function shellRowLabel(node: ShellNode, now: number): string {
  return `${shellRowName(node.shell)}, ${stateText(shellStateOf(node), now)}`;
}

/** work 행 — 이름과 셸 수. 세는 말은 「셸 N개」다(CONTEXT 「셸」). */
export function groupRowLabel(group: GroupNode): string {
  return `${group.name}, ${shellCount(group.shells.length)}`;
}

export function shellCount(count: number): string {
  return `셸 ${count}개`;
}

/** 세계 줄 — 세계의 이름이고, 지금 세계면 그렇다고 말한다. 화면이 앱 전체라 어느 쪽이 지금 세계인지가 이 줄에서 읽힌다. */
export function worldRowLabel(world: WorldNode): string {
  return world.current ? `${worldNameOf(world.mode)}, ${CURRENT_WORLD}` : worldNameOf(world.mode);
}

export const CURRENT_WORLD = "지금 세계";

/**
 * 자손 행 — **부른 이름**이다(argv[0]의 마지막 조각). 커널 이름은 실제로 실행된 파일이라 심링크로 부른 것(`claude` → 버전 경로)이
 * 다른 이름이 된다 — 셸 탭이 고르는 순서와 같다(`pty::foreground_name`). 부른 이름을 못 읽은 행(env를 못 읽었다)은 커널 이름이다.
 */
export function descendantLabel(row: ProcessRow): string {
  const invoked = row.argv0?.split("/").pop();
  return invoked ? invoked : row.name;
}

/** 셸 도우미 줄 — 「셸 도우미」와 그 이름들. 사람이 띄운 것과 섞이지 않게 한 줄로 따로 선다(P1). */
export function helperLabel(helpers: ReadonlyArray<ProcessRow>): string {
  return `${HELPER_LABEL}, ${helpers.map(descendantLabel).join(" · ")}`;
}

/** CONTEXT의 말 그대로다(「셸 도우미」). */
export const HELPER_LABEL = "셸 도우미";
