import type { Locator, Page } from "./evidence";

// 코드 보기를 재는 손잡이 — 파일 탭의 본문(git-integration 판 01). `code-tab.spec.ts`(04 — 탭이 열리고 닫힌다)와
// `code-highlight.spec.ts`(08 — 강조된 코드)가 **같은 읽기 · 같은 주소 이동**으로 본문을 잰다. 스펙 파일끼리는 import할 수
// 없어(`tab-row.ts` 머리말) 여기 둔다.
//
// **강조 결과는 shadow DOM 안이다.** `@pierre/diffs`는 사용자 요소(`<diffs-container>`)의 shadowRoot에 줄과 줄 번호를
// 그리므로 `locator.textContent()` · 바깥 CSS 선택자로는 줄 하나 · 토큰 하나를 가를 수 없다. 그래서 카드 아래의 shadow를
// 걸어 들어가 줄(`[data-line]`)과 줄 번호(`[data-column-number]`)를 읽는다 — 색은 그 토큰의 **계산된** 색이다(인라인
// 변수가 무엇이든 화면에 칠해진 값).

/** 줄 하나의 토큰 — 강조 전이나 평문이면 줄 전체가 토큰 하나다. */
export interface CodeToken {
  text: string;
  /** `getComputedStyle().color` — `rgb(r, g, b)` 꼴. */
  color: string;
  italic: boolean;
}

export interface CodeLine {
  text: string;
  tokens: CodeToken[];
}

export interface CodeViewReading {
  /** 그려진 줄 번호 칸의 글자, 위에서부터. 가상화 때문에 보이는 창 언저리만 그려진다. */
  numbers: string[];
  /** 그려진 줄, 위에서부터. */
  lines: CodeLine[];
}

/** 코드 카드(`getByRole("main", { name: <경로> })`) 안에 그려진 코드를 읽는다. */
export async function readCodeView(card: Locator): Promise<CodeViewReading> {
  return card.evaluate((root) => {
    const elements: Element[] = [];
    const walk = (node: Element | ShadowRoot) => {
      for (const element of node.querySelectorAll("*")) {
        elements.push(element);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(root);
    // 토큰은 글자를 직접 든 가장 안쪽 span이다 — 줄의 겉 span(줄 · 칸 틀)은 세지 않는다.
    const tokensOf = (line: Element): { text: string; color: string; italic: boolean }[] =>
      Array.from(line.querySelectorAll("span"))
        .filter((span) => span.children.length === 0 && (span.textContent ?? "") !== "")
        .map((span) => {
          const style = getComputedStyle(span);
          return { text: span.textContent ?? "", color: style.color, italic: style.fontStyle === "italic" };
        });
    return {
      numbers: elements
        .filter((element) => element.hasAttribute("data-column-number"))
        .map((element) => (element.textContent ?? "").trim()),
      lines: elements
        .filter((element) => element.hasAttribute("data-line"))
        .map((line) => ({ text: line.textContent ?? "", tokens: tokensOf(line) })),
    };
  });
}

/** 그 글자를 든 토큰 — 없으면 `undefined`. 강조가 끝나기 전에는 줄 전체가 한 토큰이라 대개 찾지 못한다. */
export const tokenOf = (reading: CodeViewReading, text: string): CodeToken | undefined =>
  reading.lines.flatMap((line) => line.tokens).find((token) => token.text.trim() === text);

/** 코드 카드 — 접근 이름이 그 파일의 경로다(스토리 89). */
export const codeCard = (page: Page, ref: string) => page.getByRole("main", { name: ref, exact: true });

/**
 * 앱 안에서 주소를 바꾼다 — 링크 · 팔레트 · 대화창이 하는 push와 같다. **다시 띄우지 않는다**: `page.goto`는 앱을 새로 세워
 * 메모리에만 사는 묶음(결정 33)을 지운다. 라우터의 기록(`@tanstack/history`)이 `pushState`를 감싸 듣고 있어 이 한 번으로
 * 화면이 따라오고, 뒤로가기도 이 자리를 센다.
 */
export async function 주소로간다(page: Page, url: string): Promise<void> {
  await page.evaluate((next) => {
    const state = (window.history.state ?? {}) as Record<string, unknown>;
    const index = (typeof state.__TSR_index === "number" ? state.__TSR_index : 0) + 1;
    window.history.pushState({ ...state, __TSR_index: index, key: `t${index}`, __TSR_key: `t${index}` }, "", next);
  }, url);
}
