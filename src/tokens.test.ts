/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { cssBlocks, declared, SHADCN_NAMES } from "@/css-tokens";

// **앱 팔레트가 Codex 토큰으로 서 있는가**(codex-ds 결정 27 · 스펙 S1 · S2). 이름과 값은 DS 「Atelier」 2판이고,
// 남은 shadcn 이름은 값을 들지 않고 Codex 토큰을 가리킨다.
//
// **유틸리티는 Tailwind를 실제로 돌려 잰다(CSS 훑기).** `@theme`에 줄이 있다고 유틸리티가 서는 것은 아니다 — 시간은
// `--duration-*`가 아니라 `--transition-duration-*`여야 `duration-panel`이 CSS를 내고, 그림자는 값을 글자로 적으면 유틸리티가
// 그 값을 박아 넣어 `.dark`가 못 덮는다. 둘 다 빌드도 타입 검사도 조용하고, 화면에는 「안 움직인다」 · 「다크에서 선이
// 검다」로만 남는다. 쓰는 화면이 아직 없는 토큰(대화 · 도구 · Atelier 낱말)은 L3가 못 재므로 여기서 잰다.
// 화면의 실제 색(창 바탕 · 카드 · 본문 글자)은 L3가 computed style로 잰다(`e2e/frame.spec.ts`).

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(root, "src/index.css"), "utf8");
const blocks = cssBlocks(css);

