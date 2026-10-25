import type { SharedSpace, Space, SpaceDraft, SpacePieces, SpaceProblem } from "./types";

// Space 파일 고치기 화면(03 구현 스펙 §13 · 시안 F1-SpaceEdit · F4-SpaceNew · F4-SpaceEditErr)이 그리는 것을 값으로 짓는 순수 함수들 —
// 커서 줄 ↔ 조각, 처음 커서, 고친 줄, 상태 알약, 안내 줄, 새 Space의 빈 틀. **문제와 조각 자리는 core 검사가 준 것을 그대로 쓴다**
// (S7 — `check_space`). 여기서는 그 값을 화면 말로 옮기기만 하고, 파일 글을 따로 읽어 문제를 짓지 않는다(L2가 잰다).

/** 관계 편집(그 Space의 파일) · 새 Space(직접 만들기) — 같은 화면의 두 길. */
export type EditMode = "edit" | "new";

/** 파일의 세 조각 — 미리보기 카드의 이름 · 관계 그래프 · 설명이 이 차례로 그린다. */
export type Piece = "name" | "projects" | "body";

/** 그 줄(1부터)이 속한 조각 — 조각 밖(`---` · `createdAt` · 빈 줄)이면 없다. */
export function pieceOfLine(pieces: SpacePieces, line: number): Piece | null {
  if (pieces.name === line) return "name";
  if (pieces.projects && pieces.projects.first <= line && line <= pieces.projects.last) return "projects";
  if (pieces.body && pieces.body.first <= line && line <= pieces.body.last) return "body";
  return null;
}

/** 카드 조각의 꼬리표 — 그 조각의 줄(「2행」 · 「3–6행」). 파일에 없는 조각이면 빈 글이다. */
export function pieceSpan(pieces: SpacePieces, piece: Piece): string {
  const lines = piece === "name" ? (pieces.name === null ? null : { first: pieces.name, last: pieces.name }) : pieces[piece];
  if (!lines) return "";
  return lines.first === lines.last ? `${lines.first}행` : `${lines.first}–${lines.last}행`;
}

/** 글의 자리(편집기의 커서) → 그 줄(1부터). */
export function caretLineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** 그 줄(1부터)의 끝 자리 — 처음 커서를 그 줄 끝에 둔다. 줄이 모자라면 글의 끝이다. */
export function lineEndOffset(text: string, line: number): number {
  const lines = text.split("\n");
  return lines.slice(0, Math.min(line, lines.length)).join("\n").length;
}

/**
 * 처음 커서(S14) — 첫 문제 줄, 없으면 새 Space는 `name` 줄, 관계 편집은 `projects` 줄(가장 많이 고치는 조각 — 「방금 고친 줄」은 화면을
 * 새로 열면 없다). 조각이 없는 파일이면 frontmatter의 첫 칸 자리(2행)다.
 */
export function firstCaretLine(problems: readonly SpaceProblem[], pieces: SpacePieces, mode: EditMode): number {
  if (problems.length > 0) return Math.min(...problems.map((problem) => problem.line));
  if (mode === "edit" && pieces.projects) return pieces.projects.first;
  return pieces.name ?? 2;
}

/**
 * 연 글(`base`)과 지금 글을 줄로 맞대 본 것 — 고친 줄 수와 지금 글의 새 줄(1부터, 줄 머리의 초록 막대). 이어진 고침 한 덩이는 뺀 줄과
 * 넣은 줄 가운데 많은 쪽으로 센다 — 한 줄을 바꾸면 1이지 「빼고 넣은 둘」이 아니다.
 */
export function lineChanges(base: string, text: string): { count: number; added: number[] } {
  const a = base.split("\n");
  const b = text.split("\n");
  // 가장 긴 같은 줄 차례(LCS) — Space 파일은 수십 줄이라 표 하나로 충분하다.
  const same = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      same[i][j] = a[i] === b[j] ? same[i + 1][j + 1] + 1 : Math.max(same[i + 1][j], same[i][j + 1]);
    }
  }
  const added: number[] = [];
  let count = 0;
  let removed = 0;
  let inserted = 0;
  const close = () => {
    count += Math.max(removed, inserted);
    removed = 0;
    inserted = 0;
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || same[i][j + 1] >= same[i + 1][j])) {
      added.push(j + 1);
      inserted++;
      j++;
    } else {
      removed++;
      i++;
    }
  }
  close();
  return { count, added };
}

/** 편집기 글자의 갈래 — frontmatter 경계(`---`) · 칸 이름 · 기호(`:` · `-`) · 값 · 주석 · 본문 · 빈칸. */
export type Tone = "mark" | "key" | "punct" | "value" | "comment" | "body" | "plain";

export interface PaintedLine {
  tokens: { tone: Tone; text: string }[];
  /** 그 줄 끝에 붙는 문제의 말 — core 검사가 그 줄에 낸 첫 문제다(시안 `.lens`). */
  problem: string | null;
}

/**
 * 편집기의 줄마다 칠할 조각과 줄 끝 문제(시안 `.hl` — 칸 이름은 파랑, `---` · 기호 · 주석은 옅게). **색칠은 보이기만 한다** — 문제는 core
 * 검사가 준 줄 그대로이고, 여기서 frontmatter를 가르는 것은 글자 색을 고르는 데까지다.
 */
