// 읽는 범위(03 구현 스펙 §7) — core `reading_scope.rs`가 내는 모양 그대로다(serde camelCase). Thread가 읽는 Project는 core의 함수 하나에서
// 나온다 — Session의 자리 · 머리말 · 요약 카드 「소스」 · Space 메뉴가 같은 값을 읽는다(화면은 다시 세지 않는다).

/** 그 Project를 왜 읽나 — Space에 묶임 · Space가 없어 전부 · Work의 아직 worktree 없는 Project · 「읽기만 하기」로 허락함. */
export type ScopeWhy = "space" | "all" | "work" | "readOnly";

/** 범위 줄의 갈래 — Space 없음(등록된 전부) · Space · 빈 Space · 등록된 Project 없음. */
export type ScopeKind = "all" | "space" | "emptySpace" | "noProjects";

export interface ScopeSpace {
  slug: string;
  /** 보이는 이름 — 읽을 수 없는 파일이면 slug다. */
  name: string;
  /** 파일에 문제가 있다 — 읽을 수 있는 Project만 읽는다. */
  troubled: boolean;
}

export interface ScopeProject {
  slug: string;
  name: string;
  why: ScopeWhy;
}

/** worktree에서 일하는 Project — 함께 여는 폴더에서는 빠졌지만(§7 규칙 4) 그 worktree에서 읽는다. */
export interface WorkedProject {
  slug: string;
  name: string;
}

export interface ReadingScope {
  /** 정한 Space — 없거나 그 파일이 없으면 `null`이다(§7 규칙 1). */
  space: ScopeSpace | null;
  /** 읽는 Project — 바탕(Space · 전부) 뒤에 더한 것(Work · 읽기만) 차례다. worktree에서 일하는 Project · 폴더가 없는 Project는 빠졌다. */
  projects: ScopeProject[];
  /** 이 Work의 worktree에서 일하는 Project — 범위 줄 · Space 줄은 이것도 읽는 Project로 말한다(고치는 것이 먼저 — 요약 카드 「소스」 차례). */
  worked: WorkedProject[];
  kind: ScopeKind;
  /** 등록된 Project 수 — 「등록된 Project N개를 모두 읽어요」. */
  registered: number;
}

/** 범위를 셀 자리 — 연 Thread, 또는 보내기 전의 새 Thread가 쥔 Work · Space(입력창, 06). */
export interface ScopeOf {
  thread?: string | null;
  work?: string | null;
  space?: string | null;
}

/** 읽는 Project의 이름이 이 수를 넘으면 앞 둘과 「외 N개」다(§5 범위 줄 「web-app · api-server 외 2개를 읽어요」). */
const NAMED = 3;

/** 읽는 Project 이름들의 한 조각 — 「web-app · api-server」, 셋을 넘으면 「web-app · api-server 외 2개」. 범위 줄 · Space 줄이 함께 쓴다. */
export function readingList(names: readonly string[]): string {
  if (names.length <= NAMED) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} 외 ${names.length - 2}개`;
}
