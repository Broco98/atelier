/**
 * 채팅의 **읽던 자리**(restart 02a-6 · 구현 스펙 「02a — 숨은 탭」). 숨은 채팅 탭은 내려간다 — 기록 구독과 조각 그리기가 멈추고, 기록 · 글 ·
 * 첨부 · 인용은 스토어에 있어 남는다. 굴림 자리만 화면과 함께 사라지므로 탭이 쥐었다가(`keepChatPlace`) 돌아오면 되살린다.
 *
 * 둘 중 하나다.
 *
 * - **바닥** — 바닥을 따라가던 탭이다. 돌아오면 그사이 쌓인 줄의 끝(바닥)으로 간다.
 * - **그 자리** — 위로 올려 읽던 탭이다. 위에서 잰 굴림 거리로 쥔다. 새 줄은 끝에만 쌓여 위에서 잰 거리는 그 줄들에 움직이지 않는다.
 */
export type ReadingPlace = { kind: "bottom" } | { kind: "at"; top: number };

/** 굴림 상자의 잰 값 — 위에서 굴린 거리 · 내용의 높이 · 보이는 높이. */
export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** 바닥까지 남은 거리. 내용이 상자보다 짧으면 0 아래다. */
const remaining = ({ scrollTop, scrollHeight, clientHeight }: ScrollBox) => scrollHeight - clientHeight - scrollTop;

/** 바닥에서 이만큼까지는 바닥이다 — 넘게 멀어지면 끊기고, 이 안으로 돌아오면 붙는다(Motion 보드 「바닥 따라가기」). */
const FOLLOW_SLACK = 24;

/**
 * 바닥에 붙어 있나 — 남은 거리가 24까지면 바닥이다. 바닥에 붙은 흐름은 끝을 따라가고, 떨어지면 「맨 아래로」가 선다(v1 티켓 46 ·
 * Motion 보드).
 */
export function atBottom(box: ScrollBox): boolean {
  return remaining(box) <= FOLLOW_SLACK;
}

/**
 * 굴린 뒤에도 바닥에 붙어 있나(restart 02b-7 · Motion 보드 「바닥 따라가기」 · Thread 보드 `onScroll`) — 위로 굴려 바닥에서 24 넘게 멀어지면
 * 끊기고, 바닥 24 안으로 돌아오면 다시 붙는다. 그 밖은 그대로다 — 따라가는 동안 글이 늘어 바닥이 잠깐 24 넘게 멀어져도 끊기지 않는다. 끊는
 * 것은 사람이 위로 굴린 것뿐이다. `lastTop`은 앞서 잰 굴림 거리다(따라가기가 내린 거리도 적는다). 1px 아래의 흔들림은 굴린 것이 아니다.
 */
export function stuckAfter(stuck: boolean, lastTop: number, box: ScrollBox): boolean {
  if (atBottom(box)) return true;
  if (box.scrollTop < lastTop - 1) return false;
  return stuck;
}

/** 바닥에 닿았다고 보는 남은 거리 — 반 px 아래는 굴려도 움직이지 않는다. */
const REACHED = 0.5;
/** 프레임마다 남은 거리에서 내려가는 몫. */
const FOLLOW_SHARE = 0.18;

/**
 * 바닥 따라가기의 한 걸음(restart 02b-7 · 구현 스펙 「02b — 대화창」 · Motion 보드) — 다음 프레임의 굴림 거리다. 남은 거리의 18%씩, 최소
 * 1px 내려가고 바닥을 지나지 않는다. 동작 줄이기면 그 프레임에 바닥으로 바로 간다. 바닥에 닿았으면(남은 거리가 반 px 아래) 걸음이 없다.
 * 다음 자리는 정수 px로 반올림한다 — WebKit은 굴림 거리의 소수를 버려(125.8 → 125) 그대로 건네면 걸음마다 18%보다 덜 간다.
 */
export function followStep(box: ScrollBox, reduce: boolean): number | null {
  const left = remaining(box);
  if (left <= REACHED) return null;
  const bottom = box.scrollTop + left;
  if (reduce) return bottom;
  return Math.min(bottom, Math.round(box.scrollTop + Math.max(1, left * FOLLOW_SHARE)));
}

/** 떠나는 탭이 쥘 자리 — 바닥을 따라가던 탭은 바닥이고, 아니면 위에서 굴린 거리다. */
export function leavingPlace(following: boolean, top: number): ReadingPlace {
  return following ? { kind: "bottom" } : { kind: "at", top };
}
