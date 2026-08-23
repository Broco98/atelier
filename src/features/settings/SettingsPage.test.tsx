import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  canSave,
  FONT_PRESETS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  parseFontSize,
  patchTerminal,
  previewFontFamily,
  TerminalSection,
} from "./SettingsPage";
import { FONT_FAMILY, FONT_SIZE } from "@/features/terminal/terminal-defaults";
import { terminalThemeDark, terminalThemeLight } from "@/features/terminal/terminal-theme";
import type { Settings } from "./types";

// 이 화면이 지켜야 하는 것은 화면으로는 안 잡히는 종류다.
//
// 1. **모르는 키가 살아남는 것** — 사용자가 손으로 적은 줄이 저장 한 번에 사라져도 화면에는
//    아무 일도 안 일어난다. 다음에 파일을 열어 봐야 안다. 결정 53이 파일로 간 이유가
//    「손으로 고칠 수 있다」인데, 그 말이 거짓이 되는 자리다.
// 2. **미리보기가 폴백을 감추지 않는 것** — 결정 52가 미리보기를 필수로 만든 이유 자체가
//    「이름을 잘못 적어도 조용히 그려진다」이고, 미리보기에 폴백을 덧붙이면 그 실패가
//    미리보기 안에서 한 번 더 감춰진다. 눈으로는 「글꼴이 잘 나오네」로 보인다.
// 3. **기본 글꼴·크기를 이 화면이 베껴 적지 않는 것** — 값을 정하는 자리는
//    `terminal-defaults.ts`이고, 여기에 옮겨 적으면 그쪽이 바뀔 때 이 화면만 낡는다.
//    낡아도 조용하다: 미리보기가 실물과 다른 글꼴을 그려도 화면에는 아무 표시가 없다.
// 4. **범위 밖 크기가 파일에서 온 것인지 여기서 적힌 것인지** — 파일이 준 값이 저장을
//    잠그면 테마 한 줄 바꾸는 것도 막힌다. 화면에는 「저장이 안 눌린다」로만 보이고 왜
//    잠겼는지는 어디에도 안 적힌다.
//
// 클릭은 걸 수 없다(jsdom이 없어 `renderToStaticMarkup` 문자열을 본다) — 그래서 판단은
// 전부 순수 함수로 꺼내 두고 여기서 그 함수들을 직접 돌린다.

const settings = (terminal: Partial<Settings["terminal"]> = {}): Settings => ({
  terminal: { fontFamily: null, fontSize: null, theme: "dark", ...terminal },
});

function render(value: Settings, sizeText = ""): string {
  return renderToStaticMarkup(
    <TerminalSection
      settings={value}
      sizeText={sizeText}
      onChange={() => {}}
      onChangeSize={() => {}}
    />,
  );
}

describe("읽은 것을 펼쳐 고친다", () => {
  it("고친 필드만 바뀐다", () => {
    const next = patchTerminal(settings({ fontSize: 15 }), { theme: "light" });
    expect(next.terminal).toEqual({ fontFamily: null, fontSize: 15, theme: "light" });
  });

  // 백엔드가 `#[serde(flatten)] extra`로 실어 보내는 것들이다(`settings.rs`). 타입에는
  // 없지만 런타임 객체에는 있고, 펼치기가 곧 보존이다.
  it("우리가 모르는 키는 구획 안팎 모두 살아남는다", () => {
    const read = {
      editor: { tabWidth: 2 },
      terminal: { fontFamily: null, fontSize: null, theme: "dark", bell: "off" },
    } as unknown as Settings;

    const next = patchTerminal(read, { fontSize: 16 }) as unknown as {
      editor: unknown;
      terminal: { bell: string; fontSize: number };
    };

    expect(next.editor, "모르는 구획이 사라졌다").toEqual({ tabWidth: 2 });
    expect(next.terminal.bell, "모르는 키가 사라졌다").toBe("off");
    expect(next.terminal.fontSize).toBe(16);
  });

  it("읽은 객체를 제자리에서 고치지 않는다", () => {
    const read = settings({ fontSize: 15 });
    patchTerminal(read, { fontSize: 20 });
    expect(read.terminal.fontSize).toBe(15);
  });
});

