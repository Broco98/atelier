/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { cssBlocks, declared, resolved, SHADCN_NAMES } from "@/css-tokens";

// **앱 팔레트가 Codex 토큰으로 서 있는가**(codex-ds 결정 27 · 스펙 S1 · S2). 이름과 값은 DS 「Atelier」 2판이고,
// 남은 shadcn 이름은 값을 들지 않고 Codex 토큰을 가리킨다.
//
// **유틸리티는 Tailwind를 실제로 돌려 잰다(CSS 훑기).** `@theme`에 줄이 있다고 유틸리티가 서는 것은 아니다 — 시간은
// `--duration-*`가 아니라 `--transition-duration-*`여야 `duration-panel`이 CSS를 내고, 그림자는 값을 글자로 적으면 유틸리티가
// 그 값을 박아 넣어 `.dark`가 못 덮는다. 둘 다 빌드도 타입 검사도 조용하고, 화면에는 「안 움직인다」 · 「다크에서 선이
// 검다」로만 남는다. 쓰는 화면이 아직 없는 토큰(대화 · 도구 · diff · 구문색 · 컴포저)은 L3가 못 재므로 여기서 잰다.
// 화면의 실제 색은 L3가 computed style로 잰다 — 창 바탕 · 카드 · 본문 글자, 상태 넷, 터미널 카드의 `term-bg`(`e2e/frame.spec.ts`)와
// 부름의 점(`works-sidebar`) · 셸 탭의 채움(`terminal-tabs`)이다. Atelier 낱말은 티켓 06부터 화면이 있어, 여기서는 대표 유틸리티로만 선다.

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

/**
 * 그 셀렉터 규칙의 몸 **전부** — 안에 든 `@media` · `& > i` 같은 겹친 블록까지 중괄호를 세어 자른다(`ruleOf`는 첫 `}`에서 멈춘다).
 * 없으면 `null`이다.
 */
function nestedRuleOf(built: string, selector: string): string | null {
  const head = built.indexOf(`${selector} {`);
  return head < 0 ? null : bodyAt(built, built.indexOf("{", head));
}

/** `open` 자리의 `{`부터 짝이 맞는 `}`까지의 몸. */
function bodyAt(built: string, open: number): string | null {
  let depth = 0;
  for (let at = open; at < built.length; at++) {
    if (built[at] === "{") depth++;
    else if (built[at] === "}" && --depth === 0) return built.slice(open + 1, at);
  }
  return null;
}

/** 그 셀렉터로 시작하는 블록들 — `.x {}`와, 겹친 셀렉터만 든 유틸리티를 Tailwind가 펼친 `.x [data-…] {}`까지. 셀렉터째 잇는다. */
function blocksOf(built: string, selector: string): string[] {
  const found: string[] = [];
  for (let at = built.indexOf(selector); at >= 0; at = built.indexOf(selector, at + 1)) {
    if (/[\w-]/.test(built[at + selector.length] ?? "")) continue; // `.row-in`이 `.row-inner`에 걸리지 않게
    const open = built.indexOf("{", at);
    found.push(`${built.slice(at, open)}{${bodyAt(built, open)}}`);
  }
  return found;
}

/** 그 유틸리티가 낸 CSS — 없으면 `null`이다(이름을 Tailwind가 모른다). */
const utilityCss = (built: string, candidate: string) => blocksOf(built, `.${candidate}`).join("\n") || null;

/** 동작 줄이기의 미디어 질의 — `index.css`에 이 블록은 하나다(아래 「동작 줄이기는 한 곳」). */
const REDUCED = "@media (prefers-reduced-motion: reduce)";

/** 그 셀렉터(`.word-in` · `[data-doc-flash]` …)의 동작 줄이기 규칙 — 동작 줄이기 블록 안에서 그 셀렉터로 시작하는 규칙들이다. 없으면 `null`이다. */
function reducedOf(built: string, selector: string): string | null {
  const rules = blocksOf(built, REDUCED).flatMap((block) => blocksOf(block.slice(block.indexOf("{") + 1, -1), selector));
  return rules.length > 0 ? rules.join("\n") : null;
}

