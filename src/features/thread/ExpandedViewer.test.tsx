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

  it("좁으면 경로가 먼저 줄고(끝 조각 말줄임), 그다음 브랜치가 말줄임으로, 끝으로 +/−가 잘린다 — 경로 복사 · ×는 줄지 않는다", () => {
    const markup = renderToStaticMarkup(
      <ViewerHead
        path={["atelier", "src-tauri", "src", "watcher.rs"]}
        change={{ branch: "feat/watcher-failure-signal", additions: 18, deletions: 4 }}
        onCopy={none}
        onClose={none}
      />,
    );
    expect(nav(markup)).toMatch(/^<nav aria-label="위치" class="[^"]*\bmin-w-0 flex-1 basis-0\b[^"]*\boverflow-hidden\b/);
    expect(nav(markup)).toMatch(/class="min-w-0 truncate text-fg">watcher.rs</);
    // 브랜치는 줄 수 있고(기본 flex-shrink 1 · 최소 폭 0) 넘치면 말줄임이다. 경로의 바탕이 0이라 경로가 먼저 다 준다.
    expect(markup).toMatch(
      /<span class="flex min-w-0 items-center gap-2 overflow-hidden"><span class="min-w-0 truncate font-mono text-xs text-fg-tertiary">feat\/watcher-failure-signal<\/span>/,
    );
    expect(markup).toMatch(/<span class="shrink-0 text-xs text-diff-added tabular-nums">\+18<\/span>/);
    expect(markup).toMatch(/<span class="shrink-0 text-xs text-diff-deleted tabular-nums">−4<\/span>/);
    expect(button(markup, "경로 복사")).toContain("icon-button");
    expect(button(markup, "카드로 접기")).toContain("icon-button");
  });

  it("좁으면 렌더 · 원문 묶음도 잘린다 — 묶음이 포커스 링 자리(4)를 들어 링은 잘리지 않는다", () => {
    const markup = renderToStaticMarkup(
      <ViewerHead path={["문서", "overview.md"]} view={{ source: false, locked: false, onChange: none }} onCopy={none} onClose={none} />,
    );
    expect(markup).toMatch(/<span role="group" aria-label="문서 보기" class="flex min-w-0 gap-0\.5 overflow-hidden focus-ring-room">/);
  });

  it("Project 트리는 가리킬 파일이 없어 경로 복사가 없다", () => {
    const markup = renderToStaticMarkup(<ViewerHead path={["Project", "atelier"]} onClose={none} />);
    expect(text(nav(markup))).toBe("Project / atelier");
    expect(button(markup, "경로 복사")).toBe("");
    expect(button(markup, "카드로 접기")).not.toBe("");
  });
});
