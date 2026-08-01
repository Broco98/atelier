import { useRef } from "react";
import { cn } from "@/lib/utils";
import SidebarWorkList from "@/features/works/SidebarWorkList";
import { navItems, type NavKey } from "./nav-items";
import useResizableWidth, { ResizeHandle } from "./useResizableWidth";

interface SidebarProps {
  open: boolean;
  // Works 화면에서는 활성 항목이 없다 — nav에 Works가 없기 때문이다
  activeKey: NavKey | null;
  onSelect: (key: NavKey) => void;
}

// 고정 nav 블록 + 상주하는 작업 목록. 어느 화면에 있든 이 사이드바는 바뀌지 않는다.
// 목록이 여기 살면서 셸이 작업 데이터를 직접 읽게 됐다 — 순수 프레젠테이션이 아니다.
function Sidebar({ open, activeKey, onSelect }: SidebarProps) {
  const size = useResizableWidth("sidebar-width", 280, 240, 400);
  // 호버 카드가 이 상자 오른쪽으로 비켜 열린다 — 행이 아니라 사이드바가 기준이다
  const asideRef = useRef<HTMLElement>(null);

  return (
    <aside
      ref={asideRef}
      style={{ "--sidebar-width": `${size.width}px` } as React.CSSProperties}
      className={cn(
        "relative shrink-0 overflow-hidden border-r bg-sidebar",
        // 드래그 중엔 폭 트랜지션을 꺼서 커서를 즉각 따라오게 한다.
        // 곡선은 --ease-panel — 목록 패널 둘과 작업 패널 퇴장이 같은 값을 읽는다 (index.css)
        !size.dragging &&
          "transition-[width,border-color] duration-[220ms] ease-panel",
        // 접을 때 테두리 폭을 0으로 보낸다. border-transparent는 색만 지우고 1px 자리를 남기는데,
        // box-sizing이 border-box라 사용 폭이 0이 아니라 1px에서 바닥을 친다. 그 1px이 오른쪽
        // 전부를 밀어 --titlebar-inset-panel 계산이 어긋났고(간격 6px가 7px), 접힘이 끝난 뒤에도
        // 창 왼쪽 끝에 사이드바 배경 한 줄이 남았다. 목록 패널 둘도 같은 이유로 같은 처리를 한다.
        //
        // border-width는 위 트랜지션 목록에 **넣지 않는다.** WebKit이 0보다 큰 테두리를 디바이스
        // 픽셀 하나로 올림해서, 보간해 봐야 폭 바닥은 그대로인 채 레티나에서 구분선 두께만
        // 1↔2 디바이스픽셀로 튄다 (열림 끝에 툭 굵어진다). 폭은 그냥 끊어 바꾸는 편이 낫다.
        open ? "w-(--sidebar-width)" : "w-0 border-transparent border-r-0",
      )}
    >
      {/* fixed inner width so text doesn't reflow while the width animates */}
      <div
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col pb-2.5 transition-opacity",
          open ? "opacity-100 duration-[220ms]" : "opacity-0 duration-150",
        )}
      >
        {/* traffic light strip — same height as the main header so the logo top
            lines up with where the header ends (the header no longer draws a
            bottom border; the 44px strip is what keeps the two columns aligned) */}
        <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />

        <div className="shrink-0 pb-3 pl-3.5 pt-1">
          <span className="text-xl font-semibold tracking-[-0.01em] text-sidebar-foreground">
            Atelier
          </span>
        </div>

        <nav className="flex shrink-0 flex-col gap-[3px] px-2">
          {navItems.map((item) => {
            const active = item.key === activeKey;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                className={cn(
                  "flex h-8 items-center gap-[9px] rounded-[10px] px-[9px] text-[13.5px] font-medium transition-colors",
                  // 목록 항목과 같은 표시 — 둘이 세로로 붙어 있어 규칙이 다르면 그 자리에서 어긋난다
                  active
                    ? "selected-row text-foreground"
                    : "text-muted-foreground hover:bg-state-1",
                )}
              >
                <item.icon className="size-[17px]" strokeWidth={1.7} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <SidebarWorkList open={open} boundaryRef={asideRef} />
      </div>

      {open && <ResizeHandle control={size} />}
    </aside>
  );
}

export default Sidebar;