describe("크기 칸 읽기", () => {
  it("빈 칸은 고르지 않음이다", () => {
    expect(parseFontSize("")).toBeNull();
    expect(parseFontSize("   ")).toBeNull();
  });

  it("정수는 그 값이다", () => {
    expect(parseFontSize("15")).toBe(15);
    expect(parseFontSize(" 15 ")).toBe(15);
  });

  it("범위 안팎이 갈린다", () => {
    expect(parseFontSize(String(FONT_SIZE_MIN))).toBe(FONT_SIZE_MIN);
    expect(parseFontSize(String(FONT_SIZE_MAX))).toBe(FONT_SIZE_MAX);
    expect(parseFontSize(String(FONT_SIZE_MIN - 1))).toBe("invalid");
    expect(parseFontSize(String(FONT_SIZE_MAX + 1))).toBe("invalid");
  });

  // Rust 쪽이 `u16`이라 소수는 저장할 때 거절당한다 — 여기서 먼저 말한다.
  it("숫자가 아니거나 소수면 잘못 적힌 것이다", () => {
    expect(parseFontSize("abc")).toBe("invalid");
    expect(parseFontSize("15.5")).toBe("invalid");
    expect(parseFontSize("-15")).toBe("invalid");
  });
});

describe("저장이 열리는 조건", () => {
  // 파일이 15를 줬고 사용자가 그걸 그대로 두고 다른 칸을 고친 상태가 기본형이다.
  const state = (over: Partial<Parameters<typeof canSave>[0]> = {}) =>
    canSave({ dirty: true, sizeText: "15", savedSizeText: "15", saving: false, ...over });

  it("고친 것이 있어야 열린다", () => {
    expect(state()).toBe(true);
    expect(state({ dirty: false })).toBe(false);
  });

  it("크기가 잘못 적혀 있으면 잠긴다 — 그 칸만 조용히 옛 값으로 남는 것을 막는다", () => {
    expect(state({ sizeText: "999" })).toBe(false);
  });

  // 결정 53이 파일로 간 이유가 「손으로 고칠 수 있다」다. 큰 화면에서 손으로 적은
  // `fontSize: 40`이 테마 한 줄 바꾸는 것까지 막으면, 그 편집이 화면을 반쯤 못 쓰게
  // 만든 셈이고 울타리가 파일을 심판한 것이다(FONT_SIZE_MIN 주석).
  it("파일이 준 범위 밖 값은 다른 칸의 저장까지 잠그지 않는다", () => {
    expect(state({ sizeText: "40", savedSizeText: "40" })).toBe(true);
  });

  // 반대쪽 — 같은 40이라도 이 화면에서 적힌 것이면 잠근다. 저장하면 그 칸만 조용히
  // 예전 값으로 남기 때문이다.
  it("그 값을 이 화면에서 적었으면 잠긴다", () => {
    expect(state({ sizeText: "40", savedSizeText: "15" })).toBe(false);
  });

  // `settings.rs`가 tmp 이름을 고정해 두고 「쓰기는 한 번에 하나」를 전제로 적었다 —
  // 겹치면 한쪽의 rename이 남이 아직 쓰는 중인 tmp를 옮긴다. 직렬화는 이 화면의 몫이다.
  it("이미 쓰는 중이면 잠긴다", () => {
    expect(state({ saving: true })).toBe(false);
  });
});

describe("미리보기가 읽는 글꼴", () => {
  // 폴백을 덧붙이면 오타가 그럴듯한 다른 글꼴로 그려져, 미리보기가 존재 이유를 잃는다.
  it("고른 이름에 폴백을 덧붙이지 않는다", () => {
    expect(previewFontFamily("Menlo")).toBe("Menlo");
    expect(previewFontFamily("있지도 않은 글꼴")).toBe("있지도 않은 글꼴");
  });

  // **고르지 않았을 때만 셸과 글자 그대로 같다.** 고른 이름에는 셸 쪽에서 폴백 사슬이
  // 붙지만(결정 56) 여기는 안 붙인다 — 위 검사가 그 이유다. 「기본」은 붙일 것이 없어
  // 두 값이 같아지고, 그래서 이 칩만은 실물과 어긋날 수 없다.
  //
  // 이름을 베껴 적지 않고 **값을 정하는 유일한 지점**에서 읽는다. 예전에는 그 자리가
  // `@xterm/*`를 딸고 오는 `terminal-store.ts` 안이라 앱 토큰 `var(--font-mono)`를 대신
  // 읽었는데, 결정 55가 터미널 글꼴만 `JetBrainsMonoNL Nerd Font`로 옮기면서 그 대역이
  // 실물과 갈라졌다. `terminal-defaults.ts`가 그 물음을 닫았다.
  it("고르지 않았으면 셸이 쓸 목록을 그대로 그린다", () => {
    expect(previewFontFamily(null)).toBe(FONT_FAMILY);
  });
});


