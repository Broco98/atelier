import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ViewerHead } from "./ExpandedViewer";

// 넓힌 카드 보기의 머리(SummarySheet 「넓힌 카드」 · 보드 `.ra-vwhead`) — 받은 값을 그대로 그리는 조각이라 정적 마크업으로 잰다. 자리 · 색
// (38 · 왼쪽 14 · 오른쪽 6 · 아래 0.5 `border-heavy`)은 시안 비교가, 렌더 · 원문을 눌러 뒤집는 것은 L3가 본다.

const none = () => {};
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const nav = (markup: string) => markup.match(/<nav\b[^>]*aria-label="위치"[\s\S]*?<\/nav>/)?.[0] ?? "";
const button = (markup: string, name: string) =>
  markup.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>|<button[^>]*>${name}</button>`))?.[0] ?? "";

describe("넓힌 카드 보기의 머리", () => {
  it("경로는 「위치」 nav에 「/」로 이어 서고, 끝 조각만 지금 보는 것이다 — 누르는 칸이 없다", () => {
    const markup = renderToStaticMarkup(
      <ViewerHead path={["문서", "01-실패-신호", "재시도-규칙.md"]} onClose={none} />,
    );
    expect(text(nav(markup))).toBe("문서 / 01-실패-신호 / 재시도-규칙.md");
    expect(nav(markup)).toMatch(/aria-current="page"[^>]*>재시도-규칙.md</);
    expect(nav(markup).match(/aria-current/g) ?? []).toHaveLength(1);
    expect(nav(markup)).not.toContain("<button");
  });

  it("변경은 경로 뒤에 Work 브랜치(고정폭)와 그 파일의 +/−가 서고 0인 쪽은 적지 않는다 — 경로 복사 · 「카드로 접기」", () => {
    const markup = renderToStaticMarkup(
      <ViewerHead
        path={["atelier", "src-tauri", "src", "watcher.rs"]}
        change={{ branch: "feat/watcher-failure-signal", additions: 18, deletions: 0 }}
        onCopy={none}
        onClose={none}
      />,
    );
    expect(text(markup)).toBe("atelier / src-tauri / src / watcher.rs feat/watcher-failure-signal +18");
    expect(markup).toMatch(/font-mono[^>]*>feat\/watcher-failure-signal</);
    expect(markup).toMatch(/text-diff-added[^>]*>\+18</);
    expect(button(markup, "경로 복사")).not.toBe("");
    expect(button(markup, "카드로 접기")).not.toBe("");
    expect(markup).not.toContain("렌더");
  });

  it("문서는 「문서 보기」 묶음의 렌더 · 원문 두 단추가 서고, 지금 보기만 눌린 것이다 — 잠기면 둘 다 못 누른다", () => {
    const rendered = renderToStaticMarkup(
      <ViewerHead path={["문서", "overview.md"]} view={{ source: false, locked: false, onChange: none }} onCopy={none} onClose={none} />,
    );
    expect(rendered).toMatch(/role="group" aria-label="문서 보기"/);
    expect(button(rendered, "렌더")).toContain('aria-pressed="true"');
    expect(button(rendered, "원문")).toContain('aria-pressed="false"');
    const source = renderToStaticMarkup(
      <ViewerHead path={["문서", "overview.md"]} view={{ source: true, locked: false, onChange: none }} onClose={none} />,
    );
    expect(button(source, "원문")).toContain('aria-pressed="true"');
    const locked = renderToStaticMarkup(
      <ViewerHead path={["문서", "a.png"]} view={{ source: false, locked: true, onChange: none }} onClose={none} />,
    );
    expect(button(locked, "렌더")).toContain("disabled");
    expect(button(locked, "원문")).toContain("disabled");
  });

  it("Project 트리는 가리킬 파일이 없어 경로 복사가 없다", () => {
    const markup = renderToStaticMarkup(<ViewerHead path={["Project", "atelier"]} onClose={none} />);
    expect(text(nav(markup))).toBe("Project / atelier");
    expect(button(markup, "경로 복사")).toBe("");
    expect(button(markup, "카드로 접기")).not.toBe("");
  });
});
