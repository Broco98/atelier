import { SquareTerminal } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShellMeta } from "./shell-meta";

// 정적 마크업 seam — 이 저장소에서 가장 싸고 가장 높은 지점이다. `ShellMeta`가 props만 받는
// **순수 컴포넌트**인 것이 여기 살기 위한 조건이다: 터미널 스토어를 물면 `@xterm/*`와 그
// CSS가 딸려 와 이 층이 서지 못한다(ShellTabs·SidebarWorkList가 그 seam에 사는 이유와 같다).
//
// **이 파일이 지키는 것은 결정 3의 불변조건 하나다**: 숫자를 다 더하면 그 소유자의 셸 수다.
// 한때 셸 수와 로고가 따로 서서 같은 셸을 두 번 셌고, 그 뒤로는 마크 무리와 「그 밖의 셸」 무리로
// 갈라 셌다. 사이드바에서 마크가 빠지면서(ui-refresh 결정 13) 무리는 `⌨` 하나가 됐고, 불변조건은
// 그 무리의 수가 곧 셸 수라는 것으로 저절로 선다.

const meta = (shellCount: number) => renderToStaticMarkup(<ShellMeta shellCount={shellCount} />);

/** 무리마다 붙는 수 — 그려진 순서 그대로다. 합 불변조건은 이 배열을 더해서 잰다. */
const countsOf = (markup: string) =>
  [...markup.matchAll(/<span class="tabular-nums">(\d+)<\/span>/g)].map((m) => Number(m[1]));

/**
 * 셸을 뜻하는 글리프의 그림. 검사가 자기 사본을 들면 표가 바뀌는 날 둘이 갈리므로
 * lucide에서 그대로 꺼내 온다(ShellTabs.test.tsx의 `SHELL_GLYPH`와 같은 근거).
 */
const SHELL_GLYPH = [
  ...renderToStaticMarkup(<SquareTerminal />).matchAll(/ d="([^"]+)"/g),
].map((match) => match[1])[0];

describe("무리는 하나이고, 그 수가 셸 수다", () => {
  it.each([1, 2, 5])("셸 %i개면 `⌨` 무리 하나에 그 수가 선다", (shellCount) => {
    // 결정 3의 불변조건(합 = 셸 수)이 무리가 하나라 저절로 선다 — 그래도 수로 못박는다.
    // 무리가 다시 갈라지는 날(마크가 돌아오든 무엇이든) 이 줄이 그 합을 다시 묻는다.
    const html = meta(shellCount);
    expect(countsOf(html)).toEqual([shellCount]);
    expect(html.split(SHELL_GLYPH).length - 1).toBe(1);
  });

  it("에이전트 마크가 없다 — 접근성 이름을 단 그림이 하나도 안 선다", () => {
    // ui-refresh 결정 13. 무엇이 도는지는 호버 카드와 셸 탭이 말하고, 이 자리는 셸 수만 든다.
    const html = meta(3);
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("aria-label");
  });

  it("셸이 0개면 아무것도 안 선다", () => {
    // 「없음」은 숫자로 말하지 않는다. 이 규칙이 **슬롯 안에** 있어야 nav `Terminal`과 work
    // 행이 각자 조건을 다시 쓰지 않는다(결정 13).
    expect(meta(0)).toBe("");
  });
});

describe("무리 하나 = 글리프 + 셸 수", () => {
  it("수는 고정폭 숫자다", () => {
    expect(meta(3)).toContain("tabular-nums");
  });

  it("무리는 바깥보다 한 단 진하다 — 대비 바닥이 그 이유다", () => {
    // 바깥 색(fg-tertiary)은 사이드바 배경에서 대비 4.5 아래다(`fg-tertiary` 대 `surface-shell` ≈ 3.2). 이 무리가
    // 이 목록의 **기본값**(셸은 열려 있는데 부르지도 돌지도 않는다)이라, 바깥 색을 물려받으면
    // work 행 메타가 통째로 3.2로 선다 — 그 대비를 L3가 계산해 잰다(`works-sidebar.spec.ts`).
    const html = meta(2);
    expect(countsOf(html)).toHaveLength(1);
    expect([...html.matchAll(/text-fg-secondary/g)]).toHaveLength(1);
  });

  it("누를 수 없고 툴팁도 없다", () => {
    // `title`을 안 다는 것은 work 행에 머물면 호버 카드가 떠서 OS 툴팁이 그 위로 겹치기
    // 때문이다(핀 버튼과 같은 이유).
    const html = meta(2);
    expect(html).not.toContain("title=");
    // **표시 전용이다**(결정 5). 무리 하나가 셸 여럿을 접으므로 누르면 어느 셸로 갈지
    // 정해지지 않는다.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });
});
