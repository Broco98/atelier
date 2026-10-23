import { readStored, writeStored } from "@/lib/stored";
import type { ChangedFile, ProjectChanges, ProjectPr, SpecTree, SpecTreeItem, WorkView } from "@/features/works/types";
import { particle } from "./fold";
import type { DocWriting } from "./types";

// **Work 카드의 칸을 짓는 순수 함수**(v1 티켓 34 · 구현 스펙 §15 · 캔버스 WorkPanel · Screen-Review 보드). 카드(`WorkCard.tsx`)는 이것이
// 지은 줄을 그리기만 한다. 칸은 문서 · 변경 · Project · PR 차례이고, **비어 있는 칸은 그리지 않는다** — 짓는 함수가 칸이 없음을
// `null` · 빈 목록으로 말한다.

/** 변경 칸의 Project 하나 — 그 Project의 +/− 합계와 바뀐 파일들(코어 차례 — 늦게 고친 것이 앞). */
export interface ChangeGroup {
  project: string;
  additions: number;
  deletions: number;
  files: ChangedFile[];
}

/** 변경 칸 — Work 합계와 Project 묶음들. */
export interface ChangeSummary {
  additions: number;
  deletions: number;
  groups: ChangeGroup[];
}

/**
 * 변경 칸(스토리 109 · 보드 「Project가 셋」) — 바뀐 파일이 있는 Project만 묶는다. 읽기만 하는 Project(`worktreeMissing`)와 견주지
 * 못한 Project(`baseUnknown` · `unreadable`)는 변경이 없는 것과 같이 빠진다. 바뀐 파일이 하나도 없으면 칸이 없다(`null`).
 *
 * 합계는 화면이 더한다(v1 티켓 33) — **셀 수 없는 파일(`null` — 바이너리 · 너무 큰 새 파일)은 0으로 세지 않고 뺀다.**
 */
export function changeSummary(changes: readonly ProjectChanges[]): ChangeSummary | null {
  const groups: ChangeGroup[] = [];
  for (const one of changes) {
    if (one.kind !== "listed" || one.files.length === 0) continue;
    groups.push({ project: one.project, additions: sum(one.files, "additions"), deletions: sum(one.files, "deletions"), files: one.files });
  }
  if (groups.length === 0) return null;
  return {
    additions: groups.reduce((total, group) => total + group.additions, 0),
    deletions: groups.reduce((total, group) => total + group.deletions, 0),
    groups,
  };
}

const sum = (files: readonly ChangedFile[], side: "additions" | "deletions") =>
  files.reduce((total, file) => total + (file[side] ?? 0), 0);

/** 바뀐 파일의 열쇠 — Project와 경로. */
export const fileKey = (project: string, path: string) => `${project}\u0000${path}`;

/**
 * 새로 바뀐 파일(스토리 109 「새로 바뀐 파일이 … 잠깐 빛나기를」 · 보드 「Host가 코드를 고치는 중」) — 앞 답에 없던 파일과 +/−가 바뀐
 * 파일이다. 「맨 위로」는 코어의 차례 그대로라(늦게 고친 것이 앞) 여기서 고르지 않는다. **처음 읽은 답은 빛나지 않는다**(`before`가
 * 없다) — 카드를 열 때마다 모든 줄이 빛나면 무엇이 새로 바뀌었는지가 사라진다.
 */
export function freshFiles(before: readonly ProjectChanges[] | undefined, after: readonly ProjectChanges[]): Set<string> {
  const fresh = new Set<string>();
  if (!before) return fresh;
  const seen = new Map<string, ChangedFile>();
  for (const one of before) {
    if (one.kind === "listed") for (const file of one.files) seen.set(fileKey(one.project, file.path), file);
  }
  for (const one of after) {
    if (one.kind !== "listed") continue;
    for (const file of one.files) {
      const key = fileKey(one.project, file.path);
      const was = seen.get(key);
      if (!was || was.additions !== file.additions || was.deletions !== file.deletions) fresh.add(key);
    }
  }
  return fresh;
}

/** 문서 칸의 줄 하나 — spec 기준 경로와, 지금 그 문서를 쓰는 Agent(없으면 `null`). */
export interface DocRow {
  path: string;
  writer: DocWriting | null;
}

