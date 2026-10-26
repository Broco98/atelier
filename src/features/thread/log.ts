import type { Entry, ToolEntry, Turn } from "./fold";
import { describeTool, type ToolGlyph, type ToolView } from "./tool-view";

export { elapsed } from "./tool-view";

// 작업 로그의 줄 묶기(v1 티켓 05 · 캔버스 WorkLog 보드 「묶음 줄」)와 바뀐 파일 알약의 셈(Composer · Cards 보드) — 접은 턴의 도구 줄을
// 그릴 줄로 옮기는 **순수 함수**다.
//
// - **읽기와 찾기가 이어지면 한 줄로 묶는다**(「파일 4개 살펴봄 · 검색 2번」). 고치기와 명령은 묶지 않는다 — 결과가 바뀌는 일이라 줄마다
//   보여야 한다. 도는 줄은 묶지 않는다(하는 중인 일은 제 줄에서 반짝인다). 하나뿐인 읽기 · 찾기도 제 줄이다. 판정이 묻지 않고 허용한
//   줄도 묶지 않는다 — 그 앞에 방패 줄(「자동으로 허용함」)이 서야 한다(v1 티켓 23).
// - **바뀐 파일은 마지막 턴의 편집 도구가 낸 diff에서 센다.** Thread Session에는 three-axes의 고친 곳(`changes`) 줄이 없다 — 엔진이 턴
//   앞뒤로 폴더를 견주지 않는다. 끝난(`completed`) 편집만 센다: 실패한 편집은 파일을 바꾸지 않았다.

/** 작업 로그의 한 줄 — 도구 줄 하나, 또는 이어진 읽기 · 찾기 묶음. */
export type LogRow = { kind: "tool"; key: string; tool: ToolEntry; view: ToolView } | LogGroup;

export interface LogGroup {
  kind: "group";
  key: string;
  /** 「파일 N개 살펴봄 · 검색 M번」. */
  label: string;
  /** 줄 앞의 종류 글리프 — 파일을 읽었으면 읽기, 찾기만이면 검색이다. */
  glyph: Extract<ToolGlyph, "read" | "search">;
  tools: { tool: ToolEntry; view: ToolView }[];
}

/** 도구 줄들을 작업 로그의 줄로 — 끝난 읽기 · 찾기가 둘 이상 이어지면 묶는다. 도구가 아닌 줄은 받지 않는다(그리는 쪽이 가른다). */
export function logRows(tools: readonly ToolEntry[]): LogRow[] {
  const rows: LogRow[] = [];
  let run: { tool: ToolEntry; view: ToolView }[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const glyph = run.some(({ view }) => view.group === "read") ? "read" : "search";
      rows.push({ kind: "group", key: `g${run[0].tool.key}`, label: groupLabel(run), glyph, tools: run });
    }
    else for (const one of run) rows.push({ kind: "tool", key: one.tool.key, ...one });
    run = [];
  };
  for (const tool of tools) {
    const view = describeTool(tool);
    const groupable = view.group !== null && view.state === "done" && tool.stop === null && !tool.denied && tool.allowed === null;
    if (groupable) {
      run.push({ tool, view });
      continue;
    }
    flush();
    rows.push({ kind: "tool", key: tool.key, tool, view });
  }
  flush();
  return rows;
}

function groupLabel(run: readonly { tool: ToolEntry; view: ToolView }[]): string {
  const files = new Set<string>();
  let searches = 0;
  for (const { tool, view } of run) {
    if (view.group === "search") searches += 1;
    else files.add(fileKey(tool) ?? tool.key);
  }
  if (files.size === 0) return `검색 ${searches}번 함`;
  return searches > 0 ? `파일 ${files.size}개 살펴봄 · 검색 ${searches}번` : `파일 ${files.size}개 살펴봄`;
}

/** 읽은 파일의 열쇠 — 같은 파일을 두 번 읽어도 한 파일이다. 경로를 모르면 제목이다. */
function fileKey(tool: ToolEntry): string | null {
  const locations = Array.isArray(tool.call.locations) ? tool.call.locations : [];
  const first = locations.find(
    (location): location is { path: string } =>
      typeof location === "object" && location !== null && typeof (location as { path?: unknown }).path === "string",
  );
  return first?.path ?? (typeof tool.call.title === "string" ? tool.call.title : null);
}

/** 바뀐 파일 하나 — 경로와 더한 · 지운 줄 수. */
export interface ChangedFile {
  path: string;
  added: number;
  deleted: number;
}

/** 바뀐 파일 알약의 셈 — 파일들(처음 고친 차례)과 합. */
export interface Changes {
  files: ChangedFile[];
  added: number;
  deleted: number;
}

/** 그 턴의 끝난 편집이 바꾼 파일들 — 같은 파일은 한 줄로 더한다. 바꾼 것이 없으면 null이다. */
export function changedFiles(turn: Pick<Turn, "entries">): Changes | null {
  const byPath = new Map<string, ChangedFile>();
  for (const entry of turn.entries) {
    if (!isTool(entry) || entry.call.status !== "completed") continue;
    for (const piece of describeTool(entry).diffs) {
      const file = byPath.get(piece.path) ?? { path: piece.path, added: 0, deleted: 0 };
      file.added += piece.added;
      file.deleted += piece.deleted;
      byPath.set(piece.path, file);
    }
  }
  if (byPath.size === 0) return null;
  const files = [...byPath.values()];
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    deleted: files.reduce((sum, file) => sum + file.deleted, 0),
  };
}

const isTool = (entry: Entry): entry is ToolEntry => entry.kind === "tool";
