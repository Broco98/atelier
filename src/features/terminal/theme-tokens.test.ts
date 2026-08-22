/// <reference types="node" />
// 이 파일만 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { terminalTheme, terminalThemeDark, terminalThemeLight } from "./terminal-theme";

// 터미널의 글꼴과 색은 **두 곳에 적혀 있다** — 앱 팔레트인 `index.css`와, xterm이 요구하는
// 모양으로 옮겨 적은 `terminal-theme.ts`/`terminal-store.ts`다. 옮겨 적은 쪽이 뒤처져도
// 타입 검사도 화면도 조용하다: 색이 조금 어긋난 터미널은 "원래 그런가 보다"로 읽힌다.
// 그 짝을 여기서 고정한다 — 이 저장소가 파일 간 불변조건을 다루는 방식 그대로다
// (src/tauri-commands.test.ts의 invoke↔Rust 배선, src/state-scale.test.ts).
//
// **`terminal-store.ts`는 import하지 않고 소스를 읽는다.** import하면 `@xterm/*`와 그 CSS가
// DOM 없는 Node 테스트로 딸려 들어온다 — 위 두 파일이 소스 스캔인 것과 같은 이유다.
// `terminal-theme.ts`는 반대로 **import한다**: 그 파일의 유일한 import가 `import type`이라
// 런타임에 아무것도 딸려오지 않고, 테마가 두 벌이 된 뒤로 소스 정규식은 「어느 벌의
// `foreground`인지」를 선언 순서로만 구분하게 되어 조용히 틀릴 수 있다.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(root + path, "utf8");

const css = read("src/index.css");
const store = read("src/features/terminal/terminal-store.ts");

// `:root`(라이트)가 `.dark`보다 먼저 나오므로 **첫 번째** 정의가 라이트 값이다.
// 앱은 아직 다크를 출하하지 않는다 — `.dark` 블록은 shadcn 기본값이고 아무도 켜지 않는다.
function cssToken(name: string): string {
  const found = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!found) throw new Error(`index.css에서 --${name}을 찾지 못했다`);
  return found[1].trim();
}

// 따옴표와 공백만 다른 것은 같은 목록이다: CSS는 `'Geist Mono Variable', ui-monospace, …`,
// xterm 옵션은 따옴표 없는 한 문자열이다.
const fontList = (raw: string) =>
  raw
    .replace(/['"]/g, "")
    .split(",")
    .map((one) => one.trim())
    .join(", ");

describe("터미널이 앱 팔레트에서 옮겨 적은 값", () => {
  it("모노 글꼴 목록이 --font-mono와 같다", () => {
    const declared = store.match(/const FONT_FAMILY = "([^"]+)"/);
    expect(declared, "terminal-store.ts에서 FONT_FAMILY를 찾지 못했다").not.toBeNull();
    expect(fontList(declared![1])).toBe(fontList(cssToken("font-mono")));
  });

  // 티켓이 「앱과 어긋나면 안 되는 넷」으로 못박은 짝들이다(결정 33). **라이트만** 짝이 있다 —
  // 다크에는 짝이 될 앱 토큰이 없다(결정 54, terminal-theme.ts 머리말).
  it("foreground가 --foreground와 같다", () => {
    expect(terminalThemeLight.foreground).toBe(cssToken("foreground"));
  });

  it("cursor가 --primary와 같다", () => {
    expect(terminalThemeLight.cursor).toBe(cssToken("primary"));
  });

  it("selectionBackground이 --state-3과 같다", () => {
    expect(terminalThemeLight.selectionBackground).toBe(cssToken("state-3"));
  });

  // 넷 중 이것만 문자열로 못 견준다 — `--background`는 `oklch(1 0 0)`이고 xterm은 그 표기를
  // 직접 파싱하지 못해(css.toColor가 #rrggbb·rgb()·rgba()만 본다) 테마에는 `#ffffff`로 적혀
  // 있다. 그래서 **앱 쪽을 고정한다**: 앱 배경이 흰색을 벗어나면 이 검사가 깨지고,
  // 깨진 사람이 terminal-theme.ts를 다시 보게 된다.
  it("앱 배경이 흰색인 동안에만 테마의 #ffffff가 맞다", () => {
    expect(cssToken("background")).toBe("oklch(1 0 0)");
    expect(terminalThemeLight.background).toBe("#ffffff");
  });
});

const ANSI_16 = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

// 정확한 휘도가 아니라 세 채널 평균이다 — 여기서 가리려는 것은 「바탕과 글자가 뒤바뀌었나」
// 하나라 이걸로 충분하고, 감마를 들이면 검사가 읽기만 어려워진다.
function brightness(hex: string | undefined): number {
  const found = hex?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (!found) throw new Error(`#rrggbb가 아니다: ${hex}`);
  return (parseInt(found[1], 16) + parseInt(found[2], 16) + parseInt(found[3], 16)) / 3;
}

// 다크는 앱과 견줄 짝이 커서 하나뿐이라, 나머지는 **두 벌 사이**를 견준다 — 한 벌만 고치고
// 다른 벌을 잊는 것이 이 파일이 썩는 방식이기 때문이다.
describe("터미널 테마 두 벌", () => {
  // 기본을 정하는 유일한 지점이 이 별칭이다(결정 54). store는 `terminalTheme`만 import하므로
  // 여기가 라이트로 돌아가도 타입 검사에는 아무 티가 안 난다.
  it("기본은 어둡게다", () => {
    expect(terminalTheme).toBe(terminalThemeDark);
  });

  it("두 벌이 같은 키 집합을 갖는다", () => {
    expect(Object.keys(terminalThemeDark).sort()).toEqual(Object.keys(terminalThemeLight).sort());
  });

  it("ANSI 16색이 두 벌 모두에 빠짐없이 있다", () => {
    for (const [name, set] of [
      ["밝게", terminalThemeLight],
      ["어둡게", terminalThemeDark],
    ] as const) {
      for (const key of ANSI_16) {
        expect(set[key], `${name}에 ${key}가 없다`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  // 다크에서 앱과 이어진 값은 이것 하나다 — 결정 54가 「커서는 앱 --primary를 그대로」로
  // 못박았고, 그 연결이 끊기면 다크 터미널에 앱의 색이 한 점도 남지 않는다.
  it("다크 커서가 앱 --primary와 같다", () => {
    expect(terminalThemeDark.cursor).toBe(cssToken("primary"));
  });

  it("밝게는 바탕이 글자보다 밝고, 어둡게는 그 반대다", () => {
    expect(brightness(terminalThemeLight.background)).toBeGreaterThan(
      brightness(terminalThemeLight.foreground),
    );
    expect(brightness(terminalThemeDark.background)).toBeLessThan(
      brightness(terminalThemeDark.foreground),
    );
  });

  // 한 벌을 통째로 베낀 뒤 배경만 어둡게 바꾸는 것이 가장 그럴듯하게 썩는 길이다. Light+와
  // Dark+가 실제로 같은 값을 쓰는 것은 셋(black·red·brightBlack)뿐이고 나머지 열셋은 다르다.
  const SHARED_16: readonly string[] = ["black", "red", "brightBlack"];

  it("다크 16색이 라이트를 베낀 것이 아니다", () => {
    for (const key of ANSI_16) {
      if (SHARED_16.includes(key)) continue;
      expect(terminalThemeDark[key], `${key}가 두 벌에서 같다`).not.toBe(terminalThemeLight[key]);
    }
  });
});
