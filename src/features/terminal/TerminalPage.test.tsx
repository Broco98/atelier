/// <reference types="node" />
// 소스 스캔 몇 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import TerminalPage from "./TerminalPage";
import { NO_SHELLS, openShell, setTitle } from "./shell-registry";
import type { ShellsState } from "./shell-registry";
import { terminalStore } from "./terminal-store";

// 최상위 터미널의 머리행 — **탭 줄이다**(결정 8 · adr-03). work 화면과 **같은 컴포넌트**를
// 쓰고, 갈리는 것은 맨 앞 한 칸뿐이다: 이 화면에는 문서가 없어 `spec` 칸이 없고 ⌘1부터가
// 셸이다.
//
// **줄 자체가 보는 것은 여기서 다시 안 본다** — 칸이 무엇을 적는지·꼬리표·켜짐 표시는
// ShellTabs.test.tsx가 상태를 직접 넣어 든다. 이 seam이 드는 것은 **조립**이다: 이 화면이
// 그 줄에 무엇을 넘기고, 스토어의 어느 가지를 구독하며, 키를 어디에 배선하는가.
describe("최상위 터미널의 머리행", () => {
  // 스토어는 모듈 싱글턴이라 이 파일 안에서 새어 나간다. 비우고 나간다.
  afterEach(() => terminalStore.setState(() => NO_SHELLS));

  const html = (sidebarOpen: boolean) =>
    renderToStaticMarkup(<TerminalPage sidebarOpen={sidebarOpen} />);
  const headerTag = (markup: string) => /<header[^>]*>/.exec(markup)?.[0] ?? null;

  /**
   * 칸 하나씩 잘라낸다. 경계는 **표식이지 모양이 아니다** — ShellTabs.test.tsx·
   * WorksPage.test.tsx가 쓰는 그 관용구다. 정규식으로 블록을 잘라내지 않는다: 이 저장소는
   * 앞쪽 `[\s\S]*?`가 남의 코드에서 출발해 초록이 되는 fail-open으로 데었다.
   */
  const cellsOf = (markup: string) =>
    markup
      .split('data-tab="')
      .slice(1)
      .map((chunk) => ({ kind: chunk.slice(0, chunk.indexOf('"')), markup: chunk }));
  const kindsOf = (markup: string) => cellsOf(markup).map((cell) => cell.kind);
  const shellCellsOf = (markup: string) =>
    cellsOf(markup)
      .filter((cell) => cell.kind === "shell")
      .map((cell) => cell.markup);

  /** 셸 몇 개를 띄운 상태. `owner`가 `null`이면 이 화면의 것이다. */
  function seed(count: number, owner: string | null, from: ShellsState = NO_SHELLS) {
    let state = from;
    const ids: number[] = [];
    for (let n = 0; n < count; n += 1) {
      const next = openShell(state, { owner, project: null, cwd: null });
      if (!next) throw new Error(`셸 ${count}개를 띄우려 했는데 ${n}개에서 거부됐다`);
      state = next.state;
      ids.push(next.id);
    }
    return { state, ids };
  }

  it("`spec` 칸이 없다 — 셸부터 선다", () => {
    // 결정 8. 이 화면에는 문서가 없다. `spec`이 서면 ⌘1이 가리키는 칸과 화면에 보이는
    // 첫 칸이 어긋나고, 그 순간 이 판이 한 일이 없어진다.
    terminalStore.setState(() => seed(2, null).state);
    const markup = html(true);
    expect(kindsOf(markup)).toEqual(["shell", "shell", "new"]);
    // 머리행이 **하나뿐이다** — 브레드크럼(`PageHeader`)이 남아 있으면 층이 둘이 되고,
    // 창을 끄는 자리와 신호등 회피 여백도 둘로 갈린다.
    expect(markup.split("<header").length - 1).toBe(1);
  });

  it("이 화면의 셸만 선다 — work의 셸은 안 온다", () => {
    // `owner`를 잘못 넘기면 남의 work 셸이 이 줄에 서고, `+`가 여는 자리와 칸이 가리키는
    // 자리가 갈린다. 이 화면의 소유자는 `null`이다(`shellsOf`의 계약).
    const mine = seed(1, null);
    terminalStore.setState(() => seed(2, "가", mine.state).state);
    expect(shellCellsOf(html(true))).toHaveLength(1);
  });

  it("칸이 `shellsOf` 순서 그대로 선다 — ⌘1이 첫 칸이다", () => {
    // 화면에 보이는 순서와 ⌘1~9가 고르는 것이 어긋나면 안 된다(판 03의 핵심 증거).
    const { state, ids } = seed(3, null);
    terminalStore.setState(() =>
      ids.reduce((acc, id, at) => setTitle(acc, id, `셸${at + 1}`), state),
    );
    const cells = shellCellsOf(html(true));
    expect(cells).toHaveLength(3);
    expect(cells[0]).toContain("셸1");
    expect(cells[1]).toContain("셸2");
    expect(cells[2]).toContain("셸3");
  });

  it("켜진 칸이 켜져 보인다 — 이 화면의 본문은 늘 셸이다", () => {
    // `showing`은 **본문이 이 화면의 셸을 보여주는가**다(ShellTabs의 그 prop). work 화면은
    // 문서를 읽는 중에 꺼지지만 여기에는 갈아탈 본문이 없어 늘 참이다 — 거짓으로 넘기면
    // 어느 칸이 지금인지가 화면 어디에도 안 남는다(사이드바 가지가 걷혔다 — 결정 6).
    const { state, ids } = seed(2, null);
    terminalStore.setState(() => state);
    const cells = shellCellsOf(html(true));
    // 마지막에 연 칸이 켜진 칸이다(`openShell`이 그렇게 앉힌다).
    expect(ids).toHaveLength(2);
    expect(cells[1]).toContain('aria-pressed="true"');
    expect(cells[0]).toContain('aria-pressed="false"');
  });

  it("셸이 0개여도 줄은 선다", () => {
    // 셸 0개인 화면이 실재한다(결정 102) — 마지막 칸을 `×`로 닫으면 그 자리다. 그때 이 줄이
    // 통째로 사라지면 창을 끌 자리도 함께 사라진다.
    expect(kindsOf(html(true))).toEqual(["new"]);
    expect(headerTag(html(true))).toContain("data-tauri-drag-region");
  });

  it("창을 끌 수 있다", () => {
    // 이 화면 맨 위가 이 줄이다. 없으면 창이 아예 안 끌린다 — `PageHeader`가 지고 있던 몫을
    // 그대로 물려받는다(ShellTabs 머리말).
    terminalStore.setState(() => seed(1, null).state);
    expect(headerTag(html(true))).toContain("data-tauri-drag-region");
  });

  it("사이드바가 접히면 신호등을 피한다", () => {
    // 왼쪽에 남은 것이 사이드바뿐이라, 접히면 이 줄이 창 왼쪽 끝에 붙어 신호등에 깔린다.
    expect(headerTag(html(false))).toContain("pl-(--titlebar-inset-tabs)");
    expect(headerTag(html(true))).toContain("pl-(--tab-lead)");
  });
});

