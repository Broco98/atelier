// **검사가 `index.css`의 토큰을 읽는 길 — 한 벌이다.** 앱 코드는 이것을 부르지 않는다(토큰은 CSS가 읽는다).
// 부르는 쪽은 `tokens.test.ts`(Codex 토큰이 서 있는가) · `theme-tokens.test.ts`(터미널이 옮겨 적은 값) ·
// `panel-layout.test.ts`(패널 박자의 값)다 — 각자 정규식을 적으면 「어느 벌의 값인가」를 가르는 길이 여럿이 되어, 블록 순서가
// 바뀌는 날 한쪽만 조용히 다른 벌을 읽는다.
//
// **범위로 가른다 — 선언 순서로 가르지 않는다.** 라이트는 셀렉터에 `:root`가 든 상자, 다크는 `.dark`가 든 상자다
// (`:root, .dark`의 별칭 묶음은 둘 다다). `@theme`의 `--color-surface: var(--surface)` 같은 줄은 어느 범위도 아니다.
// 주석은 먼저 지운다 — 주석 안의 `--name: 값` 예시를 선언으로 읽지 않게.

export type CssScope = "light" | "dark";

/** 중괄호가 없는 가장 안쪽 상자 하나 — 셀렉터(쉼표로 가른 것)와 그 안의 사용자 속성 선언. */
export interface CssBlock {
  head: string[];
  decls: Map<string, string>;
}

export function cssBlocks(css: string): CssBlock[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...code.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, head, body]) => ({
    head: head.split(",").map((one) => one.trim()),
    decls: new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])),
  }));
}

const SELECTOR: Record<CssScope, string> = { light: ":root", dark: ".dark" };

/**
 * 그 범위에서 `--name`에 **적힌 글자 그대로**. 다크는 `.dark`에 없으면 라이트 값을 물려받는다(같은 값을 다시 적지
 * 않은 토큰). 없으면 `undefined`다.
 */
export function declared(blocks: CssBlock[], scope: CssScope, name: string): string | undefined {
  // 뒤에서부터 찾는다 — 같은 범위에 두 번 적혔으면 캐스케이드처럼 나중 것이 이긴다.
  const find = (selector: string) =>
    [...blocks].reverse().find((block) => block.head.includes(selector) && block.decls.has(`--${name}`))?.decls.get(`--${name}`);
  return scope === "dark" ? (find(SELECTOR.dark) ?? find(SELECTOR.light)) : find(SELECTOR.light);
}

/**
 * 그 범위에서 `--name`이 **실제로 풀리는 값** — 값이 `var(--다른이름)` 하나뿐이면 그 이름을 같은 범위에서 다시 읽는다.
 * 별칭이 아닌 식(`color-mix(…)`)은 글자 그대로 돌려준다. 없는 이름에 닿으면 던진다 — 그 자리는 브라우저에서 투명이 된다.
 */
export function resolved(blocks: CssBlock[], scope: CssScope, name: string): string {
  const value = declared(blocks, scope, name);
  if (value === undefined) throw new Error(`index.css의 ${scope} 범위에 --${name}이 없다`);
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  return alias ? resolved(blocks, scope, alias[1]) : value;
}
