import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ResizableWidth {
  width: number;
  dragging: boolean;
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
function setResizing(on: boolean) {
  document.body.classList.toggle("resizing", on);
}

// 패널 폭 드래그 조절 + 더블클릭으로 기본 폭 복원. localStorage에 유지된다.
function useResizableWidth(
  key: string,
  defaultWidth: number,
  min: number,
  max: number,
): ResizableWidth {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved >= min && saved <= max ? saved : defaultWidth;
  });
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, width: 0 });

  const clamp = (value: number) => Math.min(max, Math.max(min, value));

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
    handleProps: {
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        setResizing(true);
        setDragging(true);
      },
      onPointerMove: (e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setWidth(clamp(start.current.width + e.clientX - start.current.x));
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

// 패널 오른쪽 가장자리에 얹는 리사이즈 핸들 — 부모는 relative여야 한다.
// 호버 시 세로 중앙이 가장 밝고 위아래로 갈수록 옅어지는 은은한 글로우 라인.
export function ResizeHandle({ control }: { control: ResizableWidth }) {
  // 드래그 도중 핸들이 사라지면(Cmd+B·Cmd+Enter로 패널 접기) pointerup도 pointercancel도 오지 않는다.
  // 억제가 영구히 남는 유일한 경로라 언마운트에서 무조건 푼다
  useEffect(() => () => setResizing(false), []);

  const visible = control.dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100";
  return (
    <div
      {...control.handleProps}
      title="드래그로 폭 조절 · 더블클릭으로 기본 폭"
      className="group absolute inset-y-0 right-0 z-30 w-[5px] cursor-col-resize touch-none"
    >
      {/* 심 라인 — blur 층은 WebKit에서 잔상(스미어)을 남겨 그라데이션 단일 층만 쓴다.
          right-0으로 패널 경계선(border-r)에 딱 붙인다 */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-[2px] bg-linear-to-b from-transparent via-primary/55 to-transparent transition-opacity duration-150",
          visible,
        )}
      />
    </div>
  );
}

export default useResizableWidth;
