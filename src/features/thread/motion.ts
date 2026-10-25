// Thread 움직임의 셈(v1 티켓 43 · 구현 스펙 §14 「모션」 · 캔버스 Motion 보드). 움직임 자체는 CSS다(`index.css` 「Thread의 움직임」) — 여기는
// 스크립트가 알아야 하는 것, 토큰의 길이 · 동작 줄이기를 문서에서 읽는 길이다. 흐르는 답의 낱말 차례(`arrive` — 낱말마다 70ms씩 늦게)는
// 02 티켓 12가 걷었다 — Codex 답은 조각 사이 늦음 없이 선다(02 구현 스펙 §12).

/**
 * 모션 토큰의 길이(ms) — `--duration-relaxed` 같은 이름을 문서 뿌리에서 읽는다(`index.css`의 `@theme static`). 스크립트가
 * 수를 따로 들면 토큰을 고친 날 그 셈만 옛 박자로 남는다(`panelMotionMs`와 같은 까닭). 스타일시트 없이 그린 자리(정적 렌더 · 시험)에서는
 * 0이다 — 그때는 움직일 CSS도 없다.
 */
export function motionMs(name: string): number {
  if (typeof document === "undefined") return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const time = parseFloat(value);
  if (!Number.isFinite(time)) return 0;
  return value.endsWith("ms") ? time : time * 1000;
}

/**
 * 동작 줄이기를 켰나 — CSS가 아니라 스크립트가 움직이는 자리(부드러운 굴림)가 묻는다. CSS의 움직임은 유틸리티마다의 갈래가 끈다.
 */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