/** `@theme`에 적힌 그 이름의 값 — 테마 이름은 `:root` 상자가 아니라 `@theme` 상자에 선다(`declared`는 `:root`만 본다). */
const themed = (name: string) =>
  blocks.find((block) => block.head.some((one) => one.startsWith("@theme")) && block.decls.has(`--${name}`))?.decls.get(`--${name}`);

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

// **Codex 실측 값이 토큰으로 선다**(02 구현 스펙 §3~§12 · 티켓 01). DS 2판 표에 없는 값 — Codex 화면을 재어 시안(캔버스 v35)이 적은
// 것이다. 쓰는 화면은 02~12가 짓는다. 쓰는 자리가 아직 없어 L3가 못 재므로, 값과 유틸리티를 여기서 잰다.
describe("Codex 실측 색", () => {
  // 스펙 그대로다 — 이름 → 라이트 값. 다크는 적지 않는다(라이트만, v1 S34 — `.dark`에서는 라이트 값을 물려받는다).
  const COLORS: Record<string, string> = {
    "fg-bubble": "#0c274a",
    "fg-placeholder": "#c7c7c8",
    "fg-subtle": "#8e8f90",
    "fg-faint": "#a4a4a5",
    "fg-label": "#6a6b6d",
    "fg-icon": "#5d5f61",
    "fg-titlebar": "#898a8b",
    "fg-titlebar-disabled": "#cbcbcb",
    "fg-thinking": "#aeaeae",
    mine: "#2c67c5",
    "surface-codespan": "#e8e9e9",
    "surface-tray": "#f4f4f4",
    "border-panel": "#e8e8e8",
    "border-summary": "#dadadb",
    "border-slot": "rgba(26, 28, 31, 0.078)",
    "border-faint": "rgba(0, 0, 0, 0.04)",
    separator: "#e5e5e5",
    "separator-soft": "#ededed",
    "fill-nav-selected": "rgba(26, 28, 31, 0.053)",
    "fill-toggle-on": "#ebebec",
    "accent-solid-pending": "#a9c9fb",
  };

  it("스펙의 값이 라이트에 선다", () => {
    for (const [name, value] of Object.entries(COLORS)) expect(declared(blocks, "light", name), name).toBe(value);
  });

  // 내 차례 알약의 바탕은 사람 말풍선과 같은 옅은 파랑이다(스펙 §4 「#2c67c5 on #e8f3fe」) — 값을 다시 적지 않고 가리킨다.
  it("내 차례 알약의 바탕은 사람 말풍선의 바탕을 가리킨다", () => {
    expect(declared(blocks, "light", "mine-soft")).toBe("var(--bubble-user)");
    expect(resolved(blocks, "light", "mine-soft")).toBe("#e8f3fe");
  });

  it("새 색마다 그 이름의 유틸리티가 그 변수를 읽는다", async () => {
    const names = [...Object.keys(COLORS), "mine-soft"];
    const built = await utilities(names.map((name) => `bg-${name}`));
    for (const name of names) expect(ruleOf(built, `bg-${name}`), name).toContain(`background-color: var(--${name})`);
  });

  // 「생각 중」의 띠는 글자를 밝게 바래게 한다(스펙 §12) — 흰 75%. 띠를 그리는 유틸리티(12)만 읽어 유틸리티 이름을 내지 않는다.
  it("생각 중의 띠 색이 선다", () => {
    expect(declared(blocks, "light", "shimmer-band")).toBe("rgba(255, 255, 255, 0.75)");
  });
});

