import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { navItem } from "./nav-items";
import { MineRow, NewThreadRow, PlaceRow, SettingsRow } from "./sidebar-item";
import { SIDEBAR_ROW_SHAPE } from "./sidebar-look";

// 정적 마크업 seam — 사이드바 **위 칸**(02 구현 스펙 §4 · 스토리 9~15 · 캔버스 F1-Home · Diff-Frame 「제안」)의 행이 **무엇을 말하는가**를 본다.
// 무엇이 기다리는지 · 어떤 차례인지는 `waiting.test.ts`가 보고, 여기로는 그 수만 들어온다. 누르면 무엇이 바뀌는지(거르기 · 돌아오기)는 정적
// 렌더에 없다 — 시안 비교와 L3(13)가 본다.

const render = (node: ReactNode) => renderToStaticMarkup(node);
/** 태그를 걷은 보이는 글 — 줄 사이는 한 칸으로. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** 행의 버튼 하나(여는 태그부터 닫는 태그까지). */
const buttonOf = (html: string) => html.match(/<button[^>]*>.*?<\/button>/)?.[0] ?? "";
/** 버튼의 여는 태그 — 속성만 본다. */
const openTagOf = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? "";

describe("위 칸 「내 차례」 행", () => {
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

describe("위 칸 「새 채팅」 행", () => {
  it("끝에 ⌘N이 옅게 서되 이름에 들지 않고, 키는 `aria-keyshortcuts`가 말한다", () => {
    const html = render(<NewThreadRow active={false} stop={false} onClick={() => {}} />);
    // 단축키 표의 글자다(`hotkeys.json`의 `newThread`) — 보이는 글은 이름 뒤에 그 글자가 선다.
    expect(textOf(buttonOf(html))).toBe("새 채팅 ⌘N");
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>⌘N<\/span>/);
    expect(openTagOf(html)).toContain('aria-keyshortcuts="Meta+N"');
    // 「새 채팅」은 누르면 가는 행이다 — 누름 상태를 말하지 않는다.
    expect(openTagOf(html)).not.toContain("aria-pressed");
  });
});

// restart 02a-3 · 스토리 86 — **위 칸의 다섯**(시안 Main의 「가는 곳」)이 사람 메뉴에서 올라온 줄이다. 누르면 그 화면으로 가고, 지금 선 화면의
// 줄은 지금 자리를 말한다(`aria-current` — 한때 사람 메뉴의 줄이 그랬다). 끝 글자(Processes의 합계 · Terminal의 셸 수)는 줄 안 오른쪽 끝에 선다.
describe("위 칸 「가는 곳」 줄", () => {
  it("이름이 그 화면이고, 지금 선 화면이면 그 줄이 지금 자리다", () => {
    const html = render(<PlaceRow item={navItem("services")} active stop={false} onClick={() => {}} />);
    expect(textOf(buttonOf(html))).toBe("Services");
    expect(openTagOf(html)).toContain('aria-current="page"');
  });

  it("다른 화면이면 지금 자리가 아니고, 누름 상태도 말하지 않는다", () => {
    const tag = openTagOf(render(<PlaceRow item={navItem("archive")} active={false} stop={false} onClick={() => {}} />));
    expect(tag).not.toContain("aria-current");
    expect(tag).not.toContain("aria-pressed");
  });

  it("끝 글자가 이름 뒤 줄 안에 선다", () => {
    const html = render(
      <PlaceRow item={navItem("processes")} active={false} stop={false} onClick={() => {}} end={<span>3.3GB</span>} />,
    );
    expect(textOf(buttonOf(html))).toBe("Processes 3.3GB");
  });
});

// restart 02a-3 — **맨 아래에는 설정만 선다**(시안 `.ra-sr-foot` — 「설정 ⌘,」). 사람 줄(얼굴 · 이름 · 꺾쇠)과 그 메뉴는 걷혔다.
describe("맨 아래 「설정」 줄", () => {
  it("끝에 ⌘,가 옅게 서되 이름에 들지 않고, 키는 `aria-keyshortcuts`가 말한다", () => {
    const html = render(<SettingsRow onClick={() => {}} />);
    expect(textOf(buttonOf(html))).toBe("설정 ⌘,");
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>⌘,<\/span>/);
    expect(openTagOf(html)).toContain('aria-keyshortcuts="Meta+,"');
  });
});

// 02 구현 스펙 §4 「행 모양은 다른 사이드바 줄과 같다」 · 「둥글기는 Codex의 superellipse 12.5」 · 02 코드 리뷰 S2. **위 칸 · 설정 nav의 행은
// Work · Thread 줄과 한 모양이다**(`SIDEBAR_ROW_SHAPE`) — 한때 `rounded-lg`라 `corner-shape`가 있는 창에서 Work · Thread 줄(12.5)과 둥글기가
// 갈렸다(WKWebView에서는 둘 다 10이라 눈으로 안 보인다). 면을 칠하는 상자와 포커스 링이 서는 이름 버튼이 같은 모서리를 쓴다.
describe("위 칸 행의 모양", () => {
  it("상자와 이름 버튼이 사이드바 줄의 모양 한 벌이다", () => {
    for (const html of [
      render(<NewThreadRow active stop onClick={() => {}} />),
      render(<MineRow count={1} on={false} stop={false} onToggle={() => {}} />),
    ]) {
      const [box, button] = [html.match(/^<div[^>]*>/)?.[0] ?? "", openTagOf(html)];
      for (const tag of [box, button]) {
        expect(tag).toMatch(new RegExp(`class="[^"]*\\b${SIDEBAR_ROW_SHAPE.replace(" ", "\\b[^\"]*\\b")}\\b`));
        expect(tag).not.toMatch(/\brounded-lg\b/);
      }
    }
  });
});
