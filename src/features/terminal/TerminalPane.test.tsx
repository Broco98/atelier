import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TerminalPane from "./TerminalPane";

// 터미널 본문의 **자리**만 본다. 정적 렌더라 이펙트가 안 돌아 xterm은 서지 않고, 셸도
// 붙지 않는다 — 여기서 관찰할 수 있는 것은 그 셸이 들어앉을 상자의 모양뿐이다.
//
// `work={null}`이고 스토어가 비어 있으므로 셸이 하나도 없다 — 종료 줄과 셸의 집, 그리고
// 셸 0개일 때 덮는 안내(결정 102)가 전부다.
describe("터미널 본문의 자리", () => {
  const html = () => renderToStaticMarkup(<TerminalPane work={null} />);
  const classesOf = (found: RegExpExecArray | null) => (found?.[1] ?? "").split(/\s+/);
  const padding = (classes: string[]) => classes.filter((one) => /^p[xytblr]?-/.test(one));

  // 결정 94. 셸 화면에서 여백은 **빈 배경**이라 창이 좁을수록 손해가 크고, 그만큼 `cols`가
  // 줄어든다. spec 본문의 거터는 읽는 글이라 그대로 두지만 여기는 아니다.
  it("셸이 들어앉는 자리에 여백이 없다", () => {
    // 셸의 집은 `data-shell-host`로 집는다 — **자리로 집지 않는다.** 한때 「마크업의
    // 마지막 빈 div」였는데, 그 판정은 이 컴포넌트에 무엇 하나만 더 그려져도 결정 94와
    // 무관하게 깨져서 「여백이 늘었다」로 잘못 보고한다.
    const host = /<div data-shell-host="" class="([^"]*)"><\/div>/.exec(html());
    expect(host, "셸이 들어앉는 빈 자리를 찾지 못했다").not.toBeNull();
    expect(padding(classesOf(host))).toEqual([]);
  });

  // 결정 22가 만든 성질이고 결정 94가 건드리지 않는 것. 이 줄을 조건부로 끼우면 나타나는
  // 순간 컨테이너가 그만큼 낮아지고 ResizeObserver가 셸을 한두 행 줄여 **다시 흐르게 한다.**
  it("종료 줄은 비어도 자리를 지키고, 그 줄에도 여백이 없다", () => {
    const notice = /<div class="([^"]*\bh-5\b[^"]*)"><\/div>/.exec(html());
    expect(notice, "종료 줄이 사라졌다 — 조건부로 끼우면 셸이 다시 흐른다").not.toBeNull();
    expect(padding(classesOf(notice))).toEqual([]);
  });

  // 결정 102. 가로 탭 줄이 걷힌 뒤로 셸 0개인 화면에서 셸을 여는 길이 여기뿐이다.
  // **셸의 집을 밀어내지 않는다** — 덮개라 집의 여백이 그대로 0이고(위 검사), 셸이 뜨는
  // 순간 집이 이미 자리를 잡고 있어 xterm이 다시 흐르지 않는다.
  it("셸이 0개면 여는 자리가 덮개로 선다", () => {
    const markup = html();
    expect(markup).toContain('aria-label="셸 열기"');
    expect(markup).toContain("absolute inset-0");
  });
});
