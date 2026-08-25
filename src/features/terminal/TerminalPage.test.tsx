import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TerminalPage from "./TerminalPage";

// 결정 72. 최상위 터미널의 맨 위 44px 한 층을 가로 탭 줄이 겸하고 있었다 — 그 줄이 걷히면서
// 창을 끄는 영역과 신호등 피하기가 갈 곳을 잃었고, 자리를 `PageHeader`에 돌려줬다.
// 여기서 보는 것은 그 한 층이 실제로 서는가와, 그것이 두 몫을 지고 있는가다.
describe("최상위 터미널의 머리행", () => {
  const html = (sidebarOpen: boolean) =>
    renderToStaticMarkup(<TerminalPage sidebarOpen={sidebarOpen} />);
  const header = (markup: string) => /<header[^>]*>/.exec(markup)?.[0] ?? null;

  it("머리행이 서고 `Terminal`이라고 말한다", () => {
    const markup = html(true);
    expect(header(markup), "머리행이 없다 — 창을 끌 자리도 함께 사라진다").not.toBeNull();
    expect(markup).toContain(">Terminal<");
  });

  it("창을 끌 수 있다", () => {
    // 이 화면 맨 위가 이 행이다. 없으면 창이 아예 안 끌린다 — 탭 줄이 지던 몫이다.
    expect(header(html(true))).toContain("data-tauri-drag-region");
  });

  it("사이드바가 접히면 신호등을 피한다", () => {
    // 왼쪽에 남은 것이 사이드바뿐이라, 접히면 이 행이 창 왼쪽 끝에 붙어 신호등에 깔린다.
    expect(header(html(false))).toContain("pl-(--titlebar-inset)");
    expect(header(html(true))).toContain("pl-4");
  });
});
