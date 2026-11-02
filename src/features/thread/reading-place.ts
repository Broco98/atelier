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

/**
 * 바닥에 붙어 있나 — 남은 거리가 24 아래면 바닥이다. 바닥에 붙은 흐름은 끝을 따라가고, 떨어지면 「맨 아래로」가 선다(v1 티켓 46 ·
 * Motion 보드).
 */
export function atBottom({ scrollTop, scrollHeight, clientHeight }: ScrollBox): boolean {
  return scrollHeight - scrollTop - clientHeight < FOLLOW_SLACK;
}

const FOLLOW_SLACK = 24;

/** 떠나는 탭이 쥘 자리 — 바닥을 따라가던 탭은 바닥이고, 아니면 위에서 굴린 거리다. */
export function leavingPlace(following: boolean, top: number): ReadingPlace {
  return following ? { kind: "bottom" } : { kind: "at", top };
}
