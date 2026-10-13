import { Store } from "@tanstack/react-store";
import { isObject } from "./json";

// 고친 곳(three-axes 티켓 26) — 턴이 끝난 뒤 스펙 창 · 트리 · 레일 · 알약에 서는 표시. **비교는 호스트, 표시는 화면이다**(구현 스펙
// 「고친 곳」): 호스트가 턴 앞뒤로 spec 폴더를 찍어 견준 것을 `changes` 기록 줄로 적고(`turn-end` 바로 앞, three-axes 결정 22), 화면은
// 그 줄을 읽기만 한다. 이 모듈이 그 줄을 좁히고, work마다의 표시를 쥔다.
//
// **표시는 work의 것이다(S19).** 대화마다가 아니라 work마다 하나다 — 그 work의 어느 대화에서든 사람이 다음 말을 보내면 지운다.
// 두 대화가 함께 돌며 고쳤으면 두 `changes` 줄이 모두 이 표시에 든다(스토리 74). **메모리에만 둔다** — 앱을 다시 켜면 없고, 처음
// 그릴 때 읽은 기록의 `changes`(지난 턴들)로는 세우지 않는다. 표시를 세우는 것은 기록 줄 이벤트로 온 `changes`뿐이다.
//
// 지우는 때가 둘로 갈린다(three-axes 결정 22 · 프로토타입 D):
// - **문단의 표시**(`files`) — 사람이 다음 말을 보내면.
// - **트리 · 레일의 점**(`unseen`) — 그 파일을 열면. 다음 말을 보내도 남는다: 아직 안 본 변경이라는 뜻이 그대로라서다.

/** 원문의 줄 범위 — 1부터 센다, 끝 줄을 품는다. */
export interface LineRange {
  start: number;
  end: number;
}

/** 바뀜 종류 — 새 문서 · 고침 · 지움. 기록의 글자 그대로다(`atelier_acp`의 `changes` 줄). */
export type ChangeKind = "created" | "modified" | "deleted";

/** 고친 파일 하나. */
export interface ChangedFile {
  /** spec 폴더 기준 경로(`/`로 잇는다). */
  path: string;
  change: ChangeKind;
  /**
   * md · 텍스트 파일이면 **새 글 기준**의 바뀐 줄 범위. 새 문서는 전체 범위 하나다. 지우기만 한 자리는 새 글에 줄이 없어 범위가
   * 없고(`[]`), 내용을 찍지 못한 파일(1MB 초과 · 그 밖의 파일)은 범위 자체를 모른다(`null`).
   */
  lines: readonly LineRange[] | null;
}

const KINDS: readonly string[] = ["created", "modified", "deleted"] satisfies ChangeKind[];

/** `changes` 줄의 payload를 좁힌다 — 모르는 모양의 파일은 버리고 나머지는 산다(기록은 원문 그대로라 칸이 늘 수 있다). */
export function changedFiles(payload: unknown): ChangedFile[] {
  const files = isObject(payload) && Array.isArray(payload.files) ? payload.files : [];
  return files.flatMap((file): ChangedFile[] => {
    if (!isObject(file) || typeof file.path !== "string" || !KINDS.includes(file.change as string)) return [];
    const lines = Array.isArray(file.lines)
      ? file.lines.filter(
          (range): range is LineRange =>
            isObject(range) && typeof range.start === "number" && typeof range.end === "number",
        )
      : null;
    return [{ path: file.path, change: file.change as ChangeKind, lines }];
  });
}

/**
 * 그 파일을 열 때 가 닿을 자리 — **첫 고친 줄**(스토리 72). 범위를 모르거나(그 밖의 파일 · 1MB 초과) 지우기만 했으면 `null`이다 —
 * 그때는 파일만 연다.
 */
export function firstChangedLine(file: ChangedFile): number | null {
  if (!file.lines || file.lines.length === 0) return null;
  return Math.min(...file.lines.map((range) => range.start));
}

/** 블록의 원문 줄 범위가 바뀐 범위 중 하나에 걸리는가. */
export const overlaps = (ranges: readonly LineRange[], start: number, end: number) =>
  ranges.some((range) => range.start <= end && start <= range.end);

/** work 하나의 표시. */
export interface WorkMarks {
  /** 문단의 표시 — 파일마다 바뀐 줄 범위. 범위를 모르는 파일은 `null`이고 문단을 칠하지 않는다. */
  files: Readonly<Record<string, readonly LineRange[] | null>>;
  /** 아직 열지 않은 고친 파일 — 트리와 레일 `spec` 칸의 점. 지운 파일은 들지 않는다(열 것이 없다). */
  unseen: readonly string[];
}

interface MarksState {
  byWork: Readonly<Record<string, WorkMarks>>;
}

export const changeMarksStore = new Store<MarksState>({ byWork: {} });

const NO_MARKS: WorkMarks = { files: {}, unseen: [] };

/** 그 work의 표시 — 없으면 빈 표시(늘 같은 값이라 셀렉터가 다시 그리지 않는다). */
export const marksOf = (state: MarksState, work: string): WorkMarks => state.byWork[work] ?? NO_MARKS;

function setMarks(work: string, next: (marks: WorkMarks) => WorkMarks): void {
  changeMarksStore.setState((state) => {
    const have = marksOf(state, work);
    const marks = next(have);
    return marks === have ? state : { byWork: { ...state.byWork, [work]: marks } };
  });
}

/**
 * `changes` 줄이 왔다 — 그 파일들에 표시를 세운다. 이미 표시가 선 파일이면 범위를 합친다: 함께 돈 두 대화가 같은 파일을 적었거나,
 * 다음 말 전에 턴 밖 턴이 또 고쳤을 때다.
 */
export function applyChanges(work: string, files: readonly ChangedFile[]): void {
  if (files.length === 0) return;
  setMarks(work, (marks) => {
    const next: Record<string, readonly LineRange[] | null> = { ...marks.files };
    const unseen = new Set(marks.unseen);
    for (const file of files) {
      if (file.change === "deleted") {
        delete next[file.path];
        unseen.delete(file.path);
        continue;
      }
      const had = next[file.path];
      next[file.path] = had && file.lines ? [...had, ...file.lines] : (had ?? file.lines);
      unseen.add(file.path);
    }
    return { files: next, unseen: [...unseen] };
  });
}

/** 사람이 다음 말을 보냈다 — 그 work의 문단 표시를 지운다(S19). 트리 · 레일의 점은 남는다(머리말). */
export function clearChangeMarks(work: string): void {
  setMarks(work, (marks) => (Object.keys(marks.files).length === 0 ? marks : { ...marks, files: {} }));
}

/** 그 파일을 열었다 — 트리 · 레일의 점을 지운다. */
export function markOpened(work: string, path: string): void {
  setMarks(work, (marks) =>
    marks.unseen.includes(path) ? { ...marks, unseen: marks.unseen.filter((one) => one !== path) } : marks,
  );
}