// 키 배선은 렌더로 못 본다 — 이펙트고, 이 seam에는 이벤트가 없다. **표현식을 통째로
// 못박는다**(WorksPage.test.tsx의 같은 관용구). 판정 자체(`shellForNav`·
// `closesShellFromWindow`)는 shell-registry.test.ts에 전수돼 있다.
describe("최상위 터미널의 키 — 판정은 한 벌이다", () => {
  const source = readFileSync(fileURLToPath(new URL("./TerminalPage.tsx", import.meta.url)), "utf8");
  const countOf = (text: string, literal: string) => text.split(literal).length - 1;

  it("⌘1이 첫 셸이다 — 화면마다 갈리는 것은 `firstKey` 하나다", () => {
    // 결정 8·78. work 화면은 ⌘1이 spec이라 `firstKey`가 2이고 여기는 1이다. 그 어긋남을
    // `shellForNav`가 인자 하나로 받으므로 **판정을 두 벌로 만들지 않는다.**
    expect(source).toContain("const shells = shellsOf(state, null);");
    expect(source).toContain("shellForNav(shells, activeIdOf(state, null), nav, 1)");
    // work 화면의 spec 갈래가 여기 살면 ⌘1이 아무 데도 안 간다 — 이 화면에는 그 칸이 없다.
    expect(source).not.toMatch(/nav\.kind === "index" && nav\.n === 1/);
  });

  it("⌘W가 이 화면의 켜진 칸을 닫는다", () => {
    // 결정 13. 겨눌 칸이 화면에 서게 된 것이 이 키를 window에서 듣는 근거다(adr-03).
    expect(source).toContain("if (!closesShellFromWindow(e)) return;");
    expect(source).toContain("const id = activeIdOf(terminalStore.state, null);");
    // **확인 창을 우회하는 길을 새로 만들지 않는다**(결정 92). 탭의 `×`도 같은 함수로 온다.
    expect(source).toContain("void requestCloseShell(id);");
    expect(source).toContain("onClose={requestCloseShell}");
    // `shellClosedByTab`은 **work 화면의 것이다** — `owner`가 `null`이면 언제나 null을
    // 돌려주므로(그 화면의 ⌘W가 여기 셸을 죽이지 않게 막는 가드다) 여기서 부르면 이 키가
    // 조용히 아무 일도 안 한다. **이름으로 세지 않는다** — 그 이름은 이 파일의 주석에도
    // 나와서 그것만 세면 실제로 불러도 초록이 안 된다(반대로 주석을 고치면 거짓 빨강이다).
    // 끌어오는 길을 본다: 이 화면은 `features/works`에 안 기댄다.
    expect(source, "work 화면의 `shellClosedByTab`을 끌어오면 ⌘W가 조용히 죽는다").not.toContain(
      'from "@/features/works',
    );
  });

  it("window에서 듣는 자리가 셋이다", () => {
    // ⌘T(셸 열기 — 결정 93) · ⌘1~9·⌃Tab(결정 78·79) · ⌘W(켜진 칸 닫기 — 결정 13).
    // 줄어들면 그중 한 벌이 통째로 죽은 것이다.
    expect(
      countOf(source, 'window.addEventListener("keydown", onKeyDown);'),
      "window에서 키를 듣는 자리가 셋이 아니다 — ⌘T · ⌘1~9·⌃Tab · ⌘W",
    ).toBe(3);
  });

  it("구독이 이 화면의 가지로 좁혀져 있다", () => {
    // 줄은 상태와 콜백만 받으므로(ShellTabs 머리말) 구독을 화면이 진다. 좁히지 않고 통째로
    // 읽는 것은 그 줄이 **앱 전체** 상한을 세야 해서이고(결정 30), 다시 그릴지는
    // `sameScreen`가 가른다 — 소유자를 잘못 넘기면 남의 work 타이틀마다 이 화면이 다시
    // 그려지거나(넓게) 이 화면의 칸이 아예 안 갱신된다(엉뚱한 가지).
    expect(source).toContain("(a, b) => sameScreen(a, b, null),");
  });
});
