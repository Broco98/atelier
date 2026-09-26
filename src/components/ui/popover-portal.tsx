import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// **떠 있는 것 가운데 부품(Base UI)으로 옮기지 않은 둘이 쓰는 카드다.** 쓰는 자리는 둘뿐이다.
//
// 1. **사이드바 작업 행의 호버 카드**(`SidebarWorkList`). 사이드바 구조는 이 전환의 범위 밖이고
//    (`sidebar-active-band` 결정 3), 호버 카드는 HoverCard로 바꾸지 않는다. 여닫음은 행의 hover가
//    온전히 소유한다 — 350ms 지연, 끄는 동안 억제, 행이 화면에서 빠지거나 사이드바가 접히면 함께
//    닫힘. 키보드로는 닿지 않고(스토리 38) 포커스도 안 받는다. 스크린리더가 들을 말은 행 버튼의
//    이름과 설명이 든다.
// 2. **틀 이동 힌트**(`SpecViewer`의 `FrameFocusHint`). HTML 문서의 프레임이 포커스를 쥔 동안에만
//    서서 「⌃Tab·⌘W가 이 문서 안으로 들어간다」를 말한다. 여는 트리거도 닫는 몸짓도 없고, 포커스를
//    뺏으면 안 되며(프레임 안 조작이 계속 먹어야 한다), 포인터도 안 받는다(`pointer-events-none`).
//
// 둘 다 **여닫음과 포커스를 부품에 맡길 것이 없다** — Popover·HoverCard·Tooltip이 들고 오는 것
// (트리거, 바깥 누르기와 Esc 닫기, 첫 포커스, 열림 애니메이션)이 이 둘에게는 없어야 할 것이다.
// 그래서 여기는 **자리 잡기 하나만** 한다. 여닫는 떠 있는 것(메뉴·Popover·Select·창)은
// `components/ui`의 부품이 든다. 카드의 모양(13px 모서리 · 강한 테두리 · 큰 그림자 · 흰 바탕)은
// 이 카드와 그 부품들이 함께 부르는 index.css의 `floating-card` 한 곳에 있다(각 부품 파일 머리의
// 「옛 PopoverPortal 카드」가 이 값이다).
//
// 문서 최상위(body 직계)에 그리는 이유는 잘림이다. absolute로 조상 안에 두면 그 조상 어딘가의
// overflow-hidden에 잘린다 — 사이드바는 폭 드래그 때문에 overflow-hidden을 갖는다. fixed라
// 조상에 변형이 걸려도 기준 상자가 viewport로 고정된다.
//
// 위치는 앵커의 화면 좌표에서 계산한다. 창 가장자리를 넘으면 8px 안쪽으로 물려
// 화면 밖으로 나가지 않게 한다 — 잘림을 옮겨 심지 않기 위한 것이다. 세로도 같이 물리므로
// 목록 아래쪽 행에 붙어도 아래가 잘리지 않는다.

const VIEWPORT_MARGIN = 8;

export function PopoverPortal({
  anchorRef,
  side = "bottom",
  align = "left",
  gap = 4,
  width,
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
      // 보인다. 여기 카드는 문서 최상위에 뜨는 **떠 있는 것**이라, 앵커 옆에 붙어
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
    <div
      ref={cardRef}
      // 이 상자는 body 직계라 조상으로 못 찾는다 — 자리를 재는 검사가 붙잡을 손잡이다
      data-popover
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width }}
      className={cn(
        "fixed z-50 overflow-hidden floating-card",
        // 위치를 재기 전 한 프레임을 엉뚱한 자리에 그리지 않는다
        pos ? "visible" : "invisible",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
