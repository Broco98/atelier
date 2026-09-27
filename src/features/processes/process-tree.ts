import { formatMemory } from "./metrics";
import type { ProcessIdentity, ProcessRow } from "./types";

// **`Processes`의 프로세스 한 줄**(프로세스 스펙 S53 · S54 · S58 · 티켓 27 · 31). 셸의 자손, 확정 고아 · 출처 불명, 다른 인스턴스, 예외 —
// 어느 묶음에 서든 프로세스 줄은 같은 규칙으로 선다: 트리로 펴는 차례, 줄의 이름과 접근성 이름, [끝내기] · [정리]가 넘길 신원. 그 규칙이
// 사는 자리가 여기 하나다. 순수 함수다.
//
// 이 줄을 「자손」으로 부르지 않는다 — 예외 · 고아 · 다른 인스턴스의 줄은 셸의 자손이 아니다(CONTEXT 「예외」 · 「고아」). 셸 · work ·
// 세계의 층은 `shell-tree.ts`가, 다른 인스턴스를 실행마다 묶는 것과 확인 창의 말은 `process-groups.ts`가 짓고, 둘 다 이 도구를 딛는다.

/**
 * 신원을 한 글자로 — 집합과 줄의 열쇠. pid만으로는 재사용을 못 가른다(프로세스 결정 3).
 *
 * **이 글자는 저장된다.** nav 메타의 본 것(`needs-look.ts`의 `unknown:<신원>`)이 이것으로 짓고 localStorage에 남는다(`looked.ts`).
 * 모양을 바꾸면 앱을 새 판으로 올린 날 사람이 본 출처 불명이 모두 새것이 되어 `●`가 다시 선다 — `needs-look.test.ts`가 글자를 잡는다.
 */
export function identityKey(id: ProcessIdentity): string {
  return `${id.pid}@${id.startedUs}`;
}

/** 트리로 편 프로세스 한 줄. 깊이 1이 그 묶음의 맨 위다 — 셸의 자손이면 셸 바로 밑이다. */
export interface ProcessNode {
  row: ProcessRow;
  depth: number;
}

/** 시작 순 — 같으면 pid 순. pid는 돌고 돌아 작아질 수 있어 뜬 차례를 말하지 않는다. */
export function byStart(a: ProcessRow, b: ProcessRow): number {
  return a.id.startedUs - b.id.startedUs || a.id.pid - b.id.pid;
}

/**
 * 행들을 **트리로 펴다** — 깊이 우선으로 편 차례이고, 형제는 시작 순이며, 깊이 1이 맨 위다. 셸의 자손과 고아 · 다른 인스턴스 · 예외
 * 묶음(티켓 31)이 같은 규칙으로 선다.
 *
 * **들여쓰기는 부모 pid로 짓는다.** 부모 행이 묶음에 없으면 맨 위에 선다. 부모 행이 자식보다 늦게 태어났으면 그 pid는 재사용된
 * 남이다 — 판정과 같은 규칙으로 잇지 않는다(`verdict.rs`). 그래서 고리가 생기지 않는다.
 */
export function processTree(rows: ReadonlyArray<ProcessRow>): ProcessNode[] {
  const sorted = [...rows].sort(byStart);
  const byPid = new Map(sorted.map((row) => [row.id.pid, row]));
  const children = new Map<ProcessRow | null, ProcessRow[]>();
  for (const row of sorted) {
    const parent = byPid.get(row.ppid);
    const under = parent !== undefined && parent !== row && parent.id.startedUs <= row.id.startedUs ? parent : null;
    const siblings = children.get(under);
    if (siblings) siblings.push(row);
    else children.set(under, [row]);
  }

  const nodes: ProcessNode[] = [];
  const walk = (parent: ProcessRow | null, depth: number) => {
    for (const row of children.get(parent) ?? []) {
      nodes.push({ row, depth });
      walk(row, depth + 1);
    }
  };
  walk(null, 1);
  return nodes;
}

