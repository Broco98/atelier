import type { SystemLine, WorkProjectChoice } from "./fold";
import type { AgentRoster } from "./types";

// Work 만들기 카드의 값(v1 티켓 30 · 구현 스펙 §11 · S31 · 캔버스 Cards 보드 「Work 만들기」 · 「처음 한 번」) — **순수 함수**다. 그리는
// 것은 `WorkProposalCard` · `DecisionsCard`다.
//
// - **브랜치 칸은 규칙을 말한다**(스토리 90) — 고른 Project의 브랜치에서 머리(`fix/` · `feat/` …)를 읽어, 적은 이름이 그 규칙을 따르는지
//   칸 오른쪽에 한 줄로 말한다. 고른 Project에 이미 있는 이름 · 빈 이름은 문제라 「Work 만들기」가 잠긴다(core가 그 이름으로 Work를 만들지
//   않는다). Project를 다 빼면 브랜치가 없다 — core가 Project 없는 Work에 브랜치를 적지 않는다.
// - **처음 골라 둔 것은 Host의 추천이다**(보드 「Host 추천」) — 사람은 넣고 빼기만 한다.
// - **「결정은 내가 합니다」 카드는 처음 한 번**(S31) — 이 Thread에 Work를 만든 줄이 있고 앱 설정에 본 표(`seen.decisions`)가 없을 때 선다.
//   줄은 Library Host 정의의 `ask_before`에서 선다(코드 리뷰 1차 B7) — 고정해 두면 사람이 고친 Host 파일과 어긋난 약속이 된다.

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

/** 「결정은 내가 합니다」 카드의 줄 하나 — 그 일의 갈래(아이콘을 고른다)와 글. */
export interface DecisionItem {
  kind: "schema" | "push" | "merge" | "edit" | "shell" | "command" | "project";
  text: string;
}

/** 줄의 차례 — 보드의 차례(스키마 · push · Work 밖 Project)에 나머지 이름을 끼운다. 명령 패턴은 파일에 적힌 차례다. */
const DECISION_ORDER: readonly DecisionItem["kind"][] = ["schema", "push", "merge", "edit", "shell", "command", "project"];

/** 데이터베이스 스키마를 바꾸는 명령 패턴 — Host 기본 파일의 마이그레이션 명령들이다. */
const SCHEMA = /migrat|db push|alembic|drizzle-kit/;

/**
 * `ask_before`의 규칙 이름 하나 → 카드 줄. 판정이 걸지 않는 이름(`schema` · 모르는 이름)은 줄이 없다(`policy.rs` `rule`). 이름과 명령
 * 패턴의 보이는 꼴은 L2(`work-proposal.test.ts`)가 판정의 `rule` · `NAMED` · `shown` 표와 견준다.
 */
function decisionOf(rule: string): DecisionItem | null {
  if (rule === "push") return { kind: "push", text: "원격 저장소에 push" };
  if (rule === "merge") return { kind: "merge", text: "브랜치 · PR merge" };
  if (rule === "edit") return { kind: "edit", text: "파일 고치기" };
  if (rule === "shell") return { kind: "shell", text: "명령 실행" };
  const pattern = /^Bash\((.*)\)$/s.exec(rule)?.[1];
  if (pattern === undefined) return null;
  if (SCHEMA.test(pattern)) return { kind: "schema", text: "데이터베이스 스키마 바꾸기" };
  // 판정의 물음 이름과 같은 꼴로 보인다 — 앞뒤의 `*` · `:*`를 뗀다(`policy.rs` `shown`).
  const shown = pattern.replace(/:\*$/, "").replace(/^[\s*]+|[\s*]+$/g, "");
  return { kind: "command", text: `「${shown}」 실행` };
}

/**
 * 카드의 줄들 — Library Host 정의의 `ask_before`(물어보는 정도와 상관없이 먼저 묻는 일)와, 끝에 늘 Work 밖 Project(S22)다. Host를 읽지
 * 못했으면(목록을 아직 · 못 읽음, 깨진 파일) Work 밖 Project 한 줄이다. 같은 글은 한 번만 선다.
 */
export function decisionItems(roster: AgentRoster | null): DecisionItem[] {
  const host = roster?.agents.find((agent) => agent.from === "library" && agent.definition.handle === "host");
  const items: DecisionItem[] = [];
  for (const rule of host?.definition.policy.askBefore ?? []) {
    const item = decisionOf(rule);
    if (item && !items.some((one) => one.text === item.text)) items.push(item);
  }
  items.push({ kind: "project", text: "이 Work 밖의 Project 건드리기" });
  return items.sort((a, b) => DECISION_ORDER.indexOf(a.kind) - DECISION_ORDER.indexOf(b.kind));
}
