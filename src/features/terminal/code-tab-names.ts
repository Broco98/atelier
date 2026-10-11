import type { CodeTarget } from "./shell-registry";

/** 파일 탭 칸에 서는 이름 — 파일 이름과, 겹칠 때만 흐리게 덧붙는 상위 폴더(`index.ts · works`). */
export interface CodeTabName {
  name: string;
  /** 겹침을 푸는 상위 폴더들(`/`로 잇는다, 위에서부터). 겹치지 않으면 `null`이다. */
  folder: string | null;
}

/**
 * 열린 파일 탭들의 이름(git-integration S11 · 결정 38 — 스토리 27). **이름이 겹치는 칸끼리만** 상위 폴더를 하나씩 덧붙이고,
 * 겹침이 풀릴 때까지 더 붙인다 — 이미 풀린 칸은 거기서 멈춘다(VS Code와 같은 버릇). 겹치던 칸이 닫히면 남은 칸은 다시 짧아진다:
 * 값은 지금 열린 칸들로만 낸다.
 *
 * 폴더의 사다리 맨 위는 **프로젝트**다 — 두 프로젝트의 같은 경로(`billing/src/index.ts` · `ledger/src/index.ts`)도 끝내 갈린다.
 * 셸 칸은 받지 않는다: 셸의 이름은 타이틀이 말한다.
 */
export function codeTabNames<T extends CodeTarget & { id: number }>(
  tabs: ReadonlyArray<T>,
): ReadonlyMap<number, CodeTabName> {
  const rungs = tabs.map((tab) => {
    const parts = [tab.project, ...tab.path.split("/")];
    return { id: tab.id, name: parts[parts.length - 1], folders: parts.slice(0, -1), depth: 0 };
  });
  const folderOf = (rung: (typeof rungs)[number]) => rung.folders.slice(rung.folders.length - rung.depth).join("/");

  const byName = new Map<string, (typeof rungs)[number][]>();
  for (const rung of rungs) byName.set(rung.name, [...(byName.get(rung.name) ?? []), rung]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const rung of group) rung.depth = 1;
    for (;;) {
      const labels = group.map(folderOf);
      // 아직 겹치고 더 오를 폴더가 남은 칸만 한 단 오른다.
      const clashing = group.filter(
        (rung, at) => labels.indexOf(labels[at]) !== labels.lastIndexOf(labels[at]) && rung.depth < rung.folders.length,
      );
      if (clashing.length === 0) break;
      for (const rung of clashing) rung.depth += 1;
    }
  }
  return new Map(rungs.map((rung) => [rung.id, { name: rung.name, folder: rung.depth > 0 ? folderOf(rung) : null }]));
}