describe("프리셋", () => {
  // 첫 줄은 앱이 번들하는 글꼴이다 — 목록의 순서가 「무엇을 먼저 권하는가」다.
  it("첫 줄이 번들 글꼴이고 macOS의 셋이 함께 있다", () => {
    expect(FONT_PRESETS[0]).toBe("JetBrainsMonoNL Nerd Font");
    expect(FONT_PRESETS).toContain("SF Mono");
    expect(FONT_PRESETS).toContain("Menlo");
    expect(FONT_PRESETS).toContain("Monaco");
  });

  it("프리셋 칩이 목록 순서대로 그려진다", () => {
    const markup = render(settings());
    const positions = FONT_PRESETS.map((preset) => markup.indexOf(preset));
    expect(positions.some((at) => at < 0), "그려지지 않은 프리셋이 있다").toBe(false);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("고른 프리셋만 켜진다", () => {
    const markup = render(settings({ fontFamily: "Menlo" }));
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Menlo</);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>Monaco</);
  });
});

describe("미리보기 한 줄", () => {
  it("고른 글꼴이 그대로 실린다", () => {
    const markup = render(settings({ fontFamily: "있지도 않은 글꼴" }));
    expect(markup).toContain("font-family:있지도 않은 글꼴");
    // 폴백이 함께 실리면 오타가 그럴듯하게 그려진다
    expect(markup).not.toContain("var(--font-mono)");
  });

  // 기본 글꼴 이름을 이 화면이 **베껴 적지** 않는다 — 값을 정하는 자리는
  // `terminal-defaults.ts`이고 여기는 그 상수를 읽는다. 그래서 그 이름이 **마크업에** 나오는
  // 것은 맞다(셸이 쓸 목록을 그대로 그리는 중이다). 틀린 것은 이 화면 소스에 문자열로
  // 적히는 쪽이고, 그 갈래는 위 「전제」 검사가 아니라 이 import 하나가 닫는다.
  //
  // `var(--font-mono)`를 대신 읽던 자리다 — 결정 55가 터미널 글꼴만 옮기면서 그 대역이
  // 실물과 갈라졌다.
  it("고르지 않았으면 셸이 쓸 목록을 그대로 그린다", () => {
    const markup = render(settings());
    expect(markup).toContain(`font-family:${FONT_FAMILY}`);
    expect(markup).not.toContain("var(--font-mono)");
  });

  // 글꼴과 같은 규칙이다. 예전에는 고르지 않았을 때 크기를 **아예 적지 않고** CSS 클래스에
  // 맡겼는데(기본값을 베껴 적지 않으려는 것이었다), 그러면 「기본」 미리보기가 실물보다 작게
  // 그려지는 것을 아무도 못 본다 — 미리보기가 실패를 감추는 그 자리다.
  it("고른 크기가 실리고, 고르지 않았으면 기본 크기로 그린다", () => {
    expect(render(settings({ fontSize: 20 }), "20")).toContain("font-size:20px");
    expect(render(settings())).toContain(`font-size:${FONT_SIZE}px`);
  });

  // 「어둡게」가 어떤 어둠인지는 이름으로 알 수 없다 — 두 벌의 실제 값을 그대로 쓴다.
  it("고른 테마의 색으로 그린다", () => {
    const dark = render(settings({ theme: "dark" }));
    expect(dark).toContain(`background:${terminalThemeDark.background}`);
    expect(dark).toContain(`color:${terminalThemeDark.foreground}`);

    const light = render(settings({ theme: "light" }));
    expect(light).toContain(`background:${terminalThemeLight.background}`);
    expect(light).toContain(`color:${terminalThemeLight.foreground}`);
  });
});

describe("테마 줄", () => {
  it("고른 쪽만 켜진다", () => {
    const markup = render(settings({ theme: "light" }));
    expect(markup).toMatch(/aria-pressed="true"[^>]*>밝게</);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>어둡게</);
  });
});

// 결정 52가 명시적으로 뺀 둘이다. 「설정 화면이 있으니 한 줄 더」로 조용히 들어오기 쉬운
// 자리라 여기서 못박는다 — 스크롤백은 모양이 아니라 메모리 값이고(셸 8개 × 10,000줄),
// 색 편집기는 별건이다.
describe("이 판이 열지 않은 것", () => {
  it("스크롤백도 ANSI 색 편집도 화면에 없다", () => {
    const markup = render(settings());
    expect(markup).not.toContain("스크롤백");
    expect(markup).not.toContain("ANSI");
  });
});
