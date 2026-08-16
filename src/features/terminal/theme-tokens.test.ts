/// <reference types="node" />
// 이 파일만 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 터미널의 글꼴과 색은 **두 곳에 적혀 있다** — 앱 팔레트인 `index.css`와, xterm이 요구하는
// 모양으로 옮겨 적은 `terminal-theme.ts`/`TerminalPage.tsx`다. 옮겨 적은 쪽이 뒤처져도
// 타입 검사도 화면도 조용하다: 색이 조금 어긋난 터미널은 "원래 그런가 보다"로 읽힌다.
// 그 짝을 여기서 고정한다 — 이 저장소가 파일 간 불변조건을 다루는 방식 그대로다
// (src/tauri-commands.test.ts의 invoke↔Rust 배선, src/state-scale.test.ts).
//
// **import하지 않고 소스를 읽는다.** `TerminalPage.tsx`를 import하면 `@xterm/*`와 그 CSS가
// DOM 없는 Node 테스트로 딸려 들어온다 — 위 두 파일이 소스 스캔인 것과 같은 이유다.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(root + path, "utf8");

const css = read("src/index.css");
const theme = read("src/features/terminal/terminal-theme.ts");
const page = read("src/features/terminal/TerminalPage.tsx");

// `:root`(라이트)가 `.dark`보다 먼저 나오므로 **첫 번째** 정의가 라이트 값이다.
// 앱은 아직 다크를 출하하지 않고 `terminal-theme.ts`도 라이트 한 벌만 갖는다.
function cssToken(name: string): string {
  const found = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!found) throw new Error(`index.css에서 --${name}을 찾지 못했다`);
  return found[1].trim();
}

function themeColor(key: string): string {
  const found = theme.match(new RegExp(`\\b${key}:\\s*"([^"]+)"`));
  if (!found) throw new Error(`terminal-theme.ts에서 ${key}를 찾지 못했다`);
  return found[1];
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
    const declared = page.match(/const FONT_FAMILY = "([^"]+)"/);
    expect(declared, "TerminalPage.tsx에서 FONT_FAMILY를 찾지 못했다").not.toBeNull();
    expect(fontList(declared![1])).toBe(fontList(cssToken("font-mono")));
  });

  // 티켓이 「앱과 어긋나면 안 되는 넷」으로 못박은 짝들이다(결정 33).
  it("foreground가 --foreground와 같다", () => {
    expect(themeColor("foreground")).toBe(cssToken("foreground"));
  });

  it("cursor가 --primary와 같다", () => {
    expect(themeColor("cursor")).toBe(cssToken("primary"));
  });

  it("selectionBackground이 --state-3과 같다", () => {
    expect(themeColor("selectionBackground")).toBe(cssToken("state-3"));
  });

  // 넷 중 이것만 문자열로 못 견준다 — `--background`는 `oklch(1 0 0)`이고 xterm은 그 표기를
  // 직접 파싱하지 못해(css.toColor가 #rrggbb·rgb()·rgba()만 본다) 테마에는 `#ffffff`로 적혀
  // 있다. 그래서 **앱 쪽을 고정한다**: 앱 배경이 흰색을 벗어나면 이 검사가 깨지고,
  // 깨진 사람이 terminal-theme.ts를 다시 보게 된다.
  it("앱 배경이 흰색인 동안에만 테마의 #ffffff가 맞다", () => {
    expect(cssToken("background")).toBe("oklch(1 0 0)");
    expect(themeColor("background")).toBe("#ffffff");
  });
});
