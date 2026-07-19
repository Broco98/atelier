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
          "flex h-full w-(--sidebar-width) flex-col transition-opacity",
          open ? "opacity-100 duration-[220ms]" : "opacity-0 duration-150",
        )}
      >
        {/* titlebar strip: traffic lights + toggle live here (native / floating) */}
        <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />

        <div className="px-5 pb-2">
          <span className="text-[17px] font-semibold text-foreground">
            Atelier
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-3 pt-2">
          {navItems.map((item) => {
            const active = item.key === activeKey;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                className={cn(
                  "flex h-9 items-center gap-[10px] rounded-lg px-[10px] text-[15px] font-medium transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <item.icon className="size-[18px]" />
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
