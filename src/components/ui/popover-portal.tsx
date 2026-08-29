import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// 드롭다운·카드를 문서 최상위에 그린다 — 전체화면 다이어그램과 같은 이유다.
//
// absolute로 조상 안에 두면 그 조상 어딘가의 overflow-hidden에 잘린다. 실제로 목록
// 패널은 폭 드래그 때문에 overflow-hidden을 갖고 있어서, 그 안의 드롭다운이
// 패널 경계에서 글자가 잘려 나왔다. 포털로 body 직계에 두면 조상이 무엇을 하든 잘리지 않고,
// fixed라 조상에 변형이 걸려도 기준 상자가 viewport로 고정된다.
//
// 위치는 앵커의 화면 좌표에서 계산한다. 창 가장자리를 넘으면 8px 안쪽으로 물려
// 화면 밖으로 나가지 않게 한다 — 잘림을 옮겨 심지 않기 위한 것이다. 세로도 같이 물리므로
// 목록 아래쪽 항목에 붙어도 아래가 잘리지 않는다.

const VIEWPORT_MARGIN = 8;

export function PopoverPortal({
  anchorRef,
  side = "bottom",
  align = "left",
  gap = 4,
  width,
  onClose,
  className,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  // 앵커의 어느 쪽에 붙일지 — bottom은 아래, right는 오른쪽 옆(윗변을 맞춘다)
  side?: "bottom" | "right";
  // side가 bottom일 때 앵커의 어느 변에 맞출지 — left면 왼쪽 끝끼리, right면 오른쪽 끝끼리
  align?: "left" | "right";
  gap?: number;
  width: number;
  // 넘기면 바깥 클릭을 받아 닫는 투명 막이 함께 깔린다. 호버로 여닫는 쪽은 넘기지 않는다 —
  // 막이 포인터를 가로채면 앵커에서 곧바로 mouseleave가 나 열자마자 닫힌다.
  onClose?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      // 세로로 물리려면 실제 높이가 필요하다 — 내용에 따라 달라져 상수로 둘 수 없다.
      // 레이아웃 이펙트라 이 시점에 카드는 이미 그려져 있다(아직 invisible일 뿐이다).
      const height = cardRef.current?.offsetHeight ?? 0;
      // **앵커에서만 잰다** — 앵커를 품은 패널의 경계에서 재던 판은 걷었다(결정 30).
      // 패널 밖으로 밀어내면 카드가 그 경계선에 딱 맞춰 서서 옆 화면에 끼워 넣은 칸처럼
      // 보인다. 여기 팝오버는 문서 최상위에 뜨는 **떠 있는 것**이라, 앵커 옆에 붙어
      // 패널 여백을 덮고 올라서는 편이 그 사실을 말한다.
      const rawLeft =
        side === "right" ? rect.right + gap : align === "right" ? rect.right - width : rect.left;
      const rawTop = side === "right" ? rect.top : rect.bottom + gap;
      const fit = (value: number, size: number, limit: number) =>
        Math.min(Math.max(VIEWPORT_MARGIN, value), Math.max(VIEWPORT_MARGIN, limit - size - VIEWPORT_MARGIN));
      setPos({
        top: fit(rawTop, height, window.innerHeight),
        left: fit(rawLeft, width, window.innerWidth),
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
  }, [anchorRef, side, align, gap, width]);

  return createPortal(
    <>
      {onClose && <div className="fixed inset-0 z-40" onClick={onClose} />}
      <div
        ref={cardRef}
        // 이 상자는 body 직계라 조상으로 못 찾는다 — 자리를 재는 검사가 붙잡을 손잡이다
        data-popover
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
