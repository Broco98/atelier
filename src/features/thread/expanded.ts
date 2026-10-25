import type { Entry, ToolEntry, Turn } from "./fold";
import { describeTool, lineDiff, splitLines } from "./tool-view";

// **넓힌 카드**(v1 티켓 35 · 구현 스펙 §15 배치 1 · 캔버스 Layout-Expand · Messages · Motion 보드)의 순수 함수 — 요약 카드에서 문서 · 변경 ·
// Project 줄을 누르면 카드가 넓어져 왼쪽에 카드의 칸들(목록), 오른쪽에 그 파일의 보기가 선다. **한 번에 파일 하나만 본다**(§15 —
// 배치 2 · 3은 짓지 않는다). 그리는 쪽은 `SummaryCard.tsx`(목록 · 고른 줄) · `ExpandedViewer.tsx`(보기) · `ThreadFlow.tsx`(대화 속 문서
// 카드)다.

/**
 * 넓힌 카드가 연 것 — 문서(spec 기준 경로) · 변경(Project · worktree 기준 경로 — `read_work_diff`의 인자 그대로, v1 티켓 33) · Project(그
 * 파일 트리와, 트리에서 연 파일 — 아직 고르지 않았으면 `null`).
 */
export type Opened =
  | { kind: "doc"; path: string }
  | { kind: "change"; project: string; path: string }
  | { kind: "project"; project: string; file: string | null };

/** 카드의 줄 하나가 가리키는 것 — Project 줄은 그 Project 하나다(트리에서 어느 파일을 열었든 같은 줄이다). */
export type RowTarget =
  | { kind: "doc"; path: string }
  | { kind: "change"; project: string; path: string }
  | { kind: "project"; project: string };

/** 그 줄이 지금 넓힌 카드가 연 것인가 — 그 줄이 고른 면(`selected-row`)으로 선다(보드 `.wr.on`). */
export function isOpened(opened: Opened | null, row: RowTarget): boolean {
  if (opened === null || opened.kind !== row.kind) return false;
  switch (row.kind) {
    case "doc":
      return opened.kind === "doc" && opened.path === row.path;
    case "change":
      return opened.kind === "change" && opened.project === row.project && opened.path === row.path;
    case "project":
      return opened.kind === "project" && opened.project === row.project;
  }
}

/**
 * 보기의 경로 줄(`PathBar`의 조각) — 보드 `.vh .path`의 앞머리를 따른다: 문서는 「문서 / design.md」, 변경은 「api-server / src/refunds /
 * refund.service.ts」, Project는 「Project / api-server」이고 트리에서 파일을 열면 그 파일의 경로다.
 */
export function viewerPath(opened: Opened): string[] {
  switch (opened.kind) {
    case "doc":
      return ["문서", ...opened.path.split("/")];
    case "change":
      return [opened.project, ...opened.path.split("/")];
    case "project":
      return opened.file === null ? ["Project", opened.project] : [opened.project, ...opened.file.split("/")];
  }
}

/**
 * 다시 읽은 문서에서 칠할 줄(스토리 118 · Motion 보드 「문서 실시간 편집」 — 「Host가 문서를 고치면 바뀐 줄만 잠깐 칠해집니다」) — 새 글에서
 * 더하거나 고친 줄의 번호(1부터)다. 지우기만 한 자리는 칠할 줄이 없다. **처음 읽은 글(`before`가 없다)은 칠하지 않는다** — 문서를 열
 * 때마다 온 글이 빛나면 무엇이 바뀌었는지가 사라진다(요약 카드의 새로 바뀐 파일과 같은 규칙 — `summary-card.ts`의 `freshFiles`).
 */
export function freshLines(before: string | undefined, after: string): number[] {
  if (before === undefined || before === after) return [];
  const fresh: number[] = [];
  let line = 0;
  for (const change of lineDiff(splitLines(before), splitLines(after))) {
    if (change.type === "del") continue;
    line += 1;
    if (change.type === "add") fresh.push(line);
  }
  return fresh;
}

/** 대화 속 문서 카드 하나 — spec 기준 경로 · 줄 수 · 쓴 Agent. */
export interface CreatedDoc {
  path: string;
  lines: number;
  who: string | null;
}

/**
 * 대화 속 문서 카드(스토리 102 · Messages 보드 「파일과 첨부 — Agent가 만든 파일」 · 「Host가 만듦 · 32줄」) — 그 턴의 **끝난** 편집 가운데
 * 이은 Work의 spec 폴더(`specRoot` — 절대 경로)에 **새로 쓴** 문서다. 새로 썼는지는 옛 글이 없는 diff로 안다(Claude `Write` — `tool-view.ts`의
 * `written`). 옛 글이 있는 고치기는 카드가 아니다 — 바뀐 파일 알약 · 요약 카드의 「변경 사항」이 든다. 같은 문서를 두 번 쓰면 한 장이고 줄 수는
 * 마지막 글의 것이다. spec 폴더를 모르면(Work 없는 Thread) 카드가 없다.
 */
export function createdDocs(turn: Pick<Turn, "entries" | "who">, specRoot: string | null): CreatedDoc[] {
  if (specRoot === null) return [];
  const root = `${specRoot.replace(/\/+$/, "")}/`;
  const byPath = new Map<string, CreatedDoc>();
  for (const entry of turn.entries) {
    if (!isTool(entry) || entry.call.status !== "completed") continue;
    for (const piece of describeTool(entry).diffs) {
      if (!piece.written || !piece.path.startsWith(root) || piece.path.length === root.length) continue;
      const path = piece.path.slice(root.length);
      byPath.delete(path);
      byPath.set(path, { path, lines: piece.added, who: turn.who });
    }
  }
  return [...byPath.values()];
}

const isTool = (entry: Entry): entry is ToolEntry => entry.kind === "tool";
