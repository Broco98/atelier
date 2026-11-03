import { describe, expect, it } from "vitest";
import { diffRows } from "./wide-diff";

// 넓힌 카드의 변경 보기(restart 03-15b · 시안 Summary `.ra-vwdiff`)가 그릴 줄 — `read_work_diff`의 patch와 worktree의 지금 파일에서 짓는다.
// 시안의 줄 목록은 「숨긴 줄 40개」 · 바뀐 줄 · 「숨긴 줄 86개」이고, 지운 줄은 옛 줄번호 · 더한 줄과 같은 줄은 새 줄번호다(시안 42 지움 · 42 더함 · 46 같음).

/** 시안의 watcher.rs — 132줄이고 41–46줄이 덩어리다. 나머지 줄은 `// n`이다. */
const NEW_HUNK = [
  "    watcher.watch(path, RecursiveMode::Recursive)?;",
  "    if let Err(e) = rx.recv() {",
  '        app.emit("watcher:failed", WatcherFailure::from(e))?;',
  "        return retry.next();",
  "    }",
  "    Ok(())",
];
const WATCHER = Array.from({ length: 132 }, (_, i) => (i + 1 >= 41 && i + 1 <= 46 ? NEW_HUNK[i - 40] : `// ${i + 1}`)).join("\n") + "\n";
const WATCHER_PATCH = [
  "diff --git a/src-tauri/src/watcher.rs b/src-tauri/src/watcher.rs",
  "index 1111111..2222222 100644",
  "--- a/src-tauri/src/watcher.rs",
  "+++ b/src-tauri/src/watcher.rs",
  "@@ -41,3 +41,6 @@ pub fn start(app: &AppHandle, path: &Path) -> Result<()> {",
  "     watcher.watch(path, RecursiveMode::Recursive)?;",
  '-    if let Err(e) = rx.recv() { log::warn!("{e}"); }',
  "+    if let Err(e) = rx.recv() {",
  '+        app.emit("watcher:failed", WatcherFailure::from(e))?;',
  "+        return retry.next();",
  "+    }",
  "     Ok(())",
  "",
].join("\n");

const lines = (rows: ReturnType<typeof diffRows>) => rows.filter((row) => row.type === "line");
const folds = (rows: ReturnType<typeof diffRows>) => rows.flatMap((row) => (row.type === "fold" ? [row] : []));

