import { describe, expect, it } from "vitest";
import { folderOpen } from "./folds";

// 넓힌 카드 Project 트리의 폴더가 처음 서는 모양(SummarySheet 「넓힌 카드 — Project」 — 바뀐 파일이 보이게 그 위 폴더가 펼쳐져 있다).
describe("files 트리 폴더의 펼침", () => {
  const changed = ["src-tauri/src/watcher.rs", "src/features/works/WatcherBanner.tsx", "README.md"];

  it("기억이 없으면 바뀐 파일 위의 폴더만 펼쳐 서고 나머지는 접혀 선다", () => {
    const open = folderOpen({}, changed);
    expect(["src-tauri", "src-tauri/src", "src", "src/features", "src/features/works"].filter(open)).toHaveLength(5);
    expect(open("docs")).toBe(false);
    expect(open("src/lib")).toBe(false);
  });

  it("손으로 접거나 편 폴더는 그 기억대로다", () => {
    const open = folderOpen({ "src-tauri": false, docs: true }, changed);
    expect(open("src-tauri")).toBe(false);
    expect(open("docs")).toBe(true);
    expect(open("src-tauri/src")).toBe(true);
  });

  it("바뀐 파일이 없으면 모두 접혀 선다", () => {
    expect(folderOpen({}, [])("src")).toBe(false);
  });
});
