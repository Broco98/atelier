import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import TerminalPane from "./TerminalPane";
import { markExited, MAX_SHELLS, NO_SHELLS, openShell, shellCapNotice } from "./shell-registry";
import { terminalStore } from "./terminal-store";

// 터미널 본문의 **자리**만 본다. 정적 렌더라 이펙트가 안 돌아 xterm은 서지 않고, 셸도
// 붙지 않는다 — 여기서 관찰할 수 있는 것은 그 셸이 들어앉을 상자의 모양뿐이다.
//
// `work={null}`이라 최상위 터미널의 자리이고, 스토어를 이 파일이 직접 세워 셸이 도는
// 화면과 죽은 화면을 각각 만든다(TerminalPage.test.tsx가 같은 길을 쓴다).
describe("터미널 본문의 자리", () => {
  // 스토어는 모듈 싱글턴이라 이 파일 안에서 새어 나간다. 비우고 나간다.
  afterEach(() => terminalStore.setState(() => NO_SHELLS));

  const html = () => renderToStaticMarkup(<TerminalPane work={null} />);
  const classesOf = (found: RegExpExecArray | null) => (found?.[1] ?? "").split(/\s+/);
  const padding = (classes: string[]) => classes.filter((one) => /^p[xytblr]?-/.test(one));

  /** 셸 하나를 띄운 화면. 돌려주는 것은 그 칸의 번호다 — 죽이는 쪽이 쓴다. */
  const openOne = () => {
    const opened = openShell(NO_SHELLS, { owner: null, project: null, cwd: null });
    if (!opened) throw new Error("셸을 못 열었다");
    terminalStore.setState(() => opened.state);
    return opened.id;
  };

  // 결정 94. 셸 화면에서 여백은 **빈 배경**이라 창이 좁을수록 손해가 크고, 그만큼 `cols`가
  // 줄어든다. spec 본문의 거터는 읽는 글이라 그대로 두지만 여기는 아니다.
  it("셸이 들어앉는 자리에 여백이 없다", () => {
    // 셸의 집은 `data-shell-host`로 집는다 — **자리로 집지 않는다.** 한때 「마크업의
    // 마지막 빈 div」였는데, 그 판정은 이 컴포넌트에 무엇 하나만 더 그려져도 결정 94와
    // 무관하게 깨져서 「여백이 늘었다」로 잘못 보고한다.
    const host = /<div data-shell-host="" class="([^"]*)"/.exec(html());
    expect(host, "셸이 들어앉는 빈 자리를 찾지 못했다").not.toBeNull();
    expect(padding(classesOf(host))).toEqual([]);
  });

  /**
   * 결정 1(판 01). 위쪽 20px 띠의 정체가 이 줄이었다 — **비어 있어도 자리를 먹는 흐름 위의
   * 칸**이었다. 이제 셸 위에 겹쳐 뜬다.
   *
   * 막으려던 회귀는 그대로다: 이 줄이 흐름에 끼면 나타나는 순간 컨테이너가 낮아지고
   * ResizeObserver가 셸을 한두 행 줄여 **다시 흐르게 한다**(결정 22). 그래서 재는 것이
   * 「자리를 지키는가」에서 **「자리를 안 먹는가」**로 뒤집힌다.
   *
   * **이 seam이 못 보는 것**: 픽셀. 정적 렌더에는 상자도 관찰자도 없어 「행 수가 안 바뀌었다」를
   * 여기서 직접 못 잰다. 그 판정은 e2e/terminal-fill.spec.ts가 실물 격자로 든다.
   */
  it("안내가 뜨고 사라져도 셸의 집이 그대로다", () => {
    const id = openOne();
    const running = html();

    terminalStore.setState((state) => markExited(state, id, { exitCode: 1, signal: null }));
    const dead = html();

    // 안내는 실제로 떴다 — 이것이 없으면 아래 두 단언이 「아무것도 안 그려서」 초록이 된다.
    const notice = /<div data-shell-notice="" class="([^"]*)">([^<]*)<\/div>/.exec(dead);
    expect(notice, "죽은 셸의 안내가 없다 — 결정 22가 읽으라는 문장이다").not.toBeNull();
    expect(notice?.[2]).toBe("종료 코드 1");

    // **흐름 밖에 있다.** 이 한 줄이 회귀를 막는 자리다 — 아래 동일성 검사만으로는
    // 흐름에 낀 칸과 겹쳐 뜬 칸이 구분되지 않는다(둘 다 지우면 같은 마크업이 된다).
    expect(classesOf(notice)).toContain("absolute");

    // 그리고 **그 칸 말고는 아무것도 안 달라졌다** — 셸의 집도, 집을 담은 상자도 그대로다.
    expect(dead.replace(notice?.[0] ?? "", "")).toBe(running);
  });

  /**
   * 결정 19가 결정 102를 뒤집는다. 그 결정은 셸 0개인 본문에 **여는 자리**(`+ 새 셸` 행이
   * 든 덮개)를 세웠는데, 근거가 「탭 줄이 걷힌 뒤로 본문에서 셸을 여는 길이 여기뿐이다」
   * 하나였다. 판 03이 그 줄을 되살려 근거가 사라졌고, 남겨 두면 한 화면에 같은 일을 하는
   * 버튼이 둘이 된다.
   *
   * 남는 것은 **비었다는 표시와 여는 법**이다 — 「어떻게 여나」가 화면 밖(탭 줄)에 있으므로
   * 빈 자리에 아무 말도 없으면 그 자리가 고장으로 읽힌다.
   */
  it("셸이 0개면 안내가 서고, 여는 자리는 없다", () => {
    const markup = html();
    expect(markup, "본문에 여는 자리가 남았다 — 탭 줄의 `+`와 둘이 된다").not.toContain(
      'aria-label="셸 열기"',
    );
    expect(markup).toContain("아직 셸이 없어요");
    // **셸의 집을 밀어내지 않는다** — 덮개라 집의 여백이 그대로 0이고(위 검사), 셸이 뜨는
    // 순간 집이 이미 자리를 잡고 있어 xterm이 다시 흐르지 않는다.
    expect(markup).toContain("absolute inset-0");
  });

  /**
   * **잠긴 이유를 안내가 말한다**(결정 45·47). 상한은 앱 전체라(결정 30) 이 화면의 셸이
   * 0개인데도 닿아 있을 수 있다 — 그때 탭 줄의 `+`는 잠겨 있고 그 이유는 hover `title`
   * 뒤에 있어서, 여기에 아무 말도 없으면 「눌러도 아무 일이 없다」만 남는다.
   *
   * 문장은 `shellCapNotice`가 짓는다 — ⌘T 거절 토스트·잠긴 `+`와 **같은 문장**이어야
   * 한쪽만 늙지 않는다(결정 47).
   */
  it("상한에 닿았으면 그 이유를 말한다", () => {
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      const opened = openShell(state, { owner: "남", project: null, cwd: null });
      if (!opened) throw new Error(`셸 ${MAX_SHELLS}개를 못 채웠다`);
      state = opened.state;
    }
    terminalStore.setState(() => state);
    // 이 화면(최상위 터미널)의 셸은 여전히 0개다 — 상한은 앱 전체를 센다.
    expect(html()).toContain(shellCapNotice(state));
  });

  /**
   * 판 01이 아래쪽 띠를 지우려고 셸의 집에 셸 배경을 칠했다(실측 16px — xterm이 `rows`를
   * 내림으로 재고 남는 잉여). **그 칠은 셸이 있을 때만이다** — 0개인 화면에서까지 칠하면
   * 결정 102의 안내가 커다란 어두운 판 위에 서게 된다.
   */
  it("셸이 0개면 집을 칠하지 않는다", () => {
    expect(html()).not.toContain("background-color");
    openOne();
    expect(html(), "셸이 있는데 집이 안 칠해졌다 — 아래 잉여가 앱 배경으로 남는다").toContain(
      "background-color",
    );
  });
});