// `@import`를 Vite처럼 푼다 — 상대 경로는 그 파일 옆, 패키지는 `node_modules/<이름>`의 `exports`(스타일 조건)다.
function packageCss(id: string): string {
  const parts = id.split("/");
  const name = id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const sub = `.${id.slice(name.length)}`;
  const dir = join(root, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const target = pkg.exports?.[sub];
  const file: string = typeof target === "string" ? target : (target?.style ?? target?.default ?? sub);
  return join(dir, file);
}

async function utilities(candidates: string[]): Promise<string> {
  const compiler = await compile(css, {
    base: join(root, "src"),
    loadStylesheet: async (id, base) => {
      const path = id.startsWith(".") ? resolve(base, id) : packageCss(id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

/** 그 유틸리티 규칙의 몸. 규칙이 없으면 `null`이다 — 이름을 Tailwind가 모른다는 뜻이다. */
const ruleOf = (built: string, candidate: string) =>
  built.match(new RegExp(`\\.${candidate} \\{([^}]*)\\}`))?.[1] ?? null;

describe("Codex 토큰", () => {
  // 대표 유틸리티가 **그 이름의 변수를 읽는** CSS를 낸다. 값을 글자로 박은 규칙이면 `.dark`가 못 덮는다.
  const REPRESENTATIVE: Record<string, string> = {
    "bg-surface": "background-color: var(--surface)",
    "bg-surface-shell": "background-color: var(--surface-shell)",
    "text-fg-secondary": "color: var(--fg-secondary)",
    "bg-fill-hover": "background-color: var(--fill-hover)",
    "border-border-heavy": "border-color: var(--border-heavy)",
    "text-link": "color: var(--link)",
    "bg-st-active": "background-color: var(--st-active)",
    "bg-dot-new": "background-color: var(--dot-new)",
    "bg-wait-soft": "background-color: var(--wait-soft)",
    "text-term-fg": "color: var(--term-fg)",
    // 쓰는 화면이 아직 없는 대화 · 도구 · diff · 구문색(codex-ds 스펙 S2)
    "bg-surface-composer": "background-color: var(--surface-composer)",
    "bg-diff-added-line": "background-color: var(--diff-added-line)",
    "text-syntax-keyword": "color: var(--syntax-keyword)",
    "text-chat-accent-purple": "color: var(--chat-accent-purple)",
    "shadow-hairline": "--tw-shadow: var(--shadow-hairline)",
    "shadow-prominent": "--tw-shadow: var(--shadow-prominent)",
    "duration-panel": "transition-duration: var(--duration-panel)",
    "duration-tip": "transition-duration: var(--duration-tip)",
    "ease-panel": "transition-timing-function: var(--ease-panel)",
    "ease-enter-snappy": "transition-timing-function: var(--ease-enter-snappy)",
    "size-control": "width: var(--size-control)",
  };

  it("대표 유틸리티가 Codex 이름의 변수를 읽는 CSS를 낸다", async () => {
    const built = await utilities(Object.keys(REPRESENTATIVE));
    for (const [candidate, declaration] of Object.entries(REPRESENTATIVE)) {
      const rule = ruleOf(built, candidate);
      expect(rule, `${candidate}가 CSS를 안 낸다`).not.toBeNull();
      expect(rule, candidate).toContain(declaration);
    }
  });

  // **유틸리티 `accent`는 Codex 파랑이다**(codex-ds 스펙 S1) — CSS 변수 `--accent`를 읽는다. shadcn이 그 이름에 걸던 옅은 면은
  // Codex `fill-hover`이고, 앱은 그 면을 그 이름으로 적는다. 상태(hover · focus · 켜짐) 뒤에 `bg-accent`를 붙이는 registry의
  // 쓰임은 `state-scale.test.ts`가 막는다 — 이제 그 면은 파랑이다.
  it("유틸리티 bg-accent는 CSS 변수 --accent(Codex 파랑 #339cff)를 읽는다", async () => {
    const rule = ruleOf(await utilities(["bg-accent"]), "bg-accent");
    expect(rule).toContain("background-color: var(--accent)");
    expect(declared(blocks, "light", "accent")).toBe("#339cff");
  });

  // **색 유틸리티가 없는 변수를 가리키지 않는다.** `var()`가 못 풀리면 그 선언은 통째로 무효가 되어 바탕이 투명해진다 —
  // 이름 한 글자가 틀린 유틸리티는 빌드도 타입 검사도 통과하고 화면에서만 사라진다.
  it("@theme의 색 유틸리티가 모두 라이트 · 다크에서 선언된 변수를 읽는다", () => {
    const theme = blocks.filter((block) => block.head.some((one) => one.startsWith("@theme")));
    const reads = theme.flatMap((block) =>
      [...block.decls].flatMap(([name, value]) =>
        name.startsWith("--color-") ? [...value.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]) : [],
      ),
    );
    // 앵커: 블록을 실제로 읽었다 — 경로가 새서 빈 목록이면 아래가 그냥 통과한다.
    expect(reads).toEqual(expect.arrayContaining(["surface", "fg", "accent", "st-active", "background"]));
    expect(reads.length).toBeGreaterThan(90);
    for (const one of reads) {
      expect(declared(blocks, "light", one), `라이트에 --${one}이 없다`).toBeDefined();
      expect(declared(blocks, "dark", one), `다크에 --${one}이 없다`).toBeDefined();
    }
  });

  // 다크는 shadcn 기본값이 아니라 DS 다크 값이다 — 대표 넷이 `.dark`에 제 값으로 선다(물려받은 라이트 값이 아니다).
  it(".dark가 DS 다크 값을 든다", () => {
    const DARK: Record<string, string> = {
      surface: "#181818",
      "surface-shell": "#343434",
      fg: "#ffffff",
      "fill-hover": "rgba(255, 255, 255, 0.12)",
      "shadow-hairline": "0 0 0 0.5px #ffffff1f",
    };
    for (const [name, value] of Object.entries(DARK)) {
      expect(declared(blocks, "dark", name), name).toBe(value);
      expect(declared(blocks, "light", name), `${name} — 라이트와 다크가 같다`).not.toBe(value);
    }
  });

  // **shadcn 이름은 값을 들지 않는다** — Codex 토큰을 가리키는 별칭이다(codex-ds 스펙 S1 · DS README 「앱 토큰 이름과의 짝」).
  // 값이 남으면 팔레트의 정본이 둘이 되어, Codex 값을 고치는 날 그 이름을 읽는 자리(shadcn 바탕 CSS · registry에서 들인 부품)만
  // 옛 색으로 남는다. `.dark`에 따로 적은 값도 같은 일이다. 걷은 앱 전용 이름이 다시 서지 않는 것은 `color-guard.test.ts`가 본다.
  it("shadcn 이름이 모두 Codex 토큰을 가리키고 손으로 적은 색 값이 없다", () => {
    const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i;
    const aliases: readonly string[] = SHADCN_NAMES;
    for (const name of aliases) {
      const value = declared(blocks, "light", name);
      expect(value, `--${name}이 없다`).toBeDefined();
      expect(value, `--${name}에 색 값이 적혀 있다`).not.toMatch(COLOR_LITERAL);
      const targets = [...value!.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]);
      expect(targets, `--${name}이 아무것도 가리키지 않는다`).not.toEqual([]);
      for (const target of targets) {
        expect(aliases, `--${name}이 shadcn 이름 --${target}을 가리킨다`).not.toContain(target);
        expect(declared(blocks, "light", target), `--${name}이 가리키는 --${target}이 없다`).toBeDefined();
      }
      // 다크 값은 가리키는 Codex 토큰이 든다 — `.dark`만의 상자에 shadcn 이름이 따로 적히지 않는다.
      const darkOnly = blocks.filter((block) => block.head.includes(".dark") && !block.head.includes(":root"));
      expect(
        darkOnly.some((block) => block.decls.has(`--${name}`)),
        `.dark가 --${name}을 따로 적는다`,
      ).toBe(false);
    }
  });
});
