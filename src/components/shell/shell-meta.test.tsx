import { SquareTerminal } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShellMeta } from "./shell-meta";

// 정적 마크업 seam — 이 저장소에서 가장 싸고 가장 높은 지점이다. `ShellMeta`가 props만 받는
// **순수 컴포넌트**인 것이 여기 살기 위한 조건이다: 터미널 스토어를 물면 `@xterm/*`와 그
// CSS가 딸려 와 이 층이 서지 못한다(ShellTabs·SidebarWorkList가 그 seam에 사는 이유와 같다).
//
// **이 파일이 지키는 것은 결정 3의 불변조건 하나다**: 글리프는 「우리가 아는 한 그 셸이 지금
// 무엇인지」를, 그 옆 숫자는 「그 무리의 셸 수」를 말하고, **숫자를 다 더하면 그 소유자의 셸
// 수다.** 한때 셸 수와 로고가 따로 서서 같은 셸을 두 번 셌다.

const meta = (shellCount: number, running: string[] = []) =>
  renderToStaticMarkup(<ShellMeta shellCount={shellCount} running={running} />);

/** 무리마다 붙는 수 — 그려진 순서 그대로다. 합 불변조건은 이 배열을 더해서 잰다. */
const countsOf = (markup: string) =>
  [...markup.matchAll(/<span class="tabular-nums">(\d+)<\/span>/g)].map((m) => Number(m[1]));

/** 마크가 붙은 무리의 접근성 이름 — 그 밖의 셸 무리에는 없다. */
const labelsOf = (markup: string) => [...markup.matchAll(/aria-label="(.*?)"/g)].map((m) => m[1]);

/**
 * 셸을 뜻하는 **대체 글리프**의 그림. 검사가 자기 사본을 들면 표가 바뀌는 날 둘이 갈리므로
 * lucide에서 그대로 꺼내 온다(ShellTabs.test.tsx의 `SHELL_GLYPH`와 같은 근거).
 */
const SHELL_GLYPH = [
  ...renderToStaticMarkup(<SquareTerminal />).matchAll(/ d="([^"]+)"/g),
].map((match) => match[1])[0];

describe("셸 하나는 한 무리에만 들어간다", () => {
  it("**숫자를 다 더하면 그 소유자의 셸 수다**", () => {
    // 결정 3의 전부가 이 한 줄이다. 한때 이 자리가 `⌨3 ✳1`이라 적었고, 그 3에 1이 이미
    // 들어 있다는 것을 화면은 아무 데서도 말하지 않았다 — 사용자는 셸이 넷이라고 읽었다.
    const html = meta(3, ["claude"]);
    expect(countsOf(html)).toEqual([1, 2]);
    expect(countsOf(html).reduce((sum, one) => sum + one, 0)).toBe(3);
  });

  it("셸 하나에서 claude가 돌면 `✳1` 하나만 선다", () => {
    // 로고가 셸 전부를 덮으면 그 밖의 셸 무리는 **아예 없다**. 겹쳐 세던 `⌨1 ✳1`이
    // 사라지는 자리가 여기다.
    const html = meta(1, ["claude"]);
    expect(labelsOf(html)).toEqual(["claude 1개"]);
    expect(countsOf(html)).toEqual([1]);
    expect(html).not.toContain(SHELL_GLYPH);
  });

  it("**마크 표에 없는 명령**을 띄운 셸도 그 밖의 셸로 들어간다", () => {
    // 결정 3의 두 번째 그물이다. `shellCount − running.length`로 재면 `vim`·`node`·`cargo`를
    // 띄운 셸이 **목록에서 통째로 사라진다** — `agentMarkOf`가 모르는 이름에 `null`을 줘서
    // 로고도 안 붙고 어느 무리에도 안 세어지고, 합 불변조건까지 깨진다.
    // **모르면 그냥 터미널이다.**
    const html = meta(1, ["vim"]);
    expect(countsOf(html)).toEqual([1]);
    expect(html).toContain(SHELL_GLYPH);
    expect(labelsOf(html)).toEqual([]);
  });

  it("무리 순서는 **마크가 붙은 것 먼저, 그 밖의 셸이 마지막**이다", () => {
    // 결정 8. 이 메타는 오른쪽 정렬이라 오른쪽 끝 무리가 고정점이다 — claude가 시작되면
    // 새 무리가 **왼쪽으로 끼어들고** 그 밖의 셸 무리는 제자리에 있다. 반대로 하면 이미
    // 서 있던 숫자가 옆으로 미끄러진다.
    const html = meta(3, ["claude", "codex"]);
    expect(labelsOf(html)).toEqual(["claude 1개", "codex 1개"]);
    expect(countsOf(html)).toEqual([1, 1, 1]);
    expect(html.indexOf(SHELL_GLYPH)).toBeGreaterThan(html.indexOf('aria-label="codex'));
  });

  it("셸이 0개면 아무것도 안 선다", () => {
    // 「없음」은 숫자로 말하지 않는다. 이 규칙이 **슬롯 안에** 있어야 nav `Terminal`과 work
    // 행이 각자 조건을 다시 쓰지 않는다(결정 13).
    expect(meta(0)).toBe("");
    expect(meta(0, ["claude"])).toBe("");
  });
});

