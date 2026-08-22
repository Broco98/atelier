/// <reference types="node" />
// 이 파일만 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 이 트랙의 산출물 전체가 **문자열 경로로만 닿는 바이너리 두 개**다. `index.css`의 `url()`이
// 옆 폴더의 woff2를 이름으로 가리킬 뿐, 그 둘을 import하는 코드는 어디에도 없다.
//
// 그래서 경로가 끊겨도 아무도 빨개지지 않는다 — Vite는 해결되지 않은 `url()`을 **에러가 아니라
// 경고로** 흘린다("didn't resolve at build time, it will remain unchanged to be resolved at
// runtime"). 파일을 지우거나 이름을 바꾸거나 `index.css`의 경로에 오타를 내면 `pnpm build`가
// exit 0으로 끝나고, 출하된 앱은 죽은 참조를 싣고, 터미널의 그 무게만 폴백으로 흘러
// Nerd Font 아이콘이 다시 두부(￿)가 된다. **이 티켓이 존재하는 이유 그 자체가 조용히 되돌아온다.**
//
// 파일 간 불변조건을 소스 스캔으로 고정하는 방식은 이 저장소 관습 그대로다
// (src/tauri-commands.test.ts의 invoke↔Rust 배선, src/state-scale.test.ts).
//
// **여기서 하지 않는 것:** 얼굴 이름을 `terminal-store.ts`의 `FONT_FAMILY` 첫 항목과 견주는 일.
// 그 짝도 끊기면 조용하지만(번들만 1.9MB 무거워지고 아이콘은 여전히 두부다) `FONT_FAMILY`는
// 아직 이 얼굴을 부르지 않는다 — 그쪽을 고치는 트랙이 그 검사도 같이 들여온다.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cssPath = root + "src/index.css";
const css = readFileSync(cssPath, "utf8");

// 글꼴이 제 이름표(name ID 16)에 적어 둔 이름. 시스템에 같은 글꼴이 깔린 사용자와 이름이
// 갈리지 않으려고 이것을 그대로 쓴다 — index.css 머리 주석과 같은 근거다.
const FAMILY = "JetBrainsMonoNL Nerd Font";

// 블록에서 한 속성을 꺼낸다. **없으면 던진다** — 「못 찾으면 빈 값」으로 흘리면 정규식이 새는
// 순간 아래 검사가 통째로 조용해진다.
function declared(block: string, property: string, pattern: RegExp): string {
  const found = block.match(pattern);
  if (!found) throw new Error(`@font-face 블록에서 ${property}를 찾지 못했다:\n${block}`);
  return found[1].trim().replace(/^["']|["']$/g, "");
}

// `@font-face`는 중첩되지 않는 규칙이라 `[^}]*`로 충분하다. 주석은 걷어내지 않는다 —
// 주석에 `@font-face {`를 쓴 사람이 생기면 아래 개수 검사가 **빨개져서** 알려 준다.
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => ({
  family: declared(match[1], "font-family", /font-family:\s*([^;]+);/),
  weight: declared(match[1], "font-weight", /font-weight:\s*([^;]+);/),
  url: declared(match[1], "src url()", /src:\s*url\(\s*([^)]+?)\s*\)/),
}));

describe("번들한 터미널 글꼴", () => {
  it("index.css가 @font-face로 직접 들인다", () => {
    expect(faces).not.toHaveLength(0);
  });

  // 목록을 그대로 견줘서 개수까지 함께 고정한다 — `every`로 쓰면 빈 목록이 통과한다.
  it("두 벌 다 번들한 얼굴 이름을 쓴다", () => {
    expect(faces.map((face) => face.family)).toEqual([FAMILY, FAMILY]);
  });

  // 무게가 둘뿐인 것은 셈이 아니라 사실이다: ANSI bold는 실제로 쓰이고 italic은 xterm이 합성한다.
  it("Regular·Bold 두 무게가 다 있다", () => {
    expect(faces.map((face) => face.weight).sort()).toEqual(["400", "700"]);
  });

  // 파일 이름은 못박지 않는다 — 아이콘 폭이 어긋나면 `…NerdFontMono-*`로 **파일만 갈아 끼우는
  // 것이 되돌리는 길**이라(README 참고), 여기에 이름을 적어 두면 그 한 번이 두 번이 된다.
  it("src가 가리키는 woff2가 실제로 저장소에 있다", () => {
    const cssDir = dirname(cssPath);
    const checked = faces
      .map((face) => {
        const where = existsSync(resolve(cssDir, face.url)) ? "있다" : `없다 — ${face.url}`;
        return `${face.weight} ${where}`;
      })
      .sort();
    expect(checked).toEqual(["400 있다", "700 있다"]);
  });
});
