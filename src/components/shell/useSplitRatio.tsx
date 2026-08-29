import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { setResizing } from "./useResizableWidth";

/**
 * 분할 두 열의 경계 — **비율로 든다.**
 *
 * 옆의 `useResizableWidth`는 px를 든다. 그것이 맞는 자리는 **폭이 내용으로 정해지는 것들**
 * 이다(작업 패널은 경로와 파일 이름이 들어가야 하고, 사이드바는 제목이 들어가야 한다) —
 * 창이 넓어져도 그 폭은 더 필요하지 않다.
 *
 * 분할은 반대다. 두 열이 **같은 본문을 나눠 갖는 것**이라 창이 넓어지면 둘 다 넓어져야
 * 하고, 기본값도 「반」이지 「480px」이 아니다. px로 두면 창 크기마다 반이 아닌 자리에서
 * 시작하고(실측: 창 1512에서 480은 본문의 38%였다), 창을 늘리면 오른쪽 열만 자란다.
 * 판 05 spec이 저장 키를 `work-split-ratio`라 적어 둔 것이 이 뜻이었다.
 */

/**
 * 한 열이 가질 수 있는 최소 비율. 양쪽에 걸리므로 반대쪽은 `1 - min`이 상한이다.
 *
 * **결정 88이 걱정한 것이 이 값이다** — 터미널이 너무 좁으면 `claude` TUI가 깨진다.
 * 비율이라 창이 좁으면 그만큼 같이 좁아지는 것은 감수한다: 창 자체가 좁을 때 지킬 수 있는
 * 하한은 없고, 그 경우 사람이 분할을 끄는 것이 답이다.
 */
export const SPLIT_MIN = 0.25;

/**
 * 드래그 한 번의 비율 계산. 훅 밖에 있는 이유는 `nextWidth`와 같다 — 부호가 뒤집혀도
 * 화면은 멀쩡히 그려져서, 포인터를 흉내내지 않고 방향을 검사할 자리가 여기뿐이다.
 *
 * **절대 위치가 아니라 시작점에서의 이동으로 잰다.** 절대 위치로 재면 핸들(5px 띠)의 어디를
 * 잡았느냐에 따라 잡는 순간 경계가 그만큼 튄다.
 */
export function nextRatio({
  startRatio,
  startX,
  clientX,
  hostWidth,
  min,
}: {
  startRatio: number;
  startX: number;
  clientX: number;
  hostWidth: number;
  min: number;
}): number {
  // 폭을 못 읽었으면(아직 안 그려짐) 움직이지 않는다 — 0으로 나누면 비율이 무한이 된다.
  if (hostWidth <= 0) return startRatio;
  const raw = startRatio + (clientX - startX) / hostWidth;
  return Math.min(1 - min, Math.max(min, raw));
}

/** 더블클릭으로 되돌아가는 데 걸리는 시간. 패널이 접히는 것과 **같은 값**이다. */
const SNAP_MS = 220;

export interface SplitRatio {
  /** 왼쪽 열이 갖는 몫. 오른쪽은 나머지를 먹는다. */
  ratio: number;
  dragging: boolean;
  /**
   * 지금 폭을 **애니메이션해야 하는가**(더블클릭으로 반반에 돌아가는 중).
   *
   * 상시로 트랜지션을 걸 수 없다: 폭이 비율이라 **창을 끌 때마다** 계산값이 바뀌고,
   * 그러면 창 크기를 조절하는 내내 두 열이 손을 늦게 따라온다. 드래그 중에도 같은 이유로
   * 꺼야 한다. 남는 것은 「한 번에 훌쩍 뛰는」 이 순간뿐이다.
   */
  snapping: boolean;
  side: "left";
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: () => void;
    onDoubleClick: () => void;
  };
}

/** `host`는 두 열을 담은 상자다 — 비율의 분모가 그 폭이다. */
function useSplitRatio(key: string, host: RefObject<HTMLElement | null>): SplitRatio {
  const [ratio, setRatio] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    // 범위 밖이거나 숫자가 아니면 **반**이다. `Number("")`가 0이라 하한 비교가 그것도 막는다.
    return saved >= SPLIT_MIN && saved <= 1 - SPLIT_MIN ? saved : 0.5;
  });
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const start = useRef({ x: 0, ratio: 0.5 });
  const snapTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(snapTimer.current), []);

  // 놓든 뺏기든 같은 정리를 한다 — `setResizing`이 안 풀리면 앱 전체에서 글을 선택할 수 없다.
  const endDrag = () => {
    setResizing(false);
    setDragging(false);
    setRatio((value) => {
      localStorage.setItem(key, String(value));
      return value;
    });
  };

  return {
    ratio,
    dragging,
    snapping,
    side: "left",
    handleProps: {
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, ratio };
        setResizing(true);
        setDragging(true);
      },
      onPointerMove: (e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const box = host.current?.getBoundingClientRect();
        setRatio(
          nextRatio({
            startRatio: start.current.ratio,
            startX: start.current.x,
            clientX: e.clientX,
            hostWidth: box?.width ?? 0,
            min: SPLIT_MIN,
          }),
        );
      },
      onPointerUp: (e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        endDrag();
      },
      onPointerCancel: endDrag,
      // 기본값은 **반**이다 — 두 열이 같은 본문을 나눠 갖는다는 것이 이 뷰의 전부다.
      //
      // 여기서만 애니메이션한다. 끄는 동안은 손을 그대로 따라와야 하고 창을 끄는 동안도
      // 마찬가지라(위 `snapping` 주석), 훌쩍 뛰는 자리는 이 한 번뿐이다.
      onDoubleClick: () => {
        setSnapping(true);
        setRatio(0.5);
        localStorage.setItem(key, "0.5");
        window.clearTimeout(snapTimer.current);
        snapTimer.current = window.setTimeout(() => setSnapping(false), SNAP_MS + 20);
      },
    },
  };
}

export default useSplitRatio;
