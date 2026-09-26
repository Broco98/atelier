import { sumMetrics } from "./metrics";
import { descendantLabel, processTree, withMemory, type DescendantNode } from "./shell-tree";
import type { OtherInstance, ProcessIdentity, ProcessMetrics, ProcessRow, ProcessSnapshot } from "./types";

// **`Processes`의 고아 · 다른 인스턴스 · 예외 묶음**(프로세스 결정 5 · 6 · 10 · 프로세스 스펙 S54 · 티켓 31). 판정이 가른 묶음을
// 화면이 트리로 펴고, 다른 인스턴스를 실행마다 묶고, [끝내기] · [정리]가 넘길 신원과 확인 창의 말을 짓는다. 순수 함수다.
//
// **묶음을 다시 가르지 않는다.** 무엇이 확정 고아이고 무엇이 출처 불명인지는 판정이 정한다(`verdict.rs`) — 화면이 다시 가르면 판정이
// 두 벌이 되고, [정리]가 끝내는 것과 화면이 보인 것이 갈린다.

/**
 * 고아(확정 고아나 출처 불명) 한 갈래를 한 트리로 — 판정은 셸 키마다 가르지만 화면은 키를 안 보인다(사람이 읽을 뜻이 없다). 트리의
 * 규칙은 셸의 자손과 같다(`processTree`).
 */
export function strayTree(groups: Readonly<Record<string, ReadonlyArray<ProcessRow>>>): DescendantNode[] {
  return processTree(Object.values(groups).flat());
}

/** 묶음이 보인 신원 전부 — [정리]가 끝내기에 넘기는 것이다. 화면에 보인 표본의 (pid, 시작 시각) 그대로다. */
export function identitiesOf(nodes: ReadonlyArray<DescendantNode>): ProcessIdentity[] {
  return nodes.map(({ row }) => row.id);
}

/**
 * **[끝내기]가 넘길 신원 — 그 줄의 프로세스와 그 PID 트리**(기본값 [끝내기]). 깊이 우선으로 편 줄에서 그 줄 뒤로 더 깊은 줄이 이어지는
 * 데까지가 그 트리다. 화면에 보인 표본의 신원이다 — 그사이 pid가 재사용됐으면 끝내기가 신호 직전 신원 확인으로 거른다(S4).
 */
export function subtreeAt(nodes: ReadonlyArray<DescendantNode>, at: number): ProcessIdentity[] {
  const top = nodes[at];
  if (top === undefined) return [];
  const ids = [top.row.id];
  for (const node of nodes.slice(at + 1)) {
    if (node.depth <= top.depth) break;
    ids.push(node.row.id);
  }
  return ids;
}

/** 확인 창 하나의 말 — `askDanger`에 넘긴다. */
export interface Ask {
  title: string;
  body: string;
  confirm: string;
}

/** 자손 행 [끝내기]의 확인 창. `count`는 넘길 신원의 수(그 프로세스 + 그 밑)다. */
export function endAsk(label: string, count: number): Ask {
  const body = count <= 1 ? "이 프로세스를 끝내요." : `이 프로세스와 그 밑에서 뜬 프로세스 ${count - 1}개를 끝내요.`;
  return { title: `'${label}' 끝내기`, body, confirm: "끝내기" };
}

/** 출처 불명 [정리]의 확인 창(결정 6). 확정 고아의 [정리]는 묻지 않는다 — 기록이 그 셸이 없다고 말한다. */
export function tidyUnknownAsk(count: number): Ask {
  return { title: "출처 불명 정리", body: `출처를 모르는 프로세스 ${count}개를 끝내요.`, confirm: "끝내기" };
}

/** 다른 인스턴스의 실행 하나 — 머리 줄(빌드 종류 · 버전과 합)과 그 밑의 트리. */
export interface InstanceGroup {
  /** 줄의 키. 어느 실행에도 안 묶인 키들의 묶음은 `null`이다. */
  generation: string | null;
  label: string;
  nodes: DescendantNode[];
  /** 그 실행의 행을 더한 것 — 셸 행 · work 행과 같은 규칙(`sumMetrics`). */
  totals: ProcessMetrics;
}

/**
 * 빌드 이름(S54) — 결정 10 그림의 「다른 인스턴스 (dev 빌드)」다. 설치본은 「설치본」이다. 버전이 붙는다. 그 실행의 기록을 못 읽었으면
 * 모른다고 말한다.
 */
export function buildLabel({ build, version }: Pick<OtherInstance, "build" | "version">): string {
  if (build === null) return "빌드 모름";
  const kind = build === "dev" ? "dev 빌드" : "설치본";
  return version === null ? kind : `${kind} · v${version}`;
}

/**
 * **다른 인스턴스를 실행마다** — 백엔드가 준 차례(세대 순)로 서고, 실행마다 그 셸 키들이 낸 행을 한 트리로 편다. 어느 실행에도 안
 * 묶인 키(판정 뒤에 그 실행의 기록이 지워졌다)의 행도 숨기지 않는다 — 「빌드 모름」 하나로 끝에 선다.
 */
export function instanceGroups(snapshot: ProcessSnapshot): InstanceGroup[] {
  const byKey = snapshot.verdict.otherInstances;
  const claimed = new Set<string>();
  const group = (generation: string | null, label: string, keys: ReadonlyArray<string>): InstanceGroup => {
    keys.forEach((key) => claimed.add(key));
    const rows = keys.flatMap((key) => byKey[key] ?? []);
    return { generation, label, nodes: processTree(rows), totals: sumMetrics(rows.map((row) => row.metrics)) };
  };
  const groups = snapshot.instances
    .map((instance) => group(instance.generation, buildLabel(instance), instance.shellKeys))
    .filter((one) => one.nodes.length > 0);
  const unclaimed = Object.keys(byKey).filter((key) => !claimed.has(key));
  const rest = group(null, buildLabel({ build: null, version: null }), unclaimed);
  return rest.nodes.length > 0 ? [...groups, rest] : groups;
}

/** 실행 줄의 접근성 이름 — 「빌드, 프로세스 N개, 메모리」 한 문장(S58). 메모리는 그 실행의 합이다. */
export function instanceRowLabel(group: InstanceGroup): string {
  return withMemory([group.label, `프로세스 ${group.nodes.length}개`], group.totals.memory);
}

/**
 * 「예외로 두기」가 목록에 더할 이름 — 행이 보인 이름(부른 이름, 없으면 커널 이름)이다. 예외 목록은 둘 중 어느 것으로도 건다
 * (`processes/exceptions.rs`의 `caught`) — 사람이 화면에서 본 그 글자를 적는다.
 */
export function exceptionName(row: ProcessRow): string {
  return descendantLabel(row);
}
