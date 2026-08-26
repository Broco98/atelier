import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import TerminalPage from "./TerminalPage";
import { NO_SHELLS, openShell, setTitle } from "./shell-registry";
import { terminalStore } from "./terminal-store";

// 결정 72. 최상위 터미널의 맨 위 44px 한 층을 가로 탭 줄이 겸하고 있었다 — 그 줄이 걷히면서
// 창을 끄는 영역과 신호등 피하기가 갈 곳을 잃었고, 자리를 `PageHeader`에 돌려줬다.
// 여기서 보는 것은 그 한 층이 실제로 서는가와, 그것이 두 몫을 지고 있는가다.
describe("최상위 터미널의 머리행", () => {
  // 스토어는 모듈 싱글턴이라 이 파일 안에서 새어 나간다. 비우고 나간다.
  afterEach(() => terminalStore.setState(() => NO_SHELLS));

  const html = (sidebarOpen: boolean) =>
    renderToStaticMarkup(<TerminalPage sidebarOpen={sidebarOpen} />);
  const header = (markup: string) => /<header[\s\S]*?<\/header>/.exec(markup)?.[0] ?? null;
  const headerTag = (markup: string) => /<header[^>]*>/.exec(markup)?.[0] ?? null;

  it("머리행이 서고 `Terminal`이라고 말한다", () => {
    const markup = html(true);
    expect(header(markup), "머리행이 없다 — 창을 끌 자리도 함께 사라진다").not.toBeNull();
    expect(markup).toContain(">Terminal<");
  });

  it("창을 끌 수 있다", () => {
    // 이 화면 맨 위가 이 행이다. 없으면 창이 아예 안 끌린다 — 탭 줄이 지던 몫이다.
    expect(headerTag(html(true))).toContain("data-tauri-drag-region");
  });

  it("사이드바가 접히면 신호등을 피한다", () => {
    // 왼쪽에 남은 것이 사이드바뿐이라, 접히면 이 행이 창 왼쪽 끝에 붙어 신호등에 깔린다.
    expect(headerTag(html(false))).toContain("pl-(--titlebar-inset)");
    expect(headerTag(html(true))).toContain("pl-4");
  });

  // **결정 72의 나머지 절반이다.** 결정 44가 이 머리행을 아꼈던 이유는 「적을 것이
  // `Terminal` 하나뿐」이었는데, 셸을 고르는 자리가 사이드바로 가면서 그 말이 거짓이 됐다 —
  // 화면에는 그중 하나가 서 있는데 어느 것인지 여기서 안 말하면 사이드바를 봐야 안다.
  it("말단에 지금 켜진 셸이 온다", () => {
    const opened = openShell(NO_SHELLS, { owner: null, project: null, cwd: null })!;
    terminalStore.setState(() => setTitle(opened.state, opened.id, "claude"));
    expect(header(html(true))).toContain("claude");
  });

  it("셸이 없으면 말단도 없다 — 구분선만 남지 않는다", () => {
    // `leaf`가 truthy면 구분선이 함께 그려진다. 빈 문자열을 주면 「Terminal /」가 되고,
    // 셸이 0개인 화면이 실재하므로(결정 102) 그 모습이 실제로 뜬다.
    const SEPARATOR = '<span class="text-border-strong">/</span>';
    expect(header(html(true))).not.toContain(SEPARATOR);
    const opened = openShell(NO_SHELLS, { owner: null, project: null, cwd: null })!;
    terminalStore.setState(() => opened.state);
    expect(header(html(true))).toContain(SEPARATOR);
  });
});
