import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems, type NavKey } from "./nav-items";

interface RailProps {
  open: boolean;
  activeKey: NavKey;
  onSelect: (key: NavKey) => void;
}

// 펼침 248px / 접힘 60px 아이콘 모드. w-0으로 사라지지 않는다.
// 상단 44px 스트립은 macOS 신호등 영역 — drag region 유지.
function Rail({ open, activeKey, onSelect }: RailProps) {
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-r bg-sidebar pb-2.5 transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        open ? "w-[248px]" : "w-[60px]",
      )}
    >
      <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />

      <div className={cn("flex h-11 shrink-0 items-center gap-[9px]", open ? "px-[14px]" : "justify-center")}>
        <div className="flex size-[26px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-[13px] font-bold text-primary-foreground">
          A
        </div>
        {open && (
          <span className="whitespace-nowrap text-[13.5px] font-semibold tracking-[-0.01em] text-sidebar-foreground">
            Atelier
          </span>
        )}
      </div>

      <nav className={cn("flex flex-1 flex-col gap-[3px] pt-1", open ? "px-2" : "items-center")}>
        {navItems.map((item, i) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              title={open ? undefined : `${item.label} ⌘${i + 1}`}
              className={cn(
                "flex items-center transition-colors",
                open ? "h-8 w-full gap-[9px] rounded-[10px] px-[9px]" : "size-[38px] justify-center rounded-[12px]",
                active ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-sidebar-accent",
              )}
            >
              <item.icon className="size-[17px] shrink-0" strokeWidth={1.7} />
              {open && <span className="truncate text-[12.5px] font-medium">{item.label}</span>}
            </button>
          );
        })}

        <button
          type="button"
          disabled
          title="Settings — 이번 범위 밖"
          className={cn(
            "mt-auto flex items-center text-muted-foreground opacity-55",
            open ? "h-8 w-full gap-[9px] rounded-[10px] px-[9px]" : "size-[38px] justify-center rounded-[12px]",
          )}
        >
          <SlidersHorizontal className="size-[17px] shrink-0" strokeWidth={1.7} />
          {open && <span className="text-[12.5px] font-medium">Settings</span>}
        </button>
      </nav>
    </aside>
  );
}

export default Rail;
