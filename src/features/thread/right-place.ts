import { useCallback, useEffect } from "react";
import { Store, useStore } from "@tanstack/react-store";
import type { Opened } from "./expanded";

// **오른쪽 자리**(restart 02a-9 · 구현 스펙 「02a — 오른쪽 자리」 · 스토리 93 · 94 · 96 · 보드 SummarySheet 「오른쪽 자리는 하나다」) — spec 패널과
// 요약 카드는 본문 카드 오른쪽의 같은 자리를 나눠 쓴다. 1440 창에서 둘을 함께 열면 대화에 남는 폭이 450이 안 되기 때문이다.
//
// - **값은 하나다** — `spec` · `summary` · 없음(`null`) 중 하나만 선다. 넓힌 카드가 연 것(`opened`)이 곁에 산다 — 요약 카드가 넓어져 있으면
//   그것을 본다. 넓힌 카드도 요약 카드라 값은 `summary`다.
// - **값은 작업공간마다, 밖 채팅은 채팅마다 하나다**(`workSeat` · `chatSeat`) — spec 패널이 작업공간 화면에 있어 값의 주인이 그 화면이다.
//   `/threads/:id`에 남는 작업공간 밖 채팅과 보관된 작업공간의 채팅은 그 채팅을 열쇠로 같은 곳(`rightPlaceStore`)에 쥔다. 한때 요약 카드의
//   열림은 Thread마다 이 컴퓨터에 적었고(02 S22) 넓힌 카드는 채팅 화면의 지역 상태였다. 이제 둘 다 이 값이고, 작업 패널 열림처럼 앱이 도는
//   동안 메모리에 산다.
// - **규칙은 SummarySheet의 표다**(`nextSeat`) — 요약 단추는 작은 카드를, 레일의 spec은 spec 패널을 세운다. 넓히면 spec 패널을 접고(사이드바는
//   넓힌 카드가 서 있는 동안 화면이 접는다 — `useFoldSidebar`), 넓힌 카드의 ×는 작은 카드로 돌린다 — spec 패널은 접힌 채다.
// - **넓힐 수 있는 자리만 넓힌 카드를 그린다**(`rightShown`) — 작업공간 밖 채팅은 작은 카드만 쓴다(구현 스펙 「02a — 작업공간 밖 채팅」).
//
// 탭을 옮길 때의 규칙(셸 · 파일 탭이 켜지면 값이 없음 · 다른 채팅 탭이면 작은 카드)은 02a-10이 더한다.

/** 오른쪽 자리에 선 것 — spec 패널 · 요약 카드 · 없음. */
export type RightPlace = "spec" | "summary" | null;

/** 오른쪽 자리의 값 — 선 것과, 요약 카드가 넓어져 있으면 그것이 연 것. 넓힌 카드는 값이 `summary`일 때만 있다. */
export interface RightSeat {
  readonly place: RightPlace;
  readonly opened: Opened | null;
}

/**
 * 오른쪽 자리를 바꾸는 손짓.
 * - `show` — 그것을 세운다(레일의 spec 칸 · 머리의 작업공간 이름 · PR의 「변경 사항 보기」가 넓힐 수 없는 자리). 이미 서 있으면 그대로다 —
 *   넓힌 카드도 걷지 않는다.
 * - `hide` — 그것이 서 있으면 걷는다(분할을 켤 때 spec 패널 · 레일의 켜진 칸을 다시 누름).
 * - `toggle` — 서 있으면 걷고 아니면 세운다(요약 단추 · 패널 토글 · ⌘Enter).
 * - `expand` — 요약 카드를 넓혀 그것을 연다(대화의 문서 카드 · PR의 「변경 사항 보기」 · 카드의 줄).
 * - `collapse` — 넓힌 카드의 × — 작은 카드로 돌아온다.
 */
export type RightMove =
  | { readonly kind: "show" | "hide" | "toggle"; readonly place: "spec" | "summary" }
  | { readonly kind: "expand"; readonly target: Opened }
  | { readonly kind: "collapse" };

const FIRST: Readonly<Record<"spec" | "summary" | "none", RightSeat>> = {
  spec: { place: "spec", opened: null },
  summary: { place: "summary", opened: null },
  none: { place: null, opened: null },
};

