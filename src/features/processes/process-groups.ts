import { sumMetrics } from "./metrics";
import { processCount, processTree, withMemory, type ProcessNode } from "./process-tree";
import type { OtherInstance, ProcessIdentity, ProcessMetrics, ProcessSnapshot } from "./types";

// **`Processes`의 다른 인스턴스 묶음과 확인 창의 말**(프로세스 결정 5 · 6 · 10 · 프로세스 스펙 S54 · 티켓 31). 다른 인스턴스를 실행마다
// 묶고, [끝내기] · [정리]가 띄울 확인 창의 말을 짓는다. 출처 불명 묶음의 신원도 여기서 뽑는다(`unknownIdentities` — `●`의 재료). 순수
// 함수다. 묶음을 트리로 펴는 것과 넘길 신원은 프로세스 줄의 도구다(`process-tree.ts` — 셸의 자손과 같은 규칙).
//
// **묶음을 다시 가르지 않는다.** 무엇이 확정 고아이고 무엇이 출처 불명인지, 어느 셸 키가 다른 인스턴스의 것인지는 판정이
// 정한다(`verdict.rs`) — 화면이 다시 가르면 판정이 두 벌이 되고, [정리]가 끝내는 것과 화면이 보인 것이 갈린다.

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

/** 출처 불명 [정리]의 확인 창(프로세스 결정 6). 확정 고아의 [정리]는 묻지 않는다 — 기록이 그 셸이 없다고 말한다. */
export function tidyUnknownAsk(count: number): Ask {
  return { title: "출처 불명 정리", body: `출처를 모르는 프로세스 ${count}개를 끝내요.`, confirm: "끝내기" };
}

/**
 * 스냅샷의 **출처 불명 묶음의 신원 전부**(키 순 · 행 순). 요약이 싣는 출처 불명(`ProcessSummary.unknown`)과 같은 것이다 — Rust
 * `Summary::of`가 판정의 출처 불명 신원을 모두 싣는다. 화면이 보는 동안 `●`의 본 것으로 앉히는 재료다(`needs-look.ts`의 `lookSourceOf`).
 */
export function unknownIdentities(snapshot: ProcessSnapshot): ProcessIdentity[] {
  return Object.values(snapshot.verdict.orphans.unknown).flatMap((rows) => rows.map((row) => row.id));
}

/** 다른 인스턴스의 실행 하나 — 머리 줄(빌드 종류 · 버전과 합)과 그 밑의 트리. */
export interface InstanceGroup {
  /** 줄의 키. 어느 실행에도 안 묶인 키들의 묶음은 `null`이다. */
  generation: string | null;
  label: string;
  nodes: ProcessNode[];
  /** 그 실행의 행을 더한 것 — 셸 행 · work 행과 같은 규칙(`sumMetrics`). */
  totals: ProcessMetrics;
}

/**
 * 빌드 이름(S54) — 프로세스 결정 10 그림의 「다른 인스턴스 (dev 빌드)」다. 설치본은 「설치본」이다. 버전이 붙는다. 그 실행의 기록을 못 읽었으면
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
  return withMemory([group.label, processCount(group.nodes.length)], group.totals.memory);
}
