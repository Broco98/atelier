/**
 * 입력기가 아직 그 키를 물고 있다는 신호. xterm도 같은 값을 같은 뜻으로 쓴다.
 *
 * WKWebView의 한글 경로에는 `compositionstart`가 한 건도 없어(실측 — `features/terminal/terminal-ime.ts` 머리말) 키다운의
 * `isComposing`이 서지 않을 수 있다. 그래도 입력기가 문 키는 이 값으로 온다 — 한글 타자, 조합 중의 백스페이스 · Esc가 그렇다
 * (`features/terminal/shell-input.ts`의 `ime`).
 */
export const IME_KEYCODE = 229;

/**
 * 이 키다운을 입력기가 쥐고 있나 — 조합 중이거나(`isComposing`) 입력기가 문 키다(`IME_KEYCODE`). 쥔 키는 조합을 끝내거나 거두는
 * 키라 앱의 키(저장 · 취소)로 읽지 않는다. 둘을 함께 보는 것은 브라우저마다 서는 쪽이 달라서다 — 조합 사건이 오는 엔진은
 * `isComposing`을 세우고, 위 WKWebView 경로는 keyCode만 남긴다.
 */
export const imeHolds = (event: { isComposing: boolean; keyCode: number }): boolean =>
  event.isComposing || event.keyCode === IME_KEYCODE;