describe("Codex 실측 그림자", () => {
  // 스펙 그대로다 — 흰 판의 위 그림자(§3) · 사람 메뉴(§5) · 요약 카드(§7) · 입력창(§9 — DS `composer`의 바깥 흐림 40이 80이다).
  const SHADOWS: Record<string, string> = {
    "shadow-panel": "0 -1px 8px rgba(0, 0, 0, 0.03)",
    "shadow-menu": "0 0 0 0.5px rgba(26, 28, 31, 0.117), 0 8px 24px rgba(0, 0, 0, 0.08)",
    "shadow-summary": "0 6px 20px rgba(0, 0, 0, 0.06)",
    "shadow-prompt": "0 0 0 1px #0000000a, 0 2px 8px #0000000a, 0 4px 80px 8px #00000006",
  };

  // DS `composer`는 입력창 자리 카드 · 알림 카드 · 읽기만 줄도 읽는다 — 값을 고치지 않고 입력창의 새 이름(`prompt`)을 더했다.
  it("DS 입력창 그림자는 그대로다", () => {
    expect(declared(blocks, "light", "shadow-composer")).toBe("0 0 0 1px #0000000a, 0 2px 8px 0 #0000000a, 0 4px 40px 8px #00000006");
  });

  it("스펙의 값이 라이트에 서고, 유틸리티가 그 변수를 읽는다", async () => {
    const built = await utilities(Object.keys(SHADOWS));
    for (const [name, value] of Object.entries(SHADOWS)) {
      expect(declared(blocks, "light", name), name).toBe(value);
      expect(ruleOf(built, name), name).toContain(`--tw-shadow: var(--${name})`);
    }
  });
});

describe("Codex 실측 글자", () => {
  // 인라인 코드는 둘레 글자의 .92다(스펙 §8 — 고정 13px가 아니다). 줄 높이를 정하지 않는다 — 글줄의 줄 높이를 그대로 따라 줄이 들쭉날쭉하지 않다.
  it("인라인 코드 단계는 .92em이고 줄 높이를 따로 정하지 않는다", async () => {
    expect(themed("text-codespan")).toBe("0.92em");
    expect(themed("text-codespan--line-height")).toBeUndefined();
    expect(ruleOf(await utilities(["text-codespan"]), "text-codespan")).toContain("font-size: var(--text-codespan)");
  });

  // 첫 화면의 「무엇을 만들까요?」(스펙 §11 · 시안 F1-Home) — 28 / 34 · 400 · 자간 −0.2.
  it("첫 화면 물음 단계는 28 / 34에 자간 −0.2다", async () => {
    expect(themed("text-home")).toBe("28px");
    expect(themed("text-home--line-height")).toBe("34px");
    expect(themed("text-home--letter-spacing")).toBe("-0.2px");
    expect(themed("text-home--font-weight")).toBeUndefined();
    const rule = ruleOf(await utilities(["text-home"]), "text-home");
    expect(rule).toContain("font-size: var(--text-home)");
    expect(rule).toContain("letter-spacing: var(--tw-tracking, var(--text-home--letter-spacing))");
  });
});

describe("Codex 실측 크기", () => {
  // 대화 열과 입력창의 폭은 Codex 737이다(스펙 §9 — DS `size-thread` 48rem은 문서 · 설정 글 폭으로 남는다). 답이 흐르는 동안 끝을 옅게
  // 지우는 그라데이션의 길이는 240이다(스펙 §12 「답 글자 도착」).
  it("대화 열 737과 흐르는 답 끝의 페이드 240이 선다", async () => {
    expect(themed("size-column")).toBe("737px");
    expect(themed("size-stream-fade")).toBe("240px");
    expect(themed("size-thread"), "DS 글 폭은 그대로다").toBe("48rem");
    expect(await utilities(["max-w-(--size-column)"])).toContain("max-width: var(--size-column)");
  });
});