/**
 * 고아(확정 고아나 출처 불명) 한 갈래를 한 트리로 — 판정은 셸 키마다 가르지만 화면은 키를 안 보인다(사람이 읽을 뜻이 없다). 트리의
 * 규칙은 셸의 자손과 같다(`processTree`). **묶음을 다시 가르지 않는다** — 무엇이 확정 고아이고 무엇이 출처 불명인지는 판정이 정한다.
 */
export function strayTree(groups: Readonly<Record<string, ReadonlyArray<ProcessRow>>>): ProcessNode[] {
  return processTree(Object.values(groups).flat());
}

/** 묶음이 보인 신원 전부 — [정리]가 끝내기에 넘기는 것이다. 화면에 보인 표본의 (pid, 시작 시각) 그대로다. */
export function identitiesOf(nodes: ReadonlyArray<ProcessNode>): ProcessIdentity[] {
  return nodes.map(({ row }) => row.id);
}

/**
 * **[끝내기]가 넘길 신원 — 그 줄의 프로세스와 그 PID 트리**(기본값 [끝내기]). 깊이 우선으로 편 줄에서 그 줄 뒤로 더 깊은 줄이 이어지는
 * 데까지가 그 트리다. 화면에 보인 표본의 신원이다 — 그사이 pid가 재사용됐으면 끝내기가 신호 직전 신원 확인으로 거른다(S4).
 */
export function subtreeAt(nodes: ReadonlyArray<ProcessNode>, at: number): ProcessIdentity[] {
  const top = nodes[at];
  if (top === undefined) return [];
  const ids = [top.row.id];
  for (const node of nodes.slice(at + 1)) {
    if (node.depth <= top.depth) break;
    ids.push(node.row.id);
  }
  return ids;
}

// ── 줄의 이름(S58) — 행마다 한 문장이다. 스크린리더가 트리를 줄로 읽을 때 그 줄이 무엇인지가 이 이름에서 끝난다.
//
// **메모리는 이름의 끝 조각이다**(티켓 28). 표기는 행의 칸과 같은 함수(`formatMemory`)라 눈과 귀가 같은 숫자를 받는다. 못 읽었으면
// 그 조각이 빠진다 — 「알 수 없음」을 줄마다 읽어 주는 것은 소리일 뿐이다(macOS 밖에서는 늘 그렇다).

/** 이름 조각들 끝에 메모리를 붙여 한 문장으로. 셸 · work · 실행 · 화면 밖 셸의 줄도 이것으로 짓는다. */
export function withMemory(parts: ReadonlyArray<string>, memory: number | null): string {
  return (memory === null ? parts : [...parts, formatMemory(memory)]).join(", ");
}

/**
 * 프로세스 줄의 이름 — **부른 이름**이다(argv[0]의 마지막 조각). 커널 이름은 실제로 실행된 파일이라 심링크로 부른 것(`claude` → 버전
 * 경로)이 다른 이름이 된다 — 셸 탭이 고르는 순서와 같다(`pty::foreground_name`). 부른 이름을 못 읽은 행(env를 못 읽었다)은 커널
 * 이름이다.
 */
export function processLabel(row: ProcessRow): string {
  const invoked = row.argv0?.split("/").pop();
  return invoked ? invoked : row.name;
}

/** 프로세스 줄의 접근성 이름 — 부른 이름과 그 프로세스의 메모리. 셸 행과 같은 모양(이름, …, 메모리)이라 줄마다 같은 자리에서 숫자가 읽힌다. */
export function processRowLabel(row: ProcessRow): string {
  return withMemory([processLabel(row)], row.metrics.memory);
}

/**
 * 「예외로 두기」가 목록에 더할 이름 — 행이 보인 이름(부른 이름, 없으면 커널 이름)이다. 예외 목록은 둘 중 어느 것으로도 건다
 * (`processes/exceptions.rs`의 `caught`) — 사람이 화면에서 본 그 글자를 적는다.
 */
export function exceptionName(row: ProcessRow): string {
  return processLabel(row);
}
