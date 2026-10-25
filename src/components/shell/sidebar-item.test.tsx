import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MineRow, NewThreadRow } from "./sidebar-item";

// 정적 마크업 seam — 사이드바 **위 줄**(02 구현 스펙 §4 · 스토리 9~15 · 캔버스 F1-Home · Diff-Frame 「제안」)의 행이 **무엇을 말하는가**를 본다.
// 무엇이 기다리는지 · 어떤 차례인지는 `waiting.test.ts`가 보고, 여기로는 그 수만 들어온다. 누르면 무엇이 바뀌는지(거르기 · 돌아오기)는 정적
// 렌더에 없다 — 시안 비교와 L3(13)가 본다.

const render = (node: ReactNode) => renderToStaticMarkup(node);
/** 태그를 걷은 보이는 글 — 줄 사이는 한 칸으로. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** 행의 버튼 하나(여는 태그부터 닫는 태그까지). */
const buttonOf = (html: string) => html.match(/<button[^>]*>.*?<\/button>/)?.[0] ?? "";
/** 버튼의 여는 태그 — 속성만 본다. */
const openTagOf = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? "";

describe("위 줄 「내 차례」 행", () => {
  it("끝에 나를 기다리는 Thread 수가 서고, 이름에 수가 함께 든다", () => {
    const row = buttonOf(render(<MineRow count={3} on={false} stop={false} onToggle={() => {}} />));
    expect(textOf(row)).toBe("내 차례 3");
    expect(row).toContain('aria-label="내 차례 3"');
  });

  it("기다리는 것이 없으면 끝이 비고 이름도 「내 차례」뿐이다", () => {
    const row = buttonOf(render(<MineRow count={0} on={false} stop={false} onToggle={() => {}} />));
    expect(textOf(row)).toBe("내 차례");
    expect(row).not.toContain("aria-label");
  });

  it("거르는 동안 눌린 행이고, 아니면 안 눌린 행이다", () => {
    expect(openTagOf(render(<MineRow count={2} on stop={false} onToggle={() => {}} />))).toContain('aria-pressed="true"');
    expect(openTagOf(render(<MineRow count={2} on={false} stop={false} onToggle={() => {}} />))).toContain('aria-pressed="false"');
  });
});

describe("위 줄 「새 Thread」 행", () => {
  it("끝에 ⌘N이 옅게 서되 이름에 들지 않고, 키는 `aria-keyshortcuts`가 말한다", () => {
    const html = render(<NewThreadRow active={false} stop={false} onClick={() => {}} />);
    // 단축키 표의 글자다(`hotkeys.json`의 `newThread`) — 보이는 글은 이름 뒤에 그 글자가 선다.
    expect(textOf(buttonOf(html))).toBe("새 Thread ⌘N");
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>⌘N<\/span>/);
    expect(openTagOf(html)).toContain('aria-keyshortcuts="Meta+N"');
    // 「새 Thread」는 누르면 가는 행이다 — 누름 상태를 말하지 않는다.
    expect(openTagOf(html)).not.toContain("aria-pressed");
  });
});