/**
 * 문서 칸(스토리 108 · 보드 「Host가 문서를 쓰는 중」) — Work의 spec 트리의 파일을 **트리 차례로** 편다(앱에는 차례의 규칙이 없다 —
 * 레이아웃이 정한 차례다). 쓰는 중인 문서에는 그 Agent가 붙는다. 아직 트리에 없는 문서(방금 쓰기 시작한 새 파일 — spec 트리는
 * `works:changed`로 따라온다)도 쓰는 중이면 끝에 선다.
 */
export function docRows(tree: SpecTree, writing: readonly DocWriting[]): DocRow[] {
  const writerOf = (path: string) => writing.find((one) => one.path === path) ?? null;
  const rows: DocRow[] = filesOf(tree.items).map((path) => ({ path, writer: writerOf(path) }));
  for (const one of writing) {
    if (!rows.some((row) => row.path === one.path)) rows.push({ path: one.path, writer: one });
  }
  return rows;
}

function filesOf(items: readonly SpecTreeItem[]): string[] {
  return items.flatMap((item) => (item.kind === "file" ? [item.path] : filesOf(item.children)));
}

/** 쓰는 중 문구(보드 「Host가 쓰는 중」) — 이름의 받침에 맞는 조사를 단다. */
export const writerLine = (name: string) => `${name}${particle(name, "이", "가")} 쓰는 중`;

/** Project 칸의 줄 하나 — 고치는 중(worktree가 섰다)인가, 읽기만인가. */
export interface ProjectRow {
  project: string;
  editing: boolean;
}

/**
 * Project 칸(스토리 110) — Work의 Project 차례대로, worktree가 선 Project는 「고치는 중」, 없는 Project는 「읽기만」이다(S21 — worktree는
 * 처음 고칠 때 선다).
 */
export function projectRows(work: Pick<WorkView, "projects" | "worktrees">): ProjectRow[] {
  return work.projects.map((project) => ({
    project,
    editing: work.worktrees.some((tree) => tree.project === project && tree.exists),
  }));
}

/** PR 줄 하나. `checking`이면 문장이 천천히 빛난다(보드 「확인하는 동안 글자만 천천히 빛납니다」). */
export interface PrRow {
  project: string;
  number: number;
  url: string;
  status: string;
  checking: boolean;
}

/**
 * PR 줄(보드 「PR」 · 스토리 125) — 찾은 PR마다 한 줄이다. 없거나(`absent` — PR이 없다 · `gh`가 없다) 못 읽은(`unreadable`) Project는
 * 줄이 없다(S24). 상태는 **색 없이 문장**이다. 승인 수 · 실패한 검사의 문장 · 병합 시각 · 60초마다 다시 읽기는 v1 티켓 36이 더한다.
 */
export function prRows(prs: readonly ProjectPr[]): PrRow[] {
  return prs.flatMap((pr) => {
    if (pr.kind !== "found") return [];
    const checking = pr.state === "open" && pr.ci.kind === "pending";
    return [{ project: pr.project, number: pr.number, url: pr.url, status: prStatus(pr), checking }];
  });
}

function prStatus(pr: Extract<ProjectPr, { kind: "found" }>): string {
  if (pr.state === "merged") return "병합됨";
  if (pr.state === "closed") return "닫힘";
  switch (pr.ci.kind) {
    case "pending":
      return "CI 확인 중";
    case "passing":
      return "CI 통과";
    case "failing":
      return "CI 실패";
    case "noChecks":
      return "열림";
  }
}

/** 카드 열림을 적는 열쇠 — Work마다 하나다(S32). */
const openKey = (slug: string) => `work-card-open:${slug}`;

/**
 * 카드가 열려 있나(S32 — 열고 닫은 상태는 Work마다 이 컴퓨터의 로컬 저장에 둔다). **적은 적이 없거나 읽지 못하면 열린 것이다** — 처음
 * Work에 이은 Thread에서는 카드가 떠 있다(보드 「평소」).
 */
export function readCardOpen(slug: string): boolean {
  return readStored(openKey(slug)) !== "closed";
}

/** 카드 열림을 적는다. 적지 못하면 이번 실행 동안만 기억한다(부르는 쪽의 상태). */
export function writeCardOpen(slug: string, open: boolean): void {
  writeStored(openKey(slug), open ? "open" : "closed");
}
