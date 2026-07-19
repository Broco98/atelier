import { cn } from "@/lib/utils";
import { navItems, type NavKey } from "./nav-items";

interface SidebarProps {
  open: boolean;
  activeKey: NavKey;
  onSelect: (key: NavKey) => void;
}

function Sidebar({ open, activeKey, onSelect }: SidebarProps) {
  return (
    <aside
      className={cn(
        "shrink-0 overflow-hidden border-r bg-sidebar transition-[width,border-color] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
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
        {/* traffic light strip — same height as the main header so the logo top
            lines up with the header's bottom border */}
        <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />

        <div className="shrink-0 pb-3 pl-3.5 pt-1">
          <span className="text-xl font-semibold tracking-[-0.01em] text-sidebar-foreground">
            Atelier
          </span>
        </div>

        <nav className="flex flex-col gap-[2px] px-2">
          {navItems.map((item) => {
            const active = item.key === activeKey;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                className={cn(
                  "flex h-8 items-center gap-[9px] rounded-[7px] px-[9px] text-[13px] font-medium transition-colors",
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
    </aside>
  );
}

export default Sidebar;