// 결정 4·15. **표는 agent-mark 하나다** — 셸 탭 칸과 이 자리가 각자 표를 들면 둘이 갈린다.
// **세는 일이 여기다**(결정 28) — 값 쪽은 중복을 그대로 둔다(shell-registry.test.ts).
// 아래는 이 조각이 `RunningMarks`였을 때 SidebarWorkList.test.tsx가 지고 있던 검사들이다.
describe("무리 하나 = 글리프 + 그 무리의 셸 수", () => {
  it("종류마다 하나씩, 받은 순서 그대로다", () => {
    // 순서가 칸 순서인 것은 로고 자리가 초마다 재배열되면 그 자체가 깜빡임이라서다.
    expect(labelsOf(meta(2, ["codex", "claude"]))).toEqual(["codex 1개", "claude 1개"]);
  });

  it("같은 종류가 여럿이면 하나로 접히고 그 **수**가 붙는다", () => {
    // 결정 28. 한 자리 안에서 어떤 무리에만 수가 붙고 어떤 무리에는 안 붙으면 세는 단위가
    // 둘로 갈린다 — 결정 3은 그것을 「숫자는 늘 셸 수」로 일반화한다.
    const html = meta(3, ["claude", "codex", "claude"]);
    expect(labelsOf(html)).toEqual(["claude 2개", "codex 1개"]);
    expect(countsOf(html)).toEqual([2, 1]);
    expect(html).toContain("tabular-nums");
  });

  it("로고는 바깥보다 한 단 진하다 — 대비 바닥이 그 이유다", () => {
    // 결정 15가 로고를 `currentColor`로 칠한 근거가 「대비 바닥 4.5를 저절로 넘는다」인데,
    // 이 자리의 색(tertiary)은 사이드바 배경에서 그 아래다(≈3.0). 바깥 색을 그대로
    // 물려받으면 결정 15의 근거가 이 자리에서만 거짓이 된다.
    expect(meta(1, ["claude"])).toContain("text-muted-foreground");
  });

  it("이름은 눈이 아니라 접근성으로만 읽는다 — 누를 수도 없다", () => {
    const html = meta(1, ["claude"]);
    // 좁은 사이드바에서 이름까지 적으면 무리가 둘일 때 이 자리가 제목보다 길어진다.
    expect(html).not.toContain(">claude<");
    // `title`을 안 다는 것은 work 행에 머물면 호버 카드가 떠서 OS 툴팁이 그 위로 겹치기
    // 때문이다(핀 버튼과 같은 이유).
    expect(html).not.toContain("title=");
    // **표시 전용이다**(결정 5). 무리 하나가 셸 여럿을 접으므로 누르면 어느 셸로 갈지
    // 정해지지 않는다.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });
});
