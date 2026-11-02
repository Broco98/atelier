import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Rail from "./Rail";

// **레일은 작업공간의 도구다**(restart 02a-14 · 스토리 80 · 81 · 82 · 시안 Shell 「레일」 · Motion 「레일이 들고 난다」). 칸은 `spec` 하나이고
// 둥근 문서 아이콘이다. 작업공간에서만 서고(폭 32), 떠나면 폭 0으로 접힌다. seam은 그린 꼴(markup)이다 — 칸 · 켜짐 · 서고 접힘의 클래스를
// 잰다. 칠해진 폭과 계산된 시간 · 곡선은 시안 비교(WebKit의 계산된 스타일)가 잰다.

const draw = (shown: boolean, open: boolean) =>
  renderToStaticMarkup(<Rail shown={shown} open={open} onPick={() => {}} controls="work-panel" />);

/** 레일 카드 — 「레일」 묶음이 레일 카드 자신이다(시안 `.ra-rail` · `role="group"`). */
const railTag = (markup: string) => markup.match(/<div[^>]*aria-label="레일"[^>]*>/)?.[0] ?? "";
const classOf = (tag: string) => tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
const buttons = (markup: string): string[] => markup.match(/<button[^>]*>/g) ?? [];

describe("레일의 칸", () => {
  it("칸은 `spec` 하나이고, 패널을 가리키는 `aria-pressed` 버튼이다", () => {
    const markup = draw(true, true);
    expect(railTag(markup), "레일을 찾지 못했다").toContain('role="group"');
    const cells = buttons(markup);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toContain('aria-label="spec"');
    expect(cells[0]).toContain('aria-controls="work-panel"');
    expect(cells[0]).toContain('tabindex="0"');
    expect(markup).not.toContain('aria-label="files"');
  });

  it("켜짐은 패널이 열렸다는 뜻이다 — 열리면 켜짐 면이 칸 뒤에 깔리고, 닫히면 둘 다 꺼진다", () => {
    // 시안 Shell 「패널 열림 — 켜짐 면이 칸 뒤에 깔린다」 · 「패널 닫힘 — 켜진 칸 없음」. 켜짐 면(`ra-rail-ind`)은 `tool-rail-on`이고 옅음으로
    // 들고 난다. 켜진 칸은 제 면 없이(`bg-transparent`) 글리프만 `fg`로 진해진다 — hover해도 그대로다.
    const on = draw(true, true);
    const off = draw(true, false);
    expect(buttons(on)[0]).toContain('aria-pressed="true"');
    expect(buttons(off)[0]).toContain('aria-pressed="false"');
    const indicator = (markup: string) => markup.match(/<span[^>]*data-rail-on[^>]*>/)?.[0] ?? "";
    expect(classOf(indicator(on)), "켜짐 면을 찾지 못했다").toEqual(
      expect.arrayContaining(["bg-tool-rail-on", "rounded-ctl", "size-7", "opacity-100"]),
    );
    expect(classOf(indicator(off))).toContain("opacity-0");
    expect(classOf(buttons(on)[0] ?? "")).toEqual(expect.arrayContaining(["text-fg", "bg-transparent"]));
    expect(classOf(buttons(off)[0] ?? "")).toEqual(
      expect.arrayContaining(["text-fg-tertiary", "hover:bg-fill-soft", "hover:text-fg"]),
    );
  });

  it("칸은 28 · 둥글기 4이고 아래 4를 둔다(시안 `.ra-rail button`)", () => {
    expect(classOf(buttons(draw(true, false))[0] ?? "")).toEqual(expect.arrayContaining(["size-7", "rounded-ctl", "mb-1"]));
  });

  it("spec 아이콘은 둥근 문서 한 장이다 — 위 짧은 줄 · 둥근 모서리 3.5의 몸 · 글줄 둘(시안 `ic-docs`)", () => {
    const markup = draw(true, false);
    const svg = markup.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(svg, "아이콘을 찾지 못했다").toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('d="M8 3.5h8"');
    expect(svg).toMatch(/<rect[^>]*x="4"[^>]*y="7.5"[^>]*width="16"[^>]*height="13"[^>]*rx="3.5"/);
    expect(svg).toContain('d="M8.5 12.25h7"');
    expect(svg).toContain('d="M8.5 15.75h4"');
    expect(classOf(svg.match(/<svg[^>]*>/)?.[0] ?? "")).toContain("size-4");
  });
});

