import type { ShellOwner } from "@/features/terminal/shell-registry";
import { identityKey } from "./process-tree";
import type { GroupNode } from "./shell-tree";
import type { ProcessIdentity, ProcessSnapshot } from "./types";

// **`Processes`의 접힘**(ui-refresh 결정 28 · 「같은 날 더 정한 것」 — 사용자 요청으로 더한 동작). 구획과 트리의 줄이 접힌다. 처음
// 상태는 규칙(ui-refresh 결정 28의 표)이 정하고, 손으로 바꾼 것은 화면에 있는 동안만 기억한다 — 상태는 화면이 든다(`ProcessesPage`의
// `useFolds`). 여기는 그 규칙과 키다. 순수 함수다. 트리에서 무엇이 보이는지는 프로세스 줄의 도구다(`process-tree.ts`의 `shownNodes`).

/** 구획 — 화면에 선 차례다. */
export type SectionId = "works" | "ownerless" | "offscreen" | "confirmed" | "unknown" | "instances" | "exceptions" | "log";

/**
 * **ui-refresh 결정 28의 표** — 정리할 것이 있는 구획(작업 · 주인 잃은 셸 · 화면 밖 셸 · 확정 고아)은 펼쳐 열고, 보기 전용이거나 참고용인 구획
 * (출처 불명 · 다른 인스턴스 · 예외 · 정리 기록)은 접어 연다. 올 때마다 할 일이 펼쳐져 있다.
 */
export const OPEN_AT_FIRST: Readonly<Record<SectionId, boolean>> = {
  works: true,
  ownerless: true,
  offscreen: true,
  confirmed: true,
  unknown: false,
  instances: false,
  exceptions: false,
  log: false,
};

/**
 * 줄의 접힘 키 — 작업은 셸 주인, 셸은 셸 키, 다른 인스턴스의 머리는 실행의 세대, 프로세스(셸의 자손 · 고아 · 예외 · 다른 인스턴스의
 * 줄)는 신원이다. 줄은 처음에 다 펼침이라 화면은 접은 줄의 키만 든다. 종류마다 앞말을 달아 한 집합에 섞여도 다른 종류의 같은 글자와
 * 안 겹친다 — 프로세스는 `identityKey` 그대로다(`shownNodes`가 그것으로 찾는다. 그 글자에는 `:`가 없다).
 */
export const foldKey = {
  work: (owner: ShellOwner) => `work:${owner}`,
  shell: (shellKey: string) => `shell:${shellKey}`,
  run: (generation: string | null) => `run:${generation ?? ""}`,
  process: (id: ProcessIdentity) => identityKey(id),
};

/**
 * 지금 화면에 설 수 있는 줄의 키 — 이 밖의 접은 키는 잊는다(사라진 줄이다). 작업은 선 work 줄(셸 묶음 · 주인 잃은 셸)의 것, 셸은 풀의
 * 셸, 프로세스는 판정이 실은 줄 전부, 실행은 백엔드가 준 실행과 어느 실행에도 안 묶인 묶음이다. 그 줄이 지금 접힌 구획이나 줄 밑에
 * 있어도 든다 — 안 보인다고 잊지 않는다.
 */
export function liveFoldKeys(snapshot: ProcessSnapshot, groups: ReadonlyArray<GroupNode>): Set<string> {
  const { verdict } = snapshot;
  const rows = [
    ...Object.values(verdict.descendants),
    ...Object.values(verdict.orphans.confirmed),
    ...Object.values(verdict.orphans.unknown),
    verdict.exceptions,
    ...Object.values(verdict.otherInstances),
  ].flat();
  return new Set([
    ...groups.map((group) => foldKey.work(group.owner)),
    ...snapshot.pool.map((shell) => foldKey.shell(shell.shellKey)),
    ...rows.map((row) => foldKey.process(row.id)),
    ...snapshot.instances.map((instance) => foldKey.run(instance.generation)),
    foldKey.run(null),
  ]);
}

/** 구획 하나의 여닫음 — `Section`이 받는다. 여닫이 부품이 알리는 **다음** 상태를 그대로 적는다. */
export interface SectionFold {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 자식이 있는 줄 하나의 여닫음 — `TreeRow`가 받는다. 이름은 셰브론 버튼의 이름(「<이름> 접기」 · 「<이름> 펼치기」)이 된다. */
export interface RowFold {
  open: boolean;
  name: string;
  onToggle: () => void;
}

/** 화면이 든 접힘 — 구획과 줄에 나눠 준다(`ProcessesPage`의 `useFolds`). */
export interface Folds {
  section: (id: SectionId) => SectionFold;
  row: (key: string, name: string) => RowFold;
  /** 접은 줄의 키 — 프로세스 줄 가운데 무엇이 보이는지는 이것으로 가른다(`shownNodes`). */
  closed: ReadonlySet<string>;
}
