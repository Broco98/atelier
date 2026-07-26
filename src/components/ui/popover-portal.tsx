import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// 드롭다운을 문서 최상위에 그린다 — 전체화면 다이어그램과 같은 이유다.
//
// absolute로 조상 안에 두면 그 조상 어딘가의 overflow-hidden에 잘린다. 실제로 작업 목록
// 패널은 폭 드래그 때문에 overflow-hidden을 갖고 있어서, 그 안의 프로젝트 필터 드롭다운이
// 패널 경계에서 글자가 잘려 나왔다. 포털로 body 직계에 두면 조상이 무엇을 하든 잘리지 않고,
// fixed라 조상에 변형이 걸려도 기준 상자가 viewport로 고정된다.
//
// 위치는 앵커의 화면 좌표에서 계산한다. 창 가장자리를 넘으면 8px 안쪽으로 물려
// 화면 밖으로 나가지 않게 한다 — 잘림을 옮겨 심지 않기 위한 것이다.

const VIEWPORT_MARGIN = 8;

export function PopoverPortal({
  anchorRef,
  align = "left",
  gap = 4,
  width,
  onClose,
  className,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  // 앵커의 어느 변에 맞출지 — left면 왼쪽 끝끼리, right면 오른쪽 끝끼리
  align?: "left" | "right";
  gap?: number;
  width: number;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const raw = align === "right" ? rect.right - width : rect.left;
      const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
      setPos({
        top: rect.bottom + gap,
        left: Math.min(Math.max(VIEWPORT_MARGIN, raw), Math.max(VIEWPORT_MARGIN, maxLeft)),
      });
    };
    place();
    // 스크롤은 버블링하지 않으므로 캡처로 받아 어느 조상이 움직여도 따라간다
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, align, gap, width]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width }}
        className={cn(
          "fixed z-50 overflow-hidden rounded-[13px] border border-border-strong bg-background shadow-lg",
          // 위치를 재기 전 한 프레임을 엉뚱한 자리에 그리지 않는다
          pos ? "visible" : "invisible",
          className,
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