// 시안 `.ra-rail` · `.ra-rail[data-show="false"]` · Motion 「레일이 들고 난다」 — 작업공간에 들어오면 폭 0 → 32, 떠나면 패널과 함께 접힌다.
// 폭과 왼쪽 틈은 패널과 같은 박자(`duration-panel-open` 500ms · `ease-spring`)로 옮겨 가 본문이 튀지 않고, 옅음은 `duration-panel`(220)이다.
// 접힌 레일은 보이지도 눌리지도 포커스되지도 않는다 — 보임은 폭이 다 걷힌 뒤에 꺼진다.
describe("레일이 들고 난다", () => {
  it("서면 폭 32 · 왼쪽 틈 8 · 안쪽 2의 카드다(둥글기 6 · 면 surface · 0.5 링)", () => {
    const rail = classOf(railTag(draw(true, false)));
    expect(rail).toEqual(
      expect.arrayContaining([
        "w-(--size-prail)",
        "ml-2",
        "p-0.5",
        "rounded-rail",
        "bg-surface",
        "shadow-hairline",
        "shrink-0",
        "opacity-100",
      ]),
    );
    expect(railTag(draw(true, false))).toContain('data-show="true"');
    expect(railTag(draw(true, false))).not.toMatch(/\binert=/);
  });

  it("접히면 폭 · 왼쪽 틈 · 좌우 안쪽이 0이고 옅어지며, 링 · 보임 · 누름 · 포커스가 걷힌다", () => {
    const tag = railTag(draw(false, false));
    expect(tag).toContain('data-show="false"');
    expect(tag).toMatch(/\binert=""/);
    expect(classOf(tag)).toEqual(
      expect.arrayContaining(["w-0", "ml-0", "px-0", "opacity-0", "shadow-none", "invisible", "pointer-events-none"]),
    );
    expect(classOf(tag)).not.toContain("w-(--size-prail)");
  });

  // 칸의 포커스 링(바깥 4)은 안쪽 2를 넘어 카드 밖으로 2 나간다 — 카드가 넘침을 자르면 그 링이 왼쪽 · 오른쪽 · 위에서 잘린다(codex-ds 결정
  // 11 · 02a-15 — L3 `primitives` 「링을 다는 것은 … 잘리지 않는다」). 세로는 늘 자르지 않고, 가로는 접힌 동안 · 들고 나는 동안만 자른다 — 그동안은
  // 28 칸이 좁아지는 카드에 잘린다(시안 `.ra-rail { overflow: hidden }`). 다 선 뒤에 놓는 순간은 폭의 길이만큼 늦고(넘침은 이산 값이라
  // `transition-discrete`), 접을 때는 곧장 자른다.
  it("레일 카드는 들고 나는 동안만 가로를 자르고, 다 선 뒤에는 칸의 링이 카드 끝에서 잘리지 않는다", () => {
    const shown = classOf(railTag(draw(true, false)));
    expect(shown).not.toContain("overflow-hidden");
    expect(shown).toEqual(expect.arrayContaining(["overflow-x-visible", "transition-discrete"]));
    const hidden = classOf(railTag(draw(false, false)));
    expect(hidden).not.toContain("overflow-hidden");
    expect(hidden).toContain("overflow-x-clip");
    expect(hidden.find((name) => name.startsWith("transition-[")), "접을 때 넘침은 곧장 잘린다").not.toContain("overflow-x");
  });

  it("폭 · 왼쪽 틈은 500ms spring, 옅음은 220ms 기본 곡선이고, 접힐 때 보임은 500ms 뒤에 꺼진다 · 동작 줄이기면 곧바로다", () => {
    const shown = classOf(railTag(draw(true, false)));
    expect(shown).toEqual(
      expect.arrayContaining([
        "transition-[width,margin-left,opacity,overflow-x]",
        "duration-[var(--duration-panel-open),var(--duration-panel-open),var(--duration-panel),0s]",
        "ease-[var(--ease-spring),var(--ease-spring),var(--ease-default),linear]",
        "delay-[0s,0s,0s,var(--duration-panel-open)]",
        "motion-reduce:transition-none",
      ]),
    );
    const hidden = classOf(railTag(draw(false, false)));
    expect(hidden).toEqual(
      expect.arrayContaining([
        "transition-[width,margin-left,opacity,visibility]",
        "duration-[var(--duration-panel-open),var(--duration-panel-open),var(--duration-panel),0s]",
        "ease-[var(--ease-spring),var(--ease-spring),var(--ease-default),linear]",
        "delay-[0s,0s,0s,var(--duration-panel-open)]",
        "motion-reduce:transition-none",
      ]),
    );
  });
});
