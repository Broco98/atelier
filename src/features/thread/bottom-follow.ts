import { useCallback, useEffect, useRef, type RefObject } from "react";
import { reducedMotion } from "./motion";
import { followStep } from "./reading-place";

/**
 * **바닥 따라가기**(restart 02b-7 · 구현 스펙 「02b — 대화창」 · Motion 보드 「바닥 따라가기」 · Thread 보드 `loop`). 바닥에 붙은 흐름은 글이 늘면
 * 프레임마다 남은 거리의 18%씩, 최소 1px 내려간다 — 글이 늘어도 화면이 튀지 않는다. 동작 줄이기면 그 프레임에 바닥으로 바로 간다. 한 걸음의 셈은
 * `followStep`이고, 붙었나는 부르는 쪽이 쥔다(`stuck` — 굴림마다 `stuckAfter`로 고친다).
 *
 * - **언제 움직이나** — 굴림 상자와 그 안 내용의 크기가 바뀔 때(`ResizeObserver`)와 부를 때다(보냄 · 「맨 아래로」 · 다시 붙음). 기록 줄 · 흐르는
 *   글 · 펼침 · 늦게 서는 답 아래 줄 · 입력창 높이가 모두 크기로 온다. 바닥에 닿거나 끊기면 멈춘다 — 프레임마다 도는 고리를 두지 않는다.
 * - **따라가기가 내린 거리도 적는다**(`scrolled`) — 굴림 이벤트가 그 거리를 사람이 굴린 것으로 읽지 않게(위로 굴렸나는 앞서 잰 거리와 견준다).
 * - 굴림 상자에 `overflow-anchor: none`을 둔다(보드 `.ra-scroll`) — 브라우저의 굴림 닻이 따라가기와 함께 자리를 고치지 않게.
 */
export function useBottomFollow(
  scroller: RefObject<HTMLElement | null>,
  stuck: RefObject<boolean>,
  scrolled: RefObject<number>,
): () => void {
  const frame = useRef(0);
  const glide = useCallback(() => {
    if (frame.current !== 0 || !stuck.current) return;
    const step = () => {
      frame.current = 0;
      const el = scroller.current;
      if (!el || !stuck.current) return;
      const next = followStep(el, reducedMotion());
      if (next === null) return;
      const before = el.scrollTop;
      el.scrollTop = next;
      scrolled.current = el.scrollTop;
      // 더 내려가지 못했으면(반 px 아래의 반올림) 바닥이다.
      if (el.scrollTop !== before) frame.current = window.requestAnimationFrame(step);
    };
    frame.current = window.requestAnimationFrame(step);
  }, [scroller, stuck, scrolled]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(glide);
    watch.observe(el);
    for (const content of el.children) watch.observe(content);
    return () => {
      watch.disconnect();
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [scroller, glide]);
  return glide;
}
