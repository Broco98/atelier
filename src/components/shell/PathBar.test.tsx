import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PathBar } from "./PathBar";

// 경로 줄이 **받은 값을 그대로 그리는가**(codex-ds 스펙 §4 · DS `PathBar`). 줄을 세우는 화면(`WorksPage` · `ArchivePage`)은 원문
// 켜짐을 제 상태로 들어 정적 렌더로는 켠 모습을 못 만든다 — 그래서 받은 값 → 그림의 단언은 부품 자신을 그려 잰다. 어느 식에서 그
// 값이 나오는지(본문과 켜짐이 같은 식인가)는 화면 쪽(`WorksPage.test.tsx`)이, 줄의 기하(48 · 캡슐 글자 = 문서 글 x)는 L3
// (`e2e/path-bar.spec.ts`)가 든다. 누르면 뒤집히는 것 · ←/→는 L3(`e2e/source-toggle.spec.ts`)가 든다.
//
// `source`는 사람이 정한 켜짐이고, `locked`는 이 파일에서 묶음이 먹지 않는다는 뜻이다. **둘은 독립이다.**
interface Drawn {
  source?: boolean;
  locked?: boolean;
  /** 경로 복사를 건네나. */
  copy?: boolean;
  path?: string[];
}

function render({ source = false, locked = false, copy = true, path = ["ui-refresh", "spec", "overview.md"] }: Drawn = {}): string {
  return renderToStaticMarkup(
    <PathBar path={path} view={{ source, locked, onChange: () => {} }} onCopy={copy ? () => {} : undefined} />,
  );
}

const LABEL = 'aria-label="원문 보기"';
const DOC_LABEL = 'aria-label="문서로 보기"';

// 여는 태그만 잘라낸다 — 클래스와 속성을 함께 봐야 "꺼짐 어휘"와 "잠김"이 갈린다
const toggle = (markup: string) => markup.match(new RegExp(`<button[^>]*${LABEL}[^>]*>`))?.[0] ?? "";
const docTab = (markup: string) => markup.match(new RegExp(`<button[^>]*${DOC_LABEL}[^>]*>`))?.[0] ?? "";

/** 두 칸 사이를 미끄러지는 칩의 여는 태그 — segment-on이 그 표식이다(알약에서는 옅은 원이다). */
const chip = (markup: string) => markup.match(/<span[^>]*segment-on[^>]*>/)?.[0] ?? "";

/** 칩이 오른쪽(`</>`) 칸에 서 있는가. 왼쪽은 옮김이 없는 자리다. 알약 칸 28px이고 칸 사이 틈이 없다(`segment-group.tsx`의 `pill`). */
const SLID = "translate-x-7";

/** 경로 캡슐 — 「위치」라는 이름의 nav 하나다. */
const capsule = (markup: string) => markup.match(/<nav\b[^>]*aria-label="위치"[\s\S]*?<\/nav>/)?.[0] ?? "";

/** 조각의 여는 태그와 글자 — 꺾쇠(svg)는 조각이 아니다. */
function pieces(markup: string): { tag: string; text: string }[] {
  return [...capsule(markup).matchAll(/<(span)\b([^>]*)>([^<]*)<\/\1>/g)].map((m) => ({ tag: `<${m[1]}${m[2]}>`, text: m[3] }));
}

/** 본문 글자색(`text-fg`) — `text-fg-secondary` · `text-fg-tertiary`는 다른 이름이라 세지 않는다. */
const 본문색 = /(?<![\w-])text-fg(?![\w-])/;

describe("경로 캡슐", () => {
  // 이름은 옛 문서 카드 머리의 위치 캡슐이 갖던 「위치」 그대로다 — 모양이 경로 줄로 바뀌어도 스크린리더와 검사가 같은
  // 이름으로 찾는다(codex-ds 스펙 스토리 109).
  it("경로를 「위치」라는 이름의 nav 하나로 말하고, 누르는 칸이 없다", () => {
    const markup = capsule(render());
    expect(markup, "「위치」 nav를 찾지 못했다").not.toBe("");
    // 보여 주기만 한다 — 누르는 칸이 생기면 사이드바 nav의 버튼 찾기와 겹친다.
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<a ");
  });

  it("조각이 받은 순서대로 서고 사이마다 꺾쇠가 하나씩 선다", () => {
    const markup = render();
    expect(pieces(markup).map((piece) => piece.text)).toEqual(["ui-refresh", "spec", "overview.md"]);
    expect(capsule(markup).match(/lucide-chevron-right/g)).toHaveLength(2);
  });

  it("끝 조각만 굵고 본문 글자색이며 지금 보는 것이다", () => {
    const [first, second, last] = pieces(render({ path: ["Settings", "spec 레이아웃", "Atelier"] }));
    for (const piece of [first, second]) {
      expect(piece.tag).not.toContain("font-medium");
      expect(piece.tag).not.toMatch(본문색);
      expect(piece.tag).not.toContain("aria-current");
    }
    expect(last.tag).toContain("font-medium");
    expect(last.tag).toMatch(본문색);
    expect(last.tag).toContain('aria-current="page"');
    // 긴 이름은 끝 조각에서 말줄임으로 접힌다 — 앞 조각은 줄지 않는다.
    expect(last.tag).toContain("truncate");
  });

  // 조각 하나도 경로다 — Archive에서 남은 문서가 없으면 경로가 `slug` 하나다(`ArchivePage`).
  it("조각이 하나면 꺾쇠 없이 그 조각이 지금 보는 것이다", () => {
    const markup = render({ path: ["shipped-work"] });
    expect(capsule(markup)).not.toContain("lucide-chevron-right");
    const [only, ...rest] = pieces(markup);
    expect(rest).toEqual([]);
    expect(only.text).toBe("shipped-work");
    expect(only.tag).toContain("font-medium");
    expect(only.tag).toMatch(본문색);
    expect(only.tag).toContain('aria-current="page"');
  });
});

