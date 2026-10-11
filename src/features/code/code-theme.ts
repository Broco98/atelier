import { createCSSVariablesTheme, registerCustomTheme, type ThemeRegistration } from "@pierre/diffs";

/**
 * **코드 보기의 색 테마**(git-integration 판 01 S16 · 결정 35 · 38). 이름 하나로 라이브러리에 등록하고, 파일 보기와 워커 풀이
 * 이 이름으로 부른다.
 *
 * 색은 값이 아니라 **변수**다 — 라이브러리의 CSS 변수 테마(shiki `css-variables`)가 토큰마다 `var(--diffs-token-…, 기본값)`을
 * 칠하고, 기본값이 코드 보기 범위 토큰(`--code-syntax-*`, `index.css`의 `[data-code-view]`)을 가리킨다. 그 변수들은 강조 결과가
 * 서는 shadow DOM 안으로 상속돼 들어간다. 바탕과 글자는 앱 전역 토큰(`--background` · `--foreground`)을 그대로 읽는다 —
 * 전역 토큰은 고치지 않는다(결정 38).
 *
 * Codex `syntax-*` 일곱 ↔ shiki `css-variables` 토큰:
 *
 * | syntax-*  | 토큰                                  | 무엇이 그 색인가(TextMate 범위의 대표)                         |
 * |-----------|---------------------------------------|----------------------------------------------------------------|
 * | keyword   | `token-keyword`                       | `keyword` · `storage.type` · `storage.modifier`                |
 * | literal   | `token-constant`                      | `constant.numeric` · `constant.language` · `variable.other.constant` · `support` |
 * | string    | `token-string` · `token-string-expression` | `string` · 템플릿 · 정규식 · 태그 이름                    |
 * | variable  | `token-parameter`                     | `variable.parameter.function`                                  |
 * | name      | `token-function`                      | 함수 · 타입 · 클래스 이름                                       |
 * | attribute | (덧붙인 규칙)                          | `entity.other.attribute-name` — 라이브러리 표에선 `token-function`이라 따로 뗀다 |
 * | comment   | `token-comment` + 기울임(덧붙인 규칙)  | `comment`                                                      |
 *
 * 나머지(구두점 · 보통 변수 이름)는 글자색이다.
 *
 * **라이브러리의 `registerCustomCSSVariableTheme`을 곧장 쓰지 않는다.** 그 함수의 기울임 인자(`fontStyle`)는 마크다운 강조만
 * 살리고 주석을 기울이지 않으며, 테마의 종류를 `dark`로 둬 파일 보기가 `color-scheme: dark`로 선다(앱은 라이트만 낸다).
 * 그래서 같은 테마를 라이브러리의 `createCSSVariablesTheme`으로 지어 둘을 덧대고 `registerCustomTheme`으로 올린다.
 */
export const CODE_THEME = "atelier-code";

/** shiki `css-variables` 토큰 → 코드 보기 범위 토큰(`--code-syntax-*`). */
const TOKEN_DEFAULTS: Record<string, string> = {
  foreground: "var(--foreground)",
  background: "var(--background)",
  "token-keyword": "var(--code-syntax-keyword)",
  "token-constant": "var(--code-syntax-literal)",
  "token-string": "var(--code-syntax-string)",
  "token-string-expression": "var(--code-syntax-string)",
  "token-parameter": "var(--code-syntax-variable)",
  "token-function": "var(--code-syntax-name)",
  "token-comment": "var(--code-syntax-comment)",
};

function codeTheme(): ThemeRegistration {
  const base = createCSSVariablesTheme({
    name: CODE_THEME,
    variablePrefix: "--diffs-",
    variableDefaults: TOKEN_DEFAULTS,
    fontStyle: true,
  });
  return {
    ...base,
    type: "light",
    tokenColors: [
      ...(base.tokenColors ?? []),
      // 같은 범위의 뒤 규칙이 앞 규칙의 색을 덮는다(TextMate) — 속성 이름을 `token-function` 무리에서 뗀다.
      { scope: ["entity.other.attribute-name"], settings: { foreground: "var(--code-syntax-attribute)" } },
      // 색은 그대로 두고 기울임만 더한다 — 앞 규칙(`token-comment`)의 색과 합쳐진다.
      { scope: ["comment", "punctuation.definition.comment"], settings: { fontStyle: "italic" } },
    ],
  };
}

let registered = false;

/** 테마를 라이브러리에 한 번 올린다. 파일 보기 · 워커 풀이 이 이름을 풀기 **전에** 부른다. */
export function registerCodeTheme(): void {
  if (registered) return;
  registered = true;
  registerCustomTheme(CODE_THEME, () => Promise.resolve(codeTheme()));
}