/** 아직 손대지 않은 자리의 값 — 작업공간은 spec 패널(표 첫 줄 「채팅을 처음 연다」), 밖 채팅은 빈 자리다. */
export function firstSeat(place: RightPlace): RightSeat {
  return FIRST[place ?? "none"];
}

/** 손짓 뒤의 값(SummarySheet 표). 바뀌지 않으면 같은 값을 돌려준다. */
export function nextSeat(seat: RightSeat, move: RightMove): RightSeat {
  switch (move.kind) {
    case "show":
      return seat.place === move.place ? seat : firstSeat(move.place);
    case "hide":
      return seat.place === move.place ? FIRST.none : seat;
    case "toggle":
      return seat.place === move.place ? FIRST.none : firstSeat(move.place);
    case "expand":
      return { place: "summary", opened: move.target };
    case "collapse":
      return seat.opened === null ? seat : { place: seat.place, opened: null };
  }
}

/** 오른쪽 자리에 보이는 것 — spec 패널이 열렸나, 요약 카드가 섰나, 넓힌 카드가 연 것(넓힐 수 있는 자리에서 넓어져 있을 때만). */
export interface RightShown {
  panel: boolean;
  card: boolean;
  opened: Opened | null;
}

/** 값에서 보이는 것을 읽는다. `expandable`이 거짓인 자리(작업공간 밖 채팅 · 보관된 작업공간의 채팅)는 넓어져 있어도 작은 카드다. */
export function rightShown(seat: RightSeat, expandable: boolean): RightShown {
  const card = seat.place === "summary";
  return { panel: seat.place === "spec", card, opened: card && expandable ? seat.opened : null };
}

/** 작업공간의 오른쪽 자리 열쇠. */
export function workSeat(slug: string): string {
  return `work:${slug}`;
}

/** `/threads/:id`에 선 채팅(작업공간 밖 · 보관된 작업공간)의 오른쪽 자리 열쇠. */
export function chatSeat(thread: string): string {
  return `thread:${thread}`;
}

/**
 * 오른쪽 자리를 쥐는 한 곳 — 열쇠(`workSeat` · `chatSeat`)마다의 값이다. 손대지 않은 열쇠는 없고, 읽는 쪽이 처음 값을 건넨다(`seatOf`). 앱이 도는
 * 동안 메모리에만 산다.
 */
export const rightPlaceStore = new Store<Readonly<Record<string, RightSeat>>>({});

/** 그 열쇠의 값 — 손대지 않았으면 처음 값이다. */
export function seatOf(state: Readonly<Record<string, RightSeat>>, key: string, first: RightPlace): RightSeat {
  return state[key] ?? firstSeat(first);
}

/** 그 열쇠의 값을 손짓으로 바꾼다. */
export function moveSeat(key: string, first: RightPlace, move: RightMove): void {
  rightPlaceStore.setState((state) => {
    const now = seatOf(state, key, first);
    const next = nextSeat(now, move);
    return next === now && state[key] !== undefined ? state : { ...state, [key]: next };
  });
}

/**
 * 그 열쇠의 값과 바꾸는 길. 열쇠가 없으면(고른 작업공간이 없다) 처음 값이고 바꾸는 길은 아무 일도 안 한다.
 *
 * **처음 읽은 값을 적어 둔다** — 작업공간의 처음 값은 분할 여부를 탄다(분할인 채 들어오면 spec 패널이 접혀 있다 — 결정 88). 적지 않으면 분할을 끄는
 * 순간 처음 값이 바뀌어 사람이 손대지 않은 패널이 저절로 열린다.
 */
export function useRightSeat(key: string | null, first: RightPlace): readonly [RightSeat, (move: RightMove) => void] {
  const seat = useStore(rightPlaceStore, (state) => (key === null ? firstSeat(first) : seatOf(state, key, first)));
  useEffect(() => {
    if (key === null || rightPlaceStore.state[key] !== undefined) return;
    rightPlaceStore.setState((state) => (state[key] === undefined ? { ...state, [key]: firstSeat(first) } : state));
    // 열쇠가 처음 설 때만 적는다 — 처음 값이 뒤에 바뀌어도 다시 적지 않는다.
  }, [key]);
  const move = useCallback(
    (next: RightMove) => {
      if (key !== null) moveSeat(key, first, next);
    },
    [key, first],
  );
  return [seat, move] as const;
}
