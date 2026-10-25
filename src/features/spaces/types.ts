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

/** 파일의 줄 자리 — 1부터, 끝 포함. */
export interface Lines {
  first: number;
  last: number;
}

/** 파일의 세 조각(name · projects · 본문)이 선 줄 — core 검사가 준다. 고치기 화면의 「커서 줄 ↔ 조각」이 이것으로 짝을 짓는다. */
export interface SpacePieces {
  name: number | null;
  projects: Lines | null;
  body: Lines | null;
}

/**
 * 고치기 화면(관계 편집 · 직접 만들기)의 검사 한 번(core `draft_space` — 명령 `check_space`). 고칠 때마다 다시 부른다 — 화면은 따로
 * 검사하지 않는다(S7).
 */
export interface SpaceDraft {
  /** 그 글을 읽은 Space — 문제는 `problems`. slug는 관계 편집이면 그 Space의 것, 새 Space면 이름에서 지을 것(이름이 비면 빈 글). */
  space: Space;
  pieces: SpacePieces;
  /** 그 글의 Project를 적은 다른 Space — 고치는 Space 자신은 빠진다. */
  shared: SharedSpace[];
  /** 등록된 Project의 slug — 안내 줄 「Project는 … 중에서」. */
  registered: string[];
  /** Space 파일들의 폴더(홈은 `~`). 파일 칸 머리의 경로가 이 아래 `<slug>.md`다. */
  folder: string;
  /** 새 Space에서 같은 이름의 Space가 있어 slug 끝에 붙인 것(`-2`). */
  suffix: string | null;
}
