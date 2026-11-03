/**
 * **넓힌 카드 변경 보기의 줄**(restart 03-15b · 시안 Summary `.ra-vwdiff`) — `read_work_diff`의 patch(git이 낸 그 파일 하나의 unified diff)와
 * worktree의 지금 파일에서 그릴 줄을 짓는다. 한때 이 보기는 문법색을 칠하는 diff 부품(`@pierre/diffs`)이었다.
 *
 * - **줄**은 같은 줄 · 지운 줄 · 더한 줄이다. 줄번호는 하나다 — 지운 줄은 옛 번호, 더한 줄 · 같은 줄은 새 번호(시안 42 지움 · 42 더함 · 46 같음).
 * - **숨긴 줄**은 덩어리 밖의 같은 줄 묶음이다(시안 「숨긴 줄 N개」). 첫 덩어리 위 · 덩어리 사이의 수는 patch가 안다. 마지막 덩어리 아래의 수는
 *   지금 파일의 길이를 알아야 해서 파일이 있을 때만 선다. 펴면 설 줄은 지금 파일의 줄이다 — 덩어리 밖의 줄은 두 쪽이 같다.
 * - 지금 파일이 없거나(지운 파일 · 아직 못 읽음 · 글이 아님) **patch와 어긋나면**(patch를 읽은 뒤 다시 바뀌었다) 숨긴 줄은 수만 들고 펴지
 *   못한다(`lines`가 `null`). 틀린 줄을 펴느니 펴지 않는다 — 감시가 곧 새 patch와 파일을 가져온다.
 */

export interface DiffLine {
  kind: "same" | "add" | "del";
  number: number;
  text: string;
}

export type DiffRow =
  | ({ type: "line" } & DiffLine)
  /** `at`은 숨긴 첫 줄의 새 번호다 — 편 묶음을 가리키는 열쇠다. */
  | { type: "fold"; at: number; count: number; lines: DiffLine[] | null };

interface Hunk {
  /** 새 쪽에서 이 덩어리 앞에 선 줄 수. */
  before: number;
  /** 새 쪽 줄 수. */
  newCount: number;
  lines: DiffLine[];
}

const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** 줄을 가르는 것 — `\r\n` · `\r` · `\n`을 모두 줄바꿈으로 센다. 끝의 줄바꿈 뒤는 줄이 아니다. */
function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** patch의 덩어리들 — 머리(`diff --git` · `index` · `---` · `+++` · 모드 · 이름 바꿈)는 건너뛰고, 덩어리 몸은 머리의 줄 수만큼 읽는다. */
function hunksOf(patch: string): Hunk[] {
  const rows = patch.split("\n").map((row) => (row.endsWith("\r") ? row.slice(0, -1) : row));
  const hunks: Hunk[] = [];
  let at = 0;
  while (at < rows.length) {
    const head = HUNK_HEAD.exec(rows[at]);
    at += 1;
    if (!head) continue;
    const [oldStart, oldCount, newStart, newCount] = [head[1], head[2] ?? "1", head[3], head[4] ?? "1"].map(Number);
    const hunk: Hunk = { before: newCount === 0 ? newStart : newStart - 1, newCount, lines: [] };
    let [oldLeft, newLeft] = [oldCount, newCount];
    let [oldNumber, newNumber] = [oldCount === 0 ? oldStart + 1 : oldStart, hunk.before + 1];
    while (at < rows.length && (oldLeft > 0 || newLeft > 0)) {
      const row = rows[at];
      at += 1;
      // 「\ No newline at end of file」 — 줄이 아니다.
      if (row.startsWith("\\")) continue;
      const mark = row[0] ?? " ";
      const text = row.slice(1);
      if (mark === "-") {
        hunk.lines.push({ kind: "del", number: oldNumber, text });
        oldNumber += 1;
        oldLeft -= 1;
      } else if (mark === "+") {
        hunk.lines.push({ kind: "add", number: newNumber, text });
        newNumber += 1;
        newLeft -= 1;
      } else {
        hunk.lines.push({ kind: "same", number: newNumber, text });
        oldNumber += 1;
        newNumber += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
    }
    hunks.push(hunk);
  }
  return hunks;
}

/** 지금 파일이 patch의 새 쪽과 맞는가 — 덩어리마다 새 쪽 줄(같은 줄 · 더한 줄)이 그 자리의 파일 줄과 같아야 한다. */
function matches(file: readonly string[], hunks: readonly Hunk[]): boolean {
  return hunks.every((hunk) => {
    const shown = hunk.lines.filter((line) => line.kind !== "del");
    return shown.every((line, i) => file[hunk.before + i] === line.text) && hunk.before + hunk.newCount <= file.length;
  });
}

/** 새 번호 `from`부터 `count`줄을 숨긴 묶음 — 파일이 있으면 펼 줄을 든다. */
function fold(from: number, count: number, file: readonly string[] | null): DiffRow {
  const lines = file && file.slice(from - 1, from - 1 + count).map((text, i): DiffLine => ({ kind: "same", number: from + i, text }));
  return { type: "fold", at: from, count, lines };
}

/**
 * 그릴 줄. `current`는 worktree의 지금 파일 글이다 — 없으면(지운 파일 · 아직 못 읽음 · 글이 아님) `null`이다.
 */
export function diffRows(patch: string, current: string | null): DiffRow[] {
  const hunks = hunksOf(patch);
  const lines = current === null ? null : linesOf(current);
  const file = lines !== null && matches(lines, hunks) ? lines : null;
  const rows: DiffRow[] = [];
  let shown = 0;
  for (const hunk of hunks) {
    if (hunk.before > shown) rows.push(fold(shown + 1, hunk.before - shown, file));
    rows.push(...hunk.lines.map((line): DiffRow => ({ type: "line", ...line })));
    shown = hunk.before + hunk.newCount;
  }
  if (file !== null && hunks.length > 0 && file.length > shown) rows.push(fold(shown + 1, file.length - shown, file));
  return rows;
}
