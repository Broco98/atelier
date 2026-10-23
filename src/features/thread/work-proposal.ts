import type { SystemLine, WorkProjectChoice } from "./fold";

// Work 만들기 카드의 값(v1 티켓 30 · 구현 스펙 §11 · S31 · 캔버스 Cards 보드 「Work 만들기」 · 「처음 한 번」) — **순수 함수**다. 그리는
// 것은 `WorkProposalCard` · `DecisionsCard`다.
//
// - **브랜치 칸은 규칙을 말한다**(스토리 90) — 고른 Project의 브랜치에서 머리(`fix/` · `feat/` …)를 읽어, 적은 이름이 그 규칙을 따르는지
//   칸 오른쪽에 한 줄로 말한다. 고른 Project에 이미 있는 이름 · 빈 이름은 문제라 「Work 만들기」가 잠긴다(core가 그 이름으로 Work를 만들지
//   않는다). Project를 다 빼면 브랜치가 없다 — core가 Project 없는 Work에 브랜치를 적지 않는다.
// - **처음 골라 둔 것은 Host의 추천이다**(보드 「Host 추천」) — 사람은 넣고 빼기만 한다.
// - **「결정은 내가 합니다」 카드는 처음 한 번**(S31) — 이 Thread에 Work를 만든 줄이 있고 앱 설정에 본 표(`seen.decisions`)가 없을 때 선다.

/** 브랜치 칸 오른쪽의 한 줄. `problem`이면 그 이름으로는 만들 수 없다. */
export interface BranchHint {
  text: string;
  problem: boolean;
}

/** 브랜치 이름의 머리 — 첫 `/`까지(「fix/」). 없으면 null이다. */
const headOf = (branch: string): string | null => {
  const at = branch.indexOf("/");
  return at > 0 ? branch.slice(0, at + 1) : null;
};

/** 브랜치 칸의 규칙 설명. `checked`는 지금 고른 Project의 slug들이다. */
export function branchHint(
  branch: string,
  projects: readonly WorkProjectChoice[],
  checked: ReadonlySet<string>,
): BranchHint {
  const picked = projects.filter((one) => checked.has(one.slug));
  if (picked.length === 0) return { text: "Project를 넣으면 이 이름으로 만들어요", problem: false };
  const name = branch.trim();
  if (name === "") return { text: "브랜치 이름을 적어 주세요", problem: true };
  const taken = picked.find((one) => one.branches.includes(name));
  if (taken) return { text: `${taken.name}에 이미 있는 브랜치예요`, problem: true };
  const head = headOf(name);
  const follows = head === null ? undefined : picked.find((one) => one.branches.some((other) => other.startsWith(head)));
  if (follows && head) return { text: `${follows.name}의 ${head}... 규칙을 따름`, problem: false };
  for (const one of picked) {
    const used = mostUsedHead(one.branches);
    // 「의」로 잇는다 — Project 이름은 대개 영문이라 받침으로 조사를 고르면 읽는 소리와 어긋난다(「web-app는」).
    if (used) return { text: `${one.name}의 브랜치는 ${used}... 규칙이에요`, problem: false };
  }
  return { text: "고른 Project가 모두 이 브랜치를 같이 써요", problem: false };
}

/** 그 저장소의 브랜치가 가장 많이 쓰는 머리 — 같으면 먼저 선 것이다. 머리 있는 브랜치가 없으면 null이다. */
function mostUsedHead(branches: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const branch of branches) {
    const head = headOf(branch);
    if (head) counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [head, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = head;
  return best;
}

/** 카드가 서면 처음 골라 둘 Project — Host가 추천한 것들이다. */
export function firstPicked(projects: readonly WorkProjectChoice[]): Set<string> {
  return new Set(projects.filter((one) => one.recommended).map((one) => one.slug));
}

/**
 * 「결정은 내가 합니다」 카드가 설 때 — 이 Thread에 Work를 만든 줄이 있고 아직 보지 않았다. `seen`은 앱 설정의 본 표이고, 아직 읽지
 * 못했으면 null이다(서지 않는다 — 본 사람에게 잠깐 번쩍이지 않게).
 */
export function decisionsDue(model: { system: readonly Pick<SystemLine, "kind">[] }, seen: boolean | null): boolean {
  return seen === false && model.system.some((line) => line.kind === "work");
}
