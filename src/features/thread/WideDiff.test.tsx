import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiffLines } from "./WideDiff";
import type { DiffRow } from "./wide-diff";

// 넓힌 카드의 변경 보기 몸(restart 03-15b · 시안 Summary `.ra-vwdiff` · `.ra-ln` · `.ra-vwfold`) — 받은 줄을 그대로 그리는 조각이라 정적 마크업으로
// 잰다. 자리 · 색은 시안 비교가, 숨긴 줄을 눌러 펴는 것은 L3(`thread-work-card.spec.ts`)가 본다.

const none = () => {};
const text = (markup = "") => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** 시안 watcher.rs의 줄 — 위 숨긴 줄 40개(펼 줄 둘만 실었다), 바뀐 줄, 아래 숨긴 줄 86개(못 편다). */
const ROWS: DiffRow[] = [
  {
    type: "fold",
    at: 1,
    count: 40,
    lines: [
      { kind: "same", number: 1, text: "use notify::RecursiveMode;" },
      { kind: "same", number: 2, text: "" },
    ],
  },
  { type: "line", kind: "same", number: 41, text: "    watcher.watch(path, RecursiveMode::Recursive)?;" },
  { type: "line", kind: "del", number: 42, text: '    if let Err(e) = rx.recv() { log::warn!("{e}"); }' },
  { type: "line", kind: "add", number: 42, text: "    if let Err(e) = rx.recv() {" },
  { type: "line", kind: "same", number: 46, text: "    Ok(())" },
  { type: "fold", at: 47, count: 86, lines: null },
];

const rowsOf = (markup: string) => markup.match(/<(div|ins|del) class="grid[^"]*"[\s\S]*?<\/\1>/g) ?? [];
const folds = (markup: string) => markup.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];

