/// <reference types="node" />
// 소스 스캔 몇 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import TerminalPage from "./TerminalPage";
import { NO_SHELLS, openShell, ownerOf, setTitle, topTerminal } from "./shell-registry";
import type { ShellOwner, ShellsState } from "./shell-registry";
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

  // **어느 세계의 최상위인가**가 이 화면의 소유자를 정한다(결정 10). 여기서는 Atelier로
  // 고정해 두고, 「그 값이 실제로 `mode`에서 나오는가」는 아래 소스 스캔이 리터럴로 든다 —
  // 정적 렌더로는 두 세계가 서로 다른 목록을 그리는 것을 못 본다(스토어가 모듈 싱글턴이라
  // 두 번 그려도 같은 상태를 본다).
  const TOP = topTerminal("atelier").owner;
  const html = (sidebarOpen: boolean) =>
    renderToStaticMarkup(<TerminalPage mode="atelier" sidebarOpen={sidebarOpen} />);
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

  /** 셸 몇 개를 띄운 상태. `owner`가 `TOP`이면 이 화면의 것이다. */
  function seed(count: number, owner: ShellOwner, from: ShellsState = NO_SHELLS) {
    let state = from;
    const ids: number[] = [];
    for (let n = 0; n < count; n += 1) {
      const next = openShell(state, { mode: "atelier", owner, project: null, cwd: null });
      if (!next) throw new Error(`셸 ${count}개를 띄우려 했는데 ${n}개에서 거부됐다`);
      state = next.state;
      ids.push(next.id);
    }
    return { state, ids };
  }

  it("`spec` 칸이 없다 — 셸부터 선다", () => {
    // 결정 8. 이 화면에는 문서가 없다. `spec`이 서면 ⌘1이 가리키는 칸과 화면에 보이는
    // 첫 칸이 어긋나고, 그 순간 이 판이 한 일이 없어진다.
    terminalStore.setState(() => seed(2, TOP).state);
    const markup = html(true);
    expect(kindsOf(markup)).toEqual(["shell", "shell", "new"]);
    // 머리행이 **하나뿐이다** — 브레드크럼(`PageHeader`)이 남아 있으면 층이 둘이 되고,
    // 창을 끄는 자리와 신호등 회피 여백도 둘로 갈린다.
    expect(markup.split("<header").length - 1).toBe(1);
  });

  it("이 화면의 셸만 선다 — work의 셸은 안 온다", () => {
    // `owner`를 잘못 넘기면 남의 work 셸이 이 줄에 서고, `+`가 여는 자리와 칸이 가리키는
    // 자리가 갈린다. 이 화면의 소유자는 **그 세계의 뒤가 빈 키**다(결정 10).
    const mine = seed(1, TOP);
    terminalStore.setState(() => seed(2, ownerOf("atelier", "가"), mine.state).state);
    expect(shellCellsOf(html(true))).toHaveLength(1);
  });

  it("칸이 `shellsOf` 순서 그대로 선다 — ⌘1이 첫 칸이다", () => {
    // 화면에 보이는 순서와 ⌘1~9가 고르는 것이 어긋나면 안 된다(판 03의 핵심 증거).
    const { state, ids } = seed(3, TOP);
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
    const { state, ids } = seed(2, TOP);
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
    terminalStore.setState(() => seed(1, TOP).state);
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
    // **조회하는 소유자가 `mode`에서 나와야 한다**(결정 10) — 한쪽 세계로 박으면
    // `/maison/terminal`이 Atelier 최상위의 셸을 세고 고른다.
    expect(source).toContain("const owner = ownerOf(mode);");
    expect(source).toContain("const shells = shellsOf(state, owner);");
    expect(source).toContain("shellForNav(shells, activeIdOf(state, owner), nav, 1)");
    // work 화면의 spec 갈래가 여기 살면 ⌘1이 아무 데도 안 간다 — 이 화면에는 그 칸이 없다.
    expect(source).not.toMatch(/nav\.kind === "index" && nav\.n === 1/);
  });

  it("⌘W가 이 화면의 켜진 칸을 닫는다", () => {
    // 결정 13. 겨눌 칸이 화면에 서게 된 것이 이 키를 window에서 듣는 근거다(adr-03).
    expect(source).toContain("if (!closesShellFromWindow(e)) return;");
    expect(source).toContain("const id = activeIdOf(terminalStore.state, owner);");
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

  // 결정 19. 셸 안 ⌘T는 xterm 핸들러가 **요청만** 보내고 화면이 연다. 이 화면이 그 요청을
  // 안 들으면 셸에 포커스가 있는 동안 ⌘T가 죽는다 — 이 화면은 셸이 늘 포커스를 쥐고 있어
  // 사실상 ⌘T 전부다. 창 keydown 리스너로 짓지 않는다(아래 개수가 그대로다).
  //
  // 여기서는 **구독하는가**만 본다 — 지역 이름을 못박지 않는다. 포커스를 둔 셸에서 누른 ⌘T가
  // 새 셸로 이어지는 사슬은 `e2e/shell-origin.spec.ts`가 진짜 xterm으로 잰다.
  it("셸 안 ⌘T의 요청을 듣고, 이 세계의 최상위에 연다", () => {
    expect(source).toContain("onNewShellRequested(");
    expect(source).toContain("openNewShell(topTerminal(mode))");
  });

  it("window에서 듣는 자리가 셋이다", () => {
    // ⌘T(셸 열기 — 결정 93) · ⌘1~9·⌃Tab(결정 78·79) · ⌘W(켜진 칸 닫기 — 결정 13).
    // 줄어들면 그중 한 벌이 통째로 죽은 것이다.
    expect(
      countOf(source, 'window.addEventListener("keydown", onKeyDown);'),
      "window에서 키를 듣는 자리가 셋이 아니다 — ⌘T · ⌘1~9·⌃Tab · ⌘W",
    ).toBe(3);
  });

  // 결정 11 — **이 화면도 탭을 끌어 순서를 바꾼다.** 떨굴 분할이 없어 소비자는 탭 줄 하나다.
  // 제스처는 기능 폴더 밖 공용 모듈이라 `features/works`를 안 부른다(위 import 검사 그대로).
  it("탭을 끄는 자리와 틈 소비자를 이 화면이 준다", () => {
    expect(source).toContain("if (shellId !== null) armDrag({ kind: \"shell\", owner, shellId }, from);");
    expect(source).toContain("slot={slot}");
    expect(source).toContain("onSlot={hoverSlot}");
    expect(source).toContain("onDropSlot={dropShellOnSlot}");
  });

  it("구독이 이 화면의 가지로 좁혀져 있다", () => {
    // 줄은 상태와 콜백만 받으므로(ShellTabs 머리말) 구독을 화면이 진다. 좁히지 않고 통째로
    // 읽는 것은 그 줄이 **앱 전체** 상한을 세야 해서이고(결정 30), 다시 그릴지는
    // `sameScreen`가 가른다 — 소유자를 잘못 넘기면 남의 work 타이틀마다 이 화면이 다시
    // 그려지거나(넓게) 이 화면의 칸이 아예 안 갱신된다(엉뚱한 가지).
    expect(source).toContain("(a, b) => sameScreen(a, b, owner),");
  });
});
