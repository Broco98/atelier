// Thread 움직임의 셈(v1 티켓 43 · 구현 스펙 §14 「모션」 · 캔버스 Motion 보드). 움직임 자체는 CSS다(`index.css` 「Thread의 움직임」) — 여기는
// 스크립트가 알아야 하는 둘이다: 흐르는 답의 낱말이 언제 서나(`arrive`), 그리고 토큰의 길이 · 동작 줄이기를 문서에서 읽는 길.

/** 흐르는 답 하나의 낱말 차례 — 낱말마다의 늦음(ms, 그 낱말이 처음 그려진 때부터)과 다음 낱말이 설 수 있는 가장 이른 때(시계 ms). */
export interface WordClock {
  readonly delays: readonly number[];
  readonly next: number;
}

export const NO_WORDS: WordClock = { delays: [], next: 0 };

/**
 * **낱말 도착 차례**(Motion 보드 「단어 도착」 — 단어 사이 70ms). 지금(`now`) 그린 글에 낱말이 `total`개면, 아직 세지 않은 낱말마다 언제 설지를
 * 정한다. 낱말은 앞 낱말보다 `gap`만큼 늦게 선다 — 한 조각에 온 낱말들은 차례로 서고, 앞 조각이 다 서기 전에 온 조각은 그 뒤에 이어
 * 선다(앞 낱말을 앞지르지 않는다).
 *
 * **밀린 늦음은 `cap`을 넘지 않는다** — 답이 사이보다 빨리 흐르면 늦음이 끝없이 쌓여 보이는 글이 온 글보다 점점 처지는데, 끝에 닿은
 * 낱말들은 함께 선다. 끝을 넘긴 차례를 당겨도 앞 낱말보다 먼저 서지는 않는다(앞 낱말들도 많아야 같은 끝에 선다).
 *
 * 이미 센 낱말은 다시 세지 않는다 — 글이 늘 때마다 다시 그려도 선 낱말의 늦음이 그대로라 애니메이션이 다시 걸리지 않는다. 같은 판을
 * 돌려주므로 두 번 그려도(StrictMode) 같다.
 */
export function arrive(clock: WordClock, total: number, now: number, gap: number, cap: number): WordClock {
  if (total <= clock.delays.length) return clock;
  const delays = [...clock.delays];
  let next = clock.next;
  for (let at = delays.length; at < total; at++) {
    const start = Math.max(now, Math.min(next, now + cap));
    delays.push(start - now);
    next = start + gap;
  }
  return { delays, next };
}

/**
 * 모션 토큰의 길이(ms) — `--stagger-word` · `--duration-word` 같은 이름을 문서 뿌리에서 읽는다(`index.css`의 `@theme static`). 스크립트가
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
