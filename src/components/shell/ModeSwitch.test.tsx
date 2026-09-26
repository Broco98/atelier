import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ALL_MODES, type Mode } from "@/mode";
import { ModeSwitch } from "./ModeSwitch";

// 정적 마크업 seam — `ModeSwitch`가 **props만 받는 순수 컴포넌트**인 것이 여기 살기 위한
// 조건이다(`shell-meta.tsx`와 같은 이유). 세그먼트를 `Sidebar.tsx` 안에 인라인으로 두면 그
// 파일이 `terminal-store`를 통해 `@xterm/*`와 그 CSS를 끌고 오므로 이 층이 아예 서지 못하고,
// 그러면 아래 검사들이 전부 e2e로 밀린다.
//
// **두 세계를 함께 잰다.** 한쪽만 재면 「모드를 안 보고 늘 Atelier를 켜는」 변형이 그 검사에서
// 초록이다 — 화면으로는 Maison에 있는데 세그먼트만 왼쪽이 서 있는 모양으로만 보인다.

const markup = (mode: Mode) => renderToStaticMarkup(<ModeSwitch mode={mode} onPick={() => {}} />);

const buttonsOf = (html: string) => html.match(/<button[\s\S]*?<\/button>/g) ?? [];
/** 칸 안에 실제로 들어 있는 것 — 태그를 벗기지 않는다. 낱말 말고 무엇이 들어와도 여기 남는다. */
const insideOf = (button: string) => button.replace(/^<button[^>]*>|<\/button>$/g, "");
const pressedOf = (html: string) =>
  buttonsOf(html).map((button) => /aria-pressed="true"/.test(button));

describe("두 칸이 두 세계다", () => {
  it.each(ALL_MODES)("%s에서도 칸은 `Atelier`·`Maison` 둘이다", (mode) => {
    // 서 있는 쪽이 어디든 **두 칸이 다 있다** — 저쪽 세계가 화면에서 사라지면 건너갈 길이
    // 없어진다. 라벨이 대문자 영어인 것은 nav 항목과 같은 층이라 그렇다(US 59).
    expect(buttonsOf(markup(mode)).map(insideOf)).toEqual(["Atelier", "Maison"]);
  });

  it.each(ALL_MODES)("%s에서 그 칸 하나만 눌려 있다", (mode) => {
    // `aria-pressed`이지 `aria-expanded`가 아니다 — 사이드바에서 접히는 것은 구획 머리뿐이고
    // 검사 둘이 그 사실에 기대고 있다(`Sidebar.test.tsx`의 「접히는 자리가 하나도 없다」).
    expect(pressedOf(markup(mode))).toEqual(ALL_MODES.map((one) => one === mode));
  });

  it("한 컨트롤이라고 말한다", () => {
    // 두 칸이 각자 서 있는 버튼이 아니라 **하나를 고르는 자리**다. 묶음이 없으면 스크린
    // 리더가 「Atelier 버튼」·「Maison 버튼」 둘로만 읽어 무엇을 고르는 중인지가 사라진다.
    expect(markup("atelier")).toContain('role="group"');
    // 이름은 **사전의 말**이다. 목업이 적은 「공간 선택」은 CONTEXT.md의 「모드」 항목이
    // _피할 말_로 등재한 낱말이라, 그것이 여기 남으면 앱이 사전이 금지한 말을 스크린 리더로
    // 말한다 — 이 컨트롤의 유일한 사용자 노출 문장이 이 값이다.
    expect(markup("atelier")).toContain('aria-label="모드 선택"');
  });
});

describe("칩 하나가 서 있는 칸을 말한다", () => {
  it.each(ALL_MODES)("%s에서도 칩은 하나다", (mode) => {
    // 칸마다 배경을 켜고 끄는 안은 기각됐다(`toggle-group.tsx`의 segment 주석) — 그 대가로 두 세계가 동시에
    // 서는 판이 마크업에서 아예 불가능하다. 칩이 둘이 되면 그 보장이 조용히 사라진다.
    expect(markup(mode).split("segment-on").length - 1).toBe(1);
  });

  it("칩이 켜진 칸으로 미끄러진다", () => {
    // 자리가 세계를 적으므로 그 자리가 바뀌는 것도 보여야 한다. 이동이 `translate-x-full`
    // (제 폭의 100%)인 것은 사이드바 폭이 240~400px로 드래그되기 때문이다 — 고정 px로
    // 적으면 그 순간 칩이 칸에서 어긋난다.
    expect(markup("atelier")).not.toContain("translate-x-full");
    expect(markup("maison")).toContain("translate-x-full");
  });
});

describe("점 신호는 없다", () => {
  // 판 02의 몫이다. 지금 넣으면 세그먼트가 「고르는 것」이면서 「알리는 것」이 되고, 그 둘의
  // 규격이 아직 정하지 않은 신호 어휘에 먼저 묶인다.
  //
  // **칸 안에 무엇이 있는가로 잰다.** 「점이 없다」를 클래스 이름 하나로 세면 다음 사람이
  // 다른 모양(svg 글리프·`::after`를 물린 span)으로 넣었을 때 조용히 통과한다 — 칸의 내용이
  // 낱말 하나뿐임을 보면 어떤 모양으로 들어와도 걸린다.
  it.each(ALL_MODES)("%s에서 칸 안에 낱말 말고는 아무것도 없다", (mode) => {
    for (const inside of buttonsOf(markup(mode)).map(insideOf)) {
      expect(inside).not.toContain("<");
    }
  });

  it.each(ALL_MODES)("%s에서 세그먼트 어디에도 글리프가 없다", (mode) => {
    // 칸 **밖**(묶음이나 칩 위)에 얹는 길도 막는다 — 저쪽 세계의 점은 자리가 어디든 점이다.
    expect(markup(mode)).not.toContain("<svg");
  });
});
