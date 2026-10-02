import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceToggle } from "./SourceToggle";

// 문서/원문 전환이 **받은 두 값을 그대로 그리는가**. 한때 이 단언들은 작업 패널(`WorkPanel.test.tsx`)을 통해 쟀다 — 토글이
// 그 머리행에 앉아 있었다. 토글이 문서 카드 머리로 옮겨 가면서(ui-refresh 판 04) 그 머리를 세우는 화면(`WorksPage`)은 켜짐을
// 제 상태로 들어 정적 렌더로는 켠 모습을 못 만든다 — 그래서 받은 값 → 그림의 단언은 부품 자신을 그려 잰다. 어느 식에서
// 그 값이 나오는지(본문과 켜짐이 같은 식인가)는 화면 쪽(`WorksPage.test.tsx`)이 든다.
//
// on은 사람이 정한 켜짐이고, locked는 이 파일에서 토글이 먹지 않는다는 뜻이다. **둘은 독립이다.**
function render(on: boolean, locked: boolean): string {
  return renderToStaticMarkup(<SourceToggle on={on} locked={locked} onChange={() => {}} />);
}

const LABEL = 'aria-label="원문 보기"';
const DOC_LABEL = 'aria-label="문서로 보기"';

// 여는 태그만 잘라낸다 — 클래스와 속성을 함께 봐야 "꺼짐 어휘"와 "잠김"이 갈린다
function toggle(markup: string): string {
  return markup.match(new RegExp(`<button[^>]*${LABEL}[^>]*>`))?.[0] ?? "";
}

function docTab(markup: string): string {
  return markup.match(new RegExp(`<button[^>]*${DOC_LABEL}[^>]*>`))?.[0] ?? "";
}

/** 두 칸 사이를 미끄러지는 칩의 여는 태그 — segment-on이 그 표식이다(알약에서는 회색 원이다). */
function chip(markup: string): string {
  return markup.match(/<span[^>]*segment-on[^>]*>/)?.[0] ?? "";
}

/**
 * 칩이 오른쪽(`</>`) 칸에 서 있는가. 왼쪽은 옮김이 없는 자리다. 알약 칸 26px + 칸 사이 2px이다
 * (ui-refresh 결정 7의 B — `segment-group.tsx`의 `pill`).
 */
const SLID = "translate-x-[28px]";

describe("SourceToggle", () => {
  it("글리프는 `</>` 하나다", () => {
    // Code(꺾쇠 둘)와 달리 CodeXml만 슬래시를 가진다
    expect(render(false, false)).toMatch(/lucide-code-xml\b/);
  });

  // 결정 33 — **어느 모드인지가 색이 아니라 자리로 읽힌다.** 두 칸 중 하나만 서 있다.
  // 이 한 줄이 없으면 둘 다 서거나 둘 다 안 선 판이 「좀 흐리네」로 지나간다.
  it("두 칸 중 정확히 한 칸만 서 있다", () => {
    for (const on of [false, true]) {
      const markup = render(on, false);
      // 칩은 하나뿐이라 「둘 다 섰다」는 마크업에서 불가능하다. 남은 질문은 **어느 자리냐**다.
      expect(chip(markup)).toBeTruthy();
      expect(chip(markup).includes(SLID)).toBe(on);
      expect(docTab(markup)).toContain(`aria-pressed="${!on}"`);
      expect(toggle(markup)).toContain(`aria-pressed="${on}"`);
    }
  });

  it("예쁜 보기에서는 `</>` 칸이 안 서 있고 누를 수 있다", () => {
    const button = toggle(render(false, false));
    expect(button).toContain('aria-pressed="false"');
    expect(button).not.toMatch(/\sdisabled=""/);
    // 안 선 칸은 **배경을 안 켠다**(결정 31) — 선 칸을 말하는 칩이 회색 원이라 hover 바탕을 얹으면
    // 서 있는 칸과 구분이 안 된다.
    expect(button).toContain("tint-hover");
    expect(button).not.toContain("quiet-hover");
  });

  it("소스 보기에서는 `</>` 칸이 떠오른다", () => {
    const markup = render(true, false);
    const button = toggle(markup);
    expect(button).toContain('aria-pressed="true"');
    // 떠오름은 칸이 아니라 그 칸으로 미끄러져 온 칩이 말한다(SourceToggle 주석).
    expect(chip(markup)).toContain(SLID);
    // 서 있는 칸에는 hover 규칙이 없다 — 겹치면 유틸리티 정렬 순서가 승자를 정한다
    // (index.css의 quiet-hover 주석). 눌리기는 한다(누르면 뒤집힌다) — 다만 그 사실을
    // 말하는 것은 배경이 아니라 **떠올라 있음**이다.
    expect(button).not.toContain("tint-hover");
    expect(button).not.toContain("quiet-hover");
  });

  it("잠기면 흐려지고 눌리지 않는다", () => {
    // 토글을 무시하는 파일은 켜든 끄든 같은 것이 선다 (결정 6·21). 흐리게만 하고
    // disabled를 빠뜨리면 눌리는데 아무 일도 없는 오늘 그대로다 — 둘을 함께 본다.
    const button = toggle(render(false, true));
    expect(button).toMatch(/\sdisabled=""/);
    expect(button).toContain("disabled:pointer-events-none");
    expect(button).toMatch(/disabled:opacity-\d+/);
  });

  it("잠김이 켜짐을 만들지 않는다", () => {
    // 잠김과 켜짐은 **독립이다.** 토글을 무시하는 파일도 본문은 코드뷰이므로 "본문이 소스니까
    // 켜진 것"으로 그리고 싶어지는데, 그러면 트리에서 토글을 따르는 파일과 무시하는 파일을
    // 오갈 때마다 누른 적도 없는 버튼이 저 혼자 켜졌다 꺼진다. 잠김을 말하는 것은 흐림이지
    // 켜짐이 아니다.
    const button = toggle(render(false, true));
    expect(button).toContain('aria-pressed="false"');
    expect(button).not.toContain("toggle-on");
  });

  it("켜 둔 채 잠기면 켜짐이 유지된다", () => {
    // 반대 방향도 못 박는다 — 잠김이 켜짐을 **끄지도** 않는다. 사람이 켜 둔 값은
    // 토글을 무시하는 파일을 스쳐도 그대로여야 다시 md로 돌아왔을 때 소스 보기가 살아 있다.
    const markup = render(true, true);
    const button = toggle(markup);
    expect(button).toContain('aria-pressed="true"');
    expect(chip(markup)).toContain(SLID);
    expect(button).toMatch(/\sdisabled=""/);
    // 칩은 disabled를 못 받는다(버튼이 아니다) — 흐림을 따로 주지 않으면 두 칸이 흐린
    // 위에서 칩 혼자 또렷하게 서 있다.
    expect(chip(markup)).toMatch(/\bopacity-40\b/);
  });

  // 두 칸을 **함께** 잠근다. 한 칸만 잠그면 잠긴 채로도 반대 칸이 눌려, 결정 21이 없애려던
  // 「눌리는데 아무 일도 안 난다」가 그 자리에서 되살아난다.
  it("잠기면 두 칸이 함께 잠긴다", () => {
    const markup = render(false, true);
    for (const tag of [docTab(markup), toggle(markup)]) {
      expect(tag).toMatch(/\sdisabled=""/);
      expect(tag).toContain("disabled:pointer-events-none");
    }
  });
});