describe("경로 복사 · 줄 끝", () => {
  it("경로 복사는 복사할 것을 받았을 때만 선다", () => {
    expect(render()).toContain('aria-label="경로 복사"');
    expect(render({ copy: false })).not.toContain('aria-label="경로 복사"');
  });

  // 닫기 ×는 미리보기에만 단다(codex-ds 결정 13) — 줄이 스스로 세우는 닫기는 없다. 줄 끝 칸은 부르는 쪽이 건넬 때만 선다
  // (분할 spec 열의 열 닫기 — codex-ds 스펙 S14).
  it("줄 끝 칸은 건넨 것만 서고, 경로 복사 뒤에 선다", () => {
    expect(render()).not.toMatch(/aria-label="[^"]*닫기"/);
    const markup = renderToStaticMarkup(
      <PathBar
        path={["a"]}
        view={{ source: false, locked: false, onChange: () => {} }}
        onCopy={() => {}}
        end={<button type="button" aria-label="spec 열 닫기" />}
      />,
    );
    expect(markup.indexOf('aria-label="경로 복사"')).toBeLessThan(markup.indexOf('aria-label="spec 열 닫기"'));
  });
});

describe("보기 묶음", () => {
  it("글리프는 눈과 `</>`다", () => {
    const markup = render();
    expect(docTab(markup)).not.toBe("");
    expect(markup).toMatch(/lucide-eye\b/);
    // Code(꺾쇠 둘)와 달리 CodeXml만 슬래시를 가진다
    expect(markup).toMatch(/lucide-code-xml\b/);
  });

  // 결정 33 — **어느 모드인지가 색이 아니라 자리로 읽힌다.** 두 칸 중 하나만 서 있다.
  // 이 한 줄이 없으면 둘 다 서거나 둘 다 안 선 판이 「좀 흐리네」로 지나간다.
  it("두 칸 중 정확히 한 칸만 서 있다", () => {
    for (const source of [false, true]) {
      const markup = render({ source });
      // 칩은 하나뿐이라 「둘 다 섰다」는 마크업에서 불가능하다. 남은 질문은 **어느 자리냐**다.
      expect(chip(markup)).toBeTruthy();
      expect(chip(markup).includes(SLID)).toBe(source);
      expect(docTab(markup)).toContain(`aria-pressed="${!source}"`);
      expect(toggle(markup)).toContain(`aria-pressed="${source}"`);
    }
  });

  it("예쁜 보기에서는 `</>` 칸이 안 서 있고 누를 수 있다", () => {
    const button = toggle(render());
    expect(button).toContain('aria-pressed="false"');
    expect(button).not.toMatch(/\sdisabled=""/);
    // 안 선 칸은 **배경을 안 켠다**(결정 31) — 선 칸을 말하는 칩이 옅은 원이라 hover 바탕을 얹으면
    // 서 있는 칸과 구분이 안 된다.
    expect(button).toContain("tint-hover");
    expect(button).not.toContain("quiet-hover");
  });

  it("원문 보기에서는 칩이 `</>` 칸으로 미끄러져 온다", () => {
    const markup = render({ source: true });
    const button = toggle(markup);
    expect(button).toContain('aria-pressed="true"');
    // 서 있음은 칸이 아니라 그 칸으로 미끄러져 온 칩이 말한다(`PathBar`의 보기 묶음 주석).
    expect(chip(markup)).toContain(SLID);
    // 서 있는 칸에는 hover 규칙이 없다 — 겹치면 유틸리티 정렬 순서가 승자를 정한다
    // (index.css의 quiet-hover 주석). 눌리기는 한다(누르면 뒤집힌다).
    expect(button).not.toContain("tint-hover");
    expect(button).not.toContain("quiet-hover");
  });

  it("잠기면 흐려지고 눌리지 않는다", () => {
    // 묶음을 무시하는 파일은 켜든 끄든 같은 것이 선다 (결정 6·21). 흐리게만 하고
    // disabled를 빠뜨리면 눌리는데 아무 일도 없는 버튼이다 — 둘을 함께 본다.
    const button = toggle(render({ locked: true }));
    expect(button).toMatch(/\sdisabled=""/);
    expect(button).toContain("disabled:pointer-events-none");
    expect(button).toMatch(/disabled:opacity-\d+/);
  });

  it("잠김이 켜짐을 만들지 않는다", () => {
    // 잠김과 켜짐은 **독립이다.** 묶음을 무시하는 파일도 본문은 코드뷰이므로 "본문이 소스니까
    // 켜진 것"으로 그리고 싶어지는데, 그러면 트리에서 묶음을 따르는 파일과 무시하는 파일을
    // 오갈 때마다 누른 적도 없는 칸이 저 혼자 섰다 내려간다. 잠김을 말하는 것은 흐림이지
    // 켜짐이 아니다.
    const button = toggle(render({ locked: true }));
    expect(button).toContain('aria-pressed="false"');
    expect(button).not.toContain("toggle-on");
  });

  it("켜 둔 채 잠기면 켜짐이 유지된다", () => {
    // 반대 방향도 못 박는다 — 잠김이 켜짐을 **끄지도** 않는다. 사람이 켜 둔 값은
    // 묶음을 무시하는 파일을 스쳐도 그대로여야 다시 md로 돌아왔을 때 원문 보기가 살아 있다.
    const markup = render({ source: true, locked: true });
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
    const markup = render({ locked: true });
    for (const tag of [docTab(markup), toggle(markup)]) {
      expect(tag).toMatch(/\sdisabled=""/);
      expect(tag).toContain("disabled:pointer-events-none");
    }
  });
});