// **Codex 둥글기는 두 값이다**(02 구현 스펙 §4 · §7 · §8 · §10 · S24 · 위험). `corner-shape`를 쓸 수 있는 창에서는 superellipse(1.5)와 큰 값,
// 못 쓰는 창(WebKit — 앱과 L3)에서는 둥근 네모와 작은 값이다. 시안의 `.r-*`(`@supports (corner-shape: superellipse(1.5))`)과 같은 짝이다.
describe("Codex 둥글기", () => {
  // 이름 → [둥근 네모, superellipse]. 트레이와 입력창은 시안에서도 둥근 네모 하나다(Diff-Tokens 「입력창 22는 round」).
  const RADII: Record<string, [string, string | null]> = {
    codespan: ["6px", "7.5px"],
    row: ["10px", "12.5px"],
    summary: ["12px", "15px"],
    tray: ["15px", null],
    speech: ["16px", "22px"],
    slot: ["20px", "25px"],
    prompt: ["22px", null],
  };
  const SUPPORTS = "@supports (corner-shape: superellipse(1.5))";
  const superellipseRoot = blocksOf(css.replace(/\/\*[\s\S]*?\*\//g, ""), SUPPORTS)
    .map((block) => cssBlocks(block.slice(block.indexOf("{") + 1, -1)))
    .flat()
    .find((block) => block.head.includes(":root"));

  it("둥근 네모 값이 @theme에, superellipse 값이 corner-shape를 쓰는 창의 :root에 선다", () => {
    expect(superellipseRoot, `${SUPPORTS} 안의 :root가 없다`).toBeDefined();
    for (const [name, [round, superellipse]] of Object.entries(RADII)) {
      expect(themed(`radius-${name}`), name).toBe(round);
      expect(superellipseRoot?.decls.get(`--radius-${name}`), name).toBe(superellipse ?? undefined);
    }
  });

  it("반경 유틸리티가 그 변수를 읽고, superellipse 값은 빌드에도 남는다", async () => {
    const built = await utilities(Object.keys(RADII).map((name) => `rounded-${name}`));
    for (const name of Object.keys(RADII)) expect(ruleOf(built, `rounded-${name}`), name).toContain(`border-radius: var(--radius-${name})`);
    const rootInside = blocksOf(built, SUPPORTS).flatMap((block) => blocksOf(block, ":root")).join("\n");
    for (const [name, [, superellipse]] of Object.entries(RADII))
      if (superellipse) expect(rootInside, name).toContain(`--radius-${name}: ${superellipse}`);
  });

  // 모양은 그 창에서만 바꾼다 — `corner-shape`를 모르는 창에 `superellipse`를 적어도 해는 없지만, 같은 질의 안에 두어 큰 값과 늘 짝이다.
  it("corner-superellipse는 corner-shape를 쓰는 창에서만 모서리를 superellipse(1.5)로 바꾼다", async () => {
    // Tailwind는 질의를 셀렉터 밖으로 꺼내 `@supports (…) { .corner-superellipse { … } }`로 낸다.
    const built = await utilities(["corner-superellipse"]);
    const inside = blocksOf(built, SUPPORTS).flatMap((block) => blocksOf(block, ".corner-superellipse"));
    expect(inside, `${SUPPORTS} 안에 .corner-superellipse가 없다`).toHaveLength(1);
    expect(inside[0]).toContain("corner-shape: superellipse(1.5)");
    expect(blocksOf(built, ".corner-superellipse"), "질의 밖의 .corner-superellipse").toHaveLength(1);
  });
});

// **Codex 움직임이 토큰으로 선다**(02 구현 스펙 §12 · 캔버스 v35 Diff-Tokens 「움직임」 · Motion 보드). 움직임 자체(키프레임 · 유틸리티 · 동작 줄이기
// 갈래)는 그것을 그리는 티켓(07 · 09 · 10 · 12)이 짓는다 — 여기는 시간 · 곡선 · 늦음만이다.
describe("Codex 움직임 토큰", () => {
  // Motion 보드의 `--cx-spring` — spring {bounce .1}을 `linear()`로 옮긴 것이다. 사이드바 열고 닫기(.3s)가 쓴다.
  const SPRING =
    "linear(0, 0.042, 0.14, 0.261, 0.386, 0.504, 0.608, 0.697, 0.771, 0.83, 0.876, 0.911, 0.938, 0.958, 0.973, 0.983, 0.99, 0.995, 0.998, 1, 1.001, 1.001, 1.001, 1.002, 1)";
  // 스펙 §12의 줄 → 새 토큰과 값.
  const NEW: [줄: string, 토큰: string, 값: string][] = [
    ["툴팁 — 지연 200ms(호버 카드가 함께 읽는 `duration-tip` 150과 나눈다)", "delay-tip", "200ms"],
    ["사이드바 열고 닫기 — .3s(작업 패널과 나누는 `PANEL_MOTION` 220과 따로 둔다)", "duration-sidebar", "300ms"],
    ["사이드바 열고 닫기 — spring의 linear() 근사", "ease-spring", SPRING],
    ["생각 중 — 한 바퀴 4s(띠는 첫 1s에 지나간다)", "duration-think", "4000ms"],
    ["생각 중 — 보인 뒤 600ms에 시작", "delay-think", "600ms"],
    ["생각 중 · 작업 중 — steps(48)", "ease-shimmer", "steps(48, end)"],
    ["답 글자 도착 — .7s", "duration-arrive", "700ms"],
    ["답 글자 도착 — 곡선", "ease-arrive", "cubic-bezier(0.37, 0.55, 0.86, 0.88)"],
    ["작업 중 점 — 1s", "duration-wave", "1000ms"],
    ["작업 중 점 — steps(3)", "ease-wave", "steps(3, end)"],
    ["작업 중 점 — 점마다 .1s", "stagger-wave", "100ms"],
    ["보내기 아이콘 — .52s", "duration-morph", "520ms"],
  ];
  // 스펙 §12의 줄 가운데 지금 토큰과 같은 값인 것 → 그 토큰. 새 이름을 세우지 않는다.
  const SAME: [줄: string, 토큰: string, 값: string][] = [
    ["모델 피커 — .32s", "duration-dropdown", "320ms"],
    ["모델 피커 · 칩 등장 — cubic-bezier(.23,1,.32,1)", "ease-enter-snappy", "cubic-bezier(0.23, 1, 0.32, 1)"],
    ["펼침 · 꺾쇠 회전 — .3s", "duration-relaxed", "300ms"],
    ["펼침 · 접힘 — cubic-bezier(.19,1,.22,1)", "ease-enter", "cubic-bezier(0.19, 1, 0.22, 1)"],
    ["작업 중 — 2s", "duration-shimmer", "2000ms"],
    ["보내기 아이콘 — cubic-bezier(.4,0,.2,1)", "ease-default", "cubic-bezier(0.4, 0, 0.2, 1)"],
    ["칩 등장 — .28s", "duration-chip", "280ms"],
    ["요약 카드 비켜나기 · 입력창 바닥 줄 높이 — .22s", "duration-panel", "220ms"],
    ["요약 카드 비켜나기 · 입력창 바닥 줄 높이 — cubic-bezier(.2,0,0,1)", "ease-panel", "cubic-bezier(0.2, 0, 0, 1)"],
  ];

  it("스펙 §12의 새 시간 · 곡선 · 늦음이 토큰으로 선다", () => {
    for (const [줄, 토큰, 값] of NEW) expect(themed(토큰), 줄).toBe(값);
  });

  it("스펙 §12의 나머지 값은 지금 토큰과 같다", () => {
    for (const [줄, 토큰, 값] of SAME) expect(themed(토큰), 줄).toBe(값);
  });

  it("새 시간 · 곡선의 유틸리티가 그 변수를 읽는다", async () => {
    const DURATIONS = ["sidebar", "think", "arrive", "wave", "morph"];
    const EASES = ["spring", "shimmer", "arrive", "wave"];
    const built = await utilities([...DURATIONS.map((name) => `duration-${name}`), ...EASES.map((name) => `ease-${name}`)]);
    for (const name of DURATIONS)
      expect(ruleOf(built, `duration-${name}`), name).toContain(`transition-duration: var(--duration-${name})`);
    for (const name of EASES)
      expect(ruleOf(built, `ease-${name}`), name).toContain(`transition-timing-function: var(--ease-${name})`);
  });
});

// **움직임은 모션 보드의 토큰이다**(v1 티켓 43 · 구현 스펙 §14 「모션」 · 캔버스 v31 Motion 보드 「모션 토큰」 표). 표의 열두 줄이 시간 토큰
// 하나와 곡선 하나로 서고, Thread 화면의 움직임 유틸리티가 그 이름을 읽는다. 값을 유틸리티에 글자로 적으면 토큰을 고친 날 그 움직임만
// 옛 박자로 남는다 — 빌드도 타입 검사도 조용하고 화면에서는 「조금 느리다」로만 남는다. 동작 줄이기에서는 모두 멈춘 모양이다(보드
// 「동작 줄이기를 켜면 움직임은 모두 멈추고, 반짝임은 흐린 글자로, 점과 회전은 멈춘 모양으로 남습니다」).
describe("모션 토큰", () => {
  // 보드 표 그대로다 — 이름 · 시간 · 곡선. 곡선은 보드 머리말의 둘(감속 · 가감속)과 일정(linear)이다.
  const 감속 = "cubic-bezier(0.2, 0.8, 0.2, 1)";
  const 가감속 = "cubic-bezier(0.4, 0, 0.2, 1)";
  const BOARD: [보드이름: string, 토큰: string, 시간: string, 곡선: string][] = [
    ["단어 도착", "word", "500ms", 감속],
    ["칩 나타남", "chip", "280ms", 감속],
    ["승인 카드", "card", "320ms", 감속],
    ["Agent 참여", "join", "360ms", 감속],
    ["로그 펼침", "log", "240ms", 가감속],
    ["줄 바뀜", "swap", "200ms", 감속],
    ["버튼 바뀜", "button", "160ms", 감속],
    ["아래로 버튼", "jump", "180ms", 감속],
    ["문서 강조", "flash", "1600ms", 가감속],
    ["반짝임", "shimmer", "2000ms", "linear"],
    ["세 점", "pulse", "1250ms", 가감속],
    ["회전", "spin", "900ms", "linear"],
  ];

  it("보드 표의 열두 시간이 --duration-* 토큰으로 선다", () => {
    for (const [보드이름, 토큰, 시간] of BOARD) expect(themed(`duration-${토큰}`), 보드이름).toBe(시간);
  });

  it("감속 · 가감속이 --ease-settle · --ease-default다", () => {
    expect(themed("ease-settle")).toBe(감속);
    expect(themed("ease-default")).toBe(가감속);
  });

  it("보드 표의 「사이」 값(단어 · 로그 줄 · 점)이 --stagger-* 토큰으로 선다", () => {
    expect(themed("stagger-word")).toBe("70ms");
    expect(themed("stagger-log")).toBe("40ms");
    expect(themed("stagger-dot")).toBe("150ms");
  });

  // 유틸리티 이름 → 그 움직임이 읽는 시간 · 곡선(보드 표의 줄). 넓힌 카드의 보기는 모션 보드가 아니라 패널 박자다 — 같은 때 접히는
  // 사이드바와 같은 곡선이어야 합이 되흐르지 않는다(`ease-panel`의 머리말).
  const ease = (curve: string) => (curve === 감속 ? "var(--ease-settle)" : curve === 가감속 ? "var(--ease-default)" : curve);
  const byName = Object.fromEntries(BOARD.map(([보드이름, 토큰, , 곡선]) => [보드이름, { 토큰, 곡선: ease(곡선) }]));
  const MOTIONS: Record<string, { 토큰: string; 곡선: string }> = {
    "word-in": byName["단어 도착"],
    "chip-in": byName["칩 나타남"],
    "card-rise": byName["승인 카드"],
    "pop-in": byName["Agent 참여"],
    "log-open": byName["로그 펼침"],
    "row-in": byName["줄 바뀜"],
    "button-in": byName["버튼 바뀜"],
    "jump-in": byName["아래로 버튼"],
    "row-flash": byName["문서 강조"],
    "chat-shimmer": byName["반짝임"],
    "typing-dots": byName["세 점"],
    "writing-pulse": byName["세 점"],
    "spin-thread": byName["회전"],
    "view-in": { 토큰: "panel", 곡선: "var(--ease-panel)" },
  };

  it("Thread의 움직임 유틸리티가 그 시간 · 곡선 토큰을 읽는다", async () => {
    const built = await utilities(Object.keys(MOTIONS));
    for (const [candidate, { 토큰, 곡선 }] of Object.entries(MOTIONS)) {
      const rule = utilityCss(built, candidate);
      expect(rule, `${candidate}가 CSS를 안 낸다`).not.toBeNull();
      expect(rule, candidate).toContain(`var(--duration-${토큰})`);
      expect(rule, candidate).toContain(곡선);
      // 0은 고른 길이가 아니라 「없음」이다(늦음을 받지 않은 낱말의 `var(--word-delay, 0s)`).
      const times = (rule ?? "").match(/\b\d+(?:\.\d+)?(?:ms|s)\b/g) ?? [];
      expect(times.filter((time) => parseFloat(time) !== 0), `${candidate}에 손으로 적은 시간이 있다`).toEqual([]);
    }
  });

  it("동작 줄이기에서는 Thread의 움직임 유틸리티가 모두 멎는다", async () => {
    const built = await utilities(Object.keys(MOTIONS));
    for (const candidate of Object.keys(MOTIONS)) {
      const reduced = reducedOf(built, `.${candidate}`);
      expect(reduced, `${candidate}에 동작 줄이기 갈래가 없다`).not.toBeNull();
      expect(reduced, candidate).toMatch(/animation: none|transition: none/);
    }
  });

  // 로그 펼침의 「줄마다 40」은 화면의 줄마다다 — 잇따른 도구 줄은 한 묶음 상자에 들어 있어(`ThreadFlow`의 `Entries`) 상자의 차례로 늦추면
  // 도구 줄들이 한꺼번에 선다. 줄의 차례는 펼친 로그가 줄마다 적고(`--log-at`), 여섯째부터는 함께 선다.
  it("로그 펼침은 줄의 차례마다 --stagger-log씩 늦게 서고 여섯째부터 함께 선다", async () => {
    const rule = utilityCss(await utilities(["log-open"]), "log-open") ?? "";
    expect(rule).toContain("[data-log-run] > *");
    expect(rule).toContain("animation-delay: calc(min(var(--log-at, 0), 5) * var(--stagger-log))");
  });

  // 반짝임은 멎으면 흐린 글자다 — 띠(그라디언트)가 글자 한 자리에 굳어 진한 얼룩으로 남지 않는다.
  it("동작 줄이기의 반짝임은 띠 없는 흐린 글자다", async () => {
    const reduced = reducedOf(await utilities(["chat-shimmer"]), ".chat-shimmer") ?? "";
    expect(reduced).toContain("background: none");
    expect(reduced).toContain("-webkit-text-fill-color: var(--chat-shimmer-dim, var(--fg-tertiary))");
  });

  // 회전은 DS `Spinner`의 호다 — Thread 줄의 스피너만 보드 박자로 돌고(`spin-thread`), 앱의 다른 스피너는 Tailwind `animate-spin`의 1초
  // 그대로다(sidebar-active-band 결정 4 — L3 `works-sidebar`가 잰다). 회전의 키프레임이 실제로 선다.
  it("Thread 줄의 스피너가 회전 토큰으로 돌고 앱의 스피너는 1초 그대로다", async () => {
    const built = await utilities(["spin-thread", "animate-spin"]);
    expect(utilityCss(built, "spin-thread")).toContain("animation: spin var(--duration-spin) linear infinite");
    expect(ruleOf(built, "animate-spin")).toContain("animation: var(--animate-spin)");
    expect(built).toContain("--animate-spin: spin 1s linear infinite");
    expect(built).toMatch(/@keyframes spin \{/);
  });

  // 넓힌 카드 문서의 바뀐 줄(v1 티켓 35)은 클래스가 아니라 표식으로 칠한다 — 문서 강조와 같은 박자다.
  it("문서 칠함 표식이 문서 강조 토큰을 읽고 동작 줄이기에서 멎는다", async () => {
    const built = await utilities([]);
    expect(nestedRuleOf(built, "[data-doc-flash]")).toContain("var(--duration-flash) var(--ease-default)");
    expect(reducedOf(built, "[data-doc-flash]")).toContain("animation: none");
  });

  // **동작 줄이기는 한 곳이다**(코드-지도 §7.1 · 코드 리뷰 1차 B11) — 움직임마다 제 몸 안에 `@media`를 겹쳐 두면 새 움직임이 그 갈래를
  // 빠뜨려도 한눈에 보이지 않는다. 그 블록은 파일 맨 끝에 선다 — 레이어 밖 규칙(`[data-doc-flash]`)은 특이도가 같으면 뒤에 선 것이 이겨,
  // 앞에 선 블록은 그 움직임을 끄지 못한다.
  it("동작 줄이기 블록은 index.css 맨 끝의 하나다", () => {
    const queries = [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion/g)];
    expect(queries, "동작 줄이기 블록의 수").toHaveLength(1);
    const open = css.indexOf("{", queries[0].index);
    const body = bodyAt(css, open) ?? "";
    expect(css.slice(open + body.length + 2).trim(), "동작 줄이기 블록 뒤의 CSS").toBe("");
  });
});
