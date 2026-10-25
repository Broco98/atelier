// Space(03 구현 스펙 §8) — core `space.rs`가 내는 모양 그대로다(serde camelCase). 문제의 말(`message`)도 core가 짓는다 — 화면은 따로
// 검사하지 않는다(S7).

export type SpaceProblemKind = "unclosedFrontmatter" | "badYaml" | "noName" | "unknownProject" | "duplicateProject";

export interface SpaceProblem {
  /** 파일의 줄 — 1부터. */
  line: number;
  kind: SpaceProblemKind;
  /** 등록되지 않은 · 두 번 적은 Project의 slug. */
  project?: string;
  /** 그 줄 끝에 붙는 말(「등록되지 않은 Project예요」). */
  message: string;
}

export interface Space {
  slug: string;
  /** 읽을 수 없는 파일이면 빈 글이다 — 화면은 slug로 부른다(`spaceName`). */
  name: string;
  /** 적힌 차례, 한 번씩 — 등록되지 않은 Project도 든다. */
  projects: string[];
  createdAt: string;
  /** Host 도구로 만들면 `host`, 화면에서 만들면 없다(S6). */
  createdBy: string | null;
  description: string;
  problems: SpaceProblem[];
}

/** 같은 Project를 적은 다른 Space — 「함께 쓰는 Space」와 그래프의 점선 노드. */
export interface SharedSpace {
  slug: string;
  name: string;
  /** 겹치는 Project — 이 Space에 적힌 차례. */
  overlap: string[];
  /** 그 Space의 Project 전부. */
  projects: string[];
}

export interface SpaceDetail extends Space {
  shared: SharedSpace[];
}

/** 상세의 고치기 — 비운 칸은 그대로 둔다. `before`는 넣는 Project를 그 Project 앞에 세운다(빼기 되돌리기). */
export interface SpacePatch {
  name?: string;
  description?: string;
  add?: string[];
  before?: string;
  remove?: string[];
}
