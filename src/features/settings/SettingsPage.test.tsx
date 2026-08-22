/// <reference types="node" />
// Node 타입을 끌어오는 셋째 파일이다 — 근거는 `src/tauri-commands.test.ts` 머리말과 같다
// (tsconfig의 전역 types를 건드리면 프로젝트 전체의 자동 @types 포함이 좁아진다).
// 아래 「미리보기의 「고르지 않음」이 기대는 전제」 하나가 소스를 읽는다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
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
// 3. **기본 글꼴 이름이 이 화면에 없는 것** — 값을 정하는 자리는 `terminal-store.ts`이고
//    여기에 베껴 적으면 그쪽이 바뀔 때 이 화면만 낡는다. 낡아도 조용하다.
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

  it("고르지 않았으면 앱 토큰을 읽는다 — 이름을 적지 않는다", () => {
    expect(previewFontFamily(null)).toBe("var(--font-mono)");
  });
});

// 위 「고르지 않음」이 서 있는 전제를 여기서 못박는다: **`--font-mono`가 터미널 기본 글꼴과
// 같은 목록인 동안에만** `var(--font-mono)`가 실물과 같은 그림을 그린다.
//
// **이 전제는 곧 깨진다.** 결정 55가 터미널 기본 글꼴만 `JetBrainsMonoNL Nerd Font`로 옮기고
// `--font-mono`는 Geist Mono로 남긴다(`index.css` 머리말이 「`--font-mono`는 건드리지
// 않는다」로 못박았고, 그 글꼴의 `@font-face`는 이미 그 파일에 있다). 그날 「기본」 칩의
// 미리보기는 실물과 다른 글꼴을 그리는데 **화면에는 아무 표시도 나지 않는다** — 폴백이란
// 원래 조용한 것이고, 그것을 눈에 보이게 만드는 게 미리보기의 존재 이유였다.
//
// `theme-tokens.test.ts`에도 같은 짝을 보는 줄이 있지만 거기 기대지 않는다. 그쪽은 「터미널이
// 앱 팔레트에서 옮겨 적은 값」을 지키는 검사라 짝이 끊기는 날 **함께 고쳐지거나 지워질 쪽**
// 이다. 전제를 쓰는 사람이 자기 전제를 진다.
//
// **여기가 빨개졌다면 색을 맞추지 마라.** 고치는 길은 기본 글꼴·크기를 정하는 자리를
// `@xterm`을 딸고 오지 않는 작은 모듈(예: `src/features/terminal/terminal-defaults.ts`)로
// 꺼내, 미리보기와 `terminal-store.ts`가 **같은 상수**를 읽게 하는 것이다. 그러면 이 검사도
// 그 import 하나로 줄어든다.
//
// 소스를 읽는 이유는 `terminal-store.ts`를 import하면 `@xterm/*`와 그 CSS가 DOM 없는 Node
// 테스트로 딸려 들어오기 때문이다(`theme-tokens.test.ts` 머리말과 같다). 정규식이 못 찾으면
// **실패한다** — 못 찾은 것을 통과로 읽으면 이 검사가 지키는 것은 갈라짐이 아니라 자기 자신이다.
describe("미리보기의 「고르지 않음」이 기대는 전제", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));

  // 따옴표와 공백만 다른 것은 같은 목록이다 — CSS는 `'Geist Mono Variable', …`, xterm 옵션은
  // 따옴표 없는 한 문자열이다(`theme-tokens.test.ts`의 같은 함수).
  const fontList = (raw: string) =>
    raw
      .replace(/['"]/g, "")
      .split(",")
      .map((one) => one.trim())
      .join(", ");

  it("--font-mono가 터미널 기본 글꼴과 같은 동안에만 var(--font-mono)가 맞다", () => {
    const store = readFileSync(root + "src/features/terminal/terminal-store.ts", "utf8");
    const declared = store.match(/const FONT_FAMILY = "([^"]+)"/);
    expect(declared, "terminal-store.ts에서 FONT_FAMILY를 찾지 못했다").not.toBeNull();

    const css = readFileSync(root + "src/index.css", "utf8");
    const token = css.match(/--font-mono:\s*([^;]+);/);
    expect(token, "index.css에서 --font-mono를 찾지 못했다").not.toBeNull();

    expect(
      fontList(declared![1]),
      "터미널 기본 글꼴이 --font-mono와 갈라졌다 — 미리보기의 「기본」이 실물과 다른 글꼴을 그린다",
    ).toBe(fontList(token![1]));
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

  // 기본 글꼴 이름을 이 화면이 알면 안 된다 — 그 값을 정하는 자리는 `terminal-store.ts`다.
  it("고르지 않았으면 앱 토큰으로 그리고 화면 어디에도 기본 글꼴 이름이 없다", () => {
    const markup = render(settings());
    expect(markup).toContain("font-family:var(--font-mono)");
    expect(markup).not.toContain("Geist");
  });

  it("고른 크기가 실리고, 고르지 않았으면 크기를 적지 않는다", () => {
    expect(render(settings({ fontSize: 20 }), "20")).toContain("font-size:20px");
    expect(render(settings())).not.toContain("font-size:");
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
