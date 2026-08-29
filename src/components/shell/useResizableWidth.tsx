import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// 패널이 **놓인 쪽**이다 — 핸들이 붙는 가장자리가 아니다. 핸들은 늘 그 반대쪽 가장자리,
// 즉 패널의 바깥 경계선 위에 얹히고 끄는 방향의 부호도 거기서 따라온다.
export type PanelSide = "left" | "right";

export interface ResizableWidth {
  width: number;
  dragging: boolean;
  side: PanelSide;
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: () => void;
    onDoubleClick: () => void;
  };
}

// 드래그 중 문서 전체의 텍스트 선택을 막고 커서를 리사이즈 모양으로 고정한다 (index.css의 body.resizing).
// 해제가 누락되면 앱 전체에서 글자를 선택할 수 없고 재시작 외엔 복구 수단이 없다 — 종료 경로마다 반드시 끈다.
export function setResizing(on: boolean) {
  document.body.classList.toggle("resizing", on);
}

// 드래그 한 번의 폭 계산. 훅 밖으로 떼어낸 이유는 하나다 — 부호가 뒤집혀도 화면은 멀쩡히
// 그려져서, 포인터 이벤트를 흉내내지 않고 방향을 검사할 수 있는 자리가 여기밖에 없다.
// side에 기본값을 두지 않는다: 기본값을 정하는 지점은 훅 하나여야 한다. 여기에도 두면
// 훅 쪽 기본값이 뒤집혀도 이 함수의 테스트는 초록으로 남는다.
export function nextWidth({
  side,
  startX,
  startWidth,
  clientX,
  min,
  max,
}: {
  side: PanelSide;
  startX: number;
  startWidth: number;
  clientX: number;
  min: number;
  max: number;
}): number {
  const delta = clientX - startX;
  const raw = startWidth + (side === "right" ? -delta : delta);
  // **폭은 정수다.** 트랙패드·레티나에서 clientX가 분수로 들어와 그대로 두면
  // `326.3828125px` 같은 폭이 남는다. 그러면 패널 경계선이 장치 픽셀 격자에 얹히는
  // 자리가 본문 재배치 때마다 달라져 1px씩 떨린다. 끄는 감각은 정수로도 같다.
  return Math.round(Math.min(max, Math.max(min, raw)));
}

// 패널 폭 드래그 조절 + 더블클릭으로 기본 폭 복원. localStorage에 유지된다.
// side를 생략하면 왼쪽 패널이다 — 이 기본값이 오늘 나가 있는 목록 패널들의 부호를 정한다.
function useResizableWidth(
  key: string,
  defaultWidth: number,
  min: number,
  max: number,
  side: PanelSide = "left",
): ResizableWidth {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    // 반올림은 여기서도 한다 — 이 값을 정수로 만들기 전에 저장된 분수 폭이 남아 있다
    // (nextWidth 주석 참조). 새로 끄는 순간이 아니라 **다음에 앱을 켤 때** 걸린다.
    return saved >= min && saved <= max ? Math.round(saved) : defaultWidth;
  });
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, width: 0 });

  // 드래그 종료 — pointerup·pointercancel 어느 쪽으로 끝나도 같은 정리를 한다
  const endDrag = () => {
    setResizing(false);
    setDragging(false);
    setWidth((value) => {
      localStorage.setItem(key, String(value));
      return value;
    });
  };

  return {
    width,
    dragging,
    side,
    handleProps: {
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        setResizing(true);
        setDragging(true);
      },
      onPointerMove: (e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setWidth(
          nextWidth({
            side,
            startX: start.current.x,
            startWidth: start.current.width,
            clientX: e.clientX,
            min,
            max,
          }),
        );
      },
      onPointerUp: (e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        endDrag();
      },
      // 웹뷰/OS가 드래그를 가로채면 pointerup이 오지 않는다 — 캡처는 이미 풀린 상태다
      onPointerCancel: endDrag,
      onDoubleClick: () => {
        setWidth(defaultWidth);
        localStorage.setItem(key, String(defaultWidth));
      },
    },
  };
}

// 패널의 바깥쪽 가장자리에 얹는 리사이즈 핸들 — 어느 쪽인지는 control.side가 정한다.
// 부모는 relative여야 한다.
// 호버 시 세로 중앙이 가장 밝고 위아래로 갈수록 옅어지는 은은한 글로우 라인.
export function ResizeHandle({
  control,
}: {
  // **폭을 어떻게 드는지는 안 본다.** px로 드는 것(`useResizableWidth`)과 비율로 드는 것
  // (`useSplitRatio`)이 같은 핸들을 쓴다 — 잡는 자리와 글로우가 갈리면 같은 제스처가
  // 화면마다 다르게 보인다.
  control: Pick<ResizableWidth, "dragging" | "side" | "handleProps">;
}) {
  // 드래그 도중 핸들이 사라지면(Cmd+B·Cmd+Enter로 패널 접기) pointerup도 pointercancel도 오지 않는다.
  // 억제가 영구히 남는 유일한 경로라 언마운트에서 무조건 푼다
  useEffect(() => () => setResizing(false), []);

  const visible = control.dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100";
  const edge = control.side === "right" ? "left-0" : "right-0";
  return (
    <div
      {...control.handleProps}
      title="드래그로 폭 조절 · 더블클릭으로 기본 폭"
      className={cn(
        "group absolute inset-y-0 z-30 w-[5px] cursor-col-resize touch-none",
        edge,
      )}
    >
      {/* 심 라인 — blur 층은 WebKit에서 잔상(스미어)을 남겨 그라데이션 단일 층만 쓴다.
          패널 경계선에 딱 붙인다 — 왼쪽 패널이면 자기 border-r 위, 오른쪽 패널이면 왼쪽 끝 */}
      <div
        className={cn(
          "absolute inset-y-0 w-[2px] bg-linear-to-b from-transparent via-primary/55 to-transparent transition-opacity duration-150",
          edge,
          visible,
        )}
      />
    </div>
  );
}

export default useResizableWidth;
