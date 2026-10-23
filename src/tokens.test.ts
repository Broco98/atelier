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

/** 그 유틸리티의 동작 줄이기 갈래 — 몸 안에 겹친 `@media`이거나, Tailwind가 펼쳐 낸 `@media` 안의 그 유틸리티 규칙이다. */
function reducedOf(built: string, candidate: string): string | null {
  const QUERY = "@media (prefers-reduced-motion: reduce)";
  const inside = nestedRuleOf(nestedRuleOf(built, `.${candidate}`) ?? "", QUERY);
  if (inside !== null) return inside;
  const outside = blocksOf(built, QUERY)
    .map((block) => block.slice(block.indexOf("{") + 1, -1))
    .filter((body) => blocksOf(body, `.${candidate}`).length > 0);
  return outside.length > 0 ? outside.join("\n") : null;
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
      const reduced = reducedOf(built, candidate);
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
    const reduced = reducedOf(await utilities(["chat-shimmer"]), "chat-shimmer") ?? "";
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
    const rule = nestedRuleOf(await utilities([]), "[data-doc-flash]") ?? "";
    expect(rule).toContain("var(--duration-flash) var(--ease-default)");
    expect(nestedRuleOf(rule, "@media (prefers-reduced-motion: reduce)")).toContain("animation: none");
  });
});
