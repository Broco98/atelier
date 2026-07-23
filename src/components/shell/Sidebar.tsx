import { cn } from "@/lib/utils";
import { navItems, type NavKey } from "./nav-items";
import useIsFullscreen from "./useIsFullscreen";
import useResizableWidth, { ResizeHandle } from "./useResizableWidth";

interface SidebarProps {
  open: boolean;
  activeKey: NavKey;
  onSelect: (key: NavKey) => void;
}

function Sidebar({ open, activeKey, onSelect }: SidebarProps) {
  const fullscreen = useIsFullscreen();
  const size = useResizableWidth("sidebar-width", 248, 180, 400);

  return (
    <aside
      style={{ "--sidebar-width": `${size.width}px` } as React.CSSProperties}
      className={cn(
        "relative shrink-0 overflow-hidden border-r bg-sidebar",
        // 드래그 중엔 폭 트랜지션을 꺼서 커서를 즉각 따라오게 한다
        !size.dragging &&
          "transition-[width,border-color] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        open ? "w-(--sidebar-width)" : "w-0 border-transparent",
      )}
    >
      {/* fixed inner width so text doesn't reflow while the width animates */}
      <div
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col pb-2.5 transition-opacity",
          open ? "opacity-100 duration-[220ms]" : "opacity-0 duration-150",
        )}
      >
        {/* traffic light strip — 로고가 신호등·토글 오른쪽에 붙는다.
            pl은 PageHeader inset과 같은 산식(신호등 88/16 + 토글 26 + 간격 12) */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-(--titlebar-height) shrink-0 items-center transition-[padding] duration-[220ms]",
            fullscreen ? "pl-[54px]" : "pl-[126px]",
          )}
        >
          <span
            data-tauri-drag-region
            className="text-[16px] font-semibold tracking-[-0.01em] text-sidebar-foreground"
          >
            Atelier
          </span>
        </div>

        <nav className="flex flex-col gap-[3px] px-2 pt-1">
          {navItems.map((item) => {
            const active = item.key === activeKey;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                className={cn(
                  "flex h-8 items-center gap-[9px] rounded-[10px] px-[9px] text-[13.5px] font-medium transition-colors",
                  active
                    ? "bg-sidebar-primary/12 text-sidebar-primary"
                    : "text-muted-foreground hover:bg-sidebar-accent",
                )}
              >
                <item.icon className="size-[17px]" strokeWidth={1.7} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {open && <ResizeHandle control={size} />}
    </aside>
  );
}

export default Sidebar;