describe("넓힌 카드 변경 보기의 줄", () => {
  it("시안처럼 숨긴 위 줄 · 바뀐 줄 · 숨긴 아래 줄이다 — 지운 줄은 옛 번호, 더한 줄 · 같은 줄은 새 번호", () => {
    const rows = diffRows(WATCHER_PATCH, WATCHER);
    expect(rows.map((row) => (row.type === "fold" ? `숨김 ${row.count}` : `${row.kind} ${row.number}`))).toEqual([
      "숨김 40",
      "same 41",
      "del 42",
      "add 42",
      "add 43",
      "add 44",
      "add 45",
      "same 46",
      "숨김 86",
    ]);
    expect(lines(rows).map((row) => row.type === "line" && row.text)).toEqual([
      "    watcher.watch(path, RecursiveMode::Recursive)?;",
      '    if let Err(e) = rx.recv() { log::warn!("{e}"); }',
      "    if let Err(e) = rx.recv() {",
      '        app.emit("watcher:failed", WatcherFailure::from(e))?;',
      "        return retry.next();",
      "    }",
      "    Ok(())",
    ]);
  });

  it("숨긴 줄은 펴면 설 지금 파일의 줄을 든다 — 같은 줄이고 새 번호다", () => {
    const [top, bottom] = folds(diffRows(WATCHER_PATCH, WATCHER));
    expect(top.at).toBe(1);
    expect(top.lines).toHaveLength(40);
    expect(top.lines?.[0]).toEqual({ kind: "same", number: 1, text: "// 1" });
    expect(top.lines?.[39]).toEqual({ kind: "same", number: 40, text: "// 40" });
    expect(bottom.at).toBe(47);
    expect(bottom.lines).toHaveLength(86);
    expect(bottom.lines?.[0]).toEqual({ kind: "same", number: 47, text: "// 47" });
    expect(bottom.lines?.[85]).toEqual({ kind: "same", number: 132, text: "// 132" });
  });

  it("지금 파일을 아직 못 읽었으면 위 숨긴 줄은 수만 들고 펴지 못하며, 아래 숨긴 줄은 길이를 몰라 서지 않는다", () => {
    const rows = diffRows(WATCHER_PATCH, null);
    expect(folds(rows)).toEqual([{ type: "fold", at: 1, count: 40, lines: null }]);
    expect(rows[rows.length - 1]).toEqual({ type: "line", kind: "same", number: 46, text: "    Ok(())" });
  });

  it("지금 파일이 patch와 어긋나면(그 뒤에 다시 바뀌었다) 못 읽은 것과 같다 — 틀린 줄을 펴지 않는다", () => {
    const moved = WATCHER.replace("        return retry.next();", "        return retry.later();");
    expect(folds(diffRows(WATCHER_PATCH, moved))).toEqual([{ type: "fold", at: 1, count: 40, lines: null }]);
  });

  it("덩어리 사이의 숨긴 줄은 patch가 아는 수다 — 지우기만 한 덩어리는 머리의 새 번호가 그 앞 줄이다", () => {
    const file = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n") + "\n";
    const patch = [
      "--- a/x.txt",
      "+++ b/x.txt",
      "@@ -1,2 +1,2 @@",
      "-A",
      "+a",
      " b",
      "@@ -6,2 +5,0 @@",
      "-gone",
      "-gone too",
      "@@ -9 +7 @@",
      "-G",
      "+g",
      "",
    ].join("\n");
    const rows = diffRows(patch, file);
    expect(rows.map((row) => (row.type === "fold" ? `숨김 ${row.at}+${row.count}` : `${row.kind} ${row.number}`))).toEqual([
      "del 1",
      "add 1",
      "same 2",
      "숨김 3+3",
      "del 6",
      "del 7",
      "숨김 6+1",
      "del 9",
      "add 7",
      "숨김 8+3",
    ]);
    expect(folds(rows).map((one) => one.lines?.map((line) => line.text))).toEqual([["c", "d", "e"], ["f"], ["h", "i", "j"]]);
  });

  it("새 파일은 더한 줄뿐이고 지운 파일은 지운 줄뿐이다 — 숨긴 줄이 없다", () => {
    const added = ["--- /dev/null", "+++ b/new.ts", "@@ -0,0 +1,2 @@", "+one", "+two", ""].join("\n");
    expect(diffRows(added, "one\ntwo\n")).toEqual([
      { type: "line", kind: "add", number: 1, text: "one" },
      { type: "line", kind: "add", number: 2, text: "two" },
    ]);
    const removed = ["--- a/old.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-one", "-two", ""].join("\n");
    expect(diffRows(removed, null)).toEqual([
      { type: "line", kind: "del", number: 1, text: "one" },
      { type: "line", kind: "del", number: 2, text: "two" },
    ]);
  });

  it("「\\ No newline at end of file」은 줄이 아니고, CRLF 줄의 끝 \\r은 글이 아니며, 빈 같은 줄도 줄이다", () => {
    const patch = ["@@ -1,3 +1,3 @@\r", " top\r", " \r", "-end\r", "\\ No newline at end of file\r", "+end!\r", "\\ No newline at end of file\r", ""].join(
      "\n",
    );
    expect(diffRows(patch, "top\r\n\r\nend!")).toEqual([
      { type: "line", kind: "same", number: 1, text: "top" },
      { type: "line", kind: "same", number: 2, text: "" },
      { type: "line", kind: "del", number: 3, text: "end" },
      { type: "line", kind: "add", number: 3, text: "end!" },
    ]);
  });

  it("덩어리가 없는 patch(모드만 바뀜)는 줄이 없다", () => {
    expect(diffRows("diff --git a/x b/x\nold mode 100644\nnew mode 100755\n", "x\n")).toEqual([]);
  });
});