export function paintLines(text: string, problems: readonly SpaceProblem[]): PaintedLine[] {
  const lines = text.split("\n");
  const open = lines[0]?.trim() === "---";
  const close = open ? lines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1;
  const said = new Map<number, string>();
  for (const problem of problems) if (!said.has(problem.line)) said.set(problem.line, problem.message);
  return lines.map((line, index) => {
    const front = open && index > 0 && (close < 0 || index < close);
    let tokens: PaintedLine["tokens"];
    if (open && (index === 0 || index === close)) tokens = [{ tone: "mark", text: line }];
    else if (!front) tokens = [{ tone: "body", text: line }];
    else if (line.trim().startsWith("#")) tokens = [{ tone: "comment", text: line }];
    else {
      const field = /^(\s*)([^\s:#-][^:#]*)(:)(.*)$/.exec(line);
      const item = /^(\s*)(-)(\s*)(.*)$/.exec(line);
      if (field) tokens = [{ tone: "plain", text: field[1] }, { tone: "key", text: field[2] }, { tone: "punct", text: field[3] }, ...valued(field[4])];
      else if (item) tokens = [{ tone: "plain", text: item[1] }, { tone: "punct", text: item[2] }, { tone: "plain", text: item[3] }, ...valued(item[4])];
      else tokens = valued(line);
    }
    return { tokens: tokens.filter((token) => token.text !== ""), problem: said.get(index + 1) ?? null };
  });
}

/** 값과 그 뒤 주석(` #`부터) — 따옴표 안의 `#`까지 가르지는 않는다(색만 다르다). */
function valued(rest: string): PaintedLine["tokens"] {
  const at = rest.search(/(^|\s)#/);
  if (at < 0) return [{ tone: "value", text: rest }];
  const cut = rest[at] === "#" ? at : at + 1;
  return [
    { tone: "value", text: rest.slice(0, cut) },
    { tone: "comment", text: rest.slice(cut) },
  ];
}

/** 파일 칸 머리 끝의 말 — 관계 편집은 고친 것이 있을 때만 「고친 줄 N · 저장 안 함」, 새 Space는 저장하기 전까지 「새 파일 · 아직 없음」. */
export function fileNote(mode: EditMode, changed: number): string | null {
  if (mode === "new") return "새 파일 · 아직 없음";
  return changed > 0 ? `고친 줄 ${changed} · 저장 안 함` : null;
}

/** 미리보기 칸 머리의 상태 알약 — 문제가 있으면 붉다(저장도 꺼진다). */
export function problemPill(problems: readonly SpaceProblem[]): { ok: boolean; text: string } {
  return problems.length === 0 ? { ok: true, text: "문제 없어요" } : { ok: false, text: `문제 ${problems.length}개` };
}

/**
 * 미리보기 카드가 그리는 것 — 그 글의 Space에서 **등록되지 않은 Project를 뺀** 것(그 줄은 편집기에 문제로 선다), 그 Project로 이어지는
 * 함께 쓰는 Space, 이름(비면 없다 — 카드는 「이름 없음」), 이름 아래 줄 「Project N · 함께 쓰는 Space N」.
 */
export function previewOf(draft: Pick<SpaceDraft, "space" | "shared">): {
  space: Space;
  shared: SharedSpace[];
  name: string | null;
  aside: string;
} {
  const unknown = new Set(draft.space.problems.flatMap((problem) => (problem.kind === "unknownProject" && problem.project ? [problem.project] : [])));
  const projects = draft.space.projects.filter((project) => !unknown.has(project));
  const shared = draft.shared.flatMap((other) => {
    const overlap = other.overlap.filter((project) => projects.includes(project));
    return overlap.length > 0 ? [{ ...other, overlap }] : [];
  });
  const name = draft.space.name.trim() || null;
  return {
    // 그래프의 Space 노드도 「이름 없음」이다 — 새 Space에는 부를 slug도 아직 없다.
    space: { ...draft.space, name: name ?? "이름 없음", projects },
    shared,
    name,
    aside: `Project ${projects.length} · 함께 쓰는 Space ${shared.length}`,
  };
}

/**
 * 편집기 아래 안내 줄 — 넣을 수 있는 Project(등록부 차례). 관계 편집은 뒤에 Host 길을, 새 Space는 앞에 파일 이름이 이름을 따라온다는 말
 * (겹치면 `-2`를 붙였다는 말)을 단다(시안 `.hint` · F4-KitSpace 「파일 이름 — 따라옴 · 겹침」).
 */
export function editHint(mode: EditMode, draft: Pick<SpaceDraft, "registered" | "suffix">): string {
  const projects =
    draft.registered.length > 0 ? `Project는 ${draft.registered.join(" · ")} 중에서` : "아직 등록된 Project가 없어요";
  if (mode === "edit") return `${projects} — Host에게 말로 부탁해도 이 파일이 바뀌어요`;
  const slug = draft.suffix
    ? `같은 이름의 Space가 있어 파일 이름에 ${draft.suffix}를 붙였어요`
    : "이름(name)을 적으면 파일 이름이 따라와요 — 만든 뒤엔 바뀌지 않아요";
  return `${slug} · ${projects}`;
}

/**
 * 새 Space의 빈 틀 — `name:` 빈 줄 · `projects:` 빈 목록 · `createdAt` 오늘 · 빈 본문. 칸 차례는 core 만들기(`create_space`)가 쓰는 것과
 * 같다. 날은 이 컴퓨터의 날이다(core도 그렇다).
 */
export function blankSpaceText(today: Date): string {
  const day = [today.getFullYear(), today.getMonth() + 1, today.getDate()].map((n, index) => String(n).padStart(index ? 2 : 4, "0"));
  return `---\nname: \nprojects: []\ncreatedAt: ${day.join("-")}\n---\n`;
}