describe("넓힌 카드 변경 보기의 몸", () => {
  it("줄 목록은 고정폭 12 / 21.6이고 문법색을 칠하지 않는다 — 글은 한 줄로 서고 탭은 4칸이다", () => {
    const markup = renderToStaticMarkup(<DiffLines rows={ROWS} open={new Set()} onUnfold={none} />);
    expect(markup).toMatch(/<div class="[^"]*\bfont-mono text-xs leading-\[21\.6px\] tracking-normal\b/);
    expect(markup).toContain("[tab-size:4]");
    expect(markup).not.toMatch(/syntax|data-code-view|diffs-container|color:/);
  });

  it("몸이 구르는 상자이고, 목록은 가장 긴 줄(막대 · 번호 44 뒤)만큼 넓어 옆으로 구른다", () => {
    const markup = renderToStaticMarkup(<DiffLines rows={ROWS} open={new Set()} onUnfold={none} />);
    expect(markup).toMatch(/^<div data-diff="" class="min-h-0 flex-1 overflow-auto scroll-quiet">/);
    // 가장 긴 줄은 지운 줄 「    if let Err(e) = rx.recv() { log::warn!("{e}"); }」 52칸이다.
    expect(markup).toMatch(/<div class="w-max [^"]*" style="min-width:max\(100%, calc\(44px \+ 52ch\)\)">/);
  });

  it("큰 diff는 100줄 덩어리로 나뉘어 첫 덩어리만 그리고, 나머지는 같은 높이(줄 21.6 · 펼침 줄 28)의 빈 자리다", () => {
    const many: DiffRow[] = [
      ...Array.from({ length: 199 }, (_, i): DiffRow => ({ type: "line", kind: "add", number: i + 1, text: `line ${i + 1}` })),
      { type: "fold", at: 200, count: 3, lines: null },
      ...Array.from({ length: 50 }, (_, i): DiffRow => ({ type: "line", kind: "same", number: i + 203, text: `line ${i + 203}` })),
    ];
    const markup = renderToStaticMarkup(<DiffLines rows={many} open={new Set()} onUnfold={none} />);
    expect(rowsOf(markup)).toHaveLength(100);
    expect(text(rowsOf(markup)[99])).toBe("100 line 100");
    // 그린 줄은 목록의 바로 아래 줄이다 — 덩어리 상자가 없어 펼침 줄의 포커스 링이 덩어리 끝에서 잘리지 않는다.
    expect(markup).toMatch(/style="min-width:[^"]*"><ins class="grid /);
    expect(markup).not.toContain("content-visibility");
    expect(markup.match(/<div data-chunk="\d+" data-chunk-pending="" style="height:[^"]+"><\/div>/g)).toEqual([
      '<div data-chunk="1" data-chunk-pending="" style="height:2166.4px"></div>',
      '<div data-chunk="2" data-chunk-pending="" style="height:1080px"></div>',
    ]);
    expect(folds(markup)).toEqual([]);
  });

  it("줄은 왼쪽 막대 4 · 줄번호 40(오른쪽 맞춤 · 오른쪽 10) · 글의 세 칸이고, 바뀌지 않은 줄은 막대가 비고 번호가 옅다", () => {
    const [same] = rowsOf(renderToStaticMarkup(<DiffLines rows={ROWS} open={new Set()} onUnfold={none} />));
    expect(same).toMatch(/^<div class="grid grid-cols-\[4px_40px_minmax\(0,1fr\)\] whitespace-pre"/);
    expect(same).toMatch(/<span aria-hidden="true" class=""><\/span>/);
    expect(same).toMatch(/<span class="select-none pr-2\.5 text-right text-fg-tertiary">41<\/span>/);
    expect(same).toContain("<span>    watcher.watch(path, RecursiveMode::Recursive)?;</span>");
  });

  it("지운 줄은 `<del>` · 지운 바탕 · 빗금 막대 · 붉은 번호, 더한 줄은 `<ins>` · 더한 바탕 · 찬 막대 · 초록 번호다", () => {
    const [, del, add] = rowsOf(renderToStaticMarkup(<DiffLines rows={ROWS} open={new Set()} onUnfold={none} />));
    expect(del).toMatch(/^<del class="grid [^"]*\bbg-diff-deleted-line no-underline"/);
    expect(del).toMatch(/<span aria-hidden="true" class="diff-bar-deleted"><\/span>/);
    expect(del).toMatch(/text-diff-deleted">42</);
    expect(add).toMatch(/^<ins class="grid [^"]*\bbg-diff-added-line no-underline"/);
    expect(add).toMatch(/<span aria-hidden="true" class="bg-diff-added"><\/span>/);
    expect(add).toMatch(/text-diff-added">42</);
  });

  it("숨긴 줄은 「숨긴 줄 N개」 펼침 줄이다 — 28 · 왼쪽 44 · 오른쪽 12 · 옅은 면 · sans 12 자간 0 `fg-tertiary`에 셰브론 12", () => {
    const markup = renderToStaticMarkup(<DiffLines rows={ROWS} open={new Set()} onUnfold={none} />);
    const [top, bottom] = folds(markup);
    expect(text(top)).toBe("숨긴 줄 40개");
    expect(text(bottom)).toBe("숨긴 줄 86개");
    expect(top).toMatch(/class="[^"]*\bflex h-7 w-full items-center gap-1\.5 bg-fill-soft pr-3 pl-11 font-sans text-xs tracking-normal text-fg-tertiary\b/);
    expect(top).toMatch(/hover:text-fg-secondary/);
    expect(top).toMatch(/<svg[^>]*lucide-chevron-right[^>]*size-3/);
    expect(top).toContain('tabindex="0"');
    expect(top).not.toMatch(/disabled=""/);
    // 지금 파일과 맞지 않아 펼 줄이 없으면 누르지 못한다.
    expect(bottom).toMatch(/disabled=""/);
  });

  it("편 숨긴 줄은 그 자리에 바뀌지 않은 줄로 서고 펼침 줄은 걷힌다", () => {
    const markup = renderToStaticMarkup(<DiffLines rows={ROWS} open={new Set([1])} onUnfold={none} />);
    expect(folds(markup).map(text)).toEqual(["숨긴 줄 86개"]);
    const [first, second] = rowsOf(markup);
    expect(first).toMatch(/^<div class="grid /);
    expect(text(first)).toBe("1 use notify::RecursiveMode;");
    expect(text(second)).toBe("2");
  });
});
