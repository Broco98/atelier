// **DS의 시스템 글꼴 두 줄과, 그 줄을 견주는 길** — 앱 전체 mono가 그 줄인지(`features/terminal/theme-tokens.test.ts`)와
// 실제 요소가 그 줄로 서는지(`e2e/system-font.spec.ts`)가 함께 쓴다. 줄의 정본은 DS(「Atelier」 2판 `tokens.json`의
// `type.families`)이고, 앱 쪽은 `index.css`의 `--font-sans` · `--font-mono`다. 두 검사가 그 둘을 맞대려고 DS 줄을 여기 한 벌
// 글자 그대로 옮겨 둔다 — DS 줄이 바뀌면 여기와 `index.css` 두 곳을 고친다.
//
// 테스트 파일이 아니다 — `*.test.ts`면 vitest가 이것을 테스트로 돌린다. 앱 코드는 이것을 부르지 않는다.

/** DS `type.families.sans` — macOS는 SF Pro(한글은 Apple SD Gothic Neo)로 그리고, 그 글꼴이 없는 OS는 제 sans-serif로 흐른다. */
export const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif';

/** DS `type.families.mono` — macOS는 SF Mono로 그리고, 그 글꼴이 없는 OS는 제 고정폭으로 흐른다. */
export const SYSTEM_MONO = 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * 따옴표와 공백만 다른 것은 같은 목록이다 — 이름에 따옴표를 붙이는 방식이 CSS 소스(`"SF Mono"`) · computed 값(엔진이 정한다) ·
 * xterm 옵션 문자열(따옴표 없는 한 줄)마다 다르다.
 */
export const fontList = (raw: string) =>
  raw
    .replace(/['"]/g, "")
    .split(",")
    .map((one) => one.trim())
    .join(", ");
