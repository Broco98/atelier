import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ResizableWidth {
  width: number;
  dragging: boolean;
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onDoubleClick: () => void;
  };
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

  return {
    width,
    dragging,
    handleProps: {
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        setDragging(true);
      },
      onPointerMove: (e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setWidth(clamp(start.current.width + e.clientX - start.current.x));
      },
      onPointerUp: (e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
        setWidth((value) => {
          localStorage.setItem(key, String(value));
          return value;
        });
      },
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
  const visible = control.dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100";
  return (
    <div
      {...control.handleProps}
      title="드래그로 폭 조절 · 더블클릭으로 기본 폭"
      className="group absolute inset-y-0 right-0 z-30 w-[5px] cursor-col-resize touch-none"
    >
      {/* 퍼지는 글로우 층 */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-full bg-linear-to-b from-transparent via-primary/25 to-transparent blur-[2px] transition-opacity duration-200",
          visible,
        )}
      />
      {/* 심 라인 */}
      <div
        className={cn(
          "absolute inset-y-0 right-[1.5px] w-[2px] bg-linear-to-b from-transparent via-primary/55 to-transparent transition-opacity duration-200",
          visible,
        )}
      />
    </div>
  );
}

export default useResizableWidth;
